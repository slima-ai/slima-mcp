/**
 * Slima API Client
 *
 * Supports dependency injection for token retrieval,
 * allowing different strategies for CLI (file-based) vs Worker (KV-based).
 */

// Version is injected at build time by tsup `define` (CLI + Worker) and mirrored
// in vitest.config.ts so tests see a real version string too.
declare const __VERSION__: string;

import {
  type Book,
  type Commit,
  type Branch,
  type Blob,
  type Persona,
  type ReaderTest,
  type ReaderTestProgress,
  type CreateReaderTestParams,
  type ApiResponse,
  type ApiError,
  type CommitsListResponse,
  type BlobsDownloadResponse,
  type McpFileReadResponse,
  type McpFileCreateResponse,
  type McpFileUpdateResponse,
  type McpFileDeleteResponse,
  type McpFileAppendResponse,
  type McpSearchResponse,
} from './types.js';
import {
  SlimaApiError,
  AuthenticationError,
  NotFoundError,
  InsufficientCreditsError,
} from '../utils/errors.js';

// Export for logger injection (optional)
export interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, error?: unknown) => void;
}

// Default no-op logger
const defaultLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * API Client Configuration (new style with token getter)
 */
export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => Promise<string>;  // Async token getter (injected)
  logger?: Logger;
}

/**
 * Legacy config format (backwards compatibility)
 * @deprecated Use ApiClientConfig with getToken instead
 */
export interface SlimaConfig {
  baseUrl: string;
  token: string;
}

// Type guard to check if config is legacy format
function isLegacyConfig(config: ApiClientConfig | SlimaConfig): config is SlimaConfig {
  return 'token' in config && typeof (config as SlimaConfig).token === 'string';
}

