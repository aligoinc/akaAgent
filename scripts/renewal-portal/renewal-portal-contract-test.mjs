// Kiểm hợp đồng màn Gia hạn mà không cần DB/Edge/CRM chạy thật:
// 1) hàm phân loại src/shared/renewalPortal.ts (trang nào, sản phẩm trọng tâm);
// 2) helper ký link supabase/functions/_shared/renewalPortalLink.ts khớp quy tắc
//    verifyRenewalLinkToken của CRM (HS256, aud, sub, iat/exp ≤ 24h, opid).
// Tuỳ chọn: CRM_REPO=<checkout SqlServerDashboard đã npm ci> để xác minh bằng chính
// thư viện jsonwebtoken của CRM.
//   node scripts/renewal-portal/renewal-portal-contract-test.mjs
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
async function load(entry) {
  const result = await build({ entryPoints: [join(root, entry)], bundle: true, format: 'esm', platform: 'neutral', write: false, logLevel: 'silent' })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)
}

const portal = await load('src/shared/renewalPortal.ts')
const link = await load('supabase/functions/_shared/renewalPortalLink.ts')
let passed = 0
const test = async (name, fn) => { await fn(); passed += 1; console.log(`PASS ${name}`) }

const DAY = 86_400_000
const today = Date.parse('2026-11-04T00:00:00+07:00')
const iso = ms => new Date(ms).toISOString()
const row = (id, productId, packageType, expirationMs) => ({ id, product_id: productId, package_type: packageType, expiration_date: expirationMs == null ? null : iso(expirationMs) })

await test('chỉ còn dùng thử hết hạn → Hết hạn dùng thử, trọng tâm dòng mới hết hạn nhất', () => {
  const r = portal.classifyRenewalRequirement([row(1, 3, 'demo', today - 10 * DAY), row(2, 16, 'demo', today - 2 * DAY)], today, 'dung')
  assert.equal(r.kind, 'trial_expired')
  assert.equal(r.focusOrganizationProductId, 2)
  assert.deepEqual(r.products.map(p => p.displayName), ['Zalo', 'Facebook'])
  assert.equal(r.username, 'dung')
})

await test('có gói trả phí hết hạn → Hết hạn gói, ưu tiên hơn dùng thử', () => {
  const r = portal.classifyRenewalRequirement([row(1, 16, 'demo', today - DAY), row(2, 3, '2month', today - 30 * DAY)], today, 'u')
  assert.equal(r.kind, 'package_expired')
  assert.equal(r.focusOrganizationProductId, 2)
  assert.equal(r.focusProduct.isTrial, false)
})

await test('không có sản phẩm akaAgent → Nâng cấp, không opid', () => {
  const r = portal.classifyRenewalRequirement([row(9, 5, 'year', today - DAY), row(8, 4, 'year', today + DAY)], today, 'u')
  assert.equal(r.kind, 'no_package')
  assert.equal(r.focusOrganizationProductId, null)
  assert.equal(r.focusProduct, null)
})

await test('Facebook product 10 mới hết hạn hơn vẫn mở trang product 3 (CRM không bán gói 10)', () => {
  const r = portal.classifyRenewalRequirement([row(3, 3, 'year', today - 40 * DAY), row(10, 10, '2month', today - DAY)], today, 'u')
  assert.equal(r.focusOrganizationProductId, 3)
  assert.equal(r.products.length, 1)
})

await test('package_type rỗng/null là dùng thử như CRM; hạn đúng đầu ngày VN vẫn còn hạn', () => {
  const r = portal.classifyRenewalRequirement([row(1, 13, null, today - DAY), row(2, 17, '', today - 2 * DAY), row(3, 18, 'year', today)], today, 'u')
  assert.equal(r.kind, 'trial_expired')
  assert.deepEqual(r.products.map(p => p.displayName).sort(), ['Email', 'akaAgent SMS'])
})

await test('nhóm còn hạn bị loại khỏi danh sách cần gia hạn', () => {
  const r = portal.classifyRenewalRequirement([row(1, 16, 'year', today + 5 * DAY), row(2, 18, 'demo', today - DAY), row(3, 3, 'year', today - DAY)], today, 'u')
  assert.equal(r.kind, 'package_expired')
  assert.deepEqual(r.products.map(p => p.displayName), ['Facebook'])
})

