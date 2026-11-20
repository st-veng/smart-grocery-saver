#!/usr/bin/env node
/**
 * `pnpm db:up` / `pnpm db:down` on Windows, macOS and Linux.
 *
 * With Docker running: PostgreSQL 17 from docker-compose.yml on port 5433.
 * Without Docker (Linux and macOS only): falls back to a local PostgreSQL install via
 * scripts/local-pg-up.sh / local-pg-down.sh (used by CI-like sandboxes that have no Docker daemon).
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const action = process.argv[2];

if (action !== 'up' && action !== 'down') {
  console.error('Usage: node scripts/db.mjs up|down');
  process.exit(2);
}

/** Run a command in the repo root, showing its output; returns the exit code. */
function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit' });
  if (r.error) {
    console.error(`Could not run ${cmd}: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

function dockerRunning() {
  const r = spawnSync('docker', ['info'], { cwd: root, stdio: 'ignore' });
  return !r.error && r.status === 0;
}

if (dockerRunning()) {
  const code =
    action === 'up'
      ? run('docker', ['compose', 'up', '-d', '--wait', 'db'])
      : run('docker', ['compose', 'down']);
  if (code === 0) {
    console.log(action === 'up' ? 'Postgres (docker) ready on :5433' : 'Postgres (docker) stopped');
  }
  process.exit(code);
}

if (isWindows) {
  const installed = !spawnSync('docker', ['--version'], { stdio: 'ignore' }).error;
  console.error(
    installed
      ? 'Docker is installed but not running. Start Docker Desktop, wait until it says it is running, then try again.'
      : 'Docker was not found. Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, then open a new terminal and try again.',
  );
  process.exit(1);
}

process.exit(
  run('bash', [join('scripts', action === 'up' ? 'local-pg-up.sh' : 'local-pg-down.sh')]),
);
