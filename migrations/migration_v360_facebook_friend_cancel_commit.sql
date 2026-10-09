-- v360: preserve a completed Facebook friend click when its trailing delay is cancelled.
-- Source: live akachat block 39 captured in facebook-friend-cancellation-live.json.
-- Data only. Keeps the legacy branch, selectors, workflows and policies unchanged.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $friend_cancel$
DECLARE
  policies_before jsonb;
BEGIN
  SELECT jsonb_agg(to_jsonb(e) ORDER BY id) INTO policies_before
  FROM public.auto_error e WHERE error_code IN ('err_fb_add_friend_unavailable','err_undefined');
  PERFORM 1 FROM public.auto_blocks WHERE id=39 AND name='fb_add_friend' FOR UPDATE;
  IF (SELECT md5(to_jsonb(b)::text) FROM public.auto_blocks b WHERE id=39 AND name='fb_add_friend')
    IS DISTINCT FROM '80a5c705172c9dc509f59f65fba595d3' THEN
    RAISE EXCEPTION 'v360 preflight: fb_add_friend changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE id=12) IS DISTINCT FROM '6e03d6a844cd2948a31028e2da8785ea' THEN
    RAISE EXCEPTION 'v360 preflight: auto_elements 12 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE id=1781) IS DISTINCT FROM '8fdb75886f27c34bfe696773e46ee9b9' THEN
    RAISE EXCEPTION 'v360 preflight: auto_elements 1781 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE id=1782) IS DISTINCT FROM 'b78691f0436c1975674741e67aa9ceee' THEN
    RAISE EXCEPTION 'v360 preflight: auto_elements 1782 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(e)::text) FROM public.auto_elements e WHERE id=1783) IS DISTINCT FROM '38f902dfffc14436d1ab5df3bc9793fc' THEN
    RAISE EXCEPTION 'v360 preflight: auto_elements 1783 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=3) IS DISTINCT FROM 'ce08a74e7cca8cf06ec1f4d51b904a0e' THEN
    RAISE EXCEPTION 'v360 preflight: auto_workflows 3 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=208) IS DISTINCT FROM '7a1b85e0e7a19537d99ce753784b06d1' THEN
    RAISE EXCEPTION 'v360 preflight: auto_workflows 208 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=248) IS DISTINCT FROM '126faf27aad5040dcd64cb2d48892523' THEN
    RAISE EXCEPTION 'v360 preflight: auto_workflows 248 changed; recapture live source';
  END IF;
  IF (SELECT md5(to_jsonb(w)::text) FROM public.auto_workflows w WHERE id=249) IS DISTINCT FROM '48a1a840224f2eccb6c3432dd9c3a9eb' THEN
    RAISE EXCEPTION 'v360 preflight: auto_workflows 249 changed; recapture live source';
  END IF;
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
let committedOutcome = null
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
    committedOutcome = 'accepted'
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
  committedOutcome = 'request_sent'
  await helpers.sleep(2000, signal)
  return { ok: true, clicked: true, outcome: 'request_sent' }
} catch (error) {
  // Cancellation after a completed click only interrupts the trailing delay.
  if (committedOutcome && signal.aborted) return { ok: true, clicked: true, outcome: committedOutcome }
  if (signal.aborted) return cancelled()
  const message = stage === 'accept' ? 'Không bấm được nút chấp nhận lời mời kết bạn'
    : stage === 'send' ? 'Không bấm được nút thêm bạn bè' : 'Không kiểm tra được trạng thái kết bạn'
  return { ok: false, clicked: false, outcome: 'failed', errorCode: 'err_undefined',
    error: message + (error && error.message ? ': ' + error.message : '') }
}$friend_code$, updated_at=now()
  WHERE id=39 AND name='fb_add_friend';
  IF (SELECT md5(code) FROM public.auto_blocks WHERE id=39) IS DISTINCT FROM 'e8712f551ee23df11353fca29c15525a' THEN
    RAISE EXCEPTION 'v360 verification: friend block checksum mismatch';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.auto_error e
      WHERE error_code IN ('err_fb_add_friend_unavailable','err_undefined')) IS DISTINCT FROM policies_before THEN
    RAISE EXCEPTION 'v360 verification: policies changed';
  END IF;
END $friend_cancel$;
COMMIT;
