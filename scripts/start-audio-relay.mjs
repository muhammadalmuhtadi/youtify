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

async function waitForHealth(url, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j?.ok && j?.relay) return true;
      }
    } catch {
      // Wait and retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function putWranglerSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'secret', 'put', name], {
      cwd: WORKER_DIR,
      shell: process.platform === 'win32',
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
  const children = [];
  let shuttingDown = false;

  const shutdown = (sig) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[relay] Shutting down (${sig})...`);
    for (const ch of children) {
      try {
        ch.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  console.log(`[relay] Starting local Node audio relay on port ${PORT}...`);
  const nodeProc = spawn(process.execPath, [path.join(ROOT_DIR, 'server', 'index.js')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT,
      AUDIO_RELAY_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(nodeProc);
  nodeProc.stdout.on('data', (d) => process.stdout.write(`[node] ${d}`));
  nodeProc.stderr.on('data', (d) => process.stderr.write(`[node] ${d}`));
  nodeProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[relay] Node server exited unexpectedly (${code}).`);
      shutdown('node-exit');
    }
  });

  const localReady = await waitForHealth(LOCAL_HEALTH_URL, 20000);
  if (!localReady) {
    throw new Error(`Local audio relay did not become healthy at ${LOCAL_HEALTH_URL}`);
  }
  console.log(`[relay] Local health OK: ${LOCAL_HEALTH_URL}`);

  const cfBin = resolveCloudflaredBin();
  console.log(`[relay] Launching cloudflared quick tunnel (${cfBin})...`);
  const cfProc = spawn(cfBin, ['tunnel', '--url', `http://127.0.0.1:${PORT}`, '--no-autoupdate'], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(cfProc);

  let tunnelUrl = '';
  let secretsUploaded = false;

  const onTunnelChunk = async (chunk) => {
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
      return;
    }
    try {
      await putWranglerSecret('AUDIO_RELAY_URL', tunnelUrl);
      await putWranglerSecret('AUDIO_RELAY_TOKEN', token);
      secretsUploaded = true;
      console.log(`READY: ${tunnelUrl}`);
    } catch (err) {
      console.error('[relay] Failed to upload Cloudflare Worker secrets:', err?.message || err);
    }
  };

  cfProc.stdout.on('data', onTunnelChunk);
  cfProc.stderr.on('data', onTunnelChunk);
  cfProc.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`[relay] cloudflared exited unexpectedly (${code}).`);
      shutdown('cloudflared-exit');
    }
  });
}

main().catch((err) => {
  console.error('[relay] Fatal error:', err?.message || err);
  process.exit(1);
});
