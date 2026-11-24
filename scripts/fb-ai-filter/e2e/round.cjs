// Một vòng kiểm thử: lấy mẫu mới (data mẫu có đáp án + data cố tình sai lệch + data thật ngẫu nhiên do trọng tài gắn nhãn),
// chạy qua code thật của block với AI thật, rồi chạy lại một phần có tiêm lỗi. In báo cáo, ghi <DATA>/round-<n>.json.
//   NODE_USE_ENV_PROXY=1 E2E_DATA=<thư mục> node round.cjs <số vòng> [--synth 3] [--real 150] [--faults 300]
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const lib = require('./lib.cjs')
const { run, UNAVAILABLE } = require('./run.cjs')
const synth = require('./synth.cjs')
const adversarial = require('./adversarial.cjs')
const real = require('./sample-real.cjs')

const argv = process.argv.slice(2)
const n = Number(argv[0] || 1)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const TAG = opt('tag', ''), SYNTH = Number(opt('synth', 3)), REAL = Number(opt('real', 150)), FAULTN = Number(opt('faults', 300))
const r = (() => { let s = (n * 7919) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 } })()

;(async () => {
  const t0 = Date.now()
  const prevReal = new Set()
  for (const f of fs.readdirSync(lib.DATA)) if (/^round-\d+\.json$/.test(f) && Number(f.match(/\d+/)[0]) < n) for (const x of JSON.parse(fs.readFileSync(path.join(lib.DATA, f))).cases.filter(c => c.src === 'real')) prevReal.add(x.log_id)
  let cases = [...synth.generate({ seed: n * 1000 + 17, perCell: SYNTH }), ...adversarial.map(x => ({ ...x }))]
  if (REAL > 0) {
    // Mẫu thật của vòng giữ ở real-<n>.json để các lần chạy so sánh trong cùng vòng dùng đúng một bộ.
    const rp = path.join(lib.DATA, `real-${n}.json`)
    let sampled
    if (fs.existsSync(rp)) sampled = JSON.parse(fs.readFileSync(rp, 'utf8'))
    else { sampled = await real.sample({ seed: n * 31 + 5, target: REAL, exclude: prevReal }); await real.label(sampled); fs.writeFileSync(rp, JSON.stringify(sampled)) }
    cases.push(...sampled.filter(c => c.label))
  }
  // Bộ mẫu chấm tay 24/11 (đường dẫn ngoài repo vì là nội dung thật của khách).
  if (opt('gold', '')) {
    const gold = JSON.parse(fs.readFileSync(opt('gold', ''), 'utf8')).filter(c => c.label === 'match' || c.label === 'no').map(c => ({ ...c, label: c.label === 'match' ? 'yes' : 'no' }))
    cases.push(...gold.map(c => ({ src: 'gold', key: c.using_code, description: String(c.description || '').trim(), content: String(c.content || ''), entity: c.entity === 'comment' ? 'comment' : 'post', label: c.label, log_id: c.log_id })).filter(c => c.description && c.content.trim()))
  }
  const seen = new Set()
  cases = cases.filter(c => { const k = c.description + '\u0001' + c.content.trim() + '\u0001' + c.entity; if (seen.has(k)) return false; seen.add(k); return true })
  cases.forEach((c, i) => { c.id = `${n}-${i}` })

  // Lượt A: không tiêm lỗi.
  const A = await run(cases, { seed: n })
  // Lượt B: tiêm lỗi 30% lượt gọi trên một phần ca (câu trả lời thật lấy từ bộ nhớ của lượt A).
  const subset = A.filter(() => r() < FAULTN / A.length).map(({ id, src, key, description, content, entity, label }) => ({ id, src, key, description, content, entity, label }))
  const B = await run(subset, { seed: n + 99, faultRate: 0.3 })

  const issues = []
  const push = (kind, c, extra = {}) => issues.push({ kind, id: c.id, src: c.src, key: c.key || c.desc_kind || c.using_code, role: c.role, block: c.block, description: c.description.slice(0, 160), content: c.content.slice(0, 220), label: c.label, ai: c.ai, reason: c.aiReason, ...extra })
  for (const c of A) {
    if (c.blockError) push('block_error', c, { err: c.blockError.slice(0, 200) })
    else if (c.calls.length === 0 && c.content.trim()) push('no_ai_call', c)
    else if (c.calls.length && c.ai === null) push('ai_unparsed', c, { calls: c.calls })
    else if (c.calls.length && c.selected !== c.ai) push('block_vs_ai', c)
    if (!c.payloadOk) push('payload', c)
    if (c.calls.some(x => x.code === 'fb_ai_content_filter_fallback')) push('fallback_used_no_fault', c, { calls: c.calls })
    const decided = c.calls.length ? c.ai : false
    if (c.label && decided !== null && (decided ? 'yes' : 'no') !== c.label) {
      if (c.src === 'real' && c.labelConfidence === 'low') continue
      // Mô tả nhiều cách hiểu (danh sách từ khoá, việc kinh doanh của chính khách, "đang hỏi hoặc quan tâm đến"): chỉ theo dõi, không tính là lỗi cứng.
      const soft = c.src === 'synth' && ['keywords', 'own_business', 'interest'].includes(c.desc_kind)
      push(c.src === 'real' ? 'real_disagree' : c.src === 'gold' ? 'gold_wrong' : c.src === 'adv' ? 'adv_wrong' : soft ? 'synth_soft' : 'synth_wrong', c, { judge: c.labelReason })
    }
  }
  // Kiểm hành vi khi lỗi.
  const MAIN = /_ai_filter_v2$/
  for (const c of B) {
    const main = c.calls.filter(x => MAIN.test(x.code)), fb = c.calls.filter(x => x.code === 'fb_ai_content_filter_fallback')
    const usable = x => x.ok && !['prose', 'string_bool', 'truncated'].includes(x.fault)
    if (main.length > 3 || fb.length > 2) push('fault_too_many_calls', c, { calls: c.calls })
    const hopelessIdx = main.findIndex(x => /lỗi (400|401|402|403|404)\b/.test(x.error || ''))
    if (hopelessIdx >= 0 && main.length > hopelessIdx + 1) push('fault_hopeless_retried', c, { calls: c.calls })
    if (fb.length && main.length < 3 && hopelessIdx < 0) push('fault_fallback_early', c, { calls: c.calls })
    const anyOk = c.calls.some(usable)
    if (!c.calls.length) continue
    if (anyOk && c.blockError && !B.some(o => o.job === c.job && o.calls.length && !o.calls.some(usable))) push('fault_error_without_cause', c, { err: c.blockError, calls: c.calls })
    if (!anyOk) {
      if (c.engine && !(c.blockError || '').startsWith(UNAVAILABLE)) push('fault_engine_no_fb53', c, { err: c.blockError, calls: c.calls })
      if (!c.engine && c.selected) push('fault_old_selected', c, { calls: c.calls })
    }
    if (anyOk && !c.blockError && c.selected !== c.ai) push('fault_block_vs_ai', c, { calls: c.calls })
  }
  const by = (xs, f) => xs.reduce((m, x) => { const k = f(x); (m[k] = m[k] || []).push(x); return m }, {})
  const score = xs => { const d = xs.filter(c => c.label && !(c.src === 'real' && c.labelConfidence === 'low') && !c.blockError); let tp = 0, fp = 0, fn = 0, tn = 0
    for (const c of d) { const p = c.calls.length ? c.ai === true : false; const y = c.label === 'yes'; if (p && y) tp++; else if (p) fp++; else if (y) fn++; else tn++ }
    return { n: d.length, tp, fp, fn, tn, acc: +((tp + tn) / Math.max(1, d.length) * 100).toFixed(1), prec: +(tp / Math.max(1, tp + fp) * 100).toFixed(1), rec: +(tp / Math.max(1, tp + fn) * 100).toFixed(1) } }
  const report = { round: n, cases: A.length, faulted: B.length, seconds: Math.round((Date.now() - t0) / 1000), stats: lib.stats,
    score: Object.fromEntries(Object.entries(by(A, c => c.src)).map(([k, v]) => [k, score(v)])),
    synthByKind: Object.fromEntries(Object.entries(by(A.filter(c => c.src === 'synth'), c => c.desc_kind)).map(([k, v]) => [k, score(v)])),
    realLow: A.filter(c => c.src === 'real' && c.labelConfidence === 'low').length,
    faultsInjected: B.reduce((s, c) => s + c.calls.filter(x => x.fault).length, 0), fb53: B.filter(c => (c.blockError || '').startsWith(UNAVAILABLE)).length,
    issueCounts: Object.fromEntries(Object.entries(by(issues, i => i.kind)).map(([k, v]) => [k, v.length])) }
  // Tiêu chí một vòng không có vấn đề: 0 lỗi hệ thống (block, gọi AI, thử lại, dự phòng, FB53), 0 lỗi với dữ liệu cố tình sai lệch,
  // tối đa 1 lỗi ở dữ liệu mẫu rõ nghĩa (phải xem tay), bài thật chấm tay đúng từ 89%.
  const SEMANTIC = new Set(['synth_soft', 'gold_wrong', 'real_disagree', 'synth_wrong', 'adv_wrong'])
  const sys = issues.filter(i => !SEMANTIC.has(i.kind)).length
  const goldAcc = report.score.gold ? report.score.gold.acc : null
  report.pass = { systemIssues: sys, advWrong: report.issueCounts.adv_wrong || 0, synthHard: report.issueCounts.synth_wrong || 0, goldAcc,
    ok: sys === 0 && !(report.issueCounts.adv_wrong) && (report.issueCounts.synth_wrong || 0) <= 1 && (goldAcc === null || goldAcc >= 89) }
  fs.writeFileSync(path.join(lib.DATA, `round-${n}${TAG}.json`), JSON.stringify({ report, issues, cases: A, faulted: B }, null, 1))
  console.log(JSON.stringify(report, null, 1))
  for (const i of issues.filter(i => !i.kind.startsWith('real_'))) console.log(JSON.stringify(i))
  console.log('--- real_disagree:', issues.filter(i => i.kind === 'real_disagree').length)
})().catch(e => { console.error(e); process.exit(1) })
