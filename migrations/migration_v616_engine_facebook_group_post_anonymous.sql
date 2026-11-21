-- V616: đăng bài nhóm Facebook ẩn danh (anh chốt 21/11/2026). Chỉ workflow engine 321: block mới "[engine] fb_enable_group_anonymous_post" + node enable_anonymous /
-- if_anonymous_ready sau khi hộp Tạo bài viết mở; 2 element công tắc "Đăng ẩn danh" / nút OK; mã FB51 err_fb_group_anonymous_post_not_allowed "Nhóm này không cho đăng bài ẩn danh"
-- (data tạm dừng, dòng lịch sử "Bỏ qua", không tính lượt, không cộng chuỗi, chạy tiếp). Block chỉ chạy khi app gửi vars.groupPostAnonymous = true.
-- Bộ cũ (workflow 1) không đổi. SINH TỪ scripts/build-v616-sql.cjs (nguồn guard v616-live-20261121.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc workflow / block mỗi lượt, tự nạp lại element khi gặp tên mới.
-- Block mới không phải mốc gửi nên không có dòng danh mục bước. Gỡ: rollback_v616_engine_facebook_group_post_anonymous.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v616_%') THEN
      RAISE EXCEPTION 'V616: sổ migration đã có V616, không chạy lại';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_workflows WHERE purpose = 'facebook_group_post' AND workflow_id = 321) THEN
    RAISE EXCEPTION 'V616: workflow engine của facebook_group_post không còn là 321';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_workflows w
   WHERE w.id = 321 AND w.name = '[engine] facebook_group_post' AND md5(w.nodes::text || w.edges::text) = 'd5172b8a15c0b6f8a973a704dd475f5b'
     AND md5(w.variables_schema::text || w.default_variables::text) = 'e6dcaa859d181ec948753be1a82db9a4';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V616: workflow 321 khác bản đã đọc (md5 d5172b8a15c0b6f8a973a704dd475f5b), đọc lại và sinh lại'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2838 AND name = '[engine] if_else') THEN
    RAISE EXCEPTION 'V616: không thấy block [engine] if_else (2838)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = '[engine] fb_enable_group_anonymous_post') THEN
    RAISE EXCEPTION 'V616: đã có block "[engine] fb_enable_group_anonymous_post", dọn trước rồi chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('fb_group_post_anonymous_switch', 'fb_group_post_anonymous_intro_ok')) THEN
    RAISE EXCEPTION 'V616: đã có element công tắc / nút OK đăng ẩn danh';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = 'err_fb_group_anonymous_post_not_allowed' OR public_code = 'FB51') THEN
    RAISE EXCEPTION 'V616: mã err_fb_group_anonymous_post_not_allowed / FB51 đã có';
  END IF;
  IF (SELECT max(substring(public_code from 3)::int) FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$') IS DISTINCT FROM 50 THEN
    RAISE EXCEPTION 'V616: mã FB lớn nhất không còn là FB50, đọc lại và sinh lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = 'err_fb_group_anonymous_post_not_allowed') THEN
    RAISE EXCEPTION 'V616: đã có chính sách cho err_fb_group_anonymous_post_not_allowed';
  END IF;
END $pre$;

-- 1. Element (sửa ở màn Element khi Facebook đổi giao diện).
INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
  ('fb_group_post_anonymous_switch', '//*[@role=''dialog'']//input[@role=''switch'' and @aria-labelledby=//*[normalize-space(.)=''Đăng ẩn danh'' or normalize-space(.)=''Post anonymously'']/@id]', 'V616: công tắc "Đăng ẩn danh" trong hộp Tạo bài viết của nhóm (chỉ có khi nhóm cho đăng ẩn danh). Chữ tiếng Anh chưa thử.', 'facebook', true, NULL, NULL),
  ('fb_group_post_anonymous_intro_ok', '//*[@role=''dialog''][.//input[@role=''switch'']]//*[@role=''button'' and @aria-label=''OK'']', 'V616: nút OK của bảng giới thiệu "Bài viết ẩn danh" hiện sau khi bấm công tắc Đăng ẩn danh (bấm OK thì công tắc mới bật).', 'facebook', true, NULL, NULL);

-- 2. Block mới (chỉ bật công tắc trong hộp đang mở, không phải mốc gửi).
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES ('[engine] fb_enable_group_anonymous_post', 'Bật công tắc "Đăng ẩn danh" trong hộp Tạo bài viết của nhóm (bấm OK ở bảng giới thiệu). Không thấy công tắc thì trả FB51.',
        'EyeOff', 'facebook', 'js', $v616_block$
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
// Không bật được thì dừng ở đây: tuyệt đối không bấm Đăng bằng tên thật.
if (state !== 'on') throw new Error('Không bật được chế độ đăng bài ẩn danh')
return { anonymousReady: true, anonymousEnabled: true }
$v616_block$, '[]'::jsonb, '[{"label":"Sẵn sàng đăng ẩn danh","name":"anonymousReady","type":"boolean"}]'::jsonb, '{}'::jsonb, true);

-- 3. Workflow 321: if_composer_opened (đúng) → enable_anonymous → if_anonymous_ready → sleep1 + select_group_share_targets; sai → merge_join.
UPDATE public.auto_workflows w
   SET nodes = w.nodes || jsonb_build_array(
         '{"id":"enable_anonymous","label":"Bật đăng ẩn danh","config":{"screenshotCaptureOn":"failure","screenshotCaptureTiming":"after"},"blockName":"fb_enable_group_anonymous_post","position":{"x":540,"y":330}}'::jsonb || jsonb_build_object('blockId', b.id),
         '{"id":"if_anonymous_ready","label":"Đã bật ẩn danh?","config":{"condition":"input.anonymousReady !== false"},"blockId":2838,"position":{"x":540,"y":420},"blockName":"if_else","systemType":"ifElse"}'::jsonb),
       edges = (SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality), '[]'::jsonb)
                  FROM jsonb_array_elements(w.edges) WITH ORDINALITY e WHERE e.value->>'id' NOT IN ('e-if_composer_opened-sleep1-true', 'e-if_composer_opened-select_group_share_targets-true'))
               || '[{"id":"e-if_composer_opened-enable_anonymous-true","source":"if_composer_opened","target":"enable_anonymous","sourceHandle":"true"},{"id":"e-enable_anonymous-if_anonymous_ready","source":"enable_anonymous","target":"if_anonymous_ready"},{"id":"e-if_anonymous_ready-sleep1-true","source":"if_anonymous_ready","target":"sleep1","sourceHandle":"true"},{"id":"e-if_anonymous_ready-select_group_share_targets-true","source":"if_anonymous_ready","target":"select_group_share_targets","sourceHandle":"true"},{"id":"e-if_anonymous_ready-merge_join-false","source":"if_anonymous_ready","target":"merge_join","sourceHandle":"false"}]'::jsonb,
       variables_schema = w.variables_schema || '[{"default":false,"label":"Đăng bài ẩn danh","name":"groupPostAnonymous","type":"boolean"}]'::jsonb,
       default_variables = w.default_variables || '{"groupPostAnonymous":false}'::jsonb,
       updated_at = now()
  FROM public.auto_blocks b
 WHERE w.id = 321 AND b.name = '[engine] fb_enable_group_anonymous_post' AND md5(w.nodes::text || w.edges::text) = 'd5172b8a15c0b6f8a973a704dd475f5b';

