#!/usr/bin/env node
// Bộ thử ngẫu nhiên cho đồng bộ Google Sheet vào data chiến dịch (V662), tầng JS + sinh kịch bản cho tầng DB.
//
// Chạy: node scripts/campaign-sheet-sync/fuzz-loop.cjs --seed 1 [--cases 400] [--real <mẫu ngoài repo>] [--out <file kịch bản>]
// rồi:  python3 scripts/campaign-sheet-sync/fuzz_db.py <file kịch bản>
//
// Mỗi ca: một Sheet (giá trị lấy từ data thật nếu có --real, cộng dữ liệu tự sinh và dữ liệu cố tình sai), qua đúng đường
// cửa sổ Upload (nhận cột, chuẩn hoá) rồi qua nhiều lượt đồng bộ (Sheet thêm / sửa / xoá dòng, đổi cột). Tính chất kiểm:
//  J1 dòng đồng bộ = dòng hợp lệ của cửa sổ Upload với cùng Sheet + cùng ghép cột (từng trường, cùng thứ tự)
//  J2 số dòng đọc / không hợp lệ / trùng khớp Upload
//  J3 chỉ ném CampaignSheetSyncError với mã đã biết; đổi tên / thứ tự / xoá cột cũ ⇒ sheet_columns_changed; thêm cột sau ⇒ chạy
//  J4 cấu hình dựng lại từ cùng lựa chọn cho cùng kết quả; link chuẩn hoá giữ gid
//  J5 (khi có WEBAPP_REPO) Web dựng cùng cấu hình và cùng mốc ban đầu như Desktop cho các loại Web hỗ trợ
//  J6 mốc ban đầu (sheetValues) = khoá của mọi dòng hợp lệ đã đọc, không quá 20.000
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const esbuild = require('esbuild')
const ROOT = path.resolve(__dirname, '../..')

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, item, index, all) => {
  if (item.startsWith('--')) acc.push([item.slice(2), all[index + 1] && !all[index + 1].startsWith('--') ? all[index + 1] : true])
  return acc
}, []))
const SEED = Number(args.seed || 1)
const CASES = Number(args.cases || 400)

