// Thế giới giả lập cho bộ kịch bản engine v2 (run.cjs).
//
// - Dựng tổ chức / nhân viên / tài khoản / chiến dịch / data từ cấu hình production đã che (fixtures/profile-*.json).
// - Cổng Zalo giả: mỗi data có "tính cách" cố định cho từng thao tác (không tồn tại, chặn người lạ, đã là bạn bè…), rút theo phân bố
//   kết quả thật (outcomes + zaloErrors, theo nơi chạy); lỗi hạ tầng (mạng, phiên, runtime Fly, hàng rào media) rút lại ở mỗi lần gọi,
//   theo tỉ lệ thật nhân hệ số chaos. Lỗi dựng lại đúng như cổng Desktop / Fly đọc (zaloPortErrorFrom, mediaFenceError, flyCommandFailure).
// - Ghi lại mọi lần "giao" tới người nhận để kiểm không gửi trùng, và các lời gọi phụ (đăng ký tương tác, lưu danh bạ) để kiểm bất biến.
'use strict'
const crypto = require('node:crypto')

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hash32 = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest().readUInt32LE(0)
const unitRandom = (...parts) => hash32(...parts) / 4294967296
function weighted(x, entries) {
  const total = entries.reduce((s, e) => s + e.w, 0)
  let left = x * total
  for (const e of entries) { left -= e.w; if (left <= 0) return e }
  return entries[entries.length - 1]
}
const NUMERIC = /^-?\d+$/
const ERRNO = /^(?:E[A-Z0-9_]{2,}|UND_ERR_[A-Z0-9_]+)$/
const object = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {})

// ---------------------------------------------------------------------------------------------------------------------------
// Mô hình kết quả theo dữ liệu thật
// ---------------------------------------------------------------------------------------------------------------------------

/** Lỗi "tính cách" (cố định theo người nhận): mã Zalo số, trừ -69 (Zalo tự ngừng thử lại, lần sau có thể được). */
const isPersonaCode = code => NUMERIC.test(code) && code !== '-69'
/**
 * Mã do tài khoản (Zalo hãm tốc / hạn chế tài khoản, hết lượt, phiên hỏng), không do người nhận: rút ở mỗi lần gọi theo tỉ lệ thật
 * (không nhân chaos). Nhắn group: 126/127 là group chặn riêng tài khoản nên vẫn là tính cách của group.
 */
const ACCOUNT_LEVEL = {
  zalo_message_stranger: ['127', '120', '802', '600', '221'], zalo_message_friend: ['127', '120', '802', '600'],
  zalo_find_phone_user: ['221', '312', '313', '304', '600'], zalo_add_friend: ['221', '223', '224', '600'],
  zalo_add_group_member: ['314', '120', '264', '269', '600'], zalo_message_group: ['221', '600']
}
/** Dòng lỗi của bộ cũ không phải câu trả lời của Zalo cho người nhận mà là sản phẩm phụ của bộ chạy cũ: bỏ khỏi mô hình. */
const ARTIFACT = /Chiến dịch đã dừng theo policy khi gửi media/

/**
 * Mô hình theo (thao tác, nơi chạy): tỉ lệ thành công, phân bố lỗi tính cách và lỗi hạ tầng, cùng cửa sổ thời gian (outcomes).
 * Thành phần của một mã lỗi (mã Zalo nào, câu nào) lấy từ zaloErrors (cửa sổ 7 ngày) theo tỉ lệ, nên tỉ lệ thành công / lỗi đúng
 * với cửa sổ của outcomes.
 */
