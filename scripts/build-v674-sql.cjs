#!/usr/bin/env node
// V674: chiến dịch qua ngày kết thúc thì dừng hẳn, kể cả khi còn data chưa gửi (anh chốt 27/11/2026: "Dừng hẳn").
//
// Trước: từ V214 (30/07/2026, commit 0f8d806b), bước bảo trì lịch đầu ngày gặp chiến dịch có ngày chạy kế quá ngày kết thúc thì
// gọi hàm kết thúc chung; hàm này không hoàn thành khi còn data "chờ xử lý" (chặn race data mới thêm lúc kết thúc), nhưng bước bảo
// trì vẫn dời lịch sang ngày chạy kế ⇒ chiến dịch chạy quá ngày kết thúc tới khi hết data (tổ chức 2172, 27/11: 470 data còn lại
// gửi tiếp sau ngày kết thúc 26/11; 144 chiến dịch đang như vậy lúc điều tra). Trước V214 qua ngày kết thúc là hoàn thành ngay.
// Sau: hai hàm kết thúc mà bước bảo trì của cả ba nơi chạy gọi tới đóng data còn "chờ xử lý" (hoàn thành + ghi chú) rồi hoàn thành
// chiến dịch như trước V214. Không đổi app: mọi bản Desktop / App Server / Fly đang chạy đều được sửa.
//  - aka_agent_finalize_campaign (Desktop, bộ cũ lẫn bảo trì lịch): đóng data khi đã qua ngày kết thúc theo giờ DB, hoặc khi bước
//    bảo trì báo ngày chạy kế quá ngày kết thúc (ghi chú 'Chiến dịch đã hết ngày kết thúc' + trạng thái chờ 'chờ xử lý'; trường hợp
//    ngày kết thúc rơi vào ngày không chạy, lúc bảo trì giờ DB chưa qua ngày kết thúc). Khoá theo thứ tự input -> campaign như hàm
//    của Zalo Server: lấy khoá tuần tự data trước khi khoá chiến dịch.
//  - aka_agent_finalize_zalo_server_maintenance_campaign (App Server VPS và Fly): hàm đã tự tính "ngày chạy kế quá ngày kết thúc" và đã
//    khoá data, chỉ thêm bước đóng data trước khi gọi hàm kết thúc.
// Nhóm data có hàm kết thúc riêng, không đổi.
//
// Nguồn: pg_get_functiondef production đọc chỉ đọc 27/11/2026 (scripts/fixtures/campaign-end-date/v674-live-20261127.json).
// Thân hàm mới không ghi số migration trong chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v674-sql.cjs (ghi migration + bản gỡ). Không sửa tay hai file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v674'
const NAME = `migration_${VERSION}_campaign_end_date_close_pending`
const ROLLBACK_NAME = `rollback_${VERSION}_campaign_end_date_close_pending`
const FIXTURE = 'scripts/fixtures/campaign-end-date/v674-live-20261127.json'

/** Ghi chú trên từng data bị đóng vì chiến dịch hết ngày kết thúc (khách thấy ở tab data). */
const INPUT_NOTE = 'Chưa gửi vì chiến dịch đã hết ngày kết thúc'

const DESKTOP_SIG = 'public.aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)'
const SERVER_SIG = 'public.aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)'

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'))
function live(sig) {
  const item = fixture.functions[sig]
  if (!item) throw new Error(`${FIXTURE}: thiếu ${sig}`)
  if (md5(item.def) !== item.md5) throw new Error(`${FIXTURE}: md5 ${sig} không khớp`)
  return item.def
}

// ---------- aka_agent_finalize_campaign (Desktop) ----------
const desktopLive = live(DESKTOP_SIG)
let desktopNew = patch(desktopLive,
  `  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
BEGIN`,
  `  v_expected_status text := lower(btrim(COALESCE(p_expected_status, '')));
  v_end_passed boolean := false;
BEGIN`, 1, 'desktop: khai báo biến')
desktopNew = patch(desktopNew,
  `    p_auth_password
  );

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct')`,
  `    p_auth_password
  );

  -- Qua ngày kết thúc thì dừng hẳn (anh chốt 27/11/2026): đóng data còn "chờ xử lý" kèm ghi chú để bước dưới hoàn thành chiến dịch.
  -- Không đóng thì bước bảo trì lịch vẫn dời lịch sang ngày chạy kế và chiến dịch chạy quá ngày kết thúc tới khi hết data.
  -- Hai trường hợp: giờ DB đã qua ngày kết thúc; hoặc bước bảo trì lịch báo ngày chạy kế quá ngày kết thúc (ghi chú
  -- 'Chiến dịch đã hết ngày kết thúc' với trạng thái chờ 'chờ xử lý', gặp khi ngày kết thúc rơi vào ngày không chạy).
  -- Khoá tuần tự data trước khi khoá chiến dịch (thứ tự input -> campaign như hàm kết thúc của Zalo Server). Nhóm data không đụng.
  SELECT campaign.schedule_end_date IS NOT NULL
         AND (campaign.schedule_end_date <= now()
              OR (v_expected_status = 'chờ xử lý' AND p_note = 'Chiến dịch đã hết ngày kết thúc'))
  INTO v_end_passed
  FROM public.auto_campaigns AS campaign
  WHERE campaign.id = p_campaign_id
    AND campaign.staff_id = p_staff_id
    AND (
      campaign.organization_id IS NULL
      OR campaign.organization_id = p_organization_id
    )
    AND COALESCE(campaign.is_delete, false) = false
    AND COALESCE(campaign.data_target_source_mode, 'direct') = 'direct';

  IF v_end_passed IS TRUE THEN
    PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành',
        note = '${INPUT_NOTE}'
    WHERE input_data.campaign_id = p_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý';
  END IF;

  SELECT campaign.status, COALESCE(campaign.data_target_source_mode, 'direct')`, 1, 'desktop: đóng data qua ngày kết thúc')

