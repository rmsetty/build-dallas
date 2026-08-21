import { BROWSER_HEADERS } from '../http.ts';
import type { Env, RawEvent, SourceMessage } from '../types.ts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const DEFAULT_MAX_HTML_BYTES = 150_000;
const DEFAULT_MAX_TEXT_CHARS = 12_000;

const PROMPT = [
  'Extract every event listed on this page as JSON.',
  'Return ONLY a JSON object of the form {"events":[...]}, no markdown, no commentary.',
  'Each event object has these keys: title, date, time, location, description, url.',
  'date must be YYYY-MM-DD and time must be HH:MM in 24-hour form; use null when the page does not say.',
  'Assume the local timezone of Dallas, Texas. Do not convert times.',
  'Do NOT invent events. If the page lists no actual events, return {"events":[]}.',
].join(' ');

/**
 * Reduces a page to plain text cheaply.
 *
 * Every step here is CPU we pay for out of a 10ms budget, so the input is hard
 * capped first and the regexes are kept few and non-backtracking. On a 1.4MB
 * page (dfw.community) the cap is what keeps this viable at all.
 */
export function htmlToText(html: string, maxBytes: number, maxChars: number): string {
  return html
    .slice(0, maxBytes)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:nav|header|footer|svg|noscript)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer|svg|noscript)>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#?\w{1,8};/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

interface LlmEvent {
  title?: string;
  date?: string | null;
  time?: string | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
}

/**
 * Last resort for sites with no API and no structured markup. The expensive
 * part is an external fetch to Groq, which does not count against Worker CPU —
 * only the tag stripping above does.
 */
export async function fetchHtmlViaLlm(msg: SourceMessage, env: Env): Promise<RawEvent[]> {
  if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured');

  const s = msg.scrape_strategy ?? {};
  const res = await fetch(msg.url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`html ${msg.url} -> ${res.status}`);

  const text = htmlToText(
    await res.text(),
    s.max_html_bytes ?? DEFAULT_MAX_HTML_BYTES,
    s.max_text_chars ?? DEFAULT_MAX_TEXT_CHARS,
  );
  if (text.length < 200) return [];

  const groq = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.GROQ_MODEL ?? DEFAULT_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: PROMPT },
        { role: 'user', content: `Page URL: ${msg.url}\n\n${text}` },
      ],
    }),
  });

  if (!groq.ok) throw new Error(`groq -> ${groq.status} ${(await groq.text()).slice(0, 200)}`);

  const completion = (await groq.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = completion.choices?.[0]?.message?.content;
  if (!content) return [];

  let events: LlmEvent[];
  try {
    const parsed = JSON.parse(content) as { events?: LlmEvent[] } | LlmEvent[];
    events = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
  } catch {
    // A malformed model response is a bad run, not a broken source.
    return [];
  }

  return events.flatMap((e) => {
    const title = (e.title ?? '').trim();
    if (!title || !e.date) return [];
    return [
      {
        title,
        description: e.description ?? null,
        // Naive local time by construction; the source's default zone applies.
        start_time: `${e.date}T${e.time ?? '00:00'}:00`,
        location: e.location ?? null,
        venue: e.location ?? null,
        url: e.url ?? msg.url,
        // No stable platform id exists here, so cross-run identity comes from
        // the fuzzy title/date/venue match inside ingest_events.
        external_id: null,
      } satisfies RawEvent,
    ];
  });
}
