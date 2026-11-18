// Bộ kịch bản sự cố cho engine v2 Facebook (như bộ kịch bản Zalo, scripts/engine-v2-scenarios/run.cjs): bộ lập lịch Desktop thật chạy
// chiến dịch đăng nhóm (kèm comment, chia sẻ sang nhóm đã tham gia) và đăng trang cá nhân trên trang Facebook giả ("thế giới" ghi mọi
// cú gửi thật), có tiêm lỗi: không thấy nút trước cú bấm, script lỗi sau cú bấm, form không đóng, không mở được ô đăng bài, cửa sổ ẩn chết,
// chết tiến trình ngay sau cú bấm gửi (bộ chạy mới nhận lại sau khi lease hết hạn), DB mất yêu cầu / mất câu trả lời. Sau cùng kiểm bất
// biến. Không chạm DB thật, không mở Facebook.
//
//   node scripts/engine-v2-facebook/scenarios.cjs [--seeds 3] [--campaigns 6] [--targets 8] [--fault 0.08] [--crash 0.03] [--dbchaos 0.03] [--out r.json]
//
// Bất biến:
//   B1 mỗi data (nhóm) được đăng tối đa một lần, kể cả khi được chia sẻ kèm từ data khác;
//   B2 mỗi vị trí comment của một data tối đa một lần;
//   B3 cú gửi nào cũng có dấu "sắp gửi" (marks) của đúng data / thao tác trước đó;
//   B4 data đã có cú gửi không bao giờ về lại hàng đợi (sẽ gửi lần nữa);
//   B5 hết lượt: không còn lượt data mở, không còn lease;
//   B6 không "thành công giả": dòng thành công của data phải có cú gửi tương ứng trong thế giới;
//   B7 trang cá nhân: mỗi mốc lịch tối đa một bài.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '../..')
if (!process.versions.electron) {
  const electron = require(path.join(ROOT, 'node_modules/electron'))
  const r = spawnSync(electron, [__filename, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
  process.exit(r.status ?? 1)
}

const { loadScheduler, fakeClient } = require('./desktop-harness.cjs')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, FACEBOOK_POLICY_MIGRATIONS } = require('./fixture.cjs')

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const SEEDS = Number(opt('--seeds', 3))
const ONLY_SEED = opt('--seed') ? Number(opt('--seed')) : null
const CAMPAIGNS = Number(opt('--campaigns', 6))
const TARGETS = Number(opt('--targets', 8))
const FAULT = Number(opt('--fault', 0.08))
const CRASH = Number(opt('--crash', 0.03))
const DBCHAOS = Number(opt('--dbchaos', 0.03))
const OUT = opt('--out')
const PORT = Number(process.env.FB_SCENARIO_PORT || 55557)

/** RNG có hạt giống (mulberry32): cùng hạt giống thì cùng chuỗi lỗi. */
function rng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ------------------------------------------------------------------------------------------------ block giả (code chạy thật trong vm)
const BLOCKS = [
  { id: 27, name: 'fb_open_composer', code: `
const sel = await helpers.element('fb_composer_button')
try { await page.waitForSelector(sel, { timeout: 100 }) } catch (cause) {
  return { opened: false, actionResult: { actionCode: input.composerActionCode || 'fb_post_group', statusCode: 'campaign_detail_error',
    errorCode: 'err_fb_group_composer_editor_not_found', inputDataId: vars.inputDataId ?? null, operationState: 'not_committed',
    message: 'Không tìm thấy ô đăng bài', data: { error: String(cause.message), source: 'fb_open_composer' } } }
}
await page.click(sel)
return { opened: true }` },
  { id: 28, name: 'fb_type_post_content', code: `await page.type(await helpers.element('fb_composer_editor'), 'Nội dung'); return { typed: true }` },
  { id: 2794, name: 'fb_select_group_post_share_targets', code: `
const enabled = vars.enableGroupPostShareToJoinedGroups === true
const targets = Array.isArray(vars.groupPostShareTargets) ? vars.groupPostShareTargets : []
const max = Math.min(3, Math.max(0, Math.floor(Number(vars.groupPostShareMaxCount ?? 0))))
if (!enabled || max <= 0 || targets.length === 0) return { enabled, skipped: true, selectedTargets: [] }
const selectedTargets = targets.slice(0, Math.min(max, 2))
await page.evaluate('share:' + JSON.stringify(selectedTargets.map(t => Number(t.id))))
return { enabled: true, skipped: false, selectedCount: selectedTargets.length, selectedTargets }` },
  { id: 30, name: 'fb_click_post_button', code: `
const btn = await helpers.element('fb_post_button')
await page.waitForSelector(btn, { timeout: 100 })
await page.click(btn)
return { posted: true }` },
  { id: 2624, name: 'fb_verify_group_post_form_closed', code: `
const ok = await page.evaluate('formClosed')
if (!ok) throw new Error('Form đăng bài chưa đóng sau 60 giây')
return { ok: true, posted: true, submitClosed: true, message: 'Form đăng bài đã đóng' }` },
  { id: 2833, name: 'fb_get_first_group_post_link', code: `return { postUrl: 'https://www.facebook.com/groups/g/posts/' + (vars.inputDataId ?? 0) + '/' }` },
  { id: 34, name: 'fb_comment_at_position', code: `
const position = (vars.loopIndex ?? 0) + 1
await page.evaluate('position:' + position)
await page.click(await helpers.element('fb_comment_box'))
await page.press('Enter')
return { commented: true, position, text: 'Bình luận ' + position }` }
]
const GROUP_WF = 5101, TIMELINE_WF = 5102
const WORKFLOWS = new Map([
  [GROUP_WF, { id: GROUP_WF, name: '[engine] Đăng nhóm', defaultVariables: {}, edges: [
    { id: 'e1', source: 'open', target: 'gate' }, { id: 'e2', source: 'gate', target: 'type', sourceHandle: 'true' },
    { id: 'e3', source: 'type', target: 'share' }, { id: 'e4', source: 'share', target: 'post' }, { id: 'e5', source: 'post', target: 'verify' },
    { id: 'e6', source: 'verify', target: 'link' }, { id: 'e7', source: 'link', target: 'comments' },
    { id: 'e8', source: 'comments', target: 'comment', sourceHandle: 'body' }],
  nodes: [
    { id: 'open', blockId: 27, blockName: 'fb_open_composer', config: { composerActionCode: 'fb_post_group' } },
    { id: 'gate', blockId: 0, blockName: 'if_else', systemType: 'ifElse', config: { condition: 'input.opened === true' } },
    { id: 'type', blockId: 28, blockName: 'fb_type_post_content', config: {} },
    { id: 'share', blockId: 2794, blockName: 'fb_select_group_post_share_targets', config: {} },
    { id: 'post', blockId: 30, blockName: 'fb_click_post_button', config: { composerActionCode: 'fb_post_group' } },
    { id: 'verify', blockId: 2624, blockName: 'fb_verify_group_post_form_closed', config: {} },
    { id: 'link', blockId: 2833, blockName: 'fb_get_first_group_post_link', config: {} },
    { id: 'comments', blockId: 0, blockName: 'loop', systemType: 'loop', config: { loopType: 'count', count: 2 } },
    { id: 'comment', blockId: 34, blockName: 'fb_comment_at_position', config: {} }] }],
  [TIMELINE_WF, { id: TIMELINE_WF, name: '[engine] Đăng trang cá nhân', defaultVariables: {}, edges: [
    { id: 'e1', source: 'open', target: 'gate' }, { id: 'e2', source: 'gate', target: 'type', sourceHandle: 'true' },
    { id: 'e3', source: 'type', target: 'post' }],
  nodes: [
    { id: 'open', blockId: 27, blockName: 'fb_open_composer', config: { composerActionCode: 'fb_post_my_profile' } },
    { id: 'gate', blockId: 0, blockName: 'if_else', systemType: 'ifElse', config: { condition: 'input.opened === true' } },
    { id: 'type', blockId: 28, blockName: 'fb_type_post_content', config: {} },
    { id: 'post', blockId: 30, blockName: 'fb_click_post_button', config: { composerActionCode: 'fb_post_my_profile' } }] }]
])

// ------------------------------------------------------------------------------------------------ thế giới Facebook giả
class World {
  constructor(random) {
    this.random = random
    this.sends = []
    this.current = null
    this.position = null
    this.shareTo = []
    this.faults = {}
    this.crashed = null
  }
  begin(ctx) { this.current = ctx; this.position = null; this.shareTo = [] }
  pick(kind, choices) {
    const roll = this.random()
    let acc = 0
    for (const [name, p] of choices) { acc += p; if (roll < acc) { this.faults[`${kind}:${name}`] = (this.faults[`${kind}:${name}`] || 0) + 1; return name } }
    return null
  }
  send(kind) {
    const c = this.current ?? {}
    this.sends.push({ kind, campaign: c.campaignId, target: c.inputDataId ?? null, slot: c.slot ?? null, run: c.run ?? null, instance: c.instance ?? null,
      position: kind === 'comment' ? this.position : null,
      shareTo: kind === 'post' ? [...this.shareTo] : [], at: Date.now() })
  }
}

class WorldPage {
  constructor(world, instance) { this.world = world; this.instance = instance; this.url = 'https://www.facebook.com/groups/g/'; this.dead = false }
  getURL() { return this.url }
  isConnected() { return !this.dead && !this.instance.dead }
  destroy() { this.dead = true }
  alive() { if (this.dead || this.instance.dead) throw new Error('Browser page is not connected') }
  async waitForSelector(sel) {
    this.alive()
    if (String(sel).endsWith('fb_composer_button') && this.world.pick('composer', [['missing', FAULT / 2]])) throw new Error('waitForSelector timeout: ' + sel)
    return true
  }
  async $(sel) { return { xpath: sel } }
  async type() { this.alive() }
  async captureJpeg() { return Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }
  async evaluate(code) {
    this.alive()
    const text = String(code)
    if (text.startsWith('position:')) { this.world.position = Number(text.slice(9)); return null }
    if (text.startsWith('share:')) { this.world.shareTo = JSON.parse(text.slice(6)); return null }
    if (text === 'formClosed') return this.world.pick('form', [['stuck', FAULT / 2]]) !== 'stuck'
    return null
  }
  async gesture(kind) {
    const fault = this.world.pick(kind, [['notfound', FAULT / 2], ['after', FAULT / 2], ['crash', CRASH], ['browser', FAULT / 4]])
    if (fault === 'notfound') throw new Error(kind === 'post' ? 'Element not found: //replay-fb_post_button' : 'Element cannot be focused')
    if (fault === 'browser') { this.dead = true; throw new Error('Browser page is not connected') }
    this.world.send(kind)
    if (fault === 'after') throw new Error('Script failed to execute')
    // Chết tiến trình ngay sau khi cú bấm đã đi: executeJavaScript trả lỗi khác "Browser page is not connected" (câu đó chỉ có ở bước
    // kiểm kết nối trước khi gửi, pageController.ts:489), ví dụ "Script failed to execute".
    if (fault === 'crash') { this.dead = true; this.instance.crash(); throw new Error('Script failed to execute') }
  }
  async click(sel) {
    this.alive()
    if (String(sel).endsWith('fb_post_button')) return this.gesture('post')
  }
  async press() { this.alive(); return this.gesture('comment') }
}

// ------------------------------------------------------------------------------------------------
async function main() {
  const { mod, out } = await loadScheduler({ replayExecutor: false })
  const cluster = startCluster({ port: PORT, label: 'aka-fb-scenarios-', timeoutMs: 3_600_000 })
  const db = await cluster.connect()
  db.setTypeParser(20, 'text', value => Number(value))
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
  const report = { startedAt: new Date().toISOString(), options: { SEEDS, CAMPAIGNS, TARGETS, FAULT, CRASH, DBCHAOS }, seeds: [], violations: [] }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-scenarios-userdata-'))
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    await applyFacebookMigrations(db, FACEBOOK_POLICY_MIGRATIONS)
    // V576 (đóng lượt bị bỏ dở cho đúng: mồ côi, chốt theo kết quả đã báo, hàm reset Desktop): FB_SCENARIO_ORPHAN_RUNS=1 để chạy trên DB đã có
    // V576 (nạp thân report_v1 / close_stale production 18/11 nếu DB thử khác).
    if (process.env.FB_SCENARIO_ORPHAN_RUNS === '1') await require('../fixtures/engine-v2-orphan-runs-v576/setup.cjs').applyV576(db)
    await db.query(`CREATE OR REPLACE FUNCTION public.aka_agent_engine_action_limit(p_campaign_id bigint, p_account_id bigint, p_action_code text)
      RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT NULL::jsonb $f$`)
    for (const b of BLOCKS) await db.query(`INSERT INTO public.auto_blocks (id, name, code) VALUES ($1, $2, $3)`, [b.id, b.name, b.code])
    await db.query(`INSERT INTO public.auto_workflows (id, name) VALUES ($1, 'g'), ($2, 't')`, [GROUP_WF, TIMELINE_WF])
    await db.query(`INSERT INTO public.auto_engine_workflows (purpose, workflow_id) VALUES ('facebook_group_post', $1), ('facebook_timeline_post', $2)`,
      [GROUP_WF, TIMELINE_WF])
    await db.query(`INSERT INTO public.auto_engine_block_steps (block_id, workflow_id, step_kind, action_code, commit_level, send_ops) VALUES
      (27, NULL, 'result', NULL, 1, '[]'), (30, $1, 'delivery', 'fb_post_group', 2, '["click:fb_post_button"]'),
      (30, $2, 'delivery', 'fb_post_my_profile', 2, '["click:fb_post_button"]'), (34, NULL, 'delivery', 'fb_comment', 2, '["press:Enter"]'),
      (2624, NULL, 'result', NULL, 1, '[]')`, [GROUP_WF, TIMELINE_WF])

    for (let seed = ONLY_SEED ?? 1; seed <= (ONLY_SEED ?? SEEDS); seed++) {
      const random = rng(seed * 7919)
      const world = new World(random)
      const ORG = 700 + seed, STAFF = 9700 + seed
      await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'FB kịch bản') ON CONFLICT DO NOTHING`, [ORG])
      await db.query(`INSERT INTO public.org_staff (id, organization_id, username, password) VALUES ($1, $2, $3, 'pw')`, [STAFF, ORG, `fbs${seed}`])
      await db.query(`INSERT INTO public.org_organization_product (organization_id, product_id, package_type, expiration_date)
        VALUES ($1, 3, 'paid', now() + interval '30 days')`, [ORG])
      await db.query(`UPDATE public.auto_system_settings SET value = $1 WHERE key = 'engine.facebook'`, [JSON.stringify({ mode: 'orgs', organizationIds: [ORG] })])
      const user = { staffId: STAFF, organizationId: ORG, facebookEngineV2: true, campaignEngineV2: false,
        entitlements: { facebookCore: true, facebookFanpage: false, email: false, zalo: false, sms: false } }

      // ---- một "tiến trình" bộ lập lịch; chết thì dựng tiến trình mới (RAM mới, cùng DB, cùng nhật ký trên máy) ----
      let dbFaults = {}
      let instanceNo = 0
      const deadRunners = new Set()
      const newInstance = () => {
        const instance = { no: ++instanceNo, dead: false, crash() { this.dead = true; for (const c of scheduler.engineRunner.runs?.values?.() ?? []) c.abort() } }
        const base = fakeClient(db, [])
        const CHAOS = new Set(['aka_agent_engine_report_v1', 'aka_agent_engine_mark_sending_v1', 'aka_agent_engine_claim_target_v1',
          'aka_agent_engine_claim_batch_v1', 'aka_agent_engine_heartbeat_v1'])
        const client = {
          from: table => base.from(table),
          rpc(name, rpcArgs) {
            if (instance.dead) {
              const failed = Promise.resolve({ data: null, error: { message: 'TypeError: fetch failed' }, status: 0 })
              return { abortSignal: () => failed, then: (a, b) => failed.then(a, b) }
            }
            if (CHAOS.has(name) && random() < DBCHAOS) {
              const lostResponse = random() < 0.5
              const key = `${name}:${lostResponse ? 'mất câu trả lời' : 'mất yêu cầu'}`
              dbFaults[key] = (dbFaults[key] || 0) + 1
              const run = (lostResponse ? base.rpc(name, rpcArgs).then(() => undefined) : Promise.resolve())
                .then(() => ({ data: null, error: { message: 'TypeError: fetch failed' }, status: 0 }))
              return { abortSignal: () => run, then: (a, b) => run.then(a, b) }
            }
            return base.rpc(name, rpcArgs)
          }
        }
        globalThis.__fbHarness = {
          userData, client, user, runs: [], runSteps: [], workflows: WORKFLOWS,
          block: id => { const b = BLOCKS.find(x => x.id === id); return b ? { ...b, configSchema: [], defaultConfig: {}, isBuiltin: false } : null },
          fakeMedia: (name, temp) => { const f = path.join(userData, 'media.jpg'); fs.writeFileSync(f, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); temp?.push?.(f); return f }
        }
        const facade = makeFacade(db, mod, one)
        const scheduler = new mod.CampaignScheduler(facade, { isRegistered: () => true, listRegistered: () => [], getWebContentsId: () => null },
          { webContents: { send() {} }, isDestroyed: () => false }, undefined, undefined, undefined, { runtimeTarget: 'desktop' })
        scheduler.running = true
        let page = new WorldPage(world, instance)
        scheduler.backgroundPages = { getOrCreate: () => (page.dead ? (page = new WorldPage(world, instance)) : page), destroy() { page.dead = true },
          destroyAll() {}, createTemporary() { return { page } } }
        Object.assign(scheduler, { startBackgroundPreview() {}, stopBackgroundPreview() {}, selectAutomationBrowser() {}, broadcastCampaignUpdate() {} })
        const engineRun = scheduler.engineV2.run.bind(scheduler.engineV2)
        scheduler.engineV2.run = async (wf, variables, pageArg, ctx = {}) => {
          world.begin({ campaignId: Number(ctx.campaignId), inputDataId: ctx.campaignInputDataId ?? null, run: variables?.engineTargetRunId ?? null,
            instance: instance.no, slot: ctx.campaignInputDataId == null ? (variables?.engineTargetRunId ?? null) : null })
          try { return await engineRun(wf, variables, pageArg, ctx) } finally { world.current = null }
        }
        return { instance, scheduler }
      }
      let proc = newInstance()

      // ---- chiến dịch ----
      let nextId = seed * 1_000_000
      const campaigns = []
      for (let c = 0; c < CAMPAIGNS; c++) {
        const timeline = c % 3 === 2
        const share = !timeline && c % 2 === 1
        const account = ++nextId, campaign = ++nextId
        await db.query(`INSERT INTO public.auto_accounts (id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id,
            is_zalo_server, is_zalo_show_web) OVERRIDING SYSTEM VALUE VALUES ($1, 'FB', 'facebook', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false, false)`,
          [account, STAFF, ORG])
        await db.query(`INSERT INTO public.auto_campaigns (id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, schedule_type,
            content, extra_settings) OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', now() - interval '1 minute', false, $5, $6, 'daily', 'Nội dung', $7)`,
          [campaign, `Kịch bản ${seed}.${c}`, timeline ? 'facebook_timeline_post' : 'facebook_group_post', account, STAFF, ORG,
            JSON.stringify(timeline ? {} : { enableComment: true, commentCount: 2, ...(share ? { enableGroupPostShareToJoinedGroups: true, groupPostShareMaxCount: 3 } : {}) })])
        const ids = []
        if (!timeline) {
          for (let i = 0; i < TARGETS; i++) {
            const id = ++nextId
            await db.query(`INSERT INTO public.auto_campaign_input_data (id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
              VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Nhóm ${i + 1}`, `https://www.facebook.com/groups/s${seed}c${c}g${i}`])
            ids.push(id)
          }
        }
        campaigns.push({ campaign, account, timeline, share, ids, slots: timeline ? 3 : 0, units: [], pauses: 0, restarts: 0 })
      }

      const accountObj = async id => ({ ...mod.mapAccountFromDB(await one('SELECT * FROM public.auto_accounts WHERE id = $1', [id])),
        accountGroupSettings: { sleepBetweenActions: 0 }, facebookRandomRunEnabled: false })
      const campaignObj = async id => mod.mapCampaignFromDB(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id]))
      const expireLeases = () => db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 hour' WHERE expires_at > now() - interval '1 hour'`)

      for (const c of campaigns) {
        // danh mục nạp nền lần đầu
        for (let i = 0; i < 40; i++) {
          const s = proc.scheduler.engineRunner.support(await accountObj(c.account), await campaignObj(c.campaign))
          if (s.ok || s.reason !== 'catalog_loading') break
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        let slotsDone = 0
        for (let unit = 0; unit < 80; unit++) {
          const row = await one('SELECT status, note FROM public.auto_campaigns WHERE id = $1', [c.campaign])
          if (row.status === 'tạm dừng') c.pauses++
          if (!c.timeline) {
            const pending = await one(`SELECT count(*)::int AS n FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND status = 'chờ xử lý'`, [c.campaign])
            const open = await one(`SELECT count(*)::int AS n FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [c.campaign])
            if (pending.n === 0 && open.n === 0) break
          } else if (slotsDone >= c.slots) break
          // Người dùng bấm Tiếp tục khi chiến dịch tạm dừng; mốc lịch đến hạn; tài khoản đăng nhập lại; thời gian trôi qua (lease, khoá hết hạn).
          await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, schedule = now() - interval '1 minute' WHERE id = $1`, [c.campaign])
          await db.query(`UPDATE public.auto_accounts SET login_status = 'đã đăng nhập', status = 'chờ xử lý' WHERE id = $1`, [c.account])
          await db.query(`UPDATE public.auto_account_action_status SET is_disable = false, date_enable = NULL WHERE account_id = $1`, [c.account])
          await expireLeases()
          // Thời gian trôi qua: lượt data mở của tiến trình đã chết quá engine.stale_target_minutes, job pg_cron aka-agent-engine-close-stale
          // (mỗi phút) đóng chúng (DB thử không có pg_cron: gọi thẳng).
          await db.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '1 hour' WHERE completed_at IS NULL`)
          await db.query(`SELECT public.aka_agent_engine_close_stale_v1(200)`)
          mod.clearFacebookIdentityMarker(c.account)
          let result = null
          try {
            result = await proc.scheduler.engineRunner.run(await accountObj(c.account), await campaignObj(c.campaign))
          } catch (error) {
            report.violations.push({ seed, rule: 'ném lỗi', campaign: c.campaign, error: String(error.stack || error).slice(0, 400) })
          }
          c.units.push(result?.reason ?? null)
          if (c.timeline && result && result.targets > 0) slotsDone++
          if (proc.instance.dead) {
            // Tiến trình chết: bộ chạy mới (lease cũ hết hạn ở vòng sau).
            deadRunners.add(proc.scheduler.engineRunner.runnerId)
            c.restarts++
            proc = newInstance()
          }
        }
      }

      // Lượt chạy kết thúc bình thường phải nhả lease (release_v1); chỉ tiến trình đã chết mới để lại lease tới khi hết hạn.
      const liveLeases = (await db.query(`SELECT account_id, runner_id FROM public.auto_engine_leases WHERE expires_at > now() AND account_id = ANY($1)`,
        [campaigns.map(c => c.account)])).rows.filter(l => !deadRunners.has(l.runner_id))
      // Hết việc: thời gian trôi qua, job dọn lượt treo chạy (lượt của tiến trình chết sau cú bấm cuối cùng).
      await expireLeases()
      await db.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '1 hour' WHERE completed_at IS NULL`)
      await db.query(`SELECT public.aka_agent_engine_close_stale_v1(200)`)

      // ---- bất biến ----
      const violations = []
      const fail = (rule, detail) => violations.push({ seed, rule, ...detail })
      const runs = (await db.query(`SELECT id, campaign_id, input_data_id, marks, completed_at, lease_token, final_response->'target' AS target_resp FROM public.auto_engine_target_runs
        WHERE campaign_id = ANY($1)`, [campaigns.map(c => c.campaign)])).rows
      const details = (await db.query(`SELECT campaign_id, input_data_id, action_code, status FROM public.auto_campaign_details WHERE campaign_id = ANY($1)`,
        [campaigns.map(c => c.campaign)])).rows
      const finals = new Map((await db.query(`SELECT id, status FROM public.auto_campaign_input_data WHERE campaign_id = ANY($1)`,
        [campaigns.map(c => c.campaign)])).rows.map(r => [Number(r.id), r.status]))
      const postsOf = new Map()
      const markOf = (target, action) => runs.some(r => Number(r.input_data_id) === Number(target) && (r.marks ?? []).some(m => m.actionCode === action))
      for (const s of world.sends) {
        if (s.kind === 'post' && s.target != null) {
          for (const id of [s.target, ...s.shareTo]) postsOf.set(id, (postsOf.get(id) || 0) + 1)
          if (!markOf(s.target, 'fb_post_group')) fail('B3 đăng mà chưa ghi dấu', { target: s.target })
          for (const id of s.shareTo) if (!markOf(id, 'fb_post_group')) fail('B3 chia sẻ kèm mà nhóm chưa ghi dấu', { target: id, main: s.target })
        }
        if (s.kind === 'comment' && !markOf(s.target, 'fb_comment')) fail('B3 comment mà chưa ghi dấu', { target: s.target, position: s.position })
      }
      for (const [id, n] of postsOf) {
        if (n <= 1) continue
        fail('B1 đăng trùng', { target: id, n, sends: world.sends.filter(x => x.kind === 'post' && (x.target === id || x.shareTo.includes(id)))
          .map(x => ({ main: x.target, run: x.run, instance: x.instance })),
          runs: runs.filter(r => Number(r.input_data_id) === Number(id)).map(r => ({ id: r.id, closed: r.completed_at != null,
            marks: (r.marks ?? []).map(m => `${m.stepKey}:${m.actionCode}:${m.state}`) })) })
      }
      const comments = new Map()
      for (const s of world.sends.filter(x => x.kind === 'comment')) {
        const k = `${s.target}:${s.position}`
        comments.set(k, (comments.get(k) || 0) + 1)
      }
      for (const [k, n] of comments) if (n > 1) fail('B2 comment trùng', { key: k, n })
      const sentTargets = new Set([...postsOf.keys(), ...world.sends.filter(x => x.kind === 'comment').map(x => x.target)])
      for (const id of sentTargets) if (id != null && finals.get(Number(id)) === 'chờ xử lý') fail('B4 data đã gửi lại về hàng đợi', { target: id })
      const openRuns = runs.filter(r => r.completed_at == null)
      if (openRuns.length) fail('B5 còn lượt data mở', { n: openRuns.length, runs: openRuns.slice(0, 5).map(r => ({ id: r.id, target: r.input_data_id,
        marks: (r.marks ?? []).map(m => `${m.stepKey}:${m.state}`), data: finals.get(Number(r.input_data_id)) })) })
      if (liveLeases.length) fail('B5 lượt chạy xong mà không nhả lease', { leases: liveLeases.slice(0, 5) })
      for (const d of details) {
        if (d.status !== 'thành công' || d.input_data_id == null) continue
        if (d.action_code === 'fb_post_group' && !(postsOf.get(Number(d.input_data_id)) > 0)) fail('B6 đăng thành công giả', { target: d.input_data_id })
      }
      const okComments = new Map()
      for (const d of details) if (d.action_code === 'fb_comment' && d.status === 'thành công') okComments.set(Number(d.input_data_id), (okComments.get(Number(d.input_data_id)) || 0) + 1)
      for (const [id, n] of okComments) {
        const real = world.sends.filter(x => x.kind === 'comment' && Number(x.target) === id).length
        if (n > real) fail('B6 comment thành công giả', { target: id, rows: n, real })
      }
      for (const c of campaigns.filter(x => x.timeline)) {
        const posts = world.sends.filter(s => s.kind === 'post' && s.campaign === c.campaign)
        const bySlot = new Map()
        for (const p of posts) bySlot.set(p.slot, (bySlot.get(p.slot) || 0) + 1)
        for (const [slot, n] of bySlot) if (n > 1) fail('B7 một mốc đăng nhiều bài', { campaign: c.campaign, slot, n })
      }
      const summary = { seed, sends: world.sends.length, faults: world.faults, dbFaults, campaigns: campaigns.map(c => ({ id: c.campaign,
        type: c.timeline ? 'timeline' : c.share ? 'group+share' : 'group', units: c.units.length, pauses: c.pauses, restarts: c.restarts,
        reasons: [...new Set(c.units)] })), violations: violations.length }
      report.seeds.push(summary)
      report.violations.push(...violations)
      console.log(`hạt giống ${seed}: ${world.sends.length} cú gửi, lỗi trang ${JSON.stringify(world.faults)}, lỗi DB ${JSON.stringify(dbFaults)}, ` +
        `khởi động lại ${campaigns.reduce((n, c) => n + c.restarts, 0)}, tạm dừng ${campaigns.reduce((n, c) => n + c.pauses, 0)}, vi phạm ${violations.length}`)
      for (const v of violations.slice(0, 20)) console.log('   ✗', JSON.stringify(v))
    }
  } finally {
    await db.end().catch(() => undefined)
    cluster.stop()
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  console.log(report.violations.length ? `\n${report.violations.length} vi phạm bất biến` : '\nKhông vi phạm bất biến nào')
  process.exit(report.violations.length ? 1 : 0)
}

/** Kho dữ liệu của bộ lập lịch (campaignRepository…) tối thiểu cho đường Facebook của engine, đọc / ghi DB thử. */
function makeFacade(db, mod, one) {
  const mapCampaign = row => row && mod.mapCampaignFromDB(row)
  return new Proxy({
    getCampaign: async id => mapCampaign(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id])),
    getCampaignAction: async id => ({ id, limitCheckActionCodes: id === 'facebook_group_post' ? ['fb_post_group', 'fb_comment'] : [] }),
    listCampaignInputData: async campaignId => (await db.query('SELECT * FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id',
      [campaignId])).rows.map(r => mod.mapCampaignInputDataFromDB(r)),
    updateCampaign: async (id, patch) => {
      if (patch.extraSettings) await db.query('UPDATE public.auto_campaigns SET extra_settings = $2 WHERE id = $1', [id, JSON.stringify(patch.extraSettings)])
      return mapCampaign(await one('SELECT * FROM public.auto_campaigns WHERE id = $1', [id]))
    },
    appendCampaignLog: async id => {
      const row = await one('SELECT id, name, account_id FROM public.auto_campaigns WHERE id = $1', [id])
      return { id: Number(row.id), name: row.name, accountId: Number(row.account_id), accountName: 'FB' }
    },
    upsertGroupPostContactStatus: async () => undefined,
    updatePendingUnclaimedCampaignNote: async (id, _updatedAt, note) => mapCampaign(await one(`UPDATE public.auto_campaigns SET note = $2
      WHERE id = $1 AND status = 'chờ xử lý' RETURNING *`, [id, note])),
    createCampaignDetail: async () => { throw new Error('bộ cũ ghi thẳng lịch sử') },
    getErrorPolicy: async () => null,
    applyCampaignDeliveryCooldown: async (_campaignId, _accountId, ids) => ids.map(id => ({ inputDataId: Number(id), decision: 'allowed' })),
    getRuntimeClock: async () => {
      const r = await one(`SELECT now() AS db_now, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS vn,
        ((date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS next_midnight`)
      return { dbNow: new Date(r.db_now).toISOString(), vietnamDateKey: r.vn, nextVietnamMidnight: new Date(r.next_midnight).toISOString() }
    },
    getAccountRateLimitStatus: async () => ({ ok: true, dailyLimit: 100000, dailyActionCount: 0, windowLimit: 100000, windowActionCount: 0 }),
    updateCampaignInputData: async (id, patch) => {
      await db.query(`UPDATE public.auto_campaign_input_data SET status = coalesce($2, status), note = CASE WHEN $4 THEN $3 ELSE note END WHERE id = $1`,
        [id, patch.status ?? null, patch.note ?? null, 'note' in patch])
      return null
    },
    listCampaignDetailsByInputData: async inputDataId => (await db.query(`SELECT * FROM public.auto_campaign_details WHERE input_data_id = $1`,
      [inputDataId])).rows.map(r => ({ campaignId: Number(r.campaign_id), actionName: r.action_name, status: r.status, data: r.data })),
    listCampaignDetailsByCampaign: async campaignId => (await db.query(`SELECT * FROM public.auto_campaign_details WHERE campaign_id = $1`,
      [campaignId])).rows.map(r => ({ campaignId: Number(r.campaign_id), actionName: r.action_name, status: r.status, data: r.data })),
    setDesktopCampaignStatusV2: async (id, _accountId, status) => (await one(`UPDATE public.auto_campaigns SET status = $2
      WHERE id = $1 AND status IS DISTINCT FROM $2 RETURNING id`, [id, status])) ? { ok: true } : { ok: false, reason: 'already_target' }
  }, { get(target, key) {
    if (key in target) return target[key]
    if (typeof key !== 'string' || key === 'then') return undefined
    return async () => null
  } })
}

main().catch(error => { console.error(error); process.exit(1) })
