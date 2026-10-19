import type { ApiError } from '../shared/types';

/** An error that maps directly onto an HTTP status and an ApiError body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toBody(): ApiError {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Upstream routing provider failure (bad gateway). */
export class ProviderError extends HttpError {
  constructor(message: string) {
    super(502, 'PROVIDER_ERROR', message);
    this.name = 'ProviderError';
  }
}
