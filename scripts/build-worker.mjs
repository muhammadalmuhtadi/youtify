import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const backendGoDir = path.join(rootDir, 'backend-go');
const buildDir = path.join(backendGoDir, 'build');

function run(cmd, args, opts = {}) {
  console.log(`[build-worker] > ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
  });
}

// 1. Build React + Vite frontend into ./dist
const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
if (fs.existsSync(viteBin)) {
  run(process.execPath, [viteBin, 'build'], { cwd: rootDir });
} else {
  run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], { cwd: rootDir });
}

// 2. Generate workers-go JS glue (worker.mjs, wasm_exec.js, runtime.mjs)
run(
  'go',
  ['run', 'github.com/syumai/workers-go/cmd/workers-assets-gen@v0.36.0', '-mode=go'],
  { cwd: backendGoDir }
);

// 3. Compile Go Cloudflare Worker binary to WebAssembly (stripped for Worker size limits)
run('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', './build/app.wasm', './cmd/worker'], {
  cwd: backendGoDir,
  env: {
    ...process.env,
    GOOS: 'js',
    GOARCH: 'wasm',
  },
});

// 4. Verify expected output artifacts exist
const requiredFiles = [
  path.join(rootDir, 'dist', 'index.html'),
  path.join(buildDir, 'app.wasm'),
  path.join(buildDir, 'worker.mjs'),
  path.join(buildDir, 'wasm_exec.js'),
];

for (const filePath of requiredFiles) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[build-worker] Missing required build artifact: ${filePath}`);
  }
  const sizeKb = (fs.statSync(filePath).size / 1024).toFixed(1);
  console.log(`[build-worker] OK ${path.relative(rootDir, filePath)} (${sizeKb} KB)`);
}
