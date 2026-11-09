// Smoke test lõi "Khách sẽ nhận" (src/shared/recipientPreview.ts) — không DB, không Electron.
// Chép các ca của akaAgentWebApp packages/campaign-core/src/recipientPreview.test.ts, chỉnh theo Desktop:
// media nhận chuỗi/snapshot có `localPath`, không còn cảnh báo `desktop_local_media`, và so từng byte với
// runtime Desktop `renderSmsInputContent` / `renderCampaignTemplateText`.
// Chạy: node scripts/recipient-preview-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '..')
const entry = `
export * as rp from './src/shared/recipientPreview'
export * as spin from './src/shared/contentSpin'
export * as smsRecipient from './src/shared/smsRecipientContent'
export * as sms from './src/shared/smsContent'
export * as template from './src/shared/campaignContentTemplate'
export * as optOut from './src/shared/zaloMessageOptOut'
export * as phone from './src/shared/phone'
`

const tests = []
const test = (name, fn) => tests.push({ name, fn })

/** Giống `toMatchObject` của vitest: mọi khoá của `expected` phải khớp (đệ quy), khoá thừa ở `actual` bỏ qua. */
function assertMatch(actual, expected, where = 'value') {
  if (expected === null || typeof expected !== 'object') {
    assert.deepEqual(actual, expected, `${where}: ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)
    return
  }
  assert.ok(actual !== null && typeof actual === 'object', `${where}: không phải object (${JSON.stringify(actual)})`)
  for (const [key, value] of Object.entries(expected)) assertMatch(actual[key], value, `${where}.${key}`)
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recipient-preview-'))
  try {
    const outfile = path.join(dir, 'bundle.cjs')
    await build({
      stdin: { contents: entry, resolveDir: root, loader: 'ts', sourcefile: 'recipient-preview-entry.ts' },
      outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    })
    const { rp, spin, smsRecipient, sms, template, optOut, phone } = require(outfile)
    const { seededRandom, renderContentSpin, countContentSpinOptions, listContentSpinOptions } = spin

    const NOW = new Date('2026-11-09T03:00:00.000Z')
    const source = (overrides = {}) => ({
      actionCode: 'zalo_message_phone', enableMessage: true, enableAddFriend: false, friendRequestMessage: '',
      zaloMessageSendMode: 'normal', formattedContentEnabled: false, zaloOptOutLinkEnabled: false,
      smsUseUnicode: false, smsKeepNewLines: false, rewriteContentEachRun: false, advanced: false,
      advancedContentSource: 'manual', content: 'Chào #{FULL_NAME}', advancedItems: [], media: [],
      mediaOption: 'none', randomCount: 3, ...overrides,
    })
    const ctx = (overrides = {}) => ({
      channel: 'zalo', mode: 'sample', gender: 'female', share: false, optOutEnabled: false,
      smsUseUnicode: false, smsKeepNewLines: false, now: NOW, smsBaseDate: NOW, seed: 0, ...overrides,
    })
    const join = (parts) => parts.map((part) => part.text).join('')
    const image = (name) => ({ name, cloudUrl: `https://cdn.example.com/${name}`, mimeType: 'image/jpeg', sizeBytes: 100 })
    const runtimePhone = (...values) => values.map(phone.normalizeVietnamMobilePhone).find(Boolean) || ''
    const firstTextParts = (rendered) => (rendered.bubbles[0] && rendered.bubbles[0].kind === 'text' ? rendered.bubbles[0].parts : [])

    test('map hành động sang kênh khách nhận', () => {
      assert.equal(rp.recipientPreviewChannel('zalo_message_phone'), 'zalo')
      assert.equal(rp.recipientPreviewChannel('zalo_message_group'), 'zalo_group')
      assert.equal(rp.recipientPreviewChannel('sms_send'), 'sms')
      assert.equal(rp.recipientPreviewChannel('voice_call'), 'voice')
      assert.equal(rp.recipientPreviewChannel('zalo_add_group_member'), null)
      assert.equal(rp.recipientPreviewChannel('zalo_join_group_link'), null)
      assert.equal(rp.recipientPreviewChannel('facebook_message_friend'), null)
    })

    test('tin nhắn trước lời mời, theo đúng công tắc', () => {
      const screens = (value) => rp.recipientPreviewScreens(source(value)).map((item) => item.screen)
      assert.deepEqual(screens({ enableAddFriend: true }), ['message', 'friend_request'])
      assert.deepEqual(screens({ enableMessage: false, enableAddFriend: true }), ['friend_request'])
      assert.deepEqual(screens({ actionCode: 'zalo_message_friend', enableMessage: false, enableAddFriend: true }), ['message'])
      assert.deepEqual(screens({ actionCode: 'sms_send' }), ['message'])
    })

    test('nội dung cơ bản chỉ tách ở `|` ngoài cùng', () => {
      const versions = rp.recipientMessageVersions(source({ content: 'A {x|y} #{FULL_NAME} | B \\| C | ' }))
      assert.deepEqual(versions.map((item) => item.raw), ['A {x|y} #{FULL_NAME}', 'B \\| C'])
      assert.equal(versions[0].spinOptions, 2)
    })

    test('nội dung rỗng vẫn giữ một phiên bản để xem tin chỉ có media', () => {
      const versions = rp.recipientMessageVersions(source({ content: '', media: [image('a.jpg')], mediaOption: 'all' }))
      assert.equal(versions.length, 1)
      assert.equal(versions[0].hasText, false)
      assert.equal(versions[0].media.pool.length, 1)
    })

    test('mục nâng cao: mặc định media như runtime, giữ nguồn mẫu', () => {
      const versions = rp.recipientMessageVersions(source({
        advanced: true,
        advancedItems: [
          { id: '1', content: 'Một', mediaOption: undefined, mediaItems: [image('a.jpg')] },
          { id: '2', content: 'Hai', mediaOption: 'random', mediaItems: [image('b.jpg')], randomMediaCount: 0, sourceTemplateName: 'Mẫu A', sourceVariantIndex: 1 },
        ],
      }))
      assert.equal(versions[0].media.option, 'none')
      assert.equal(versions[1].media.randomCount, 3)
      assertMatch(versions[1].origin, { kind: 'advanced', templateName: 'Mẫu A', templateVariant: 1 })
    })

    test('SMS bỏ media, gọi thoại chỉ dùng nội dung cơ bản', () => {
      assert.equal(rp.recipientMessageVersions(source({ actionCode: 'sms_send', media: [image('a.jpg')], mediaOption: 'all' }))[0].media.option, 'none')
      const voice = rp.recipientMessageVersions(source({ actionCode: 'voice_call', advanced: true, content: 'Gọi', advancedItems: [{ id: '1', content: 'Nâng cao', mediaOption: 'none', mediaItems: [] }] }))
      assert.deepEqual(voice.map((item) => item.raw), ['Gọi'])
    })

    test('nội dung định dạng tách theo cây HTML', () => {
      const versions = rp.recipientMessageVersions(source({ formattedContentEnabled: true, content: '<p><strong>Một</strong> | Hai</p>' }))
      assert.equal(versions.length, 2)
      assert.ok(versions.every((item) => item.formatted))
    })

    test('lời mời kết bạn tách biến thể', () => {
      assert.deepEqual(rp.recipientFriendRequestVersions(source({ friendRequestMessage: 'A|B' })).map((item) => item.raw), ['A', 'B'])
      assert.equal(rp.recipientFriendRequestVersions(source({ friendRequestMessage: '' })).length, 1)
    })

    test('thứ tự gửi khớp nhánh runtime', () => {
      const seq = (input) => rp.zaloSendSequence(input)
      assert.equal(seq({ mediaCount: 0, rich: false, hasText: true, share: false }), 'content_only')
      assert.equal(seq({ mediaCount: 1, rich: false, hasText: true, share: false }), 'combined')
      assert.equal(seq({ mediaCount: 1, rich: true, hasText: true, share: false }), 'content_then_media')
      assert.equal(seq({ mediaCount: 2, rich: false, hasText: true, share: false }), 'media_then_content')
      assert.equal(seq({ mediaCount: 1, rich: true, hasText: true, share: true }), 'media_then_content')
      assert.equal(seq({ mediaCount: 3, rich: false, hasText: false, share: false }), 'media_only')
      assert.equal(seq({ mediaCount: 1, rich: false, hasText: false, share: false }), 'media_only')
    })

    test('chọn media như runtime, ổn định theo hạt giống', () => {
      const pool = rp.recipientMessageVersions(source({ media: [image('a.jpg'), image('b.jpg'), image('c.jpg')], mediaOption: 'random', randomCount: 2 }))[0].media
      const first = rp.selectRecipientMedia(pool, 4)
      assert.equal(first.length, 2)
      assert.deepEqual(rp.selectRecipientMedia(pool, 4), first)
      assert.equal(rp.selectRecipientMedia({ ...pool, option: 'all' }).length, 3)
      assert.equal(rp.selectRecipientMedia({ ...pool, option: 'none' }).length, 0)
      assert.equal(rp.selectRecipientMedia({ ...pool, randomCount: 9 }, 1).length, 3)
    })

    test('bong bóng theo thứ tự gửi', () => {
      const version = rp.recipientMessageVersions(source({ content: 'Xin chào', media: [image('a.jpg'), image('b.jpg')], mediaOption: 'all' }))[0]
      const rendered = rp.renderRecipientMessage(version, ctx())
      assert.equal(rendered.sequence, 'media_then_content')
      assert.deepEqual(rendered.bubbles.map((bubble) => bubble.kind), ['media', 'text'])
      const single = rp.recipientMessageVersions(source({ content: 'Xin chào', media: [image('a.jpg')], mediaOption: 'all' }))[0]
      const combined = rp.renderRecipientMessage(single, ctx())
      assert.equal(combined.bubbles.length, 1)
      assertMatch(combined.bubbles[0], { kind: 'media', caption: { kind: 'text' } })
    })

    test('Desktop: file trên máy giữ `localPath`, chuỗi đường dẫn và URL đều đọc được', () => {
      const version = rp.recipientMessageVersions(source({
        mediaOption: 'all',
        media: [
          { name: 'local.png', cloudUrl: '', mimeType: null, sizeBytes: null, localPath: 'C:\\anh\\local.png' },
          'C:\\anh\\b.JPG',
          '/Users/a/clip.mov',
          'https://cdn.example.com/c.mp4?x=1',
          { name: 'bao-gia.pdf', localPath: '/Users/a/bao-gia.pdf', cloudUrl: 'https://cdn.example.com/bao-gia.pdf', mimeType: 'application/pdf', sizeBytes: 9 },
          '',
          { name: 'rong' },
        ],
      }))[0]
      const pool = version.media.pool
      assert.equal(pool.length, 5)
      assertMatch(pool[0], { localOnly: true, url: null, localPath: 'C:\\anh\\local.png', kind: 'image', name: 'local.png' })
      assertMatch(pool[1], { localOnly: true, url: null, localPath: 'C:\\anh\\b.JPG', kind: 'image', name: 'b.JPG' })
      assertMatch(pool[2], { localOnly: true, kind: 'video', name: 'clip.mov' })
      assertMatch(pool[3], { localOnly: false, url: 'https://cdn.example.com/c.mp4?x=1', localPath: null, kind: 'video', name: 'c.mp4' })
      assertMatch(pool[4], { localOnly: false, kind: 'file', localPath: '/Users/a/bao-gia.pdf', url: 'https://cdn.example.com/bao-gia.pdf' })
      assert.equal(new Set(pool.map((item) => item.key)).size, pool.length)
    })

    const tokenTemplate = 'Chào #{SEX{anh-chị-anh/chị}} #{FULL_NAME} (#{ORIGINAL_NAME}) #{INPUT_FULLNAME} #{PHONE}/#{MOBILE} #{EMAIL} #{UID} #{INFO1} #{INFO2} #{INFO3} #{INFO4} #{INFO5} #{TODAY(DD/MM/YYYY)} #{TOMORROW(DD/MM)} #{YESTERDAY(YYYY)} #{TEN} #{SEX} #{TODAY} #{full_name}'
    for (const gender of ['female', 'male', 'unknown']) {
      test(`mẫu xem thử khớp từng byte renderCampaignTemplateText của Desktop (${gender})`, () => {
        const { parts } = rp.recipientTemplateParts(tokenTemplate, ctx({ gender }))
        const runtime = template.renderCampaignTemplateText(tokenTemplate, rp.RECIPIENT_SAMPLE.row, {
          displayName: rp.RECIPIENT_SAMPLE.displayName,
          originalName: rp.RECIPIENT_SAMPLE.originalName,
          gender: gender === 'unknown' ? undefined : gender,
        }, NOW, { spin: (text) => text, phone: runtimePhone })
        assert.equal(join(parts), runtime)
      })
    }

    test('chế độ dòng data: biến hồ sơ Zalo chờ lúc gửi, báo dữ liệu trống', () => {
      const { parts } = rp.recipientTemplateParts('Chào #{SEX{anh-chị-anh/chị}} #{FULL_NAME}, #{INPUT_FULLNAME} #{PHONE} #{INFO2}', ctx({
        mode: 'row', row: { name: 'Trần Văn Bình', phone: '+84 912 345 678', info2: '' },
      }))
      assert.deepEqual(parts.filter((part) => part.state === 'runtime').map((part) => part.token), ['#{SEX{anh-chị-anh/chị}}', '#{FULL_NAME}'])
      assertMatch(parts.find((part) => part.token === '#{INPUT_FULLNAME}'), { state: 'filled', text: 'Trần Văn Bình' })
      assertMatch(parts.find((part) => part.token === '#{PHONE}'), { state: 'filled', text: '0912345678' })
      assertMatch(parts.find((part) => part.token === '#{INFO2}'), { state: 'empty' })
    })

    test('chế độ gốc: gắn nhãn biến đã biết, giữ biến lạ', () => {
      const { parts } = rp.recipientTemplateParts('#{FULL_NAME} #{TODAY(DD/MM)} #{TEN}', ctx({ mode: 'raw' }))
      assert.deepEqual(parts.filter((part) => part.kind === 'token').map((part) => [part.state, part.text]), [
        ['raw', 'Tên Zalo'], ['raw', 'Hôm nay (DD/MM)'], ['unknown', '#{TEN}'],
      ])
    })

    test('chia sẻ: không thay biến nào', () => {
      const { parts } = rp.recipientTemplateParts('Chào #{FULL_NAME} #{TODAY(DD/MM)}', ctx({ share: true }))
      assert.ok(parts.filter((part) => part.kind === 'token').every((part) => part.state === 'unrendered'))
      assert.equal(join(parts), 'Chào #{FULL_NAME} #{TODAY(DD/MM)}')
    })

    test('nhắn nhóm dùng tên nhóm, không xét giới tính', () => {
      const { parts } = rp.recipientTemplateParts('Chào #{FULL_NAME}, #{SEX{anh-chị-cả nhà}}', ctx({ channel: 'zalo_group', gender: 'male' }))
      assert.equal(join(parts), `Chào ${rp.RECIPIENT_SAMPLE.groupName}, cả nhà`)
    })

    test('link từ chối nhận tin như runtime', () => {
      const link = optOut.buildStopMessagesLink(optOut.STOP_MESSAGES_PREVIEW_ID)
      const version = rp.recipientMessageVersions(source({ content: 'Xin chào' }))[0]
      assert.equal(join(rp.renderRecipientMessage(version, ctx({ optOutEnabled: true })).bubbles[0].parts), `Xin chào\n\nTừ chối nhận tin: ${link}`)
      const inline = rp.recipientMessageVersions(source({ content: 'Bấm #{STOP_MESSAGES_LINK} nếu không muốn nhận' }))[0]
      assert.equal(join(rp.renderRecipientMessage(inline, ctx({ optOutEnabled: true })).bubbles[0].parts), `Bấm ${link} nếu không muốn nhận`)
      assert.equal(join(rp.renderRecipientMessage(inline, ctx({ optOutEnabled: false })).bubbles[0].parts), 'Bấm  nếu không muốn nhận')
    })

    test('nội dung định dạng có span biến, không sót ký tự giữ chỗ', () => {
      const version = rp.recipientMessageVersions(source({ formattedContentEnabled: true, content: '<p><strong>Chào #{FULL_NAME}</strong> #{TEN}</p>' }))[0]
      const bubble = rp.renderRecipientMessage(version, ctx({ optOutEnabled: true })).bubbles[0]
      assert.equal(bubble.kind, 'rich')
      assert.ok(bubble.html.includes('<strong>Chào <span class="recipient-token is-filled">Nguyễn Minh Anh</span></strong>'), bubble.html)
      assert.ok(bubble.html.includes('is-unknown'))
      assert.ok(bubble.html.includes('Từ chối nhận tin:'))
      assert.doesNotMatch(bubble.html, /[\uE000\uE001]/)
    })

    test('SMS: khớp từng byte renderSmsInputContent của Desktop (main dựng nội dung từng dòng)', () => {
      const content = 'Chào #{SEX{anh-chị-anh/chị}} #{FULL_NAME}, {ưu đãi|quà tặng} ngày #{TODAY(DD/MM)}.\nGọi #{PHONE} | Bản 2 cho #{INFO1} | {Ba|Bốn} #{YESTERDAY(DD/MM/YY)}'
      const row = { name: 'Trần Quốc Bảo', phone: '987654321', info1: 'Khách VIP' }
      const realRandom = Math.random
      try {
        for (const rowIndex of [0, 1, 2, 3, 7]) {
          for (const useUnicode of [false, true]) {
            for (const keepNewLines of [false, true]) {
              const smsSource = source({ actionCode: 'sms_send', content, smsUseUnicode: useUnicode, smsKeepNewLines: keepNewLines })
              const versions = rp.recipientMessageVersions(smsSource)
              const versionIndex = rp.recipientVersionForRow({ channel: 'sms', share: false, rowIndex, versionCount: versions.length })
              const rendered = rp.renderRecipientMessage(versions[versionIndex], ctx({ channel: 'sms', mode: 'row', row, smsUseUnicode: useUnicode, smsKeepNewLines: keepNewLines, seed: 3 }))
              const preview = join(firstTextParts(rendered))
              const campaign = { content, schedule: NOW.toISOString(), extraSettings: { smsUseUnicode: useUnicode, smsKeepNewLines: keepNewLines } }
              // Cùng hạt giống với khung xem trước cho mỗi phiên bản.
              const shared = smsRecipient.renderSmsRecipientContent(campaign, row, rowIndex, { rng: seededRandom(3 * 7919 + versionIndex) })
              assert.equal(preview, shared, `rowIndex ${rowIndex} unicode ${useUnicode} newline ${keepNewLines}`)
              // Runtime Desktop dùng Math.random: cho nó đúng chuỗi số của hạt giống thì phải ra đúng bản xem trước.
              Math.random = seededRandom(3 * 7919 + versionIndex)
              const desktop = sms.renderSmsInputContent(campaign, row, rowIndex)
              Math.random = realRandom
              assert.equal(desktop, shared, `Desktop rowIndex ${rowIndex} unicode ${useUnicode} newline ${keepNewLines}`)
            }
          }
        }
      } finally {
        Math.random = realRandom
      }
    })

    test('SMS nâng cao: biến thể theo mục, khớp Desktop', () => {
      const advancedContentItems = [{ id: '1', content: 'Mục {một|1} #{FULL_NAME}', mediaOption: 'none', mediaItems: [] }, { id: '2', content: 'Mục hai #{INFO1}', mediaOption: 'none', mediaItems: [] }]
      const row = { name: 'Lê Hà', phone: '0912345678', info1: 'Q1' }
      const realRandom = Math.random
      try {
        for (const rowIndex of [0, 1, 2]) {
          const versionIndex = rowIndex % 2
          const campaign = { content: '', schedule: NOW.toISOString(), extraSettings: { advancedContentEnabled: true, advancedContentItems } }
          const shared = smsRecipient.renderSmsRecipientContent(campaign, row, rowIndex, { rng: seededRandom(11 + versionIndex) })
          Math.random = seededRandom(11 + versionIndex)
          const desktop = sms.renderSmsInputContent(campaign, row, rowIndex)
          Math.random = realRandom
          assert.equal(desktop, shared)
          const versions = rp.recipientMessageVersions(source({ actionCode: 'sms_send', advanced: true, advancedItems: advancedContentItems, content: '' }))
          assert.equal(versions.length, 2)
        }
      } finally {
        Math.random = realRandom
      }
    })

    test('SMS đếm tin theo luật sẵn có', () => {
      const version = rp.recipientMessageVersions(source({ actionCode: 'sms_send', content: 'Chào chị, '.repeat(10), smsUseUnicode: true }))[0]
      const rendered = rp.renderRecipientMessage(version, ctx({ channel: 'sms', smsUseUnicode: true }))
      assert.equal(rendered.smsSegments, 2)
      assert.equal(rendered.smsUnicode, true)
    })

    test('gọi thoại thêm câu báo AI, giữ dấu', () => {
      const version = rp.recipientMessageVersions(source({ actionCode: 'voice_call', content: 'Chào #{FULL_NAME}' }))[0]
      const rendered = rp.renderRecipientMessage(version, ctx({ channel: 'voice' }))
      assert.equal(join(rendered.bubbles[0].parts), 'Đây là cuộc gọi tự động sử dụng giọng nói AI. Chào Trần Quốc Bảo')
    })

    const friendMessage = 'Chào #{FULL_NAME}, em là Thảo bên Shop An Nhiên. Shop vừa về mẫu áo len thu đông, mình kết bạn để em gửi ảnh mẫu và bảng size cho tiện xem nhé!'
    test('lời mời cắt ở 150 ký tự sau khi điền tên', () => {
      const version = rp.recipientFriendRequestVersions(source({ friendRequestMessage: friendMessage }))[0]
      assertMatch(rp.renderRecipientFriendRequest(version, ctx()), { length: 146, cut: false })
      const long = rp.renderRecipientFriendRequest(version, ctx({ longName: true }))
      assert.equal(long.length, 159)
      assert.equal(long.cut, true)
      assert.equal(long.parts.filter((part) => part.kind === 'cut').map((part) => part.text).join(''), ' xem nhé!')
      assert.equal(long.parts.filter((part) => part.kind !== 'cut').map((part) => part.text).join('').length, 150)
    })

    test('lời mời chưa đo được khi biến hồ sơ chờ lúc gửi', () => {
      const version = rp.recipientFriendRequestVersions(source({ friendRequestMessage: friendMessage }))[0]
      assert.equal(rp.renderRecipientFriendRequest(version, ctx({ mode: 'row', row: { name: 'A' } })).length, null)
    })

    test('lời mời không bao giờ có link từ chối', () => {
      const version = rp.recipientFriendRequestVersions(source({ friendRequestMessage: 'Kết bạn #{STOP_MESSAGES_LINK}' }))[0]
      const rendered = rp.renderRecipientFriendRequest(version, ctx({ optOutEnabled: true }))
      assertMatch(rendered.parts.find((part) => part.kind === 'token'), { state: 'unknown', text: '#{STOP_MESSAGES_LINK}' })
    })

    const analyze = (overrides, extra = {}) => {
      const value = source(overrides)
      return rp.analyzeRecipientPreview({
        source: value,
        screens: rp.recipientPreviewScreens(value),
        rows: extra.rows || [],
        zaloWebSenders: extra.zaloWebSenders || 0,
        ctx: ctx({ channel: extra.channel || rp.recipientPreviewChannel(value.actionCode) }),
      })
    }
    const codes = (warnings) => warnings.map((item) => item.code)

    test('cảnh báo biến lạ và spin hỏng', () => {
      const warnings = analyze({ content: 'Chào #{TEN} | {a|b' })
      assertMatch(warnings.find((item) => item.code === 'unknown_token'), { level: 'warn', target: { version: 0 } })
      assertMatch(warnings.find((item) => item.code === 'broken_spin'), { target: { version: 1 } })
      assert.equal(rp.hasBrokenSpin('{a|b} #{SEX{a-b}} \\{'), false)
      assert.equal(rp.hasBrokenSpin('a } b'), true)
    })

    test('cảnh báo biến ở chế độ chia sẻ', () => {
      assert.ok(codes(analyze({ actionCode: 'zalo_message_friend', zaloMessageSendMode: 'share', content: 'Chào #{FULL_NAME}' })).includes('share_tokens'))
    })

    test('cảnh báo lời mời bị cắt và còn ít chỗ cho tên', () => {
      assert.ok(codes(analyze({ enableAddFriend: true, friendRequestMessage: 'x'.repeat(149) + '#{FULL_NAME}' })).includes('friend_request_cut'))
      const headroom = analyze({ enableAddFriend: true, friendRequestMessage: friendMessage }).find((item) => item.code === 'friend_request_headroom')
      assert.ok(headroom && headroom.text.includes('tên Zalo dài hơn 19 ký tự'), headroom && headroom.text)
    })

    test('đếm dòng data trống ở biến đang dùng', () => {
      const warning = analyze({ content: 'Chi nhánh #{INFO2}' }, { rows: [{ name: 'A', info2: 'x' }, { name: 'B', info2: '' }, { name: 'C' }] })
        .find((item) => item.code === 'empty_token_rows')
      assert.equal(warning && warning.text, '2/3 dòng trống INFO2: khách thấy chỗ trống ở Nội dung 1.')
    })

    test('cảnh báo media (Desktop không còn desktop_local_media)', () => {
      assert.ok(codes(analyze({ media: [], mediaOption: 'all', content: 'A' })).includes('media_option_empty'))
      assert.ok(codes(analyze({ media: [image('a.jpg')], mediaOption: 'random', randomCount: 4 })).includes('random_over_pool'))
      const video = { name: 'clip.mp4', cloudUrl: 'https://cdn.example.com/clip.mp4', mimeType: 'video/mp4', sizeBytes: 1 }
      assert.ok(codes(analyze({ media: [video], mediaOption: 'all' }, { zaloWebSenders: 1 })).includes('zalo_web_media'))
      assert.ok(!codes(analyze({ media: [image('a.jpg')], mediaOption: 'all' }, { zaloWebSenders: 1 })).includes('zalo_web_media'))
      // Tài khoản Zalo trình duyệt chỉ gửi được ảnh: file trên máy cũng phải xét theo đuôi.
      assert.ok(codes(analyze({ media: ['C:\\video\\clip.mp4'], mediaOption: 'all' }, { zaloWebSenders: 1 })).includes('zalo_web_media'))
      assert.ok(!codes(analyze({ media: ['C:\\anh\\a.png'], mediaOption: 'all' }, { zaloWebSenders: 1 })).includes('zalo_web_media'))
      const local = codes(analyze({ media: [{ name: 'x.png', cloudUrl: '', mimeType: null, sizeBytes: null, localPath: '/Users/a/x.png' }], mediaOption: 'all' }))
      assert.ok(!local.includes('desktop_local_media'))
      assert.deepEqual(local, [])
    })

    test('cảnh báo SMS dài, có dấu, trùng, link từ chối tắt, mục rỗng, thoại quá dài', () => {
      assert.ok(['sms_segments', 'sms_diacritics'].every((code) => codes(analyze({ actionCode: 'sms_send', content: `${'a'.repeat(170)} | Có dấu` })).includes(code)))
      assert.ok(codes(analyze({ content: 'Giống | giống  | Giống' })).includes('duplicate_versions'))
      assert.equal(analyze({ content: 'Bấm #{STOP_MESSAGES_LINK}' }).find((item) => item.code === 'stop_link_off').text, optOut.STOP_MESSAGES_CHECKBOX_ERROR)
      assert.ok(codes(analyze({ advanced: true, advancedItems: [
        { id: '1', content: 'A', mediaOption: 'none', mediaItems: [] },
        { id: '2', content: ' ', mediaOption: 'none', mediaItems: [] },
      ] })).includes('empty_version'))
      assert.ok(codes(analyze({ actionCode: 'voice_call', content: 'a'.repeat(4100) })).includes('voice_too_long'))
    })

    test('cảnh báo đứng trước thông tin, chiến dịch sạch thì im lặng', () => {
      assert.equal(analyze({ content: 'Chào #{TEN} | Chào #{TEN}' })[0].level, 'warn')
      assert.deepEqual(analyze({ content: 'Chào #{FULL_NAME}' }), [])
    })

    test('ghi chú xoay vòng theo kênh', () => {
      const value = source({ content: 'A | B', enableAddFriend: true, friendRequestMessage: 'Kết bạn' })
      assert.ok(rp.recipientPreviewNotes({ source: value, screens: rp.recipientPreviewScreens(value), liveSource: false })[0].includes('Nội dung 1 → 2'))
      const smsValue = source({ actionCode: 'sms_send', content: 'A | B' })
      assert.ok(rp.recipientPreviewNotes({ source: smsValue, screens: rp.recipientPreviewScreens(smsValue), liveSource: true }).join(' ').includes('cố định khi thêm data'))
      const share = source({ actionCode: 'zalo_message_group', zaloMessageSendMode: 'share', content: 'A' })
      assert.ok(rp.recipientPreviewNotes({ source: share, screens: rp.recipientPreviewScreens(share), liveSource: false })[0].includes('50 group'))
    })

    test('dòng data → phiên bản, bỏ qua lượt chia sẻ', () => {
      assert.equal(rp.recipientVersionForRow({ channel: 'zalo', share: false, rowIndex: 4, versionCount: 3 }), 1)
      assert.equal(rp.recipientVersionForRow({ channel: 'zalo', share: true, rowIndex: 4, versionCount: 3 }), null)
    })

    test('đếm/liệt kê spin: lồng nhau, ký tự thoát, biến', () => {
      assert.equal(countContentSpinOptions('{a|b} {c|{d|e}}'), 6)
      assert.equal(countContentSpinOptions('no spin #{FULL_NAME} \\{x|y\\}'), 1)
      assert.deepEqual(listContentSpinOptions('{Chào|Hi} #{FULL_NAME}{!|.}'), ['Chào #{FULL_NAME}!', 'Chào #{FULL_NAME}.', 'Hi #{FULL_NAME}!', 'Hi #{FULL_NAME}.'])
      assert.equal(listContentSpinOptions('{a|b|c} {d|e|f}', 4).length, 4)
      assert.equal(countContentSpinOptions('{a|b}'.repeat(20), 10_001), 10_001)
    })

    test('hạt giống cho chuỗi ngẫu nhiên ổn định', () => {
      const first = renderContentSpin('{a|b|c|d|e|f}{1|2|3}', { rng: seededRandom(42) })
      assert.equal(renderContentSpin('{a|b|c|d|e|f}{1|2|3}', { rng: seededRandom(42) }), first)
      const values = Array.from({ length: 50 }, seededRandom(7))
      assert.ok(values.every((value) => value >= 0 && value < 1))
    })

    test('con trỏ → phiên bản đang sửa, bỏ đoạn rỗng', () => {
      const content = 'Một {a|b} | | Hai #{FULL_NAME} |\nBa'
      assert.equal(rp.recipientVersionAtCaret(content, 0), 0)
      assert.equal(rp.recipientVersionAtCaret(content, content.indexOf('Hai') + 1), 1)
      assert.equal(rp.recipientVersionAtCaret(content, content.indexOf('| |') + 2), 0)
      assert.equal(rp.recipientVersionAtCaret(content, content.length), 2)
      const range = rp.recipientVariantRange(content, 1)
      assert.equal(content.slice(range.start, range.end), 'Hai #{FULL_NAME}')
      assert.equal(rp.recipientVariantRange(content, 5), null)
    })

    let failed = 0
    for (const { name, fn } of tests) {
      try {
        await fn()
        console.log(`  ok   ${name}`)
      } catch (error) {
        failed += 1
        console.error(`  FAIL ${name}\n       ${String(error && error.message || error).split('\n').join('\n       ')}`)
      }
    }
    console.log(`\n${tests.length - failed}/${tests.length} ca đạt`)
    if (failed) process.exitCode = 1
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
