#!/usr/bin/env node
/**
 * Kiểm thử bộ kiểm nội dung (src/shared/contentSyntax.ts) bằng vòng lặp ngẫu nhiên, đáp án là CODE GỬI TIN THẬT:
 * bộ tách mẫu / spin (contentSpin.ts), điền biến Zalo / email (campaignContentTemplate.ts), SMS (smsContent.ts), nội dung có
 * định dạng (formattedContent.ts), Facebook (bản chép đúng regex của prepareFacebookCampaignContent, có kiểm còn khớp mã nguồn).
 *
 *   node scripts/content-syntax/fuzz-loop.cjs --seed 1 --cases 3000 [--real <pool.json> --real-cases 1500] [--show 5]
 *
 * Mỗi vòng: data mẫu soạn tay + nội dung sinh ngẫu nhiên đúng (biết trước số mẫu) + nội dung cố tình viết sai + data thật
 * (nếu có tệp pool, không commit vì là nội dung của khách). Mỗi nội dung được kiểm các tính chất ở `checkCase`; vi phạm in
 * theo nhóm kèm ví dụ. Mã thoát 1 khi còn vi phạm.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')

const root = path.resolve(__dirname, '..', '..')
const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const SEED = Number(arg('seed', '1'))
const CASES = Number(arg('cases', '3000'))
const REAL = arg('real', '')
const REAL_CASES = Number(arg('real-cases', '1500'))
const SHOW = Number(arg('show', '4'))
const DUMP = arg('dump', '')
const dumped = []
let currentItem = null

// ── Nạp code thật ────────────────────────────────────────────────────────────────────────────────────────────────
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'content-syntax-fuzz-'))
const entry = path.join(outDir, 'entry.ts')
fs.writeFileSync(entry, [
  `export * as syntax from ${JSON.stringify(path.join(root, 'src/shared/contentSyntax.ts'))}`,
  `export * as spin from ${JSON.stringify(path.join(root, 'src/shared/contentSpin.ts'))}`,
  `export { renderCampaignTemplateText } from ${JSON.stringify(path.join(root, 'src/shared/campaignContentTemplate.ts'))}`,
  `export { renderSmsInputContent } from ${JSON.stringify(path.join(root, 'src/shared/smsContent.ts'))}`,
  `export { normalizeVietnamMobilePhone } from ${JSON.stringify(path.join(root, 'src/shared/phone.ts'))}`,
  `export * as formatted from ${JSON.stringify(path.join(root, 'src/shared/formattedContent.ts'))}`,
  `export { convertHtmlToZaloMessage } from ${JSON.stringify(path.join(root, 'src/shared/zaloFormattedContent.ts'))}`,
  `export * as guard from ${JSON.stringify(path.join(root, 'src/main/services/contentSyntaxGuard.ts'))}`,
].join('\n'))
esbuild.buildSync({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(outDir, 'bundle.cjs'), logLevel: 'silent' })
const real = require(path.join(outDir, 'bundle.cjs'))
const { syntax, spin, formatted } = real

// Facebook điền biến ngay trong campaignScheduler: chép đúng hai regex, và dừng nếu mã nguồn đã đổi.
const schedulerSource = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
const FB_NAME_SOURCE = String.raw`.replace(/#\{\s*FULL_NAME\s*\}/gi, () => name)`
const FB_DATE_SOURCE = String.raw`.replace(/#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi,`
if (!schedulerSource.includes(FB_NAME_SOURCE) || !schedulerSource.includes(FB_DATE_SOURCE)) {
  console.error('Cách điền biến Facebook trong campaignScheduler.ts đã đổi: cập nhật renderFacebook của bộ thử.')
  process.exit(2)
}
function renderFacebook(text, name, rng) {
  return spin.renderContentSpin(text, { rng })
    .replace(/#\{\s*FULL_NAME\s*\}/gi, () => name)
    .replace(/#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi, () => '24/11/2026')
}

// ── Ngẫu nhiên có hạt giống ──────────────────────────────────────────────────────────────────────────────────────
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const random = mulberry32(SEED)
const pick = list => list[Math.floor(random() * list.length)]
const chance = p => random() < p
const int = (min, max) => min + Math.floor(random() * (max - min + 1))
// Mỗi hạt giống một tỉ lệ nội dung đúng / sai khác nhau.
const CLEAN_SHARE = 0.3 + random() * 0.3

// ── Ngữ cảnh gửi: loại chiến dịch, ô, cách gửi ──────────────────────────────────────────────────────────────────
const CONTEXTS = [
  { name: 'zalo_phone', actionId: 'zalo_message_phone', field: 'content', channel: 'zalo', audience: 'person', weight: 5 },
  { name: 'zalo_member', actionId: 'zalo_message_group_member', field: 'content', channel: 'zalo', audience: 'person', weight: 3 },
  { name: 'zalo_group', actionId: 'zalo_message_group', field: 'content', channel: 'zalo', audience: 'group', weight: 2 },
  { name: 'zalo_share', actionId: 'zalo_message_friend', field: 'content', channel: 'zalo', audience: 'share', share: true, weight: 2 },
  { name: 'zalo_html', actionId: 'zalo_message_phone', field: 'content', channel: 'zalo', audience: 'person', html: true, weight: 2 },
  { name: 'zalo_advanced', actionId: 'zalo_message_phone', field: 'advanced', channel: 'zalo', audience: 'person', weight: 1 },
  { name: 'zalo_friend_request', actionId: 'zalo_message_phone', field: 'friendRequestMessage', channel: 'zalo', audience: 'person', weight: 1 },
  { name: 'zalo_alias', actionId: 'zalo_message_phone', field: 'zaloAliasTemplate', channel: 'zalo', audience: 'person', weight: 1 },
  { name: 'sms', actionId: 'sms_send', field: 'content', channel: 'sms', audience: 'person', weight: 2 },
  { name: 'email', actionId: 'email_send', field: 'content', channel: 'email', audience: 'person', weight: 1 },
  { name: 'facebook_message', actionId: 'facebook_message_uid', field: 'content', channel: 'facebook', audience: 'person', weight: 2 },
  { name: 'facebook_comment', actionId: 'facebook_group_post', field: 'commentContent', channel: 'facebook', audience: 'person', weight: 1 },
]
const weighted = CONTEXTS.flatMap(context => Array(context.weight).fill(context))

function checkerInput(context, value, rows) {
  const extra = { zaloMessageSendMode: context.share ? 'share' : 'normal', formattedContentEnabled: context.html === true,
    enableAddFriend: true, enableZaloAlias: true }
  const input = { actionId: context.actionId, extraSettings: extra, inputRows: rows }
  if (context.field === 'content') input.content = value
  else if (context.field === 'advanced') extra.advancedContentItems = [{ content: value }]
  else extra[context.field] = value
  if (context.field === 'commentContent') input.content = 'Bài viết'
  return input
}
const reportField = context => context.field === 'advanced' ? 'advancedContentItems[0].content' : context.field

// ── Sinh nội dung ───────────────────────────────────────────────────────────────────────────────────────────────
const WORDS = ['Chào', 'bạn', 'anh', 'chị', 'em', 'bên', 'mình', 'đang', 'có', 'ưu', 'đãi', 'tháng', 'này', 'giảm', '30%', 'liên', 'hệ',
  'hotline', '0912 345 678', 'https://akabiz.vn/km?id=1', 'nhé', 'ạ', '🎁', '🔥', '✅', 'dự án', 'căn hộ', 'giá', 'chỉ', 'từ', '2,5', 'tỷ',
  'quận 7', 'Vinhomes', 'xem', 'ngay', 'SALE', '#sale', '#batdongsan', '@admin', '(*)', '[QC]', '[THÔNG BÁO]', '–', '-', ':', '!', '?', '…']
const VALID_TOKENS = ['#{FULL_NAME}', '#{ORIGINAL_NAME}', '#{INPUT_FULLNAME}', '#{PHONE}', '#{MOBILE}', '#{EMAIL}', '#{UID}',
  '#{INFO1}', '#{INFO2}', '#{INFO5}', '#{SEX{anh-chị-anh/chị}}', '#{SEX{Anh-Chị-Bạn}}', '#{SEX{ông-bà-quý khách}}',
  '#{TODAY(DD/MM/YYYY)}', '#{TOMORROW(DD/MM)}', '#{YESTERDAY(YYYY)}', '#{STOP_MESSAGES_LINK}']
const FACEBOOK_TOKENS = ['#{FULL_NAME}', '#{TODAY(DD/MM/YYYY)}', '#{TOMORROW(MM/DD/YYYY)}', '#{TODAY}', '#{full_name}', '#{ FULL_NAME }']
const BROKEN_TOKENS = ['#{SEX{anh-chị-anh/chị}', '#{FULL_NAME', '#{INPUT_Fullname}', '#{NAME}', '#{FULLNAME}', '#{INPUT FULLNAME}',
  '#{SEX{anh|chị|anh/chị}}', '#{SEX{anh-chị-anh/chị} }', '#{TODAY}', '#{today(dd/mm/yyyy)}', '#{SEX}', '#{Sex{anh-chị-bạn}}',
  '{anh-chị-anh/chị}', '{FULLNAME}', '{gioi_tinh}', '{full_name}', '{SEX{anh-chị-anh/chị}}', '{ORIGINAL_NAME}', '[fullname]',
  '[Vocative_web]', '[tên kh]', '[Họ và tên]', '[điền giá]', '[...]', '#{DỰ ÁN}', '#{F1 BITRIX}', '#{abc}', '#{a|b}', 'SEX{anh-chị-bạn}}']

function words(count) {
  const out = []
  for (let index = 0; index < count; index += 1) out.push(pick(WORDS))
  return out.join(' ')
}

/** Một đoạn chữ đúng: chữ, biến hợp lệ của kênh, spin lồng (luôn có dấu |), ký tự thoát. */
function cleanFragment(context, depth = 0) {
  const parts = []
  const count = int(1, 6)
  for (let index = 0; index < count; index += 1) {
    const roll = random()
    if (roll < 0.45) parts.push(words(int(1, 8)))
    else if (roll < 0.62 && context.channel !== 'other' && !context.share) {
      // Link từ chối chỉ điền trong nội dung tin nhắn Zalo gửi từng người.
      const stopLink = context.channel === 'zalo' && context.audience === 'person' && (context.field === 'content' || context.field === 'advanced')
      parts.push(context.channel === 'facebook' ? pick(FACEBOOK_TOKENS) : pick(VALID_TOKENS.filter(token =>
        !(context.channel === 'email' && /FULL_NAME|ORIGINAL_NAME/.test(token)) && !(context.audience === 'group' && /NAME|SEX/.test(token))
        && (stopLink || token !== '#{STOP_MESSAGES_LINK}'))))
    } else if (roll < 0.82 && depth < 3) {
      const options = []
      for (let option = int(2, 4); option > 0; option -= 1) options.push(chance(0.15) ? '' : cleanFragment(context, depth + 1))
      parts.push(`{${options.join('|')}}`)
    } else if (roll < 0.88) parts.push(pick(['\\{giá\\}', 'A \\| B', '\\\\', '50\\%'.replace('\\%', '%')]))
    else if (roll < 0.94) parts.push(pick(['\n', '\r\n', '\n\n', ' \t ']))
    else parts.push(pick(['😀', 'ℹ️', 'Ⓐ', ' ', 'ạ̀']))
  }
  return parts.join(pick([' ', ' ', '', '\n']))
}

