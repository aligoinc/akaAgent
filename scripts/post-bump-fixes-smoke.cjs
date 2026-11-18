// Up tin Facebook: các sửa anh chốt 18/11/2026 ngoài cách chia câu (xem docs/POST_BUMP_FIXES_20261118.md).
// - Tài khoản up tin đã xoá thì không chia lượt, không tạo chiến dịch up tin mới.
// - Chiến dịch up tin mới: nghỉ 30 giây giữa hai comment, không làm mới data.
// - Bài không còn trên Facebook: đóng các lượt còn chờ khác của bài trong cùng chiến dịch up tin.
// - Bảo trì ngày mới: lịch theo lượt chờ sớm nhất (quá hạn thì chạy ngay), không làm mới data của up tin.
// - Form tạo / sửa chiến dịch: câu cảnh báo bài có video (câu anh viết).
// Không kết nối production / Facebook: hàm thật của bộ lập lịch chạy với kho giả.
// node scripts/post-bump-fixes-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const harness = require('./fixtures/post-bump-content-rotation/harness.cjs')

const { root, shared } = harness
const results = []
const check = (name, fn) => results.push({ name, fn })

// ---------------------------------------------------------------- nhận chiến dịch up tin
check('nhận chiến dịch up tin theo loại + tên do Kiêm up tin đặt', () => {
  const name = `${shared.POST_BUMP_TARGET_NAME_PREFIX}Đăng nhóm 04/10 - Lee Danh`
  assert.equal(shared.isPostBumpTargetCampaign({ actionId: 'facebook_comment_seeding_post', name }), true)
  assert.equal(shared.isPostBumpTargetCampaign({ actionId: 'facebook_comment_seeding_post', name: 'Comment vào bài khách tự tạo' }), false)
  assert.equal(shared.isPostBumpTargetCampaign({ actionId: 'facebook_group_post', name }), false)
  assert.equal(shared.isPostBumpTargetCampaign(null), false)
  assert.equal(shared.POST_BUMP_SLEEP_BETWEEN_COMMENTS_SECONDS, 30)
  assert.equal(shared.POST_BUMP_POST_NOT_FOUND_NOTE, 'Không tìm thấy bài Facebook để bình luận')
})

// ---------------------------------------------------------------- bảo trì lịch
check('bảo trì: lượt quá hạn → đầu ngày hôm nay; lượt tương lai → giờ của lượt; không còn lượt → cách cũ', () => {
  const todayStart = new Date('2026-11-17T17:00:00.000Z') // 00:00 18/11 giờ VN
  const plan = shared.planPostBumpMaintenanceSchedule
  assert.equal(plan(new Date('2026-11-17T07:37:39Z'), todayStart).toISOString(), todayStart.toISOString(), '57420: quá hạn từ 14:37 17/11')
  assert.equal(plan(todayStart, todayStart).toISOString(), todayStart.toISOString())
  assert.equal(plan(new Date('2026-11-18T02:30:00Z'), todayStart).toISOString(), '2026-11-18T02:30:00.000Z')
  assert.equal(plan(null, todayStart), null)
  assert.equal(plan(new Date('x'), todayStart), null)
})

check('bảo trì (mã nguồn): up tin dùng lịch theo lượt và không làm mới data', () => {
  const repo = fs.readFileSync(path.join(root, 'src/main/data/repositories/campaignRepository.ts'), 'utf8')
  const start = repo.indexOf('export async function maintainCampaignSchedules(')
  const body = repo.slice(start, repo.indexOf('\nexport async function', start + 10))
  assert.match(body, /campaign\.status === 'chờ xử lý' && isPostBumpTargetCampaign\(campaign\)/)
  assert.match(body, /planPostBumpMaintenanceSchedule\(await getEarliestPendingInputSchedule\(campaign\.id, todayStart\), todayStart\)/)
  assert.match(body, /campaign\.refreshData && !isPostBumpTargetCampaign\(campaign\) && \(allDataDone \|\| details\.length === 0\)/)
  // Quy tắc up tin đứng sau kiểm ngày kết thúc và trước nhánh 23:59 / hằng ngày.
  const rule = body.indexOf('isPostBumpTargetCampaign(campaign)) {')
  assert.ok(rule > body.indexOf('isPastScheduleEnd(campaign, nextSchedule)'))
  assert.ok(rule < body.indexOf('isAtOrAfterDailyDrainTime(nextSchedule)'))
  assert.ok(rule < body.indexOf("if (scheduleType === 'daily')"))
})

// ---------------------------------------------------------------- bộ lập lịch thật
const POST_BUMP_METHODS = ['resolvePostBumpTargets', 'resolveCreatedPostBumpTargets', 'loadPostBumpAccount', 'isPostBumpAccountGone',
  'createPostBumpTargetCampaign', 'normalizeRateLimitMinutes', 'closePostBumpRowsOfMissingPost']
