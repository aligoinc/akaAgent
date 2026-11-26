// Phát lại thật cho V659: mọi lượt lỗi Facebook / Zalo của 7 ngày (đọc chỉ đọc từ production, gom theo tín hiệu) chạy qua phân loại và chính
// sách trên bản sao danh mục production, trước và sau V659. Không chạm DB thật.
//   CHAT_REPO=<akaAgentChatApi> node scripts/engine-v2-facebook/v659-replay.cjs <signals.json> [báo cáo.json]
// signals.json: mảng [action, phase, runtime, campaignAction, kind, code, errorCode, message, mãProductionĐangRa, lượt, tàiKhoản, chiếnDịch]
// (câu đọc ở đầu tệp này, chạy bằng `supabase db query --linked` trong giao dịch read only). Tệp có câu lỗi của khách: chỉ để thư mục tạm,
// không commit. Báo cáo chỉ ghi mã, luật khớp và số đếm, không ghi câu lỗi.
//
//   select json_agg(json_build_array(x.a, x.ph, x.rt, x.ca, x.k, x.cd, x.ec, x.m, x.cur, x.n, x.acc, x.camps)) from (
//     select o.action_code a, o.phase ph, r.runtime_target rt, c.action_id ca, o.signal->>'kind' k, o.signal->>'code' cd,
//            o.signal->>'errorCode' ec, left(o.signal->>'message', 600) m, o.error_code cur, count(*) n,
//            count(distinct o.account_id) acc, count(distinct o.campaign_id) camps
//       from public.auto_engine_outcomes o join public.auto_engine_target_runs r on r.id = o.target_run_id
//       left join public.auto_campaigns c on c.id = o.campaign_id
//      where o.created_at >= now() - interval '7 days' and not o.ok and (o.action_code like 'fb\_%' or o.action_code like 'zalo\_%')
//      group by 1,2,3,4,5,6,7,8,9) x;
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const V659 = require('../build-v659-sql.cjs')
const { makeReplicaBuilder } = require('./catalog-replica.cjs')

const PORT = Number(process.env.ENGINE_FB_V659_REPLAY_PORT || 55660)
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json'), 'utf8'))
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations', `${V659.NAME}.sql`), 'utf8')
const [signalsFile, outFile] = process.argv.slice(2)
if (!signalsFile) { console.error('Cần đường dẫn signals.json'); process.exit(1) }
const SIGNALS = JSON.parse(fs.readFileSync(signalsFile, 'utf8'))
  .map(([action, phase, runtime, campaignAction, kind, code, errorCode, message, current, n, accounts, campaigns]) => ({
    platform: action.startsWith('zalo_') ? 'zalo' : 'facebook', action, phase, runtime: runtime || 'desktop', campaignAction, current, n, accounts, campaigns,
    signal: { kind, code, errorCode, message } }))

const POLICY_KEYS = ['target_effect', 'target_streak_effect', 'streak_threshold', 'campaign_effect', 'lock_minutes', 'quota_effect', 'log_template']
async function decide(db) {
  const { rows } = await db.query(`SELECT (c->>'i')::int AS i, s.error_code AS code, s.rule_id, s.matched_by,
      public.aka_agent_engine_resolve_policy(s.error_code, NULL, c->>'action', c->>'ca', c->>'rt', c->>'phase') AS p
    FROM jsonb_array_elements($1::jsonb) c
    LEFT JOIN LATERAL public.aka_agent_engine_classify_signal(c->>'platform', c->>'action', c->>'phase', c->'signal') s ON true`,
  [JSON.stringify(SIGNALS.map((s, i) => ({ i, platform: s.platform, action: s.action, phase: s.phase, ca: s.campaignAction, rt: s.runtime, signal: s.signal })))])
  const out = new Array(SIGNALS.length)
  for (const r of rows) out[r.i] = { code: r.code, rule: r.rule_id, by: r.matched_by, p: Object.fromEntries(POLICY_KEYS.map(k => [k, r.p?.[k] ?? null])) }
  return out
}

// Chỉ mã trình duyệt / câu proxy trong câu lỗi (không chép câu của khách).
const errToken = message => (String(message ?? '').match(/\b(ERR_[A-Z0-9_]+)\b/) || [])[1]
  || (/Proxy connection ended before receiving CONNECT response/.test(String(message ?? '')) ? 'Proxy connection ended…' : '(không có mã ERR_)')
