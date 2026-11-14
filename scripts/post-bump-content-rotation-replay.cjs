// Phát lại lịch sử up tin Facebook thật qua bản sửa V531 (không ghi production).
//
// Đầu vào: file JSON xuất CHỈ ĐỌC từ akachat bằng scripts/fixtures/post-bump-content-rotation/export.sql
// (sources / targets / inputs / details). File có nội dung khách: để ngoài repo.
//
// 1. Hiệu chỉnh: chạy cách cũ (con trỏ từng chiến dịch) qua RPC thật trên PGlite, so chỉ số câu dự đoán với chỉ số
//    production đã dùng (content_rotation_indexes của dòng data = chỉ số dùng lần cuối + 1).
// 2. Cách mới: mỗi bài chạy hàm thật enqueuePostBumpAfterGroupPost (giữ đúng tài khoản nhận từng lượt như production),
//    chèn dòng data có chỉ số chọn trước, rồi gọi RPC thật theo đúng thứ tự thời gian và số lần chạy lại.
// 3. So từng bài: cách cũ / cách mới có lượt nào trùng câu, và phân loại mọi ca còn trùng.
// 4. Đồng bộ "Nội dung up tin": lưu không đổi thì không ghi; giả lập đổi nội dung thì ghi những chiến dịch nào.
//
// AKA_CHAT_REPO=/path/to/akaAgentChatApi node scripts/post-bump-content-rotation-replay.cjs <data.json> [--out summary.json]
const fs = require('node:fs')
const {
  shared, loadEnqueueHarness, commentVariants, withPostBumpDb, addClaimedCampaigns, takeContentIndex
} = require('./fixtures/post-bump-content-rotation/harness.cjs')

const args = process.argv.slice(2)
const dataPath = args[0]
const outPath = args.includes('--out') ? args[args.indexOf('--out') + 1] : null
if (!dataPath) {
  console.error('Thiếu đường dẫn file dữ liệu')
  process.exit(2)
}
// Nhận cả file CLI xuất thẳng (có dòng chữ trước JSON và lớp rows) lẫn JSON đã bóc.
function readExport(file) {
  const text = fs.readFileSync(file, 'utf8')
  let parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  if (Array.isArray(parsed.rows)) parsed = Object.values(parsed.rows[0])[0]
  return parsed
}
const data = readExport(dataPath)
const BATCH_GAP_MS = 10 * 60 * 1000
const ms = value => new Date(value).getTime()

// ---------------------------------------------------------------- chiến dịch up tin
const targets = new Map()
for (const t of data.targets) {
  const variants = t.advanced ? [] : commentVariants(t.comment_content)
  const count = t.advanced ? Number(t.advanced_items || 0) : variants.length
  targets.set(Number(t.id), { ...t, id: Number(t.id), variants: variants.map(v => v.trim()), count })
}
const owners = new Map()
for (const s of data.sources) {
  const ex = s.ex || {}
  const ids = []
  if (ex.postBumpCreatedCampaignIdsByAccount && typeof ex.postBumpCreatedCampaignIdsByAccount === 'object') {
    ids.push(...Object.values(ex.postBumpCreatedCampaignIdsByAccount))
  }
  if (Array.isArray(ex.postBumpTargetCampaignIds)) ids.push(...ex.postBumpTargetCampaignIds)
  for (const raw of ids) {
    const id = Math.floor(Number(raw))
    if (!Number.isSafeInteger(id) || id <= 0) continue
    if (!owners.has(id)) owners.set(id, new Set())
    owners.get(id).add(Number(s.id))
  }
}

// ---------------------------------------------------------------- lượt up đã chạy
const detailsByInput = new Map()
for (const d of data.details) {
  const id = Number(d.input_data_id)
  if (!detailsByInput.has(id)) detailsByInput.set(id, [])
  detailsByInput.get(id).push(d)
}
for (const list of detailsByInput.values()) list.sort((a, b) => ms(a.created_at) - ms(b.created_at))

