-- Migration 014: Fix handle_new_user trigger to auto-set unique_id + backfill missing
-- Applied live 2026-08-11 via Supabase Management API
--
-- Problem: the handle_new_user() trigger (fires on auth.users INSERT) created
-- profiles but did NOT set `unique_id`. Migration 013 backfilled existing rows
-- once, but every user who signed up AFTER 013 got a NULL unique_id. This
-- affected 7 of 22 profiles at the time of this fix (including the new Phase 1
-- QA test user qa.phase1.0811@gmail.com). The founder console's unique-ID
-- display and cross-device founder auth both depend on unique_id being set.

-- 1. Fix the trigger function to auto-generate unique_id on new user signup.
--    Uses random() + the user's auth uid for entropy, formatted as
--    UPPER(8-hex-chars)-FPR (matching migration 013's format).
--    On conflict (user re-created), preserves the existing unique_id.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, name, username, unique_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'username', NULL),
    upper(substr(md5(random()::text || NEW.id::text), 1, 8)) || '-FPR'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, profiles.name),
    unique_id = COALESCE(profiles.unique_id, upper(substr(md5(random()::text || NEW.id::text), 1, 8)) || '-FPR');
  RETURN NEW;
END;
$function$;

-- 2. Backfill unique_id for all profiles that are still missing it.
UPDATE public.profiles
SET unique_id = upper(substr(md5(random()::text || id::text), 1, 8)) || '-FPR'
WHERE unique_id IS NULL;
