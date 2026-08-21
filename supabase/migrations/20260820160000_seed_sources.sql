-- ============================================================================
-- Build Dallas — seed sources
--
-- Every URL below was fetched and checked on 2026-08-20. Where the spec's URL
-- was wrong or dead, the `notes` column records what was found instead.
-- Sources that could not be verified are inserted with active = false rather
-- than guessed at, so they show up in the admin view instead of failing nightly.
-- ============================================================================

insert into public.sources (name, url, source_type, platform, scrape_strategy, active, notes) values

-- ---------------------------------------------------------------- luma (JSON)
-- api.lu.ma is unauthenticated and free. NOTE: the official public-api.luma.com
-- requires a Luma Plus subscription ($59/mo), which the free-tier rule rules
-- out; these are the same endpoints the lu.ma web client itself calls.
('Luma — Dallas discover feed', 'https://lu.ma/dallas', 'api', 'luma',
 '{"mode":"discover","place_api_id":"discplace-Ez9iuaZfs6AZDls","pagination_limit":50}', true,
 'Resolved via GET api.lu.ma/url?url=dallas. City-wide feed; keyword filter does the narrowing.'),

('Luma — Startup Valley', 'https://lu.ma/StartupValley', 'api', 'luma',
 '{"mode":"calendar","calendar_api_id":"cal-Wdpq5TCA3scZSZo","pagination_limit":50}', true,
 'Spec source #23. Confirmed calendar with upcoming events on 2026-08-20.'),

('Luma — Texas Startup & Tech Week', 'https://lu.ma/texas-startup-tech-week', 'api', 'luma',
 '{"mode":"calendar","calendar_api_id":"cal-acFpdadTrO9nXH7","pagination_limit":50}', true,
 'Sept 28 - Oct 2 2026. Zero upcoming entries at seed time; expected to fill closer to the date.'),

-- ---------------------------------------------------------- eventbrite (HTML)
-- The v3 public Event Search API was withdrawn in Dec 2019 and the internal
-- destination/search endpoint requires a CSRF cookie pair, so we read the
-- __SERVER_DATA__ blob the search page already ships. The consumer slices just
-- the results array out of it rather than parsing the whole 780KB document.
('Eventbrite — Dallas startup events', 'https://www.eventbrite.com/d/tx--dallas/startup-events/',
 'html', 'eventbrite', '{"mode":"server_data"}', true,
 'Verified: 19 structured events in __SERVER_DATA__; results slice is ~85KB of the 784KB page.'),

('Eventbrite — Dallas tech meetups', 'https://www.eventbrite.com/d/tx--dallas/tech-meetup/',
 'html', 'eventbrite', '{"mode":"server_data"}', true, null),

-- --------------------------------------------------------------- meetup (HTML)
-- Meetup's GraphQL API now requires OAuth behind a paid Meetup Pro plan, so the
-- spec's GraphQL plan is not available on free tier. Group pages ship a 58KB
-- __NEXT_DATA__ blob with a fully normalized Apollo cache instead: title,
-- dateTime, endTime, description, eventUrl and a venue ref, no auth required.
('Meetup — Dallas Startup Founder 101', 'https://www.meetup.com/dallas-startup-founder-101/events/',
 'html', 'meetup', '{"group_urlname":"dallas-startup-founder-101"}', true, null),

('Meetup — Startups and Tech Events in Dallas', 'https://www.meetup.com/startups-and-tech-events-in-dallas/events/',
 'html', 'meetup', '{"group_urlname":"startups-and-tech-events-in-dallas"}', true, null),

('Meetup — Dallas AI/ML/Data Developers Group', 'https://www.meetup.com/dallas-ai-ml-data-developers-group/events/',
 'html', 'meetup', '{"group_urlname":"dallas-ai-ml-data-developers-group"}', true, null),

('Meetup — Dallas Startup & Tech Mixer', 'https://www.meetup.com/dallastechmixer/events/',
 'html', 'meetup', '{"group_urlname":"dallastechmixer"}', true, null),

('Meetup — StartupCouncil.org Dallas Tech Entrepreneurs & Investors', 'https://www.meetup.com/dallas-technology-startups-meetup-group/events/',
 'html', 'meetup', '{"group_urlname":"dallas-technology-startups-meetup-group"}', true, null),

('Meetup — Dallas AI', 'https://www.meetup.com/dal-ai/events/',
 'html', 'meetup', '{"group_urlname":"dal-ai"}', true,
 'Spec asked to cross-check dallas-ai.org: that site is live but publishes no machine-readable calendar, so Meetup is the feed.'),

