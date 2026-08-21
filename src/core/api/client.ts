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
  type McpFileEditResponse,
  type McpFileDeleteResponse,
  type McpFileAppendResponse,
  type McpSearchResponse,
  type McpFileVisualizeResponse,
  type BooksPage,
  type PaginationMeta,
} from './types.js';
import {
  SlimaApiError,
  AuthenticationError,
  NotFoundError,
  InsufficientCreditsError,
  RateLimitedError,
  RequestTimeoutError,
} from '../utils/errors.js';

/**
 * Per-request deadline.
 *
 * Sixty seconds is well clear of any single Slima endpoint — the long-running
 * one (Beta Reader) is polled in short calls rather than held open — while
 * still being short enough that a wedged server surfaces as an error the agent
 * can act on instead of a tool call that never comes back.
 */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Retry-After is either a delta in seconds or an HTTP date (RFC 9110). Both
 * appear in the wild, so handle both and return undefined rather than a wrong
 * number when it is absent or unparseable — a missing wait is better than a
 * confidently incorrect one.
 */
function parseRetryAfter(response: Response): number | undefined {
  // Guarded the same way handleUpgradeHint is: mocked Response objects in tests
  // do not always carry a full Headers interface, and a throttle response is a
  // bad moment to crash on a missing accessor.
  const header = response.headers?.get?.('retry-after');
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const when = Date.parse(header);
  if (Number.isNaN(when)) return undefined;

  return Math.max(0, Math.ceil((when - Date.now()) / 1000));
}

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
    body?: unknown,
    options: { envelope?: boolean } = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.getToken();

    this.logger.debug(`${method} ${path}`);

    // Nothing here used to bound the call. If Rails stopped responding the
    // fetch would sit open for whatever the host runtime allowed, and the MCP
    // client had no deadline of its own — a hung server became a tool call
    // that never returned.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': `slima-mcp-server/${__VERSION__}`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      // Check the signal, not just the error name. `AbortError` is what Node and
      // browsers throw, but this same client runs in Cloudflare Workers, and a
      // runtime that names its abort differently would otherwise slip past into
      // the generic branch and lose the "the server may still be processing it"
      // guidance. The name check stays as the fallback for the reverse case —
      // an abort surfacing before the signal flips.
      if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new RequestTimeoutError(REQUEST_TIMEOUT_MS);
      }
      // Anything else — including a platform-level timeout the runtime imposes
      // on its own, which we did not trigger and cannot recognise — is passed
      // through unchanged rather than mislabelled as our deadline.
      throw error;
    } finally {
      clearTimeout(deadline);
    }

    // Rails surfaces a soft staleness signal via this header when the client
    // is older than McpVersions::MIN_RECOMMENDED. Log once per request so the
    // user / wrapping AI client notices without hard-failing the call.
    this.handleUpgradeHint(response);

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const json = (await response.json()) as ApiResponse<T>;
    // `envelope` keeps meta (pagination totals); the default unwraps to `data`.
    return (options.envelope ? json : json.data) as T;
  }

  /**
   * Like #request but keeps the whole envelope. Paginated endpoints carry the
   * real total in `meta`, and dropping it is how `list_books` came to report a
   * capped page as if it were the whole library.
   *
   * Delegates to #request rather than re-implementing fetch/auth/error handling:
   * the first version copied those ~20 lines and had already lost request()'s
   * debug log, so list_books was the one call invisible at debug level.
   */
  private async requestWithMeta<T>(
    method: string,
    path: string
  ): Promise<{ data: T; meta?: PaginationMeta }> {
    return this.request<{ data: T; meta?: PaginationMeta }>(method, path, undefined, {
      envelope: true,
    });
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
      case 429:
        // Rails' rack-attack sends Retry-After alongside the 429. Carrying it
        // through is what separates "wait N seconds, then repeat the call"
        // from a generic failure the agent has to guess its way out of.
        throw new RateLimitedError(parseRetryAfter(response), message);
      default:
        throw new SlimaApiError(response.status, code, message);
    }
  }

  // === Book Operations ===

  /**
   * List books (one page). `meta` carries the true total — callers must report
   * it rather than presenting a page as the whole library.
   */
  async listBooks(options: { page?: number } = {}): Promise<BooksPage> {
    const page = options.page && options.page > 1 ? `&page=${options.page}` : '';
    const response = await this.requestWithMeta<Book[]>(
      'GET',
      `/api/v1/books?status=active${page}`
    );
    return { books: response.data ?? [], meta: response.meta ?? {} };
  }

  /**
   * Get book details
   */
  // === Teaching surface =====================================================
  //
  // These are why the client stays thin. Everything they return is authored and
  // served by Rails, so the guidance an AI reads updates when the server
  // deploys — including for the users who pinned an old version of this package,
  // who are exactly the ones stale guidance would mislead.

  async getCapabilities(): Promise<unknown> {
    return this.request('GET', '/api/v1/mcp/capabilities');
  }

  async listGuides(): Promise<{ guides: Array<{ slug: string; title: string; summary: string }> }> {
    return this.request('GET', '/api/v1/mcp/guides');
  }

  async loadGuide(slug: string): Promise<{ slug: string; title: string; body: string }> {
    return this.request('GET', `/api/v1/mcp/guides/${encodeURIComponent(slug)}`);
  }

  async listWritingSkills(): Promise<{ skills: Array<{ key: string; name: string; description: string }> }> {
    return this.request('GET', '/api/v1/mcp/skills');
  }

  async loadWritingSkill(key: string): Promise<{ key: string; name: string; body: string }> {
    return this.request('GET', `/api/v1/mcp/skills/${encodeURIComponent(key)}`);
  }

  // === Teams ================================================================

  async listTeams(): Promise<unknown[]> {
    return this.request('GET', '/api/v1/teams');
  }

  async getTeam(token: string): Promise<unknown> {
    return this.request('GET', `/api/v1/teams/${token}`);
  }

  async listTeamSkills(token: string): Promise<unknown[]> {
    return this.request('GET', `/api/v1/teams/${token}/skills`);
  }

  async listTeamMemories(token: string): Promise<unknown> {
    return this.request('GET', `/api/v1/teams/${token}/memories`);
  }

  async listTeamRules(token: string): Promise<unknown> {
    return this.request('GET', `/api/v1/teams/${token}/rules`);
  }

  async semanticSearch(bookToken: string, query: string, limit?: number): Promise<unknown> {
    return this.request('POST', `/api/v1/books/${bookToken}/semantic-search`, { query, limit });
  }

  // === Notes and comments ===================================================

  async listNotes(bookToken: string): Promise<unknown> {
    return this.request('GET', `/api/v1/books/${bookToken}/notes`);
  }

  async createNote(bookToken: string, note: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/api/v1/books/${bookToken}/notes`, { note });
  }

  async listComments(bookToken: string): Promise<unknown> {
    return this.request('GET', `/api/v1/books/${bookToken}/comments`);
  }

  async createComment(bookToken: string, comment: Record<string, unknown>): Promise<unknown> {
    return this.request('POST', `/api/v1/books/${bookToken}/comments`, { comment });
  }

  async resolveComment(bookToken: string, commentToken: string): Promise<unknown> {
    return this.request('POST', `/api/v1/books/${bookToken}/comments/${commentToken}/resolve`);
  }

  async reopenComment(bookToken: string, commentToken: string): Promise<unknown> {
    return this.request('POST', `/api/v1/books/${bookToken}/comments/${commentToken}/reopen`);
  }

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
    params: {
      path: string;
      content?: string;
      parentPath?: string;
      commitMessage?: string;
      /** manuscript | reference | character | location | storyline */
      contentType?: string;
    }
  ): Promise<McpFileCreateResponse> {
    return this.request<McpFileCreateResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/create`,
      {
        path: params.path,
        content: params.content || '',
        parent_path: params.parentPath,
        commit_message: params.commitMessage,
        content_type: params.contentType,
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
   * Search-and-replace inside a file, applied SERVER-side.
   *
   * The old client-side read-modify-write reported a replacement count this
   * process computed and blind-wrote the whole file back, so concurrent edits
   * silently clobbered each other while both callers saw a success
   * (iss_gkqwnovhajzl7xvz). Rails re-reads inside its branch lock.
   */
  async editFile(
    bookToken: string,
    params: {
      path: string;
      oldString: string;
      newString: string;
      replaceAll?: boolean;
      commitMessage?: string;
    }
  ): Promise<McpFileEditResponse> {
    return this.request<McpFileEditResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/edit`,
      {
        path: params.path,
        old_string: params.oldString,
        new_string: params.newString,
        replace_all: params.replaceAll,
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
   * Render a structured file (today: .map relationship graphs) as an image
   * plus a text summary.
   */
  async visualizeFile(
    bookToken: string,
    path: string
  ): Promise<McpFileVisualizeResponse> {
    return this.request<McpFileVisualizeResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/visualize`,
      { path }
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
