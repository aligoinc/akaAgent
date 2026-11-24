-- rollback_v641_fb_ai_filter_blocks: trả 10 block lọc AI về code trước V641 (kiểm md5 bản V641 trước khi ghi). Mã cấu hình cũ vẫn còn nên chạy lại như trước.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $upd$
DECLARE
  v_helper_old text := $v641$// AI lọc bài / comment: thử lại rồi gọi mô hình dự phòng. Câu trả lời phải là JSON có "matched" true / false, sai khuôn cũng tính là lỗi.
// Lỗi không thử lại được (hết tiền, sai khoá, thiếu cấu hình) thì chuyển ngay sang mô hình dự phòng.
const __AI_FILTER_FALLBACK_CODE = 'fb_ai_content_filter_fallback'
const __AI_FILTER_UNAVAILABLE = 'AI lọc bài tạm thời không dùng được'
async function __aiFilterCall(usingCode, payload) {
  const readText = result => {
    const value = result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response)
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    try { return JSON.stringify(value) } catch (e) { return String(value) }
  }
  const usable = result => {
    if (!result || result.ok !== true) return false
    const text = readText(result).trim()
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const body = (fenced ? fenced[1] : text).trim()
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) return false
    try {
      const parsed = JSON.parse(body.slice(start, end + 1))
      return typeof parsed.matched === 'boolean' || typeof parsed.match === 'boolean'
    } catch (e) {
      return false
    }
  }
  const hopeless = message => /lỗi (?:400|401|402|403|404)\b|Không tìm thấy cấu hình AI|Thiếu mã cấu hình AI|no credits|insufficient|credit_balance/i.test(message)
  const abortSignal = typeof signal !== 'undefined' ? signal : undefined
  const plan = [[usingCode, 3], [__AI_FILTER_FALLBACK_CODE, 2]]
  let lastError = 'AI lỗi'
  for (const [code, tries] of plan) {
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) await helpers.sleep(attempt === 1 ? 2000 : 5000, abortSignal)
      const result = await helpers.callAIUsing(code, payload)
      if (result && result.unsupported) return result
      if (usable(result)) return result
      lastError = result && result.ok === true ? 'AI trả lời sai khuôn' : String((result && (result.error || result.message)) || 'AI lỗi')
      if (hopeless(lastError)) break
    }
  }
  return { ok: false, error: lastError }
}
$v641$;
  v_helper_engine text := replace(v_helper_old, $v641$return { ok: false, error: lastError }$v641$, $v641$throw new Error(__AI_FILTER_UNAVAILABLE + ' (' + String(lastError).slice(0, 200) + ')')$v641$);
  v_central_old text := $v641$const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await helpers.callAIUsing(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};$v641$;
  v_central_new text := $v641$const __callCentralAI = async (usingCode, payload) => {
  if (!usingCode) throw new Error('Thiếu mã cấu hình AI');
  if (typeof helpers.callAIUsing !== 'function') throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  const result = await __aiFilterCall(usingCode, payload || {});
  if (result && result.unsupported) throw new Error('Runtime chưa hỗ trợ helper callAIUsing');
  if (!result || result.ok !== true) throw new Error(String(result && result.error ? result.error : 'AI lỗi'));
  return result;
};$v641$;
  v_n integer;
