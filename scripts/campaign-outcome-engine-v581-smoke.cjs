// V581: tách Z114 "Tham số không hợp lệ" thành 4 mã đã rõ nguyên nhân (TAG01, DAT02, DAT03, DAT04; câu anh duyệt 19/11/2026).
// Chạy lõi thật (packages/campaign-engine) + cổng Zalo giả trên PostgreSQL 17 cục bộ có chuỗi V495 → … → V532 như production; cùng kịch
// bản trước V581, sau V581, sau khi gỡ. Không mạng, không dữ liệu khách.
// Chạy: CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/campaign-outcome-engine-v581-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const chain = [499, 501, 503, 504, 505, 506, 507, 508, 509, 512, 515, 517, 527, 532].reduce((m, n) => ({ ...m, [n]: require(`./build-v${n}-sql.cjs`) }), {})
const v581 = require('./build-v581-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V581_TEST_PORT || 55581)
const GROUP = 'zalo_message_group_member'
const { CODES } = v581

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v581-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

const HEARTBEAT_MS = 61000
function testClock() {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms === HEARTBEAT_MS) return signal?.addEventListener('abort', () => resolve(false), { once: true })
      setImmediate(() => resolve(!signal?.aborted))
    })
  }
}

// UID Zalo thật dài 14–19 chữ số.
const UID = n => `70000000000000${String(n).padStart(4, '0')}`
const OWN_UID = '6111111111111111111'

