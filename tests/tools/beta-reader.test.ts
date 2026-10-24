/**
 * Beta Reader Tools Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SlimaApiClient } from '../../src/api/client.js';
import { registerBetaReaderTools } from '../../src/tools/beta-reader.js';
import { InsufficientCreditsError, NotFoundError } from '../../src/utils/errors.js';

describe('Beta Reader Tools', () => {
  let server: McpServer;
  let mockClient: {
    listPersonas: ReturnType<typeof vi.fn>;
    readFile: ReturnType<typeof vi.fn>;
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
      getBook: vi.fn(),
      readFile: vi.fn(),
      listCommits: vi.fn(),
      downloadBlobs: vi.fn(),
      createReaderTest: vi.fn(),
      getReaderTestProgress: vi.fn(),
      getReaderTest: vi.fn(),
    };

    // Capture tool handlers
    toolHandlers = new Map();
    vi.spyOn(server, 'tool').mockImplementation(
      (...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as Function;
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
      progress: 100,
      reportType: 'chapter',
      personaCount: 1,
      completedPersonaCount: 1,
      personaTokens: ['psn_fantasy1'],
      aggregatedMetrics: {
        overall: {
          avgContinueReading: 8.5,
          avgRecommendation: 8.0,
          dnfRisk: 'low',
        },
        kindleRating: {
          avgScore: 4.2,
          individualScores: [{ score: 4.2, confidence: 'high', personaName: '奇幻讀者' }],
        },
      },
      individualFeedbacks: [
        {
          personaToken: 'psn_fantasy1',
          personaName: '奇幻讀者',
          overall: {
            continueReading: 8,
            recommendation: 8,
            dnfRisk: 'low',
          },
          kindleRating: {
            score: 4,
            rationale: 'Great chapter!',
            confidence: 'high',
          },
          detailedFeedback: {
            whatWorked: 'Exciting and engaging',
            strongestElement: 'Well-developed protagonist',
            specificSuggestions: ['Consider adding more dialogue'],
          },
        },
      ],
      createdAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      // Default successful mocks. getBook returns a Writing Studio book by default
      // so analyze_chapter's Script Studio gate passes through.
      mockClient.getBook.mockResolvedValue({
        token: 'bk_test',
        title: 'Test Book',
        bookType: 'book',
        createdAt: '',
        updatedAt: '',
      });
      // analyze_chapter reads through Rails' audited mcp/files/read — the same
      // endpoint get_chapter uses — not commits + blob download.
      mockClient.readFile.mockResolvedValue({
        file: { token: 'ch01', name: 'chapter-01.md', path: 'chapter-01.md', kind: 'file', wordCount: 1000 },
        content: 'Chapter content here...',
      });
      mockClient.listCommits.mockResolvedValue([
        { token: 'cmt_1', filesSnapshot: mockFilesSnapshot },
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
      expect(result.content[0].text).toContain('Summary Metrics'); // English header
      expect(result.content[0].text).toContain('Individual Reader Feedback'); // English header
      expect(result.content[0].text).toContain('奇幻讀者');
      expect(result.content[0].text).toContain('Great chapter!');
      expect(result.content[0].text).toContain('Exciting and engaging');
      expect(result.content[0].text).toContain('Well-developed protagonist');
      expect(result.content[0].text).toContain('Consider adding more dialogue');
      expect(result.content[0].text).toContain('8.5'); // avgContinueReading
      expect(result.content[0].text).toContain('4.2'); // Kindle rating
    });

    it('should create reader test with correct params', async () => {
      const handler = toolHandlers.get('analyze_chapter')!;
      await handler({
        book_token: 'bk_test',
        file_path: 'chapter-01.md',
        persona_token: 'psn_fantasy1',
      });

      expect(mockClient.createReaderTest).toHaveBeenCalledWith('bk_test', {
        reportType: 'chapter',
        personaTokens: ['psn_fantasy1'],
        scopeConfig: { chapters: ['chapter-01.md'] },
        content: 'Chapter content here...',
      });
    });

    it('reads the chapter through mcp/files/read and never through blob download', async () => {
      // A mcp:books token is being narrowed to the endpoints the tools need. blobs/download
      // is the one only this tool used; it also skipped the confidential-skill audit trail
      // and read budget that mcp/files/read enforces.
      const handler = toolHandlers.get('analyze_chapter')!;
      await handler({ book_token: 'bk_test', file_path: 'chapter-01.md', persona_token: 'psn_fantasy1' });

      expect(mockClient.readFile).toHaveBeenCalledWith('bk_test', 'chapter-01.md');
      expect(mockClient.downloadBlobs).not.toHaveBeenCalled();
    });

    it('resolves a bare filename through the file tree when the exact path is not found', async () => {
      mockClient.readFile
        .mockRejectedValueOnce(new NotFoundError('File not found: ch01'))
        .mockResolvedValueOnce({
          file: { token: 'ch01', name: 'chapter-01.md', path: 'chapters/chapter-01.md', kind: 'file', wordCount: 1000 },
          content: 'Chapter content here...',
        });
      mockClient.listCommits.mockResolvedValue([
        {
          token: 'cmt_1',
          filesSnapshot: [
            { token: 'fld', name: 'chapters', kind: 'folder', position: 0 },
            { token: 'ch01', name: 'chapter-01.md', kind: 'file', position: 1, parentToken: 'fld', blobHash: 'sha256:x' },
          ],
        },
      ]);

      const handler = toolHandlers.get('analyze_chapter')!;
      await handler({ book_token: 'bk_test', file_path: 'chapter-01', persona_token: 'psn_fantasy1' });

      expect(mockClient.readFile).toHaveBeenLastCalledWith('bk_test', 'chapters/chapter-01.md');
      expect(mockClient.createReaderTest).toHaveBeenCalled();
      expect(mockClient.downloadBlobs).not.toHaveBeenCalled();
    });

    it('should return error when the file is not found and the book has no commits', async () => {
      mockClient.readFile.mockRejectedValue(new NotFoundError('File not found: chapter.md'));
      mockClient.listCommits.mockResolvedValue([]);

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'chapter.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('File not found');
      expect(mockClient.createReaderTest).not.toHaveBeenCalled();
    });

    it('should return error when file not found', async () => {
      mockClient.readFile.mockRejectedValue(new NotFoundError('File not found: nonexistent.md'));
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
      mockClient.readFile.mockResolvedValue({
        file: { token: 'empty', name: 'empty.md', path: 'empty.md', kind: 'file', wordCount: 0 },
        content: '',
      });

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({
        book_token: 'bk_test',
        file_path: 'empty.md',
        persona_token: 'psn_1',
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('has no content');
    });

    it('refuses, and spends nothing, when the content is withheld (a confidential team skill)', async () => {
      mockClient.readFile.mockResolvedValue({
        file: { token: 'sk1', name: 'skill.md', path: 'skills/skill.md', kind: 'file', wordCount: 10 },
        content: null,
        contentWithheld: true,
        withheldReason: 'confidential',
      });

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({ book_token: 'bk_test', file_path: 'skills/skill.md', persona_token: 'psn_1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/withheld/i);
      expect(mockClient.createReaderTest).not.toHaveBeenCalled();
    });

    it('refuses, and spends nothing, when the team read budget is spent', async () => {
      mockClient.readFile.mockResolvedValue({
        file: { token: 'sk1', name: 'skill.md', path: 'skills/skill.md', kind: 'file', wordCount: 10 },
        content: null,
        throttled: true,
        throttledReason: 'daily budget',
      });

      const handler = toolHandlers.get('analyze_chapter')!;
      const result = await handler({ book_token: 'bk_test', file_path: 'skills/skill.md', persona_token: 'psn_1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/budget|limit/i);
      expect(mockClient.createReaderTest).not.toHaveBeenCalled();
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
        progress: 100,
        reportType: 'chapter',
        personaCount: 0,
        completedPersonaCount: 0,
        personaTokens: [],
        individualFeedbacks: [],
        aggregatedMetrics: undefined,
        createdAt: '2024-01-01T00:00:00Z',
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
        progress: 100,
        reportType: 'chapter',
        personaCount: 1,
        completedPersonaCount: 1,
        personaTokens: ['psn_1'],
        individualFeedbacks: [
          {
            personaToken: 'psn_1',
            personaName: 'reader-1',
            kindleRating: {
              score: 4,
              rationale: 'Good',
              confidence: 'medium',
            },
            // Missing other fields - partial data
          },
        ],
        createdAt: '2024-01-01T00:00:00Z',
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
