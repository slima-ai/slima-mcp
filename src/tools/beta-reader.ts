/**
 * Beta Reader Tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { FileSnapshot, ReaderTest } from '../api/types.js';
import { logger } from '../utils/logger.js';

/**
 * 註冊 Beta Reader 工具
 */
export function registerBetaReaderTools(
  server: McpServer,
  client: SlimaApiClient
): void {
  // === list_personas ===
  server.tool(
    'list_personas',
    'List available virtual reader personas for beta reading feedback',
    {
      genre: z
        .string()
        .optional()
        .describe('Filter by genre (e.g., fantasy, romance, scifi)'),
    },
    async ({ genre }) => {
      try {
        const personas = await client.listPersonas(genre);

        if (personas.length === 0) {
          const genreText = genre ? ` for genre "${genre}"` : '';
          return {
            content: [
              {
                type: 'text',
                text: `No personas found${genreText}.`,
              },
            ],
          };
        }

        const formatted = personas
          .map((p) => {
            const name = p.displayLabels?.zh || p.displayLabels?.en || p.slug;
            const tags = p.genreTags?.join(', ') || 'General';
            const demo = p.demographics || {};
            const gender = demo.gender || 'N/A';
            const age = demo.ageRange || 'N/A';

            return `- **${name}** (\`${p.token}\`)
  Gender: ${gender} | Age: ${age}
  Genres: ${tags}`;
          })
          .join('\n\n');

        return {
          content: [
            {
              type: 'text',
              text: `Available Personas (${personas.length}):\n\n${formatted}\n\n**Tip**: Use the persona token with \`analyze_chapter\` to get feedback from a specific reader.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );

  // === analyze_chapter ===
  server.tool(
    'analyze_chapter',
    'Get AI Beta Reader feedback on a chapter from a specific reader persona. This may take a moment to complete.',
    {
      book_token: z.string().describe('Book token (e.g., bk_abc123)'),
      file_path: z.string().describe('Chapter file path (e.g., /chapters/01.md)'),
      persona_token: z
        .string()
        .describe('Persona token (e.g., psn_xxx). Use list_personas to find available personas.'),
    },
    async ({ book_token, file_path, persona_token }) => {
      try {
        // 1. 取得最新 commit 和章節內容
        const commits = await client.listCommits(book_token, 1);

        if (commits.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No commits found. The book may be empty.',
              },
            ],
            isError: true,
          };
        }

        // 2. 找到檔案
        const file = findFileInSnapshot(commits[0].filesSnapshot, file_path);

        if (!file) {
          return {
            content: [
              {
                type: 'text',
                text: `File not found: ${file_path}. Use get_book_structure to see available files.`,
              },
            ],
            isError: true,
          };
        }

        if (!file.blobHash) {
          return {
            content: [
              {
                type: 'text',
                text: `File "${file_path}" has no content (empty file).`,
              },
            ],
            isError: true,
          };
        }

        // 3. 下載內容
        const blobs = await client.downloadBlobs(book_token, [file.blobHash]);

        if (blobs.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'Could not retrieve file content.',
              },
            ],
            isError: true,
          };
        }

        const content = blobs[0].content;

        // 4. 建立 Reader Test
        logger.info(`Creating reader test for ${file_path} with persona ${persona_token}`);

        const test = await client.createReaderTest(book_token, {
          personaTokens: [persona_token],
          commitToken: commits[0].token,
          scopeConfig: { chapters: [file_path] },
          content: content,
        });

        // 5. 輪詢等待完成（最多 90 秒）
        const result = await pollForCompletion(
          () => client.getReaderTestProgress(book_token, test.token),
          90000
        );

        if (result.status === 'failed') {
          return {
            content: [
              {
                type: 'text',
                text: 'Analysis failed. Please try again later.',
              },
            ],
            isError: true,
          };
        }

        if (result.status !== 'completed') {
          return {
            content: [
              {
                type: 'text',
                text: `Analysis is still in progress. You can check the status later.\n\nTest ID: ${test.token}`,
              },
            ],
          };
        }

        // 6. 取得完整結果
        const fullResult = await client.getReaderTest(book_token, test.token);

        // 7. 格式化反饋
        const feedback = formatBetaReaderFeedback(fullResult, file.name);

        return {
          content: [{ type: 'text', text: feedback }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: formatErrorForMcp(error) }],
          isError: true,
        };
      }
    }
  );
}

/**
 * 輪詢等待完成
 */
async function pollForCompletion(
  checkFn: () => Promise<{ status: string; progress?: number }>,
  timeoutMs: number
): Promise<{ status: string }> {
  const startTime = Date.now();
  const pollInterval = 3000; // 3 秒

  while (Date.now() - startTime < timeoutMs) {
    const result = await checkFn();
    logger.debug(`Poll status: ${result.status}, progress: ${result.progress || 'N/A'}`);

    if (result.status === 'completed' || result.status === 'failed') {
      return result;
    }

    await sleep(pollInterval);
  }

  return { status: 'timeout' };
}

/**
 * 睡眠
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 格式化 Beta Reader 反饋
 */
function formatBetaReaderFeedback(test: ReaderTest, fileName: string): string {
  const results = test.personaResults || [];

  if (results.length === 0) {
    return 'No feedback available.';
  }

  const feedbackSections = results.map((r) => {
    const persona = r.persona;
    const name =
      persona?.displayLabels?.zh || persona?.displayLabels?.en || persona?.slug || 'Reader';

    let section = `## ${name} 的反饋\n\n`;

    if (r.overallImpression) {
      section += `### 整體印象\n${r.overallImpression}\n\n`;
    }

    if (r.emotionalResponse) {
      section += `### 情緒反應\n${r.emotionalResponse}\n\n`;
    }

    if (r.characterFeedback) {
      section += `### 角色評價\n${r.characterFeedback}\n\n`;
    }

    if (r.suggestions) {
      section += `### 改進建議\n${r.suggestions}\n\n`;
    }

    return section;
  });

  return `# Beta Reader Feedback: ${fileName}\n\n${feedbackSections.join('---\n\n')}`;
}

/**
 * 在 snapshot 中尋找檔案（複製自 content.ts）
 */
function findFileInSnapshot(
  files: FileSnapshot[],
  path: string
): FileSnapshot | null {
  const normalizedPath = path.replace(/^\//, '').toLowerCase();
  const pathParts = normalizedPath.split('/');

  function search(
    items: FileSnapshot[],
    remainingParts: string[]
  ): FileSnapshot | null {
    for (const item of items) {
      const itemNameLower = item.name.toLowerCase();
      const itemTokenLower = item.token.toLowerCase();

      if (remainingParts.length === 1) {
        const target = remainingParts[0];
        if (
          itemNameLower === target ||
          itemTokenLower === target ||
          itemNameLower.replace(/\.[^.]+$/, '') === target.replace(/\.[^.]+$/, '')
        ) {
          return item;
        }
      }

      if (item.kind === 'folder' && item.children) {
        if (
          itemNameLower === remainingParts[0] ||
          itemTokenLower === remainingParts[0]
        ) {
          const result = search(item.children, remainingParts.slice(1));
          if (result) return result;
        }

        const result = search(item.children, remainingParts);
        if (result) return result;
      }
    }

    return null;
  }

  let result = search(files, pathParts);
  if (result) return result;

  result = searchByName(files, pathParts[pathParts.length - 1]);
  return result;
}

function searchByName(
  files: FileSnapshot[],
  name: string
): FileSnapshot | null {
  const nameLower = name.toLowerCase();

  for (const item of files) {
    const itemNameLower = item.name.toLowerCase();
    const itemTokenLower = item.token.toLowerCase();

    if (
      itemNameLower === nameLower ||
      itemTokenLower === nameLower ||
      itemNameLower.replace(/\.[^.]+$/, '') === nameLower.replace(/\.[^.]+$/, '')
    ) {
      return item;
    }

    if (item.kind === 'folder' && item.children) {
      const result = searchByName(item.children, name);
      if (result) return result;
    }
  }

  return null;
}
