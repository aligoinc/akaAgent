const assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')
const { _electron } = require('playwright')

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-data-validation-ui-'))
  let app
  try {
    await build({ entryPoints: [join(__dirname, 'campaign-data-validation-ui-smoke.tsx')], outdir: directory,
      bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'chrome120',
      define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.png': 'dataurl', '.svg': 'dataurl' }, logLevel: 'warning' })
    writeFileSync(join(directory, 'index.html'), '<!doctype html><html lang="vi"><meta charset="utf-8"><link rel="stylesheet" href="campaign-data-validation-ui-smoke.css"><body><div id="root"></div><script src="campaign-data-validation-ui-smoke.js"></script></body></html>')
    writeFileSync(join(directory, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false, width: 1550, height: 1100, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
      win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }));
      win.loadFile(${JSON.stringify(join(directory, 'index.html'))});
    });`)
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    app = await _electron.launch({ executablePath: require('electron'), args: [join(directory, 'main.cjs')], cwd: resolve(__dirname, '..'), env })
    const page = await app.firstWindow()
    page.setDefaultTimeout(10000)
    await page.waitForFunction(() => !!window.dataValidationSmoke)
    const form = page.locator('.campaign-full-modal')
    const save = form.getByRole('button', { name: 'Tạo chiến dịch', exact: true })
    const snapshot = () => page.evaluate(() => window.dataValidationSmoke.state)
    const open = async (scenario) => {
      await page.evaluate(value => window.dataValidationSmoke.open(value), scenario)
      await save.waitFor()
    }
    const waitForAlert = text => page.waitForFunction(value => window.dataValidationSmoke.state.alerts.some(alert => alert.message.includes(value)), text)
    const assertNoActivation = state => assert.equal(state.calls.filter(call => call.method === 'updateCampaign' && call.args[1]?.status === 'chờ xử lý').length, 0)

    await open({})
    await save.click()
    await waitForAlert('Có 1 data hợp lệ nhưng đang chia cho 3 tài khoản')
    assert.equal((await snapshot()).calls.filter(call => call.method === 'createCampaign').length, 0)
    assert.equal(await form.getByPlaceholder('Nhập tên chiến dịch...').inputValue(), 'Kiểm tra data rỗng')
    await page.screenshot({ path: '/tmp/akaagent-empty-split-validation.png' })
    console.log('PASS split: counts normalized targets, rejects 1 valid / 3 accounts before creating')

    await open({ rows: [{ uid: '', name: 'Chỉ có tên' }] })
    await save.click()
    await waitForAlert('Vui lòng chọn ít nhất một group Zalo.')
    assert.equal((await snapshot()).calls.filter(call => call.method === 'createCampaign').length, 0)
    await form.getByRole('button', { name: 'Lưu nháp', exact: true }).click()
    await page.waitForFunction(() => window.dataValidationSmoke.state.calls.some(call => call.method === 'saveCampaignDraft'))
    assert.equal((await snapshot()).calls.filter(call => call.method === 'createCampaign').length, 0)
    console.log('PASS empty: rejects creation but allows saving an unfinished draft')

    for (const insertedCount of [0, 1]) {
      await open({ formData: { accountIds: [11] }, rows: [{ uid: 'group-1' }, { uid: 'group-2' }], insertedCount })
      await save.click()
      await waitForAlert(`Không lưu đủ data chiến dịch (${insertedCount}/2 dòng)`)
      const state = await snapshot()
      const creates = state.calls.filter(call => call.method === 'createCampaign')
      assert.equal(creates.length, 1)
      assert.equal(creates[0].args[0].status, 'tạm dừng')
      assertNoActivation(state)
      assert.equal(state.calls.filter(call => call.method === 'completeCampaignDraft').length, 0)
      console.log(`PASS write count ${insertedCount}/2: stays paused, draft remains available`)
    }

    await open({ rows: [{ uid: 'group-1' }, { uid: 'group-2' }, { uid: 'group-3' }] })
    await save.click()
    await waitForAlert('Lưu chiến dịch thành công!')
    let state = await snapshot()
    assert.deepEqual(state.calls.filter(call => call.method === 'createCampaignInputDataBatch').map(call => call.args[0].length), [1, 1, 1])
    assert.equal(state.calls.filter(call => call.method === 'updateCampaign' && call.args[1]?.status === 'chờ xử lý').length, 3)
    assert.deepEqual(state.errors, [])
    // The production success callback closes after 1.2 seconds; let it finish before reopening.
    await form.waitFor({ state: 'detached' })
    console.log('PASS valid split: every account receives one row before activation')

    await open({ formData: { accountIds: [11], actionId: 'zalo_message_friend', zaloFriendTargetMode: 'all_friends' }, rows: [] })
    await save.click()
    await waitForAlert('Lưu chiến dịch thành công!')
    state = await snapshot()
    assert.equal(state.calls.filter(call => call.method === 'createCampaignInputDataBatch').length, 0)
    assert.equal(state.calls.filter(call => call.method === 'updateCampaign' && call.args[1]?.status === 'chờ xử lý').length, 1)
    assert.deepEqual(state.errors, [])
    console.log('PASS runtime source: all-friends campaign can materialize targets later')
    await form.waitFor({ state: 'detached' })

    for (const actionId of ['facebook_timeline_post', 'facebook_newsfeed_interaction']) {
      // Old drafts can retain one target and split=true while the Data section is hidden.
      await open({ formData: { accountIds: [41, 42, 43], actionId,
        ...(actionId === 'facebook_newsfeed_interaction' ? { enablePostLike: true, newsfeedLikeKind: 'Bài viết về sản phẩm', newsfeedLikeLimit: 1 } : {}) },
        rows: [{ uid: 'old-target' }] })
      await save.click()
      await waitForAlert('Lưu chiến dịch thành công!')
      state = await snapshot()
      assert.equal(state.calls.filter(call => call.method === 'createCampaignInputDataBatch').length, 0)
      assert.equal(state.calls.filter(call => call.method === 'updateCampaign' && call.args[1]?.status === 'chờ xử lý').length, 3)
      assert.deepEqual(state.errors, [])
      await form.waitFor({ state: 'detached' })
      console.log(`PASS ${actionId}: ignores stale hidden data/split settings and creates normally`)
    }

    const sourceItems = [41, 42, 43].map((accountId, index) => ({
      campaignPayload: { name: `Nguồn tìm data ${accountId}`, actionId: 'facebook_find_data_group', accountId,
        schedule: '2035-01-01T09:00:00+07:00', status: 'chờ xử lý', dataTargetSourceMode: 'direct',
        extraSettings: { isFindUid: true, isFindInGroupMembers: true, findUidTargetCampaignIds: [] } },
      details: index === 0 ? [{ uid: 'group-1' }] : [], dataGroupSnapshots: []
    }))
    const sourceScenario = items => ({
      formData: { actionId: 'facebook_message_uid', accountIds: [41], enableMessage: true },
      rows: [{ uid: 'target-1' }], values: { selectedFindDataSourceCampaignIds: [-5],
        internalCampaignDrafts: [{ tempId: -5, sourceType: 'findDataSource', actionId: 'facebook_find_data_group', items }] }
    })
    for (const invalidDetails of [[], [{ name: 'Chỉ có tên', uid: '  ' }]]) {
      const items = structuredClone(sourceItems)
      items[1].details = invalidDetails
      await open(sourceScenario(items))
      await save.click()
      await waitForAlert('Nguồn tìm data 42')
      state = await snapshot()
      assert(state.alerts.some(alert => alert.message.includes('chưa có group URL hợp lệ')))
      assert.equal(state.calls.filter(call => ['createCampaign', 'createCampaignInputDataBatch', 'updateCampaign', 'saveCampaignDraft', 'createCampaignCreationBundle'].includes(call.method)).length, 0)
      assert.equal(await form.getByPlaceholder('Nhập tên chiến dịch...').inputValue(), 'Kiểm tra data rỗng')
    }
    console.log('PASS stored bundle: empty/blank source children block the entire save before any write')

    const validItems = sourceItems.map((item, index) => ({ ...item, details: [{ uid: `  group-${index + 1}  ` }, { uid: '' }] }))
    await open(sourceScenario(validItems))
    await save.click()
    await waitForAlert('Lưu chiến dịch thành công!')
    state = await snapshot()
    const normalizedSourceWrites = state.calls.filter(call => call.method === 'createCampaignInputDataBatch').slice(1)
    assert.deepEqual(normalizedSourceWrites.map(call => call.args[0].map(row => row.uid)), [['group-1'], ['group-2'], ['group-3']])
    assert.equal(state.calls.filter(call => call.method === 'updateCampaign' && call.args[1]?.status === 'chờ xử lý').length, 4)
    await form.waitFor({ state: 'detached' })
    console.log('PASS stored bundle: validates and persists the same normalized child rows')

    for (const sourceMode of ['data_group', 'snapshot']) {
      const item = structuredClone(sourceItems[0])
      item.details = []
      if (sourceMode === 'data_group') Object.assign(item.campaignPayload, { dataTargetSourceMode: 'data_group', dataGroupId: 31 })
      else item.dataGroupSnapshots = [{ groupId: 31, groupName: 'Nhóm fixture' }]
      await open(sourceScenario([item]))
      await save.click()
      await waitForAlert('Lưu chiến dịch thành công')
      state = await snapshot()
      assert.equal(state.calls.filter(call => call.method === 'createCampaign').length, 2)
      assert.equal(state.calls.filter(call => call.method === (sourceMode === 'data_group' ? 'bindCampaignDataGroupSource' : 'snapshotDataGroupToCampaign')).length, 1)
      assert.equal(state.calls.filter(call => call.method === 'updateCampaign' && call.args[1]?.status === 'chờ xử lý').length, sourceMode === 'data_group' ? 2 : 1)
      await form.waitFor({ state: 'detached' })
    }
    console.log('PASS group sources: live binding stays allowed; empty snapshots stay paused')

    const targetCases = [
      ['facebook_message_uid', 'messageUidTarget', 'isFindUid', 'handleFoundUidData', 'findUidTargetCampaignIds'],
      ['facebook_comment_seeding_post', 'postLinkTarget', 'isFindPostLink', 'handleFoundPostLinkData', 'findPostLinkTargetCampaignIds'],
      ['zalo_message_phone', 'zaloMessagePhoneTarget', 'isFindPhone', 'handleFoundPhoneZaloMessagePhoneData', 'findPhoneZaloMessagePhoneTargetCampaignIds'],
      ['zalo_join_group_link', 'zaloJoinGroupLinkTarget', 'isFindLinkGroupZalo', 'handleFoundZaloGroupLinkJoinData', 'findZaloGroupLinkJoinTargetCampaignIds'],
      ['facebook_group_post', 'groupPostTarget', 'isFindFacebookGroup', 'handleFoundFacebookGroupPostData', 'findFacebookGroupPostTargetCampaignIds'],
      ['facebook_comment_seeding', 'groupCommentTarget', 'isFindFacebookGroup', 'handleFoundFacebookGroupCommentData', 'findFacebookGroupCommentTargetCampaignIds'],
      ['facebook_join_group', 'facebookJoinGroupTarget', 'isFindFacebookGroup', 'handleFoundFacebookGroupJoinData', 'findFacebookGroupJoinTargetCampaignIds'],
    ]
    const targetScenario = ([actionId, sourceType, flag, handler, field], details = []) => ({
      formData: { actionId: flag === 'isFindFacebookGroup' ? 'facebook_find_data_search' : 'facebook_find_data_group',
        accountIds: [41], isFindUid: false, isFindPhone: false, isFindLinkGroupZalo: false, isFindPostLink: false,
        isFindFacebookGroup: false, isFindInPost: true, isFindInComment: false, isFindInGroupMembers: false,
        isFindNewInteractors: false, [flag]: true, [field]: [-6] },
      rows: [{ uid: 'group-source' }],
      values: { findDataSearchKeywordsText: 'từ khóa fixture', [handler]: true,
        internalCampaignDrafts: [{ tempId: -6, sourceType, actionId, items: [{
          campaignPayload: { name: 'Chiến dịch nhận data', actionId, accountId: actionId.startsWith('zalo_') ? 11 : 41,
            schedule: '2035-01-01T09:00:00+07:00', status: 'chờ xử lý', dataTargetSourceMode: 'direct', content: 'Nội dung nhận data', extraSettings: {} },
          details, dataGroupSnapshots: []
        }] }] }
    })
    for (const target of targetCases) {
      await open(targetScenario(target))
      await save.click()
      await waitForAlert('Lưu chiến dịch thành công!')
      state = await snapshot()
      assert.equal(state.calls.filter(call => call.method === 'createCampaign').length, 2)
      assert.equal(state.calls.filter(call => call.method === 'createCampaignInputDataBatch').length, 1)
      const creates = state.calls.filter(call => call.method === 'createCampaign')
      const sourceId = state.calls.find(call => call.method === 'createCampaignInputDataBatch').args[0][0].campaignId
      assert(state.calls.some(call => call.method === 'updateCampaign' && call.args[0] === sourceId && call.args[1].extraSettings?.[target[4]]?.length === 1))
      assert.equal(creates[1].args[0].actionId, target[0])
      await form.waitFor({ state: 'detached' })
      console.log(`PASS linked target ${target[0]}: starts empty with an active producer link`)
    }

    const wrongTarget = targetScenario(targetCases[0])
    wrongTarget.values.internalCampaignDrafts[0].items[0].campaignPayload.actionId = 'zalo_message_phone'
    await open(wrongTarget)
    await save.click()
    await waitForAlert('chưa có SĐT Zalo hợp lệ')
    assert.equal((await snapshot()).calls.filter(call => call.method === 'createCampaign').length, 0)
    console.log('PASS mismatched link: a UID producer cannot exempt a phone target from initial data')

    await open(targetScenario(targetCases[2], [{ phone: '+84 90 123 45 67', name: '  Khách  ' }, { phone: '123' }]))
    await save.click()
    await waitForAlert('Lưu chiến dịch thành công!')
    state = await snapshot()
    const childWrite = state.calls.filter(call => call.method === 'createCampaignInputDataBatch')[1]
    assert.equal(childWrite.args[0].length, 1)
    assert.equal(childWrite.args[0][0].phone, '0901234567')
    assert.equal(childWrite.args[0][0].name, 'Khách')
    assert.deepEqual(state.errors, [])
    console.log('PASS per-action normalization: phone child uses phone rules even when the parent uses UID')
  } catch (error) {
    if (app) {
      const page = await app.firstWindow()
      console.error(await page.evaluate(() => ({ alerts: window.dataValidationSmoke?.state.alerts, errors: window.dataValidationSmoke?.state.errors })))
      await page.screenshot({ path: '/tmp/akaagent-data-validation-failure.png' })
    }
    throw error
  } finally {
    await app?.close()
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
