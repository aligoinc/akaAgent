const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-support-access-'))
  try {
    const output = join(directory, 'access.cjs')
    await build({
      stdin: { contents: `
        export { requireCampaignSupportAccess } from './src/main/data/repositories/campaignRepository';
        export { setCurrentUser } from './src/main/data/currentUser';
      `, resolveDir: resolve(__dirname, '..') },
      outfile: output, bundle: true, platform: 'node', format: 'cjs', target: 'node20',
      external: ['electron', 'better-sqlite3'], logLevel: 'warning',
      plugins: [{ name: 'isolated-campaign-access-db', setup(plugin) {
        plugin.onResolve({ filter: /\/supabaseClient$/ }, () => ({ path: 'db', namespace: 'support-access' }))
        plugin.onLoad({ filter: /.*/, namespace: 'support-access' }, () => ({ contents: `
          export const getSupabaseClient = () => globalThis.__campaignSupportAccessDb;
          export const getSupabaseUrl = () => 'https://mock.invalid';
        ` }))
      } }]
    })
    const { requireCampaignSupportAccess, setCurrentUser } = require(output)
    const user = { staffId: 7, organizationId: 1,
      entitlements: { facebookCore: true, facebookFanpage: true, zalo: true, email: true, sms: true },
      zaloAccountCapabilities: { qr: true, web: true, server: true } }
    const campaign = { id: 17, staff_id: 7, organization_id: 1, is_delete: false,
      action_id: 'facebook_message_uid', primary_account: { flatform_type: 'facebook' } }
    let row = campaign
    let dbError = null
    const queries = []
    // Keep root columns distinct from relation columns, as in the live schema.
    const campaignColumns = new Set(['id', 'name', 'action_id', 'account_id', 'staff_id', 'organization_id', 'is_delete'])
    const accountColumns = new Set(['name', 'flatform_type', 'is_zalo_show_web', 'is_zalo_server'])
    function checkProjection(select) {
      const root = select.replace(/primary_account:auto_accounts!auto_campaigns_account_id_fkey\(([^)]+)\)/g, (_match, fields) => {
        fields.split(',').forEach(field => assert(accountColumns.has(field.trim()), `Unknown account column: ${field}`))
        return ''
      })
      for (const field of root.split(',').map(field => field.trim()).filter(Boolean)) {
        if (!campaignColumns.has(field)) return { code: '42703', message: `column auto_campaigns.${field} does not exist` }
      }
      return null
    }
    globalThis.__campaignSupportAccessDb = { from(table) {
      assert.equal(table, 'auto_campaigns')
      const query = { filters: [], select: '' }
      const builder = {
        select(value) { query.select = value; return builder },
        eq(column, value) { query.filters.push([column, value]); return builder },
        async maybeSingle() {
          queries.push(query)
          const error = dbError || checkProjection(query.select)
          return { error, data: !error && query.filters.every(([field, value]) => row[field] === value) ? row : null }
        }
      }
      return builder
    } }
    setCurrentUser(user)
    await requireCampaignSupportAccess(17, 7, 1)
    assert.deepEqual(queries[0].filters, [['id', 17], ['staff_id', 7], ['organization_id', 1], ['is_delete', false]])
    assert(!queries[0].select.includes('*'), 'access check must not load full campaign content or logs')
    for (const patch of [{ id: 18 }, { staff_id: 8 }, { organization_id: 2 }, { is_delete: true }]) {
      row = { ...campaign, ...patch }
      await assert.rejects(requireCampaignSupportAccess(17, 7, 1), /quyền/)
    }
    for (const [platform, action] of [['zalo', 'zalo_message_phone'], ['sms', 'sms_send'], ['sms', 'voice_call'], ['email', 'email_send']]) {
      row = { ...campaign, action_id: action, primary_account: { flatform_type: platform } }
      await requireCampaignSupportAccess(17, 7, 1)
      setCurrentUser({ ...user, entitlements: { ...user.entitlements, [platform]: false } })
      await assert.rejects(requireCampaignSupportAccess(17, 7, 1), /quyền/)
      setCurrentUser(user)
    }
    for (const [capability, flags] of [['qr', {}], ['web', { is_zalo_show_web: true }], ['server', { is_zalo_server: true }]]) {
      row = { ...campaign, action_id: 'zalo_message_phone', primary_account: { flatform_type: 'zalo', ...flags } }
      await requireCampaignSupportAccess(17, 7, 1)
      const deniedCapabilities = { ...user.zaloAccountCapabilities, [capability]: false }
      if (capability === 'qr') deniedCapabilities.web = false // Web capability also grants QR.
      setCurrentUser({ ...user, zaloAccountCapabilities: deniedCapabilities })
      await assert.rejects(requireCampaignSupportAccess(17, 7, 1), /quyền/)
      setCurrentUser(user)
    }
    row = { ...campaign, action_id: null, primary_account: { flatform_type: 'zalo' } }
    setCurrentUser({ ...user, entitlements: { ...user.entitlements, facebookCore: false, facebookFanpage: false } })
    await requireCampaignSupportAccess(17, 7, 1)
    dbError = { code: '08006', message: 'Temporary DB failure' }
    await assert.rejects(requireCampaignSupportAccess(17, 7, 1), /Không kiểm tra được quyền/)
    setCurrentUser(null)
    console.log('PASS campaign support access: real repository query, campaign/account schema, tenant/staff/deleted guards, entitlements and Zalo subtypes')
  } finally {
    delete globalThis.__campaignSupportAccessDb
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
