// Phát lại lịch sử Facebook thật bằng engine v2 trên PostgreSQL 17 cục bộ (như bài phát lại Zalo, scripts/engine-v2-realdata/replay.cjs).
// Dữ liệu: file chép bằng export-replay.cjs (chỉ đọc từ production; dữ liệu khách, chỉ để ở scratchpad). Không chạm DB thật, không mở Facebook.
//
//   node scripts/engine-v2-facebook/replay.cjs <snapshot.json> [--out report.json] [--types a,b] [--only id,id] [--limit N] [--verbose]
//
// Cách chạy: bộ lập lịch Desktop thật (campaignScheduler.ts dựng bằng esbuild) chạy chiến dịch bằng engine (DesktopEngineRunner → runUnit
// chế độ workflow → runFacebookEngineTarget → hook mốc → bộ dựng dòng lịch sử của bộ cũ → hàm engine thật V556…V559). Block KHÔNG chạy code:
// mỗi node trả lại đúng kết quả (output / lỗi) bộ cũ đã ghi ở auto_run_steps cho data đó, theo đúng thứ tự; nhánh if / số vòng lặp đi đúng
// như lượt bộ cũ (điều kiện đọc biến do code block gán nên không tính lại được). Block gửi mức 2 (V560) thì giả cú bấm gửi qua trang có vết,
// như block thật: bước thành công, hoặc lỗi không phải kiểu "không tìm thấy phần tử", là đã bấm.
//
// Mỗi data chạy đúng lượt bộ cũ đầu tiên của nó trong mẫu. Mã data đánh lại theo thứ tự bộ cũ xử lý (data chính rồi tới các nhóm được
// chia sẻ kèm) vì engine nhận data theo mã. Thời gian nén: bỏ hạn mức ngày / khung giờ (hàm hạn mức trả NULL), nghỉ giữa data 0 giây.
// Chiến dịch không có dòng data (trang cá nhân, newsfeed): mỗi lượt bộ cũ là một mốc lịch.
//
// Kết quả: bảng chuyển đổi dòng lịch sử bộ cũ → dòng engine (thao tác : trạng thái, + tính lượt / 0 không tính) và trạng thái data, kèm
// sự kiện của chiến dịch (tạm dừng, khoá thao tác, data trả về hàng đợi) và chỗ đi lệch nhánh. Cặp khác nhau phải giải thích được bằng
// quyết định đã chốt (Q1–Q24, anh chốt 17/11 giữ dòng "lỗi" ở block không phải mốc gửi: dòng "=") hoặc chính sách V559; còn lại ("≠") là
// lỗi cần sửa, mã thoát 1.
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const { loadScheduler, fakeClient } = require('./desktop-harness.cjs')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS } = require('./fixture.cjs')
const { STEPS } = require('../build-v560-sql.cjs')

const args = process.argv.slice(2)
const snapshotPath = args[0]
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
if (!snapshotPath) { console.error('Dùng: node replay.cjs <snapshot.json> [--out report.json] [--types a,b] [--only id,id] [--limit N]'); process.exit(2) }
const onlyTypes = opt('--types') ? new Set(opt('--types').split(',')) : null
const onlyIds = opt('--only') ? new Set(opt('--only').split(',').map(Number)) : null
const limit = Number(opt('--limit') || 0)
const outPath = opt('--out')
const verbose = args.includes('--verbose')
const PORT = Number(process.env.FB_REPLAY_PORT || 55556)

const SLOT_TYPES = new Set(['facebook_timeline_post', 'facebook_newsfeed_interaction'])
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const object = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

class FakePage {
  constructor() { this.url = 'https://www.facebook.com/'; this.ops = [] }
  getURL() { return this.url }
  isConnected() { return true }
  destroy() {}
  async waitForSelector() { return true }
  async $(sel) { return { xpath: sel } }
  async $$() { return [] }
  async click(sel) { this.ops.push(['click', sel]) }
  async press(key) { this.ops.push(['press', key]) }
  async type() {}
  async paste() {}
  async fill() {}
  async focus() {}
  async hover() {}
  async scroll() {}
  async navigate(url) { this.url = String(url || this.url) }
  async evaluate() { return null }
  async captureJpeg() { return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]) }
  async screenshot() { return Buffer.alloc(0) }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Chuẩn bị mẫu: chọn lượt bộ cũ, đánh lại mã data theo thứ tự bộ cũ xử lý.

const ID_KEYS = new Set(['inputDataId', 'input_data_id', 'campaignInputDataId', 'targetInputDataId'])
const TARGET_ARRAY_KEYS = new Set(['selectedTargets', 'groupPostShareTargets', 'shareTargets', 'targets', 'candidates'])
/** Đổi mã data trong output bước (actionResult.inputDataId, selectedTargets[].id…); bỏ dấu nguồn kết quả của lượt cũ. */
function remapIds(value, map, parentKey) {
  if (Array.isArray(value)) return value.map(v => remapIds(v, map, TARGET_ARRAY_KEYS.has(parentKey) ? '__target' : parentKey))
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === '__akaActionResultSource') continue
      const idLike = ID_KEYS.has(k) || (parentKey === '__target' && k === 'id')
      if (idLike && (typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v))) && map.has(Number(v))) {
        out[k] = typeof v === 'number' ? map.get(Number(v)) : String(map.get(Number(v)))
      } else out[k] = remapIds(v, map, k)
    }
    return out
  }
  return value
}

