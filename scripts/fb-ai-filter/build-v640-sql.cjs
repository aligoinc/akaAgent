#!/usr/bin/env node
// Sinh migration V640 (chỉ dữ liệu, chưa ai dùng cho tới V641): lời dặn AI lọc bài mới, 5 mã cấu hình `<mã cũ>_v2` + 1 mã dự phòng,
// mã lỗi FB53 "AI lọc bài tạm thời không dùng được" (engine v2: tạm dừng chiến dịch, data về hàng đợi) và dấu hiệu nhận câu lỗi của block.
// Phương án: docs/FB_AI_FILTER_PLAN.md mục 1.2–1.3. Mô hình chọn theo bộ mẫu 348 bài thật (24/11/2026, docs/FB_AI_FILTER_EVAL_20261124.md):
// DeepSeek (ai_model 2) chính, gpt-6-luna (ai_model 16) dự phòng.
//   node scripts/fb-ai-filter/build-v640-sql.cjs           ghi migration + bản gỡ
//   node scripts/fb-ai-filter/build-v640-sql.cjs --check   chỉ kiểm file đang có khớp bộ sinh
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '../..')
const NUMBER = 'v640'
const NAME = 'migration_v640_fb_ai_filter_config'
const ROLLBACK_NAME = 'rollback_v640_fb_ai_filter_config'
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = text => text == null ? 'NULL' : `'${String(text).replace(/'/g, "''")}'`
const SYSTEM = fs.readFileSync(path.join(__dirname, 'prompt-v2.system.txt'), 'utf8').trim()
const USER = fs.readFileSync(path.join(__dirname, 'prompt-v2.user.txt'), 'utf8').trim()
const SIGNS = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/fb-ai-filter/error-signs-live-20261124.json'), 'utf8'))
if (md5(SIGNS.value) !== SIGNS.md5) throw new Error('Fixture dấu hiệu lệch md5')

const PROMPT = { code: 'find_data_meaning_check_v2', name: 'Lọc bài / comment Facebook theo mô tả của khách (v2)',
  description: 'V640: nhận nguyên văn mô tả ([prompt]), tự tách phần cần tìm và phần loại bỏ, trả JSON {matched, excluded, reason}. Thay prompt 6 (tách mỗi dòng thành một tính chất, khớp một là chọn).' }
const MAIN_MODEL = { id: 2, code: 'deepseek_default', model: 'deepseek-flash' }
const FALLBACK_MODEL = { id: 16, code: 'openai_luna', model: 'gpt-6-luna' }
const USINGS = [
  { code: 'fb_prepare_seeding_iterations_ai_filter_v2', name: 'Block fb_prepare_seeding_iterations - AI filter v2', description: 'Lọc bài viết trước khi comment seeding group/page/profile (lời dặn v2).' },
  { code: 'fb_extract_data_from_group_posts_ai_filter_v2', name: 'Block fb_extract_data_from_group_posts - AI filter v2', description: 'Lọc bài viết trong group khi tìm data (lời dặn v2).' },
  { code: 'fb_collect_group_comments_ai_filter_v2', name: 'Block fb_collect_group_comments - AI filter v2', description: 'Lọc comment trong group khi tìm data (lời dặn v2).' },
  { code: 'fb_extract_data_from_search_posts_ai_filter_v2', name: 'Block fb_extract_data_from_search_posts - AI filter v2', description: 'Lọc bài viết từ Facebook search khi tìm data (lời dặn v2).' },
  { code: 'fb_collect_search_post_comments_ai_filter_v2', name: 'Block fb_collect_search_post_comments - AI filter v2', description: 'Lọc comment từ Facebook search khi tìm data (lời dặn v2).' }
].map(u => ({ ...u, modelId: MAIN_MODEL.id, timeoutMs: 45000 }))
const FALLBACK = { code: 'fb_ai_content_filter_fallback', name: 'AI lọc bài / comment Facebook - mô hình dự phòng',
  description: 'Dùng chung cho 5 chỗ lọc khi mô hình chính lỗi 3 lần hoặc lỗi không thử lại được (V641).', modelId: FALLBACK_MODEL.id, timeoutMs: 60000 }

