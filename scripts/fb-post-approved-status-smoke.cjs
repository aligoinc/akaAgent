// Real scheduler -> policy resolver -> PostgreSQL WASM writer. No live sends.
const assert = require('node:assert/strict')
const { harness, step, result } = require('./action-status-mixed-output-smoke.cjs')
const pendingCode = 'campaign_detail_post_pending'
const approvedCode = 'campaign_detail_post_approved'
let scenarios = 0

async function run(zca, test) {
  const f = await harness(zca, test.timeline ? 'facebook_timeline_post' : 'facebook_group_post')
  try {
    Object.assign(f.scheduler, {
      syncGroupPostContactStatus: async () => {}, enqueuePostBumpAfterGroupPost: async () => {},
      cleanPostLinkForStorage: value => value
    })
    const url = 'https://www.facebook.com/groups/1/posts/2/'
    const steps = [step(1, 'fb_click_post_button', { posted: true })]
    if (!test.fallback) steps.push(step(2, 'fb_verify_group_post_form_closed', test.failed
      ? { posted: false, message: 'Existing fixture failure' }
      : { posted: true, ...(test.explicit ? { actionResult: result('fb_post_group', 'campaign_detail_success', {
        subStatusCode: test.explicit
      }) } : {}) }))
    steps.push(step(3, 'fb_get_first_group_post_link', { postUrl: url }))
    if (test.detector !== undefined) steps.push({ ...step(4, 'fb_detect_pending_post', test.detector),
      ...(test.detectorFailed ? { status: 'error' } : {}) })
    await f.final(steps)
    await f.finish()
    const rows = await f.details()
    assert.equal(rows.length, 1, test.name)
    const row = rows[0]
    const expected = test.expected == null ? null
      : (await f.db.query('SELECT id FROM auto_status WHERE code=$1', [test.expected])).rows[0].id
    assert.equal(row.sub_status_id, expected, test.name)
    assert.equal(row.policy_snapshot.subStatusId, expected, test.name)
    assert.equal(row.status, test.failed ? 'thất bại' : 'thành công', test.name)
    assert.equal(row.report_group, test.failed ? 'failure' : 'success', test.name)
    if (!test.failed) {
      assert.equal(row.counts_toward_limit, true)
      assert.equal(await f.quota(), 1)
      const pending = test.detector?.isPending === true
      assert.equal(row.log, `Đăng bài thành công vào Fixture group${pending ? ' (chờ duyệt)' : ''}`,
        'existing detail log remains unchanged')
      const policy = (await f.db.query('SELECT * FROM auto_account_action_status_policies WHERE id=$1',
        [row.action_status_policy_id])).rows[0]
      assert.equal(policy.action_code, null, 'secondary status uses the existing default success policy')
      assert.equal(policy.status_id, row.status_id)
    }
    const approved = (await f.db.query('SELECT id FROM auto_status WHERE code=$1', [approvedCode])).rows[0]
    assert.equal((await f.db.query('SELECT id FROM auto_account_action_status_policies WHERE status_id=$1',
      [approved.id])).rows.length, 0, 'no extra primary policy required for secondary status')
    scenarios++
  } finally { await f.close() }
}

async function main() {
  const zca = await import('zca-js')
  const cases = [
    { name: 'conclusive non-pending', detector: { isPending: false, pendingCheckConclusive: true }, expected: approvedCode },
    { name: 'pending', detector: { isPending: true, pendingCheckConclusive: true }, expected: pendingCode },
    { name: 'inconclusive false', detector: { isPending: false, pendingCheckConclusive: false }, expected: null },
    { name: 'legacy boolean false', detector: { isPending: false }, expected: approvedCode },
    { name: 'missing boolean', detector: { pendingCheckConclusive: true }, expected: null },
    { name: 'malformed boolean', detector: { isPending: 'false', pendingCheckConclusive: true }, expected: null },
    { name: 'public URL alone is insufficient', expected: null }
  ]
  for (const test of cases) {
    await run(zca, test)
    await run(zca, { ...test, name: `legacy fallback: ${test.name}`, fallback: true })
  }
  await run(zca, { name: 'failed detector cannot establish approval', detectorFailed: true,
    detector: { isPending: false, pendingCheckConclusive: true }, expected: null })
  await run(zca, { name: 'failed posting cannot inherit detector approval', failed: true,
    detector: { isPending: false, pendingCheckConclusive: true }, expected: null })
  await run(zca, { name: 'producer secondary wins', explicit: pendingCode,
    detector: { isPending: false, pendingCheckConclusive: true }, expected: pendingCode })
  await run(zca, { name: 'explicit DB producer can choose approval without a new app mapping', explicit: approvedCode,
    detector: { isPending: false, pendingCheckConclusive: true }, expected: approvedCode })
  await run(zca, { name: 'timeline unchanged', fallback: true, timeline: true,
    detector: { isPending: false, pendingCheckConclusive: true }, expected: null })
  console.log(JSON.stringify({ scenarios, external_operations: 0 }))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
