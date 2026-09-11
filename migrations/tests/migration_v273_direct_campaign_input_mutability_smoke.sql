-- Disposable inputs/aliases/origins on the real tables exercise the real
-- triggers and constraints. No campaign is run; every fixture rolls back.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';

DO $behavior$
DECLARE
  v_action text;
  v_campaign bigint;
  v_id bigint := 8800273000000000;
  v_key text;
  v_field text;
  v_rejected boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('akaagent-v273-smoke', 0));
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id BETWEEN v_id AND v_id+1000)
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE id BETWEEN v_id AND v_id+1000)
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_origins WHERE id BETWEEN v_id AND v_id+1000)
  THEN RAISE EXCEPTION 'v273 smoke: fixture ID collision'; END IF;

  FOREACH v_action IN ARRAY ARRAY['zalo_message_phone', 'zalo_add_group_member',
    'facebook_message_uid', 'facebook_group_post', 'email_send', 'zalo_join_group_link']
  LOOP
    SELECT id INTO v_campaign FROM public.auto_campaigns
    WHERE action_id=v_action AND data_target_source_mode='direct' ORDER BY id LIMIT 1;
    IF v_campaign IS NULL THEN RAISE EXCEPTION 'v273 smoke: missing campaign type %', v_action; END IF;
    v_id := v_id+1;
    v_key := '__v273__:' || v_action;
    INSERT INTO public.auto_campaign_input_data
      (id,campaign_id,name,phone,uid,email,canonical_target_key,status,is_delete)
    OVERRIDING SYSTEM VALUE VALUES
      (v_id,v_campaign,'__v273__','0900000000','111111','original@example.invalid',v_key,'chờ xử lý',false);
    INSERT INTO public.auto_campaign_input_target_aliases
      (id,campaign_id,alias_key,canonical_target_key,input_data_id)
    OVERRIDING SYSTEM VALUE VALUES (v_id,v_campaign,v_key,v_key,v_id);
    INSERT INTO public.auto_campaign_input_origins
      (id,input_data_id,origin_kind,group_revision,canonical_target_key,payload_snapshot)
    OVERRIDING SYSTEM VALUE VALUES
      (v_id,v_id,'manual',0,v_key,'{"name":"Original snapshot","phone":"0900000000"}'::jsonb);

    -- Payload edits are independent of action and retain the target identity.
    UPDATE public.auto_campaign_input_data SET name='Updated',input_id=NULL,
      phone_carrier='vinaphone',info1='1',info2='2',info3='3',info4='4',info5='5',
      content='Updated content',schedule=now(),status='hoàn thành',note='Updated',date_action=now()
    WHERE id=v_id;
    IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_id
      AND canonical_target_key=v_key AND content='Updated content' AND info5='5')
    THEN RAISE EXCEPTION 'v273 smoke: metadata edit failed for %',v_action; END IF;
    IF v_action IN ('zalo_message_phone','zalo_add_group_member') THEN
      UPDATE public.auto_campaign_input_data SET uid='resolved-uid',phone='+84900000000' WHERE id=v_id;
      IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_id AND canonical_target_key=v_key)
      THEN RAISE EXCEPTION 'v273 smoke: enrichment/equivalent phone dropped identity'; END IF;
    END IF;

    -- A later constraint failure must roll back alias cleanup as well.
    v_rejected := false;
    BEGIN
      UPDATE public.auto_campaign_input_data SET phone='0911111111',uid='222222',
        email='changed@example.invalid',status='invalid-status' WHERE id=v_id;
    EXCEPTION WHEN check_violation THEN v_rejected:=true;
    END;
    IF NOT v_rejected OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE input_data_id=v_id)
    THEN RAISE EXCEPTION 'v273 smoke: alias cleanup was not atomic'; END IF;

    -- Metadata/system references remain separate from ordinary input data.
    v_rejected := false;
    BEGIN
      UPDATE public.auto_campaign_input_data SET canonical_target_key='caller-supplied-key' WHERE id=v_id;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM<>'canonical_campaign_input_payload_immutable' THEN RAISE; END IF;
      v_rejected:=true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'v273 smoke: system key became client-writable'; END IF;

    UPDATE public.auto_campaign_input_data SET phone='0911111111',uid='222222',
      email='changed@example.invalid' WHERE id=v_id;
    IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_id AND canonical_target_key IS NULL)
      OR EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE input_data_id=v_id)
      OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_origins WHERE input_data_id=v_id
        AND canonical_target_key=v_key AND payload_snapshot->>'name'='Original snapshot')
    THEN RAISE EXCEPTION 'v273 smoke: stale identity/history handling failed for %',v_action; END IF;

    -- One-time imports can also attach aliases to pre-existing noncanonical
    -- rows. Those aliases must be released on subsequent edits too.
    INSERT INTO public.auto_campaign_input_target_aliases
      (id,campaign_id,alias_key,canonical_target_key,input_data_id)
    OVERRIDING SYSTEM VALUE VALUES (v_id,v_campaign,v_key,v_key,v_id);
    UPDATE public.auto_campaign_input_data SET phone='0922222222',uid='333333',
      email='changed-again@example.invalid' WHERE id=v_id;
    IF EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE input_data_id=v_id)
    THEN RAISE EXCEPTION 'v273 smoke: legacy alias survived target edit'; END IF;

    INSERT INTO public.auto_campaign_input_target_aliases
      (id,campaign_id,alias_key,canonical_target_key,input_data_id)
    OVERRIDING SYSTEM VALUE VALUES (v_id,v_campaign,v_key,v_key,v_id);
    UPDATE public.auto_campaign_input_data SET is_delete=true WHERE id=v_id;
    IF EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE input_data_id=v_id)
      OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_origins WHERE input_data_id=v_id)
    THEN RAISE EXCEPTION 'v273 smoke: direct deletion/history failed'; END IF;
  END LOOP;

  -- Live Data Group inputs retain v272, including its phone enrichment.
  FOREACH v_action IN ARRAY ARRAY['zalo_message_phone','facebook_message_uid'] LOOP
    SELECT id INTO v_campaign FROM public.auto_campaigns
    WHERE action_id=v_action AND data_target_source_mode='data_group' ORDER BY id LIMIT 1;
    IF v_campaign IS NULL THEN RAISE EXCEPTION 'v273 smoke: missing group fixture'; END IF;
    v_id:=v_id+1;
    INSERT INTO public.auto_campaign_input_data
      (id,campaign_id,name,phone,uid,canonical_target_key,status,is_delete)
    OVERRIDING SYSTEM VALUE VALUES (v_id,v_campaign,'__v273__','0900000000','111111',
      '__v273__:group:'||v_action,'chờ xử lý',false);
    IF v_action='zalo_message_phone' THEN
      UPDATE public.auto_campaign_input_data SET name='Resolved',uid='resolved' WHERE id=v_id;
    ELSE
      v_rejected:=false;
      BEGIN
        UPDATE public.auto_campaign_input_data SET name='Forbidden',uid='changed' WHERE id=v_id;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'canonical_campaign_input_payload_immutable' THEN RAISE; END IF;
        v_rejected:=true;
      END;
      IF NOT v_rejected THEN RAISE EXCEPTION 'v273 smoke: group identity guard lost'; END IF;
    END IF;
    FOREACH v_field IN ARRAY ARRAY['phone','phone_carrier','email','info1','info2','info3',
      'info4','info5','content','schedule','is_delete'] LOOP
      v_rejected:=false;
      BEGIN
        -- Text fields start NULL; setting a non-NULL value forces an actual edit.
        IF v_field='is_delete' THEN
          UPDATE public.auto_campaign_input_data SET is_delete=true WHERE id=v_id;
        ELSIF v_field='schedule' THEN
          UPDATE public.auto_campaign_input_data SET schedule=now() WHERE id=v_id;
        ELSE
          EXECUTE format('UPDATE public.auto_campaign_input_data SET %I=%L WHERE id=%L',v_field,'forbidden',v_id);
        END IF;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'canonical_campaign_input_payload_immutable' THEN RAISE; END IF;
        v_rejected:=true;
      END;
      IF NOT v_rejected THEN RAISE EXCEPTION 'v273 smoke: group field % became editable',v_field; END IF;
    END LOOP;
    UPDATE public.auto_campaign_input_data SET status='tạm dừng',note='Still allowed',date_action=now() WHERE id=v_id;
  END LOOP;
END;
$behavior$;

SELECT 'PASS: six direct action types, full payload edits, equivalent-phone enrichment, atomic alias cleanup, legacy aliases, preserved origins, deletion and live-group guards' AS result;
ROLLBACK;
