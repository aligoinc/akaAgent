#!/usr/bin/env node
// Kiểm SQL sửa zalo_users.global_id (scripts/zalo-users-gid-repair.cjs) trên PostgreSQL cục bộ (fixture V657 + V666, không I/O production):
// đủ loại dòng như production 26/11/2026, chạy lặp lô theo khoảng tài khoản, chạy lại không đổi gì, dòng đang bị khoá để lô sau, app cũ
// ghi sai lại sau khi sửa, hoàn tác (không đè giá trị app ghi sau), tài khoản 12.000 dòng (nhiều lô, kế hoạch dùng chỉ mục một phần).
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/zalo-users-gid-repair-smoke.cjs
'use strict'
process.env.SX_WITH_V666 ??= '1'
const assert = require('node:assert/strict')
const path = require('node:path')
const { buildDb } = require('./send-exclusion-v657-fixture.cjs')
const R = require('./zalo-users-gid-repair.cjs')
const { Client } = require(path.join(process.env.PG_MODULE_DIR || process.env.CHAT_REPO || '', 'node_modules/pg'))

let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e.stack || e.message).split('\n').slice(0, 6).join('\n')) }
}
const G = k => ('G' + k).padEnd(32, '0')
const SCAN = (uid, gid) => ({ id: uid, ...(gid ? { globalId: gid } : {}), source: 'profile', zaloGroupId: '6784869142295974592', zaloName: 'tv ' + uid })
const PROFILE = (uid, gid) => ({ userId: uid, globalId: gid, zaloName: 'hs ' + uid, bizPkg: { pkgId: 0 } })
const SCAN_THEN_PROFILE = (uid, gid) => ({ ...SCAN(uid, G('viewer')), userId: uid, globalId: gid })

