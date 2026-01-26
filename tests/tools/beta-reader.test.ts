/**
 * Beta Reader Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerBetaReaderTools } from '../../src/tools/beta-reader.js';
import { InsufficientCreditsError } from '../../src/utils/errors.js';

describe('Beta Reader Tools', () => {
  let server: McpServer;
  let mockClient: {
    listPersonas: ReturnType<typeof vi.fn>;
    listCommits: ReturnType<typeof vi.fn>;
    downloadBlobs: ReturnType<typeof vi.fn>;
    createReaderTest: ReturnType<typeof vi.fn>;
    getReaderTestProgress: ReturnType<typeof vi.fn>;
    getReaderTest: ReturnType<typeof vi.fn>;
  };
  let toolHandlers: Map<string, Function>;

  beforeEach(() => {
    server = new McpServer({
      name: 'test',
      version: '1.0.0',
    });

    mockClient = {
      listPersonas: vi.fn(),
      listCommits: vi.fn(),
      downloadBlobs: vi.fn(),
      createReaderTest: vi.fn(),
      getReaderTestProgress: vi.fn(),
      getReaderTest: vi.fn(),
    };

    // Capture tool handlers
    toolHandlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation(
      (name: string, _desc: string, _schema: unknown, handler: Function) => {
        toolHandlers.set(name, handler);
        return server;
      }
    );

    registerBetaReaderTools(server, mockClient as unknown as SlimaApiClient);
  });

  describe('registerBetaReaderTools', () => {
    it('should register list_personas tool', () => {
      expect(toolHandlers.has('list_personas')).toBe(true);
    });

    it('should register analyze_chapter tool', () => {
      expect(toolHandlers.has('analyze_chapter')).toBe(true);
    });
  });

  describe('list_personas handler', () => {
    const mockPersonas = [
      {
        token: 'psn_fantasy1',
        slug: 'fantasy-reader-1',
        genreTags: ['fantasy', 'adventure'],
        displayLabels: { zh: '奇幻讀者小明', en: 'Fantasy Reader Ming' },
        demographics: { gender: 'male', ageRange: '18-25' },
      },
      {
        token: 'psn_romance1',
        slug: 'romance-reader-1',
        genreTags: ['romance', 'drama'],
        displayLabels: { zh: '言情讀者小美', en: 'Romance Reader Mei' },
        demographics: { gender: 'female', ageRange: '25-35' },
      },
    ];

    it('should list all personas', async () => {
      mockClient.listPersonas.mockResolvedValue(mockPersonas);

      const handler = toolHandlers.get('list_personas')!;
      const result = await handler({});

      expect(result.content[0].text).toContain('Available Personas (2)');
      expect(result.content[0].text).toContain('奇幻讀者小明');
      expect(result.content[0].text).toContain('psn_fantasy1');
      expect(result.content[0].text).toContain('fantasy, adventure');
      expect(result.content[0].text).toContain('male');
      expect(result.content[0].text).toContain('18-25');
    });

    it('should filter personas by genre', async () => {
      mockClient.listPersonas.mockResolvedValue([mockPersonas[0]]);

      const handler = toolHandlers.get('list_personas')!;
      await handler({ genre: 'fantasy' });

      expect(mockClient.listPersonas).toHaveBeenCalledWith('fantasy');
    });

    it('should return message when no personas found', async () => {
      mockClient.listPersonas.mockResolvedValue([]);

      const handler = toolHandlers.get('list_personas')!;
      const result = await handler({});

      expect(result.content[0].text).toContain('No personas found');
    });

    it('should include genre in message when filtering', async () => {
      mockClient.listPersonas.mockResolvedValue([]);

      const handler = toolHandlers.get('list_personas')!;
      const result = await handler({ genre: 'horror' });

      expect(result.content[0].text).toContain('for genre "horror"');
    });

    it('should handle API errors', async () => {
      mockClient.listPersonas.mockRejectedValue(new Error('API Error'));

      const handler = toolHandlers.get('list_personas')!;
      const result = await handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('API Error');
    });

    it('should handle personas with minimal data', async () => {
      const minimalPersona = {
        token: 'psn_min',
        slug: 'minimal-reader',
        genreTags: null,
        displayLabels: null,
        demographics: null,
      };
      mockClient.listPersonas.mockResolvedValue([minimalPersona]);

      const handler = toolHandlers.get('list_personas')!;
      const result = await handler({});

      expect(result.content[0].text).toContain('minimal-reader');
      expect(result.content[0].text).toContain('General');
      expect(result.content[0].text).toContain('N/A');
    });
  });

  describe('analyze_chapter handler', () => {
    const mockFilesSnapshot = [
      {
        token: 'ch01',
        name: 'chapter-01.md',
        kind: 'file',
        position: 0,
        blobHash: 'sha256:chapter1',
        wordCount: 1000,
      },
    ];

    const mockReaderTestResult = {
      token: 'rpt_test1',
      status: 'completed',
      personaResults: [
        {
          persona: {
            slug: 'fantasy-reader',
            displayLabels: { zh: '奇幻讀者' },
          },
          overallImpression: 'Great chapter!',
          emotionalResponse: 'Exciting and engaging',
          characterFeedback: 'Well-developed protagonist',
          suggestions: 'Consider adding more dialogue',
        },
      ],
    };

    beforeEach(() => {
      // Default successful mocks
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
      ]);
      mockClient.downloadBlobs.mockResolvedValue([
        { hash: 'sha256:chapter1', content: 'Chapter content here...' },
      ]);
      mockClient.createReaderTest.mockResolvedValue({ token: 'rpt_test1', status: 'pending' });
      mockClient.getReaderTestProgress.mockResolvedValue({ status: 'completed', progress: 100 });
      mockClient.getReaderTest.mockResolvedValue(mockReaderTestResult);
    });

    it('should analyze chapter and return feedback', async () => {
      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_fantasy1',
      });

      expect(result.content[0].text).toContain('Beta Reader Feedback');
      expect(result.content[0].text).toContain('奇幻讀者');
      expect(result.content[0].text).toContain('Great chapter!');
      expect(result.content[0].text).toContain('Exciting and engaging');
      expect(result.content[0].text).toContain('Well-developed protagonist');
      expect(result.content[0].text).toContain('Consider adding more dialogue');
    });

    it('should create reader test with correct params', async () => {
      const handler = toolHandlers.get('analyze_chapter')!;
      await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_fantasy1',
      });

      expect(mockClient.createReaderTest).toHaveBeenCalledWith('bk_test', {
        personaTokens: ['psn_fantasy1'],
        commitToken: 'cmt_1',
        scopeConfig: { chapters: ['chapter-01.md'] },
        content: 'Chapter content here...',
      });
    });

    it('should return error when no commits found', async () => {
      mockClient.listCommits.mockResolvedValue([]);

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No commits found');
    });

    it('should return error when file not found', async () => {
      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'nonexistent.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
    });

    it('should return error when file has no content', async () => {
      mockClient.listCommits.mockResolvedValue([
        {
          token: 'cmt_1',
          filesSnapshot: [
            { token: 'empty', name: 'empty.md', kind: 'file', position: 0, blobHash: null },
          ],
        },
      ]);

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'empty.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('has no content');
    });

    it('should return error when blob download fails', async () => {
      mockClient.downloadBlobs.mockResolvedValue([]);

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Could not retrieve file content');
    });

    it('should handle analysis failure', async () => {
      mockClient.getReaderTestProgress.mockResolvedValue({ status: 'failed' });

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Analysis failed');
    });

    it('should handle insufficient credits error', async () => {
      mockClient.createReaderTest.mockRejectedValue(
        new InsufficientCreditsError('Not enough credits')
      );

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Insufficient credits');
    });

    it('should handle no feedback available', async () => {
      mockClient.getReaderTest.mockResolvedValue({
        token: 'rpt_test1',
        status: 'completed',
        personaResults: [],
      });

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_1',
      });

      expect(result.content[0].text).toContain('No feedback available');
    });

    it('should handle partial feedback data', async () => {
      mockClient.getReaderTest.mockResolvedValue({
        token: 'rpt_test1',
        status: 'completed',
        personaResults: [
          {
            persona: { slug: 'reader-1' },
            overallImpression: 'Good',
            // Missing other fields
          },
        ],
      });

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_1',
      });

      expect(result.content[0].text).toContain('reader-1');
      expect(result.content[0].text).toContain('Good');
    });
  });
});
