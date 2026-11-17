#!/usr/bin/env node
// Sinh V560: chép workflow / block Facebook sang bản riêng cho engine v2 (anh chốt Q7, 16/11/2026: chép hết block / workflow FB đang dùng,
// bỏ cái không còn dùng; Q9: chép một lần cho cả 13 loại). CHỈ DỮ LIỆU; bộ cũ không nạp bản "[engine]" nên không đổi.
//
// Nguồn: đồ thị workflow production đọc chỉ đọc (scripts/engine-v2-facebook/read-workflows.cjs → scripts/fixtures/engine-v2-facebook/
// workflows-live-*.json): 13 workflow của 13 loại chiến dịch FB (auto_campaign_actions.workflow_id) + fb_campaign_rest_browse, 84 block.
// Code block không nằm trong migration: chép ngay trong DB (INSERT … SELECT), preflight kiểm md5 code / đồ thị đúng bản đã đọc.
//
//   * 84 block "[engine] <tên>" (giữ nguyên code, cấu hình) + sổ cặp auto_engine_block_copies (md5 lúc chép).
//   * 14 workflow "[engine] <tên>": node giữ id, tên block (bộ dựng lịch sử của bộ cũ nhận mốc theo tên), blockId trỏ sang bản engine;
//     auto_engine_workflows (purpose = loại chiến dịch / rest_browse, md5 hai bản lúc chép).
//   * Danh mục bước auto_engine_block_steps cho bản engine (phương án mục 3.5): mức 2 chỉ ở block mà cú gửi cuối đi qua PageController
//     (đọc code production 16/11: 30 click fb_post_button, 37 click fb_reels_publish_button, 34 / 2616 / 2710 / 38 press Enter); block bấm
//     trong page.evaluate hoặc có nhiều cú bấm có thể đăng (36 "Chia sẻ ngay") để mức 1 (ghi dấu đầu block, không bao giờ gửi lại).
//     reviewed_code_md5 = md5 code lúc chép: sửa block bản engine mà chưa duyệt lại danh mục thì engine tự lùi về mức 1.
// Gỡ: rollback_v560_engine_facebook_copies.sql xoá sổ + danh mục (engine FB lùi về bộ cũ); KHÔNG xoá workflow / block "[engine]" vì
// auto_runs.workflow_id có khoá ngoại tới auto_workflows (bảng lớn): để nguyên, bộ cũ không nạp.
// Chạy: node scripts/build-v560-sql.cjs [workflows.json]
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SNAPSHOT_FILE = path.resolve(process.argv[2] || path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/workflows-live-20261116.json'))
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const PREFIX = '[engine] '

// [block nguồn, loại chiến dịch (NULL = mọi workflow), loại bước, thao tác, mức, cú gửi, ghi chú]
const STEPS = [
  [27, null, 'result', null, 1, [], 'Mở hộp đăng bài: block trả FB35 / FB40 khi không mở được (not_committed).'],
  [30, 'facebook_group_post', 'delivery', 'fb_post_group', 2, ['click:fb_post_button'], 'Bấm Đăng (cú gửi cuối: click fb_post_button).'],
  [30, 'facebook_timeline_post', 'delivery', 'fb_post_my_profile', 2, ['click:fb_post_button'], 'Bấm Đăng (cú gửi cuối: click fb_post_button).'],
  [2624, null, 'result', null, 1, [], 'Chờ form đăng bài đóng sau cú bấm Đăng.'],
  [2836, null, 'delivery', 'fb_post_group', 1, [], 'Chia sẻ nguyên bài vào nhóm: bấm trong page.evaluate.'],
  [34, null, 'delivery', 'fb_comment', 2, ['press:Enter'], 'Comment theo vị trí: gửi bằng Enter.'],
  [2074, null, 'delivery', 'fb_like_post', 1, [], 'Thích bài: bấm trong page.evaluate; bấm lại là bỏ thích.'],
  [2616, null, 'delivery', 'fb_comment', 2, ['press:Enter'], 'Comment bài hiện tại (V472): gửi bằng Enter.'],
  [2615, null, 'delivery', 'fb_like_post', 1, [], 'Thích bài hiện tại: bấm trong page.evaluate.'],
  [2793, null, 'idempotent', 'fb_join_group', 1, [], 'Tham gia nhóm: làm lại vô hại.'],
  [33, null, 'idempotent', 'fb_join_group', 1, [], 'Tự tham gia nhóm khi chưa là thành viên.'],
  [32, null, 'idempotent', null, 1, [], 'Rời nhóm khi đang chờ duyệt (không tính lượt).'],
  [37, null, 'delivery', 'fb_post_my_profile', 2, ['click:fb_reels_publish_button'], 'Đăng reels (cú gửi cuối: click fb_reels_publish_button).'],
  [36, null, 'delivery', 'fb_post_my_profile', 1, [], 'Chia sẻ bài lên trang cá nhân: "Chia sẻ ngay" có thể đăng luôn nên mức 1.'],
  [38, 'facebook_message_friend', 'delivery', 'fb_message_friend', 2, ['press:Enter'], 'Gửi tin nhắn bạn bè: gửi bằng Enter.'],
  [38, 'facebook_message_uid', 'delivery', 'fb_message_stranger', 2, ['press:Enter'], 'Gửi tin nhắn theo UID: gửi bằng Enter.'],
  [39, null, 'delivery', 'fb_add_friend', 1, [], 'Kết bạn: nhiều nhánh bấm (thêm bạn / chấp nhận) nên mức 1.'],
  [2669, null, 'delivery', 'fb_post_page', 1, [], 'Đăng Page qua Graph API.'],
  [2672, null, 'delivery', 'fb_post_page', 1, [], 'Đăng Page bằng giao diện: bấm trong page.evaluate.'],
  [2679, null, 'delivery', 'fb_message_page_inbox_customer', 1, [], 'Gửi tin hộp thư Page: bấm trong page.evaluate.'],
  [2705, null, 'delivery', 'fb_like_post', 1, [], 'Newsfeed: thích (page.evaluate).'],
  [2710, null, 'delivery', 'fb_comment', 2, ['press:Enter'], 'Newsfeed: gửi comment bằng Enter.'],
  [2819, null, 'delivery', 'fb_group_invite', 1, [], 'Mời bạn vào nhóm theo lô (page.evaluate).'],
  [2671, null, 'session', null, 1, [], 'Đổi danh tính Page (phải khôi phục, phương án mục 7.6).']
]

function build(snapshot, { name = 'v560' } = {}) {
  const workflows = snapshot.workflows
  const blocks = snapshot.blocks
  if (snapshot.missingBlocks?.length) throw new Error(`Workflow nguồn trỏ tới block không có: ${snapshot.missingBlocks.join(', ')}`)
  const blockIds = blocks.map(b => Number(b.id)).sort((a, b) => a - b)
  const byPurpose = new Map(workflows.map(w => [w.purpose, w]))
  const used = new Set(workflows.flatMap(w => w.nodes.map(n => Number(n.blockId)).filter(id => id > 0)))

  for (const [blockId, purpose] of STEPS) {
    if (!used.has(blockId)) throw new Error(`Danh mục bước: block ${blockId} không nằm trong workflow nào`)
    if (purpose && !byPurpose.get(purpose)?.nodes.some(n => Number(n.blockId) === blockId)) throw new Error(`Danh mục bước: block ${blockId} không có trong ${purpose}`)
  }

  const lit = v => v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`
  const blockMd5 = blocks.map(b => `(${Number(b.id)}, ${lit(b.md5)})`).join(', ')
  const workflowRows = workflows.map(w => `(${lit(w.purpose)}, ${Number(w.id)}, ${lit(w.md5)})`).join(',\n    ')
  const stepRows = STEPS.map(([blockId, purpose, kind, action, level, ops, note]) =>
    `    (${blockId}, ${lit(purpose)}, ${lit(kind)}, ${lit(action)}, ${level}, ${lit(JSON.stringify(ops))}::jsonb, ${lit(note)})`).join(',\n')
  const campaignWorkflows = workflows.filter(w => w.purpose !== 'rest_browse')

  const migration = `-- V560: chép workflow / block Facebook sang bản riêng cho engine v2 (Q7). SINH TỪ scripts/build-v560-sql.cjs, không sửa tay.
-- Nguồn: ${path.relative(ROOT, SNAPSHOT_FILE)} (đọc chỉ đọc ${snapshot.readAt ?? ''}): ${workflows.length} workflow, ${blocks.length} block.
-- Chỉ dữ liệu. Bộ cũ không nạp bản "[engine]" (chọn workflow qua auto_campaign_actions.workflow_id, không đổi); engine chọn qua
-- auto_engine_workflows. Code block chép trong DB; preflight kiểm md5 code từng block và đồ thị từng workflow đúng bản đã đọc.
-- Gỡ: rollback_v560_engine_facebook_copies.sql (xoá sổ + danh mục; để nguyên workflow / block "[engine]").
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_bad text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${name}_%') THEN
      RAISE EXCEPTION '${name.toUpperCase()} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_engine_block_copies') IS NULL OR to_regclass('public.auto_engine_workflows') IS NULL THEN
    RAISE EXCEPTION '${name.toUpperCase()} cần V556 (bảng sổ chép, danh mục workflow engine)';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_block_copies) OR EXISTS (SELECT 1 FROM public.auto_engine_workflows)
     OR EXISTS (SELECT 1 FROM public.auto_engine_block_steps) THEN
    RAISE EXCEPTION '${name.toUpperCase()}: đã có sổ chép / danh mục engine Facebook';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_blocks WHERE name LIKE '${PREFIX}%') OR EXISTS (SELECT 1 FROM public.auto_workflows WHERE name LIKE '${PREFIX}%') THEN
    RAISE EXCEPTION '${name.toUpperCase()}: đã có block / workflow "[engine]" (lần gỡ trước để lại?), dọn trước rồi chạy lại';
  END IF;
  -- Code từng block đúng bản đã đọc (bảng chép và danh mục bước dựa trên bản này).
  SELECT string_agg(v.id::text, ', ') INTO v_bad FROM (VALUES ${blockMd5}) v(id, md5)
    LEFT JOIN public.auto_blocks b ON b.id = v.id
   WHERE b.id IS NULL OR md5(b.code) IS DISTINCT FROM v.md5;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '${name.toUpperCase()}: code block đã đổi / không còn so với bản đã đọc: %, đọc lại (read-workflows.cjs) và sinh lại', v_bad; END IF;
  -- Đồ thị từng workflow và workflow của từng loại chiến dịch đúng bản đã đọc.
  SELECT string_agg(v.purpose, ', ') INTO v_bad FROM (VALUES
    ${workflowRows}) v(purpose, id, md5)
    LEFT JOIN public.auto_workflows w ON w.id = v.id
   WHERE w.id IS NULL OR md5(w.nodes::text || w.edges::text) IS DISTINCT FROM v.md5
      OR (v.purpose <> 'rest_browse' AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_actions c WHERE c.id = v.purpose AND c.workflow_id = v.id))
      OR (v.purpose = 'rest_browse' AND w.name <> 'fb_campaign_rest_browse');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '${name.toUpperCase()}: workflow đã đổi so với bản đã đọc: %, đọc lại và sinh lại', v_bad; END IF;
