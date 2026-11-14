/**
 * Images: look at them, store them (iss_tq07rttkofkm2381 Tim; iss_8ra4aqwgliryabow — field research
 * is only half there without the street view, the statue, the artefact).
 *
 * Inserting an image is not a tool of its own: an image appears in a chapter where a file points
 * at it with `![alt](slima-media://med_…)` — the same line the app's editor writes — so the agent
 * puts that line in with edit_file. An upload nothing points at is cleaned up after a while.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SlimaApiClient } from '../api/client.js';
import { formatErrorForMcp } from '../utils/errors.js';
import {
  fetchImageFromUrl,
  readImageFromFile,
  ImageSourceError,
  type ReadLocalFile,
  type ResolveHost,
} from '../images/source.js';

/** Larger than this is not returned inline — models reject oversized image content. */
export const MAX_INLINE_IMAGE_BYTES = 3.5 * 1024 * 1024;

export interface ImageToolOptions {
  /** stdio build only: lets upload_image take a file on the author's computer. */
  readLocalFile?: ReadLocalFile;
  /** stdio build only: refuse a public-looking name that resolves to a local address. */
  resolveHost?: ResolveHost;
  fetchImpl?: typeof fetch;
}

function failure(error: unknown) {
  const text = error instanceof ImageSourceError ? error.message : formatErrorForMcp(error);
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function filenameFor(source: string, mimeType: string): string {
  const last = source.split(/[\\/?#]/).filter(Boolean).pop() ?? 'image';
  const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last : `${last}.${ext}`;
}

export function registerImageTools(server: McpServer, client: SlimaApiClient, options: ImageToolOptions = {}): void {
  const fetchImpl = options.fetchImpl ?? fetch;

  server.tool(
    'view_image',
    `Look at an image stored in a book. Give its media token (med_…): read_file lists the images a file points
at (\`slima-media://med_…\`), and leaving media_token out lists every image in the book.`,
    {
      book_token: z.string().describe('Book token (bk_...)'),
      media_token: z.string().optional().describe('The image to show (med_…); omit to list the book’s images'),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ book_token, media_token }) => {
      try {
        if (!media_token) {
          const media = await client.listMedia(book_token);
          const images = media.filter((m) => m.mimeType.startsWith('image/'));
          const lines = images.length
            ? images.map((m) => `- ${m.token}  ${m.filename}  (${(m.size / 1024).toFixed(0)}KB)`)
            : ['(this book has no images)'];
          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        }

        const read = await client.mediaReadUrl(book_token, media_token);
        if (!read) {
          return failure(new ImageSourceError(`${media_token} is not an image in this book (or not uploaded yet).`));
        }
        const response = await fetchImpl(read.url);
        if (!response.ok) return failure(new ImageSourceError(`could not read ${media_token} (${response.status}).`));
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
          return {
            content: [
              {
                type: 'text' as const,
                text: `${media_token} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB — too large to show inline.`,
              },
            ],
          };
        }
        return {
          content: [{ type: 'image' as const, data: toBase64(bytes), mimeType: read.mimeType }],
        };
      } catch (error) {
        return failure(error);
      }
    }
  );

  const sourceHelp = options.readLocalFile
    ? 'Give source_url (a public http(s) image address) or file_path (a file on this computer).'
    : 'Give source_url (a public http(s) image address).';

  server.tool(
    'upload_image',
    `Store an image in a book. ${sourceHelp} jpeg, png, webp or gif, up to 10MB; 50 uploads a day through MCP.

It returns a line like \`![alt](slima-media://med_…)\`. **Put that line in a file with edit_file** — that is
how an image appears in a chapter. An image no file points at is cleaned up after a while.`,
    {
      book_token: z.string().describe('Book token (bk_...)'),
      source_url: z.string().optional().describe('Public http(s) address of the image'),
      ...(options.readLocalFile
        ? { file_path: z.string().optional().describe('Path of an image file on this computer') }
        : {}),
      alt: z.string().optional().describe('What the image shows, in the author’s language (used as the alt text)'),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (args) => {
      const { book_token, source_url, alt } = args as { book_token: string; source_url?: string; alt?: string };
      const file_path = (args as { file_path?: string }).file_path;
      try {
        if (!!source_url === !!file_path) {
          throw new ImageSourceError(options.readLocalFile ? 'give exactly one of source_url or file_path.' : 'give source_url.');
        }
        const image = file_path
          ? await readImageFromFile(file_path, options.readLocalFile!)
          : await fetchImageFromUrl(source_url!, { fetchImpl, resolveHost: options.resolveHost });

        const filename = filenameFor(file_path ?? source_url!, image.mimeType);
        const upload = await client.requestMediaUpload(book_token, {
          filename,
          mimeType: image.mimeType,
          size: image.bytes.byteLength,
        });
        const put = await fetchImpl(upload.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': image.mimeType },
          // A fresh ArrayBuffer-backed copy: fetch's BodyInit does not take a Uint8Array over ArrayBufferLike.
          body: new Uint8Array(image.bytes),
        });
        if (!put.ok) throw new ImageSourceError(`storing the image failed (${put.status}); nothing was saved.`);
        await client.confirmMedia(book_token, upload.token);

        const label = (alt ?? filename).replace(/[[\]]/g, '');
        return {
          content: [
            {
              type: 'text' as const,
              text: [
                `Stored ${filename} as ${upload.token}. Put this line where it belongs with edit_file:`,
                '',
                `![${label}](slima-media://${upload.token})`,
              ].join('\n'),
            },
          ],
        };
      } catch (error) {
        return failure(error);
      }
    }
  );
}
