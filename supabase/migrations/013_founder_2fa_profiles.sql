-- 013_founder_2fa_profiles.sql
-- Adds cross-device 2FA, recovery codes, unique identifier, and password
-- change tracking to the profiles table. Previously the founder 2FA secret
-- and "password hash" were stored in localStorage (per-browser only), so 2FA
-- silently disabled on new devices and password changes never reached
-- Supabase Auth. Moving these to the profiles table makes them cross-device.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_secret text DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS two_factor_enabled boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS recovery_codes text DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS unique_id text DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_password_change timestamptz DEFAULT NULL;

-- Backfill a human-friendly unique id (8 hex chars + -FPR suffix) for any
-- existing profiles that don't have one yet.
UPDATE profiles
SET unique_id = upper(substr(md5(random()::text), 1, 8)) || '-FPR'
WHERE unique_id IS NULL;

-- Ensure unique_id is unique per user.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_unique_id_idx ON profiles (unique_id) WHERE unique_id IS NOT NULL;
