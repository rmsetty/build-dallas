/**
 * Several of these sites return a bot-check or a stripped page for a bare
 * fetch, so we present as an ordinary browser.
 */
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const JSON_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json',
};

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, ...init });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: JSON_HEADERS, ...init });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.json() as Promise<T>;
}

/**
 * Pulls out the JSON payload between two literal markers using indexOf rather
 * than a regex. Deliberate: these pages run to 800KB and a backtracking regex
 * over that much text is the one thing that can actually blow the Worker's 10ms
 * CPU budget. indexOf is a native memchr-style scan.
 */
export function sliceBetween(haystack: string, startMarker: string, endMarker: string, from = 0): string | null {
  const start = haystack.indexOf(startMarker, from);
  if (start < 0) return null;
  const contentStart = start + startMarker.length;
  const end = haystack.indexOf(endMarker, contentStart);
  if (end < 0) return null;
  return haystack.slice(contentStart, end);
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
  '#38': '&',
};

/**
 * JSON-LD blocks carry HTML-escaped text, so titles arrive as
 * "LADRON &amp; MAS". Decoding matters beyond cosmetics: the escaped form
 * changes the normalized title that dedupe and keyword matching run on.
 */
export function decodeEntities(input: string | null | undefined): string | null {
  if (!input) return null;
  return input
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, name: string) => {
      const key = name.toLowerCase();
      if (ENTITIES[key]) return ENTITIES[key];
      if (key.startsWith('#x')) {
        const code = Number.parseInt(key.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (key.startsWith('#')) {
        const code = Number.parseInt(key.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstString(...values: unknown[]): string | null {
  for (const v of values) {
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return null;
}

/** Joins address parts, dropping blanks and duplicates. */
export function joinLocation(...parts: Array<string | null | undefined>): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of parts) {
    const t = (p ?? '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    kept.push(t);
  }
  return kept.length ? kept.join(', ') : null;
}
