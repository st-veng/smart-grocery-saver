import type { ErrorCode, ErrorResponse } from '@sgs/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown[],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', 404, `No route for ${req.method} ${req.path}`));
};

/** Single error → JSON mapping. Never leaks stack traces or SQL. */
export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    let body: ErrorResponse;
    let status: number;
    if (err instanceof AppError) {
      status = err.status;
      body = {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      };
    } else if (isBodyParserError(err)) {
      status = err.status;
      body = {
        error: {
          code: err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_FAILED',
          message: err.status === 413 ? 'Request body too large' : 'Malformed JSON body',
        },
      };
    } else {
      status = 500;
      logger.error({ err }, 'unhandled error');
      body = { error: { code: 'INTERNAL', message: 'Something went wrong' } };
    }
    res.status(status).json(body);
  };
}

function isBodyParserError(err: unknown): err is { status: number; type: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'type' in err &&
    'status' in err &&
    typeof (err as { status: unknown }).status === 'number'
  );
}