const add = (map, key, s) => { const v = map.get(key) || { n: 0, groups: 0, accounts: 0, campaigns: 0 }; v.n += s.n; v.groups++; v.accounts += s.accounts; v.campaigns += s.campaigns; map.set(key, v) }
const table = map => [...map].sort((a, b) => b[1].n - a[1].n).map(([key, v]) => ({ key, ...v }))

async function main() {
  const cluster = startCluster({ port: PORT, label: 'aka-fb-v659-replay-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  try {
    await makeReplicaBuilder(CATALOG)(db)
    await db.query('SET check_function_bodies = off')
    const rules = new Map((await db.query('SELECT id, pattern, signal_kind, source FROM public.auto_outcome_signal_rules')).rows.map(r => [Number(r.id), r]))
    const before = await decide(db)
    await db.query(MIGRATION)
    for (const r of (await db.query('SELECT id, pattern, signal_kind, source FROM public.auto_outcome_signal_rules')).rows) rules.set(Number(r.id), r)
    const after = await decide(db)

    const total = SIGNALS.reduce((a, s) => a + s.n, 0)
    // 1) Bản sao có ra đúng mã production đang ra không (mã đổi trong 7 ngày vì migration khác thì lệch, ghi riêng).
    const fidelity = new Map()
    let same = 0
    SIGNALS.forEach((s, i) => { if (before[i].code === s.current) same += s.n; else add(fidelity, `${s.platform} ${s.phase}: production ${s.current} / bản sao ${before[i].code}`, s) })
    // 2) Đổi mã do V659.
    const codeChanges = new Map()
    const unexpected = new Map()
    const expectedPattern = new Set(V659.RULES.map(r => r.pattern))
    // 3) Đổi chính sách mà không đổi mã (NET01 FB V575, câu NET01 Zalo).
    const policyOnly = new Map()
    SIGNALS.forEach((s, i) => {
      const b = before[i], a = after[i]
      if (b.code !== a.code) {
        const rule = rules.get(Number(a.rule))
        const key = `${s.platform} ${s.phase} ${errToken(s.signal.message)}: ${b.code} → ${a.code} (luật ${a.rule} ${rule?.source ?? '?'})`
        add(codeChanges, key, s)
        if (!rule || rule.source !== V659.SOURCE || !expectedPattern.has(rule.pattern)) add(unexpected, key, s)
        return
      }
      const diff = POLICY_KEYS.filter(k => JSON.stringify(b.p[k]) !== JSON.stringify(a.p[k]))
      if (diff.length) add(policyOnly, `${s.platform} ${s.action} ${s.phase} ${a.code}: ${diff.map(k => `${k} ${JSON.stringify(b.p[k])} → ${JSON.stringify(a.p[k])}`).join('; ')}`, s)
    })
    // 4) Cách xử lý sau V659 của mọi lượt đổi mã: data đi đâu, có dừng chiến dịch không.
    const effects = new Map()
    SIGNALS.forEach((s, i) => {
      const b = before[i], a = after[i]
      if (b.code === a.code) return
      add(effects, `${s.platform} ${a.code}: data ${b.p.target_effect} → ${a.p.target_effect}, chuỗi ${b.p.target_streak_effect} → ${a.p.target_streak_effect}` +
        ` (ngưỡng ${a.p.streak_threshold ?? '-'}), chiến dịch ${b.p.campaign_effect} → ${a.p.campaign_effect}, khoá ${a.p.lock_minutes ?? '-'} phút`, s)
    })
    const report = {
      readAt: new Date().toISOString(), groups: SIGNALS.length, outcomes: total,
      fidelity: { same, total, mismatches: table(fidelity) },
      codeChanges: table(codeChanges), unexpectedCodeChanges: table(unexpected), policyOnly: table(policyOnly), effects: table(effects)
    }
    if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`)
    const show = (title, rows, limit = 40) => { console.log(`\n${title} (${rows.length} dòng)`); for (const r of rows.slice(0, limit)) console.log(`  ${r.n}\t${r.key}`) }
    console.log(`${SIGNALS.length} nhóm tín hiệu, ${total} lượt lỗi 7 ngày. Bản sao ra đúng mã production: ${same}/${total} (${(100 * same / total).toFixed(2)}%)`)
    show('Bản sao lệch mã production', report.fidelity.mismatches, 15)
    show('Đổi mã do V659', report.codeChanges)
    show('Đổi mã KHÔNG do luật V659 (phải rỗng)', report.unexpectedCodeChanges)
    show('Cách xử lý của lượt đổi mã', report.effects)
    show('Không đổi mã, đổi chính sách', report.policyOnly, 30)
    process.exitCode = report.unexpectedCodeChanges.length ? 1 : 0
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
