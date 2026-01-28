/**
 * @deprecated This file is kept for backwards compatibility.
 * Import from '../core/api/client.js' instead.
 */
export { SlimaApiClient } from '../core/api/client.js';
export type { ApiClientConfig, Logger } from '../core/api/client.js';

// Legacy compatibility: SlimaConfig type
export interface SlimaConfig {
  baseUrl: string;
  token: string;
}
