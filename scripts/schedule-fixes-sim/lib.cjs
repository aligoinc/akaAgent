// Bộ giả lập ba lỗi hẹn giờ (24/11/2026): sinh ca, luật kiểm độc lập (oracle), chạy hàm thật của Desktop / App Server.
// Dùng chung cho run.cjs (Desktop + engine v2 trên Postgres cục bộ) và bài kiểm opt-in của ChatApi.
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const transpile = (code, module = true) => ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, ...(module ? { module: ts.ModuleKind.CommonJS } : {}) }
}).outputText
function loadTs(rel) {
  const module = { exports: {} }
  new Function('module', 'exports', 'require', transpile(read(rel)))(module, module.exports, require)
  return module.exports
}
const pass = loadTs('src/shared/campaignRecurringPass.ts')
const postBump = loadTs('src/shared/postBumpContent.ts')

// ------------------------------------------------------------------------------------------------ ngẫu nhiên có hạt giống
function rng(seed) {
  let s = (Math.floor(seed) >>> 0) || 1
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1))
  next.pick = list => list[Math.floor(next() * list.length)]
  next.chance = p => next() < p
  next.shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }
  return next
}

// ------------------------------------------------------------------------------------------------ giờ Việt Nam (viết lại độc lập)
const H7 = 7 * 3600e3
const DAY = 86400e3
const vnKey = ms => new Date(ms + H7).toISOString().slice(0, 10)
const vnDayStart = key => Date.parse(`${key}T00:00:00Z`) - H7
const vnTimeOfDayMs = ms => ((ms + H7) % DAY + DAY) % DAY
const vnWeekday = ms => { const d = new Date(ms + H7).getUTCDay(); return d === 0 ? 8 : d + 1 } // thứ 2 = 2 … chủ nhật = 8
const vnMonthDay = ms => new Date(ms + H7).getUTCDate()
const iso = ms => (ms == null ? null : new Date(ms).toISOString())

// ------------------------------------------------------------------------------------------------ luật kiểm (spec, không chép code)
/**
 * Danh sách ngày khách nhập: tách theo dấu phẩy; mỗi phần sau khi bỏ khoảng trắng phải là số thập phân viết thường
 * (có thể có dấu + ở đầu, số 0 ở đầu, phần thập phân toàn số 0, hoặc dạng 1e1), giá trị nguyên trong khoảng. Phần khác bỏ qua.
 */
function specDays(raw, min, max) {
  const out = new Set()
  for (const token of String(raw ?? '').split(',')) {
    const t = token.trim()
    if (!/^\+?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) continue
    const n = Number(t)
    if (Number.isInteger(n) && n >= min && n <= max) out.add(n)
  }
  return out
}
/** Ngày chạy kế từ ngày `fromKey` (gồm cả ngày đó) trong `span` ngày, giờ = giờ của lịch gốc (bỏ phần nghìn giây). */
function specNextRun(c, fromDayStartMs, span) {
  const type = c.schedule_type || 'daily'
  const src = c.original_schedule ?? c.schedule
  if (c.schedule == null || src == null) return null
  const srcMs = Date.parse(src)
  if (!Number.isFinite(srcMs)) return null
  const tod = Math.floor(vnTimeOfDayMs(srcMs) / 1000) * 1000
  if (type === 'daily') return fromDayStartMs + tod
  const days = type === 'weekly' ? specDays(c.schedule_week_days, 2, 8) : type === 'monthly' ? specDays(c.schedule_days, 1, 31) : null
  if (!days || days.size === 0) return null
  for (let i = 0; i < span; i++) {
    const day = fromDayStartMs + i * DAY
    const v = type === 'weekly' ? vnWeekday(day + 12 * 3600e3) : vnMonthDay(day + 12 * 3600e3)
    if (days.has(v)) return day + tod
  }
  return null
}
const SPECIAL_CLEAR = new Set(['zalo_message_friend_recommendation', 'zalo_cancel_sent_friend_request', 'zalo_message_birthday'])
const isPostBumpRow = c => c.action_id === 'facebook_comment_seeding_post' && String(c.name || '').startsWith(postBump.POST_BUMP_TARGET_NAME_PREFIX)
const live = inputs => inputs.filter(i => !i.is_delete)
const hasStop = c => String(c.daily_stop_time ?? '').trim() !== ''

