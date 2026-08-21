/**
 * Parser registrations.
 *
 * To add a source type:
 *   1. write `./<name>.ts` exporting `(msg, ctx) => Promise<RawEvent[]>`
 *   2. add one registerParser({...}) block below
 *   3. `insert into public.platforms (platform, label) values (...)`
 *
 * Nothing else changes. The queue consumer, the local runner, failure handling
 * and reporting all resolve parsers through the registry.
 */
import { registerParser } from './registry.ts';
import { fetchEventbrite } from './eventbrite.ts';
import { fetchHtmlViaLlm } from './htmlLlm.ts';
import { fetchIcal } from './ical.ts';
import { fetchJsonLd } from './jsonld.ts';
import { fetchLocalist } from './localist.ts';
import { fetchLuma } from './luma.ts';
import { fetchMeetup } from './meetup.ts';
import { fetchTribe } from './tribe.ts';

registerParser({
  platform: 'luma',
  label: 'Luma',
  strategy: 'api.lu.ma discover + calendar endpoints (unauthenticated)',
  parse: (msg) => fetchLuma(msg),
});

registerParser({
  platform: 'eventbrite',
  label: 'Eventbrite',
  strategy: '__SERVER_DATA__ blob on the search page',
  parse: (msg) => fetchEventbrite(msg),
});

registerParser({
  platform: 'meetup',
  label: 'Meetup',
  strategy: '__NEXT_DATA__ Apollo cache on the group page',
  parse: (msg) => fetchMeetup(msg),
});

registerParser({
  platform: 'localist',
  label: 'Localist',
  strategy: '/api/2/events JSON API',
  parse: (msg) => fetchLocalist(msg),
});

registerParser({
  platform: 'tribe',
  label: 'The Events Calendar',
  strategy: '/wp-json/tribe/events/v1/events REST API',
  parse: (msg) => fetchTribe(msg),
});

registerParser({
  platform: 'ical',
  label: 'iCalendar feed',
  strategy: 'RFC 5545 .ics feed',
  parse: (msg) => fetchIcal(msg),
});

registerParser({
  platform: 'jsonld',
  label: 'schema.org JSON-LD',
  strategy: 'embedded <script type="application/ld+json"> Event blocks',
  parse: (msg) => fetchJsonLd(msg),
});

registerParser({
  platform: 'html',
  label: 'HTML via LLM',
  strategy: 'strip tags, extract with Groq',
  usesLlm: true,
  requiresEnv: ['GROQ_API_KEY'],
  parse: (msg, ctx) => fetchHtmlViaLlm(msg, ctx.env),
});

export {
  getParser,
  listParsers,
  missingEnv,
  registerParser,
  runParser,
  UnavailableParserError,
} from './registry.ts';
export type { ParserContext, ParserDef, ParseFn } from './registry.ts';
export { htmlToText } from './htmlLlm.ts';
