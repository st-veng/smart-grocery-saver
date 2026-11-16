import pg from 'pg';
import { createDb, type DbHandle } from './client.js';
import { DEFAULT_DATABASE_URL_TEST, loadRootEnv } from './env.js';
import { runMigrations } from './migrate.js';

/** URL of a per-suite test database derived from DATABASE_URL_TEST, e.g. sgs_test_db. */
export function testDatabaseUrl(suffix: string): string {
  loadRootEnv();
  const base = new URL(process.env.DATABASE_URL_TEST ?? DEFAULT_DATABASE_URL_TEST);
  base.pathname = `/${base.pathname.replace(/^\//, '')}_${suffix}`;
  return base.toString();
}

function adminUrl(url: string): string {
  const u = new URL(url);
  u.pathname = '/postgres';
  return u.toString();
}

/** Drop + create an empty database. Requires CREATEDB (the dev/CI role is a superuser). */
export async function recreateDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing unsafe database name: ${name}`);
  const admin = new pg.Client({ connectionString: adminUrl(url) });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

/** Fresh, migrated database for one test suite. */
export async function createTestDatabase(suffix: string): Promise<DbHandle & { url: string }> {
  const url = testDatabaseUrl(suffix);
  await recreateDatabase(url);
  await runMigrations(url);
  return { url, ...createDb(url, { max: 4 }) };
}
