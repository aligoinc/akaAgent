#!/usr/bin/env node
// V577: "Tìm kiếm data bằng search" của Facebook lấy thêm thông tin quản trị viên của từng group tìm được (18/11/2026, anh: "Search tìm group
// fb: thêm checkbox: lấy thông tin admin của group: link profile, tên, phone, email"). Anh chốt qua hộp chọn: chỉ quản trị viên (không lấy
// người kiểm duyệt), lấy hết quản trị viên Facebook hiện, SĐT / email lấy từ mục "Thông tin liên hệ" + tên + dòng giới thiệu dưới tên, kết quả
// chỉ để xem và xuất Excel (không đẩy sang chiến dịch khác).
//
// Chỉ workflow engine (anh chốt 17/11 "engine cũ đừng đụng vào"): workflow 319 "[engine] … Tìm kiếm data bằng search" thêm node
// collect_group_admins giữa "Tải group" và "Tổng kết", block mới "[engine] fb_collect_search_group_admins", block tổng kết 2910 cho hai trường
// admins / adminScan của từng group đi qua. Bộ cũ (workflow 239, block 2723 / 2724) không đổi: chiến dịch chạy bộ cũ thì ô chọn không có tác dụng.
// Block mới chỉ chạy khi app gửi vars.isFindFacebookGroupAdmins = true (Desktop có ô chọn); bản Desktop chưa có ô chọn chạy như trước.
//
// Xem Facebook thật 18/11 (Cốc Cốc, tài khoản thử, chỉ đọc; đoạn chạy trong trang đã chạy trên trang thật):
//   - /groups/<nhóm>/members/admins của group công khai hoặc đã tham gia liệt kê "Quản trị viên và người kiểm duyệt · N", mỗi người một
//     listitem có link /groups/<nhóm>/user/<uid>/ và dòng "Quản trị viên" / "Người kiểm duyệt";
//   - group riêng tư chưa tham gia chỉ có hàng ảnh đại diện ở trang Giới thiệu, không ghi vai trò từng người: không lấy (adminScan not_listed);
//   - trang cá nhân ?sk=directory_contact_info: vùng trước hàng tab có tên + dòng giới thiệu; mục "Thông tin liên hệ" chỉ có khi công khai.
//
// Nguồn guard: scripts/fixtures/engine-v2-facebook/v577-live-20261118.json (đọc chỉ đọc production 18/11 21:54 VN).
// Code block: scripts/facebook-search-groups/v577/{admins-block,admins-page,admin-profile-page,contact-extract}.fragment.js. Code block không ghi số
// migration (đổi số không đổi md5 code). Số chỉ thật sự giữ được khi đã có dòng trong sổ: kiểm lại sổ ngay trước khi apply.
// Chạy: node scripts/build-v577-sql.cjs (ghi migration + bản gỡ).
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const LIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v577-live-20261118.json'), 'utf8'))
// Bản code đã apply nằm ở thư mục v577 (đóng băng); bản đang dùng (selector lấy từ auto_elements, V578) ở scripts/facebook-search-groups/.
const FRAGMENTS = path.join(ROOT, 'scripts/facebook-search-groups/v577')
const read = name => fs.readFileSync(path.join(FRAGMENTS, name), 'utf8')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
/** Bỏ dòng chú thích đứng riêng (code block lưu trong DB gọn hơn; chú thích giữ ở file nguồn). */
const stripComments = text => text.split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n').replace(/\n+$/, '')

const NAME = 'migration_v577_engine_facebook_search_group_admins'
const ROLLBACK_NAME = 'rollback_v577_engine_facebook_search_group_admins'
const BLOCK_NAME = '[engine] fb_collect_search_group_admins'
const NODE_ID = 'collect_group_admins'
const VAR_NAME = 'isFindFacebookGroupAdmins'
const VAR_LABEL = 'Lấy thông tin quản trị viên của group'

