-- V617: đăng bài nhóm ẩn danh, có công tắc "Đăng ẩn danh" mà không bật được (Facebook đổi cách bật) thì trả mã FB52 err_fb_group_anonymous_switch_not_enabled
-- "Không bật được chế độ đăng bài ẩn danh" thay cho SYS99 (anh chốt 21/11/2026): ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi (như FB49; 4 data liền thì
-- tạm dừng chiến dịch theo ngưỡng chung). Block 2923 "[engine] fb_enable_group_anonymous_post" đổi code (bản V616 → bản trả FB52, ok: false để có ảnh + DOM lỗi).
-- Không thấy công tắc vẫn là FB51 (V616). SINH TỪ scripts/build-v617-sql.cjs (nguồn guard v617-live-20261121.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc block mỗi lần mở unit. Gỡ: rollback_v617_engine_facebook_group_post_anonymous_switch.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v617_%') THEN
      RAISE EXCEPTION 'V617: sổ migration đã có V617, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2923 AND name = '[engine] fb_enable_group_anonymous_post' AND md5(code) = '0687856f3663282482914025fc606aa0') THEN
    RAISE EXCEPTION 'V617: block 2923 khác bản V616 (md5 0687856f3663282482914025fc606aa0), đọc lại và sinh lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_group_anonymous_switch_not_enabled' OR public_code = 'FB52') THEN
    RAISE EXCEPTION 'V617: mã err_fb_group_anonymous_switch_not_enabled / FB52 đã có';
  END IF;
  IF (SELECT max(substring(public_code from 3)::int) FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$') IS DISTINCT FROM 51 THEN
    RAISE EXCEPTION 'V617: mã FB lớn nhất không còn là FB51, đọc lại và sinh lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_fb_group_anonymous_switch_not_enabled') THEN
    RAISE EXCEPTION 'V617: đã có chính sách cho err_fb_group_anonymous_switch_not_enabled';
  END IF;
END $pre$;

-- 1. Block 2923: không bật được công tắc thì trả FB52 (không ném lỗi).
UPDATE public.auto_blocks SET code = $v617_block$
// Đăng bài nhóm ẩn danh (anh chốt 21/11/2026). Chạy ngay sau khi hộp "Tạo bài viết" đã mở, trước khi gõ nội dung.
// Chiến dịch không bật ẩn danh: không làm gì (không có khoá actionResult để bộ dựng lịch sử không coi là kết quả).
if (vars.groupPostAnonymous !== true) return { anonymousReady: true }
const switchSelector = await helpers.element('fb_group_post_anonymous_switch')
const okSelector = await helpers.element('fb_group_post_anonymous_intro_ok')
// Trạng thái công tắc "Đăng ẩn danh" trong hộp Tạo bài viết: missing / off / on.
async function anonymousSwitchState() {
  return await page.evaluate(`
    const result = document.evaluate(__args[0], document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (result.snapshotLength === 0) return 'missing';
    for (let i = 0; i < result.snapshotLength; i++) {
      if (result.snapshotItem(i).getAttribute('aria-checked') === 'true') return 'on';
    }
    return 'off';
  `, switchSelector)
}
// Công tắc có thể hiện chậm hơn ô nhập nội dung: chờ tối đa 5 giây.
let state = await anonymousSwitchState()
const switchDeadline = Date.now() + 5000
while (state === 'missing' && Date.now() < switchDeadline) {
  await helpers.sleep(250, signal)
  state = await anonymousSwitchState()
}
// Hộp Tạo bài viết đã mở mà không có công tắc: nhóm không cho đăng ẩn danh. Không đăng; data chuyển tạm dừng (FB51).
if (state === 'missing') {
  return {
    anonymousReady: false,
    actionResult: {
      actionCode: 'fb_post_group', statusCode: 'campaign_detail_error', errorCode: 'err_fb_group_anonymous_post_not_allowed',
      inputDataId: vars.inputDataId ?? null, operationState: 'not_committed', message: 'Nhóm này không cho đăng bài ẩn danh',
      data: { source: 'fb_enable_group_anonymous_post', selector: switchSelector }
    }
  }
}
if (state === 'off') {
  await page.click(switchSelector)
  // Bấm công tắc thì Facebook hiện bảng giới thiệu "Bài viết ẩn danh" có nút OK (mỗi lần mở trang mới); bấm OK thì công tắc mới bật.
  const enableDeadline = Date.now() + 15000
  while (true) {
    state = await anonymousSwitchState()
    if (state === 'on' || Date.now() >= enableDeadline) break
    if (await page.$(okSelector)) {
      await page.click(okSelector)
      await helpers.sleep(1000, signal)
    } else {
      await helpers.sleep(500, signal)
    }
  }
}
// Có công tắc mà không bật được (Facebook đổi cách bật): không bấm Đăng bằng tên thật; trả FB52 (anh chốt 21/11/2026: data về hàng đợi, cộng
// chuỗi, 4 data liền thì tạm dừng chiến dịch). ok: false để engine chụp ảnh + DOM lỗi.
if (state !== 'on') {
  return {
    ok: false,
    anonymousReady: false,
    actionResult: {
      actionCode: 'fb_post_group', statusCode: 'campaign_detail_error', errorCode: 'err_fb_group_anonymous_switch_not_enabled',
      inputDataId: vars.inputDataId ?? null, operationState: 'not_committed', message: 'Không bật được chế độ đăng bài ẩn danh',
      data: { source: 'fb_enable_group_anonymous_post', selector: switchSelector, okSelector, switchState: state }
    }
  }
}
return { anonymousReady: true, anonymousEnabled: true }
$v617_block$, updated_at = now()
 WHERE id = 2923 AND md5(code) = '0687856f3663282482914025fc606aa0';