-- ------------------------------------------------------------ localist (JSON)
-- Both universities run Localist, which exposes a free unauthenticated JSON API
-- at /api/2/events. require_keywords drops the registration-deadline noise that
-- dominates a university-wide calendar.
('UT Dallas — Comet Calendar', 'https://calendar.utdallas.edu', 'api', 'localist',
 '{"api_base":"https://calendar.utdallas.edu","days":120,"pp":100,"require_keywords":true}', true,
 'Spec #16. innovation.utdallas.edu/events 404s; the Comet Calendar Localist API is the working feed.'),

('UNT — University Calendar', 'https://calendar.unt.edu', 'api', 'localist',
 '{"api_base":"https://calendar.unt.edu","days":120,"pp":100,"require_keywords":true}', true,
 'Spec #17. murphycenter.unt.edu does not resolve; UNT Localist calendar stands in for the Murphy Center.'),

-- -------------------------------------------------------------- json-ld (HTML)
-- These two embed schema.org Event blocks, so they parse structurally and never
-- spend a Groq call.
('Dallas Innovates — events calendar', 'https://dallasinnovates.com/calendar/', 'html', 'jsonld',
 '{}', true, 'Verified: 43 schema.org Event objects on the page.'),

('AllEvents.in — Dallas startup', 'https://allevents.in/dallas/startup', 'html', 'jsonld',
 '{}', true, 'Verified: 15 schema.org Event objects. Aggregator/backstop per spec #22.'),

-- ------------------------------------------------------------- html + LLM
-- No structured data on these; the consumer strips tags and hands the text to
-- Groq. max_html_bytes caps how much of a large page we regex over, to stay
-- clear of the 10ms CPU ceiling.
('Capital Factory — events', 'https://www.capitalfactory.com/events', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #10 URL /in-person/ now redirects here. Links out to individual lu.ma events but publishes no calendar feed.'),

('The DEC Network — events', 'https://thedec.co/events/', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #11 gave thedecnetwork.org, which is a PARKED domain (114-byte redirect to a /lander sales page). Real site is thedec.co.'),

('DFW Startup Week', 'https://dfwstartupweek.com/', 'html', 'html',
 '{"max_html_bytes":150000}', true, 'Second half of spec #11.'),

('Dallas Startup Week', 'https://www.dallasstartupweek.com/', 'html', 'html',
 '{"max_html_bytes":150000}', true, null),

('TechFW / Tech Fort Worth', 'https://www.techfortworth.org/events/', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #13: techfw.org redirects to techfortworth.org. Page is ~1.2MB, so only the first 150KB is scanned.'),

('Pegasus Park — events', 'https://pegasuspark.com/events/', 'html', 'html',
 '{"max_html_bytes":150000}', true, 'Spec #14 URL confirmed live.'),

('Dallas Regional Chamber — events', 'https://www.dallaschamber.org/events/', 'html', 'html',
 '{"max_html_bytes":150000}', true, 'Spec #18.'),

('North Texas Angel Network', 'https://www.northtexasangels.org/', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #19 gave ntan.com, another PARKED domain (identical /lander redirect). Real site is northtexasangels.org.'),

('DFW.community', 'https://dfw.community/', 'html', 'html',
 '{"max_html_bytes":150000}', true, 'Spec #21. ~1.4MB page, truncated to the first 150KB.'),

('Ascent Valley', 'https://ascentvalley.com/', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #24 URL was unconfirmed; ascentvalley.com resolves and serves content, but no calendar markup was found. LLM extraction may return [].'),

('Venture Dallas', 'https://www.venturedallas.org/', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #20: the .com does not resolve, the live org is venturedallas.org. Largely a single annual event (Oct 22 2026).'),

('SMU — university calendar', 'https://calendar.smu.edu/', 'html', 'html',
 '{"max_html_bytes":150000}', true,
 'Spec #15. Not Localist and carries no JSON-LD, so it takes the LLM path. Caruth Institute / Big iDeas have no standalone calendar.'),

-- --------------------------------------------------- unverified -> parked off
('Fintech Dallas', 'https://fintechdallas.org', 'html', 'html', '{}', false,
 'Spec #20b. No live site found on 2026-08-20 (fintechdallas.org does not resolve). Left inactive rather than guessed.'),

('TxEE — Texas Entrepreneur Executives', 'https://txee.org', 'html', 'html', '{}', false,
 'Spec #25. txee.org does not resolve and no successor site was found. Left inactive.'),

('UNT Murphy Center for Entrepreneurship', 'https://unt-murphy-center.startuptree.co/', 'html', 'html', '{}', false,
 'Spec #17. murphycenter.unt.edu is dead; the center posts to a StartupTree portal that requires login. Covered indirectly by the UNT Localist source.');
