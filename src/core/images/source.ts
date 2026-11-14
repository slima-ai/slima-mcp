/**
 * Getting image bytes from where an agent can point at them (iss_8ra4aqwgliryabow).
 *
 * The bytes come from a web URL (a street view, a museum page) or, when Slima runs
 * locally over stdio, a file on the author's computer. Never from base64 in the tool
 * call: the model does not have the image's bytes, and a field that accepts them only
 * invites it to make some up.
 *
 * A URL is fetched by THIS process — on the author's machine for the npm build — so it
 * must not be a way to read things only this machine can reach (a router page,
 * localhost services, cloud metadata). Every hop of a redirect is checked again.
 */

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

/** Rails MediaAsset::MAX_FILE_SIZE. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

export class ImageSourceError extends Error {}

export interface ImageBytes {
  bytes: Uint8Array;
  mimeType: ImageType;
}

/** Hostnames and IP literals that point inside the machine or its network. */
export function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return isInternalV4(v4.slice(1, 5).map(Number));

  if (host.includes(':')) return isInternalV6(host);
  return false;
}

/**
 * IPv6, after expanding to eight groups. `new URL()` rewrites `[::ffff:192.168.0.1]` as
 * `[::ffff:c0a8:1]`, so the embedded IPv4 has to be read from the hex groups — matching the
 * dotted form only would let every IPv4-mapped private address through.
 */
function isInternalV6(host: string): boolean {
  const groups = expandV6(host);
  if (!groups) return true; // unparseable: refuse rather than guess
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];

  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0;
  if (zeroPrefix && g4 === 0 && (g5 === 0xffff || g5 === 0)) return isInternalV4(v4(g6, g7)); // mapped / compatible
  if (zeroPrefix && g4 === 0xffff && g5 === 0) return isInternalV4(v4(g6, g7)); // ::ffff:0:a.b.c.d (SIIT)
  if (g0 === 0x64 && g1 === 0xff9b) return isInternalV4(v4(g6, g7)); // 64:ff9b::/96 NAT64
  if (g0 === 0x2002) return isInternalV4(v4(g1, g2)); // 2002::/16 6to4
  return false;
}

function expandV6(host: string): number[] | null {
  let text = host;
  const dotted = text.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1, 5).map(Number) as [number, number, number, number];
    text = `${text.slice(0, dotted.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const parts = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!parts.every((p) => /^[0-9a-f]{1,4}$/.test(p))) return null;
  return parts.map((p) => parseInt(p, 16));
}

function isInternalV4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 168) ||
    a! >= 224
  );
}

/** What the first bytes say the file is — the Content-Type header is the server's claim, not proof. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function checkSourceUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageSourceError(`source_url is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ImageSourceError(`source_url must be http or https (got ${url.protocol}).`);
  }
  if (isInternalHost(url.hostname)) {
    throw new ImageSourceError(
      `source_url points inside this computer or its local network (${url.hostname}); only public web addresses are fetched.`
    );
  }
  return url;
}

/**
 * Optional DNS check for the npm build: a public-looking name can resolve to 10.x. The Worker
 * build passes nothing — Cloudflare's network has no private range to reach.
 */
export type ResolveHost = (hostname: string) => Promise<string[]>;

export async function fetchImageFromUrl(
  raw: string,
  opts: { fetchImpl?: typeof fetch; resolveHost?: ResolveHost } = {}
): Promise<ImageBytes> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let url = checkSourceUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (opts.resolveHost) {
      const addresses = await opts.resolveHost(url.hostname);
      if (addresses.some(isInternalHost)) {
        throw new ImageSourceError(`source_url resolves to a local network address (${url.hostname}).`);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { redirect: 'manual', signal: controller.signal });
    } catch {
      throw new ImageSourceError(`could not fetch ${url.toString()} (network error or no answer within 20s).`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new ImageSourceError(`${url.toString()} redirected without a Location.`);
      url = checkSourceUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new ImageSourceError(`${url.toString()} answered ${response.status}.`);

    const declared = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declared)) {
      throw new ImageSourceError(
        `${url.toString()} is not an image Slima stores (Content-Type ${declared || 'missing'}); ` +
          `allowed: ${ALLOWED_IMAGE_TYPES.join(', ')}.`
      );
    }
    const length = Number(response.headers.get('content-length') ?? '0');
    if (length > MAX_IMAGE_BYTES) throw tooLarge(length);

    const bytes = await readCapped(response, MAX_IMAGE_BYTES);
    return { bytes, mimeType: confirmType(bytes, declared as ImageType) };
  }
  throw new ImageSourceError(`source_url redirected more than ${MAX_REDIRECTS} times.`);
}

/** Local file (stdio build only). The reader is injected so the Worker bundle never imports fs. */
export type ReadLocalFile = (path: string) => Promise<Uint8Array>;

export async function readImageFromFile(path: string, read: ReadLocalFile): Promise<ImageBytes> {
  const bytes = await read(path);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw tooLarge(bytes.byteLength);
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new ImageSourceError(`${path} is not a jpeg, png, webp or gif image.`);
  }
  return { bytes, mimeType: sniffed };
}

function confirmType(bytes: Uint8Array, declared: ImageType): ImageType {
  const sniffed = sniffImageType(bytes);
  if (!sniffed) throw new ImageSourceError(`the file says it is ${declared}, but its content is not an image.`);
  return sniffed;
}

function tooLarge(size: number): ImageSourceError {
  return new ImageSourceError(
    `the image is ${(size / 1024 / 1024).toFixed(1)}MB; Slima stores images up to ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`
  );
}

async function readCapped(response: Response, max: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw tooLarge(total);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
