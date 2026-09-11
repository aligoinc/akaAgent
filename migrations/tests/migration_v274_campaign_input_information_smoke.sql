-- Run with the v274 migration staged in the same transaction. Disposable
-- input/alias/origin fixtures only; no campaigns run and every write rolls back.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
DO $behavior$
DECLARE
  v_mode text;
  v_action text;
  v_campaign bigint;
  v_id bigint := 8800274000000000;
  v_key text;
  v_field text;
  v_target_field text;
  v_rejected boolean;
  v_alias jsonb;
  v_origin jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('akaagent-v274-smoke',0));
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id BETWEEN v_id AND v_id+1000)
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_target_aliases WHERE id BETWEEN v_id AND v_id+1000)
    OR EXISTS (SELECT 1 FROM public.auto_campaign_input_origins WHERE id BETWEEN v_id AND v_id+1000)
  THEN RAISE EXCEPTION 'v274 smoke: fixture ID collision'; END IF;

  FOREACH v_mode IN ARRAY ARRAY['direct','data_group'] LOOP
    FOREACH v_action IN ARRAY ARRAY['zalo_message_phone','zalo_add_group_member',
      'facebook_message_uid','facebook_group_post','email_send'] LOOP
      SELECT id INTO v_campaign FROM public.auto_campaigns
      WHERE action_id=v_action AND data_target_source_mode=v_mode ORDER BY id LIMIT 1;
      IF v_campaign IS NULL THEN RAISE EXCEPTION 'v274 smoke: missing campaign % %',v_mode,v_action; END IF;
      v_id:=v_id+1;
      v_key:='__v274__:'||v_mode||':'||v_action;
      INSERT INTO public.auto_campaign_input_data
        (id,campaign_id,name,phone,uid,email,canonical_target_key,status,is_delete)
      OVERRIDING SYSTEM VALUE VALUES
        (v_id,v_campaign,'Original','0900000000',CASE WHEN v_action='zalo_add_group_member' THEN NULL ELSE '111111' END,
          'original@example.invalid',v_key,'chờ xử lý',false);
      INSERT INTO public.auto_campaign_input_target_aliases
        (id,campaign_id,alias_key,canonical_target_key,input_data_id)
      OVERRIDING SYSTEM VALUE VALUES (v_id,v_campaign,v_key,v_key,v_id);
      INSERT INTO public.auto_campaign_input_origins
        (id,input_data_id,origin_kind,group_revision,canonical_target_key,payload_snapshot)
      OVERRIDING SYSTEM VALUE VALUES (v_id,v_id,'manual',0,v_key,'{"name":"Original","phone":"0900000000"}');
      SELECT to_jsonb(a) INTO v_alias FROM public.auto_campaign_input_target_aliases a WHERE id=v_id;
      SELECT to_jsonb(o) INTO v_origin FROM public.auto_campaign_input_origins o WHERE id=v_id;

      UPDATE public.auto_campaign_input_data SET name='Information',phone_carrier='vinaphone',
        info1='1',info2='2',info3='3',info4='4',info5='5',content='Content',schedule=now(),
        status='hoàn thành',note='Note',date_action=now() WHERE id=v_id;
      IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_id
        AND name='Information' AND phone_carrier='vinaphone' AND info5='5' AND content='Content'
        AND canonical_target_key=v_key AND schedule IS NOT NULL AND date_action IS NOT NULL)
      THEN RAISE EXCEPTION 'v274 smoke: information did not persist % %',v_mode,v_action; END IF;

      IF v_action IN ('zalo_message_phone','zalo_add_group_member') THEN
        v_target_field:='phone';
        UPDATE public.auto_campaign_input_data SET uid='resolved-uid',email='info@example.invalid' WHERE id=v_id;
      ELSIF v_action='email_send' THEN
        v_target_field:='email';
        UPDATE public.auto_campaign_input_data SET uid='info-uid',phone='0911111111' WHERE id=v_id;
      ELSE
        v_target_field:='uid';
        UPDATE public.auto_campaign_input_data SET phone='0911111111',email='info@example.invalid' WHERE id=v_id;
      END IF;

      IF v_action='zalo_add_group_member' THEN
        v_rejected:=false;
        BEGIN
          UPDATE public.auto_campaign_input_data SET uid='different-resolved-uid' WHERE id=v_id;
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM<>'canonical_campaign_input_target_immutable' THEN RAISE; END IF;
          v_rejected:=true;
        END;
        IF NOT v_rejected THEN RAISE EXCEPTION 'v274 smoke: populated add-member UID changed'; END IF;
      END IF;

      -- A mixed patch must reject the entire update and retain the input/key.
      v_rejected:=false;
      BEGIN
        EXECUTE format('UPDATE public.auto_campaign_input_data SET %I=%L,name=%L WHERE id=%L',
          v_target_field,'another-target','Must not save',v_id);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'canonical_campaign_input_target_immutable' THEN RAISE; END IF;
        v_rejected:=true;
      END;
      IF NOT v_rejected OR NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data
        WHERE id=v_id AND name='Information' AND canonical_target_key=v_key)
      THEN RAISE EXCEPTION 'v274 smoke: target edit was accepted % %',v_mode,v_action; END IF;

      FOREACH v_field IN ARRAY ARRAY['campaign_id','input_id','auto_automation_detail_id','canonical_target_key','is_delete'] LOOP
        v_rejected:=false;
        BEGIN
          IF v_field='is_delete' THEN
            UPDATE public.auto_campaign_input_data SET is_delete=true WHERE id=v_id;
          ELSIF v_field='canonical_target_key' THEN
            UPDATE public.auto_campaign_input_data SET canonical_target_key=NULL WHERE id=v_id;
          ELSE
            EXECUTE format('UPDATE public.auto_campaign_input_data SET %I=%L WHERE id=%L',v_field,8800274999999999,v_id);
          END IF;
        EXCEPTION WHEN raise_exception THEN
          IF SQLERRM<>'canonical_campaign_input_payload_immutable' THEN RAISE; END IF;
          v_rejected:=true;
        END;
        IF NOT v_rejected THEN RAISE EXCEPTION 'v274 smoke: reference editable %',v_field; END IF;
      END LOOP;
      IF v_alias IS DISTINCT FROM (SELECT to_jsonb(a) FROM public.auto_campaign_input_target_aliases a WHERE id=v_id)
        OR v_origin IS DISTINCT FROM (SELECT to_jsonb(o) FROM public.auto_campaign_input_origins o WHERE id=v_id)
      THEN RAISE EXCEPTION 'v274 smoke: aliases/origins changed'; END IF;
    END LOOP;

    -- Hybrid add-member inputs without a phone remain bound to their UID.
    SELECT id INTO v_campaign FROM public.auto_campaigns
    WHERE action_id='zalo_add_group_member' AND data_target_source_mode=v_mode ORDER BY id LIMIT 1;
    v_id:=v_id+1;
    INSERT INTO public.auto_campaign_input_data (id,campaign_id,uid,canonical_target_key,status,is_delete)
    OVERRIDING SYSTEM VALUE VALUES(v_id,v_campaign,'original-uid','__v274__:uid:'||v_mode,'chờ xử lý',false);
    UPDATE public.auto_campaign_input_data SET name='Information',info1='1',email='info@example.invalid' WHERE id=v_id;
    FOREACH v_field IN ARRAY ARRAY['uid','phone'] LOOP
      v_rejected:=false;
      BEGIN
        EXECUTE format('UPDATE public.auto_campaign_input_data SET %I=%L WHERE id=%L',v_field,'0911111111',v_id);
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'canonical_campaign_input_target_immutable' THEN RAISE; END IF;
        v_rejected:=true;
      END;
      IF NOT v_rejected THEN RAISE EXCEPTION 'v274 smoke: hybrid target switched'; END IF;
    END LOOP;
  END LOOP;

  -- Existing noncanonical direct editing/deletion is outside this fix.
  SELECT id INTO v_campaign FROM public.auto_campaigns
  WHERE action_id='zalo_message_phone' AND data_target_source_mode='direct' ORDER BY id LIMIT 1;
  v_id:=v_id+1;
  INSERT INTO public.auto_campaign_input_data (id,campaign_id,phone,status,is_delete)
  OVERRIDING SYSTEM VALUE VALUES(v_id,v_campaign,'0900000000','chờ xử lý',false);
  UPDATE public.auto_campaign_input_data SET phone='0911111111',uid='edited',email='edited@example.invalid',is_delete=true WHERE id=v_id;
  IF NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data WHERE id=v_id AND phone='0911111111' AND is_delete=true)
  THEN RAISE EXCEPTION 'v274 smoke: ordinary input behavior regressed'; END IF;
END;
$behavior$;
SELECT 'PASS: both modes, five actions, information enrichment, immutable targets/references, hybrid routing, unchanged aliases/origins and ordinary editing' AS result;
ROLLBACK;
