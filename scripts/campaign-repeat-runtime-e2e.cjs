// "Lặp lại sau khi chạy xong" (V561) chạy code app thật trên DB thật (PostgreSQL cục bộ dựng như production tới V558 + V561):
//   A. Bộ chạy cũ Desktop: các method thật của CampaignScheduler (handleCampaignCompletion → handleCampaignRepeatAfterCompletion →
//      rescheduleCompletedCampaignPass) và repository thật (campaignRepeatRepository.ts) gọi RPC thật qua một client giống supabase-js;
//      3 lượt liền, tua thời gian giữa các lượt, rồi khách cho chạy lại sau lượt cuối.
//   B. Bộ quét của API Web: lớp CampaignRepeatSweeper thật và RPC wrapper thật (akaAgentWebApp apps/api/src/modules/campaign-repeat/)
//      mở lại chiến dịch mà "bộ chạy chưa biết tính năng" (App Server, Desktop cũ) đã đánh "hoàn thành", rồi chốt lượt cuối; kèm thông
//      báo "hoàn thành" chỉ ở lượt cuối.
// Engine v2 (lõi thật, Desktop và Fly) chạy nhiều lượt ở bộ kịch bản: SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_CAMPAIGN_REPEAT=1
// node scripts/engine-v2-scenarios/run.cjs --skip-general (S30, S31).
// Chạy: CHAT_REPO=<akaAgentChatApi> WEBAPP_REPO=<checkout akaAgentWebApp có phần chạy> node scripts/campaign-repeat-runtime-e2e.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap } = require('./engine-v2-scenarios/bootstrap.cjs')
const { applyFacebookMigrations } = require('./engine-v2-facebook/fixture.cjs')
const { applyCampaignRepeatV561 } = require('./fixtures/campaign-outcome-engine/campaign-repeat-v561.cjs')

const root = path.resolve(__dirname, '..')
const webRoot = path.resolve(root, process.env.WEBAPP_REPO || '../akaAgentWebApp')
const PORT = Number(process.env.V561_E2E_PORT || 55563)
const STAFF = 7301
const ORG = 601

/** Nạp một file TS (CommonJS) với bảng thay thế require. */
function loadTs(file, replace = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }
  }).outputText
  const module = { exports: {} }
  const req = id => (id in replace ? replace[id] : require(id))
  new Function('module', 'exports', 'require', code)(module, module.exports, req)
  return module.exports
}

