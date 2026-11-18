// Kiêm up tin Facebook: mỗi lượt up của một bài lấy một câu khác nhau dù chia cho nhiều tài khoản (V531); mỗi bài bắt đầu
// từ một câu ngẫu nhiên (anh chốt 18/11/2026).
// Không kết nối production: RPC aka_agent_take_campaign_content_index chạy đúng thân đang chạy trên akachat
// (migrations/snapshots/post-bump-content-rotation-v531/source.json) trong PGlite; bộ lập lịch, chèn data, đồng bộ
// nội dung chạy mã thật với DB giả.
// AKA_CHAT_REPO=/path/to/akaAgentChatApi node scripts/post-bump-content-rotation-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const harness = require('./fixtures/post-bump-content-rotation/harness.cjs')

const { root, loadTs, shared, startAt, seededRandom } = harness
const results = []
const check = (name, fn) => results.push({ name, fn })
const rotationInsert = loadTs('src/main/data/campaignInputContentRotation.ts')
const sync = loadTs('src/main/services/postBumpContentSync.ts', { '../../shared/postBumpContent': shared })

// ---------------------------------------------------------------- chia câu
check('chia câu: lượt thứ i lấy (bắt đầu + i), bắt đầu ngẫu nhiên mỗi bài', () => {
  assert.deepEqual(shared.planPostBumpContentIndexes(3, () => 0), { indexes: [0, 1, 2] })
  assert.deepEqual(shared.planPostBumpContentIndexes(2, startAt(7)), { indexes: [7, 8] })
  assert.deepEqual(shared.planPostBumpContentIndexes(1, startAt(123_456_789)), { indexes: [123_456_789] })
  const top = shared.planPostBumpContentIndexes(10, () => 0.999_999_999_999)
  assert.equal(top.indexes[0], 999_999_999)
  assert.ok(top.indexes.every(i => Number.isSafeInteger(i) && String(i).length <= 16), 'RPC nhận 1–16 chữ số')
  for (const bad of [() => NaN, () => -1, () => Infinity, () => 'x']) {
    assert.deepEqual(shared.planPostBumpContentIndexes(1, bad).indexes, [0], String(bad))
  }
  assert.deepEqual(shared.planPostBumpContentIndexes(0, () => 0.5), { indexes: [] })
  assert.deepEqual(shared.planPostBumpContentIndexes(-2, () => 0.5), { indexes: [] })
  // Mặc định Math.random: luôn liên tiếp, và hai bài liền nhau không buộc phải tiếp nối.
  const a = shared.planPostBumpContentIndexes(3).indexes
  assert.deepEqual(a, [a[0], a[0] + 1, a[0] + 2])
  const starts = new Set(Array.from({ length: 200 }, () => shared.planPostBumpContentIndexes(1).indexes[0] % 5))
  assert.equal(starts.size, 5, 'bắt đầu rải đều qua mọi câu')
})

