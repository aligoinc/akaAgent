-- Keep campaign Data Group support tables RPC-only while allowing the
-- auto_campaigns lifecycle trigger to close intake after delete/completion.
--
-- v186 intentionally revoked direct table privileges from anon/authenticated,
-- but this trigger function was left SECURITY INVOKER. A desktop soft-delete
-- therefore ran the trigger as anon and failed while updating the protected
-- auto_campaign_data_group_sources table.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.aka_agent_close_terminal_campaign_data_group_source()'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_campaign_data_group_close_trigger_function';
  END IF;
END;
$preflight$;

ALTER FUNCTION public.aka_agent_close_terminal_campaign_data_group_source()
  SECURITY DEFINER;

ALTER FUNCTION public.aka_agent_close_terminal_campaign_data_group_source()
  SET search_path = pg_catalog, public;

-- Trigger functions are not client RPC entrypoints. Keep their execution
-- surface closed even though the trigger itself may invoke the function.
REVOKE ALL ON FUNCTION
  public.aka_agent_close_terminal_campaign_data_group_source()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION
  public.aka_agent_close_terminal_campaign_data_group_source()
IS
  'Trusted auto_campaigns lifecycle trigger that stops Data Group intake on campaign delete, completion, or hard end.';

NOTIFY pgrst, 'reload schema';

COMMIT;
