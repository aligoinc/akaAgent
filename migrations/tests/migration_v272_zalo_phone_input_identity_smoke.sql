-- Preserve the v272 live-group contract after v273 opens direct input edits.
-- No customer input or campaign is changed, and every test write rolls back.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $wiring$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.auto_campaign_input_data'::regclass
      AND tgname = 'trg_aka_agent_guard_canonical_campaign_input_payload'
      AND tgfoid = 'public.aka_agent_guard_canonical_campaign_input_payload()'::regprocedure
      AND tgenabled = 'O'
  ) THEN
    RAISE EXCEPTION 'v272 smoke: live trigger missing or disabled';
  END IF;
END;
$wiring$;

CREATE TEMP TABLE canonical_input_identity_smoke ON COMMIT DROP AS
SELECT * FROM public.auto_campaign_input_data WITH NO DATA;
CREATE TRIGGER canonical_input_identity_smoke_guard
BEFORE UPDATE ON canonical_input_identity_smoke
FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_canonical_campaign_input_payload();

DO $behavior$
DECLARE
  v_direct_id bigint;
  v_group_id bigint;
  v_other_id bigint;
  v_column text;
  v_rejected boolean;
  v_count integer;
BEGIN
  SELECT id INTO v_direct_id FROM public.auto_campaigns
  WHERE action_id = 'zalo_message_phone' AND data_target_source_mode = 'direct'
  ORDER BY id LIMIT 1;
  SELECT id INTO v_group_id FROM public.auto_campaigns
  WHERE action_id = 'zalo_message_phone' AND data_target_source_mode = 'data_group'
  ORDER BY id LIMIT 1;
  SELECT id INTO v_other_id FROM public.auto_campaigns
  WHERE action_id = 'facebook_message_uid' AND data_target_source_mode = 'data_group'
  ORDER BY id LIMIT 1;
  IF v_direct_id IS NULL OR v_group_id IS NULL OR v_other_id IS NULL THEN
    RAISE EXCEPTION 'v272 smoke: required campaign types unavailable';
  END IF;

  INSERT INTO canonical_input_identity_smoke
    (id, campaign_id, input_id, name, phone, phone_carrier, uid, email,
     info1, info2, info3, info4, info5, content, schedule,
     canonical_target_key, auto_automation_detail_id, is_delete, status)
  SELECT id, campaign_id, 1, 'Original', phone, 'viettel', 'old-uid', 'test@example.invalid',
         'one', 'two', 'three', 'four', 'five', 'Original content', now(),
         canonical_key, 1, false, 'chờ xử lý'
  FROM (VALUES
    (1, v_direct_id, '0900000000', 'portable:phone:0900000000'),
    (2, v_group_id, '0900000000', 'portable:phone:0900000000'),
    (3, v_other_id, '0900000000', 'portable:facebook_person:old-uid'),
    (4, v_direct_id, '0900000000', NULL),
    (5, v_group_id, '   ', 'portable:phone:missing')
  ) AS fixtures(id, campaign_id, phone, canonical_key);

  UPDATE canonical_input_identity_smoke
  SET name = 'Resolved Zalo', uid = 'resolved-uid', status = 'hoàn thành',
      note = 'Identity saved', date_action = now()
  WHERE id IN (1, 2);
  SELECT count(*) INTO v_count FROM canonical_input_identity_smoke
  WHERE id IN (1, 2) AND name = 'Resolved Zalo' AND uid = 'resolved-uid'
    AND phone = '0900000000' AND canonical_target_key = 'portable:phone:0900000000'
    AND status = 'hoàn thành' AND date_action IS NOT NULL;
  IF v_count <> 2 THEN RAISE EXCEPTION 'v272 smoke: identity update failed'; END IF;

  -- Repeated refreshes work, rather than allowing only the first resolution.
  UPDATE canonical_input_identity_smoke SET name = 'Refreshed', uid = 'refreshed-uid'
  WHERE id IN (1, 2);

  FOREACH v_column IN ARRAY ARRAY[
    'campaign_id', 'input_id', 'phone', 'phone_carrier', 'email',
    'info1', 'info2', 'info3', 'info4', 'info5', 'content', 'schedule',
    'canonical_target_key', 'auto_automation_detail_id', 'is_delete'
  ] LOOP
    v_rejected := false;
    BEGIN
      EXECUTE format('UPDATE canonical_input_identity_smoke SET %I = NULL, name = ''Mixed patch'' WHERE id = 2', v_column);
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'canonical_campaign_input_payload_immutable' THEN RAISE; END IF;
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'v272 smoke: protected field % was changed', v_column; END IF;
  END LOOP;

  FOR v_count IN 3..5 LOOP
    IF v_count = 4 THEN CONTINUE; END IF;
    v_rejected := false;
    BEGIN
      UPDATE canonical_input_identity_smoke SET name = 'Forbidden', uid = 'forbidden'
      WHERE id = v_count;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'canonical_campaign_input_payload_immutable' THEN RAISE; END IF;
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'v272 smoke: wrong-action/blank-phone guard lost'; END IF;
  END LOOP;

  -- Ordinary direct inputs keep their original edit behavior.
  UPDATE canonical_input_identity_smoke
  SET name = 'Ordinary', uid = 'ordinary-uid', phone = '0911111111', content = 'Edited'
  WHERE id = 4;
  UPDATE canonical_input_identity_smoke SET status = 'tạm dừng', note = 'Paused'
  WHERE id IN (3, 5);
END;
$behavior$;

SELECT 'PASS: direct/group Zalo identity refresh; protected fields, other actions, blank phones and ordinary inputs' AS result;
ROLLBACK;