const NOTES = {
  invalid: 'Lịch chạy không hợp lệ. Vui lòng kiểm tra lại ngày chạy trong tuần/tháng.',
  drain: '23:59 là thời gian hệ thống dừng nhận lượt mới để cập nhật lịch ngày mới. Vui lòng chọn giờ chạy sớm hơn.',
  end: 'Chiến dịch đã hết ngày kết thúc',
  birthday: 'Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày',
  newsfeed: 'Chiến dịch lướt newsfeed không chạy tiếp qua ngày',
  singleDay: pass.SINGLE_DAY_STOP_CAMPAIGN_NOTE,
  singleDayInput: pass.SINGLE_DAY_STOP_INPUT_NOTE
}
function noteKind(note) {
  if (note == null) return 'none'
  for (const [k, v] of Object.entries(NOTES)) if (note === v) return k
  return 'other'
}

/**
 * Bảo trì đầu ngày (todayStart = T) cho chiến dịch đã đọc (lịch < T, trạng thái chờ xử lý / hoàn thành, không phải SMS).
 * Kết quả: { status, schedule, note, inputs: [{status, note}] }. Hàm kết thúc (finalize) giả: còn data chờ thì chiến dịch về
 * "chờ xử lý" (ghi chú xoá), không còn thì "hoàn thành" kèm ghi chú nếu đang "chờ xử lý".
 */
function oracleMaintenance(caseItem, T) {
  const c = { ...caseItem.c }
  const inputs = caseItem.inputs.map(i => ({ ...i }))
  const out = () => ({ status: c.status, schedule: c.schedule, note: c.note ?? null, inputs: inputs.map(i => ({ status: i.status, note: i.note ?? '' })), deleted: inputs.map(i => !!i.is_delete) })
  // Bảo trì chỉ đọc chiến dịch có lịch trước hôm nay, đang "chờ xử lý" / "hoàn thành".
  if (c.schedule == null || !(Date.parse(c.schedule) < T) || !['chờ xử lý', 'hoàn thành'].includes(c.status)) return out()
  const finalize = note => {
    if (live(inputs).some(i => i.status === 'chờ xử lý')) { if (c.status === 'chờ xử lý' || c.status === 'hoàn thành') { c.status = 'chờ xử lý'; c.note = null } return }
    if (c.status === 'chờ xử lý') { c.status = 'hoàn thành'; c.note = note }
  }
  const type = c.schedule_type || 'daily'
  if (type === 'daily' && c.status === 'hoàn thành' && (c.action_id === 'zalo_message_birthday' || c.action_id === 'facebook_newsfeed_interaction')) return out()
  const next = specNextRun(c, T, type === 'weekly' ? 14 : 370)
  if (next == null) { if (c.status === 'chờ xử lý') { c.status = 'tạm dừng'; c.note = NOTES.invalid } return out() }
  if (c.schedule_end_date != null && next > Date.parse(c.schedule_end_date)) { finalize(NOTES.end); c.schedule = iso(next); return out() }
  const drain = vnTimeOfDayMs(next) >= (23 * 60 + 59) * 60e3
  if (c.status === 'chờ xử lý' && drain) { c.status = 'tạm dừng'; c.note = NOTES.drain; return out() }
  if (type === 'daily') {
    if (c.action_id === 'zalo_message_birthday' || c.action_id === 'facebook_newsfeed_interaction') {
      finalize(c.action_id === 'zalo_message_birthday' ? NOTES.birthday : NOTES.newsfeed)
      if (c.status === 'chờ xử lý' && Date.parse(c.schedule) < T) c.schedule = iso(T)
      return out()
    }
    if (c.status !== 'chờ xử lý') return out()
    if (hasStop(c) && c.continue_next_day !== true && c.data_target_source_mode !== 'data_group') {
      if (!live(inputs).some(i => i.status === 'hoàn thành')) { c.schedule = iso(next); c.note = null; return out() }
      for (const i of inputs) if (!i.is_delete && i.status === 'chờ xử lý') { i.status = 'hoàn thành'; i.note = NOTES.singleDayInput }
      c.status = 'hoàn thành'; c.note = NOTES.singleDay
      return out()
    }
    if (c.continue_next_day === true) { c.schedule = iso(next); c.note = null } else c.note = null
    return out()
  }
  if (SPECIAL_CLEAR.has(c.action_id)) {
    for (const i of inputs) i.is_delete = true
    c.status = 'chờ xử lý'; c.schedule = iso(next); c.note = null
    return out()
  }
  const l = live(inputs)
  const passDone = l.some(i => i.status === 'hoàn thành') && l.every(i => i.status === 'hoàn thành' || i.status === 'tạm dừng')
  if (c.refresh_data === true && !isPostBumpRow(c) && (passDone || l.length === 0)) {
    for (const i of inputs) if (!i.is_delete && i.status !== 'tạm dừng') { i.status = 'chờ xử lý'; i.note = '' }
    c.status = 'chờ xử lý'; c.schedule = iso(next); c.note = null
    return out()
  }
  c.schedule = iso(next); c.note = null
  return out()
}

