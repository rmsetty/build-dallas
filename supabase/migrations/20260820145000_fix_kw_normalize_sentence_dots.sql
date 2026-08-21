-- ============================================================================
-- Build Dallas — fix keyword normalization around sentence-final periods
--
-- kw_normalize kept '.' as a word character so that node.js / next.js / a.i.
-- survive tokenization. The side effect: a term at the end of a sentence keeps
-- its period, so " aws. " never matched the pattern " aws ". That silently
-- dropped keywords from exactly the text we care most about — resume bullets
-- and event blurbs, which are full of sentence-final terms.
--
-- Fix: strip periods that are NOT flanked by alphanumerics on both sides, so
-- "node.js" keeps its dot while "AWS." and "scikit-learn." lose theirs.
-- ============================================================================

create or replace function public.kw_normalize(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  -- btrim before padding: stripping a trailing dot leaves a space behind, and
  -- without the trim the padding produced a double space, so a pattern like
  -- 'a.i.' normalized to ' a.i  ' and could never match ' ... a.i work '.
  select ' ' || btrim(regexp_replace(
           regexp_replace(lower(coalesce(p, '')), '(?<![a-z0-9])\.|\.(?![a-z0-9])', ' ', 'g'),
           '[^a-z0-9+#.]+', ' ', 'g'
         )) || ' '
$$;

-- '.net' normalizes to bare 'net', which would fire on "net revenue" and
-- similar. 'dotnet' alone is the safe alias.
update public.keywords
  set aliases = array_remove(aliases, '.net')
  where term = 'c#';