const inputs = data.inputs
  .filter(i => !i.is_delete && targets.has(Number(i.campaign_id)) && targets.get(Number(i.campaign_id)).action_id === 'facebook_comment_seeding_post')
  .map(i => {
    const target = targets.get(Number(i.campaign_id))
    const details = detailsByInput.get(Number(i.id)) || []
    const rot = i.rot && Number.isInteger(i.rot.fb_comment) ? i.rot.fb_comment : null
    // Đã lấy câu: chiến dịch ≥ 2 câu thì RPC luôn ghi chỉ số lên dòng data (= chỉ số dùng lần cuối + 1); 1 câu thì
    // RPC không ghi, dựa vào comment thành công. Có dòng kết quả mà không có chỉ số là block dừng trước khi lấy câu
    // (vd bài không còn), không tính.
    const ran = target.count >= 2 ? rot !== null : details.some(d => d.status === 'thành công')
    const takes = ran ? Math.max(1, details.length) : 0
    const actual = !ran ? null : target.count >= 2 ? ((rot - 1) % target.count + target.count) % target.count : 0
    const takeTimes = details.length > 0 ? details.map(d => ms(d.created_at)) : [ms(i.schedule || i.created_at)]
    return { ...i, id: Number(i.id), campaign_id: Number(i.campaign_id), target, details, rot, ran, takes, actual, takeTimes }
  })

// Một bài = các dòng cùng uid được thêm trong cùng một lần (cách nhau ≤ 10 phút), theo thứ tự tạo.
const byUid = new Map()
for (const i of inputs) {
  if (!byUid.has(i.uid)) byUid.set(i.uid, [])
  byUid.get(i.uid).push(i)
}
const batches = []
for (const list of byUid.values()) {
  list.sort((a, b) => ms(a.created_at) - ms(b.created_at) || a.id - b.id)
  let current = []
  for (const i of list) {
    if (current.length && ms(i.created_at) - ms(current[current.length - 1].created_at) > BATCH_GAP_MS) {
      batches.push(current)
      current = []
    }
    current.push(i)
  }
  if (current.length) batches.push(current)
}
for (const b of batches) b.sort((a, b2) => a.id - b2.id)

function batchSource(batch) {
  let common = null
  for (const i of batch) {
    const set = owners.get(i.campaign_id) || new Set()
    common = common === null ? new Set(set) : new Set([...common].filter(id => set.has(id)))
  }
  return common && common.size === 1 ? [...common][0] : common && common.size > 1 ? Math.min(...common) : null
}

// ---------------------------------------------------------------- RPC thật trên PGlite
async function replayTakes(seedFor, initialCursorFor) {
  return withPostBumpDb(async db => {
    const campaignIds = [...new Set(inputs.map(i => i.campaign_id))]
    await addClaimedCampaigns(db, campaignIds)
    for (const [campaignId, cursor] of initialCursorFor) {
      await db.query(`UPDATE auto_campaigns SET content_rotation_indexes = jsonb_build_object('fb_comment', $2::int) WHERE id = $1`, [campaignId, cursor])
    }
    const rows = inputs.map(i => ({ id: i.id, campaign_id: i.campaign_id, status: 'đang chạy', uid: i.uid,
      content_rotation_indexes: seedFor.has(i.id) ? { fb_comment: seedFor.get(i.id) } : {} }))
    for (let start = 0; start < rows.length; start += 2000) {
      await db.query(`INSERT INTO auto_campaign_input_data(id, campaign_id, status, uid, content_rotation_indexes)
        SELECT id, campaign_id, status, uid, content_rotation_indexes FROM json_to_recordset($1::json)
          AS x(id bigint, campaign_id bigint, status text, uid text, content_rotation_indexes jsonb)`, [JSON.stringify(rows.slice(start, start + 2000))])
    }
    await db.exec(`UPDATE auto_campaigns c SET runtime_unit_input_data_ids = x.ids
      FROM (SELECT campaign_id, array_agg(id) ids FROM auto_campaign_input_data GROUP BY campaign_id) x WHERE x.campaign_id = c.id`)

    // Mọi lần lấy câu theo thời gian thật. Lượt chưa chạy được tính một lần SAU mốc xuất dữ liệu (theo giờ hẹn),
    // vì nó chưa lấy câu nào; đặt ở giờ hẹn cũ sẽ chiếm con trỏ trước các lượt đã chạy thật.
    const exportedAt = ms(data.exported_at)
    const events = []
    for (const i of inputs) {
      const times = i.ran ? i.takeTimes.slice(0, i.takes) : [Math.max(exportedAt + 1, ms(i.schedule || i.created_at))]
      times.forEach((time, n) => events.push({ time, n, input: i }))
    }
    events.sort((a, b) => a.time - b.time || a.input.id - b.input.id || a.n - b.n)
    const last = new Map()
    let calls = 0
    for (const e of events) {
      const count = Math.max(1, e.input.target.count)
      last.set(e.input.id, await takeContentIndex(db, e.input.campaign_id, e.input.id, count))
      calls++
    }
    return { last, calls }
  })
}