const RERUN_ACTIONS_DESKTOP = new Set(['facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction'])
/**
 * Kết thúc lượt lúc `N` (chạy xong danh sách, không còn data chờ đến hạn) cho chiến dịch "đang chạy".
 * Trả { kind: 'completed' | 'rescheduled' | 'rerun', schedule, inputs: [status] }.
 */
function oracleCompletion(caseItem, N, { rerunActions = RERUN_ACTIONS_DESKTOP } = {}) {
  const c = caseItem.c
  const inputs = caseItem.inputs.map(i => ({ ...i }))
  const res = (kind, schedule = null) => ({ kind, schedule: iso(schedule), inputs: inputs.map(i => i.status) })
  if (c.schedule_end_date != null && N >= Date.parse(c.schedule_end_date)) return res('completed')
  const extra = c.extra_settings || {}
  if (rerunActions.has(c.action_id) && extra.findDataRerunEnabled === true) {
    const raw = extra.findDataRerunAfterHours
    const hours = Math.floor(Number(raw))
    if (Number.isFinite(hours) && hours >= 1 && hours <= 1000000) {
      const next = N + hours * 3600e3
      if (vnKey(next) !== vnKey(N)) return res('completed')
      const stop = hasStop(c) ? String(c.daily_stop_time).slice(0, 8).padEnd(8, ':00') : '23:59:00'
      const t = new Date(next + H7).toISOString().slice(11, 19)
      if (t >= stop.slice(0, 8)) return res('completed')
      if (c.action_id !== 'facebook_newsfeed_interaction') {
        if (!live(inputs).some(i => i.status !== 'tạm dừng')) return res('completed')
        for (const i of inputs) if (!i.is_delete && i.status !== 'tạm dừng') i.status = 'chờ xử lý'
      }
      return res('rerun', next)
    }
  }
  const type = c.schedule_type || 'daily'
  if ((type === 'weekly' || type === 'monthly') && c.refresh_data === true && !SPECIAL_CLEAR.has(c.action_id) && !isPostBumpRow(c)
    && c.data_target_source_mode !== 'data_group') {
    const next = specNextRun(c, vnDayStart(vnKey(N)) + DAY, type === 'weekly' ? 14 : 370)
    if (next != null && (c.schedule_end_date == null || next <= Date.parse(c.schedule_end_date))) {
      const l = live(inputs)
      const resettable = l.filter(i => i.status !== 'tạm dừng')
      if (resettable.length === 0) {
        // Không còn data chạy lại được: hoàn thành; riêng chiến dịch Facebook không có dòng data nào (trừ Page) thì hẹn lượt kế.
        if (l.length === 0 && c.action_id.startsWith('facebook_') && c.action_id !== 'facebook_page_post') return res('rescheduled', next)
        return res('completed')
      }
      for (const i of inputs) if (!i.is_delete && i.status !== 'tạm dừng') i.status = 'chờ xử lý'
      return res('rescheduled', next)
    }
  }
  return res('completed')
}