END $pre$;

-- 1. Block: "[engine] <tên>", giữ nguyên code / cấu hình; sổ cặp kèm md5 lúc chép.
WITH src AS (SELECT * FROM public.auto_blocks WHERE id = ANY (ARRAY[${blockIds.join(', ')}]::bigint[])),
ins AS (
  INSERT INTO public.auto_blocks (name, description, icon, category, kind, system_type, code, config_schema, output_schema, default_config, is_builtin,
    staff_id, organization_id)
  SELECT '${PREFIX}' || s.name, s.description, s.icon, s.category, s.kind, s.system_type, s.code, s.config_schema, s.output_schema, s.default_config,
         s.is_builtin, s.staff_id, s.organization_id
    FROM src s ORDER BY s.id
  RETURNING id, name, code)
INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy, copied_at)
SELECT i.id, s.id, md5(s.code), md5(i.code), now() FROM ins i JOIN src s ON i.name = '${PREFIX}' || s.name;

-- 2. Workflow: "[engine] <tên>", node giữ id và tên block, blockId trỏ sang bản engine (giữ kiểu số / chuỗi của JSON gốc).
WITH src AS (
  SELECT v.purpose, w.* FROM (VALUES ${workflows.map(w => `(${lit(w.purpose)}, ${Number(w.id)})`).join(', ')}) v(purpose, id)
  JOIN public.auto_workflows w ON w.id = v.id),
