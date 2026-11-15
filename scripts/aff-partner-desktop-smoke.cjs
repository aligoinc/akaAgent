// Smoke: "Giới thiệu nhận hoa hồng" trên Desktop (docs/AFF_PARTNER_DESKTOP.md).
// Kiểm hợp đồng chép nguyên văn từ WebApp, repository với Supabase giả, kiểm origin trước khi mở link và công tắc menu.
// Chạy: node scripts/aff-partner-desktop-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')
const CONTRACT_MD5 = '98aa5a8355fcd9bd0ba0e087d20ac844'
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
    console.log('  ', error && error.message ? error.message : error)
  }
}

const CODE = 'AK7M2QX'
const TICKET = 'a'.repeat(64)
const activeRow = () => ({
  enabled: true,
  partner: { code: CODE, status: 'active', displayName: 'Anh A', pageUrl: `https://crm.akabiz.net/gt/${CODE}`, termsAcceptedAt: null, hasPayoutInfo: false },
  stats: { visits: 12, trials: 3, purchased: 1, commissionPending: 150000, commissionApproved: 0, commissionPaid: 0 },
  program: { visitWindowDays: 90, purchaseWindowDays: 90, holdDays: 30, minPayout: 200000, trialRewardMonthlyCap: 10 },
  defaultRate: { purchaseRate: 0.1, trialReward: 20000 },
  rates: [{ productId: 3, productName: 'akaAgent Facebook', purchaseRate: 0.15, trialReward: 30000 }],
  portalUrl: 'https://crm.akabiz.net/gia-han/doi-tac'
})

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-aff-partner-'))
  try {
    // Supabase giả: mỗi lượt rpc ghi lại tên hàm + tham số, trả lời theo `globalThis.__affRpc`.
    const fakeClient = join(dir, 'fakeSupabaseClient.js')
    writeFileSync(fakeClient, `
      exports.getSupabaseClient = () => ({
        rpc(name, args) {
          globalThis.__affCalls.push({ name, args })
          const answer = Promise.resolve().then(() => globalThis.__affRpc(name, args))
          return { abortSignal: () => answer, then: (a, b) => answer.then(a, b) }
        }
      })
    `)
    const fakeUser = join(dir, 'fakeCurrentUser.js')
    writeFileSync(fakeUser, `exports.requireCurrentUser = () => ({ staffId: 1, organizationId: 1, isAdminAkabiz: false })`)
    const redirect = {
      name: 'redirect',
      setup(b) {
        b.onResolve({ filter: /(^|\/)supabaseClient$/ }, () => ({ path: fakeClient }))
        b.onResolve({ filter: /(^|\/)currentUser$/ }, () => ({ path: fakeUser }))
      }
    }
    const entry = join(dir, 'entry.ts')
    writeFileSync(entry, `
      export * from ${JSON.stringify(join(ROOT, 'src/main/data/repositories/affPartnerRepository.ts'))}
      export { affPartnerSafePortalUrl, AffPartnerDesktopError } from ${JSON.stringify(join(ROOT, 'src/shared/affPartnerDesktop.ts'))}
      export { affPartnerVisibleFor, parseAffPartnerAudience } from ${JSON.stringify(join(ROOT, 'src/shared/affPartner.ts'))}
    `)
    const outfile = join(dir, 'bundle.cjs')
    await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [redirect] })
    const m = require(outfile)
    const warn = console.warn
    console.warn = () => {}

    const reset = handler => { globalThis.__affCalls = []; globalThis.__affRpc = handler }

    await group('hợp đồng affPartner.ts chép nguyên văn từ WebApp', () => {
      const source = readFileSync(join(ROOT, 'src/shared/affPartner.ts'))
      assert.equal(createHash('md5').update(source).digest('hex'), CONTRACT_MD5)
      const web = resolve(ROOT, '../akaAgentWebApp/packages/control-api/src/affPartner.ts')
      if (existsSync(web)) assert.ok(source.equals(readFileSync(web)), 'khác WebApp')
    })

    await group('tóm tắt: có mã → đối tác đang hoạt động, p_create truyền đúng', async () => {
      reset(() => ({ data: activeRow(), error: null }))
      const summary = await m.getAffPartnerSummary(true)
      assert.equal(summary.enabled, true)
      assert.equal(summary.partner.code, CODE)
      assert.equal(summary.rates.length, 1)
      assert.equal(summary.partner.hasPayoutInfo, false)
      assert.deepEqual(globalThis.__affCalls, [{ name: 'aka_agent_aff_partner', args: { p_create: true } }])
      reset(() => ({ data: activeRow(), error: null }))
      await m.getAffPartnerSummary(false)
      assert.deepEqual(globalThis.__affCalls[0].args, { p_create: false })
    })

    await group('tóm tắt: PGRST202 → not_installed, lỗi khác → unavailable, ném lỗi → unavailable', async () => {
      reset(() => ({ data: null, error: { code: 'PGRST202', message: 'not found' } }))
      assert.deepEqual(await m.getAffPartnerSummary(true), { enabled: false, reason: 'not_installed' })
      reset(() => ({ data: null, error: { code: '57014', message: 'timeout' } }))
      assert.deepEqual(await m.getAffPartnerSummary(true), { enabled: false, reason: 'unavailable' })
      reset(() => { throw new Error('fetch failed') })
      assert.deepEqual(await m.getAffPartnerSummary(true), { enabled: false, reason: 'unavailable' })
      reset(() => ({ data: { enabled: false, reason: 'off' }, error: null }))
      assert.deepEqual(await m.getAffPartnerSummary(true), { enabled: false, reason: 'off' })
    })

    await group('link quản lý: có vé, không vé, vé sai dạng', async () => {
      const withTicket = ticket => (name) => name === 'aka_agent_aff_partner'
        ? { data: activeRow(), error: null }
        : ticket
      reset(withTicket({ data: { ok: true, token: TICKET }, error: null }))
      let link = await m.getAffPartnerPortalLink()
      assert.equal(link.signed, true)
      assert.equal(link.url, `https://crm.akabiz.net/gia-han?t=${TICKET}&next=%2Fgia-han%2Fdoi-tac`)
      assert.deepEqual(globalThis.__affCalls.map(c => c.name), ['aka_agent_aff_partner', 'aka_agent_renewal_link_ticket'])
      assert.deepEqual(globalThis.__affCalls[0].args, { p_create: false })
      assert.deepEqual(globalThis.__affCalls[1].args, { p_organization_product_id: null })

      reset(withTicket({ data: null, error: { code: 'PGRST202' } }))
      link = await m.getAffPartnerPortalLink()
      assert.equal(link.signed, false)
      assert.equal(link.url, 'https://crm.akabiz.net/gia-han?next=%2Fgia-han%2Fdoi-tac')

      reset(withTicket({ data: { ok: true, token: 'xyz' }, error: null }))
      link = await m.getAffPartnerPortalLink()
      assert.equal(link.signed, false)
      assert.equal(new URL(link.url).searchParams.has('t'), false)
    })

    await group('link quản lý: không phải đối tác → lỗi, không xin vé', async () => {
      for (const data of [{ enabled: false, reason: 'off' }, { enabled: true, partner: null }]) {
        reset(() => ({ data, error: null }))
        await assert.rejects(m.getAffPartnerPortalLink(), error => error.code === 'aff_partner_not_partner' && /mã giới thiệu/.test(error.message))
        assert.deepEqual(globalThis.__affCalls.map(c => c.name), ['aka_agent_aff_partner'])
      }
    })

    await group('kiểm origin trước khi mở link', () => {
      const portal = 'https://crm.akabiz.net/gia-han/doi-tac'
      assert.equal(m.affPartnerSafePortalUrl('https://crm.akabiz.net/gia-han?next=%2Fgia-han%2Fdoi-tac', portal), 'https://crm.akabiz.net/gia-han?next=%2Fgia-han%2Fdoi-tac')
      assert.equal(m.affPartnerSafePortalUrl('https://evil.example/gia-han', portal), null)
      assert.equal(m.affPartnerSafePortalUrl('http://crm.akabiz.net/gia-han', portal), null)
      assert.equal(m.affPartnerSafePortalUrl('https://user:pw@crm.akabiz.net/gia-han', portal), null)
      assert.equal(m.affPartnerSafePortalUrl('https://crm.akabiz.net.evil.example/gia-han', portal), null)
      assert.equal(m.affPartnerSafePortalUrl('javascript:alert(1)', portal), null)
      assert.equal(m.affPartnerSafePortalUrl('https://crm.akabiz.net/gia-han', 'http://crm.akabiz.net/gia-han/doi-tac'), null)
      assert.equal(m.affPartnerSafePortalUrl(null, portal), null)
    })

    await group('ẩn/hiện mục menu theo cài đặt affiliate.program', () => {
      const visible = (raw, admin) => m.affPartnerVisibleFor(m.parseAffPartnerAudience(raw), admin)
      assert.equal(visible(undefined, true), false, 'thiếu dòng = ẩn')
      assert.equal(visible('{bad', true), false, 'sai JSON = ẩn')
      assert.equal(visible('{"audience":"off"}', true), false)
      assert.equal(visible('{"audience":"admin_akabiz"}', true), true)
      assert.equal(visible('{"audience":"admin_akabiz"}', false), false)
      assert.equal(visible('{"audience":"all"}', false), true)
      // Renderer nhận `affPartnerAudience` đã parse rồi parse lại dạng object.
      assert.equal(m.parseAffPartnerAudience({ audience: 'all' }), 'all')
      assert.equal(m.parseAffPartnerAudience({ audience: 'lạ' }), 'off')
    })

    await group('đọc cài đặt lúc đăng nhập có khoá affiliate.program, không thêm request', () => {
      const repo = readFileSync(join(ROOT, 'src/main/data/repositories/desktopUiRepository.ts'), 'utf8')
      assert.ok(/RENEWAL_REMINDER_SETTING_KEY, AFF_PARTNER_SETTING_KEY\]/.test(repo), 'khoá chưa nằm trong câu đọc cài đặt')
      assert.ok(/affPartnerAudience: parseAffPartnerAudience\(values\.get\(AFF_PARTNER_SETTING_KEY\)\)/.test(repo))
    })

    console.warn = warn
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} nhóm đạt, ${failed} nhóm lỗi`)
  if (failed) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
