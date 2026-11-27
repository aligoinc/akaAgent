#!/usr/bin/env node
'use strict'
/*
 * Phát lại danh sách tag Zalo THẬT qua Bot sự kiện: chuỗi ảnh chụp `account_tags_snapshot` của runtime Fly (Zalo thật trả,
 * mã hội thoại đã che) → getLabels giả trả đúng từng ảnh theo thứ tự → ZaloTagSyncRuntime thật (Desktop) → V660 thật → trigger V672
 * → EventBotRuntime thật gửi. So việc bot tạo ra với kết quả tính độc lập từ chính các ảnh (gắn / gỡ, nhóm, gắn hàng loạt, xoá tag).
 *
 * Đầu vào (ngoài repo, chỉ đọc production): mảng [{b, seq, v, at, present:[tagId], tags:[{id, add:[cid], rem:[cid]}]}] theo (b, seq):
 * seq 1 = danh sách đầy đủ (add từ rỗng), seq sau = phần đổi so với ảnh trước; mỗi phiên bản lấy ảnh đọc được đầu tiên.
 * Cách chạy: PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/event-bot/fuzz/tag-replay.cjs <tệp.json> [tệp.json…] [--verbose]
 */
const fs = require('fs')
const { startCluster, buildTs } = require('./cluster.cjs')

const args = process.argv.slice(2)
const VERBOSE = args.includes('--verbose')
const files = args.filter(a => !a.startsWith('--'))
if (!files.length) { console.error('Thiếu tệp dữ liệu'); process.exit(2) }
const { ZaloTagSyncRuntime } = buildTs('src/main/services/zaloTagSyncRuntime.ts')
const { EventBotRuntime } = buildTs('src/main/services/eventBotRuntime.ts')

const ORG = 10
const STAFF = 100
const BULK = 20

async function asDesktop(c, sql, params) {
  await c.query('BEGIN')
  try {
    await c.query(`SELECT set_config('test.staff', $1, true)`, [String(STAFF)])
    await c.query('SET LOCAL ROLE aka_agent_desktop')
    const r = (await c.query(sql, params)).rows[0].r
    await c.query('COMMIT')
    return r
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e }
}