// ------------------------------------------------------------------------------------------------ sinh ca
const WEEK_GOOD = ['2,3,4,5,6,7,8', '2,3,4,5,6,7', '8,7,6,5,4,3,2', '2,4,6,8', '3,5,7', '4,5', '2', '8', '6,7,8,2', '3,4,5,6,7']
const WEEK_BAD = ['', null, ' ', '2,,3', ' 8 ', '2.0', '1,9', 'abc', '0,1', '9', '2,3,4,5,6,7,8,9', '+3', '03', '3.', '1e1', '0x3', '2 3', '2;3', 'Thứ 2', '7,7,7', '-2', '2.5', '١', '２', '1_2', 'Infinity', 'NaN', '8.000', '  4  ,  5']
const MONTH_GOOD = ['1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31', '5,10,19,25', '31', '30', '29,30,31',
  '05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30', '3,7,11,15,19,23,27,31', '1', '15', '28']
const MONTH_BAD = ['', null, '1-31', '1.2.3.4.5.6.7.8.9.10.11.12.13.14.15.16.17.18.19.20.21.22.23.24.25.26.27.28.29.30.31.', '16.17.18', '30.',
  'Thái Bình, Thanh Hóa', '0', '32', '1,2,,3', '12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30.', '1e1', '0x1f', '+5', '5.5', '-1', ' ', '31,31', '0031']
const ACTIONS = ['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group', 'zalo_message_group_member', 'zalo_add_group_member', 'zalo_join_group_link',
  'zalo_message_remarketing_customer', 'zalo_message_birthday', 'zalo_message_friend_recommendation', 'zalo_cancel_sent_friend_request',
  'facebook_group_post', 'facebook_timeline_post', 'facebook_comment_seeding', 'facebook_find_data_group', 'facebook_newsfeed_interaction', 'facebook_page_post',
  'facebook_comment_seeding_post', 'facebook_message_uid']
const STATUSES_GOOD = ['hoàn thành', 'chờ xử lý', 'tạm dừng']
const STATUSES_BAD = ['đang chạy', 'lỗi', 'Hoàn thành', 'hoàn thành ', '', 'xyz']
const STOPS = [null, '20:00:00', '19:00:00', '23:00:00', '23:59:00', '00:00:00', '08:00:00', '21:30:00', '12:00:00']

