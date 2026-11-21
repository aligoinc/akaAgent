#!/usr/bin/env node
// V616: chiến dịch đăng bài nhóm Facebook có ô "Đăng bài ẩn danh" (anh yêu cầu 21/11/2026; anh duyệt qua hộp chọn cùng ngày: 2 XPath, câu cho khách
// "Nhóm này không cho đăng bài ẩn danh", ẩn thêm Kiêm up tin + Đăng bài dạng chia sẻ, không thấy công tắc thì chỉ tạm dừng data).
//
// Xem Facebook thật 21/11 (trình duyệt app, tài khoản thử Lee Danh, chỉ mở hộp soạn bài, không gõ, không đăng):
//   - nhóm cho đăng ẩn danh (Nhóm private 1 / 2, Nhóm loại việc làm): hộp "Tạo bài viết" có công tắc <input role="switch"> với
//     aria-labelledby trỏ tới chữ "Đăng ẩn danh". Bấm công tắc thì Facebook hiện bảng giới thiệu "Bài viết ẩn danh" (nút aria-label="OK") mỗi
//     lần mở trang mới; bấm OK thì công tắc aria-checked="true", tên người đăng thành "Thành viên ẩn danh", nút Đăng vẫn khớp fb_post_button;
//   - nhóm không cho (BẤT ĐỘNG SẢN CHÍNH CHỦ TP.HCM): hộp Tạo bài viết không có công tắc, Facebook không ghi chữ nào;
//   - bật ẩn danh thì Facebook bỏ nút "Thêm nhóm" (nên form tắt "Đăng bài dạng chia sẻ").
//
// Chỉ workflow engine 321 (bộ cũ workflow 1 không đổi; chỉ tài khoản "chạy ngẫu nhiên" còn chạy bộ cũ, 21/11 có 1 tài khoản, 0 chiến dịch đăng
// nhóm). Node mới enable_anonymous (block "[engine] fb_enable_group_anonymous_post") + if_anonymous_ready chen giữa if_composer_opened (nhánh
// đúng) và sleep1 / select_group_share_targets; nhánh sai về merge_join như khi không thấy ô đăng bài. Block chỉ chạy khi app gửi
// vars.groupPostAnonymous = true (Desktop có ô chọn); app chưa có ô chọn chạy như trước.
// Không thấy công tắc: mã mới FB51 err_fb_group_anonymous_post_not_allowed: data chuyển "tạm dừng" (target_effect hold), ghi dòng lịch sử "Bỏ qua"
// như FB40, không tính lượt, không cộng chuỗi lỗi, chạy tiếp nhóm sau. Thấy công tắc mà không bật được: block ném lỗi (không bấm Đăng).
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v616-live-20261121.json (đọc chỉ đọc production 21/11 17:24 VN).
// Code block: scripts/engine-v2-facebook/v616/group-anonymous-block.fragment.js (bản đã apply, đóng băng; bản đang dùng ở thư mục cha; không ghi số migration). Số migration chỉ
// thật sự giữ được khi đã có dòng trong sổ: kiểm lại sổ ngay trước khi apply.
// Chạy: node scripts/build-v616-sql.cjs (ghi migration + bản gỡ); --check chỉ kiểm file đang có khớp bộ sinh.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v616-live-20261121.json'), 'utf8'))
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const lit = value => value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`
const sqlJson = value => `${lit(JSON.stringify(value))}::jsonb`

const NAME = 'migration_v616_engine_facebook_group_post_anonymous'
const ROLLBACK_NAME = 'rollback_v616_engine_facebook_group_post_anonymous'
const SOURCE = 'v616'
const ACTION = 'fb_post_group'
const CAMPAIGN_ACTION = 'facebook_group_post'
const BLOCK_NAME = '[engine] fb_enable_group_anonymous_post'
const VAR_NAME = 'groupPostAnonymous'
const PHASES = ['before_send', 'in_flight', 'after_send']

// Element anh duyệt 21/11 (hộp chọn "Duyệt cả 2"; chữ tiếng Anh 'Post anonymously' chưa thử được trên giao diện tiếng Anh).
const ELEMENTS = [
  { name: 'fb_group_post_anonymous_switch',
    xpath: "//*[@role='dialog']//input[@role='switch' and @aria-labelledby=//*[normalize-space(.)='Đăng ẩn danh' or normalize-space(.)='Post anonymously']/@id]",
    description: 'V616: công tắc "Đăng ẩn danh" trong hộp Tạo bài viết của nhóm (chỉ có khi nhóm cho đăng ẩn danh). Chữ tiếng Anh chưa thử.' },
  { name: 'fb_group_post_anonymous_intro_ok',
    xpath: "//*[@role='dialog'][.//input[@role='switch']]//*[@role='button' and @aria-label='OK']",
    description: 'V616: nút OK của bảng giới thiệu "Bài viết ẩn danh" hiện sau khi bấm công tắc Đăng ẩn danh (bấm OK thì công tắc mới bật).' }
]

// Mã anh duyệt 21/11 (câu "Nhóm này không cho đăng bài ẩn danh"; hành vi: data tạm dừng, không tính lượt, không cộng chuỗi, chạy tiếp).
const FB51 = { code: 'err_fb_group_anonymous_post_not_allowed', pub: 'FB51', cls: 'target_permanent', title: 'Nhóm này không cho đăng bài ẩn danh',
  scope: 'Đăng nhóm bật "Đăng bài ẩn danh": hộp Tạo bài viết đã mở nhưng không có công tắc "Đăng ẩn danh".' }
const FB40_CODE = 'err_fb_group_composer_editor_not_found'

// ----- Kiểm nguồn -----
const WF = LIVE.workflow
if (md5(WF.nodesText + WF.edgesText) !== WF.md5) throw new Error('Fixture: md5 workflow 321 không khớp nodesText / edgesText')
if (md5(WF.varsText + WF.defaultsText) !== WF.varsMd5) throw new Error('Fixture: md5 biến workflow 321 không khớp')
if (md5(LIVE.legacyWorkflow.nodesText + LIVE.legacyWorkflow.edgesText) !== LIVE.legacyWorkflow.md5) throw new Error('Fixture: md5 workflow 1 không khớp')
if (WF.id !== 321 || LIVE.engineWorkflow.workflow_id !== 321 || LIVE.engineWorkflow.purpose !== CAMPAIGN_ACTION) throw new Error('Fixture: workflow engine đăng nhóm không phải 321')
if (LIVE.legacyWorkflow.id !== 1 || LIVE.engineWorkflow.source_workflow_id !== 1) throw new Error('Fixture: workflow bộ cũ không phải 1')
if (LIVE.ifElse.id !== 2838 || LIVE.ifElse.name !== '[engine] if_else') throw new Error('Fixture: block if_else engine lệch')
if (LIVE.maxFb !== 50 || LIVE.codeTaken !== 0 || LIVE.elementsTaken.length || LIVE.blockTaken.length) throw new Error('Fixture: mã / element / block đã có')
const FB40P = LIVE.fb40Resolved
for (const ph of PHASES) {
  const p = FB40P[ph]
  if (p.detail_status_id !== 51 || p.detail_mode !== 'write' || p.quota_effect !== 'no_count' || p.target_streak_effect !== 'ignore'
    || p.pace_mode !== 'full' || p.run_effect !== 'continue' || p.campaign_effect !== 'none') throw new Error(`Fixture: chính sách FB40 (${ph}) khác bản đọc 21/11`)
}
const NODES = JSON.parse(WF.nodesText)
const EDGES = JSON.parse(WF.edgesText)
const VARS = JSON.parse(WF.varsText)
const DEFAULTS = JSON.parse(WF.defaultsText)
const byId = id => NODES.find(n => n.id === id)
const IF_OPENED = byId('if_composer_opened')
if (!IF_OPENED || IF_OPENED.blockId !== 2838 || IF_OPENED.config?.condition !== 'input.opened === true') throw new Error('Fixture: node if_composer_opened lệch')
for (const id of ['sleep1', 'select_group_share_targets', 'merge_join']) if (!byId(id)) throw new Error(`Fixture: thiếu node ${id}`)
for (const id of ['enable_anonymous', 'if_anonymous_ready']) if (byId(id)) throw new Error(`Fixture: đã có node ${id}`)
const OLD_EDGE_IDS = ['e-if_composer_opened-sleep1-true', 'e-if_composer_opened-select_group_share_targets-true']
const outOfOpened = EDGES.filter(e => e.source === 'if_composer_opened')
const expectOut = [
  { id: OLD_EDGE_IDS[0], source: 'if_composer_opened', target: 'sleep1', sourceHandle: 'true' },
  { id: OLD_EDGE_IDS[1], source: 'if_composer_opened', target: 'select_group_share_targets', sourceHandle: 'true' },
  { id: 'e-if_composer_opened-merge_join-false', source: 'if_composer_opened', target: 'merge_join', sourceHandle: 'false' }
]
const norm = list => JSON.stringify(list.map(e => JSON.stringify(Object.keys(e).sort().reduce((o, k) => (o[k] = e[k], o), {}))).sort())
if (norm(outOfOpened) !== norm(expectOut)) throw new Error('Fixture: cạnh ra từ if_composer_opened khác bản đã đọc')
if (VARS.some(v => v.name === VAR_NAME) || VAR_NAME in DEFAULTS) throw new Error('Fixture: workflow đã có biến groupPostAnonymous')

// ----- Block mới -----
const BLOCK_CODE = '\n' + fs.readFileSync(path.join(ROOT, 'scripts/engine-v2-facebook/v616/group-anonymous-block.fragment.js'), 'utf8').replace(/\n+$/, '') + '\n'
const BLOCK_MD5 = md5(BLOCK_CODE)
const TAG = '$v616_block$'
if (BLOCK_CODE.includes(TAG)) throw new Error('Code block chứa thẻ dollar-quote')
try { new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${BLOCK_CODE}\n})`) } catch (error) {
  throw new Error(`Code block không hợp lệ: ${error.message}`)
}
for (const e of ELEMENTS) if (!BLOCK_CODE.includes(`helpers.element('${e.name}')`)) throw new Error(`Block không dùng element ${e.name}`)
if (!BLOCK_CODE.includes(`'${FB51.code}'`) || !BLOCK_CODE.includes(`'${FB51.title}'`)) throw new Error('Block không trả đúng mã / câu FB51')
const OUTPUT_SCHEMA = [{ label: 'Sẵn sàng đăng ẩn danh', name: 'anonymousReady', type: 'boolean' }]

