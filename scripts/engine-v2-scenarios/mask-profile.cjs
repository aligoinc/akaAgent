// Che dữ liệu khách trong hồ sơ production để dùng làm dữ liệu thử của engine v2.
//
//   node scripts/engine-v2-scenarios/mask-profile.cjs <thư mục hồ sơ thô> <file ra>
//
// Thư mục hồ sơ thô (chỉ đọc từ production, nằm ngoài repo) gồm configs.json, outcomes3.json, zalo-errors.json, catalog.json.
// Giữ: khoá, kiểu, số, cờ, chuỗi ngắn dạng mã (enum), ngày ISO, biến mẫu #{…}, cú pháp xoay vòng {a|b}, đuôi tệp.
// Thay: chữ tự do, số dài (SĐT, UID, id nhóm), link, tên tệp, tên tag / nhóm. Phân bố kết quả và câu lỗi Zalo là dữ liệu tổng hợp,
// không có SĐT / tên / UID (câu lỗi đã che dãy số từ 3 chữ số lúc chép).
'use strict'
const fs = require('node:fs')
const path = require('node:path')

const [inDir, outFile] = process.argv.slice(2)
if (!inDir || !outFile) { console.error('Dùng: node mask-profile.cjs <thư mục hồ sơ thô> <file ra>'); process.exit(2) }
const read = name => JSON.parse(fs.readFileSync(path.join(inDir, name), 'utf8'))

const FILLER = ['xin', 'chào', 'anh', 'chị', 'bên', 'em', 'có', 'ưu', 'đãi', 'sản', 'phẩm', 'mới', 'hôm', 'nay', 'liên', 'hệ', 'ngay']
let fillerIndex = 0
const filler = () => FILLER[fillerIndex++ % FILLER.length]
const ENUM = /^[A-Za-z0-9_.\-/:+]{1,40}$/
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/
/** Khoá chứa chữ tự do: so theo phần cuối tên khoá (zaloMessageSendMode là mã, friendRequestMessage là chữ). */
const FREE_TEXT_KEY = /(content|message|template|text|subject|body|note|title|caption|keywords?|smsContent)$/i
/** Tên do khách đặt (tag, nhóm, danh sách): luôn thay, trừ tên tệp có đuôi. */
const NAME_KEY = /name$/i

/** Chữ tự do → chữ giả cùng độ dài tương đối; giữ #{…}, {a|b}, xuống dòng, dấu câu, emoji; số dài → 0. */
function maskText(value) {
  return String(value)
    .replace(/https?:\/\/\S+/g, 'https://example.test/link')
    .split(/(#\{[^}]*\}|[{}|\n])/u)
    .map(part => {
      if (/^#\{[^}]*\}$/.test(part) || /^[{}|\n]$/.test(part) || part === 'https://example.test/link') return part
      return part
        .replace(/\d{3,}/g, d => '0'.repeat(d.length))
        .replace(/[\p{L}]+/gu, () => filler())
    })
    .join('')
}
/** Id giả cùng độ dài, luôn bắt đầu bằng 9999 để nhận ra là dữ liệu giả. */
function maskId(value) {
  const s = String(value)
  let n = 0
  return s.replace(/\d/g, () => (n++ < 4 ? '9' : String((n * 7 + 3) % 10)))
}
function maskUrl(value) {
  const ext = /\.([A-Za-z0-9]{2,5})(?:[?#]|$)/.exec(String(value))?.[1]?.toLowerCase()
  return `https://cdn.example.test/media/${(fillerIndex++).toString(36)}${ext ? '.' + ext : ''}`
}
function maskFileName(value) {
  const ext = /\.([A-Za-z0-9]{2,5})$/.exec(String(value))?.[1]?.toLowerCase()
  return `tep-${(fillerIndex++).toString(36)}${ext ? '.' + ext : ''}`
}

function maskValue(key, value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (Array.isArray(value)) return value.map(v => maskValue(key, v))
  // Khoá là id (map theo tài khoản: zaloSendExclusionsByAccountId…): thay bằng id giả, giữ tên khoá của giá trị con.
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => /^\d{3,}$/.test(k) ? [maskId(k), maskValue(key, v)] : [k, maskValue(k, v)]))
  const s = String(value)
  if (s === '') return s
  if (/(url|path)$/i.test(key) || /^https?:\/\//i.test(s)) return maskUrl(s)
  if (/^name$/i.test(key) && /\.[A-Za-z0-9]{2,5}$/.test(s)) return maskFileName(s)
  if (ISO.test(s)) return s
  if (/^\d{4,}$/.test(s) || /^[gG]?\d{6,}$/.test(s)) return maskId(s)
  if (/id$/i.test(key) && /\d/.test(s)) return maskId(s)
  if (NAME_KEY.test(key)) return `Tên mẫu ${(fillerIndex++).toString(36)}`
  if (FREE_TEXT_KEY.test(key)) return maskText(s)
  if (ENUM.test(s)) return s
  return maskText(s)
}

function maskImages(images) {
  if (!Array.isArray(images)) return images
  return images.map(item => typeof item === 'string'
    ? (/^https?:/i.test(item) ? maskUrl(item) : maskFileName(item))
    : maskValue('image', item))
}

const configs = read('configs.json')
const outcomes = read('outcomes3.json')
const errors = read('zalo-errors.json')
const catalog = read('catalog.json')

const masked = {
  generatedAt: new Date().toISOString(),
  note: 'Hồ sơ production đã che: cấu hình chiến dịch mẫu, phân bố kết quả Zalo, câu lỗi Zalo, bộ luật và chính sách. Không có SĐT/tên/UID/nội dung thật.',
  activeCampaignsPerType7d: configs.per_type,
  campaigns: configs.sample.map((c, index) => ({
    sampleId: index + 1,
    actionId: c.action_id,
    runtime: c.server ? 'fly' : 'desktop',
    zaloWeb: c.web === true,
    scheduleType: c.schedule_type,
    dataTargetSourceMode: c.data_target_source_mode,
    content: c.content == null ? null : maskText(c.content),
    images: maskImages(c.images),
    extraSettings: maskValue('extraSettings', c.extra_settings || {})
  })),
  outcomeWindow: outcomes.window,
  outcomes: outcomes.by_action,
  zaloErrorWindow: errors.window,
  zaloErrors: errors.by_code.map(x => ({ ...x, msgs: (x.msgs || []).map(m => String(m).replace(/\b\d{3,}\b/g, '#')) })),
  catalog
}
const text = JSON.stringify(masked, null, 1)
// Chốt chặn: không còn chuỗi giống SĐT Việt Nam hay UID Zalo dài trong file ra.
const leaks = (text.match(/\b0\d{9}\b|\b84\d{9}\b|\b\d{15,}\b/g) || []).filter(s => !/^0+$/.test(s) && !/^9999\d*$/.test(s))
if (leaks.length) { console.error('Còn chuỗi giống SĐT/UID:', [...new Set(leaks)].slice(0, 5)); process.exit(1) }
fs.mkdirSync(path.dirname(outFile), { recursive: true })
fs.writeFileSync(outFile, text + '\n')
console.log(`Đã ghi ${outFile}: ${masked.campaigns.length} cấu hình, ${masked.outcomes.length} nhóm kết quả, ${masked.zaloErrors.length} nhóm lỗi Zalo, ` +
  `${catalog.rules.length} luật, ${catalog.policies.length} chính sách`)
