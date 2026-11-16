import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';

/** Load the repo-root .env (if any) without overriding variables already set. */
export function loadRootEnv(startDir: string = process.cwd()): void {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) {
      const envFile = path.join(dir, '.env');
      if (fs.existsSync(envFile)) config({ path: envFile, quiet: true });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export const DEFAULT_DATABASE_URL = 'postgres://sgs:sgs@localhost:5433/sgs_dev';
export const DEFAULT_DATABASE_URL_TEST = 'postgres://sgs:sgs@localhost:5433/sgs_test';

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}
