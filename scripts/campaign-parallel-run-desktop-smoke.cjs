// "Chạy cùng lúc" (V670) trên Desktop: bộ lập lịch thật (src/main/services/campaignScheduler.ts dựng bằng esbuild như bộ kiểm engine
// Facebook) với bộ chạy engine giả ghi lại thời điểm chạy của từng làn, cổng DB giả (không PostgreSQL, không mạng).
//   1. Không chiến dịch nào tích: một hàng đợi như trước, không đọc danh sách loại được bật, không mở làn riêng.
//   2. Có tích: chiến dịch phụ chạy ở làn riêng cùng lúc với hàng đợi chính; cùng loại thì lần lượt trong một làn.
//   3. Loại chưa được bật / engine không chạy được / tài khoản Server / App Server: về hàng đợi chính.
//   4. Hàng đợi chính gặp parallel_wait thì dừng, giữ thứ tự lịch; tài khoản "đang chạy" vì làn riêng của máy này vẫn nhận hàng đợi chính.
//   5. Bộ cũ và làn riêng chờ nhau (claim bộ cũ đòi tài khoản "chờ xử lý"); chờ dừng, giữ tài khoản cho việc ngoài, ảnh chụp heartbeat.
//   6. Nút "Lý do đang chờ": chiến dịch ở làn riêng không bị coi là bận vì hàng đợi chính; câu chờ đúng câu anh duyệt.
// Chạy: node scripts/campaign-parallel-run-desktop-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { ROOT, loadScheduler } = require('./engine-v2-facebook/desktop-harness.cjs')

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const ALLOWED = ['zalo_cancel_sent_friend_request', 'zalo_add_group_member', 'zalo_join_group_link']

