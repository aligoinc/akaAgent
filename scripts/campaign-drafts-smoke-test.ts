import assert from 'node:assert/strict'
import { restoreCampaignDraftValue, validateCampaignDraftPayload } from '../src/shared/campaignDrafts'
import { setCurrentUser, setCurrentUserCredentials } from '../src/main/data/currentUser'
import { saveCampaignDraft, getCampaignDraft, listCampaignDrafts, deleteCampaignDraft, completeCampaignDraft } from '../src/main/data/repositories/campaignDraftRepository'

async function main() {
  const old = { enabled: false, count: 0, content: '', nested: { selected: [] } }
  const hydrated = restoreCampaignDraftValue({ enabled: true, count: 10, content: 'default', newFeature: false,
    nested: { selected: [1], newField: 'new' } }, old)
  assert.deepEqual(hydrated, { enabled: false, count: 0, content: '', newFeature: false, nested: { selected: [], newField: 'new' } })
  assert.equal(restoreCampaignDraftValue({ value: 'default' }, { value: null }).value, null)
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"polluted":true}}')
  restoreCampaignDraftValue({}, malicious)
  assert.equal(({} as any).polluted, undefined)
  const snapshot = { version: 1, values: { formData: { name: 'Draft', actionId: 'facebook_message_uid', accountIds: [1], schedule: '2035-01-01T09:00' },
    details: [{ uid: '123' }], advancedContentSourceMode: 'manual', internalCampaignDrafts: [{ tempId: -1 }] } }
  validateCampaignDraftPayload(snapshot)
  assert.throws(() => validateCampaignDraftPayload({ ...snapshot, version: 2 }))
  assert.throws(() => validateCampaignDraftPayload({ ...snapshot, values: { formData: { ...snapshot.values.formData, accountIds: [] } } }))
  assert.throws(() => validateCampaignDraftPayload({ ...snapshot, values: { formData: { ...snapshot.values.formData, schedule: 'bad' } } }))
  const user = { staffId: 1, organizationId: 1 } as any
  setCurrentUser(user)
  setCurrentUserCredentials({ username: 'smoke', password: 'smoke-only' })
  const calls: any[] = []
  let allowedAccount = true
  const mock = (globalThis as any).draftSmoke = {
    getAccount: async (id: number) => allowedAccount ? { id } : null,
    ensureCurrentUserCanUseCampaignAction: async () => {},
    rpc: async (name: string, args: any) => {
      calls.push({ name, ...args })
      return { data: args.p_operation === 'list' ? { items: [], total: 0 } : { id: args.p_draft_id, payload: snapshot }, error: null }
    }
  }
  const request = { id: '61b21e19-7ed9-419f-af2c-fc124eea4c81', revision: 0, payload: snapshot }
  assert.deepEqual((await saveCampaignDraft(request)).payload, snapshot)
  assert.equal(calls.length, 1, 'saving only writes the draft snapshot')
  assert.equal(calls[0].p_operation, 'save')
  assert.equal(calls[0].p_staff_id, 1)
  assert.equal(calls[0].p_organization_id, 1)
  assert.equal(calls[0].p_auth_username, 'smoke')
  allowedAccount = false
  await assert.rejects(saveCampaignDraft(request), /Tài khoản/)
  assert.equal(calls.length, 1)
  await getCampaignDraft(request.id)
  await listCampaignDrafts(2)
  await deleteCampaignDraft(request.id)
  await assert.rejects(completeCampaignDraft({ id: request.id, revision: 1, campaignIds: [] }))
  await completeCampaignDraft({ id: request.id, revision: 1, campaignIds: [100, 101] })
  assert.deepEqual(calls.map(call => call.p_operation), ['save', 'get', 'list', 'delete', 'complete'])
  assert.deepEqual(calls.at(-1).p_data, { revision: 1, campaignIds: [100, 101] })
  mock.rpc = async () => ({ data: null, error: { message: 'ownership denied' } })
  await assert.rejects(getCampaignDraft(request.id), /ownership denied/)
  setCurrentUser(null)
  await assert.rejects(getCampaignDraft(request.id))
  console.log('PASS: snapshot/defaults, minimum validation, authenticated draft CRUD, account guard and completion metadata')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
