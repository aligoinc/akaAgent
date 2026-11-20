#!/usr/bin/env node
// V596: cho fanpage Facebook dùng akaChat (hộp thư Chat Web) như một tài khoản Zalo Server (anh chốt 17–20/11/2026).
//
// Chat API kết nối Page qua webhook Meta và lưu mỗi Page thành một dòng auto_accounts flatform_type = 'facebook_page'
// + chat_zalo_account zalo_id 'fb:<page>' + một binding mỗi tổ chức (akaAgentChatApi, nhánh feat/facebook-page-inbox).
// Hai hàm quyền đang chặn mọi loại tài khoản không phải Zalo cho akaChat:
// - aka_agent_app_access_account_allowed(account, 'akaChat') chỉ trả true cho zalo (không phải Zalo trình duyệt);
// - private.app_access_validate_account (trigger app_access_guard_flags trên auto_accounts) ném app_access_zalo_only khi bật
//   is_akachat_enabled cho loại khác, và đòi chủ tài khoản đọc được akaAgent (app_access_local_reader_required) cho tài khoản
//   không phải Server.
// Sửa: thêm loại 'facebook_page' vào nhánh akaChat của hàm thứ nhất; ở hàm thứ hai bỏ các bước chỉ Zalo có (phiên trên máy
// Desktop, giữ chỗ UID Zalo) cho 'facebook_page'. Kiểm gói akaChat và suất tài khoản giữ nguyên, chạy trước nhánh này: suất akaChat
// đếm mọi tài khoản is_akachat_enabled của chủ tài khoản (private.app_access_quota), nên mỗi Page chiếm một suất như một tài khoản
// Zalo (anh chốt 20/11: "Tính một suất"). Mọi nhánh khác (akaAgent, Zalo trình duyệt, Zalo QR / Server) giữ nguyên từng ký tự.
//
// Nguồn: pg_get_functiondef production đọc chỉ đọc 20/11/2026 (scripts/fixtures/chat-facebook-page/v596-live-20261120.json).
// Thân hàm mới không ghi số migration trong chú thích: đổi số thì md5 thân hàm không đổi.
// Chạy: node scripts/build-v596-sql.cjs (ghi migration + bản gỡ). Không sửa tay hai file đó.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')

const VERSION = 'v596'
const NAME = `migration_${VERSION}_chat_facebook_page_access`
const ROLLBACK_NAME = `rollback_${VERSION}_chat_facebook_page_access`
const FIXTURE = 'scripts/fixtures/chat-facebook-page/v596-live-20261120.json'

const FUNCS = [
  {
    key: 'allowed',
    sig: 'public.aka_agent_app_access_account_allowed(bigint,text)',
    fixtureKey: 'public.aka_agent_app_access_account_allowed(bigint,text)',
    liveMd5: '410005b7e2720a1db565acfcd8c7e197',
    patches: [{
      label: 'allowed: nhánh akaChat',
      from: `      WHEN 'akaChat' THEN a.is_akachat_enabled AND lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)
`,
      to: `      -- Fanpage Facebook (Chat API nhận tin qua webhook Meta) dùng akaChat như tài khoản Zalo; Zalo trình duyệt thì không.
      WHEN 'akaChat' THEN a.is_akachat_enabled
        AND ((lower(a.flatform_type)='zalo' AND NOT COALESCE(a.is_zalo_show_web,false)) OR lower(a.flatform_type)='facebook_page')
`
    }]
  },
  {
    key: 'validate',
    sig: 'private.app_access_validate_account(public.auto_accounts,public.auto_accounts)',
    fixtureKey: 'private.app_access_validate_account(auto_accounts,auto_accounts)',
    liveMd5: 'f9f8f66c263a45c7196808f1781a64cf',
    patches: [{
      label: 'validate: nhánh akaChat cho facebook_page',
      from: `    ELSE
      IF lower(n.flatform_type)<>'zalo' OR COALESCE(n.is_zalo_show_web,false) THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
`,
      to: `    ELSIF lower(n.flatform_type)='facebook_page' THEN
      -- Fanpage Facebook: không có phiên Zalo hay máy Desktop đọc tin, không có UID Zalo để giữ chỗ. Chat API giữ mỗi Page cho
      -- đúng một tổ chức (chat_zalo_account zalo_id 'fb:<page>', một binding mỗi tổ chức). Gói và suất akaChat đã kiểm ở trên.
      NULL;
    ELSE
      IF lower(n.flatform_type)<>'zalo' OR COALESCE(n.is_zalo_show_web,false) THEN RAISE EXCEPTION 'app_access_zalo_only'; END IF;
`
    }]
  }
]

