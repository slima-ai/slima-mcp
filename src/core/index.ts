/**
 * Slima MCP Core Module
 *
 * Platform-agnostic core functionality that can be used by both CLI and Worker.
 */

// API Client
export { SlimaApiClient } from './api/client.js';
export type { ApiClientConfig, Logger } from './api/client.js';
export * from './api/types.js';

// Tools
export {
  registerBookTools,
  registerContentTools,
  registerBetaReaderTools,
  registerFileTools,
} from './tools/index.js';

// Utils
export * from './utils/errors.js';
