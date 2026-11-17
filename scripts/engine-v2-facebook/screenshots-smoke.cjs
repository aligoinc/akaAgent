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