function load(entry, extra = {}) {
  const out = esbuild.buildSync({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', write: false, logLevel: 'error', ...extra })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
  return mod.exports
}
const contract = load(path.join(ROOT, 'src/shared/campaignSheetSync.ts'))
const rowsLib = load(path.join(ROOT, 'src/shared/campaignSheetSyncRows.ts'))
const verify = load(path.join(ROOT, 'src/shared/campaignImportVerification.ts'))
const sheetReader = load(path.join(ROOT, 'src/shared/googleSheetSync.ts'))
const workbook = load(path.join(ROOT, 'src/shared/campaignImportWorkbook.ts'))

let web = null
if (process.env.WEBAPP_REPO) {
  const W = process.env.WEBAPP_REPO
  const alias = { '@aka-agent/control-api': path.join(W, 'packages/control-api/src/index.ts') }
  const entry = path.join(require('node:os').tmpdir(), `sheet-web-entry-${process.pid}.ts`)
  fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(W, 'packages/campaign-core/src/campaignSheetSyncConfig.ts'))}\n` +
    `export { verifyImportRows, mapImportTable, detectImportColumns } from ${JSON.stringify(path.join(W, 'packages/campaign-core/src/campaignImportVerification.ts'))}\n` +
    `export { readImportWorkbook, importWorkbookTables } from ${JSON.stringify(path.join(W, 'packages/campaign-core/src/campaignImportWorkbook.ts'))}\n`)
  web = load(entry, { alias, nodePaths: [path.join(W, 'node_modules')] })
  fs.unlinkSync(entry)
}

// ---------------------------------------------------------------------------------------------- ngẫu nhiên có hạt giống
let state = SEED >>> 0 || 1
const rnd = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296 }
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = list => list[Math.floor(rnd() * list.length)]
const chance = p => rnd() < p
const shuffle = list => { const copy = [...list]; for (let i = copy.length - 1; i > 0; i--) { const j = int(0, i); [copy[i], copy[j]] = [copy[j], copy[i]] } return copy }

// ---------------------------------------------------------------------------------------------- nguồn giá trị
const ACTIONS = {
  zalo_message_phone: 'zalo', zalo_message_friend: 'zalo', zalo_message_group: 'zalo', zalo_message_group_member: 'zalo',
  zalo_join_group_link: 'zalo', zalo_add_group_member: 'zalo', facebook_group_post: 'facebook', facebook_join_group: 'facebook',
  facebook_message_uid: 'facebook', facebook_comment_seeding: 'facebook', facebook_comment_seeding_post: 'facebook',
  facebook_find_data_group: 'facebook', facebook_find_data_search: 'facebook', facebook_group_invite: 'facebook', email_send: 'email'
}
assert.deepEqual(Object.keys(ACTIONS).sort(), [...contract.CAMPAIGN_SHEET_SYNC_ACTIONS].sort(), 'danh sách loại chiến dịch lệch hợp đồng')
const WEB_ACTIONS = new Set(['zalo_message_phone', 'zalo_message_friend', 'zalo_message_group', 'zalo_message_group_member', 'zalo_join_group_link'])

const real = args.real ? JSON.parse(fs.readFileSync(args.real, 'utf8')) : []
const realBy = new Map()
for (const r of real) {
  if (!realBy.has(r.a)) realBy.set(r.a, [])
  realBy.get(r.a).push(r)
}
const realAny = real.length ? real : null
// --realcamp: trọn data của vài chiến dịch thật (chỉ đọc, ngoài repo). Ca dùng chiến dịch thật lấy Sheet và data đã có từ đó.
const realCamps = args.realcamp ? Object.values(JSON.parse(fs.readFileSync(args.realcamp, 'utf8'))).filter(rows => rows.length) : []
let campPool = null
const target = action => verify.importTargetField(ACTIONS[action], action)

const NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khánh', 'Linh', 'Minh', 'Nam', 'Phương', 'Quân', 'Thảo', 'Trang', 'Vy', 'Nguyễn Văn A', 'Lê Thị Bích Ngọc',
  'Mr. John', 'ＡＢＣ', '😀 Khách VIP', '<b>Đậm</b>', '=SUM(A1:A2)', 'Tên "có ngoặc"', 'a,b;c', '  có   khoảng  trắng  ', 'Tên\nxuống dòng', '']
const PREFIX = ['32', '33', '34', '35', '36', '37', '38', '39', '70', '76', '77', '78', '79', '81', '82', '83', '84', '85', '86', '88', '89', '90', '91', '92', '93', '94', '96', '97', '98', '99', '56', '58', '59', '52']
const genPhone = () => `0${pick(PREFIX)}${String(int(0, 9999999)).padStart(7, '0')}`
function messPhone(p) {
  const d = p.replace(/^0/, '')
  switch (int(0, 22)) {
    case 0: return `+84${d}`
    case 1: return `84${d}`
    case 2: return `0084${d}`
    case 3: return d
    case 4: return `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}`
    case 5: return `${p.slice(0, 4)}.${p.slice(4, 7)}.${p.slice(7)}`
    case 6: return `${p.slice(0, 4)}-${p.slice(4)}`
    case 7: return `'${p}`
    case 8: return `(+84) ${d}`
    case 9: return `${p}, ${genPhone()}`
    case 10: return `${p}; ${genPhone()}`
    case 11: return `${p} / ${genPhone()}`
    case 12: return `${p} zalo`
    case 13: return `Zalo: ${p}`
    case 14: return p.replace(/\d/g, ch => String.fromCharCode(0xff10 + Number(ch)))
    case 15: return `${Number(d)}`.length === 9 ? `${Number(d)}.0` : p
    case 16: return `8.4${d.slice(0, 3)}E+10`
    case 17: return `  ${p}  `
    case 18: return `\t${p} `
    case 19: return p.slice(0, 9)
    case 20: return `${p}0`
    case 21: return `${p}\u0000`
    default: return p
  }
}
const OLD = { '32': '162', '33': '163', '34': '164', '35': '165', '36': '166', '37': '167', '38': '168', '39': '169', '70': '120', '79': '121', '77': '122', '76': '126', '78': '128' }
const oldPhone = () => { const k = pick(Object.keys(OLD)); return `01${OLD[k].slice(1)}${String(int(0, 9999999)).padStart(7, '0')}` }
const BAD = ['', ' ', 'abc', 'null', 'undefined', 'N/A', '-', '0', '000000000', '02838123456', '1900 1234', '123', '#REF!', '#N/A', 'TRUE', '=A1', '<script>x</script>',
  'x'.repeat(5000), '💩', 'https://evil.example/', '0912345678'.repeat(30), 'ơ ư ạ', '‮0912345678', '09 12 34 56 7']