// ---------------------------------------------------------------- quyết định đồng bộ
check('đồng bộ: chỉ khi khách đổi Nội dung up tin ở chế độ tạo mới', () => {
  const mapping = { 21: 101, 22: 102, 23: 102, 24: 0, 25: 'x' }
  const after = { postBumpMode: 'create', postBumpContent: '  a|b|c ', postBumpCreatedCampaignIdsByAccount: mapping }
  assert.deepEqual(shared.planPostBumpContentSync('facebook_group_post', { postBumpContent: 'a|b' }, after),
    { content: 'a|b|c', targetCampaignIds: [101, 102] })
  assert.equal(shared.planPostBumpContentSync('facebook_group_post', { postBumpContent: 'a|b|c\n' }, after), null, 'chỉ khác khoảng trắng')
  assert.equal(shared.planPostBumpContentSync('facebook_group_post', null, after), null, 'không đọc được bản cũ')
  assert.equal(shared.planPostBumpContentSync('facebook_group_post', {}, { ...after, postBumpMode: 'select' }), null)
  assert.equal(shared.planPostBumpContentSync('facebook_group_post', {}, { ...after, postBumpContent: '  ' }), null)
  assert.equal(shared.planPostBumpContentSync('facebook_timeline_post', {}, after), null)
  assert.equal(shared.planPostBumpContentSync('facebook_group_post', {}, { ...after, postBumpCreatedCampaignIdsByAccount: {} }), null)
  assert.deepEqual(shared.planPostBumpContentSync('facebook_group_post', {}, { postBumpContent: 'z', postBumpCreatedCampaignIdsByAccount: { 1: 9 } }),
    { content: 'z', targetCampaignIds: [9] }, 'thiếu postBumpMode = tạo mới')
  const target = { actionId: 'facebook_comment_seeding_post', isDelete: false, staffId: 3, extraSettings: { commentContent: 'a|b' } }
  assert.equal(shared.shouldSyncPostBumpTarget(target, 3, 'a|b|c'), true)
  assert.equal(shared.shouldSyncPostBumpTarget({ ...target, extraSettings: { commentContent: ' a|b|c ' } }, 3, 'a|b|c'), false)
  assert.equal(shared.shouldSyncPostBumpTarget({ ...target, isDelete: true }, 3, 'x'), false)
  assert.equal(shared.shouldSyncPostBumpTarget({ ...target, actionId: 'facebook_group_post' }, 3, 'x'), false)
  assert.equal(shared.shouldSyncPostBumpTarget({ ...target, staffId: 4 }, 3, 'x'), false)
  assert.equal(shared.shouldSyncPostBumpTarget({ ...target, extraSettings: { advancedContentEnabled: true } }, 3, 'x'), false)
  assert.equal(shared.shouldSyncPostBumpTarget(null, 3, 'x'), false)
})

// ---------------------------------------------------------------- dịch vụ đồng bộ
function syncStore(campaigns, failOn = new Set()) {
  const updates = []
  const logs = []
  return {
    updates, logs,
    getCampaign: async id => campaigns.get(id) ?? null,
    updateCampaign: async (id, patch) => {
      if (failOn.has(id)) throw new Error('network')
      updates.push({ id, patch })
      const next = { ...campaigns.get(id), ...patch }
      campaigns.set(id, next)
      return next
    },
    appendCampaignLog: async (id, text) => { logs.push({ id, text }) }
  }
}
const target = (id, extra = {}, rest = {}) => [id, {
  id, actionId: 'facebook_comment_seeding_post', isDelete: false, staffId: 3, content: 'a|b',
  extraSettings: { enableComment: true, commentContent: 'a|b', commentCount: 1, ...extra }, ...rest
}]
const source = (content, mapping) => ({
  id: 7, name: 'Đăng nhóm BĐS', actionId: 'facebook_group_post', staffId: 3,
  extraSettings: { enablePostBump: true, postBumpMode: 'create', postBumpContent: content, postBumpCreatedCampaignIdsByAccount: mapping }
})

check('đồng bộ: chép nội dung mới, bỏ qua chiến dịch xoá/khác loại/nâng cao, giữ cấu hình khác', async () => {
  const campaigns = new Map([
    target(101), target(102, { commentContent: 'khách sửa tay' }), target(103, {}, { isDelete: true }),
    target(104, { advancedContentEnabled: true }), [105, { id: 105, actionId: 'facebook_group_post', staffId: 3 }]
  ])
  const store = syncStore(campaigns)
  const result = await sync.syncPostBumpTargetContent(store, { extraSettings: { postBumpContent: 'a|b' } },
    source('a|b|c', { 1: 101, 2: 102, 3: 103, 4: 104, 5: 105, 6: 999 }))
  assert.deepEqual(result, { updatedCampaignIds: [101, 102], failedCampaignIds: [] })
  assert.deepEqual(store.updates[0], { id: 101, patch: { content: 'a|b|c',
    extraSettings: { enableComment: true, commentContent: 'a|b|c', commentCount: 1 } } })
  assert.equal(campaigns.get(102).extraSettings.commentContent, 'a|b|c', 'khách đổi nội dung nguồn thì nội dung nguồn thắng')
  assert.deepEqual(store.logs.map(l => [l.id, l.text]), [
    [101, '✅ Đã cập nhật nội dung up tin từ chiến dịch "Đăng nhóm BĐS"'],
    [102, '✅ Đã cập nhật nội dung up tin từ chiến dịch "Đăng nhóm BĐS"'],
    [7, '✅ Đã cập nhật nội dung up tin cho 2 chiến dịch up tin']
  ])
})