// ----- Đoạn chạy trong trang -----
const EXTRACT = stripComments(read('contact-extract.fragment.js'))
const ADMINS_PAGE_SCRIPT = `${EXTRACT}\n${stripComments(read('admins-page.fragment.js'))}`
const PROFILE_PAGE_SCRIPT = `${EXTRACT}\n${stripComments(read('admin-profile-page.fragment.js'))}`
for (const [label, script] of [['admins-page', ADMINS_PAGE_SCRIPT], ['admin-profile-page', PROFILE_PAGE_SCRIPT]]) {
  // Nằm trong String.raw`…` của block: không được có dấu ` hay ${ (bị cắt / nội suy).
  if (script.includes('`') || script.includes('${')) throw new Error(`Đoạn chạy trong trang ${label} có dấu \` hoặc \${`)
  // pageController.evaluate bọc code trong (async function () { var __args = …; <code> })().
  try { new Function(`return (async function () { var __args = []; ${script}\n})`) } catch (error) { throw new Error(`Đoạn ${label} không hợp lệ: ${error.message}`) }
}

// ----- Block mới -----
const BLOCK_TEMPLATE = read('admins-block.fragment.js').replace(/\n+$/, '')
for (const token of ['__ADMINS_PAGE_SCRIPT__', '__PROFILE_PAGE_SCRIPT__']) {
  if (BLOCK_TEMPLATE.split(token).length !== 2) throw new Error(`Khuôn block phải có đúng một ${token}`)
}
const ADMINS_CODE = '\n' + BLOCK_TEMPLATE.replace('__ADMINS_PAGE_SCRIPT__', () => ADMINS_PAGE_SCRIPT).replace('__PROFILE_PAGE_SCRIPT__', () => PROFILE_PAGE_SCRIPT) + '\n'
const ADMINS_MD5 = md5(ADMINS_CODE)

// ----- Block tổng kết: cho admins / adminScan của từng group đi qua -----
const SUMMARY_OLD = LIVE.summary.code
if (md5(SUMMARY_OLD) !== LIVE.summary.md5) throw new Error('Fixture: md5 code block tổng kết không khớp')
const SUMMARY_EDIT = {
  from: "keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '').trim() }); } return Array.from(map.values()); }",
  to: "keyword: String(rawGroup.keyword || vars.findDataSearchKeyword || '').trim(), ...(typeof rawGroup.adminScan === 'string' && rawGroup.adminScan ? { adminScan: rawGroup.adminScan, admins: Array.isArray(rawGroup.admins) ? rawGroup.admins : [] } : {}) }); } return Array.from(map.values()); }"
}
if (SUMMARY_OLD.split(SUMMARY_EDIT.from).length !== 2) throw new Error('Block tổng kết: không tìm thấy đúng một chỗ dựng group')
const SUMMARY_NEW = SUMMARY_OLD.replace(SUMMARY_EDIT.from, () => SUMMARY_EDIT.to)
const SUMMARY_NEW_MD5 = md5(SUMMARY_NEW)

const TAG = '$v577_block$'
for (const [label, code] of [['block quản trị viên', ADMINS_CODE], ['block tổng kết', SUMMARY_NEW], ['block tổng kết cũ', SUMMARY_OLD]]) {
  if (code.includes(TAG)) throw new Error(`${label} chứa thẻ dollar-quote`)
  // Code block phải dựng được thành hàm async (đúng cách workflowEngine chạy block).
  try { new Function('page', 'helpers', 'vars', 'input', 'signal', `return (async () => {\n${code}\n})`) } catch (error) { throw new Error(`${label} không hợp lệ: ${error.message}`) }
}

// ----- Workflow -----
const WF = LIVE.workflow
if (md5(WF.nodesText + WF.edgesText) !== WF.md5) throw new Error('Fixture: md5 workflow không khớp nodesText / edgesText')
const OLD_EDGE = WF.edges.find(edge => edge.source === 'collect_groups' && edge.target === 'summary')
if (!OLD_EDGE || OLD_EDGE.id !== 'e-collect-groups-summary') throw new Error('Fixture: không thấy cạnh "Tải group" → "Tổng kết"')
if (WF.nodes.some(node => node.id === NODE_ID)) throw new Error('Fixture: workflow đã có node quản trị viên')
const COLLECT = WF.nodes.find(node => node.id === 'collect_groups')
const SUMMARY = WF.nodes.find(node => node.id === 'summary')
if (!COLLECT || COLLECT.blockId !== LIVE.collect.id || !SUMMARY || SUMMARY.blockId !== LIVE.summary.id) throw new Error('Fixture: node "Tải group" / "Tổng kết" khác bản đã đọc')
const NODE_POSITION = { x: Math.round((COLLECT.position.x + SUMMARY.position.x) / 2), y: COLLECT.position.y + 160 }
const NEW_EDGES = [
  { id: 'e-collect-groups-admins', source: 'collect_groups', target: NODE_ID },
  { id: 'e-group-admins-summary', source: NODE_ID, target: 'summary' }
]
if (WF.variablesSchema.some(item => item.name === VAR_NAME) || VAR_NAME in WF.defaultVariables) throw new Error('Fixture: workflow đã có biến quản trị viên')
const VAR_SCHEMA = { default: false, label: VAR_LABEL, name: VAR_NAME, type: 'boolean' }