async function main() {
  const T = await buildDb({ label: 'aka-gidrepair-' })
  const { db, one, q } = T
  let seq = 880000
  const id = () => ++seq
  const cols = {}
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    if (!rows.length) return
    cols[table] ??= (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
    const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols[table].includes(k))
    const list = keys.map(k => `"${k}"`).join(', ')
    await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`, [JSON.stringify(rows)])
  }
  try {
    await T.applyV657()
    const ORG = 8801, STAFF = 880101
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org sửa gid') ON CONFLICT DO NOTHING`, [ORG])
    await ins('org_staff', { id: STAFF, organization_id: ORG, username: 'rp', password: 'pw', is_active: true })
    // Tài khoản: desk = Global ID của nick ở zalo_accounts.metadata, fly = ở chat_zalo_account (liên kết Fly), không có = không ghi nhận.
    const acc = async (accId, { desk, fly, nick } = {}) => {
      let za = null
      if (desk) { za = id(); await ins('zalo_accounts', { id: za, zalo_uid: nick, metadata: { globalId: desk } }) }
      await ins('auto_accounts', { id: accId, name: 'Zalo ' + accId, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
        staff_id: STAFF, organization_id: ORG, is_zalo_server: !!fly, is_zalo_show_web: false, zalo_account_id: za })
      if (fly) { const ca = id(); await ins('chat_zalo_account', { id: ca, zalo_id: nick + (desk ? '' : ''), global_id: fly })
        await ins('chat_zalo_account_organization', { id: id(), chat_zalo_account_id: ca, organization_id: ORG, auto_account_id: accId, is_active: true }) }
      return accId
    }
    const T0 = '2026-11-01T00:00:00.000Z'
    const expect = new Map()   // id → { gid, reason }
    const rows = []
    const zu = (account, uid, gid, raw, want, reason = null) => {
      const rid = id(); rows.push({ id: rid, account_id: account, zalo_uid: uid, global_id: gid, raw_payload: raw, zalo_name: 'n ' + uid, staff_id: STAFF, organization_id: ORG,
        is_fr: 0, updated_at: T0, last_seen_at: T0 })
      expect.set(rid, { gid: want, reason, account, uid }); return rid
    }
    const A1 = await acc(9001, { desk: G('ownA1'), nick: 'nickA1' })                       // QR, Global ID của nick ở zalo_accounts
    const A2 = await acc(9002, { fly: G('ownA2'), nick: 'nickA2' })                        // Server (Fly), Global ID ở chat_zalo_account
    const A3 = await acc(9003, { desk: G('ownA3d'), fly: G('ownA3f'), nick: 'nickA3' })    // cả hai nơi, hai giá trị khác nhau
    const A4 = await acc(9004)                                                            // không ghi nhận nick ở đâu
    const A5 = await acc(9005, { desk: G('ownA5new'), nick: 'nickA5' })                    // đổi nick: còn dòng của nick cũ G('old5')
    const A6 = await acc(9100, { desk: G('ownA6'), nick: 'nickA6' })                       // ngoài khoảng lô đầu
    const A7 = await acc(9006, { desk: G('ownA7'), nick: 'nickA7' })                       // 12.000 dòng quét nhóm
    // A1
    zu(A1, 'a1-s1', G('ownA1'), SCAN('a1-s1', G('ownA1')), null, 'R1_group_scan_viewer_gid')
    zu(A1, 'a1-s2', G('ownA1'), SCAN('a1-s2', null), null, 'R1_group_scan_viewer_gid')
    zu(A1, 'a1-c1', G('ownA1'), PROFILE('a1-c1', G('real-c1')), G('real-c1'), 'R2_restore_profile_gid')
    zu(A1, 'a1-c2', G('ownA1'), PROFILE('a1-c2', G('ownA1')), null, 'R3_own_gid')
    zu(A1, 'a1-o1', G('ownA1'), {}, null, 'R3_own_gid')
    zu(A1, 'a1-f1', G('real-f1'), PROFILE('a1-f1', G('real-f1')), G('real-f1'))
    zu(A1, 'a1-f2', G('real-f2'), {}, G('real-f2'))
    zu(A1, 'a1-f3', G('real-f3'), SCAN_THEN_PROFILE('a1-f3', G('real-f3')), G('real-f3'))
    zu(A1, 'nickA1', G('ownA1'), SCAN('nickA1', G('ownA1')), G('ownA1'))                    // dòng của chính nick
    zu(A1, 'a1-n1', null, SCAN('a1-n1', G('ownA1')), null)
    zu(A1, 'a1-k1', G('real-k1'), SCAN('a1-k1', G('ownA1')), G('real-k1'))                 // quét nhóm rồi được ghi Global ID khác mà không đổi raw: giữ
    zu(A1, 'a1-n2', '', SCAN('a1-n2', G('ownA1')), '')
    // A2 (Fly)
    zu(A2, 'a2-s1', G('ownA2'), SCAN('a2-s1', G('ownA2')), null, 'R1_group_scan_viewer_gid')
    zu(A2, 'a2-o1', G('ownA2'), PROFILE('a2-o1', G('ownA2')), null, 'R3_own_gid')
    zu(A2, 'a2-f1', G('real-a2'), PROFILE('a2-f1', G('real-a2')), G('real-a2'))
    zu(A2, 'nickA2', G('ownA2'), PROFILE('nickA2', G('ownA2')), G('ownA2'))
    // A3 (hai Global ID của nick)
    zu(A3, 'a3-s1', G('ownA3d'), SCAN('a3-s1', G('ownA3d')), null, 'R1_group_scan_viewer_gid')
    zu(A3, 'a3-s2', G('ownA3f'), SCAN('a3-s2', G('ownA3f')), null, 'R1_group_scan_viewer_gid')
    zu(A3, 'a3-c1', G('ownA3f'), PROFILE('a3-c1', G('real-a3')), G('real-a3'), 'R2_restore_profile_gid')
    zu(A3, 'a3-c2', G('ownA3f'), PROFILE('a3-c2', G('ownA3d')), null, 'R3_own_gid')
    // A4 (nick không ghi nhận): dòng quét nhóm 5 dòng cùng Global ID người xem; dòng bị đè; dòng không có dấu vết giữ nguyên (giới hạn).
    for (let k = 0; k < 5; k++) zu(A4, 'a4-s' + k, G('viewer4'), SCAN('a4-s' + k, G('viewer4')), null, 'R1_group_scan_viewer_gid')
    zu(A4, 'a4-c1', G('viewer4'), PROFILE('a4-c1', G('real-a4')), G('real-a4'), 'R2_restore_profile_gid')
    zu(A4, 'a4-x1', G('viewer4'), {}, G('viewer4'))
    zu(A4, 'a4-f1', G('real-a4b'), PROFILE('a4-f1', G('real-a4b')), G('real-a4b'))
    // A5 (đổi nick): dòng quét của nick cũ; dòng quét cũ bị quét lại dưới nick mới (raw còn Global ID nick cũ, cột Global ID nick mới).
    for (let k = 0; k < 3; k++) zu(A5, 'a5-s' + k, G('old5'), SCAN('a5-s' + k, G('old5')), null, 'R1_group_scan_viewer_gid')
    zu(A5, 'a5-r1', G('ownA5new'), SCAN('a5-r1', G('old5')), null, 'R1_group_scan_viewer_gid')
    zu(A5, 'a5-f1', G('old5'), PROFILE('a5-f1', G('old5')), G('old5'))                      // chủ nick cũ là bạn của nick mới: đúng
    // A6 ngoài khoảng lô đầu
    zu(A6, 'a6-s1', G('ownA6'), SCAN('a6-s1', G('ownA6')), null, 'R1_group_scan_viewer_gid')
    // A7: 12.000 dòng quét nhóm (Global ID của nick) + 50 dòng đúng
    for (let k = 0; k < 12000; k++) zu(A7, 'a7-s' + k, G('ownA7'), SCAN('a7-s' + k, G('ownA7')), null, 'R1_group_scan_viewer_gid')
    for (let k = 0; k < 50; k++) zu(A7, 'a7-f' + k, G('a7real' + k), PROFILE('a7-f' + k, G('a7real' + k)), G('a7real' + k))
    for (let i = 0; i < rows.length; i += 2000) await ins('zalo_users', rows.slice(i, i + 2000))
    await db.query('ANALYZE public.zalo_users')
    const before = new Map((await q(`SELECT id, global_id FROM public.zalo_users WHERE account_id BETWEEN 9001 AND 9100`)).map(r => [Number(r.id), r.global_id]))

    // Một lượt: từ lo đi tiếp theo nextFrom tới hi.
    const runBatches = async (lo, hi, limit = 5000, budgetMs = 20000) => {
      const counts = []; const reasons = {}; let from = lo
      for (let k = 0; k < 500 && from < hi; k++) {
        const r = (await one(R.batchSql(from, hi, limit, budgetMs))).r
        counts.push(r.updated)
        for (const [k2, v] of Object.entries(r.byReason)) reasons[k2] = (reasons[k2] ?? 0) + v
        assert.ok(Number(r.nextFrom) >= from, 'nextFrom lùi')
        from = Number(r.nextFrom)
      }
      return { counts, reasons, total: counts.reduce((a, b) => a + b, 0) }
    }
    const state = async () => new Map((await q(`SELECT id, global_id, updated_at, last_seen_at FROM public.zalo_users WHERE account_id BETWEEN 9001 AND 9100`)).map(r => [Number(r.id), r]))

    await db.query(R.setupSql)
    await check('setup tạo bảng lưu, chạy lại không lỗi', async () => { await db.query(R.setupSql); assert.equal((await one(`SELECT count(*)::int n FROM ${R.TABLE}`)).n, 0) })

    let first
    await check('lô theo khoảng [9001, 9007): sửa đúng mọi dòng, không đụng tài khoản ngoài khoảng, 12.000 dòng qua nhiều lô', async () => {
      const t0 = Date.now()
      first = await runBatches(9001, 9007)
      const ms = Date.now() - t0
      const s = await state()
      const wrong = []
      for (const [rid, e] of expect) {
        if (e.account === A6) continue
        const got = s.get(rid).global_id
        if ((got ?? null) !== (e.gid ?? null)) wrong.push({ uid: e.uid, want: e.gid, got })
      }
      assert.deepEqual(wrong.slice(0, 10), [])
      assert.equal(s.get([...expect].find(([, e]) => e.uid === 'a6-s1')[0]).global_id, G('ownA6'))
      assert.ok(first.counts.length >= 3, 'tài khoản 12.000 dòng phải qua ≥ 3 lô 5.000: ' + first.counts.join(','))
      assert.ok(first.counts.slice(0, -1).every(n => n === 5000), first.counts.join(','))
      console.log(`     lô: ${first.counts.join(' + ')} dòng, ${ms} ms; theo lý do ${JSON.stringify(first.reasons)}`)
    })
    await check('lý do và bản lưu khớp từng dòng; cột updated_at / last_seen_at không đổi', async () => {
      const bk = new Map((await q(`SELECT zalo_user_id, old_global_id, new_global_id, reason FROM ${R.TABLE}`)).map(r => [Number(r.zalo_user_id), r]))
      for (const [rid, e] of expect) {
        if (e.account === A6) continue
        const b = bk.get(rid)
        if (!e.reason) { assert.equal(b, undefined, 'không được lưu/sửa: ' + e.uid); continue }
        assert.ok(b, 'thiếu bản lưu: ' + e.uid)
        assert.equal(b.reason, e.reason, e.uid)
        assert.equal(b.old_global_id, before.get(rid), e.uid)
        assert.equal(b.new_global_id ?? null, e.gid ?? null, e.uid)
      }
      const s = await state()
      for (const [, r] of s) { assert.equal(new Date(r.updated_at).toISOString(), T0); assert.equal(new Date(r.last_seen_at).toISOString(), T0) }
    })
    await check('quét lại cả khoảng: 0 dòng', async () => { assert.equal((await runBatches(9001, 9007)).total, 0) })
    await check('lô sau [9007, 9200) sửa tài khoản còn lại', async () => {
      const r = await runBatches(9007, 9200)
      assert.equal(r.total, 1)
      assert.equal((await state()).get([...expect].find(([, e]) => e.uid === 'a6-s1')[0]).global_id, null)
    })
    await check('dòng đang bị khoá (app đang ghi) được bỏ qua, lô sau sửa', async () => {
      const rid = zu(A1, 'a1-lock', G('ownA1'), SCAN('a1-lock', G('ownA1')), null, 'R1_group_scan_viewer_gid')
      await ins('zalo_users', rows.at(-1))
      const other = new Client({ host: db.host, port: db.port, user: db.user, database: db.database })
      await other.connect()
      try {
        await other.query('BEGIN'); await other.query('SELECT id FROM public.zalo_users WHERE id=$1 FOR UPDATE', [rid])
        assert.equal((await runBatches(9001, 9007)).total, 0)
        assert.equal((await one(`SELECT global_id FROM public.zalo_users WHERE id=$1`, [rid])).global_id, G('ownA1'))
        await other.query('COMMIT')
      } finally { await other.end() }
      assert.equal((await runBatches(9001, 9007)).total, 1)
      assert.equal((await one(`SELECT global_id FROM public.zalo_users WHERE id=$1`, [rid])).global_id, null)
    })
    await check('app cũ ghi sai lại sau khi sửa: lô sau sửa lại, bản lưu giữ giá trị sai mới nhất', async () => {
      const rid = [...expect].find(([, e]) => e.uid === 'a1-c1')[0]
      await db.query(`UPDATE public.zalo_users SET global_id=$2 WHERE id=$1`, [rid, G('ownA1')])
      assert.equal((await runBatches(9001, 9007)).total, 1)
      assert.equal((await one(`SELECT global_id FROM public.zalo_users WHERE id=$1`, [rid])).global_id, G('real-c1'))
      const b = await one(`SELECT old_global_id, new_global_id FROM ${R.TABLE} WHERE zalo_user_id=$1`, [rid])
      assert.equal(b.old_global_id, G('ownA1')); assert.equal(b.new_global_id, G('real-c1'))
    })
    await check('hoàn tác: trả giá trị trước lần sửa; dòng app đã ghi giá trị mới sau khi sửa thì giữ', async () => {
      const appRid = [...expect].find(([, e]) => e.uid === 'a1-s1')[0]
      await db.query(`UPDATE public.zalo_users SET global_id=$2 WHERE id=$1`, [appRid, G('real-s1-from-profile')])
      const n = (await db.query(R.rollbackSql(0, 100000))).rowCount
      const s = await state()
      const bk = await q(`SELECT zalo_user_id FROM ${R.TABLE}`)
      assert.equal(n, bk.length - 1)
      for (const [rid, e] of expect) {
        if (rid === appRid) { assert.equal(s.get(rid).global_id, G('real-s1-from-profile')); continue }
        if (e.uid === 'a1-lock') continue
        assert.equal(s.get(rid).global_id ?? null, before.get(rid) ?? null, 'hoàn tác sai: ' + e.uid)
      }
    })
    await check('sửa lại sau hoàn tác: cùng kết quả (trừ dòng app đã ghi Global ID đọc từ hồ sơ)', async () => {
      await runBatches(0, 100000)
      const s = await state()
      for (const [rid, e] of expect) {
        if (e.uid === 'a1-s1') { assert.equal(s.get(rid).global_id, G('real-s1-from-profile')); continue }
        assert.equal(s.get(rid).global_id ?? null, e.gid ?? null, e.uid)
      }
    })
    await check('ngân sách thời gian 0 ms: mỗi lô dừng sau một tài khoản, lượt vẫn đi hết và cùng kết quả', async () => {
      await db.query(R.rollbackSql(0, 100000))
      const r = await runBatches(9001, 9200, 5000, 0)
      assert.ok(r.counts.length >= 7, 'phải ≥ 1 lô mỗi tài khoản: ' + r.counts.length)
      const s = await state()
      for (const [rid, e] of expect) {
        if (e.uid === 'a1-s1') continue
        assert.equal(s.get(rid).global_id ?? null, e.gid ?? null, e.uid)
      }
    })
    await check('procedure (CALL, COMMIT sau mỗi câu ≤ 700 dòng): cùng kết quả như hàm', async () => {
      await db.query(R.rollbackSql(0, 100000))
      let from = 9001, calls = 0
      while (from < 9200 && calls < 100) { const r = (await one(R.runSql(from, 9200, 60000, 700))).p_result; from = Number(r.nextFrom); calls++ }
      const s = await state()
      for (const [rid, e] of expect) {
        if (e.uid === 'a1-s1') continue
        assert.equal(s.get(rid).global_id ?? null, e.gid ?? null, e.uid)
      }
    })
    await check('trong lúc procedure sửa tài khoản 12.000 dòng, app upsert đúng các dòng đó với statement_timeout 3s không bị hủy', async () => {
      await db.query(R.rollbackSql(9006, 9007))
      const other = new Client({ host: db.host, port: db.port, user: db.user, database: db.database })
      await other.connect()
      try {
        await other.query(`SET statement_timeout = '3s'`)
        const run = one(R.runSql(9006, 9007, 60000, 1000))
        let ok = 0
        for (let k = 0; k < 40; k++) {
          await other.query(`INSERT INTO public.zalo_users (id, account_id, zalo_uid, global_id, raw_payload, staff_id, organization_id) VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (account_id, zalo_uid) DO UPDATE SET display_name = 'app ' || $3`, [9900000 + k, A7, 'a7-s' + (k * 300), null, {}, 880101, 8801])
          ok++
        }
        const r = (await run).p_result
        assert.equal(ok, 40)
        assert.ok(r.updated >= 11000, 'procedure phải sửa tài khoản: ' + r.updated)
      } finally { await other.end() }
    })
    await check('kế hoạch lô: đi chỉ mục một phần idx_zalo_users_account_global_id (không quét bảng)', async () => {
      // trả 12.000 dòng về trạng thái sai để có việc; dữ liệu nền 120.000 dòng / 300 tài khoản (ít tài khoản thì planner quét cả bảng)
      await db.query(`UPDATE public.zalo_users SET global_id=$1 WHERE account_id=$2 AND zalo_uid LIKE 'a7-s%'`, [G('ownA7'), A7])
      await db.query(`INSERT INTO public.zalo_users (id, account_id, zalo_uid, global_id, raw_payload, staff_id, organization_id)
        SELECT 5000000+g, 20000 + g/400, 'bg'||g, 'GBG'||(g%7000), '{}'::jsonb, $1, $2 FROM generate_series(1,120000) g`, [STAFF, ORG])
      await db.query('ANALYZE public.zalo_users')
      await db.query('BEGIN')
      try {
        const own = (await one(`SELECT private.aka_agent_zalo_own_global_ids($1) o`, [A7])).o
        await db.query(`SET LOCAL plan_cache_mode = force_generic_plan`)
        await db.query(`PREPARE gid_repair_acc(bigint, text[], text[], integer) AS ` + R.accountStatementSql())
        const lit = v => `ARRAY[${v.map(x => `'${x}'`).join(',')}]::text[]`
        const plan = (await q(`EXPLAIN EXECUTE gid_repair_acc(${A7}, ${lit(own)}, ${lit(['nickA7'])}, 5000)`)).map(r => r['QUERY PLAN']).join('\n')
        await db.query('DEALLOCATE gid_repair_acc')
        console.log('     kế hoạch chung (generic) cho một tài khoản: ' + plan.split('\n').filter(l => /zalo_users zu|Index|Seq/.test(l)).map(l => l.trim()).join(' | '))
        assert.match(plan, /idx_zalo_users_account_global_id|idx_zalo_users_account_uid/)
        assert.doesNotMatch(plan, /Seq Scan on zalo_users/)
        const t0 = Date.now(); const r = (await one(R.batchSql(9006, 9007, 5000))).r; const ms = Date.now() - t0
        assert.ok((await one(`SELECT count(*)::int n FROM ${R.TABLE} b JOIN public.zalo_users z ON z.id=b.zalo_user_id WHERE z.account_id=$1 AND z.global_id IS NULL AND b.new_global_id IS NULL`, [A7])).n >= 5000, 'mọi dòng đã đổi phải có bản lưu')
        assert.equal(r.updated, 5000); assert.equal(Number(r.nextFrom), 9006)
        console.log(`     một lô 5.000 dòng (tài khoản 12.000 dòng sai, nền 120.000 dòng / 300 tài khoản): ${ms} ms trên DB thử`)
      } finally { await db.query('ROLLBACK') }
    })
  } finally { await T.stop() }
  console.log(`\n${passed} đạt, ${failed} lỗi`)
  if (failed) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