/** Nội dung đúng gồm N mẫu, dấu | ngăn mẫu đứng sát chỗ xuống dòng (biết trước số mẫu). */
function cleanContent(context) {
  const variants = []
  const total = context.field === 'advanced' || context.field === 'zaloAliasTemplate' ? 1 : int(1, 5)
  for (let index = 0; index < total; index += 1) {
    let variant = cleanFragment(context).trim()
    if (!variant.replace(/[\s{}|\\]/g, '')) variant = words(3)
    variants.push(variant)
  }
  const joiner = pick(['\n|\n', '|\n', '\n|', ' |\n', '\n| '])
  return { text: variants.join(joiner), intended: variants.length }
}

/** Làm sai có chủ ý: bỏ / thêm ngoặc, đổi biến thành dạng hỏng, thêm dấu \ trước dấu |, chèn ngoặc không xoay vòng… */
function mutate(text) {
  const kinds = []
  let value = text
  for (let round = int(1, 3); round > 0; round -= 1) {
    const kind = pick(['drop_close', 'drop_open', 'stray_close', 'broken_token', 'escape_pipe', 'drop_hash', 'pipe_inline', 'double_pipe', 'unclosed_open'])
    kinds.push(kind)
    // Vị trí theo đơn vị UTF-16 (như slice): duyệt theo ký tự Unicode thì emoji làm lệch vị trí, xoá nhầm ký tự khác.
    const positions = (char) => value.split('').map((c, i) => c === char ? i : -1).filter(i => i >= 0)
    if (kind === 'drop_close' && positions('}').length) {
      const at = pick(positions('}')); value = value.slice(0, at) + value.slice(at + 1)
    } else if (kind === 'drop_open' && positions('{').length) {
      const at = pick(positions('{')); value = value.slice(0, at) + value.slice(at + 1)
    } else if (kind === 'stray_close') {
      const at = int(0, value.length); value = `${value.slice(0, at)}}${value.slice(at)}`
    } else if (kind === 'broken_token') {
      const at = int(0, value.length); value = `${value.slice(0, at)} ${pick(BROKEN_TOKENS)} ${value.slice(at)}`
    } else if (kind === 'escape_pipe' && positions('|').length) {
      const at = pick(positions('|')); value = `${value.slice(0, at)}\\${value.slice(at)}`
    } else if (kind === 'drop_hash' && value.indexOf('#{') >= 0) {
      value = value.replace('#{', '{')
    } else if (kind === 'pipe_inline') {
      const at = int(0, value.length); value = `${value.slice(0, at)} | ${value.slice(at)}`
    } else if (kind === 'double_pipe') {
      value = value.replace('|', '||')
    } else if (kind === 'unclosed_open') {
      const at = int(0, value.length); value = `${value.slice(0, at)}{${value.slice(at)}`
    }
  }
  return { text: value, kinds }
}

