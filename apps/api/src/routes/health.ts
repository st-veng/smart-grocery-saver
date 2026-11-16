import type { HealthResponse, ReadyResponse } from '@sgs/shared';
import { Router } from 'express';
import type { AppDeps } from '../app.js';

const CHECK_TIMEOUT_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`${what} timed out after ${ms} ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function healthRouter(deps: AppDeps): Router {
  const r = Router();

  r.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      version: deps.version,
      uptimeS: Math.max(0, Math.round((deps.clock().getTime() - deps.startedAt.getTime()) / 1000)),
    };
    res.json(body);
  });

  r.get('/health/ready', async (_req, res) => {
    const [database, migrations, provider] = await Promise.all([
      withTimeout(deps.pool.query('SELECT 1'), CHECK_TIMEOUT_MS, 'database')
        .then(() => ({ ok: true }))
        .catch((e: unknown) => ({ ok: false, detail: message(e) })),
      withTimeout(
        deps.pool.query('SELECT count(*)::text AS applied FROM drizzle.__drizzle_migrations'),
        CHECK_TIMEOUT_MS,
        'migrations',
      )
        .then((q) => {
          const applied = Number(q.rows[0]?.applied ?? 0);
          return applied > 0
            ? { ok: true, applied }
            : { ok: false, applied, detail: 'no migrations applied' };
        })
        .catch((e: unknown) => ({ ok: false, applied: 0, detail: message(e) })),
      withTimeout(deps.provider.health(), CHECK_TIMEOUT_MS, 'provider')
        .then((h) => ({ ...h, id: deps.provider.id }))
        .catch((e: unknown) => ({ ok: false, id: deps.provider.id, detail: message(e) })),
    ]);
    const ready = database.ok && migrations.ok && provider.ok;
    const body: ReadyResponse = {
      status: ready ? 'ready' : 'not_ready',
      checks: { database, migrations, provider },
      priceProvider: deps.provider.id,
      metro: deps.metro,
    };
    res.status(ready ? 200 : 503).json(body);
  });

  return r;
}