// ----- Workflow -----
const NEW_NODES = [
  { id: 'enable_anonymous', label: 'Bật đăng ẩn danh', config: { screenshotCaptureOn: 'failure', screenshotCaptureTiming: 'after' },
    blockName: 'fb_enable_group_anonymous_post', position: { x: 540, y: 330 } },
  { id: 'if_anonymous_ready', label: 'Đã bật ẩn danh?', config: { condition: 'input.anonymousReady !== false' }, blockId: 2838,
    position: { x: 540, y: 420 }, blockName: 'if_else', systemType: 'ifElse' }
]
const NEW_EDGES = [
  { id: 'e-if_composer_opened-enable_anonymous-true', source: 'if_composer_opened', target: 'enable_anonymous', sourceHandle: 'true' },
  { id: 'e-enable_anonymous-if_anonymous_ready', source: 'enable_anonymous', target: 'if_anonymous_ready' },
  { id: 'e-if_anonymous_ready-sleep1-true', source: 'if_anonymous_ready', target: 'sleep1', sourceHandle: 'true' },
  { id: 'e-if_anonymous_ready-select_group_share_targets-true', source: 'if_anonymous_ready', target: 'select_group_share_targets', sourceHandle: 'true' },
  { id: 'e-if_anonymous_ready-merge_join-false', source: 'if_anonymous_ready', target: 'merge_join', sourceHandle: 'false' }
]
const VAR_SCHEMA = { default: false, label: 'Đăng bài ẩn danh', name: VAR_NAME, type: 'boolean' }

