import type { Env } from '../types.ts';

/** Company-directory platforms. Mirrors Platform for events. */
export type CompanyPlatform = 'sec_form_d' | 'jsonld_org' | 'yc_directory' | 'sqsp_gallery' | 'html';

export interface CompanyScrapeStrategy {
  /** Cities a record must sit in to be kept. Compared against the source's own location field. */
  cities?: string[];
  /** Free-text region match for sources that only give a coarse location (YC's all_locations). */
  region_match?: string[];
  /** How many result pages to walk. Each page is one subrequest. */
  pages?: number;
  /** Lookback for dated sources (SEC). Days. */
  since_days?: number;
  /** What being in this directory tells us about the company. */
  signal?: string;
  /** Human label used in signal_detail, e.g. "Capital Factory portfolio". */
  signal_label?: string;
  /** jsonld_org: skip these names (the site's own org block is always in there). */
  exclude_names?: string[];
  /** Drop anything that does not resolve to a DFW location. */
  dfw_only?: boolean;
  /**
   * Region to record when the source itself publishes no location. Most
   * portfolio pages don't, and "Texas" from a Texas fund's own portfolio is a
   * far more useful answer for the directory than a null.
   */
  default_location?: string;
}

/**
 * Normalized company as handed to ingest_companies(). Everything optional but
 * `name`: directories disagree wildly on what they expose, and the RPC merges
 * rather than overwrites, so a sparse record is useful rather than harmful.
 */
export interface RawCompany {
  name: string;
  one_liner?: string | null;
  description?: string | null;
  website?: string | null;
  hq_location?: string | null;
  logo_url?: string | null;
  stage?: string | null;
  signal?: string | null;
  signal_detail?: string | null;
  /** ISO date of the evidence, not of the crawl. */
  signal_at?: string | null;
}

export interface CompanySourceMessage {
  source_id: string;
  slug: string;
  url: string;
  platform: CompanyPlatform;
  scrape_strategy: CompanyScrapeStrategy;
}

export interface CompanyParserContext {
  env: Env;
  log: (message: string) => void;
}

export interface CompanyIngestResult {
  inserted: number;
  updated: number;
  skipped: number;
  out_of_region: number;
}
