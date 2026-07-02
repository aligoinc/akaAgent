DO $$
DECLARE
  v_definition text;
  v_next_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.aka_agent_record_sms_message_status(bigint,bigint,text,text,jsonb,text)'::regprocedure
  )
  INTO v_definition;

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'Function public.aka_agent_record_sms_message_status not found';
  END IF;

  v_next_definition := replace(
    v_definition,
    'note = ''Hoàn thành chiến dịch SMS từ mobile app'',',
    'note = NULL,'
  );

  IF v_next_definition = v_definition THEN
    RAISE EXCEPTION 'Could not find SMS mobile completion note assignment to replace';
  END IF;

  EXECUTE v_next_definition;
END $$;

NOTIFY pgrst, 'reload schema';
