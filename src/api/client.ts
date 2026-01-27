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
}
