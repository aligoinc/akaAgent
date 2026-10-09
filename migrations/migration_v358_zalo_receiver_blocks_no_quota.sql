-- v358: Do not count recipient-blocked messages toward action limits.
-- Live source: akachat / cgjbsmqtfhqvttudyjzq, captured 2026-10-09.
-- Codes 122 and 119 remain shared policies for friend/stranger messaging.
-- Data only: preserve failed results and existing counters/history; no reload.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $history_guard$ BEGIN
IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name='migration_v358_zalo_receiver_blocks_no_quota') THEN
RAISE EXCEPTION 'v358 already recorded; do not reapply'; END IF;
END $history_guard$;

DO $receiver_blocks_no_quota$
DECLARE
  target record;
  before_row jsonb;
  after_row jsonb;
  affected integer;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      (10, 'err_zalo_receiver_blocks_stranger_message', 'd53de701e30c8bdab611240b5af14927'),
      (11, 'err_zalo_receiver_blocks_message', '541972c8188d73be665b10eea4a50222')
    ) AS expected(id, error_code, checksum)
    ORDER BY id
  LOOP
    IF (SELECT count(*) FROM public.auto_error p WHERE p.error_code = target.error_code) <> 1 THEN
      RAISE EXCEPTION 'v358 preflight: expected exactly one policy %', target.error_code;
    END IF;

    SELECT to_jsonb(p) INTO before_row
    FROM public.auto_error p
    WHERE p.id = target.id AND p.error_code = target.error_code
    FOR UPDATE;

    IF md5(before_row::text) IS DISTINCT FROM target.checksum THEN
      RAISE EXCEPTION 'v358 preflight: live policy % changed; recapture before applying', target.error_code;
    END IF;

    UPDATE public.auto_error
    SET counts_toward_limit = false, updated_at = now()
    WHERE id = target.id AND error_code = target.error_code;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN
      RAISE EXCEPTION 'v358 verification: expected one updated policy %', target.error_code;
    END IF;

    SELECT to_jsonb(p) INTO after_row FROM public.auto_error p WHERE p.id = target.id;
    IF (after_row->>'counts_toward_limit')::boolean IS DISTINCT FROM false
      OR (after_row - 'counts_toward_limit' - 'updated_at')
         IS DISTINCT FROM (before_row - 'counts_toward_limit' - 'updated_at') THEN
      RAISE EXCEPTION 'v358 verification: unexpected policy change %', target.error_code;
    END IF;
  END LOOP;
END;
$receiver_blocks_no_quota$;

COMMIT;
