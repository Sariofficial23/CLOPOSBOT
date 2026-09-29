/** Base class for everything thrown by the Clopos integration. Never carries secrets. */
export class CloposError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CloposError';
  }
}

/** Credentials rejected, token missing/expired and could not be renewed. */
export class CloposAuthError extends CloposError {
  constructor(message = 'Clopos authentication failed', status?: number) {
    super(message, 'CLOPOS_AUTH_FAILED', status);
    this.name = 'CloposAuthError';
  }
}

/** Non-2xx response from Clopos (after retries). */
export class CloposHttpError extends CloposError {
  constructor(status: number, method: string, path: string, detail?: string) {
    super(`Clopos ${method} ${path} failed with HTTP ${status}${detail ? `: ${detail}` : ''}`, 'CLOPOS_HTTP_ERROR', status);
    this.name = 'CloposHttpError';
  }
}

/** Response did not match the documented shape. */
export class CloposUnexpectedResponseError extends CloposError {
  constructor(what: string) {
    super(`Unexpected Clopos response: ${what}`, 'CLOPOS_UNEXPECTED_RESPONSE', 502);
    this.name = 'CloposUnexpectedResponseError';
  }
}

/**
 * The operation has no documented endpoint in the official Clopos Open API
 * (https://developer.clopos.com). We intentionally do NOT guess one.
 * `required` describes what Clopos would need to provide.
 */
export class CloposNotSupportedError extends CloposError {
  constructor(
    public readonly operation: string,
    public readonly required: string,
  ) {
    super(
      `Clopos Open API does not document an endpoint for "${operation}". Required: ${required}`,
      'CLOPOS_NOT_SUPPORTED',
      501,
    );
    this.name = 'CloposNotSupportedError';
  }
}