const sqlText = value => `'${String(value).replace(/'/g, "''")}'`
const sqlJson = value => `${sqlText(JSON.stringify(value))}::jsonb`
const OUTPUT_SCHEMA = [{ label: 'Số group đã đọc', name: 'listed', type: 'number' }, { label: 'Số quản trị viên', name: 'admins', type: 'number' }]

const migration = `-- V577: "Tìm kiếm data bằng search" (Facebook) lấy thêm thông tin quản trị viên của từng group tìm được: tên, link trang cá nhân, SĐT, email.
-- Chỉ workflow engine ${WF.id}: thêm block "${BLOCK_NAME}" + node ${NODE_ID} giữa "Tải group" và "Tổng kết"; block tổng kết
-- ${LIVE.summary.id} cho admins / adminScan của từng group đi qua. Block mới chỉ chạy khi app gửi vars.${VAR_NAME} = true (Desktop có ô chọn);
-- app chưa có ô chọn chạy như trước. Bộ cũ (workflow ${LIVE.legacy.workflowId}, block tìm group / tổng kết của bộ cũ) không đổi.
-- SINH TỪ scripts/build-v577-sql.cjs (nguồn guard: scripts/fixtures/engine-v2-facebook/v577-live-20261118.json), không sửa tay.
-- Chỉ dữ liệu, không DDL (không nạp lại schema PostgREST). Desktop đọc workflow / block mỗi lượt. Block mới không phải mốc gửi nên không có dòng
-- danh mục bước (engine coi là bước đọc). Gỡ: ${ROLLBACK_NAME}.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_n integer;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v577_%') THEN
      RAISE EXCEPTION 'V577 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_workflows') IS NULL THEN RAISE EXCEPTION 'V577 cần V556–V560 (workflow engine Facebook)'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_engine_workflows WHERE purpose = 'facebook_find_data_search' AND workflow_id = ${WF.id}) THEN
    RAISE EXCEPTION 'V577: workflow engine của facebook_find_data_search không còn là ${WF.id}';
  END IF;
  SELECT count(*) INTO v_n FROM public.auto_workflows w
   WHERE w.id = ${WF.id} AND w.name = ${sqlText(WF.name)} AND md5(w.nodes::text || w.edges::text) = '${WF.md5}'
     AND md5(w.variables_schema::text || w.default_variables::text) = '${WF.varsMd5}';
  IF v_n <> 1 THEN RAISE EXCEPTION 'V577: workflow ${WF.id} khác bản đã đọc (md5 ${WF.md5}), đọc lại và sinh lại'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.summary.id} AND name = ${sqlText(LIVE.summary.name)} AND md5(code) = '${LIVE.summary.md5}') THEN
    RAISE EXCEPTION 'V577: block tổng kết ${LIVE.summary.id} khác bản đã đọc (md5 ${LIVE.summary.md5}), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.collect.id} AND name = ${sqlText(LIVE.collect.name)}) THEN
    RAISE EXCEPTION 'V577: không thấy block tải group ${LIVE.collect.id}';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)}) THEN
    RAISE EXCEPTION 'V577: đã có block "${BLOCK_NAME}" (lần chạy trước để lại?), dọn trước rồi chạy lại';
  END IF;
END $pre$;

-- 1. Block mới (chỉ đọc trang, không phải mốc gửi).
INSERT INTO public.auto_blocks (name, description, icon, category, kind, code, config_schema, output_schema, default_config, is_builtin)
VALUES (${sqlText(BLOCK_NAME)}, 'Mở trang quản trị viên của từng group vừa tìm được và trang cá nhân từng quản trị viên để lấy tên, link, SĐT, email.',
        'UserCog', 'facebook', 'js', ${TAG}${ADMINS_CODE}${TAG}, '[]'::jsonb, ${sqlJson(OUTPUT_SCHEMA)}, '{}'::jsonb, true);

-- 2. Workflow: node mới giữa "Tải group" và "Tổng kết", biến ${VAR_NAME} (mặc định tắt).
UPDATE public.auto_workflows w
   SET nodes = w.nodes || jsonb_build_array(jsonb_build_object(
         'id', ${sqlText(NODE_ID)}, 'blockId', b.id, 'blockName', 'fb_collect_search_group_admins', 'config', '{}'::jsonb,
         'label', 'Lấy quản trị viên group', 'position', ${sqlJson(NODE_POSITION)})),
       edges = (SELECT coalesce(jsonb_agg(e.value ORDER BY e.ordinality), '[]'::jsonb)
                  FROM jsonb_array_elements(w.edges) WITH ORDINALITY e WHERE e.value->>'id' <> ${sqlText(OLD_EDGE.id)})
               || ${sqlJson(NEW_EDGES)},
       variables_schema = w.variables_schema || ${sqlJson([VAR_SCHEMA])},
       default_variables = w.default_variables || ${sqlJson({ [VAR_NAME]: false })},
       updated_at = now()
  FROM public.auto_blocks b
 WHERE w.id = ${WF.id} AND b.name = ${sqlText(BLOCK_NAME)} AND md5(w.nodes::text || w.edges::text) = '${WF.md5}';

-- 3. Block tổng kết: giữ admins / adminScan của từng group.
UPDATE public.auto_blocks SET code = ${TAG}${SUMMARY_NEW}${TAG}, updated_at = now()
 WHERE id = ${LIVE.summary.id} AND md5(code) = '${LIVE.summary.md5}';

DO $post$
DECLARE v_block bigint; v_nodes jsonb; v_edges jsonb;
BEGIN
  SELECT id INTO v_block FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${ADMINS_MD5}';
  IF v_block IS NULL THEN RAISE EXCEPTION 'V577 postflight: không thấy block mới đúng code (md5 ${ADMINS_MD5})'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.summary.id} AND md5(code) = '${SUMMARY_NEW_MD5}') THEN
    RAISE EXCEPTION 'V577 postflight: block tổng kết ${LIVE.summary.id} không phải bản mới (md5 ${SUMMARY_NEW_MD5})';
  END IF;
  SELECT nodes, edges INTO v_nodes, v_edges FROM public.auto_workflows WHERE id = ${WF.id};
  IF jsonb_array_length(v_nodes) <> ${WF.nodes.length + 1} OR jsonb_array_length(v_edges) <> ${WF.edges.length + 1} THEN
    RAISE EXCEPTION 'V577 postflight: workflow ${WF.id} có % node / % cạnh, cần ${WF.nodes.length + 1} / ${WF.edges.length + 1}', jsonb_array_length(v_nodes), jsonb_array_length(v_edges);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_nodes) n WHERE n->>'id' = ${sqlText(NODE_ID)} AND (n->>'blockId')::bigint = v_block
                    AND jsonb_typeof(n->'blockId') = 'number') THEN
    RAISE EXCEPTION 'V577 postflight: node ${NODE_ID} không trỏ tới block mới';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'collect_groups' AND e->>'target' = 'summary')
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE (e->>'source' = 'collect_groups' AND e->>'target' = ${sqlText(NODE_ID)})
           OR (e->>'source' = ${sqlText(NODE_ID)} AND e->>'target' = 'summary')) <> 2
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'source' = 'collect_groups') <> 1
     OR (SELECT count(*) FROM jsonb_array_elements(v_edges) e WHERE e->>'target' = 'summary') <> 1 THEN
    RAISE EXCEPTION 'V577 postflight: cạnh quanh node ${NODE_ID} không đúng';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = ${WF.id} AND w.default_variables->${sqlText(VAR_NAME)} = 'false'::jsonb
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.variables_schema) v WHERE v->>'name' = ${sqlText(VAR_NAME)})) THEN
    RAISE EXCEPTION 'V577 postflight: workflow ${WF.id} chưa có biến ${VAR_NAME}';
  END IF;
  -- Bộ cũ không được đổi.
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows WHERE id = ${LIVE.legacy.workflowId} AND md5(nodes::text || edges::text) = '${LIVE.legacy.workflowMd5}')
     OR NOT EXISTS (SELECT 1 FROM public.auto_blocks b JOIN public.auto_engine_block_copies c ON c.source_block_id = b.id
                     WHERE c.engine_block_id = ${LIVE.summary.id} AND md5(b.code) = '${LIVE.legacy.summaryMd5}') THEN
    RAISE EXCEPTION 'V577 postflight: workflow / block bộ cũ đã đổi (V577 không được đụng bộ cũ)';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V577: workflow engine ${WF.id} về bản trước (bỏ node ${NODE_ID} và biến ${VAR_NAME}), block tổng kết ${LIVE.summary.id} về code cũ, xoá block
-- "${BLOCK_NAME}". Chỉ chạy khi workflow và hai block đang đúng bản V577 (đã ai sửa sau V577 thì dừng, không ghi đè). Bộ cũ không đổi.
-- Lượt tìm data đang chạy dở lúc gỡ: bước lấy quản trị viên của lượt đó bị bỏ, phần còn lại chạy như trước. SINH TỪ scripts/build-v577-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_block bigint;
BEGIN
  SELECT id INTO v_block FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${ADMINS_MD5}';
  IF v_block IS NULL THEN RAISE EXCEPTION 'Gỡ V577: không thấy block "${BLOCK_NAME}" đúng bản V577, không ghi đè'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.summary.id} AND md5(code) = '${SUMMARY_NEW_MD5}') THEN
    RAISE EXCEPTION 'Gỡ V577: block tổng kết ${LIVE.summary.id} không phải bản V577 (md5 ${SUMMARY_NEW_MD5}), không ghi đè';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = ${WF.id}
                    AND jsonb_array_length(w.nodes) = ${WF.nodes.length + 1} AND jsonb_array_length(w.edges) = ${WF.edges.length + 1}
                    AND EXISTS (SELECT 1 FROM jsonb_array_elements(w.nodes) n WHERE n->>'id' = ${sqlText(NODE_ID)} AND (n->>'blockId')::bigint = v_block)
                    AND (w.nodes - (jsonb_array_length(w.nodes) - 1)) = ${sqlJson(WF.nodes)}) THEN
    RAISE EXCEPTION 'Gỡ V577: workflow ${WF.id} không phải bản V577 (đã có sửa khác), không ghi đè';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_steps WHERE block_id = v_block) THEN
    RAISE EXCEPTION 'Gỡ V577: block "${BLOCK_NAME}" đã có dòng danh mục bước, gỡ dòng đó trước';
  END IF;
END $pre$;

UPDATE public.auto_workflows
   SET nodes = ${sqlJson(WF.nodes)}, edges = ${sqlJson(WF.edges)}, variables_schema = ${sqlJson(WF.variablesSchema)},
       default_variables = ${sqlJson(WF.defaultVariables)}, updated_at = now()
 WHERE id = ${WF.id};
UPDATE public.auto_blocks SET code = ${TAG}${SUMMARY_OLD}${TAG}, updated_at = now()
 WHERE id = ${LIVE.summary.id} AND md5(code) = '${SUMMARY_NEW_MD5}';
DELETE FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)} AND md5(code) = '${ADMINS_MD5}';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.auto_workflows w WHERE w.id = ${WF.id} AND md5(w.nodes::text || w.edges::text) = '${WF.md5}'
                    AND md5(w.variables_schema::text || w.default_variables::text) = '${WF.varsMd5}') THEN
    RAISE EXCEPTION 'Gỡ V577 postflight: workflow ${WF.id} chưa về bản trước V577';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_blocks WHERE id = ${LIVE.summary.id} AND md5(code) = '${LIVE.summary.md5}') THEN
    RAISE EXCEPTION 'Gỡ V577 postflight: block tổng kết ${LIVE.summary.id} chưa về code cũ';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name = ${sqlText(BLOCK_NAME)}) THEN
    RAISE EXCEPTION 'Gỡ V577 postflight: block "${BLOCK_NAME}" vẫn còn';
  END IF;
END $post$;

COMMIT;
`

module.exports = {
  NAME, ROLLBACK_NAME, BLOCK_NAME, NODE_ID, VAR_NAME, LIVE, ADMINS_CODE, ADMINS_MD5, ADMINS_PAGE_SCRIPT, PROFILE_PAGE_SCRIPT, EXTRACT,
  SUMMARY_OLD, SUMMARY_NEW, SUMMARY_NEW_MD5, NEW_EDGES, migration, rollback
}
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`V577: block mới ${ADMINS_MD5} (${ADMINS_CODE.length} ký tự), block tổng kết ${LIVE.summary.md5} → ${SUMMARY_NEW_MD5}; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