async function loadShared() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-parallel-shared-'))
  const outfile = path.join(out, 'shared.cjs')
  fs.writeFileSync(path.join(out, 'entry.ts'), [
    `export * from ${JSON.stringify(path.join(ROOT, 'src/shared/campaignParallelRun.ts'))}`,
    `export { engineWaitMessage } from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/engineWaitReason.ts'))}`,
    `export { campaignRunLane, PARALLEL_RUN_MAIN_LANE } from ${JSON.stringify(path.join(ROOT, 'packages/campaign-engine/src/parallelRun.ts'))}`
  ].join('\n'))
  await build({ entryPoints: [path.join(out, 'entry.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error' })
  return require(outfile)
}

function account(id, extra = {}) {
  return { id, name: `TK ${id}`, flatformType: 'zalo', status: 'chờ xử lý', loginStatus: 'đã đăng nhập', isActive: true, isDelete: false,
    isZaloServer: false, isZaloShowWeb: false, staffId: 9, organizationId: 1, ...extra }
}

let nextCampaign = 100
function campaign(accountId, actionId, extra = {}) {
  const id = ++nextCampaign
  return { id, name: `CD ${id}`, actionId, accountId, status: 'chờ xử lý', isDelete: false, schedule: new Date(Date.now() - 60_000).toISOString(),
    scheduleType: 'daily', dailyStopTime: null, dataTargetSourceMode: 'direct', extraSettings: {}, content: '', images: [], log: '',
    updatedAt: new Date().toISOString(), ...extra }
}

/** Bộ chạy engine giả: ghi [bắt đầu, kết thúc] theo làn; kết quả theo hàm result(campaign). */
function fakeEngine({ ms = 60, support = () => ({ ok: true }), result = () => ({ reason: 'end_unit', targets: 1 }) } = {}) {
  const engine = {
    calls: [], active: new Map(),
    support: (acc, c) => support(acc, c),
    isRunning: (accountId, lane = 'main') => engine.active.has(`${accountId}:${lane}`),
    abortAll() {},
    async run(acc, c, lane = 'main') {
      const key = `${acc.id}:${lane}`
      if (engine.active.has(key)) return null
      const call = { campaignId: c.id, accountId: acc.id, lane, start: Date.now(), end: null }
      engine.calls.push(call)
      engine.active.set(key, call)
      try {
        await sleep(typeof ms === 'function' ? ms(c) : ms)
        return { detail: {}, ...result(c) }
      } finally {
        call.end = Date.now()
        engine.active.delete(key)
      }
    }
  }
  return engine
}

const overlap = (a, b) => a.start < b.end && b.start < a.end

async function main() {
  const shared = await loadShared()
  const { mod } = await loadScheduler()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-parallel-userdata-'))
  const rpcCalls = []
  let parallelWaitAnswer = null
  const client = {
    rpc(name, args) {
      rpcCalls.push([name, args])
      const run = Promise.resolve(name === 'aka_agent_engine_parallel_wait_v1' ? { data: parallelWaitAnswer, error: null }
        : { data: null, error: { code: 'PGRST202', message: 'not in test' } })
      return { abortSignal: () => run, then: (a, b) => run.then(a, b) }
    },
    from() { throw new Error('from() không dùng trong bài kiểm này') }
  }
  globalThis.__fbHarness = { userData, client, user: { staffId: 9, organizationId: 1, campaignEngineV2: true, entitlements: { zalo: true } },
    runs: [], runSteps: [], workflows: new Map(), block: () => null, fakeMedia: () => path.join(userData, 'x.jpg') }

  /** Bộ lập lịch thật + cổng DB giả cho một bộ tài khoản / chiến dịch. */
  const makeScheduler = ({ accounts, campaigns, engine, runtimeTarget = 'desktop', actionList = async () => ALLOWED }) => {
    const db = { accounts, campaigns: new Map(campaigns.map(c => [c.id, c])), listCalls: 0, legacy: [] }
    const facade = {
      enableDueAccountActions: async () => undefined,
      getEligibleAccounts: async () => db.accounts,
      getPendingCampaigns: async accountId => [...db.campaigns.values()].filter(c => c.accountId === accountId && c.status === 'chờ xử lý' && !c.isDelete),
      getPendingCampaignsForAccounts: async ids => new Map(ids.map(id => [id, [...db.campaigns.values()].filter(c => c.accountId === id && c.status === 'chờ xử lý')])),
      getCampaign: async id => db.campaigns.get(id) ?? null,
      getCampaignAction: async () => null,
      listParallelRunActionIds: async () => { db.listCalls++; return actionList() }
    }
    const scheduler = new mod.CampaignScheduler(facade, { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null },
      { webContents: { send() {} }, isDestroyed: () => false }, undefined, undefined, undefined, { runtimeTarget })
    scheduler.running = true
    scheduler.engineRunner = engine
    scheduler.getReadyRuntimeClock = async () => ({ dbNow: new Date().toISOString() })
    scheduler.executeCampaign = async (acc, c) => { db.legacy.push(c.id); await sleep(20); return 'done' }
    scheduler.sendLog = () => undefined
    return { scheduler, db }
  }
  const tick = async scheduler => { await scheduler.tick() }
  const idle = async scheduler => assert.equal(await scheduler.waitForIdle(5_000), true, 'bộ lập lịch rảnh trong 5 giây')

  // ---- 1. Không tích: như trước -----------------------------------------------------------------------------------------------------
  {
    const engine = fakeEngine()
    const acc = account(1)
    const list = [campaign(1, 'zalo_message_phone'), campaign(1, 'zalo_cancel_sent_friend_request'), campaign(1, 'zalo_join_group_link')]
    const { scheduler, db } = makeScheduler({ accounts: [acc], campaigns: list, engine })
    await tick(scheduler)
    await idle(scheduler)
    assert.deepEqual(engine.calls.map(c => [c.campaignId, c.lane]), list.map(c => [c.id, 'main']), 'một hàng đợi, đúng thứ tự lịch')
    for (let i = 1; i < engine.calls.length; i++) assert.ok(engine.calls[i].start >= engine.calls[i - 1].end, 'lần lượt, không chồng')
    assert.equal(db.listCalls, 0, 'không đọc danh sách loại được bật')
    assert.equal(scheduler.activeLaneRuns.size, 0)
    pass('không tích: một hàng đợi như trước, đúng thứ tự, không chồng, không đọc thêm gì')
  }

  // ---- 2. Có tích: chạy cùng lúc ----------------------------------------------------------------------------------------------------
  {
    const engine = fakeEngine({ ms: c => c.actionId === 'zalo_message_phone' ? 200 : 80 })
    const acc = account(2)
    const m1 = campaign(2, 'zalo_message_phone')
    const c1 = campaign(2, 'zalo_cancel_sent_friend_request', { parallelRunEnabled: true })
    const j1 = campaign(2, 'zalo_join_group_link', { parallelRunEnabled: true })
    const c2 = campaign(2, 'zalo_cancel_sent_friend_request', { parallelRunEnabled: true })
    const m2 = campaign(2, 'zalo_message_phone')
    const { scheduler, db } = makeScheduler({ accounts: [acc], campaigns: [m1, c1, j1, c2, m2], engine })
    await tick(scheduler)
    await idle(scheduler)
    const by = id => engine.calls.find(c => c.campaignId === id)
    assert.deepEqual(engine.calls.filter(c => c.lane === 'main').map(c => c.campaignId), [m1.id, m2.id], 'hàng đợi chính: chỉ chiến dịch không tích')
    assert.deepEqual(engine.calls.filter(c => c.lane === 'zalo_cancel_sent_friend_request').map(c => c.campaignId), [c1.id, c2.id], 'làn huỷ lời mời')
    assert.deepEqual(engine.calls.filter(c => c.lane === 'zalo_join_group_link').map(c => c.campaignId), [j1.id], 'làn tham gia group')
    assert.ok(overlap(by(m1.id), by(c1.id)) && overlap(by(m1.id), by(j1.id)) && overlap(by(c1.id), by(j1.id)), 'ba làn chạy cùng lúc')
    assert.ok(by(c2.id).start >= by(c1.id).end, 'cùng loại: lần lượt trong một làn')
    assert.equal(db.listCalls, 1, 'đọc danh sách loại được bật một lần (nhớ 5 phút)')
    await tick(scheduler)
    await idle(scheduler)
    assert.equal(db.listCalls, 1, 'lượt quét sau dùng lại danh sách đã nhớ')
    pass('có tích: huỷ lời mời và tham gia group chạy cùng lúc với nhắn tin; hai chiến dịch huỷ lời mời chạy lần lượt')
  }

  // ---- 3. Về hàng đợi chính ---------------------------------------------------------------------------------------------------------
  {
    const engine = fakeEngine({ support: (_a, c) => ({ ok: c.actionId !== 'zalo_add_group_member' }) })
    const acc = account(3)
    const notAllowed = campaign(3, 'zalo_message_friend', { parallelRunEnabled: true })
    const unsupported = campaign(3, 'zalo_add_group_member', { parallelRunEnabled: true })
    const ok = campaign(3, 'zalo_join_group_link', { parallelRunEnabled: true })
    const { scheduler, db } = makeScheduler({ accounts: [acc], campaigns: [notAllowed, unsupported, ok], engine })
    await tick(scheduler)
    await idle(scheduler)
    assert.deepEqual(engine.calls.filter(c => c.lane === 'main').map(c => c.campaignId), [notAllowed.id], 'loại chưa bật: hàng đợi chính')
    assert.deepEqual(db.legacy, [unsupported.id], 'engine không chạy được: bộ cũ ở hàng đợi chính như trước')
    assert.deepEqual(engine.calls.filter(c => c.lane !== 'main').map(c => c.campaignId), [ok.id], 'loại được bật: làn riêng')

    const server = makeScheduler({ accounts: [account(4, { isZaloServer: true })], campaigns: [campaign(4, 'zalo_join_group_link', { parallelRunEnabled: true })],
      engine: fakeEngine() })
    await tick(server.scheduler)
    await idle(server.scheduler)
    assert.equal(server.db.listCalls, 0, 'tài khoản Server (không chạy ở Desktop): không chia làn')
    const facebook = makeScheduler({ accounts: [account(5, { flatformType: 'facebook' })], campaigns: [campaign(5, 'facebook_group_post', { parallelRunEnabled: true })],
      engine: fakeEngine() })
    assert.equal((await facebook.scheduler.takeParallelRunLanes(facebook.db.accounts[0], [...facebook.db.campaigns.values()])).size, 0, 'Facebook: không có làn riêng')
    const appServer = makeScheduler({ accounts: [account(6)], campaigns: [], engine: fakeEngine(), runtimeTarget: 'server' })
    assert.equal((await appServer.scheduler.takeParallelRunLanes(account(6), [campaign(6, 'zalo_join_group_link', { parallelRunEnabled: true })])).size, 0,
      'App Server: không có làn riêng')
    const broken = makeScheduler({ accounts: [account(7)], campaigns: [], engine: fakeEngine(), actionList: async () => { throw new Error('column does not exist') } })
    const brokenList = [campaign(7, 'zalo_join_group_link', { parallelRunEnabled: true })]
    assert.equal((await broken.scheduler.takeParallelRunLanes(account(7), brokenList)).size, 0, 'DB chưa có cột: không loại nào')
    assert.equal(brokenList.length, 1, 'chiến dịch giữ ở hàng đợi chính')
    await broken.scheduler.takeParallelRunLanes(account(7), brokenList)
    assert.equal(broken.db.listCalls, 1, 'đọc lỗi thì nhớ 1 phút, không đọc lại mỗi lượt quét')
    pass('loại chưa bật, engine không chạy được, tài khoản Server, Facebook, App Server, DB chưa có cột: về hàng đợi chính')
  }

  // ---- 4. parallel_wait ở hàng đợi chính; tài khoản "đang chạy" vì làn riêng ---------------------------------------------------------
  {
    const blocked = campaign(8, 'zalo_cancel_sent_friend_request')
    const later = campaign(8, 'zalo_message_phone')
    const engine = fakeEngine({ result: c => c.id === blocked.id ? { reason: 'parallel_wait', targets: 0 } : { reason: 'end_unit', targets: 1 } })
    const { scheduler } = makeScheduler({ accounts: [account(8)], campaigns: [blocked, later], engine })
    await tick(scheduler)
    await idle(scheduler)
    assert.deepEqual(engine.calls.map(c => c.campaignId), [blocked.id], 'parallel_wait: hàng đợi chính dừng, không chạy chiến dịch sau')

    const acc = account(9)
    const lane = campaign(9, 'zalo_cancel_sent_friend_request', { parallelRunEnabled: true })
    const slow = fakeEngine({ ms: c => c.id === lane.id ? 400 : 40 })
    const second = makeScheduler({ accounts: [acc], campaigns: [lane], engine: slow })
    await tick(second.scheduler)
    await sleep(50)
    assert.equal(second.scheduler.activeLaneRuns.size, 1, 'làn riêng đang chạy')
    acc.status = 'đang chạy' // DB đặt khi làn nhận lượt
    const main = campaign(9, 'zalo_message_phone')
    second.db.campaigns.set(main.id, main)
    await tick(second.scheduler)
    await idle(second.scheduler)
    const mainCall = slow.calls.find(c => c.campaignId === main.id)
    assert.ok(mainCall, 'tài khoản "đang chạy" vì làn riêng của máy này: hàng đợi chính vẫn nhận chiến dịch')
    assert.ok(overlap(mainCall, slow.calls.find(c => c.campaignId === lane.id)), 'chạy cùng lúc với làn riêng')

    const stale = account(10, { status: 'đang chạy' })
    const third = makeScheduler({ accounts: [stale], campaigns: [campaign(10, 'zalo_message_phone'), campaign(10, 'zalo_join_group_link', { parallelRunEnabled: true })],
      engine: fakeEngine() })
    await tick(third.scheduler)
    await idle(third.scheduler)
    assert.equal(third.scheduler.engineRunner.calls.length, 0, '"đang chạy" không do máy này: không nhận gì, như trước')
    pass('parallel_wait giữ thứ tự lịch; "đang chạy" vì làn riêng vẫn nhận hàng đợi chính, "đang chạy" sót lại thì không')
  }

  // ---- 5. Bộ cũ, chờ dừng, việc ngoài, ảnh chụp --------------------------------------------------------------------------------------
  {
    const acc = account(11)
    const lane = campaign(11, 'zalo_join_group_link', { parallelRunEnabled: true })
    const legacy = campaign(11, 'zalo_message_friend')
    const engine = fakeEngine({ ms: c => c.id === lane.id ? 300 : 30, support: (_a, c) => ({ ok: c.id !== legacy.id }) })
    const { scheduler, db } = makeScheduler({ accounts: [acc], campaigns: [lane], engine })
    await tick(scheduler)
    await sleep(40)
    acc.status = 'đang chạy'
    db.campaigns.set(legacy.id, legacy)
    await tick(scheduler)
    await sleep(40)
    assert.deepEqual(db.legacy, [], 'làn riêng giữ tài khoản: bộ cũ bỏ qua (claim bộ cũ đòi "chờ xử lý"), không đọc DB')
    assert.equal(scheduler.tryReserveExternalAccount(acc.id, 'r1'), false, 'không giữ tài khoản cho việc ngoài khi làn riêng đang chạy')
    const snapshot = scheduler.getRuntimeSnapshotSource()
    assert.ok(snapshot.activeAccountIds.includes(acc.id) && snapshot.runningCampaigns.get(acc.id) === lane.id, 'ảnh chụp: tài khoản đang chạy chiến dịch của làn')
    assert.equal(await scheduler.waitForZaloIdle(50), false, 'waitForZaloIdle chờ làn riêng')
    assert.equal(await scheduler.waitForIdle(50), false, 'waitForIdle chờ làn riêng')
    await idle(scheduler)
    assert.equal(await scheduler.waitForZaloIdle(50), true)
    assert.equal(scheduler.tryReserveExternalAccount(acc.id, 'r2'), true, 'làn riêng xong: giữ tài khoản cho việc ngoài được như trước')
    scheduler.releaseExternalAccount(acc.id, 'r2')
    // Làn riêng xong, tài khoản về "chờ xử lý": bộ cũ chạy; trong lúc bộ cũ chạy, làn riêng không mở.
    acc.status = 'chờ xử lý'
    db.campaigns.delete(lane.id)
    const laneLater = campaign(11, 'zalo_join_group_link', { parallelRunEnabled: true })
    scheduler.executeCampaign = async (_acc, c) => {
      db.legacy.push(c.id)
      db.campaigns.set(laneLater.id, laneLater)
      await tick(scheduler)
      await sleep(60)
      return 'done'
    }
    await tick(scheduler)
    await idle(scheduler)
    assert.deepEqual(db.legacy, [legacy.id], 'làn riêng xong: bộ cũ chạy ở lượt quét sau')
    assert.equal(engine.calls.filter(c => c.campaignId === laneLater.id).length, 0, 'làn riêng chờ bộ cũ xong (DB cũng trả legacy_busy)')
    pass('bộ cũ chờ làn riêng (claim bộ cũ đòi "chờ xử lý"), làn riêng chờ bộ cũ; chờ dừng, việc ngoài, ảnh chụp heartbeat tính cả làn riêng')
  }

  // ---- 6. "Lý do đang chờ" -----------------------------------------------------------------------------------------------------------
  {
    const acc = account(12)
    const lane = campaign(12, 'zalo_cancel_sent_friend_request', { parallelRunEnabled: true })
    const waiting = campaign(12, 'zalo_cancel_sent_friend_request', { parallelRunEnabled: true })
    const engine = fakeEngine({ ms: 300 })
    const { scheduler } = makeScheduler({ accounts: [acc], campaigns: [lane, waiting], engine })
    scheduler.activeAccountRuns.add(acc.id) // hàng đợi chính đang chạy chiến dịch khác
    await tick(scheduler)
    await sleep(40)
    const runtime = scheduler.getDiagnosticRuntime(new AbortController().signal)
    assert.equal(runtime.busyReason(acc), 'Tài khoản đang bận, chưa thể chạy chiến dịch.', 'chiến dịch thường: hàng đợi chính bận như trước')
    assert.equal(runtime.busyReason(acc, { parallelLane: true }), null, 'chiến dịch ở làn riêng: không chờ hàng đợi chính')
    const info = runtime.parallelRun(acc, waiting)
    assert.equal(info.lane, true)
    assert.equal(info.accountHasLaneRun, true)
    assert.deepEqual(info.laneCampaignIds, [lane.id])
    parallelWaitAnswer = { campaignId: lane.id, campaignName: lane.name, reason: 'same_type', actionCodes: ['zalo_cancel_sent_friend_request'], lane: 'zalo_cancel_sent_friend_request' }
    assert.equal(await runtime.parallelRunReason(acc, waiting, new AbortController().signal),
      `Tài khoản đang chạy chiến dịch "${lane.name}" cùng loại. Chiến dịch này sẽ chạy khi chiến dịch đó xong.`)
    parallelWaitAnswer = { campaignId: lane.id, campaignName: 'Nhắn khách', reason: 'same_action', actionCodes: ['zalo_message_stranger', 'zalo_add_friend'] }
    assert.equal(await runtime.parallelRunReason(acc, waiting, new AbortController().signal),
      'Đang chờ chiến dịch "Nhắn khách" chạy xong, vì hai chiến dịch cùng nhắn tin người lạ, kết bạn.')
    parallelWaitAnswer = null
    assert.equal(await runtime.parallelRunReason(acc, waiting, new AbortController().signal), null)
    scheduler.activeAccountRuns.delete(acc.id)
    await idle(scheduler)
    const before = rpcCalls.length
    const plain = account(13)
    assert.equal(await runtime.parallelRunReason(plain, campaign(13, 'zalo_message_phone'), new AbortController().signal), null)
    assert.equal(rpcCalls.length, before, 'không ai tích, không làn riêng: không hỏi DB')
    pass('"Lý do đang chờ": làn riêng không bị coi là bận vì hàng đợi chính; câu cùng loại / chung thao tác đúng câu đã duyệt; không tích thì không hỏi DB')
  }

  // ---- 7. Hợp đồng dùng chung + câu của engine ------------------------------------------------------------------------------------
  {
    assert.equal(shared.CAMPAIGN_PARALLEL_RUN_LABEL, 'Chạy cùng lúc với chiến dịch khác của tài khoản')
    assert.equal(shared.CAMPAIGN_PARALLEL_RUN_SHORT_LABEL, 'Chạy cùng lúc')
    assert.equal(shared.CAMPAIGN_PARALLEL_RUN_HINT, 'Không chờ chiến dịch khác chạy xong. Chiến dịch cùng loại vẫn chạy lần lượt.')
    assert.equal(shared.campaignParallelRunDetail(true), 'Chạy cùng lúc: Có')
    assert.equal(shared.campaignParallelRunDetail(false), 'Chạy cùng lúc: Không')
    assert.equal(shared.canShowCampaignParallelRun({ allowParallelRun: true, engineV2: true }), true)
    assert.equal(shared.canShowCampaignParallelRun({ allowParallelRun: true, engineV2: false }), false)
    assert.equal(shared.canShowCampaignParallelRun({ allowParallelRun: false, engineV2: true }), false)
    assert.equal(shared.campaignRunLane({ actionId: 'zalo_join_group_link', parallelRunEnabled: true }, true), 'zalo_join_group_link')
    assert.equal(shared.campaignRunLane({ actionId: 'zalo_join_group_link', parallelRunEnabled: true }, false), 'main')
    assert.equal(shared.campaignRunLane({ actionId: 'zalo_join_group_link', parallelRunEnabled: false }, true), 'main')
    const message = shared.engineWaitMessage({ accountId: 1, reason: 'parallel_wait', at: Date.now(),
      claim: { status: 'parallel_wait', campaignId: 5, campaignName: 'Huỷ lời mời 1', reason: 'same_type', actionCodes: ['zalo_cancel_sent_friend_request'] } }, Date.now(), 'Zalo')
    assert.equal(message, 'Tài khoản đang chạy chiến dịch "Huỷ lời mời 1" cùng loại. Chiến dịch này sẽ chạy khi chiến dịch đó xong.')
    const webApp = process.env.WEBAPP_REPO && path.join(process.env.WEBAPP_REPO, 'packages/control-api/src/campaignParallelRun.ts')
    if (webApp && fs.existsSync(webApp)) {
      assert.equal(fs.readFileSync(webApp, 'utf8'), fs.readFileSync(path.join(ROOT, 'src/shared/campaignParallelRun.ts'), 'utf8'),
        'src/shared/campaignParallelRun.ts chép nguyên văn WebApp')
      pass('hợp đồng dùng chung trùng từng byte với WebApp')
    }
    pass('hợp đồng dùng chung (câu đã duyệt, điều kiện hiện ô, làn) và câu chờ của engine')
  }

  console.log(`\nChạy cùng lúc (Desktop): ${checks} nhóm đạt.`)
  process.exit(0)
}

main().catch(error => { console.error(error); process.exit(1) })