// ---------------------------------------------------------------- 1. hiệu chỉnh cách cũ
function oldInitialCursors() {
  const first = new Map()
  for (const i of inputs) {
    if (!i.ran || i.target.count < 2 || i.actual === null) continue
    const t = i.takeTimes[0]
    const prev = first.get(i.campaign_id)
    if (!prev || t < prev.t) first.set(i.campaign_id, { t, index: i.actual, retake: i.takes > 1 })
  }
  // Lượt đầu chạy lại thì chỉ số cuối = chỉ số đầu + 1: lùi lại cho lần lấy đầu.
  return new Map([...first].map(([id, f]) => {
    const n = targets.get(id).count
    return [id, f.retake ? ((f.index - 1) % n + n) % n : f.index]
  }))
}

// ---------------------------------------------------------------- 2. cách mới qua hàm thật của bộ lập lịch
async function newSeeds() {
  const Harness = loadEnqueueHarness()
  const seeds = new Map()
  const bySource = new Map()
  let unknownSource = 0
  for (const batch of batches) {
    const src = batchSource(batch)
    if (src === null) unknownSource++
    const key = src ?? `uid:${batch[0].uid}`
    if (!bySource.has(key)) bySource.set(key, [])
    bySource.get(key).push(batch)
  }
  let mismatch = 0
  for (const list of bySource.values()) {
    list.sort((a, b) => ms(a[0].created_at) - ms(b[0].created_at))
    const campaign = { id: 1, name: 'nguồn', actionId: 'facebook_group_post', extraSettings: { enablePostBump: true } }
    let rows = []
    const scheduler = Object.assign(new Harness(), {
      cleanPostLinkForStorage: url => url,
      resolvePostBumpTargets: async () => currentTargets,
      getDatabaseBusinessNow: async () => new Date(),
      updateCampaignAndBroadcast: async (_id, patch) => Object.assign(campaign, patch),
      refreshPostBumpTargetCampaignSchedule: async () => {},
      logCampaignProgress: async () => {},
      supabase: { createCampaignInputData: async row => { rows.push(row); return row } }
    })
    let currentTargets = []
    for (const batch of list) {
      // Giữ đúng tài khoản nhận từng lượt như production: lượt i → chiến dịch của dòng thứ i.
      currentTargets = batch.map(i => ({ campaignId: i.campaign_id }))
      campaign.extraSettings = { ...campaign.extraSettings, postBumpCount: batch.length, postBumpRotationIndex: 0 }
      rows = []
      await scheduler.enqueuePostBumpAfterGroupPost(campaign, batch[0].uid)
      if (rows.length !== batch.length) { mismatch++; continue }
      rows.forEach((row, k) => {
        if (row.campaignId !== batch[k].campaign_id) mismatch++
        seeds.set(batch[k].id, row.contentRotationIndexes[shared.POST_BUMP_COMMENT_ACTION_CODE])
      })
    }
  }
  return { seeds, unknownSource, mismatch, sources: bySource.size }
}

// ---------------------------------------------------------------- 3. so từng bài
const distinct = values => new Set(values).size === values.length
function textOf(i, index) {
  return i.target.variants[index] ?? `#${index}`
}
// Xét đủ số lượt của bài (kể cả lượt chưa chạy): chỉ số chọn trước đánh số trên toàn bộ các lượt của bài.
function classifyNew(fullBatch, batch, indexes) {
  const counts = new Set(fullBatch.map(i => i.target.count))
  if (fullBatch.length > Math.min(...counts)) return 'nhiều lượt hơn số câu'
  if (counts.size > 1) return 'số câu khác nhau giữa các chiến dịch up tin'
  if (batch.some(i => i.takes > 1)) return 'chạy lại lượt lỗi'
  if (!distinct(indexes)) return 'LỖI: trùng chỉ số không rõ lý do'
  return 'câu trùng chữ (khách nhập 2 câu giống nhau)'
}

