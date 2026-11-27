#!/usr/bin/env node
// Kiểm V676 (danh sách Zalo ID loại trừ của tài khoản cùng nick không đòi Zalo global ID) trên PostgreSQL cục bộ dựng như production
// 27/11/2026: V657 + V666 (send-exclusion-v657-fixture.cjs) + V668 p1/p2 (gid-trust-apply-migration.cjs); thân hàm so khớp phải trùng
// md5 thân production đã lưu trước khi apply. Cùng bộ ca chạy trước V676, sau V676, sau khi gỡ.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-v676-smoke.cjs
'use strict'
process.env.SX_WITH_V666 ??= '1'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')
const applyV668 = require('./gid-trust-apply-migration.cjs')
const V676 = require('./build-v676-sql.cjs')
const ROOT = path.resolve(__dirname, '..')

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n')) }
}
const ORG = 7761, STAFF = 77601
let seq = 776000
const id = () => ++seq
const G = k => ('G' + k).padEnd(32, '0')

async function main() {
  assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${V676.NAME}.sql`), 'utf8'), V676.migration, 'file migration = bản sinh')
  assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${V676.ROLLBACK_NAME}.sql`), 'utf8'), V676.rollback, 'file gỡ = bản sinh')
  const T = await buildDb({ label: 'aka-v676-' })
  const { db, one, q } = T
  const cols = {}
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    cols[table] ??= (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols[table].includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  const md5Now = async () => (await one(`SELECT md5(pg_get_functiondef(to_regprocedure($1))) m`, [V676.SIG])).m
  try {
    await T.applyV657()
    await applyV668(db)
    assert.equal(await md5Now(), V676.OLD_MD5, 'DB thử có đúng thân hàm production 27/11 (V657 + V666 + V668)')

    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org V676') ON CONFLICT DO NOTHING`, [ORG])
    await ins('org_staff', { id: STAFF, organization_id: ORG, username: 'v676', password: 'pw', is_active: true })
    const cat = async code => (await one(`SELECT id FROM public.category_item WHERE code=$1 LIMIT 1`, [code]))?.id
    let catPerson = await cat('zalo_person')
    if (!catPerson) { catPerson = 990776; await ins('category_item', { id: catPerson, code: 'zalo_person', name: 'Zalo User' }) }
    // Tài khoản Zalo; nick = zalo_accounts dùng chung (hai tài khoản cùng nick dùng cùng một dòng zalo_accounts).
    const nick = async () => { const za = id(); await ins('zalo_accounts', { id: za, zalo_uid: 'nick' + za, metadata: {} }); return za }
    const acc = async za => {
      const a = id()
      await ins('auto_accounts', { id: a, name: 'Zalo ' + a, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
        staff_id: STAFF, organization_id: ORG, is_zalo_server: false, is_zalo_show_web: false, zalo_account_id: za })
      return a
    }
    const contact = async (account, uid) => { const c = id(); await ins('auto_account_contacts', { id: c, account_id: account, contact_type: 'person', uid, is_delete: false,
      staff_id: STAFF, organization_id: ORG, flatform_type: 'zalo' }); return c }
    const group = async extra => { const g = id(); await ins('auto_account_contact_groups', { id: g, is_delete: false, staff_id: STAFF, organization_id: ORG, name: 'G' + g, ...extra }); return g }
    const member = (g, c) => ins('auto_account_contact_group_members', { id: id(), group_id: g, contact_id: c, is_delete: false })
    const list = async (account, uids) => { const g = await group({ purpose: 'zalo_friend_blocklist', account_id: account, contact_type: 'person', name: 'Không gửi ' + account })
      for (const u of uids) await member(g, await contact(account, u)); return g }
    const dataGroup = async members => { const g = await group({ purpose: 'data_group', data_type_category_item_id: catPerson })
      for (const [a, u] of members) await member(g, await contact(a, u)); return g }
    const campaign = async account => { const c = id(); await ins('auto_campaigns', { id: c, name: 'C' + c, action_id: 'zalo_message_group_member', account_id: account,
      status: 'đang chạy', is_delete: false, staff_id: STAFF, organization_id: ORG, schedule: new Date().toISOString(), schedule_type: 'daily',
      extra_settings: { enableMessage: true } }); return c }
    const match = async (account, selection, { uid, gid = null, final = true }) => {
      const c = await campaign(account)
      return (await one(`SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, $3::jsonb, NULL, $4::text, $5::text, $6::boolean) m
        FROM public.auto_campaigns c WHERE c.id=$1`, [c, account, JSON.stringify(selection), gid, uid ?? null, final])).m
    }
    const sel = (blocklistIds, extra = {}) => ({ groupId: null, blocklistIds, ...extra })
    const UNKNOWN = 'Chưa xác định được khách để kiểm tra loại trừ.'

    // Tài khoản gửi A (nick NA), A2 cùng nick NA, B nick khác.
    const NA = await nick(), NB = await nick()
    const A = await acc(NA), A2 = await acc(NA), B = await acc(NB)
    const own = await list(A, ['u-blocked'])
    const sameNick = await list(A2, ['u-blocked-2'])
    const other = await list(B, ['uB-1'])
    const dg = await dataGroup([[B, 'uB-dg']])

    // [tên, lựa chọn, tham số, kỳ vọng trước V676, kỳ vọng sau V676]: 'allowed' | 'unknown' | 'excluded'
    const outcome = m => m.match ? 'excluded' : (m.unknown ? 'unknown' : 'allowed')
    const cases = [
      ['danh sách của chính tài khoản, UID không có trong danh sách, không có Global ID (ca 63333)', sel([own]), { uid: 'u-new' }, 'unknown', 'allowed'],
      ['danh sách của chính tài khoản, UID có trong danh sách, không có Global ID', sel([own]), { uid: 'u-blocked' }, 'excluded', 'excluded'],
      ['danh sách của tài khoản cùng nick, UID không có, không có Global ID', sel([sameNick]), { uid: 'u-new' }, 'unknown', 'allowed'],
      ['danh sách của tài khoản cùng nick, UID có trong danh sách', sel([sameNick]), { uid: 'u-blocked-2' }, 'excluded', 'excluded'],
      ['danh sách của Zalo khác nick, không có Global ID: vẫn không xác định được', sel([other]), { uid: 'u-new' }, 'unknown', 'unknown'],
      ['danh sách của chính tài khoản + danh sách Zalo khác nick, không có Global ID', sel([own, other]), { uid: 'u-new' }, 'unknown', 'unknown'],
      ['danh sách của chính tài khoản + Nhóm data, không có Global ID: Nhóm data vẫn cần Global ID', sel([own], { dataGroupIds: [dg] }), { uid: 'u-new' }, 'unknown', 'unknown'],
      ['danh sách của chính tài khoản, không có UID lẫn Global ID', sel([own]), { uid: null }, 'unknown', 'unknown'],
      ['danh sách của chính tài khoản, có Global ID, không trong danh sách', sel([own]), { uid: 'u-new', gid: G('new') }, 'allowed', 'allowed'],
      ['bước nhận data (chưa tra số / đọc hồ sơ): chỉ báo cần Global ID, chưa trả unknown', sel([other]), { uid: 'u-new', final: false }, 'allowed', 'allowed']
    ]
    const runCases = async (phase, index) => {
      for (const [name, selection, args, ...expected] of cases) {
        await check(`${phase}: ${name}`, async () => {
          const m = await match(A, selection, args)
          assert.equal(outcome(m), expected[index], JSON.stringify(m))
          if (outcome(m) === 'unknown') assert.equal(m.unknown, UNKNOWN)
        })
      }
    }

    await runCases('trước V676', 0)

    await check('apply V676: preflight đạt, md5 thân mới đúng bản sinh, quyền và chủ hàm giữ nguyên, apply lại bị từ chối', async () => {
      const acl = async () => (await one(`SELECT p.proacl::text a, pg_get_userbyid(p.proowner) o, p.prosecdef d, p.proconfig::text c FROM pg_proc p WHERE p.oid=to_regprocedure($1)`, [V676.SIG]))
      const before = await acl()
      const text = V676.migration
      const i = text.lastIndexOf('COMMIT;')
      await db.query(text.slice(0, i) + `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261127999990', '${V676.NAME}', '{}');\n` + text.slice(i))
      assert.equal(await md5Now(), V676.NEW_MD5)
      assert.deepEqual(await acl(), before)
      await assert.rejects(db.query(V676.migration), /V676 đã có trong sổ migration/)
      await db.query('ROLLBACK').catch(() => {})
    })

    await runCases('sau V676', 1)

    await check('gỡ V676 trả thân production, gỡ lần hai bị từ chối', async () => {
      await db.query(V676.rollback)
      assert.equal(await md5Now(), V676.OLD_MD5)
      await assert.rejects(db.query(V676.rollback), /không phải bản V676/)
      await db.query('ROLLBACK').catch(() => {})
    })

    await runCases('sau khi gỡ', 0)
  } finally {
    await db.end().catch(() => {})
    T.stop()
  }
  console.log(`V676: ${passed} đạt, ${failed} hỏng`)
  if (failed) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