const ERROR = { code: 'err_fb_ai_filter_unavailable', pub: 'FB53', cls: 'transient', title: 'AI lọc bài tạm thời không dùng được' }
const NOTE = `${ERROR.title} (${ERROR.pub}). Bấm Tiếp tục chiến dịch sau ít phút.`
const SIGN = { code: ERROR.code, source: 'message', actions: [], phases: [], replaces: [], texts: [ERROR.title] }
const SIGNS_BEFORE = JSON.parse(SIGNS.value)
if (JSON.stringify(SIGNS_BEFORE) !== SIGNS.value) throw new Error('Dòng dấu hiệu không phải JSON gọn')
if (SIGNS_BEFORE.some(s => s.code === ERROR.code)) throw new Error('Đã có dấu hiệu FB53')
const SIGNS_AFTER = JSON.stringify([...SIGNS_BEFORE, SIGN])
const SIGNS_AFTER_MD5 = md5(SIGNS_AFTER)

const Q = `$${NUMBER}$`
for (const t of [SYSTEM, USER, SIGNS.value, SIGNS_AFTER]) if (t.includes(Q)) throw new Error(`Chứa ${Q}`)
const dq = t => `${Q}${t}${Q}`

const header = [
  `-- ${NAME}: cấu hình AI lọc bài / comment mới cho Comment seeding, Tìm data trong group, Tìm data bằng search (chỉ dữ liệu, không DDL,`,
  '-- không nạp lại schema PostgREST). Chưa ai dùng cho tới V641 (10 block gọi mã mới). Phương án: docs/FB_AI_FILTER_PLAN.md.',
  `--   * ai_prompt ${PROMPT.code}: nhận nguyên văn mô tả, tự tách phần cần tìm / loại bỏ (prompt 6 cũ giữ nguyên).`,
  `--   * 5 ai_using \`<mã cũ>_v2\` dùng ${MAIN_MODEL.model} (ai_model ${MAIN_MODEL.id}), 1 ai_using ${FALLBACK.code} dùng ${FALLBACK_MODEL.model} (ai_model ${FALLBACK_MODEL.id}).`,
  `--   * auto_error ${ERROR.code} (${ERROR.pub}) + chính sách engine: tạm dừng chiến dịch, data về hàng đợi, không ghi lịch sử, không tính lượt,`,
  '--     không cộng chuỗi data lỗi; dấu hiệu "message" ở facebook.error_signs nhận câu lỗi của block "[engine]".',
  `-- Sinh bằng scripts/fb-ai-filter/build-v640-sql.cjs, không sửa tay. Gỡ: ${ROLLBACK_NAME}.sql (gỡ V641 trước).`
].join('\n')

