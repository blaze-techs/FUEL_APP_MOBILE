BEGIN;

DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON public.audit_log;
CREATE POLICY audit_log_authenticated_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (station_id IS NULL OR fuelpro_user_role(station_id) IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.stamp_audit_log_actor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated session required'; END IF;
  NEW.user_id := auth.uid();
  NEW.created_at := coalesce(NEW.created_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_audit_log_actor ON public.audit_log;
CREATE TRIGGER stamp_audit_log_actor
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.stamp_audit_log_actor();

COMMIT;