function randomTime(r) {
  return r.pick([
    () => r.int(0, 23) * 3600e3 + r.pick([0, 15, 30, 45]) * 60e3,
    () => r.int(0, 86399) * 1000 + r.int(0, 999),
    () => (23 * 60 + 59) * 60e3, () => (23 * 60 + 58) * 60e3 + 59e3, () => 0, () => 1000, () => 8 * 3600e3
  ])()
}
function randomInputs(r, bad) {
  const n = r.pick([0, 1, 2, 3, 5, 8])
  const pool = bad ? [...STATUSES_GOOD, ...STATUSES_BAD] : STATUSES_GOOD
  const mix = r.pick(['all_done', 'done_paused', 'all_paused', 'mixed', 'pending'])
  const rows = []
  for (let i = 0; i < n; i++) {
    let status
    if (mix === 'all_done') status = 'hoàn thành'
    else if (mix === 'done_paused') status = r.chance(0.7) ? 'hoàn thành' : 'tạm dừng'
    else if (mix === 'all_paused') status = 'tạm dừng'
    else if (mix === 'pending') status = r.chance(0.5) ? 'chờ xử lý' : 'hoàn thành'
    else status = r.pick(pool)
    rows.push({ status, is_delete: r.chance(bad ? 0.2 : 0.05), note: r.chance(0.3) ? 'ghi chú cũ' : '' })
  }
  return rows
}
/** Ca tổng hợp / sai lệch cho bảo trì đầu ngày T. */
function synthCase(r, T, idx, bad) {
  const type = bad && r.chance(0.04) ? r.pick(['Weekly', 'WEEKLY', '', 'yearly', ' weekly']) : r.pick(['daily', 'daily', 'weekly', 'weekly', 'monthly'])
  const tod = randomTime(r)
  const daysBack = r.pick([1, 1, 1, 2, 7, 40])
  const origDay = T - r.pick([daysBack, 3, 30, 400]) * DAY
  const schedule = T - daysBack * DAY + (r.chance(0.8) ? tod : randomTime(r))
  const c = {
    id: idx, action_id: r.pick(ACTIONS), name: 'C', status: r.pick(['chờ xử lý', 'chờ xử lý', 'hoàn thành']),
    schedule: iso(schedule), original_schedule: bad && r.chance(0.1) ? null : iso(origDay + tod),
    schedule_type: type,
    schedule_week_days: r.chance(bad ? 0.5 : 0.1) ? r.pick(WEEK_BAD) : r.pick(WEEK_GOOD),
    schedule_days: r.chance(bad ? 0.5 : 0.1) ? r.pick(MONTH_BAD) : r.pick(MONTH_GOOD),
    schedule_end_date: r.pick([null, null, null, iso(T + r.int(-3, 40) * DAY + randomTime(r)), iso(T - 1), iso(T + tod), iso(T + tod - 1), iso(T + DAY + tod)]),
    daily_stop_time: r.pick(STOPS), continue_next_day: r.chance(0.6), refresh_data: r.chance(0.7),
    data_target_source_mode: bad && r.chance(0.05) ? 'data_group' : 'direct', extra_settings: {}, note: r.chance(0.3) ? 'ghi chú cũ' : null
  }
  if (c.action_id === 'facebook_comment_seeding_post' && r.chance(0.5)) c.name = `${postBump.POST_BUMP_TARGET_NAME_PREFIX}A`
  return { key: `${bad ? 'bad' : 'syn'}-${idx}`, source: bad ? 'bad' : 'syn', c, inputs: randomInputs(r, bad) }
}
/** Chuyển dòng production (chỉ đọc) thành ca bảo trì đầu ngày T: giữ cài đặt, lịch = hôm qua cùng giờ. */
function prodCase(row, T, idx) {
  const src = row.original_schedule ?? row.schedule
  const tod = src ? vnTimeOfDayMs(Date.parse(src)) : 8 * 3600e3
  const c = {
    id: idx, action_id: row.action_id, name: row.is_post_bump ? `${postBump.POST_BUMP_TARGET_NAME_PREFIX}A` : 'C',
    status: row.status === 'hoàn thành' ? 'hoàn thành' : 'chờ xử lý', schedule: row.schedule == null ? null : iso(T - DAY + tod),
    original_schedule: row.original_schedule, schedule_type: row.schedule_type, schedule_week_days: row.schedule_week_days, schedule_days: row.schedule_days,
    schedule_end_date: row.schedule_end_date, daily_stop_time: row.daily_stop_time, continue_next_day: row.continue_next_day, refresh_data: row.refresh_data,
    data_target_source_mode: row.data_target_source_mode || 'direct', extra_settings: {}, note: null
  }
  return { key: `prod-${row.id}`, source: 'prod', c, inputs: (row.inputs || []).map(i => ({ status: i.status, is_delete: !!i.is_delete, note: '' })) }
}

// ------------------------------------------------------------------------------------------------ Desktop / App Server: hàm thật
function pickDeclarations(rel, names) {
  const source = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true)
  return names.map(name => {
    const node = source.statements.find(st =>
      (ts.isFunctionDeclaration(st) && st.name?.text === name) ||
      (ts.isVariableStatement(st) && st.declarationList.declarations.some(d => d.name.getText(source) === name)))
    assert.ok(node, `không thấy ${name} trong ${rel}`)
    return node.getText(source).replace(/^export\s+/, '')
  }).join('\n')
}
function loadSchedulerMethods(names, scope) {
  const rel = 'src/main/services/campaignScheduler.ts'
  const source = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
  const methods = names.map(name => {
    const m = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
    assert.ok(m, name)
    return m.getText(source)
  }).join('\n')
  return new Function(...Object.keys(scope), `${transpile(`class Harness { ${methods} }`, false)}; return Harness`)(...Object.values(scope))
}

