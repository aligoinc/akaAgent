#!/usr/bin/env node
// Kiểm trigger V668 p1 (chặn ghi Global ID của người xem vào zalo_users) trên PostgreSQL cục bộ (fixture V657 + V666): mô phỏng đúng
// câu ghi của từng nơi (upsert thành viên nhóm Desktop cũ / WebApp, bạn bè Desktop / WebApp, upsert COALESCE + gộp raw_payload của ChatApi,
// đọc hồ sơ của Desktop), dòng của chính nick, lô sửa dữ liệu, hoàn tác có / không tắt chặn, UPDATE không đụng global_id, tốc độ.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/zalo-users-gid-guard-smoke.cjs
'use strict'
process.env.SX_WITH_V666 ??= '1'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')
const R = require('./zalo-users-gid-repair.cjs')
const ROOT = path.resolve(__dirname, '..')
const P1 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v668_zalo_users_global_id_guard_p1.sql'), 'utf8')
const RB1 = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v668_zalo_users_global_id_guard_p1.sql'), 'utf8')

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.stack || e.message).split('\n').slice(0, 5).join('\n')) }
}
const G = k => ('G' + k).padEnd(32, '0')
const SCAN = (uid, gid) => ({ id: uid, ...(gid ? { globalId: gid } : {}), source: 'profile', zaloGroupId: '6784869142295974592', zaloName: 'tv ' + uid })
const PROFILE = (uid, gid) => ({ userId: uid, globalId: gid, zaloName: 'hs ' + uid, bizPkg: { pkgId: 0 } })