await test('URL cổng: chỉ nhận /gia-han của crm.akabiz.net; link dự phòng giữ trang đích', () => {
  assert.equal(portal.isRenewalPortalUrl('https://crm.akabiz.net/gia-han?t=a.b.c'), true)
  assert.equal(portal.isRenewalPortalUrl('https://crm.akabiz.net/gia-han/nang-cap'), true)
  assert.equal(portal.isRenewalPortalUrl('https://crm.akabiz.net/api/public/renewal/link'), false)
  assert.equal(portal.isRenewalPortalUrl('https://evil.example/gia-han'), false)
  assert.equal(portal.isRenewalPortalUrl('https://u:p@crm.akabiz.net/gia-han'), false)
  assert.equal(portal.renewalManualLoginUrl('package_expired'), 'https://crm.akabiz.net/gia-han?next=%2Fgia-han%2Fhet-han-goi')
})

const secret = 'x'.repeat(40)
const now = 1793430000

await test('thiếu khóa hoặc khóa < 32 ký tự → RenewalLinkUnavailable', async () => {
  await assert.rejects(link.createRenewalPortalLink({ staffId: 1, secret: '' }), link.RenewalLinkUnavailable)
  await assert.rejects(link.createRenewalPortalLink({ staffId: 1, secret: 'y'.repeat(31) }), link.RenewalLinkUnavailable)
  await assert.rejects(link.createRenewalPortalLink({ staffId: 0, secret }), /renewal_link_invalid_staff/)
})

let signed
await test('JWT HS256 khớp quy tắc verifyRenewalLinkToken của CRM', async () => {
  signed = await link.createRenewalPortalLink({ staffId: 1520, organizationProductId: 6034, secret: `  ${secret}\n`, nowSeconds: now })
  const url = new URL(signed.url)
  assert.equal(url.origin + url.pathname, 'https://crm.akabiz.net/gia-han')
  const token = url.searchParams.get('t')
  const [header, payload, signature] = token.split('.')
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'HS256', typ: 'JWT' })
  assert.equal(createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url'), signature)
  const claims = JSON.parse(Buffer.from(payload, 'base64url'))
  assert.deepEqual(claims, { aud: 'akabiz-renewal-link', sub: '1520', iat: now, exp: now + 600, opid: 6034 })
  assert.equal(signed.expiresAt, new Date((now + 600) * 1000).toISOString())
})

await test('TTL bị kẹp trong 60 giây – 24 giờ; origin lạ quay về crm.akabiz.net', async () => {
  const long = await link.createRenewalPortalLink({ staffId: 9, secret, nowSeconds: now, ttlSeconds: 3 * 86400, origin: 'http://crm.akabiz.net' })
  const claims = JSON.parse(Buffer.from(new URL(long.url).searchParams.get('t').split('.')[1], 'base64url'))
  assert.equal(claims.exp - claims.iat, 86400)
  assert.equal(claims.opid, undefined)
  assert.ok(long.url.startsWith('https://crm.akabiz.net/gia-han?t='))
})

await test('opid chỉ nhận dòng sản phẩm akaAgent của tổ chức', () => {
  const products = [{ id: 11, product_id: 3 }, { id: 12, product_id: 5 }, { id: '13', product_id: '16' }]
  assert.equal(link.pickRenewalOrganizationProductId(products, 11), 11)
  assert.equal(link.pickRenewalOrganizationProductId(products, 12), null)
  assert.equal(link.pickRenewalOrganizationProductId(products, 13), 13)
  assert.equal(link.pickRenewalOrganizationProductId(products, '11'), null)
  assert.equal(link.pickRenewalOrganizationProductId(products, 99), null)
  assert.equal(link.pickRenewalOrganizationProductId(null, 11), null)
})

if (process.env.CRM_REPO) {
  await test('jsonwebtoken của CRM xác minh được link', () => {
    const jwt = createRequire(join(resolve(process.env.CRM_REPO), 'package.json'))('jsonwebtoken')
    const token = new URL(signed.url).searchParams.get('t')
    const verified = jwt.verify(token, secret, { algorithms: ['HS256'], audience: 'akabiz-renewal-link', clockTimestamp: now + 30, clockTolerance: 60 })
    assert.equal(verified.sub, '1520')
    assert.equal(verified.opid, 6034)
    assert.throws(() => jwt.verify(token, 'z'.repeat(40), { algorithms: ['HS256'], audience: 'akabiz-renewal-link', clockTimestamp: now }))
  })
} else {
  console.log('SKIP jsonwebtoken của CRM (đặt CRM_REPO=<checkout SqlServerDashboard> để chạy)')
}

console.log(`${passed} PASS`)