function buildModel(profile) {
  const comp = new Map()
  for (const e of profile.zaloErrors) {
    if (ARTIFACT.test((e.msgs || [])[0] || '')) continue
    const key = `${e.action_code}|${e.ncode}|${e.server ? 'fly' : 'desktop'}`
    if (!comp.has(key)) comp.set(key, [])
    comp.get(key).push(e)
  }
  const model = {}
  for (const o of profile.outcomes) {
    const rt = o.server ? 'fly' : 'desktop'
    const m = (model[o.action_code] ||= {})[rt] ||= { total: 0, ok: 0, persona: [], transient: [], account: [] }
    m.total += o.n
    if (o.status === 'thành công') { m.ok += o.n; continue }
    let parts = comp.get(`${o.action_code}|${o.error_code}|${rt}`) || comp.get(`${o.action_code}|${o.error_code}|${rt === 'fly' ? 'desktop' : 'fly'}`)
    if (!parts?.length) {
      // Không có câu Zalo tương ứng trong cửa sổ 7 ngày: lấy mã Zalo từ luật phân loại của chính mã nội bộ đó (ưu tiên luật của thao tác).
      const rule = (profile.catalog.rules || []).filter(r => r.is_active && r.signal_kind === 'zalo_code' && r.error_code === o.error_code && /^-?\d+$/.test(r.pattern))
        .sort((a, b) => (a.action_code === o.action_code ? 0 : a.action_code ? 2 : 1) - (b.action_code === o.action_code ? 0 : b.action_code ? 2 : 1))[0]
      parts = [{ zcode: rule ? rule.pattern : '', msgs: [rule ? 'Lỗi Zalo' : o.status], n: 1, ncode: o.error_code }]
    }
    const sum = parts.reduce((s, p) => s + p.n, 0)
    for (const p of parts) {
      const entry = { w: o.n * p.n / sum, code: String(p.zcode ?? ''), message: (p.msgs || [])[0] || '', errorCode: o.error_code, status: o.status }
      if (entry.message === 'Tag Zalo không tồn tại') entry.kind = 'label_not_found'
      if ((ACCOUNT_LEVEL[o.action_code] || []).includes(entry.code)) m.account.push(entry)
      else (isPersonaCode(entry.code) || entry.kind ? m.persona : m.transient).push(entry)
    }
  }
  for (const byRt of Object.values(model)) {
    for (const m of Object.values(byRt)) {
      m.transientRate = m.transient.reduce((s, e) => s + e.w, 0) / Math.max(1, m.total)
      m.accountRate = m.account.reduce((s, e) => s + e.w, 0) / Math.max(1, m.total)
      m.personaEntries = [{ w: m.ok, ok: true }, ...m.persona]
    }
  }
  return model
}