/** Kho giả theo kiểu PostgREST cho đúng các câu bảo trì dùng. */
function fakeStore(campaignRows, inputRows) {
  const tables = { auto_campaigns: campaignRows, auto_campaign_input_data: inputRows }
  const apply = (rows, filters) => rows.filter(row => filters.every(([op, key, value]) => {
    if (key.includes('.')) return true
    const v = row[key]
    switch (op) {
      case 'eq': return v === value
      case 'neq': return v !== value
      case 'in': return value.includes(v)
      case 'lt': return v != null && Date.parse(v) < Date.parse(value)
      case 'gt': return v != null && v > value
      case 'not': return value.op === 'is' ? v !== null && v !== undefined : !String(value.list).slice(1, -1).split(',').includes(v)
      default: throw new Error(`kho giả chưa hỗ trợ ${op}`)
    }
  }))
  const client = () => ({
    from(table) {
      const st = { filters: [], patch: null, limit: Infinity }
      const exec = async () => {
        const rows = apply(tables[table], st.filters).sort((a, b) => a.id - b.id)
        if (st.patch) for (const row of rows) Object.assign(row, st.patch)
        return { data: rows.slice(0, st.limit).map(r => ({ ...r })), error: null }
      }
      const b = {
        select: () => b, update: patch => { st.patch = patch; return b },
        eq: (k, v) => { st.filters.push(['eq', k, v]); return b }, neq: (k, v) => { st.filters.push(['neq', k, v]); return b },
        in: (k, v) => { st.filters.push(['in', k, v]); return b }, lt: (k, v) => { st.filters.push(['lt', k, v]); return b },
        gt: (k, v) => { st.filters.push(['gt', k, v]); return b },
        not: (k, op, list) => { st.filters.push(['not', k, { op, list }]); return b },
        or: () => b, order: () => b, limit: n => { st.limit = n; return b },
        then: (res, rej) => exec().then(res, rej)
      }
      return b
    }
  })
  return { client, tables }
}
const mapCampaign = row => ({
  id: row.id, name: row.name, actionId: row.action_id, accountId: 9, status: row.status, schedule: row.schedule,
  originalSchedule: row.original_schedule ?? undefined, scheduleType: row.schedule_type || undefined, scheduleWeekDays: row.schedule_week_days ?? undefined,
  scheduleDays: row.schedule_days ?? undefined, scheduleEndDate: row.schedule_end_date ?? null, dailyStopTime: row.daily_stop_time ?? null,
  continueNextDay: row.continue_next_day, refreshData: row.refresh_data, note: row.note ?? null, extraSettings: row.extra_settings || {},
  dataTargetSourceMode: row.data_target_source_mode || 'direct', isDelete: false
})
const mapInput = row => ({ id: row.id, campaignId: row.campaign_id, status: row.status, isDelete: !!row.is_delete, note: row.note, schedule: row.schedule ?? null })

