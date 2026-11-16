import type { PriceProvider } from '@sgs/pricing';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pino, type Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFoundHandler } from './errors.js';
import { healthRouter } from './routes/health.js';

/** Minimal query interface so tests can inject a failing database. */
export interface Queryable {
  query(text: string): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface AppDeps {
  readonly pool: Queryable;
  readonly provider: PriceProvider;
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
  '*.token',
  '*.refreshToken',
];

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

  app.use('/api/v1', healthRouter(deps));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