function compare(oldLast, newLast) {
  const scope = { ran: { posts: 0, multiTarget: 0, oldDup: 0, oldDupMulti: 0, newDup: 0, newDupMulti: 0 },
    projected: { posts: 0, multiTarget: 0, newDup: 0, newDupMulti: 0 } }
  const reasons = {}
  const reasonsProjected = {}
  const examples = []
  for (const batch of batches) {
    const ranBatch = batch.filter(i => i.ran)
    if (ranBatch.length >= 2 && ranBatch.every(i => i.actual !== null)) {
      const multi = new Set(ranBatch.map(i => i.campaign_id)).size > 1
      const oldTexts = ranBatch.map(i => textOf(i, i.actual))
      const newIdx = ranBatch.map(i => newLast.get(i.id))
      const newTexts = ranBatch.map((i, k) => textOf(i, newIdx[k]))
      scope.ran.posts++
      if (multi) scope.ran.multiTarget++
      if (!distinct(oldTexts)) { scope.ran.oldDup++; if (multi) scope.ran.oldDupMulti++ }
      if (!distinct(newTexts)) {
        scope.ran.newDup++
        if (multi) scope.ran.newDupMulti++
        const reason = classifyNew(batch, ranBatch, newIdx)
        reasons[reason] = (reasons[reason] || 0) + 1
        if (reason.startsWith('LỖI') && examples.length < 10) {
          examples.push({ uid: batch[0].uid, rows: ranBatch.map((i, k) => ({ input: i.id, campaign: i.campaign_id, count: i.target.count,
            newIndex: newIdx[k], takes: i.takes })), batchSize: batch.length })
        }
      }
    }
    if (batch.length >= 2) {
      const multi = new Set(batch.map(i => i.campaign_id)).size > 1
      const idx = batch.map(i => newLast.get(i.id))
      const texts = batch.map((i, k) => textOf(i, idx[k]))
      scope.projected.posts++
      if (multi) scope.projected.multiTarget++
      if (!distinct(texts)) {
        scope.projected.newDup++
        if (multi) scope.projected.newDupMulti++
        const reason = classifyNew(batch, batch, idx)
        reasonsProjected[reason] = (reasonsProjected[reason] || 0) + 1
      }
    }
  }
  return { scope, reasons, reasonsProjected, examples }
}

// ---------------------------------------------------------------- 4. đồng bộ nội dung
// Chiến dịch đăng nhóm đang bật up tin đặt nhiều lượt/bài hơn số câu thì chắc chắn trùng câu trên một bài.
function countVersusVariants() {
  const out = { liveSources: 0, countAboveVariants: 0, byGap: {} }
  for (const s of data.sources) {
    const ex = s.ex || {}
    if (s.is_delete || ex.enablePostBump !== true || (ex.postBumpMode || 'create') !== 'create') continue
    out.liveSources++
    const count = Math.min(10, Math.max(1, Math.floor(Number(ex.postBumpCount ?? 3)) || 3))
    const variants = commentVariants(ex.postBumpContent).length
    if (count > variants) {
      out.countAboveVariants++
      const key = `${count} lượt / ${variants} câu`
      out.byGap[key] = (out.byGap[key] || 0) + 1
    }
  }
  out.byGap = Object.fromEntries(Object.entries(out.byGap).sort((a, b) => b[1] - a[1]).slice(0, 12))
  return out
}

// Lượt up quá giờ hẹn hơn 1 ngày mà vẫn chờ: chiến dịch up tin không chạy (vấn đề riêng, không do V531).
function pendingOverdue() {
  const cutoff = ms(data.exported_at) - 24 * 3600 * 1000
  const out = { inputs: 0, campaigns: new Set(), byTargetStatus: {} }
  for (const i of inputs) {
    if (i.status !== 'chờ xử lý' || !i.schedule || ms(i.schedule) >= cutoff) continue
    out.inputs++
    out.campaigns.add(i.campaign_id)
    const key = i.target.status || 'null'
    out.byTargetStatus[key] = (out.byTargetStatus[key] || 0) + 1
  }
  return { inputs: out.inputs, campaigns: out.campaigns.size, byTargetStatus: out.byTargetStatus }
}

