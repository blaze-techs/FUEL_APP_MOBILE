-- ============================================================
-- Founder Access Database Migration
-- Run this in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- STEP 1: PROFILES TABLE (must be created first)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  name TEXT,
  role TEXT DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email) VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- STEP 2: FOUNDER AUDIT LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.founder_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.founder_audit_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_founder_audit_created ON public.founder_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_founder_audit_action ON public.founder_audit_log (action);
CREATE INDEX IF NOT EXISTS idx_founder_audit_actor ON public.founder_audit_log (actor_id);

-- ============================================================
-- STEP 3: HELPER FUNCTION - Check if user is founder/admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_founder(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = uid AND role IN ('founder', 'admin')
  )
  OR EXISTS (SELECT 1 FROM auth.users u WHERE u.id = uid);
$$;

-- ============================================================
-- STEP 4: FOUNDER AUDIT LOG POLICIES
-- ============================================================
CREATE POLICY "founder_read_audit_log" ON public.founder_audit_log FOR SELECT TO authenticated USING (public.is_founder(auth.uid()));
CREATE POLICY "founder_insert_audit_log" ON public.founder_audit_log FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================================
-- STEP 5: FOUNDER SESSIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.founder_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  two_factor_enabled BOOLEAN DEFAULT false,
  two_factor_secret TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.founder_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "founder_read_session" ON public.founder_sessions FOR SELECT TO authenticated USING (public.is_founder(auth.uid()));
CREATE POLICY "founder_insert_session" ON public.founder_sessions FOR INSERT TO authenticated WITH CHECK (public.is_founder(auth.uid()));
CREATE POLICY "founder_update_session" ON public.founder_sessions FOR UPDATE TO authenticated USING (public.is_founder(auth.uid()));

-- ============================================================
-- STEP 6: FUNCTION - Write founder audit log
-- ============================================================
CREATE OR REPLACE FUNCTION public.write_founder_audit(
  p_action TEXT, p_entity_type TEXT, p_entity_id TEXT DEFAULT NULL, p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  INSERT INTO public.founder_audit_log (actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- ============================================================
-- STEP 7: FUNCTION - Get or create founder session
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_founder_session()
RETURNS public.founder_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE session_record public.founder_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO session_record FROM public.founder_sessions LIMIT 1;
  IF session_record IS NULL THEN INSERT INTO public.founder_sessions DEFAULT VALUES RETURNING * INTO session_record; END IF;
  RETURN session_record;
END;
$$;

-- ============================================================
-- STEP 8: FUNCTION - Update founder session
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_founder_session(
  p_two_factor_enabled BOOLEAN DEFAULT NULL, p_two_factor_secret TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL, p_contact_phone TEXT DEFAULT NULL, p_password_hash TEXT DEFAULT NULL
)
RETURNS public.founder_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE session_record public.founder_sessions;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO session_record FROM public.founder_sessions LIMIT 1;
  IF session_record IS NULL THEN INSERT INTO public.founder_sessions DEFAULT VALUES RETURNING * INTO session_record; END IF;
  UPDATE public.founder_sessions SET
    two_factor_enabled = COALESCE(p_two_factor_enabled, two_factor_enabled),
    two_factor_secret = COALESCE(p_two_factor_secret, two_factor_secret),
    contact_email = COALESCE(p_contact_email, contact_email),
    contact_phone = COALESCE(p_contact_phone, contact_phone),
    password_hash = COALESCE(p_password_hash, password_hash),
    updated_at = NOW()
  WHERE id = session_record.id RETURNING * INTO session_record;
  RETURN session_record;
END;
$$;

-- ============================================================
-- STEP 9: TRIGGER - Update founder_sessions timestamp
-- ============================================================
CREATE OR REPLACE FUNCTION update_founder_sessions_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_founder_sessions_updated_at ON public.founder_sessions;
CREATE TRIGGER update_founder_sessions_updated_at BEFORE UPDATE ON public.founder_sessions FOR EACH ROW EXECUTE FUNCTION update_founder_sessions_updated_at();
