/**
 * Live parser check. Hits the real sites — no fixtures — because the whole risk
 * with scraping is that a page changes shape, which a recorded fixture would
 * happily hide.
 *
 *   node --experimental-strip-types --no-warnings test/parsers.live.test.ts
 *
 * Skips the `html` platform: that one needs a Groq key and costs a model call.
 */
import { fetchEventbrite } from '../shared/parsers/eventbrite.ts';
import { fetchJsonLd } from '../shared/parsers/jsonld.ts';
import { fetchLocalist } from '../shared/parsers/localist.ts';
import { fetchLuma } from '../shared/parsers/luma.ts';
import { fetchMeetup } from '../shared/parsers/meetup.ts';
import { htmlToText } from '../shared/parsers/htmlLlm.ts';
import type { RawEvent, SourceMessage } from '../shared/types.ts';

const CASES: Array<{ name: string; msg: SourceMessage; run: (m: SourceMessage) => Promise<RawEvent[]> }> = [
  {
    name: 'luma / discover (Dallas)',
    run: fetchLuma,
    msg: {
      source_id: 'test',
      url: 'https://lu.ma/dallas',
      platform: 'luma',
      scrape_strategy: { mode: 'discover', place_api_id: 'discplace-Ez9iuaZfs6AZDls', pagination_limit: 20 },
    },
  },
  {
    name: 'luma / calendar (Startup Valley)',
    run: fetchLuma,
    msg: {
      source_id: 'test',
      url: 'https://lu.ma/StartupValley',
      platform: 'luma',
      scrape_strategy: { mode: 'calendar', calendar_api_id: 'cal-Wdpq5TCA3scZSZo', pagination_limit: 20 },
    },
  },
  {
    name: 'eventbrite / __SERVER_DATA__',
    run: fetchEventbrite,
    msg: {
      source_id: 'test',
      url: 'https://www.eventbrite.com/d/tx--dallas/startup-events/',
      platform: 'eventbrite',
      scrape_strategy: { mode: 'server_data' },
    },
  },
  {
    name: 'meetup / __NEXT_DATA__',
    run: fetchMeetup,
    msg: {
      source_id: 'test',
      url: 'https://www.meetup.com/dallas-ai-ml-data-developers-group/events/',
      platform: 'meetup',
      scrape_strategy: { group_urlname: 'dallas-ai-ml-data-developers-group' },
    },
  },
  {
    name: 'localist / UT Dallas',
    run: fetchLocalist,
    msg: {
      source_id: 'test',
      url: 'https://calendar.utdallas.edu',
      platform: 'localist',
      scrape_strategy: { api_base: 'https://calendar.utdallas.edu', days: 120, pp: 50 },
    },
  },
  {
    name: 'json-ld / Dallas Innovates',
    run: fetchJsonLd,
    msg: {
      source_id: 'test',
      url: 'https://dallasinnovates.com/calendar/',
      platform: 'jsonld',
      scrape_strategy: {},
    },
  },
  {
    name: 'json-ld / AllEvents.in',
    run: fetchJsonLd,
    msg: {
      source_id: 'test',
      url: 'https://allevents.in/dallas/startup',
      platform: 'jsonld',
      scrape_strategy: {},
    },
  },
];

function summarize(events: RawEvent[]): string {
  const withStart = events.filter((e) => e.start_time).length;
  const withUrl = events.filter((e) => e.url).length;
  const withVenue = events.filter((e) => e.venue || e.location).length;
  const withId = events.filter((e) => e.external_id).length;
  return `start=${withStart} url=${withUrl} place=${withVenue} extId=${withId}`;
}

let failures = 0;

for (const c of CASES) {
  const t0 = performance.now();
  try {
    const events = await c.run(c.msg);
    const ms = Math.round(performance.now() - t0);

    if (events.length === 0) {
      console.log(`~ ${c.name.padEnd(34)} 0 events (${ms}ms) — source may simply be empty right now`);
      continue;
    }

    const bad = events.filter((e) => !e.title || typeof e.title !== 'string');
    if (bad.length) {
      failures++;
      console.log(`FAIL ${c.name.padEnd(32)} ${bad.length} events without a usable title`);
      continue;
    }

    console.log(`ok  ${c.name.padEnd(34)} ${String(events.length).padStart(3)} events (${ms}ms)  ${summarize(events)}`);
    const first = events[0]!;
    console.log(
      `      e.g. ${JSON.stringify(first.title).slice(0, 62)} | ${first.start_time ?? 'no start'} | ${first.venue ?? first.location ?? 'no place'}`,
    );
  } catch (err) {
    failures++;
    console.log(`FAIL ${c.name.padEnd(32)} ${err instanceof Error ? err.message : String(err)}`);
  }
}

// htmlToText is the only piece of the LLM path that burns Worker CPU, so check
// it holds up on the biggest page in the seed set.
{
  const t0 = performance.now();
  const html = await (await fetch('https://dfw.community/')).text();
  const fetched = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const text = htmlToText(html, 150_000, 12_000);
  const stripMs = performance.now() - t1;
  console.log(
    `\nhtmlToText on dfw.community: page=${Math.round(html.length / 1024)}KB fetch=${fetched}ms ` +
      `strip=${stripMs.toFixed(1)}ms -> ${text.length} chars`,
  );
  if (stripMs > 10) {
    failures++;
    console.log('FAIL htmlToText exceeded the 10ms Worker CPU budget on its own');
  }
}

console.log(failures === 0 ? '\nAll parser checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
