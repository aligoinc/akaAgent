// V504: loại trừ gửi (gateSendExclusion của Desktop) bằng lõi thật (packages/campaign-engine) + cổng Zalo giả, trên PostgreSQL 17 cục bộ
// có đủ chuỗi V495 → V499 → V500 → V501 → V503 → V504. Bảng / hàm phụ trợ của loại trừ gửi (V330 trở đi) dựng tối thiểu ở đây: phần đọc
// cấu hình / dữ kiện của V504 chép từ hàm cũ đang chạy production (preflight của V504 kiểm md5 hàm cũ trên production).
// Kỳ vọng là hành vi Desktop (gateSendExclusion, preflightZaloMessageOptOut, gateResolvedPhoneMessageTarget) cộng các thay đổi đã nêu.
// Không mạng, không dữ liệu khách. Chạy: node scripts/campaign-outcome-engine-v504-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v504 = require('./build-v504-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V504_TEST_PORT || 55503)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-v504-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

function testClock(heartbeatMs = 60000) {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms !== heartbeatMs) return setImmediate(() => resolve(!signal?.aborted))
      signal?.addEventListener('abort', () => resolve(false), { once: true })
    })
  }
}

// Bảng / hàm phụ trợ tối thiểu (tên cột như production; hàm phụ trợ là bản giả có cùng chữ ký).
const SUPPORT_SQL = `
CREATE TABLE public.auto_account_contacts (id bigint PRIMARY KEY, account_id bigint, staff_id bigint, organization_id bigint,
  contact_type text, uid text, is_delete boolean NOT NULL DEFAULT false);
CREATE TABLE public.auto_account_contact_group_members (id bigserial PRIMARY KEY, group_id bigint, contact_id bigint, is_delete boolean NOT NULL DEFAULT false);
CREATE TABLE public.auto_account_contact_groups (id bigint PRIMARY KEY, account_id bigint, staff_id bigint, organization_id bigint, name text,
  purpose text, contact_type text, is_delete boolean NOT NULL DEFAULT false);
CREATE TABLE public.auto_contact_tags (id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, auto_account_id bigint, is_delete boolean NOT NULL DEFAULT false);
CREATE TABLE public.chat_zalo_account_organization (id bigint PRIMARY KEY, chat_zalo_account_id bigint, auto_account_id bigint, organization_id bigint, is_active boolean);
CREATE TABLE public.chat_zalo_account_conversation (id bigint PRIMARY KEY, chat_zalo_account_id bigint, zalo_id text, conversation_type text);
CREATE TABLE public.chat_zalo_conversation (id bigint PRIMARY KEY, chat_zalo_account_organization_id bigint, chat_zalo_account_conversation_id bigint, organization_id bigint);
CREATE TABLE public.chat_zalo_conversation_system_tag (chat_zalo_conversation_id bigint, organization_id bigint, auto_contact_tag_id bigint);
CREATE TABLE public.test_exclusion_groups (id bigint PRIMARY KEY, body jsonb NOT NULL);
CREATE TABLE public.test_contact_facts (contact_id bigint PRIMARY KEY, facts jsonb NOT NULL);
CREATE TABLE public.test_delivery (account_id bigint, created_at timestamptz, target_keys text[]);
CREATE FUNCTION public.aka_agent_internal_send_exclusion_catalog() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
  'fields', jsonb_build_array(
    jsonb_build_object('id', 1, 'code', 'zalo_tags', 'name', 'Tag Zalo', 'dataType', 'set', 'sourceKey', 'zalo_labels', 'sourceConfig', jsonb_build_object('path', jsonb_build_array('ids')),
      'optionsSource', 'zalo_labels', 'optionsConfig', '{}'::jsonb, 'isActive', true, 'sortOrder', 1),
    jsonb_build_object('id', 2, 'code', 'akabiz_tags', 'name', 'Tag akaBiz', 'dataType', 'set', 'sourceKey', 'akabiz_contact', 'sourceConfig', jsonb_build_object('path', jsonb_build_array('ids')),
      'optionsSource', 'akabiz_tags', 'optionsConfig', '{}'::jsonb, 'isActive', true, 'sortOrder', 2),
    jsonb_build_object('id', 3, 'code', 'days_since_sent', 'name', 'Số ngày từ lần gửi gần nhất', 'dataType', 'number', 'sourceKey', 'campaign_delivery', 'sourceConfig', jsonb_build_object('path', jsonb_build_array('daysSince')),
      'optionsSource', 'none', 'optionsConfig', '{}'::jsonb, 'isActive', true, 'sortOrder', 3),
    jsonb_build_object('id', 4, 'code', 'zalo_friend_status', 'name', 'Trạng thái bạn bè', 'dataType', 'enum', 'sourceKey', 'zalo_friendship', 'sourceConfig', jsonb_build_object('path', jsonb_build_array('status')),
      'optionsSource', 'static', 'optionsConfig', '{}'::jsonb, 'isActive', true, 'sortOrder', 4),
    jsonb_build_object('id', 5, 'code', 'zalo_gender', 'name', 'Giới tính Zalo', 'dataType', 'number', 'sourceKey', 'zalo_profile', 'sourceConfig', jsonb_build_object('path', jsonb_build_array('gender')),
      'optionsSource', 'none', 'optionsConfig', '{}'::jsonb, 'isActive', true, 'sortOrder', 5)),
  'operators', jsonb_build_array(
    jsonb_build_object('id', 11, 'code', 'contains_any', 'name', 'Có một trong', 'evaluatorKey', 'contains_any', 'isActive', true, 'sortOrder', 1),
    jsonb_build_object('id', 12, 'code', 'lt', 'name', 'Nhỏ hơn', 'evaluatorKey', 'lt', 'isActive', true, 'sortOrder', 2),
    jsonb_build_object('id', 13, 'code', 'equals', 'name', 'Bằng', 'evaluatorKey', 'equals', 'isActive', true, 'sortOrder', 3)),
  'fieldOperators', jsonb_build_array(
    jsonb_build_object('fieldId', 1, 'operatorId', 11, 'valueType', 'text', 'minValues', 1, 'maxValues', 20, 'validationConfig', '{}'::jsonb),
    jsonb_build_object('fieldId', 2, 'operatorId', 11, 'valueType', 'text', 'minValues', 1, 'maxValues', 20, 'validationConfig', '{}'::jsonb),
    jsonb_build_object('fieldId', 3, 'operatorId', 12, 'valueType', 'number', 'minValues', 1, 'maxValues', 1, 'validationConfig', jsonb_build_object('min', 1, 'max', 3650, 'integer', true)),
    jsonb_build_object('fieldId', 4, 'operatorId', 13, 'valueType', 'enum', 'minValues', 1, 'maxValues', 1, 'validationConfig', '{}'::jsonb),
    jsonb_build_object('fieldId', 5, 'operatorId', 13, 'valueType', 'number', 'minValues', 1, 'maxValues', 1, 'validationConfig', '{}'::jsonb)),
  'options', jsonb_build_array(
    jsonb_build_object('fieldId', 4, 'code', 'friend', 'label', 'Bạn bè', 'value', 'friend', 'isActive', true, 'sortOrder', 1),
    jsonb_build_object('fieldId', 4, 'code', 'stranger', 'label', 'Người lạ', 'value', 'stranger', 'isActive', true, 'sortOrder', 2))) $$;
CREATE FUNCTION public.aka_agent_internal_send_exclusion_group(p_id bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT body FROM public.test_exclusion_groups WHERE id = p_id $$;
CREATE FUNCTION public.aka_agent_internal_validate_send_exclusion_selection(p_map jsonb, p_staff bigint, p_org bigint, p_account bigint) RETURNS void
LANGUAGE plpgsql AS $$ DECLARE v_group text := p_map->p_account::text->>'groupId'; BEGIN
  IF v_group IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.test_exclusion_groups WHERE id = v_group::bigint) THEN
    RAISE EXCEPTION 'send_exclusion_group_not_found';
  END IF;
END $$;
CREATE FUNCTION public.aka_agent_data_group_zalo_facts(p_contact_id bigint) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce((SELECT facts FROM public.test_contact_facts WHERE contact_id = p_contact_id), '{}'::jsonb) $$;
CREATE FUNCTION public.aka_agent_internal_delivery_cooldown_target_keys(p_target_kind text, p_uid text, p_phone text, p_email text) RETURNS text[]
LANGUAGE sql AS $$ SELECT CASE WHEN nullif(btrim(p_uid), '') IS NULL THEN ARRAY[]::text[] ELSE ARRAY['zalo:' || btrim(p_uid)] END $$;
CREATE FUNCTION public.aka_agent_internal_send_delivery_history(p_account_id bigint, p_action_codes text[], p_since timestamptz, p_now timestamptz)
RETURNS TABLE(detail_id bigint, created_at timestamptz, campaign_id bigint, campaign_name text, target_keys text[]) LANGUAGE sql AS $$
  SELECT 0::bigint, d.created_at, 0::bigint, ''::text, d.target_keys FROM public.test_delivery d
   WHERE d.account_id = p_account_id AND d.created_at >= p_since AND d.created_at <= p_now $$;
`