-- 2. Mã FB52 + chính sách ở đăng nhóm.
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_fb_group_anonymous_switch_not_enabled', 'Không bật được chế độ đăng bài ẩn danh', 'V617 (engine v2): Đăng nhóm bật "Đăng bài ẩn danh": có công tắc "Đăng ẩn danh" nhưng bấm (và bấm OK) 15 giây vẫn không bật được.', NULL, NULL, '{}', false, false, 'fixed_minutes',
  '{}', '{}', true, false, 'FB52', 'ui_changed', 'Không bật được chế độ đăng bài ẩn danh', NULL);

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode, campaign_effect, account_effect, login_effect, source, description) VALUES
  ('err_fb_group_anonymous_switch_not_enabled', 'fb_post_group', NULL, 21, 'write', '{message}', NULL, 'no_count', 'increment', NULL, 'requeue', 'skip', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', 'v617', '[anh chốt 21/11/2026] FB52 đăng nhóm ẩn danh: có công tắc mà không bật được; ghi thất bại, không tính lượt, cộng chuỗi, data về hàng đợi (như FB49; 4 data liền thì tạm dừng theo ngưỡng chung).');

DO $post$
DECLARE v_text text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2923 AND md5(code) = '1bf17cec942b68537a7bdff675ee94f8') THEN
    RAISE EXCEPTION 'V617 postflight: block 2923 không phải bản mới (md5 1bf17cec942b68537a7bdff675ee94f8)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_group_anonymous_switch_not_enabled' AND public_code = 'FB52' AND is_active
                    AND customer_title = 'Không bật được chế độ đăng bài ẩn danh' AND error_class = 'ui_changed') THEN
    RAISE EXCEPTION 'V617 postflight: mã FB52 không đúng';
  END IF;

  IF (public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes') IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes')
     OR (public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes')->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V617 postflight: chính sách FB52 (%) khác FB49: % / %', 'before_send', public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes', public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes';
  END IF;
  IF (public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes') IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes')
     OR (public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes')->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V617 postflight: chính sách FB52 (%) khác FB49: % / %', 'in_flight', public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes', public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes';
  END IF;
  IF (public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes') IS DISTINCT FROM (public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes')
     OR (public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes')->>'target_effect' IS DISTINCT FROM 'requeue' THEN
    RAISE EXCEPTION 'V617 postflight: chính sách FB52 (%) khác FB49: % / %', 'after_send', public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_switch_not_enabled', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes', public.aka_agent_engine_resolve_policy('err_fb_group_post_upload_failed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions' - 'error_class' - 'requeue_after_minutes';
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"block","code":"err_fb_group_anonymous_switch_not_enabled","errorCode":"err_fb_group_anonymous_switch_not_enabled","message":"Không bật được chế độ đăng bài ẩn danh"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_group_anonymous_switch_not_enabled' THEN RAISE EXCEPTION 'V617 postflight: tín hiệu FB52 ra %', v_text; END IF;
END $post$;

COMMIT;
