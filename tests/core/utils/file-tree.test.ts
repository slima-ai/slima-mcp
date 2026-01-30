/**
 * BDD Tests for File Tree Utilities
 *
 * Problem: The API returns files with flat `parentToken` references,
 * but `formatFileTree` expects nested `children` arrays.
 *
 * Solution: Add `buildFileTree` function to convert flat structure to nested.
 */

import { describe, it, expect } from 'vitest';
import { buildFileTree, formatFileTree } from '../../../src/core/utils/file-tree.js';
import type { FileSnapshot, FlatFileSnapshot } from '../../../src/core/utils/file-tree.js';

describe('File Tree Utilities', () => {
  describe('buildFileTree', () => {
    describe('Given flat files with parentToken references', () => {
      it('should convert to nested children structure', () => {
        // Given: Flat structure from API (with parentToken)
        const flatFiles: FlatFileSnapshot[] = [
          {
            token: 'folder_1',
            name: '研究資料',
            kind: 'folder',
            position: 0,
            parentToken: undefined,
          },
          {
            token: 'folder_2',
            name: '鬥羅大陸',
            kind: 'folder',
            position: 0,
            parentToken: 'folder_1',
          },
          {
            token: 'file_1',
            name: '大綱.md',
            kind: 'file',
            position: 0,
            wordCount: 100,
            parentToken: 'folder_2',
          },
          {
            token: 'file_2',
            name: '章節1.md',
            kind: 'file',
            position: 1,
            wordCount: 500,
            parentToken: 'folder_2',
          },
        ];

        // When: Convert to nested structure
        const result = buildFileTree(flatFiles);

        // Then: Should have nested children
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('研究資料');
        expect(result[0].children).toHaveLength(1);
        expect(result[0].children![0].name).toBe('鬥羅大陸');
        expect(result[0].children![0].children).toHaveLength(2);
        expect(result[0].children![0].children![0].name).toBe('大綱.md');
        expect(result[0].children![0].children![1].name).toBe('章節1.md');
      });

      it('should handle root-level files (no parent)', () => {
        // Given: Mix of root files and folders
        const flatFiles: FlatFileSnapshot[] = [
          {
            token: 'file_root',
            name: 'README.md',
            kind: 'file',
            position: 0,
            wordCount: 50,
            parentToken: undefined,
          },
          {
            token: 'folder_1',
            name: 'chapters',
            kind: 'folder',
            position: 1,
            parentToken: undefined,
          },
          {
            token: 'file_ch1',
            name: 'chapter-01.md',
            kind: 'file',
            position: 0,
            wordCount: 1000,
            parentToken: 'folder_1',
          },
        ];

        // When: Convert
        const result = buildFileTree(flatFiles);

        // Then: Root has 2 items
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe('README.md');
        expect(result[1].name).toBe('chapters');
        expect(result[1].children).toHaveLength(1);
        expect(result[1].children![0].name).toBe('chapter-01.md');
      });

      it('should sort children by position', () => {
        // Given: Files with different positions
        const flatFiles: FlatFileSnapshot[] = [
          {
            token: 'folder',
            name: 'chapters',
            kind: 'folder',
            position: 0,
            parentToken: undefined,
          },
          {
            token: 'ch3',
            name: 'chapter-03.md',
            kind: 'file',
            position: 2,
            parentToken: 'folder',
          },
          {
            token: 'ch1',
            name: 'chapter-01.md',
            kind: 'file',
            position: 0,
            parentToken: 'folder',
          },
          {
            token: 'ch2',
            name: 'chapter-02.md',
            kind: 'file',
            position: 1,
            parentToken: 'folder',
          },
        ];

        // When
        const result = buildFileTree(flatFiles);

        // Then: Children sorted by position
        const chapters = result[0].children!;
        expect(chapters[0].name).toBe('chapter-01.md');
        expect(chapters[1].name).toBe('chapter-02.md');
        expect(chapters[2].name).toBe('chapter-03.md');
      });

      it('should handle empty input', () => {
        const result = buildFileTree([]);
        expect(result).toEqual([]);
      });

      it('should handle deeply nested structure (3+ levels)', () => {
        // Given: 3-level nesting
        const flatFiles: FlatFileSnapshot[] = [
          { token: 'l1', name: 'level1', kind: 'folder', position: 0 },
          { token: 'l2', name: 'level2', kind: 'folder', position: 0, parentToken: 'l1' },
          { token: 'l3', name: 'level3', kind: 'folder', position: 0, parentToken: 'l2' },
          { token: 'f', name: 'deep.md', kind: 'file', position: 0, parentToken: 'l3' },
        ];

        // When
        const result = buildFileTree(flatFiles);

        // Then
        expect(result[0].name).toBe('level1');
        expect(result[0].children![0].name).toBe('level2');
        expect(result[0].children![0].children![0].name).toBe('level3');
        expect(result[0].children![0].children![0].children![0].name).toBe('deep.md');
      });

      it('should support snake_case fields from Rails API', () => {
        // Given: Rails API returns snake_case fields
        const flatFiles: FlatFileSnapshot[] = [
          {
            token: 'folder_1',
            name: '研究資料',
            kind: 'folder',
            position: 0,
            parent_token: undefined,
          },
          {
            token: 'file_1',
            name: '大綱.md',
            kind: 'file',
            position: 0,
            word_count: 100,
            blob_hash: 'sha256:abc',
            is_manuscript: true,
            parent_token: 'folder_1',
          },
        ];

        // When
        const result = buildFileTree(flatFiles);

        // Then: Should correctly parse snake_case fields
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('研究資料');
        expect(result[0].children).toHaveLength(1);
        expect(result[0].children![0].name).toBe('大綱.md');
        expect(result[0].children![0].wordCount).toBe(100);
        expect(result[0].children![0].blobHash).toBe('sha256:abc');
        expect(result[0].children![0].isManuscript).toBe(true);
      });
    });
  });

  describe('formatFileTree', () => {
    describe('Given nested FileSnapshot structure', () => {
      it('should format as tree with proper indentation', () => {
        // Given: Already nested structure
        const files: FileSnapshot[] = [
          {
            token: 'folder',
            name: 'chapters',
            kind: 'folder',
            position: 0,
            children: [
              {
                token: 'ch1',
                name: 'chapter-01.md',
                kind: 'file',
                position: 0,
                wordCount: 1000,
                isManuscript: true,
              },
            ],
          },
        ];

        // When
        const result = formatFileTree(files);

        // Then
        expect(result).toContain('📁 chapters');
        expect(result).toContain('  📄 chapter-01.md (1000 words) [M]');
      });

      it('should show folder icon for folders', () => {
        const files: FileSnapshot[] = [
          { token: '1', name: 'folder', kind: 'folder', position: 0 },
        ];

        const result = formatFileTree(files);
        expect(result).toContain('📁 folder');
      });

      it('should show file icon for files', () => {
        const files: FileSnapshot[] = [
          { token: '1', name: 'file.md', kind: 'file', position: 0 },
        ];

        const result = formatFileTree(files);
        expect(result).toContain('📄 file.md');
      });

      it('should show word count for files', () => {
        const files: FileSnapshot[] = [
          { token: '1', name: 'file.md', kind: 'file', position: 0, wordCount: 500 },
        ];

        const result = formatFileTree(files);
        expect(result).toContain('(500 words)');
      });

      it('should show [M] marker for manuscript files', () => {
        const files: FileSnapshot[] = [
          { token: '1', name: 'ch.md', kind: 'file', position: 0, isManuscript: true },
        ];

        const result = formatFileTree(files);
        expect(result).toContain('[M]');
      });
    });
  });

  describe('Integration: buildFileTree + formatFileTree', () => {
    it('should correctly display flat API data as formatted tree', () => {
      // Given: Real-world scenario - flat data from API
      const flatFiles: FlatFileSnapshot[] = [
        { token: 't1', name: '紀元時間線', kind: 'folder', position: 0 },
        { token: 't2', name: '研究資料', kind: 'folder', position: 1 },
        { token: 't3', name: '鬥羅大陸', kind: 'folder', position: 0, parentToken: 't2' },
        { token: 't4', name: '大綱.md', kind: 'file', position: 0, wordCount: 100, parentToken: 't3' },
        { token: 't5', name: '章節1.md', kind: 'file', position: 1, wordCount: 500, parentToken: 't3' },
        { token: 't6', name: '引言.md', kind: 'file', position: 2, wordCount: 200, parentToken: 't3' },
      ];

      // When: Build tree then format
      const tree = buildFileTree(flatFiles);
      const formatted = formatFileTree(tree);

      // Then: Should show proper nesting
      const lines = formatted.split('\n');

      // Root level folders
      expect(lines.some(l => l.match(/^📁 紀元時間線/))).toBe(true);
      expect(lines.some(l => l.match(/^📁 研究資料/))).toBe(true);

      // 鬥羅大陸 is inside 研究資料 (indented)
      expect(lines.some(l => l.match(/^\s+📁 鬥羅大陸/))).toBe(true);

      // Files are inside 鬥羅大陸 (double indented)
      expect(lines.some(l => l.match(/^\s+\s+📄 大綱\.md/))).toBe(true);
      expect(lines.some(l => l.match(/^\s+\s+📄 章節1\.md/))).toBe(true);
      expect(lines.some(l => l.match(/^\s+\s+📄 引言\.md/))).toBe(true);
    });
  });
});
