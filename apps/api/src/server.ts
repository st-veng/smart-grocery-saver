import { readFileSync } from 'node:fs';
import { todayIn } from '@sgs/core';
import { createDb, loadRootEnv } from '@sgs/db';
import { MockPriceProvider } from '@sgs/pricing';
import { pino } from 'pino';
import { createApp, DEFAULT_RATE_LIMITS, REDACT_PATHS } from './app.js';
import { MockGoogleClient, RealGoogleClient, type GoogleClient } from './auth/google.js';
import { scaleLimits } from './auth/middleware.js';
import { TokenService } from './auth/tokens.js';
import { loadConfig } from './config.js';

loadRootEnv();
const config = loadConfig();
const logger = pino({ level: config.LOG_LEVEL, redact: REDACT_PATHS });
const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as {
  version: string;
};
const clock = () => new Date();

const handle = createDb(config.DATABASE_URL);
const provider = new MockPriceProvider({
  seed: config.SEED,
  anchorDate: config.SEED_ANCHOR_DATE ?? todayIn(),
});
const google: GoogleClient =
  config.googleMode === 'real' && config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
    ? new RealGoogleClient({
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        redirectUri: config.GOOGLE_REDIRECT_URI,
      })
    : new MockGoogleClient();

const app = createApp({
  pool: handle.pool,
  db: handle.db,
  provider,
  tokens: new TokenService(config.JWT_SECRET, clock),
  google,
  config: {
    webOrigin: config.WEB_ORIGIN,
    cookieSecure: config.COOKIE_SECURE,
    preselectRadiusMiles: config.PRESELECT_RADIUS_MILES,
    defaultOrigin: config.DEFAULT_ORIGIN,
    testHooks: config.ENABLE_TEST_HOOKS,
  },
  rateLimits: scaleLimits(DEFAULT_RATE_LIMITS, config.AUTH_RATE_LIMIT_SCALE),
  metro: config.METRO,
  version,
  startedAt: new Date(),
  clock,
  logger,
});

const server = app.listen(config.PORT, () => {
  logger.info(
    `API listening on http://localhost:${config.PORT} (provider ${provider.id}, metro ${config.METRO}, google ${google.mode})`,
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