function prepare(snap) {
  const byRun = new Map()
  for (const s of snap.steps) {
    const list = byRun.get(Number(s.run_id)) ?? []
    list.push(s)
    byRun.set(Number(s.run_id), list)
  }
  for (const list of byRun.values()) list.sort((a, b) => Number(a.id) - Number(b.id))
  const runsByCampaign = new Map()
  for (const r of snap.runs) {
    const list = runsByCampaign.get(Number(r.campaign_id)) ?? []
    list.push(r)
    runsByCampaign.set(Number(r.campaign_id), list)
  }
  for (const list of runsByCampaign.values()) list.sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)) || Number(a.id) - Number(b.id))
  const accounts = new Map(snap.accounts.map(a => [Number(a.id), a]))

  let campaigns = snap.campaigns.filter(c => (!onlyTypes || onlyTypes.has(c.action_id)) && (!onlyIds || onlyIds.has(Number(c.id))))
  campaigns.sort((a, b) => String(a.action_id).localeCompare(String(b.action_id)) || Number(a.id) - Number(b.id))
  if (limit > 0) campaigns = campaigns.slice(0, limit)

  let nextId = 90_000_000
  const plans = []
  const skipped = {}
  const skip = (reason, n = 1) => { skipped[reason] = (skipped[reason] || 0) + n }
  for (const c of campaigns) {
    const account = accounts.get(Number(c.account_id))
    if (!account) { skip('không có tài khoản trong mẫu'); continue }
    if (account.facebook_random_run_enabled === true) { skip('tài khoản bật chạy ngẫu nhiên (engine chưa nhận)'); continue }
    const slot = SLOT_TYPES.has(c.action_id)
    const usable = []
    for (const r of runsByCampaign.get(Number(c.id)) ?? []) {
      const steps = byRun.get(Number(r.id)) ?? []
      if (!['completed', 'failed'].includes(r.status)) { skip(`lượt bộ cũ ${r.status}`); continue }
      if (steps.some(s => !['success', 'error'].includes(s.status))) { skip('lượt có bước dở'); continue }
      if (slot !== (r.campaign_input_data_id == null)) { skip(slot ? 'lượt có data ở loại theo mốc' : 'lượt không data (khôi phục danh tính…)'); continue }
      usable.push({ ...r, steps })
    }
    const rows = snap.inputData.filter(i => Number(i.campaign_id) === Number(c.id))
    const idMap = new Map()
    const chosen = []
    if (slot) chosen.push(...usable)
    else {
      const seen = new Set()
      for (const r of usable) {
        const target = Number(r.campaign_input_data_id)
        if (seen.has(target)) { skip('lượt lặp lại của cùng data (chỉ phát lại lượt đầu)'); continue }
        if (!rows.some(i => Number(i.id) === target)) { skip('data của lượt không có trong mẫu'); continue }
        seen.add(target)
        chosen.push(r)
      }
      // Mã mới theo thứ tự bộ cũ xử lý: data chính rồi tới nhóm được chia sẻ kèm (block 2794 chọn).
      for (const r of chosen) {
        const target = Number(r.campaign_input_data_id)
        if (!idMap.has(target)) idMap.set(target, ++nextId)
        for (const s of r.steps) {
          for (const t of Array.isArray(s.output?.selectedTargets) ? s.output.selectedTargets : []) {
            const id = Number(t?.id)
            if (Number.isFinite(id) && rows.some(i => Number(i.id) === id) && !idMap.has(id)) idMap.set(id, ++nextId)
          }
        }
      }
      for (const i of rows) if (!idMap.has(Number(i.id))) idMap.set(Number(i.id), ++nextId)
    }
    if (chosen.length === 0) { skip('chiến dịch không còn lượt dùng được'); continue }
    const mains = new Set(chosen.map(r => r.campaign_input_data_id == null ? null : idMap.get(Number(r.campaign_input_data_id))))
    const shareOwner = new Map()
    for (const r of chosen) {
      for (const s of r.steps) {
        for (const t of Array.isArray(s.output?.selectedTargets) ? s.output.selectedTargets : []) {
          const id = idMap.get(Number(t?.id))
          if (id && !mains.has(id)) shareOwner.set(id, idMap.get(Number(r.campaign_input_data_id)))
        }
      }
    }
    plans.push({
      campaign: c, account, slot, idMap, mains, shareOwner,
      runs: chosen.map(r => ({ ...r, target: r.campaign_input_data_id == null ? null : idMap.get(Number(r.campaign_input_data_id)),
        steps: r.steps.map(s => ({ ...s, output: remapIds(s.output ?? {}, idMap) })) })),
      rows: rows.map(i => ({ ...i, oldId: Number(i.id), id: idMap.get(Number(i.id)) ?? Number(i.id) }))
    })
  }
  return { plans, skipped }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Bộ phát lại lượt workflow: chọn lượt bộ cũ cho data / mốc, viết lại điều kiện if và vòng lặp theo lượt đó, trả kết quả bước.

/** Số vòng lặp lượt bộ cũ đã bắt đầu (kể cả vòng lỗi). */
function startedIterations(step, loopType) {
  const n = Math.max(0, Number(step.output?.iterations ?? 0))
  if (step.status !== 'error') return n
  return loopType === 'while' ? n : n + 1
}

function rewriteWorkflow(wf) {
  const nodes = wf.nodes.map(node => {
    const id = JSON.stringify(node.id)
    if (node.systemType === 'ifElse' || node.blockName === 'if_else') {
      return { ...node, config: { ...object(node.config), condition: `vars.__replay.branch(${id})` } }
    }
    if (node.systemType === 'loop' || node.blockName === 'loop') {
      const cfg = object(node.config)
      const type = cfg.loopType ?? 'count'
      if (type === 'while') return { ...node, config: { ...cfg, condition: `vars.__replay.loop(${id}, iter, 'while')`, maxIterations: 100000 } }
      const original = type === 'forEach' && typeof cfg.itemsExpr === 'string' ? cfg.itemsExpr : Array.isArray(cfg.items) ? JSON.stringify(cfg.items) : 'null'
      return { ...node, config: { ...cfg, loopType: 'forEach', items: undefined,
        itemsExpr: `vars.__replay.items(${id}, (function () { try { return (${original}) } catch (e) { return null } })(), ${JSON.stringify(type)})` } }
    }
    return node
  })
  return { ...wf, nodes }
}