check('đồng bộ: không đổi nội dung nguồn thì giữ nội dung khách sửa thẳng trong chiến dịch up tin', async () => {
  const campaigns = new Map([target(102, { commentContent: 'x|y|z' })])
  const store = syncStore(campaigns)
  const result = await sync.syncPostBumpTargetContent(store, { extraSettings: { postBumpContent: 'a|b' } }, source('a|b\n', { 1: 102 }))
  assert.deepEqual(result, { updatedCampaignIds: [], failedCampaignIds: [] })
  assert.equal(store.updates.length + store.logs.length, 0)
  assert.equal(campaigns.get(102).extraSettings.commentContent, 'x|y|z')
})

check('đồng bộ: một chiến dịch lỗi không chặn chiến dịch khác, báo trong lịch sử chạy', async () => {
  const campaigns = new Map([target(101), target(102)])
  const store = syncStore(campaigns, new Set([101]))
  const result = await sync.syncPostBumpTargetContent(store, { extraSettings: { postBumpContent: 'a|b' } }, source('c|d', { 1: 101, 2: 102 }))
  assert.deepEqual(result, { updatedCampaignIds: [102], failedCampaignIds: [101] })
  assert.deepEqual(store.logs.filter(l => l.id === 7).map(l => l.text), [
    '✅ Đã cập nhật nội dung up tin cho 1 chiến dịch up tin',
    '⚠️ Chưa cập nhật được nội dung up tin cho 1 chiến dịch up tin, vui lòng sửa trực tiếp trong chiến dịch up tin'
  ])
})

// ---------------------------------------------------------------- chèn data khi thiếu quyền cột
check('chèn data: gửi cột chỉ số, thiếu quyền (42501) thì chèn lại không có cột và nghỉ 10 phút', async () => {
  rotationInsert.resetContentRotationInsertStateForTests()
  assert.deepEqual(rotationInsert.normalizeContentRotationIndexes({ fb_comment: 2, bad: -1, x: 1.5, '': 3, y: '4' }), { fb_comment: 2 })
  assert.equal(rotationInsert.normalizeContentRotationIndexes({ bad: -1 }), null)
  assert.equal(rotationInsert.normalizeContentRotationIndexes([1]), null)
  let clock = 1_000_000
  const now = () => clock
  const calls = []
  const denied = { data: null, error: { code: '42501', message: 'permission denied for table auto_campaign_input_data' } }
  const run = response => rows => { calls.push(rows); return Promise.resolve(typeof response === 'function' ? response(rows) : response) }
  const rows = [{ uid: 'a', content_rotation_indexes: { fb_comment: 4 } }, { uid: 'b' }]

  let out = await rotationInsert.insertWithContentRotationFallback(rows, run({ data: ['ok'], error: null }), now)
  assert.deepEqual(out, { data: ['ok'], error: null })
  assert.deepEqual(calls.pop(), [{ uid: 'a', content_rotation_indexes: { fb_comment: 4 } }, { uid: 'b', content_rotation_indexes: {} }], 'cùng tập cột')

  out = await rotationInsert.insertWithContentRotationFallback(rows, run(r => r[0].content_rotation_indexes ? denied : { data: ['fallback'], error: null }), now)
  assert.deepEqual(out, { data: ['fallback'], error: null })
  assert.deepEqual(calls.splice(0), [
    [{ uid: 'a', content_rotation_indexes: { fb_comment: 4 } }, { uid: 'b', content_rotation_indexes: {} }],
    [{ uid: 'a' }, { uid: 'b' }]
  ])

  clock += 9 * 60 * 1000
  await rotationInsert.insertWithContentRotationFallback(rows, run({ data: [], error: null }), now)
  assert.deepEqual(calls.splice(0), [[{ uid: 'a' }, { uid: 'b' }]], 'trong 10 phút không thử cột')
  clock += 2 * 60 * 1000
  await rotationInsert.insertWithContentRotationFallback(rows, run({ data: [], error: null }), now)
  assert.equal(calls.splice(0)[0][0].content_rotation_indexes.fb_comment, 4, 'hết 10 phút thì thử lại cột')

  const rls = { data: null, error: { code: '42501', message: 'new row violates row-level security policy for table "auto_campaign_input_data"' } }
  out = await rotationInsert.insertWithContentRotationFallback(rows, run(rls), now)
  assert.equal(out, rls, 'lỗi RLS không chèn lại')
  assert.equal(calls.splice(0).length, 1)

  await rotationInsert.insertWithContentRotationFallback([{ uid: 'c' }], run({ data: [], error: null }), now)
  assert.deepEqual(calls.splice(0), [[{ uid: 'c' }]], 'không chọn trước thì không gửi cột')
})

