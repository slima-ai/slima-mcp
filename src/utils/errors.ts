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
  constructor(resource = 'Resource') {
    super(404, 'NOT_FOUND', `${resource} not found`);
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
 * 格式化錯誤訊息供 MCP 回傳
 */
export function formatErrorForMcp(error: unknown): string {
  if (error instanceof SlimaApiError) {
    switch (error.code) {
      case 'NOT_FOUND':
        return 'Resource not found. Please check the token.';
      case 'UNAUTHORIZED':
        return 'Invalid API token. Please check your configuration.';
      case 'INSUFFICIENT_CREDITS':
        return 'Insufficient credits. Please top up your account.';
      case 'TOKEN_EXPIRED':
        return 'API token has expired. Please generate a new one.';
      case 'TOKEN_REVOKED':
        return 'API token has been revoked. Please generate a new one.';
      default:
        return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'An unexpected error occurred.';
}