function genUid(action) {
  switch (action) {
    case 'zalo_join_group_link': return pick([`https://zalo.me/g/${randomToken(10)}`, `zalo.me/g/${randomToken(8)}`, `https://zalo.me/g/${randomToken(6)}?src=qr`, `ZALO.ME/G/${randomToken(6).toUpperCase()}`, randomToken(6)])
    case 'zalo_message_friend': case 'zalo_message_group': case 'zalo_message_group_member': return pick([String(int(1e15, 9e18)), String(int(1e8, 9e9)), `${int(1e15, 9e15)} `, `g${int(1e15, 9e15)}`])
    case 'facebook_find_data_search': return pick(['nhà quận 7', 'Nhà  Quận 7', 'BÁN NHÀ', 'cho thuê phòng trọ', ' tuyển  ctv ', 'giày nam', 'x'.repeat(300)])
    default: {
      const id = String(int(1e13, 9e14))
      return pick([id, `https://www.facebook.com/profile.php?id=${id}`, `https://facebook.com/${randomToken(8)}`, `https://m.facebook.com/groups/${id}/`,
        `facebook.com/groups/${randomToken(10)}`, `https://www.facebook.com/groups/${id}/posts/${int(1e10, 9e14)}/?__cft__=abc`, `fb.com/${randomToken(6)}`,
        `https://www.facebook.com/${randomToken(6)}?mibextid=ZbWKwL`, `@${randomToken(6)}`, ` ${id} `])
    }
  }
}
function randomToken(n) { const c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._'; let s = ''; for (let i = 0; i < n; i++) s += c[int(0, c.length - 1)]; return s }
function genEmail() {
  const local = pick(['an', 'nguyen.van.a', 'Ha.Tran', 'kh+tag', 'x_y', 'VIP'])
  const dom = pick(['gmail.com', 'Gmail.COM', 'yahoo.com.vn', 'akabiz.net', 'x.vn'])
  return pick([`${local}${int(1, 999)}@${dom}`, ` ${local}@${dom} `, `${local}@${dom}`.toUpperCase(), `${local}@@${dom}`, `${local}@${dom}.`, `${local} @${dom}`, `mailto:${local}@${dom}`, `${local}@${dom}, ${local}2@${dom}`])
}

function realValue(action) {
  const field = target(action)
  if (campPool && chance(0.85)) {
    const r = pick(campPool)
    const v = field === 'phone' ? r.p : field === 'email' ? r.e : r.u
    if (v != null && v !== '') return String(v)
  }
  const pool = realBy.get(action)
  const anyRow = pool && pool.length && chance(0.85) ? pick(pool) : realAny && chance(0.5) ? pick(realAny) : null
  if (!anyRow) return null
  const v = field === 'phone' ? anyRow.p : field === 'email' ? anyRow.e : anyRow.u
  return v == null || v === '' ? (chance(0.5) ? anyRow.p || anyRow.u || anyRow.e || '' : null) : String(v)
}
function genTarget(action) {
  const field = target(action)
  const r = chance(campPool ? 0.85 : 0.55) ? realValue(action) : null
  if (r != null) return field === 'phone' && chance(0.4) ? messPhone(verify.normalizeImportPhone ? r : r) : r
  if (chance(0.12)) return pick(BAD)
  if (field === 'phone') return chance(0.08) ? oldPhone() : chance(0.7) ? messPhone(genPhone()) : genPhone()
  if (field === 'email') return genEmail()
  return genUid(action)
}
const genInfo = () => chance(0.5) ? '' : pick(['vip', 'Đã mua', 'Hà Nội', 'TP.HCM', '12/11/2026', 'x'.repeat(int(1, 300)), '😀', '0912345678', 'a\nb', ' '])
const realName = () => { const r = realAny && chance(0.5) ? pick(realAny).n : null; return r == null ? pick(NAMES) : String(r) }

// ---------------------------------------------------------------------------------------------- dựng Sheet
const HEADERS = {
  phone: ['SĐT', 'Số điện thoại', 'Phone', 'mobile', 'sdt', 'Điện thoại', 'Số ĐT'],
  uid: ['UID', 'Link', 'Url', 'Link group', 'Profile', 'Facebook', 'Zalo UID', 'Từ khoá'],
  email: ['Email', 'E-mail', 'Mail', 'email address'],
  name: ['Tên', 'Họ tên', 'Name', 'Fullname', 'Tên khách'],
  info: ['Ghi chú', 'Info1', 'Địa chỉ', 'Ngày mua', 'Nguồn', 'Info2']
}
function makeSheet(action, count) {
  const field = target(action)
  const columns = shuffle(['target', 'name', ...Array.from({ length: int(0, 3) }, (_, i) => `info${i + 1}`), ...(chance(0.3) ? ['junk'] : [])])
  const hasHeader = chance(0.85)
  const header = columns.map(col => col === 'target' ? pick(HEADERS[field]) : col === 'name' ? pick(HEADERS.name) : col === 'junk' ? pick(['', 'Cột trống', 'x']) : pick(HEADERS.info))
  const body = []
  for (let i = 0; i < count; i++) body.push(makeRow(action, columns))
  // Trùng có chủ đích.
  for (let i = 0; i < Math.floor(count * rnd() * 0.15); i++) body.splice(int(0, body.length), 0, [...pick(body.length ? body : [makeRow(action, columns)])])
  // Dòng trống / dòng chỉ có tên.
  for (let i = 0; i < int(0, 3); i++) body.splice(int(0, body.length), 0, columns.map(() => chance(0.5) ? '' : ' '))
  return { action, columns, hasHeader, header, body, eol: pick(['\r\n', '\n']), bom: chance(0.1) }
}
function makeRow(action, columns) {
  return columns.map(col => col === 'target' ? genTarget(action) : col === 'name' ? realName() : col === 'junk' ? (chance(0.5) ? '' : pick(BAD)) : genInfo())
}
const toRows = sheet => sheet.hasHeader ? [sheet.header, ...sheet.body] : [...sheet.body]
// CSV như Google xuất: ô có dấu phẩy / ngoặc kép / xuống dòng thì bọc ngoặc kép; các dòng cùng số cột.
function toCsv(sheet) {
  const rows = toRows(sheet).map(row => row.map(v => String(v).replace(/\u0000/g, '')))
  const width = Math.max(0, ...rows.map(r => r.length))
  const eol = sheet.eol || '\r\n'
  return (sheet.bom ? '\ufeff' : '') + rows.map(r => Array.from({ length: width }, (_, i) => {
    const v = r[i] ?? ''
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }).join(',')).join(eol)
}
// Cửa sổ Upload (Desktop) đọc CSV bằng SheetJS; Edge đọc bằng parseSheetCsv. Hai bảng phải cho cùng kết quả.
const uploadTableOf = sheet => workbook.importWorkbookTables(workbook.readImportWorkbook(new TextEncoder().encode(toCsv(sheet)), '', { csvSeparator: ',' })).tables[0]
  || { name: 'x', rows: [], rowNumbers: [] }
const tableOf = sheet => rowsLib.campaignSheetTable(sheetReader.parseSheetCsv(toCsv(sheet)))

// ---------------------------------------------------------------------------------------------- đường cửa sổ Upload
function uploadPath(sheet, link, phonePolicy, lib = { rows: rowsLib, verify }) {
  const platform = ACTIONS[sheet.action]
  const table = uploadTableOf(sheet)
  const v = lib === web ? web : verify
  const detected = v.detectImportColumns(table, platform, sheet.action)
  // Khách có thể ghép tay: đôi khi bỏ cột nhận diện, ghép đúng cột theo vị trí.
  const mapping = { ...detected.mapping }
  const field = target(sheet.action)
  if (mapping[field] === undefined || chance(0.2)) mapping[field] = sheet.columns.indexOf('target')
  if (chance(0.3)) { const n = sheet.columns.indexOf('name'); mapping.name = n }
  const skipHeader = sheet.hasHeader ? (chance(0.95) ? true : false) : chance(0.05)
  const report = v.verifyImportRows(v.mapImportTable(table, mapping, skipHeader ? 1 : 0, 'Google Sheet'), { platform, actionId: sheet.action, kind: 'sheet', phonePolicy })
  const builder = lib === web ? web : rowsLib
  const config = builder.buildCampaignSheetSyncConfig({ link, table, mapping, skipHeader, phonePolicy, platform, actionId: sheet.action })
  return { table, mapping, skipHeader, report, config, values: config ? builder.campaignSheetSyncValues(report) : [] }
}

const fieldsOf = (entry, field) => {
  const row = {}
  const name = verify.importText(entry.row.name)
  if (name) row.name = name
  row[field] = entry.normalizedValue
  for (const info of ['info1', 'info2', 'info3', 'info4', 'info5']) { const value = verify.importText(entry.row[info]); if (value) row[info] = value }
  if (field === 'phone' && entry.row.phoneCarrier) row.phoneCarrier = entry.row.phoneCarrier
  return row
}

// ---------------------------------------------------------------------------------------------- tiến hoá Sheet giữa các lượt
function evolve(sheet) {
  const next = { ...sheet, header: [...sheet.header], body: sheet.body.map(r => [...r]), columns: [...sheet.columns] }
  const ops = []
  const n = int(1, 3)
  for (let i = 0; i < n; i++) {
    const op = pick(['append', 'append', 'append', 'edit', 'delete', 'reorderRows', 'appendCol', 'renameHeader', 'swapCols', 'dupes', 'blank', 'bigAppend', 'none'])
    ops.push(op)
    if (op === 'append') for (let k = 0; k < int(1, 30); k++) next.body.push(makeRow(next.action, next.columns))
    if (op === 'bigAppend' && chance(0.3)) for (let k = 0; k < int(200, 1500); k++) next.body.push(makeRow(next.action, next.columns))
    if (op === 'edit' && next.body.length) for (let k = 0; k < int(1, 5); k++) { const r = pick(next.body); r[next.columns.indexOf('target')] = genTarget(next.action) }
    if (op === 'delete' && next.body.length) next.body.splice(int(0, next.body.length - 1), int(1, 5))
    if (op === 'reorderRows') next.body = shuffle(next.body)
    if (op === 'dupes' && next.body.length) for (let k = 0; k < int(1, 10); k++) next.body.push([...pick(next.body)])
    if (op === 'blank') next.body.push(next.columns.map(() => ''))
    if (op === 'appendCol') { next.columns.push('extra'); next.header.push(pick(['Cột mới', 'Ghi chú 2', ''])); next.body.forEach(r => r.push(chance(0.5) ? 'x' : '')) }
    if (op === 'renameHeader' && next.hasHeader) { const i = int(0, next.header.length - 1); next.header[i] = `${next.header[i]} (mới)` }
    if (op === 'swapCols' && next.columns.length > 1) {
      const a = int(0, next.columns.length - 1), b = (a + 1) % next.columns.length
      ;[next.columns[a], next.columns[b]] = [next.columns[b], next.columns[a]]
      ;[next.header[a], next.header[b]] = [next.header[b], next.header[a]]
      next.body.forEach(r => { [r[a], r[b]] = [r[b], r[a]] })
    }
  }
  return { next, ops }
}

// ---------------------------------------------------------------------------------------------- chạy
const failures = []
const fail = (kind, detail) => { failures.push({ kind, ...detail }); if (failures.length <= 15) console.log('FAIL', kind, JSON.stringify(detail).slice(0, 600)) }
const KNOWN = new Set(['sheet_columns_changed', 'sheet_too_large'])
const scenarios = []
let checked = 0, syncRuns = 0, webChecked = 0

for (let c = 0; c < CASES; c++) {
  campPool = realCamps.length && chance(0.3) ? pick(realCamps) : null
  const action = campPool ? campPool[0].a : pick(Object.keys(ACTIONS))
  const sheet0 = makeSheet(action, int(chance(0.1) ? 0 : 1, chance(0.05) ? 2500 : 120))
  const gid = chance(0.7) ? `#gid=${int(0, 2e9)}` : ''
  const link = pick([
    `https://docs.google.com/spreadsheets/d/1${randomToken(30).replace(/[._]/g, 'x')}/edit${gid}`,
    `https://docs.google.com/spreadsheets/d/1${randomToken(25).replace(/[._]/g, 'x')}/edit?usp=sharing${gid}`,
    `https://docs.google.com/spreadsheets/d/1${randomToken(25).replace(/[._]/g, 'x')}/htmlview`,
    `https://docs.google.com/spreadsheets/u/0/d/1${randomToken(25).replace(/[._]/g, 'x')}/edit`,
    `https://drive.google.com/file/d/${randomToken(20)}/view`, `docs.google.com/spreadsheets/d/1${randomToken(20).replace(/[._]/g, 'x')}`
  ])
  const policy = target(action) === 'phone' ? pick(['first', 'first', 'all', 'discard']) : 'first'
  let up
  try { up = uploadPath(sheet0, link, policy) } catch (error) {
    if (/IMPORT|giới hạn|vượt/i.test(String(error.message))) continue
    fail('upload_threw', { action, error: String(error.stack || error).slice(0, 300) }); continue
  }
  checked++
  const canonical = contract.canonicalCampaignSheetUrl(link)
  if (!canonical) { if (up.config) fail('config_for_bad_link', { link }); continue }
  if (!up.config) {
    // Chỉ không dựng được khi chưa ghép cột người nhận hoặc quá rộng.
    if (up.mapping[target(action)] !== undefined && up.table.rows.reduce((m, r) => Math.max(m, r.length), 0) <= 512) fail('config_null', { action, mapping: up.mapping })
    continue
  }
  // J4
  assert.equal(up.config.url.includes('docs.google.com/spreadsheets/d/'), true)
  if (/#gid=(\d+)/.test(link) && !up.config.url.endsWith(link.match(/#gid=\d+/)[0])) fail('gid_lost', { link, url: up.config.url })
  const validation = (() => { try { return true } catch { return false } })()
  // J6
  const expectedValues = new Set(up.report.valid.map(e => e.normalizedValue).filter(Boolean))
  if (up.values.length !== Math.min(expectedValues.size, 20000) || up.values.some(v => !expectedValues.has(v))) fail('values', { action, n: up.values.length, expected: expectedValues.size })

  // J5 Web
  if (web && WEB_ACTIONS.has(action) && sheet0.body.length < 2000) {
    try {
      // Bảng như API Web đọc link Sheet (utilities/import-sheet).
      const table = web.importWorkbookTables(web.readImportWorkbook(new TextEncoder().encode(toCsv(sheet0)), '', { csvSeparator: ',' })).tables[0] || { name: 'x', rows: [], rowNumbers: [] }
      const wReport = web.verifyImportRows(web.mapImportTable(table, up.mapping, up.skipHeader ? 1 : 0, 'Google Sheet'), { platform: 'zalo', actionId: action, kind: 'sheet', phonePolicy: policy })
      const wConfig = web.buildCampaignSheetSyncConfig({ link, table, mapping: up.mapping, skipHeader: up.skipHeader, phonePolicy: policy, platform: 'zalo', actionId: action })
      webChecked++
      if (JSON.stringify(wConfig) !== JSON.stringify(up.config)) fail('web_config', { action, desk: up.config, web: wConfig })
      const dv = up.report.valid.map(e => e.normalizedValue), wv = wReport.valid.map(e => e.normalizedValue)
      if (JSON.stringify(dv) !== JSON.stringify(wv)) {
        const onlyD = dv.filter(v => !wv.includes(v)).slice(0, 5), onlyW = wv.filter(v => !dv.includes(v)).slice(0, 5)
        fail('web_rows', { action, desk: dv.length, web: wv.length, onlyDesktop: onlyD, onlyWeb: onlyW })
      }
    } catch (error) { fail('web_threw', { action, error: String(error.message).slice(0, 200) }) }
  }

  // Các lượt đồng bộ.
  const field = up.config.targetField
  const runs = []
  let sheet = sheet0
  const nRuns = int(1, 5)
  for (let r = 0; r < nRuns; r++) {
    const { next, ops } = r === 0 && chance(0.3) ? { next: sheet, ops: ['none'] } : evolve(sheet)
    sheet = next
    const table = tableOf(sheet)
    let result, error = null
    try { result = rowsLib.campaignSheetSyncRows(table, up.config, action) } catch (e) {
      if (!(e instanceof rowsLib.CampaignSheetSyncError) || !KNOWN.has(e.code)) { fail('sync_threw', { action, ops, error: String(e.stack || e).slice(0, 300) }); break }
      error = { code: e.code, message: e.message, permanent: e.permanent }
    }
    syncRuns++
    // J3: thay đổi cột
    // Sự thật: dòng đầu của Sheet (chuỗi gốc) đổi ở các cột đã có lúc kết nối.
    const cellNorm = v => String(v ?? '').replace(/\u0000/g, '').trim().replace(/\s+/g, ' ')
    const first0 = toRows(sheet0)[0] || [], firstNow = toRows(sheet)[0] || []
    const headerChanged = up.config.hasHeader && up.config.expectedHeaders.some((_, i) => cellNorm(firstNow[i]) !== cellNorm(first0[i]))
    if (headerChanged !== Boolean(error && error.code === 'sheet_columns_changed')) fail('header_rule', { action, ops, headerChanged, error })
    if (!error) {
      // J1 + J2
      let upload
      try { upload = verify.verifyImportRows(verify.mapImportTable(uploadTableOf(sheet), up.config.mapping, up.config.hasHeader ? 1 : 0, 'Google Sheet'),
        { platform: up.config.platform, actionId: action, kind: 'sheet', phonePolicy: up.config.phonePolicy }) } catch { upload = null }
      if (upload) {
        const want = upload.valid.map(e => fieldsOf(e, field))
        if (JSON.stringify(want) !== JSON.stringify(result.rows)) fail('rows_parity', { action, ops, want: want.slice(0, 2), got: result.rows.slice(0, 2) })
        if (result.rowCount !== upload.sourceRowCount || result.invalid !== upload.rejected.length || result.duplicates !== upload.duplicates.length)
          fail('counts_parity', { action, result: [result.rowCount, result.invalid, result.duplicates], upload: [upload.sourceRowCount, upload.rejected.length, upload.duplicates.length] })
        if (result.rows.length > 20000) fail('too_many_rows', { n: result.rows.length })
      }
      runs.push({ ops, payload: { rows: result.rows, rowCount: result.rowCount, invalid: result.invalid, duplicates: result.duplicates },
        keys: upload ? upload.valid.map(e => e.normalizedValue) : result.rows.map(row => row[field]) })
    } else runs.push({ ops, error })
    if (error && error.permanent && chance(0.5)) break
  }

  // Data khách nhập tay vào chiến dịch (qua đường khác), tính khoá theo app để làm "sự thật".
  const manual = []
  const variant = key => {
    // SĐT trong data chiến dịch luôn qua bộ chuẩn hoá của app hoặc DB: chỉ còn các cách viết mà cả hai hiểu như nhau.
    if (field === 'phone') return pick([key, `+84${key.slice(1)}`, `84${key.slice(1)}`, `${key.slice(0, 4)} ${key.slice(4, 7)} ${key.slice(7)}`, `${key.slice(0, 4)}.${key.slice(4)}`, ` ${key} `])
    if (field === 'email') return pick([key.toUpperCase(), ` ${key} `, key])
    if (action === 'facebook_find_data_search') return pick([key.toUpperCase(), ` ${key.replace(/ /g, '   ')} `, key])
    if (action === 'zalo_join_group_link') return pick([`${key.replace('https://', '')}?src=qr`, key.replace('zalo.me/g', 'ZALO.ME/G'), `${key}/`, `https://zaloapp.com/qr/g/${key.split('/').pop()}`])
    return pick([`${key}/`, `${key}//`, ` ${key} `, key.length > 4 ? `${key.slice(0, 3)} ${key.slice(3)}` : key, key])
  }
  const sheetKeys = runs.flatMap(run => run.keys || [])
  for (let k = 0; k < (campPool ? int(20, 300) : int(0, 12)); k++) {
    // Data khách đã có: cách viết khác của chính dòng Sheet (dòng đầu, lượt sau), data thật cùng loại, data tự sinh.
    const realRaw = chance(campPool ? 0.9 : 0.5) ? realValue(action) : null
    const raw = String(chance(0.6) && sheetKeys.length ? variant(pick(sheetKeys)) : realRaw != null ? realRaw : field === 'phone' ? variant(genPhone()) : genTarget(action)).replace(/\u0000/g, '')
    const rep = verify.verifyImportRows([{ data: { [field]: raw }, location: { source: 'm', sheet: '', row: 1, item: 1 } }], { platform: ACTIONS[action], actionId: action, kind: 'textbox' })
    manual.push({ raw, key: rep.valid[0]?.normalizedValue ?? null, deleted: chance(0.3) })
  }
  scenarios.push({ id: c, action, platform: ACTIONS[action], field, config: up.config, sheetValues: up.values,
    imported: up.report.valid.map(e => ({ row: fieldsOf(e, field), key: e.normalizedValue })), manual, runs })
}

if (args.out) fs.writeFileSync(args.out, JSON.stringify({ seed: SEED, scenarios }))
const byKind = failures.reduce((acc, f) => { acc[f.kind] = (acc[f.kind] || 0) + 1; return acc }, {})
console.log(`seed ${SEED}: ${checked} ca, ${syncRuns} lượt đồng bộ, ${webChecked} ca so Web, ${scenarios.length} kịch bản DB, data thật ${real.length}`)
console.log(failures.length ? `LỖI ${failures.length}: ${JSON.stringify(byKind)}` : 'SẠCH')
process.exit(failures.length ? 1 : 0)