/** Client giống supabase-js tối thiểu: .rpc(name, params).abortSignal(...) → { data, error }, gọi hàm thật trong DB. */
function rpcClient(db, calls) {
  return {
    rpc(name, params = {}) {
      const keys = Object.keys(params)
      const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} := $${i + 1}`).join(', ')}) AS r`
      calls.push(name)
      const exec = db.query(sql, keys.map(k => params[k]))
        .then(res => ({ data: res.rows[0].r, error: null }), e => ({ data: null, error: { code: e.code, message: e.message } }))
      const chain = { abortSignal: () => chain, then: (ok, bad) => exec.then(ok, bad) }
      return chain
    }
  }
}

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v561-e2e-' })
  const db = await connect()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
  try {
    await bootstrap(db, [])
    await applyFacebookMigrations(db)
    await applyCampaignRepeatV561(db)
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff(id, organization_id) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [STAFF, ORG])
    await db.query(`INSERT INTO public.auto_notification_subscriptions VALUES ($1, 'campaign.status_changed', 'own', true, NULL, NULL)`, [STAFF])

    let nextId = 940000
    const vnDay = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)
    const makeCampaign = async (extra, targets = 3) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server, is_zalo_show_web)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo thử', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`, [account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, original_schedule, schedule_type, continue_next_day,
          provisioning_state, data_target_source_mode, extra_settings, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch lặp thử', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', $3, 'daily', true, 'ready',
          'direct', $4::jsonb, false, $5, $6)`, [campaign, account, `${vnDay}T00:05:00+07:00`, JSON.stringify(extra), STAFF, ORG])
      const ids = []
      for (let i = 0; i < targets; i++) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Khách ${i + 1}`, `0913${String(id).slice(-6)}`])
        ids.push(id)
      }
      return { account, campaign, ids }
    }
    const repeatHour = maxRuns => ({ repeatAfterCompletionEnabled: true, repeatAfterCompletionEvery: 1, repeatAfterCompletionUnit: 'hour',
      repeatAfterCompletionMaxRuns: maxRuns })
    const campaignRow = id => one(`SELECT status, schedule, completed_at, repeat_runs_done, note FROM public.auto_campaigns WHERE id = $1`, [id])
    const dataStatuses = async id => (await db.query(`SELECT status FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [id])).rows.map(r => r.status)
    const state = async id => (await one(`SELECT private.aka_agent_campaign_repeat_state(c) AS s FROM public.auto_campaigns c WHERE c.id = $1`, [id])).s
    const notified = id => one(`SELECT count(*)::int AS n FROM public.auto_notifications WHERE campaign_id = $1 AND payload->>'toStatus' = 'hoàn thành'`, [id]).then(r => r.n)
    // Bộ chạy (bất kỳ) chạy hết danh sách: mọi data chờ → hoàn thành, chiến dịch đang chạy.
    const runList = async id => {
      await db.query(`UPDATE public.auto_campaigns SET status = 'đang chạy' WHERE id = $1`, [id])
      await db.query(`UPDATE public.auto_campaign_input_data SET status = 'hoàn thành', date_action = now() WHERE campaign_id = $1 AND status = 'chờ xử lý'`, [id])
    }

    // ---- A. Bộ chạy cũ Desktop --------------------------------------------------------------------------------------------
    const rpcCalls = []
    const client = rpcClient(db, rpcCalls)
    const repeatShared = loadTs(path.join(root, 'src/shared/campaignRepeat.ts'))
    const repo = loadTs(path.join(root, 'src/main/data/repositories/campaignRepeatRepository.ts'), {
      '../supabaseClient': { getSupabaseClient: () => client },
      '../currentUser': { requireCurrentUser: () => ({ staffId: STAFF }) },
      '../../../shared/campaignRepeat': repeatShared
    })
    const schedulerFile = path.join(root, 'src/main/services/campaignScheduler.ts')
    const source = ts.createSourceFile(schedulerFile, fs.readFileSync(schedulerFile, 'utf8'), ts.ScriptTarget.Latest, true)
    const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
    const methods = ['handleCampaignCompletion', 'handleMultiDailyTimeSlotAfterCompletion', 'rescheduleCompletedCampaignPass',
      'handleZaloShareRepeatAfterCompletion', 'handleCampaignRepeatAfterCompletion', 'getFutureInputSchedule', 'getVietnamDateTimeParts',
      'getVietnamDateKey', 'isSameVietnamDay', 'parseDailyStopTime', 'isAfterDailyStopTime', 'isAtOrAfterCampaignDispatchCutoff',
      'formatVietnamDateTime', 'parseMultiDailyTimeSlot', 'normalizeMultiDailyTimeSlots', 'getTimeSlotMinute', 'withVietnamTimeSlot']
      .map(name => declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name).getText(source)).join('\n')
    const shareRepeat = loadTs(path.join(root, 'src/shared/zaloShareRepeat.ts'))
    const cooldown = loadTs(path.join(root, 'src/shared/campaignDeliveryCooldown.ts'))
    const globals = {
      ZALO_MESSAGE_FRIEND_ACTION_ID: 'zalo_message_friend', ZALO_MESSAGE_GROUP_ACTION_ID: 'zalo_message_group', PAGE_POST_ACTION_ID: 'facebook_page_post',
      MULTI_DAILY_TIME_SLOT_ACTION_IDS: new Set(['facebook_timeline_post', 'facebook_page_post', 'zalo_message_friend', 'zalo_message_group']),
      supportsZaloShareRepeat: shareRepeat.supportsZaloShareRepeat, parseZaloShareRepeatMinutes: shareRepeat.parseZaloShareRepeatMinutes,
      isRecentDeliveryCooldownEnabled: cooldown.isRecentDeliveryCooldownEnabled, campaignRepeatUnits: repeatShared.campaignRepeatUnits,
      CAMPAIGN_REPEAT_NO_DATA_ACTIONS: repeatShared.CAMPAIGN_REPEAT_NO_DATA_ACTIONS
    }
    const compiled = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
    const Scheduler = new Function(...Object.keys(globals), `${compiled}; return Harness`)(...Object.values(globals))
    const COLUMN = { status: 'status', schedule: 'schedule', note: 'note' }
    const applyPatch = async (id, patch, onlyRunning) => {
      const sets = []
      const args = [id]
      for (const [key, value] of Object.entries(patch)) {
        if (!COLUMN[key]) throw new Error(`patch ngoài phạm vi thử: ${key}`)
        args.push(value instanceof Date ? value.toISOString() : value)
        sets.push(`${COLUMN[key]} = $${args.length}`)
      }
      const res = await db.query(`UPDATE public.auto_campaigns SET ${sets.join(', ')}, updated_at = now() WHERE id = $1${onlyRunning ? ` AND status = 'đang chạy'` : ''}
        RETURNING id`, args)
      return res.rowCount ? { id } : null
    }
    const progress = []
    const scheduler = Object.assign(new Scheduler(), {
      runtimeTarget: 'desktop', claimedServerZaloCampaignIds: new Set(), claimedServerZaloAccountIds: new Set(), campaignRunBoundaries: new Map(),
      restoreFacebookPageIdentity: async () => {}, getDatabaseBusinessNow: async () => new Date(),
      handleZaloRealtimeGroupCompletion: async () => false, handleRerunAfterCompletion: async () => false,
      transitionCampaignToCompleted: async c => (await db.query(`UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = $1 AND status = 'đang chạy'`, [c.id])).rowCount > 0,
      logCampaignProgress: async (_c, message) => { progress.push(message) },
      updateCampaignAndBroadcast: (id, patch) => applyPatch(id, patch, false),
      updateRunningCampaignAndBroadcast: (id, patch) => applyPatch(id, patch, true),
      broadcastCampaignUpdate: () => {},
      supabase: {
        listCampaignInputData: async id => (await db.query(`SELECT id, status, is_delete, schedule FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [id]))
          .rows.map(r => ({ id: Number(r.id), status: r.status, isDelete: r.is_delete, schedule: r.schedule ? new Date(r.schedule).toISOString() : null })),
        // Đúng câu của campaignRepository.resetCampaignInputDataForRerun.
        resetCampaignInputDataForRerun: id => db.query(`UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
          WHERE campaign_id = $1 AND is_delete = false AND status <> 'tạm dừng'`, [id]),
        advanceZaloServerMultiDailySlot: async () => { throw new Error('không dùng trên Desktop') },
        decideCampaignRepeat: id => repo.decideCampaignRepeat(id),
        getAccount: async () => null
      }
    })
    const campaignObject = async id => {
      const r = await one(`SELECT * FROM public.auto_campaigns WHERE id = $1`, [id])
      return { id: Number(r.id), accountId: Number(r.account_id), name: r.name, actionId: r.action_id, status: r.status,
        schedule: r.schedule && new Date(r.schedule).toISOString(), originalSchedule: r.original_schedule && new Date(r.original_schedule).toISOString(),
        scheduleType: r.schedule_type, dailyStopTime: r.daily_stop_time, scheduleEndDate: r.schedule_end_date, dataTargetSourceMode: r.data_target_source_mode,
        extraSettings: r.extra_settings }
    }

    const a = await makeCampaign(repeatHour(3))
    assert.equal(await repo.syncCampaignRepeat(a.campaign), true, 'đăng ký lặp qua repository thật')
    const rounds = []
    for (let round = 1; round <= 3; round++) {
      await runList(a.campaign)
      const from = progress.length
      await scheduler.handleCampaignCompletion(await campaignObject(a.campaign))
      const row = await campaignRow(a.campaign)
      rounds.push({ round, status: row.status, runs: row.repeat_runs_done, data: await dataStatuses(a.campaign), lines: progress.slice(from), schedule: row.schedule })
      if (round < 3) await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [a.campaign])
    }
    for (const r of rounds.slice(0, 2)) {
      assert.deepEqual([r.status, r.runs, r.data], ['chờ xử lý', r.round, ['chờ xử lý', 'chờ xử lý', 'chờ xử lý']], `Desktop lượt ${r.round}`)
      assert.ok(r.lines.some(t => t.startsWith(`⏳ Đã chạy xong lượt ${r.round}/3, hẹn chạy lại chiến dịch "Chiến dịch lặp thử" lúc `)), JSON.stringify(r.lines))
      assert.ok(new Date(r.schedule).getTime() > Date.now(), 'lượt kế ở tương lai')
    }
    assert.deepEqual([rounds[2].status, rounds[2].runs, rounds[2].data], ['hoàn thành', 3, ['hoàn thành', 'hoàn thành', 'hoàn thành']])
    assert.ok(rounds[2].lines.includes('✅ Hoàn thành chiến dịch "Chiến dịch lặp thử" (đã chạy đủ 3 lượt)'), JSON.stringify(rounds[2].lines))
    assert.equal(await notified(a.campaign), 1, 'bộ chạy mới không đánh "hoàn thành" ở lượt giữa: chỉ một thông báo')
    assert.ok(rpcCalls.includes('aka_agent_campaign_repeat_decide_v1') && rpcCalls.includes('aka_agent_campaign_repeat_sync_v1'))
    pass('A1 bộ chạy cũ Desktop (method + repository thật, RPC thật): 3 lượt, lượt giữa hẹn lượt kế và đặt lại data, lượt 3 hoàn thành, một thông báo')
    // Khách cho chạy lại sau lượt cuối (bộ quét chưa chốt): vòng đếm mới.
    await runList(a.campaign)
    progress.length = 0
    await scheduler.handleCampaignCompletion(await campaignObject(a.campaign))
    assert.deepEqual([(await campaignRow(a.campaign)).status, (await campaignRow(a.campaign)).repeat_runs_done], ['chờ xử lý', 1])
    assert.ok(progress.some(t => t.startsWith('⏳ Đã chạy xong lượt 1/3')), JSON.stringify(progress))
    pass('A2 chạy lại sau lượt cuối: vòng đếm mới, lượt 1/3')
    // Không bật lặp: hoàn thành như trước, không gọi DB.
    const plain = await makeCampaign({})
    await runList(plain.campaign)
    const decideBefore = rpcCalls.filter(n => n === 'aka_agent_campaign_repeat_decide_v1').length
    progress.length = 0
    await scheduler.handleCampaignCompletion(await campaignObject(plain.campaign))
    assert.deepEqual([(await campaignRow(plain.campaign)).status, progress], ['hoàn thành', ['✅ Hoàn thành chiến dịch "Chiến dịch lặp thử"']])
    assert.equal(rpcCalls.filter(n => n === 'aka_agent_campaign_repeat_decide_v1').length, decideBefore, 'không bật lặp: không gọi decide')
    pass('A3 chiến dịch không bật lặp: hoàn thành như trước, không gọi hàm lặp')

    // ---- B. Bộ quét của API Web -----------------------------------------------------------------------------------------------
    const webCalls = []
    const webClient = rpcClient(db, webCalls)
    const controlRepeat = loadTs(path.join(webRoot, 'packages/control-api/src/campaignRepeat.ts'))
    const rpc = loadTs(path.join(webRoot, 'apps/api/src/modules/campaign-repeat/campaignRepeat.rpc.ts'), {
      '@aka-agent/control-api': controlRepeat,
      '../../db/akaAgentSupabase': { getAkaAgentSupabaseClient: () => webClient }
    })
    const sweeperModule = loadTs(path.join(webRoot, 'apps/api/src/modules/campaign-repeat/campaignRepeat.sweeper.ts'), {
      '../../config/env': { env: { campaignRepeatSweeperEnabled: false, campaignRepeatSweepSeconds: 60 } },
      './campaignRepeat.rpc': rpc
    })
    const logs = []
    const sweeper = new sweeperModule.CampaignRepeatSweeper({ log: { warn: (o, m) => logs.push(['warn', m, o]), info: (o, m) => logs.push(['info', m, o]) } })
    const b = await makeCampaign(repeatHour(2), 2)
    assert.equal(await rpc.syncCampaignRepeat(STAFF, b.campaign), true, 'API đăng ký lặp sau khi lưu (RPC wrapper thật)')
    // Bộ chạy chưa biết tính năng (App Server, Desktop cũ) chạy hết danh sách rồi đánh "hoàn thành".
    await runList(b.campaign)
    await db.query(`UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = $1`, [b.campaign])
    assert.equal(await notified(b.campaign), 0, 'lượt giữa: không báo "hoàn thành"')
    assert.equal(await sweeper.tickOnce(), 'worked')
    let row = await campaignRow(b.campaign)
    assert.deepEqual([row.status, row.completed_at, row.repeat_runs_done, await dataStatuses(b.campaign)], ['chờ xử lý', null, 1, ['chờ xử lý', 'chờ xử lý']])
    assert.match((await one(`SELECT log FROM public.auto_campaign_logs WHERE campaign_id = $1 ORDER BY id DESC LIMIT 1`, [b.campaign])).log,
      /^\d{2}:\d{2}:\d{2} \d{2}\/\d{2}\/\d{4} - ⏳ Đã chạy xong lượt 1\/2, hẹn chạy lại chiến dịch "Chiến dịch lặp thử" lúc \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}$/)
    assert.equal(await sweeper.tickOnce(), 'idle', 'quét lại: không làm gì')
    const st = await rpc.readCampaignRepeatStates(STAFF, [b.campaign])
    assert.deepEqual(st.map(x => [x.campaignId, x.runsDone, x.maxRuns, x.unit, x.every]), [[b.campaign, 1, 2, 'hour', 1]], 'API đọc bộ đếm lượt')
    await db.query(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [b.campaign])
    await runList(b.campaign)
    await db.query(`UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = $1`, [b.campaign])
    assert.equal(await notified(b.campaign), 1, 'lượt cuối: báo "hoàn thành"')
    assert.equal(await sweeper.tickOnce(), 'worked')
    row = await campaignRow(b.campaign)
    assert.deepEqual([row.status, row.repeat_runs_done, (await state(b.campaign)).endedReason], ['hoàn thành', 2, 'max_runs'])
    assert.equal(await sweeper.tickOnce(), 'idle', 'đã chốt: không mở lại')
    assert.ok(logs.some(([level, msg, o]) => level === 'info' && msg === 'campaign repeat sweep' && o.reopened === 1), JSON.stringify(logs))
    // Khoá tắt khẩn: RPC trả enabled false → 'off'.
    await db.query(`UPDATE public.auto_system_settings SET value = '{"audience":"admin_akabiz","sweeper":false}' WHERE key = 'campaign.repeat_after_completion'`)
    assert.equal(await sweeper.tickOnce(), 'off')
    await db.query(`UPDATE public.auto_system_settings SET value = '{"audience":"admin_akabiz","sweeper":true}' WHERE key = 'campaign.repeat_after_completion'`)
    // Đồng hồ thật của bộ quét: start → một lượt sau firstDelay → stop.
    const c = await makeCampaign(repeatHour(2), 1)
    await rpc.syncCampaignRepeat(STAFF, c.campaign)
    await runList(c.campaign)
    await db.query(`UPDATE public.auto_campaigns SET status = 'hoàn thành' WHERE id = $1`, [c.campaign])
    const timed = new sweeperModule.CampaignRepeatSweeper({ firstDelayMs: 50, jitterMs: 1, intervalMs: 60_000 })
    timed.start()
    for (let i = 0; i < 100 && (await campaignRow(c.campaign)).status !== 'chờ xử lý'; i++) await new Promise(r => setTimeout(r, 50))
    await timed.stop()
    assert.equal((await campaignRow(c.campaign)).status, 'chờ xử lý', 'đồng hồ của bộ quét tự chạy lượt quét')
    pass('B bộ quét API Web (lớp + RPC wrapper thật): mở lại lượt giữa, ghi lịch sử chạy, quét lại không làm gì, chốt lượt cuối, thông báo chỉ ở lượt cuối, khoá tắt khẩn, đồng hồ tự chạy')

    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
