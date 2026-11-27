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
const v677 = require('./build-v677-sql.cjs')
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
    const make = async ({ extra = {}, targets, exclusion = false }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extraSettings = { enableMessage: true, ...extra,
        // Loại trừ theo Nhóm data (V654+): cổng loại trừ cần biết khách là ai (Zalo global ID / SĐT) mới so được với Nhóm data.
        ...(exclusion ? { zaloSendExclusionsByAccountId: { [account]: { groupId: null, blocklistIds: [], dataGroupIds: [6169] } } } : {}) }
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
          // b.noProfile: Zalo không trả hồ sơ cho UID (UID của tài khoản khác) nên không có Zalo global ID.
          if (b.noProfile?.(uid)) return null
          if (b.profileError?.(uid)) throw new Error(b.profileError(uid))
          // b.profileNoGid: đọc được hồ sơ nhưng Zalo không kèm Global ID.
          if (b.profileNoGid?.(uid)) return E.normalizeZaloFoundUser({ userId: uid, display_name: 'Lan', zalo_name: 'Lan' })
          return E.normalizeZaloFoundUser({ userId: uid, display_name: 'Lan', zalo_name: 'Lan', globalId: `g-${uid}` })
        },
        // Loại trừ theo Nhóm data: DB không xác định được khách (V666 'unknown') với mọi người nhận.
        sendExclusionSnapshot: async () => ({ catalog: {}, group: null, blocklistUids: [],
          remote: { groupName: null, blocks: [], blocklistIds: [], dataGroups: [{ id: 6169, name: 'Nhóm A' }], campaigns: [] } }),
        sendExclusionRemote: async (_ctx, payload) => {
          calls.push(`exclusion:${payload.uid}:${payload.globalId ?? '-'}`)
          // b.exclusionOk: DB xác định được khách (không thuộc nguồn loại trừ) với UID này.
          if (b.exclusionOk?.(payload.uid)) return { match: null, blocks: [], unknown: null }
          return { match: null, blocks: [], unknown: 'Chưa xác định được khách để kiểm tra loại trừ.' }
        },
        sendExclusionFacts: async () => ({ akabiz_contact: null, campaign_delivery: null }),
        labelMembership: async () => null,
        friendRequestStatus: async () => null,
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

    // ---- 7. Loại trừ theo Nhóm data mà UID là của tài khoản khác (chiến dịch 53605, 27/11/2026) -----------------------------------
    // Khách đổi tài khoản chạy chiến dịch: UID của tài khoản cũ, Zalo không trả hồ sơ nên không có global ID, cổng loại trừ không xác
    // định được khách. Trước bản sửa: mọi data ra EXC02 và bị tạm dừng (155 data trong 2 phút). Nay: tra tài khoản khác, đúng thì DAT04
    // ở cổng (chưa gọi Zalo), 4 data liền thì tạm dừng chiến dịch kèm câu.
    const swapTargets = [UID(91), UID(92), UID(93), UID(94), UID(95), UID(96)]
    const swap = await run(await make({ extra: { enableAddFriend: true }, targets: swapTargets, exclusion: true }),
      { own: OWN_UID, noProfile: all, other: () => true })
    assert.deepEqual(swap.calls, swapTargets.slice(0, 4).flatMap(u => [`profile:${u}`, `exclusion:${u}:-`, `owner:${u}`]),
      'mỗi data: không có hồ sơ → loại trừ không xác định → tra một lần → không gửi tin, không kết bạn; data thứ 5, 6 không chạy')
    assert.deepEqual(swap.details, swapTargets.slice(0, 4).map(() =>
      `zalo_message_stranger|thất bại|${CODES.otherAccount.code}|false|UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)`))
    assert.equal(swap.campaign, 'tạm dừng')
    assert.equal(swap.note, 'Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)')
    assert.deepEqual(swap.inputs.map(i => i.status), ['hoàn thành', 'hoàn thành', 'hoàn thành', 'hoàn thành', 'chờ xử lý', 'chờ xử lý'], 'data chưa chạy giữ nguyên')
    assert.deepEqual([swap.streak, await swap.used('zalo_message_stranger'), await swap.used('zalo_add_friend')], [4, 0, 0], 'không tính lượt')
    assert.ok(!swap.lines.some(l => l.includes('(EXC02)')), swap.lines.join('\n'))
    pass('loại trừ theo Nhóm data + UID của tài khoản khác: DAT04 ở cổng (không gọi Zalo gửi), không tính lượt, 4 data liền thì tạm dừng chiến dịch, data chưa chạy giữ nguyên')

    // Không thuộc tài khoản khác / tra lỗi / cổng cũ chưa có hàm tra, mà đọc hồ sơ không ra: không giữ data với EXC02 nữa (tín hiệu đọc hồ
    // sơ không ra; trước V677 luật chung ra NET01): một data rồi dừng lượt, data về hàng đợi, không gửi.
    for (const [label, answer] of [['không thuộc tài khoản khác', () => false], ['tra lỗi', () => new Error('mất kết nối DB')], ['cổng cũ', null]]) {
      const targets = [UID(101), UID(102), UID(103), UID(104), UID(105)]
      const keep = await run(await make({ extra: { enableAddFriend: true }, targets, exclusion: true }),
        { own: OWN_UID, noProfile: all, ...(answer ? { other: answer } : {}) })
      assert.equal(keep.calls.filter(call => call.startsWith('text:') || call.startsWith('friend:')).length, 0, `${label}: không gửi`)
      assert.deepEqual(keep.inputs.map(i => i.status), targets.map(() => 'chờ xử lý'), `${label}: không data nào bị giữ`)
      assert.deepEqual(keep.details, [], label)
      assert.notEqual(keep.campaign, 'tạm dừng', label)
      assert.equal(keep.calls.filter(call => call.startsWith('owner:')).length, answer ? 1 : 0, label)
      assert.ok(keep.lines.some(l => l.includes('(NET01)')) && !keep.lines.some(l => l.includes('(EXC02)')), `${label}\n${keep.lines.join('\n')}`)
    }
    // Đọc được hồ sơ mà không có Global ID (UID không thuộc tài khoản khác), hoặc có Global ID mà DB vẫn không xác định được: giữ EXC02.
    const noGid = await run(await make({ targets: [UID(106), UID(107)], exclusion: true }), { own: OWN_UID, profileNoGid: all, other: () => false })
    assert.deepEqual(noGid.inputs.map(i => [i.status, i.note]), [UID(106), UID(107)].map(() => ['tạm dừng', 'Chưa xác định được khách để kiểm tra loại trừ. (EXC02)']))
    assert.equal(noGid.calls.filter(call => call.startsWith('owner:')).length, 2, 'không có Global ID nên vẫn tra tài khoản khác')
    const known = await run(await make({ targets: [UID(111), UID(112)], exclusion: true }), { own: OWN_UID, other: () => true })
    assert.deepEqual(known.calls, [UID(111), UID(112)].flatMap(u => [`profile:${u}`, `exclusion:${u}:g-${u}`]), 'có global ID: không tra tài khoản khác')
    assert.deepEqual(known.inputs.map(i => i.status), ['tạm dừng', 'tạm dừng'])
    pass('đọc hồ sơ không ra mà UID không thuộc tài khoản khác: không giữ data (NET01 khi chưa có V677); đọc được hồ sơ thiếu Global ID, hoặc có Global ID: giữ EXC02')

    // ---- 8. V677: đọc hồ sơ Zalo không ra khi cần Global ID để kiểm loại trừ (chiến dịch 63333, 27/11/2026) -----------------------
    // Tài khoản 1828 từ 11:55 VN không đọc được hồ sơ nào; trước bản sửa mỗi data ra EXC02 và bị giữ "tạm dừng", không nghỉ.
    const signalOf = async campaign => rows(`SELECT error_code, signal->>'message' m, signal->'evidence'->>'profileError' e FROM public.auto_engine_outcomes
      WHERE campaign_id = $1 ORDER BY created_at`, [campaign])
    // Trước V677: tín hiệu mới là tín hiệu engine lạ trước khi gửi, luật chung đưa về NET01 (data về hàng đợi), không giữ data.
    const preTargets = [UID(121), UID(122)]
    const pre677 = await run(await make({ targets: preTargets, exclusion: true }), { own: OWN_UID, noProfile: all, other: () => false })
    assert.deepEqual(pre677.inputs.map(i => i.status), ['chờ xử lý', 'chờ xử lý'], 'trước V677: data về hàng đợi (NET01), không bị giữ')
    assert.deepEqual(pre677.details, [])
    assert.ok(pre677.lines.some(l => l.includes('(NET01)')), pre677.lines.join('\n'))
    assert.equal(pre677.calls.filter(c => c.startsWith('text:')).length, 0)
    pass('trước V677: lõi mới báo tín hiệu đọc hồ sơ không ra thì luật chung ra NET01, data về hàng đợi, không gửi, không bị giữ')

    // Apply / chặn chạy lại / gỡ / apply lại.
    await db.query(v677.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await classify('zalo_message_stranger', { kind: 'engine', code: v677.SIGNAL }, 'before_send'), 'err_network_offline', 'apply rồi ROLLBACK không đổi gì')
    await db.query(v677.migration)
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v677.NAME}.sql`), 'utf8'), v677.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, `migrations/${v677.ROLLBACK_NAME}.sql`), 'utf8'), v677.rollback, 'file gỡ = bản sinh')
    const changed = ['target_streak_effect', 'streak_threshold', 'campaign_effect']
    for (const a of ['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend']) {
      for (const phase of ['before_send', 'after_send']) assert.equal(await classify(a, { kind: 'engine', code: v677.SIGNAL }, phase), v677.CODE.code, `${a} ${phase}`)
      const mine = await policy(v677.CODE.code, a, 'desktop', 'before_send'), base = await policy(v677.BASE, a, 'desktop', 'before_send')
      assert.deepEqual(strip(mine, changed), strip(base, changed), `${a}: chính sách như EXC02 ngoài câu và phần đã chốt`)
      assert.deepEqual([mine.target_effect, mine.detail_mode, mine.quota_effect, mine.run_effect, mine.target_streak_effect, mine.streak_threshold, mine.campaign_effect, mine.lock_action_codes ?? []],
        ['hold', 'suppress', 'no_count', 'continue', 'increment', 4, 'pause', []])
    }
    const err677 = (await rows(`SELECT public_code, error_class, customer_title, customer_help FROM public.auto_error WHERE error_code = $1`, [v677.CODE.code]))[0]
    assert.deepEqual(err677, { public_code: 'EXC06', error_class: 'target_temporary', customer_title: v677.CODE.title, customer_help: null })
    assert.equal(v677.CODE.title, 'Chưa đọc được hồ sơ Zalo của người nhận nên chưa kiểm tra được điều kiện loại trừ gửi', 'câu anh duyệt 27/11/2026')
    assert.equal(Number(await val(`SELECT count(*) FROM public.aka_agent_engine_policy_lint`)), 0, 'không có dòng lint')
    await assert.rejects(db.query(v677.migration), /Đã có mã|Đã có chính sách/)
    await db.query('ROLLBACK')
    await db.query(v677.rollback)
    assert.equal(await classify('zalo_message_stranger', { kind: 'engine', code: v677.SIGNAL }, 'before_send'), 'err_network_offline', 'gỡ trả luật chung')
    await assert.rejects(db.query(v677.rollback), /Chưa có V677/)
    await db.query('ROLLBACK')
    await db.query(v677.migration)
    pass('V677: tín hiệu ra EXC06 ở mọi thao tác và pha; chính sách như EXC02 nhưng cộng chuỗi, 4 liền thì tạm dừng, không khoá; câu như anh duyệt; chạy lại bị chặn; gỡ trả NET01; apply lại được')

    // Cả tài khoản không đọc được hồ sơ (như 63333): 4 data bị giữ kèm câu EXC06 rồi chiến dịch tạm dừng, phần còn lại giữ "chờ xử lý".
    const prfTargets = [UID(131), UID(132), UID(133), UID(134), UID(135), UID(136)]
    const prfCampaign = await make({ extra: { enableAddFriend: true }, targets: prfTargets, exclusion: true })
    const prf = await run(prfCampaign, { own: OWN_UID, profileError: () => 'Zalo từ chối đọc hồ sơ', other: () => false })
    assert.deepEqual(prf.calls, prfTargets.slice(0, 4).flatMap(u => [`profile:${u}`, `exclusion:${u}:-`, `owner:${u}`]), 'không gửi tin / kết bạn; data thứ 5, 6 không chạy')
    const held = `${v677.CODE.title} (EXC06)`
    assert.deepEqual(prf.inputs.map(i => [i.status, i.note]), [...prfTargets.slice(0, 4).map(() => ['tạm dừng', held]), ['chờ xử lý', null], ['chờ xử lý', null]])
    assert.deepEqual(prf.details, [])
    assert.equal(prf.campaign, 'tạm dừng')
    assert.equal(prf.note, `Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): ${held}`)
    assert.deepEqual([prf.streak, await prf.used('zalo_message_stranger')], [4, 0], 'không tính lượt')
    assert.ok(prf.lines.some(l => l.includes(held)) && !prf.lines.some(l => l.includes('(EXC02)')), prf.lines.join('\n'))
    const sig = (await signalOf(prfCampaign.campaign)).filter(r => r.error_code === v677.CODE.code)
    assert.ok(sig.length === 4 && sig.every(r => r.m.includes('Zalo từ chối đọc hồ sơ')), JSON.stringify(sig))
    pass('V677: cả tài khoản không đọc được hồ sơ khi cần Global ID: 4 data bị giữ kèm câu EXC06, câu lỗi Zalo ghi ở tín hiệu, không tính lượt, rồi tạm dừng chiến dịch; data còn lại giữ chờ xử lý')

    // Một người hỏng lẻ: data đó bị giữ, người kế đọc được hồ sơ thì chuỗi về 0, chiến dịch chạy hết.
    const loneTargets = [UID(161), UID(162), UID(163), UID(164)]
    const lone = await run(await make({ targets: loneTargets, exclusion: true, extra: {} }),
      { own: OWN_UID, noProfile: uid => uid === UID(161) || uid === UID(163), other: () => false, exclusionOk: uid => uid !== UID(161) && uid !== UID(163) })
    assert.deepEqual(lone.inputs.map(i => i.status), ['tạm dừng', 'hoàn thành', 'tạm dừng', 'hoàn thành'], lone.lines.join('\n'))
    assert.equal(lone.campaign, 'hoàn thành')
    assert.equal(lone.streak, 0)
    pass('V677: người hỏng lẻ bị giữ, người đọc được hồ sơ vẫn gửi, chuỗi lỗi về 0, chiến dịch không dừng')

    // Ưu tiên: UID của tài khoản khác thì DAT04 (không phải EXC06) dù đọc hồ sơ cũng không ra.
    const both = await run(await make({ targets: [UID(141)], exclusion: true }), { own: OWN_UID, noProfile: all, other: () => true })
    assert.deepEqual(both.details, [`zalo_message_stranger|thất bại|${CODES.otherAccount.code}|false|UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)`])
    // Không cần Global ID (không bật loại trừ): đọc hồ sơ không ra vẫn gửi như cũ.
    const noExc = await run(await make({ targets: [UID(151)] }), { own: OWN_UID, noProfile: all })
    assert.deepEqual(noExc.details, ['zalo_message_stranger|thành công|-|true|Đã gửi tin nhắn đến Khách 1'])
    pass('V677: UID của tài khoản khác vẫn ra DAT04; chiến dịch không bật loại trừ thì đọc hồ sơ không ra vẫn gửi như trước')

    console.log(`OK V581: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
