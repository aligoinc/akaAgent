// Real import helpers and XLSX round trips; no network, database, or sends.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')
const cache = new Map()
function loadTs(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const module = { exports: {} }; cache.set(file, module.exports)
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { URL, TextDecoder, console })(id => id.startsWith('.')
    ? loadTs(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
const api = loadTs('src/shared/campaignImportVerification.ts')
const workbookApi = loadTs('src/shared/campaignImportWorkbook.ts')
const plain = value => JSON.parse(JSON.stringify(value))
let checks = 0
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`) }
const makeRow = (phone, index = 1, info = {}) => ({ data: { name: 'An', phone, info1: 'Căn 12', ...info }, location: { source: 'test.xlsx', sheet: 'Data', row: index, item: 1 } })
const verify = (rows, phonePolicy = 'first', kind = 'excel') => api.verifyImportRows(rows, { platform: 'zalo', actionId: 'zalo_message_phone', kind, phonePolicy })
const counts = result => ['valid', 'rejected', 'duplicates'].map(group => result[group].length)
const cases = [
  ['0912345678','0912345678'], ['912345678','0912345678'], ['+84912345678','0912345678'], ['84912345678','0912345678'],
  ['+84 912 345 678','0912345678'], ['84-912-345-678','0912345678'], ['0084912345678','0912345678'],
  ['840912345678','0912345678'], ['+84 (0) 912 345 678','0912345678'], ['084912345678','0912345678'],
  ["'0912345678",'0912345678'], ['0912.345.678','0912345678'], ['(091) 2345 678','0912345678'],
  ['0912 345 678 (zalo)','0912345678'], ['Anh Hùng 0912345678','0912345678'], ['0912\u200b345678','0912345678'],
  ['01662345678','0362345678'], ['1662345678','0362345678'], ['0868 123 456','0868123456'], ['0522123456','0522123456'],
  ['0912345678 / 0987654321',''], ['0912345678 - 0987654321',''], ['0912345678;0987654321',''],
  ['A.Nam - 2 - 0912345678',''], ['912345678.0','0912345678'], ['8.49123E+10',''], ['091234567',''],
  ['02838123456',''], ['+1 650 555 1234',''], ['1900 1234','']
]
for (const [input, expected] of cases) check(`phone ${input}`, () => assert.equal(api.normalizeImportPhone(input).value, expected))
check('notes cannot join unrelated numeric groups into a valid phone', () => {
  for (const value of ['Căn 09 tầng 12345678', '09 ghi chú 12345678', '09/12345678']) assert.equal(api.normalizeImportPhone(value).value, '')
})
for (const [input, expected] of [['0841234567','0841234567'], ['8.4912345678E+10','0912345678'], ['3.33875455E+8','0333875455'], ['9123456780E-1','0912345678'], [912345678.9,''], [Infinity,''], [Number.MAX_SAFE_INTEGER + 1,'']]) {
  check(`phone edge ${input}`, () => assert.equal(api.normalizeImportPhone(input).value, expected))
}
check('first valid, policy rejects, invalid and duplicate are disjoint', () => {
  const result = verify([makeRow('bad;0912345678;0987654321'), makeRow('+84912345678', 2), makeRow('0841234567', 3)])
  assert.deepEqual(counts(result), [2, 2, 1]); assert.equal(result.itemCount, 5); assert.equal(result.sourceRowCount, 3)
  assert.match(result.rejected[1].reason, /chỉ lấy số hợp lệ đầu tiên/)
  assert.equal(result.duplicates[0].duplicateOf.row, 1)
  assert.equal(new Set([...result.valid, ...result.rejected, ...result.duplicates].map(row => row.id)).size, 5)
})
check('first valid duplicate does not fall through to another recipient', () => {
  const result = verify([makeRow('0912345678'), makeRow('bad;0912345678;0987654321', 2)])
  assert.deepEqual(counts(result), [1, 2, 1]); assert.equal(result.valid[0].row.phone, '0912345678')
})
check('discard rejects every candidate without deduplication', () => assert.deepEqual(counts(verify([makeRow('bad;0912345678;0912345678')], 'discard')), [0, 3, 0]))
check('all copies metadata and deduplicates after normalization', () => {
  const result = verify([makeRow('bad;0912345678;+84912345678;0987654321')], 'all')
  assert.deepEqual(counts(result), [2, 1, 1]); assert(result.valid.every(row => row.row.name === 'An' && row.row.info1 === 'Căn 12'))
})
check('TXT always takes all and tracks original line/item', () => {
  const rows = api.textImportRows('0912345678,0987654321;bad\n+84912345678', 'zalo', 'zalo_message_phone', 'Text')
  const result = verify(rows, 'discard', 'textbox')
  assert.deepEqual(counts(result), [2, 1, 1]); assert.equal(result.sourceRowCount, 2)
  assert.equal(result.rejected[0].location.item, 3); assert.equal(result.duplicates[0].location.row, 2)
})
check('TXT recognizes only required-field headers and can retain the first line explicitly', () => {
  const text = 'SĐT\n0912345678;0987654321'
  const rows = api.textImportRows(text, 'zalo', 'zalo_message_phone', 'Text')
  assert.equal(rows.length, 2); assert.equal(rows[0].location.row, 2)
  assert.equal(verify(rows).rejected.length, 0)
  assert.equal(verify(api.textImportRows(text, 'zalo', 'zalo_message_phone', 'Text', false)).rejected.length, 1)
  assert.equal(api.hasImportTextHeader('Mã căn\n0912345678', 'zalo', 'zalo_message_phone'), false)
})
check('TXT source limit counts physical rows, not duplicate candidates on one row', () => {
  const rows = api.textImportRows(Array(10001).fill('0912345678').join(';'), 'zalo', 'zalo_message_phone', 'Text')
  const report = verify(rows, 'first', 'textbox')
  assert.equal(report.sourceRowCount, 1); assert.equal(report.itemCount, 10001)
  assert.deepEqual(counts(report), [1, 0, 10000]); assert.equal(report.limitExceeded, false)
})
const headers = ['Fullname','Uid','Mobile','Email','Info1','Info2','Info3','Info4','Info5']
const book = XLSX.utils.book_new()
const sheet = XLSX.utils.aoa_to_sheet([headers, [], ['An','',84912345678,'',46315,12.75,0.125,123,123456], ['Sai','','8.49123E+10']])
sheet.C3.z = '0.00000E+00'; sheet.E3.z = 'dd/mm/yyyy'; sheet.F3.z = '0.00'; sheet.G3.z = '0.0%'; sheet.H3.z = '000000'; sheet.I3.z = '0.00E+00'
XLSX.utils.book_append_sheet(book, sheet, 'First')
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Tên KH','Điện thoại','Mã căn'], ['Bình','0987654321','C12']]), 'Second')
const tables = workbookApi.importWorkbookTables(workbookApi.readImportWorkbook(XLSX.write(book, { type:'buffer', bookType:'xlsx' }), 'source.xlsx')).tables
check('raw phone survives scientific display, metadata retains formatting and row gaps', () => {
  const schema = api.templateImportSchema(tables[0])
  const result = verify(api.mapImportTable(tables[0], schema.mapping, schema.headerIndex + 1, 'source.xlsx'), 'first', 'akabizTemplate')
  assert.deepEqual(counts(result), [1, 1, 0]); assert.equal(result.valid[0].row.phone, '0912345678'); assert.equal(result.valid[0].location.row, 3)
  assert.deepEqual([1,2,3,4,5].map(i => result.valid[0].row[`info${i}`]), ['20/10/2026','12.75','12.5%','000123','1.23E+05'])
  assert.equal(result.valid[0].originalValue, '84912345678'); assert.equal(result.valid[0].displayValue, '8.49123E+10')
})
check('second sheet and clear aliases, no arbitrary Info guess', () => {
  const result = api.detectImportColumns(tables[1], 'zalo', 'zalo_message_phone')
  assert.equal(result.hasHeader, true); assert.deepEqual(plain(result.mapping), { name: 0, phone: 1 })
})
const tableOf = (matrix, name = 'Test') => ({ name, rows: matrix.map(row => row.map(value => ({ value, text: String(value) }))), rowNumbers: matrix.map((_, i) => i + 1) })
check('no header keeps first row; ambiguous target requires selection', () => {
  const source = tableOf([['0912345678'],['0987654321']])
  const detection = api.detectImportColumns(source, 'zalo', 'zalo_message_phone')
  assert.equal(detection.hasHeader, false); assert.equal(detection.mapping.phone, 0)
  assert.equal(verify(api.mapImportTable(source, detection.mapping, 0, 'data')).valid.length, 2)
  assert.equal(api.detectImportColumns(tableOf([['SĐT','Phone'],['0912345678','0987654321']]), 'zalo', 'zalo_message_phone').mapping.phone, undefined)
})
check('blank rows excluded, missing target retained as invalid', () => {
  const rows = api.mapImportTable(tableOf([['Tên','SĐT'],['',''],['An',''],['Bình','0912345678']]), { name: 0, phone: 1 }, 1, 'test')
  assert.equal(rows.length, 2); assert.deepEqual(counts(verify(rows)), [1, 1, 0]); assert.equal(verify(rows).rejected[0].location.row, 3)
})
check('CSV quoted commas are parsed as cells before phone splitting', () => {
  const source = workbookApi.importWorkbookTables(workbookApi.readImportWorkbook(Buffer.from('Tên,SĐT,Info1\n"An, Bình","0912345678;0987654321","Căn 12, tầng 3"'), 'test.csv')).tables[0]
  const result = verify(api.mapImportTable(source, { name: 0, phone: 1, info1: 2 }, 1, 'test.csv'), 'all')
  assert.equal(result.valid.length, 2); assert.equal(result.valid[0].row.name, 'An, Bình'); assert.equal(result.valid[1].row.info1, 'Căn 12, tầng 3')
})
check('TSV paste keeps name and numeric notes', () => {
  const source = workbookApi.importWorkbookTables(XLSX.read('Tên\tSĐT\tInfo1\nAn\t0912345678\tCăn 12', { type: 'string', raw: true, FS: '\t' })).tables[0]
  const result = api.detectImportColumns(source, 'zalo', 'zalo_message_phone')
  const report = verify(api.mapImportTable(source, result.mapping, 1, 'dán'), 'first', 'textbox')
  assert.equal(report.valid[0].row.name, 'An'); assert.equal(report.valid[0].row.info1, 'Căn 12')
})
check('UID string preserved, unsafe numeric rejected, email case dedup and keyword spaces kept', () => {
  const uid = '1234567890123456789'
  const rows = [uid, uid, Number(uid)].map((uid, i) => ({ ...makeRow('', i + 1), data: { uid } }))
  const report = api.verifyImportRows(rows, { platform: 'zalo', actionId:'zalo_message_group_member', kind:'excel' })
  assert.deepEqual(counts(report), [1,1,1]); assert.equal(report.valid[0].row.uid, uid)
  for (const group of ['valid', 'rejected', 'duplicates']) {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(api.importExportMatrix(report, group)), 'Data')
    const sheet = XLSX.read(XLSX.write(book, { type:'buffer', bookType:'xlsx' }), {type:'buffer'}).Sheets.Data
    assert.equal(sheet.B2.t, 's')
    if (group !== 'rejected') assert.equal(sheet.B2.v, uid)
  }
  const email = ['AN@example.com','an@example.com'].map((email, i) => ({ ...makeRow('', i + 1), data: { email } }))
  assert.deepEqual(counts(api.verifyImportRows(email, { platform:'email', actionId:'email_send', kind:'excel' })), [1,0,1])
  assert.equal(api.verifyImportRows([{ ...makeRow(''), data: { uid:'bất động sản' } }], { platform:'facebook', actionId:'facebook_find_data_search', kind:'excel' }).valid[0].row.uid, 'bất động sản')
})
check('all three Excel files retain text, reasons, lineage and valid template roundtrip', () => {
  const report = verify([makeRow('0912345678;0987654321'), makeRow('+84912345678', 2), makeRow('bad', 3)], 'first')
  for (const group of ['valid','rejected','duplicates']) {
    const matrix = api.importExportMatrix(report, group)
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), 'Data')
    const parsed = XLSX.read(XLSX.write(book, { type:'buffer', bookType:'xlsx' }), {type:'buffer'})
    const output = XLSX.utils.sheet_to_json(parsed.Sheets.Data, {header:1,raw:true})
    assert.equal(output.length - 1, report[group].length)
    assert.equal(parsed.Sheets.Data.C2.t, 's')
    if (group !== 'valid') assert.equal(output[1][16], report[group][0].reason)
    if (group === 'duplicates') assert.match(output[1][17], /dòng 1/)
    if (group === 'valid') {
      const source = workbookApi.importWorkbookTables(parsed).tables[0], schema = api.templateImportSchema(source)
      assert.equal(verify(api.mapImportTable(source, schema.mapping, 1, 'again'), 'first', 'akabizTemplate').valid[0].row.phone, '0912345678')
    }
  }
})
check('unsafe formula-like text remains a string in Excel', () => {
  const report = verify([makeRow('0912345678', 1, { name: '=1+1', info1: '000123' })])
  const sheet = XLSX.utils.aoa_to_sheet(api.importExportMatrix(report, 'valid'))
  assert.equal(sheet.A2.t, 's'); assert.equal(sheet.A2.f, undefined); assert.equal(sheet.E2.v, '000123')
})
check('10,000 accepted, 10,001 source blocked; split overflow reported without truncation', () => {
  const rows = Array.from({length:10000}, (_, i) => makeRow(`090${String(i).padStart(7,'0')}`, i + 1))
  assert.equal(verify(rows).valid.length, 10000)
  assert.throws(() => verify([...rows, makeRow('0987654321', 10001)]), /10.000/)
  rows[0].data.phone += ';0987654321'
  const result = verify(rows, 'all'); assert.equal(result.valid.length, 10001); assert.equal(result.limitExceeded, true)
})
check('image adapter retains malformed and duplicate records for verification', () => {
  const rows = api.imageImportRows([{phone:'0912345678'}, {phone:'+84912345678'}, {phone:'bad'}, {name:'Thiếu'}], 'zalo', 'zalo_message_phone')
  assert.equal(rows.length, 4); assert.deepEqual(counts(verify(rows, 'first', 'image')), [1,2,1])
  const blank = api.imageImportRows([{}, null, {phone:'0912345678'}], 'zalo', 'zalo_message_phone')
  assert.equal(blank.length, 1); assert.equal(blank[0].location.row, 3)
})
console.log(`PASS ${checks} import verification scenarios`)
