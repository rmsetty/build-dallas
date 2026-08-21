/**
 * Hand-maintained mirror of the columns the frontend actually reads.
 *
 * The pipeline-only columns (raw_content_hash, external_id, scrape_strategy…)
 * are deliberately absent: nothing in the browser is allowed to touch them, and
 * leaving them out means a typo surfaces at compile time instead of as an empty
 * column in the UI. Regenerate against the live project if the schema moves.
 */

export type EntityType = "company" | "event" | "person";
export type EditStatus = "auto_applied" | "pending" | "rejected";

export type EventRow = {
  id: string;
  source_id: string | null;
  title: string;
  description: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  venue: string | null;
  url: string | null;
  status: string;
  keywords: string[];
  created_at: string;
  updated_at: string;
};

/** What tells us a company is currently active. Ordered loosely by strength. */
export type CompanySignal =
  | "raising"
  | "event_active"
  | "accelerator"
  | "yc"
  | "portfolio"
  | "research"
  | "hiring"
  | "directory";

export type CompanyRow = {
  id: string;
  name: string;
  description: string | null;
  one_liner: string | null;
  stage: string | null;
  tags: string[];
  website: string | null;
  hq_location: string | null;
  logo_url: string | null;
  /** Generated in Postgres from hq_location; never written from the client. */
  dfw: boolean;
  signal: CompanySignal | null;
  signal_detail: string | null;
  signal_at: string | null;
  /** Slugs of every directory that reported this company. */
  discovered_via: string[];
  verified_by: string | null;
  last_seen_event_id: string | null;
  last_seen_at: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type PersonRow = {
  id: string;
  name: string;
  linkedin_url: string | null;
  company_id: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
};

export type ProfileRow = {
  id: string;
  display_name: string | null;
  headline: string | null;
  role_label: string | null;
  school: string | null;
  keywords: string[];
  target_roles: string[];
  linkedin_url: string | null;
  website: string | null;
  /** Opt-in. False means the member is invisible to public.member_directory(). */
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

/**
 * Resume text lives in its own owner-only table rather than on profiles.
 * profiles gained a "readable when is_public" policy, and RLS is row-level —
 * keeping the resume here is what makes that policy safe to grant.
 */
export type ProfileResumeRow = {
  profile_id: string;
  raw_text: string | null;
  updated_at: string;
};

export type EventCompanyLinkRow = {
  event_id: string;
  company_id: string;
  relationship: "host" | "sponsor" | "presenter" | "mentioned";
  created_at: string;
};

export type KeywordRow = {
  term: string;
  category: "role" | "industry" | "tool" | "stage" | "event_type";
  aliases: string[];
  active: boolean;
};

export type WikiEditableField = {
  entity_type: EntityType;
  field_name: string;
  value_type: "text" | "text[]";
  allowed_values: string[] | null;
};

export type WikiEditRow = {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  submitted_by: string;
  status: EditStatus;
  applied_at: string | null;
  review_note: string | null;
  created_at: string;
};

/** A row of public.member_directory(...) — a member plus our keyword overlap. */
export type DirectoryMember = {
  id: string;
  display_name: string | null;
  headline: string | null;
  role_label: string | null;
  school: string | null;
  keywords: string[];
  target_roles: string[];
  linkedin_url: string | null;
  website: string | null;
  created_at: string;
  shared_count: number;
  shared_terms: string[];
};

export type EcosystemStats = {
  events: number;
  companies: number;
  companies_dfw: number;
  companies_raising: number;
  members: number;
  sources: number;
  updated_at: string;
};

/** A row of public.recommended_events(...) — events plus the profile overlap. */
export type RankedEvent = Pick<
  EventRow,
  | "id"
  | "title"
  | "description"
  | "start_time"
  | "end_time"
  | "location"
  | "venue"
  | "url"
  | "keywords"
> & {
  match_score: number;
  matched_terms: string[];
};

type Table<TRow, TInsert = Partial<TRow>> = {
  Row: TRow;
  Insert: TInsert;
  Update: Partial<TRow>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      events: Table<EventRow>;
      companies: Table<CompanyRow>;
      people: Table<PersonRow>;
      profiles: Table<ProfileRow>;
      profile_resumes: Table<ProfileResumeRow>;
      event_company_links: Table<EventCompanyLinkRow>;
      keywords: Table<KeywordRow>;
      wiki_editable_fields: Table<WikiEditableField>;
      wiki_edits: Table<
        WikiEditRow,
        Pick<WikiEditRow, "entity_type" | "entity_id" | "field_name" | "new_value" | "submitted_by">
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      recommended_events: {
        Args: { p_limit?: number; p_offset?: number; p_from?: string; p_only_matches?: boolean };
        Returns: RankedEvent[];
      };
      apply_resume_text: {
        Args: { p_text: string; p_store_raw?: boolean };
        Returns: string[];
      };
      match_keywords: { Args: { p_text: string }; Returns: string[] };
      member_directory: {
        Args: {
          p_search?: string | null;
          p_role?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: DirectoryMember[];
      };
      ecosystem_stats: { Args: Record<string, never>; Returns: EcosystemStats };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