function patch(text, from, to, label) {
  const n = text.split(from).length - 1
  if (n !== 1) throw new Error(`${label}: cần đúng 1 chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'))
for (const fn of FUNCS) {
  fn.live = fixture[fn.fixtureKey]
  if (typeof fn.live !== 'string') throw new Error(`${FIXTURE}: thiếu ${fn.fixtureKey}`)
  if (md5(fn.live) !== fn.liveMd5) throw new Error(`${fn.key}: fixture không còn khớp md5 production ${fn.liveMd5}`)
  fn.next = fn.patches.reduce((text, p) => patch(text, p.from, p.to, p.label), fn.live)
  fn.nextMd5 = md5(fn.next)
}

const V = VERSION.toUpperCase()
const checks = (label, expectKey, doneKey, ledger) => `DO $pre$
DECLARE v_oid oid; v_md5 text; v_acl text;
BEGIN
${ledger ? `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_${VERSION}_%') THEN
      RAISE EXCEPTION '${V} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
` : ''}${FUNCS.map(fn => `  v_oid := to_regprocedure('${fn.sig}');
  IF v_oid IS NULL THEN RAISE EXCEPTION '${label}: không có ${fn.sig}'; END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 = '${fn[doneKey]}' THEN RAISE EXCEPTION '${label}: ${fn.key} đã là bản đích'; END IF;
  IF v_md5 IS DISTINCT FROM '${fn[expectKey]}' THEN RAISE EXCEPTION '${label}: định nghĩa ${fn.key} khác bản đã đối chiếu (%)', v_md5; END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  PERFORM set_config('aka.${VERSION}_meta_${fn.key}', v_acl, true);
`).join('')}END $pre$;`

const post = (label, expectKey) => `DO $post$
DECLARE v_oid oid; v_acl text;
BEGIN
${FUNCS.map(fn => `  v_oid := '${fn.sig}'::regprocedure;
  IF md5(pg_get_functiondef(v_oid)) IS DISTINCT FROM '${fn[expectKey]}' THEN
    RAISE EXCEPTION '${label} postflight: định nghĩa ${fn.key} %', md5(pg_get_functiondef(v_oid));
  END IF;
  SELECT coalesce(p.proacl::text, '') || '|' || pg_get_userbyid(p.proowner) || '|' || p.prosecdef::text || '|' || p.provolatile::text
    || '|' || coalesce(array_to_string(p.proconfig, ','), '') INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF v_acl IS DISTINCT FROM current_setting('aka.${VERSION}_meta_${fn.key}', true) THEN
    RAISE EXCEPTION '${label} postflight: quyền / chủ sở hữu / thuộc tính ${fn.key} bị đổi';
  END IF;
`).join('')}END $post$;`

const header = `BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';`

const migration = `-- ${V}: fanpage Facebook dùng akaChat (hộp thư Chat Web) như tài khoản Zalo; mỗi Page chiếm một suất akaChat.
-- SINH TỪ scripts/build-${VERSION}-sql.cjs, không sửa tay. Thay thân hai hàm (giữ chữ ký, chủ sở hữu, quyền, thuộc tính):
-- - aka_agent_app_access_account_allowed: nhánh akaChat nhận thêm flatform_type 'facebook_page';
-- - private.app_access_validate_account: với 'facebook_page' bỏ các bước chỉ Zalo có (phiên Desktop, giữ chỗ UID Zalo); gói và suất
--   akaChat vẫn kiểm như mọi tài khoản.
-- Không có dòng auto_accounts 'facebook_page' nào trước khi Chat API bản fanpage chạy, nên hành vi với dữ liệu hiện có không đổi.
-- Nguồn = pg_get_functiondef production 20/11/2026: ${FUNCS.map(fn => `${fn.key} ${fn.liveMd5}`).join(', ')}.
-- Bản mới: ${FUNCS.map(fn => `${fn.key} ${fn.nextMd5}`).join(', ')}.
-- DDL làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. Gỡ: ${ROLLBACK_NAME}.sql.
${header}

${checks(V, 'liveMd5', 'nextMd5', true)}

${FUNCS.map(fn => `${fn.next};`).join('\n\n')}

${post(V, 'nextMd5')}

COMMIT;
`

const rollback = `-- Gỡ ${V}: trả hai hàm quyền akaChat về bản production 20/11/2026. SINH TỪ scripts/build-${VERSION}-sql.cjs.
-- Gỡ trước khi xoá các Page đã kết nối thì akaChat của các Page đó thành không được phép (Chat Web không hiện, bật lại cờ bị từ chối).
${header}

${checks(`Gỡ ${V}`, 'nextMd5', 'liveMd5', false)}

${FUNCS.map(fn => `${fn.live};`).join('\n\n')}

${post(`Gỡ ${V}`, 'liveMd5')}

COMMIT;
`

module.exports = { migration, rollback, NAME, ROLLBACK_NAME, FUNCS }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/${NAME}.sql`), migration)
  fs.writeFileSync(path.join(ROOT, `migrations/${ROLLBACK_NAME}.sql`), rollback)
  console.log(`${V} migration`, md5(migration), 'rollback', md5(rollback))
  for (const fn of FUNCS) console.log(' ', fn.key, fn.liveMd5, '->', fn.nextMd5)
}