-- 4. Mã FB51 + chính sách ở đăng nhóm.
INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', 'err_fb_group_anonymous_post_not_allowed', 'Nhóm này không cho đăng bài ẩn danh', 'V616 (engine v2): Đăng nhóm bật "Đăng bài ẩn danh": hộp Tạo bài viết đã mở nhưng không có công tắc "Đăng ẩn danh".', NULL, NULL, '{}', false, false, 'fixed_minutes',
  '{}', '{}', true, false, 'FB51', 'target_permanent', 'Nhóm này không cho đăng bài ẩn danh', NULL);

INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template, quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode, campaign_effect, account_effect, login_effect, source, description) VALUES
  ('err_fb_group_anonymous_post_not_allowed', 'fb_post_group', NULL, 51, 'write', 'Nhóm này không cho đăng bài ẩn danh', NULL, 'no_count', 'ignore', NULL, 'hold', 'skip', ARRAY[]::text[], 'fixed_minutes', 'continue', 'full', 'none', 'none', 'none', 'v616', '[anh chốt 21/11/2026] FB51 đăng nhóm ẩn danh: nhóm không có công tắc "Đăng ẩn danh"; data chuyển tạm dừng, ghi dòng "Bỏ qua" như FB40, không tính lượt, không cộng chuỗi, chạy tiếp nhóm sau.');

