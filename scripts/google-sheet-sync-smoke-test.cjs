const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const esbuild = require('esbuild')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-sheet-parser-'))
esbuild.buildSync({ entryPoints: ['src/shared/googleSheetSync.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(dir, 'sync.cjs') })
const { parseSheetCsv, googleSheetUrl, readGoogleSheet, mapGoogleSheet, SHEET_MAX_BYTES } = require(path.join(dir, 'sync.cjs'))
const config = { url: 'https://docs.google.com/spreadsheets/d/test/edit#gid=123', dataTypeCode: 'zalo_person', hasHeader: true, mapping: [{ column: 0, field: 'uid' }, { column: 1, field: 'name' }, { column: 2, field: 'phone' }], expectedHeaders: ['UID', 'Tên', 'Phone'] }
async function main() {
  assert.deepEqual(parseSheetCsv('\uFEFFUID,Tên,Phone\r\n12345678901234567890,"An,\nBình",0912345678\r\n'), [['UID','Tên','Phone'],['12345678901234567890','An,\nBình','0912345678']])
  assert.deepEqual(parseSheetCsv('a,"b""c",\n'), [['a','b"c','']])
  assert.deepEqual(parseSheetCsv(''), [])
  assert.throws(() => parseSheetCsv('"bad'), /thiếu/)
  assert.throws(() => parseSheetCsv('"ok"bad'), /không hợp lệ/)
  assert.throws(() => parseSheetCsv('x\n'.repeat(10002)), /10.000/)
  assert.equal(googleSheetUrl(config.url).downloadUrl, 'https://docs.google.com/spreadsheets/d/test/export?format=csv&gid=123')
  assert.equal(googleSheetUrl('https://docs.google.com/spreadsheets/d/test/edit?gid=456').url, 'https://docs.google.com/spreadsheets/d/test/edit#gid=456')
  for (const url of ['http://docs.google.com/spreadsheets/d/test/edit','https://docs.google.com.evil.test/spreadsheets/d/test/edit','https://u:p@docs.google.com/spreadsheets/d/test/edit','file:///tmp/foo','https://docs.google.com:8080/spreadsheets/d/test/edit','https://docs.google.com/spreadsheets/d/test/edit#gid=x']) assert.throws(() => googleSheetUrl(url))
  const fetchCsv = async () => new Response('UID,Tên,Phone\n12345678901234567890,An,0912345678\n,Thiếu UID,\n', { headers: { 'content-type': 'text/csv' } })
  const document = await readGoogleSheet(config.url, true, fetchCsv)
  const mapped = mapGoogleSheet(document, config)
  assert.equal(mapped.rows[0].uid, '12345678901234567890')
  assert.equal(mapped.rows[0].phone, '0912345678')
  assert.equal(mapped.invalidCount, 1); assert.equal(mapped.errors[0].row, 3)
  assert.throws(() => mapGoogleSheet({ ...document, headers: ['Tên','UID','Phone'] }, config), /đã thay đổi/)
  assert.throws(() => mapGoogleSheet(document, { ...config, mapping: [{ column: 0, field: 'uid' },{ column: 1, field: 'uid' }] }), /một lần/)
  const noHeaders = await readGoogleSheet(config.url, false, async () => new Response('00123,An\n00456,Bình'))
  assert.deepEqual(noHeaders.headers, ['','']); assert.equal(noHeaders.rows[0][0], '00123')
  const empty = await readGoogleSheet(config.url, true, async () => new Response('UID,Tên,Phone\n'))
  assert.equal(mapGoogleSheet(empty, config).rowCount, 0)
  for (const response of [new Response('<html>Login</html>',{headers:{'content-type':'text/html'}}),new Response('',{status:403}),new Response('',{status:404}),new Response('',{status:302,headers:{location:'http://127.0.0.1/private'}})]) {
    await assert.rejects(() => readGoogleSheet(config.url, true, async () => response), err => err.permanent === true)
  }
  await assert.rejects(() => readGoogleSheet(config.url, true, async () => new Response('',{status:429})), err => err.permanent === false)
  await assert.rejects(() => readGoogleSheet(config.url, true, async () => { throw new TypeError('network') }), err => err.permanent === false)
  await assert.rejects(() => readGoogleSheet(config.url, true, async () => new Response('',{headers:{'content-length':String(SHEET_MAX_BYTES+1)}})), /10 MiB/)
  await assert.rejects(() => readGoogleSheet(config.url, true, async () => new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(SHEET_MAX_BYTES+1));c.close()}}))), /10 MiB/)
  await assert.rejects(() => readGoogleSheet(config.url, false, async () => new Response('1\n'.repeat(10001))), /10.000/)
  const tenThousand = await readGoogleSheet(config.url, true, async () => new Response('UID,Tên,Phone\n'+'123,An,0912345678\n'.repeat(10000)))
  assert.equal(mapGoogleSheet(tenThousand, config).rows.length, 10000)
  const one = (type, field, value) => mapGoogleSheet({ url: config.url, headers: ['Key'], rows: [[value]] }, { ...config, dataTypeCode: type, expectedHeaders: ['Key'], mapping: [{ column: 0, field }] })
  // Match the existing app's phone normalization, including numeric Sheet cells
  // that have lost a leading zero, country codes and legacy mobile prefixes.
  for (const [input, expected] of [
    ['333875455', '0333875455'], ['703576704', '0703576704'],
    ['0333875455', '0333875455'], ['0703576704', '0703576704'],
    ['+84 333 875 455', '0333875455'], ['84333875455', '0333875455'],
    ['0084 703 576 704', '0703576704'], ['+84 912 345 678', '0912345678'],
    ['(070) 357-6704', '0703576704'], ['01638754555', '0338754555'],
    ['1638754555', '0338754555'], ['01203576704', '0703576704'],
    ['3.33875455E+8', '0333875455']
  ]) {
    const mapped = one('phone', 'phone', input)
    assert.equal(mapped.invalidCount, 0, input)
    assert.equal(mapped.rows[0].phone, expected, input)
    assert.equal(one('phone', 'phone', expected).rows[0].phone, expected, 'Phone normalization must be idempotent')
  }
  for (const input of ['', 'abc', '123', '233875455', '03338754550']) {
    assert.equal(one('phone', 'phone', input).invalidCount, 1, input)
  }
  assert.equal(one('email','email','AN@Example.com').rows[0].email, 'an@example.com')
  assert.equal(one('zalo_group','url','https://zaloapp.com/qr/g/abc123').rows[0].url,'https://zalo.me/g/abc123')
  assert.equal(one('facebook_group','uid','https://m.facebook.com/groups/123/?ref=x').rows[0].uid,'https://www.facebook.com/groups/123')
  assert.equal(one('facebook_person','uid','https://evil.test/foo').invalidCount, 1)
  // The mapper must preserve the identity that the SQL canonicalizer dedupes.
  for (const id of ['pfbidExampleA', 'pfbidExampleB', 'pfbidExamplea', '123ABC']) {
    const mapped = one('facebook_post_url', 'url', `https://m.facebook.com/story.php?story_fbid=${id}&id=1001&ref=feed`)
    assert.equal(mapped.invalidCount, 0)
    assert.equal(mapped.rows[0].url, `https://www.facebook.com/story.php?story_fbid=${id}&id=1001`)
  }
  assert.equal(one('facebook_person', 'uid', 'https://fb.com/people/Example/1000123456789/').rows[0].uid, 'https://www.facebook.com/people/Example/1000123456789')
  assert.equal(one('facebook_page', 'uid', 'https://m.facebook.com/pages/Example/1000123456789/').rows[0].uid, 'https://www.facebook.com/pages/Example/1000123456789')
  const postLinks = [
    ['https://m.facebook.com/watch/?v=111111111&ref=feed', 'https://www.facebook.com/watch/?v=111111111'],
    ['https://www.facebook.com/watch/?v=222222222', 'https://www.facebook.com/watch/?v=222222222'],
    ['https://www.facebook.com/watch/live/?v=333333333&ref=feed', 'https://www.facebook.com/watch/live/?v=333333333'],
    ['https://www.facebook.com/video.php?v=444444444&ref=feed', 'https://www.facebook.com/video.php?v=444444444'],
    ['https://www.facebook.com/groups/123?multi_permalinks=111111111&ref=feed', 'https://www.facebook.com/groups/123/posts/111111111'],
    ['https://www.facebook.com/groups/123/?multi_permalinks=222222222', 'https://www.facebook.com/groups/123/posts/222222222'],
    ['https://www.facebook.com/groups/123?multi_permalinks=pfbidAbC', 'https://www.facebook.com/groups/123/posts/pfbidAbC'],
    ['https://www.facebook.com/example/videos/111111111/?ref=feed', 'https://www.facebook.com/example/videos/111111111'],
    ['https://www.facebook.com/reel/111111111/?ref=feed', 'https://www.facebook.com/reel/111111111'],
    ['https://www.facebook.com/groups/123/permalink/111111111/?ref=feed', 'https://www.facebook.com/groups/123/permalink/111111111']
  ]
  for (const [input, expected] of postLinks) {
    const mapped = one('facebook_post_url', 'url', input)
    assert.equal(mapped.invalidCount, 0, input)
    assert.equal(mapped.rows[0].url, expected)
    assert.equal(one('facebook_post_url', 'url', expected).rows[0].url, expected, 'Normalization must be idempotent')
  }
  for (const url of [
    'https://www.facebook.com/watch', 'https://www.facebook.com/watch/?v=',
    'https://www.facebook.com/watch/?v=123&v=456', 'https://www.facebook.com/video.php',
    'https://www.facebook.com/groups/123', 'https://www.facebook.com/groups/123?multi_permalinks=',
    'https://www.facebook.com/groups/123?multi_permalinks=123,456',
    'https://www.facebook.com/groups/123?multi_permalinks=123&multi_permalinks=456'
  ]) assert.equal(one('facebook_post_url', 'url', url).invalidCount, 1, url)
  console.log('Google Sheet parser, validation, limits, redirects and shared mapping: PASS')
}
main().finally(() => fs.rmSync(dir,{recursive:true,force:true})).catch(error => {console.error(error);process.exitCode=1})