remapped AS (
  SELECT s.purpose, s.id AS source_id, s.name, s.description, s.edges, s.variables_schema, s.default_variables, s.is_builtin, s.staff_id, s.organization_id,
         md5(s.nodes::text || s.edges::text) AS source_md5,
         (SELECT coalesce(jsonb_agg(CASE WHEN c.engine_block_id IS NULL THEN n.value
                   WHEN jsonb_typeof(n.value->'blockId') = 'string' THEN jsonb_set(n.value, '{blockId}', to_jsonb(c.engine_block_id::text))
                   ELSE jsonb_set(n.value, '{blockId}', to_jsonb(c.engine_block_id)) END ORDER BY n.ordinality), '[]'::jsonb)
            FROM jsonb_array_elements(s.nodes) WITH ORDINALITY n
            LEFT JOIN public.auto_engine_block_copies c
              ON (n.value->>'blockId') ~ '^[0-9]+$' AND c.source_block_id = (n.value->>'blockId')::bigint) AS nodes
    FROM src s),
ins AS (
  INSERT INTO public.auto_workflows (name, description, nodes, edges, variables_schema, default_variables, is_builtin, staff_id, organization_id)
  SELECT '${PREFIX}' || r.name, r.description, r.nodes, r.edges, r.variables_schema, r.default_variables, r.is_builtin, r.staff_id, r.organization_id
    FROM remapped r
  RETURNING id, name, nodes, edges)
