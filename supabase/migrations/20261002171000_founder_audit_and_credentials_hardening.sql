BEGIN;

-- Founder credentials are developer-level secrets; admin is not equivalent to founder.
DROP POLICY IF EXISTS founder_creds_founder_read ON public.founder_credentials;
DROP POLICY IF EXISTS founder_creds_founder_insert ON public.founder_credentials;
DROP POLICY IF EXISTS founder_creds_founder_update ON public.founder_credentials;
DROP POLICY IF EXISTS founder_creds_founder_delete ON public.founder_credentials;
CREATE POLICY founder_creds_founder_read ON public.founder_credentials
  FOR SELECT TO authenticated USING (is_founder(auth.uid()));
CREATE POLICY founder_creds_founder_insert ON public.founder_credentials
  FOR INSERT TO authenticated WITH CHECK (is_founder(auth.uid()));
CREATE POLICY founder_creds_founder_update ON public.founder_credentials
  FOR UPDATE TO authenticated USING (is_founder(auth.uid())) WITH CHECK (is_founder(auth.uid()));
CREATE POLICY founder_creds_founder_delete ON public.founder_credentials
  FOR DELETE TO authenticated USING (is_founder(auth.uid()));

-- Founder audit rows must be produced by founders and must be stamped with the
-- actual authenticated actor. A client cannot impersonate another actor.
DROP POLICY IF EXISTS founder_insert_audit_log ON public.founder_audit_log;
CREATE POLICY founder_insert_audit_log ON public.founder_audit_log
  FOR INSERT TO authenticated WITH CHECK (is_founder(auth.uid()));

CREATE OR REPLACE FUNCTION public.stamp_founder_audit_actor()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT is_founder(auth.uid()) THEN
    RAISE EXCEPTION 'Founder privileges required';
  END IF;
  NEW.actor_id := auth.uid();
  NEW.created_at := coalesce(NEW.created_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_founder_audit_actor ON public.founder_audit_log;
CREATE TRIGGER stamp_founder_audit_actor
  BEFORE INSERT ON public.founder_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.stamp_founder_audit_actor();

COMMIT;
