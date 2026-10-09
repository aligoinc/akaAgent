-- v359: C# facebook.com friend outcomes + policy-aware Desktop contract.
-- Live akachat source captured 2026-10-09. Data only; no RPC/DDL/schema reload.
-- Old clients execute the exact captured legacy body until they opt into v1.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $friend_status$
DECLARE
  policies_before jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO policies_before
  FROM public.auto_error e WHERE error_code IN ('err_fb_add_friend_unavailable','err_undefined');
  PERFORM 1 FROM public.auto_blocks WHERE id=39 AND name='fb_add_friend' FOR UPDATE;
  IF (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=39 AND name='fb_add_friend')
    IS DISTINCT FROM '7a07491212e603b21b1585f8d6f0f78a' THEN
    RAISE EXCEPTION 'v359 preflight: fb_add_friend changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE id=12 AND name='fb_add_friend_button')
    IS DISTINCT FROM '6e03d6a844cd2948a31028e2da8785ea' THEN
    RAISE EXCEPTION 'v359 preflight: add-friend selector changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN ('fb_friend_request_sent_button','fb_accept_friend_request_button','fb_already_friend_button')) THEN
    RAISE EXCEPTION 'v359 preflight: friend state selectors already exist';
  END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=249) IS DISTINCT FROM '48a1a840224f2eccb6c3432dd9c3a9eb' THEN RAISE EXCEPTION 'v359 preflight: workflow 249 changed'; END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=208) IS DISTINCT FROM '7a1b85e0e7a19537d99ce753784b06d1' THEN RAISE EXCEPTION 'v359 preflight: workflow 208 changed'; END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=248) IS DISTINCT FROM '126faf27aad5040dcd64cb2d48892523' THEN RAISE EXCEPTION 'v359 preflight: workflow 248 changed'; END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=3) IS DISTINCT FROM 'ce08a74e7cca8cf06ec1f4d51b904a0e' THEN RAISE EXCEPTION 'v359 preflight: workflow 3 changed'; END IF;
  INSERT INTO public.auto_elements(name,xpath,description,category,is_builtin,staff_id,organization_id) VALUES
    ('fb_friend_request_sent_button', '//*[@role=''button'' and .=''Hủy lời mời'']', 'C# CancelRequestBtn: lời mời kết bạn đã gửi', 'facebook', true, 1, 1),
    ('fb_accept_friend_request_button', '//*[@role=''button'' and .=''Chấp nhận lời mời'']', 'C# ConfirmAddFrdBtn: chấp nhận lời mời kết bạn', 'facebook', true, 1, 1),
    ('fb_already_friend_button', '//*[@role=''button'' and .=''Bạn bè'']', 'C# IsFriendBtn: đã là bạn bè', 'facebook', true, 1, 1);
  UPDATE public.auto_blocks SET code=$friend_code$// v359: new Desktop scheduler opts in; released clients keep their live behavior.
if (vars.facebookFriendOutcomeVersion !== 1) {
try {
  const btn = await helpers.element('fb_add_friend_button')
  // waitForSelector throws khi timeout → catch ở dưới chỉ catch lỗi engine, không phải timeout
  const found = await page.waitForSelector(btn, { timeout: 5000 }).catch(() => false)
  if (!found) {
    // Không có nút "Thêm bạn bè" — tình huống bình thường:
    //   - Đã là bạn (FB hiện "Bạn bè" thay vì "Thêm bạn bè")
    //   - Đã gửi lời mời, đang chờ phản hồi (FB hiện "Đã gửi yêu cầu")
    //   - Profile khoá / FB ẩn nút (privacy settings)
    // → KHÔNG coi là lỗi, return ok: true với cờ alreadyFriend
    helpers.log('ℹ️ Không có nút Thêm bạn bè — bỏ qua (có thể đã là bạn hoặc nút bị ẩn)')
    return { ok: true, clicked: false, alreadyFriend: true }
  }
  await page.click(btn)
  await helpers.sleep(2000, signal)
  return { ok: true, clicked: true, alreadyFriend: false }
} catch (e) {
  return { ok: false, clicked: false, alreadyFriend: false, error: e.message }
}
}

