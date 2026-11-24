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

check('ba cảnh báo mới: dấu ngăn bị vô hiệu, mẩu ngắn do dấu | trang trí, biến akaBiz cũ (không chặn lưu)', () => {
  const codes = (text, options = { channel: 'zalo' }) => syntax.analyzeContentSyntax(text, options).issues.map(issue => `${issue.code}:${issue.severity}`)
  const escaped = 'Mẫu một dài\n\\|\nMẫu hai dài'
  assert.deepEqual(codes(escaped), ['separator_escaped:warn'])
  assert.equal(spin.splitContentVariants(escaped).length, 1)
  const fixedEscaped = syntax.applyContentSyntaxFixes(escaped, { channel: 'zalo' }, ['separator_escaped'])
  assert.equal(spin.splitContentVariants(fixedEscaped).length, 2)
  // Dấu \| giữa dòng là chữ khách muốn giữ: không nhắc.
  assert.deepEqual(codes('Giá 100k \\| 200k cho anh chị'), [])

  const long = 'Nội dung chào hàng đầy đủ của shop. '.repeat(6)
  assert.deepEqual(codes(`Hotline | 0900 000 000\n${long}`), ['variant_fragment:warn'])
  assert.deepEqual(codes(`${long}|\n${long}`), [])

  assert.deepEqual(codes('Chào [fullname], số [mobile]'), ['legacy_token:warn', 'legacy_token:warn'])
  assert.equal(syntax.applyContentSyntaxFixes('Chào [fullname], số [mobile]', { channel: 'zalo' }, ['legacy_token']), 'Chào #{INPUT_FULLNAME}, số #{PHONE}')
  // Mặc định "Sửa giúp tất cả" chỉ sửa lỗi chặn, không tự đổi chỗ đang là cảnh báo.
  assert.equal(syntax.applyContentSyntaxFixes('Chào [fullname]', { channel: 'zalo' }), 'Chào [fullname]')
  // Cảnh báo không chặn đường lưu.
  guard.assertCampaignContentSyntax({ actionId: 'zalo_message_phone', content: `${escaped}\nChào [fullname]` })
})