// ----- Mã + chính sách -----
const POLICY = {
  error_code: FB51.code, action_code: ACTION, campaign_action_id: null, detail_status_id: 51, detail_mode: 'write', log_template: FB51.title,
  campaign_note_template: null, quota_effect: 'no_count', target_streak_effect: 'ignore', streak_threshold: null, target_effect: 'hold',
  remaining_steps: 'skip', lock_action_codes: [], lock_mode: 'fixed_minutes', run_effect: 'continue', pace_mode: 'full', campaign_effect: 'none',
  account_effect: 'none', login_effect: 'none', source: SOURCE,
  description: '[anh chốt 21/11/2026] FB51 đăng nhóm ẩn danh: nhóm không có công tắc "Đăng ẩn danh"; data chuyển tạm dừng, ghi dòng "Bỏ qua" như FB40, không tính lượt, không cộng chuỗi, chạy tiếp nhóm sau.'
}
const POLICY_COLUMNS = Object.keys(POLICY)
const policyValues = POLICY_COLUMNS.map(col => {
  const v = POLICY[col]
  if (v === undefined || v === null) return 'NULL'
  if (Array.isArray(v)) return v.length ? `ARRAY[${v.map(lit).join(', ')}]::text[]` : `ARRAY[]::text[]`
  return typeof v === 'number' ? String(v) : lit(v)
}).join(', ')
const EXPECT = { target_effect: 'hold', target_streak_effect: 'ignore', campaign_effect: 'none', quota_effect: 'no_count', detail_status_id: '51',
  detail_mode: 'write', run_effect: 'continue', remaining_steps: 'skip', log_template: FB51.title, pace_mode: 'full', streak_threshold: null,
  error_class: FB51.cls }
