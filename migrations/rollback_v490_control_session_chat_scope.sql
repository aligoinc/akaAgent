-- Rollback V490: drop the chat-scope session reader. The WebApp API falls back to
-- public.aka_agent_authenticate_control_session (PGRST202/42883) on the next request, so chat-only iOS
-- sessions get 401 again and campaign sessions keep working unchanged. Chat-only sessions are not revoked
-- by this rollback; the old function revokes each one on its next request.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.aka_agent_authenticate_control_session_chat_v2(text);
DO $postflight$
BEGIN
  IF to_regprocedure('public.aka_agent_authenticate_control_session_chat_v2(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'v490_rollback_function_still_present';
  END IF;
  IF to_regprocedure('public.aka_agent_authenticate_control_session(text)') IS NULL THEN
    RAISE EXCEPTION 'v490_rollback_old_function_missing';
  END IF;
END
$postflight$;
COMMIT;
