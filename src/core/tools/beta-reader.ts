/**
 * Beta Reader Tools
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient, Logger } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import type { FileSnapshot, ReaderTest, IndividualFeedback, AggregatedMetrics } from '../api/types.js';

// Default no-op logger
const defaultLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Register Beta Reader tools
 */
export function registerBetaReaderTools(
  server: McpServer,
  client: SlimaApiClient,
  logger: Logger = defaultLogger
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
        // 1. Get latest commit and chapter content
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

        // 2. Find file
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

        // 3. Download content
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

        // 4. Create Reader Test
        logger.info(`Creating reader test for ${file_path} with persona ${persona_token}`);

        const test = await client.createReaderTest(book_token, {
          reportType: 'chapter',
          personaTokens: [persona_token],
          commitToken: commits[0].token,
          scopeConfig: { chapters: [file_path] },
          content: content,
        });

        // 5. Poll for completion (max 90 seconds)
        const result = await pollForCompletion(
          () => client.getReaderTestProgress(book_token, test.token),
          90000,
          logger
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

        // 6. Get full result
        const fullResult = await client.getReaderTest(book_token, test.token);

        // 7. Format feedback
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
 * Poll for completion
 */
async function pollForCompletion(
  checkFn: () => Promise<{ status: string; progress?: number }>,
  timeoutMs: number,
  logger: Logger
): Promise<{ status: string }> {
  const startTime = Date.now();
  const pollInterval = 3000; // 3 seconds

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
 * Sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format Beta Reader feedback
 */
function formatBetaReaderFeedback(test: ReaderTest, fileName: string): string {
  const feedbacks = test.individualFeedbacks || [];
  const metrics = test.aggregatedMetrics;

  if (feedbacks.length === 0 && !metrics) {
    return 'No feedback available.';
  }

  let output = `# Beta Reader Feedback: ${fileName}\n\n`;

  // Aggregated metrics summary
  if (metrics) {
    output += formatAggregatedMetrics(metrics);
  }

  // Individual persona feedback
  if (feedbacks.length > 0) {
    output += `\n---\n\n## Individual Reader Feedback\n\n`;
    output += feedbacks.map(formatIndividualFeedback).join('\n---\n\n');
  }

  return output;
}

/**
 * Format aggregated metrics
 */
function formatAggregatedMetrics(metrics: AggregatedMetrics): string {
  let output = `## Summary Metrics\n\n`;

  // Overall
  if (metrics.overall) {
    const o = metrics.overall;
    output += `### Overall Scores\n`;
    if (o.avgContinueReading) output += `- Continue Reading Intent: ${o.avgContinueReading.toFixed(1)}/10\n`;
    if (o.avgRecommendation) output += `- Recommendation Score: ${o.avgRecommendation.toFixed(1)}/10\n`;
    if (o.avgWantMore) output += `- Want More: ${o.avgWantMore.toFixed(1)}/10\n`;
    if (o.dnfRisk) output += `- DNF Risk: ${o.dnfRisk}\n`;
    output += '\n';
  }

  // Kindle Rating
  if (metrics.kindleRating) {
    output += `### Predicted Kindle Rating\n`;
    output += `- Average Score: ⭐ ${metrics.kindleRating.avgScore.toFixed(1)}/5\n`;
    if (metrics.kindleRating.individualScores) {
      const scores = metrics.kindleRating.individualScores
        .map(s => `${s.personaName || 'Reader'}: ${s.score}/5 (${s.confidence})`)
        .join(', ');
      output += `- Individual Scores: ${scores}\n`;
    }
    output += '\n';
  }

  // Characters
  if (metrics.characters) {
    const c = metrics.characters;
    output += `### Character Evaluation\n`;
    if (c.avgProtagonistLikability) output += `- Protagonist Likability: ${c.avgProtagonistLikability.toFixed(1)}/10\n`;
    if (c.avgMotivationClarity) output += `- Motivation Clarity: ${c.avgMotivationClarity.toFixed(1)}/10\n`;
    if (c.avgDialogueNaturalness) output += `- Dialogue Naturalness: ${c.avgDialogueNaturalness.toFixed(1)}/10\n`;
    output += '\n';
  }

  // Pacing
  if (metrics.pacing) {
    const p = metrics.pacing;
    output += `### Pacing Evaluation\n`;
    if (p.avgOverall) output += `- Overall Pacing: ${p.avgOverall.toFixed(1)}/10\n`;
    if (p.consensus) output += `- Consensus: ${p.consensus}\n`;
    if (p.commonDnfTriggers && p.commonDnfTriggers.length > 0) {
      output += `- Common DNF Triggers:\n`;
      p.commonDnfTriggers.slice(0, 3).forEach(t => {
        output += `  - ${t.trigger} (${t.count}x)\n`;
      });
    }
    output += '\n';
  }

  // Market
  if (metrics.market) {
    const m = metrics.market;
    output += `### Market Positioning\n`;
    if (m.avgWordOfMouth) output += `- Word of Mouth Potential: ${m.avgWordOfMouth.toFixed(1)}/10\n`;
    if (m.topComparableBooks && m.topComparableBooks.length > 0) {
      const books = m.topComparableBooks.slice(0, 3).map(b => b.title).join(', ');
      output += `- Comparable Books: ${books}\n`;
    }
    output += '\n';
  }

  return output;
}

/**
 * Format individual feedback
 */
function formatIndividualFeedback(feedback: IndividualFeedback): string {
  const name = feedback.personaName || feedback.personaToken;
  let output = `### ${name}\n\n`;

  // Overall scores
  if (feedback.overall) {
    const o = feedback.overall;
    if (o.continueReading) output += `**Continue Reading Intent**: ${o.continueReading}/10\n`;
    if (o.recommendation) output += `**Recommendation**: ${o.recommendation}/10\n`;
    if (o.dnfRisk) output += `**DNF Risk**: ${o.dnfRisk}\n`;
    output += '\n';
  }

  // Kindle Rating
  if (feedback.kindleRating) {
    output += `**Kindle Rating**: ⭐ ${feedback.kindleRating.score}/5`;
    if (feedback.kindleRating.rationale) {
      output += ` - ${feedback.kindleRating.rationale}`;
    }
    output += '\n\n';
  }

  // Detailed Feedback
  if (feedback.detailedFeedback) {
    const d = feedback.detailedFeedback;

    if (d.whatWorked) {
      output += `**What Worked**:\n${d.whatWorked}\n\n`;
    }

    if (d.whatDidntWork) {
      output += `**What Didn't Work**:\n${d.whatDidntWork}\n\n`;
    }

    if (d.strongestElement) {
      output += `**Strongest Element**: ${d.strongestElement}\n`;
    }

    if (d.weakestElement) {
      output += `**Weakest Element**: ${d.weakestElement}\n`;
    }

    if (d.wouldYouBuy) {
      output += `**Would You Buy**: ${d.wouldYouBuy}\n`;
    }

    if (d.specificSuggestions && d.specificSuggestions.length > 0) {
      output += `\n**Specific Suggestions**:\n`;
      d.specificSuggestions.forEach((s, i) => {
        output += `${i + 1}. ${s}\n`;
      });
    }

    if (d.finalThoughts) {
      output += `\n**Final Thoughts**:\n${d.finalThoughts}\n`;
    }
  }

  // Emotional Journey
  if (feedback.emotionalJourney) {
    const e = feedback.emotionalJourney;
    if (e.emotionalArc) {
      output += `\n**Emotional Arc**: ${e.emotionalArc}\n`;
    }
    if (e.peakMoments && e.peakMoments.length > 0) {
      const moments = e.peakMoments.map(m =>
        typeof m === 'string' ? m : (m as { moment?: string; description?: string }).moment || (m as { moment?: string; description?: string }).description || JSON.stringify(m)
      );
      output += `**Peak Moments**: ${moments.join(', ')}\n`;
    }
    if (e.overallMood) {
      output += `**Overall Mood**: ${e.overallMood}\n`;
    }
  }

  return output;
}

/**
 * Find file in snapshot
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
