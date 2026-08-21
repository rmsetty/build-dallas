export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  GROQ_API_KEY?: string;
  GROQ_MODEL?: string;
  /** Optional shared secret guarding the manual-trigger fetch handler. */
  TRIGGER_SECRET?: string;
  EVENT_QUEUE?: Queue<SourceMessage>;
}

export type Platform = 'luma' | 'eventbrite' | 'meetup' | 'localist' | 'jsonld' | 'html';

export interface ScrapeStrategy {
  // luma
  mode?: 'discover' | 'calendar' | 'server_data';
  place_api_id?: string;
  calendar_api_id?: string;
  pagination_limit?: number;
  // meetup
  group_urlname?: string;
  // localist + tribe
  api_base?: string;
  days?: number;
  pp?: number;
  per_page?: number;
  require_keywords?: boolean;
  // ical
  feed_url?: string;
  // html + llm
  max_html_bytes?: number;
  max_text_chars?: number;
  // shared quality gates, enforced inside ingest_events
  default_timezone?: string;
  /** Drop events starting more than this many days ago. Default 1. */
  max_past_days?: number;
  /** When set, keep only events whose venue/location matches one of these. */
  location_filter?: string[];
}

/** One queue message == one source to go fetch. */
export interface SourceMessage {
  source_id: string;
  url: string;
  platform: Platform;
  scrape_strategy: ScrapeStrategy;
}

/**
 * Normalized event as handed to ingest_events(). Timestamps stay STRINGS on
 * purpose: Postgres resolves wall-clock + IANA zone into an instant, which a
 * Worker cannot do without shipping a timezone database.
 */
export interface RawEvent {
  title: string;
  description?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  timezone?: string | null;
  location?: string | null;
  venue?: string | null;
  url?: string | null;
  external_id?: string | null;
  raw_content_hash?: string | null;
  cancelled?: boolean;
}

export interface IngestResult {
  inserted: number;
  updated: number;
  duplicates: number;
  skipped: number;
  no_keywords: number;
  past: number;
  out_of_region: number;
}