const cancelled = () => ({ ok: false, clicked: false, outcome: 'cancelled' })
const exists = async xpath => await page.evaluate(`
  return !!document.evaluate(__args[0], document, null,
    XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
`, xpath)
let stage = 'inspect'
try {
  if (signal.aborted) return cancelled()
  const add = await helpers.element('fb_add_friend_button')
  // Preserve the existing maximum 5s profile readiness wait. State probes below
  // use raw XPath (no visible filtering), in AddFriendUid_Fb order.
  await page.waitForSelector(add, { timeout: 5000 }).catch(() => false)
  if (signal.aborted) return cancelled()
  const sent = await helpers.element('fb_friend_request_sent_button')
  if (await exists(sent)) return { ok: true, clicked: false, outcome: 'already_requested' }

  const accept = await helpers.element('fb_accept_friend_request_button')
  if (await exists(accept)) {
    stage = 'accept'
    if (signal.aborted) return cancelled()
    await page.click('(' + accept + ')[1]')
    await helpers.sleep(2000, signal)
    return { ok: true, clicked: true, outcome: 'accepted' }
  }

  const friend = await helpers.element('fb_already_friend_button')
  if (await exists(friend)) return { ok: true, clicked: false, alreadyFriend: true, outcome: 'already_friend' }
  if (!await exists(add)) {
    return { ok: false, clicked: false, outcome: 'unavailable',
      errorCode: 'err_fb_add_friend_unavailable', error: 'Không tìm thấy nút kết bạn' }
  }
  stage = 'send'
  if (signal.aborted) return cancelled()
  await page.click('(' + add + ')[1]')
  await helpers.sleep(2000, signal)
  return { ok: true, clicked: true, outcome: 'request_sent' }
} catch (error) {
  if (signal.aborted) return cancelled()
  const message = stage === 'accept' ? 'Không bấm được nút chấp nhận lời mời kết bạn'
    : stage === 'send' ? 'Không bấm được nút thêm bạn bè' : 'Không kiểm tra được trạng thái kết bạn'
  return { ok: false, clicked: false, outcome: 'failed', errorCode: 'err_undefined',
    error: message + (error && error.message ? ': ' + error.message : '') }
}$friend_code$,
    description='Kết bạn theo C# facebook.com: đã gửi, chấp nhận, đã là bạn, gửi mới hoặc lỗi theo policy. Runtime v359 đọc outcome; app cũ giữ nhánh tương thích.',
    output_schema='[{"name": "ok", "type": "boolean", "label": "Có lỗi nghiêm trọng không (false=lỗi, true=OK hoặc skipped)"}, {"name": "clicked", "type": "boolean", "label": "Đã click nút kết bạn chưa"}, {"name": "alreadyFriend", "type": "boolean", "label": "Đã là bạn bè (runtime v359)"}, {"name": "error", "type": "string", "label": "Lỗi (nếu có)"}, {"name": "outcome", "type": "string", "label": "Kết quả kết bạn: already_requested, accepted, already_friend, request_sent, unavailable, failed, cancelled"}, {"name": "errorCode", "type": "string", "label": "Mã policy lỗi"}]'::jsonb, updated_at=now()
  WHERE id=39 AND name='fb_add_friend';
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id=39) IS DISTINCT FROM '5c0fc74531bd5c12643cf632d06193a8' THEN
    RAISE EXCEPTION 'v359 verification: friend block checksum mismatch';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.auto_error e
      WHERE error_code IN ('err_fb_add_friend_unavailable','err_undefined')) IS DISTINCT FROM policies_before THEN
    RAISE EXCEPTION 'v359 verification: policies changed';
  END IF;
END $friend_status$;
COMMIT;
