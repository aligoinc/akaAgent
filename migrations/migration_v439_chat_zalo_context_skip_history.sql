-- Skip automatic Context enqueue for imported history only.
-- Canonical source: live akachat capture in snapshots/context-skip-history-v439.
-- One atomic DO block; no function, ACL, existing job or application change.
-- The runner must execute this file in one transaction.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog, public;

DO $migration$
DECLARE
  v_trigger oid;
  v_checksum text;
BEGIN
  -- Serialize trigger replacement before checking its captured definition.
  LOCK TABLE public.chat_zalo_message IN SHARE ROW EXCLUSIVE MODE;

  IF (SELECT count(*) FROM pg_proc p
      WHERE p.oid IN (to_regprocedure('public.fn_context_trg_chat_zalo_message()'),
                      to_regprocedure('public.fn_context_xep_hang(text,text,text)'))
        AND pg_get_userbyid(p.proowner) = 'postgres'
        AND p.prosecdef AND p.provolatile = 'v'
        AND p.proconfig = ARRAY['search_path=""']::text[]
        AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
        AND ((p.oid = to_regprocedure('public.fn_context_trg_chat_zalo_message()')
              AND md5(pg_get_functiondef(p.oid)) = '0e0e281069b421112dcf78b4d2eb4407')
          OR (p.oid = to_regprocedure('public.fn_context_xep_hang(text,text,text)')
              AND md5(pg_get_functiondef(p.oid)) = '35cae0ef11d7f53c385d229523ddf410'))) <> 2 THEN
    RAISE EXCEPTION 'V439: Context function definition or privileges drifted; capture and review live state';
  END IF;

  SELECT t.oid, md5(pg_get_triggerdef(t.oid)) INTO v_trigger, v_checksum
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.chat_zalo_message'::regclass
    AND t.tgname = 'trg_context_xep_hang'
    AND NOT t.tgisinternal AND t.tgenabled = 'O';
  IF v_trigger IS NULL OR v_checksum NOT IN
      ('21da2094428e85bfb7ce8cfbf0b57750', '8c7c490bc897f189910b9f8d2f8bdbfa') THEN
    RAISE EXCEPTION 'V439: Context trigger missing, disabled or drifted; capture and review live state';
  END IF;

  IF v_checksum = '21da2094428e85bfb7ce8cfbf0b57750' THEN
    CREATE OR REPLACE TRIGGER trg_context_xep_hang
    AFTER INSERT ON public.chat_zalo_message
    FOR EACH ROW
    WHEN (NEW.direction = 'incoming'
      AND COALESCE(NEW.content_text, '') <> ''
      AND NEW.sync_source IS DISTINCT FROM 'old')
    EXECUTE FUNCTION public.fn_context_trg_chat_zalo_message();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
      WHERE t.tgrelid = 'public.chat_zalo_message'::regclass
        AND t.tgname = 'trg_context_xep_hang' AND t.tgenabled = 'O'
        AND md5(pg_get_triggerdef(t.oid)) = '8c7c490bc897f189910b9f8d2f8bdbfa') THEN
    RAISE EXCEPTION 'V439: Context trigger postcondition failed';
  END IF;
END
$migration$;
