import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { createDb } from './client.js';

export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
);

export async function runMigrations(url: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await handle.close();
  }
}

/** Latest applied migration (for /health/ready). */
export async function migrationStatus(
  pool: pg.Pool,
): Promise<{ applied: number; latestAt: number | null }> {
  const res = await pool.query<{ applied: string; latest: string | null }>(
    `SELECT count(*)::text AS applied, max(created_at)::text AS latest FROM drizzle.__drizzle_migrations`,
  );
  const row = res.rows[0];
  return { applied: Number(row?.applied ?? 0), latestAt: row?.latest ? Number(row.latest) : null };
}

/** Drop and recreate the application schemas, then migrate. Destroys all data in `url`. */
export async function resetDatabase(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
