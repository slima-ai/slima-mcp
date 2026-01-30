/**
 * E2E Test: File Tree with Real Production Data Format
 *
 * This test uses the exact data format from the production Rails API
 * to ensure buildFileTree works correctly.
 */

import { describe, it, expect } from 'vitest';
import { buildFileTree, formatFileTree } from '../../../src/core/utils/file-tree.js';
import type { FlatFileSnapshot } from '../../../src/core/utils/file-tree.js';

describe('File Tree E2E with Production Data Format', () => {
  it('should correctly build tree from production-like data', () => {
    // This is the exact format returned by Rails API after deep_camelize_keys
    const productionData: FlatFileSnapshot[] = [
      // Root folders
      {
        kind: 'folder',
        name: '技能',
        token: '6395f807-8190-471f-86d3-c49be106273f',
        position: 0,
        // parentToken: nil (root level)
      },
      {
        kind: 'folder',
        name: '世界觀',
        token: '6a8f6c52-a853-4693-a0d1-c3856d5048c7',
        position: 1,
        // parentToken: nil (root level)
      },
      {
        kind: 'folder',
        name: '研究資料',
        token: 'c5b05f85-7b56-4025-a6b5-c51593f984de',
        position: 2,
        // parentToken: nil (root level)
      },

      // Nested folder: 紀元時間線 inside 世界觀
      {
        kind: 'folder',
        name: '紀元時間線',
        token: 'eb860d17-f71f-4a16-b0ab-39755c8981d0',
        position: 0,
        parentToken: '6a8f6c52-a853-4693-a0d1-c3856d5048c7', // inside 世界觀
      },

      // Nested folder: 鬥羅大陸 inside 研究資料
      {
        kind: 'folder',
        name: '鬥羅大陸',
        token: '0c14ed26-1234-5678-9abc-def012345678',
        position: 0,
        parentToken: 'c5b05f85-7b56-4025-a6b5-c51593f984de', // inside 研究資料
      },

      // Files
      {
        kind: 'file',
        name: '法師.md',
        token: '02412e2d-49bf-4fbc-bc8c-77ecee2743d8',
        position: 0,
        blobHash: 'fc61fb92b17f2b1cda157cdd27888a4aa57f46f7006693166f4b710f19712f81',
        wordCount: 1548,
        parentToken: '6395f807-8190-471f-86d3-c49be106273f', // inside 技能
      },
      {
        kind: 'file',
        name: '第一紀元：創世與諸神黃昏.md',
        token: '039a3329-ed0a-4f2e-819d-75bddf364f3a',
        position: 0,
        blobHash: 'e81dac50683bd3056b657bdc8b7ae6206231e27ccc668b18c66e1b99802ce76b',
        wordCount: 2266,
        parentToken: 'eb860d17-f71f-4a16-b0ab-39755c8981d0', // inside 紀元時間線
      },
      {
        kind: 'file',
        name: '大綱.md',
        token: '85892eb9-1111-2222-3333-444455556666',
        position: 0,
        wordCount: 100,
        parentToken: '0c14ed26-1234-5678-9abc-def012345678', // inside 鬥羅大陸
      },
    ];

    // Build the tree
    const tree = buildFileTree(productionData);

    // Debug: print the tree structure
    console.log('Tree structure:');
    console.log(JSON.stringify(tree, null, 2));

    // Verify root has 3 folders
    expect(tree).toHaveLength(3);

    // Find each root folder
    const skills = tree.find(f => f.name === '技能');
    const worldview = tree.find(f => f.name === '世界觀');
    const research = tree.find(f => f.name === '研究資料');

    expect(skills).toBeDefined();
    expect(worldview).toBeDefined();
    expect(research).toBeDefined();

    // 技能 should contain 法師.md
    expect(skills!.children).toHaveLength(1);
    expect(skills!.children![0].name).toBe('法師.md');

    // 世界觀 should contain 紀元時間線
    expect(worldview!.children).toHaveLength(1);
    expect(worldview!.children![0].name).toBe('紀元時間線');

    // 紀元時間線 should contain 第一紀元...
    expect(worldview!.children![0].children).toHaveLength(1);
    expect(worldview!.children![0].children![0].name).toBe('第一紀元：創世與諸神黃昏.md');

    // 研究資料 should contain 鬥羅大陸
    expect(research!.children).toHaveLength(1);
    expect(research!.children![0].name).toBe('鬥羅大陸');

    // 鬥羅大陸 should contain 大綱.md
    expect(research!.children![0].children).toHaveLength(1);
    expect(research!.children![0].children![0].name).toBe('大綱.md');

    // Now test the formatted output
    const formatted = formatFileTree(tree);
    console.log('\nFormatted output:');
    console.log(formatted);

    // Verify the output shows proper nesting
    const lines = formatted.split('\n');

    // Root level folders (no indent)
    expect(lines.some(l => l === '📁 技能')).toBe(true);
    expect(lines.some(l => l === '📁 世界觀')).toBe(true);
    expect(lines.some(l => l === '📁 研究資料')).toBe(true);

    // 法師.md inside 技能 (2 spaces indent)
    expect(lines.some(l => l === '  📄 法師.md (1548 words)')).toBe(true);

    // 紀元時間線 inside 世界觀 (2 spaces indent)
    expect(lines.some(l => l === '  📁 紀元時間線')).toBe(true);

    // 第一紀元... inside 紀元時間線 (4 spaces indent)
    expect(lines.some(l => l === '    📄 第一紀元：創世與諸神黃昏.md (2266 words)')).toBe(true);

    // 鬥羅大陸 inside 研究資料 (2 spaces indent)
    expect(lines.some(l => l === '  📁 鬥羅大陸')).toBe(true);

    // 大綱.md inside 鬥羅大陸 (4 spaces indent)
    expect(lines.some(l => l === '    📄 大綱.md (100 words)')).toBe(true);
  });
});
