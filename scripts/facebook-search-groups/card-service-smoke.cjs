// Smoke phần main đọc thẻ nhóm từ log chạy (src/main/services/foundFacebookGroupCardService.ts), không DB:
// supabase-js thật với fetch giả mô phỏng PostgREST (lọc, sắp xếp, limit), để kiểm URL lọc thật (ngoặc kép, mã hoá "+"),
// chia trang khi nhiều dòng trùng created_at, gộp thẻ theo nhóm, trần dòng, quá hạn, lỗi DB, quyền sở hữu, gộp lượt trùng.
// Chạy: node scripts/facebook-search-groups/card-service-smoke.cjs
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { build } = require('esbuild')

const root = path.resolve(__dirname, '../..')
const stubs = {
  currentUser: `
    export const requireCurrentUser = () => { if (!globalThis.__user) throw new Error('Chưa đăng nhập. Vui lòng đăng nhập trước khi thao tác dữ liệu.'); return globalThis.__user }
    export const runWithCurrentUser = (_user, operation) => operation()`,
  supabaseClient: `
    import { createClient } from '@supabase/supabase-js'
    const client = createClient('https://fixture.supabase.test', 'fixture-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (...args) => globalThis.__fetch(...args) }
    })
    export const getSupabaseClient = () => client`
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ts = second => `2026-09-27T12:${String(40 + Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.157267+00:00`

// PostgREST giả cho đúng câu đọc thẻ: eq campaign/event/status, lte created_at, or(created_at.lt."X",id.lt.N), order desc, limit.
function serveEvents(url, rows, calls) {
  const params = url.searchParams
  assert.equal(params.get('select'), 'id,created_at,target_url,raw_text:debug_data->>rawText')
  assert.equal(params.get('event_type'), 'eq.extract_facebook_group_data')
  assert.equal(params.get('status'), 'eq.success')
  assert.equal(params.get('order'), 'created_at.desc,id.desc')
  const campaignId = Number(params.get('campaign_id').replace(/^eq\./, ''))
  const limit = Number(params.get('limit'))
  const lte = params.get('created_at')
  const or = params.get('or')
  calls.push({ lte, or, raw: url.href })
  let cursor = null
  if (lte || or) {
    assert.match(lte, /^lte\./)
    const at = lte.slice(4)
    assert.match(at, /\+00:00$/, 'dấu "+" của múi giờ phải được mã hoá, không thành khoảng trắng')
    const match = /^\(created_at\.lt\."([^"]+)",id\.lt\.(\d+)\)$/.exec(or)
    assert.ok(match, `or không đúng cú pháp: ${or}`)
    assert.equal(match[1], at)
    cursor = { at: Date.parse(at), id: Number(match[2]) }
  }
  return rows
    .filter(row => row.campaign_id === campaignId)
    .filter(row => !cursor || (Date.parse(row.created_at) <= cursor.at && (Date.parse(row.created_at) < cursor.at || row.id < cursor.id)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
    .slice(0, limit)
    .map(row => ({ id: row.id, created_at: row.created_at, target_url: row.target_url, raw_text: row.raw_text }))
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-group-cards-'))
  try {
    await build({
      entryPoints: [path.join(root, 'src/main/services/foundFacebookGroupCardService.ts')], outfile: path.join(dir, 'service.cjs'),
      bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
      plugins: [{ name: 'stubs', setup(b) {
        b.onResolve({ filter: /(^|\/)(currentUser|supabaseClient)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
        b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: stubs[args.path], loader: 'js', resolveDir: root }))
      } }]
    })
    const service = require(path.join(dir, 'service.cjs'))
    globalThis.__user = { staffId: 7, organizationId: 9 }
    let campaignRow = { id: 501, action_id: 'facebook_find_data_search' }
    let events = []
    let calls = []
    let failEvents = null
    globalThis.__fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url)
      if (url.pathname === '/rest/v1/auto_campaigns') {
        const params = url.searchParams
        assert.equal(params.get('select'), 'id,action_id')
        assert.equal(params.get('staff_id'), 'eq.7')
        assert.equal(params.get('organization_id'), 'eq.9')
        assert.equal(params.get('is_delete'), 'eq.false')
        return json(campaignRow && params.get('id') === `eq.${campaignRow.id}` ? [campaignRow] : [])
      }
      assert.equal(url.pathname, '/rest/v1/auto_campaign_run_events')
      if (failEvents) return failEvents(url, init)
      return json(serveEvents(url, events, calls))
    }

    // 3 lượt chạy ghi cả loạt (trùng created_at): 1.200 + 900 + 250 dòng, nhóm lặp lại giữa các lượt.
    const card = (n, text) => `Nhóm ${n} ${text}`
    let id = 1
    const batch = (second, count, text) => Array.from({ length: count }, (_, i) => ({
      id: id++, campaign_id: 501, created_at: ts(second),
      target_url: `https://www.facebook.com/groups/${1000 + i}/`, raw_text: card(i, text)
    }))
    events = [
      ...batch(0, 250, 'Công khai · 1,2K thành viên · 5 bài viết/ngày 2 người bạn là thành viên Tham gia'),
      ...batch(30, 900, 'Public · 1.3K members · 90+ posts a day Join'),
      ...batch(60, 1200, 'Công khai · 1,4K thành viên · 25 bài viết chưa đọc · Là thành viên từ tháng 2 năm 2026 Truy cập'),
      { id: id++, campaign_id: 501, created_at: ts(61), target_url: '', raw_text: 'Không có URL Công khai · 1 thành viên Tham gia' },
      { id: id++, campaign_id: 502, created_at: ts(62), target_url: 'https://www.facebook.com/groups/1000/', raw_text: 'Chiến dịch khác Riêng tư · 9 thành viên Tham gia' }
    ]
    let result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.data.scannedRows, 2351)
    assert.equal(result.data.truncated, false)
    assert.deepEqual(calls.map(call => call.lte ? call.lte.slice(4) : null), [null, ts(60), ts(30)])
    assert.equal(calls.length, 3)
    assert.equal(result.data.cards.length, 1200)
    const byKey = new Map(result.data.cards.map(entry => [entry.key, entry]))
    // Thẻ mới nhất (đã tham gia) thắng; số bài/bạn bè/… lấy từ thẻ cũ hơn còn có.
    assert.deepEqual(byKey.get('facebook.com/groups/1000'), { key: 'facebook.com/groups/1000', seenAt: ts(60), card: {
      name: 'Nhóm 0', privacy: 'Công khai', memberCount: 1400, unreadPosts: 25, memberSince: '02/2026', joinState: 'joined',
      postsPerDay: 90, postsText: '90+', friendMemberCount: 2 } })
    assert.deepEqual(byKey.get('facebook.com/groups/2100').card, { name: 'Nhóm 1100', privacy: 'Công khai', memberCount: 1400,
      unreadPosts: 25, memberSince: '02/2026', joinState: 'joined' })
    console.log('PASS đọc 3 trang qua nhóm dòng trùng created_at, không sót/không lặp, gộp thẻ mới nhất trước, bỏ dòng thiếu URL và chiến dịch khác')

    // Trần 60.000 dòng: dừng, trả phần mới nhất, đánh dấu truncated.
    id = 1
    events = Array.from({ length: 61 }, (_, s) => batch(s, 1000, 'Public · 2K members Join')).flat()
    calls = []
    result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.equal(result.ok, true)
    assert.equal(result.data.scannedRows, 60000)
    assert.equal(result.data.truncated, true)
    assert.equal(calls.length, 60)
    assert.equal(calls[1].lte.slice(4), ts(60), 'đọc từ mới nhất trở xuống')
    console.log('PASS trần 60.000 dòng: dừng đúng, giữ phần mới nhất, truncated')

    // Quá hạn sau trang đầu: trả phần đã đọc; quá hạn ngay trang đầu: báo lỗi hết giờ.
    const realTimeout = AbortSignal.timeout
    const quickTimeout = () => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), 30); return controller.signal }
    const hangUntilAbort = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)))
    AbortSignal.timeout = quickTimeout
    try {
      let page = 0
      failEvents = (url, init) => (page++ === 0 ? Promise.resolve(json(serveEvents(url, events, []))) : hangUntilAbort(url, init))
      result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
      assert.equal(result.ok, true)
      assert.equal(result.data.scannedRows, 1000)
      assert.equal(result.data.truncated, true)
      failEvents = hangUntilAbort
      result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
      assert.deepEqual([result.ok, result.code], [false, 'cards_timeout'])
    } finally {
      AbortSignal.timeout = realTimeout
    }
    failEvents = () => json({ code: '57014', message: 'canceling statement due to statement timeout' }, 500)
    result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.deepEqual([result.ok, result.code], [false, 'cards_unavailable'])
    assert.doesNotMatch(result.message, /statement|57014/)
    failEvents = null
    console.log('PASS quá hạn giữa chừng trả phần đã đọc, quá hạn từ đầu/lỗi DB báo câu tiếng Việt không lộ SQL')

    // Quyền và đầu vào.
    campaignRow = null
    result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.deepEqual([result.ok, result.code], [false, 'campaign_not_found'])
    campaignRow = { id: 501, action_id: 'facebook_find_data_group' }
    result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.deepEqual([result.ok, result.code], [false, 'unsupported_campaign'])
    campaignRow = { id: 501, action_id: 'facebook_find_data_search' }
    for (const bad of [0, -1, 1.5, '12a', null, undefined]) {
      result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: bad })
      assert.deepEqual([result.ok, result.code], [false, 'invalid_campaign_id'])
    }
    result = await service.handleFoundFacebookGroupCardsRequest(undefined)
    assert.deepEqual([result.ok, result.code], [false, 'invalid_campaign_id'])
    globalThis.__user = null
    result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.deepEqual([result.ok, result.code], [false, 'session_invalid'])
    globalThis.__user = { staffId: 7, organizationId: 9 }
    console.log('PASS chiến dịch không thuộc nhân viên/không phải tìm bằng search, ID sai, chưa đăng nhập')

    // Hai lượt bấm trùng nhau dùng chung một lượt đọc.
    id = 1
    events = batch(0, 10, 'Public · 2K members Join')
    calls = []
    const [a, b] = await Promise.all([
      service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 }),
      service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    ])
    assert.equal(calls.length, 1)
    assert.deepEqual(a, b)
    result = await service.handleFoundFacebookGroupCardsRequest({ campaignId: 501 })
    assert.equal(calls.length, 2, 'không cache sau khi xong')
    console.log('PASS gộp lượt trùng đang chạy, không cache kết quả')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