check('mẫu nội dung: ô biến thể chứa nhiều nội dung thì hỏi tách; tách xong bộ tách đang chạy ra đúng số mẫu', () => {
  const packed = ['Nội dung A dòng 1\nA dòng 2\n|\nNội dung B\n|\nNội dung C', 'Nội dung D']
  const prompt = syntax.packedVariantsPrompt(packed)
  assert.equal(prompt.total, 4)
  assert.equal(prompt.confirmText, 'Tách thành 4 nội dung')
  assert.equal(prompt.cancelText, 'Giữ nguyên')
  const expanded = syntax.expandPackedVariants(packed)
  assert.deepEqual(expanded.map(text => text.trim()), ['Nội dung A dòng 1\nA dòng 2', 'Nội dung B', 'Nội dung C', 'Nội dung D'])
  // Dấu | giữa dòng (trang trí) và ô có định dạng không bị tách, không hỏi.
  assert.equal(syntax.packedVariantsPrompt(['Giá 100k | 200k', '<p>a</p>\n|\n<p>b</p>']), null)
  assert.equal(syntax.packedVariantsPrompt(['Một nội dung', 'Hai nội dung']), null)
  let serialize = null
  for (const file of ['contentSpin.js']) {
    const mod = require(path.join(out, 'shared', file))
    if (typeof mod.serializeContentVariants === 'function') serialize = mod.serializeContentVariants
  }
  if (serialize) {
    assert.equal(spin.splitContentVariants(serialize(packed)).length, 2, 'giữ nguyên = 2 mẫu như trước')
    assert.equal(spin.splitContentVariants(serialize(expanded)).length, 4, 'tách = 4 mẫu')
  }
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  for (const form of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    assert.match(read(`src/renderer/src/components/CampaignPanels/${form}`), /packedVariantsPrompt\(templateVariants\)/)
  }
  assert.match(read('src/renderer/src/components/ContentTemplates/ContentTemplateWorkspace.tsx'), /packedVariantsPrompt\(/)
  assert.match(read('src/renderer/src/components/CampaignPanels/ConfirmModal.tsx'), /onCancel/)
})

check('hỏi lại lúc lưu: gom cảnh báo, "Sửa giúp" chỉ sửa đúng chỗ đã nêu, hai form đã nối', () => {
  const long = 'Nội dung chào hàng đầy đủ của shop. '.repeat(6)
  const form = { name: 'Chiến dịch', content: `Chào [fullname]\n${long}\n\\|\n${long}`, friendRequestMessage: 'Chào [Fullname]', advancedContentItems: [] }
  const input = { actionId: 'zalo_message_phone', content: form.content, extraSettings: { friendRequestMessage: form.friendRequestMessage } }
  const warning = syntax.campaignContentSaveWarning(input)
  assert.equal(warning.count, 3)
  assert.equal(warning.fixText, 'Sửa giúp')
  assert.equal(warning.keepText, 'Vẫn lưu')
  const fixed = syntax.applyCampaignContentFixes(form, warning.fixes)
  assert.equal(fixed.name, 'Chiến dịch')
  assert.equal(fixed.friendRequestMessage, 'Chào #{INPUT_FULLNAME}')
  assert.equal(spin.splitContentVariants(form.content).length, 1)
  assert.equal(spin.splitContentVariants(fixed.content).length, 2)
  assert.equal(syntax.campaignContentSaveWarning({ ...input, content: fixed.content, extraSettings: { friendRequestMessage: fixed.friendRequestMessage } }), null)
  assert.equal(syntax.campaignContentSaveWarning(input, 'off'), null)
  // Cảnh báo không làm đường lưu của tiến trình chính từ chối.
  guard.assertCampaignContentSyntax(input)
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  for (const file of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    const source = read(`src/renderer/src/components/CampaignPanels/${file}`)
    assert.match(source, /campaignContentSaveWarning\(syntaxInput, syntaxMode\)/)
    assert.match(source, /applyCampaignContentFixes\(current, contentWarning\.fixes\)/)
  }
})

check('rà 24/11: ngoặc không xoay vòng, chỗ trống, chia sẻ, Facebook, group, độ dài, AI viết lại, data thiếu', () => {
  const codes = (text, options = { channel: 'zalo' }) => syntax.analyzeContentSyntax(text, options).issues.map(issue => `${issue.code}:${issue.severity}`)
  assert.deepEqual(codes('Chào {anh-chị-anh/chị} [tên kh]'), ['brace_literal:warn', 'placeholder_unfilled:warn'])
  assert.equal(syntax.applyContentSyntaxFixes('Chào {anh-chị-anh/chị}', { channel: 'zalo' }, ['brace_literal']), 'Chào #{SEX{anh-chị-anh/chị}}')
  // Bộ chạy thật gửi nguyên cả dấu ngoặc khi không có dấu | bên trong: đúng điều bộ kiểm báo.
  assert.equal(spin.renderContentSpin('Chào {anh-chị-anh/chị}', { rng: () => 0 }), 'Chào {anh-chị-anh/chị}')

  // Gửi dạng chia sẻ: chặn ở đường lưu, kể cả khi chỉ bật chế độ chia sẻ mà không sửa nội dung.
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'zalo_message_friend', content: 'Chào #{FULL_NAME}', extraSettings: { zaloMessageSendMode: 'share' } }), 'content')
  const normal = { actionId: 'zalo_message_group', content: 'Chào #{FULL_NAME}', extraSettings: { zaloMessageSendMode: 'normal' } }
  assert.equal(guard.touchesCampaignContent({ extraSettings: { zaloMessageSendMode: 'share' } }), true)
  throwsSyntax(() => guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_group', { extraSettings: { zaloMessageSendMode: 'share' } }, normal)), 'content')
  const sharing = { ...normal, extraSettings: { zaloMessageSendMode: 'share' } }
  guard.assertCampaignContentSyntax(guard.changedCampaignContentFields('zalo_message_group', { extraSettings: { zaloMessageSendMode: 'share', actionLimits: {} } }, sharing))
  guard.assertCampaignContentSyntax(normal)

  // Facebook: biến hệ thống không điền được thì chặn, #{FULL_NAME} / ngày / biến lạ trang trí thì không.
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'facebook_message_uid', content: 'Chào #{SEX{anh-chị-anh/chị}}' }), 'content')
  throwsSyntax(() => guard.assertCampaignContentSyntax({ actionId: 'facebook_group_post', content: 'Bài', extraSettings: { commentContent: 'Hi #{INFO1}' } }), 'commentContent')
  guard.assertCampaignContentSyntax({ actionId: 'facebook_message_uid', content: 'Chào #{FULL_NAME} #{ full_name } #{TODAY(DD/MM/YYYY)} #{abc}' })

  assert.deepEqual(codes('Chào #{FULL_NAME} #{SEX{anh-chị-bạn}}', { channel: 'zalo', audience: 'group' }), ['token_group_target:warn', 'token_group_target:warn'])

  const warning = syntax.campaignContentSaveWarning({
    actionId: 'zalo_message_phone', content: `Chào #{INPUT_FULLNAME}\n|\n${'x'.repeat(2400)}`,
    extraSettings: { rewriteContentEachRun: true, enableAddFriend: true, friendRequestMessage: 'k'.repeat(160), enableZaloAlias: true, zaloAliasTemplate: 'Khách hàng tiềm năng dự án Vinhomes Grand Park quận 9 - #{FULL_NAME}' },
    inputRows: [{ name: 'A', info1: 'a' }, { name: '', info1: 'b' }]
  })
  assert.equal(warning.count, 5)
  for (const text of ['mẫu số 2) dài 2.400', 'Lời mời kết bạn dài 160', 'Tên gợi nhớ dài ít nhất 56', 'Viết nội dung cho mỗi lượt chạy', '1/2 dòng data chưa có Tên']) {
    assert.ok(warning.message.includes(text), text)
  }
  // Chỉ nhắc khi chắc chắn vượt: tên gợi nhớ ngắn mà nhiều biến thì không nhắc.
  assert.equal(syntax.campaignContentSaveWarning({ actionId: 'zalo_message_phone', content: 'Chào bạn',
    extraSettings: { enableZaloAlias: true, zaloAliasTemplate: '#{FULL_NAME} - #{PHONE} - #{INFO1} - #{INFO2} - dự án' } }), null)
  // Tắt lời mời / đổi tên thì không nhắc độ dài.
  assert.equal(syntax.campaignContentSaveWarning({ actionId: 'zalo_message_phone', content: 'Chào bạn',
    extraSettings: { enableAddFriend: false, friendRequestMessage: 'k'.repeat(160), enableZaloAlias: false, zaloAliasTemplate: 'x'.repeat(80) } }), null)

  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  for (const form of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    const source = read(`src/renderer/src/components/CampaignPanels/${form}`)
    for (const key of ['zaloMessageSendMode: isZaloShareMessageMode', 'rewriteContentEachRun: formData.rewriteContentEachRun', 'enableAddFriend: formData.actionId', 'enableZaloAlias: formData.enableZaloAlias', 'inputRows: !isEditingSavedCampaign']) {
      assert.ok(source.includes(key), `${form}: ${key}`)
    }
  }
})

check('đường lưu IPC và hai form đã gọi bộ chặn; bộ lập lịch và lõi engine không gọi', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8')
  assert.match(read('src/main/ipc/handlers/campaignHandlers.ts'), /assertCampaignContentSyntax\(\{\s*actionId: campaignData\?\.actionId/)
  assert.match(read('src/main/ipc/handlers/campaignHandlers.ts'), /changedCampaignContentFields\(/)
  assert.match(read('src/main/ipc/handlers/contentTemplateHandlers.ts'), /assertTemplateContentSyntax\(templateData\)/)
  for (const form of ['CampaignFormModal.tsx', 'CampaignAgentFormModal.tsx']) {
    assert.match(read(`src/renderer/src/components/CampaignPanels/${form}`), /checkCampaignContentSyntax\(syntaxInput, syntaxMode\)/)
  }
  assert.doesNotMatch(read('src/main/services/campaignScheduler.ts'), /contentSyntax/)
  const engine = path.join(root, 'packages/campaign-engine/src')
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(dir, item.name)) : [path.join(dir, item.name)])
  for (const file of walk(engine)) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /contentSyntax/, file)
})

fs.rmSync(out, { recursive: true, force: true })
console.log(`\n${passed} nhóm đạt`)
