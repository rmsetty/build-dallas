-- ============================================================================
-- Build Dallas — company source registry
--
-- Four directories, all free and keyless, chosen to answer different halves of
-- "who is being built here":
--
--   sec-form-d          companies raising RIGHT NOW (filed within 15 days of
--                       first sale, months ahead of any press coverage)
--   capital-factory     the largest Texas venture portfolio published as
--                       structured data — 835 companies
--   yc-texas            small but the highest-quality records we get
--   health-wildcatters  Dallas healthtech accelerator; logo wall only
--
-- Adding a fifth is an INSERT here plus one parser file, nothing else.
-- ============================================================================

insert into public.platforms (platform, label, requires_llm, notes) values
  ('sec_form_d',   'SEC Form D',                false, 'EDGAR full-text search; exempt-offering notices by DFW issuers'),
  ('jsonld_org',   'schema.org Organization',   false, 'ld+json and Next.js flight payloads on portfolio pages'),
  ('yc_directory', 'Y Combinator directory',    false, 'yc-oss static JSON mirror, filtered by location'),
  ('sqsp_gallery', 'Squarespace logo gallery',  false, 'company names recovered from gallery image alt text')
on conflict (platform) do nothing;

insert into public.company_sources (slug, name, url, platform, scrape_strategy, notes) values
  (
    'sec-form-d',
    'SEC Form D filings (DFW)',
    'https://efts.sec.gov/LATEST/search-index',
    'sec_form_d',
    '{"pages": 5, "since_days": 240, "signal": "raising"}'::jsonb,
    'Earliest public evidence of a private raise. Funds are excluded via the filer''s own Item 3C claim, real-estate SPVs and practice roll-ups by name pattern.'
  ),
  (
    'capital-factory',
    'Capital Factory portfolio',
    'https://www.capitalfactory.com/portfolio',
    'jsonld_org',
    '{"signal": "portfolio", "signal_label": "Capital Factory portfolio", "default_location": "Texas", "exclude_names": ["Capital Factory", "Capital Factory Texas Fund"]}'::jsonb,
    'Texas-wide, not DFW-only: the source publishes no per-company address, so default_location records what we actually know rather than implying Dallas.'
  ),
  (
    'yc-texas',
    'Y Combinator (Texas)',
    'https://yc-oss.github.io/api/companies/all.json',
    'yc_directory',
    '{"region_match": ["TX, USA"], "signal": "yc"}'::jsonb,
    'Free static mirror of the YC directory. Matching is per-location so "Frisco, CO" never counts as Frisco, TX.'
  ),
  (
    'health-wildcatters',
    'Health Wildcatters portfolio',
    'https://www.healthwildcatters.com/portfolio/',
    'sqsp_gallery',
    '{"signal": "accelerator", "signal_label": "Health Wildcatters portfolio", "dfw_only": true, "default_location": "Dallas–Fort Worth, TX", "exclude_names": ["Health Wildcatters"]}'::jsonb,
    'Dallas healthtech accelerator. The page is a wall of logos with no text, so names are recovered from image alt attributes.'
  )
on conflict (slug) do nothing;
