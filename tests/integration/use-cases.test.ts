/**
 * Use Case Integration Tests
 *
 * Tests complete user workflows end-to-end
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../../src/api/client.js';
import { registerBookTools } from '../../src/tools/books.js';
import { registerContentTools } from '../../src/tools/content.js';
import { registerBetaReaderTools } from '../../src/tools/beta-reader.js';
import { registerFileTools } from '../../src/tools/files.js';
import { NotFoundError, AuthenticationError, InsufficientCreditsError } from '../../src/utils/errors.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

describe('Use Case: New Author Starting a Book', () => {
  let handlers: Map<string, ToolHandler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();

    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
        return server;
      }
    );

    mockClient = {
      createBook: vi.fn(),
      listBooks: vi.fn(),
      getBook: vi.fn(),
      createFile: vi.fn(),
      readFile: vi.fn(),
      updateFile: vi.fn(),
      listCommits: vi.fn(),
    };

    registerBookTools(server, mockClient as SlimaApiClient);
    registerContentTools(server, mockClient as SlimaApiClient);
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  it('should complete full book creation workflow', async () => {
    // Step 1: Create a new book
    (mockClient.createBook as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'bk_newbook123',
      title: '我的第一本小說',
      authorName: '作者名',
    });

    const createResult = await handlers.get('create_book')!({
      title: '我的第一本小說',
      author_name: '作者名',
      description: '一個關於冒險的故事',
    });

    expect(createResult.content[0].text).toContain('Book created successfully');
    expect(createResult.content[0].text).toContain('bk_newbook123');

    // Step 2: Create chapter structure
    (mockClient.createFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_1', name: 'Create chapter-01.md' },
      fileToken: 'fl_ch01',
    });

    const createChapterResult = await handlers.get('create_file')!({
      book_token: 'bk_newbook123',
      path: 'chapters/chapter-01.md',
      content: '# 第一章\n\n故事開始了...',
    });

    expect(createChapterResult.content[0].text).toContain('created successfully');

    // Step 3: Create character notes
    (mockClient.createFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_2', name: 'Create protagonist.md' },
      fileToken: 'fl_char',
    });

    const createCharResult = await handlers.get('create_file')!({
      book_token: 'bk_newbook123',
      path: 'characters/protagonist.md',
      content: '# 主角設定\n\n姓名：李小明\n年齡：25歲',
    });

    expect(createCharResult.content[0].text).toContain('created successfully');
  });

  it('should verify book was created by listing books', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'bk_newbook123',
        title: '我的第一本小說',
        authorName: '作者名',
        totalWordCount: 150,
      },
    ]);

    const listResult = await handlers.get('list_books')!({});

    expect(listResult.content[0].text).toContain('Found 1 book');
    expect(listResult.content[0].text).toContain('我的第一本小說');
  });
});

describe('Use Case: Daily Writing Workflow', () => {
  let handlers: Map<string, ToolHandler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();

    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
        return server;
      }
    );

    mockClient = {
      readFile: vi.fn(),
      updateFile: vi.fn(),
      appendToFile: vi.fn(),
      getBook: vi.fn(),
      listCommits: vi.fn(),
    };

    registerBookTools(server, mockClient as SlimaApiClient);
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  it('should read, edit, and append to chapter', async () => {
    // Step 1: Read current chapter
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'chapter-01.md', path: 'chapters/chapter-01.md', wordCount: 500 },
      content: '# 第一章\n\n小明走在街上，天空下著雨。他想著今天發生的事...',
    });

    const readResult = await handlers.get('read_file')!({
      book_token: 'bk_test',
      path: 'chapters/chapter-01.md',
    });

    expect(readResult.content[0].text).toContain('第一章');
    expect(readResult.content[0].text).toContain('500');

    // Step 2: Edit a specific part (fix typo or revise)
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'chapter-01.md', path: 'chapters/chapter-01.md', wordCount: 500 },
      content: '# 第一章\n\n小明走在街上，天空下著雨。他想著今天發生的事...',
    });
    (mockClient.updateFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_edit1', name: 'Edit chapter' },
    });

    const editResult = await handlers.get('edit_file')!({
      book_token: 'bk_test',
      path: 'chapters/chapter-01.md',
      old_string: '天空下著雨',
      new_string: '天空飄著細雨',
    });

    expect(editResult.content[0].text).toContain('edited successfully');

    // Step 3: Append new content
    (mockClient.appendToFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_append1', name: 'Append to chapter' },
    });

    const appendResult = await handlers.get('append_to_file')!({
      book_token: 'bk_test',
      path: 'chapters/chapter-01.md',
      content: '\n\n突然，一道閃電劃破天際。小明抬頭望去，看見了不可思議的景象...',
    });

    expect(appendResult.content[0].text).toContain('appended successfully');
  });

  it('should check writing stats after writing session', async () => {
    (mockClient.getBook as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'bk_test',
      title: '測試書籍',
      totalWordCount: 2500,
      manuscriptWordCount: 2000,
      language: 'zh-TW',
    });

    (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
      { token: 'cmt_1', totalWordCount: 2500 },
      { token: 'cmt_2', totalWordCount: 2200 },
      { token: 'cmt_3', totalWordCount: 2000 },
    ]);

    const statsResult = await handlers.get('get_writing_stats')!({
      book_token: 'bk_test',
    });

    expect(statsResult.content[0].text).toContain('2,500');
    expect(statsResult.content[0].text).toContain('+500'); // Progress
  });
});

describe('Use Case: Research and Organization', () => {
  let handlers: Map<string, ToolHandler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();

    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
        return server;
      }
    );

    mockClient = {
      searchFiles: vi.fn(),
      readFile: vi.fn(),
      deleteFile: vi.fn(),
      listCommits: vi.fn(),
    };

    registerBookTools(server, mockClient as SlimaApiClient);
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  it('should search for character mentions across book', async () => {
    (mockClient.searchFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [
        {
          file: { path: 'chapters/chapter-01.md', wordCount: 1000 },
          matchCount: 3,
          snippets: [
            { text: '...小明走在街上...' },
            { text: '...小明轉頭看向...' },
          ],
        },
        {
          file: { path: 'chapters/chapter-05.md', wordCount: 800 },
          matchCount: 5,
          snippets: [
            { text: '...小明終於明白了...' },
          ],
        },
        {
          file: { path: 'characters/protagonist.md', wordCount: 200 },
          matchCount: 2,
          snippets: [
            { text: '姓名：小明' },
          ],
        },
      ],
    });

    const searchResult = await handlers.get('search_content')!({
      book_token: 'bk_test',
      query: '小明',
    });

    expect(searchResult.content[0].text).toContain('3 file(s)');
    expect(searchResult.content[0].text).toContain('chapter-01.md');
    expect(searchResult.content[0].text).toContain('chapter-05.md');
    expect(searchResult.content[0].text).toContain('protagonist.md');
  });

  it('should clean up old draft files', async () => {
    (mockClient.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      commit: { token: 'cmt_del1', name: 'Delete old-draft.md' },
    });

    const deleteResult = await handlers.get('delete_file')!({
      book_token: 'bk_test',
      path: 'drafts/old-draft.md',
      commit_message: '清理舊草稿',
    });

    expect(deleteResult.content[0].text).toContain('deleted successfully');
  });
});

describe('Use Case: Beta Reader Feedback', () => {
  let handlers: Map<string, ToolHandler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();

    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
        return server;
      }
    );

    mockClient = {
      listPersonas: vi.fn(),
      createReaderTest: vi.fn(),
      getReaderTestProgress: vi.fn(),
      getReaderTest: vi.fn(),
      readFile: vi.fn(),
      listCommits: vi.fn(),
      downloadBlobs: vi.fn(),
    };

    registerBetaReaderTools(server, mockClient as SlimaApiClient);
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  it('should complete beta reader feedback workflow', async () => {
    // Step 1: List available personas
    (mockClient.listPersonas as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'psn_fantasy1',
        slug: 'fantasy_reader_1',
        displayLabels: { zh: '奇幻愛好者', en: 'Fantasy Reader' },
        description: '熱愛奇幻文學的資深讀者',
        genreTags: ['fantasy', 'adventure'],
        demographics: { gender: 'female', ageRange: '25-34' },
      },
      {
        token: 'psn_romance1',
        slug: 'romance_reader_1',
        displayLabels: { zh: '浪漫文學迷', en: 'Romance Reader' },
        description: '喜歡愛情故事的讀者',
        genreTags: ['romance'],
        demographics: { gender: 'male', ageRange: '18-24' },
      },
    ]);

    const personasResult = await handlers.get('list_personas')!({});

    expect(personasResult.content[0].text).toContain('奇幻愛好者');
    expect(personasResult.content[0].text).toContain('浪漫文學迷');

    // Step 2: Setup mocks for analyze_chapter
    // analyze_chapter needs: listCommits -> downloadBlobs -> createReaderTest -> poll -> getReaderTest
    (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'cmt_1',
        filesSnapshot: [
          {
            token: 'fl_ch01',
            name: 'chapter-01.md',
            path: 'chapters/chapter-01.md',
            kind: 'file',
            blobHash: 'sha256:abc123',
            position: 0,
          },
        ],
      },
    ]);

    (mockClient.downloadBlobs as ReturnType<typeof vi.fn>).mockResolvedValue([
      { hash: 'sha256:abc123', content: '# 第一章：冒險的開始\n\n主角踏上了冒險的旅程...' },
    ]);

    (mockClient.createReaderTest as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'rt_test123',
      status: 'processing',
    });

    (mockClient.getReaderTestProgress as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'completed',
      progress: 100,
    });

    (mockClient.getReaderTest as ReturnType<typeof vi.fn>).mockResolvedValue({
      token: 'rt_test123',
      status: 'completed',
      progress: 100,
      reportType: 'chapter',
      personaCount: 1,
      completedPersonaCount: 1,
      personaTokens: ['psn_fantasy1'],
      individualFeedbacks: [
        {
          personaToken: 'psn_fantasy1',
          personaName: '奇幻愛好者',
          overall: {
            continueReading: 8,
            recommendation: 7,
          },
          detailedFeedback: {
            whatWorked: '這是一個引人入勝的開場！世界觀設定獨特，讓人想繼續閱讀。',
            strongestElement: '世界觀設定有趣',
          },
        },
      ],
      createdAt: '2026-01-28T00:00:00Z',
    });

    // Step 3: Request analysis from fantasy reader
    const analysisResult = await handlers.get('analyze_chapter')!({
      book_token: 'bk_test',
      file_path: 'chapters/chapter-01.md',
      persona_token: 'psn_fantasy1',
    });

    expect(analysisResult.content[0].text).toContain('引人入勝');
    expect(analysisResult.content[0].text).toContain('世界觀設定有趣');
  });

  it('should filter personas by genre', async () => {
    (mockClient.listPersonas as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'psn_fantasy1',
        slug: 'fantasy_reader_1',
        displayLabels: { zh: '奇幻愛好者', en: 'Fantasy Reader' },
        description: '熱愛奇幻文學',
        genreTags: ['fantasy'],
        demographics: { gender: 'female', ageRange: '25-34' },
      },
    ]);

    const result = await handlers.get('list_personas')!({ genre: 'fantasy' });

    expect(mockClient.listPersonas).toHaveBeenCalledWith('fantasy');
    expect(result.content[0].text).toContain('奇幻愛好者');
  });
});

describe('Use Case: Error Handling', () => {
  let handlers: Map<string, ToolHandler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();

    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
        return server;
      }
    );

    mockClient = {
      listBooks: vi.fn(),
      readFile: vi.fn(),
      createReaderTest: vi.fn(),
      getReaderTestProgress: vi.fn(),
      getReaderTest: vi.fn(),
      listCommits: vi.fn(),
    };

    registerBookTools(server, mockClient as SlimaApiClient);
    registerFileTools(server, mockClient as SlimaApiClient);
    registerBetaReaderTools(server, mockClient as SlimaApiClient);
  });

  it('should handle authentication expired error', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AuthenticationError('Token expired')
    );

    const result = await handlers.get('list_books')!({});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid API token');
  });

  it('should handle book not found error', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('Book not found: bk_invalid')
    );

    const result = await handlers.get('read_file')!({
      book_token: 'bk_invalid',
      path: 'chapter-01.md',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should handle file not found error', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('File not found: nonexistent.md')
    );

    const result = await handlers.get('read_file')!({
      book_token: 'bk_test',
      path: 'nonexistent.md',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not found');
  });

  it('should handle insufficient credits for beta reader', async () => {
    // analyze_chapter calls listCommits first to get filesSnapshot
    (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        token: 'cmt_1',
        filesSnapshot: [
          {
            token: 'fl_ch01',
            name: 'chapter-01.md',
            path: 'chapter-01.md',
            kind: 'file',
            blobHash: 'sha256:abc',
            position: 0,
          },
        ],
      },
    ]);

    // Mock downloadBlobs which is called before createReaderTest
    mockClient.downloadBlobs = vi.fn().mockResolvedValue([
      { hash: 'sha256:abc', content: 'Test chapter content' },
    ]);

    (mockClient.createReaderTest as ReturnType<typeof vi.fn>).mockRejectedValue(
      new InsufficientCreditsError()
    );

    const result = await handlers.get('analyze_chapter')!({
      book_token: 'bk_test',
      file_path: 'chapter-01.md',
      persona_token: 'psn_test',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('credits');
  });

  it('should provide helpful error when edit target not found', async () => {
    (mockClient.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
      file: { name: 'chapter-01.md', path: 'chapter-01.md', wordCount: 100 },
      content: 'Hello world',
    });

    const result = await handlers.get('edit_file')!({
      book_token: 'bk_test',
      path: 'chapter-01.md',
      old_string: 'goodbye universe',
      new_string: 'hello galaxy',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Could not find');
    expect(result.content[0].text).toContain('Tip');
  });
});

describe('Use Case: Empty Book Handling', () => {
  let handlers: Map<string, ToolHandler>;
  let mockClient: Partial<SlimaApiClient>;

  beforeEach(() => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    handlers = new Map();

    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as ToolHandler;
        handlers.set(name, handler);
        return server;
      }
    );

    mockClient = {
      listBooks: vi.fn(),
      listCommits: vi.fn(),
      searchFiles: vi.fn(),
    };

    registerBookTools(server, mockClient as SlimaApiClient);
    registerFileTools(server, mockClient as SlimaApiClient);
  });

  it('should handle empty book list gracefully', async () => {
    (mockClient.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handlers.get('list_books')!({});

    expect(result.content[0].text).toContain('No books found');
  });

  it('should handle empty book structure', async () => {
    (mockClient.listCommits as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await handlers.get('get_book_structure')!({
      book_token: 'bk_empty',
    });

    expect(result.content[0].text).toContain('No commits found');
    expect(result.content[0].text).toContain('empty');
  });

  it('should handle no search results', async () => {
    (mockClient.searchFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [],
    });

    const result = await handlers.get('search_content')!({
      book_token: 'bk_test',
      query: 'nonexistent keyword xyz123',
    });

    expect(result.content[0].text).toContain('No matches found');
  });
});
