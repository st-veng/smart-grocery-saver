import type { LatLng } from '@sgs/core';
import type { Db } from '@sgs/db';
import type { PriceProvider } from '@sgs/pricing';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import type { GoogleClient } from './auth/google.js';
import { csrfGuard, DEFAULT_RATE_LIMITS, type RateLimits } from './auth/middleware.js';
import type { TokenService } from './auth/tokens.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { meRouter, storesRouter } from './routes/me.js';

/** Minimal query interface so tests can inject a failing database. */
export interface Queryable {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface AppConfig {
  readonly webOrigin: string;
  readonly cookieSecure: boolean;
  readonly preselectRadiusMiles: number;
  readonly defaultOrigin: LatLng;
}

export interface AppDeps {
  readonly pool: Queryable;
  readonly db: Db;
  readonly provider: PriceProvider;
  readonly tokens: TokenService;
  readonly google: GoogleClient;
  readonly config: AppConfig;
  readonly rateLimits: RateLimits;
  readonly metro: string;
  readonly version: string;
  readonly startedAt: Date;
  /** Injected clock — services never call Date.now() directly. */
  readonly clock: () => Date;
  readonly logger?: Logger;
}

/** Log redaction applies to every phase: secrets never reach logs. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.password_hash',
  '*.token',
  '*.refreshToken',
  '*.accessToken',
  '*.code',
];

export { DEFAULT_RATE_LIMITS };

export function createApp(deps: AppDeps): Express {
  const logger = deps.logger ?? pino({ level: 'silent' });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(
    pinoHttp({
      logger,
      redact: REDACT_PATHS,
      autoLogging: { ignore: (req) => req.url.startsWith('/api/v1/health') },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.use(cookieParser());
  app.use('/api/v1', csrfGuard);

  app.use('/api/v1', healthRouter(deps));
  app.use('/api/v1/auth', authRouter({ ...deps, logger }));
  app.use('/api/v1/me', meRouter(deps));
  app.use('/api/v1/stores', storesRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