function loadDesktopRepository(store) {
  const REPO = 'src/main/data/repositories/campaignRepository.ts'
  const code = transpile(pickDeclarations(REPO, ['VIETNAM_TIME_ZONE', 'VIETNAM_UTC_OFFSET', 'vietnamDateTimeFormatter', 'vietnamWeekdayFormatter', 'pad2',
    'parseVietnamParts', 'makeVietnamDate', 'startOfVietnamDateKey', 'addVietnamDays', 'withVietnamTime', 'formatVietnamTimeForQuery',
    'isAtOrAfterDailyDrainTime', 'getVietnamWeekdayNumber', 'SCHEDULE_DAY_TOKEN', 'parseNumberList', 'resolveNextSchedule', 'isPastScheduleEnd',
    'resolveNextRecurringRun', 'maintainCampaignSchedules']), false)
  const campaignById = id => store.tables.auto_campaigns.find(r => r.id === id)
  const pendingOf = id => store.tables.auto_campaign_input_data.filter(r => r.campaign_id === id && !r.is_delete && r.status === 'chờ xử lý').length
  const finalize = async (id, note) => {
    const row = campaignById(id)
    if (pendingOf(id) > 0) { if (row.status === 'chờ xử lý' || row.status === 'hoàn thành') { row.status = 'chờ xử lý'; row.note = null } return { reason: 'pending_input_remaining' } }
    if (row.status === 'chờ xử lý') { row.status = 'hoàn thành'; row.note = note; return { reason: 'completed' } }
    return { reason: 'campaign_control_won' }
  }
  const updateCampaign = async (id, updates) => {
    const row = campaignById(id)
    const keys = { status: 'status', schedule: 'schedule', note: 'note', extraSettings: 'extra_settings' }
    for (const [k, v] of Object.entries(updates)) { assert.ok(keys[k], `updateCampaign khoá lạ ${k}`); row[keys[k]] = v }
    return mapCampaign(row)
  }
  const scope = {
    client: store.client, requireCurrentUser: () => ({ staffId: 1, organizationId: 1 }), mapCampaignFromDB: mapCampaign,
    MOBILE_MANAGED_SMS_ACTION_IDS: ['sms_send', 'voice_call'], updateCampaign,
    listCampaignInputData: async id => store.tables.auto_campaign_input_data.filter(r => r.campaign_id === id && !r.is_delete).map(mapInput),
    getCampaign: async id => mapCampaign(campaignById(id)),
    finalizeCampaign: finalize, finalizeDataGroupCampaign: async () => { throw new Error('nhóm data không thuộc phạm vi giả lập') },
    finalizeZaloServerMaintenanceCampaign: finalize,
    clearCampaignInputData: async id => { for (const r of store.tables.auto_campaign_input_data) if (r.campaign_id === id) r.is_delete = true },
    getEarliestPendingInputSchedule: async () => null,
    isPostBumpTargetCampaign: postBump.isPostBumpTargetCampaign, planPostBumpMaintenanceSchedule: postBump.planPostBumpMaintenanceSchedule,
    ZALO_MESSAGE_BIRTHDAY_ACTION_ID: 'zalo_message_birthday', NEWSFEED_INTERACTION_ACTION_ID: 'facebook_newsfeed_interaction',
    ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID: 'zalo_message_friend_recommendation', ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID: 'zalo_cancel_sent_friend_request',
    clearZaloFriendRecommendationMaterializedExtra: x => x, clearZaloCancelSentFriendRequestMaterializedExtra: x => x, clearZaloBirthdayMaterializedExtra: x => x,
    isRefreshablePassDone: pass.isRefreshablePassDone, isSingleDayStopCampaign: pass.isSingleDayStopCampaign,
    SINGLE_DAY_STOP_INPUT_NOTE: pass.SINGLE_DAY_STOP_INPUT_NOTE, SINGLE_DAY_STOP_CAMPAIGN_NOTE: pass.SINGLE_DAY_STOP_CAMPAIGN_NOTE
  }
  return new Function(...Object.keys(scope), `${code}; return { maintainCampaignSchedules, resolveNextRecurringRun }`)(...Object.values(scope))
}

/** Chạy bảo trì thật của Desktop cho mọi ca (mỗi ca một kho riêng). Trả kết quả theo key. */
async function desktopMaintenance(cases, T) {
  const out = {}
  for (const k of cases) {
    const campaign = { ...k.c, is_delete: false, staff_id: 1 }
    let n = 0
    const inputs = k.inputs.map(i => ({ id: ++n, campaign_id: campaign.id, status: i.status, is_delete: !!i.is_delete, note: i.note ?? '' }))
    const store = fakeStore([campaign], inputs)
    const repo = loadDesktopRepository(store)
    try {
      await repo.maintainCampaignSchedules(vnKey(T + 1))
      out[k.key] = { status: campaign.status, schedule: campaign.schedule, note: campaign.note ?? null, inputs: inputs.map(i => ({ status: i.status, note: i.note ?? '' })), deleted: inputs.map(i => i.is_delete) }
    } catch (error) {
      out[k.key] = { error: String(error && error.message || error) }
    }
  }
  return out
}