const resolveSql = phase =>
  `public.aka_agent_engine_resolve_policy(${lit(FB51.code)}, NULL, ${lit(ACTION)}, ${lit(CAMPAIGN_ACTION)}, 'desktop', ${lit(phase)}) - 'policy_ids' - 'revisions'`
const policyChecks = PHASES.map(phase => `
  v_p := ${resolveSql(phase)};
  IF ${Object.entries(EXPECT).map(([k, v]) => `v_p->>${lit(k)} IS DISTINCT FROM ${v === null ? 'NULL' : lit(v)}`).join('\n     OR ')} THEN
    RAISE EXCEPTION 'V616 postflight: chính sách FB51 (%) ra %', ${lit(phase)}, v_p;
  END IF;`).join('')
// Tín hiệu đúng dạng Desktop gửi khi block trả actionResult có mã (mã có sẵn trong tín hiệu thắng mọi luật).
const SIGNAL = { kind: 'block', code: FB51.code, errorCode: FB51.code, message: FB51.title }

const elementValues = ELEMENTS.map(e => `  (${lit(e.name)}, ${lit(e.xpath)}, ${lit(e.description)}, 'facebook', true, NULL, NULL)`).join(',\n')
const elementNames = ELEMENTS.map(e => lit(e.name)).join(', ')

// Riêng phần mã + chính sách (đúng câu trong migration), cho DB thử của bộ kiểm Desktop (desktop-fb-smoke.cjs).
const CODES_POLICIES_SQL = `INSERT INTO public.auto_error (error_type, error_code, error_name, error_desc, noti_running_process, noti_campaign,
  disable_action_codes, counts_toward_limit, counts_toward_bad_target, disable_action_mode, zalo_error_codes, zalo_action_codes,
  is_active, is_delete, public_code, error_class, customer_title, customer_help)
VALUES ('engine v2', ${lit(FB51.code)}, ${lit(FB51.title)}, ${lit(`V616 (engine v2): ${FB51.scope}`)}, NULL, NULL, '{}', false, false, 'fixed_minutes',
  '{}', '{}', true, false, ${lit(FB51.pub)}, ${lit(FB51.cls)}, ${lit(FB51.title)}, NULL);

INSERT INTO public.auto_outcome_policies (${POLICY_COLUMNS.join(', ')}) VALUES
  (${policyValues});
`

