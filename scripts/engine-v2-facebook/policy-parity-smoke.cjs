// V559 (chính sách Facebook bản nháp) trên PostgreSQL 17 cục bộ: so từng cặp mã FB × thao tác FB × trạng thái lỗi × pha của engine
// (aka_agent_engine_resolve_policy, giải inherit như report_v1) với chính ActionStatusCatalog.resolve của bộ cũ (src/shared/actionStatusPolicy.ts,
// override như actionResultRuntime.ts writeManagedActionResult) và cột hiệu ứng phụ của auto_error (applyRuntimeErrorPolicy).
// Kiểm thêm: luật phân loại, mã mới, Q6 / Q20, chặn comment sau khi gửi, Zalo không đổi, gỡ rồi apply lại.
// Chạy: node scripts/engine-v2-facebook/policy-parity-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { buildFacebookFixture, applyFacebookMigrations, readMigration } = require('./fixture.cjs')

const ROOT = path.resolve(__dirname, '../..')
const PORT = Number(process.env.FB_PARITY_TEST_PORT || 55558)
let checks = 0, failed = 0
async function check(name, fn) {
  try { await fn(); checks++; console.log(`PASS ${name}`) } catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack || error.message}`) }
}

async function loadCatalogClass() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-parity-'))
  const outfile = path.join(out, 'catalog.cjs')
  await build({ entryPoints: [path.join(ROOT, 'src/shared/actionStatusPolicy.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error' })
  const mod = require(outfile)
  fs.rmSync(out, { recursive: true, force: true })
  return mod
}

const FAILURE_STATUSES = ['campaign_detail_failed', 'campaign_detail_error', 'campaign_detail_not_found']
const INPUT_TO_TARGET = { none: 'complete', complete: 'complete', pause: 'hold', requeue: 'requeue' }
const CAMPAIGN = { 'tạm dừng': 'pause', 'chờ xử lý': 'hold' }
const LOGIN = { 'chưa đăng nhập': 'logged_out', checkpoint: 'checkpoint' }

async function main() {
  const { ActionStatusCatalog } = await loadCatalogClass()
  const cluster = startCluster({ port: PORT, label: 'aka-fb-parity-', timeoutMs: 600_000 })
  const db = await cluster.connect()
  const q = async (sql, args = []) => (await db.query(sql, args)).rows
  const one = async (sql, args = []) => (await q(sql, args))[0]
  try {
    await buildFacebookFixture(db)
    await applyFacebookMigrations(db)
    const statuses = await q(`SELECT id, code, name, status_value, color, component_type, flatform_type, is_active, is_delete FROM public.auto_status`)
    const statusId = code => Number(statuses.find(s => s.code === code).id)
    const fbActions = (await q(`SELECT code FROM public.auto_account_actions WHERE flatform_type = 'facebook' AND is_active AND NOT is_delete ORDER BY code`)).map(r => r.code)
    const zaloActions = (await q(`SELECT code FROM public.auto_account_actions WHERE flatform_type = 'zalo' AND is_active AND NOT is_delete ORDER BY code`)).map(r => r.code)
    const zaloCodes = (await q(`SELECT error_code FROM public.auto_error WHERE error_type IN ('external zalo', 'engine v2') AND is_active AND NOT is_delete ORDER BY error_code`)).map(r => r.error_code)
    const resolve = async (code, status, action, phase) => (await one(
      `SELECT public.aka_agent_engine_resolve_policy($1, $2, $3, NULL, 'desktop', $4) AS p`, [code, status, action, phase])).p
    // Như khối INHERIT của report_v1: giải lại theo trạng thái kết quả gửi lên, rồi inherit thành write.
    const effective = async (code, action, phase, reportedStatus) => {
      let p = await resolve(code, null, action, phase)
      if (p.detail_mode === 'inherit') {
        p = await resolve(code, reportedStatus ? statusId(reportedStatus) : (p.detail_status_id ? Number(p.detail_status_id) : statusId('campaign_detail_failed')), action, phase)
        if (p.detail_mode === 'inherit') p = { ...p, detail_mode: 'write' }
      }
      return p
    }
    const snapshot = async (codes, actions) => {
      const out = {}
      for (const code of codes) for (const action of actions) for (const phase of ['before_send', 'after_send', 'in_flight']) {
        const p = await resolve(code, null, action, phase)
        delete p.policy_ids; delete p.revisions
        out[`${code}|${action}|${phase}`] = p
      }
      return out
    }
    const fbCodesBefore = (await q(`SELECT error_code FROM public.auto_error WHERE error_type = 'external facebook' AND is_active AND NOT is_delete ORDER BY error_code`)).map(r => r.error_code)
    const zaloBefore = await snapshot(zaloCodes, zaloActions.slice(0, 4))
    const fbBefore = await snapshot(['err_undefined', 'err_engine_unknown_delivery', 'err_runtime_browser', ...fbCodesBefore.slice(0, 6)], fbActions.slice(0, 3))

    const legacyStatuses = statuses.map(s => ({ id: Number(s.id), code: s.code, name: s.name, statusValue: s.status_value, color: s.color,
      componentType: s.component_type, platform: s.flatform_type ?? 'all', isActive: s.is_active, isDelete: s.is_delete }))
    const legacyPolicies = (await q(`SELECT id, action_code, status_id, report_group, counts_toward_limit, bad_target_effect, reset_error_streak,
        input_effect, is_active, is_delete FROM public.auto_account_action_status_policies`)).map(p => ({ id: Number(p.id), actionCode: p.action_code,
      statusId: Number(p.status_id), reportGroup: p.report_group, countsTowardLimit: p.counts_toward_limit, badTargetEffect: p.bad_target_effect,
      resetErrorStreak: p.reset_error_streak, inputEffect: p.input_effect, isActive: p.is_active, isDelete: p.is_delete }))
    const legacyCatalog = new ActionStatusCatalog(legacyStatuses, legacyPolicies)
    const fbErrors = await q(`SELECT * FROM public.auto_error WHERE error_type = 'external facebook' AND is_active AND NOT is_delete ORDER BY public_code`)

    const { SIGNS, SIGNS_SETTING_KEY, SIGNS_JSON } = require('../build-v559-sql.cjs')
    const signCodes = new Set(SIGNS.map(s => s.code))
    const parityDiffs = async () => {
      const diffs = []
      let compared = 0
      for (const e of fbErrors) {
        // Q6 đã chốt; FB06 bộ cũ không đi qua chính sách mã (pauseBeforePageIdentityTarget), kiểm riêng. Mã có dấu hiệu (anh chốt 17/11) giữ
        // cách xử lý của mã hôm nay đang xử lý trường hợp đó, không theo danh mục: kiểm riêng ở dưới.
        if (e.error_code === 'err_fb_checkpoint' || e.error_code === 'err_fb_identity_switch_failed' || signCodes.has(e.error_code)) continue
        for (const action of fbActions) {
          const errorCounting = action === 'fb_add_friend' || e.detail_mode != null
          const override = { detailMode: e.detail_mode, detailStatusId: e.detail_status_id == null ? null : Number(e.detail_status_id), inputEffect: e.input_effect,
            ...(errorCounting ? { countsTowardLimit: e.counts_toward_limit, badTargetEffect: e.counts_toward_bad_target ? 'increment' : 'ignore',
              resetErrorStreak: e.counts_toward_limit } : {}) }
          for (const status of FAILURE_STATUSES) {
            const legacy = legacyCatalog.resolve({ actionCode: action, statusCode: status, operationState: 'not_committed' }, override, {})
            for (const phase of ['before_send', 'after_send']) {
              const p = await effective(e.error_code, action, phase, status)
              compared++
              const want = {
                write: legacy.createDetail, status: legacy.createDetail ? legacy.statusId : null, count: legacy.countsTowardLimit,
                streak: legacy.badTargetEffect, target: INPUT_TO_TARGET[legacy.inputEffect], campaign: CAMPAIGN[e.update_status_campaign] ?? 'none',
                account: e.update_status_account === 'tạm dừng' ? 'pause' : 'none', login: LOGIN[e.update_login_status] ?? 'none',
                locks: (e.disable_action_codes ?? []).join(','), lockMinutes: e.time_disable_actions ?? null, threshold: e.count_consecutive_errors || null
              }
              const got = {
                write: p.detail_mode !== 'suppress', status: p.detail_mode !== 'suppress' ? Number(p.detail_status_id) : null, count: p.quota_effect === 'count',
                streak: p.target_streak_effect, target: p.target_effect, campaign: p.campaign_effect ?? 'none', account: p.account_effect ?? 'none',
                login: p.login_effect ?? 'none', locks: (p.lock_action_codes ?? []).join(','), lockMinutes: p.lock_minutes ?? null, threshold: p.streak_threshold ?? null
              }
              if (JSON.stringify(want) !== JSON.stringify(got)) diffs.push({ code: e.error_code, action, status, phase, want, got })
            }
          }
        }
      }
      return { diffs, compared }
    }

    await check('trước V559 (seed V495) lệch bộ cũ đúng như phương án mục 5.3 (bài so có phân biệt)', async () => {
      const { diffs } = await parityDiffs()
      const codes = new Set(diffs.map(d => d.code))
      for (const code of ['err_fb_composer_editor_not_found', 'err_fb_comment_box_not_found', 'err_group_post_frequency_limit']) assert.ok(codes.has(code), code)
      console.log(`  seed V495: ${diffs.length} cặp lệch bộ cũ trên ${codes.size} mã`)
    })

    const v559 = readMigration('migration_v559_engine_facebook_policies.sql')
    const rollback = readMigration('rollback_v559_engine_facebook_policies.sql')
    // Dòng FB04 của bộ cũ: [số thao tác khoá, chế độ khoá, tạm dừng tài khoản, chiến dịch, đăng nhập].
    const fb04Row = async () => {
      const r = await one(`SELECT cardinality(disable_action_codes)::int AS locks, disable_action_mode AS mode, update_status_account AS account,
        update_status_campaign AS campaign, update_login_status AS login FROM public.auto_error WHERE error_code = 'err_fb_checkpoint'`)
      return [r.locks, r.mode, r.account, r.campaign, r.login]
    }
    const FB04_BEFORE = [11, 'indefinite', 'tạm dừng', 'chờ xử lý', 'checkpoint']
    const FB04_AFTER = [0, 'fixed_minutes', null, 'chờ xử lý', 'checkpoint']
    await check('apply V559 trên DB thử (preflight: V558, vân tay danh mục FB khớp production)', async () => {
      assert.deepEqual(await fb04Row(), FB04_BEFORE)
      await db.query(v559)
      const n = await one(`SELECT count(*)::int AS n FROM public.auto_outcome_policies WHERE source = 'v559_fb_draft' AND is_active`)
      assert.equal(n.n, require('../build-v559-sql.cjs').POLICY_COUNT)
      assert.equal((await q(`SELECT 1 FROM public.aka_agent_engine_policy_lint`)).length, 0)
      await assert.rejects(db.query(v559), /đã có dòng v559_fb_draft|đang bật, cần/)
      await db.query('ROLLBACK')
    })

    await check('anh chốt 17/11: V559 sửa dòng FB04 của bộ cũ (bỏ khoá 11 thao tác, bỏ tạm dừng tài khoản; giữ chiến dịch về chờ, đăng nhập → checkpoint)', async () => {
      assert.deepEqual(await fb04Row(), FB04_AFTER)
      // Các dòng FB khác của bộ cũ không đổi.
      const others = await one(`SELECT count(*)::int AS n FROM public.auto_error WHERE error_type = 'external facebook' AND error_code <> 'err_fb_checkpoint'
        AND updated_at > now() - interval '1 hour'`)
      assert.equal(others.n, 0)
    })

    await check('anh duyệt từng câu 17/11 (Q23): câu cho khách / bước tiếp theo của mã FB, chính sách engine dùng câu đó; câu bộ cũ giữ nguyên', async () => {
      const row = async code => one(`SELECT customer_title AS title, customer_help AS help, noti_running_process AS noti FROM public.auto_error WHERE error_code = $1`, [code])
      assert.deepEqual(await row('err_fb_comment_unavailable_not_member'), { title: 'Tài khoản chưa vào nhóm này nên chưa bình luận được', help: null,
        noti: 'Chưa đủ quyền thành viên để bình luận trong nhóm' })
      assert.deepEqual(await row('err_fb_comment_box_not_found'), { title: 'Không thấy ô bình luận dưới bài', help: 'Mở tab trình duyệt của tài khoản để kiểm tra.',
        noti: 'Không tìm thấy ô bình luận' })
      assert.equal((await row('err_fb_group_composer_editor_not_found')).help, null)
      assert.equal((await row('err_engine_fb_logged_out')).title, 'Tài khoản Facebook đã bị đăng xuất')
      const pol = await one(`SELECT log_template, campaign_note_template FROM public.auto_outcome_policies
        WHERE source = 'v559_fb_draft' AND error_code = 'err_group_post_frequency_limit' AND action_code IS NULL AND is_active`)
      assert.deepEqual(pol, { log_template: 'Facebook báo tài khoản đăng bài vào nhóm quá nhanh',
        campaign_note_template: 'Facebook báo tài khoản đăng bài vào nhóm quá nhanh (FB02). Giảm số bài mỗi giờ hoặc tăng thời gian nghỉ, rồi bấm Tiếp tục chiến dịch.' })
      const missing = await one(`SELECT count(*)::int AS n FROM public.auto_error WHERE error_type = 'external facebook' AND is_active AND NOT is_delete
        AND nullif(btrim(customer_title), '') IS NULL`)
      assert.equal(missing.n, 0)
    })

    await check('mọi mã FB × thao tác FB × trạng thái lỗi × pha: engine sau V559 = bộ cũ (ActionStatusCatalog.resolve + cột auto_error), trừ Q6', async () => {
      const { diffs, compared } = await parityDiffs()
      assert.ok(compared > 2000, `chỉ so được ${compared} cặp`)
      assert.equal(diffs.length, 0, `${diffs.length} cặp lệch, ví dụ ${JSON.stringify(diffs.slice(0, 3))}`)
      console.log(`  ${compared} cặp khớp bộ cũ`)
    })

    await check('Q6: checkpoint chỉ đổi trạng thái đăng nhập, data chưa gửi về hàng đợi, không khoá, không tạm dừng tài khoản / chiến dịch', async () => {
      for (const action of fbActions) {
        const p = await effective('err_fb_checkpoint', action, 'before_send', null)
        assert.deepEqual([p.detail_mode, p.target_effect, p.login_effect, p.account_effect, p.campaign_effect, (p.lock_action_codes ?? []).length, p.run_effect],
          ['suppress', 'requeue', 'checkpoint', 'none', 'none', 0, 'stop_account'], action)
      }
      const logged = await effective('err_engine_fb_logged_out', 'fb_comment', 'before_send', null)
      assert.deepEqual([logged.detail_mode, logged.target_effect, logged.login_effect, (logged.lock_action_codes ?? []).length], ['suppress', 'requeue', 'logged_out', 0])
    })

    // Ghi chú dừng của FB06 là câu anh duyệt 17/11 (Q23) thay câu lỗi thô của bộ cũ.
    const FB06_NOTE = 'Không chuyển được sang Page để đăng bài (FB06). Kiểm tra tài khoản còn quản lý Page này và tên Page trong chiến dịch đã đúng chưa, rồi bấm Tiếp tục chiến dịch.'
    await check('FB06 như bộ cũ (pauseBeforePageIdentityTarget): không ghi lịch sử, không tính lượt, data về hàng đợi, tạm dừng chiến dịch kèm câu lỗi', async () => {
      for (const action of fbActions) {
        const p = await effective('err_fb_identity_switch_failed', action, 'before_send', null)
        assert.deepEqual([p.detail_mode, p.quota_effect, p.target_streak_effect, p.target_effect, p.campaign_effect, p.campaign_note_template, p.run_effect],
          ['suppress', 'no_count', 'ignore', 'requeue', 'pause', FB06_NOTE, 'end_unit'], action)
      }
    })

    await check('FB45: bước chạy xong mà bộ dựng cũ không ghi dòng nào: không ghi, không tính lượt, không cộng chuỗi, data hoàn thành, chạy tiếp', async () => {
      for (const phase of ['before_send', 'in_flight']) {
        const p = await effective('err_engine_fb_no_history', 'fb_like_post', phase, null)
        assert.deepEqual([p.detail_mode, p.quota_effect, p.target_streak_effect, p.target_effect, p.remaining_steps, p.run_effect, p.campaign_effect],
          ['suppress', 'no_count', 'ignore', 'complete', 'continue', 'continue', 'none'], phase)
      }
      const inbox = await effective('err_undefined', 'fb_message_page_inbox_customer', 'after_send', null)
      assert.equal(inbox.streak_threshold, 8, 'inbox Page: bộ cũ tự chạy lại một lần, tạm dừng ở gấp đôi ngưỡng')
      assert.equal((await effective('err_undefined', 'fb_post_group', 'after_send', null)).streak_threshold, 4)
    })

    await check('FB42: dòng không mã của bộ dựng cũ: trạng thái và cách đếm theo trạng thái, câu giữ nguyên (FB42 ở cuối)', async () => {
      const expect = { campaign_detail_failed: ['count', 'increment'], campaign_detail_error: ['no_count', 'increment'], campaign_detail_not_found: ['no_count', 'ignore'] }
      for (const [status, [quota, streak]] of Object.entries(expect)) {
        const p = await effective('err_engine_fb_action_failed', 'fb_comment', 'after_send', status)
        assert.deepEqual([p.detail_mode, Number(p.detail_status_id), p.quota_effect, p.target_streak_effect, p.target_effect, p.log_template],
          ['write', statusId(status), quota, streak, 'complete', '{message}'], status)
      }
      const join = await effective('err_engine_fb_action_failed', 'fb_join_group', 'after_send', 'campaign_detail_error')
      assert.equal(join.quota_effect, 'count', 'tham gia nhóm "lỗi" tính lượt như chính sách trạng thái riêng của bộ cũ')
    })

    await check('FB44 như lỗi không xác định của bộ cũ; SYS04 với thao tác FB về hàng đợi, 4 lần liền tạm dừng (Q20); Zalo giữ SYS04 cũ', async () => {
      const ui = await effective('err_engine_fb_ui_not_ready', 'fb_post_group', 'before_send', null)
      assert.deepEqual([ui.detail_mode, Number(ui.detail_status_id), ui.quota_effect, ui.target_streak_effect, ui.target_effect],
        ['write', statusId('campaign_detail_error'), 'no_count', 'increment', 'complete'])
      const browser = await effective('err_runtime_browser', 'fb_comment', 'before_send', null)
      assert.deepEqual([browser.detail_mode, browser.target_effect, browser.target_streak_effect, browser.streak_threshold, browser.campaign_effect],
        ['suppress', 'requeue', 'increment', 4, 'pause'])
      const zalo = await effective('err_runtime_browser', 'zalo_message_stranger', 'before_send', null)
      assert.equal(zalo.streak_threshold ?? null, null, 'SYS04 của Zalo không đổi')
    })

    await check('comment lỗi sau khi đã gửi: chặn theo thao tác streak_after_delivery = ignore chỉ cho fb_comment', async () => {
      assert.equal((await effective('err_engine_fb_action_failed', 'fb_comment', 'after_send', 'campaign_detail_failed')).streak_after_delivery, 'ignore')
      assert.equal((await effective('err_undefined', 'fb_comment', 'after_send', null)).streak_after_delivery, 'ignore')
      assert.equal((await effective('err_engine_fb_action_failed', 'fb_post_group', 'after_send', 'campaign_detail_failed')).streak_after_delivery ?? null, null)
    })

    await check('dấu hiệu (anh chốt 17/11): mã có chỗ phát mới tính lượt / chuỗi / dừng y như mã hôm nay đang xử lý, chỉ đổi câu cho khách', async () => {
      // So mọi trường quyết định hành vi. Không so: câu (đổi có chủ ý), nhóm lỗi (report_v1 chỉ dùng để ghi lại và khi nhóm là
      // unknown_delivery, không mã nào ở đây), thời gian chờ chạy lại khi data không về hàng đợi (chỉ dùng khi target_effect = requeue).
      const strip = p => {
        const out = { ...p }
        for (const k of ['log_template', 'campaign_note_template', 'policy_ids', 'revisions', 'error_class']) delete out[k]
        if (out.target_effect !== 'requeue') delete out.requeue_after_minutes
        return out
      }
      for (const sign of SIGNS) {
        for (const code of [sign.code, sign.mirror]) {
          assert.notEqual((await resolve(code, null, 'fb_post_group', 'after_send')).error_class, 'unknown_delivery', `${code}: nhóm lỗi unknown_delivery đổi pha giao`)
        }
      }
      let compared = 0
      for (const sign of SIGNS) {
        for (const action of fbActions) for (const phase of ['before_send', 'in_flight', 'after_send']) for (const status of [null, ...FAILURE_STATUSES]) {
          const mine = await effective(sign.code, action, phase, status)
          const today = await effective(sign.mirror, action, phase, status)
          assert.deepEqual(strip(mine), strip(today), `${sign.code} ≠ ${sign.mirror} ở ${action} / ${phase} / ${status}`)
          compared++
        }
        const p = await resolve(sign.code, null, sign.actions[0] ?? 'fb_post_group', 'after_send')
        const title = (await one(`SELECT customer_title AS t FROM public.auto_error WHERE error_code = $1`, [sign.code])).t
        assert.ok(title && p.log_template === title, `${sign.code}: câu cho khách là câu anh duyệt (${p.log_template} / ${title})`)
      }
      const row = await one(`SELECT value, is_active, is_secret FROM public.auto_system_settings WHERE key = $1`, [SIGNS_SETTING_KEY])
      assert.ok(row && row.is_active && !row.is_secret, 'dòng thiết lập dấu hiệu bật, không bí mật')
      assert.deepEqual(JSON.parse(row.value), JSON.parse(SIGNS_JSON))
      console.log(`  ${compared} cặp (mã có dấu hiệu, thao tác, pha, trạng thái) khớp mã hôm nay`)
    })

    await check('luật phân loại tín hiệu Facebook', async () => {
      const classify = async (action, phase, signal, platform = 'facebook') => (await one(
        `SELECT error_code FROM public.aka_agent_engine_classify_signal($1, $2, $3, $4::jsonb)`, [platform, action, phase, JSON.stringify(signal)])).error_code
      const cases = [
        ['fb_comment', 'after_send', { kind: 'block', code: 'status:campaign_detail_failed', message: 'Không comment được bài thứ 2' }, 'err_engine_fb_action_failed'],
        ['fb_post_group', 'after_send', { kind: 'block', code: 'status:campaign_detail_error' }, 'err_engine_fb_action_failed'],
        ['fb_comment', 'in_flight', { kind: 'engine', code: 'fb_checkpoint' }, 'err_fb_checkpoint'],
        ['fb_comment', 'before_send', { kind: 'engine', code: 'fb_logged_out' }, 'err_engine_fb_logged_out'],
        ['fb_comment', 'before_send', { kind: 'engine', code: 'block_hang' }, 'err_runtime_browser'],
        ['fb_comment', 'in_flight', { kind: 'engine', code: 'block_hang' }, 'err_engine_unknown_delivery'],
        ['fb_post_group', 'before_send', { kind: 'engine', code: 'browser_gone' }, 'err_runtime_browser'],
        ['fb_post_group', 'in_flight', { kind: 'engine', code: 'browser_gone' }, 'err_engine_unknown_delivery'],
        ['fb_post_group', 'before_send', { kind: 'block', code: 'click:fb_post_button', message: 'Element not found' }, 'err_engine_fb_ui_not_ready'],
        ['fb_post_group', 'in_flight', { kind: 'block', code: 'click:fb_post_button', message: 'Element not found' }, 'err_undefined'],
        ['fb_message_stranger', 'in_flight', { kind: 'exception', message: 'Bạn đã đạt giới hạn về số tin nhắn đang chờ' }, 'err_limit_waiting_message'],
        ['fb_comment', 'in_flight', { kind: 'exception', message: 'Facebook báo giới hạn tần suất comment' }, 'err_comment_frequency_limit'],
        ['fb_post_group', 'in_flight', { kind: 'exception', message: 'Facebook báo giới hạn tần suất bạn đăng bài' }, 'err_group_post_frequency_limit'],
        ['fb_comment', 'in_flight', { kind: 'exception', message: 'Facebook báo giới hạn tần suất bạn đăng bài' }, 'err_undefined'],
        ['fb_post_group', 'before_send', { kind: 'block', code: 'click:fb_post_button', message: 'Facebook báo giới hạn tần suất bạn đăng bài' }, 'err_group_post_frequency_limit'],
        ['fb_comment', 'before_send', { kind: 'engine', code: 'mark_refused:action_unknown' }, 'err_system_block_load'],
        ['fb_comment', 'before_send', { kind: 'exception', message: 'Cannot read properties of undefined' }, 'err_undefined'],
        ['fb_comment', 'after_send', { kind: 'block', code: 'x', errorCode: 'err_fb_comment_box_not_found' }, 'err_fb_comment_box_not_found']
      ]
      for (const [action, phase, signal, want] of cases) assert.equal(await classify(action, phase, signal), want, JSON.stringify([action, phase, signal]))
      assert.notEqual(await classify('zalo_message_stranger', 'before_send', { kind: 'block', code: 'click:x' }, 'zalo'), 'err_engine_fb_ui_not_ready', 'luật FB không áp cho Zalo')
    })

    await check('Zalo không đổi: chính sách mọi mã Zalo / engine × thao tác Zalo × pha giữ nguyên sau V559', async () => {
      const after = await snapshot(zaloCodes, zaloActions.slice(0, 4))
      const diff = Object.keys(zaloBefore).filter(k => JSON.stringify(zaloBefore[k]) !== JSON.stringify(after[k]))
      assert.deepEqual(diff, [])
    })

    await check('gỡ V559 rồi apply lại: chính sách FB về đúng như trước (seed V495), mã mới tắt; apply lại được', async () => {
      await db.query(rollback)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_outcome_policies WHERE source = 'v559_fb_draft'`)).n, 0)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_error WHERE error_code = 'err_engine_fb_action_failed' AND is_active`)).n, 0)
      const back = await snapshot(['err_undefined', 'err_engine_unknown_delivery', 'err_runtime_browser', ...fbCodesBefore.slice(0, 6)], fbActions.slice(0, 3))
      const diff = Object.keys(fbBefore).filter(k => JSON.stringify(fbBefore[k]) !== JSON.stringify(back[k]))
      assert.deepEqual(diff, [])
      assert.deepEqual(await fb04Row(), FB04_BEFORE)
      assert.equal((await one(`SELECT customer_title AS t FROM public.auto_error WHERE error_code = 'err_fb_comment_unavailable_not_member'`)).t,
        'Chưa đủ quyền thành viên để bình luận trong nhóm', 'gỡ V559 trả câu cho khách về như cũ')
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_system_settings WHERE key = $1`, [SIGNS_SETTING_KEY])).n, 0, 'gỡ V559 xoá dòng dấu hiệu')
      await db.query(v559)
      assert.equal((await one(`SELECT count(*)::int AS n FROM public.auto_error WHERE error_code = 'err_engine_fb_action_failed' AND is_active`)).n, 1)
      assert.deepEqual(await fb04Row(), FB04_AFTER)
    })
  } finally {
    await db.end().catch(() => {})
    cluster.stop()
  }
  console.log(`\n${checks} nhóm kiểm tra đạt${failed ? `, ${failed} lỗi` : ''}`)
  process.exit(failed ? 1 : 0)
}

main().catch(error => { console.error(error); process.exit(1) })
