import { runParser, UnavailableParserError } from '../../shared/parsers/index.ts';
import { ingestEvents, markSourceFailed } from '../../shared/supabase.ts';
import type { Env, SourceMessage } from '../../shared/types.ts';

/**
 * Give a source two retries for transient trouble (a timeout, a 503), then
 * record the failure and ack. Must stay <= max_retries in wrangler.toml so we
 * always get a final delivery to write the error on, rather than the message
 * being dropped silently.
 */
const MAX_ATTEMPTS = 3;

export default {
  async queue(batch: MessageBatch<SourceMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const source = message.body;

      // Each source is isolated: a site that changes its markup, times out or
      // starts returning HTML where JSON used to be must not take down the rest
      // of the batch.
      try {
        const events = await runParser(source, { env, log: (m) => console.log(m) });

        // Quality gates are per-source policy carried on scrape_strategy and
        // enforced inside Postgres, not here.
        const strategy = source.scrape_strategy ?? {};
        const result = await ingestEvents(env, source.source_id, events, {
          requireKeywords: strategy.require_keywords,
          defaultTimezone: strategy.default_timezone,
          maxPastDays: strategy.max_past_days,
          locationFilter: strategy.location_filter,
        });

        console.log(
          `${source.platform} ${source.url}: fetched=${events.length} ` +
            `inserted=${result.inserted} updated=${result.updated} dupes=${result.duplicates} ` +
            `past=${result.past} off_region=${result.out_of_region} no_keywords=${result.no_keywords}`,
        );
        message.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);

        // A missing parser or missing credentials will not fix itself on a
        // retry, so record it and move on rather than burning queue ops.
        if (err instanceof UnavailableParserError) {
          await markSourceFailed(env, source.source_id, reason);
          console.error(`${source.url}: ${reason}`);
          message.ack();
        } else if (message.attempts >= MAX_ATTEMPTS) {
          // Log it against the source instead of throwing. consecutive_failures
          // climbs, and mark_source_failed parks the source after 7 bad days.
          await markSourceFailed(env, source.source_id, reason);
          console.error(`${source.url}: giving up after ${message.attempts} attempts — ${reason}`);
          message.ack();
        } else {
          console.warn(`${source.url}: attempt ${message.attempts} failed, retrying — ${reason}`);
          message.retry({ delaySeconds: 60 });
        }
      }
    }
  },
};