async function main() {
  const rows = files.flatMap(f => JSON.parse(fs.readFileSync(f, 'utf8')))
  const byB = new Map()
  for (const r of rows) { if (!byB.has(r.b)) byB.set(r.b, []); byB.get(r.b).push(r) }
  for (const list of byB.values()) list.sort((a, b) => a.seq - b.seq)
  const sources = [...byB.keys()]

  const cluster = await startCluster({})
  const db = await cluster.fresh()
  const c = await db.connect()
  const conns = []
  const conn = async () => { const x = await db.connect(); conns.push(x); return x }
  const issues = []
  const report = []
  try {
    await c.query(`INSERT INTO org_staff (id, organization_id, name) VALUES ($1,$2,'NV')`, [STAFF, ORG])
    await c.query(`UPDATE auto_system_settings SET value='true' WHERE key='zalo.tag_sync.enabled'`)
    await c.query(`UPDATE auto_system_settings SET value=$1 WHERE key='event_bot'`, [JSON.stringify({ audience: 'all', runtimes: { desktop: true, server: true, fly: false } })])

    // Mỗi tài khoản Fly → một tài khoản Zalo QR cục bộ; Zalo giả trả ảnh hiện tại của nó.
    const accOf = new Map(); const zalo = new Map()
    let i = 0
    for (const b of sources) {
      const acc = 3000 + (++i)
      accOf.set(b, acc)
      await c.query(`INSERT INTO zalo_accounts (id, zalo_uid, display_name) VALUES ($1,$2,$3)`, [acc, '9' + acc, 'Zalo ' + acc])
      await c.query(`INSERT INTO auto_accounts (id, name, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, zalo_account_id)
        VALUES ($1,$2,$3,$4,'zalo',false,false,$1)`, [acc, 'TK ' + acc, STAFF, ORG])
      zalo.set(acc, { version: null, tags: new Map() })
    }

    // Quy tắc: mọi tag từng thấy, cả chiều gắn lẫn gỡ (tối đa 20 tag mỗi quy tắc), không khoảng cách tối thiểu, không chờ.
    for (const b of sources) {
      const tagIds = [...new Set(byB.get(b).flatMap(r => [...(r.present || []), ...(r.tags || []).map(t => t.id)]))].map(String).sort((x, y) => Number(x) - Number(y))
      const rules = []
      for (let k = 0; k < tagIds.length; k += 20) {
        const ids = tagIds.slice(k, k + 20)
        for (const direction of ['added', 'removed']) {
          rules.push({ eventType: 'tag_change', name: `${direction} ${k}`, enabled: true,
            config: { direction, tagIds: ids, tagNames: ids.map(x => 'Tag ' + x), message: direction === 'added' ? 'Chào #{FULL_NAME}' : 'Tạm biệt #{FULL_NAME}', delay: { minSeconds: 0, maxSeconds: 0 } } })
        }
      }
      const out = (await c.query('SELECT public.aka_agent_control_event_bot($1,$2,$3,$4::jsonb) r', [STAFF, ORG, 'save',
        JSON.stringify({ accountId: accOf.get(b), revision: 0, enabled: true, blocklistIds: [], rules })])).rows[0].r
      if (!out || out.ok === false) throw new Error('save lỗi: ' + JSON.stringify(out))
    }

    let clock = 1_000_000
    const tagConn = await conn()
    const peek = async acc => {
      const z = zalo.get(acc)
      if (!z || z.version == null) return null
      const labelData = [...z.tags.entries()].map(([id, set]) => ({ id: Number(id), text: 'Tag ' + id, textKey: 'Tag ' + id, conversations: [...set], color: '#ff0000', offset: 0, emoji: '', createTime: 0 }))
      return { version: String(z.version), labels: labelData }
    }
    const tagRt = new ZaloTagSyncRuntime({
      loadAccounts: () => asDesktop(tagConn, 'SELECT public.aka_agent_desktop_zalo_tag_sync_accounts() r'),
      sync: items => asDesktop(tagConn, 'SELECT public.aka_agent_desktop_sync_zalo_tags($1::jsonb) r', [JSON.stringify(items)]),
      readLabels: peek, now: () => clock, setTimer: () => 1, clearTimer: () => {}, warn: () => {}
    })

    // Bot gửi thật (Desktop), Zalo gửi giả ghi lại.
    const sends = []
    const botConn = await conn()
    let botClock = 0
    const held = [...accOf.values()]
    const bot = new EventBotRuntime({
      source: 'desktop', runnerId: 'desktop:replay', active: () => true, canStartWork: () => true,
      isHeld: id => held.includes(id), listHeldAccounts: () => held,
      sync: () => asDesktop(botConn, 'SELECT public.aka_agent_desktop_event_bot_sync_v1() r'),
      birthdays: () => ({ ok: true, created: 0 }),
      claim: (runnerId, ids, limit) => asDesktop(botConn, 'SELECT public.aka_agent_desktop_event_bot_claim_v1($1, $2::bigint[], $3) r', [runnerId, ids, limit]),
      report: (jobId, token, result) => asDesktop(botConn, 'SELECT public.aka_agent_desktop_event_bot_report_v1($1, $2::uuid, $3::jsonb) r', [jobId, token, JSON.stringify(result)]),
      port: {
        async sendText(accountId, uid, text) { sends.push({ accountId, uid, text }); return { msgId: 'z' + sends.length } },
        async getProfile() { return { displayName: 'Khách', originalName: null, gender: 1 } },
        errorHints: () => ({}), businessNow: async () => new Date()
      },
      readFriendsPage: async () => [],
      vietnamDate: async () => (await c.query(`SELECT to_char(timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date, 'YYYY-MM-DD') d`)).rows[0].d,
      isRpcMissing: e => e && e.code === 'PGRST202', now: () => botClock, wallNow: () => Date.now(),
      sleep: async ms => { botClock += ms }, setTimer: () => 1, clearTimer: () => {}, random: Math.random, warn: () => {}, info: () => {}
    })
    bot.start()

    const mark = async () => Number((await c.query('SELECT COALESCE(max(id),0) m FROM auto_event_bot_jobs')).rows[0].m)
    const maxSeq = Math.max(...rows.map(r => r.seq))
    const totals = { steps: 0, expectPending: 0, expectSkipped: {}, gotPending: 0, gotSkipped: {} }
    const inc = (o, k) => { o[k] = (o[k] || 0) + 1 }

    for (let seq = 1; seq <= maxSeq; seq++) {
      const expect = []
      for (const b of sources) {
        const r = byB.get(b).find(x => x.seq === seq)
        if (!r) continue
        const acc = accOf.get(b); const z = zalo.get(acc)
        const present = new Set((r.present || []).map(String))
        const before = new Map([...z.tags].map(([k, v]) => [k, new Set(v)]))
        for (const t of r.tags || []) {
          const id = String(t.id)
          if (!z.tags.has(id)) z.tags.set(id, new Set())
          for (const x of t.add) z.tags.get(id).add(x)
          for (const x of t.rem) z.tags.get(id).delete(x)
        }
        for (const id of [...z.tags.keys()]) if (!present.has(id)) z.tags.delete(id)
        z.version = r.v
        if (seq === 1) continue // lần đọc đầu sau khi bật quy tắc: chỉ lấy mốc
        // Kỳ vọng tính độc lập từ hai ảnh liên tiếp.
        for (const id of new Set([...before.keys(), ...z.tags.keys()])) {
          const o = before.get(id) || new Set(); const n = z.tags.get(id) || new Set()
          const add = [...n].filter(x => !o.has(x)); const rem = [...o].filter(x => !n.has(x))
          for (const [kind, list] of [['added', add], ['removed', rem]]) {
            for (const uid of list) {
              let reason = null
              if (uid.startsWith('g')) reason = 'not_person'
              else if (kind === 'removed' && list.length >= 2 && !z.tags.has(id)) reason = 'tag_deleted'
              else if (list.length > BULK) reason = 'bulk_tag'
              expect.push({ acc, tag: id, uid, dir: kind, reason })
            }
          }
        }
      }
      const m = await mark()
      clock += 60_000
      await tagRt.tick()
      const got = (await c.query('SELECT account_id, tag_id, recipient_uid, direction, status, reason_code FROM auto_event_bot_jobs WHERE id > $1', [m])).rows
      if (seq === 1) { if (got.length) issues.push({ seq, kind: 'baseline_jobs', n: got.length }); continue }
      totals.steps++
      const key = x => `${x.acc ?? x.account_id}|${x.tag ?? x.tag_id}|${x.uid ?? x.recipient_uid}|${x.dir ?? x.direction}`
      const gm = new Map(got.map(g => [key(g), g]))
      for (const e of expect) {
        if (e.reason) inc(totals.expectSkipped, e.reason); else totals.expectPending++
        const g = gm.get(key(e))
        if (!g) { issues.push({ seq, kind: 'missing', ...e }); continue }
        gm.delete(key(e))
        const gotReason = g.status === 'skipped' ? g.reason_code : null
        if (gotReason) inc(totals.gotSkipped, gotReason); else totals.gotPending++
        if (gotReason !== e.reason) issues.push({ seq, kind: 'reason', ...e, got: gotReason })
      }
      for (const g of gm.values()) issues.push({ seq, kind: 'extra', acc: Number(g.account_id), tag: g.tag_id, uid: '…' + String(g.recipient_uid).slice(-4), dir: g.direction, got: g.reason_code })
    }

    // Gửi: chạy bot tới khi hết việc đến hạn.
    for (let k = 0; k < 2000; k++) {
      await c.query(`UPDATE auto_event_bot_jobs SET send_after = clock_timestamp() - interval '1 second' WHERE status='pending' AND send_after > clock_timestamp()`)
      botClock += 120_000; bot.refreshSoon(); await bot.tick()
      if (Number((await c.query(`SELECT count(*) n FROM auto_event_bot_jobs WHERE status IN ('pending','sending')`)).rows[0].n) === 0) break
    }
    const st = (await c.query(`SELECT status || COALESCE(':' || reason_code, '') status, count(*)::int n FROM auto_event_bot_jobs GROUP BY 1 ORDER BY 1`)).rows
    const dupSends = sends.length - new Set(sends.map(s => `${s.accountId}|${s.uid}|${s.text}`)).size
    report.push({ accounts: sources.length, versions: rows.length, ...totals, jobStatus: Object.fromEntries(st.map(x => [x.status, x.n])), sends: sends.length, dupSends })
    bot.stop(); await bot.waitForIdle(1000)
  } finally {
    for (const x of conns) await x.end().catch(() => {})
    await c.end().catch(() => {}); await cluster.drop(db.name).catch(() => {}); await cluster.end()
  }
  console.log(JSON.stringify(report[0]))
  const shown = VERBOSE ? issues : issues.slice(0, 20)
  for (const x of shown) console.log('LỆCH', JSON.stringify({ ...x, uid: x.uid ? '…' + String(x.uid).slice(-4) : undefined }))
  console.log(JSON.stringify({ issues: issues.length }))
  process.exit(issues.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
