// Ảnh lỗi của engine v2 Facebook trên Desktop (errorScreenshots.ts) và trả lời yêu cầu chẩn đoán (diagnosticsResponder.ts) với hàm V556
// thật trên PostgreSQL 17 cục bộ, gọi bằng vai trò aka_agent_desktop như phiên Desktop. Chạy: node scripts/engine-v2-facebook/screenshots-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations } = require('./fixture.cjs')

const ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.FB_SHOTS_TEST_PORT || 55556)
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

const STUBS = {
  electron: `module.exports = { app: { getPath: () => globalThis.__shots.userData, getVersion: () => '9.9.9-test' } }`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__shots.client }`
}

async function load() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-shots-'))
  const outfile = path.join(out, 'shots.cjs')
  fs.writeFileSync(path.join(out, 'entry.ts'), `export * from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/facebook/errorScreenshots.ts'))}
export * from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/facebook/diagnosticsResponder.ts'))}`)
  await build({ entryPoints: [path.join(out, 'entry.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
    plugins: [{ name: 'shots', setup(plugin) {
      plugin.onResolve({ filter: /^electron$|\/supabaseClient$/ }, args => ({ path: args.path === 'electron' ? 'electron' : 'supabaseClient', namespace: 'stub' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
    } }] })
  return { mod: require(outfile), out }
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
// DOM cả trang kèm ảnh (anh chốt 20/11/2026) và V595 (bảng DOM riêng).
const V595 = path.join(ROOT, 'migrations/migration_v595_desktop_diagnostic_dom.sql')
const V595_ROLLBACK = path.join(ROOT, 'migrations/rollback_v595_desktop_diagnostic_dom.sql')
const DOM_A = '<!DOCTYPE html>\n<html lang="vi"><body><div role="main"><h1>Nhóm A</h1></div><div role="dialog">Tạo bài viết — Đăng</div></body></html>'
const DOM_B = '<!DOCTYPE html>\n<html lang="vi"><body><div role="main"><h2>Bạn hiện không xem được nội dung này</h2></div></body></html>'

async function main() {
  const { mod: S, out } = await load()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-shots-ud-'))
  const cluster = startCluster({ port: PORT, label: 'aka-fb-shots-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  let desktopStaff = null
  globalThis.__shots = {
    userData,
    client: {
      rpc(name, args) {
        const run = (async () => {
          const params = [], parts = []
          for (const [key, value] of Object.entries(args || {})) {
            const json = value !== null && typeof value === 'object'
            params.push(json ? JSON.stringify(value) : value)
            parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
          }
          await db.query('BEGIN')
          try {
            await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [desktopStaff == null ? '' : String(desktopStaff)])
            await db.query('SET LOCAL ROLE aka_agent_desktop')
            const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
            await db.query('COMMIT')
            return { data: r.rows[0].r, error: null }
          } catch (e) { await db.query('ROLLBACK'); return { data: null, error: { message: e.message, code: e.code } } }
        })()
        return { abortSignal: () => run }
      }
    }
  }
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    const STAFF = 9301, ORG = 631
    await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Ảnh') ON CONFLICT DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'shots', 'pw')`, [STAFF, ORG])

    await check('trần chụp: mỗi lượt data tối đa 3 ảnh; cùng mã lỗi một chiến dịch tối đa 5 ảnh mỗi giờ', async () => {
      const t0 = 1_000_000_000_000
      assert.equal([1, 2, 3, 4].map(() => S.screenshotAllowed(11, 700, 'click:fb_post_button', t0)).join(), 'true,true,true,false')
      const runs = [21, 22, 23, 24, 25, 26].map(run => S.screenshotAllowed(run, 701, 'wait:fb_comment_box', t0))
      assert.deepEqual(runs, [true, true, true, true, true, false])
      assert.equal(S.screenshotAllowed(27, 701, 'wait:fb_comment_box', t0 + 61 * 60_000), true, 'qua một giờ thì chụp lại được')
      assert.equal(S.screenshotAllowed(28, 701, 'other_code', t0), true, 'mã khác không bị trần của mã này')
    })

    const saved = []
    await check('lưu ảnh JPEG + mô tả trên máy, tìm theo bộ lọc (chiến dịch, data, lượt, khoảng giờ, mã ảnh)', async () => {
      for (const [campaignId, inputDataId, targetRunId] of [[800, 1, 10], [800, 2, 11], [801, 3, 12]]) {
        const id = S.saveErrorScreenshot(JPEG, { campaignId, accountId: 5, inputDataId, targetRunId, stepKey: 'post', blockName: 'fb_click_post_button',
          url: 'www.facebook.com/groups/g1/', code: 'click:fb_post_button', message: 'Element not found: {fb_post_button}' })
        assert.match(String(id), /^[0-9a-f-]{36}$/)
        saved.push(id)
      }
      const day = new Date().toISOString().slice(0, 10)
      assert.ok(fs.existsSync(path.join(userData, 'local-data', 'engine-screenshots', day, `${saved[0]}.jpg`)))
      const meta = JSON.parse(fs.readFileSync(path.join(userData, 'local-data', 'engine-screenshots', day, `${saved[0]}.json`), 'utf8'))
      assert.equal(meta.appVersion, '9.9.9-test'); assert.equal(meta.bytes, JPEG.length)
      assert.equal(S.findErrorScreenshots({ campaignId: 800 }).length, 2)
      assert.equal(S.findErrorScreenshots({ inputDataId: 3 }).length, 1)
      assert.equal(S.findErrorScreenshots({ targetRunId: 11 })[0].meta.id, saved[1])
      assert.equal(S.findErrorScreenshots({ imageIds: [saved[2]] }).length, 1)
      assert.equal(S.findErrorScreenshots({ from: new Date(Date.now() + 60_000).toISOString() }).length, 0)
    })

    await check('yêu cầu ảnh lỗi: presence báo có yêu cầu → nhận → gửi ảnh khớp bộ lọc vào DB → xong; yêu cầu không có ảnh → no_images', async () => {
      const req = Number((await db.query(`SELECT public.aka_agent_desktop_diagnostic_request_v1($1, $2::jsonb, 'admin@akabiz') AS id`,
        [STAFF, JSON.stringify({ campaignId: 800 })])).rows[0].id)
      const empty = Number((await db.query(`SELECT public.aka_agent_desktop_diagnostic_request_v1($1, $2::jsonb, 'admin@akabiz') AS id`,
        [STAFF, JSON.stringify({ campaignId: 999 })])).rows[0].id)
      const presence = (await db.query(`SELECT public.aka_agent_device_presence_v2('shots', 'pw', gen_random_uuid(), '{}'::jsonb, false) AS r`)).rows[0].r
      assert.equal(presence.diagnostics, 2, JSON.stringify(presence))
      desktopStaff = STAFF
      await S.respondToDiagnostics()
      const rows = (await db.query(`SELECT id, status, result FROM public.auto_desktop_diagnostic_requests WHERE id = ANY($1) ORDER BY id`, [[req, empty]])).rows
      assert.equal(rows[0].status, 'done', JSON.stringify(rows[0])); assert.equal(rows[0].result.uploaded, 2)
      assert.equal(rows[1].status, 'no_images')
      const files = (await db.query(`SELECT image_id::text AS id, octet_length(content) AS n, meta FROM public.auto_desktop_diagnostic_files WHERE request_id = $1
        ORDER BY image_id`, [req])).rows
      assert.deepEqual(files.map(f => f.id).sort(), [saved[0], saved[1]].sort())
      assert.ok(files.every(f => Number(f.n) === JPEG.length && f.meta.campaignId === 800))
      const after = (await db.query(`SELECT public.aka_agent_device_presence_v2('shots', 'pw', gen_random_uuid(), '{}'::jsonb, false) AS r`)).rows[0].r
      assert.equal(after.diagnostics, 0)
    })

    const zlib = require('node:zlib')
    const crypto = require('node:crypto')
    const day = new Date().toISOString().slice(0, 10)
    const shotDir = path.join(userData, 'local-data', 'engine-screenshots', day)
    const request = async (filter, staff = STAFF) => Number((await db.query(
      `SELECT public.aka_agent_desktop_diagnostic_request_v1($1, $2::jsonb, 'admin@akabiz') AS id`, [staff, JSON.stringify(filter)])).rows[0].id)
    const asDesktop = async (staff, sql, params = []) => {
      await db.query('BEGIN')
      try {
        await db.query(`SELECT set_config('test.desktop_staff', $1, true)`, [String(staff)])
        await db.query('SET LOCAL ROLE aka_agent_desktop')
        const r = await db.query(sql, params)
        await db.query('COMMIT')
        return r
      } catch (error) { await db.query('ROLLBACK'); throw error }
    }
    const domUpload = args => globalThis.__shots.client.rpc('aka_agent_desktop_diagnostic_dom_upload_v1', args).abortSignal()
    const evid = {}

    await check('lưu ảnh + DOM cùng mã (DOM nén gzip); chỉ có DOM vẫn lưu được; tìm ảnh (AI đọc ảnh Q11) chỉ trả mã có ảnh', async () => {
      const meta = targetRunId => ({ campaignId: 810, accountId: 5, inputDataId: null, targetRunId, stepKey: 'post', blockName: 'fb_click_post_button',
        url: 'www.facebook.com/groups/g1/', code: 'click:fb_post_button', message: 'Element not found: {fb_post_button}' })
      assert.match(S.PAGE_DOM_SCRIPT, /aka:page-dom/)
      evid.both = S.saveErrorEvidence({ jpeg: JPEG, domGzip: await S.gzipErrorDom(DOM_A), domChars: DOM_A.length }, meta(30))
      await new Promise(resolve => setTimeout(resolve, 20))
      evid.domOnly = S.saveErrorEvidence({ jpeg: null, domGzip: await S.gzipErrorDom(DOM_B), domChars: DOM_B.length }, meta(31))
      assert.equal(S.saveErrorEvidence({ jpeg: null, domGzip: null }, meta(32)), null, 'không có gì thì không lưu')
      assert.ok(fs.existsSync(path.join(shotDir, `${evid.both}.jpg`)) && fs.existsSync(path.join(shotDir, `${evid.both}.dom.html.gz`)))
      assert.ok(!fs.existsSync(path.join(shotDir, `${evid.domOnly}.jpg`)) && fs.existsSync(path.join(shotDir, `${evid.domOnly}.dom.html.gz`)))
      const m1 = JSON.parse(fs.readFileSync(path.join(shotDir, `${evid.both}.json`), 'utf8'))
      const m2 = JSON.parse(fs.readFileSync(path.join(shotDir, `${evid.domOnly}.json`), 'utf8'))
      assert.equal(m1.hasJpeg, true); assert.equal(m1.bytes, JPEG.length); assert.equal(m1.dom.chars, DOM_A.length)
      assert.equal(m2.hasJpeg, false); assert.equal(m2.bytes, 0); assert.equal(m2.dom.chars, DOM_B.length)
      assert.equal(zlib.gunzipSync(fs.readFileSync(path.join(shotDir, `${evid.both}.dom.html.gz`))).toString('utf8'), DOM_A)
      const found = S.findErrorEvidence({ campaignId: 810 })
      assert.deepEqual(found.map(f => f.meta.id), [evid.domOnly, evid.both], 'mới nhất trước')
      assert.equal(found[0].jpegPath, null); assert.ok(found[0].domPath && found[1].jpegPath && found[1].domPath)
      assert.deepEqual(S.findErrorScreenshots({ campaignId: 810 }).map(f => f.meta.id), [evid.both])
      assert.deepEqual(S.findErrorScreenshots({ campaignId: 810 }, 1).map(f => f.meta.id), [evid.both], 'giới hạn 1 vẫn bỏ qua mã chỉ có DOM')
    })

    await check('DB chưa có V595: vẫn gửi ảnh như cũ, bỏ DOM (dom_rpc_missing), yêu cầu xong', async () => {
      desktopStaff = STAFF
      const req = await request({ campaignId: 810 })
      await S.respondToDiagnostics()
      const row = (await db.query(`SELECT status, result FROM public.auto_desktop_diagnostic_requests WHERE id = $1`, [req])).rows[0]
      assert.equal(row.status, 'done', JSON.stringify(row)); assert.equal(row.result.uploaded, 1); assert.equal(row.result.doms, 0)
      assert.ok(row.result.skipped.some(s => s.reason === 'dom_rpc_missing'), JSON.stringify(row.result))
      const files = (await db.query(`SELECT image_id::text AS id FROM public.auto_desktop_diagnostic_files WHERE request_id = $1`, [req])).rows
      assert.deepEqual(files.map(f => f.id), [evid.both])
      assert.equal((await db.query(`SELECT to_regclass('public.auto_desktop_diagnostic_doms') AS t`)).rows[0].t, null)
    })

    await check('V595 apply: bảng DOM bật RLS; Desktop chỉ gọi được hàm gửi, không đọc được DOM; anon không gọi được', async () => {
      await db.query(fs.readFileSync(V595, 'utf8'))
      assert.equal((await db.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.auto_desktop_diagnostic_doms'::regclass`)).rows[0].relrowsecurity, true)
      await assert.rejects(asDesktop(STAFF, 'SELECT public.aka_agent_desktop_diagnostic_doms_v1(1)'), /permission denied/)
      await assert.rejects(asDesktop(STAFF, 'SELECT count(*) FROM public.auto_desktop_diagnostic_doms'), /permission denied/)
      const anon = (await db.query(`SELECT has_function_privilege('anon', 'public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text)', 'EXECUTE') AS a`)).rows[0].a
      assert.equal(anon, false)
      await assert.rejects(db.query(fs.readFileSync(V595, 'utf8')), /đã có/, 'apply lại bị từ chối')
      await db.query('ROLLBACK').catch(() => {})
    })

    await check('V595: yêu cầu chẩn đoán gửi cả ảnh lẫn DOM (gzip như ảnh); bảng ảnh chỉ có ảnh (V593 đếm "ảnh đã về" không đổi); DOM giải nén ra đúng từng chữ', async () => {
      desktopStaff = STAFF
      const req = await request({ campaignId: 810 })
      await S.respondToDiagnostics()
      const row = (await db.query(`SELECT status, result FROM public.auto_desktop_diagnostic_requests WHERE id = $1`, [req])).rows[0]
      assert.equal(row.status, 'done', JSON.stringify(row)); assert.equal(row.result.uploaded, 1); assert.equal(row.result.doms, 2)
      assert.equal(Number((await db.query(`SELECT count(*) AS n FROM public.auto_desktop_diagnostic_files WHERE request_id = $1`, [req])).rows[0].n), 1)
      const doms = (await db.query(`SELECT image_id::text AS id, content, sha256, meta FROM public.auto_desktop_diagnostic_doms WHERE request_id = $1`, [req])).rows
      const byId = Object.fromEntries(doms.map(d => [d.id, d]))
      assert.equal(zlib.gunzipSync(byId[evid.both].content).toString('utf8'), DOM_A)
      assert.equal(zlib.gunzipSync(byId[evid.domOnly].content).toString('utf8'), DOM_B)
      assert.equal(byId[evid.both].sha256, crypto.createHash('sha256').update(byId[evid.both].content).digest('hex'))
      assert.equal(byId[evid.domOnly].meta.hasJpeg, false); assert.equal(byId[evid.both].meta.dom.chars, DOM_A.length)
      // Cách người đọc lấy DOM: hàm chỉ đọc trả gzip mã base64 → lưu ra tệp → giải nén.
      const read = (await db.query('SELECT public.aka_agent_desktop_diagnostic_doms_v1($1) AS r', [req])).rows[0].r
      assert.equal(read.doms.length, 2)
      const html = read.doms.map(d => zlib.gunzipSync(Buffer.from(String(d.gzipBase64).replace(/\s/g, ''), 'base64')).toString('utf8'))
      assert.deepEqual(html.sort(), [DOM_A, DOM_B].sort())
    })

    await check('gửi DOM bị từ chối đúng lý do: không phải base64, không phải gzip, quá 2 MB, chưa đăng nhập, yêu cầu của nhân viên khác, yêu cầu đã đóng, quá 50 DOM; gửi lại không nhân đôi', async () => {
      const STAFF2 = 9302
      await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, 'shots2', 'pw') ON CONFLICT DO NOTHING`, [STAFF2, ORG])
      desktopStaff = STAFF
      const open = await request({ campaignId: 997 })
      const id = crypto.randomUUID()
      const gz = text => zlib.gzipSync(Buffer.from(text, 'utf8')).toString('base64')
      const call = async (b64, extra = {}) => (await domUpload({ p_request_id: open, p_image_id: id, p_meta: { a: 1 }, p_gzip_base64: b64, ...extra })).data
      assert.equal((await call('không phải base64 !!!')).reason, 'invalid_request')
      assert.equal((await call(Buffer.from('<html>chưa nén</html>').toString('base64'))).reason, 'invalid_dom')
      const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1, 0x41); tooBig[0] = 0x1f; tooBig[1] = 0x8b
      assert.equal((await call(tooBig.toString('base64'))).reason, 'invalid_dom')
      desktopStaff = null
      assert.equal((await call(gz('<html></html>'))).reason, 'no_session')
      desktopStaff = STAFF
      const other = await request({ campaignId: 997 }, STAFF2)
      assert.equal((await call(gz('<html></html>'), { p_request_id: other })).reason, 'not_found')
      assert.equal((await call(gz('<html>ok</html>'))).ok, true)
      assert.equal((await call(gz('<html>lần hai</html>'))).ok, true)
      const rows = (await db.query(`SELECT content FROM public.auto_desktop_diagnostic_doms WHERE request_id = $1`, [open])).rows
      assert.deepEqual(rows.map(r => zlib.gunzipSync(r.content).toString('utf8')), ['<html>ok</html>'], 'cùng mã chỉ giữ lần đầu')
      const many = await request({ campaignId: 996 })
      await db.query(`INSERT INTO public.auto_desktop_diagnostic_doms (request_id, image_id, content, sha256)
        SELECT $1, gen_random_uuid(), decode(repeat('1f8b', 9), 'hex'), repeat('a', 64) FROM generate_series(1, 50)`, [many])
      assert.equal((await call(gz('<html></html>'), { p_request_id: many, p_image_id: crypto.randomUUID() })).reason, 'too_many_files')
      for (const req of [open, many, other]) {
        await db.query(`UPDATE public.auto_desktop_diagnostic_requests SET status = 'done', completed_at = now() WHERE id = $1`, [req])
      }
      assert.equal((await call(gz('<html></html>'), { p_image_id: crypto.randomUUID() })).reason, 'closed')
    })

    await check('gỡ V595: mất bảng và hàm DOM; Desktop vẫn gửi ảnh; apply lại được', async () => {
      await db.query(fs.readFileSync(V595_ROLLBACK, 'utf8'))
      assert.equal((await db.query(`SELECT to_regclass('public.auto_desktop_diagnostic_doms') AS t`)).rows[0].t, null)
      assert.equal((await db.query(`SELECT to_regprocedure('public.aka_agent_desktop_diagnostic_dom_upload_v1(bigint, uuid, jsonb, text)') AS f`)).rows[0].f, null)
      desktopStaff = STAFF
      const req = await request({ campaignId: 810 })
      await S.respondToDiagnostics()
      const row = (await db.query(`SELECT status, result FROM public.auto_desktop_diagnostic_requests WHERE id = $1`, [req])).rows[0]
      assert.equal(row.status, 'done'); assert.equal(row.result.uploaded, 1); assert.equal(row.result.doms, 0)
      await db.query(fs.readFileSync(V595, 'utf8'))
      assert.ok((await db.query(`SELECT to_regclass('public.auto_desktop_diagnostic_doms') AS t`)).rows[0].t)
    })

    await check('dọn ảnh: quá 14 ngày thì xoá (cả block-screenshots của bộ cũ); quá dung lượng thì xoá cũ nhất trước', async () => {
      const legacy = path.join(userData, 'local-data', 'block-screenshots', 'campaign-1', '2026-10-01')
      fs.mkdirSync(legacy, { recursive: true })
      const oldFile = path.join(legacy, 'old.png')
      fs.writeFileSync(oldFile, Buffer.alloc(100))
      const old = (Date.now() - 20 * 24 * 60 * 60_000) / 1000
      fs.utimesSync(oldFile, old, old)
      const removed = await S.cleanupScreenshots()
      assert.equal(removed, 1); assert.equal(fs.existsSync(oldFile), false)
      assert.equal(fs.existsSync(path.join(userData, 'local-data', 'block-screenshots', 'campaign-1')), false, 'thư mục rỗng được dọn')
      // Quá dung lượng: giữ ảnh mới nhất.
      const day = new Date().toISOString().slice(0, 10)
      const dir = path.join(userData, 'local-data', 'engine-screenshots', day)
      const files = fs.readdirSync(dir).map(name => path.join(dir, name))
      files.forEach((file, index) => { const t = (Date.now() - (files.length - index) * 1000) / 1000; fs.utimesSync(file, t, t) })
      const newest = files[files.length - 1]
      const before = files.length
      const removedBySize = await S.cleanupScreenshots(Date.now(), { days: 14, bytes: fs.statSync(newest).size })
      assert.equal(removedBySize, before - 1)
      assert.ok(fs.existsSync(newest))
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
