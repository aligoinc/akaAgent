// Smoke: khung "Sau khi chạy: đưa khách vào nhóm" và Tự động hóa nhúng trên Desktop
// (docs/DESKTOP_RESULT_GROUPS_AND_JOURNEYS_PLAN.md).
// Kiểm: hợp đồng chép nguyên văn từ WebApp (md5), đổi (action, payload) thành yêu cầu API, mã thật của client main gọi một API
// cục bộ làm đúng hợp đồng (thành công, API chưa có đường, lỗi nghiệp vụ, mất mạng, token lỗi), luật đường của trang nhúng.
// Chạy: node scripts/campaign-result-groups-desktop-smoke.cjs   (WEBAPP_REPO=<checkout akaAgentWebApp> để so md5 với bản WebApp)
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const http = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')
let failed = 0
let passed = 0

async function group(label, run) {
  try {
    await run()
    passed++
    console.log('PASS', label)
  } catch (error) {
    failed++
    console.log('FAIL', label)
    console.log('  ', error && error.stack ? error.stack.split('\n').slice(0, 3).join('\n   ') : error)
  }
}

async function bundle(dir, entry, name) {
  const outfile = join(dir, `${name}.cjs`)
  await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', external: ['electron'] })
  return require(outfile)
}

function listen(handler) {
  return new Promise(resolvePromise => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolvePromise(server))
  })
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-crg-desktop-'))
  try {
    const contractPath = join(ROOT, 'src/shared/campaignResultGroups.ts')
    const desktop = await bundle(dir, join(ROOT, 'src/shared/campaignResultGroupsDesktop.ts'), 'desktop')
    const contract = await bundle(dir, contractPath, 'contract')
    const api = await bundle(dir, join(ROOT, 'src/main/services/campaignResultGroupsApi.ts'), 'api')
    const journey = await bundle(dir, join(ROOT, 'src/shared/journeyWebDesktop.ts'), 'journey')

    await group('hợp đồng chép nguyên văn từ WebApp, không import gì', async () => {
      const text = readFileSync(contractPath, 'utf8')
      assert.equal(/^import /m.test(text), false)
      const webapp = process.env.WEBAPP_REPO
      if (webapp) {
        const source = join(webapp, 'packages/control-api/src/campaignResultGroups.ts')
        assert.ok(existsSync(source), `không thấy ${source}`)
        const md5 = value => createHash('md5').update(value).digest('hex')
        assert.equal(md5(text), md5(readFileSync(source, 'utf8')), 'src/shared/campaignResultGroups.ts lệch bản WebApp: chép lại nguyên văn')
      } else {
        console.log('   (bỏ qua so md5: chưa đặt WEBAPP_REPO)')
      }
    })

    await group('hợp đồng: loại chiến dịch Facebook có khung, câu theo đối tượng', async () => {
      assert.equal(contract.campaignResultGroupsSupported('facebook_group_post'), true)
      assert.equal(contract.campaignResultGroupsSupported('facebook_timeline_post'), false)
      assert.deepEqual(contract.campaignResultGroupTypes('facebook_group_post'), ['facebook_group'])
      assert.equal(contract.campaignResultGroupsWording('facebook_group_post').title, 'Sau khi chạy: đưa group vào nhóm')
      assert.equal(contract.campaignResultGroupsWording('zalo_message_phone').title, 'Sau khi chạy: đưa khách vào nhóm')
      assert.deepEqual(contract.campaignResultEnabledActionCodes('facebook_group_post', { enableComment: false }), ['fb_post_group'])
      assert.deepEqual(contract.campaignResultEnabledActionCodes('facebook_group_post', { enableComment: true }), ['fb_post_group', 'fb_comment'])
    })

    await group('đổi (action, payload) thành yêu cầu API; payload sai bị chặn ở main', async () => {
      const b = desktop.buildCampaignResultGroupsRequest
      assert.deepEqual(b('listAll'), { method: 'GET', path: '' })
      assert.deepEqual(b('options', { actionId: 'zalo_message_phone', accountIds: [9, 3, 3, -1, 'x'] }),
        { method: 'GET', path: '/options?actionId=zalo_message_phone&accountIds=3%2C9' })
      assert.deepEqual(b('list', { campaignId: 320 }), { method: 'GET', path: '/campaigns/320' })
      assert.deepEqual(b('save', { campaignId: 320, requestId: 'r1', rows: [{ groupId: 7, keys: ['fb_post_group::thành công'] }], includeExisting: true }),
        { method: 'PUT', path: '/campaigns/320', body: { requestId: 'r1', rows: [{ groupId: 7, keys: ['fb_post_group::thành công'] }], includeExisting: true } })
      assert.deepEqual(b('setStatus', { campaignId: 320, journeyId: 55, action: 'resume', includePaused: true }),
        { method: 'POST', path: '/campaigns/320/55/status', body: { action: 'resume', includePaused: true } })
      assert.deepEqual(b('setStatus', { campaignId: 320, journeyId: 55, action: 'pause', includePaused: true }).body, { action: 'pause' })
      for (const [action, payload] of [
        ['options', { actionId: '../x' }], ['list', { campaignId: 0 }], ['list', { campaignId: '320' }],
        ['save', { campaignId: 1, requestId: '', rows: [] }], ['save', { campaignId: 1, requestId: 'r', rows: [{ groupId: 1, keys: [] }] }],
        ['save', { campaignId: 1, requestId: 'r', rows: new Array(6).fill({ groupId: 1, keys: ['a::b'] }) }],
        ['setStatus', { campaignId: 1, journeyId: 2, action: 'delete' }]
      ]) {
        assert.throws(() => b(action, payload), error => error.code === 'campaign_result_groups_invalid_request', `${action} ${JSON.stringify(payload)}`)
      }
    })

    await group('client main gọi API cục bộ: token Bearer, thành công, lỗi nghiệp vụ giữ câu, API chưa có đường, mất mạng', async () => {
      const seen = []
      const server = await listen((request, response) => {
        let body = ''
        request.on('data', chunk => { body += chunk })
        request.on('end', () => {
          seen.push({ method: request.method, url: request.url, auth: request.headers.authorization, body: body ? JSON.parse(body) : null })
          response.setHeader('content-type', 'application/json')
          if (request.url.startsWith('/missing')) { response.statusCode = 404; response.end(JSON.stringify({ message: 'Route not found', statusCode: 404 })); return }
          if (request.url.endsWith('/campaigns/404')) {
            response.statusCode = 404
            response.end(JSON.stringify({ ok: false, code: 'campaign_result_groups_campaign_not_found', message: 'Không tìm thấy chiến dịch.' }))
            return
          }
          if (request.method === 'PUT') {
            response.statusCode = 409
            response.end(JSON.stringify({ ok: false, code: 'campaign_result_groups_group_type', message: 'Nhóm “A” không nhận được khách của loại chiến dịch này.' }))
            return
          }
          response.end(JSON.stringify({ ok: true, data: { items: [] } }))
        })
      })
      const base = `http://127.0.0.1:${server.address().port}`
      const deps = (url = `${base}/api`) => ({ url, token: async () => 'tok.en.abc', fetch: (...args) => fetch(...args) })
      try {
        assert.deepEqual(await api.callCampaignResultGroupsApi(deps(), 'listAll'), { items: [] })
        assert.equal(seen[0].auth, 'Bearer tok.en.abc')
        assert.equal(seen[0].url, '/api')
        await assert.rejects(api.callCampaignResultGroupsApi(deps(), 'list', { campaignId: 404 }),
          error => error.code === 'campaign_result_groups_campaign_not_found' && error.message === 'Không tìm thấy chiến dịch.')
        await assert.rejects(api.callCampaignResultGroupsApi(deps(), 'save', { campaignId: 5, requestId: 'r', rows: [{ groupId: 7, keys: ['zalo_message_stranger::thành công'] }] }),
          error => error.code === 'campaign_result_groups_group_type' && /không nhận được khách/.test(error.message))
        assert.equal(seen.at(-1).body.requestId, 'r')
        await assert.rejects(api.callCampaignResultGroupsApi(deps(`${base}/missing`), 'listAll'),
          error => error.code === desktop.CAMPAIGN_RESULT_GROUPS_NOT_READY)
        await assert.rejects(api.callCampaignResultGroupsApi({ ...deps(), token: async () => { throw new Error('no session') } }, 'listAll'),
          error => error.code === desktop.CAMPAIGN_RESULT_GROUPS_UNAVAILABLE)
        const count = seen.length
        await assert.rejects(api.callCampaignResultGroupsApi(deps(), 'list', { campaignId: -1 }), error => error.code === 'campaign_result_groups_invalid_request')
        assert.equal(seen.length, count, 'payload sai không được gửi đi')
      } finally {
        await new Promise(done => server.close(done))
      }
      await assert.rejects(api.callCampaignResultGroupsApi(deps('http://127.0.0.1:9/api'), 'listAll'),
        error => error.code === desktop.CAMPAIGN_RESULT_GROUPS_UNAVAILABLE)
    })

    await group('trang nhúng: chỉ ở lại trong /automation, link ra ngoài mở màn Desktop', async () => {
      const origin = 'https://agent.akabiz.net'
      assert.equal(journey.journeyWebInsidePath('/automation/12'), true)
      assert.equal(journey.journeyWebInsidePath('/automation/from-campaigns'), false)
      assert.equal(journey.journeyWebStartPath('//evil.com/automation'), '/automation')
      assert.equal(journey.journeyWebStartPath('/automation/../accounts'), '/automation')
      assert.equal(journey.journeyWebUrl(origin, '/automation/12', 'dark'), `${origin}/automation/12?embed=desktop&theme=dark`)
      const c = href => journey.classifyJourneyWebOutside(href, origin)
      assert.deepEqual(c(`${origin}/campaigns?campaign=77`), { kind: 'campaign', campaignId: 77, edit: false })
      assert.deepEqual(c(`${origin}/campaigns/77/edit`), { kind: 'campaign', campaignId: 77, edit: true })
      assert.deepEqual(c(`${origin}/campaigns/new`), { kind: 'newCampaign' })
      assert.deepEqual(c(`${origin}/data-groups`), { kind: 'dataGroup', groupId: null })
      assert.deepEqual(c(`${origin}/accounts`), { kind: 'accounts' })
      assert.deepEqual(c(`${origin}/automation/from-campaigns`), { kind: 'fromCampaigns' })
      assert.deepEqual(c('https://example.com/x'), { kind: 'external', url: 'https://example.com/x' })
      assert.equal(journey.JOURNEY_WEB_EXPIRED_TITLE, 'akaAgent: cần đăng nhập lại')
      const webapp = process.env.WEBAPP_REPO
      if (webapp) {
        const embed = readFileSync(join(webapp, 'apps/web/src/lib/desktopEmbed.ts'), 'utf8')
        assert.ok(embed.includes(`DESKTOP_EMBED_EXPIRED_TITLE = '${journey.JOURNEY_WEB_EXPIRED_TITLE}'`), 'câu tiêu đề hết phiên lệch WebApp')
      }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  if (failed) process.exit(1)
}

main().catch(error => { console.error(error); process.exit(1) })
