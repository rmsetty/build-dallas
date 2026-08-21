-- ============================================================================
-- Build Dallas — wiki edit value validation
--
-- Fixes two problems found while testing auto-apply:
--   1. The value written to the target row was the submitter's raw string, so
--      "  Series-A " tripped the companies_stage_check constraint even though
--      corroboration matching had already normalized it for comparison.
--   2. Any constraint violation during auto-apply aborted the INSERT of the
--      wiki_edit itself, so a bad suggestion surfaced as a hard 500 instead of
--      being recorded and declined.
-- ============================================================================

-- Constrained-vocabulary fields can now declare their legal values. NULL means
-- free text. The frontend can read this to render a <Select> instead of a text
-- input, since wiki_editable_fields is publicly readable.
alter table public.wiki_editable_fields
  add column allowed_values text[];

update public.wiki_editable_fields
  set allowed_values = array['idea', 'pre-seed', 'seed', 'series-a', 'series-b',
                             'series-c-plus', 'growth', 'bootstrapped',
                             'acquired', 'public', 'unknown']
  where entity_type = 'company' and field_name = 'stage';


-- Trim the submission and, for constrained fields, canonicalize it against the
-- allowlist case-insensitively so "Series-A" and "series-a" both land as the
-- stored value. Unknown values are rejected up front with a readable message.
create or replace function private.wiki_edits_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table    text;
  v_exists   boolean;
  v_current  text;
  v_allowed  text[];
  v_canonical text;
begin
  new.submitted_by := coalesce(new.submitted_by, auth.uid());
  if new.submitted_by is null then
    raise exception 'wiki edits require an authenticated submitter';
  end if;

  new.new_value := nullif(btrim(coalesce(new.new_value, '')), '');

  select f.allowed_values into v_allowed
  from public.wiki_editable_fields f
  where f.entity_type = new.entity_type and f.field_name = new.field_name;

  if v_allowed is not null and new.new_value is not null then
    select a into v_canonical
    from unnest(v_allowed) as a
    where lower(a) = lower(new.new_value)
    limit 1;

    if v_canonical is null then
      raise exception '% is not a valid value for %.% (expected one of: %)',
        new.new_value, new.entity_type, new.field_name, array_to_string(v_allowed, ', ');
    end if;

    new.new_value := v_canonical;
  end if;

  v_table := private.wiki_entity_table(new.entity_type);

  execute format('select exists (select 1 from public.%I t where t.id = $1)', v_table)
    into v_exists using new.entity_id;
  if not v_exists then
    raise exception 'no % with id %', new.entity_type, new.entity_id;
  end if;

  execute format('select (t.%I)::text from public.%I t where t.id = $1', new.field_name, v_table)
    into v_current using new.entity_id;

  if v_current is not distinct from new.new_value then
    raise exception '%.% already has that value', new.entity_type, new.field_name;
  end if;

  new.old_value  := v_current;
  new.status     := 'pending';
  new.applied_at := null;
  return new;
end;
$$;


-- Auto-apply, but never let a downstream constraint failure take down the
-- insert. The EXCEPTION block opens a subtransaction: the failed UPDATE rolls
-- back on its own and the edit is recorded as 'rejected' with the reason.
create or replace function private.wiki_edits_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_owner      boolean := false;
  v_corroborators integer := 0;
  v_matching_ids  uuid[];
begin
  if new.entity_type = 'company' then
    select exists (
      select 1 from public.companies c
      where c.id = new.entity_id and c.verified_by = new.submitted_by
    ) into v_is_owner;
  end if;

  select coalesce(array_agg(e.id), '{}'::uuid[]), count(distinct e.submitted_by)
    into v_matching_ids, v_corroborators
  from public.wiki_edits e
  where e.entity_type = new.entity_type
    and e.entity_id   = new.entity_id
    and e.field_name  = new.field_name
    and e.status      = 'pending'
    and lower(btrim(coalesce(e.new_value, ''))) = lower(btrim(coalesce(new.new_value, '')));

  if v_is_owner or v_corroborators >= 2 then
    begin
      perform private.wiki_apply_edit(new.entity_type, new.entity_id, new.field_name, new.new_value);

      update public.wiki_edits
        set status = 'auto_applied', applied_at = now()
        where id = any(v_matching_ids);
    exception when others then
      update public.wiki_edits
        set status = 'rejected', review_note = 'auto-apply failed: ' || sqlerrm
        where id = any(v_matching_ids);
    end;
  end if;

  return null;
end;
$$;
