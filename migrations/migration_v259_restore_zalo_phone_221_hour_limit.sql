-- Repository migration v259.
-- Already applied to production akachat on 2026-09-07 as Supabase migration
-- 20260907070842_restore_zalo_phone_221_hour_limit. Renamed locally to follow
-- the repository's migration_vN convention; no database reapply is needed.
--
-- Restore findUser code 221 removed by v249 while preserving action-scoped
-- sendFriendRequest handling. Requires runtimes with action-scoped lookup.
-- Source rows captured from production akachat on 2026-09-07. Checksums omit
-- only updated_at so an identical, already-applied policy is a safe no-op.

BEGIN;
SET LOCAL TIME ZONE 'UTC';

DO $migration$
DECLARE
  phone_policy jsonb;
  friend_policy jsonb;
  phone_checksum text;
BEGIN
  SELECT to_jsonb(e) INTO phone_policy
  FROM public.auto_error e
  WHERE e.error_code = 'err_zalo_find_phone_limit'
  FOR UPDATE;

  SELECT to_jsonb(e) INTO friend_policy
  FROM public.auto_error e
  WHERE e.error_code = 'err_zalo_add_friend_limit'
  FOR SHARE;

  IF md5((friend_policy - 'updated_at')::text)
      IS DISTINCT FROM '599f61e994ed9c973bb8c141a6a48e8c' THEN
    RAISE EXCEPTION 'Friend-request policy missing or changed; inspect live policy before applying';
  END IF;

  phone_checksum := md5((phone_policy - 'updated_at')::text);
  IF phone_checksum = '331395a3708f043bce1e1c09a11a160e' THEN
    UPDATE public.auto_error
    SET zalo_error_codes = ARRAY['312', '221']::text[],
        updated_at = now()
    WHERE error_code = 'err_zalo_find_phone_limit';
  ELSIF phone_checksum IS DISTINCT FROM '3a069ecaca5dcdeacb6ce39e350a43a0' THEN
    RAISE EXCEPTION 'Phone-search policy missing or changed; inspect live policy before applying';
  END IF;

  SELECT to_jsonb(e) INTO phone_policy
  FROM public.auto_error e
  WHERE e.error_code = 'err_zalo_find_phone_limit';

  IF md5((phone_policy - 'updated_at')::text)
      IS DISTINCT FROM '3a069ecaca5dcdeacb6ce39e350a43a0' THEN
    RAISE EXCEPTION 'Phone-search policy postflight checksum mismatch';
  END IF;
END;
$migration$;

COMMIT;