// ---------- aka_agent_finalize_zalo_server_maintenance_campaign (App Server VPS + Fly) ----------
const serverLive = live(SERVER_SIG)
const serverNew = patch(serverLive,
  `  v_maintenance_note := CASE
    WHEN v_is_schedule_end_maintenance THEN 'Chiến dịch đã hết ngày kết thúc'`,
  `  -- Qua ngày kết thúc thì dừng hẳn (anh chốt 27/11/2026): đóng data còn "chờ xử lý" kèm ghi chú (data đã khoá ở trên) để hàm kết thúc
  -- hoàn thành chiến dịch. Không đóng thì bước bảo trì lịch vẫn dời lịch sang ngày chạy kế và chiến dịch chạy quá ngày kết thúc.
  IF v_is_schedule_end_maintenance THEN
    UPDATE public.auto_campaign_input_data AS input_data
    SET status = 'hoàn thành',
        note = '${INPUT_NOTE}'
    WHERE input_data.campaign_id = v_authorized_campaign_id
      AND COALESCE(input_data.is_delete, false) = false
      AND input_data.status = 'chờ xử lý';
  END IF;

  v_maintenance_note := CASE
    WHEN v_is_schedule_end_maintenance THEN 'Chiến dịch đã hết ngày kết thúc'`, 1, 'server: đóng data qua ngày kết thúc')

const FUNCS = [
  { key: 'desktop', sig: DESKTOP_SIG, live: desktopLive, next: desktopNew },
  { key: 'server', sig: SERVER_SIG, live: serverLive, next: serverNew }
].map(f => ({ ...f, liveMd5: md5(f.live), nextMd5: md5(f.next) }))

const V = VERSION.toUpperCase()

function preflight(label, from, to, msgDone, msgDrift, ledger) {
  const checks = FUNCS.map(f => `  v_oid := to_regprocedure('${f.sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${f.sig}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${f[to]}' THEN RAISE EXCEPTION '${msgDone} (${f.key})'; END IF;
  IF v_md5 IS DISTINCT FROM '${f[from]}' THEN RAISE EXCEPTION '${msgDrift} (${f.key}: %)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.${VERSION}_acl_${f.key}', v_acl, true);`).join('\n')
  return `DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${VERSION}_%') THEN
      RAISE EXCEPTION '${V} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}${checks}
END $pre$;`
}

function postflight(label, expectKey) {
  const checks = FUNCS.map(f => `  v_oid := '${f.sig}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${f[expectKey]}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa ${f.key} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || coalesce(p.proconfig::text, '') || '|' || p.prosecdef::text
    INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.${VERSION}_acl_${f.key}', true) THEN
    RAISE EXCEPTION '${label} postflight: quyền / chủ sở hữu / cấu hình ${f.key} bị đổi';
  END IF;`).join('\n')
  return `DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${checks}
END $post$;`
}

const header = FUNCS.map(f => `--   ${f.sig}: ${f.liveMd5} -> ${f.nextMd5}`).join('\n')

const migration = `-- ${V}: chiến dịch qua ngày kết thúc thì dừng hẳn, đóng data còn "chờ xử lý". SINH TỪ scripts/build-${VERSION}-sql.cjs, không sửa tay.
-- Thay thân 2 hàm kết thúc (giữ chữ ký, chủ sở hữu, quyền, cấu hình); md5 pg_get_functiondef production 27/11/2026 -> bản mới:
${header}
-- Ghi chú data bị đóng: '${INPUT_NOTE}'.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql (không mở lại data đã đóng).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(V, 'liveMd5', 'nextMd5', `${V} đã chạy`, `${V}: định nghĩa khác bản production 27/11/2026, dừng để đối chiếu bản live`, true)}

${FUNCS.map(f => f.next + ';').join('\n\n')}

${postflight(V, 'nextMd5')}

COMMIT;
`

const rollback = `-- Gỡ ${V}: trả 2 hàm kết thúc chiến dịch về bản production 27/11/2026. SINH TỪ scripts/build-${VERSION}-sql.cjs.
-- Data đã bị đóng ('${INPUT_NOTE}') giữ nguyên; sau khi gỡ, chiến dịch còn data lại chạy quá ngày kết thúc như trước.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

${preflight(`Gỡ ${V}`, 'nextMd5', 'liveMd5', `Gỡ ${V}: hàm đã là bản trước ${V}`, `Gỡ ${V}: định nghĩa không phải bản ${V}`, false)}

${FUNCS.map(f => f.live + ';').join('\n\n')}

${postflight(`Gỡ ${V}`, 'liveMd5')}

COMMIT;
`

module.exports = { migration, rollback, NAME, ROLLBACK_NAME, INPUT_NOTE, FUNCS }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${V} migration`, md5(migration), 'rollback', md5(rollback))
  for (const f of FUNCS) console.log(' ', f.key, f.liveMd5, '->', f.nextMd5)
}
