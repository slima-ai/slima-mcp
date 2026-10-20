/**
 * How a file read is presented to the model — in ONE place.
 *
 * `read_file` and `get_chapter` both surface the same Rails response
 * (`/mcp/files/read`), and they used to render it independently: read_file said
 * "(empty file)" for a withheld confidential skill while get_chapter said "could
 * not retrieve file content". Neither was true, and the drift meant fixing one
 * left the other lying.
 *
 * The three outcomes are distinct on purpose. A withheld file is not an error
 * and not empty — the AI may still USE that skill, it just may not read the
 * source, and telling it anything else sends it off to "repair" a file it is
 * forbidden to write.
 */
import type { McpFileReadResponse } from '../api/types.js';

export function renderFileRead(result: McpFileReadResponse): string {
  if (result.contentWithheld) {
    return [
      `# ${result.file.name} 🔒`,
      '',
      `**Path:** ${result.file.path}`,
      `**Words:** ${result.file.wordCount}`,
      '',
      '---',
      '',
      `The content of this file is withheld from you (reason: ${result.withheldReason ?? 'confidential'}).`,
      'It is a confidential team skill: your team allows it to be USED but not READ,',
      'so Slima applies it on the server without showing you the source.',
      '',
      'This is intentional, not an error and not an empty file. Do not try to rewrite,',
      'restore or "fix" it — writes to this path are rejected. If you need its contents,',
      'ask a team manager.',
    ].join('\n');
  }

  if (result.throttled) {
    return [
      `# ${result.file.name} ⏳`,
      '',
      `**Path:** ${result.file.path}`,
      `**Words:** ${result.file.wordCount}`,
      '',
      '---',
      '',
      `This team skill's read budget is exhausted for now (${result.throttledReason ?? 'daily_read_limit'}).`,
      'The file is not empty — try again later, or ask a team manager.',
    ].join('\n');
  }

  return [
    `# ${result.file.name}`,
    '',
    `**Path:** ${result.file.path}`,
    `**Words:** ${result.file.wordCount}`,
    `**Type:** ${result.file.fileType || 'unknown'}`,
    // The file's version: pass it as base_version to append_to_file so a retry cannot duplicate text.
    ...(result.file.blobHash ? [`**Version:** ${result.file.blobHash}`] : []),
    '',
    '---',
    '',
    result.content || '(empty file)',
  ].join('\n');
}
