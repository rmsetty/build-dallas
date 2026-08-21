import { listActiveSources } from '../../shared/supabase.ts';
import type { Env, SourceMessage } from '../../shared/types.ts';

/** sendBatch accepts at most 100 messages per call. */
const SEND_BATCH_SIZE = 100;

/**
 * The cron Worker does exactly two things: read the active sources and fan them
 * out onto the queue. No fetching, no parsing — all of that belongs to the
 * consumer, where a failure can be attributed to a single source.
 */
async function enqueueActiveSources(env: Env): Promise<number> {
  if (!env.EVENT_QUEUE) throw new Error('EVENT_QUEUE binding is missing');

  const sources = await listActiveSources(env);

  for (let i = 0; i < sources.length; i += SEND_BATCH_SIZE) {
    const chunk = sources.slice(i, i + SEND_BATCH_SIZE);
    await env.EVENT_QUEUE.sendBatch(
      chunk.map((s) => ({
        body: {
          source_id: s.id,
          url: s.url,
          platform: s.platform,
          scrape_strategy: s.scrape_strategy ?? {},
        } satisfies SourceMessage,
      })),
    );
  }

  return sources.length;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const count = await enqueueActiveSources(env);
    console.log(`event-cron: enqueued ${count} active sources`);
  },

  /**
   * Manual trigger, so a run can be kicked off without waiting for 12:00 UTC.
   * Refuses to serve at all unless TRIGGER_SECRET is set, so an unconfigured
   * deploy cannot be poked by anyone who finds the URL.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.TRIGGER_SECRET) {
      return new Response('manual trigger disabled: TRIGGER_SECRET is not set\n', { status: 404 });
    }
    if (request.headers.get('x-trigger-secret') !== env.TRIGGER_SECRET) {
      return new Response('forbidden\n', { status: 403 });
    }

    const count = await enqueueActiveSources(env);
    return Response.json({ enqueued: count });
  },
};
