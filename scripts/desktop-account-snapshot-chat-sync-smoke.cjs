// Smoke: màn tài khoản Desktop gửi `p_access.chatSync` cho `aka_agent_desktop_account_snapshot` theo nơi giữ phiên của tài khoản
// Server (14/11/2026). DB dùng cờ này để tính `hasZaloSession` của tài khoản Server: true thì theo `login_status` (phiên ở ChatApi),
// false thì theo `auto_accounts.zalo_session` (phiên App Server). Tổ chức không Chat chạy Server trên Fly theo cờ engine v2 cũng giữ
// phiên ở ChatApi, nên phải gửi true như tổ chức có Chat (cùng điều kiện `serverAccountsUseChatApi` của `mapAccountFromDB`).
// Chạy: node scripts/desktop-account-snapshot-chat-sync-smoke.cjs [đường dẫn desktopUiRepository.ts khác để đối chứng]
'use strict'
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const ROOT = resolve(__dirname, '..')
const ENTRY = resolve(process.argv[2] || join(ROOT, 'src/main/data/repositories/desktopUiRepository.ts'))

// Thay các module đọc Supabase / phiên bằng bản giả đọc từ globalThis.__stub; module trong src/shared dựng thật.
const STUBS = {
  '../supabaseClient': 'export const getSupabaseClient = () => globalThis.__stub.client',
  '../currentUser': `export const requireCurrentUser = () => globalThis.__stub.user
export const requireCurrentUserCredentials = () => ({ username: 'staff', password: 'secret' })`,
  './entitlementRepository': `export const loadCurrentUserEffectiveEntitlements = async () => globalThis.__stub.user.entitlements
export const loadCurrentUserZaloAccountCapabilities = () => globalThis.__stub.user.zaloAccountCapabilities`,
  '../mappers': 'export const mapAccountFromDB = row => row\nexport const mapCampaignConfigFromDB = row => row',
  './campaignRepository': `export const listCampaignSummariesForPage = async () => []
export const attachCampaignSecondaryAccountNames = async rows => rows
export const attachCampaignDataGroupSourceSummaries = async rows => rows`
}

const stubPlugin = {
  name: 'stubs',
  setup(b) {
    b.onResolve({ filter: /.*/ }, args => (Object.hasOwn(STUBS, args.path) ? { path: args.path, namespace: 'stub' } : undefined))
    b.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: STUBS[args.path], loader: 'js' }))
  }
}

let checks = 0
let failures = 0
const pass = label => { checks++; console.log('PASS', label) }
const fail = (label, err) => { failures++; console.log('FAIL', label, '-', err.message) }

const user = over => ({
  staffId: 7, organizationId: 526, isChatSync: false, zaloServerOnFly: false,
  appAccess: { separateAccess: false }, entitlements: { zalo: true, facebookCore: false },
  zaloAccountCapabilities: { qr: true, web: false, server: true }, ...over
})

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-account-snapshot-'))
  try {
    const outfile = join(dir, 'desktopUiRepository.cjs')
    await build({ entryPoints: [ENTRY], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent', plugins: [stubPlugin] })
    const { getDesktopAccountSnapshot } = require(outfile)

    const calls = []
    globalThis.__stub = {
      user: null,
      client: {
        rpc(name, args) {
          calls.push({ name, args })
          return { abortSignal: async () => ({ data: { version: 'v', states: [], catalog: null }, error: null }) }
        }
      }
    }
    const access = async u => {
      globalThis.__stub.user = u
      calls.length = 0
      await getDesktopAccountSnapshot()
      assert.equal(calls.length, 1)
      assert.equal(calls[0].name, 'aka_agent_desktop_account_snapshot')
      return calls[0].args
    }

    const cases = [
      ['tổ chức có Chat: chatSync true (như trước)', user({ isChatSync: true }), true],
      ['không Chat, cờ engine v2 bật, có gói Server: chatSync true (phiên ở ChatApi)', user({ zaloServerOnFly: true }), true],
      ['không Chat, cờ tắt: chatSync false (phiên App Server, như trước)', user({ zaloServerOnFly: false }), false],
      ['cờ bật nhưng chưa có gói Server: chatSync false (chưa có tài khoản Server)', user({ zaloServerOnFly: true, zaloAccountCapabilities: { qr: true, web: false, server: false } }), false],
      ['tách quyền app không dùng Chat: chatSync false (như trước)', user({ zaloServerOnFly: true, appAccess: { separateAccess: true } }), false]
    ]
    for (const [label, u, expected] of cases) {
      try {
        const args = await access(u)
        assert.equal(args.p_access.chatSync, expected, `chatSync phải là ${expected}`)
        assert.equal(args.p_staff_id, u.staffId)
        assert.equal(args.p_organization_id, u.organizationId)
        assert.equal(args.p_access.zalo, true, 'vẫn gửi quyền gói')
        assert.equal(args.p_access.server, u.zaloAccountCapabilities.server, 'vẫn gửi quyền loại tài khoản Zalo')
        assert.equal(args.p_catalog_version, null)
        pass(label)
      } catch (err) {
        fail(label, err)
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${checks} ca đạt, ${failures} ca lỗi (${ENTRY.replace(ROOT + '/', '')})`)
  if (failures) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