DO $post$
DECLARE v_block bigint; v_nodes jsonb; v_edges jsonb; v_p jsonb; v_text text;
BEGIN
  SELECT id INTO v_block FROM public.auto_blocks WHERE name = '[engine] fb_enable_group_anonymous_post' AND md5(code) = '0687856f3663282482914025fc606aa0';
  IF v_block IS NULL THEN RAISE EXCEPTION 'V616 postflight: không thấy block mới đúng code (md5 0687856f3663282482914025fc606aa0)'; END IF;
  SELECT nodes, edges INTO v_nodes, v_edges FROM public.auto_workflows WHERE id = 321;
  IF jsonb_array_length(v_nodes) <> 58 OR jsonb_array_length(v_edges) <> 72 THEN
    RAISE EXCEPTION 'V616 postflight: workflow 321 có % node / % cạnh, cần 58 / 72', jsonb_array_length(v_nodes), jsonb_array_length(v_edges);
  END IF;
  IF (v_nodes - (jsonb_array_length(v_nodes) - 1) - (jsonb_array_length(v_nodes) - 2)) IS DISTINCT FROM '[{"id": "resolve_url", "label": "Resolve link/UID → URL group", "config": {"urlType": "group"}, "blockId": 2857, "position": {"x": 100, "y": -100}, "blockName": "fb_resolve_url"}, {"id": "nav", "label": "Mở group", "config": {}, "blockId": 2841, "position": {"x": 100, "y": 0}, "blockName": "nav_to_url"}, {"id": "wait_main", "label": "Chờ trang group", "config": {"timeout": 10000, "selector": "//*[@role=''main'']"}, "blockId": 2843, "position": {"x": 100, "y": 100}, "blockName": "wait_for_selector"}, {"id": "open_composer", "config": {"composerActionCode": "fb_post_group"}, "blockId": 2844, "position": {"x": 100, "y": 200}, "blockName": "fb_open_composer"}, {"id": "sleep1", "config": {"ms": 2000}, "blockId": 2842, "position": {"x": 100, "y": 300}, "blockName": "sleep"}, {"id": "type_content", "config": {}, "blockId": 2845, "position": {"x": 100, "y": 400}, "blockName": "fb_type_post_content"}, {"id": "drop_images", "config": {}, "blockId": 2846, "position": {"x": 100, "y": 500}, "blockName": "fb_drop_post_images"}, {"id": "sleep2", "config": {"ms": 5000}, "blockId": 2842, "position": {"x": 100, "y": 600}, "blockName": "sleep"}, {"id": "click_post", "config": {"screenshotCaptureOn": "failure", "screenshotCaptureTiming": "after"}, "blockId": 2847, "position": {"x": 100, "y": 700}, "blockName": "fb_click_post_button"}, {"id": "sleep3", "config": {"ms": 3000}, "blockId": 2842, "position": {"x": 100, "y": 800}, "blockName": "sleep"}, {"id": "detect_pending", "config": {}, "blockId": 2848, "position": {"x": 100, "y": 900}, "blockName": "fb_detect_pending_post"}, {"id": "if_comment", "config": {"condition": "vars.enableComment === true && Array.isArray(vars.commentIterations) && vars.commentIterations.length > 0"}, "blockId": 2838, "position": {"x": 100, "y": 1000}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "loop_comment", "config": {"loopType": "forEach", "itemsExpr": "vars.commentIterations"}, "blockId": 2839, "position": {"x": 0, "y": 1100}, "blockName": "loop", "systemType": "loop"}, {"id": "comment", "label": "Comment iteration", "config": {}, "blockId": 2851, "position": {"x": 0, "y": 1200}, "blockName": "fb_comment_at_position"}, {"id": "merge_comment", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": 100, "y": 1300}, "blockName": "merge", "systemType": "merge"}, {"id": "if_leave", "config": {"condition": "vars.groupPostSubmitted === true && vars.leaveGroupOnPendingApproval === true && vars.groupPostIsPending === true"}, "blockId": 2838, "position": {"x": 100, "y": 1400}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "leave_group", "config": {"enabled": true}, "blockId": 2849, "position": {"x": 0, "y": 1500}, "blockName": "fb_leave_group_if_pending"}, {"id": "merge_leave", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": 100, "y": 1600}, "blockName": "merge", "systemType": "merge"}, {"id": "if_join", "config": {"condition": "vars.groupPostSubmitted === true && vars.autoJoinGroupAfterPost === true && vars.groupPostIsPending !== true"}, "blockId": 2838, "position": {"x": 100, "y": 1700}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "join_group", "config": {"enabled": true}, "blockId": 2850, "position": {"x": 0, "y": 1800}, "blockName": "fb_join_group_if_not_member"}, {"id": "merge_join", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": 100, "y": 1900}, "blockName": "merge", "systemType": "merge"}, {"id": "dismiss_after_nav", "label": "Click popup group nếu có", "config": {}, "blockId": 2872, "position": {"x": 100, "y": 50}, "blockName": "fb_click_group_post_prompt_if_present"}, {"id": "verify_submit", "label": "Xác nhận form đăng bài đã đóng", "config": {"screenshotCaptureOn": "failure", "screenshotCaptureTiming": "after"}, "blockId": 2871, "position": {"x": 100, "y": 760}, "blockName": "fb_verify_group_post_form_closed"}, {"id": "dismiss_after_submit", "label": "Click popup sau đăng nếu có", "config": {}, "blockId": 2872, "position": {"x": 100, "y": 800}, "blockName": "fb_click_group_post_prompt_if_present"}, {"id": "if_submitted", "label": "Đăng bài thành công?", "config": {"condition": "vars.groupPostSubmitted === true"}, "blockId": 2838, "position": {"x": 100, "y": 840}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "get_post_link", "label": "Lấy link bài vừa đăng", "config": {}, "blockId": 2873, "position": {"x": 100, "y": 880}, "blockName": "fb_get_first_group_post_link"}, {"id": "adjust_comments_after_pending", "label": "Điều chỉnh comment khi pending", "config": {}, "blockId": 2874, "position": {"x": 100, "y": 960}, "blockName": "fb_adjust_group_post_comments_after_pending"}, {"id": "if_skip_known_approval", "label": "Bỏ qua đăng bài nếu group đã biết cần duyệt?", "config": {"condition": "vars.skipGroupPostByKnownApproval === true"}, "blockId": 2838, "position": {"x": 100, "y": 160}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "skip_known_approval", "label": "Bỏ qua đăng bài group cần duyệt", "config": {}, "blockId": 2875, "position": {"x": 360, "y": 260}, "blockName": "fb_skip_group_post_for_known_approval"}, {"id": "merge_known_approval", "label": "Gộp nhánh đăng bài/bỏ qua", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": 100, "y": 880}, "blockName": "merge", "systemType": "merge"}, {"id": "if_copy_source", "label": "Có copy nguồn?", "config": {"condition": "vars.copyContentFromSource === true && !!vars.sourceLink"}, "blockId": 2838, "position": {"x": -260, "y": -220}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "scrape_source", "label": "Copy nội dung nguồn", "config": {}, "blockId": 2852, "position": {"x": -500, "y": -80}, "blockName": "fb_scrape_post"}, {"id": "source_ai_prompt", "label": "AI edit nội dung nguồn", "config": {}, "blockId": 2882, "position": {"x": -500, "y": 60}, "blockName": "fb_rewrite_source_content_ai"}, {"id": "nav_group_after_source", "label": "Quay lại group", "config": {}, "blockId": 2883, "position": {"x": -500, "y": 200}, "blockName": "fb_navigate_to_target_url"}, {"id": "merge_source_ready", "label": "Gộp nguồn trước khi đăng group", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": -260, "y": 340}, "blockName": "merge", "systemType": "merge"}, {"id": "select_group_share_targets", "label": "Chọn group share kèm", "config": {}, "blockId": 2912, "position": {"x": 100, "y": 430}, "blockName": "fb_select_group_post_share_targets"}, {"id": "compose_formatted_content", "label": "Ghép nội dung nguồn và nội dung định dạng", "config": {}, "blockId": 2914, "position": {"x": 100, "y": 500}, "blockName": "fb_compose_source_manual_content"}, {"id": "page_identity_restore_only", "label": "Chỉ chuyển về danh tính ban đầu?", "config": {"condition": "vars.runAsPage === true && vars.pageIdentityRestoreOnly === true"}, "blockId": 2838, "position": {"x": -260, "y": -1140}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "page_identity_needs_switch", "label": "Cần chuyển sang Page?", "config": {"condition": "vars.runAsPage === true && vars.pageIdentityReady !== true"}, "blockId": 2838, "position": {"x": -260, "y": -1010}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "page_identity_original", "label": "Nhớ danh tính ban đầu", "config": {}, "blockId": 2879, "position": {"x": -480, "y": -880}, "blockName": "fb_get_current_identity_name"}, {"id": "page_identity_switch", "label": "Chuyển sang Page đã chọn", "config": {"identityNameFromVars": "runAsPageName"}, "blockId": 2880, "position": {"x": -480, "y": -750}, "blockName": "fb_switch_identity_by_name"}, {"id": "page_identity_ready", "label": "Kiểm tra đã chuyển Page", "config": {"pageIdentityStateOperation": "ready"}, "blockId": 2915, "position": {"x": -480, "y": -620}, "blockName": "fb_campaign_page_identity_state"}, {"id": "page_identity_enter", "label": "Chạy hành động chiến dịch", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": -260, "y": -460}, "blockName": "merge", "systemType": "merge"}, {"id": "page_identity_capture_result", "label": "Giữ kết quả hành động", "config": {"pageIdentityStateOperation": "capture_result"}, "blockId": 2915, "position": {"x": -260, "y": 2160}, "blockName": "fb_campaign_page_identity_state"}, {"id": "page_identity_restore_join", "label": "Kết thúc phần hành động", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": 140, "y": 2290}, "blockName": "merge", "systemType": "merge"}, {"id": "page_identity_needs_restore", "label": "Cần chuyển về danh tính ban đầu?", "config": {"condition": "vars.runAsPage === true && !!vars.originalIdentityName && (vars.pageIdentityRestoreOnly === true || vars.pageIdentityRestoreAfterTarget !== false)"}, "blockId": 2838, "position": {"x": 140, "y": 2420}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "page_identity_restore", "label": "Chuyển về danh tính ban đầu", "config": {"useOriginalIdentity": true}, "blockId": 2880, "position": {"x": -80, "y": 2550}, "blockName": "fb_switch_identity_by_name"}, {"id": "page_identity_restored", "label": "Kiểm tra đã chuyển về", "config": {"pageIdentityStateOperation": "restored"}, "blockId": 2915, "position": {"x": -80, "y": 2680}, "blockName": "fb_campaign_page_identity_state"}, {"id": "page_identity_result_join", "label": "Kết thúc phiên Page", "config": {"mode": "any"}, "blockId": 2840, "position": {"x": 140, "y": 2810}, "blockName": "merge", "systemType": "merge"}, {"id": "page_identity_result", "label": "Trả kết quả hành động", "config": {"pageIdentityStateOperation": "result"}, "blockId": 2915, "position": {"x": 140, "y": 2940}, "blockName": "fb_campaign_page_identity_state"}, {"id": "if_composer_opened", "config": {"condition": "input.opened === true"}, "blockId": 2838, "position": {"x": 320, "y": 260}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "if_native_group_share", "label": "Chia sẻ bài viết nguồn vào nhóm?", "config": {"condition": "vars.groupPostShareFromPost === true"}, "blockId": 2838, "position": {"x": 600, "y": 200}, "blockName": "if_else", "systemType": "ifElse"}, {"id": "fb_prepare_native_group_share", "label": "fb_prepare_native_group_share", "config": {}, "blockId": 2919, "position": {"x": 600, "y": 350}, "blockName": "fb_prepare_native_group_share"}, {"id": "fb_select_native_share_group", "label": "fb_select_native_share_group", "config": {}, "blockId": 2920, "position": {"x": 600, "y": 500}, "blockName": "fb_select_native_share_group"}, {"id": "fb_submit_native_group_share", "label": "fb_submit_native_group_share", "config": {}, "blockId": 2921, "position": {"x": 600, "y": 650}, "blockName": "fb_submit_native_group_share"}, {"id": "if_native_group_selected", "config": {"condition": "vars.groupShareSelected === true"}, "blockId": 2838, "position": {"x": 600, "y": 575}, "blockName": "if_else", "systemType": "ifElse"}]'::jsonb THEN
    RAISE EXCEPTION 'V616 postflight: các node cũ của workflow 321 đã đổi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_nodes) n WHERE n->>'id' = 'enable_anonymous' AND jsonb_typeof(n->'blockId') = 'number'
                    AND (n->>'blockId')::bigint = v_block) THEN
    RAISE EXCEPTION 'V616 postflight: node enable_anonymous không trỏ tới block mới';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_edges) e WHERE e->>'id' IN ('e-if_composer_opened-sleep1-true', 'e-if_composer_opened-select_group_share_targets-true'))
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'if_composer_opened') <> 2
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'target' IN ('sleep1', 'select_group_share_targets')
           AND e->>'source' <> 'if_anonymous_ready') <> 0
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'if_anonymous_ready') <> 3 THEN
    RAISE EXCEPTION 'V616 postflight: cạnh quanh node đăng ẩn danh không đúng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = 321 AND w.default_variables->'groupPostAnonymous' = 'false'::jsonb
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.variables_schema) v WHERE v->>'name' = 'groupPostAnonymous')) THEN
    RAISE EXCEPTION 'V616 postflight: workflow 321 chưa có biến groupPostAnonymous';
  END IF;
  IF (SELECT count(*) FROM public.auto_elements WHERE name IN ('fb_group_post_anonymous_switch', 'fb_group_post_anonymous_intro_ok')) <> 2 THEN
    RAISE EXCEPTION 'V616 postflight: thiếu element';
  END IF;

  v_p := public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_post_not_allowed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'before_send') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'hold'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '51'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM 'Nhóm này không cho đăng bài ẩn danh'
     OR v_p->>'pace_mode' IS DISTINCT FROM 'full'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'target_permanent' THEN
    RAISE EXCEPTION 'V616 postflight: chính sách FB51 (%) ra %', 'before_send', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_post_not_allowed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'in_flight') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'hold'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '51'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM 'Nhóm này không cho đăng bài ẩn danh'
     OR v_p->>'pace_mode' IS DISTINCT FROM 'full'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'target_permanent' THEN
    RAISE EXCEPTION 'V616 postflight: chính sách FB51 (%) ra %', 'in_flight', v_p;
  END IF;
  v_p := public.aka_agent_engine_resolve_policy('err_fb_group_anonymous_post_not_allowed', NULL, 'fb_post_group', 'facebook_group_post', 'desktop', 'after_send') - 'policy_ids' - 'revisions';
  IF v_p->>'target_effect' IS DISTINCT FROM 'hold'
     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore'
     OR v_p->>'campaign_effect' IS DISTINCT FROM 'none'
     OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'
     OR v_p->>'detail_status_id' IS DISTINCT FROM '51'
     OR v_p->>'detail_mode' IS DISTINCT FROM 'write'
     OR v_p->>'run_effect' IS DISTINCT FROM 'continue'
     OR v_p->>'remaining_steps' IS DISTINCT FROM 'skip'
     OR v_p->>'log_template' IS DISTINCT FROM 'Nhóm này không cho đăng bài ẩn danh'
     OR v_p->>'pace_mode' IS DISTINCT FROM 'full'
     OR v_p->>'streak_threshold' IS DISTINCT FROM NULL
     OR v_p->>'error_class' IS DISTINCT FROM 'target_permanent' THEN
    RAISE EXCEPTION 'V616 postflight: chính sách FB51 (%) ra %', 'after_send', v_p;
  END IF;
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', 'fb_post_group', 'before_send', '{"kind":"block","code":"err_fb_group_anonymous_post_not_allowed","errorCode":"err_fb_group_anonymous_post_not_allowed","message":"Nhóm này không cho đăng bài ẩn danh"}'::jsonb) c;
  IF v_text IS DISTINCT FROM 'err_fb_group_anonymous_post_not_allowed' THEN RAISE EXCEPTION 'V616 postflight: tín hiệu FB51 ra %', v_text; END IF;
  -- Bộ cũ không được đổi.
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows WHERE id = 1 AND md5(nodes::text || edges::text) = 'c29504544a7900ae11ccda48f9ae6d73') THEN
    RAISE EXCEPTION 'V616 postflight: workflow bộ cũ 1 đã đổi';
  END IF;
END $post$;

COMMIT;