/** Mô hình của thao tác ở nơi chạy; thiếu thì lấy nơi chạy kia; không có dữ liệu thì thành công 90%, lỗi chung 10%. */
function modelFor(model, action, rt) {
  const byRt = model[action] || {}
  return byRt[rt] || byRt[rt === 'fly' ? 'desktop' : 'fly'] || {
    total: 100, ok: 90, transientRate: 0.01, transient: [{ w: 1, code: 'ECONNRESET', message: 'socket hang up' }],
    personaEntries: [{ w: 90, ok: true }, { w: 10, code: '114', message: 'Tham số không hợp lệ' }]
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Dựng lỗi như cổng thật
// ---------------------------------------------------------------------------------------------------------------------------

/** Như sendFailure / readFailure của cổng Desktop (src/main/engineAdapters/desktopZaloPort.ts). */
const DESKTOP_LOCAL_BEFORE_CALL = /^(?:Chưa có session Zalo|Không tìm thấy tài khoản(?: Zalo)?|Tài khoản không phải nền tảng Zalo)$/
function desktopError(E, error, operation, answered) {
  const fence = E.mediaFenceError(error)
  if (fence) return fence
  const message = error instanceof Error ? error.message.trim() : ''
  if (!answered && operation === 'send' && DESKTOP_LOCAL_BEFORE_CALL.test(message)) return E.zaloPortErrorFrom(error, { phase: 'before_send' })
  return E.zaloPortErrorFrom(error, { operation, answered })
}

/** Như flyCommandFailure của cổng Fly (akaAgentChatApi apps/system-worker/src/campaignEngine/flyZaloPort.ts). */
const FLY_BEFORE_DISPATCH = new Set(['campaign_runtime_unavailable', 'campaign_runtime_unavailable_before_dispatch', 'campaign_runtime_binding_changed',
  'campaign_failed_before_dispatch', 'campaign_command_cancelled', 'campaign_command_cancelled_before_dispatch', 'command_handler_unavailable',
  'campaign_media_download_failed'])
const FLY_UNCERTAIN = new Set(['command_result_unknown', 'command_dispatch_failed', 'campaign_media_timeout'])
function flyCommandError(E, code, message, operation) {
  const read = operation === 'read'
  const fly = phase => new E.ZaloPortError(message, { code, signal: { kind: 'fly_command', code, message }, phase,
    ...(phase === 'in_flight' ? { evidence: { deliveryState: 'unknown' } } : {}) })
  if (FLY_UNCERTAIN.has(code)) return fly(read ? 'before_send' : 'in_flight')
  if (FLY_BEFORE_DISPATCH.has(code)) return fly('before_send')
  if (code === 'zalo_command_timeout') return fly(read ? 'before_send' : 'in_flight')
  if (code === 'runtime_payload_invalid') return fly('before_send')
  if (code === 'runtime_label_session_reset') return fly(read ? 'before_send' : 'in_flight')
  return fly(read ? 'before_send' : 'after_send')
}

/**
 * Một lỗi của phân bố → lỗi cổng của nơi chạy. Mã Zalo số: Zalo đã trả lời. errno: lỗi đường truyền. Mã lệnh / câu của bộ cũ:
 * dựng theo đúng nơi chạy (VPS / Desktop "Failed to get account…" không có trên Fly: Fly là runtime chưa sẵn sàng).
 */
function renderError(E, entry, rt, operation) {
  const code = entry.code
  const message = (entry.message || 'Lỗi Zalo').replace(/#/g, '502')
  if (NUMERIC.test(code)) return E.zaloPortErrorFrom(Object.assign(new Error(message), { code: Number(code) }), { operation, answered: true })
  if (ERRNO.test(code)) {
    const err = Object.assign(new Error(message), { code, syscall: code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' ? 'connect' : undefined })
    return rt === 'fly' ? E.zaloPortErrorFrom(err, { operation, answered: false }) : desktopError(E, err, operation, false)
  }
  if (code === 'campaign_media_timeout') return E.mediaFenceError(Object.assign(new Error(message), { code }))
  if (code === 'zalo_command_failed') return E.zaloPortErrorFrom(new Error(message), { operation, answered: rt === 'fly' })
  if (rt === 'fly' && /^Failed to get account|phiên Zalo Web/.test(message)) {
    return flyCommandError(E, 'campaign_runtime_unavailable', 'Zalo runtime chưa sẵn sàng', operation)
  }
  if (/^Failed to get account|phiên Zalo Web/.test(message)) return desktopError(E, new Error(message), operation, false)
  // Câu Zalo không mã (zca-js ZaloApiError không mã, runtime Fly bản cũ): Zalo đã trả lời.
  return rt === 'fly' ? E.zaloPortErrorFrom(new Error(message), { operation, answered: true }) : desktopError(E, new Error(message), operation, true)
}

/** Lỗi hạ tầng tiêm thêm (không có trong dữ liệu 11–12/11 vì bộ mới chưa chạy rộng): theo nơi chạy. */
const FLY_INJECT = [
  { w: 3, code: 'campaign_runtime_unavailable', message: 'Zalo runtime gửi tin chưa online' },
  { w: 2, code: 'command_result_unknown', message: 'Chat Core không trả kết quả lệnh' },
  { w: 2, code: 'zalo_command_timeout', message: 'Zalo runtime không trả kết quả lệnh đúng hạn' },
  { w: 1, code: 'command_dispatch_failed', message: 'Không gửi được lệnh tới runtime' },
  { w: 1, code: 'runtime_label_session_reset', message: 'Phiên tag Zalo đã bị xoá' },
  { w: 1, code: 'runtime_payload_invalid', message: 'Tham số lệnh không hợp lệ' }
]
const DESKTOP_INJECT = [
  { w: 3, message: 'Chưa có session Zalo' },
  { w: 3, message: 'Failed to get account Zalo session: TypeError: fetch failed' },
  { w: 2, code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 1.2.3.4:443' },
  { w: 2, code: 'ECONNRESET', message: 'socket hang up' },
  { w: 1, message: 'Request failed with status code 502' },
  { w: 1, message: 'Request failed with status code 429' },
  { w: 1, message: 'Failed to parse response data' }
]

// ---------------------------------------------------------------------------------------------------------------------------
// Dữ liệu giả
// ---------------------------------------------------------------------------------------------------------------------------

const GIVEN = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Hùng', 'Khánh', 'Lan', 'Minh', 'Ngọc', 'Phúc', 'Quân', 'Sơn', 'Thảo', 'Trang', 'Tuấn', 'Vy']
const FAMILY = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ']
const fakeName = r => `${FAMILY[Math.floor(r() * FAMILY.length)]} ${GIVEN[Math.floor(r() * GIVEN.length)]}`
const fakeUid = r => String(7000000000000000000n + BigInt(Math.floor(r() * 1e15)) * 1000n + BigInt(Math.floor(r() * 1000)))

/** Data của một chiến dịch theo loại; có xen data lỗi (thiếu SĐT, SĐT sai, trùng, tên dài, thiếu cột mẫu) để đi các nhánh. */
function buildTargets(sample, count, r) {
  const a = sample.actionId
  const rows = []
  for (let i = 0; i < count; i++) {
    const name = fakeName(r) + (i % 23 === 7 ? ' ' + 'rất dài '.repeat(9).trim() : '')
    const phone = '09' + String(10000000 + Math.floor(r() * 89999999))
    const row = { name, phone: null, uid: null, info1: i % 9 === 4 ? null : `Mã ${i}`, info2: i % 11 === 5 ? null : 'Quận 1', info3: null }
    if (a === 'zalo_message_phone') {
      row.phone = i % 31 === 3 ? '' : i % 37 === 5 ? 'abc-xyz' : phone
    } else if (a === 'zalo_message_group') {
      row.uid = String(5000000000000000000n + BigInt(Math.floor(r() * 1e15)))
      row.name = `Nhóm ${i + 1}`
    } else if (a === 'zalo_join_group_link') {
      row.uid = i % 13 === 2 ? 'not-a-link' : `https://zalo.me/g/${crypto.randomBytes(5).toString('hex')}`
    } else if (a === 'zalo_add_group_member') {
      if (i % 3 === 0) row.phone = phone
      else row.uid = i % 29 === 1 ? '' : fakeUid(r)
    } else {
      row.uid = i % 29 === 1 ? '' : fakeUid(r)
      if (i % 4 === 0) row.phone = phone
    }
    rows.push(row)
  }
  // Một data trùng hệt data trước (chống gửi lặp / khoá mục tiêu).
  if (rows.length > 3) rows.push({ ...rows[1] })
  return rows
}

/** Ảnh chụp danh sách Zalo giả cho lấy data đầu lượt (bạn bè, sinh nhật, đề xuất, lời mời đã gửi). */
function friendUniverse(sample, r, size) {
  const ddmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' }).format(new Date())
  return Array.from({ length: size }, (_, i) => ({
    uid: fakeUid(r), name: fakeName(r), phone: i % 3 === 0 ? '09' + String(10000000 + Math.floor(r() * 89999999)) : '',
    sdob: i % 3 === 1 ? ddmm : '01/01', sentAt: Date.now() - (i + 1) * 86400000, tagged: i % 2 === 0
  }))
}

/** Cấu hình loại trừ giả: điều kiện của đủ năm nguồn (bạn bè, tag Zalo, hồ sơ, tag akaBiz, số ngày từ lần gửi). */
const EXCLUSION_CATALOG = {
  fields: [
    { id: 1, code: 'friend_status', name: 'Trạng thái bạn bè', dataType: 'enum', sourceKey: 'zalo_friendship', sourceConfig: { path: ['status'] },
      optionsSource: 'friend_status', optionsConfig: {}, isActive: true, sortOrder: 1 },
    { id: 2, code: 'zalo_labels', name: 'Tag Zalo', dataType: 'set', sourceKey: 'zalo_labels', sourceConfig: { path: ['ids'] },
      optionsSource: 'zalo_labels', optionsConfig: {}, isActive: true, sortOrder: 2 },
    { id: 3, code: 'gender', name: 'Giới tính', dataType: 'number', sourceKey: 'zalo_profile', sourceConfig: { path: ['gender'] },
      optionsSource: 'static', optionsConfig: {}, isActive: true, sortOrder: 3 },
    { id: 4, code: 'akabiz_tags', name: 'Tag akaBiz', dataType: 'set', sourceKey: 'akabiz_contact', sourceConfig: { path: ['ids'] },
      optionsSource: 'akabiz_tags', optionsConfig: {}, isActive: true, sortOrder: 4 },
    { id: 5, code: 'days_since_delivery', name: 'Số ngày từ lần gửi gần nhất', dataType: 'number', sourceKey: 'campaign_delivery',
      sourceConfig: { path: ['daysSince'] }, optionsSource: 'none', optionsConfig: {}, isActive: true, sortOrder: 5 }
  ],
  operators: [
    { id: 1, code: 'equals', name: 'là', evaluatorKey: 'equals', isActive: true, sortOrder: 1 },
    { id: 2, code: 'contains_any', name: 'có một trong', evaluatorKey: 'contains_any', isActive: true, sortOrder: 2 },
    { id: 3, code: 'lt', name: 'nhỏ hơn', evaluatorKey: 'lt', isActive: true, sortOrder: 3 }
  ],
  fieldOperators: [
    { fieldId: 1, operatorId: 1, valueType: 'enum', minValues: 1, maxValues: 1, validationConfig: {} },
    { fieldId: 2, operatorId: 2, valueType: 'enum', minValues: 1, maxValues: 10, validationConfig: {} },
    { fieldId: 3, operatorId: 1, valueType: 'number', minValues: 1, maxValues: 1, validationConfig: { integer: true } },
    { fieldId: 4, operatorId: 2, valueType: 'enum', minValues: 1, maxValues: 10, validationConfig: {} },
    { fieldId: 5, operatorId: 3, valueType: 'number', minValues: 1, maxValues: 1, validationConfig: { min: 1, integer: true } }
  ],
  options: [{ fieldId: 3, code: 'male', label: 'Nam', value: 0, isActive: true, sortOrder: 1 }, { fieldId: 3, code: 'female', label: 'Nữ', value: 1, isActive: true, sortOrder: 2 }]
}
function exclusionGroup(sample, accountId, r) {
  const variants = [
    [{ fieldId: 1, operatorId: 1, value: 'friend', isEnabled: true, sortOrder: 1 }],
    [{ fieldId: 2, operatorId: 2, value: ['11', '12'], isEnabled: true, sortOrder: 1 }],
    [{ fieldId: 4, operatorId: 2, value: [7, 8], isEnabled: true, sortOrder: 1 }, { fieldId: 5, operatorId: 3, value: 3, isEnabled: true, sortOrder: 2 }],
    [{ fieldId: 3, operatorId: 1, value: 1, isEnabled: true, sortOrder: 1 }, { fieldId: 1, operatorId: 1, value: 'request_sent', isEnabled: true, sortOrder: 2 }]
  ]
  return { id: 70000 + sample.sampleId, accountId, name: `Nhóm loại trừ ${sample.sampleId}`, matchMode: sample.sampleId % 2 ? 'or' : 'and', revision: 1,
    rules: variants[sample.sampleId % variants.length] }
}

/** Cấu hình chiến dịch (đã che) → cấu hình chạy trên tài khoản giả: chuyển các khoá "theo tài khoản" sang id tài khoản mới. */
function rekeyExtra(extra, accountId) {
  const out = JSON.parse(JSON.stringify(extra || {}))
  for (const key of ['zaloSendExclusionsByAccountId', 'zaloTagSettingsByAccountId']) {
    const map = object(out[key])
    const first = Object.values(map)[0]
    if (first !== undefined) out[key] = { [String(accountId)]: first }
  }
  // Mã nhóm loại trừ / danh sách loại trừ đã bị che: dùng id giả của thế giới này (cổng giả đọc theo id này).
  const sel = object(out.zaloSendExclusionsByAccountId)[String(accountId)]
  if (sel) {
    sel.groupId = sel.groupId ? 70000 : null
    sel.blocklistIds = (Array.isArray(sel.blocklistIds) ? sel.blocklistIds : []).map((_, i) => 80001 + i)
  }
  return out
}

module.exports = {
  mulberry32, hash32, unitRandom, weighted, object, NUMERIC,
  buildModel, modelFor, renderError, flyCommandError, desktopError, FLY_INJECT, DESKTOP_INJECT,
  buildTargets, friendUniverse, fakeName, fakeUid, EXCLUSION_CATALOG, exclusionGroup, rekeyExtra
}