const Harness = harness.loadSchedulerMethods(POST_BUMP_METHODS, {
  COMMENT_SEEDING_POST_ACTION_ID: 'facebook_comment_seeding_post',
  DEFAULT_RATE_LIMIT_MINUTES: 65,
  POST_BUMP_SLEEP_BETWEEN_COMMENTS_SECONDS: shared.POST_BUMP_SLEEP_BETWEEN_COMMENTS_SECONDS,
  POST_BUMP_TARGET_NAME_PREFIX: shared.POST_BUMP_TARGET_NAME_PREFIX,
  POST_BUMP_POST_NOT_FOUND_ERROR_CODE: shared.POST_BUMP_POST_NOT_FOUND_ERROR_CODE,
  POST_BUMP_POST_NOT_FOUND_NOTE: shared.POST_BUMP_POST_NOT_FOUND_NOTE,
  isPostBumpTargetCampaign: shared.isPostBumpTargetCampaign
})

/** accounts: id → tài khoản | null (đã xoá / không dùng được) | 'error' (đọc lỗi). campaigns: id → chiến dịch. */
function schedulerFixture({ accounts = {}, campaigns = {} } = {}) {
  const created = []
  const updates = []
  const logs = []
  const closed = []
  let nextId = 900
  const scheduler = Object.assign(new Harness(), {
    supabase: {
      getAccount: async id => {
        const value = accounts[id]
        if (value === 'error') throw new Error('network')
        return value === undefined ? null : value
      },
      getCampaign: async id => campaigns[id] ?? null,
      createCampaign: async input => { const row = { ...input, id: nextId++, isDelete: false }; created.push(row); return row },
      closePendingPostBumpRowsForPost: async (...args) => {
        if (args[1] === 'boom') throw new Error('network')
        closed.push(args)
        return 2
      }
    },
    getDatabaseBusinessNow: async () => new Date('2026-11-18T03:00:00Z'),
    updateCampaignAndBroadcast: async (id, patch) => { updates.push([id, patch]); return patch },
    logCampaignProgress: async (_campaign, message) => { logs.push(message) }
  })
  return { scheduler, created, updates, logs, closed }
}

const account = (id, name) => ({ id, name, rateLimitMinutes: 30 })
const upTin = (id, accountId) => ({ id, accountId, actionId: 'facebook_comment_seeding_post', isDelete: false })

check('chia lượt (tạo mới): bỏ tài khoản đã xoá, giữ tài khoản đọc lỗi, tạo up tin cho tài khoản chưa có', async () => {
  const source = { id: 7, name: 'Đăng nhóm', actionId: 'facebook_group_post', extraSettings: {
    enablePostBump: true, postBumpMode: 'create', postBumpAccountIds: [1, 2, 3, 4, 2],
    postBumpContent: 'A|B|C', postBumpCreatedCampaignIdsByAccount: { 1: 501, 2: 502, 4: 504 } } }
  const { scheduler, created, updates } = schedulerFixture({
    accounts: { 1: account(1, 'TK1'), 2: null, 3: account(3, 'TK3'), 4: 'error' },
    campaigns: { 501: upTin(501, 1), 502: upTin(502, 2), 504: upTin(504, 4) }
  })
  const targets = await scheduler.resolvePostBumpTargets(source)
  assert.deepEqual(targets.map(t => t.campaignId), [501, 900, 504], 'tài khoản 2 (đã xoá) không nhận lượt')
  assert.equal(created.length, 1)
  const up = created[0]
  assert.equal(up.accountId, 3)
  assert.equal(up.name, 'Up tin cho chiến dịch Đăng nhóm - TK3')
  assert.equal(up.refreshData, false, 'không làm mới data')
  assert.equal(up.scheduleType, 'daily')
  assert.equal(up.continueNextDay, true)
  assert.equal(up.extraSettings.actionLimits.sleepBetweenActions, 30, 'nghỉ 30 giây giữa hai comment')
  assert.equal(up.extraSettings.actionLimits.rateLimitMinutes, 30)
  assert.equal(up.extraSettings.commentContent, 'A|B|C')
  assert.equal(shared.isPostBumpTargetCampaign(up), true)
  assert.deepEqual(updates, [[7, { extraSettings: { ...source.extraSettings, postBumpCreatedCampaignIdsByAccount: { 1: 501, 2: 502, 3: 900, 4: 504 } } }]],
    'chỉ thêm ánh xạ cho tài khoản 3, giữ ánh xạ cũ của tài khoản đã xoá')
})

check('chia lượt (tạo mới): mọi tài khoản đã xoá thì không có đích, không tạo chiến dịch', async () => {
  const source = { id: 7, name: 'Đăng nhóm', actionId: 'facebook_group_post', extraSettings: {
    postBumpMode: 'create', postBumpAccountIds: [2, 5], postBumpCreatedCampaignIdsByAccount: { 2: 502 } } }
  const { scheduler, created, updates } = schedulerFixture({ accounts: { 2: null }, campaigns: { 502: upTin(502, 2) } })
  assert.deepEqual(await scheduler.resolvePostBumpTargets(source), [])
  assert.equal(created.length, 0)
  assert.equal(updates.length, 0)
})

