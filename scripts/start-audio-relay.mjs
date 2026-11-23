import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ROOT_DIR = path.resolve(import.meta.dirname, '..');
const WORKER_DIR = path.join(ROOT_DIR, 'backend-go');
const SECRET_FILE = path.join(ROOT_DIR, 'data', 'relay-secret.json');
const PORT = process.env.PORT || '3001';
const LOCAL_HEALTH_URL = `http://127.0.0.1:${PORT}/api/relay/health`;

function ensureRelayToken() {
  fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SECRET_FILE, 'utf8'));
      if (typeof parsed?.token === 'string' && parsed.token.length >= 32) {
        return parsed.token;
      }
    }
  } catch {
    // Regenerate corrupt file below
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  return token;
}

async function waitForDnsViaDoH(hostname, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(
        `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        {
          headers: { Accept: 'application/dns-json' },
          signal: AbortSignal.timeout(2500),
        }
      );
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (Array.isArray(j?.Answer) && j.Answer.length > 0) return true;
      }
    } catch {
      // Wait and retry DoH lookup
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function checkRelayHealthOnce(url, timeoutMs = 4000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j?.ok && j?.relay) return true;
    }
  } catch {
    // Ignore transient probe error
  }
  return false;
}

async function waitForHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkRelayHealthOnce(url, 2500)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function putWranglerSecret(name, value) {
  const isWin = process.platform === 'win32';
  const exe = isWin ? (process.env.ComSpec || 'cmd.exe') : 'npx';
  const args = isWin
    ? ['/d', '/c', 'npx', 'wrangler', 'secret', 'put', name]
    : ['wrangler', 'secret', 'put', name];
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, {
      cwd: WORKER_DIR,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.stderr.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`wrangler secret put ${name} exited ${code}: ${out}`));
    });
    child.stdin.write(`${value}\n`);
    child.stdin.end();
  });
}

function resolveCloudflaredBin() {
  const winDefault = 'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe';
  if (process.platform === 'win32' && fs.existsSync(winDefault)) {
    return winDefault;
  }
  return 'cloudflared';
}

async function main() {
  const token = ensureRelayToken();
  const cfBin = resolveCloudflaredBin();
  let shuttingDown = false;
  let nodeProc = null;
  let cfProc = null;
  let currentTunnelUrl = '';
  let consecutiveHealthFailures = 0;

  const killChild = (proc) => {
    if (!proc || proc.killed) return;
    try {
      proc.kill('SIGTERM');
    } catch {
      // Ignore
    }
  };

  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[relay] Shutting down (${sig})...`);
    killChild(cfProc);
    killChild(nodeProc);
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  async function startNodeServer() {
    if (shuttingDown) return;
    console.log(`[relay] Starting local Node audio relay on port ${PORT}...`);
    const proc = spawn(process.execPath, [path.join(ROOT_DIR, 'server', 'index.js')], {
      cwd: ROOT_DIR,
      env: {
        ...process.env,
        PORT,
        AUDIO_RELAY_TOKEN: token,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    nodeProc = proc;
    proc.stdout.on('data', (d) => process.stdout.write(`[node] ${d}`));
    proc.stderr.on('data', (d) => process.stderr.write(`[node] ${d}`));
    proc.on('exit', (code) => {
      if (shuttingDown || nodeProc !== proc) return;
      console.error(`[relay] Node server exited unexpectedly (${code}). Respawning in 2s...`);
      setTimeout(() => {
        if (!shuttingDown) {
          startNodeServer().catch((err) => {
            console.error('[relay] Failed to respawn Node server:', err?.message || err);
          });
        }
      }, 2000);
    });

    const localReady = await waitForHealth(LOCAL_HEALTH_URL, 20000);
    if (!localReady) {
      throw new Error(`Local audio relay did not become healthy at ${LOCAL_HEALTH_URL}`);
    }
    console.log(`[relay] Local health OK: ${LOCAL_HEALTH_URL}`);
  }

  function startCloudflared() {
    if (shuttingDown) return;
    currentTunnelUrl = '';
    consecutiveHealthFailures = 0;
    console.log(`[relay] Launching cloudflared quick tunnel (${cfBin})...`);
    const proc = spawn(cfBin, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
      cwd: ROOT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    cfProc = proc;

    let tunnelUrl = '';
    let secretsUploaded = false;

    const onTunnelChunk = async (chunk) => {
      if (cfProc !== proc || shuttingDown) return;
      const text = chunk.toString();
      process.stdout.write(`[cf] ${text}`);
      if (tunnelUrl || secretsUploaded) return;
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (!match) return;
      tunnelUrl = match[0];
      const hostname = new URL(tunnelUrl).hostname;
      console.log(`[relay] Tunnel assigned: ${tunnelUrl}. Waiting for 1.1.1.1 DNS & health...`);
      await waitForDnsViaDoH(hostname, 20000);
      await new Promise((r) => setTimeout(r, 1500));
      const pubOk = await waitForHealth(`${tunnelUrl}/api/relay/health`, 30000);
      if (!pubOk) {
        console.error(`[relay] Tunnel URL ${tunnelUrl} did not respond on /api/relay/health in time.`);
        killChild(proc);
        return;
      }
      try {
        await putWranglerSecret('AUDIO_RELAY_URL', tunnelUrl);
        await putWranglerSecret('AUDIO_RELAY_TOKEN', token);
        if (cfProc !== proc || shuttingDown) return;
        currentTunnelUrl = tunnelUrl;
        consecutiveHealthFailures = 0;
        secretsUploaded = true;
        console.log(`READY: ${tunnelUrl}`);
      } catch (err) {
        console.error('[relay] Failed to upload Cloudflare Worker secrets:', err?.message || err);
      }
    };

    proc.stdout.on('data', onTunnelChunk);
    proc.stderr.on('data', onTunnelChunk);
    proc.on('exit', (code) => {
      if (shuttingDown || cfProc !== proc) return;
      console.error(`[relay] cloudflared exited unexpectedly (${code}). Respawning in 3s...`);
      currentTunnelUrl = '';
      setTimeout(() => {
        if (!shuttingDown) startCloudflared();
      }, 3000);
    });
  }

  await startNodeServer();
  startCloudflared();

  // Periodic 45s tunnel health watchdog
  const watchdog = setInterval(async () => {
    if (shuttingDown || !currentTunnelUrl) return;
    const localOk = await checkRelayHealthOnce(LOCAL_HEALTH_URL, 3000);
    if (!localOk) return;
    const pubOk = await checkRelayHealthOnce(`${currentTunnelUrl}/api/relay/health`, 6000);
    if (pubOk) {
      consecutiveHealthFailures = 0;
      return;
    }
    consecutiveHealthFailures += 1;
    console.warn(
      `[relay] Tunnel watchdog miss (${consecutiveHealthFailures}/3) for ${currentTunnelUrl}`
    );
    if (consecutiveHealthFailures >= 3) {
      console.error('[relay] Tunnel failed 3 consecutive probes; restarting cloudflared...');
      consecutiveHealthFailures = 0;
      currentTunnelUrl = '';
      killChild(cfProc);
    }
  }, 45000);
  watchdog.unref?.();
}

main().catch((err) => {
  console.error('[relay] Fatal error:', err?.message || err);
  process.exit(1);
});