// ---------------------------------------------------------------- bộ lập lịch thật
/** `starts`: câu bắt đầu của từng bài theo thứ tự (bộ lập lịch gọi hàm ngẫu nhiên một lần mỗi bài). */
function enqueueFixture(extra, targetIds, starts = []) {
  const queue = [...starts]
  const Harness = harness.loadEnqueueHarness(() => (queue.shift() + 0.5) / 1_000_000_000)
  const campaign = { id: 7, name: 'Đăng nhóm', actionId: 'facebook_group_post', extraSettings: { enablePostBump: true, ...extra } }
  const inserted = []
  const scheduler = Object.assign(new Harness(), {
    cleanPostLinkForStorage: url => url,
    resolvePostBumpTargets: async () => targetIds.map(campaignId => ({ campaignId })),
    getDatabaseBusinessNow: async () => new Date('2026-11-14T03:00:00Z'),
    updateCampaignAndBroadcast: async (_id, patch) => Object.assign(campaign, patch),
    refreshPostBumpTargetCampaignSchedule: async () => {},
    logCampaignProgress: async () => {},
    supabase: { createCampaignInputData: async row => { inserted.push(row); return row } }
  })
  return { campaign, inserted, scheduler, queue }
}

check('bộ lập lịch: 3 lượt chia cho 3 tài khoản mang 3 chỉ số câu liên tiếp từ câu bắt đầu của bài', async () => {
  const { campaign, inserted, scheduler, queue } = enqueueFixture({ postBumpCount: 3 }, [101, 102, 103], [40, 7])
  await scheduler.enqueuePostBumpAfterGroupPost(campaign, 'https://facebook.com/groups/1/posts/9/')
  assert.deepEqual(inserted.map(r => [r.campaignId, r.contentRotationIndexes]),
    [[101, { fb_comment: 40 }], [102, { fb_comment: 41 }], [103, { fb_comment: 42 }]])
  assert.equal(campaign.extraSettings.postBumpContentRotationIndex, undefined, 'không còn lưu con trỏ câu')
  assert.equal(campaign.extraSettings.postBumpRotationIndex, 0)
  inserted.length = 0
  await scheduler.enqueuePostBumpAfterGroupPost(campaign, 'https://facebook.com/groups/1/posts/10/')
  assert.deepEqual(inserted.map(r => r.contentRotationIndexes.fb_comment), [7, 8, 9], 'bài sau bắt đầu lại ngẫu nhiên')
  assert.equal(queue.length, 0, 'một lần ngẫu nhiên cho mỗi bài')
})

check('bộ lập lịch: 2 lượt/bài trên 3 tài khoản, chỉ số câu không phụ thuộc tài khoản; bài chờ duyệt không thêm', async () => {
  const { campaign, inserted, scheduler, queue } = enqueueFixture({ postBumpCount: 2, postBumpContentRotationIndex: 5 },
    [101, 102, 103], [5, 0, 99])
  await scheduler.enqueuePostBumpAfterGroupPost(campaign, 'p1')
  await scheduler.enqueuePostBumpAfterGroupPost(campaign, 'p2')
  assert.deepEqual(inserted.map(r => [r.uid, r.campaignId, r.contentRotationIndexes.fb_comment]),
    [['p1', 101, 5], ['p1', 102, 6], ['p2', 103, 0], ['p2', 101, 1]])
  inserted.length = 0
  await scheduler.enqueuePostBumpAfterGroupPost(campaign, 'p3', true)
  assert.equal(inserted.length, 0)
  assert.deepEqual(queue, [99], 'bài chờ duyệt không chọn câu')
})