function syncReplay() {
  const out = { createSources: 0, unchangedSaveWrites: 0, editedSources: 0, wouldUpdate: 0, skipped: {} }
  for (const s of data.sources) {
    const ex = s.ex || {}
    if (s.is_delete || (ex.postBumpMode || 'create') !== 'create') continue
    out.createSources++
    if (shared.planPostBumpContentSync('facebook_group_post', ex, ex)) out.unchangedSaveWrites++
    const edited = { ...ex, postBumpContent: `${ex.postBumpContent || ''} | câu mới` }
    const plan = shared.planPostBumpContentSync('facebook_group_post', ex, edited)
    if (!plan) continue
    out.editedSources++
    for (const id of plan.targetCampaignIds) {
      const t = targets.get(id)
      const snapshot = t && { actionId: t.action_id, isDelete: t.is_delete, staffId: t.staff_id,
        extraSettings: { commentContent: t.comment_content, advancedContentEnabled: t.advanced } }
      if (shared.shouldSyncPostBumpTarget(snapshot, s.staff_id, plan.content)) { out.wouldUpdate++; continue }
      const reason = !t ? 'không còn chiến dịch' : t.is_delete ? 'đã xoá' : t.action_id !== 'facebook_comment_seeding_post'
        ? `khác loại (${t.action_id})` : Number(t.staff_id) !== Number(s.staff_id) ? 'khác nhân viên' : t.advanced ? 'nội dung nâng cao' : 'khác'
      out.skipped[reason] = (out.skipped[reason] || 0) + 1
    }
  }
  return out
}

;(async () => {
  const started = Date.now()
  const oldCursors = oldInitialCursors()
  const oldRun = await replayTakes(new Map(), oldCursors)
  // Chiến dịch up tin tạo trong cửa sổ có đủ lịch sử lấy câu; chiến dịch cũ hơn thì thiếu các lần lấy trước cửa sổ.
  const windowStart = ms(data.exported_at) - 21 * 24 * 3600 * 1000
  let agree = 0, compared = 0
  const byAge = { createdInWindow: { compared: 0, agree: 0 }, older: { compared: 0, agree: 0 } }
  for (const i of inputs) {
    if (!i.ran || i.actual === null || i.target.count < 2) continue
    const bucket = byAge[ms(i.target.created_at) >= windowStart ? 'createdInWindow' : 'older']
    compared++
    bucket.compared++
    if (oldRun.last.get(i.id) === i.actual) { agree++; bucket.agree++ }
  }
  if (args.includes('--dump-old')) {
    fs.writeFileSync(args[args.indexOf('--dump-old') + 1], JSON.stringify(inputs.filter(i => i.ran).map(i => ({
      id: i.id, campaign: i.campaign_id, uid: i.uid, count: i.target.count, takes: i.takes, rot: i.rot, actual: i.actual,
      predicted: oldRun.last.get(i.id), created: i.created_at, schedule: i.schedule, takeTimes: i.takeTimes,
      details: i.details.map(d => d.status)
    }))))
  }
  const plan = await newSeeds()
  const newRun = await replayTakes(plan.seeds, new Map())
  const result = compare(oldRun.last, newRun.last)
  const summary = {
    window: { exportedAt: data.exported_at, inputs: inputs.length, ran: inputs.filter(i => i.ran).length, posts: batches.length },
    calibration: { comparedInputs: compared, agreeWithProduction: agree, rate: compared ? +(agree / compared).toFixed(4) : null, byAge },
    pendingOverdue: pendingOverdue(),
    enqueue: { sources: plan.sources, batchesWithoutUniqueSource: plan.unknownSource, assignmentMismatch: plan.mismatch, seeded: plan.seeds.size },
    rpcCalls: { old: oldRun.calls, new: newRun.calls },
    ...result,
    countVersusVariants: countVersusVariants(),
    sync: syncReplay(),
    seconds: Math.round((Date.now() - started) / 1000)
  }
  console.log(JSON.stringify(summary, null, 2))
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')
})().catch(error => { console.error(error); process.exitCode = 1 })