class RunPlayer {
  constructor(run, notes) {
    this.run = run
    this.notes = notes
    this.queues = new Map()
    for (const s of run.steps) {
      // Node gộp (merge) engine tự chạy, không qua block / điều kiện.
      if (s.block_name === 'merge') continue
      const list = this.queues.get(s.node_id) ?? []
      list.push(s)
      this.queues.set(s.node_id, list)
    }
    this.extra = []
    this.loops = new Map()
    this.consumed = 0
  }
  next(nodeId) {
    const list = this.queues.get(nodeId)
    const step = list?.shift()
    if (step) this.consumed++
    else this.extra.push(nodeId)
    return step ?? null
  }
  branch(nodeId) {
    const step = this.next(nodeId)
    return step ? step.output?.branch === 'true' : false
  }
  items(nodeId, original, type) {
    const step = this.next(nodeId)
    const n = step ? startedIterations(step, type) : 0
    return Array.from({ length: n }, (_, i) => (Array.isArray(original) ? original[i] : undefined))
  }
  loop(nodeId, iter, type) {
    if (iter === 0) {
      const step = this.next(nodeId)
      this.loops.set(nodeId, step ? startedIterations(step, type) : 0)
    }
    return iter < (this.loops.get(nodeId) ?? 0)
  }
  leftover() {
    const rest = []
    for (const [nodeId, list] of this.queues) if (list.length) rest.push(`${nodeId}×${list.length}`)
    return rest
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------

function rowSig(r) {
  // Dòng không gắn thao tác (Tìm data): không bao giờ vào đếm hạn mức (đếm theo mã thao tác), NULL hay false như nhau.
  const count = !r.action_code ? '' : r.counts_toward_limit === true ? '+' : r.counts_toward_limit === false ? '0' : '?'
  return `${r.action_code || r.action_name || '-'}:${r.status}${count}`
}
const sigList = rows => rows.map(rowSig).sort().join(' ') || '∅'

async function main() {
  const snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  const { plans, skipped } = prepare(snap)
  console.log(`Chuẩn bị: ${plans.length} chiến dịch, ${plans.reduce((n, p) => n + p.runs.length, 0)} lượt; bỏ qua ${JSON.stringify(skipped)}`)

  const sendOpsByBlock = new Map()
  for (const [blockId, , , , level, ops] of STEPS) if (level === 2 && ops.length && !sendOpsByBlock.has(blockId)) sendOpsByBlock.set(blockId, ops)

  const { mod, out } = await loadScheduler()
  const cluster = startCluster({ port: PORT, label: 'aka-fb-replay-', timeoutMs: 1_800_000 })
  const db = await cluster.connect()
  // supabase-js trả bigint dạng số (PostgREST); pg mặc định trả chuỗi.
  db.setTypeParser(20, 'text', value => Number(value))
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-replay-userdata-'))
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-replay-media-'))
  const unknownCalls = []
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const report = { snapshot: path.basename(snapshotPath), startedAt: new Date().toISOString(), skipped, campaigns: [], matrix: {}, events: {}, problems: [] }
  const bump = (bucket, key, example) => {
    const entry = (bucket[key] ||= { n: 0, examples: [] })
    entry.n++
    if (example && entry.examples.length < 5) entry.examples.push(example)
  }
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    // Thời gian nén: bỏ hạn mức ngày / khung giờ (đã kiểm riêng ở sql-smoke).
    await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text)
      RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT NULL::jsonb $f$`)

    // ---- Nạp dữ liệu mẫu (chỉ cột DB thử có) ----
    const colCache = new Map()
    const columns = async table => {
      if (!colCache.has(table)) {
        const r = await db.query(`SELECT column_name, data_type, is_identity, is_generated FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`, [table])
        colCache.set(table, new Map(r.rows.map(x => [x.column_name, x])))
      }
      return colCache.get(table)
    }
    const insertRow = async (table, row, { conflict = '' } = {}) => {
      const cols = await columns(table)
      if (cols.size === 0) throw new Error(`DB thử không có bảng ${table}`)
      const keys = Object.keys(row).filter(k => cols.has(k) && cols.get(k).is_generated !== 'ALWAYS' && row[k] !== undefined)
      const values = keys.map(k => {
        const v = row[k]
        const type = cols.get(k).data_type
        return (type === 'jsonb' || type === 'json') && v !== null ? JSON.stringify(v) : v
      })
      const identity = [...cols.values()].some(c => c.is_identity === 'YES')
      await db.query(`INSERT INTO public.${table} (${keys.map(k => `"${k}"`).join(', ')})${identity ? ' OVERRIDING SYSTEM VALUE' : ''}
        VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) ${conflict}`, values)
    }

    const orgIds = new Set(), staffIds = new Set()
    for (const p of plans) { orgIds.add(Number(p.campaign.organization_id)); staffIds.add(Number(p.campaign.staff_id)) }
    for (const org of orgIds) await insertRow('org_organization', { id: org, name: `Org ${org}` }, { conflict: 'ON CONFLICT DO NOTHING' })
    for (const staff of snap.staff.filter(s => staffIds.has(Number(s.id)))) {
      await insertRow('org_staff', { id: Number(staff.id), organization_id: Number(staff.organization_id), username: `staff${staff.id}`, password: 'pw',
        is_active: true, max_running_facebook_accounts: null }, { conflict: 'ON CONFLICT DO NOTHING' })
    }
    for (const prod of snap.orgProducts.filter(x => orgIds.has(Number(x.organization_id)))) {
      await insertRow('org_organization_product', { ...prod, expiration_date: new Date(Date.now() + 30 * 86400_000).toISOString() },
        { conflict: 'ON CONFLICT DO NOTHING' }).catch(e => report.problems.push(`org_organization_product: ${e.message}`))
    }
    await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`,
      [JSON.stringify({ mode: 'orgs', organizationIds: [...orgIds] })])

    // Danh mục engine: workflow bộ cũ (node giữ id như bản "[engine]" của V560) + danh mục bước V560 theo mã block bộ cũ.
    const workflowById = new Map(snap.workflows.map(w => [Number(w.id), { id: Number(w.id), name: w.name, nodes: w.nodes, edges: w.edges,
      defaultVariables: w.default_variables ?? {} }]))
    const blockNames = new Map()
    for (const w of workflowById.values()) for (const n of w.nodes) if (Number(n.blockId) > 0) blockNames.set(Number(n.blockId), n.blockName)
    for (const [id, name] of blockNames) {
      await db.query(`INSERT INTO public.auto_blocks (id, name, code) VALUES ($1, $2, '') ON CONFLICT DO NOTHING`, [id, `${name}#${id}`])
    }
    for (const w of workflowById.values()) {
      await db.query(`INSERT INTO public.auto_workflows (id, name, nodes, edges) VALUES ($1, $2, $3, $4)`, [w.id, w.name, JSON.stringify(w.nodes), JSON.stringify(w.edges)])
    }
    const purposeWorkflow = new Map(snap.campaignActions.filter(a => a.workflow_id && workflowById.has(Number(a.workflow_id)))
      .map(a => [a.id, Number(a.workflow_id)]))
    for (const [purpose, wf] of purposeWorkflow) {
      await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ($1, $2)`, [purpose, wf])
    }
    for (const [blockId, purpose, kind, action, level, ops, note] of STEPS) {
      if (!blockNames.has(blockId)) continue
      const wf = purpose ? purposeWorkflow.get(purpose) ?? null : null
      if (purpose && !wf) continue
      await db.query(`INSERT INTO public.auto_engine_block_steps (block_id, workflow_id, step_kind, action_code, commit_level, send_ops, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`, [blockId, wf, kind, action, level, JSON.stringify(ops), note])
    }

    // Tài khoản, chiến dịch, data.
    for (const p of plans) {
      const a = p.account
      await insertRow('auto_accounts', { ...a, login_status: 'đã đăng nhập', status: 'chờ xử lý', is_active: true, is_delete: false,
        facebook_random_run_enabled: false, proxy_id: null }, { conflict: 'ON CONFLICT (id) DO NOTHING' })
      const extra = clone(object(p.campaign.extra_settings))
      delete extra.facebookRestBrowse
      // Phát lại theo đúng thứ tự lượt bộ cũ đã chạy (id data giả đánh theo thứ tự đó, engine nhận theo id): tắt xáo trộn của V564,
      // không thì engine đi thứ tự xáo của lease thử và lệch lịch sử. Thứ tự xáo kiểm riêng ở v564-smoke.cjs.
      if (extra.shuffleGroupList === true) extra.shuffleGroupList = false
      extra.actionLimits = { ...object(extra.actionLimits), sleepBetweenActions: 0 }
      await insertRow('auto_campaigns', { ...p.campaign, status: 'chờ xử lý', note: null, is_delete: false, extra_settings: extra,
        schedule: new Date(Date.now() - 60_000).toISOString(), schedule_end_date: null, daily_stop_time: null, data_group_id: null,
        provisioning_state: undefined })
      for (const row of p.rows) {
        const pending = p.mains.has(row.id) || p.shareOwner.has(row.id)
        await insertRow('auto_campaign_input_data', { ...row, id: row.id, campaign_id: Number(p.campaign.id), is_delete: false, input_id: null,
          status: pending ? 'chờ xử lý' : 'hoàn thành', note: pending ? null : 'replay: không phát lại', auto_automation_detail_id: null })
      }
    }

    // ---- Bộ lập lịch ----
    const progressByCampaign = new Map()
    const R = globalThis.__fbHarness = {
      userData, client: fakeClient(db, unknownCalls), runs: [], runSteps: [], workflows: workflowById, user: null,
      block: id => ({ id, name: blockNames.get(id) ?? `block_${id}`, code: '', configSchema: [], defaultConfig: {}, isBuiltin: false }),
      fakeMedia: (name, temp) => {
        const file = path.join(mediaDir, `${md5(String(name)).slice(0, 12)}${path.extname(String(name).split('?')[0]) || '.jpg'}`)
        if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
        temp?.push?.(file)
        return file
      },
      player: null,
      executeBlock: async (opts, ctx, { isNotDispatchedError }) => {
        const player = R.player
        const nodeId = ctx.runtimeMetadata?.nodeId
        const blockId = Number(ctx.runtimeMetadata?.blockId)
        if (!player) return { success: false, output: {}, error: 'replay: không có lượt bộ cũ', durationMs: 0, logs: [] }
        const step = player.next(nodeId)
        if (!step) return { success: false, output: {}, error: `replay: bộ cũ không chạy node ${nodeId}`, durationMs: 0, logs: [] }
        const ok = step.status === 'success'
        const ops = sendOpsByBlock.get(blockId)
        // Cú bấm gửi mức 2: bước thành công chỉ khi block báo đã làm (posted / commented / ok); bước lỗi thì trừ lỗi kiểu "không thấy phần tử".
        const out = step.output ?? {}
        const did = out.posted === true || out.commented === true || (out.ok === true && out.commented === undefined && out.posted === undefined)
        if (ops && ctx.page && (ok ? did : !isNotDispatchedError(step.error))) {
          for (const entry of ops) {
            const [op, el] = entry.split(':')
            if (op === 'click') {
              const sel = `//replay-${el}`
              ctx.runtimeHelpers?.observeElement?.(el, sel)
              await ctx.page.click(sel)
            } else if (op === 'press') await ctx.page.press(el || 'Enter')
          }
        }
        return { success: ok, output: clone(step.output ?? {}), ...(ok ? {} : { error: step.error ?? 'Lỗi không xác định' }), durationMs: 0, logs: [] }
      }
    }

    const facadeUnknown = new Map()
    const mapCampaign = row => row && mod.mapCampaignFromDB(row)
    const campaignRow = id => one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id])
    const accountObj = row => ({ ...mod.mapAccountFromDB(row), accountGroupSettings: { sleepBetweenActions: 0 }, facebookRandomRunEnabled: false })
    const facade = new Proxy({
      getCampaign: async id => mapCampaign(await campaignRow(id)),
      getCampaignAction: async id => {
        const a = snap.campaignActions.find(x => x.id === id)
        return a ? { id: a.id, name: a.name ?? a.id, workflowId: a.workflow_id, flatformType: 'facebook', limitCheckActionCodes: a.limit_check_action_codes ?? [] } : null
      },
      listCampaignInputData: async campaignId => (await db.query('SELECT * FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id',
        [campaignId])).rows.map(r => mod.mapCampaignInputDataFromDB(r)),
      updateCampaign: async (id, patch) => {
        const map = { extraSettings: 'extra_settings', status: 'status', note: 'note', schedule: 'schedule', lastRunAt: 'last_run_at', content: 'content' }
        for (const [key, col] of Object.entries(map)) {
          if (patch[key] === undefined) continue
          await db.query(`UPDATE public.auto_campaigns SET ${col} = $2 WHERE id = $1`, [id, key === 'extraSettings' ? JSON.stringify(patch[key]) : patch[key]])
        }
        return mapCampaign(await campaignRow(id))
      },
      appendCampaignLog: async (id, message) => {
        const list = progressByCampaign.get(id) ?? []
        list.push(String(message))
        progressByCampaign.set(id, list)
        const row = await one('SELECT id, name, account_id FROM public.auto_campaigns WHERE id = $1', [id])
        return { id: Number(row.id), name: row.name, accountId: Number(row.account_id), accountName: 'FB' }
      },
      getAccount: async id => { const row = await one('SELECT * FROM public.auto_accounts WHERE id = $1', [id]); return row ? accountObj(row) : null },
      upsertGroupPostContactStatus: async () => undefined,
      updatePendingUnclaimedCampaignNote: async (id, _updatedAt, note) => mapCampaign(await one(`UPDATE public.auto_campaigns SET note = $2
        WHERE id = $1 AND status = 'chờ xử lý' RETURNING *`, [id, note])),
      createCampaignDetail: async () => { throw new Error('bộ cũ ghi thẳng lịch sử') },
      getErrorPolicy: async () => null,
      // Chống gửi lặp của nhóm chia sẻ kèm (RPC aka_agent_apply_campaign_delivery_cooldown): bộ cũ đã chạy các lượt này nên cho phép hết.
      applyCampaignDeliveryCooldown: async (_campaignId, _accountId, ids) => ids.map(id => ({ inputDataId: Number(id), decision: 'allowed' })),
      // Đồng hồ DB (aka_agent_runtime_clock): giờ máy DB thử, ngày theo giờ Việt Nam.
      getRuntimeClock: async () => {
        const r = await one(`SELECT now() AS db_now, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS vn,
          ((date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS next_midnight`)
        return { dbNow: new Date(r.db_now).toISOString(), vietnamDateKey: r.vn, nextVietnamMidnight: new Date(r.next_midnight).toISOString() }
      },
      getAccountRateLimitStatus: async () => ({ ok: true, dailyLimit: 100000, dailyActionCount: 0, windowLimit: 100000, windowActionCount: 0 }),
      updateCampaignInputData: async (id, patch) => {
        await db.query(`UPDATE public.auto_campaign_input_data SET status = coalesce($2, status), note = CASE WHEN $4 THEN $3 ELSE note END WHERE id = $1`,
          [id, patch.status ?? null, patch.note ?? null, 'note' in patch])
        return null
      },
      listCampaignDetailsByInputData: async inputDataId => (await db.query(`SELECT * FROM public.auto_campaign_details WHERE input_data_id = $1`,
        [inputDataId])).rows.map(r => ({ campaignId: Number(r.campaign_id), actionName: r.action_name, status: r.status, data: r.data })),
      listCampaignDetailsByCampaign: async campaignId => (await db.query(`SELECT * FROM public.auto_campaign_details WHERE campaign_id = $1`,
        [campaignId])).rows.map(r => ({ campaignId: Number(r.campaign_id), actionName: r.action_name, status: r.status, data: r.data })),
      setDesktopCampaignStatusV2: async (id, _accountId, status) => (await one(`UPDATE public.auto_campaigns SET status = $2
        WHERE id = $1 AND status IS DISTINCT FROM $2 RETURNING id`, [id, status])) ? { ok: true } : { ok: false, reason: 'already_target' }
    }, { get(target, key) {
      if (key in target) return target[key]
      if (typeof key !== 'string' || key === 'then') return undefined
      return async () => { facadeUnknown.set(key, (facadeUnknown.get(key) || 0) + 1); return null }
    } })

    const Scheduler = mod.CampaignScheduler
    const mainWindow = { webContents: { send() {} }, isDestroyed: () => false }
    const webviewRegistry = { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null }
    const scheduler = new Scheduler(facade, webviewRegistry, mainWindow, undefined, undefined, undefined, { runtimeTarget: 'desktop' })
    scheduler.running = true
    const page = new FakePage()
    scheduler.backgroundPages = { getOrCreate: () => page, destroy() {}, destroyAll() {}, createTemporary() { return { page } } }
    Object.assign(scheduler, { startBackgroundPreview() {}, stopBackgroundPreview() {}, selectAutomationBrowser() {}, broadcastCampaignUpdate() {} })

    // Lượt workflow của engine → lượt bộ cũ của đúng data / mốc.
    const engineRun = scheduler.engineV2.run.bind(scheduler.engineV2)
    let current = null // { plan, pickTarget(id) }
    scheduler.engineV2.run = async (wfOrId, variables, pageArg, ctx = {}) => {
      const wf = typeof wfOrId === 'number' ? workflowById.get(wfOrId) : wfOrId
      if (!current || !wf) return engineRun(wfOrId, variables, pageArg, ctx)
      if (variables?.pageIdentityRestoreOnly === true || wf.name === 'fb_campaign_rest_browse') {
        current.events.push(variables?.pageIdentityRestoreOnly ? 'khôi phục danh tính' : 'lướt nghỉ')
        return { status: 'completed', output: {}, steps: [] }
      }
      const run = current.pick(ctx.campaignInputDataId ?? null)
      if (!run) {
        current.problems.push(`không có lượt bộ cũ cho data ${ctx.campaignInputDataId ?? '(mốc)'}`)
        return { status: 'failed', output: {}, error: 'replay: không có lượt bộ cũ', steps: [] }
      }
      const player = new RunPlayer(run, current.problems)
      R.player = player
      variables.__replay = player
      try {
        const result = await engineRun(rewriteWorkflow(wf), variables, pageArg, ctx)
        const left = player.leftover()
        if (left.length && !player.extra.length) {
          bump(report.events, `${current.plan.campaign.action_id} | đi lệch nhánh`, { campaign: Number(current.plan.campaign.id), run: Number(run.id),
            thiếu: left.slice(0, 6), thêm: player.extra.slice(0, 6), status: result.status, error: result.error?.slice?.(0, 160) })
        }
        // Engine cần node mà lượt bộ cũ không ghi bước nào: auto_run_steps của lượt đó thiếu dòng (gặp ở production), không so được.
        current.done.set(run.id, { run, result, incomplete: player.extra.length > 0 })
        return result
      } finally {
        delete variables.__replay
        R.player = null
      }
    }

    // ---- Chạy từng chiến dịch ----
    const legacyDetails = new Map()
    for (const d of snap.details) {
      const list = legacyDetails.get(Number(d.campaign_id)) ?? []
      list.push(d)
      legacyDetails.set(Number(d.campaign_id), list)
    }
    const staffOrg = new Map(snap.staff.map(s => [Number(s.id), Number(s.organization_id)]))
    let campaignNo = 0
    for (const p of plans) {
      campaignNo++
      const cid = Number(p.campaign.id)
      const type = p.campaign.action_id
      R.user = { staffId: Number(p.campaign.staff_id), organizationId: staffOrg.get(Number(p.campaign.staff_id)) ?? Number(p.campaign.organization_id),
        facebookEngineV2: true, campaignEngineV2: false, isAdminAkabiz: false,
        entitlements: { facebookCore: true, facebookFanpage: true, email: false, zalo: false, sms: false } }
      const queues = new Map()
      for (const r of p.runs) {
        const key = r.target ?? 'slot'
        queues.set(key, [...(queues.get(key) ?? []), r])
      }
      current = { plan: p, problems: [], events: [], done: new Map(), pick: id => queues.get(id ?? 'slot')?.shift() ?? null }
      const summary = { id: cid, type, runs: p.runs.length, units: [], problems: current.problems, events: current.events }
      report.campaigns.push(summary)
      const accountRow = async () => accountObj(await one('SELECT * FROM public.auto_accounts WHERE id = $1', [Number(p.account.id)]))
      const fresh = async () => mapCampaign(await campaignRow(cid))

      // Engine nhận chiến dịch? (danh mục nạp nền lần đầu)
      let support = null
      for (let i = 0; i < 40; i++) {
        support = scheduler.engineRunner.support(await accountRow(), await fresh())
        if (support.ok || support.reason !== 'catalog_loading') break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!support?.ok) {
        bump(report.events, `${type} | engine không nhận: ${support?.reason}`, { campaign: cid })
        summary.unsupported = support?.reason
        continue
      }

      const maxUnits = p.slot ? p.runs.length : p.runs.length + 20
      for (let unit = 0; unit < maxUnits; unit++) {
        // Mốc lịch đến hạn, chiến dịch / tài khoản chạy được (ghi lại nếu engine đã đổi).
        const c = await campaignRow(cid)
        if (c.status === 'tạm dừng') {
          bump(report.events, `${type} | engine tạm dừng chiến dịch`, { campaign: cid, note: String(c.note ?? '').slice(0, 200) })
          current.events.push(`tạm dừng: ${String(c.note ?? '').slice(0, 160)}`)
        }
        if (!p.slot && c.status === 'hoàn thành') break
        await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, schedule = now() - interval '1 minute' WHERE id = $1`, [cid])
        const acc = await one('SELECT login_status, status FROM public.auto_accounts WHERE id = $1', [Number(p.account.id)])
        if (acc.login_status !== 'đã đăng nhập' || acc.status === 'tạm dừng') {
          bump(report.events, `${type} | tài khoản ${acc.login_status} / ${acc.status}`, { campaign: cid })
          current.events.push(`tài khoản: ${acc.login_status} / ${acc.status}`)
          await db.query(`UPDATE public.auto_accounts SET login_status = 'đã đăng nhập', status = 'chờ xử lý' WHERE id = $1`, [Number(p.account.id)])
        }
        const locks = await db.query(`UPDATE public.auto_account_action_status SET is_disable = false, date_enable = NULL
          WHERE account_id = $1 AND is_disable RETURNING action_code, disabled_error_code`, [Number(p.account.id)])
        for (const l of locks.rows) {
          bump(report.events, `${type} | engine khoá thao tác ${l.action_code} (${l.disabled_error_code})`, { campaign: cid })
          current.events.push(`khoá ${l.action_code} (${l.disabled_error_code})`)
        }
        if (!p.slot) {
          const pending = await one(`SELECT count(*)::int AS n FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND status = 'chờ xử lý'`, [cid])
          if (pending.n === 0) break
        } else if ((queues.get('slot') ?? []).length === 0) break

        // Danh tính Page: lượt bộ cũ đã chuyển về trong cùng lượt (bước phát lại); dấu "đang ở Page" do bộ phát lại để lại thì xoá.
        mod.clearFacebookIdentityMarker(Number(p.account.id))
        const before = Date.now()
        let result
        try {
          result = await scheduler.engineRunner.run(await accountRow(), await fresh())
        } catch (error) {
          current.problems.push(`lượt engine ném lỗi: ${error.stack || error.message}`)
          break
        }
        summary.units.push({ reason: result?.reason ?? null, targets: result?.targets ?? 0, ms: Date.now() - before })
        if (verbose) console.log(`  [${cid}] lượt ${unit + 1}: ${result?.reason} (${result?.targets ?? 0} data)`)
        if (!result) { current.problems.push('engine không chạy (null)'); break }
        if (result.reason === 'error' && summary.units.slice(-3).every(u => u.reason === 'error') && summary.units.length >= 3) {
          current.problems.push(`lượt engine lỗi liên tiếp: ${JSON.stringify(result.detail ?? null).slice(0, 200)}`)
          break
        }
        if (!['no_target', 'stop_campaign', 'campaign_paused', 'end_unit', 'wait', 'stop_account', 'account_logged_out', 'max_targets', 'not_due',
          'account_paused'].includes(result.reason)) {
          bump(report.events, `${type} | lượt engine kết thúc: ${result.reason}`, { campaign: cid, detail: result.detail })
        }
        // Data đã phát lại mà về hàng đợi (engine chưa gửi, sẽ thử lại lượt sau): ghi lại rồi để riêng (bộ cũ không có lượt tiếp trong mẫu).
        const requeued = await db.query(`SELECT id FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND status = 'chờ xử lý'`, [cid])
        for (const row of requeued.rows) {
          const id = Number(row.id)
          const owner = p.shareOwner.get(id)
          const replayed = p.mains.has(id) ? (queues.get(id) ?? []).length === 0 : owner != null && (queues.get(owner) ?? []).length === 0
          if (!replayed) continue
          await db.query(`UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = 'replay: engine trả về hàng đợi' WHERE id = $1`, [id])
        }
        if (p.slot && result.reason === 'no_target' && (queues.get('slot') ?? []).length > 0 && result.targets === 0) {
          current.problems.push('mốc lịch không được nhận (no_target)')
          break
        }
      }
      const notRun = [...queues.entries()].filter(([, list]) => list.length).map(([k, list]) => `${k}×${list.length}`)
      if (notRun.length) {
        const ids = [...queues.entries()].filter(([k, list]) => list.length && k !== 'slot').map(([k]) => Number(k))
        const states = ids.length ? (await db.query(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE id = ANY($1)`, [ids])).rows
          .map(r => `${r.status}${r.note ? ': ' + String(r.note).slice(0, 80) : ''}`) : []
        const counts = {}
        for (const st of states) counts[st] = (counts[st] || 0) + 1
        bump(report.events, `${type} | engine không chạy lượt bộ cũ`, { campaign: cid, left: notRun.slice(0, 5), states: counts,
          campaign_status: (await campaignRow(cid))?.status })
      }

      // ---- So sánh ----
      const engineRows = (await db.query(`SELECT id, input_data_id, action_code, action_name, status, counts_toward_limit, log, data, created_at
        FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [cid])).rows
      const finalRows = new Map((await db.query(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1`, [cid])).rows
        .map(r => [Number(r.id), r]))
      const legacy = legacyDetails.get(cid) ?? []
      if (onlyIds) {
        summary.engineRows = engineRows.map(r => `${r.input_data_id ?? '-'} ${r.action_code ?? '-'}:${r.status} ${String(r.log ?? '').slice(0, 120)}`)
        summary.progress = (progressByCampaign.get(cid) ?? []).slice(0, 80)
        summary.finalRows = [...finalRows.values()].map(r => `${r.id} ${r.status} ${String(r.note ?? '').slice(0, 80)}`)
        summary.outcomes = (await db.query(`SELECT result_key, action_code, ok, phase, error_code, signal FROM public.auto_engine_outcomes
          WHERE campaign_id = $1 ORDER BY created_at, result_key`, [cid])).rows
          .map(o => `${o.result_key} ${o.action_code} ok=${o.ok} ${o.phase} ${o.error_code ?? ''} ${o.signal?.code ?? ''} ${String(o.signal?.message ?? '').slice(0, 160)}`)
      }
      const reverse = new Map([...p.idMap].map(([o, n]) => [n, o]))
      // Cửa sổ dòng bộ cũ của một lượt: từ lúc bắt đầu tới lượt kế tiếp của cùng data / mốc (bộ cũ ghi dòng "Tìm data" sau khi đẩy data
      // xong, có khi vài phút sau lượt), tối đa 30 phút sau khi lượt kết thúc.
      // Theo giờ server (auto_runs.created_at), không theo started_at / completed_at (giờ máy khách, có máy lệch vài chục giây).
      const allRuns = (snap.runs.filter(r => Number(r.campaign_id) === cid)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      const windowOf = run => {
        const start = Date.parse(run.created_at) - 5_000
        const duration = Math.max(0, Date.parse(run.completed_at ?? run.started_at) - Date.parse(run.started_at))
        const next = allRuns.find(r => String(r.created_at) > String(run.created_at)
          && (r.campaign_input_data_id == null ? run.campaign_input_data_id == null : Number(r.campaign_input_data_id) === Number(run.campaign_input_data_id)))
        const end = Math.min(Date.parse(run.created_at) + duration + 1_800_000, next ? Date.parse(next.created_at) - 1 : Infinity)
        return d => { const t = Date.parse(d.created_at); return t >= start && t <= end }
      }
      const compareTarget = (label, run, newId, legacyRows, engineRowsFor) => {
        if (current.done.get(run.id)?.incomplete) {
          bump(report.events, `${type} | lịch sử bộ cũ thiếu bước (không so)`, { campaign: cid, run: Number(run.id) })
          return
        }
        const old = reverse.get(newId)
        const snapRow = p.rows.find(r => r.id === newId)
        const fin = finalRows.get(newId)
        const engineStatus = fin?.note === 'replay: engine trả về hàng đợi' ? 'về hàng đợi' : fin?.status ?? '?'
        // Khác biệt anh đã chốt: block không phải mốc gửi ném lỗi (lượt bộ cũ "failed", bộ cũ không ghi dòng nào) thì engine giữ dòng "lỗi"
        // không tính lượt (anh chốt 17/11).
        const keptErrorRow = legacyRows.length === 0 && engineRowsFor.length > 0 && run.status === 'failed'
          && engineRowsFor.every(r => r.status === 'lỗi' && r.counts_toward_limit !== true)
        const key = `${type}${label} | ${sigList(legacyRows)} → ${sigList(engineRowsFor)} | data ${snapRow?.status ?? '?'} → ${engineStatus}`
          + (keptErrorRow ? ' | đã chốt: giữ dòng lỗi (17/11)' : '')
        bump(report.matrix, key, { campaign: cid, run: Number(run.id), data: old, legacy: legacyRows.map(r => r.log).slice(0, 3),
          engine: engineRowsFor.map(r => r.log).slice(0, 3) })
      }
      if (!p.slot) {
        for (const run of p.runs) {
          if (!current.done.has(run.id)) continue
          const inWindow = windowOf(run)
          compareTarget('', run, run.target, legacy.filter(d => Number(d.input_data_id) === Number(reverse.get(run.target)) && inWindow(d)),
            engineRows.filter(r => Number(r.input_data_id) === run.target))
          for (const [shareId, owner] of p.shareOwner) {
            if (owner !== run.target) continue
            compareTarget(' (nhóm chia sẻ kèm)', run, shareId, legacy.filter(d => Number(d.input_data_id) === Number(reverse.get(shareId)) && inWindow(d)),
              engineRows.filter(r => Number(r.input_data_id) === shareId))
          }
        }
      } else {
        // Mốc lịch: dòng engine theo thứ tự lượt (mỗi lượt engine một mốc); dòng bộ cũ theo cửa sổ thời gian của lượt.
        const slotRows = engineRows.filter(r => r.input_data_id == null)
        let cursor = 0
        for (const run of p.runs) {
          if (!current.done.has(run.id)) continue
          const inWindow = windowOf(run)
          const legacyRows = legacy.filter(d => d.input_data_id == null && inWindow(d))
          // Dòng engine của mốc: theo data.runId (mã lượt workflow, R1) nếu có; không thì theo thứ tự.
          const done = current.done.get(run.id)
          const wfRunId = done?.result?.runId
          let mine = wfRunId ? slotRows.filter(r => String(r.data?.runId ?? '') === String(wfRunId)) : []
          if (mine.length === 0) mine = slotRows.slice(cursor, cursor + legacyRows.length)
          cursor += mine.length
          compareTarget(' (mốc)', run, null, legacyRows, mine)
        }
      }
      process.stdout.write(`\r${campaignNo}/${plans.length} chiến dịch`)
    }
    console.log()
    report.facadeUnknown = Object.fromEntries(facadeUnknown)
    const uc = {}
    for (const [kind, name, detail] of unknownCalls) bump(uc, `${kind} ${name}`, detail)
    report.clientUnknown = uc
    report.finishedAt = new Date().toISOString()

    // ---- In bảng ----
    const lines = Object.entries(report.matrix).sort((a, b) => a[0].localeCompare(b[0]))
    let same = 0, approved = 0
    for (const [key, v] of lines) {
      const parts = key.split(' | ')
      const [l, e] = parts[1].split(' → ')
      const mark = l === e ? '  ' : parts[3]?.startsWith('đã chốt') ? '= ' : '≠ '
      if (mark === '  ') same += v.n; else if (mark === '= ') approved += v.n; else unexplained += v.n
      console.log(`${mark}${String(v.n).padStart(4)}  ${key}`)
    }
    console.log(`\nDữ liệu khớp dòng lịch sử: ${same}, khác đã chốt: ${approved}, khác chưa giải thích: ${unexplained}`)
    console.log('\nSự kiện:')
    for (const [key, v] of Object.entries(report.events).sort((a, b) => b[1].n - a[1].n)) console.log(`${String(v.n).padStart(4)}  ${key}`)
    const problems = report.campaigns.filter(c => c.problems.length)
    if (problems.length) {
      console.log('\nVấn đề:')
      for (const c of problems.slice(0, 30)) console.log(`  ${c.id} ${c.type}: ${c.problems.slice(0, 3).join(' | ')}`)
    }
    if (Object.keys(report.facadeUnknown).length) console.log('\nfacade chưa giả:', JSON.stringify(report.facadeUnknown))
    if (Object.keys(report.clientUnknown).length) console.log('client:', JSON.stringify(Object.fromEntries(Object.entries(report.clientUnknown).map(([k, v]) => [k, v.n]))))
    if (outPath) fs.writeFileSync(outPath, JSON.stringify(report, null, 1))
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
    fs.rmSync(mediaDir, { recursive: true, force: true })
  }
}

/** Số data lệch bộ cũ mà chưa nằm trong quyết định đã chốt: khác 0 thì mã thoát 1. */
let unexplained = 0
main().then(() => process.exit(unexplained > 0 ? 1 : 0), error => { console.error(error); process.exit(1) })
