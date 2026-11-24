// Kiểm phần dùng chung của đợt 2 (docs/FB_AI_FILTER_PLAN.md mục 2): chữ / kiểm ô AI trống (src/shared/campaignAiFilterForm.ts)
// và danh sách ô đã đổi của aka Cài đặt (src/renderer/src/components/CampaignPanels/akaSettingsChanges.ts).
// Chạy: node scripts/fb-ai-filter/form-helpers-smoke.cjs
const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { resolve } = require('node:path')

function load(entry) {
  const out = buildSync({ entryPoints: [resolve(__dirname, '../..', entry)], bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' })
  const module = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, require)
  return module.exports
}

let checks = 0
const check = (name, fn) => { fn(); checks += 1; console.log(`ok - ${name}`) }

const form = load('src/shared/campaignAiFilterForm.ts')
check('chữ ví dụ và dòng dặn đúng phương án chốt', () => {
  assert.equal(form.CAMPAIGN_AI_FILTER_PLACEHOLDER.post, 'Ví dụ: Người đăng đang cần thuê phòng trọ ở Hà Nội cho chính mình. Loại bỏ: bài cho thuê của chủ nhà hoặc môi giới.')
  assert.equal(form.CAMPAIGN_AI_FILTER_PLACEHOLDER.comment, 'Ví dụ: Người comment đang hỏi giá hoặc xin tư vấn. Loại bỏ: comment quảng cáo, comment chỉ gắn tên bạn bè.')
  assert.equal(form.CAMPAIGN_AI_FILTER_HINT.post, 'Viết như đang dặn nhân viên. Muốn bỏ loại bài nào thì ghi “Loại bỏ: …”.')
  assert.equal(form.CAMPAIGN_AI_FILTER_HINT.comment, 'Viết như đang dặn nhân viên. Muốn bỏ loại comment nào thì ghi “Loại bỏ: …”.')
  assert.equal(form.CAMPAIGN_AI_FILTER_EMPTY_ERROR, 'Nhập mô tả cho AI hoặc bỏ tích ô này.')
})
check('ô AI trống: chỉ khi đang tích và chỉ có khoảng trắng', () => {
  assert.equal(form.isCampaignAiFilterEmpty(true, ''), true)
  assert.equal(form.isCampaignAiFilterEmpty(true, ' \n\t'), true)
  assert.equal(form.isCampaignAiFilterEmpty(true, undefined), true)
  assert.equal(form.isCampaignAiFilterEmpty(true, 'Người cần thuê trọ'), false)
  assert.equal(form.isCampaignAiFilterEmpty(false, ''), false)
  assert.equal(form.isCampaignAiFilterEmpty(undefined, ''), false)
})
check('chặn lưu: bài trước comment, bỏ qua phần không dùng', () => {
  const base = { postApplies: true, isFindPostByContentAI: true, postContentAI: '', commentApplies: true, isFindCommentByContentAI: true, commentContentAI: '' }
  assert.deepEqual(form.campaignAiFilterSaveError(base), { kind: 'post', message: 'Ý nghĩa bài viết là (dùng AI): Nhập mô tả cho AI hoặc bỏ tích ô này.' })
  assert.deepEqual(form.campaignAiFilterSaveError({ ...base, postContentAI: 'x' }), { kind: 'comment', message: 'Ý nghĩa comment là (dùng AI): Nhập mô tả cho AI hoặc bỏ tích ô này.' })
  assert.equal(form.campaignAiFilterSaveError({ ...base, postApplies: false, commentApplies: false }), null)
  assert.equal(form.campaignAiFilterSaveError({ ...base, postContentAI: 'x', commentContentAI: 'y' }), null)
  assert.equal(form.campaignAiFilterSaveError({ ...base, isFindPostByContentAI: false, isFindCommentByContentAI: false }), null)
})

const aka = load('src/renderer/src/components/CampaignPanels/akaSettingsChanges.ts')
check('giá trị hiển thị: Bật/Tắt, trống, lựa chọn, rút gọn, xuống dòng', () => {
  assert.equal(aka.formatAkaSettingsValue(true), 'Bật')
  assert.equal(aka.formatAkaSettingsValue(false), 'Tắt')
  assert.equal(aka.formatAkaSettingsValue(''), '(trống)')
  assert.equal(aka.formatAkaSettingsValue('new_posts', { choices: true }), 'Bài viết mới')
  assert.equal(aka.formatAkaSettingsValue('new_posts'), 'new_posts')
  assert.equal(aka.formatAkaSettingsValue('a\nb'), 'a · b')
  assert.equal(aka.formatAkaSettingsValue('x'.repeat(200)).length, 120)
  assert.equal(aka.formatAkaSettingsValue([11, 12], { idsUnit: 'tài khoản' }), '2 tài khoản')
  assert.equal(aka.formatAkaSettingsValue(['a', 'b']), 'a, b')
})
check('Facebook: chỉ ô đổi giá trị, nhãn gọn, bỏ khoá ngoài box', () => {
  const current = { commentPostSort: 'most_relevant', commentOnlyLatestPost: false, isFindPostByKeywords: false, postKeywords: '', isFindPostByContentAI: false, postContentAI: '' }
  const changes = aka.describeFacebookAiChanges('postSearch', current, {
    commentPostSort: 'new_posts', commentOnlyLatestPost: false, isFindPostByContentAI: true, postContentAI: 'Người cần thuê trọ.\nLoại bỏ: môi giới.', runAsPageName: 'x'
  })
  assert.deepEqual(changes, [
    { label: 'Sắp xếp bài viết', before: 'Phù hợp nhất', after: 'Bài viết mới' },
    { label: 'Lọc nội dung bài viết bằng AI', before: 'Tắt', after: 'Bật' },
    { label: 'Mô tả nội dung bài viết cần tìm', before: '(trống)', after: 'Người cần thuê trọ. · Loại bỏ: môi giới.' }
  ])
  assert.deepEqual(aka.describeFacebookAiChanges('keywords', { keywords: ['a'] }, { keywords: ['a', 'b'] }), [{ label: 'Danh sách từ khóa', before: 'a', after: 'a, b' }])
  assert.deepEqual(aka.describeFacebookAiChanges('general', { accountIds: [11] }, { accountIds: [12] }), [{ label: 'Tài khoản chính', before: '1 tài khoản', after: '1 tài khoản' }])
  assert.deepEqual(aka.describeFacebookAiChanges('search', {}, {}), [])
})
check('Lịch chạy và giới hạn', () => {
  const schedule = { scheduleType: 'daily', startDate: '2026-11-24', startTime: '09:00', scheduleEndDate: '', scheduleDays: '', scheduleWeekDays: '',
    useDailyStopTime: false, dailyStopTime: '', continueNextDay: false, refreshData: false, findDataRerunEnabled: false, findDataRerunAfterHours: 24,
    multiDailyTimeSlotsEnabled: false, multiDailyTimeSlots: '' }
  assert.deepEqual(aka.describeScheduleAiChanges(schedule, { scheduleType: 'weekly', scheduleWeekDays: '2,4,6', startTime: '09:00' }), [
    { label: 'Kiểu lịch', before: 'Hằng ngày', after: 'Hằng tuần' },
    { label: 'Thứ trong tuần', before: '(trống)', after: '2,4,6' }
  ])
  const limits = { sleepBetweenActions: 30, continueWhenActionLimitReached: false, postsPerTarget: 3,
    actions: [{ actionCode: 'fb_comment', label: 'Comment', unit: 'comment', dailyLimit: 20, rateLimitCount: 6, rateLimitMinutes: 65 }] }
  assert.deepEqual(aka.describeLimitsAiChanges(limits, { sleepBetweenActions: 90, actions: [{ actionCode: 'fb_comment', dailyLimit: 20, rateLimitCount: 4 }] }), [
    { label: 'Nghỉ giữa hai lần (giây)', before: '30', after: '90' },
    { label: 'Comment: số lượt mỗi khung giờ', before: '6', after: '4' }
  ])
})
check('mỗi box Facebook có câu mẫu Thử nhanh', () => {
  for (const kind of ['general', 'search', 'keywords', 'postSearch', 'newsfeed', 'groupComment']) assert.ok(aka.FACEBOOK_AI_EXAMPLES[kind].length >= 1, kind)
  assert.ok(aka.SCHEDULE_AI_EXAMPLES.length >= 1 && aka.LIMITS_AI_EXAMPLES.length >= 1)
})
console.log(`PASS ${checks} nhóm`)
