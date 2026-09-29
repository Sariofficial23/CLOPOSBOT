import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  badRequest: (message: string, details?: unknown) => new AppError(400, 'BAD_REQUEST', message, details),
  unauthorized: (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message),
  forbidden: (message = 'You do not have permission to perform this action') => new AppError(403, 'FORBIDDEN', message),
  notFound: (entity = 'Resource') => new AppError(404, 'NOT_FOUND', `${entity} not found`),
  conflict: (code: string, message: string) => new AppError(409, code, message),
};

export interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

/** Parse with a Zod schema; throws a ZodError that the error handler maps to 400. */
export function parse<T>(schema: { parse: (data: unknown) => T }, data: unknown): T {
  return schema.parse(data);
}

export function zodDetails(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