function migration() {
  const pre = [
    'DO $pre$',
    'BEGIN',
    "  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN",
    `    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${NUMBER}_%') THEN`,
    `      RAISE EXCEPTION 'V640: sổ migration đã có migration_${NUMBER}_%%, không chạy lại';`,
    '    END IF;',
    '  END IF;',
    `  IF EXISTS (SELECT 1 FROM public.ai_prompt WHERE code = ${lit(PROMPT.code)}) THEN RAISE EXCEPTION 'V640: đã có ai_prompt ${PROMPT.code}'; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.ai_using WHERE code IN (${[...USINGS, FALLBACK].map(u => lit(u.code)).join(', ')})) THEN RAISE EXCEPTION 'V640: đã có mã ai_using mới'; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(ERROR.code)} OR public_code = ${lit(ERROR.pub)}) THEN RAISE EXCEPTION 'V640: đã có mã lỗi ${ERROR.pub}'; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ${lit(ERROR.code)}) THEN RAISE EXCEPTION 'V640: đã có chính sách ${ERROR.pub}'; END IF;`,
    `  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = ${MAIN_MODEL.id} AND code = ${lit(MAIN_MODEL.code)} AND model = ${lit(MAIN_MODEL.model)} AND is_active AND organization_id IS NULL) THEN RAISE EXCEPTION 'V640: ai_model ${MAIN_MODEL.id} khác bản đã đọc'; END IF;`,
    `  IF NOT EXISTS (SELECT 1 FROM public.ai_model WHERE id = ${FALLBACK_MODEL.id} AND code = ${lit(FALLBACK_MODEL.code)} AND model = ${lit(FALLBACK_MODEL.model)} AND is_active AND organization_id IS NULL) THEN RAISE EXCEPTION 'V640: ai_model ${FALLBACK_MODEL.id} khác bản đã đọc'; END IF;`,
    `  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS.md5}' THEN RAISE EXCEPTION 'V640: dòng facebook.error_signs đã đổi'; END IF;`,
    'END $pre$;'
  ].join('\n')

  const inserts = [
    'DO $ins$',
    'DECLARE v_prompt bigint;',
    'BEGIN',
    '  INSERT INTO public.ai_prompt (code, name, prompt_system, prompt_user, is_reasoning, organization_id, is_system, is_active, description, request_options)',
    `  VALUES (${lit(PROMPT.code)}, ${lit(PROMPT.name)}, ${dq(SYSTEM)}, ${dq(USER)}, true, NULL, true, true, ${lit(PROMPT.description)}, '{}'::jsonb)`,
    '  RETURNING id INTO v_prompt;',
    '  INSERT INTO public.ai_using (code, name, description, prompt_id, model_id, organization_id, is_system, is_active, timeout_ms, response_parser, request_options) VALUES',
    [...USINGS, FALLBACK].map(u => `    (${lit(u.code)}, ${lit(u.name)}, ${lit(u.description)}, v_prompt, ${u.modelId}, NULL, true, true, ${u.timeoutMs}, 'auto', '{}'::jsonb)`).join(',\n') + ';',
    'END $ins$;'
  ].join('\n')

  const errorSql = [
    'INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,',
    '  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,',
    '  is_active, is_delete, public_code, error_class, customer_title, customer_help)',
    `VALUES ('engine v2', ${lit(ERROR.code)}, ${lit(ERROR.title)}, ${lit('V640 (engine v2): block lọc bài / comment bằng AI gọi mô hình chính 3 lần và mô hình dự phòng 2 lần đều lỗi.')}, NULL, NULL, '{}',`,
    `  false, false, 'fixed_minutes', '{}', '{}', true, false, ${lit(ERROR.pub)}, ${lit(ERROR.cls)}, ${lit(ERROR.title)}, NULL);`,
    '',
    'INSERT INTO public.auto_outcome_policies (error_code, action_code, campaign_action_id, detail_status_id, detail_mode, log_template, campaign_note_template,',
    '  quota_effect, target_streak_effect, streak_threshold, target_effect, remaining_steps, lock_action_codes, lock_mode, run_effect, pace_mode,',
    '  campaign_effect, account_effect, login_effect, streak_after_delivery, description, source)',
    `VALUES (${lit(ERROR.code)}, NULL, NULL, NULL, 'suppress', ${lit(ERROR.title)}, ${lit(NOTE)},`,
    "  'no_count', 'ignore', NULL, 'requeue', 'continue', ARRAY[]::text[], 'fixed_minutes', 'end_unit', 'full',",
    `  'pause', 'none', 'none', 'ignore', ${lit(`[V640] ${ERROR.pub}: AI lọc bài lỗi cả mô hình chính lẫn dự phòng; tạm dừng chiến dịch, data về hàng đợi, không ghi lịch sử, không tính lượt, không cộng chuỗi (như CFG01).`)}, 'v640');`,
    '',
    `UPDATE public.auto_system_settings SET value = ${dq(SIGNS_AFTER)}, updated_at = now()`,
    ` WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS.md5}';`
  ].join('\n')

  const checkPolicy = (action, campaignAction) => [
    `  v_p := public.aka_agent_engine_resolve_policy(${lit(ERROR.code)}, NULL, ${lit(action)}, ${lit(campaignAction)}, 'desktop', 'before_send');`,
    "  IF v_p->>'campaign_effect' IS DISTINCT FROM 'pause' OR v_p->>'target_effect' IS DISTINCT FROM 'requeue'",
    "     OR v_p->>'detail_mode' IS DISTINCT FROM 'suppress' OR v_p->>'quota_effect' IS DISTINCT FROM 'no_count'",
    "     OR v_p->>'target_streak_effect' IS DISTINCT FROM 'ignore' OR v_p->>'run_effect' IS DISTINCT FROM 'end_unit'",
    `     OR v_p->>'campaign_note_template' IS DISTINCT FROM ${lit(NOTE)} OR v_p->>'streak_threshold' IS DISTINCT FROM NULL THEN`,
    `    RAISE EXCEPTION 'V640 postflight: chính sách ${ERROR.pub} ở ${campaignAction} ra %', v_p;`,
    '  END IF;'
  ].join('\n')

  const post = [
    'DO $post$',
    'DECLARE v_p jsonb; v_n integer; v_code text;',
    'BEGIN',
    `  SELECT count(*) INTO v_n FROM public.ai_using u JOIN public.ai_prompt p ON p.id = u.prompt_id`,
    `   WHERE p.code = ${lit(PROMPT.code)} AND md5(p.prompt_user) = '${md5(USER)}' AND md5(p.prompt_system) = '${md5(SYSTEM)}' AND u.is_active AND u.is_system`,
    `     AND ((u.code IN (${USINGS.map(u => lit(u.code)).join(', ')}) AND u.model_id = ${MAIN_MODEL.id}) OR (u.code = ${lit(FALLBACK.code)} AND u.model_id = ${FALLBACK_MODEL.id}));`,
    "  IF v_n <> 6 THEN RAISE EXCEPTION 'V640 postflight: % mã ai_using mới', v_n; END IF;",
    `  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS_AFTER_MD5}' THEN RAISE EXCEPTION 'V640 postflight: dòng facebook.error_signs'; END IF;`,
    checkPolicy('fb_comment', 'facebook_comment_seeding'),
    checkPolicy('', 'facebook_find_data_group'),
    checkPolicy('', 'facebook_find_data_search'),
    `  SELECT c.error_code INTO v_code FROM public.aka_agent_engine_classify_signal('facebook', 'fb_comment', 'before_send',`,
    `    jsonb_build_object('kind', 'block', 'code', ${lit(ERROR.code)}, 'errorCode', ${lit(ERROR.code)}, 'message', ${lit(ERROR.title + ' (AI trả về lỗi 503)')})) c;`,
    `  IF v_code IS DISTINCT FROM ${lit(ERROR.code)} THEN RAISE EXCEPTION 'V640 postflight: tín hiệu ra %', v_code; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.aka_agent_engine_policy_lint WHERE subject::text LIKE '%${ERROR.code}%') THEN RAISE EXCEPTION 'V640 postflight: policy lint báo ${ERROR.code}'; END IF;`,
    'END $post$;'
  ].join('\n')
  return [header, 'BEGIN;', "SET LOCAL lock_timeout = '3s';", "SET LOCAL statement_timeout = '60s';", '', pre, '', inserts, '', errorSql, '', post, '', 'COMMIT;', ''].join('\n')
}

