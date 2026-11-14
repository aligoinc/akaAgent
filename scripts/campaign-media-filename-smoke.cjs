// Smoke test: media tải từ cloud giữ tên gốc (campaignMediaSource.ts) và tên tệp đính kèm Email (emailRuntimeService.ts).
// Chạy module thật (esbuild) với máy chủ HTTP cục bộ, không gọi mạng ngoài, không DB, không SMTP (nodemailer streamTransport).
// - tệp tải về nằm trong thư mục tạm riêng `campaign-media-XXXXXX`, mang tên gốc đã làm sạch, đuôi tệp đúng như cách đặt tên cũ;
// - dọn tệp xoá cả thư mục, chỉ thư mục do chính tiến trình tạo; tệp thật trên máy không bao giờ bị xoá;
// - tên độc hại (../../x, CON.pdf, ký tự điều khiển, tên rất dài, tiếng Việt NFD) được làm sạch;
// - cùng một thư có hai tệp trùng tên vẫn ra tên đính kèm khác nhau (đọc từ MIME thật của nodemailer).
// Run: node scripts/campaign-media-filename-smoke.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { build } = require('esbuild')
const nodemailer = require('nodemailer')

const root = path.resolve(__dirname, '..')
let passed = 0
const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

async function loadModules(outDir) {
  const outfile = path.join(outDir, 'campaign-media-filename.cjs')
  await build({
    stdin: {
      contents: `
        export * from './src/main/services/campaignMediaSource';
        export { EmailRuntimeService } from './src/main/services/emailRuntimeService';
      `,
      resolveDir: root
    },
    outfile, bundle: true, platform: 'node', format: 'cjs', target: 'node20', logLevel: 'warning',
    plugins: [{ name: 'fakes', setup(plugin) {
      plugin.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'db', namespace: 'fake-db' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fake-db' }, () => ({ contents: `
        export const getSupabaseUrl = () => 'https://mock.invalid';
        export const getSupabaseClient = () => { throw new Error('this smoke must not touch the DB') };` }))
    } }]
  })
  return require(outfile)
}

function startServer(routes) {
  const requests = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid')
    requests.push(url.pathname + url.search)
    const route = routes[url.pathname]
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('missing')
      return
    }
    res.writeHead(200, { 'content-type': route.type })
    res.end(route.body)
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    server, requests, base: `http://127.0.0.1:${server.address().port}`
  })))
}

const listTempDirs = () => new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('campaign-media-')))

