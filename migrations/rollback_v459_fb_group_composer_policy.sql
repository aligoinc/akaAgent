-- Manual rollback V459: stop affected campaigns and restart their apps afterward.
-- Restore the prior group error behavior. Retain the new policy inactive for history.
-- No historical results/counters/workflows or personal policy are modified.
BEGIN;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='3s';
DO $migration$
DECLARE
  composer public.auto_blocks%ROWTYPE;
  profile_policy public.auto_error%ROWTYPE;
  group_policy public.auto_error%ROWTYPE;
  skipped_id bigint;
  effective_policy jsonb;
  expected_policy jsonb;
  block_hash text;
  candidate_code text;
BEGIN
  SELECT id INTO STRICT skipped_id FROM public.auto_status
    WHERE code='campaign_detail_skipped' AND is_active AND NOT is_delete
      AND component_type='campaign_detail' AND status_value='bỏ qua' AND flatform_type='all'
    FOR SHARE;
  SELECT to_jsonb(p) INTO effective_policy FROM public.auto_account_action_status_policies p
    WHERE status_id=skipped_id AND (action_code IS NULL OR action_code='fb_post_group') AND NOT is_delete
    ORDER BY (action_code IS NOT NULL) DESC LIMIT 1 FOR SHARE;
  IF effective_policy IS NULL OR NOT (
    effective_policy @> '{"is_active":true,"report_group":"skipped","counts_toward_limit":false,"bad_target_effect":"ignore","reset_error_streak":false,"input_effect":"complete"}'::jsonb
  ) THEN RAISE EXCEPTION 'V459: skipped policy drift'; END IF;

  SELECT * INTO STRICT profile_policy FROM public.auto_error
    WHERE error_code='err_fb_composer_editor_not_found' FOR UPDATE;
  IF md5((to_jsonb(profile_policy)-'id'-'created_at'-'updated_at')::text) <> '15beb040bc7d8d98235231d6292ac360'
    THEN RAISE EXCEPTION 'V459: personal composer policy drift'; END IF;

  SELECT * INTO STRICT composer FROM public.auto_blocks WHERE name='fb_open_composer' FOR UPDATE;
  block_hash := md5((to_jsonb(composer)-'id'-'created_at'-'updated_at')::text);
  IF block_hash NOT IN ('5a4405dd469ee5ac30f5bbbc9e8fddda','a8205c106feee987a598e2a00a8a57de')
    THEN RAISE EXCEPTION 'V459: composer block drift'; END IF;

  expected_policy := $v459${"is_active":true,"is_delete":false,"error_code":"err_fb_group_composer_editor_not_found","error_desc":"Áp dụng riêng fb_post_group khi fb_open_composer chờ nút mở hoặc form đăng bài quá thời gian. Ghi Bỏ qua, hoàn thành data, không tính hạn mức và không tăng/reset chuỗi lỗi. Không nhận diện riêng nhóm Mua bán. Không áp dụng cho đăng trang cá nhân hoặc lỗi khác. App hiện tại vẫn có thể ghi tiền tố Lỗi ở tiến trình; giữ nguyên nhân cho người dùng.","error_name":"Không tìm thấy ô đăng bài trong nhóm Facebook","error_type":"external facebook","detail_mode":"override","input_effect":"complete","detail_status":"bỏ qua","error_element":null,"noti_campaign":"Không tìm thấy ô đăng bài","zalo_error_codes":[],"zalo_action_codes":[],"counts_toward_limit":false,"disable_action_days":null,"disable_action_mode":"fixed_minutes","disable_action_time":null,"update_login_status":null,"disable_action_codes":[],"noti_running_process":"Không tìm thấy ô đăng bài","time_disable_actions":null,"update_status_account":null,"update_status_campaign":null,"count_consecutive_errors":null,"counts_toward_bad_target":false}$v459$::jsonb || jsonb_build_object('detail_status_id', skipped_id);
  SELECT * INTO group_policy FROM public.auto_error
    WHERE error_code='err_fb_group_composer_editor_not_found' FOR UPDATE;
  IF FOUND AND (to_jsonb(group_policy)-'id'-'created_at'-'updated_at')
    NOT IN (expected_policy, expected_policy || '{"is_active":false}'::jsonb)
    THEN RAISE EXCEPTION 'V459: group composer policy collision or drift'; END IF;

  IF block_hash='a8205c106feee987a598e2a00a8a57de' THEN
    candidate_code := replace(composer.code,
      $v459$errorCode: actionCode === 'fb_post_group'
        ? 'err_fb_group_composer_editor_not_found' : 'err_fb_composer_editor_not_found'$v459$,
      $v459$errorCode: "err_fb_composer_editor_not_found"$v459$);
    IF md5(((to_jsonb(composer)-'id'-'created_at'-'updated_at') ||
      jsonb_build_object('code',candidate_code))::text) <> '5a4405dd469ee5ac30f5bbbc9e8fddda'
      THEN RAISE EXCEPTION 'V459: rollback candidate mismatch'; END IF;
    UPDATE public.auto_blocks SET code=candidate_code, updated_at=clock_timestamp()
      WHERE id=composer.id;
  END IF;
  IF group_policy.id IS NOT NULL AND group_policy.is_active THEN
    UPDATE public.auto_error SET is_active=false, updated_at=clock_timestamp()
      WHERE id=group_policy.id;
  END IF;
  IF (SELECT md5((to_jsonb(b)-'id'-'created_at'-'updated_at')::text)
      FROM public.auto_blocks b WHERE id=composer.id) <> '5a4405dd469ee5ac30f5bbbc9e8fddda'
    THEN RAISE EXCEPTION 'V459: rollback composer postflight failed'; END IF;
  IF group_policy.id IS NOT NULL AND
    (SELECT to_jsonb(e)-'id'-'created_at'-'updated_at' FROM public.auto_error e
      WHERE id=group_policy.id) IS DISTINCT FROM (expected_policy || '{"is_active":false}'::jsonb)
    THEN RAISE EXCEPTION 'V459: rollback policy postflight failed'; END IF;
END
$migration$;
COMMIT;