const FRIEND = 'zalo_message_friend'
const PHONE = 'zalo_message_phone'

async function main() {
  const E = await loadEngine()

  // ---- 1. Hỗ trợ và kiểm cấu hình đầu lượt (không cần DB) ----------------------------------------------------
  {
    const core = (actionId, extra = {}) => ({ id: 1, actionId, accountId: 7, content: 'Chào', extraSettings: extra, images: [], dataTargetSourceMode: null })
    const env = { engagementTrackingEnabled: false }
    const selection = { zaloSendExclusionsByAccountId: { 7: { groupId: 5, blocklistIds: [] } } }
    assert.deepEqual(E.zaloCampaignV2Support(core(FRIEND, selection), env), { ok: true }, 'nhắn bạn bè có loại trừ chạy bộ mới')
    assert.deepEqual(E.zaloCampaignV2Support(core(FRIEND, { ...selection, zaloMessageSendMode: 'share' }), env), { ok: true }, 'chia sẻ bạn bè có loại trừ')
    assert.deepEqual(E.zaloCampaignV2Support(core(PHONE, { ...selection, enableMessage: true }), env), { ok: true }, 'nhắn theo SĐT có loại trừ')
    const type = E.zaloCampaignType(FRIEND)
    assert.deepEqual(type.validate(core(FRIEND, { zaloSendExclusionsByAccountId: { 8: { groupId: 5, blocklistIds: [] } } }), { zaloWeb: false })
      .map(i => [i.publicCode, i.message]), [['CFG18', 'Không thể tải cấu hình loại trừ: Chưa cấu hình loại trừ cho tài khoản thực hiện.']],
      'không có cấu hình cho tài khoản chạy: câu như Desktop lúc bắt đầu lượt')
    assert.deepEqual(type.validate(core(FRIEND, { zaloSendExclusionsByAccountId: [] }), { zaloWeb: false }).map(i => i.publicCode), ['CFG18'])
    assert.deepEqual(type.validate(core(FRIEND, selection), { zaloWeb: false }), [])
    assert.deepEqual(E.zaloCampaignType(PHONE).validate(core(PHONE, { zaloSendExclusionsByAccountId: { 8: { groupId: 5, blocklistIds: [] } } }), { zaloWeb: false }), [],
      'nhắn theo SĐT tắt nhắn tin: không có loại trừ (supportsSendExclusion)')
    assert.equal(fs.readFileSync(path.join(ROOT, 'packages/campaign-engine/src/zalo/sendExclusionRules.ts'), 'utf8'),
      fs.readFileSync(path.join(ROOT, 'src/shared/campaignSendExclusion.ts'), 'utf8'), 'luật đánh giá là bản chép nguyên văn src/shared')
  }
  pass('hỗ trợ: nhắn bạn bè / theo SĐT / chia sẻ có loại trừ gửi chạy bộ mới; cấu hình hỏng → CFG18 như Desktop; luật chép nguyên văn')

  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v504-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    await db.query(v501.migration)
    await db.query(v503.migration)
    await db.query(SUPPORT_SQL)
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const rows = async (sql, args = []) => (await db.query(sql, args)).rows
    const rpc = async (sql, args) => (await db.query(sql, args)).rows[0].r

    // ---- 2. Apply / gỡ ---------------------------------------------------------------------------------------
    const SIG = v504.SIG
    const gate = () => one(`SELECT on_error, retry_after_seconds FROM public.auto_engine_gates WHERE code = 'send_exclusion'`)
    await db.query(v504.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await val(`SELECT to_regprocedure($1)`, [SIG]), null)
    assert.equal((await gate()).on_error, 'open')
    await db.query(v504.migration)
    assert.equal(await val(`SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)`, [SIG]), v504.NEW.fn)
    assert.deepEqual(await gate(), { on_error: 'closed', retry_after_seconds: 60 })
    await assert.rejects(db.query(v504.migration), /đã có/)
    await db.query('ROLLBACK')
    for (const role of ['anon', 'authenticated']) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, SIG]), false)
    for (const role of ['service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) assert.equal(await val(`SELECT has_function_privilege($1, $2, 'EXECUTE')`, [role, SIG]), true)
    await db.query(v504.rollback)
    assert.equal(await val(`SELECT to_regprocedure($1)`, [SIG]), null)
    assert.equal((await gate()).on_error, 'open')
    assert.equal(await val(`SELECT count(*) FROM public.auto_error WHERE error_code = ANY($1) AND is_active`, [v504.CODES]), '0')
    await db.query(v504.migration)
    pass('apply trong transaction rồi ROLLBACK không để lại gì; apply thật; apply lần hai bị chặn; gỡ rồi apply lại; quyền như các RPC engine')

    // ---- Dữ liệu thử ------------------------------------------------------------------------------------------
    const data = {
      claimTarget: ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      claimBatch: ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)]),
      markSending: (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step]),
      report: (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r', [id, tok, JSON.stringify(outcomes), final]),
      reportBatch: (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r', [tok, JSON.stringify(items), size, stopped]),
      heartbeat: (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok]),
      release: (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok])
    }
    // Cổng dữ liệu loại trừ như engineSendExclusion của Desktop / CampaignEngineRepository.sendExclusion của Fly.
    const sendExclusion = async (ctx, operation, payload) => {
      if (ctx.failExclusionDb) throw Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' })
      const r = await rpc(`SELECT public.aka_agent_engine_send_exclusion_v1($1, $2, $3, $4::jsonb) AS r`,
        [ctx.targetRunId, ctx.leaseToken, operation, JSON.stringify(payload)])
      if (r.ok !== true) throw new E.SendExclusionRpcError(r.reason, r.message)
      return operation === 'snapshot' ? r.snapshot : operation === 'facts' ? r.facts : r.blocklist
    }
    let nextId = 960000
    const STAFF = 9401, ORG = 671
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org', true) ON CONFLICT (id) DO NOTHING`, [ORG])
    await db.query(`INSERT INTO public.test_exclusion_groups VALUES
      (501, '{"id":501,"accountId":0,"name":"Khách VIP","matchMode":"or","revision":1,"rules":[{"fieldId":1,"operatorId":11,"value":["L9"],"isEnabled":true,"sortOrder":0}]}'),
      (502, '{"id":502,"accountId":0,"name":"Đã gửi gần đây","matchMode":"or","revision":1,"rules":[{"fieldId":3,"operatorId":12,"value":7,"isEnabled":true,"sortOrder":0}]}'),
      (503, '{"id":503,"accountId":0,"name":"Tag akaBiz","matchMode":"or","revision":1,"rules":[{"fieldId":2,"operatorId":11,"value":["77"],"isEnabled":true,"sortOrder":0}]}'),
      (504, '{"id":504,"accountId":0,"name":"Bạn bè","matchMode":"and","revision":1,"rules":[{"fieldId":4,"operatorId":13,"value":"friend","isEnabled":true,"sortOrder":0},{"fieldId":5,"operatorId":13,"value":1,"isEnabled":true,"sortOrder":1}]}')`)
    const make = async ({ actionId = FRIEND, extra = {}, selection, targets, content = 'Chào #{FULL_NAME}' }) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, STAFF, ORG])
      const extraSettings = { actionLimits: { byActionCode: { [actionId === PHONE ? 'zalo_message_stranger' : actionId]: { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 } } },
        ...(selection === undefined ? {} : { zaloSendExclusionsByAccountId: { [account]: selection } }), ...extra }
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings, images)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Loại trừ', $2, $3, 'chờ xử lý', now() - interval '1 minute', false, $4, $5, $6, $7::jsonb, '[]'::jsonb)`,
        [campaign, actionId, account, STAFF, ORG, content, JSON.stringify(extraSettings)])
      const ids = []
      for (const t of targets) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, phone, status, is_delete) OVERRIDING SYSTEM VALUE
          VALUES ($1, $2, $3, $4, $5, 'chờ xử lý', false)`, [id, campaign, t.name ?? null, t.uid ?? null, t.phone ?? null])
        ids.push(id)
      }
      return { account, campaign, ids, actionId, extra: extraSettings, content }
    }
    const err = (message, code) => Object.assign(new Error(message), code === undefined ? {} : { code })
    const run = async (c, b = {}) => {
      const calls = [], lines = []
      const port = {
        findUser: async (_ctx, phone) => { calls.push(`find:${phone}`); return E.normalizeZaloFoundUser({ userId: `p${phone.slice(-3)}`, display_name: `Khách ${phone.slice(-3)}`, globalId: `g-${phone}`, gender: 1 }) },
        phoneSearchLimitScope: async () => null,
        saveFoundUser: async () => {},
        getUserProfile: async (_ctx, uid) => {
          calls.push(`profile:${uid}`)
          const p = { gender: 1, isFr: 1, ...((b.profiles ?? {})[uid] ?? {}) }
          return E.normalizeZaloFoundUser({ userId: uid, display_name: `Bạn ${uid}`, zalo_name: `Bạn ${uid}`, globalId: `g-${uid}`,
            ...(p.gender === null ? {} : { gender: p.gender }), isFr: p.isFr })
        },
        saveResolvedProfile: async () => {},
        isOptedOut: async () => false,
        prepareOptOutLink: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
        takeContentIndex: async () => 0,
        businessNow: async () => new Date(),
        sendText: async (_ctx, uid) => { calls.push(`text:${uid}`); return { response: { msgId: `m-${uid}` }, msgId: `m-${uid}` } },
        prepareMedia: async () => [],
        sendMedia: async () => { throw new Error('không có tệp') },
        sendFriendRequest: async (_ctx, uid) => { calls.push(`friend:${uid}`); return {} },
        forwardMessage: async (_ctx, input) => {
          calls.push(`forward:${input.threadIds.join(',')}`)
          return { response: { ok: true }, results: input.threadIds.map(threadId => ({ threadId, ok: true })) }
        },
        friendStatus: async () => null, applyLabel: async () => ({ kind: 'applied', labelText: null }), mirrorLabel: async () => {},
        changeAlias: async () => '', applyAkaBizTags: async () => 1,
        sendExclusionSnapshot: ctx => { calls.push('snapshot'); return sendExclusion({ ...ctx, failExclusionDb: b.snapshotDown }, 'snapshot', {}) },
        sendExclusionFacts: (ctx, payload) => { calls.push(`facts:${JSON.stringify(payload)}`); return sendExclusion({ ...ctx, failExclusionDb: b.factsDown }, 'facts', payload) },
        labelMembership: async (_ctx, contextRunId, uid) => {
          calls.push(`labels:${contextRunId === b.expectContext?.() ? 'lead' : contextRunId}:${uid}`)
          if (b.labelsError) throw b.labelsError
          return { ids: (b.labels ?? {})[uid] ?? [], availableValues: ['L1', 'L9'] }
        },
        friendRequestStatus: async (_ctx, uid) => { calls.push(`friendship:${uid}`); return { is_friend: 0, is_requesting: 0, is_requested: 0 } },
        friendBlocklist: ctx => { calls.push('blocklist'); return sendExclusion(ctx, 'friend_blocklist', {}) }
      }
      const core = { id: c.campaign, actionId: c.actionId, accountId: c.account, content: c.content, extraSettings: c.extra, images: [], dataTargetSourceMode: null }
      const type = E.zaloCampaignType(c.actionId)
      const batch = type.buildBatch?.(core, port, { sleepBetweenBatchesSeconds: 0, readTimeoutMs: 5000, mediaTimeoutMs: 5000, sendTimeoutMs: 5000 }) ?? null
      const result = await E.runUnit({ data, journal: new E.MemoryJournal(), clock: testClock(), events: { progress: l => lines.push(l.text), trace: () => {} } }, {
        runnerId: 'desktop:v504', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign, actionId: c.actionId,
        campaignName: 'Loại trừ', accountName: 'Zalo', campaignNote: null, targetLabel: type.targetLabel,
        actionName: code => type.actionNames[code] ?? code, ...type.claimPlan(core),
        buildSteps: () => type.buildSteps(core, port, { account: { id: c.account, name: 'Zalo' } }),
        ...(batch ? { batch } : {}),
        validateCampaign: () => type.validate?.(core, { zaloWeb: false }) ?? [],
        onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, NULL) AS r', [c.account, info.leaseToken]),
        pacing: { fullSeconds: 0 }, stepTimeoutMs: 5000, heartbeatMs: 60000, retry: { callTimeoutMs: 5000, backoffMs: [5, 10] }
      }, new AbortController().signal)
      return { result, calls, lines }
    }
    const inputs = c => rows(`SELECT id::integer AS id, status, note FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    const details = c => rows(`SELECT input_data_id::integer AS input_data_id, action_code, status, log FROM public.auto_campaign_details WHERE campaign_id = $1 ORDER BY id`, [c.campaign])
    const camp = c => one(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [c.campaign])

    // ---- 3. RPC: xác thực, snapshot, facts ----------------------------------------------------------------------
    {
      const c = await make({ selection: { groupId: 501, blocklistIds: [41, 42] }, targets: [{ name: 'An', uid: 'u-1' }] })
      for (const [id, uid, type, del] of [[71, 'u-9', 'person', false], [72, 'u-8 ', 'person', false], [73, 'u-9', 'person', false], [74, 'g-1', 'group', false], [75, 'u-7', 'person', true]]) {
        await db.query(`INSERT INTO public.auto_account_contacts VALUES ($1, $2, $3, $4, $5, $6, $7)`, [id, c.account, STAFF, ORG, type, uid, del])
      }
      await db.query(`INSERT INTO public.auto_account_contact_group_members (group_id, contact_id) VALUES (41, 71), (41, 72), (42, 73), (42, 74), (41, 75), (99, 71)`)
      const claim = await data.claimTarget({ runnerId: 'smoke', runtimeTarget: 'desktop', staffId: STAFF, accountId: c.account, campaignId: c.campaign,
        actions: [{ code: FRIEND }] })
      assert.equal(claim.status, 'claimed', JSON.stringify(claim))
      const call = (op, payload = {}, run = claim.targetRunId, token = claim.leaseToken) =>
        rpc(`SELECT public.aka_agent_engine_send_exclusion_v1($1, $2, $3, $4::jsonb) AS r`, [run, token, op, JSON.stringify(payload)])
      const snap = await call('snapshot')
      assert.equal(snap.ok, true)
      assert.equal(snap.snapshot.group.name, 'Khách VIP')
      assert.deepEqual([...snap.snapshot.blocklistUids].sort(), ['u-8', 'u-9'], 'Zalo ID loại trừ: chỉ người, bỏ trùng / đã xoá / ngoài danh sách đã chọn')
      assert.equal(snap.snapshot.catalog.fields.length, 5)
      assert.deepEqual(await call('pause', { inputId: c.ids[0] }), { ok: false, reason: 'invalid_request' }, 'không có thao tác pause (đi qua report_v1)')
      assert.deepEqual(await call('snapshot', {}, claim.targetRunId, '00000000-0000-4000-8000-000000000000'), { ok: false, reason: 'ownership_lost' })
      assert.deepEqual(await call('snapshot', {}, 999999999), { ok: false, reason: 'run_closed' })
      // facts: tag akaBiz theo danh bạ, rồi theo hội thoại Chat khi chưa có danh bạ; số ngày từ lần gửi gần nhất.
      await db.query(`INSERT INTO public.auto_contact_tags VALUES (77, $1, $2, NULL, false), (78, $1, $2, $3, false), (79, $1, $2, 1, false), (80, $1, $2, NULL, true)`,
        [STAFF, ORG, c.account])
      await db.query(`INSERT INTO public.test_contact_facts VALUES (71, '{"akabiz_tag_keys":["77"]}')`)
      let f = await call('facts', { uid: 'u-9', tags: true })
      assert.deepEqual(f.facts.akabiz_contact, { ids: ['77'], availableValues: ['77', '78'] }, 'danh bạ: tag từ aka_agent_data_group_zalo_facts; tag dùng được: chung + của tài khoản')
      await db.query(`INSERT INTO public.chat_zalo_account_organization VALUES (1, 11, $1, $2, true); INSERT INTO public.chat_zalo_account_conversation VALUES (21, 11, 'u-5', 'user');
        INSERT INTO public.chat_zalo_conversation VALUES (31, 1, 21, $2); INSERT INTO public.chat_zalo_conversation_system_tag VALUES (31, $2, 78)`.replace(/\$1/g, String(c.account)).replace(/\$2/g, String(ORG)))
      f = await call('facts', { uid: 'u-5', tags: true })
      assert.deepEqual(f.facts.akabiz_contact.ids, ['78'], 'chưa có danh bạ: tag của hội thoại Chat')
      assert.equal(f.facts.campaign_delivery, null)
      f = await call('facts', { uid: 'u-5', days: 7 })
      assert.deepEqual(f.facts.campaign_delivery, { daysSince: 3651 }, 'chưa gửi lần nào')
      await db.query(`INSERT INTO public.test_delivery VALUES ($1, now() - interval '2 days', ARRAY['zalo:u-5'])`, [c.account])
      f = await call('facts', { uid: 'u-5', days: 7 })
      assert.ok(f.facts.campaign_delivery.daysSince <= 2 && f.facts.campaign_delivery.daysSince >= 1, JSON.stringify(f))
      f = await call('facts', { uid: 'u-5', days: 9000 })
      assert.equal(f.facts.campaign_delivery, null, 'số ngày ngoài 1–3650: không có dữ kiện (Desktop: chưa đủ dữ liệu)')
      // Cấu hình hỏng: nhóm đã xoá / tài khoản chạy không có cấu hình.
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = jsonb_set(extra_settings, ARRAY['zaloSendExclusionsByAccountId', $2::text, 'groupId'], '999') WHERE id = $1`,
        [c.campaign, String(c.account)])
      assert.deepEqual(await call('snapshot'), { ok: false, reason: 'config_invalid', message: 'Nhóm điều kiện loại trừ đã bị xoá.', code: 'send_exclusion_group_not_found' })
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = extra_settings - 'zaloSendExclusionsByAccountId' WHERE id = $1`, [c.campaign])
      assert.deepEqual(await call('snapshot'), { ok: false, reason: 'config_invalid', message: 'Chưa cấu hình loại trừ cho tài khoản thực hiện.' })
      await data.release(c.account, claim.leaseToken)
    }
    pass('RPC: xác thực bằng lease (sai lease / lượt đã đóng), không có pause; snapshot như hàm cũ; facts tag akaBiz (danh bạ, hội thoại Chat) và số ngày; cấu hình hỏng có câu')

    // ---- 4. Nhắn bạn bè: bị loại trừ thì tạm dừng data kèm câu, "🚫 Bỏ qua", người khác vẫn gửi ----------------
    {
      const c = await make({ selection: { groupId: 501, blocklistIds: [] }, targets: [{ name: 'Lan', uid: 'f-1' }, { name: 'Huệ', uid: 'f-2' }] })
      const r = await run(c, { labels: { 'f-1': ['L9'], 'f-2': ['L1'] } })
      assert.equal(r.calls.filter(x => x === 'snapshot').length, 1, 'cấu hình đọc một lần mỗi lượt')
      assert.ok(r.calls.includes('text:f-2') && !r.calls.includes('text:f-1'), 'người bị loại trừ không được gửi')
      const i = await inputs(c)
      assert.deepEqual(i.map(x => x.status), ['tạm dừng', 'hoàn thành'])
      assert.equal(i[0].note, 'Thỏa điều kiện loại trừ của nhóm “Khách VIP”: Tag Zalo. (EXC01)')
      assert.ok(r.lines.includes('🚫 Bỏ qua "Lan": Thỏa điều kiện loại trừ của nhóm “Khách VIP”: Tag Zalo. (EXC01)'), r.lines.join('\n'))
      const d = await details(c)
      assert.deepEqual(d.map(x => [x.input_data_id, x.status]), [[c.ids[1], 'thành công']], 'người bị loại trừ không có dòng lịch sử')
    }
    pass('nhắn bạn bè: thuộc nhóm điều kiện (tag Zalo) → data tạm dừng kèm câu (EXC01), dòng "🚫 Bỏ qua", không lịch sử; người khác vẫn gửi')

    // ---- 5. Danh sách Zalo ID loại trừ; chưa đủ dữ liệu (EXC02) -----------------------------------------------
    {
      const c = await make({ selection: { groupId: null, blocklistIds: [51] }, targets: [{ name: 'Mai', uid: 'b-1' }, { name: 'Đào', uid: 'b-2' }] })
      await db.query(`INSERT INTO public.auto_account_contacts VALUES (171, $1, $2, $3, 'person', 'b-1', false)`, [c.account, STAFF, ORG])
      await db.query(`INSERT INTO public.auto_account_contact_group_members (group_id, contact_id) VALUES (51, 171)`)
      const r = await run(c)
      const i = await inputs(c)
      assert.deepEqual(i.map(x => [x.status, x.note]), [['tạm dừng', 'Thuộc danh sách Zalo ID loại trừ. (EXC01)'], ['hoàn thành', null]])
      assert.ok(!r.calls.some(x => x.startsWith('labels:')), 'chỉ danh sách: không đọc tag')
      // Nhóm "Bạn bè" (AND: là bạn bè VÀ giới tính 1): đủ hai điều kiện → loại trừ; thiếu giới tính → chưa đủ dữ liệu (EXC02);
      // hồ sơ không có cờ bạn bè → đọc trạng thái kết bạn (người lạ) → không thoả → gửi.
      const c2 = await make({ selection: { groupId: 504, blocklistIds: [] }, targets: [{ name: 'Cúc', uid: 'n-1' }, { name: 'Lý', uid: 'n-2' }, { name: 'Sen', uid: 'n-3' }] })
      const r2 = await run(c2, { profiles: { 'n-2': { gender: null }, 'n-3': { isFr: 0 } } })
      const i2 = await inputs(c2)
      assert.deepEqual(i2.map(x => [x.status, x.note]), [
        ['tạm dừng', 'Thỏa điều kiện loại trừ của nhóm “Bạn bè”. (EXC01)'],
        ['tạm dừng', 'Chưa đủ dữ liệu để kiểm tra nhóm “Bạn bè”. (EXC02)'],
        ['hoàn thành', null]])
      assert.ok(r2.calls.includes('friendship:n-3') && !r2.calls.includes('friendship:n-1'), 'chỉ đọc trạng thái kết bạn khi hồ sơ không có cờ bạn bè')
      assert.ok(r2.calls.includes('text:n-3') && !r2.calls.includes('text:n-1') && !r2.calls.includes('text:n-2'))
      assert.ok(r2.lines.includes('🚫 Bỏ qua "Lý": Chưa đủ dữ liệu để kiểm tra nhóm “Bạn bè”. (EXC02)'), r2.lines.join('\n'))
    }
    pass('danh sách Zalo ID loại trừ → EXC01; nhóm AND: thoả → EXC01, thiếu dữ liệu → EXC02 (tạm dừng như Desktop), người lạ → gửi')

    // ---- 6. Dữ kiện DB: số ngày từ lần gửi gần nhất; DB lỗi khi kiểm → chưa gửi, data về hàng đợi (SYS08) --------
    {
      const c = await make({ selection: { groupId: 502, blocklistIds: [] }, targets: [{ name: 'Tâm', uid: 'd-1' }, { name: 'Tú', uid: 'd-2' }] })
      await db.query(`INSERT INTO public.test_delivery VALUES ($1, now() - interval '1 day', ARRAY['zalo:d-1'])`, [c.account])
      const r = await run(c)
      assert.ok(r.calls.includes('facts:{"uid":"d-1","days":7}'), r.calls.join(' '))
      const i = await inputs(c)
      assert.deepEqual(i.map(x => x.status), ['tạm dừng', 'hoàn thành'], 'gửi trong 7 ngày → loại trừ')
      const c2 = await make({ selection: { groupId: 502, blocklistIds: [] }, targets: [{ name: 'Vy', uid: 'd-3' }] })
      const r2 = await run(c2, { factsDown: true })
      assert.ok(!r2.calls.some(x => x.startsWith('text:')), 'không gửi khi chưa kiểm được')
      const i2 = await inputs(c2)
      assert.equal(i2[0].status, 'chờ xử lý', 'cổng send_exclusion closed (V504): data về hàng đợi')
      assert.equal(r2.result.reason, 'end_unit', JSON.stringify(r2.result))
      assert.ok(r2.lines.includes('⚠️ Nhắn tin bạn bè: Chưa kiểm tra được điều kiện gửi, sẽ tự chạy lại (SYS08)'), r2.lines.join('\n'))
    }
    pass('dữ kiện DB: gửi trong N ngày → loại trừ; DB lỗi khi kiểm → không gửi, data về hàng đợi, dừng lượt (SYS08)')

    // ---- 7. Đọc tag Zalo lỗi → báo đúng lỗi Zalo cho DB (không tạm dừng data như bản cũ) -------------------------
    {
      const c = await make({ selection: { groupId: 501, blocklistIds: [] }, targets: [{ name: 'Phúc', uid: 'z-1' }] })
      const r = await run(c, { labelsError: E.zaloPortErrorFrom(err('read ECONNRESET', 'ECONNRESET'), { operation: 'read', answered: false }) })
      assert.ok(!r.calls.some(x => x.startsWith('text:')))
      const i = await inputs(c)
      assert.equal(i[0].status, 'chờ xử lý', 'lỗi mạng khi đọc (trước khi gửi): data về hàng đợi theo chính sách')
      assert.ok(r.lines.some(l => l.includes('(NET01)')), r.lines.join('\n'))
    }
    pass('đọc tag Zalo lỗi mạng → NET01 theo chính sách (data về hàng đợi), không gửi')

    // ---- 8. Cấu hình hỏng đầu lượt (CFG18) và lúc đọc cấu hình (nhóm đã xoá) ----------------------------------------
    {
      const c = await make({ selection: { groupId: 501, blocklistIds: [] }, targets: [{ name: 'Ân', uid: 'c-1' }] })
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = jsonb_set(extra_settings, '{zaloSendExclusionsByAccountId}', '{"1":{"groupId":501,"blocklistIds":[]}}') WHERE id = $1`, [c.campaign])
      c.extra = (await one(`SELECT extra_settings FROM public.auto_campaigns WHERE id = $1`, [c.campaign])).extra_settings
      const r = await run(c)
      const s = await camp(c)
      assert.equal(s.status, 'tạm dừng')
      assert.equal(s.note, 'Không thể tải cấu hình loại trừ: Chưa cấu hình loại trừ cho tài khoản thực hiện. (CFG18)')
      assert.equal((await inputs(c))[0].status, 'chờ xử lý', 'không đốt data')
      assert.ok(!r.calls.some(x => x.startsWith('text:') || x.startsWith('profile:')))
      const c2 = await make({ selection: { groupId: 998, blocklistIds: [] }, targets: [{ name: 'Bảo', uid: 'c-2' }] })
      await run(c2)
      const s2 = await camp(c2)
      assert.equal(s2.status, 'tạm dừng')
      assert.equal(s2.note, 'Không thể tải cấu hình loại trừ: Nhóm điều kiện loại trừ đã bị xoá. (CFG18)')
      assert.equal((await inputs(c2))[0].status, 'chờ xử lý')
    }
    pass('cấu hình hỏng: không có cấu hình cho tài khoản chạy (đầu lượt) / nhóm đã xoá (lúc đọc) → tạm dừng chiến dịch kèm câu (CFG18), không đốt data')

    // ---- 9. Nhắn theo SĐT: tra số xong mới kiểm loại trừ; bị loại trừ thì không nhắn, không kết bạn --------------
    {
      const c = await make({ actionId: PHONE, extra: { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Kết bạn nhé' },
        selection: { groupId: 501, blocklistIds: [] }, targets: [{ name: 'Khách', phone: '0912000123' }, { name: 'Khách 2', phone: '0912000456' }] })
      c.extra.actionLimits.byActionCode.zalo_find_phone_user = { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 }
      c.extra.actionLimits.byActionCode.zalo_add_friend = { dailyLimit: 500, rateLimitCount: 500, rateLimitMinutes: 60 }
      await db.query(`UPDATE public.auto_campaigns SET extra_settings = $2::jsonb WHERE id = $1`, [c.campaign, JSON.stringify(c.extra)])
      const r = await run(c, { labels: { p123: ['L9'] } })
      assert.ok(r.calls.includes('find:0912000123') && !r.calls.includes('text:p123') && !r.calls.includes('friend:p123'), r.calls.join(' '))
      assert.ok(r.calls.includes('text:p456') && r.calls.includes('friend:p456'))
      const i = await inputs(c)
      assert.equal(i[0].status, 'tạm dừng')
      const d = await details(c)
      assert.deepEqual(d.filter(x => x.input_data_id === c.ids[0]).map(x => [x.action_code, x.status]), [['zalo_find_phone_user', 'thành công']],
        'tra số vẫn ghi lịch sử; nhắn / kết bạn không chạy')
    }
    pass('nhắn theo SĐT: tra số → loại trừ (tag của UID tìm được) → không nhắn, không kết bạn; data tạm dừng')

    // ---- 10. Chia sẻ bạn bè: người bị loại trừ báo riêng, không vào lô; một lần đọc tag cho cả lô ---------------
    {
      const c = await make({ extra: { zaloMessageSendMode: 'share' }, content: 'Chào cả nhà', selection: { groupId: 501, blocklistIds: [] },
        targets: [{ name: 'S1', uid: 's-1' }, { name: 'S2', uid: 's-2' }, { name: 'S3', uid: 's-3' }] })
      let leadRun = null
      const r = await run(c, { labels: { 's-2': ['L9'] }, expectContext: () => leadRun })
      leadRun = null
      const labelCalls = r.calls.filter(x => x.startsWith('labels:'))
      assert.equal(labelCalls.length, 3)
      assert.equal(new Set(labelCalls.map(x => x.split(':')[1])).size, 1, 'một ngữ cảnh tag (data đầu lô) cho cả lô')
      assert.ok(r.calls.includes('forward:s-1,s-3'), r.calls.join(' '))
      const i = await inputs(c)
      assert.deepEqual(i.map(x => x.status), ['hoàn thành', 'tạm dừng', 'hoàn thành'])
      assert.ok(r.lines.includes('🚫 Bỏ qua "S2": Thỏa điều kiện loại trừ của nhóm “Khách VIP”: Tag Zalo. (EXC01)'), r.lines.join('\n'))
      assert.ok(r.lines.includes('📨 Kết quả chia sẻ tin nhắn Zalo: tổng 2, thành công 2, thất bại 0'), r.lines.join('\n'))
    }
    pass('chia sẻ bạn bè: người bị loại trừ báo riêng (tạm dừng, "🚫 Bỏ qua"), không vào lệnh chia sẻ; tag đọc một lần cho cả lô')

    // ---- 11. Danh sách không gửi tin kiểu cũ (nhắn bạn bè chưa có cấu hình loại trừ mới) ---------------------------------
    {
      const blockMake = async (extra, targets) => {
        const c = await make({ extra, targets })
        await db.query(`INSERT INTO public.auto_account_contact_groups VALUES ($1, $2, $3, $4, 'Không gửi', 'zalo_friend_blocklist', 'person', false)
          ON CONFLICT (id) DO NOTHING`, [Number(extra.zaloFriendBlocklistId) || 0, c.account, STAFF, ORG])
        return c
      }
      const addMember = async (c, contactId, uid) => {
        await db.query(`INSERT INTO public.auto_account_contacts VALUES ($1, $2, $3, $4, 'person', $5, false)`, [contactId, c.account, STAFF, ORG, uid])
        await db.query(`INSERT INTO public.auto_account_contact_group_members (group_id, contact_id) VALUES ($1, $2)`, [c.extra.zaloFriendBlocklistId, contactId])
      }
      // Không chia sẻ: người trong danh sách hoàn thành kèm câu, không đọc gì từ Zalo; người khác vẫn gửi; danh sách đọc một lần.
      const c1 = await blockMake({ zaloFriendBlocklistEnabled: true, zaloFriendBlocklistId: 601 }, [{ name: 'K1', uid: 'k-1' }, { name: 'K2', uid: 'k-2' }])
      await addMember(c1, 6001, 'K-1/')
      const r1 = await run(c1)
      assert.equal(r1.calls.filter(x => x === 'blocklist').length, 1, 'danh sách đọc một lần mỗi lượt')
      assert.ok(!r1.calls.includes('profile:k-1') && r1.calls.includes('text:k-2'), r1.calls.join(' '))
      assert.deepEqual((await inputs(c1)).map(x => [x.status, x.note]), [
        ['hoàn thành', 'Nằm trong danh sách không gửi tin: Không gửi (EXC03)'], ['hoàn thành', null]],
        'so UID như Desktop (bỏ khoảng trắng, dấu / cuối, không phân biệt hoa thường)')
      assert.ok(r1.lines.includes('🚫 Bỏ qua "K1": Nằm trong danh sách không gửi tin: Không gửi (EXC03)'), r1.lines.join('\n'))
      assert.deepEqual((await details(c1)).map(x => x.input_data_id), [c1.ids[1]], 'người trong danh sách không có dòng lịch sử')
      // Chưa chọn danh sách / danh sách của tài khoản khác → CFG19 (tạm dừng chiến dịch, không đốt data).
      const c2 = await make({ extra: { zaloFriendBlocklistEnabled: true }, targets: [{ name: 'K3', uid: 'k-3' }] })
      await run(c2)
      assert.deepEqual(await camp(c2), { status: 'tạm dừng', note: 'Danh sách không gửi tin Zalo không hợp lệ: Chưa chọn danh sách không gửi tin Zalo (CFG19)' })
      assert.equal((await inputs(c2))[0].status, 'chờ xử lý')
      const c3 = await make({ extra: { zaloFriendBlocklistEnabled: true, zaloFriendBlocklistId: 601 }, targets: [{ name: 'K4', uid: 'k-4' }] })
      await run(c3)
      assert.deepEqual(await camp(c3), { status: 'tạm dừng',
        note: 'Danh sách không gửi tin Zalo không hợp lệ: Danh sách không gửi tin không thuộc tài khoản Zalo của chiến dịch. (CFG19)' })
      // Đã có cấu hình loại trừ mới thì bỏ danh sách cũ (như Desktop).
      const c4 = await make({ extra: { zaloFriendBlocklistEnabled: true, zaloFriendBlocklistId: 601 }, selection: { groupId: null, blocklistIds: [] },
        targets: [{ name: 'K5', uid: 'k-5' }] })
      const r4 = await run(c4)
      assert.ok(!r4.calls.includes('blocklist') && r4.calls.includes('text:k-5'), r4.calls.join(' '))
      // Chia sẻ: người trong danh sách không vào lệnh chia sẻ, Desktop không in từng người mà in một dòng tổng.
      const c5 = await blockMake({ zaloMessageSendMode: 'share', zaloFriendBlocklistEnabled: true, zaloFriendBlocklistId: 602 },
        [{ name: 'S1', uid: 'bs-1' }, { name: 'S2', uid: 'bs-2' }, { name: 'S3', uid: 'bs-3' }])
      await addMember(c5, 6002, 'bs-2')
      await db.query(`UPDATE public.auto_campaigns SET content = 'Chào cả nhà' WHERE id = $1`, [c5.campaign])
      c5.content = 'Chào cả nhà'
      const r5 = await run(c5)
      assert.ok(r5.calls.includes('forward:bs-1,bs-3') && !r5.calls.includes('profile:bs-2'), r5.calls.join(' '))
      assert.deepEqual((await inputs(c5)).map(x => x.status), ['hoàn thành', 'hoàn thành', 'hoàn thành'])
      assert.ok(r5.lines.includes('🚫 Đã bỏ qua 1 bạn bè Zalo trong danh sách không gửi tin'), r5.lines.join('\n'))
      assert.ok(!r5.lines.some(l => l.startsWith('🚫 Bỏ qua "S2"')), 'chia sẻ: không in từng người như Desktop')
    }
    pass('danh sách không gửi tin kiểu cũ: trong danh sách → hoàn thành kèm câu (EXC03), không đọc Zalo; chưa chọn / khác tài khoản → CFG19; có cấu hình loại trừ mới thì bỏ qua; chia sẻ in một dòng tổng')

    console.log(`OK V504: ${checks} nhóm kiểm`)
  } finally {
    await db.end().catch(() => undefined)
    stop()
  }
}

main().catch(error => { console.error(error); process.exit(1) })
