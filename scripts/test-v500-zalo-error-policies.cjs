// Kiểm V500 (chính sách xử lý lỗi Zalo anh đã duyệt 11/11/2026) trên PostgreSQL 17 cục bộ dùng một lần: fixture V495 từ
// ảnh chụp danh mục thật, rồi V499 (nhớ theo tài khoản), rồi V500. Không chạm DB thật.
//   1. Mỗi dòng đặc tả (scripts/build-v500-sql.cjs) ra đúng chính sách hiệu lực; luật mới phân loại đúng; mọi tín hiệu/mã
//      không thuộc quyết định cho kết quả y hệt trước V500; mã mới không lọt vào bộ kiểm của bản cũ.
//   2. Chạy thật qua claim/mark/report theo từng quyết định (Q1–Q6).
//   3. Gỡ: mọi mô phỏng về đúng trước V500; apply lại được.
// Chạy: node scripts/test-v500-zalo-error-policies.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const spec = require('./build-v500-sql.cjs')
const v499 = require('./build-v499-sql.cjs')

const APPLY = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'migrations/rollback_v500_zalo_error_policies.sql'), 'utf8')
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V500_TEST_PORT || 55500), label: 'aka-v500-' })
  const db = await connect()
  const q = (text, args = []) => db.query(text, args)
  const one = async (text, args = []) => (await q(text, args)).rows[0]
  const val = async (text, args = []) => Object.values((await q(text, args)).rows[0] || {})[0]
  const rpc = async (fn, ...args) => val(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')})`, args)
  try {
    assert.equal(APPLY, spec.migration, 'file migration phải đúng bản script sinh'); assert.equal(ROLLBACK, spec.rollback)
    await buildFixture(db, [])
    await q(MIGRATION)
    await assert.rejects(q(APPLY), /cần V499/, 'thiếu V499 thì không apply')
    await q('ROLLBACK').catch(() => {})
    await q(v499.migration)

    const simulate = (actionCode, phase, signal, runtime = 'fly') => rpc('aka_agent_engine_simulate_v1', 'zalo_message_phone', runtime,
      JSON.stringify({ actionCode, ok: false, phase, signal }))
    const strip = res => JSON.parse(JSON.stringify(res, (k, v) => ['policy_ids', 'revisions', 'ruleId'].includes(k) ? undefined : v))
    const matrix = async () => {
      const rules = (await q(`SELECT DISTINCT signal_kind, pattern FROM public.auto_outcome_signal_rules ORDER BY 1, 2`)).rows
      const signals = rules.map(r => r.signal_kind === 'message_like' ? { kind: 'message_like', message: r.pattern.replaceAll('%', '') }
        : { kind: r.signal_kind, code: r.pattern === '*' ? 'zzz' : r.pattern, message: 'x' })
      signals.push({ kind: 'errno', code: 'ECONNRESET', message: 'fetch failed' }, { kind: 'message_like', message: 'fetch failed' },
        { kind: 'http_status', code: '429' }, { kind: 'http_status', code: '502' }, { kind: 'timeout', code: 'step:lookup' },
        { kind: 'exception', message: 'TypeError: x' }, { kind: 'message_like', message: 'Chưa có session Zalo' })
      const out = new Map()
      for (const action of spec.ZALO_ACTIONS) {
        for (const phase of ['before_send', 'in_flight', 'after_send']) {
          for (const signal of signals) out.set(JSON.stringify([action, phase, signal]), strip(await simulate(action, phase, signal)))
        }
      }
      return out
    }
    const before = await matrix()

    // ---- 1. Apply, chính sách hiệu lực, luật mới, phần không đổi -------------------------------------------------------
    await q(APPLY)
    await assert.rejects(q(APPLY), /đã có dòng v500_review|đã có trong sổ/)
    await q('ROLLBACK').catch(() => {})
    assert.deepEqual((await q(`SELECT issue, subject FROM public.aka_agent_engine_policy_lint`)).rows, [])
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policies WHERE source = 'v500_review'`)), spec.policyRowCount)
    pass(`apply V500 sau V499 (thiếu V499 thì bị chặn); apply lần hai bị chặn; ${spec.policyRowCount} dòng chính sách; lint sạch`)

    const FIELDS = ['detail_mode', 'log_template', 'quota_effect', 'target_streak_effect', 'streak_threshold', 'target_effect', 'remaining_steps',
      'lock_action_codes', 'lock_mode', 'lock_minutes', 'run_effect', 'pace_mode', 'remember_target_days', 'campaign_effect']
    let rows = 0
    for (const [, code, actions, fields, , runtimes] of spec.POLICIES) {
      for (const action of actions) {
        for (const runtime of runtimes ?? ['desktop', 'fly']) {
          const eff = await rpc('aka_agent_engine_resolve_policy', code, null, action ?? 'zalo_find_phone_user', 'zalo_message_phone', runtime, 'after_send')
          // Thao tác phụ (gắn tag, đổi tên): chặn theo thao tác của V495 luôn thắng (không tính lượt, không cộng chuỗi lỗi).
          const aux = ['zalo_tag_contact', 'zalo_change_alias'].includes(action)
          for (const f of FIELDS) {
            if (fields[f] === undefined) continue
            const expected = aux && f === 'quota_effect' ? 'no_count' : aux && f === 'target_streak_effect' ? 'ignore' : fields[f]
            assert.deepEqual(eff[f], expected, `${code}/${action}/${runtime}: ${f}`)
          }
          if (fields.detail_status) assert.equal(eff.detail_status_id, Number(await val(`SELECT id FROM public.auto_status WHERE code = $1`, [fields.detail_status])))
          rows++
        }
      }
    }
    pass(`${rows} cặp (mã, thao tác, nơi chạy) ra đúng chính sách hiệu lực sau khi gộp với seed`)

    const cls = async (action, phase, signal) => (await simulate(action, phase, signal)).errorCode
    const expectations = [
      ['zalo_find_phone_user', 'before_send', { kind: 'errno', code: 'ECONNRESET', message: 'fetch failed' }, 'err_network_offline'],
      ['zalo_find_phone_user', 'before_send', { kind: 'http_status', code: '502' }, 'err_network_offline'],
      ['zalo_find_phone_user', 'before_send', { kind: 'timeout', code: 'step:lookup' }, 'err_network_offline'],
      ['zalo_message_stranger', 'in_flight', { kind: 'message_like', message: 'fetch failed' }, 'err_engine_unknown_delivery'],
      ['zalo_message_stranger', 'in_flight', { kind: 'timeout', code: 'step:message' }, 'err_engine_unknown_delivery'],
      ['zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '-69', message: 'Stop retry' }, 'err_engine_unknown_delivery'],
      ['zalo_find_phone_user', 'before_send', { kind: 'message_like', message: 'Chưa có session Zalo' }, 'err_zalo_session_invalid'],
      ['zalo_find_phone_user', 'before_send', { kind: 'engine', code: 'target_missing_identity' }, 'err_input_invalid'],
      ['zalo_message_friend', 'after_send', { kind: 'zalo_code', code: '120' }, 'err_zalo_120_message_stranger'],
      ['zalo_message_friend', 'after_send', { kind: 'zalo_code', code: '802' }, 'err_zalo_802_message_stranger'],
      ['zalo_add_group_member', 'after_send', { kind: 'zalo_code', code: '164' }, 'err_engine_zalo_not_group_member'],
      ['zalo_add_group_member', 'after_send', { kind: 'zalo_code', code: '183' }, 'err_engine_zalo_group_member_limit'],
      ['zalo_join_group_link', 'after_send', { kind: 'zalo_code', code: '172' }, 'err_engine_zalo_group_full'],
      ['zalo_join_group_link', 'after_send', { kind: 'zalo_code', code: '299' }, 'err_engine_zalo_join_group_day_limit'],
      ['zalo_cancel_sent_friend_request', 'after_send', { kind: 'zalo_code', code: '301' }, 'err_engine_zalo_cancel_friend_day_limit'],
      ['zalo_tag_contact', 'after_send', { kind: 'zalo_code', code: '230' }, 'err_engine_zalo_tag_outdated'],
      ['zalo_add_group_member', 'after_send', { kind: 'zalo_code', code: '240' }, 'err_engine_zalo_group_invite_pending'],
      // Không đổi.
      ['zalo_find_phone_user', 'after_send', { kind: 'zalo_code', code: '216' }, 'err_zalo_user_not_found'],
      ['zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '122' }, 'err_zalo_receiver_blocks_stranger_message'],
      ['zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '123' }, 'err_zalo_123_message_stranger'],
      ['zalo_message_stranger', 'after_send', { kind: 'message_like', message: 'Lỗi gì đó' }, 'err_zalo_api_business_failed'],
      ['zalo_message_stranger', 'after_send', { kind: 'http_status', code: '403' }, 'err_zalo_api_business_failed'],
      ['zalo_message_stranger', 'in_flight', { kind: 'exception', message: 'TypeError' }, 'err_undefined'],
      ['zalo_find_phone_user', 'before_send', { kind: 'exception', message: 'TypeError' }, 'err_undefined'],
      ['zalo_message_stranger', 'after_send', { kind: 'fly_command', code: 'campaign_media_timeout' }, 'err_engine_unknown_delivery'],
      ['zalo_find_phone_user', 'before_send', { kind: 'fly_command', code: 'campaign_runtime_unavailable' }, 'err_engine_runtime_unavailable'],
      ['zalo_message_stranger', 'before_send', { kind: 'engine', code: 'recipient_opted_out' }, 'err_engine_recipient_opted_out'],
      ['zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '120' }, 'err_zalo_120_message_stranger'],
      ['zalo_message_group', 'after_send', { kind: 'zalo_code', code: '164' }, 'err_zalo_api_business_failed']
    ]
    for (const [action, phase, signal, code] of expectations) assert.equal(await cls(action, phase, signal), code, JSON.stringify([action, phase, signal]))
    pass(`${expectations.length} ca phân loại: lỗi hạ tầng theo pha (NET01 chưa gửi, UNK01 đang gửi), -69, phiên, DAT01, mã mới; mã cũ và 123 không đổi`)

    const after = await matrix()
    // Cặp (mã, thao tác) có dòng chính sách V500; mã V500 thêm hẳn (luật mới) coi như đổi ở mọi thao tác.
    const touched = new Set()
    for (const [, code, actions] of spec.POLICIES) for (const action of actions) touched.add(action ? `${code}|${action}` : `${code}|*`)
    const isTouched = (code, action) => touched.has(`${code}|${action}`) || touched.has(`${code}|*`)
    let same = 0, changed = 0
    for (const [key, b] of before) {
      const [action] = JSON.parse(key)
      const a = after.get(key)
      if (b.errorCode === a.errorCode && !isTouched(b.errorCode, action)) { assert.deepEqual(a, b, key); same++ } else changed++
    }
    assert.ok(same > 300 && changed > 0, `không đổi: ${same}, đổi: ${changed}`)
    pass(`${same} mô phỏng ngoài các quyết định y hệt trước V500 (${changed} ca thuộc mã được quyết định đổi)`)

    const fresh = spec.NEW_CODES.map(r => r[0])
    assert.deepEqual((await q(`SELECT error_code FROM public.auto_error WHERE error_code = ANY($1)
      AND (error_type <> 'engine v2' OR cardinality(zalo_error_codes) > 0 OR counts_toward_limit OR counts_toward_bad_target)`, [fresh])).rows, [])
    pass('mã mới là engine v2 không mang mã Zalo: bộ chạy cũ (đọc zalo_error_codes) không thấy')

    // ---- 2. Chạy thật -------------------------------------------------------------------------------------------------------
    let nextId = 995000
    const makeCampaign = async ({ org = 801, phones, account } = {}) => {
      const campaign = ++nextId, staff = 7201
      const acc = account ?? ++nextId
      await q(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org V500', true) ON CONFLICT (id) DO NOTHING`, [org])
      if (!account) {
        await q(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
          OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo V500', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, true)`, [acc, staff, org])
      }
      await q(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Chiến dịch V500', 'zalo_message_phone', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4)`,
      [campaign, acc, staff, org])
      const ids = []
      for (const phone of phones ?? [`0913${String(campaign).slice(-6)}`]) {
        const id = ++nextId
        await q(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, 'Khách', $3, 'chờ xử lý', false)`, [id, campaign, phone])
        ids.push(id)
      }
      return { account: acc, campaign, staff, ids, lease: null }
    }
    const claim = async c => {
      const res = await rpc('aka_agent_engine_claim_target_v1', JSON.stringify({ staffId: c.staff, accountId: c.account, campaignId: c.campaign,
        runnerId: 'fly:v500', runtimeTarget: 'fly', leaseToken: c.lease,
        actions: [{ code: 'zalo_find_phone_user' }, { code: 'zalo_message_stranger' }, { code: 'zalo_add_friend', required: false }] }))
      if (res.leaseToken) c.lease = res.leaseToken
      return res
    }
    const release = async c => { const res = await rpc('aka_agent_engine_release_v1', c.account, c.lease); c.lease = null; return res }
    let rk = 0
    const report = (cl, outcomes, final = false) => rpc('aka_agent_engine_report_v1', cl.targetRunId, cl.leaseToken,
      JSON.stringify(outcomes.map(o => ({ resultKey: `v500:${++rk}:${o.actionCode}`, stepKey: o.actionCode, ...o }))), final, false)
    const mark = (cl, actionCode) => rpc('aka_agent_engine_mark_sending_v1', cl.targetRunId, cl.leaseToken, actionCode, actionCode)
    const lookupOk = { actionCode: 'zalo_find_phone_user', ok: true, phase: 'after_send' }
    const fail = (actionCode, phase, signal, extra = {}) => ({ actionCode, ok: false, phase, signal, ...extra })
    const target = id => one(`SELECT status, note, schedule FROM public.auto_campaign_input_data WHERE id = $1`, [id])
    const details = id => q(`SELECT action_code, status, error_code, counts_toward_limit FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [id]).then(r => r.rows)
    const campaign = id => one(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [id])
    const unlock = account => q(`UPDATE public.auto_account_action_status SET is_disable = false, date_enable = NULL WHERE account_id = $1`, [account])
    const locks = account => q(`SELECT action_code, date_enable FROM public.auto_account_action_status WHERE account_id = $1 AND is_disable ORDER BY 1`, [account]).then(r => r.rows)
    const near = (iso, minutes) => Math.abs(new Date(iso).getTime() - (Date.now() + minutes * 60000)) < 120000

    // [Q4] 127 (do tài khoản): data về chờ xử lý, không trừ lượt, khoá 30 phút, bỏ kết bạn; 3 lần liền thì tạm dừng, data vẫn chờ xử lý.
    const a = await makeCampaign()
    for (let n = 1; n <= 3; n++) {
      const cl = await claim(a)
      assert.equal(cl.status, 'claimed', `127 lần ${n}: ${JSON.stringify(cl)}`)
      await report(cl, [lookupOk])
      assert.equal((await mark(cl, 'zalo_message_stranger')).ok, true)
      const res = await report(cl, [fail('zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '127', message: 'Gửi quá nhanh' })])
      assert.equal(res.target.done, true, 'bỏ bước kết bạn')
      assert.equal(res.target.status, 'chờ xử lý')
      assert.equal(res.outcomes[0].countsTowardLimit, false)
      assert.ok(near((await locks(a.account))[0].date_enable, 30))
      if (n < 3) {
        assert.equal(res.campaign.effect, 'none')
        await release(a); await unlock(a.account)
      } else {
        assert.equal(res.campaign.effect, 'pause')
        assert.match(res.campaign.note, /^Dừng sau 3 data lỗi\/thất bại liên tiếp \(ngưỡng 3\)/)
        assert.equal((await campaign(a.campaign)).status, 'tạm dừng')
      }
    }
    assert.equal((await target(a.ids[0])).status, 'chờ xử lý', 'data không bị đốt')
    assert.deepEqual((await details(a.ids[0])).filter(d => d.action_code === 'zalo_message_stranger').map(d => [d.status, d.counts_toward_limit]),
      [['thất bại', false], ['thất bại', false], ['thất bại', false]])
    pass('Q4 do tài khoản (127): data về chờ xử lý, không trừ lượt, khoá 30 phút, bỏ kết bạn; 3 lần liền thì tạm dừng chiến dịch, data vẫn chờ xử lý')

    // [Q5] Mất mạng khi tra số: không ghi lịch sử, data về chờ xử lý, khoá mọi thao tác Zalo của tài khoản 5 phút (chiến dịch
    // khác của cùng tài khoản phải chờ); 4 lần liền thì tạm dừng chiến dịch.
    const n1 = await makeCampaign()
    const n2 = await makeCampaign({ account: n1.account })
    for (let n = 1; n <= 4; n++) {
      const cl = await claim(n1)
      assert.equal(cl.status, 'claimed', `mất mạng lần ${n}: ${JSON.stringify(cl)}`)
      const res = await report(cl, [fail('zalo_find_phone_user', 'before_send', { kind: 'errno', code: 'ECONNRESET', message: 'fetch failed' })])
      assert.equal(res.outcomes[0].errorCode, 'err_network_offline')
      assert.equal(res.target.status, 'chờ xử lý')
      await release(n1)
      if (n === 1) {
        assert.match(res.outcomes[0].log, /^Mất kết nối tới Zalo, tạm ngưng tài khoản tới \d{2}:\d{2} \d{2}\/\d{2} \(NET01\)$/)
        const l = await locks(n1.account)
        assert.deepEqual(l.map(x => x.action_code), [...spec.ZALO_ACTIONS].sort())
        assert.ok(l.every(x => near(x.date_enable, 5)))
        const other = await claim(n2)
        assert.equal(other.status, 'wait', 'chiến dịch khác của cùng tài khoản không chen vào')
        if (other.leaseToken) await release(n2)
      }
      if (n < 4) {
        assert.equal(res.campaign.effect, 'none')
        await unlock(n1.account)
        await q(`UPDATE public.auto_campaigns SET schedule = now() - interval '1 minute' WHERE id = $1`, [n1.campaign])
      } else {
        assert.equal(res.campaign.effect, 'pause')
        assert.equal((await campaign(n1.campaign)).status, 'tạm dừng')
      }
    }
    assert.deepEqual(await details(n1.ids[0]), [], 'mất mạng không ghi lịch sử')
    assert.equal((await target(n1.ids[0])).status, 'chờ xử lý', 'data không bị đốt')
    pass('Q5 mất mạng: không ghi lịch sử, data về chờ xử lý, khoá cả 11 thao tác Zalo của tài khoản 5 phút (chiến dịch khác phải chờ); 4 lần liền thì tạm dừng')

    // [Q1][Q6] 216 khi tra số: không nghỉ, vẫn trừ lượt tra; nhớ theo tài khoản; tài khoản khác cùng tổ chức vẫn tra.
    const phone = '0987000216'
    const f1 = await makeCampaign({ org: 802, phones: [phone, '0987000217'] })
    let cl = await claim(f1)
    let res = await report(cl, [fail('zalo_find_phone_user', 'after_send', { kind: 'zalo_code', code: '216', message: 'Không tồn tại' })], true)
    assert.deepEqual([res.pace.mode, res.target.status, res.outcomes[0].countsTowardLimit], ['none', 'hoàn thành', true])
    await release(f1)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_target_memory WHERE account_id = $1 AND error_code = 'err_zalo_user_not_found'`, [f1.account])), 1)
    const f2 = await makeCampaign({ org: 802, phones: [phone], account: f1.account })
    cl = await claim(f2)
    assert.equal(cl.actions.zalo_find_phone_user.decision, 'skip')
    await report(cl, [{ ...lookupOk, statusCode: 'campaign_detail_skipped' }], true)
    await release(f2)
    const g = await makeCampaign({ org: 802, phones: [phone] })
    cl = await claim(g)
    assert.equal(cl.actions.zalo_find_phone_user.decision, 'allow')
    await report(cl, [lookupOk], true)
    await release(g)
    pass('Q1/Q6 tra số 216: không nghỉ, vẫn trừ lượt tra; nhớ theo tài khoản (tài khoản đó bỏ qua, tài khoản khác cùng tổ chức vẫn tra)')

    // [Q2] 122 khi nhắn: tin đã đi, người nhận chặn: trừ lượt; kết bạn 215 không thành công: không trừ; không nghỉ khi mọi bước hỏng.
    const m = await makeCampaign({ org: 803 })
    cl = await claim(m)
    await report(cl, [lookupOk])
    assert.equal((await mark(cl, 'zalo_message_stranger')).ok, true)
    res = await report(cl, [fail('zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '122', message: 'Chặn người lạ' })])
    assert.equal(res.outcomes[0].countsTowardLimit, true)
    assert.equal((await mark(cl, 'zalo_add_friend')).ok, true)
    res = await report(cl, [fail('zalo_add_friend', 'after_send', { kind: 'zalo_code', code: '215', message: 'Không nhận kết bạn' })], true)
    assert.deepEqual([res.outcomes[0].countsTowardLimit, res.pace.mode, res.target.status], [false, 'none', 'hoàn thành'])
    await release(m)
    pass('Q2 nhắn tin bị chặn (122) trừ lượt; kết bạn không thành công (215) không trừ; data mọi bước hỏng thì không nghỉ')

    // [Q1] Nhắn thành công + kết bạn 225: vẫn nghỉ đủ (mức nặng nhất của data).
    const k = await makeCampaign({ org: 803 })
    cl = await claim(k)
    await report(cl, [lookupOk])
    assert.equal((await mark(cl, 'zalo_message_stranger')).ok, true)
    await report(cl, [{ actionCode: 'zalo_message_stranger', ok: true, phase: 'after_send' }])
    assert.equal((await mark(cl, 'zalo_add_friend')).ok, true)
    res = await report(cl, [fail('zalo_add_friend', 'after_send', { kind: 'zalo_code', code: '225', message: 'Đã là bạn bè' })], true)
    assert.equal(res.pace.mode, 'full')
    await release(k)
    pass('Q1 nhắn tin thành công + kết bạn 225: vẫn nghỉ đủ (nghỉ theo bước nặng nhất của data)')

    // [Q3] -69 khi gửi: không rõ kết quả, data hoàn thành, không gửi lại, tính lượt, cộng chuỗi lỗi.
    const s = await makeCampaign({ org: 804 })
    cl = await claim(s)
    await report(cl, [lookupOk])
    assert.equal((await mark(cl, 'zalo_message_stranger')).ok, true)
    res = await report(cl, [fail('zalo_message_stranger', 'after_send', { kind: 'zalo_code', code: '-69', message: 'Stop retry' })], true)
    assert.deepEqual([res.outcomes[0].publicCode, res.outcomes[0].deliveryState, res.outcomes[0].countsTowardLimit, res.target.status, res.streak.effect],
      ['UNK01', 'unknown', true, 'hoàn thành', 'increment'])
    await release(s)
    pass('Q3 -69 khi gửi: không rõ kết quả (UNK01), data hoàn thành, không gửi lại, tính lượt, cộng chuỗi lỗi')

    // [Q1] DAT01.
    const dt = await makeCampaign({ org: 804 })
    cl = await claim(dt)
    res = await report(cl, [fail('zalo_find_phone_user', 'before_send', { kind: 'engine', code: 'target_missing_identity', message: 'SĐT Zalo không hợp lệ' })], true)
    assert.deepEqual([res.outcomes[0].publicCode, res.outcomes[0].countsTowardLimit, res.pace.mode, res.streak.effect], ['DAT01', false, 'none', 'ignore'])
    await release(dt)
    pass('DAT01 (thiếu SĐT/UID): lỗi dữ liệu, không nghỉ, không tính lượt, không cộng chuỗi lỗi')

    // ---- 3. Gỡ -----------------------------------------------------------------------------------------------------------
    await q(ROLLBACK)
    const restored = await matrix()
    for (const [key, b] of before) assert.deepEqual(restored.get(key), b, key)
    assert.equal(await val(`SELECT is_active FROM public.auto_outcome_signal_rules WHERE source = 'seed_v495' AND pattern = 'target_missing_identity'`), true)
    await q(APPLY)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policies WHERE source = 'v500_review'`)), spec.policyRowCount)
    pass(`gỡ V500: ${before.size} mô phỏng về đúng trước V500, luật seed bật lại; apply lại được`)

    console.log(`OK V500: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
