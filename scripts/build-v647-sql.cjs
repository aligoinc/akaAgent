#!/usr/bin/env node
// Sinh migrations/migration_v647_zalo_partial_text_note.sql + rollback từ thân aka_agent_engine_report_v1 đọc trên production 24/11/2026
// (scripts/fixtures/zalo-partial-text-v647/). Không sửa tay file migration: sửa ở đây rồi chạy lại.
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const md5 = s => crypto.createHash('md5').update(s, 'utf8').digest('hex')
const LIVE = fs.readFileSync(path.join(ROOT, 'scripts/fixtures/zalo-partial-text-v647/aka_agent_engine_report_v1-live-20261124.sql'), 'utf8')

const OLD_PREFIX = "ELSE 'Đã gửi file nhưng gửi nội dung thất bại. ' END || v_log;"
const NEW_PREFIX = "ELSE 'Người nhận đã nhận ảnh nhưng chưa nhận được chữ. ' END || v_log;"

function body(def) {
  const m = def.match(/AS \$function\$([\s\S]*)\$function\$\s*$/)
  if (!m) throw new Error('không tách được thân hàm')
  return m[1]
}

const OLD_BODY_MD5 = 'ca458543bd12435a39def998ee0268d2'
if (md5(body(LIVE)) !== OLD_BODY_MD5) throw new Error('fixture không khớp md5 thân hàm production')
if (LIVE.split(OLD_PREFIX).length !== 2) throw new Error('tiền tố cũ phải xuất hiện đúng một lần')
const NEW_DEF = LIVE.replace(OLD_PREFIX, NEW_PREFIX)
const NEW_BODY_MD5 = md5(body(NEW_DEF))

// Câu cho khách (anh duyệt 24/11/2026). Dùng chung cho mọi lỗi 127 khi nhắn người lạ (kể cả tin chỉ có chữ), nên lời khuyên viết dạng "nếu".
const ADVICE = 'Nếu gửi từ 3 ảnh trở lên, đặt "Nghỉ giữa 2 lần" từ 300 giây.'
const OLD = {
  customer_title: 'Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 127)',
  customer_help: null,
  noti_running_process: 'Tin nhắn bị trùng lặp hoặc gửi quá nhanh',
  noti_campaign: 'Nội dung bị trùng lặp hoặc gửi quá nhanh, tạm nghỉ gửi tin [x] phút',
  log_template: 'Tin nhắn bị trùng lặp hoặc gửi quá nhanh',
  campaign_note_template: 'Nội dung bị trùng lặp hoặc gửi quá nhanh, tạm nghỉ gửi tin [x] phút'
}
const NEW = {
  customer_title: 'Zalo chặn tin nhắn người lạ vì gửi quá nhanh',
  customer_help: ADVICE,
  noti_running_process: 'Zalo chặn tin chữ vì gửi quá nhanh. ' + ADVICE.replace(/\.$/, ''),
  noti_campaign: 'Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. ' + ADVICE,
  log_template: 'Zalo chặn tin chữ vì gửi quá nhanh. ' + ADVICE.replace(/\.$/, ''),
  campaign_note_template: 'Zalo chặn tin nhắn người lạ vì gửi quá nhanh, tạm nghỉ gửi tin [x] phút. ' + ADVICE
}

const q = v => v === null ? 'NULL' : `$v647$${v}$v647$`
const eqOrNull = (col, v) => v === null ? `${col} IS NULL` : `${col} = ${q(v)}`

