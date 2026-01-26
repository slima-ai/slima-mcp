/**
 * Logger 工具
 *
 * 重要：MCP STDIO 模式下，stdout 是協議通道，
 * 所有日誌必須輸出到 stderr
 */

const isDebug = process.env.DEBUG === 'true' || process.env.DEBUG === '1';

export const logger = {
  info: (message: string, ...args: unknown[]) => {
    console.error(`[INFO] ${message}`, ...args);
  },

  warn: (message: string, ...args: unknown[]) => {
    console.error(`[WARN] ${message}`, ...args);
  },

  error: (message: string, error?: unknown) => {
    if (error instanceof Error) {
      console.error(`[ERROR] ${message}:`, error.message);
      if (isDebug && error.stack) {
        console.error(error.stack);
      }
    } else if (error !== undefined) {
      console.error(`[ERROR] ${message}:`, error);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  },

  debug: (message: string, ...args: unknown[]) => {
    if (isDebug) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  },
};
