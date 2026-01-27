/**
 * Slima API Client
 */

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
import { logger } from '../utils/logger.js';

export interface SlimaConfig {
  baseUrl: string;
  token: string;
}

export class SlimaApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: SlimaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // 移除尾部斜線
    this.token = config.token;
  }

  /**
   * 發送 API 請求
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug(`${method} ${path}`);

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'slima-mcp-server/0.1.0',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const json = (await response.json()) as ApiResponse<T>;
    return json.data;
  }

  /**
   * 處理錯誤回應
   */
  private async handleErrorResponse(response: Response): Promise<never> {
    let errorData: ApiError | undefined;

    try {
      errorData = (await response.json()) as ApiError;
    } catch {
      // 無法解析 JSON
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

  // === 書籍相關 ===

  /**
   * 列出所有書籍
   */
  async listBooks(): Promise<Book[]> {
    return this.request<Book[]>('GET', '/api/v1/books');
  }

  /**
   * 取得書籍詳情
   */
  async getBook(token: string): Promise<Book> {
    return this.request<Book>('GET', `/api/v1/books/${token}`);
  }

  /**
   * 建立新書籍
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

  // === 版本控制相關 ===

  /**
   * 列出 Commits
   * 注意：API 回傳 { commits: [...] }，需要解構
   */
  async listCommits(bookToken: string, limit = 10): Promise<Commit[]> {
    const response = await this.request<CommitsListResponse>(
      'GET',
      `/api/v1/books/${bookToken}/commits?limit=${limit}`
    );
    return response.commits;
  }

  /**
   * 取得 Commit 詳情
   */
  async getCommit(bookToken: string, commitToken: string): Promise<Commit> {
    return this.request<Commit>(
      'GET',
      `/api/v1/books/${bookToken}/commits/${commitToken}`
    );
  }

  /**
   * 列出分支
   */
  async listBranches(bookToken: string): Promise<Branch[]> {
    return this.request<Branch[]>('GET', `/api/v1/books/${bookToken}/branches`);
  }

  /**
   * 下載 Blobs
   * 注意：API 回傳 { blobs: [...], notFound: [...], truncated: ... }
   */
  async downloadBlobs(bookToken: string, hashes: string[]): Promise<Blob[]> {
    const response = await this.request<BlobsDownloadResponse>(
      'POST',
      `/api/v1/books/${bookToken}/blobs/download`,
      { hashes }
    );
    return response.blobs;
  }

  // === Persona 相關 ===

  /**
   * 列出所有 Personas
   */
  async listPersonas(genre?: string): Promise<Persona[]> {
    const params = genre ? `?genre=${encodeURIComponent(genre)}` : '';
    return this.request<Persona[]>('GET', `/api/v1/personas${params}`);
  }

  /**
   * 取得 Persona 詳情
   */
  async getPersona(token: string): Promise<Persona> {
    return this.request<Persona>('GET', `/api/v1/personas/${token}`);
  }

  // === Reader Test 相關 ===

  /**
   * 建立 Reader Test
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
   * 取得 Reader Test 進度
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
   * 取得 Reader Test 結果
   */
  async getReaderTest(bookToken: string, testToken: string): Promise<ReaderTest> {
    return this.request<ReaderTest>(
      'GET',
      `/api/v1/books/${bookToken}/reader_tests/${testToken}`
    );
  }

  // === MCP File Operations ===

  /**
   * 讀取檔案內容
   */
  async readFile(bookToken: string, path: string): Promise<McpFileReadResponse> {
    return this.request<McpFileReadResponse>(
      'POST',
      `/api/v1/books/${bookToken}/mcp/files/read`,
      { path }
    );
  }

  /**
   * 建立新檔案
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
   * 更新（覆寫）檔案內容
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
   * 刪除檔案
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
   * 附加內容到檔案
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
   * 搜尋檔案內容
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