function rollback() {
  return [
    `-- ${ROLLBACK_NAME}: tắt cấu hình V640. Gỡ V641 trước (block đang gọi mã _v2 thì tắt mã sẽ làm block báo lỗi). Không xoá dòng (ai_log, kết quả engine`,
    '-- có thể đang trỏ tới); dấu hiệu FB53 bỏ khỏi facebook.error_signs.',
    'BEGIN;', "SET LOCAL lock_timeout = '3s';",
    'DO $pre$',
    'BEGIN',
    "  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE code LIKE '%_ai_filter_v2%') THEN RAISE EXCEPTION 'Gỡ V640: còn block gọi mã _v2, gỡ V641 trước'; END IF;",
    'END $pre$;',
    `UPDATE public.ai_using SET is_active = false, updated_at = now() WHERE code IN (${[...USINGS, FALLBACK].map(u => lit(u.code)).join(', ')});`,
    `UPDATE public.ai_prompt SET is_active = false, updated_at = now() WHERE code = ${lit(PROMPT.code)};`,
    `UPDATE public.auto_outcome_policies SET is_active = false, is_delete = true, updated_at = now() WHERE error_code = ${lit(ERROR.code)} AND source = 'v640';`,
    `UPDATE public.auto_error SET is_active = false, is_delete = true, updated_at = now() WHERE error_code = ${lit(ERROR.code)};`,
    `UPDATE public.auto_system_settings SET value = ${dq(SIGNS.value)}, updated_at = now() WHERE key = 'facebook.error_signs' AND md5(value) = '${SIGNS_AFTER_MD5}';`,
    'DO $post$',
    'BEGIN',
    `  IF (SELECT md5(value) FROM public.auto_system_settings WHERE key = 'facebook.error_signs') IS DISTINCT FROM '${SIGNS.md5}' THEN RAISE EXCEPTION 'Gỡ V640: dòng facebook.error_signs chưa về bản cũ'; END IF;`,
    'END $post$;',
    'COMMIT;', ''
  ].join('\n')
}

const OUT = {
  [path.join(ROOT, 'migrations', `${NAME}.sql`)]: migration(),
  [path.join(ROOT, 'migrations', `${ROLLBACK_NAME}.sql`)]: rollback()
}
if (require.main === module && process.argv.includes('--check')) {
  for (const [file, text] of Object.entries(OUT)) {
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) { console.error('Lệch bộ sinh:', path.relative(ROOT, file)); process.exit(1) }
  }
  console.log('V640 khớp bộ sinh')
} else if (require.main === module) {
  for (const [file, text] of Object.entries(OUT)) fs.writeFileSync(file, text)
  console.log('signs', SIGNS.md5, '->', SIGNS_AFTER_MD5, 'prompt_user', md5(USER), 'prompt_system', md5(SYSTEM))
}
module.exports = { USINGS, FALLBACK, ERROR, NOTE, SIGNS_AFTER_MD5 }