export class SlimaApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string>;
  private readonly logger: Logger;

  constructor(config: ApiClientConfig | SlimaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash

    // Support both legacy and new config formats
    if (isLegacyConfig(config)) {
      const staticToken = config.token;
      this.getToken = async () => staticToken;
      this.logger = defaultLogger;
    } else {
      this.getToken = config.getToken;
      this.logger = config.logger || defaultLogger;
    }
  }

  /**
   * Send API request
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.getToken();

    this.logger.debug(`${method} ${path}`);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': `slima-mcp-server/${__VERSION__}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // Rails surfaces a soft staleness signal via this header when the client
    // is older than McpVersions::MIN_RECOMMENDED. Log once per request so the
    // user / wrapping AI client notices without hard-failing the call.
    this.handleUpgradeHint(response);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const json = (await response.json()) as ApiResponse<T>;
    return json.data;
  }

  /**
   * Surface the X-Slima-MCP-Upgrade-Hint header (if present) as a warn log.
   * Deduped per (hint, baseUrl) to keep stderr quiet during long sessions.
   * Defensive: mocked Response objects in tests may not carry a full Headers
   * interface, so guard the access rather than hard-crashing the request.
   */
  private readonly loggedUpgradeHints = new Set<string>();
  private handleUpgradeHint(response: Response): void {
    const hint = response?.headers?.get?.('X-Slima-MCP-Upgrade-Hint');
    if (!hint) return;

    const key = `${hint}::${this.baseUrl}`;
    if (this.loggedUpgradeHints.has(key)) return;
    this.loggedUpgradeHints.add(key);

    this.logger.warn(
      `[slima-mcp] ${hint} — upgrade options: npm install -g slima-mcp@latest, ` +
        'or change your Claude Desktop config to "npx -y slima-mcp@0".'
    );
  }

  /**
   * Handle error response
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: ApiError | undefined;

    try {
      errorData = (await response.json()) as ApiError;
    } catch {
      // Cannot parse JSON
    }

    const code = errorData?.error?.code;
    const message = errorData?.error?.message;

    switch (response.status) {
      case 401:
        throw new AuthenticationError(message);
      case 404:
        throw new NotFoundError(message);
      case 402:
        throw new InsufficientCreditsError();
      default:
        throw new SlimaApiError(response.status, code, message);
    }
  }

  // === Book Operations ===

  /**
   * List all books
   */
  async listBooks(): Promise<Book[]> {
    return this.request<Book[]>('GET', '/api/v1/books?status=active');
  }

  /**
   * Get book details
   */
  async getBook(token: string): Promise<Book> {
    return this.request<Book>('GET', `/api/v1/books/${token}`);
  }

  /**
   * Create a new book
   */
  async createBook(params: {
    title: string;
    authorName?: string;
    description?: string;
  }): Promise<Book> {
    return this.request<Book>('POST', '/api/v1/books', {
      book: {
        title: params.title,
        author_name: params.authorName,
        description: params.description,
      },
    });
  }

  // === Version Control ===

  /**
   * List commits
   */
  async listCommits(bookToken: string, limit = 10): Promise<Commit[]> {
    const response = await this.request<CommitsListResponse>(
      'GET',
      `/api/v1/books/${bookToken}/commits?limit=${limit}`
    );
    return response.commits;
  }

  /**
   * Get commit details
   */
  async getCommit(bookToken: string, commitToken: string): Promise<Commit> {
    return this.request<Commit>(
      'GET',
      `/api/v1/books/${bookToken}/commits/${commitToken}`
    );
  }

  /**
   * List branches
   */
  async listBranches(bookToken: string): Promise<Branch[]> {
    return this.request<Branch[]>('GET', `/api/v1/books/${bookToken}/branches`);
  }

  /**
   * Download blobs
   */
  async downloadBlobs(bookToken: string, hashes: string[]): Promise<Blob[]> {
    const response = await this.request<BlobsDownloadResponse>(
      'POST',
      `/api/v1/books/${bookToken}/blobs/download`,
      { hashes }
    );
    return response.blobs;
  }

  // === Persona ===

  /**
   * List personas
   */
  async listPersonas(genre?: string): Promise<Persona[]> {
    const params = genre ? `?genre=${encodeURIComponent(genre)}` : '';
    return this.request<Persona[]>('GET', `/api/v1/personas${params}`);
  }

  /**
   * Get persona details
   */
  async getPersona(token: string): Promise<Persona> {
    return this.request<Persona>('GET', `/api/v1/personas/${token}`);
  }

  // === Reader Test ===

  /**
   * Create reader test
   */
  async createReaderTest(
    bookToken: string,
    params: CreateReaderTestParams
  ): Promise<ReaderTest> {
    return this.request<ReaderTest>(
      'POST',
      `/api/v1/books/${bookToken}/reader_tests`,
      {
        reader_test: {
          report_type: params.reportType || 'chapter',
          persona_tokens: params.personaTokens,
          commit_token: params.commitToken,
          model: params.model,
          scope_config: params.scopeConfig,
        },
        content: params.content,
      }
    );
  }

  /**
   * Get reader test progress
   */
  async getReaderTestProgress(
    bookToken: string,
    testToken: string
  ): Promise<ReaderTestProgress> {
    return this.request<ReaderTestProgress>(
      'GET',
      `/api/v1/books/${bookToken}/reader_tests/${testToken}/progress`
    );
  }

  /**
   * Get reader test result
   */
  async getReaderTest(bookToken: string, testToken: string): Promise<ReaderTest> {
    return this.request<ReaderTest>(
      'GET',
      `/api/v1/books/${bookToken}/reader_tests/${testToken}`
    );
  }

  // === MCP File Operations ===

  /**
   * Read file content
   */
  async readFile(bookToken: string, path: string): Promise<McpFileReadResponse> {
    return this.request<McpFileReadResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/read`,
      { path }
    );
  }

  /**
   * Create file
   */
  async createFile(
    bookToken: string,
    params: { path: string; content?: string; parentPath?: string; commitMessage?: string }
  ): Promise<McpFileCreateResponse> {
    return this.request<McpFileCreateResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/create`,
      {
        path: params.path,
        content: params.content || '',
        parent_path: params.parentPath,
        commit_message: params.commitMessage,
      }
    );
  }

  /**
   * Update (overwrite) file content
   */
  async updateFile(
    bookToken: string,
    params: { path: string; content: string; commitMessage?: string }
  ): Promise<McpFileUpdateResponse> {
    return this.request<McpFileUpdateResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/update`,
      {
        path: params.path,
        content: params.content,
        commit_message: params.commitMessage,
      }
    );
  }

  /**
   * Delete file
   */
  async deleteFile(
    bookToken: string,
    params: { path: string; commitMessage?: string }
  ): Promise<McpFileDeleteResponse> {
    return this.request<McpFileDeleteResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/delete`,
      {
        path: params.path,
        commit_message: params.commitMessage,
      }
    );
  }

  /**
   * Append content to file
   */
  async appendToFile(
    bookToken: string,
    params: { path: string; content: string; commitMessage?: string }
  ): Promise<McpFileAppendResponse> {
    return this.request<McpFileAppendResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/append`,
      {
        path: params.path,
        content: params.content,
        commit_message: params.commitMessage,
      }
    );
  }

  /**
   * Search file content
   */
  async searchFiles(
    bookToken: string,
    params: { query: string; fileTypes?: string[]; limit?: number }
  ): Promise<McpSearchResponse> {
    return this.request<McpSearchResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/search`,
      {
        query: params.query,
        file_types: params.fileTypes,
        limit: params.limit,
      }
    );
  }
}
