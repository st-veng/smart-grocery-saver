import { readFileSync } from 'node:fs';
import { todayIn } from '@sgs/core';
import { createDb, loadRootEnv } from '@sgs/db';
import { MockPriceProvider } from '@sgs/pricing';
import { pino } from 'pino';
import { createApp, REDACT_PATHS } from './app.js';
import { loadConfig } from './config.js';

loadRootEnv();
const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, redact: REDACT_PATHS });
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

const handle = createDb(config.DATABASE_URL);
const provider = new MockPriceProvider({
  seed: config.SEED,
  anchorDate: config.SEED_ANCHOR_DATE ?? todayIn(),
});
const app = createApp({
  pool: handle.pool,
  provider,
  metro: config.METRO,
  version,
  startedAt: new Date(),
  clock: () => new Date(),
  logger,
});

const server = app.listen(config.PORT, () => {
  logger.info(
    `API listening on http://localhost:${config.PORT} (provider ${provider.id}, metro ${config.METRO})`,
  );
});

function shutdown(signal: string): void {
  logger.info(`${signal} received, shutting down`);
  server.close(() => {
    void handle.close().then(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  shutdown('SIGINT');
});
