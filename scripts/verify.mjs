#!/usr/bin/env node
/**
 * The phase gate (CLAUDE.md): typecheck → lint → test (unit + API + DB) → e2e. Stops at the first failure.
 * Plain Node so it runs the same on Windows, macOS and Linux.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const steps = ['typecheck', 'lint', 'test', 'test:e2e'];

for (const step of steps) {
  console.log(`\n\x1b[1;34m▶ ${step}\x1b[0m`);
  // On Windows, pnpm is a .cmd shim, which needs a shell to run.
  const r = spawnSync('pnpm', [step], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.error || r.status !== 0) {
    if (r.error) console.error(r.error.message);
    console.error(`\n\x1b[1;31m✖ verify failed at: ${step}\x1b[0m`);
    process.exit(r.status || 1);
  }
}
console.log('\n\x1b[1;32m✔ verify passed\x1b[0m');