check('chia lượt (chọn chiến dịch có sẵn): bỏ chiến dịch của tài khoản đã xoá, giữ khi đọc tài khoản lỗi', async () => {
  const source = { id: 7, name: 'Đăng nhóm', actionId: 'facebook_group_post', extraSettings: {
    postBumpMode: 'select', postBumpTargetCampaignIds: [601, 602, 603, 604, 7] } }
  const { scheduler } = schedulerFixture({
    accounts: { 11: account(11, 'A'), 12: null, 13: 'error' },
    campaigns: { 601: upTin(601, 11), 602: upTin(602, 12), 603: upTin(603, 13),
      604: { id: 604, accountId: 11, actionId: 'facebook_group_post' } }
  })
  assert.deepEqual((await scheduler.resolvePostBumpTargets(source)).map(t => t.campaignId), [601, 603])
})

check('bài bị gỡ: đóng lượt còn chờ của đúng bài trong chiến dịch up tin, chỉ với mã "không tìm thấy bài"', async () => {
  const campaign = { id: 55, name: 'Up tin cho chiến dịch X - TK1', actionId: 'facebook_comment_seeding_post' }
  const detail = { id: 9001, uid: 'https://www.facebook.com/groups/1/posts/2/' }
  const { scheduler, closed } = schedulerFixture()
  await scheduler.closePostBumpRowsOfMissingPost(campaign, detail, 'err_fb_comment_unavailable_post_not_found')
  assert.deepEqual(closed, [[55, detail.uid, 9001, 'Không tìm thấy bài Facebook để bình luận']])
  closed.length = 0
  for (const [c, d, code] of [
    [campaign, detail, 'err_fb_comment_box_not_found'],
    [campaign, detail, 'err_fb_comment_unavailable_comment_disabled'],
    [campaign, detail, null],
    [{ ...campaign, name: 'Comment vào bài khách tự tạo' }, detail, 'err_fb_comment_unavailable_post_not_found'],
    [{ ...campaign, actionId: 'facebook_group_post' }, detail, 'err_fb_comment_unavailable_post_not_found'],
    [campaign, { id: 9002, uid: '' }, 'err_fb_comment_unavailable_post_not_found'],
    [campaign, null, 'err_fb_comment_unavailable_post_not_found']
  ]) await scheduler.closePostBumpRowsOfMissingPost(c, d, code)
  assert.equal(closed.length, 0)
  // Lỗi khi đóng không làm hỏng lượt đang báo kết quả.
  await scheduler.closePostBumpRowsOfMissingPost(campaign, { id: 1, uid: 'boom' }, 'err_fb_comment_unavailable_post_not_found')
})

check('bài bị gỡ (mã nguồn): gọi sau khi ghi kết quả của đúng dòng data, cả bộ cũ lẫn engine', () => {
  const src = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
  const start = src.indexOf('  private async logExplicitActionResultStep(')
  const body = src.slice(start, src.indexOf('\n  private ', start + 10))
  assert.match(body, /if \(created && inputDataId === detail\?\.id\) await this\.closePostBumpRowsOfMissingPost\(campaign, detail, output\.errorCode\)/)
  const engine = src.slice(src.indexOf('  private async reportFacebookEngineRows('))
  assert.match(engine.slice(0, 6000), /this\.logExplicitActionResultStep\(campaign, detail, accountId, step, summary, allSteps/)
  const repo = fs.readFileSync(path.join(root, 'src/main/data/repositories/campaignRepository.ts'), 'utf8')
  const close = repo.slice(repo.indexOf('export async function closePendingPostBumpRowsForPost('))
  const fn = close.slice(0, close.indexOf('\n}\n'))
  for (const part of [".update({ status: 'hoàn thành', note, date_action:", ".eq('campaign_id', campaignId)", ".eq('uid', target)",
    ".eq('status', 'chờ xử lý')", ".eq('is_delete', false)", ".neq('id', excludeInputDataId)"]) {
    assert.ok(fn.includes(part), part)
  }
})

// ---------------------------------------------------------------- form
check('form thường và form AI: câu cảnh báo bài video đúng chữ anh viết, chỉ khi bật Kiêm up tin và có video', () => {
  const sentence = 'Bài có video sẽ không được up tin vì Facebook chưa duyệt bài video ngay sau khi đăng.'
  for (const file of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    const src = fs.readFileSync(path.join(root, 'src/renderer/src/components/CampaignPanels', file), 'utf8')
    assert.equal(src.split(sentence).length - 1, 1, `${file}: đúng một chỗ`)
    assert.match(src, /const showPostBumpVideoWarning = formData\.enablePostBump && \(isAdvancedContentMode/, file)
    assert.match(src, /\{!isNativeGroupShareMode && showPostBumpVideoWarning && \(/, file)
    assert.ok(!src.includes('postBumpContentRotationIndex'), `${file}: không còn con trỏ câu`)
  }
  const mediaTypes = harness.loadTs('src/shared/mediaTypes.ts')
  assert.equal(mediaTypes.isVideoMediaSource('', 'Cho thuê căn 72m² (720p).mp4'), true)
  assert.equal(mediaTypes.isVideoMediaSource('video/mp4', ''), true)
  assert.equal(mediaTypes.isVideoMediaSource('', 'anh.jpg'), false)
})

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
