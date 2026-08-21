/**
 * 錯誤處理工具
 */

export class SlimaApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
    message?: string
  ) {
    super(message || `API Error: ${status}`);
    this.name = 'SlimaApiError';
  }
}

export class AuthenticationError extends SlimaApiError {
  constructor(message = 'Invalid or expired API token') {
    super(401, 'UNAUTHORIZED', message);
    this.name = 'AuthenticationError';
  }
}

export class NotFoundError extends SlimaApiError {
  constructor(message?: string) {
    super(404, 'NOT_FOUND', message || 'Resource not found');
    this.name = 'NotFoundError';
  }
}

export class InsufficientCreditsError extends SlimaApiError {
  constructor() {
    super(402, 'INSUFFICIENT_CREDITS', 'Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}

/**
 * 429 from Rails' rack-attack.
 *
 * `retryAfter` is the whole point of having a distinct class: without it the
 * caller is told "you were throttled" but not for how long, and an agent's
 * only options are to guess or to give up. Rails runs ~24 throttle rules and
 * sends Retry-After with them; dropping that header turns a recoverable pause
 * into an opaque failure.
 */
export class RateLimitedError extends SlimaApiError {
  constructor(
    public retryAfterSeconds?: number,
    message?: string
  ) {
    super(429, 'RATE_LIMITED', message || 'Rate limited');
    this.name = 'RateLimitedError';
  }
}

/**
 * The request exceeded its own deadline — distinct from the server refusing
 * it. Nothing here used to time out at all, so a hung server meant a tool call
 * that never returned.
 */
export class RequestTimeoutError extends SlimaApiError {
  constructor(public timeoutMs: number) {
    super(408, 'REQUEST_TIMEOUT', `Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * 格式化錯誤訊息供 MCP 回傳
 */
export function formatErrorForMcp(error: unknown): string {
  if (error instanceof RateLimitedError) {
    const wait = error.retryAfterSeconds;

    return wait
      ? `Rate limited. Wait ${wait} second${wait === 1 ? '' : 's'} and try the same call again — this is a temporary throttle, not a rejected request.`
      : 'Rate limited. Wait a few seconds and try the same call again — this is a temporary throttle, not a rejected request.';
  }

  if (error instanceof RequestTimeoutError) {
    return `${error.message}. The server may still be processing it, so re-running a write could duplicate work — prefer re-reading the current state first.`;
  }

  if (error instanceof SlimaApiError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        return 'Invalid API token. Please check your configuration.';
      case 'INSUFFICIENT_CREDITS':
        return 'Insufficient credits. Please top up your account.';
      case 'TOKEN_EXPIRED':
        return 'API token has expired. Please generate a new one.';
      case 'TOKEN_REVOKED':
        return 'API token has been revoked. Please generate a new one.';
      default:
        return `Error: ${error.message}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred.';
}
