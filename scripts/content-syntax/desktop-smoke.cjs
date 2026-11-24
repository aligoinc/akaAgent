#!/usr/bin/env node
/**
 * Kiểm bộ chặn lưu nội dung sai cú pháp của Desktop (docs/CONTENT_SYNTAX_GUARD_PLAN.md).
 * Chạy mã thật của src/shared/contentSyntax.ts và src/main/services/contentSyntaxGuard.ts (dịch tại chỗ bằng TypeScript).
 *   node scripts/content-syntax/desktop-smoke.cjs
 *   WEBAPP_REPO=<checkout akaAgentWebApp> node scripts/content-syntax/desktop-smoke.cjs   # so md5 với bản gốc
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.resolve(__dirname, '..', '..')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'content-syntax-smoke-'))
const md5 = file => crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex')

function build(source, target) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  fs.mkdirSync(path.dirname(path.join(out, target)), { recursive: true })
  fs.writeFileSync(path.join(out, target), code)
}
build('src/shared/contentSyntax.ts', 'shared/contentSyntax.js')
build('src/shared/contentSpin.ts', 'shared/contentSpin.js')
build('src/main/services/contentSyntaxGuard.ts', 'main/services/contentSyntaxGuard.js')

const syntax = require(path.join(out, 'shared/contentSyntax.js'))
const spin = require(path.join(out, 'shared/contentSpin.js'))
const guard = require(path.join(out, 'main/services/contentSyntaxGuard.js'))

let passed = 0
function check(name, run) {
  run()
  passed += 1
  console.log(`PASS ${name}`)
}

const BAD = 'Mẫu 1 #{SEX{anh-chị-anh/chị}|Mẫu 2 #{SEX{anh-chị-anh/chị}|Mẫu 3 #{SEX{anh-chị-anh/chị}'
const GOOD = BAD.split('anh/chị}').join('anh/chị}}')
const throwsSyntax = (run, field) => assert.throws(run, error => error.code === 'campaign_content_syntax_invalid' && (!field || error.field === field))

check('bản Desktop của contentSyntax.ts trùng bản WebApp (khi có WEBAPP_REPO)', () => {
  const webapp = process.env.WEBAPP_REPO
  if (!webapp) return console.log('  (bỏ qua: chưa đặt WEBAPP_REPO)')
  assert.equal(md5(path.join(root, 'src/shared/contentSyntax.ts')), md5(path.join(webapp, 'packages/campaign-core/src/contentSyntax.ts')))
})

check('logic chạy không đổi: hai bản contentSpin của Desktop và lõi engine vẫn trùng nhau', () => {
  assert.equal(md5(path.join(root, 'src/shared/contentSpin.ts')), md5(path.join(root, 'packages/campaign-engine/src/content/contentSpin.ts')))
})

check('bộ kiểm đếm dấu | y như bộ tách đang chạy của Desktop', () => {
  const samples = [BAD, GOOD, 'a|b|{c|d}|#{FULL_NAME}', 'a {b | c', '#{x|y} | z', 'a \\| b | c', '{a|{b|c}} | #{SEX{x-y-z}} | }', '#{FULL_NAME | b } | c']
  for (const text of samples) {
    assert.deepEqual(syntax.actualVariantSeparatorIndexes(text), spin.findContentVariantSeparatorIndexes(text), text)
    assert.equal(syntax.analyzeContentSyntax(text, { channel: 'zalo' }).variantCount, spin.splitContentVariants(text).length, text)
  }
})

check('tạo chiến dịch: nội dung của khách bị chặn, sửa xong thì lưu được', () => {
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'zalo_message_group_member', content: BAD, extraSettings: {} }), 'content')
  guard.assertCampaignContentSyntax({ actionId: 'zalo_message_group_member', content: GOOD, extraSettings: {} })
  guard.assertCampaignContentSyntax({ actionId: 'zalo_message_group_member', content: syntax.applyContentSyntaxFixes(BAD, { channel: 'zalo' }) })
  assert.equal(spin.splitContentVariants(syntax.applyContentSyntaxFixes(BAD, { channel: 'zalo' })).length, 3)
})

check('biến lạ, lời mời kết bạn, nội dung nâng cao', () => {
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'email_send', content: 'Chào #{INPUT_Fullname},' }), 'content')
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', extraSettings: { friendRequestMessage: 'Chào #{SEX{anh-chị-anh/chị}' } }), 'friendRequestMessage')
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', extraSettings: { advancedContentItems: [{ content: 'ok' }, { content: 'Chào #{FULL_NAME' }] } }), 'advancedContentItems[1].content')
  // Tên gợi nhớ kiểu #{DỰ ÁN} và bài Facebook có hashtag: không chặn.
  guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', extraSettings: { zaloAliasTemplate: '#{FULL_NAME} #{F2 BITRIX}' } })
  guard.assertCampaignContentSyntax({ actionId: 'facebook_group_post', content: 'Bài viết #{abc} #sale {a|b} | Bài hai' })
})

check('sửa chiến dịch: chỉ kiểm ô nội dung thật sự đổi', () => {
  const current = { actionId: 'zalo_message_phone', content: BAD, extraSettings: { friendRequestMessage: 'Chào #{SEX{anh-chị-anh/chị}', actionLimits: { sleepBetweenActions: 30 } } }
  assert.equal(guard.touchesCampaignContent({ status: 'tạm dừng' }), false)
  assert.equal(guard.touchesCampaignContent({ extraSettings: { actionLimits: {} } }), false)
  assert.equal(guard.touchesCampaignContent({ content: 'x' }), true)
  const limits = { extraSettings: { ...current.extraSettings, actionLimits: { sleepBetweenActions: 60 } } }
  guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_phone', limits, current))
  guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_phone', { content: BAD, extraSettings: current.extraSettings }, current))
  throwsSyntax(() => guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_phone', { content: `${BAD} nhé` }, current)), 'content')
  guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_phone', { content: GOOD }, current))
  // Không đọc được bản đang lưu thì kiểm mọi ô được gửi.
  throwsSyntax(() => guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_phone', { content: BAD }, null)), 'content')
})

check('mẫu nội dung: chặn lỗi làm gộp mẫu', () => {
  throwsSyntax(() => guard.assertTemplateContentSyntax({ channels: { zalo: { content: BAD } } }), 'channels.zalo.content')
  guard.assertTemplateContentSyntax({ channels: { zalo: { content: GOOD }, facebook: { content: 'Bài #{abc} {a|b}' } } })
  guard.assertTemplateContentSyntax({ name: 'chỉ đổi tên' })
})

check('công tắc: thiếu dòng = chặn, warn / off cho lưu', () => {
  assert.equal(guard.setContentSyntaxGuardMode(undefined), 'block')
  assert.equal(guard.setContentSyntaxGuardMode('warn'), 'warn')
  guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', content: BAD })
  guard.assertTemplateContentSyntax({ channels: { zalo: { content: BAD } } })
  assert.equal(guard.setContentSyntaxGuardMode('{"mode":"off"}'), 'off')
  guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', content: BAD })
  assert.equal(guard.setContentSyntaxGuardMode(null), 'block')
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', content: BAD }))
})

check('đường lưu IPC và hai form đã gọi bộ chặn; bộ lập lịch và lõi engine không gọi', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  assert.match(read('src/main/ipc/handlers/campaignHandlers.ts'), /assertCampaignContentSyntax\(\{\s*actionId: campaignData\?\.actionId/)
  assert.match(read('src/main/ipc/handlers/campaignHandlers.ts'), /changedCampaignContentFields\(/)
  assert.match(read('src/main/ipc/handlers/contentTemplateHandlers.ts'), /assertTemplateContentSyntax\(templateData\)/)
  for (const form of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    assert.match(read(`src/renderer/src/components/CampaignPanels/${form}`), /checkCampaignContentSyntax\(\{/)
  }
  assert.doesNotMatch(read('src/main/services/campaignScheduler.ts'), /contentSyntax/)
  const engine = path.join(root, 'packages/campaign-engine/src')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)])
  for (const file of walk(engine)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /contentSyntax/, file)
})

fs.rmSync(out, { recursive: true, force: true })
console.log(`\n${passed} nhóm đạt`)