// ---------------------------------------------------------------- RPC thật + V531 trên PGlite
check('PGlite: V531 cấp đúng quyền INSERT cột, chặn apply lại, kiểm thân RPC; rollback thu lại', async () => {
  await withDb(async (db, helpers) => {
    const { asDesktop, failures, applyFile } = helpers
    await failures(() => asDesktop(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid,content_rotation_indexes)
      VALUES(101,'chờ xử lý','u','{"fb_comment":1}')`), /permission denied/)
    await asDesktop(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid) VALUES(101,'chờ xử lý','u')`)

    // Thân RPC khác bản đã chụp thì không apply.
    const original = helpers.snapshot.functiondef
    await db.exec(original.replace('Modulo the current snapshot size', 'Modulo the current snapshot  size'))
    await failures(() => applyFile('migration_v531_post_bump_content_rotation_desktop.sql'), /v531_content_index_rpc_body_unexpected/)
    await db.exec(original)

    await applyFile('migration_v531_post_bump_content_rotation_desktop.sql')
    await asDesktop(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid,content_rotation_indexes)
      VALUES(101,'chờ xử lý','u','{"fb_comment":1}')`)
    await failures(() => asDesktop(`UPDATE auto_campaign_input_data SET content_rotation_indexes='{}'`), /permission denied/)
    await failures(() => applyFile('migration_v531_post_bump_content_rotation_desktop.sql'), /v531_already_applied_do_not_reapply/)

    await applyFile('rollback_v531_post_bump_content_rotation_desktop.sql')
    await failures(() => asDesktop(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid,content_rotation_indexes)
      VALUES(101,'chờ xử lý','u','{"fb_comment":1}')`), /permission denied/)
    await asDesktop(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid) VALUES(101,'chờ xử lý','u')`)
    await applyFile('migration_v531_post_bump_content_rotation_desktop.sql')
  })
})

check('PGlite: RPC thật — không chọn trước thì 3 tài khoản cùng câu; chọn trước thì mỗi lượt một câu', async () => {
  await withDb(async (db, helpers) => {
    const { applyFile, addInput, take, campaignCursors } = helpers
    await applyFile('migration_v531_post_bump_content_rotation_desktop.sql')

    // Hành vi cũ (tái hiện lỗi 14/11): mỗi chiến dịch up tin bắt đầu con trỏ từ 0.
    const legacy = [await addInput(101), await addInput(102), await addInput(103)]
    assert.deepEqual(await Promise.all(legacy.map((id, i) => take(101 + i, id, 3))), [0, 0, 0])
    assert.deepEqual(await campaignCursors(), { 101: 1, 102: 1, 103: 1 })

    // Bản sửa: bộ lập lịch giao (bắt đầu + i) theo planPostBumpContentIndexes, bắt đầu ngẫu nhiên mỗi bài.
    for (const post of [0, 1, 2, 3]) {
      const plan = shared.planPostBumpContentIndexes(3, startAt(post * 3))
      const ids = []
      for (let i = 0; i < 3; i++) ids.push(await addInput(101 + i, { [shared.POST_BUMP_COMMENT_ACTION_CODE]: plan.indexes[i] }))
      const got = await Promise.all(ids.map((id, i) => take(101 + i, id, 3)))
      assert.equal(new Set(got).size, 3, `bài ${post}: ${got}`)
      assert.deepEqual(got, [0, 1, 2])
    }
    assert.deepEqual(await campaignCursors(), { 101: 1, 102: 1, 103: 1 }, 'chỉ số chọn trước không đụng con trỏ chiến dịch')

    // Câu bắt đầu không chia hết số câu vẫn khác nhau trong một bài.
    const plan = shared.planPostBumpContentIndexes(3, startAt(7))
    const ids = []
    for (let i = 0; i < 3; i++) ids.push(await addInput(101 + i, { fb_comment: plan.indexes[i] }))
    assert.deepEqual(await Promise.all(ids.map((id, i) => take(101 + i, id, 3))), [1, 2, 0])

    // Bắt đầu ngẫu nhiên thật (có hạt giống): 30 bài, 5 câu, 3 lượt/bài chia 3 tài khoản → không bài nào trùng câu, và mỗi tài
    // khoản đổi câu giữa các bài.
    const random = seededRandom(20261118)
    const perAccount = new Map()
    for (let post = 0; post < 30; post++) {
      const indexes = shared.planPostBumpContentIndexes(3, random).indexes
      const got = []
      for (let i = 0; i < 3; i++) got.push(await take(101 + i, await addInput(101 + i, { fb_comment: indexes[i] }), 5))
      assert.equal(new Set(got).size, 3, `bài ${post}: ${got}`)
      got.forEach((t, i) => perAccount.set(101 + i, (perAccount.get(101 + i) || new Set()).add(t)))
    }
    for (const [account, used] of perAccount) assert.equal(used.size, 5, `tài khoản ${account} dùng đủ 5 câu`)

    // Mỗi chiến dịch tự mod theo số câu của nó (khách sửa tay chiến dịch up tin); 1 câu thì luôn 0.
    assert.equal(await take(101, await addInput(101, { fb_comment: 5 }), 4), 1)
    assert.equal(await take(102, await addInput(102, { fb_comment: 5 }), 1), 0)
    assert.equal(await take(103, await addInput(103, { fb_comment: 5 }), 51), 5)

    // Thử lại đúng dòng đó thì sang câu kế (hành vi V350 sẵn có).
    const retry = await addInput(101, { fb_comment: 2 })
    assert.deepEqual([await take(101, retry, 3), await take(101, retry, 3)], [2, 0])
  })
})

// ---------------------------------------------------------------- PGlite harness
async function withDb(fn) {
  await harness.withPostBumpDb(async db => {
    await harness.addClaimedCampaigns(db, [101, 102, 103])
    const helpers = {
      snapshot: harness.snapshot,
      asDesktop: async sql => { try { await db.exec(`SET ROLE aka_agent_desktop; ${sql}`) } finally { await db.exec('RESET ROLE') } },
      failures: async (fn, pattern) => {
        await assert.rejects(fn, pattern)
        // Migration lỗi để lại giao dịch hỏng; ROLLBACK ngoài giao dịch chỉ cảnh báo.
        await db.exec('ROLLBACK').catch(() => {})
        await db.exec('RESET ROLE').catch(() => {})
      },
      applyFile: name => db.exec(fs.readFileSync(path.join(root, 'migrations', name), 'utf8')),
      addInput: async (campaignId, indexes) => {
        await db.exec('SET ROLE aka_agent_desktop')
        try {
          const row = indexes
            ? (await db.query(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid,content_rotation_indexes)
                VALUES($1,'chờ xử lý','post',$2) RETURNING id`, [campaignId, JSON.stringify(indexes)])).rows[0]
            : (await db.query(`INSERT INTO auto_campaign_input_data(campaign_id,status,uid) VALUES($1,'chờ xử lý','post') RETURNING id`, [campaignId])).rows[0]
          return Number(row.id)
        } finally { await db.exec('RESET ROLE') }
      },
      take: async (campaignId, inputId, count) => {
        await db.query(`UPDATE auto_campaign_input_data SET status='đang chạy' WHERE id=$1`, [inputId])
        await db.query(`UPDATE auto_campaigns SET runtime_unit_input_data_ids = array_append(runtime_unit_input_data_ids, $2::bigint) WHERE id=$1`, [campaignId, inputId])
        return harness.takeContentIndex(db, campaignId, inputId, count)
      },
      campaignCursors: async () => Object.fromEntries((await db.query(
        `SELECT id, (content_rotation_indexes->>'fb_comment')::int AS c FROM auto_campaigns ORDER BY id`)).rows.map(r => [r.id, r.c]))
    }
    await fn(db, helpers)
  })
}

;(async () => {
  let failed = 0
  for (const { name, fn } of results) {
    try {
      await fn()
      console.log(`PASS ${name}`)
    } catch (error) {
      failed++
      console.log(`FAIL ${name}`)
      console.log(error)
    }
  }
  console.log(`${results.length - failed}/${results.length} nhóm đạt`)
  process.exitCode = failed ? 1 : 0
})()