/** Chuỗi kết thúc lượt thật của bộ lập lịch Desktop (handleCampaignCompletion → … → rescheduleCompletedCampaignPass). */
async function desktopCompletion(cases, N) {
  const out = {}
  const Scheduler = loadSchedulerMethods(['handleCampaignCompletion', 'handleRerunAfterCompletion', 'handleRecurringRefreshAfterCompletion',
    'rescheduleCompletedCampaignPass', 'getFutureInputSchedule', 'normalizeFindDataRerunAfterHours', 'getVietnamDateTimeParts', 'getVietnamDateKey',
    'isSameVietnamDay', 'isAtOrAfterCampaignDispatchCutoff', 'isAfterDailyStopTime', 'parseDailyStopTime'], {
    isRecurringRefreshCampaign: pass.isRecurringRefreshCampaign, isPostBumpTargetCampaign: postBump.isPostBumpTargetCampaign,
    ZALO_MESSAGE_BIRTHDAY_ACTION_ID: 'zalo_message_birthday', ZALO_MESSAGE_FRIEND_RECOMMENDATION_ACTION_ID: 'zalo_message_friend_recommendation',
    ZALO_CANCEL_SENT_FRIEND_REQUEST_ACTION_ID: 'zalo_cancel_sent_friend_request', ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend',
    ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group', FIND_DATA_GROUP_ACTION_ID: 'facebook_find_data_group', FIND_DATA_SEARCH_ACTION_ID: 'facebook_find_data_search',
    COMMENT_SEEDING_FEED_ACTION_ID: 'facebook_comment_seeding', NEWSFEED_INTERACTION_ACTION_ID: 'facebook_newsfeed_interaction', PAGE_POST_ACTION_ID: 'facebook_page_post'
  })
  for (const k of cases) {
    const row = { ...k.c, status: 'đang chạy' }
    let n = 0
    const inputs = k.inputs.map(i => ({ id: ++n, campaign_id: row.id, status: i.status, is_delete: !!i.is_delete, note: i.note ?? '', schedule: null }))
    const store = fakeStore([row], inputs)
    const repo = loadDesktopRepository(store)
    const s = new Scheduler()
    s.runtimeTarget = 'desktop'
    s.claimedServerZaloCampaignIds = new Set(); s.claimedServerZaloAccountIds = new Set(); s.campaignRunBoundaries = new Map()
    let kind = null
    s.restoreFacebookPageIdentity = async () => {}
    s.getDatabaseBusinessNow = async () => new Date(N)
    s.handleZaloRealtimeGroupCompletion = async () => false
    s.handleMultiDailyTimeSlotAfterCompletion = async () => false
    s.handleZaloShareRepeatAfterCompletion = async () => false
    s.handleCampaignRepeatAfterCompletion = async () => false
    s.logCampaignProgress = async () => {}
    s.broadcastCampaignUpdate = () => {}
    s.formatVietnamDateTime = d => d.toISOString()
    s.transitionCampaignToCompleted = async () => {
      if (inputs.some(i => !i.is_delete && i.status === 'chờ xử lý')) { row.status = 'chờ xử lý'; kind = 'completed_pending'; return false }
      row.status = 'hoàn thành'; kind = 'completed'; return true
    }
    const update = async (id, u) => { Object.assign(row, u); return mapCampaign(row) }
    s.updateCampaignAndBroadcast = update; s.updateRunningCampaignAndBroadcast = update
    s.supabase = {
      listCampaignInputData: async () => inputs.filter(i => !i.is_delete).map(mapInput),
      resetCampaignInputDataForRerun: async () => { for (const i of inputs) if (!i.is_delete && i.status !== 'tạm dừng') { i.status = 'chờ xử lý'; i.note = '' } },
      resolveNextRecurringRun: (campaign, now) => repo.resolveNextRecurringRun(campaign, now),
      getCampaign: async () => mapCampaign(row)
    }
    try {
      await s.handleCampaignCompletion(mapCampaign(row))
      if (!kind) kind = row.status === 'chờ xử lý' ? 'rescheduled' : `status:${row.status}`
      out[k.key] = { kind, status: row.status, schedule: kind === 'rescheduled' ? row.schedule : null, inputs: inputs.map(i => i.status) }
    } catch (error) {
      out[k.key] = { error: String(error && error.message || error) }
    }
  }
  return out
}

module.exports = {
  root, rng, vnKey, vnDayStart, vnTimeOfDayMs, iso, DAY, H7, specDays, specNextRun, oracleMaintenance, oracleCompletion, noteKind, NOTES,
  synthCase, prodCase, desktopMaintenance, desktopCompletion, ACTIONS, RERUN_ACTIONS_DESKTOP, pass, postBump, isPostBumpRow, live, SPECIAL_CLEAR
}