BEGIN
  UPDATE public.auto_blocks SET code = replace(replace(replace(code,
    $v641$  const result = await __aiFilterCall(AI_USING_CODE, {
$v641$,
    $v641$  const result = await helpers.callAIUsing(AI_USING_CODE, {
$v641$),
    $v641$
$v641$ || v_helper_old || $v641$
async function checkMeaningAi(content) {
$v641$,
    $v641$
async function checkMeaningAi(content) {
$v641$),
    $v641$const AI_USING_CODE = 'fb_prepare_seeding_iterations_ai_filter_v2'
$v641$,
    $v641$const AI_USING_CODE = 'fb_prepare_seeding_iterations_ai_filter'
$v641$), updated_at = now()
   WHERE id = 2554 AND md5(code) = '091f57483369c8b03fea65e9eba0390c';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2554 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(replace(code,
    $v641$  const result = await __aiFilterCall(AI_USING_CODE, {
$v641$,
    $v641$  const result = await helpers.callAIUsing(AI_USING_CODE, {
$v641$),
    $v641$
$v641$ || v_helper_engine || $v641$
async function checkMeaningAi(content) {
$v641$,
    $v641$
async function checkMeaningAi(content) {
$v641$),
    $v641$const AI_USING_CODE = 'fb_prepare_seeding_iterations_ai_filter_v2'
$v641$,
    $v641$const AI_USING_CODE = 'fb_prepare_seeding_iterations_ai_filter'
$v641$), updated_at = now()
   WHERE id = 2859 AND md5(code) = '81f1dd79e70bbafcb85cf98b2d672210';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2859 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_old || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2602 AND md5(code) = '1716cf0e653949d72decaf6b7b633d15';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2602 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_engine || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_group_posts_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2863 AND md5(code) = 'c966c4608a3cbee3f524915fb4c090eb';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2863 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_old || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2603 AND md5(code) = '24c0f8b97db8a5467280603dbdc99cc9';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2603 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_engine || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_collect_group_comments_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2864 AND md5(code) = '905a88740cee819e0e34feb1351a0476';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2864 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_old || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2718 AND md5(code) = '892b788ee949373baa4ba1674d4d11c4';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2718 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_engine || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_extract_data_from_search_posts_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2904 AND md5(code) = '023c452504d3e5c40b584fbb146c26bc';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2904 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_old || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2719 AND md5(code) = '9d2678eeb3ef2ca56bf86a5f442958f0';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2719 không cập nhật được'; END IF;
  UPDATE public.auto_blocks SET code = replace(replace(code,
    v_helper_engine || v_central_new,
    v_central_old),
    $v641$const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter_v2";
$v641$,
    $v641$const __aiFindDataUsingCode = "fb_collect_search_post_comments_ai_filter";
$v641$), updated_at = now()
   WHERE id = 2905 AND md5(code) = '79ae67b90927a743a24f146f92245b42';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN RAISE EXCEPTION 'Gỡ V641: block 2905 không cập nhật được'; END IF;
END $upd$;

UPDATE public.auto_engine_block_copies SET source_md5_at_copy = '68fe2e31c508a4657e4de1470eedf01b', engine_md5_at_copy = '68fe2e31c508a4657e4de1470eedf01b'
 WHERE engine_block_id = 2859 AND source_block_id = 2554 AND source_md5_at_copy = '091f57483369c8b03fea65e9eba0390c' AND engine_md5_at_copy = '81f1dd79e70bbafcb85cf98b2d672210';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = '8bba818627fde233ec1b9421c2a7bf7d', engine_md5_at_copy = '8bba818627fde233ec1b9421c2a7bf7d'
 WHERE engine_block_id = 2863 AND source_block_id = 2602 AND source_md5_at_copy = '1716cf0e653949d72decaf6b7b633d15' AND engine_md5_at_copy = 'c966c4608a3cbee3f524915fb4c090eb';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = 'ffb7329bfa391d3e9a747c4562974cc6', engine_md5_at_copy = 'ffb7329bfa391d3e9a747c4562974cc6'
 WHERE engine_block_id = 2864 AND source_block_id = 2603 AND source_md5_at_copy = '24c0f8b97db8a5467280603dbdc99cc9' AND engine_md5_at_copy = '905a88740cee819e0e34feb1351a0476';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = 'b001a18aa3c3dbb33cf2490386f5b92f', engine_md5_at_copy = 'b001a18aa3c3dbb33cf2490386f5b92f'
 WHERE engine_block_id = 2904 AND source_block_id = 2718 AND source_md5_at_copy = '892b788ee949373baa4ba1674d4d11c4' AND engine_md5_at_copy = '023c452504d3e5c40b584fbb146c26bc';
UPDATE public.auto_engine_block_copies SET source_md5_at_copy = '6acf4fe3889a851e176aee9ceba9f5a4', engine_md5_at_copy = '6acf4fe3889a851e176aee9ceba9f5a4'
 WHERE engine_block_id = 2905 AND source_block_id = 2719 AND source_md5_at_copy = '9d2678eeb3ef2ca56bf86a5f442958f0' AND engine_md5_at_copy = '79ae67b90927a743a24f146f92245b42';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2554 AND md5(code) = '68fe2e31c508a4657e4de1470eedf01b') THEN RAISE EXCEPTION 'Gỡ V641: block 2554 không về md5 68fe2e31c508a4657e4de1470eedf01b'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2859 AND md5(code) = '68fe2e31c508a4657e4de1470eedf01b') THEN RAISE EXCEPTION 'Gỡ V641: block 2859 không về md5 68fe2e31c508a4657e4de1470eedf01b'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2602 AND md5(code) = '8bba818627fde233ec1b9421c2a7bf7d') THEN RAISE EXCEPTION 'Gỡ V641: block 2602 không về md5 8bba818627fde233ec1b9421c2a7bf7d'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2863 AND md5(code) = '8bba818627fde233ec1b9421c2a7bf7d') THEN RAISE EXCEPTION 'Gỡ V641: block 2863 không về md5 8bba818627fde233ec1b9421c2a7bf7d'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2603 AND md5(code) = 'ffb7329bfa391d3e9a747c4562974cc6') THEN RAISE EXCEPTION 'Gỡ V641: block 2603 không về md5 ffb7329bfa391d3e9a747c4562974cc6'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2864 AND md5(code) = 'ffb7329bfa391d3e9a747c4562974cc6') THEN RAISE EXCEPTION 'Gỡ V641: block 2864 không về md5 ffb7329bfa391d3e9a747c4562974cc6'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2718 AND md5(code) = 'b001a18aa3c3dbb33cf2490386f5b92f') THEN RAISE EXCEPTION 'Gỡ V641: block 2718 không về md5 b001a18aa3c3dbb33cf2490386f5b92f'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2904 AND md5(code) = 'b001a18aa3c3dbb33cf2490386f5b92f') THEN RAISE EXCEPTION 'Gỡ V641: block 2904 không về md5 b001a18aa3c3dbb33cf2490386f5b92f'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2719 AND md5(code) = '6acf4fe3889a851e176aee9ceba9f5a4') THEN RAISE EXCEPTION 'Gỡ V641: block 2719 không về md5 6acf4fe3889a851e176aee9ceba9f5a4'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = 2905 AND md5(code) = '6acf4fe3889a851e176aee9ceba9f5a4') THEN RAISE EXCEPTION 'Gỡ V641: block 2905 không về md5 6acf4fe3889a851e176aee9ceba9f5a4'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2859 AND source_block_id = 2554 AND source_md5_at_copy = '68fe2e31c508a4657e4de1470eedf01b' AND engine_md5_at_copy = '68fe2e31c508a4657e4de1470eedf01b') THEN RAISE EXCEPTION 'Gỡ V641: sổ chép block 2859 khác mong đợi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2863 AND source_block_id = 2602 AND source_md5_at_copy = '8bba818627fde233ec1b9421c2a7bf7d' AND engine_md5_at_copy = '8bba818627fde233ec1b9421c2a7bf7d') THEN RAISE EXCEPTION 'Gỡ V641: sổ chép block 2863 khác mong đợi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2864 AND source_block_id = 2603 AND source_md5_at_copy = 'ffb7329bfa391d3e9a747c4562974cc6' AND engine_md5_at_copy = 'ffb7329bfa391d3e9a747c4562974cc6') THEN RAISE EXCEPTION 'Gỡ V641: sổ chép block 2864 khác mong đợi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2904 AND source_block_id = 2718 AND source_md5_at_copy = 'b001a18aa3c3dbb33cf2490386f5b92f' AND engine_md5_at_copy = 'b001a18aa3c3dbb33cf2490386f5b92f') THEN RAISE EXCEPTION 'Gỡ V641: sổ chép block 2904 khác mong đợi'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies WHERE engine_block_id = 2905 AND source_block_id = 2719 AND source_md5_at_copy = '6acf4fe3889a851e176aee9ceba9f5a4' AND engine_md5_at_copy = '6acf4fe3889a851e176aee9ceba9f5a4') THEN RAISE EXCEPTION 'Gỡ V641: sổ chép block 2905 khác mong đợi'; END IF;
END $post$;

COMMIT;
