-- View analytics for customer account links (the second mini site).
--
-- The station mini site records anonymous views through
-- `minisite_record_view`/`minisite_get_view_stats`. A customer account link
-- needs the same signal — "has the customer actually opened this?" — but its
-- identifier is a mixed-case base62 token, which the station RPCs reject
-- (`^[a-z0-9]([a-z0-9-]{1,58}[a-z0-9])?$` allows no uppercase). Rather than
-- loosen that regex — it is the guard that keeps the public station namespace
-- to URL-safe slugs — these are a parallel pair that validate a token.
--
-- The rows share `minisite_views`: the counter machinery (atomic +1, deduped
-- and capped country list) is identical, and a second counter table would be
-- the same thing twice. Account rows are namespaced with an `account:` prefix
-- so a token can never collide with a station slug, and so the two namespaces
-- stay distinguishable in the table.
--
-- Security mirrors the station pair: SECURITY DEFINER with `search_path`
-- pinned, RLS stays enabled with no public policies, and EXECUTE is granted to
-- service_role only. Granting it to anon would let any visitor inflate an
-- arbitrary token's counter.

-- Atomic view recording for an account link.
CREATE OR REPLACE FUNCTION public.customer_portal_record_view(
  p_token text,
  p_country text DEFAULT NULL
)
RETURNS TABLE (views bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key text;
  v_country text := upper(nullif(btrim(coalesce(p_country, '')), ''));
BEGIN
  -- 10-16 base62, matching TOKEN_RE on the edge shell and `isCapabilityCode`.
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9]{10,16}$' THEN
    RAISE EXCEPTION 'invalid token';
  END IF;
  IF v_country IS NOT NULL AND v_country !~ '^[A-Z]{2}$' THEN
    v_country := NULL;
  END IF;

  v_key := 'account:' || p_token;

  INSERT INTO public.minisite_views AS mv (slug, views, countries, last_viewed_at)
  VALUES (v_key, 1, CASE WHEN v_country IS NULL THEN '{}'::text[] ELSE ARRAY[v_country] END, now())
  ON CONFLICT (slug) DO UPDATE
    SET views = mv.views + 1,
        countries = (
          SELECT (COALESCE(array_agg(DISTINCT c ORDER BY c), '{}'::text[]))[1:40]
          FROM unnest(mv.countries || CASE
                 WHEN v_country IS NULL THEN '{}'::text[]
                 ELSE ARRAY[v_country]
               END) AS t(c)
          WHERE c IS NOT NULL
        ),
        last_viewed_at = now();

  RETURN QUERY
    SELECT mv.views FROM public.minisite_views mv WHERE mv.slug = v_key;
END;
$$;

REVOKE ALL ON FUNCTION public.customer_portal_record_view(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_portal_record_view(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_portal_record_view(text, text) TO service_role;

-- Owner-side read (no increment). Total for every token, including one that has
-- never been opened: a plain lookup yields zero rows, which the caller receives
-- as NULL, and the owner's tile would render nothing instead of "0 views".
CREATE OR REPLACE FUNCTION public.customer_portal_get_view_stats(p_token text)
RETURNS TABLE (views bigint, countries text[], last_viewed_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(
      (SELECT mv.views FROM public.minisite_views mv WHERE mv.slug = 'account:' || p_token),
      0::bigint
    ),
    COALESCE(
      (SELECT mv.countries FROM public.minisite_views mv WHERE mv.slug = 'account:' || p_token),
      '{}'::text[]
    ),
    (SELECT mv.last_viewed_at FROM public.minisite_views mv WHERE mv.slug = 'account:' || p_token);
$$;

REVOKE ALL ON FUNCTION public.customer_portal_get_view_stats(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_portal_get_view_stats(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_portal_get_view_stats(text) TO service_role;