/** Tên tệp đính kèm như người nhận thấy: Content-Disposition trong MIME thật (gồm RFC 2231 `filename*0*=utf-8''...`). */
function attachmentFilenames(raw) {
  const text = raw.toString('utf8').replace(/\r?\n[ \t]+/g, ' ')
  return text.split(/\r?\n/).filter(line => /^content-disposition:\s*attachment/i.test(line)).map(line => {
    const params = {}
    for (const match of line.matchAll(/;\s*([a-z0-9*]+)=("(?:[^"\\]|\\.)*"|[^;]*)/gi)) {
      let value = match[2].trim()
      if (value.startsWith('"')) value = JSON.parse(value)
      params[match[1].toLowerCase()] = value
    }
    if (params.filename !== undefined) return params.filename
    const keys = Object.keys(params).filter(key => /^filename\*(\d+\*?)?$/.test(key))
      .sort((a, b) => Number(a.split('*')[1] || 0) - Number(b.split('*')[1] || 0))
    let encoded = ''
    for (const [index, key] of keys.entries()) {
      let value = params[key]
      if (key.endsWith('*')) {
        if (index === 0) value = value.replace(/^[^']*'[^']*'/, '')
        encoded += value
      } else {
        encoded += encodeURIComponent(value)
      }
    }
    return decodeURIComponent(encoded)
  })
}

async function main() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-media-filename-smoke-'))
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-user-files-'))
  const strayDir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-media-'))
  const pdf = 'application/pdf'
  const { server, base } = await startServer({
    '/media/1731500000000-abcd1234-Bao-gia.pdf': { type: pdf, body: 'PDF-A' },
    '/media/1731500000001-efgh5678-Bao-gia.pdf': { type: pdf, body: 'PDF-B' },
    '/media/abc': { type: 'image/png', body: 'PNG' },
    '/media/report.pdf': { type: pdf, body: 'REPORT' },
    '/media/T%C3%A0i%20li%E1%BB%87u%20m%E1%BA%ABu.docx': { type: 'application/octet-stream', body: 'DOCX' },
    '/media/clip.MP4': { type: 'video/mp4', body: 'MP4' },
    '/media/evil.pdf': { type: pdf, body: 'EVIL' },
    '/media/con.pdf': { type: pdf, body: 'CON' }
  })
  try {
    const lib = await loadModules(outDir)
    const tmp = fs.realpathSync(os.tmpdir())
    const assertOwnedTempFile = (resolved, expectedBaseName) => {
      const dir = path.dirname(resolved)
      assert.equal(path.basename(resolved), expectedBaseName)
      assert.match(path.basename(dir), /^campaign-media-.{6}$/, 'one mkdtemp directory per downloaded file')
      assert.equal(fs.realpathSync(path.dirname(dir)), tmp, 'the directory sits directly in the OS temp dir')
      assert.equal(path.relative(dir, resolved).includes('..'), false, 'the file never escapes its directory')
      return dir
    }

    // 1. Ảnh chụp media thư viện chỉ có cloudUrl (soạn trên Web/iOS): tên gốc, thư mục riêng, dọn cả thư mục.
    const before = listTempDirs()
    const temp = []
    const quote = await lib.resolveCampaignMediaSource({
      name: 'Báo giá.pdf', cloudUrl: `${base}/media/1731500000000-abcd1234-Bao-gia.pdf`, provider: 'r2', mimeType: pdf
    }, temp)
    const quoteDir = assertOwnedTempFile(quote, 'Báo giá.pdf')
    assert.equal(fs.readFileSync(quote, 'utf8'), 'PDF-A')
    assert.deepEqual(temp, [quote])
    lib.cleanupCampaignMediaTempFiles(temp)
    assert.deepEqual(temp, [], 'the caller list is emptied as before')
    assert.equal(fs.existsSync(quoteDir), false, 'cleanup removes the whole directory')
    assert.deepEqual([...listTempDirs()].filter(name => !before.has(name)), [], 'nothing left in the temp dir')
    ok('cloud-only media downloads into its own temp directory under the original name; cleanup removes the directory')

    // 2. Có tệp trên máy thì dùng đúng đường dẫn đó như trước, không tải; dọn tệp không bao giờ xoá tệp/thư mục của người dùng.
    const userFile = path.join(userDir, 'Hợp đồng.pdf')
    fs.writeFileSync(userFile, 'USER')
    const local = []
    const localResolved = await lib.resolveCampaignMediaSource({
      name: 'Hợp đồng.pdf', localPath: userFile, cloudUrl: `${base}/media/report.pdf`
    }, local)
    assert.equal(localResolved, userFile)
    assert.deepEqual(local, [], 'a local file is never registered as a temp file')
    assert.equal(await lib.resolveCampaignMediaSource(userFile, local), userFile, 'plain local path string unchanged')
    lib.cleanupCampaignMediaTempFiles([userFile, path.join(userDir, 'missing.pdf')])
    assert.equal(fs.readFileSync(userFile, 'utf8'), 'USER', 'cleanup ignores paths it did not create')
    assert.equal(fs.existsSync(userDir), true)
    const strayFile = path.join(strayDir, 'other-process.pdf')
    fs.writeFileSync(strayFile, 'OTHER')
    lib.cleanupCampaignMediaTempFiles([strayFile])
    assert.equal(fs.existsSync(strayFile), true, 'a campaign-media-* directory this process did not create is left alone')
    ok('local files resolve exactly as before and are never deleted, even if their path lands in the cleanup list')

    // 3. Đuôi tệp theo đúng thứ tự cũ (URL → tên → Content-Type) để các bước kiểm loại tệp theo đường dẫn không đổi.
    const cases = [
      [{ name: 'Ảnh', cloudUrl: `${base}/media/abc`, mimeType: 'image/png' }, 'Ảnh.png'],
      [{ name: 'Report v1.2', cloudUrl: `${base}/media/report.pdf` }, 'Report v1.2.pdf'],
      [{ name: 'clip.mp4', cloudUrl: `${base}/media/clip.MP4` }, 'clip.MP4'],
      [{ cloudUrl: `${base}/media/report.pdf` }, 'report.pdf'],
      [{ localPath: 'C:\\Users\\khach\\Desktop\\Bảng giá.pdf', cloudUrl: `${base}/media/report.pdf` }, 'Bảng giá.pdf'],
      [`${base}/media/T%C3%A0i%20li%E1%BB%87u%20m%E1%BA%ABu.docx?X-Amz-Signature=abc`, 'Tài liệu mẫu.docx'],
      [{ name: '../../evil.pdf', cloudUrl: `${base}/media/evil.pdf` }, 'evil.pdf'],
      [{ name: 'CON.pdf', cloudUrl: `${base}/media/con.pdf` }, '_CON.pdf']
    ]
    for (const [item, expected] of cases) {
      const list = []
      const resolved = await lib.resolveCampaignMediaSource(item, list)
      assertOwnedTempFile(resolved, expected)
      const url = typeof item === 'string' ? item : item.cloudUrl
      const contentType = url.includes('/abc') ? 'image/png' : url.includes('.docx') ? 'application/octet-stream' : url.includes('.MP4') ? 'video/mp4' : pdf
      assert.equal(path.extname(resolved), lib.getMediaDownloadExtension(url, contentType, lib.getCampaignMediaName(item)),
        `extension unchanged from the old temp naming for ${expected}`)
      lib.cleanupCampaignMediaTempFiles(list)
      assert.equal(fs.existsSync(path.dirname(resolved)), false)
    }
    // Lời gọi 3 tham số cũ (bộ lập lịch còn bọc hàm này) vẫn chạy, tên lấy từ mediaName.
    const legacy = []
    const legacyPath = await lib.downloadCampaignMediaUrl(`${base}/media/report.pdf`, 'Biên bản.pdf', legacy)
    assertOwnedTempFile(legacyPath, 'Biên bản.pdf')
    lib.cleanupCampaignMediaTempFiles(legacy)
    ok('names come from item.name, else localPath, else the decoded URL path; extension precedence is the old one')

    // 4. Tải lỗi: báo lỗi như cũ, không để lại thư mục tạm.
    const failedBefore = listTempDirs()
    const failedList = []
    await assert.rejects(
      lib.resolveCampaignMediaSource({ name: 'Báo giá.pdf', cloudUrl: `${base}/media/missing.pdf` }, failedList),
      error => lib.isCampaignMediaResolveError(error) &&
        error.message === 'Không dùng được media "Báo giá.pdf": không có local path và cloud URL không tải được (HTTP 404)'
    )
    assert.deepEqual(failedList, [])
    assert.deepEqual([...listTempDirs()].filter(name => !failedBefore.has(name)), [])
    ok('a failed download keeps the old error text and leaves no temp directory')

    // 5. Làm sạch tên (hàm thuần).
    const build = (name, url = 'http://fixture.invalid/x.pdf', type = pdf) => lib.buildCampaignMediaDownloadFileName(name, url, type)
    assert.equal(build('../../x'), 'x.pdf')
    assert.equal(build('..\\..\\Windows\\System32\\x.pdf'), 'x.pdf')
    assert.equal(build('..'), 'x.pdf', 'an unusable name falls back to the URL file name')
    assert.equal(build('..', 'http://fixture.invalid/', pdf), 'media.pdf')
    assert.equal(build('', 'http://fixture.invalid/', 'application/octet-stream'), 'media.bin')
    assert.equal(build('   ', 'http://fixture.invalid/files/Bang%20gia.xlsx', 'application/octet-stream'), 'Bang gia.xlsx')
    assert.equal(build('CON.pdf'), '_CON.pdf')
    assert.equal(build('nul'), '_nul.pdf')
    assert.equal(build('Lpt9 .pdf'), '_Lpt9.pdf')
    assert.equal(build('com1.tar.gz', 'http://fixture.invalid/x.gz', 'application/gzip'), '_com1.tar.gz')
    assert.equal(build('Console.pdf'), 'Console.pdf')
    assert.equal(build('a<b>c:d"e|f?g*h.pdf'), 'a_b_c_d_e_f_g_h.pdf')
    assert.equal(build('photo\u0000\u0007\u202E\u200B.pdf'), 'photo.pdf')
    assert.equal(build('invoice\u202Efdp.exe', 'http://fixture.invalid/x.pdf'), 'invoicefdp.exe.pdf', 'a bidi override cannot fake the extension')
    assert.equal(build('  report. . .pdf  '), 'report.pdf')
    assert.equal(build('.hidden.pdf'), 'hidden.pdf')
    assert.equal(build('x.pdf', 'http://fixture.invalid/y.p:df'), 'x.pdf.p_df', 'reserved characters in the URL extension are replaced')
    const nfd = 'Báo giá tháng 11 – khách hàng VIP.pdf'.normalize('NFD')
    assert.equal(build(nfd), 'Báo giá tháng 11 – khách hàng VIP.pdf'.normalize('NFC'))
    for (const longName of ['A'.repeat(400) + '.pdf', 'Hợp đồng mua bán thiết bị điện tử '.repeat(20) + '.pdf', '\u{1F600}'.repeat(120) + '.pdf']) {
      const name = build(longName)
      assert.ok(Buffer.byteLength(name, 'utf8') <= lib.CAMPAIGN_MEDIA_FILE_NAME_MAX_BYTES, `${name.length} chars fits ${lib.CAMPAIGN_MEDIA_FILE_NAME_MAX_BYTES} bytes`)
      assert.ok(name.endsWith('.pdf'), 'the extension survives truncation')
      assert.equal(Buffer.from(name, 'utf8').toString('utf8'), name, 'no split UTF-8 sequence')
      assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(name), false, 'no lone surrogate')
      assert.equal(name.normalize('NFC'), name)
      assert.equal(/[ .]$/.test(path.basename(name, '.pdf')), false, 'no trailing space/dot before the extension')
    }
    // Tên dài thật sự ghi được ra đĩa.
    const longList = []
    const longPath = await lib.resolveCampaignMediaSource({ name: 'Hợp đồng '.repeat(60) + '.pdf', cloudUrl: `${base}/media/report.pdf` }, longList)
    assert.equal(fs.readFileSync(longPath, 'utf8'), 'REPORT')
    lib.cleanupCampaignMediaTempFiles(longList)
    ok('hostile names are sanitized: path parts, Windows device names and characters, control/bidi characters, length, NFC')

    // 6. Email: tệp đính kèm mang tên gốc; trùng tên trong một thư vẫn ra tên khác nhau (MIME thật của nodemailer).
    const emailTemp = []
    const firstQuote = await lib.resolveCampaignMediaSource({ name: 'Báo giá.pdf', cloudUrl: `${base}/media/1731500000000-abcd1234-Bao-gia.pdf` }, emailTemp)
    const secondQuote = await lib.resolveCampaignMediaSource({ name: 'Báo giá.pdf', cloudUrl: `${base}/media/1731500000001-efgh5678-Bao-gia.pdf` }, emailTemp)
    assert.notEqual(path.dirname(firstQuote), path.dirname(secondQuote), 'same original name, separate directories')
    const numbered = path.join(userDir, 'Báo giá (2).pdf')
    fs.writeFileSync(numbered, 'LOCAL-2')
    const docx = await lib.resolveCampaignMediaSource(`${base}/media/T%C3%A0i%20li%E1%BB%87u%20m%E1%BA%ABu.docx?sig=1`, emailTemp)
    const sent = []
    const transporter = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
    const send = transporter.sendMail.bind(transporter)
    transporter.sendMail = options => { sent.push(options); return send(options) }
    const email = new lib.EmailRuntimeService({
      getAccountEmailSession: async () => ({ session: {
        host: 'smtp.fixture.invalid', port: 587, secure: false, user: 'u', pass: 'p', fromEmail: 'shop@fixture.invalid', brandName: 'Shop'
      } })
    })
    email.getTransporter = () => transporter
    const result = await email.sendEmail(1, {
      to: 'khach@fixture.invalid', subject: 'Báo giá', body: 'Gửi anh chị báo giá',
      attachments: [firstQuote, secondQuote, numbered, docx, path.join(userDir, 'not-there.pdf')]
    })
    assert.equal(result.ok, true)
    const options = sent[0]
    assert.deepEqual(options.attachments.map(item => item.path), [firstQuote, secondQuote, numbered, docx], 'missing files are skipped as before')
    const expected = ['Báo giá.pdf', 'Báo giá (2).pdf', 'Báo giá (2) (2).pdf', 'Tài liệu mẫu.docx']
    assert.deepEqual(options.attachments.map(item => item.filename), expected, 'every attachment gets an explicit, distinct filename')
    const info = await send({ ...options })
    const visible = attachmentFilenames(info.message)
    assert.deepEqual(visible, expected, 'recipients see the original, distinct names')
    assert.equal(new Set(visible).size, visible.length)
    assert.equal(visible.some(name => name.includes('campaign-media-') || /[\\/]/.test(name)), false)
    lib.cleanupCampaignMediaTempFiles(emailTemp)
    for (const file of [firstQuote, secondQuote, docx]) assert.equal(fs.existsSync(path.dirname(file)), false)
    assert.equal(fs.existsSync(numbered), true)
    ok('email attachments carry the original names and stay distinct when two files share a name')

    console.log(`PASS ${passed}/${passed}: campaign media filename smoke`)
  } finally {
    server.close()
    for (const dir of [outDir, userDir, strayDir]) fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