INSERT INTO public.auto_engine_workflows (purpose, workflow_id, source_workflow_id, source_md5, engine_md5, copied_at, is_active)
SELECT r.purpose, i.id, r.source_id, r.source_md5, md5(i.nodes::text || i.edges::text), now(), true
  FROM ins i JOIN remapped r ON i.name = '${PREFIX}' || r.name;

-- 3. Danh mục bước cho bản engine (phương án mục 3.5).
INSERT INTO public.auto_engine_block_steps (block_id, workflow_id, node_id, action_code, step_kind, commit_level, send_ops, reviewed_code_md5, note)
SELECT c.engine_block_id, ew.workflow_id, NULL, v.action, v.kind, v.level, v.ops, c.engine_md5_at_copy, '${name.toUpperCase()}: ' || v.note
  FROM (VALUES
${stepRows}
  ) v(source_block_id, purpose, kind, action, level, ops, note)
  JOIN public.auto_engine_block_copies c ON c.source_block_id = v.source_block_id
  LEFT JOIN public.auto_engine_workflows ew ON ew.purpose = v.purpose;

DO $post$
DECLARE v_n integer; v_bad text;
BEGIN
  SELECT count(*) INTO v_n FROM public.auto_engine_block_copies;
  IF v_n <> ${blocks.length} THEN RAISE EXCEPTION '${name.toUpperCase()} postflight: % block chép, cần ${blocks.length}', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_workflows WHERE is_active;
  IF v_n <> ${workflows.length} THEN RAISE EXCEPTION '${name.toUpperCase()} postflight: % workflow engine, cần ${workflows.length}', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.auto_engine_block_steps WHERE is_active;
  IF v_n <> ${STEPS.length} THEN RAISE EXCEPTION '${name.toUpperCase()} postflight: % dòng danh mục bước, cần ${STEPS.length}', v_n; END IF;
  -- Workflow engine không trỏ tới block bản cũ nào.
  SELECT string_agg(DISTINCT ew.purpose || ':' || (n.value->>'blockId'), ', ') INTO v_bad
    FROM public.auto_engine_workflows ew JOIN public.auto_workflows w ON w.id = ew.workflow_id
    CROSS JOIN LATERAL jsonb_array_elements(w.nodes) n
   WHERE (n.value->>'blockId') ~ '^[0-9]+$' AND (n.value->>'blockId')::bigint > 0
     AND NOT EXISTS (SELECT 1 FROM public.auto_engine_block_copies c WHERE c.engine_block_id = (n.value->>'blockId')::bigint);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '${name.toUpperCase()} postflight: workflow engine trỏ tới block không phải bản engine: %', v_bad; END IF;
  -- Không lệch ngay sau khi chép; loại chiến dịch nào cũng có workflow engine.
  IF EXISTS (SELECT 1 FROM public.aka_agent_engine_block_copy_drift) THEN RAISE EXCEPTION '${name.toUpperCase()} postflight: view lệch có dòng ngay sau khi chép'; END IF;
  SELECT string_agg(c.id, ', ') INTO v_bad FROM public.auto_campaign_actions c
   WHERE c.flatform_type = 'facebook' AND c.is_active AND NOT c.is_delete AND c.workflow_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.auto_engine_workflows ew WHERE ew.purpose = c.id AND ew.is_active);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '${name.toUpperCase()} postflight: loại chiến dịch chưa có workflow engine: %', v_bad; END IF;
  -- Bộ cũ không đổi: workflow của từng loại chiến dịch vẫn là bản cũ.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_actions c JOIN public.auto_workflows w ON w.id = c.workflow_id WHERE w.name LIKE '${PREFIX}%') THEN
    RAISE EXCEPTION '${name.toUpperCase()} postflight: auto_campaign_actions trỏ tới workflow "[engine]"';
  END IF;
END $post$;

COMMIT;
`

  const rollback = `-- Gỡ ${name.toUpperCase()}: xoá danh mục bước, danh mục workflow engine và sổ chép; engine Facebook lùi về bộ cũ (không có workflow engine).
-- Workflow / block "[engine]" để nguyên (auto_runs.workflow_id có khoá ngoại tới auto_workflows); bộ cũ không nạp chúng.
-- Apply lại sau khi gỡ: preflight từ chối khi còn block / workflow "[engine]" (dọn ngoài giờ cao điểm trước). SINH TỪ scripts/build-v560-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.auto_engine_block_steps;
DELETE FROM public.auto_engine_workflows;
DELETE FROM public.auto_engine_block_copies;

COMMIT;
`
  return { migration, rollback, STEPS }
}

module.exports = { build, PREFIX, STEPS }
if (require.main === module) {
  const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))
  const { migration, rollback, STEPS } = build(snapshot)
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v560_engine_facebook_copies.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v560_engine_facebook_copies.sql'), rollback)
  console.log(`V560: ${snapshot.workflows.length} workflow, ${snapshot.blocks.length} block, ${STEPS.length} dòng danh mục bước; migration ${md5(migration)}, rollback ${md5(rollback)}`)
}
