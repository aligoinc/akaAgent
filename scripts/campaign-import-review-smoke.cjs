// Regression coverage for importer review findings; real IPC/XLSX, local fixtures only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const XLSX = require('xlsx')
const handlers = new Map(), cache = new Map()
let aiRows = [], sheetBytes = Buffer.alloc(0), aiAction = ''
function load(file) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const mod = { exports: {} }; cache.set(file, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    Buffer, URL, TextDecoder, AbortSignal,
    fetch: async () => ({ ok: true, headers: { get: () => 'text/csv' }, arrayBuffer: async () => sheetBytes })
  })(id => {
    if (id === 'electron') return { ipcMain: { handle: (key, fn) => handlers.set(key, fn) } }
    if (id.endsWith('/currentUser')) return { requireCurrentUser: () => ({ staffId: 7 }) }
    if (id.endsWith('/aiRuntimeService')) return { callAiUsing: async (_code, payload) => {
      assert.equal(payload.actionId, aiAction)
      return { ok: true, content: JSON.stringify(aiRows) }
    } }
    return id.startsWith('.') ? load(path.resolve(path.dirname(file), `${id}.ts`)) : require(id)
  }, mod, mod.exports)
  return mod.exports
}
const types = load('src/shared/types.ts'), verify = load('src/shared/campaignImportVerification.ts')
const workbook = load('src/shared/campaignImportWorkbook.ts')
load('src/main/ipc/handlers/campaignImportHandlers.ts').registerCampaignImportHandlers()
const plain = value => JSON.parse(JSON.stringify(value))
const row = (phone, index = 2, fields = {}) => ({ data: { phone, ...fields }, location: { source: 'test.csv', sheet: 'Data', row: index, item: 1 } })
const options = { platform: 'zalo', actionId: 'zalo_message_phone', kind: 'excel', phonePolicy: 'first' }
function roundtrip(book) { return XLSX.read(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' }) }

async function main() {
  let cases = 0
  for (const [actionId, platform, fields, value] of [
    ['zalo_join_group_link', 'zalo', ['uid','url','link','groupLink','zaloGroupLink','zalo_group_link','value','name'], 'https://zalo.me/g/abc123'],
    ['facebook_join_group', 'facebook', ['uid','url','link','group','groupLink','facebookGroupLink','facebook_group_link','group_id','groupId','value','name'], 'https://www.facebook.com/groups/123456'],
    ['facebook_find_data_search', 'facebook', ['uid','keyword','keywords','search','query','tuKhoa','tu khoa','từ khóa','value','name'], 'bất động sản']
  ]) for (const field of fields) {
    aiAction = actionId; aiRows = [{ [field]: value, Info1: 'Căn 12' }, { [field]: value }, { [field]: 'invalid' }]
    const request = { actionId, platform, imageDataUrl: 'data:image/png;base64,AA==' }
    const handler = handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_EXTRACT_IMAGE)
    const legacy = await handler(null, request)
    const source = await handler(null, { ...request, responseMode: 'source' })
    const report = verify.verifyImportRows(source.rows, { actionId, platform, kind: 'image' })
    assert.equal(source.rows.length, 3, field)
    assert.deepEqual(plain(report.valid.map(item => item.row.uid)), plain(legacy.map(item => item.uid)), field)
    assert.equal(report.valid[0].row.info1, 'Căn 12')
    assert.equal(report.duplicates.length, 1)
    assert.equal(report.itemCount, report.valid.length + report.rejected.length + report.duplicates.length)
    cases++
  }
  const unknown = { unrecognized: 'Nội dung AI cần đối chiếu' }
  const unknownReport = verify.verifyImportRows(verify.imageImportRows([{}, null, unknown], 'zalo', options.actionId), { ...options, kind: 'image' })
  assert.equal(unknownReport.sourceRowCount, 1); assert.equal(unknownReport.rejected.length, 1)
  assert.equal(unknownReport.rejected[0].originalValue, JSON.stringify(unknown))
  assert.equal(unknownReport.rejected[0].location.row, 3)
  console.log(`PASS image: ${cases} legacy aliases through IPC, duplicates, invalid and unrecognized records retained`)

  const excelErrors = [[0, '#NULL!'], [7, '#DIV/0!'], [15, '#VALUE!'], [23, '#REF!'], [29, '#NAME?'], [36, '#NUM!'], [42, '#N/A']]
  for (const [platform, actionId, target, valid] of [
    ['zalo', 'zalo_message_phone', 'phone', '0912345678'],
    ['facebook', 'facebook_message_uid', 'uid', '100123456789012'],
    ['zalo', 'zalo_message_group_member', 'uid', '1234567890123456789'],
    ['facebook', 'facebook_find_data_search', 'uid', 'bất động sản'],
    ['zalo', 'zalo_join_group_link', 'uid', 'https://zalo.me/g/abc123'],
    ['email', 'email_send', 'email', 'an@example.com']
  ]) {
    const targetColumn = verify.IMPORT_FIELDS.indexOf(target)
    const header = ['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
    const values = value => header.map((_, column) => column === targetColumn ? value : '')
    const book = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([header, values(valid), ...excelErrors.map(() => values('error')), [], values(valid)], { origin: 'C3' })
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 2, c: 2 }, e: XLSX.utils.decode_range(sheet['!ref']).e })
    sheet.C4 = { t: 'e', v: 42 }; sheet.G4 = { t: 's', v: '000123' }; sheet.H4 = { t: 'e', v: 15 }
    excelErrors.forEach(([code], index) => { sheet[XLSX.utils.encode_cell({ r: index + 4, c: targetColumn + 2 })] = { t: 'e', v: code, f: '1/0' } })
    XLSX.utils.book_append_sheet(book, sheet, 'Errors')
    sheetBytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
    const sources = [
      workbook.importWorkbookTables(workbook.readImportWorkbook(sheetBytes, 'errors.xlsx')),
      await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, { platform, actionId, linkSheet: 'https://fixture.invalid/errors.xlsx', responseMode: 'source' })
    ]
    for (const source of sources) for (const kind of ['excel', 'sheet', 'akabizTemplate']) {
      const table = source.tables[0], schema = verify.templateImportSchema(table)
      assert(schema)
      const result = verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, 1, 'errors.xlsx'), { platform, actionId, kind })
      assert.deepEqual([result.valid.length, result.rejected.length, result.duplicates.length], [1, 7, 1], `${actionId}/${kind}`)
      assert.equal(result.sourceRowCount, 9); assert.equal(result.itemCount, 9)
      assert.equal(result.valid[0].row.info1, '000123'); assert.equal(result.valid[0].row.info2, '#VALUE!')
      assert.equal(result.duplicates[0].duplicateOf.row, 4)
      result.rejected.forEach((entry, index) => {
        assert.equal(entry.location.row, index + 5)
        assert.equal(entry.originalValue, excelErrors[index][1]); assert.equal(entry.displayValue, excelErrors[index][1])
        assert.equal(entry.normalizedValue, ''); assert(entry.reason.includes(`lỗi Excel ${excelErrors[index][1]}`))
      })
      const exported = roundtrip(workbook.createImportExportWorkbook(result, 'rejected'))
      const rows = XLSX.utils.sheet_to_json(exported.Sheets['Bị loại'], { header: 1, raw: true })
      assert.equal(rows.length, 8)
      assert.equal(rows[1][targetColumn], '#NULL!'); assert.equal(rows[3][13], '#VALUE!')
      assert(rows.every((row, index) => !index || row[16].includes('lỗi Excel')))
    }
  }
  // An error in the legacy name fallback is still an error, not a keyword or UID.
  const fallback = verify.verifyImportRows([{ data: { name: '#VALUE!' }, errors: { name: '#VALUE!' }, location: row('').location }], {
    platform: 'facebook', actionId: 'facebook_find_data_search', kind: 'akabizTemplate'
  })
  assert.equal(fallback.rejected.length, 1); assert.match(fallback.rejected[0].reason, /lỗi Excel/)
  const literal = verify.verifyImportRows([{ data: { uid: '#VALUE!' }, location: row('').location }], {
    platform: 'facebook', actionId: 'facebook_find_data_search', kind: 'textbox'
  })
  assert.equal(literal.valid.length, 1, 'literal keyword text is not an Excel error cell')
  console.log('PASS Excel errors: all seven codes, six recipient types, file/Sheet IPC, template, offset cells, blank rows, metadata, dedup and rejected export')

  const legacyBook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(legacyBook, XLSX.utils.aoa_to_sheet([
    ['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5'],
    ['An', '', '0912345678', '', '000123', 'a,b;c', '', '', '']
  ]), 'Data')
  for (const bookType of ['xml', 'biff2', 'biff5', 'biff8']) {
    sheetBytes = XLSX.write(legacyBook, { type: 'buffer', bookType })
    const sources = [
      workbook.importWorkbookTables(workbook.readImportWorkbook(sheetBytes, 'customer.xls')),
      await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, { platform: 'zalo', actionId: options.actionId, linkSheet: 'https://fixture.invalid/customer.xls', responseMode: 'source' })
    ]
    for (const source of sources) {
      const table = source.tables[0], schema = verify.templateImportSchema(table)
      assert(schema, bookType)
      const result = verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, 1, 'customer.xls'), options)
      assert.deepEqual([result.valid.length, result.rejected.length, result.duplicates.length], [1, 0, 0], bookType)
      assert.equal(result.valid[0].row.name, 'An'); assert.equal(result.valid[0].row.phone, '0912345678')
      assert.equal(result.valid[0].row.info1, '000123'); assert.equal(result.valid[0].row.info2, 'a,b;c')
    }
  }
  console.log('PASS XLS formats: XML and BIFF2/5/8 through file and Sheet IPC, template columns and recipient/metadata preserved')

  const csv = 'Fullname,Uid,Mobile,Email,Info1,Info2,Info3,Info4,Info5\r\nNguyễn An,1234567890123456789,0912345678,,"Căn 12, tầng 3",,,,\r\n'
  const encodings = [
    ['UTF8', Buffer.from(csv)], ['UTF8 BOM', Buffer.from(`\ufeff${csv}`)],
    ['UTF16LE BOM', Buffer.from(`\ufeff${csv}`, 'utf16le')],
    ['UTF16BE BOM', Buffer.from(`\ufeff${csv}`, 'utf16le').swap16()]
  ]
  for (const [encoding, bytes] of encodings) {
    sheetBytes = bytes
    const request = { platform: 'zalo', actionId: options.actionId, linkSheet: 'https://fixture.invalid/data.csv' }
    const legacy = await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, request)
    assert.equal(legacy[0].phone, '0912345678', encoding)
    const fromIpc = await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, { ...request, responseMode: 'source' })
    const fromFile = workbook.importWorkbookTables(workbook.readImportWorkbook(bytes, 'source.csv'))
    for (const source of [fromIpc, fromFile]) {
      const table = source.tables[0], schema = verify.templateImportSchema(table)
      assert(schema, encoding)
      const rows = verify.mapImportTable(table, schema.mapping, 1, 'fixture')
      const report = verify.verifyImportRows(rows, options)
      assert.equal(report.valid.length, 1, encoding); assert.equal(report.rejected.length, 0, encoding)
      assert.equal(rows[0].data.uid, '1234567890123456789', encoding)
      assert.equal(report.valid[0].row.phone, '0912345678', encoding)
      assert.equal(report.valid[0].row.name, 'Nguyễn An', encoding)
      assert.equal(report.valid[0].row.info1, 'Căn 12, tầng 3', encoding)
    }
  }
  console.log('PASS CSV: UTF8/UTF8 BOM/UTF16LE/UTF16BE through IPC and file reader, exact UID/phone/name/Info')

  const phones = ['0900000000', '0900000001', '0900000002', '0900000003']
  const csvCases = [
    ['comma', `Tên,SĐT\r\nAn,${phones.join(';')}`, 'An'],
    ['semicolon', `Tên;SĐT\nAn;${phones.join(',')}`, 'An'],
    ['tab', `Tên\tSĐT\nAn\t${phones.join(';')}`, 'An'],
    ['quoted', `Tên,SĐT\n"An, Bình; \"\"Căn 12\"\"","${phones.join(';')}"`, 'An, Bình; "Căn 12"'],
    ['multiline', `Tên,SĐT\n"An, Bình\nTầng; 3",${phones.join(';')}`, 'An, Bình\nTầng; 3'],
    ['explicit', `sep=;\r\nTên;SĐT\r\nAn;${phones.join(',')}`, 'An']
  ]
  for (const [name, csv, expectedName] of csvCases) {
    sheetBytes = Buffer.from(csv)
    const sources = [
      workbook.importWorkbookTables(workbook.readImportWorkbook(sheetBytes, `${name}.csv`)),
      await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, {
        platform: 'zalo', actionId: options.actionId, linkSheet: 'https://fixture.invalid/data.csv', responseMode: 'source'
      })
    ]
    for (const source of sources) {
      const table = source.tables[0], detected = verify.detectImportColumns(table, 'zalo', options.actionId)
      assert.equal(detected.hasHeader, true, name)
      assert.equal(table.rows[0].length, 2, name)
      const rows = verify.mapImportTable(table, detected.mapping, 1, name)
      for (const [policy, counts] of [['all', [4, 0, 0]], ['first', [1, 3, 0]], ['discard', [0, 4, 0]]]) {
        const result = verify.verifyImportRows(rows, { ...options, phonePolicy: policy })
        assert.deepEqual([result.valid.length, result.rejected.length, result.duplicates.length], counts, `${name}/${policy}`)
        assert.equal(result.itemCount, 4); assert.equal(result.sourceRowCount, 1)
        if (policy === 'all') {
          assert.deepEqual(plain(result.valid.map(entry => entry.row.phone)), phones)
          assert(result.valid.every(entry => entry.row.name === expectedName), name)
        }
      }
    }
  }
  // Without a header, varying in-cell phone counts still identify the stable CSV column count.
  const noHeader = `An,${phones.join(';')}\nBình,${phones.slice(0, 2).join(';')}`
  const noHeaderTable = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(noHeader), 'data.csv')).tables[0]
  assert.equal(noHeaderTable.rows[0].length, 2)
  assert.equal(noHeaderTable.rows[0][1].value, phones.join(';'))
  for (const csv of [`An,${phones.join(';')}`, `An,${phones.join(';')}\nBình,${phones.join(';')}`]) {
    assert.throws(() => workbook.readImportWorkbook(Buffer.from(csv), 'ambiguous.csv'), /Không xác định được dấu phân cột CSV/)
  }
  const single = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(`SĐT\n${phones.join(';')}`), 'single.csv')).tables[0]
  assert.equal(single.rows[1][0].value, phones.join(';'))
  console.log('PASS CSV structure: file/Sheet IPC, comma/semicolon/tab, quotes/newlines, explicit separator, all policies, headerless and ambiguous inputs')

  const templateHeaders = ['Fullname', 'Uid', 'Mobile', 'Email', 'Info1', 'Info2', 'Info3', 'Info4', 'Info5']
  const prefaces = ['Danh sách khách hàng\n', '""\n', '\n\r\n', 'Báo cáo, tháng 10\n""\n', Array(19).fill('Ghi chú').join('\n') + '\n']
  for (const separator of [',', ';', '\t']) for (const prefix of prefaces) {
    const csv = prefix + templateHeaders.join(separator) + '\n'
      + ['An', '', '0912345678', '', 'Căn 12', '000123', '', '', ''].join(separator)
    sheetBytes = Buffer.from(csv)
    const sources = [
      workbook.importWorkbookTables(workbook.readImportWorkbook(sheetBytes, 'preface.csv')),
      await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, {
        platform: 'zalo', actionId: options.actionId, linkSheet: 'https://fixture.invalid/preface.csv', responseMode: 'source'
      })
    ]
    for (const source of sources) {
      const table = source.tables[0], schema = verify.templateImportSchema(table)
      assert(schema, JSON.stringify({ separator, prefix }))
      const result = verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, schema.headerIndex + 1, 'preface.csv'), { ...options, kind: 'akabizTemplate' })
      assert.deepEqual([result.valid.length, result.rejected.length, result.duplicates.length], [1, 0, 0])
      assert.equal(result.valid[0].row.phone, '0912345678'); assert.equal(result.valid[0].row.name, 'An')
      assert.equal(result.valid[0].row.info1, 'Căn 12'); assert.equal(result.valid[0].row.info2, '000123')
      assert.equal(result.valid[0].location.row, prefix.replace(/\r\n?/g, '\n').split('\n').length + 1)
    }
  }
  for (const csv of ['""\nTên;SĐT\nAn;0912345678', 'Danh sách\nTên;SĐT\nAn;0912345678']) {
    const table = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(csv), 'customer.csv')).tables[0]
    assert.equal(table.rows[1][1].value, 'SĐT'); assert.equal(table.rows[2][1].value, '0912345678')
  }
  for (const separator of [',', ';', '\t']) for (const phoneColumn of [0, 1]) {
    const cells = phoneColumn ? ['', 'SĐT'] : ['SĐT', '']
    const values = phoneColumn ? ['An', '0912345678'] : ['0912345678', 'An']
    const table = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(`${cells.join(separator)}\n${values.join(separator)}`), 'empty-headers.csv')).tables[0]
    assert.equal(table.rows[1][phoneColumn].value, '0912345678')
    assert.equal(table.rows[1][1 - phoneColumn].value, 'An')
  }
  // Generic columns without recognized aliases can still follow a single-cell preface.
  const generic = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from('Danh sách\nCột A;Cột B\nAn;0912345678\nBình;0987654321'), 'generic.csv')).tables[0]
  assert.equal(generic.rows[1][1].value, 'Cột B'); assert.equal(generic.rows[3][1].value, '0987654321')
  // A known one-column phone header must not turn in-cell separators into extra columns.
  const oneColumn = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(`Danh sách\nSĐT\n${phones.join(';')}`), 'one-column.csv')).tables[0]
  assert.equal(oneColumn.rows[2][0].value, phones.join(';')); assert.equal(oneColumn.rows[2].length, 1)
  assert.throws(() => workbook.readImportWorkbook(Buffer.from(`Danh sách\nAn,${phones.join(';')}\nBình,${phones.join(';')}`), 'ambiguous.csv'), /Không xác định được dấu phân cột CSV/)
  console.log('PASS CSV prefaces: comma/semicolon/tab, title punctuation, blank/quoted-empty records, header at row 20, file/Sheet IPC, generic and single-column inputs')

  const exactUid = '100123456789012', longUid = '123456789012345678901234567890'
  const scientificUid = '1.00123456789012E+14'
  const uidInputs = [scientificUid, exactUid, '1.23456789012345678901234567890E+29', longUid, '1.00123E+14', '1001234567890120e-1', '1.23e-1', Number.MAX_SAFE_INTEGER + 1, '-1.00123456789012e+14']
  for (const kind of ['textbox', 'excel', 'akabizTemplate', 'sheet', 'image']) {
    const result = verify.verifyImportRows(uidInputs.map((uid, index) => row('', index + 2, { uid, name: 'An', info1: '000123' })), {
      platform: 'facebook', actionId: 'facebook_message_uid', kind
    })
    assert.deepEqual([result.valid.length, result.rejected.length, result.duplicates.length], [2, 4, 3], kind)
    assert.deepEqual(plain(result.valid.map(entry => entry.row.uid)), [exactUid, longUid], kind)
    assert.equal(result.valid[0].originalValue, scientificUid)
    assert.equal(result.duplicates[0].duplicateOf.row, 2)
    assert.match(result.rejected[0].reason, /nhập số đầy đủ/)
    assert.equal(result.itemCount, uidInputs.length)
    for (const group of ['valid', 'rejected', 'duplicates']) {
      const table = workbook.importWorkbookTables(roundtrip(workbook.createImportExportWorkbook(result, group))).tables[0]
      assert.equal(table.rows.length - 1, result[group].length)
      if (group === 'valid') {
        assert.equal(table.rows[1][1].value, exactUid); assert.equal(table.rows[2][1].value, longUid)
        const schema = verify.templateImportSchema(table)
        const reimported = verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, 1, 'again'), {
          platform: 'facebook', actionId: 'facebook_message_uid', kind: 'akabizTemplate'
        })
        assert.deepEqual(plain(reimported.valid.map(entry => entry.row.uid)), [exactUid, longUid])
      }
    }
  }
  const uidSource = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(`UID\n${scientificUid}\n${exactUid}`), 'uids.csv')).tables[0]
  const uidReport = verify.verifyImportRows(verify.mapImportTable(uidSource, { uid: 0 }, 1, 'uids.csv'), { platform: 'facebook', actionId: 'facebook_message_uid', kind: 'excel' })
  assert.equal(uidReport.valid.length, 1); assert.equal(uidReport.duplicates.length, 1)
  aiAction = 'facebook_message_uid'; aiRows = [{ uid: scientificUid }, { uid: exactUid }]
  const imageHandler = handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_EXTRACT_IMAGE)
  const imageRequest = { platform: 'facebook', actionId: aiAction, imageDataUrl: 'data:image/png;base64,AA==' }
  const legacyUids = await imageHandler(null, imageRequest)
  const imageUids = await imageHandler(null, { ...imageRequest, responseMode: 'source' })
  const imageUidReport = verify.verifyImportRows(imageUids.rows, { platform: 'facebook', actionId: aiAction, kind: 'image' })
  assert.deepEqual(plain(imageUidReport.valid.map(entry => entry.row.uid)), plain(legacyUids.map(entry => entry.uid)))
  assert.equal(imageUidReport.duplicates.length, 1)
  sheetBytes = Buffer.from(`UID\n${scientificUid}\n${exactUid}`)
  const sheetUids = await handlers.get(types.IPC_EVENTS.CAMPAIGN_IMPORT_LOAD_SHEET)(null, {
    platform: 'facebook', actionId: aiAction, linkSheet: 'https://fixture.invalid/uids.csv', responseMode: 'source'
  })
  const sheetUidReport = verify.verifyImportRows(verify.mapImportTable(sheetUids.tables[0], { uid: 0 }, 1, 'Sheet'), { platform: 'facebook', actionId: aiAction, kind: 'sheet' })
  assert.deepEqual(plain(sheetUidReport.valid.map(entry => entry.row.uid)), [exactUid]); assert.equal(sheetUidReport.duplicates.length, 1)
  for (const actionId of ['zalo_message_group_member', 'data_group_zalo_person_uid']) {
    const result = verify.verifyImportRows([row('', 1, { uid: scientificUid }), row('', 2, { uid: longUid })], { platform: 'zalo', actionId, kind: 'excel' })
    assert.equal(result.rejected.length, 1); assert.equal(result.valid[0].row.uid, longUid)
  }
  const url = `https://www.facebook.com/${scientificUid}`
  assert.equal(verify.verifyImportRows([row('', 1, { uid: url })], { platform: 'facebook', actionId: 'facebook_message_uid', kind: 'excel' }).valid[0].row.uid, url)
  assert.equal(verify.verifyImportRows([row('', 1, { uid: scientificUid })], { platform: 'facebook', actionId: 'facebook_find_data_search', kind: 'excel' }).valid[0].row.uid, scientificUid)
  console.log('PASS scientific UID: exact long digits, deduplication, invalid reasons, five sources, CSV, three exports/reimport, strict Zalo and URL/keyword regression')

  const zeroMantissaInputs = ['0.100123456789012E+15', exactUid, '000.100123456789012E+15', '0.1001234567890120E+15', '0100123456789012', `0.${longUid}E+30`, longUid]
  for (const kind of ['textbox', 'excel', 'akabizTemplate', 'sheet', 'image']) {
    const result = verify.verifyImportRows(zeroMantissaInputs.map((uid, index) => row('', index + 2, { uid })), {
      platform: 'facebook', actionId: 'facebook_message_uid', kind
    })
    assert.deepEqual([result.valid.length, result.rejected.length, result.duplicates.length], [3, 0, 4], kind)
    assert.deepEqual(plain(result.valid.map(entry => entry.row.uid)), [exactUid, '0100123456789012', longUid], kind)
    assert(result.duplicates.slice(0, 3).every(entry => entry.duplicateOf.row === 2))
    assert.equal(result.valid[0].originalValue, zeroMantissaInputs[0])
    for (const group of ['valid', 'duplicates']) {
      const parsed = roundtrip(workbook.createImportExportWorkbook(result, group))
      const table = workbook.importWorkbookTables(parsed).tables[0]
      assert.equal(table.rows.length - 1, result[group].length)
      if (group === 'valid') {
        assert.equal(table.rows[1][1].value, exactUid); assert.equal(table.rows[2][1].value, '0100123456789012')
        const schema = verify.templateImportSchema(table)
        const imported = verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, 1, 'again'), { platform: 'facebook', actionId: 'facebook_message_uid', kind: 'akabizTemplate' })
        assert.deepEqual(plain(imported.valid.map(entry => entry.row.uid)), [exactUid, '0100123456789012', longUid])
      }
    }
  }
  for (const input of ['0.912345678E+9', '000.912345678E+9', '0.84912345678E+11']) {
    assert.equal(verify.normalizeImportPhone(input).value, '0912345678')
  }
  assert.equal(verify.normalizeImportPhone('0841234567').value, '0841234567')
  console.log('PASS scientific mantissa: insignificant zeros removed, plain text zeros retained, exact long UID, dedup refs, exports/reimport and phone regression')

  const long = Array.from({ length: 3000 }, (_, i) => `090${String(i).padStart(7, '0')}`).join(';')
  const longTable = workbook.importWorkbookTables(workbook.readImportWorkbook(Buffer.from(`Tên,SĐT\nAn,${long}`), 'long.csv')).tables[0]
  assert.equal(longTable.rows[1][1].value, long)
  const report = verify.verifyImportRows([row(long), row(long, 3)], options)
  assert.deepEqual([report.valid.length, report.rejected.length, report.duplicates.length], [1, 5998, 1])
  for (const group of ['valid', 'rejected', 'duplicates']) {
    const parsed = roundtrip(workbook.createImportExportWorkbook(report, group))
    const primary = XLSX.utils.sheet_to_json(parsed.Sheets[parsed.SheetNames[0]], { header: 1, raw: true })
    const evidence = XLSX.utils.sheet_to_json(parsed.Sheets['Nội dung dài'], { header: 1, raw: true })
    assert.equal(primary.length - 1, report[group].length, group)
    assert.equal(evidence.length, 3, 'one copy of the long value, in two chunks, across all rows/columns')
    assert.equal(evidence.slice(1).map(r => r[2]).join(''), long)
    assert(evidence.slice(1).every(r => r[2].length <= 32767))
    const restored = workbook.importWorkbookTables(parsed)
    assert.equal(restored.tables.length, 1, 'evidence is not another input worksheet')
    assert.equal(restored.tables[0].rows[1][13].value, long)
    assert.equal(restored.tables[0].rows[1][14].text, long)
    if (group === 'valid') {
      const table = restored.tables[0], schema = verify.templateImportSchema(table)
      assert.equal(verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, 1, 'again'), options).valid[0].row.phone, '0900000000')
    }
  }
  console.log('PASS export: 3000 phones/cell, all three XLSX files, counts unchanged, full evidence stored once and restored')

  const unicode = 'x'.repeat(32766) + '😀' + '\nTiếng Việt & < >' + 'y'.repeat(32767)
  const boundaries = verify.verifyImportRows([row('0912345678', 1, {
    name: '[Nội dung dài: ND1]', info1: 'x'.repeat(32767), info2: 'x'.repeat(32768), info3: unicode, info4: '=1+1'
  })], options)
  const parsed = roundtrip(workbook.createImportExportWorkbook(boundaries, 'valid'))
  for (const sheet of Object.values(parsed.Sheets)) for (const [key, cell] of Object.entries(sheet)) {
    if (key.startsWith('!')) continue
    assert.equal(cell.t, 's'); assert.equal(cell.f, undefined); assert(cell.v.length <= 32767)
  }
  const table = workbook.importWorkbookTables(parsed).tables[0], schema = verify.templateImportSchema(table)
  const imported = verify.verifyImportRows(verify.mapImportTable(table, schema.mapping, 1, 'again'), { ...options, kind: 'akabizTemplate' })
  for (const key of ['name','info1','info2','info3','info4']) assert.equal(imported.valid[0].row[key], boundaries.valid[0].row[key], key)
  const content = XLSX.utils.sheet_to_json(parsed.Sheets['Nội dung dài'], { header: 1, raw: true }).slice(1)
  assert(content.every(r => !/[\uD800-\uDBFF]$/.test(r[2]) && !/^[\uDC00-\uDFFF]/.test(r[2])))
  const missing = { ...parsed, Sheets: { ...parsed.Sheets } }; delete missing.Sheets['Nội dung dài']
  assert.throws(() => workbook.importWorkbookTables(missing), /Nội dung dài/)
  const corrupt = roundtrip(workbook.createImportExportWorkbook(boundaries, 'valid'))
  corrupt.Sheets['Nội dung dài'].B2.v = '2'
  assert.throws(() => workbook.importWorkbookTables(corrupt), /Nội dung dài/)
  const truncated = roundtrip(workbook.createImportExportWorkbook(boundaries, 'valid'))
  const range = XLSX.utils.decode_range(truncated.Sheets['Nội dung dài']['!ref'])
  range.e.r--
  truncated.Sheets['Nội dung dài']['!ref'] = XLSX.utils.encode_range(range)
  assert.throws(() => workbook.importWorkbookTables(truncated), /Nội dung dài/)
  const unrelated = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(unrelated, XLSX.utils.aoa_to_sheet([['Info1'], ['[Nội dung dài: ND1]']]), 'Data')
  assert.equal(workbook.importWorkbookTables(unrelated).tables[0].rows[1][0].value, '[Nội dung dài: ND1]')
  console.log('PASS export: 32767/32768 boundaries, Unicode, literal references/formulas, long Info template roundtrip and damaged evidence guards')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
