import assert from 'node:assert/strict'
import { CAMPAIGN_DRAFT_SCHEDULE_TIME_ZONE, getPreservedCampaignDraftSchedule, preserveCampaignEndDate, preserveCampaignSchedule, restoreCampaignDraftSchedule, restoreCampaignDraftValue, validateCampaignDraftPayload } from '../src/shared/campaignDrafts'
import { formatScheduleVietnam, scheduleVietnamToIso } from '../src/shared/campaignScheduleAi'
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
  const originalZone = process.env.TZ
  try {
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = zone
      for (const raw of ['2035-01-01T08:00', '2035-01-01T01:30', '2035-01-01T23:30', '2035-07-01T08:00', '2026-03-08T02:30', '2026-11-01T01:30']) {
        const legacy = { ...snapshot, values: { ...snapshot.values, formData: {
          ...snapshot.values.formData, schedule: raw, scheduleEndDate: '2035-07-10', scheduleWeekDays: '2,4,6'
        } } }
        const before = JSON.stringify(legacy)
        const expectedIso = new Date(raw).toISOString()
        const restored = restoreCampaignDraftSchedule(legacy)!
        const form = restored.values.formData as typeof legacy.values.formData
        assert.equal(scheduleVietnamToIso(form.schedule), expectedIso, `${zone}: preserve the old save instant`)
        assert.equal(restored.scheduleTimeZone, CAMPAIGN_DRAFT_SCHEDULE_TIME_ZONE)
        assert.equal(JSON.stringify(legacy), before, 'opening must not mutate the saved draft')
        const expectedEnd = new Date(`${legacy.values.formData.scheduleEndDate}T23:59:59`)
        assert.equal(form.scheduleEndDate, formatScheduleVietnam(expectedEnd).slice(0, 10))
        assert.equal(getPreservedCampaignDraftSchedule(restored.preservedSchedule, form)?.end?.iso
          ?? scheduleVietnamToIso(`${form.scheduleEndDate}T23:59:59`), expectedEnd.toISOString())
        assert.deepEqual({ ...form, schedule: raw, scheduleEndDate: legacy.values.formData.scheduleEndDate }, legacy.values.formData, 'other fields remain unchanged')
        assert.equal(restored.values.details, legacy.values.details)
        assert.equal(restoreCampaignDraftSchedule(restored), restored, 'normalize at most once')
        validateCampaignDraftPayload(restored)
        process.env.TZ = zone === 'UTC' ? 'Asia/Ho_Chi_Minh' : 'UTC'
        const reopened = restoreCampaignDraftSchedule(JSON.parse(JSON.stringify(restored)))!
        assert.equal(scheduleVietnamToIso((reopened.values.formData as typeof form).schedule), expectedIso, 'tagged drafts are independent of the host timezone')
        process.env.TZ = zone
      }
      for (const test of [{ text: '14h, 8:00, 8h', first: '08:00' }, { text: '20:00,22:00', first: '20:00' }]) {
        const legacy = { ...snapshot, values: { ...snapshot.values, formData: {
          ...snapshot.values.formData, actionId: 'facebook_timeline_post', schedule: '2035-01-01T23:30',
          multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: test.text, scheduleType: 'weekly', scheduleEndDate: '2035-01-10'
        } } }
        const expectedStart = new Date(`2035-01-01T${test.first}`).toISOString()
        const expectedEnd = new Date('2035-01-10T23:59:59').toISOString()
        const restored = restoreCampaignDraftSchedule(legacy)!
        const form = restored.values.formData as typeof legacy.values.formData
        const getKept = (value: Record<string, unknown>) => getPreservedCampaignDraftSchedule(restored.preservedSchedule, value)
        assert.equal(scheduleVietnamToIso(form.schedule), expectedStart, 'display the actual legacy first run, not the ignored time field')
        assert.equal(form.multiDailyTimeSlots, test.text, 'do not shift recurring runtime slots')
        assert.equal(getKept(form)?.multiSlotStart?.iso ?? scheduleVietnamToIso(`${form.schedule.split('T')[0]}T${test.first}`), expectedStart)
        assert.equal(getKept(form)?.end?.iso ?? scheduleVietnamToIso(`${form.scheduleEndDate}T23:59:59`), expectedEnd)
        if (zone !== 'Asia/Ho_Chi_Minh') {
          assert.equal(getKept({ ...form, name: 'Changed name' })?.multiSlotStart?.iso, expectedStart)
          for (const change of [{ schedule: '2035-02-01T12:00' }, { multiDailyTimeSlots: '09:00,16:00' },
            { multiDailyTimeSlotsEnabled: false }, { dataTargetSourceMode: 'data_group' }, { actionId: 'facebook_group_post' }]) {
            assert.equal(getKept({ ...form, ...change })?.multiSlotStart, undefined, 'edited scheduling input must release the old start')
            assert.equal(getKept({ ...form, ...change })?.end?.iso, expectedEnd, 'start edits must not change the cutoff')
          }
          assert.equal(getKept({ ...form, scheduleEndDate: '2035-02-10' })?.end, undefined)
          assert.equal(getKept({ ...form, scheduleEndDate: '' })?.end, undefined)
          assert.equal(getKept({ ...form, scheduleEndDate: '' })?.multiSlotStart?.iso, expectedStart)
        }
        process.env.TZ = zone === 'UTC' ? 'Asia/Ho_Chi_Minh' : 'UTC'
        const reopened = restoreCampaignDraftSchedule(JSON.parse(JSON.stringify(restored)))!
        assert.deepEqual(reopened, JSON.parse(JSON.stringify(restored)), 'preserve exact instants across draft round-trips')
        process.env.TZ = zone
      }
    }
    for (const raw of ['', 'invalid', '2035-01-01T']) {
      const malformed = { ...snapshot, values: { formData: { ...snapshot.values.formData, schedule: raw } } }
      assert.equal(restoreCampaignDraftSchedule(malformed), malformed, 'do not invent a date for invalid drafts')
    }
    assert.equal(restoreCampaignDraftSchedule(undefined), undefined)
    assert.equal(preserveCampaignEndDate('2035-01-10T16:59:59Z'), undefined, 'normal Vietnam cutoff needs no override')
    assert.equal(preserveCampaignEndDate('invalid'), undefined)
    const existingForm = { schedule: '2035-01-01T15:00', actionId: 'facebook_timeline_post',
      multiDailyTimeSlotsEnabled: true, multiDailyTimeSlots: '08:00,14:00', scheduleEndDate: '2035-01-11' }
    const existing = preserveCampaignSchedule(existingForm, '2035-01-01T08:00:00Z', '2035-01-10T23:59:59Z')
    assert.equal(getPreservedCampaignDraftSchedule(existing, existingForm)?.multiSlotStart?.iso, '2035-01-01T08:00:00.000Z')
    assert.equal(preserveCampaignSchedule({ ...existingForm, schedule: '2035-02-01T12:00' },
      '2035-01-01T08:00:00Z')?.multiSlotStart, undefined, 'clone/new dates cannot inherit the source start')
  } finally {
    if (originalZone === undefined) delete process.env.TZ
    else process.env.TZ = originalZone
  }
  console.log('PASS: legacy draft timezone preservation, date rollover/DST, immutable restore, tagged round-trip across timezones')
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