function build(direction) {
  const from = direction === 'up' ? OLD : NEW
  const to = direction === 'up' ? NEW : OLD
  const fromMd5 = direction === 'up' ? OLD_BODY_MD5 : NEW_BODY_MD5
  const toMd5 = direction === 'up' ? NEW_BODY_MD5 : OLD_BODY_MD5
  const def = direction === 'up' ? NEW_DEF : LIVE
  const head = direction === 'up' ? [
    '-- V647: tin nhắn người lạ gửi ảnh rồi chữ mà Zalo chặn phần chữ (mã 127 sau khi album đã tới): câu cho khách nói đúng việc người nhận',
    '-- đã nhận ảnh nhưng thiếu chữ, bỏ cụm "trùng lặp" (làm khách / nhân viên tưởng app kiểm tra trùng), và chỉ cách tránh (từ 3 ảnh thì nghỉ',
    '-- giữa 2 lần từ 300 giây; số đo 24/11/2026 ở docs/ZALO_PARTIAL_TEXT_V647.md). Đổi:',
    '--   1. thân aka_agent_engine_report_v1: tiền tố dòng giao một phần "Đã gửi file nhưng gửi nội dung thất bại." -> "Người nhận đã nhận ảnh',
    '--      nhưng chưa nhận được chữ." (chỉ engine v2; bộ chạy cũ đổi trong code app). Chỉ thay đúng một chuỗi, phần còn lại giữ nguyên.',
    '--   2. auto_error 61 (err_zalo_127_message_stranger) và chính sách engine 92: câu dòng lịch sử / ghi chú chiến dịch / câu chờ.',
    '-- Không đổi tính lượt, khoá, chuỗi, data đi đâu. SINH TỪ scripts/build-v647-sql.cjs, không sửa tay. Có DDL (CREATE OR REPLACE FUNCTION)',
    '-- nên PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: rollback_v647_zalo_partial_text_note.sql.'
  ] : [
    '-- Gỡ V647: trả thân aka_agent_engine_report_v1 và câu của auto_error 61 / chính sách 92 về bản trước V647. SINH TỪ scripts/build-v647-sql.cjs.'
  ]
  const ledgerGuard = direction === 'up' ? `
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v647_%') THEN
    RAISE EXCEPTION 'V647 đã có trong sổ migration, không chạy lại';
  END IF;` : ''
  return `${head.join('\n')}
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN${ledgerGuard}
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure) IS DISTINCT FROM '${fromMd5}' THEN
    RAISE EXCEPTION 'V647: thân aka_agent_engine_report_v1 khác bản đã đọc (md5 ${fromMd5}), đọc lại và sinh lại';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 61 AND error_code = 'err_zalo_127_message_stranger'
                   AND ${eqOrNull('customer_title', from.customer_title)} AND ${eqOrNull('customer_help', from.customer_help)}
                   AND ${eqOrNull('noti_running_process', from.noti_running_process)} AND ${eqOrNull('noti_campaign', from.noti_campaign)}) THEN
    RAISE EXCEPTION 'V647: auto_error 61 khác bản đã đọc';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 92 AND error_code = 'err_zalo_127_message_stranger'
                   AND action_code IS NULL AND error_class IS NULL
                   AND ${eqOrNull('log_template', from.log_template)} AND ${eqOrNull('campaign_note_template', from.campaign_note_template)}) THEN
    RAISE EXCEPTION 'V647: chính sách 92 khác bản đã đọc';
  END IF;
END $pre$;

${def.trimEnd()};

UPDATE public.auto_error
   SET customer_title = ${q(to.customer_title)}, customer_help = ${q(to.customer_help)},
       noti_running_process = ${q(to.noti_running_process)}, noti_campaign = ${q(to.noti_campaign)}, updated_at = now()
 WHERE id = 61 AND error_code = 'err_zalo_127_message_stranger';

UPDATE public.auto_outcome_policies
   SET log_template = ${q(to.log_template)}, campaign_note_template = ${q(to.campaign_note_template)}
 WHERE id = 92 AND error_code = 'err_zalo_127_message_stranger';

DO $post$
DECLARE r record;
BEGIN
  SELECT md5(p.prosrc) AS m, pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig, p.proacl::text AS acl INTO r
    FROM pg_proc p WHERE p.oid = 'public.aka_agent_engine_report_v1(bigint,uuid,jsonb,boolean,boolean)'::regprocedure;
  IF r.m IS DISTINCT FROM '${toMd5}' THEN RAISE EXCEPTION 'V647: md5 thân hàm sau khi đổi là %, cần ${toMd5}', r.m; END IF;
  IF r.owner <> 'postgres' OR NOT r.prosecdef OR r.proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'V647: thuộc tính hàm đổi (%, %, %)', r.owner, r.prosecdef, r.proconfig;
  END IF;
  IF r.acl IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres,aka_agent_chat_api=X/postgres,aka_agent_desktop=X/postgres}' THEN
    RAISE EXCEPTION 'V647: quyền hàm đổi: %', r.acl;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 61 AND ${eqOrNull('customer_title', to.customer_title)}
                   AND ${eqOrNull('noti_running_process', to.noti_running_process)} AND ${eqOrNull('noti_campaign', to.noti_campaign)}) THEN
    RAISE EXCEPTION 'V647: auto_error 61 chưa đổi';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 92 AND ${eqOrNull('log_template', to.log_template)}
                   AND ${eqOrNull('campaign_note_template', to.campaign_note_template)}) THEN
    RAISE EXCEPTION 'V647: chính sách 92 chưa đổi';
  END IF;
END $post$;

COMMIT;
`
}

fs.writeFileSync(path.join(ROOT, 'migrations/migration_v647_zalo_partial_text_note.sql'), build('up'))
fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v647_zalo_partial_text_note.sql'), build('down'))
console.log(JSON.stringify({ oldBodyMd5: OLD_BODY_MD5, newBodyMd5: NEW_BODY_MD5, texts: NEW }, null, 2))