function toHtml(text) {
  const lines = text.split(/\r?\n/)
  return lines.map(line => {
    const escaped = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const decorated = chance(0.3) ? escaped.replace(/(^|\s)([^\s{}|#\\]+)(?=\s|$)/, '$1<strong>$2</strong>') : escaped
    return `<p>${decorated || '<br>'}</p>`
  }).join('')
}

// ── Data người nhận ─────────────────────────────────────────────────────────────────────────────────────────────
const PROFILES = [
  { input: { name: 'Nguyễn Văn An', phone: '0912345678', email: 'an@x.vn', uid: '7012345678901234567', info1: 'Gói A', info2: 'Q7', info5: 'VIP' },
    target: { displayName: 'An Nguyễn', originalName: 'Nguyễn Văn An', phone: '0912345678', gender: 0 } },
  { input: { name: 'Lê Thị Bình', phone: '0987654321', email: '', uid: '1', info1: '', info2: '', info5: '' },
    target: { displayName: 'Bình', originalName: 'Lê Thị Bình', phone: '', gender: 1 } },
  { input: { name: '', phone: '', email: '', uid: '', info1: '', info2: '', info5: '' },
    target: { displayName: '', originalName: '', phone: '', gender: undefined } },
]
const GROUP_TARGET = { displayName: 'Nhóm Bất động sản Q7', originalName: 'Nhóm Bất động sản Q7', phone: '', gender: undefined }
const NOW = new Date('2026-11-24T03:00:00Z')
const RNG_CONSTANTS = [0, 0.26, 0.51, 0.76, 0.999]

/** Chuỗi khách thật sự nhận cho một mẫu, theo kênh. `\u0001`/`\u0002` là ngoặc khách cố ý thoát. */
function renderVariant(context, variant, profile, rng) {
  const target = context.audience === 'group' ? GROUP_TARGET : profile.target
  // Như renderZaloTemplate: chỉ nội dung tin nhắn Zalo có afterSpin thay link từ chối (nhắn group không bật link: rỗng);
  // lời mời kết bạn, tên gợi nhớ, email không truyền optOut nên biến giữ nguyên văn.
  const mainZalo = context.channel === 'zalo' && (context.field === 'content' || context.field === 'advanced')
  // Link từ chối là phần điền theo người nhận: đo độ dài "chắc chắn" (hồ sơ noStopLink) thì tính rỗng như các biến data.
  const stopLink = text => text.split('#{STOP_MESSAGES_LINK}').join(context.audience === 'group' || profile.noStopLink ? '' : 'https://b.akabiz.biz/s/abc')
  if (context.share) {
    // Như shareMessage: chỉ xoay vòng chữ; nội dung có định dạng xoay vòng từng đoạn chữ rồi đổi sang tin Zalo.
    if (context.html) return real.convertHtmlToZaloMessage(formatted.transformFormattedContentText(variant, text => spin.renderContentSpin(text, { rng }))).msg
    return spin.renderContentSpin(variant, { rng })
  }
  if (context.channel === 'facebook') return renderFacebook(variant, profile.input.name, rng)
  if (context.channel === 'sms') {
    // renderSmsInputContent tự chọn mẫu theo rowIndex: truyền đúng một mẫu.
    return real.renderSmsInputContent({ content: spin.escapeContentVariantSeparators(variant), schedule: NOW.toISOString(),
      extraSettings: { smsUseUnicode: true, smsKeepNewLines: true } }, profile.input, 0)
  }
  const options = { spin: text => spin.renderContentSpin(text, { rng }), phone: (...values) => {
    for (const value of values) { const phone = real.normalizeVietnamMobilePhone(value); if (phone) return phone }
    return ''
  }, ...(mainZalo ? { afterSpin: stopLink } : {}) }
  const emailTarget = context.channel === 'email' ? undefined : target
  if (context.html) {
    const html = formatted.transformFormattedContentText(variant, text => real.renderCampaignTemplateText(text, profile.input, emailTarget, NOW, options))
    // Chữ Zalo thật sự nhận (msg của convertHtmlToZaloMessage), không phải bản xem trước.
    return real.convertHtmlToZaloMessage(html).msg
  }
  return real.renderCampaignTemplateText(variant, profile.input, emailTarget, NOW, options)
}

function realVariants(context, text) {
  if (context.field === 'advanced' || context.field === 'zaloAliasTemplate') return [text]
  if (context.html) return formatted.splitFormattedContentVariants(text)
  return spin.splitContentVariants(text, { trim: false }).filter(item => item.trim())
}

// ── Tính chất ───────────────────────────────────────────────────────────────────────────────────────────────────
const TOKEN_CODES = ['token_unclosed', 'token_unknown', 'token_malformed', 'token_unsupported_here', 'hashtag_spin', 'format_split']
const BRACE_CODES = ['brace_literal', 'brace_stray', 'brace_unclosed', ...TOKEN_CODES, 'legacy_token']
const LIMITS = { content: 2300, advanced: 2300, friendRequestMessage: 150, zaloAliasTemplate: 50 }
const violations = new Map()
const placeholderSamples = []
function violate(group, detail) {
  if (DUMP && currentItem) dumped.push({ group, context: currentItem.context.name, origin: currentItem.origin, text: currentItem.text, rows: currentItem.rows,
    intended: currentItem.intended, kinds: currentItem.kinds, detail })
  const list = violations.get(group) || []
  list.push(detail)
  violations.set(group, list)
}
const short = text => JSON.stringify(text.length > 220 ? `${text.slice(0, 220)}…` : text)

/** Thay ngoặc / dấu | khách cố ý thoát bằng ký tự trơ để biết dấu ngoặc nào trong tin gửi đi là ngoài ý muốn. */
function neutralizeEscapes(text) {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    // Bên trong biến bộ chạy giữ nguyên ký tự thoát (findTemplateTokenEnd): chép nguyên cả biến.
    if (text[index] === '#' && text[index + 1] === '{') {
      let depth = 1
      let cursor = index + 2
      for (; cursor < text.length && depth > 0; cursor += 1) {
        if (text[cursor] === '\\' && cursor + 1 < text.length && '{}|\\'.indexOf(text[cursor + 1]) >= 0) { cursor += 1; continue }
        if (text[cursor] === '{') depth += 1
        else if (text[cursor] === '}') depth -= 1
      }
      if (depth === 0) {
        out += text.slice(index, cursor)
        index = cursor - 1
        continue
      }
    }
    const next = text[index + 1]
    if (text[index] === '\\' && next !== undefined && '{}|\\'.indexOf(next) >= 0) {
      out += next === '{' ? '\u0001' : next === '}' ? '\u0002' : text[index] + next
      index += 1
      continue
    }
    out += text[index]
  }
  return out
}

/**
 * Biến nào còn nguyên văn ở BẤT KỲ cách chọn spin nào: điền biến trên toàn bộ chữ (spin để nguyên), vì cách điền biến của
 * code thật không phụ thuộc lựa chọn spin. Dùng cho T1 / T2 thay vì phải trúng đúng nhánh spin có biến.
 */
function renderTokensEverywhere(context, text, profile) {
  if (context.share) return text
  if (context.channel === 'facebook') {
    return text.replace(/#\{\s*FULL_NAME\s*\}/gi, () => 'X').replace(/#\{\s*(TODAY|TOMORROW|YESTERDAY)\s*(?:\(\s*(DD\/MM\/YYYY|MM\/DD\/YYYY)\s*\))?\s*\}/gi, () => 'D')
  }
  // SMS dùng đúng các regex điền biến của campaignContentTemplate (chỉ khác giá trị), và không thay link từ chối.
  const mainZalo = context.channel === 'zalo' && (context.field === 'content' || context.field === 'advanced')
  return real.renderCampaignTemplateText(text, profile.input, context.channel === 'email' ? undefined : profile.target, NOW, {
    spin: value => value, phone: () => '0912345678',
    ...(mainZalo ? { afterSpin: value => value.split('#{STOP_MESSAGES_LINK}').join('') } : {}),
  })
}

function checkCase(item) {
  const { context, text, origin } = item
  // Ô rỗng không được lưu nên không kiểm (fieldText bỏ qua).
  if (!text.trim()) return
  const started = Date.now()
  let reports
  try {
    reports = syntax.analyzeCampaignContentFields(checkerInput(context, text, item.rows))
  } catch (error) {
    violate('ngoại lệ trong bộ kiểm', `${origin} ${context.name} ${short(text)} ${error.stack}`)
    return
  }
  const elapsed = Date.now() - started
  if (elapsed > 250) violate('bộ kiểm chạy quá 250 ms', `${origin} ${context.name} ${elapsed}ms len=${text.length}`)
  const report = reports.find(entry => entry.field === reportField(context))
  if (!report) { violate('không có báo cáo cho ô', `${origin} ${context.name} ${short(text)}`); return }
  const issues = report.result.issues
  const has = codes => issues.some(issue => codes.indexOf(issue.code) >= 0)
  const blocking = issues.filter(issue => issue.severity === 'block')
  const tag = `${origin} ${context.name}`

  // Tin khách thật sự nhận (mọi hồ sơ người nhận × vài cách chọn spin).
  const neutral = neutralizeEscapes(text)
  // Dấu ngoặc khách cố ý thoát (`\{`) được gửi nguyên văn là đúng ý: thay bằng ký tự lạ ở cả chữ thường lẫn nội dung có định dạng.
  const variants = realVariants(context, neutral)
  const outputs = []
  for (const variant of variants) {
    for (const profile of PROFILES) {
      for (const constant of RNG_CONSTANTS) outputs.push(renderVariant(context, variant, profile, () => constant))
      const rng = mulberry32(int(1, 1e9))
      outputs.push(renderVariant(context, variant, profile, rng))
    }
  }

  // T1. Tin gửi đi còn `#{` nguyên văn thì bộ kiểm phải báo (kênh có biến: phải chặn, trừ ô tên gợi nhớ và biến lạ trên Facebook).
  // Ngoài các tin đã dựng, điền biến trên toàn bộ chữ để không phụ thuộc việc trúng đúng nhánh spin có biến.
  const plain = context.html ? formatted.formattedContentToPlainText(neutral) : neutral
  const everywhere = PROFILES.map(profile => renderTokensEverywhere(context, plain, profile))
  const verbatimFull = [...outputs, ...everywhere].find(output => output.indexOf('#{') >= 0)
  // Chỉ in đoạn quanh chỗ còn `#{` để dễ xem.
  const verbatim = verbatimFull === undefined ? undefined : verbatimFull.slice(Math.max(0, verbatimFull.indexOf('#{') - 40), verbatimFull.indexOf('#{') + 60)
  if (verbatim !== undefined) {
    // `#` đứng sát một ngoặc không xoay vòng (vd `#}{UI}` ra `#{UI}`) đã được báo là ngoặc gửi nguyên văn.
    if (!has(TOKEN_CODES) && !has(['brace_literal'])) violate('T1 tin gửi đi còn #{ mà bộ kiểm không báo', `${tag} ${short(text)} → ${short(verbatim)}`)
    else if (has(TOKEN_CODES) && blocking.length === 0 && context.field !== 'zaloAliasTemplate' && context.channel !== 'facebook'
      && !(context.channel === 'other')) violate('T1b tin gửi đi còn #{ mà chỉ nhắc, không chặn', `${tag} ${short(text)} → ${short(verbatim)}`)
  }
  // T2. Bộ kiểm chặn vì biến thì tin gửi đi phải thật sự còn `#{` (không chặn nhầm).
  // token_malformed không tính: biến đúng tên mà sai dạng có khi được điền ra chữ sai (vd #{SEX{a|b|c}} ra "a|b|c").
  const tokenBlocks = blocking.filter(issue => ['token_unknown', 'token_unsupported_here', 'token_unclosed'].indexOf(issue.code) >= 0)
  // Biến hỏng mà tin gửi đi ra dấu ngoặc lạc (vd #{SEX{anh{-chị}} ra "anh{") cũng là gửi sai: không tính chặn nhầm.
  let strayBrace = outputs.some(output => /[{}]/.test(output))
  // Nhánh xoay vòng chứa biến hỏng có khi hiếm được chọn: thử thêm nhiều cách chọn trước khi kết luận chặn nhầm.
  for (let attempt = 0; tokenBlocks.length > 0 && verbatim === undefined && !strayBrace && attempt < 400; attempt += 1) {
    const rng = mulberry32(int(1, 1e9))
    strayBrace = variants.some(variant => /#\{|[{}]/.test(renderVariant(context, variant, PROFILES[attempt % PROFILES.length], rng)))
  }
  if (tokenBlocks.length > 0 && verbatim === undefined && report.result.lostSeparators === 0 && !strayBrace) {
    violate('T2 chặn vì biến nhưng tin gửi đi không còn #{', `${tag} ${short(text)} :: ${tokenBlocks.map(issue => `${issue.code}:${issue.excerpt}`).join(', ')}`)
  }
  // T3. Dấu { } ngoài ý muốn trong tin gửi đi thì bộ kiểm phải báo.
  if (!context.html) {
    const brace = outputs.find(output => /[{}]/.test(output))
    if (brace !== undefined && !has(BRACE_CODES)) violate('T3 tin gửi đi còn dấu { } mà bộ kiểm không báo', `${tag} ${short(text)} → ${short(brace)}`)
  }
  // T4. Mỗi lần báo "ngoặc không xoay vòng" thì tin gửi đi phải có dấu ngoặc đó (ít nhất ở một cách chọn spin).
  for (const issue of issues.filter(entry => entry.code === 'brace_literal')) {
    let seen = outputs.some(output => /[{}]/.test(output))
    for (let attempt = 0; !seen && attempt < 400; attempt += 1) {
      const rng = mulberry32(int(1, 1e9))
      seen = variants.some(variant => /[{}]/.test(renderVariant(context, variant, PROFILES[0], rng)))
    }
    if (!seen) {
      violate('T4 báo ngoặc không xoay vòng nhưng tin gửi đi không có ngoặc', `${tag} ${short(text)} :: ${issue.excerpt}`)
    }
  }
  // T5. Bộ kiểm đếm số mẫu đúng như bộ tách thật.
  if (!context.html && context.field !== 'advanced' && context.field !== 'zaloAliasTemplate') {
    const actual = spin.splitContentVariants(text).length
    if (Math.max(1, report.result.variantCount) !== Math.max(1, actual) && text.trim()) {
      violate('T5 số mẫu bộ kiểm đếm khác bộ tách thật', `${tag} ${short(text)} :: kiểm=${report.result.variantCount} thật=${actual}`)
    }
  }
  // T6. Nội dung sinh đúng: bộ tách thật ra đúng số mẫu đã soạn và bộ kiểm không chặn.
  if (origin === 'sinh-đúng' && item.intended !== undefined) {
    const actual = realVariants(context, text).length
    if (actual !== item.intended) violate('T6 sinh đúng nhưng bộ tách thật ra số mẫu khác (lỗi bộ sinh hoặc bộ tách)', `${tag} ${short(text)} :: ${actual}/${item.intended}`)
    if (blocking.length > 0) violate('T6b nội dung đúng bị chặn', `${tag} ${short(text)} :: ${blocking.map(issue => `${issue.code}:${issue.excerpt}`).join(', ')}`)
  }
  // T7. Nội dung cố tình sai làm số mẫu thật khác số mẫu đã soạn thì bộ kiểm phải báo gì đó.
  if (origin === 'cố-tình-sai' && item.intended !== undefined && !context.html) {
    const actual = realVariants(context, text).length
    // Hai lỗi bù nhau thành một ngoặc { } hợp lệ bọc qua dấu | (giống hệt cách khách cố ý viết `{Bài A|Bài B}` để chọn ngẫu
    // nhiên một bài, 19 nội dung thật) thì không phân biệt được: không tính.
    const balancedSpin = report.result.lostSeparators === 0 && !issues.some(issue => ['brace_unclosed', 'brace_stray'].indexOf(issue.code) >= 0)
      && spin.findContentVariantSeparatorIndexes(text).length < (text.match(/\|/g) || []).length
    if (actual < item.intended && issues.length === 0 && !balancedSpin) violate('T7 số mẫu bị gộp mà bộ kiểm không báo', `${tag} [${item.kinds}] ${short(text)} :: ${actual}/${item.intended}`)
  }
  // T8. Độ dài: "chắc chắn vượt" phải đúng với tin gửi đi khi data rỗng (hồ sơ cuối).
  const limit = LIMITS[context.field]
  if (limit && context.channel === 'zalo' && !context.share) {
    const reported = issues.some(issue => issue.code === 'too_long')
    const empty = PROFILES[2]
    let longestEmpty = 0
    for (const variant of variants) {
      for (const constant of RNG_CONSTANTS) {
        // Xưng hô lấy lựa chọn ngắn nhất: thử cả ba giới tính, lấy độ dài nhỏ nhất.
        const lengths = [0, 1, undefined].map(gender => renderVariant(context, variant, { ...empty, noStopLink: true, target: { ...empty.target, gender } }, () => constant).trim().length)
        longestEmpty = Math.max(longestEmpty, Math.min(...lengths))
      }
    }
    const applies = context.field === 'content' || context.field === 'advanced' ? /^zalo_message_/.test(context.actionId) : true
    // Nội dung có định dạng: bộ kiểm không chép nguyên cách Zalo gộp khoảng trắng / thêm link, cho lệch 2%.
    const slack = context.html ? Math.ceil(Math.max(limit, longestEmpty) * 0.02) : 0
    // Biến hỏng: bộ kiểm cố ý chưa tính độ dài tới khi sửa biến (lỗi biến đã báo).
    const brokenTokenHere = has(['token_unclosed', 'token_malformed']) || issues.some(issue => issue.code === 'token_unknown' && !/^#\{[A-Za-z_][A-Za-z_0-9]*\}$/.test(issue.excerpt))
    if (applies && longestEmpty > limit + slack && !reported && !brokenTokenHere) violate('T8 chắc chắn vượt giới hạn mà không nhắc', `${tag} len=${longestEmpty} > ${limit}`)
    if (reported) {
      const claimed = Math.max(...issues.filter(issue => issue.code === 'too_long').map(issue => Number((/dài (?:ít nhất )?([\d.]+) ký tự/.exec(issue.message) || [])[1].replace(/\./g, ''))))
      // Biến hỏng (thiếu ngoặc, sai dạng) bộ chạy có khi điền lệch qua cả đoạn chữ sau: lỗi biến đã được báo trước, số ký tự chỉ là "ít nhất".
      const brokenToken = has(['token_unclosed', 'token_malformed', 'token_unknown'])
      if (claimed + slack < longestEmpty && !brokenToken) violate('T8b số ký tự báo nhỏ hơn tin gửi đi thật', `${tag} báo=${claimed} thật=${longestEmpty}`)
      if (claimed <= limit) violate('T8c báo quá dài nhưng số báo không vượt giới hạn', `${tag} báo=${claimed}`)
      // Không có đoạn xoay vòng thì tin thật xác định: báo quá dài mà tin thật không vượt là báo nhầm.
      const fixed = spin.renderContentSpin(text, { rng: () => 0 }) === spin.renderContentSpin(text, { rng: () => 0.999 })
        && spin.renderContentSpin(text, { rng: () => 0.5 }) === spin.renderContentSpin(text, { rng: () => 0 })
      if (fixed && longestEmpty + slack <= limit) violate('T8d báo quá dài nhưng tin gửi đi không vượt', `${tag} báo=${claimed} thật=${longestEmpty}`)
    }
  }
  // T9. "Sửa giúp" không được làm nội dung tệ hơn: sau khi sửa không có lỗi chặn mới, chữ ngoài chỗ sửa giữ nguyên.
  if (!report.html) {
    const fixable = issues.filter(issue => issue.fix)
    if (fixable.length > 0) {
      const options = { channel: report.channel, html: false }
      const before = syntax.analyzeContentSyntax(text, options).issues.filter(issue => issue.severity === 'block').length
      const fixedAll = syntax.applyContentSyntaxFixes(text, options, fixable.map(issue => issue.code))
      const after = syntax.analyzeContentSyntax(fixedAll, options).issues.filter(issue => issue.severity === 'block').length
      if (after > before) violate('T9 sửa giúp sinh thêm lỗi chặn', `${tag} ${short(text)} → ${short(fixedAll)}`)
      for (const issue of fixable) {
        const single = syntax.applyContentSyntaxFix(text, issue.fix)
        if (single.slice(0, issue.fix.start) !== text.slice(0, issue.fix.start) || single.slice(issue.fix.start + issue.fix.text.length) !== text.slice(issue.fix.end)) {
          violate('T9b sửa giúp đổi cả chữ ngoài chỗ sửa', `${tag} ${issue.code}`)
        }
      }
    }
  }
  // T10. Chia sẻ: còn bất kỳ `#{` nào thì phải chặn.
  if (context.share && /#\{/.test(text) && blocking.length === 0) violate('T10 gửi dạng chia sẻ có #{ mà không chặn', `${tag} ${short(text)}`)
  // T11. Dòng data thiếu: số dòng báo thiếu phải khớp số người nhận thật sự nhận chỗ trống.
  if (item.rows && (context.field === 'content') && !context.html && (context.channel === 'zalo' || context.channel === 'sms') && !context.share) {
    const warning = syntax.campaignContentSaveWarning(checkerInput(context, text, item.rows))
    const lines = warning ? warning.message.split('\n').filter(line => /dòng data chưa có/.test(line)) : []
    const tokens = [...new Set((report.result.text.match(/#\{[A-Z_0-9]+\}/g) || []))]
    for (const [column, label] of [['name', 'Tên'], ['email', 'Email'], ['info1', 'Info1'], ['info2', 'Info2'], ['info5', 'Info5']]) {
      // Đáp án: điền thật từng biến với từng dòng, đếm dòng ra rỗng.
      const usedTokens = tokens.filter(token => {
        const probe = profile => renderVariant(context, token, profile, () => 0)
        const full = { input: { name: 'X', phone: '0912345678', email: 'e@x.vn', uid: '9', info1: 'X', info2: 'X', info5: 'X' }, target: { displayName: 'D', originalName: 'O', phone: '0912345678', gender: 0 } }
        const cleared = { input: { ...full.input, [column]: '' }, target: full.target }
        return probe(full) !== probe(cleared)
      })
      if (usedTokens.length === 0) continue
      const missing = item.rows.filter(row => !String(row[column] ?? '').trim()).length
      const line = lines.find(entry => entry.includes(`chưa có ${label} `))
      if (missing > 0 && !line) violate('T11 data thiếu cột mà không báo', `${tag} ${column} ${missing}/${item.rows.length} ${short(text)}`)
      if (line && !line.includes(`${missing}/${item.rows.length} `)) violate('T11b số dòng thiếu báo sai', `${tag} ${line}`)
    }
    for (const line of lines) {
      const label = (/chưa có (\S+)/.exec(line) || [])[1]
      const column = { Tên: 'name', Email: 'email', Info1: 'info1', Info2: 'info2', Info5: 'info5' }[label]
      if (!column) continue
      const usedHere = tokens.some(token => {
        const base = { input: { name: 'X', phone: '0912345678', email: 'e@x.vn', uid: '9', info1: 'X', info2: 'X', info5: 'X' }, target: { displayName: 'D', originalName: 'O', phone: '0912345678', gender: 0 } }
        return renderVariant(context, token, base, () => 0) !== renderVariant(context, token, { input: { ...base.input, [column]: '' }, target: base.target }, () => 0)
      })
      if (!usedHere) violate('T11c báo thiếu cột mà biến không dùng cột đó', `${tag} ${line}`)
    }
  }

  // T12. Câu hỏi lúc lưu: "Sửa giúp" không sinh lỗi chặn, chỉ đổi đúng ô đã nêu, và sửa xong không hỏi lại y nguyên.
  const input = checkerInput(context, text, item.rows)
  const warning = syntax.campaignContentSaveWarning(input)
  if (warning) {
    if (!(warning.count > 0) || !warning.message.trim()) violate('T12 câu hỏi lúc lưu rỗng', `${tag} ${short(text)}`)
    const form = { content: input.content, friendRequestMessage: input.extraSettings.friendRequestMessage,
      zaloAliasTemplate: input.extraSettings.zaloAliasTemplate, commentContent: input.extraSettings.commentContent,
      advancedContentItems: input.extraSettings.advancedContentItems }
    const fixedForm = syntax.applyCampaignContentFixes(form, warning.fixes)
    const changed = Object.keys(form).filter(key => JSON.stringify(form[key]) !== JSON.stringify(fixedForm[key]))
    for (const key of changed) {
      if (!Object.keys(warning.fixes).some(field => field === key || field.startsWith(`${key}[`))) violate('T12b sửa giúp đổi ô không được nêu', `${tag} ${key}`)
    }
    if (changed.length > 0) {
      const fixedInput = { ...input, content: fixedForm.content, extraSettings: { ...input.extraSettings, friendRequestMessage: fixedForm.friendRequestMessage,
        zaloAliasTemplate: fixedForm.zaloAliasTemplate, commentContent: fixedForm.commentContent, advancedContentItems: fixedForm.advancedContentItems } }
      const okBefore = syntax.checkCampaignContentSyntax(input).ok
      const okAfter = syntax.checkCampaignContentSyntax(fixedInput).ok
      if (okBefore && !okAfter) violate('T12c sửa giúp làm chiến dịch không lưu được', `${tag} ${short(text)} → ${short(String(fixedForm.content ?? ''))}`)
      const again = syntax.campaignContentSaveWarning(fixedInput)
      if (again && again.signature === warning.signature) violate('T12d sửa xong vẫn hỏi y nguyên', `${tag} ${short(text)}`)
    }
  }
  // T13. Đường lưu Desktop: chỉ sửa giới hạn thì không bao giờ chặn; sửa nội dung thì chặn đúng như bộ kiểm; bật chia sẻ có biến thì chặn.
  if (context.field === 'content' && !context.html) {
    const current = { actionId: context.actionId, content: text, extraSettings: { ...input.extraSettings, actionLimits: { sleepBetweenActions: 30 } } }
    const guardThrows = run => { try { run(); return false } catch (error) { if (error.code !== syntax.CONTENT_SYNTAX_ERROR_CODE) throw error; return true } }
    real.guard.setContentSyntaxGuardMode('block')
    const limitsOnly = real.guard.changedCampaignContentFields(context.actionId, { extraSettings: { ...current.extraSettings, actionLimits: { sleepBetweenActions: 60 } } }, current)
    if (guardThrows(() => real.guard.assertCampaignContentSyntax(limitsOnly))) violate('T13 chỉ sửa giới hạn mà đường lưu chặn', `${tag} ${short(text)}`)
    const fresh = real.guard.changedCampaignContentFields(context.actionId, { content: text }, { ...current, content: 'nội dung cũ' })
    const expected = !syntax.checkCampaignContentSyntax(checkerInput(context, text)).reports.filter(entry => entry.field === 'content')
      .every(entry => syntax.blockingContentSyntaxIssues(entry.result).length === 0)
    if (guardThrows(() => real.guard.assertCampaignContentSyntax(fresh)) !== expected) violate('T13b đường lưu Desktop khác bộ kiểm', `${tag} ${short(text)}`)
    if ((context.actionId === 'zalo_message_friend' || context.actionId === 'zalo_message_group') && /#\{/.test(text)) {
      const normal = { ...current, extraSettings: { ...current.extraSettings, zaloMessageSendMode: 'normal' } }
      const toShare = real.guard.changedCampaignContentFields(context.actionId, { extraSettings: { ...normal.extraSettings, zaloMessageSendMode: 'share' } }, normal)
      if (!guardThrows(() => real.guard.assertCampaignContentSyntax(toShare))) violate('T13c bật chia sẻ với nội dung có biến mà đường lưu không chặn', `${tag} ${short(text)}`)
    }
  }
  // T14. Nội dung có định dạng: số mẫu bộ kiểm đếm khớp bộ tách nội dung có định dạng của bộ chạy.
  if (context.html && context.field === 'content' && report.result.lostSeparators === 0) {
    const actual = formatted.splitFormattedContentVariants(text).length
    if (Math.max(1, actual) !== Math.max(1, report.result.variantCount)) violate('T14 số mẫu nội dung có định dạng khác bộ tách thật', `${tag} ${short(text)} :: kiểm=${report.result.variantCount} thật=${actual}`)
  }
  // Gom chỗ trống bị nhắc trong data thật để xem tay (không phải vi phạm).
  if (origin === 'data-thật') for (const issue of issues.filter(entry => entry.code === 'placeholder_unfilled' || entry.code === 'brace_literal')) placeholderSamples.push(`${issue.code} ${issue.excerpt}`)
}

// ── Data mẫu soạn tay ────────────────────────────────────────────────────────────────────────────────────────────
const HANDMADE = [
  ['zalo_member', 'Chào #{SEX{anh-chị-anh/chị}} ơi|Hi #{SEX{anh-chị-anh/chị}} nhé|Cảm ơn #{SEX{anh-chị-anh/chị}}'],
  ['zalo_member', 'Chào #{SEX{anh-chị-anh/chị} ơi|Hi #{SEX{anh-chị-anh/chị} nhé|Cảm ơn #{SEX{anh-chị-anh/chị}'],
  ['zalo_phone', 'Chào {anh-chị-anh/chị} #{FULL_NAME}, bên em có ưu đãi'],
  ['zalo_phone', 'Chào {gioi_tinh} {{full_name}} ạ'],
  ['zalo_phone', 'Dạ chào [tên kh], em gửi [điền biểu phí] ạ'],
  ['zalo_phone', '{Chào|Xin chào|Hi} #{FULL_NAME}, {giá|giá chỉ} từ \\{2 tỷ\\}'],
  ['zalo_phone', 'Mẫu một dài\n\\|\nMẫu hai dài'],
  ['zalo_phone', `Hotline | 0900 000 000\n${'Nội dung chào hàng đầy đủ của shop. '.repeat(6)}`],
  ['zalo_group', 'Chào cả nhà, #{FULL_NAME} có ưu đãi cho #{SEX{anh-chị-mọi người}}'],
  ['zalo_share', 'Chào #{FULL_NAME} {ơi|nhé}'],
  ['zalo_share', 'Chào bạn {ơi|nhé} hôm nay #{TODAY(DD/MM/YYYY)}'],
  ['facebook_message', 'Chào #{FULL_NAME} #{INPUT_FULLNAME} #{SEX{anh-chị-bạn}}'],
  ['facebook_message', 'Chào #{ full_name }, ngày #{today}'],
  ['facebook_message', 'Bài viết #{abc} #sale {a|b} | Bài hai'],
  ['facebook_comment', 'Hay quá #{INFO1} {ạ|nhé}'],
  ['sms', 'Chào #{FULL_NAME}, mã #{INFO1}|Hi #{INPUT_FULLNAME}'],
  ['email', 'Gửi #{FULL_NAME}, email #{EMAIL}'],
  ['zalo_alias', 'Khách hàng tiềm năng dự án Vinhomes Grand Park quận 9 - #{FULL_NAME}'],
  ['zalo_alias', '#{FULL_NAME} - #{PHONE} - #{INFO1} - #{INFO2}'],
  ['zalo_friend_request', `Chào #{FULL_NAME} ${'k'.repeat(160)}`],
  ['zalo_phone', `${'Nội dung dài. '.repeat(180)}`],
  ['zalo_html', '<p>Chào #{SEX{anh-chị-anh/chị}} #{FULL_NAME}</p><p>|</p><p>Mẫu hai {a|b}</p>'],
  ['zalo_html', '<p>Chào <strong>#{FULL_NAME</strong> nhé</p>'],
  ['zalo_phone', '#{SEX{anh-chị-anh/chị}}#{SEX{anh-chị-anh/chị}}{{{{{{{{{{|}}}}}}}}}}'],
  ['zalo_phone', '{'.repeat(200) + '|'.repeat(200) + '}'.repeat(200)],
  ['zalo_phone', '#{'.repeat(300)],
  ['zalo_phone', 'a\\'],
  ['zalo_phone', '\\|\\{\\}\\\\'],
  ['zalo_phone', ''],
  ['zalo_phone', '     '],
]

function buildRound() {
  const items = []
  const rowsFor = () => {
    if (!chance(0.5)) return undefined
    const rows = []
    for (let index = int(1, 6); index > 0; index -= 1) {
      rows.push({ name: chance(0.7) ? 'Khách' : '', phone: '0912345678', email: chance(0.5) ? 'a@b.vn' : '', info1: chance(0.6) ? 'X' : '', info2: chance(0.5) ? ' ' : 'Y', info5: '' })
    }
    return rows
  }
  for (const [name, text] of HANDMADE) items.push({ context: CONTEXTS.find(context => context.name === name), text, origin: 'mẫu-tay', rows: rowsFor() })
  for (let index = 0; index < CASES; index += 1) {
    const context = pick(weighted)
    const clean = cleanContent(context)
    const html = context.html
    if (chance(CLEAN_SHARE)) {
      items.push({ context, text: html ? toHtml(clean.text) : clean.text, intended: clean.intended, origin: 'sinh-đúng', rows: rowsFor() })
    } else {
      const wrong = mutate(clean.text)
      items.push({ context, text: html ? toHtml(wrong.text) : wrong.text, intended: clean.intended, kinds: wrong.kinds, origin: 'cố-tình-sai', rows: rowsFor() })
    }
  }
  if (REAL && fs.existsSync(REAL)) {
    const pool = JSON.parse(fs.readFileSync(REAL, 'utf8'))
    for (let index = 0; index < REAL_CASES && pool.length; index += 1) {
      const entry = pool[Math.floor(random() * pool.length)]
      let context = CONTEXTS.find(item => item.name === entry.context) || CONTEXTS[0]
      // Nội dung của chiến dịch có định dạng là HTML (bộ kiểm tự nhận theo thẻ ở mục nâng cao; form gửi cờ định dạng).
      if (context.channel === 'zalo' && context.field !== 'friendRequestMessage' && context.field !== 'zaloAliasTemplate'
        && /<\/?(p|br|strong|em|ul|ol|li|a)\b/i.test(entry.value)) context = { ...context, html: true }
      items.push({ context, text: entry.value, origin: 'data-thật', rows: rowsFor() })
    }
  }
  return items
}

// --replay <file dump>: chạy lại đúng các ca đã ghi (sau khi sửa) thay vì sinh vòng mới.
const REPLAY = arg('replay', '')
const items = REPLAY
  ? [...new Map(REPLAY.split(',').flatMap(file => JSON.parse(fs.readFileSync(file, 'utf8')))
    .map(entry => [`${entry.context}\u0000${entry.text}`, { ...entry, context: CONTEXTS.find(context => context.name === entry.context) }])).values()]
  : buildRound()
for (const item of items) { currentItem = item; checkCase(item) }
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(dumped, null, 1))
const counts = items.reduce((map, item) => ({ ...map, [item.origin]: (map[item.origin] || 0) + 1 }), {})
console.log(`Vòng hạt giống ${SEED}: ${items.length} nội dung ${JSON.stringify(counts)}`)
if (placeholderSamples.length) console.log(`Nhắc trong data thật (xem tay): ${JSON.stringify([...new Set(placeholderSamples)].slice(0, 25))}`)
if (violations.size === 0) {
  console.log('Không có vi phạm.')
} else {
  for (const [group, list] of violations) {
    console.log(`\n✗ ${group}: ${list.length}`)
    for (const detail of list.slice(0, SHOW)) console.log(`   ${detail}`)
  }
}
fs.rmSync(outDir, { recursive: true, force: true })
process.exit(violations.size === 0 ? 0 : 1)