const migration = `-- V616: đăng bài nhóm Facebook ẩn danh (anh chốt 21/11/2026). Chỉ workflow engine ${WF.id}: block mới "${BLOCK_NAME}" + node enable_anonymous /
-- if_anonymous_ready sau khi hộp Tạo bài viết mở; 2 element công tắc "Đăng ẩn danh" / nút OK; mã ${FB51.pub} ${FB51.code} "${FB51.title}"
-- (data tạm dừng, dòng lịch sử "Bỏ qua", không tính lượt, không cộng chuỗi, chạy tiếp). Block chỉ chạy khi app gửi vars.${VAR_NAME} = true.
-- Bộ cũ (workflow ${LIVE.legacyWorkflow.id}) không đổi. SINH TỪ scripts/build-v616-sql.cjs (nguồn guard v616-live-20261121.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc workflow / block mỗi lượt, tự nạp lại element khi gặp tên mới.
-- Block mới không phải mốc gửi nên không có dòng danh mục bước. Gỡ: ${ROLLBACK_NAME}.sql.
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
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_workflows WHERE purpose = ${lit(CAMPAIGN_ACTION)} AND workflow_id = ${WF.id}) THEN
    RAISE EXCEPTION 'V616: workflow engine của ${CAMPAIGN_ACTION} không còn là ${WF.id}';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_workflows w
   WHERE w.id = ${WF.id} AND w.name = ${lit(WF.name)} AND md5(w.nodes::text || w.edges::text) = '${WF.md5}'
     AND md5(w.variables_schema::text || w.default_variables::text) = '${WF.varsMd5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V616: workflow ${WF.id} khác bản đã đọc (md5 ${WF.md5}), đọc lại và sinh lại'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.ifElse.id} AND name = ${lit(LIVE.ifElse.name)}) THEN
    RAISE EXCEPTION 'V616: không thấy block ${LIVE.ifElse.name} (${LIVE.ifElse.id})';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${lit(BLOCK_NAME)}) THEN
    RAISE EXCEPTION 'V616: đã có block "${BLOCK_NAME}", dọn trước rồi chạy lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'V616: đã có element công tắc / nút OK đăng ẩn danh';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE error_code = ${lit(FB51.code)} OR public_code = ${lit(FB51.pub)}) THEN
    RAISE EXCEPTION 'V616: mã ${FB51.code} / ${FB51.pub} đã có';
  END IF;
  IF (SELECT max(substring(public_code from 3)::int) FROM public.auto_error WHERE public_code ~ '^FB[0-9]+$') IS DISTINCT FROM ${LIVE.maxFb} THEN
    RAISE EXCEPTION 'V616: mã FB lớn nhất không còn là FB${LIVE.maxFb}, đọc lại và sinh lại';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE error_code = ${lit(FB51.code)}) THEN
    RAISE EXCEPTION 'V616: đã có chính sách cho ${FB51.code}';
  END IF;
END $pre$;

-- 1. Element (sửa ở màn Element khi Facebook đổi giao diện).
INSERT INTO public.auto_elements (name, xpath, description, category, is_builtin, staff_id, organization_id) VALUES
${elementValues};

-- 2. Block mới (chỉ bật công tắc trong hộp đang mở, không phải mốc gửi).
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES (${lit(BLOCK_NAME)}, 'Bật công tắc "Đăng ẩn danh" trong hộp Tạo bài viết của nhóm (bấm OK ở bảng giới thiệu). Không thấy công tắc thì trả FB51.',
        'EyeOff', 'facebook', 'js', ${TAG}${BLOCK_CODE}${TAG}, '[]'::jsonb, ${sqlJson(OUTPUT_SCHEMA)}, '{}'::jsonb, true);

-- 3. Workflow ${WF.id}: if_composer_opened (đúng) → enable_anonymous → if_anonymous_ready → sleep1 + select_group_share_targets; sai → merge_join.
UPDATE public.auto_workflows w
   SET nodes = w.nodes || jsonb_build_array(
         ${sqlJson(NEW_NODES[0])} || jsonb_build_object('blockId', b.id),
         ${sqlJson(NEW_NODES[1])}),
       edges = (SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality), '[]'::jsonb)
                  FROM jsonb_array_elements(w.edges) WITH ORDINALITY e WHERE e.value->>'id' NOT IN (${OLD_EDGE_IDS.map(lit).join(', ')}))
               || ${sqlJson(NEW_EDGES)},
       variables_schema = w.variables_schema || ${sqlJson([VAR_SCHEMA])},
       default_variables = w.default_variables || ${sqlJson({ [VAR_NAME]: false })},
       updated_at = now()
  FROM public.auto_blocks b
 WHERE w.id = ${WF.id} AND b.name = ${lit(BLOCK_NAME)} AND md5(w.nodes::text || w.edges::text) = '${WF.md5}';

-- 4. Mã ${FB51.pub} + chính sách ở đăng nhóm.
${CODES_POLICIES_SQL}
DO $post$
DECLARE v_block bigint; v_nodes jsonb; v_edges jsonb; v_p jsonb; v_text text;
BEGIN
  SELECT id INTO v_block FROM public.auto_blocks WHERE name = ${lit(BLOCK_NAME)} AND md5(code) = '${BLOCK_MD5}';
  IF v_block IS NULL THEN RAISE EXCEPTION 'V616 postflight: không thấy block mới đúng code (md5 ${BLOCK_MD5})'; END IF;
  SELECT nodes, edges INTO v_nodes, v_edges FROM public.auto_workflows WHERE id = ${WF.id};
  IF jsonb_array_length(v_nodes) <> ${NODES.length + 2} OR jsonb_array_length(v_edges) <> ${EDGES.length + 3} THEN
    RAISE EXCEPTION 'V616 postflight: workflow ${WF.id} có % node / % cạnh, cần ${NODES.length + 2} / ${EDGES.length + 3}', jsonb_array_length(v_nodes), jsonb_array_length(v_edges);
  END IF;
  IF (v_nodes - (jsonb_array_length(v_nodes) - 1) - (jsonb_array_length(v_nodes) - 2)) IS DISTINCT FROM ${lit(WF.nodesText)}::jsonb THEN
    RAISE EXCEPTION 'V616 postflight: các node cũ của workflow ${WF.id} đã đổi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_nodes) n WHERE n->>'id' = 'enable_anonymous' AND jsonb_typeof(n->'blockId') = 'number'
                    AND (n->>'blockId')::bigint = v_block) THEN
    RAISE EXCEPTION 'V616 postflight: node enable_anonymous không trỏ tới block mới';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_edges) e WHERE e->>'id' IN (${OLD_EDGE_IDS.map(lit).join(', ')}))
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'if_composer_opened') <> 2
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'target' IN ('sleep1', 'select_group_share_targets')
           AND e->>'source' <> 'if_anonymous_ready') <> 0
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'if_anonymous_ready') <> 3 THEN
    RAISE EXCEPTION 'V616 postflight: cạnh quanh node đăng ẩn danh không đúng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = ${WF.id} AND w.default_variables->${lit(VAR_NAME)} = 'false'::jsonb
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.variables_schema) v WHERE v->>'name' = ${lit(VAR_NAME)})) THEN
    RAISE EXCEPTION 'V616 postflight: workflow ${WF.id} chưa có biến ${VAR_NAME}';
  END IF;
  IF (SELECT count(*) FROM public.auto_elements WHERE name IN (${elementNames})) <> ${ELEMENTS.length} THEN
    RAISE EXCEPTION 'V616 postflight: thiếu element';
  END IF;
${policyChecks}
  SELECT c.error_code INTO v_text FROM public.aka_agent_engine_classify_signal('facebook', ${lit(ACTION)}, 'before_send', ${lit(JSON.stringify(SIGNAL))}::jsonb) c;
  IF v_text IS DISTINCT FROM ${lit(FB51.code)} THEN RAISE EXCEPTION 'V616 postflight: tín hiệu FB51 ra %', v_text; END IF;
  -- Bộ cũ không được đổi.
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows WHERE id = ${LIVE.legacyWorkflow.id} AND md5(nodes::text || edges::text) = '${LIVE.legacyWorkflow.md5}') THEN
    RAISE EXCEPTION 'V616 postflight: workflow bộ cũ ${LIVE.legacyWorkflow.id} đã đổi';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V616: workflow engine ${WF.id} về bản trước (bỏ node enable_anonymous / if_anonymous_ready và biến ${VAR_NAME}), xoá block
-- "${BLOCK_NAME}" và 2 element đăng ẩn danh; mã ${FB51.pub} và chính sách chỉ bị tắt (dòng lịch sử cũ có thể đã ghi mã). Chỉ chạy khi workflow
-- và block đang đúng bản V616 (đã ai sửa sau V616 thì dừng, không ghi đè). Gỡ rồi thì chiến dịch bật "Đăng bài ẩn danh" đăng bằng tên thật:
-- tắt ô chọn ở các chiến dịch đó trước. SINH TỪ scripts/build-v616-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_block bigint;
BEGIN
  SELECT id INTO v_block FROM public.auto_blocks WHERE name = ${lit(BLOCK_NAME)} AND md5(code) = '${BLOCK_MD5}';
  IF v_block IS NULL THEN RAISE EXCEPTION 'Gỡ V616: không thấy block "${BLOCK_NAME}" đúng bản V616, không ghi đè'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = ${WF.id}
                    AND jsonb_array_length(w.nodes) = ${NODES.length + 2} AND jsonb_array_length(w.edges) = ${EDGES.length + 3}
                    AND (w.nodes - (jsonb_array_length(w.nodes) - 1) - (jsonb_array_length(w.nodes) - 2)) = ${lit(WF.nodesText)}::jsonb) THEN
    RAISE EXCEPTION 'Gỡ V616: workflow ${WF.id} không phải bản V616 (đã có sửa khác), không ghi đè';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = v_block) THEN
    RAISE EXCEPTION 'Gỡ V616: block "${BLOCK_NAME}" đã có dòng danh mục bước, gỡ dòng đó trước';
  END IF;
END $pre$;

UPDATE public.auto_workflows
   SET nodes = ${lit(WF.nodesText)}::jsonb, edges = ${lit(WF.edgesText)}::jsonb, variables_schema = ${lit(WF.varsText)}::jsonb,
       default_variables = ${lit(WF.defaultsText)}::jsonb, updated_at = now()
 WHERE id = ${WF.id};
DELETE FROM public.auto_blocks WHERE name = ${lit(BLOCK_NAME)} AND md5(code) = '${BLOCK_MD5}';
DELETE FROM public.auto_elements WHERE name IN (${elementNames});
UPDATE public.auto_outcome_policies SET is_active = false, updated_at = now() WHERE error_code = ${lit(FB51.code)} AND source = ${lit(SOURCE)};
UPDATE public.auto_error SET is_active = false, updated_at = now() WHERE error_code = ${lit(FB51.code)};

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = ${WF.id} AND md5(w.nodes::text || w.edges::text) = '${WF.md5}'
                    AND md5(w.variables_schema::text || w.default_variables::text) = '${WF.varsMd5}') THEN
    RAISE EXCEPTION 'Gỡ V616 postflight: workflow ${WF.id} chưa về bản trước V616';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${lit(BLOCK_NAME)}) OR EXISTS (SELECT 1 FROM public.auto_elements WHERE name IN (${elementNames})) THEN
    RAISE EXCEPTION 'Gỡ V616 postflight: block / element vẫn còn';
  END IF;
END $post$;

COMMIT;
`

module.exports = {
  NAME, ROLLBACK_NAME, BLOCK_NAME, VAR_NAME, LIVE, ELEMENTS, FB51, FB40_CODE, POLICY, EXPECT, PHASES, ACTION, CAMPAIGN_ACTION,
  BLOCK_CODE, BLOCK_MD5, NODES, EDGES, NEW_NODES, NEW_EDGES, OLD_EDGE_IDS, CODES_POLICIES_SQL, migration, rollback
}
if (require.main === module) {
  const files = [[`migrations/${NAME}.sql`, migration], [`migrations/${ROLLBACK_NAME}.sql`, rollback]]
  if (process.argv.includes('--check')) {
    for (const [file, text] of files) {
      if (fs.readFileSync(path.join(ROOT, file), 'utf8') !== text) { console.error(`${file} khác bản sinh`); process.exit(1) }
    }
    console.log('V616: file khớp bộ sinh')
  } else {
    for (const [file, text] of files) fs.writeFileSync(path.join(ROOT, file), text)
  }
  console.log(`V616: block ${BLOCK_MD5} (${BLOCK_CODE.length} ký tự); migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
