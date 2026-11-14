/**
 * upload_image's source guards (iss_8ra4aqwgliryabow; CEO 2026-11-15 asked for each refusal to be tried):
 * a non-http protocol, an internal address, a file over the size limit, a non-image Content-Type.
 * Plus the two that make the first two real: every redirect hop is re-checked, and the bytes must
 * actually be an image (a Content-Type header is the server's claim, not proof).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  checkSourceUrl,
  fetchImageFromUrl,
  isInternalHost,
  readImageFromFile,
  sniffImageType,
  MAX_IMAGE_BYTES,
  ImageSourceError,
} from '../../src/core/images/source.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);

function respond(body: Uint8Array | string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, { status: init.status ?? 200, headers: init.headers ?? {} });
}

describe('checkSourceUrl', () => {
  it.each(['file:///etc/passwd', 'ftp://example.com/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)'])(
    'refuses %s (only http/https)',
    (url) => {
      expect(() => checkSourceUrl(url)).toThrow(ImageSourceError);
    }
  );

  it.each([
    'http://localhost/a.png',
    'http://127.0.0.1/a.png',
    'http://10.0.0.5/a.png',
    'http://172.16.3.1/a.png',
    'http://192.168.1.1/a.png',
    'http://169.254.169.254/latest/meta-data',
    'http://100.64.0.1/a.png',
    'http://[::1]/a.png',
    'http://[fd00::1]/a.png',
    'http://[::ffff:192.168.0.1]/a.png',
    // URL() rewrites these to hex groups (::ffff:c0a8:1 …); the embedded IPv4 must still be read.
    'http://[::ffff:7f00:1]/a.png',
    'http://[::127.0.0.1]/a.png',
    'http://[::ffff:0:10.0.0.1]/a.png',
    'http://[64:ff9b::169.254.169.254]/a.png',
    'http://[2002:c0a8:1::]/a.png',
    'http://[ff02::1]/a.png',
    'http://0x7f.1/a.png',
    'http://2130706433/a.png',
    'http://router.local/a.png',
  ])('refuses the internal address %s', (url) => {
    expect(() => checkSourceUrl(url)).toThrow(/local network|inside this computer/);
  });

  it('accepts a public https address', () => {
    expect(checkSourceUrl('https://upload.wikimedia.org/a.jpg').hostname).toBe('upload.wikimedia.org');
  });

  it('does not mistake public addresses for internal ones', () => {
    expect(isInternalHost('8.8.8.8')).toBe(false);
    expect(isInternalHost('172.32.0.1')).toBe(false);
    expect(isInternalHost('2001:4860:4860::8888')).toBe(false);
    expect(isInternalHost('::ffff:808:808')).toBe(false); // ::ffff:8.8.8.8
    expect(isInternalHost('64:ff9b::808:808')).toBe(false);
  });
});

describe('fetchImageFromUrl', () => {
  it('fetches a real image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond(PNG, { headers: { 'content-type': 'image/png' } }));

    const image = await fetchImageFromUrl('https://example.com/a.png', { fetchImpl });

    expect(image.mimeType).toBe('image/png');
    expect(image.bytes.byteLength).toBe(PNG.byteLength);
  });

  it('refuses a Content-Type that is not an image Slima stores', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond('<html>', { headers: { 'content-type': 'text/html' } }));

    await expect(fetchImageFromUrl('https://example.com/page', { fetchImpl })).rejects.toThrow(/not an image Slima stores/);
  });

  it('refuses an svg (script-capable) even though it is an image', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));

    await expect(fetchImageFromUrl('https://example.com/a.svg', { fetchImpl })).rejects.toThrow(ImageSourceError);
  });

  it('refuses bytes that are not an image even when the header says image/png', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(respond('not a png', { headers: { 'content-type': 'image/png' } }));

    await expect(fetchImageFromUrl('https://example.com/a.png', { fetchImpl })).rejects.toThrow(/not an image/);
  });

  it('refuses a declared size over the limit before downloading', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      respond(PNG, { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } })
    );

    await expect(fetchImageFromUrl('https://example.com/big.png', { fetchImpl })).rejects.toThrow(/up to 10MB/);
  });

  it('stops reading when an undeclared body grows past the limit', async () => {
    const big = new Uint8Array(MAX_IMAGE_BYTES + 10);
    big.set(PNG);
    const fetchImpl = vi.fn().mockResolvedValue(respond(big, { headers: { 'content-type': 'image/png' } }));

    await expect(fetchImageFromUrl('https://example.com/big.png', { fetchImpl })).rejects.toThrow(/up to 10MB/);
  });

  it('re-checks every redirect hop — a public URL cannot bounce to an internal one', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond('', { status: 302, headers: { location: 'http://169.254.169.254/secret' } }));

    await expect(fetchImageFromUrl('https://example.com/a.png', { fetchImpl })).rejects.toThrow(/local network|inside/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a public-looking name that resolves to a local address (npm build)', async () => {
    const fetchImpl = vi.fn();
    const resolveHost = vi.fn().mockResolvedValue(['192.168.1.10']);

    await expect(fetchImageFromUrl('https://evil.example/a.png', { fetchImpl, resolveHost })).rejects.toThrow(
      /local network/
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('readImageFromFile (stdio build)', () => {
  it('reads a real image and takes its type from the bytes', async () => {
    const image = await readImageFromFile('/tmp/x.jpg', async () => JPEG);
    expect(image.mimeType).toBe('image/jpeg');
  });

  it('refuses a file that is not an image', async () => {
    await expect(readImageFromFile('/tmp/notes.txt', async () => new TextEncoder().encode('hello'))).rejects.toThrow(
      /not a jpeg/
    );
  });

  it('refuses a file over the limit', async () => {
    await expect(readImageFromFile('/tmp/big.png', async () => new Uint8Array(MAX_IMAGE_BYTES + 1))).rejects.toThrow(
      /up to 10MB/
    );
  });
});

it('sniffs the four allowed types', () => {
  expect(sniffImageType(JPEG)).toBe('image/jpeg');
  expect(sniffImageType(PNG)).toBe('image/png');
  expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
  expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp');
});
