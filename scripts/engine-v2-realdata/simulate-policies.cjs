// Mô phỏng chính sách engine v2 (V495 + V499 + V500) trên toàn bộ lịch sử thật của mọi loại chiến dịch Zalo,
// bằng aka_agent_engine_simulate_v1 trên PostgreSQL 17 cục bộ. Không cần lõi đã phủ loại đó: mỗi dòng lịch sử được đổi
// thành kết quả thô đúng như cổng Zalo trả (mã Zalo → zalo_code; errno → lỗi đường truyền theo loại thao tác) rồi hỏi
// DB quyết định gì, so với quyết định bộ cũ đã ghi.
//
//   node scripts/engine-v2-realdata/simulate-policies.cjs <snapshot.json> [--out report.json]
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('../build-v499-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')

const args = process.argv.slice(2)
const snapshotPath = args[0]
const outPath = (() => { const i = args.indexOf('--out'); return i >= 0 ? args[i + 1] : undefined })()
if (!snapshotPath) { console.error('Dùng: node simulate-policies.cjs <snapshot.json> [--out report.json]'); process.exit(2) }
const PORT = Number(process.env.ENGINE_SIMULATE_PORT || 55513)

const NUMERIC = /^-?\d+$/
const PRE_CONNECT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'EHOSTDOWN'])
const READ_ACTIONS = new Set(['zalo_find_phone_user'])

/** Kết quả thô mà cổng Zalo của engine trả cho đúng phản hồi Zalo đã ghi trong lịch sử. */
function rawOutcome(row) {
  const data = row.data || {}
  const z = data.zalo || {}
  // Desktop/VPS ghi mã ở data.zalo.code; bộ chạy cũ của Fly ghi ở data.rawCode.
  const rawCode = z.code ?? data.rawCode
  const code = rawCode === undefined || rawCode === null ? '' : String(rawCode)
  const message = String(z.message || data.error || row.log || '')
  const partial = data.partialSend ? { evidence: { partialDelivery: true } } : {}
  if (!code) {
    if (row.status === 'thành công') return { ok: true, actionCode: row.action_code }
    if (row.action_code === 'zalo_find_phone_user' && row.status === 'không tồn tại') {
      return { ok: false, actionCode: row.action_code, phase: 'after_send', signal: { kind: 'engine', code: 'find_user_without_uid', message: 'Không tồn tại' } }
    }
    return { ok: false, actionCode: row.action_code, phase: 'after_send', signal: { kind: 'message_like', message }, ...partial }
  }
  if (NUMERIC.test(code)) return { ok: false, actionCode: row.action_code, phase: 'after_send', signal: { kind: 'zalo_code', code, message }, ...partial }
  // errno: như classifyZaloError của lõi (đọc → chưa gửi; gửi → lỗi mở kết nối chưa gửi, còn lại không rõ).
  const read = READ_ACTIONS.has(row.action_code)
  const phase = read || PRE_CONNECT.has(code) ? 'before_send' : 'in_flight'
  return { ok: false, actionCode: row.action_code, phase, signal: { kind: 'errno', code, message },
    ...(phase === 'in_flight' ? { evidence: { deliveryState: 'unknown', ...(partial.evidence || {}) } } : partial) }
}

async function main() {
  const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  const campaigns = new Map(snap.campaigns.map(c => [Number(c.id), c]))
  const accounts = new Map(snap.accounts.map(a => [Number(a.id), a]))
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-engine-simulate-', timeoutMs: 30 * 60 * 1000 })
  const db = await connect()
  const matrix = {}
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    const cache = new Map()
    const statusName = new Map((await db.query(`SELECT id, name FROM public.auto_status`)).rows.map(r => [String(r.id), r.name]))
    for (const row of snap.details) {
      const c = campaigns.get(Number(row.campaign_id))
      if (!c) continue
      const runtime = accounts.get(Number(row.account_id))?.is_zalo_server ? 'fly' : 'desktop'
      const outcome = rawOutcome(row)
      const ck = JSON.stringify([c.action_id, runtime, outcome.ok, outcome.actionCode, outcome.phase, outcome.signal, outcome.evidence])
      let sim = cache.get(ck)
      if (!sim) {
        sim = (await db.query(`SELECT public.aka_agent_engine_simulate_v1($1, $2, $3::jsonb) AS r`, [c.action_id, runtime, JSON.stringify(outcome)])).rows[0].r
        cache.set(ck, sim)
      }
      const p = sim.policy || {}
      const oldKey = `${row.action_code}|${row.status}|${row.error_code ?? '-'}|tính lượt:${row.counts_toward_limit}`
      const newKey = `${sim.errorCode ?? '-'}(${sim.publicCode ?? '-'})|${p.detail_mode === 'suppress' ? 'không ghi' : statusName.get(String(p.detail_status_id)) ?? '?'}|quota:${p.quota_effect ?? '?'}|data:${p.target_effect ?? '?'}` +
        `|nhớ:${p.remember_target_days ?? 0}|chuỗi:${p.target_streak_effect ?? '?'}${p.streak_threshold ? '/' + p.streak_threshold : ''}` +
        `|chiến dịch:${p.campaign_effect ?? '?'}|nghỉ:${p.pace_mode ?? '?'}${p.lock_action_codes?.length ? '|khoá:' + p.lock_action_codes.length + ' thao tác ' + (p.lock_minutes ?? '') + 'p' : ''}`
      const key = `${c.action_id} :: ${oldKey} => ${newKey}`
      const m = matrix[key] ||= { count: 0, runtimes: {}, sample: { detailId: row.id, log: row.log, signal: outcome.signal ?? null } }
      m.count++
      m.runtimes[runtime] = (m.runtimes[runtime] || 0) + 1
    }
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  const rows = Object.entries(matrix).sort((a, b) => a[0].localeCompare(b[0]))
  let current = ''
  for (const [k, v] of rows) {
    const [type, rest] = k.split(' :: ')
    if (type !== current) { console.log(`\n== ${type}`); current = type }
    console.log(`${String(v.count).padStart(6)}  ${rest}`)
  }
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(matrix, null, 1))
}

main().catch(error => { console.error(error); process.exit(1) })
