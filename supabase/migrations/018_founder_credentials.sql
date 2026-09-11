-- Founder credentials table: maps a username to a Supabase auth email + unique_id
-- This enables username-based login (e.g. "FOUNDER" -> founder.qa.fuelpro@gmail.com)
-- and a founder credential manager in the Security section of the Founder Console.
CREATE TABLE IF NOT EXISTS founder_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  auth_email text NOT NULL,
  unique_id text,
  display_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: public can read (needed for login lookup — password still protects auth);
-- only founder/admin users can write.
ALTER TABLE founder_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "founder_creds_public_read" ON founder_credentials;
CREATE POLICY "founder_creds_public_read" ON founder_credentials
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "founder_creds_founder_insert" ON founder_credentials;
CREATE POLICY "founder_creds_founder_insert" ON founder_credentials
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() IN (SELECT id FROM users WHERE role IN ('founder', 'admin'))
  );

DROP POLICY IF EXISTS "founder_creds_founder_update" ON founder_credentials;
CREATE POLICY "founder_creds_founder_update" ON founder_credentials
  FOR UPDATE TO authenticated USING (
    auth.uid() IN (SELECT id FROM users WHERE role IN ('founder', 'admin'))
  ) WITH CHECK (
    auth.uid() IN (SELECT id FROM users WHERE role IN ('founder', 'admin'))
  );

DROP POLICY IF EXISTS "founder_creds_founder_delete" ON founder_credentials;
CREATE POLICY "founder_creds_founder_delete" ON founder_credentials
  FOR DELETE TO authenticated USING (
    auth.uid() IN (SELECT id FROM users WHERE role IN ('founder', 'admin'))
  );

-- Seed default: username FOUNDER -> founder.qa.fuelpro@gmail.com (the active QA founder)
INSERT INTO founder_credentials (username, auth_email, unique_id, display_name, is_active)
VALUES ('FOUNDER', 'founder.qa.fuelpro@gmail.com', 'FPRQA2026', 'Founder', true)
ON CONFLICT (username) DO UPDATE SET
  auth_email = EXCLUDED.auth_email,
  unique_id = EXCLUDED.unique_id,
  display_name = EXCLUDED.display_name,
  is_active = true,
  updated_at = now();