async function main() {
  const T = await buildDb({ label: 'aka-gidguard-' })
  const { db, one, q } = T
  let seq = 990000
  const id = () => ++seq
  try {
    await T.applyV657()
    // production: zalo_users.id có giá trị mặc định (upsert của app không truyền id); DB thử thì không.
    if (!(await one(`SELECT column_default d FROM information_schema.columns WHERE table_schema='public' AND table_name='zalo_users' AND column_name='id'`)).d
        && !(await one(`SELECT is_identity i FROM information_schema.columns WHERE table_schema='public' AND table_name='zalo_users' AND column_name='id'`)).i?.startsWith('Y')) {
      await db.query(`CREATE SEQUENCE IF NOT EXISTS public.zalo_users_test_id_seq START 7000000; ALTER TABLE public.zalo_users ALTER COLUMN id SET DEFAULT nextval('public.zalo_users_test_id_seq')`)
    }
    const ORG = 9901, STAFF = 990101
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org guard') ON CONFLICT DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password, is_active) OVERRIDING SYSTEM VALUE VALUES ($1, $2, 'gd', 'pw', true)`, [STAFF, ORG])
    const acc = async (accId, { desk, fly, nick } = {}) => {
      let za = null
      if (desk) { za = id(); await db.query(`INSERT INTO public.zalo_accounts (id, zalo_uid, metadata) VALUES ($1, $2, $3)`, [za, nick, { globalId: desk }]) }
      await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web, zalo_account_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'x', 'x', true, false, $2, $3, $4, false, $5)`, [accId, STAFF, ORG, !!fly, za])
      if (fly) { const ca = id(); await db.query(`INSERT INTO public.chat_zalo_account (id, zalo_id, global_id) VALUES ($1, $2, $3)`, [ca, nick, fly])
        await db.query(`INSERT INTO public.chat_zalo_account_organization (id, chat_zalo_account_id, organization_id, auto_account_id, is_active) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, true)`, [id(), ca, ORG, accId]) }
    }
    const A = 9901, U = 9902, F = 9903
    await acc(A, { desk: G('ownA'), nick: 'nickA' })
    await acc(U)                                         // nick không ghi nhận
    await acc(F, { fly: G('ownF'), nick: 'nickF' })      // Server (Fly)
    const gid = async (account, uid) => (await one(`SELECT global_id FROM public.zalo_users WHERE account_id=$1 AND zalo_uid=$2`, [account, uid]))?.global_id ?? null
    // Dòng sẵn có trước khi apply (dữ liệu cũ, kể cả dòng sai).
    const seed = async (account, uid, g, raw) => db.query(`INSERT INTO public.zalo_users (id, account_id, zalo_uid, global_id, raw_payload, staff_id, organization_id, is_fr)
      OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6, $7, 0)`, [id(), account, uid, g, raw, STAFF, ORG])
    await seed(A, 'a-real', G('real-a'), PROFILE('a-real', G('real-a')))
    await seed(A, 'a-wrong', G('ownA'), SCAN('a-wrong', G('ownA')))
    await seed(U, 'u-real', G('real-u'), PROFILE('u-real', G('real-u')))
    await seed(A, 'a-old', G('ownA'), SCAN('a-old', G('ownA')))   // để thử lô sửa dữ liệu sau khi có trigger

    await check('apply V668 p1 trên DB thử (preflight md5 đạt), apply lại bị từ chối', async () => {
      // như make-migration-ledger-apply.cjs: dòng sổ chèn ngay trước COMMIT cuối, cùng giao dịch
      const i = P1.lastIndexOf('COMMIT;')
      await db.query(P1.slice(0, i) + `INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('20261126999998','migration_v668_zalo_users_global_id_guard_p1','{}');\n` + P1.slice(i))
      await assert.rejects(db.query(P1), /V668 đã có trong sổ migration/)
      await db.query('ROLLBACK')   // file mở BEGIN; lỗi ở preflight nên COMMIT không chạy tới
    })

    // Câu upsert như PostgREST (Desktop / WebApp): INSERT ... ON CONFLICT (account_id, zalo_uid) DO UPDATE SET cột = EXCLUDED.cột.
    const upsertAll = (rows) => db.query(`INSERT INTO public.zalo_users (account_id, zalo_uid, global_id, raw_payload, display_name, staff_id, organization_id, updated_at)
      SELECT r.account_id, r.zalo_uid, r.global_id, r.raw_payload, r.display_name, ${STAFF}, ${ORG}, now() FROM jsonb_to_recordset($1::jsonb)
        r(account_id bigint, zalo_uid text, global_id text, raw_payload jsonb, display_name text)
      ON CONFLICT (account_id, zalo_uid) DO UPDATE SET global_id = EXCLUDED.global_id, raw_payload = EXCLUDED.raw_payload,
        display_name = EXCLUDED.display_name, updated_at = EXCLUDED.updated_at`, [JSON.stringify(rows)])

    await check('Desktop cũ quét nhóm (upsert): dòng mới không mang Global ID của nick; dòng đúng giữ; dòng sai cũ thành trống', async () => {
      const existing = { 'a-real': PROFILE('a-real', G('real-a')), 'a-wrong': SCAN('a-wrong', G('ownA')) }
      // Như upsertZaloUsersForGroupMembers bản cũ: global_id = member.globalId (của nick) || cũ; raw_payload = raw cũ nếu có, không thì raw thành viên.
      await upsertAll(['a-new', 'a-real', 'a-wrong'].map(u => ({ account_id: A, zalo_uid: u, global_id: G('ownA'), raw_payload: existing[u] ?? SCAN(u, G('ownA')), display_name: 'tv ' + u })))
      assert.equal(await gid(A, 'a-new'), null)
      assert.equal(await gid(A, 'a-real'), G('real-a'))
      assert.equal(await gid(A, 'a-wrong'), null)
    })
    await check('WebApp quét nhóm, nick không ghi nhận: Global ID người xem không ghi vào dòng mới, không đè dòng đúng', async () => {
      await upsertAll([{ account_id: U, zalo_uid: 'u-new', global_id: G('viewerU'), raw_payload: SCAN('u-new', G('viewerU')), display_name: 'x' },
        { account_id: U, zalo_uid: 'u-real', global_id: G('viewerU'), raw_payload: PROFILE('u-real', G('real-u')), display_name: 'x' }])
      assert.equal(await gid(U, 'u-new'), null)
      assert.equal(await gid(U, 'u-real'), G('real-u'))
    })
    await check('Fly: Global ID của nick ở chat_zalo_account cũng bị chặn', async () => {
      await upsertAll([{ account_id: F, zalo_uid: 'f-new', global_id: G('ownF'), raw_payload: SCAN('f-new', G('ownF')), display_name: 'x' }])
      assert.equal(await gid(F, 'f-new'), null)
    })
    await check('dòng của chính nick vẫn ghi Global ID của nick', async () => {
      await upsertAll([{ account_id: A, zalo_uid: 'nickA', global_id: G('ownA'), raw_payload: SCAN('nickA', G('ownA')), display_name: 'me' }])
      assert.equal(await gid(A, 'nickA'), G('ownA'))
    })
    await check('bạn bè (Desktop / WebApp: raw = hồ sơ, Global ID cùng hồ sơ): ghi bình thường, kể cả đè dòng sai cũ', async () => {
      await upsertAll([{ account_id: A, zalo_uid: 'a-fr', global_id: G('fr'), raw_payload: PROFILE('a-fr', G('fr')), display_name: 'b' },
        { account_id: A, zalo_uid: 'a-old', global_id: G('real-old'), raw_payload: PROFILE('a-old', G('real-old')), display_name: 'b' }])
      assert.equal(await gid(A, 'a-fr'), G('fr'))
      assert.equal(await gid(A, 'a-old'), G('real-old'))
    })
    await check('ChatApi upsert (COALESCE global_id, gộp raw_payload): dòng quét nhóm được đọc hồ sơ thì ghi Global ID thật', async () => {
      await seed(F, 'f-scan', null, SCAN('f-scan', G('ownF')))
      const sqlChat = `INSERT INTO public.zalo_users (account_id, zalo_uid, global_id, raw_payload, staff_id, organization_id) VALUES ($1, $2, $3, $4, ${STAFF}, ${ORG})
        ON CONFLICT (account_id, zalo_uid) DO UPDATE SET global_id = COALESCE(NULLIF(EXCLUDED.global_id, ''), public.zalo_users.global_id),
          raw_payload = COALESCE(public.zalo_users.raw_payload, '{}'::jsonb) || EXCLUDED.raw_payload`
      await db.query(sqlChat, [F, 'f-scan', G('real-f'), PROFILE('f-scan', G('real-f'))])
      assert.equal(await gid(F, 'f-scan'), G('real-f'))
      await db.query(sqlChat, [F, 'f-new2', G('real-f2'), PROFILE('f-new2', G('real-f2'))])
      assert.equal(await gid(F, 'f-new2'), G('real-f2'))
    })
    await check('Desktop đọc hồ sơ (gộp raw cũ quét nhóm + hồ sơ mới): ghi Global ID thật', async () => {
      await seed(A, 'a-scan2', G('ownA'), SCAN('a-scan2', G('ownA')))
      await db.query(`UPDATE public.zalo_users SET global_id=$3, raw_payload = raw_payload || $4::jsonb WHERE account_id=$1 AND zalo_uid=$2`, [A, 'a-scan2', G('real-s2'), PROFILE('a-scan2', G('real-s2'))])
      assert.equal(await gid(A, 'a-scan2'), G('real-s2'))
    })
    await check('UPDATE không đụng global_id không bị ảnh hưởng (is_fr)', async () => {
      await db.query(`UPDATE public.zalo_users SET is_fr=1 WHERE account_id=$1 AND zalo_uid='a-real'`, [A])
      assert.equal(await gid(A, 'a-real'), G('real-a'))
    })
    await check('lô sửa dữ liệu chạy được khi có trigger; hoàn tác cần tắt chặn trong giao dịch', async () => {
      await db.query(`SELECT set_config('aka.zalo_gid_guard', 'off', false)`)
      await seed(A, 'a-legacy', G('ownA'), SCAN('a-legacy', G('ownA')))     // dòng sai có từ trước
      await db.query(`SELECT set_config('aka.zalo_gid_guard', '', false)`)
      assert.equal(await gid(A, 'a-legacy'), G('ownA'))
      await db.query(R.setupSql)
      const r = (await one(R.batchSql(9901, 9902))).r
      assert.ok(r.updated >= 1)
      assert.equal(await gid(A, 'a-legacy'), null)
      // hoàn tác không tắt chặn: trigger giữ trống
      await db.query(R.rollbackSql(9901, 9902))
      assert.equal(await gid(A, 'a-legacy'), null)
      // tắt chặn trong giao dịch: trả lại được
      await db.query('BEGIN'); await db.query(`SELECT set_config('aka.zalo_gid_guard', 'off', true)`); await db.query(R.rollbackSql(9901, 9902)); await db.query('COMMIT')
      assert.equal(await gid(A, 'a-legacy'), G('ownA'))
      assert.equal(await one(`SELECT current_setting('aka.zalo_gid_guard', true) v`).then(x => x.v), '')
    })
    await check('tốc độ: 5.000 dòng bạn bè upsert có trigger vs không', async () => {
      const rows = k => Array.from({ length: 5000 }, (_, i) => ({ account_id: A, zalo_uid: `perf${k}-${i}`, global_id: G('pf' + k + i), raw_payload: PROFILE(`perf${k}-${i}`, G('pf' + k + i)), display_name: 'p' }))
      let t0 = Date.now(); await upsertAll(rows('a')); const withT = Date.now() - t0
      await db.query('BEGIN'); await db.query(`SELECT set_config('aka.zalo_gid_guard', 'off', true)`)
      await db.query('ALTER TABLE public.zalo_users DISABLE TRIGGER trg_zalo_users_guard_global_id_ins')
      t0 = Date.now(); await upsertAll(rows('b')); const without = Date.now() - t0
      await db.query('ROLLBACK')
      console.log(`     5.000 dòng: có trigger ${withT} ms, không trigger ${without} ms`)
      assert.ok(withT < without * 4 + 500, 'trigger làm chậm quá nhiều')
    })
    await check('gỡ V668 p1 rồi apply lại', async () => {
      await db.query(RB1); await db.query(`DELETE FROM supabase_migrations.schema_migrations WHERE name='migration_v668_zalo_users_global_id_guard_p1'`)
      assert.equal((await one(`SELECT count(*)::int n FROM pg_trigger WHERE tgname LIKE 'trg_zalo_users_guard%'`)).n, 0)
      await db.query(P1)
      assert.equal((await one(`SELECT count(*)::int n FROM pg_trigger WHERE tgname LIKE 'trg_zalo_users_guard%'`)).n, 2)
    })
  } finally { await T.stop() }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  if (failed) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