async function main() {
  const E = await loadEngine()

  // ---- 0. Hàm thuần của lõi ---------------------------------------------------------------------------------------------
  for (const phone of ['0912345678', '912345678', '84912345678', '+84912345678', '0356 123 456', '0789.123.456', '0586123456']) {
    assert.equal(E.zaloUidLooksLikePhone(phone), true, `${phone} là SĐT`)
  }
  for (const uid of [UID(1), '1234567890123456', '123', '', '0212345678', '1900123456', '09123456789', 'g1234567890123456789', '8412345']) {
    assert.equal(E.zaloUidLooksLikePhone(uid), false, `${uid} không phải SĐT di động`)
  }
  assert.equal(E.sameZaloUid(OWN_UID, `${OWN_UID}_0`), true)
  assert.equal(E.sameZaloUid(`${OWN_UID}_0`, OWN_UID), true)
  assert.equal(E.sameZaloUid(OWN_UID, UID(1)), false)
  assert.equal(E.sameZaloUid('', ''), false)
  pass('lõi: nhận SĐT di động VN trong cột UID (có / mất số 0, 84, +84, dấu cách); UID Zalo 14–19 số, số bàn, tổng đài không bị nhận nhầm; so UID bỏ hậu tố _0')

  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v581-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v581.NAME}.sql`), 'utf8'), v581.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v581.ROLLBACK_NAME}.sql`), 'utf8'), v581.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(chain[499].migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const n of [501, 503, 504, 505, 506, 507, 508, 509, 512, 515]) await db.query(chain[n].migration)
    // pg_cron giả như smoke V517 / V532 để chuỗi có V517 như production.
    await db.query(`CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL, active boolean NOT NULL DEFAULT true);
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
        ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command RETURNING jobid $$;
      CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;`)
    for (const n of [517, 527, 532]) await db.query(chain[n].migration)

    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r
    const classify = (action, signal, phase = 'after_send') => val(`SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', $1, $2, $3::jsonb) cs`,
      [action, phase, JSON.stringify(signal)])
    const z114 = { kind: 'zalo_code', code: '114' }
    const policy = async (code, action, rt = 'fly', phase = 'after_send') => val(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, $2, NULL, $3, $4)`,
      [code, action, rt, phase])

    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    let nextId = 981000
    const STAFF = 9681, ORG = 681
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.org_staff(id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [STAFF])
    const make = async ({ extra = {}, targets }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extraSettings = { enableMessage: true, ...extra }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content,
        extra_settings, images) OVERRIDING SYSTEM VALUE VALUES ($1, 'Thành viên nhóm', $2, $3, 'chờ xử lý', now() - interval '1 minute', false,
        $4, $5, 'Chào bạn', $6::jsonb, '[]'::jsonb)`, [campaign, GROUP, account, STAFF, ORG, JSON.stringify(extraSettings)])
      const ids = []
      for (const [i, uid] of targets.entries()) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, 'chờ xử lý', false)`, [id, campaign, `Khách ${i + 1}`, uid])
        ids.push(id)
      }
      return { account, campaign, ids, extra: extraSettings }
    }
    const zaloErr = (message, code) => E.zaloPortErrorFrom(Object.assign(new Error(message), { code }), { operation: 'send', answered: true })
    const invalid = () => zaloErr('Tham số không hợp lệ', 114)
    /**
     * b.text / b.friend / b.label: hàm (uid) => true thì Zalo trả 114 ở bước đó. b.own: UID của tài khoản gửi (không truyền = cổng cũ
     * chưa có hàm). b.other: hàm (uid) => boolean | Error của phép tra tài khoản khác (không truyền = cổng cũ chưa có hàm).
     */
    const run = async (c, b = {}) => {
      const calls = [], lines = []
      const port = {
        findUser: async () => null, phoneSearchLimitScope: async () => null, saveFoundUser: async () => {},
        getUserProfile: async (_ctx, uid) => {
          calls.push(`profile:${uid}`)
          return E.normalizeZaloFoundUser({ userId: uid, display_name: 'Lan', zalo_name: 'Lan', globalId: `g-${uid}` })
        },
        saveResolvedProfile: async () => {},
        isOptedOut: async () => false,
        prepareOptOutLink: async () => ({ id: 'x', isOptedOut: false }),
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => {
          calls.push(`text:${uid}`)
          if (b.text?.(uid)) throw invalid()
          return { response: { msgId: 'mt' }, msgId: 'mt' }
        },
        prepareMedia: async () => [],
        sendMedia: async () => { throw new Error('không có tệp') },
        sendFriendRequest: async (_ctx, uid) => { calls.push(`friend:${uid}`); if (b.friend?.(uid)) throw invalid(); return {} },
        friendStatus: async () => null,
        applyLabel: async (_ctx, uid) => { calls.push(`label:${uid}`); if (b.label?.(uid)) throw invalid(); return { kind: 'applied', labelText: 'Khách' } },
        mirrorLabel: async () => {},
        changeAlias: async (_ctx, uid) => { calls.push(`alias:${uid}`); if (b.alias?.(uid)) throw invalid(); return '' },
        applyAkaBizTags: async () => 1,
        ...(b.own !== undefined ? { ownZaloUid: async () => { if (b.own instanceof Error) throw b.own; return b.own } } : {}),
        ...(b.other ? { uidBelongsToOtherAccount: async (_ctx, uid) => {
          calls.push(`owner:${uid}`)
          const answer = b.other(uid)
          if (answer instanceof Error) throw answer
          return answer
        } } : {})
      }
      const core = { id: c.campaign, actionId: GROUP, accountId: c.account, content: 'Chào bạn', extraSettings: c.extra, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(GROUP)
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v581', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: GROUP,
        campaignName: 'Thành viên nhóm', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } }),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      const camp = (await rows(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c.campaign]))[0]
      return {
        result, calls, lines, campaign: camp.status, note: camp.note,
        inputs: (await rows(`SELECT status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])),
        details: (await rows(`SELECT action_code, status, error_code, counts_toward_limit, log FROM public.auto_campaign_details
          WHERE campaign_id = $1 ORDER BY id`, [c.campaign])).map(d => `${d.action_code}|${d.status}|${d.error_code ?? '-'}|${d.counts_toward_limit}|${d.log}`),
        used: async action => Number(await val(`SELECT coalesce((SELECT count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1
          AND action_code = $2), 0)`, [c.account, action])),
        streak: Number(await val(`SELECT coalesce((SELECT count_consecutive_bad_targets FROM public.auto_campaign_error_state WHERE campaign_id = $1), 0)`, [c.campaign]))
      }
    }
    const TAG = { enableZaloTag: true, zaloTagId: '5', zaloTagName: 'Khách' }
    const all = () => true

    // ---- 1. Trước V581 ---------------------------------------------------------------------------------------------------
    assert.equal(await classify('zalo_tag_contact', z114), v581.Z114)
    assert.equal(await classify('zalo_message_stranger', { kind: 'engine', code: v581.SIGNALS.uidPhone }, 'before_send'), 'err_network_offline',
      'tín hiệu engine lạ trước khi gửi: luật chung NET01 (vì vậy apply V581 trước khi lõi mới chạy)')
    const pre = await run(await make({ extra: TAG, targets: [UID(1), UID(2)] }), { label: all })
    assert.deepEqual(pre.details.filter(d => d.startsWith('zalo_tag_contact')), [
      'zalo_tag_contact|thất bại|err_zalo_invalid_param|false|Tham số không hợp lệ (Z114)',
      'zalo_tag_contact|thất bại|err_zalo_invalid_param|false|Tham số không hợp lệ (Z114)'])
    assert.equal(pre.campaign, 'hoàn thành')
    pass('trước V581: 114 ở bước gắn tag ra "Tham số không hợp lệ (Z114)", tin vẫn gửi, chiến dịch chạy hết')

    // ---- 2. Apply / chặn chạy lại / gỡ / apply lại ---------------------------------------------------------------------------
    await db.query(v581.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await classify('zalo_tag_contact', z114), v581.Z114, 'apply rồi ROLLBACK không đổi gì')
    const t0 = Date.now()
    await db.query(v581.migration)
    const applyMs = Date.now() - t0
    assert.equal(await classify('zalo_tag_contact', z114), CODES.tagFull.code)
    for (const a of ['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'zalo_change_alias', 'zalo_message_group', 'zalo_add_group_member']) {
      assert.equal(await classify(a, z114), v581.Z114, `114 × ${a} giữ nguyên Z114`)
    }
    assert.equal(await classify('zalo_tag_contact', { kind: 'zalo_code', code: '230' }), 'err_engine_zalo_tag_outdated', 'mã 230 ở bước tag giữ nguyên')
    for (const phase of ['before_send', 'after_send']) {
      assert.equal(await classify('zalo_message_stranger', { kind: 'engine', code: v581.SIGNALS.uidPhone }, phase), CODES.uidPhone.code)
      assert.equal(await classify('zalo_message_stranger', { kind: 'engine', code: v581.SIGNALS.self }, phase), CODES.self.code)
      assert.equal(await classify('zalo_add_friend', { kind: 'engine', code: v581.SIGNALS.otherAccount }, phase), CODES.otherAccount.code)
    }
    const strip = (p, extra = []) => { const q = { ...p }; for (const k of ['revisions', 'policy_ids', 'log_template', 'campaign_note_template', ...extra]) delete q[k]; return q }
    for (const rt of ['desktop', 'fly']) {
      assert.deepEqual(strip(await policy(CODES.tagFull.code, 'zalo_tag_contact', rt)), strip(await policy(v581.Z114, 'zalo_tag_contact', rt)), `TAG01 ${rt}: như 114 × gắn tag`)
      for (const a of ['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend']) {
        const base = strip(await policy(v581.DAT01, a, rt, 'before_send'))
        const phonePolicy = await policy(CODES.uidPhone.code, a, rt, 'before_send')
        if (v581.UID_PHONE_ACTIONS.includes(a)) {
          const streak = ['target_streak_effect', 'streak_threshold', 'campaign_effect']
          assert.deepEqual(strip(phonePolicy, streak), strip(await policy(v581.DAT01, a, rt, 'before_send'), streak), `DAT02 ${a} ${rt}: như DAT01 ngoài phần đã chốt`)
          assert.deepEqual([phonePolicy.quota_effect, phonePolicy.target_streak_effect, phonePolicy.streak_threshold, phonePolicy.campaign_effect, phonePolicy.target_effect],
            ['no_count', 'increment', 4, 'pause', 'complete'])
        } else {
          assert.deepEqual(strip(phonePolicy), base, `DAT02 ${a} ${rt}: như DAT01`)
        }
        assert.deepEqual(strip(await policy(CODES.self.code, a, rt, 'before_send')), base, `DAT03 ${a} ${rt}: như DAT01`)
        const other = await policy(CODES.otherAccount.code, a, rt)
        const changed = ['target_streak_effect', 'streak_threshold', 'remaining_steps', 'campaign_effect']
        assert.deepEqual(strip(other, changed), strip(await policy(v581.Z114, a, rt), changed), `DAT04 ${a} ${rt}: như 114 ngoài phần đã chốt`)
        assert.deepEqual([other.quota_effect, other.target_streak_effect, other.streak_threshold, other.campaign_effect, other.remaining_steps, other.target_effect],
          ['no_count', 'increment', 4, 'pause', 'skip', 'complete'])
      }
    }
    const errs = await rows(`SELECT error_code, error_type, public_code, error_class, zalo_error_codes, customer_title, customer_help
      FROM public.auto_error WHERE error_code = ANY ($1) ORDER BY public_code`, [Object.values(CODES).map(c => c.code)])
    assert.deepEqual(errs.map(e => [e.public_code, e.error_type, e.error_class, e.zalo_error_codes, e.customer_title, e.customer_help]), [
      ['DAT02', 'engine v2', 'target_permanent', [], 'Data là số điện thoại, không phải UID Zalo', 'Dùng loại chiến dịch Nhắn tin theo SĐT cho danh sách này.'],
      ['DAT03', 'engine v2', 'target_permanent', [], 'Không gửi cho chính tài khoản đang gửi', null],
      ['DAT04', 'engine v2', 'target_permanent', [], 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được',
        'Dùng tài khoản đã quét danh sách để chạy, hoặc quét lại bằng tài khoản này.'],
      ['TAG01', 'engine v2', 'target_permanent', [], 'Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm',
        'Gỡ bớt người khỏi các tag trong Zalo rồi chạy tiếp chiến dịch.']
    ], 'câu đúng như anh duyệt 19/11/2026; không có mã Zalo nên bộ chạy cũ không khớp')
    assert.equal(Number(await val(`SELECT count(*) FROM public.aka_agent_engine_policy_lint`)), 0, 'không có dòng lint')
    await assert.rejects(db.query(v581.migration), /đã có chính sách hoặc luật của các mã mới/)
    await db.query('ROLLBACK')
    await db.query(v581.rollback)
    assert.equal(await classify('zalo_tag_contact', z114), v581.Z114, 'gỡ trả phân loại cũ')
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_policies WHERE source = $1`, [v581.SOURCE])), 0)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_error WHERE error_code = ANY ($1) AND (is_active OR NOT is_delete)`, [Object.values(CODES).map(c => c.code)])), 0)
    const afterRollback = await run(await make({ extra: TAG, targets: [UID(3)] }), { label: all })
    assert.ok(afterRollback.details.includes('zalo_tag_contact|thất bại|err_zalo_invalid_param|false|Tham số không hợp lệ (Z114)'), afterRollback.details.join('\n'))
    await assert.rejects(db.query(v581.rollback), /chưa có V581/)
    await db.query('ROLLBACK')
    await db.query(v581.migration)
    assert.equal(await classify('zalo_tag_contact', z114), CODES.tagFull.code, 'apply lại được (bật lại mã cũ)')
    pass(`apply rồi ROLLBACK không đổi gì; apply thật (${applyMs} ms) chỉ đổi 114 × gắn tag và 3 tín hiệu engine mới; chính sách đúng như chốt; câu đúng như duyệt; chạy lại bị chặn; gỡ trả Z114; apply lại được`)

    // ---- 3. TAG01 --------------------------------------------------------------------------------------------------------
    const tag = await run(await make({ extra: TAG, targets: [UID(11), UID(12), UID(13), UID(14), UID(15)] }), { label: all })
    assert.equal(tag.details.filter(d => d === 'zalo_message_stranger|thành công|-|true|Đã gửi tin nhắn đến Lan').length, 5, tag.details.join('\n'))
    assert.equal(tag.details.filter(d => d === `zalo_tag_contact|thất bại|${CODES.tagFull.code}|false|Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm (TAG01)`).length, 5,
      tag.details.join('\n'))
    assert.deepEqual([tag.campaign, tag.streak, await tag.used('zalo_tag_contact'), await tag.used('zalo_message_stranger')], ['hoàn thành', 0, 0, 5],
      'TAG01 không tính lượt, không cộng chuỗi, chiến dịch chạy hết dù 5 data liền')
    assert.ok(tag.lines.some(l => l.includes('Gắn tag Zalo') && l.includes('Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm (TAG01)')), tag.lines.join('\n'))
    pass('TAG01: 114 ở bước gắn tag ra "Tài khoản đã gắn tag cho quá nhiều người, Zalo không nhận thêm (TAG01)"; tin vẫn gửi và tính lượt; tag không tính lượt, không cộng chuỗi; 5 data liền không dừng chiến dịch')

    // ---- 4. DAT02 --------------------------------------------------------------------------------------------------------
    const phone = await run(await make({ extra: { enableAddFriend: true }, targets: ['0912345678', '912345678', '84912345678', UID(21)] }), { own: OWN_UID })
    assert.deepEqual(phone.calls, [`profile:${UID(21)}`, `text:${UID(21)}`, `friend:${UID(21)}`], 'SĐT trong cột UID: không gọi Zalo lần nào')
    assert.equal(phone.details.filter(d => d === `zalo_message_stranger|thất bại|${CODES.uidPhone.code}|false|Data là số điện thoại, không phải UID Zalo (DAT02)`).length, 3,
      phone.details.join('\n'))
    assert.deepEqual(phone.inputs.map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành'])
    assert.equal(phone.inputs[0].note, 'Data là số điện thoại, không phải UID Zalo (DAT02)')
    assert.deepEqual([phone.campaign, phone.streak, await phone.used('zalo_message_stranger')], ['hoàn thành', 0, 1],
      'không tính lượt; 3 SĐT liền chưa tới ngưỡng, UID thật gửi được đưa chuỗi về 0')
    assert.ok(phone.lines.some(l => l.startsWith('❌') && l.includes('"Khách 1"') && l.includes('(DAT02)')), phone.lines.join('\n'))
    pass('DAT02: UID là số điện thoại thì không gọi Zalo, ghi "Data là số điện thoại, không phải UID Zalo (DAT02)", không tính lượt; UID thật gửi bình thường; danh sách lẫn vài SĐT vẫn chạy hết')

    // Khách đưa nhầm cả danh sách SĐT: 4 data liền thì tạm dừng, phần còn lại giữ nguyên (không đánh "thất bại" cả danh sách).
    const phoneList = ['0912000001', '0912000002', '0912000003', '0912000004', '0912000005', '0912000006', '0912000007']
    const wrongList = await run(await make({ extra: { enableAddFriend: true }, targets: phoneList }), { own: OWN_UID })
    assert.deepEqual(wrongList.calls, [], 'không gọi Zalo lần nào')
    assert.equal(wrongList.campaign, 'tạm dừng')
    assert.equal(wrongList.note, 'Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): Data là số điện thoại, không phải UID Zalo (DAT02)')
    assert.deepEqual(wrongList.inputs.map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành', 'chờ xử lý', 'chờ xử lý', 'chờ xử lý'],
      'data chưa chạy giữ nguyên')
    assert.equal(wrongList.details.length, 4)
    assert.deepEqual([wrongList.streak, await wrongList.used('zalo_message_stranger')], [4, 0])
    assert.ok(wrongList.lines.some(l => l.includes('⏸') && l.includes('đã được tạm dừng')), wrongList.lines.join('\n'))
    pass('DAT02: cả danh sách là SĐT thì 4 data liền là tạm dừng chiến dịch kèm câu, 3 data còn lại giữ "chờ xử lý", không gọi Zalo, không tính lượt')

    // ---- 5. DAT03 --------------------------------------------------------------------------------------------------------
    const self = await run(await make({ extra: { enableAddFriend: true }, targets: [OWN_UID, `${OWN_UID}_0`, UID(31)] }), { own: OWN_UID })
    assert.deepEqual(self.calls, [`profile:${UID(31)}`, `text:${UID(31)}`, `friend:${UID(31)}`], 'chính mình: không gọi Zalo')
    assert.equal(self.details.filter(d => d === `zalo_message_stranger|thất bại|${CODES.self.code}|false|Không gửi cho chính tài khoản đang gửi (DAT03)`).length, 2,
      self.details.join('\n'))
    assert.deepEqual([self.campaign, self.streak], ['hoàn thành', 0])
    // Cổng cũ chưa có ownZaloUid, hoặc đọc UID của mình lỗi / không biết: giữ cách cũ (gọi Zalo).
    for (const own of [undefined, null, new Error('không đọc được')]) {
      const old = await run(await make({ targets: [OWN_UID] }), { ...(own === undefined ? {} : { own }), text: all })
      assert.deepEqual(old.calls, [`profile:${OWN_UID}`, `text:${OWN_UID}`], 'không biết UID của mình thì vẫn gọi Zalo')
      assert.deepEqual(old.details, ['zalo_message_stranger|thất bại|err_zalo_invalid_param|false|Tham số không hợp lệ (Z114)'])
    }
    pass('DAT03: data là chính tài khoản gửi (kể cả UID có hậu tố _0) thì không gọi Zalo, ghi "Không gửi cho chính tài khoản đang gửi (DAT03)"; cổng chưa biết UID của mình thì giữ cách cũ')

    // ---- 6. DAT04 --------------------------------------------------------------------------------------------------------
    const six = [UID(41), UID(42), UID(43), UID(44), UID(45), UID(46)]
    const other = await run(await make({ extra: { enableAddFriend: true, ...TAG, enableZaloAlias: true, zaloAliasTemplate: 'KH' }, targets: six }),
      { own: OWN_UID, text: all, friend: all, label: all, alias: all, other: () => true })
    assert.deepEqual(other.calls, six.slice(0, 4).flatMap(u => [`profile:${u}`, `text:${u}`, `owner:${u}`]),
      'mỗi data: gửi tin bị 114 → tra một lần → bỏ kết bạn / đổi tên / gắn tag; data thứ 5, 6 không chạy')
    assert.deepEqual(other.details, six.slice(0, 4).map(() =>
      `zalo_message_stranger|thất bại|${CODES.otherAccount.code}|false|UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)`))
    assert.equal(other.campaign, 'tạm dừng')
    assert.equal(other.note, 'Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)')
    assert.deepEqual(other.inputs.map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành', 'chờ xử lý', 'chờ xử lý'], 'data chưa chạy giữ nguyên')
    assert.deepEqual([other.streak, await other.used('zalo_message_stranger')], [4, 0], 'không tính lượt')
    assert.ok(other.lines.some(l => l.includes('⏸') && l.includes('đã được tạm dừng')), other.lines.join('\n'))
    pass('DAT04: Zalo trả 114 và UID thuộc tài khoản khác: ghi câu DAT04, không tính lượt, bỏ các bước còn lại, 4 data liền thì tạm dừng chiến dịch kèm câu, data chưa chạy giữ nguyên')

    // Xen một data gửi được thì chuỗi về 0: 3 sai, 1 đúng, 3 sai không dừng.
    const mixedTargets = [UID(51), UID(52), UID(53), UID(54), UID(55), UID(56), UID(57)]
    const bad = uid => uid !== UID(54)
    const mixed = await run(await make({ targets: mixedTargets }), { text: bad, other: () => true })
    assert.deepEqual([mixed.campaign, mixed.streak], ['hoàn thành', 3], 'danh sách lẫn UID đúng và sai vẫn chạy hết')
    assert.equal(mixed.details.filter(d => d.includes('(DAT04)')).length, 6)
    assert.equal(mixed.details.filter(d => d.includes('thành công')).length, 1)
    pass('DAT04: danh sách lẫn UID đúng và sai chạy tiếp (data gửi được đưa chuỗi về 0)')

    // Tra không thấy / tra lỗi / cổng cũ chưa có hàm tra: giữ nguyên Z114, không dừng, vẫn chạy các bước sau; tra một lần mỗi data.
    for (const [label, answer] of [['không thuộc tài khoản khác', () => false], ['tra lỗi', () => new Error('mất kết nối DB')], ['cổng cũ', null]]) {
      const targets = [UID(61), UID(62), UID(63), UID(64), UID(65)]
      const keep = await run(await make({ extra: { enableAddFriend: true }, targets }), { text: all, friend: all, ...(answer ? { other: answer } : {}) })
      assert.equal(keep.campaign, 'hoàn thành', label)
      assert.equal(keep.details.filter(d => d === 'zalo_message_stranger|thất bại|err_zalo_invalid_param|false|Tham số không hợp lệ (Z114)').length, 5, `${label}\n${keep.details.join('\n')}`)
      assert.equal(keep.details.filter(d => d === 'zalo_add_friend|thất bại|err_zalo_invalid_param|false|Tham số không hợp lệ (Z114)').length, 5, label)
      // Trả lời "không" được nhớ cho bước kết bạn của cùng data; tra lỗi thì bước kết bạn tra lại.
      assert.equal(keep.calls.filter(call => call.startsWith('owner:')).length, answer ? (label === 'tra lỗi' ? 10 : 5) : 0, label)
    }
    pass('DAT04 chỉ phát khi tra thấy: không thuộc tài khoản khác, tra lỗi hoặc cổng chưa có hàm tra thì giữ "Tham số không hợp lệ (Z114)", chạy tiếp như trước')

    // Chỉ bật kết bạn: 114 ở bước kết bạn cũng tra và ra DAT04.
    const friendOnly = await run(await make({ extra: { enableMessage: false, enableAddFriend: true }, targets: [UID(71), UID(72), UID(73), UID(74), UID(75)] }),
      { friend: all, other: () => true })
    assert.equal(friendOnly.details.filter(d =>
      d === `zalo_add_friend|thất bại|${CODES.otherAccount.code}|false|UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)`).length, 4,
      friendOnly.details.join('\n'))
    assert.equal(friendOnly.campaign, 'tạm dừng')
    pass('DAT04 ở bước kết bạn (chiến dịch chỉ kết bạn): cùng câu, 4 data liền thì tạm dừng')

    // Lỗi Zalo khác 114 không tra tài khoản khác.
    const c127 = await make({ targets: [UID(81)] })
    const notInvalid = await run(c127, { other: () => true, text: () => { throw zaloErr('Bạn gửi quá nhanh', 127) } })
    assert.equal(notInvalid.calls.filter(call => call.startsWith('owner:')).length, 0, 'mã khác 114 không tra')
    pass('mã Zalo khác 114 không gọi phép tra tài khoản khác')

    console.log(`OK V581: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
