// Bộ kịch bản toàn diện cho engine v2 trên PostgreSQL 17 cục bộ: dữ liệu giả dựng từ hồ sơ production đã che, kết quả Zalo theo phân
// bố thật, lỗi hạ tầng tiêm vào, các kịch bản sự cố cố định, rồi kiểm bất biến. Không chạm DB thật, không gọi Zalo.
//
//   CHAT_REPO=../akaAgentChatApi node scripts/engine-v2-scenarios/run.cjs [--seed 1] [--targets 14] [--rounds 3] [--chaos 3]
//     [--inject 0.01] [--dbchaos 0.01] [--concurrency 6] [--only 1,2,3] [--skip-general] [--skip-faults] [--out report.json]
//
// Phần:
//   1. Lệch danh mục: luật / chính sách / mã lỗi / cổng / thiết lập của DB thử so với production (fixtures/profile-*.json).
//   2. Từng luật đang bật: dựng tín hiệu khớp luật, mô phỏng (aka_agent_engine_simulate_v1) phải ra đúng mã; bảng chính sách hiệu lực
//      theo (thao tác, mã Zalo thật) để đánh giá chính sách.
//   3. Chạy mọi cấu hình mẫu (150 chiến dịch thật đã che) trên đúng nơi chạy của nó, nhiều vòng, có thao tác của người dùng giữa vòng.
//   4. Kịch bản sự cố cố định: DB sập giữa lượt, mất câu trả lời của DB, chết tiến trình trước/sau khi gửi, mất lease, hai bộ chạy,
//      tạm dừng / đăng xuất giữa lượt, thoát app khi đang gửi, hết lượt, qua giờ dừng.
//   5. Bất biến (mục I1–I14 trong báo cáo).
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const W = require('./world.cjs')
const { makePort } = require('./port.cjs')

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const flag = name => args.includes(name)
const SEED = Number(opt('--seed', 1))
const TARGETS = Number(opt('--targets', 14))
const ROUNDS = Number(opt('--rounds', 3))
const CHAOS = Number(opt('--chaos', 3))
const INJECT = Number(opt('--inject', 0.01))
const DBCHAOS = Number(opt('--dbchaos', 0.01))
const CONCURRENCY = Number(opt('--concurrency', 6))
const ONLY = opt('--only') ? new Set(opt('--only').split(',').map(Number)) : null
const OUT = opt('--out')
const PORT = Number(process.env.ENGINE_SCENARIO_PORT || 55513)
const PROFILE_PATH = opt('--profile', path.join(__dirname, 'fixtures/profile-20261113.json'))
const HEARTBEAT_MS = 61_237 // khác mọi nhịp nghỉ thật để đồng hồ giả nhận ra lần chờ của heartbeat
const HEARTBEAT_REAL_MS = Number(process.env.ENGINE_SCENARIO_HEARTBEAT_REAL_MS || 15000)
// Vi phạm đã biết, chưa sửa: vẫn in ra nhưng không làm mã thoát thành 1, để mã thoát chỉ báo lỗi mới.
// Sửa xong thì xoá dòng tương ứng (docs/CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md mục E).
const KNOWN_INVARIANTS = {
  I1b: 'E1: data trùng trong cùng lô chia sẻ, bộ cũ cũng vậy, chưa sửa'
}

const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'))
const model = W.buildModel(profile)

async function loadEngine() {
  const cache = path.join(ROOT, 'node_modules', '.cache')
  fs.mkdirSync(cache, { recursive: true })
  const out = fs.mkdtempSync(path.join(cache, 'aka-engine-scen-'))
  const tsc = require.resolve('typescript/bin/tsc', { paths: [ROOT] })
  const r = spawnSync(process.execPath, [tsc, '-p', path.join(ROOT, 'packages/campaign-engine/tsconfig.json'), '--outDir', out], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('tsc: ' + (r.stdout || r.stderr))
  fs.writeFileSync(path.join(out, 'package.json'), '{"type":"module"}')
  return import(pathToFileURL(path.join(out, 'index.js')).href)
}

// ---------------------------------------------------------------------------------------------------------------------------
// DB thử
// ---------------------------------------------------------------------------------------------------------------------------

async function bootstrap(db, notes) {
  const build = n => require(`../build-v${n}-sql.cjs`).migration
  await buildFixture(db, [])
  await db.query(MIGRATION)
  await db.query(build(499))
  await db.query(fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8'))
  for (const n of [501, 503, 504, 505, 506, 507, 508, 509, 512]) await db.query(build(n))
  for (const f of ['migration_v513_engine_desktop_flag.sql', 'migration_v514_status_system_group_guard.sql']) {
    try { await db.query(fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')); notes.push(`${f}: đã apply`) } catch (error) {
      await db.query('ROLLBACK').catch(() => {})
      notes.push(`${f}: không apply được trên fixture (${String(error.message).slice(0, 140)})`)
    }
  }
  // Theo thứ tự production: V515 (sửa B, C, D của bộ thử 13/11) rồi V517 (dọn bảng, decision chỉ còn result + contrib); V527 (claim bỏ
  // qua claim token bộ cũ treo trên chiến dịch đã xoá / tạm dừng; apply production 14/11 02:07 VN, không phụ thuộc V515 / V517);
  // V532 (lỗi có ngưỡng ở bước phụ không tạm dừng ngay; câu nhận data không quét khoá chính; dựng trên V517 và V527).
  // SCENARIO_SKIP_MIGRATIONS=515,517,527,532 để chạy trên DB trước các bản đó (so trước / sau); bỏ V515 thì phải bỏ cả V517;
  // bỏ V517 hoặc V527 thì phải bỏ cả V532.
  const skip = new Set(String(process.env.SCENARIO_SKIP_MIGRATIONS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number))
  if (skip.has(515) && !skip.has(517)) throw new Error('SCENARIO_SKIP_MIGRATIONS: V517 dựng trên V515, bỏ V515 thì bỏ cả 517')
  if ((skip.has(517) || skip.has(527)) && !skip.has(532)) throw new Error('SCENARIO_SKIP_MIGRATIONS: V532 dựng trên V517 và V527, bỏ một trong hai thì bỏ cả 532')
  for (const n of [515, 517, 527, 532]) {
    if (skip.has(n)) { notes.push(`V${n}: bỏ qua (SCENARIO_SKIP_MIGRATIONS)`); continue }
    await db.query(build(n))
    notes.push(`V${n}: đã apply`)
  }
  // Nhóm data: hàm kết thúc thật của production + bảng nguồn tối thiểu (như replay.cjs).
  await db.query(`CREATE TABLE public.auto_campaign_data_group_sources (id bigserial PRIMARY KEY, campaign_id bigint NOT NULL, staff_id bigint,
    organization_id bigint, status text NOT NULL, stopped_at timestamptz, stop_reason text, updated_at timestamptz DEFAULT now())`)
  await db.query(`CREATE FUNCTION public.aka_agent_internal_require_staff_tenant(p_staff_id bigint, p_organization_id bigint) RETURNS void
    LANGUAGE plpgsql AS $$ BEGIN END $$`)
  await db.query(`CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(p_campaign_id bigint) RETURNS void LANGUAGE sql
    AS $$ SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || p_campaign_id::text, 0)) $$`)
  await db.query(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/campaign-outcome-engine/data-group-finalizer-v219.sql'), 'utf8'))
  // Chỉ ở DB thử: "thời gian trôi 70 phút" giữa hai vòng: khoá thao tác hết hạn trong 70 phút tới coi như đã mở (khoá theo ngày giữ nguyên).
  await db.query(`CREATE FUNCTION public.aka_agent_scenario_time_passes(p_accounts bigint[]) RETURNS integer LANGUAGE sql AS $f$
    WITH u AS (UPDATE public.auto_account_action_status SET date_enable = now() - interval '1 second'
      WHERE account_id = ANY(p_accounts) AND is_disable AND date_enable IS NOT NULL AND date_enable <= now() + interval '70 minutes' RETURNING 1)
    SELECT count(*)::integer FROM u $f$`)
  // Chống gửi lặp N ngày: hàm của production không có trong fixture; bản thay theo đúng hợp đồng (V367: chỉ tính lần gửi thành công,
  // cùng tài khoản hoặc mọi tài khoản của nhân viên, tạm dừng data kèm câu "đã gửi tin trước đó ngày …").
  await db.query(`CREATE FUNCTION public.aka_agent_apply_campaign_delivery_cooldown(p_campaign_id bigint, p_account_id bigint, p_staff_id bigint, p_input_data_ids bigint[])
    RETURNS TABLE(input_data_id bigint, decision text, note text, last_sent_at timestamptz, eligible_date date, source_campaign_id bigint, source_campaign_name text)
    LANGUAGE plpgsql AS $f$
    DECLARE d record; c record; v_days integer; v_all boolean; v_last record; v_note text;
    BEGIN
      SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id;
      v_days := greatest(1, coalesce(nullif(c.extra_settings->>'recentDeliveryCooldownDays', '')::integer, 3));
      v_all := coalesce((c.extra_settings->>'recentDeliveryCooldownAllAccounts')::boolean, false);
      FOR d IN SELECT x.* FROM public.auto_campaign_input_data x WHERE x.id = ANY(p_input_data_ids) ORDER BY x.id FOR UPDATE LOOP
        IF d.status <> 'chờ xử lý' THEN
          RETURN QUERY SELECT d.id, 'not_pending'::text, 'Data không còn ở trạng thái chờ xử lý.'::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text;
          CONTINUE;
        END IF;
        SELECT det.created_at, det.campaign_id, cc.name INTO v_last
          FROM public.auto_campaign_details det JOIN public.auto_campaign_input_data i ON i.id = det.input_data_id
          JOIN public.auto_campaigns cc ON cc.id = det.campaign_id
         WHERE det.status = 'thành công' AND det.action_code IN ('zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend')
           AND i.id <> d.id AND coalesce(nullif(i.phone, ''), i.uid) = coalesce(nullif(d.phone, ''), d.uid)
           AND det.created_at > now() - make_interval(days => v_days)
           AND CASE WHEN v_all THEN cc.staff_id = c.staff_id ELSE det.account_id = p_account_id END
         ORDER BY det.created_at DESC LIMIT 1;
        IF FOUND THEN
          v_note := 'Tạm dừng: đã gửi tin trước đó ngày ' || to_char(v_last.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || '. Gửi lại từ '
            || to_char((v_last.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + v_days, 'DD/MM/YYYY') || '.';
          UPDATE public.auto_campaign_input_data SET status = 'tạm dừng', note = v_note WHERE id = d.id;
          RETURN QUERY SELECT d.id, 'paused_recent_delivery'::text, v_note, v_last.created_at, ((v_last.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + v_days),
            v_last.campaign_id, v_last.name;
        ELSE
          RETURN QUERY SELECT d.id, 'allowed'::text, NULL::text, NULL::timestamptz, NULL::date, NULL::bigint, NULL::text;
        END IF;
      END LOOP;
    END $f$`)
}

async function insertRows(db, table, rows) {
  if (!rows.length) return
  const cols = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table])).rows
    .map(r => r.column_name)
  const keys = [...new Set(rows.flatMap(r => Object.keys(r)))].filter(k => cols.includes(k))
  const list = keys.map(k => `"${k}"`).join(', ')
  await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb)`,
    [JSON.stringify(rows)])
}

// ---------------------------------------------------------------------------------------------------------------------------
// 1. Lệch danh mục
// ---------------------------------------------------------------------------------------------------------------------------

const CATALOG_SQL = `SELECT json_build_object(
  'rules', (SELECT json_agg(to_jsonb(r) - 'created_at' - 'updated_at' ORDER BY r.id) FROM public.auto_outcome_signal_rules r),
  'policies', (SELECT json_agg(to_jsonb(p) - 'created_at' - 'updated_at' - 'updated_by' ORDER BY p.id) FROM public.auto_outcome_policies p),
  'errors', (SELECT json_agg(json_build_object('error_code', e.error_code, 'public_code', e.public_code, 'error_class', e.error_class,
       'is_active', e.is_active, 'is_delete', e.is_delete, 'error_type', e.error_type, 'customer_title', e.customer_title) ORDER BY e.error_code)
     FROM public.auto_error e WHERE e.public_code IS NOT NULL OR e.error_class IS NOT NULL),
  'gates', (SELECT json_agg(to_jsonb(g) ORDER BY 1) FROM public.auto_engine_gates g),
  'settings', (SELECT json_object_agg(s.key, s.value) FROM public.auto_system_settings s WHERE s.key LIKE 'engine.%'),
  'status_rules', (SELECT json_agg(to_jsonb(x) ORDER BY 1) FROM public.auto_status_event_rules x),
  'lint', (SELECT json_agg(to_jsonb(l)) FROM public.aka_agent_engine_policy_lint l)
) AS r`

function diffBy(prod, local, keyOf, ignore = []) {
  const strip = row => { const o = { ...row }; for (const k of ignore) delete o[k]; return o }
  const P = new Map((prod || []).map(r => [keyOf(r), strip(r)]))
  const L = new Map((local || []).map(r => [keyOf(r), strip(r)]))
  const onlyProd = [...P.keys()].filter(k => !L.has(k))
  const onlyLocal = [...L.keys()].filter(k => !P.has(k))
  const changed = []
  for (const [k, p] of P) {
    const l = L.get(k)
    if (!l) continue
    const fields = [...new Set([...Object.keys(p), ...Object.keys(l)])].filter(f => JSON.stringify(p[f] ?? null) !== JSON.stringify(l[f] ?? null))
    if (fields.length) changed.push({ key: k, fields: Object.fromEntries(fields.map(f => [f, { prod: p[f] ?? null, local: l[f] ?? null }])) })
  }
  return { prod: P.size, local: L.size, onlyProd, onlyLocal, changed }
}

async function catalogDrift(db) {
  const local = (await db.query(CATALOG_SQL)).rows[0].r
  const prod = profile.catalog
  const ruleKey = r => [r.platform, r.signal_kind, r.pattern, r.action_code ?? '*', r.phase ?? '*', r.error_code].join('|')
  const policyKey = p => [p.error_code ?? '-', p.error_class ?? '-', p.status_id ?? '-', p.action_code ?? '*', p.campaign_action_id ?? '*',
    p.runtime_target ?? '*', p.is_delete ? 'deleted' : 'live'].join('|')
  return {
    rules: diffBy(prod.rules, local.rules, ruleKey, ['id', 'note', 'source']),
    policies: diffBy(prod.policies, local.policies, policyKey, ['id', 'revision', 'description', 'source']),
    errors: diffBy(prod.errors, local.errors, e => e.error_code),
    gates: diffBy(prod.gates, local.gates, g => String(g.gate_code ?? g.code ?? g.gate ?? JSON.stringify(g)), ['updated_at', 'created_at']),
    settings: diffBy(Object.entries(prod.settings || {}).map(([k, v]) => ({ k, v })), Object.entries(local.settings || {}).map(([k, v]) => ({ k, v })), s => s.k),
    statusRules: diffBy(prod.status_rules, local.status_rules, x => JSON.stringify([x.event_kind, x.status_id, x.action_code ?? null]), ['id', 'created_at', 'updated_at']),
    lintProd: prod.lint, lintLocal: local.lint
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2. Từng luật và bảng chính sách hiệu lực
// ---------------------------------------------------------------------------------------------------------------------------

const CAMPAIGN_OF_ACTION = { zalo_message_friend: 'zalo_message_friend', zalo_message_group: 'zalo_message_group', zalo_add_group_member: 'zalo_add_group_member',
  zalo_join_group_link: 'zalo_join_group_link', zalo_cancel_sent_friend_request: 'zalo_cancel_sent_friend_request' }
const campaignOfAction = action => CAMPAIGN_OF_ACTION[action] ?? 'zalo_message_phone'

async function conformance(db) {
  const rules = (await db.query(`SELECT * FROM public.auto_outcome_signal_rules WHERE is_active ORDER BY id`)).rows
  const actionsByPlatform = {}
  for (const a of (await db.query(`SELECT code, flatform_type FROM public.auto_account_actions ORDER BY code`)).rows) (actionsByPlatform[a.flatform_type] ||= []).push(a.code)
  const sim = async (campaignAction, runtime, outcome) =>
    (await db.query(`SELECT public.aka_agent_engine_simulate_v1($1, $2, $3::jsonb) AS r`, [campaignAction, runtime, JSON.stringify(outcome)])).rows[0].r
  const results = { checked: 0, ok: 0, shadowed: [], noPublicCode: [], invalidPolicy: [] }
  const statusIds = new Set((await db.query(`SELECT id FROM public.auto_status WHERE component_type = 'campaign_detail'`)).rows.map(r => Number(r.id)))
  for (const r of rules) {
    const platform = r.platform === 'system' ? 'zalo' : r.platform
    const action = r.action_code ?? (platform === 'zalo' ? 'zalo_message_stranger' : actionsByPlatform[platform]?.[0])
    if (!action) continue
    const phase = r.phase ?? 'after_send'
    const signal = r.signal_kind === 'message_like' ? { kind: 'message_like', message: r.pattern.replace(/%/g, 'xx').replace(/_/g, 'y') }
      : r.signal_kind === 'engine' ? { kind: 'engine', code: r.pattern === '*' ? 'conformance_unseen_engine_code' : r.pattern, message: 'conformance' }
        : { kind: r.signal_kind, code: r.pattern === '*' ? `conformance_unseen_${r.signal_kind}` : r.pattern, message: 'conformance' }
    for (const runtime of ['desktop', 'fly']) {
      const res = await sim(platform === 'zalo' ? campaignOfAction(action) : null, runtime, { actionCode: action, phase, ok: false, signal })
      results.checked++
      if (!res?.ok) { results.shadowed.push({ rule: r.id, runtime, reason: res?.reason }); continue }
      if (res.errorCode !== r.error_code) {
        results.shadowed.push({ rule: r.id, kind: r.signal_kind, pattern: r.pattern, action: r.action_code, phase: r.phase, platform: r.platform,
          expected: r.error_code, got: res.errorCode, gotRule: res.ruleId, runtime })
        continue
      }
      results.ok++
      if (!res.publicCode) results.noPublicCode.push({ rule: r.id, errorCode: res.errorCode })
      const p = res.policy || {}
      if (p.detail_mode === 'write' && !statusIds.has(Number(p.detail_status_id))) results.invalidPolicy.push({ rule: r.id, errorCode: res.errorCode, problem: 'detail_status_id', policy: p })
    }
  }
  // Bảng chính sách hiệu lực theo (thao tác, mã Zalo thật, pha after_send) cho mọi mã có trong dữ liệu production.
  const matrix = []
  const seen = new Set()
  for (const e of profile.zaloErrors) {
    const code = String(e.zcode ?? '')
    if (!W.NUMERIC.test(code)) continue
    const key = `${e.action_code}|${code}`
    if (seen.has(key)) continue
    seen.add(key)
    const n = profile.zaloErrors.filter(x => x.action_code === e.action_code && String(x.zcode) === code).reduce((s, x) => s + x.n, 0)
    const res = await sim(campaignOfAction(e.action_code), 'fly', { actionCode: e.action_code, phase: 'after_send', ok: false,
      signal: { kind: 'zalo_code', code, message: (e.msgs || [])[0] || '' } })
    const p = res?.policy || {}
    matrix.push({ action: e.action_code, code, n7d: n, oldErrorCode: e.ncode, errorCode: res?.errorCode, publicCode: res?.publicCode,
      catchAll: res?.isCatchAll, target: p.target_effect, quota: p.quota_effect, streak: p.target_streak_effect, threshold: p.streak_threshold,
      campaign: p.campaign_effect, account: p.account_effect, login: p.login_effect, run: p.run_effect, pace: p.pace_mode,
      lock: (p.lock_action_codes || []).length ? `${p.lock_mode}:${p.lock_minutes ?? ''}${p.lock_days ? 'd' + p.lock_days : ''}${p.lock_time ? '@' + p.lock_time : ''}:${p.lock_action_codes.join('+')}` : '',
      steps: p.remaining_steps, detail: p.detail_mode })
  }
  matrix.sort((a, b) => b.n7d - a.n7d)
  return { ...results, matrix }
}

// ---------------------------------------------------------------------------------------------------------------------------
// 3. Thế giới giả và chạy
// ---------------------------------------------------------------------------------------------------------------------------

const MATERIALIZED_MARKERS = /^zalo(Birthday|CancelFriendRequest|Friend|FriendRecommendation)(Data)?Materialized/
const ORG_DESKTOP = 990001
const ORG_FLY = 990002

async function createWorld(db, E, samples, opts = {}) {
  const r = W.mulberry32(W.hash32(SEED, 'world', opts.tag || ''))
  await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org Desktop', false), ($2, 'Org Fly', true)
    ON CONFLICT (id) DO NOTHING`, [ORG_DESKTOP, ORG_FLY])
  const entries = []
  for (const sample of samples) {
    const base = opts.base ?? 0
    const rt = sample.runtime
    const id = base + sample.sampleId
    const entry = { sample, sampleId: sample.sampleId, rt, actionId: sample.actionId, zaloWeb: rt === 'desktop' && sample.zaloWeb === true,
      staffId: 991000 + id, accountId: 992000 + id, campaignId: 993000 + id, orgId: rt === 'fly' ? ORG_FLY : ORG_DESKTOP,
      name: `Kịch bản ${id} ${sample.actionId}`, universeSize: opts.universeSize ?? 18 }
    let extra = W.rekeyExtra(sample.extraSettings, entry.accountId)
    if (opts.extra) extra = { ...extra, ...opts.extra }
    entry.materializing = E.zaloCampaignMaterializes({ actionId: sample.actionId, extraSettings: extra })
    if (entry.materializing) extra = Object.fromEntries(Object.entries(extra).filter(([k]) => !MATERIALIZED_MARKERS.test(k)))
    entry.extra = extra
    entry.cfg = { id: entry.campaignId, actionId: sample.actionId, accountId: entry.accountId, content: sample.content ?? '', extraSettings: extra,
      images: Array.isArray(sample.images) ? sample.images : [], dataTargetSourceMode: sample.dataTargetSourceMode ?? null }
    await insertRows(db, 'auto_accounts', [{ id: entry.accountId, name: `Zalo ${id}`, flatform_type: 'zalo', login_status: 'đã đăng nhập', status: 'chờ xử lý',
      is_active: true, is_delete: false, staff_id: entry.staffId, organization_id: entry.orgId, is_zalo_server: rt === 'fly', is_zalo_show_web: entry.zaloWeb }])
    await insertRows(db, 'auto_campaigns', [{ id: entry.campaignId, name: entry.name, action_id: sample.actionId, account_id: entry.accountId, status: 'chờ xử lý',
      schedule: new Date(Date.now() - 60000).toISOString(), is_delete: false, staff_id: entry.staffId, organization_id: entry.orgId,
      content: entry.cfg.content, images: entry.cfg.images, extra_settings: extra, data_target_source_mode: entry.cfg.dataTargetSourceMode,
      schedule_type: sample.scheduleType || 'daily', ...(opts.campaignRow || {}) }])
    if (entry.cfg.dataTargetSourceMode === 'data_group') {
      await db.query(`INSERT INTO public.auto_campaign_data_group_sources (campaign_id, staff_id, organization_id, status) VALUES ($1, $2, $3, 'active')`,
        [entry.campaignId, entry.staffId, entry.orgId])
    }
    const rows = entry.materializing ? [] : (opts.targets ?? W.buildTargets)(sample, opts.targetCount ?? TARGETS, r)
    entry.targetIds = []
    const inserted = rows.map(row => ({ ...row, id: 994_000_000 + id * 1000 + entry.targetIds.push(0), campaign_id: entry.campaignId, status: 'chờ xử lý', is_delete: false }))
    entry.targetIds = inserted.map(x => x.id)
    await insertRows(db, 'auto_campaign_input_data', inserted)
    entries.push(entry)
  }
  return entries
}

/** Đồng hồ giả: nghỉ giữa data / backoff trả ngay (ghi lại); chờ heartbeat là chờ thật HEARTBEAT_REAL_MS để heartbeat vẫn chạy. */
function makeClock(heartbeatRealMs = HEARTBEAT_REAL_MS) {
  const sleeps = []
  return {
    sleeps,
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise(resolve => {
      if (signal?.aborted) return resolve(false)
      if (ms === HEARTBEAT_MS) {
        const onAbort = () => { clearTimeout(timer); resolve(false) }
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true) }, heartbeatRealMs)
        signal?.addEventListener('abort', onAbort, { once: true })
        return
      }
      sleeps.push(ms)
      setImmediate(() => resolve(!signal?.aborted))
    })
  }
}

const transientDbError = (label = 'fetch failed') => Object.assign(new Error(label), { code: 'ECONNRESET' })

/** Cổng dữ liệu nối RPC thật của DB thử, kèm tiêm lỗi: before = DB chưa nhận; after = DB đã làm nhưng mất câu trả lời. */
function makeDataPort(rpc, faults = {}, log) {
  const r = W.mulberry32(W.hash32(SEED, 'dbfaults', faults.tag || '', faults.stream || ''))
  const wrap = (name, fn) => async (...a) => {
    if (faults.dead?.()) throw transientDbError('process killed')
    const f = faults[name] ?? faults.all
    if (faults.hook) await faults.hook(name, 'before', a)
    if (f?.before && r() < f.before) { log.db.push({ name, when: 'before' }); throw transientDbError() }
    const res = await fn(...a)
    if (faults.recent) { faults.recent.push({ name, args: name === 'claimTarget' || name === 'claimBatch' ? { leaseToken: a[0]?.leaseToken ?? null } : a.slice(0, 2), res }); if (faults.recent.length > 6) faults.recent.shift() }
    if (faults.hook) { const forced = await faults.hook(name, 'after', a, res); if (forced === 'lose') { log.db.push({ name, when: 'after', forced: true }); throw transientDbError() } }
    if (f?.after && r() < f.after) { log.db.push({ name, when: 'after' }); throw transientDbError() }
    return res
  }
  return {
    claimTarget: wrap('claimTarget', ctx => rpc('SELECT public.aka_agent_engine_claim_target_v1($1::jsonb) AS r', [JSON.stringify(ctx)])),
    claimBatch: wrap('claimBatch', ctx => rpc('SELECT public.aka_agent_engine_claim_batch_v1($1::jsonb) AS r', [JSON.stringify(ctx)])),
    reportBatch: wrap('reportBatch', (tok, items, size, stopped) => rpc('SELECT public.aka_agent_engine_report_batch_v1($1, $2::jsonb, $3, $4) AS r',
      [tok, JSON.stringify(items), size, stopped])),
    markSending: wrap('markSending', (id, tok, action, step) => rpc('SELECT public.aka_agent_engine_mark_sending_v1($1, $2, $3, $4) AS r', [id, tok, action, step])),
    report: wrap('report', (id, tok, outcomes, final) => rpc('SELECT public.aka_agent_engine_report_v1($1, $2, $3::jsonb, $4, false) AS r',
      [id, tok, JSON.stringify(outcomes), final])),
    heartbeat: wrap('heartbeat', (acc, tok) => rpc('SELECT public.aka_agent_engine_heartbeat_v1($1, $2) AS r', [acc, tok])),
    release: wrap('release', (acc, tok) => rpc('SELECT public.aka_agent_engine_release_v1($1, $2) AS r', [acc, tok]))
  }
}

const KNOWN_REASONS = new Set(['no_target', 'not_due', 'wait', 'end_unit', 'stop_account', 'stop_campaign', 'ownership_lost', 'cancelled', 'config_invalid',
  'max_targets', 'campaign_paused', 'campaign_not_runnable', 'busy', 'legacy_busy', 'not_enabled', 'not_found', 'account_mismatch', 'account_not_found',
  'invalid_request', 'app_access_denied', 'report_rejected', 'error', 'daily_boundary', 'runtime_not_owner', 'staff_time_blocked', 'account_logged_out',
  'stopped', 'maintenance_required', 'campaign_not_ready', 'data_group_hard_end', 'data_group_waiting', 'account_paused', 'entitlement_denied',
  'concurrency_limit', 'gate_unavailable', 'cooldown_scan'])

let unitSeq = 0
/**
 * Một lượt runUnit cho một chiến dịch của thế giới, cấu hình như Desktop / Fly (bảng loại, kiểm cấu hình, lô chia sẻ, lấy data đầu lượt,
 * việc sau mỗi dòng lịch sử). run: { E, client, log }. x: { faults, hooks, journal, signal, runnerId, portOpts, heartbeatRealMs, maxTargets }.
 */
async function runUnitOnce(run, entry, x = {}) {
  const { E, client, log } = run
  const rpc = async (sql, params) => (await client.query(sql, params)).rows[0].r
  const perCampaign = (run.unitsByCampaign ||= new Map())
  perCampaign.set(entry.campaignId, (perCampaign.get(entry.campaignId) || 0) + 1)
  const faults = { ...(x.faults || {}), recent: [], stream: `${entry.campaignId}:${perCampaign.get(entry.campaignId)}` }
  const data = makeDataPort(rpc, faults, log)
  const type = E.zaloCampaignType(entry.actionId)
  const query = async (sql, params) => (await client.query(sql, params)).rows
  const port = makePort({ E, model, rt: entry.rt, seed: SEED, chaos: CHAOS, inject: INJECT, query,
    engineChaos: { exception: 0.003, hang: 0.002, nullMsgId: 0.03, ownDbError: 0.01 }, entry, rpc, log, hooks: x.hooks, ...(x.portOpts || {}) })
  const random = W.mulberry32(W.hash32(SEED, 'random', entry.campaignId, ++unitSeq))
  const note = (await client.query(`SELECT note FROM public.auto_campaigns WHERE id = $1`, [entry.campaignId])).rows[0]?.note ?? null
  const cfg = entry.cfg
  const prepareTargets = type.prepareTargets?.(cfg, port, { campaignName: entry.name, campaignNote: note, readTimeoutMs: 3000, callTimeoutMs: 5000, random }) ?? null
  const batch = type.buildBatch?.(cfg, port, { sleepBetweenBatchesSeconds: 1, readTimeoutMs: 3000, mediaTimeoutMs: 4000, sendTimeoutMs: 4000,
    aiRewriteTimeoutMs: 1000, random }) ?? null
  const afterReport = type.afterReport?.(cfg, port, { targetLabel: type.targetLabel }) ?? null
  const lines = []
  const traces = []
  const events = {
    progress: l => { lines.push(l); log.lines.push({ ...l, campaignId: entry.campaignId, rt: entry.rt }) },
    trace: t => { traces.push(t); if (/failed|error|rejected|lost|refused/i.test(t.type)) log.traces.push({ campaignId: entry.campaignId, ...t }) }
  }
  const unitCfg = {
    runnerId: x.runnerId ?? `${entry.rt}:scenario:${entry.accountId}`, runtimeTarget: entry.rt, staffId: entry.staffId, accountId: entry.accountId,
    campaignId: entry.campaignId, actionId: entry.actionId, campaignName: entry.name, accountName: `Zalo ${entry.sampleId}`, campaignNote: note,
    targetLabel: type.targetLabel, actionName: code => type.actionNames[code] ?? code,
    ...type.claimPlan(cfg),
    buildSteps: target => type.buildSteps(cfg, port, { account: { id: entry.accountId, name: `Zalo ${entry.sampleId}` }, mediaStepTimeoutMs: 4000,
      textStepTimeoutMs: 2500, aiRewriteTimeoutMs: 1000, random }),
    ...(type.validate ? { validateCampaign: () => type.validate(cfg, { zaloWeb: entry.zaloWeb }) } : {}),
    ...(prepareTargets ? { prepareTargets } : {}),
    ...(batch ? { batch } : {}),
    ...(afterReport ? { afterReport } : {}),
    ...(x.shouldStopAfterTarget ? { shouldStopAfterTarget: x.shouldStopAfterTarget } : {}),
    ...(x.maxTargets ? { maxTargets: x.maxTargets } : {}),
    onNoTarget: async info => rpc('SELECT public.aka_agent_engine_finish_campaign_v2($1, $2, $3) AS r', [entry.accountId, info.leaseToken, info.note ?? null]),
    formatTime: iso => new Date(iso).toISOString(),
    pacing: { fullSeconds: 1 }, stepTimeoutMs: 2500, heartbeatMs: HEARTBEAT_MS, retry: { callTimeoutMs: 8000, backoffMs: [5, 10, 20] }, drainTimeoutMs: 2000
  }
  let result = null
  let thrown = null
  const started = Date.now()
  try {
    result = await E.runUnit({ data, journal: x.journal || new E.MemoryJournal(), clock: makeClock(x.heartbeatRealMs), events }, unitCfg,
      x.signal || new AbortController().signal)
  } catch (error) { thrown = error }
  const unit = { seq: unitSeq, campaignId: entry.campaignId, sampleId: entry.sampleId, actionId: entry.actionId, rt: entry.rt, reason: result?.reason ?? null,
    targets: result?.targets ?? 0, released: result?.released ?? null, detail: result?.detail ? JSON.stringify(result.detail).slice(0, 400) : null,
    thrown: thrown ? String(thrown.stack || thrown).slice(0, 600) : null, ms: Date.now() - started, scenario: x.scenario ?? null,
    ...(['ownership_lost', 'error', 'report_rejected', 'busy'].includes(result?.reason) ? { recent: faults.recent.map(x => ({ name: x.name,
      run: Array.isArray(x.args) ? x.args[0] : null, ok: x.res?.ok, status: x.res?.status, next: x.res?.next, reason: x.res?.reason, done: x.res?.target?.done,
      targetStatus: x.res?.target?.status, outcomes: (x.res?.outcomes || []).map(o => `${o.actionCode}:${o.errorCode || 'ok'}${o.replay ? ':replay' : ''}`) })) } : {}) }
  log.units.push(unit)
  return { result, thrown, lines, traces, unit }
}

const CONTINUE = new Set(['end_unit', 'max_targets', 'stopped', 'cooldown_scan'])
async function runCampaignToRest(run, entry, x = {}, maxUnits = 25) {
  let last = null
  for (let i = 0; i < maxUnits; i++) {
    last = await runUnitOnce(run, entry, x)
    if (!last.result || !CONTINUE.has(last.result.reason)) break
  }
  return last
}

async function pool(items, size, fn) {
  const queue = [...items]
  const workers = Array.from({ length: Math.max(1, size) }, async () => { for (let item; (item = queue.shift());) await fn(item) })
  await Promise.all(workers)
}

/** Người dùng giữa hai vòng: bấm "Tiếp tục" cho một nửa chiến dịch đang tạm dừng, đăng nhập lại một nửa tài khoản bị đăng xuất / tạm dừng. */
async function operatorActions(db, entries, round) {
  const acted = { resumed: 0, relogged: 0 }
  for (const e of entries) {
    const c = (await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [e.campaignId])).rows[0]
    if (c?.status === 'tạm dừng' && W.unitRandom(SEED, 'resume', e.campaignId, round) < 0.5) {
      await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL WHERE id = $1 AND status = 'tạm dừng'`, [e.campaignId]); acted.resumed++
    }
    const a = (await db.query(`SELECT status, login_status FROM public.auto_accounts WHERE id = $1`, [e.accountId])).rows[0]
    if ((a?.login_status !== 'đã đăng nhập' || a?.status === 'tạm dừng') && W.unitRandom(SEED, 'relogin', e.accountId, round) < 0.5) {
      await db.query(`UPDATE public.auto_accounts SET login_status = 'đã đăng nhập', status = 'chờ xử lý' WHERE id = $1`, [e.accountId]); acted.relogged++
    }
  }
  return acted
}

/** Như pg_cron sau 10 phút: lease hết hạn, đóng data dở (SYS01 / SYS02). */
async function expireAndCloseStale(db, accountIds = null) {
  await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '11 minutes', heartbeat_at = now() - interval '14 minutes'
    WHERE $1::bigint[] IS NULL OR account_id = ANY($1::bigint[])`, [accountIds])
  // close_stale chỉ đóng lượt data bắt đầu quá engine.stale_target_minutes: lùi giờ bắt đầu như thể đã qua 11 phút.
  await db.query(`UPDATE public.auto_engine_target_runs SET started_at = started_at - interval '11 minutes'
    WHERE completed_at IS NULL AND ($1::bigint[] IS NULL OR account_id = ANY($1::bigint[]))`, [accountIds])
  return (await db.query(`SELECT public.aka_agent_engine_close_stale_v1(1000) AS r`)).rows[0].r
}
/** Lease vừa hết hạn (chưa qua 10 phút): bộ chạy khác / lượt sau nhận lại được tài khoản. */
async function expireLease(db, accountId) {
  await db.query(`UPDATE public.auto_engine_leases SET expires_at = now() - interval '1 second' WHERE account_id = $1`, [accountId])
}

// ---------------------------------------------------------------------------------------------------------------------------
// 4. Kịch bản sự cố cố định
// ---------------------------------------------------------------------------------------------------------------------------

const SIMPLE_EXTRA = { enableMessage: true, enableAddFriend: true, friendRequestMessage: 'Chào bạn, kết bạn nhé', zaloMessageSendMode: 'normal',
  actionLimits: { dailyLimit: 1000, rateLimitCount: 1000, rateLimitMinutes: 65, sleepBetweenActions: 30 } }
function simpleSample(id, rt, extra = {}) {
  return { sampleId: id, actionId: 'zalo_message_phone', runtime: rt, zaloWeb: false, scheduleType: 'daily', dataTargetSourceMode: 'direct',
    content: 'Xin chào #{FULL_NAME}, bên em có ưu đãi mới', images: [], extraSettings: { ...SIMPLE_EXTRA, ...extra } }
}
const plainTargets = (sample, count) => Array.from({ length: count }, (_, i) => ({ name: `Khách ${sample.sampleId}-${i}`, phone: `0912${String(sample.sampleId).padStart(3, '0')}${String(i).padStart(3, '0')}` }))

async function faultScenarios(run, db, E) {
  const out = []
  const ok = (name, pass, detail = {}) => { out.push({ name, pass, ...detail }); console.log(`${pass ? '  PASS' : '  FAIL'} ${name}${pass ? '' : ' ' + JSON.stringify(detail).slice(0, 600)}`) }
  const statusOf = async ids => (await db.query(`SELECT id, status, note FROM public.auto_campaign_input_data WHERE id = ANY($1::bigint[]) ORDER BY id`, [ids])).rows
  const sendsOf = cid => run.log.sends.filter(s => s.campaignId === cid)
  const mk = async (id, rt, count = 6, extra = {}, campaignRow = {}) => (await createWorld(db, E, [simpleSample(id, rt, extra)],
    { base: 0, targets: s => plainTargets(s, count), targetCount: count, campaignRow }))[0]
  const quiet = { portOpts: { forceOk: true, engineChaos: { exception: 0, hang: 0, nullMsgId: 0, ownDbError: 0 }, inject: 0, chaos: 0 } }
  const closedNotes = async ids => (await statusOf(ids)).map(t => `${t.status}|${String(t.note ?? '').slice(0, 60)}`)

  // S1: DB sập giữa lượt (6 lời gọi liền lỗi) rồi sống lại: chạy tiếp, không gửi trùng, có câu "Mất kết nối…" và "đã kết nối lại".
  {
    const e = await mk(9001, 'desktop')
    let fail = 0
    const r = await runCampaignToRest(run, e, { ...quiet, scenario: 'S1', hooks: { afterSend: (ctx, part) => { if (part === 'text' && ctx.target.id === e.targetIds[2]) fail = 6 } },
      faults: { hook: async (name, when) => { if (when === 'before' && fail > 0) { fail--; throw transientDbError() } } } })
    const st = await statusOf(e.targetIds)
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const outage = run.log.lines.some(l => l.campaignId === e.campaignId && /\(DB01\)/.test(l.text))
    ok('S1 DB sập 6 lời gọi giữa lượt rồi sống lại', r.result?.reason === 'no_target' && st.every(t => t.status === 'hoàn thành') && texts.length === e.targetIds.length && outage,
      { reason: r.result?.reason, statuses: st.map(t => t.status), texts: texts.length, outage })
  }
  // S2: mất câu trả lời của report (DB đã ghi) mỗi lần thứ hai: gửi lại cùng result_key, không ghi trùng lịch sử / hạn mức.
  {
    const e = await mk(9002, 'fly')
    let n = 0
    const r = await runCampaignToRest(run, e, { ...quiet, scenario: 'S2', faults: { hook: async (name, when) => (name === 'report' && when === 'after' && ++n % 2 === 0 ? 'lose' : undefined) } })
    const dup = (await db.query(`SELECT result_key, count(*) n FROM public.auto_campaign_details d JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
      WHERE i.campaign_id = $1 AND result_key IS NOT NULL GROUP BY 1 HAVING count(*) > 1`, [e.campaignId])).rows
    const quota = (await db.query(`SELECT action_code, count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1 ORDER BY 1`, [e.accountId])).rows
    const counted = (await db.query(`SELECT action_code, count(*)::int n FROM public.auto_campaign_details WHERE campaign_id = $1 AND counts_toward_limit GROUP BY 1 ORDER BY 1`, [e.campaignId])).rows
    const quotaMatch = counted.every(c => Number(quota.find(q => q.action_code === c.action_code)?.count_action_in_day) === c.n)
    ok('S2 mất câu trả lời report: không ghi trùng lịch sử, hạn mức đúng', dup.length === 0 && quotaMatch, { reason: r.result?.reason, dup, quota, counted })
    // Lượt sau ngay lập tức, rồi sau khi lease hết hạn (như bộ lập lịch của Desktop / Fly).
    const again = await runUnitOnce(run, e, { ...quiet, scenario: 'S2b' })
    await expireLease(db, e.accountId)
    const after = await runCampaignToRest(run, e, { ...quiet, scenario: 'S2c' })
    const st = await statusOf(e.targetIds)
    const camp = (await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [e.campaignId])).rows[0]?.status
    ok('S2 mất câu trả lời của report chốt data: lượt chạy tiếp, không dừng như mất quyền', r.result?.reason === 'no_target',
      { firstReason: r.result?.reason, nextUnitImmediately: again.result?.reason, afterLeaseExpiry: after.result?.reason,
        final: st.map(t => t.status), campaignBetween: camp })
  }
  // S3: mất câu trả lời mark_sending (DB đã ghi dấu): thử lại được, gửi đúng một lần.
  {
    const e = await mk(9003, 'desktop')
    let n = 0
    const r = await runCampaignToRest(run, e, { ...quiet, scenario: 'S3', faults: { hook: async (name, when) => (name === 'markSending' && when === 'after' && ++n % 3 === 1 ? 'lose' : undefined) } })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const st = await statusOf(e.targetIds)
    ok('S3 mất câu trả lời mark_sending: gửi đúng một lần', r.result?.reason === 'no_target' && texts.length === e.targetIds.length && st.every(t => t.status === 'hoàn thành'),
      { reason: r.result?.reason, texts: texts.length, statuses: st.map(t => t.status) })
  }
  // S4: mất câu trả lời claim (DB đã nhận data): data đó ra sao?
  {
    const e = await mk(9004, 'fly')
    let n = 0
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S4', faults: { hook: async (name, when) => (name === 'claimTarget' && when === 'after' && ++n === 3 ? 'lose' : undefined) } })
    const afterUnit = await closedNotes(e.targetIds)
    const close = await expireAndCloseStale(db, [e.accountId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S4b' })
    const st = await statusOf(e.targetIds)
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const notSent = st.filter(t => !texts.some(s => s.inputDataId === Number(t.id)))
    ok('S4 mất câu trả lời claim (giữa lượt): không data nào bị đóng mà chưa gửi', notSent.length === 0,
      { firstReason: r1.result?.reason, afterUnit, closeStale: close, finalReason: r2.result?.reason, notSent: notSent.map(t => `${t.id} ${t.status} ${t.note}`) })
  }
  // S4b: mất câu trả lời của lần claim ĐẦU lượt (chưa có lease token): lượt sau gặp busy tới khi lease hết hạn; data nhận dở ra sao?
  {
    const e = await mk(9017, 'desktop', 3)
    let lost = false
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S4c', faults: { hook: async (name, when) => (name === 'claimTarget' && when === 'after' && !lost ? (lost = true, 'lose') : undefined) } })
    const again = await runUnitOnce(run, e, { ...quiet, scenario: 'S4d' })
    const mid = await closedNotes(e.targetIds)
    const close = await expireAndCloseStale(db, [e.accountId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S4e' })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const st = await statusOf(e.targetIds)
    const notSent = st.filter(t => !texts.some(s => s.inputDataId === Number(t.id)))
    ok('S4b mất câu trả lời claim đầu lượt: không data nào bị đóng mà chưa gửi', notSent.length === 0,
      { firstReason: r1.result?.reason, secondReason: again.result?.reason, mid, close, finalReason: r2.result?.reason,
        notSent: notSent.map(t => `${t.id} ${t.status} ${t.note}`) })
  }
  // S16: S4b và S7 khi engine.stale_unsent_target_action = requeue (đề xuất): data chưa có dấu "sắp gửi" về hàng đợi rồi gửi đúng một lần.
  {
    await db.query(`UPDATE public.auto_system_settings SET value = 'requeue' WHERE key = 'engine.stale_unsent_target_action'`)
    try {
      const e = await mk(9018, 'desktop', 3)
      let lost = false
      await runUnitOnce(run, e, { ...quiet, scenario: 'S16a', faults: { hook: async (name, when) => (name === 'claimTarget' && when === 'after' && !lost ? (lost = true, 'lose') : undefined) } })
      await expireAndCloseStale(db, [e.accountId])
      const ra = await runCampaignToRest(run, e, { ...quiet, scenario: 'S16b' })
      const f = await mk(9019, 'fly', 4)
      let dead = false
      const ac = new AbortController()
      await runUnitOnce(run, f, { ...quiet, scenario: 'S16c', signal: ac.signal,
        hooks: { beforeRead: ctx => { if (ctx.target.id === f.targetIds[1]) { dead = true; ac.abort(new Error('crash')); return new Promise(() => {}) } } },
        faults: { dead: () => dead } })
      dead = false
      await expireAndCloseStale(db, [f.accountId])
      const rf = await runCampaignToRest(run, f, { ...quiet, scenario: 'S16d' })
      const per = ent => ent.targetIds.map(id => sendsOf(ent.campaignId).filter(s => s.part === 'text' && s.inputDataId === id).length)
      const pe = per(e), pf = per(f)
      ok('S16 đặt requeue cho data dở chưa có dấu "sắp gửi": không cháy data, không gửi trùng', pe.every(n => n === 1) && pf.every(n => n === 1),
        { lostClaim: { final: ra.result?.reason, perTarget: pe, statuses: await closedNotes(e.targetIds) },
          crashBeforeSend: { final: rf.result?.reason, perTarget: pf, statuses: await closedNotes(f.targetIds) } })
    } finally {
      await db.query(`UPDATE public.auto_system_settings SET value = 'complete' WHERE key = 'engine.stale_unsent_target_action'`)
    }
  }
  // S5: chết tiến trình ngay sau khi gửi data 2, nhật ký bền (Desktop SQLite): lượt sau gửi bù kết quả, data 2 không bị gửi lại.
  {
    const e = await mk(9005, 'desktop')
    const journal = new E.MemoryJournal()
    let dead = false
    const ac = new AbortController()
    await runUnitOnce(run, e, { ...quiet, scenario: 'S5', journal, signal: ac.signal,
      hooks: { afterSend: (ctx, part) => { if (part === 'text' && ctx.target.id === e.targetIds[1]) { dead = true; ac.abort(new Error('app quit')) } } },
      faults: { dead: () => dead } })
    const pending = (await journal.pending()).length
    dead = false
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S5b', journal })
    const close = await expireAndCloseStale(db, [e.accountId])
    const r3 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S5c', journal })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const perTarget = e.targetIds.map(id => texts.filter(s => s.inputDataId === id).length)
    const st = await statusOf(e.targetIds)
    const t2 = (await db.query(`SELECT action_code, status, error_code FROM public.auto_campaign_details WHERE input_data_id = $1 ORDER BY id`, [e.targetIds[1]])).rows
    ok('S5 chết sau khi gửi, nhật ký bền: không gửi lại, kết quả thật được ghi', perTarget.every(n => n === 1) && st.every(t => t.status === 'hoàn thành'),
      { journalPending: pending, r2: r2.result?.reason, close, r3: r3.result?.reason, perTarget, statuses: st.map(t => `${t.status}|${t.note ?? ''}`.slice(0, 80)), target2: t2 })
  }
  // S6: chết tiến trình ngay sau khi gửi data 2, mất nhật ký (Fly RAM): data 2 đóng SYS02 (không rõ, không gửi lại), data sau chạy tiếp.
  {
    const e = await mk(9006, 'fly')
    let dead = false
    const ac = new AbortController()
    await runUnitOnce(run, e, { ...quiet, scenario: 'S6', signal: ac.signal,
      hooks: { afterSend: (ctx, part) => { if (part === 'text' && ctx.target.id === e.targetIds[1]) { dead = true; ac.abort(new Error('worker restart')) } } },
      faults: { dead: () => dead } })
    dead = false
    const close = await expireAndCloseStale(db, [e.accountId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S6b' })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const perTarget = e.targetIds.map(id => texts.filter(s => s.inputDataId === id).length)
    const t2 = (await statusOf([e.targetIds[1]]))[0]
    const outcome2 = (await db.query(`SELECT error_code, delivery_state FROM public.auto_engine_outcomes WHERE input_data_id = $1 ORDER BY created_at`, [e.targetIds[1]])).rows
    const run2 = (await db.query(`SELECT final_target_status, final_error_code, close_reason FROM public.auto_engine_target_runs WHERE input_data_id = $1 ORDER BY id`, [e.targetIds[1]])).rows
    ok('S6 chết sau khi gửi, mất nhật ký: đóng SYS02, không gửi lại, data sau chạy tiếp',
      perTarget.every(n => n === 1) && t2.status === 'hoàn thành' && r2.result?.reason === 'no_target',
      { close, r2: r2.result?.reason, perTarget, target2: t2, outcome2, run2 })
  }
  // S6b: chết tiến trình sau khi ghi dấu "sắp gửi", trước khi gọi Zalo: không biết đã gửi chưa → SYS02, không gửi lại (đúng thiết kế).
  {
    const e = await mk(9020, 'fly', 3)
    let dead = false
    const ac = new AbortController()
    await runUnitOnce(run, e, { ...quiet, scenario: 'S6b', signal: ac.signal,
      hooks: { beforeSend: (ctx, part) => { if (part === 'text' && ctx.target.id === e.targetIds[1]) { dead = true; ac.abort(new Error('crash')); return new Promise(() => {}) } } },
      faults: { dead: () => dead } })
    dead = false
    await expireAndCloseStale(db, [e.accountId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S6c' })
    const st = await closedNotes(e.targetIds)
    const sent2 = sendsOf(e.campaignId).filter(s => s.part === 'text' && s.inputDataId === e.targetIds[1]).length
    ok('S6b chết sau dấu "sắp gửi", trước khi gọi Zalo: đóng SYS02, không gửi lại', sent2 === 0 && /^hoàn thành\|Bị ngắt khi đang gửi/.test(st[1]) && r2.result?.reason === 'no_target',
      { r2: r2.result?.reason, statuses: st, sent2 })
  }
  // S7: chết tiến trình sau khi nhận data, trước khi gửi (chưa có dấu "sắp gửi"): theo engine.stale_unsent_target_action.
  {
    const e = await mk(9007, 'fly')
    let dead = false
    const ac = new AbortController()
    await runUnitOnce(run, e, { ...quiet, scenario: 'S7', signal: ac.signal,
      hooks: { beforeRead: ctx => { if (ctx.target.id === e.targetIds[1]) { dead = true; ac.abort(new Error('crash')); return new Promise(() => {}) } } },
      faults: { dead: () => dead } })
    dead = false
    const before = await closedNotes([e.targetIds[1]])
    const close = await expireAndCloseStale(db, [e.accountId])
    const after = await closedNotes([e.targetIds[1]])
    const setting = (await db.query(`SELECT value FROM public.auto_system_settings WHERE key = 'engine.stale_unsent_target_action'`)).rows[0]?.value
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S7b' })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    ok('S7 chết trước khi gửi: data dở xử lý theo thiết lập, không gửi trùng',
      e.targetIds.every(id => texts.filter(s => s.inputDataId === id).length <= 1) && r2.result?.reason === 'no_target',
      { setting, before, after, close, r2: r2.result?.reason, sentTarget2: texts.filter(s => s.inputDataId === e.targetIds[1]).length })
  }
  // S8: mất lease giữa lượt (hết hạn, bộ chạy khác chiếm): bộ chạy cũ dừng, không gửi gì sau khi mất quyền.
  {
    const e = await mk(9008, 'fly')
    let stolen = false
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S8', hooks: { afterSend: async (ctx, part) => {
      if (part === 'friend' && ctx.target.id === e.targetIds[1] && !stolen) {
        stolen = true
        // Lease hết hạn rồi máy khác nhận tài khoản (token mới).
        await db.query(`UPDATE public.auto_engine_leases SET lease_token = gen_random_uuid(), runner_id = 'fly:other-worker', acquired_at = now(),
          heartbeat_at = now(), expires_at = now() + interval '3 minutes' WHERE account_id = $1`, [e.accountId])
        run.log.events.push({ type: 'S8_other_claim', campaignId: e.campaignId })
      }
    } } })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text' || s.part === 'friend')
    const afterLoss = texts.filter(s => s.inputDataId !== e.targetIds[0] && s.inputDataId !== e.targetIds[1])
    const mid = await closedNotes(e.targetIds)
    await expireAndCloseStale(db, [e.accountId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S8b' })
    const st = await closedNotes(e.targetIds)
    const perTarget = e.targetIds.map(id => sendsOf(e.campaignId).filter(s => s.part === 'text' && s.inputDataId === id).length)
    ok('S8 mất lease giữa lượt: dừng, không gửi sau khi mất quyền', ['ownership_lost', 'report_rejected'].includes(r1.result?.reason) && afterLoss.length === 0
      && perTarget.every(n => n <= 1), { reason: r1.result?.reason, afterLoss: afterLoss.length, mid, r2: r2.result?.reason, final: st, perTarget })
  }
  // S9: hai bộ chạy cùng lúc trên một tài khoản (Desktop mở hai cửa sổ / hai worker): một bên busy, không gửi trùng.
  {
    const e = await mk(9009, 'desktop', 10)
    const [a, b] = await Promise.all([
      runCampaignToRest(run, e, { ...quiet, scenario: 'S9a', runnerId: 'desktop:A' }),
      runCampaignToRest({ ...run, client: run.otherClient }, e, { ...quiet, scenario: 'S9b', runnerId: 'desktop:B' })
    ])
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const perTarget = e.targetIds.map(id => texts.filter(s => s.inputDataId === id).length)
    ok('S9 hai bộ chạy cùng tài khoản: không gửi trùng', perTarget.every(n => n <= 1), { a: a.result?.reason, b: b.result?.reason, perTarget })
  }
  // S10: tạm dừng chiến dịch giữa lượt (Web/iOS): dừng sau data đang xử lý; data còn lại chờ; bấm Tiếp tục thì chạy tiếp.
  {
    const e = await mk(9010, 'fly', 6)
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S10', heartbeatRealMs: 300, hooks: { beforeSend: async (ctx, part) => {
      if (part === 'text' && ctx.target.id === e.targetIds[1]) {
        await db.query(`UPDATE public.auto_campaigns SET status = 'tạm dừng' WHERE id = $1`, [e.campaignId])
        await new Promise(res => setTimeout(res, 900))
      }
    } } })
    const mid = await closedNotes(e.targetIds)
    await db.query(`UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL WHERE id = $1`, [e.campaignId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S10b' })
    const st = await statusOf(e.targetIds)
    const paused = run.log.lines.some(l => l.campaignId === e.campaignId && /tạm dừng/i.test(l.text))
    ok('S10 tạm dừng giữa lượt: dừng sau data đang xử lý, Tiếp tục thì chạy hết', r1.result?.reason === 'campaign_paused'
      && mid.filter(s => s.startsWith('hoàn thành')).length <= 3 && st.every(t => t.status === 'hoàn thành') && paused,
      { r1: r1.result?.reason, mid, r2: r2.result?.reason, final: st.map(t => t.status), pausedLine: paused })
  }
  // S11: đăng xuất tài khoản giữa lượt: dừng sau data đang xử lý, câu dừng như Desktop.
  {
    const e = await mk(9011, 'desktop', 5)
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S11', heartbeatRealMs: 300, hooks: { beforeSend: async (ctx, part) => {
      if (part === 'text' && ctx.target.id === e.targetIds[1]) {
        await db.query(`UPDATE public.auto_accounts SET login_status = 'chưa đăng nhập' WHERE id = $1`, [e.accountId])
        await new Promise(res => setTimeout(res, 900))
      }
    } } })
    const mid = await closedNotes(e.targetIds)
    ok('S11 đăng xuất giữa lượt: dừng, data chưa chạy vẫn chờ', r1.result?.reason === 'stop_account' && mid.some(s => s.startsWith('chờ xử lý')),
      { r1: r1.result?.reason, mid })
    await db.query(`UPDATE public.auto_accounts SET login_status = 'đã đăng nhập' WHERE id = $1`, [e.accountId])
    await runCampaignToRest(run, e, { ...quiet, scenario: 'S11b' })
  }
  // S12: thoát app khi đang gửi (lệnh gửi treo, huỷ giữa chừng): không gửi lại data đó.
  {
    const e = await mk(9012, 'desktop', 4)
    const ac = new AbortController()
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S12', signal: ac.signal, hooks: { beforeSend: async (ctx, part) => {
      if (part === 'text' && ctx.target.id === e.targetIds[1]) {
        run.log.sends.push({ campaignId: e.campaignId, inputDataId: Number(ctx.target.id), targetRunId: ctx.targetRunId, part: 'text', ok: null, possiblyDelivered: true, at: Date.now(), note: 'hang' })
        setTimeout(() => ac.abort(new Error('app quit')), 200)
        await new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      }
    } } })
    const mid = await closedNotes(e.targetIds)
    await expireAndCloseStale(db, [e.accountId])
    const r2 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S12b' })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text')
    const perTarget = e.targetIds.map(id => texts.filter(s => s.inputDataId === id).length)
    ok('S12 thoát app khi đang gửi: data đang gửi không bị gửi lại', perTarget.every(n => n === 1), { r1: r1.result?.reason, mid, r2: r2.result?.reason, perTarget,
      final: await closedNotes(e.targetIds) })
  }
  // S13: hết lượt trong ngày (dailyLimit 3): gửi đúng 3 rồi chờ, không vượt.
  {
    const e = await mk(9013, 'fly', 7, { actionLimits: { dailyLimit: 3, rateLimitCount: 100, rateLimitMinutes: 65, sleepBetweenActions: 30 } })
    const r1 = await runCampaignToRest(run, e, { ...quiet, scenario: 'S13' })
    const texts = sendsOf(e.campaignId).filter(s => s.part === 'text' && s.ok)
    const quota = (await db.query(`SELECT action_code, count_action_in_day FROM public.auto_account_action_status WHERE account_id = $1 ORDER BY 1`, [e.accountId])).rows
    ok('S13 hết lượt trong ngày: không vượt hạn mức', texts.length === 3 && r1.result?.reason === 'wait', { reason: r1.result?.reason, texts: texts.length, quota,
      note: (await db.query(`SELECT note FROM public.auto_campaigns WHERE id = $1`, [e.campaignId])).rows[0]?.note })
  }
  // S14: qua giờ dừng trong ngày: không nhận data.
  {
    const now = new Date(Date.now() - 2 * 60000).toLocaleTimeString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour12: false })
    const e = await mk(9014, 'desktop', 3, {}, { daily_stop_time: now })
    const r1 = await runUnitOnce(run, e, { ...quiet, scenario: 'S14' })
    const sent = sendsOf(e.campaignId).length
    ok('S14 qua giờ dừng: không nhận data, không gửi', r1.result?.reason === 'daily_boundary' && sent === 0, { reason: r1.result?.reason, sent, stop: now })
  }
  // S15: chống gửi lặp 3 ngày, hai chiến dịch cùng nhân viên cùng SĐT: chiến dịch sau không gửi lại số đã gửi.
  {
    const ex = { recentDeliveryCooldownEnabled: true, recentDeliveryCooldownDays: 3, recentDeliveryCooldownAllAccounts: true }
    const a = await mk(9015, 'fly', 4, ex)
    await runCampaignToRest(run, a, { ...quiet, scenario: 'S15a' })
    const sample = simpleSample(9016, 'fly', ex)
    const b = (await createWorld(db, E, [sample], { targets: () => plainTargets({ sampleId: 9015 }, 4), targetCount: 4 }))[0]
    await db.query(`UPDATE public.auto_accounts SET staff_id = $1 WHERE id = $2`, [a.staffId, b.accountId])
    await db.query(`UPDATE public.auto_campaigns SET staff_id = $1 WHERE id = $2`, [a.staffId, b.campaignId])
    b.staffId = a.staffId
    const rb = await runCampaignToRest(run, b, { ...quiet, scenario: 'S15b' })
    const sentB = sendsOf(b.campaignId).filter(s => s.part === 'text').length
    ok('S15 chống gửi lặp: chiến dịch thứ hai không gửi lại số đã gửi', sentB === 0, { reason: rb.result?.reason, sentB, statusesB: await closedNotes(b.targetIds) })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------------------
// 5. Bất biến
// ---------------------------------------------------------------------------------------------------------------------------

async function invariants(db, log, scope) {
  const v = []
  const fail = (code, title, rows) => { if (rows.length) v.push({ code, title, count: rows.length, sample: rows.slice(0, 8) }) }
  const q = async (sql, params = []) => (await db.query(sql, params)).rows
  const campaigns = scope.campaignIds

  // I1 không gửi trùng: sau một lần "có thể đã tới" thì không có lần gửi nào nữa cho cùng data + phần.
  {
    const byKey = new Map()
    const uidMap = new Map((await q(`SELECT id, campaign_id, uid FROM public.auto_campaign_input_data WHERE campaign_id = ANY($1::bigint[])`, [campaigns]))
      .map(r => [`${r.campaign_id}|${String(r.uid ?? '').replace(/^g/, '')}`, Number(r.id)]))
    const IDEMPOTENT = new Set(['undo', 'join', 'label', 'alias'])
    const idem = []
    for (const s of log.sends) {
      if (IDEMPOTENT.has(s.part)) { idem.push(s); continue }
      const inputDataId = s.inputDataId || uidMap.get(`${s.campaignId}|${String(s.threadId ?? '').replace(/^g/, '')}`) || null
      const part = s.part === 'forward' ? 'text' : s.part
      const key = `${s.campaignId}|${inputDataId}|${part}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push({ ...s, inputDataId })
    }
    const dups = []
    const sameBatch = []
    for (const [key, list] of byKey) {
      const i = list.findIndex(s => s.possiblyDelivered)
      if (i < 0) continue
      const later = list.slice(i + 1)
      const fmt = s => `${s.targetRunId}#${s.callId}:${s.ok === true ? 'ok' : s.ok === false ? 'err:' + s.error : '?'}:${s.phase ?? ''}`
      if (later.some(s => s.callId !== list[i].callId)) dups.push({ key, calls: list.map(fmt) })
      else if (later.length) sameBatch.push({ key, calls: list.map(fmt) })
    }
    // Chi tiết DB của từng ca gửi trùng (lượt data, kết quả, lịch sử) để điều tra.
    for (const d of dups.slice(0, 6)) {
      const id = Number(d.key.split('|')[1])
      d.runs = (await q(`SELECT id, started_at, completed_at, close_reason, final_target_status, final_error_code, marks FROM public.auto_engine_target_runs
        WHERE input_data_id = $1 ORDER BY id`, [id])).map(r => `${r.id}:${r.close_reason}:${r.final_target_status}:${r.final_error_code ?? '-'}:${JSON.stringify(r.marks).slice(0, 160)}`)
      d.outcomes = (await q(`SELECT target_run_id, action_code, phase, ok, error_code, delivery_state FROM public.auto_engine_outcomes
        WHERE input_data_id = $1 ORDER BY created_at`, [id])).map(o => `${o.target_run_id}:${o.action_code}:${o.phase}:${o.ok}:${o.error_code ?? '-'}:${o.delivery_state}`)
      d.target = (await q(`SELECT status, note FROM public.auto_campaign_input_data WHERE id = $1`, [id]))[0]
    }
    fail('I1', 'Gửi lại cho data đã có thể nhận (gửi trùng)', dups)
    fail('I1b', 'Cùng một người nhận / nhóm hai lần trong một lệnh chia sẻ (data trùng trong chiến dịch)', sameBatch)
  }
  // I2 không còn data "đang chạy" / lượt data mở sau khi dọn.
  fail('I2', 'Data còn "đang chạy" sau khi dọn', await q(`SELECT id, campaign_id, note FROM public.auto_campaign_input_data
    WHERE campaign_id = ANY($1::bigint[]) AND status = 'đang chạy'`, [campaigns]))
  fail('I2b', 'Lượt data chưa đóng sau khi dọn', await q(`SELECT id, input_data_id, close_reason FROM public.auto_engine_target_runs
    WHERE campaign_id = ANY($1::bigint[]) AND completed_at IS NULL`, [campaigns]))
  // I3 không còn lease.
  fail('I3', 'Lease còn sau khi dọn', await q(`SELECT account_id, runner_id, expires_at FROM public.auto_engine_leases`))
  // I4 dòng lịch sử: trạng thái hợp lệ, câu không lộ mã nội bộ / chỗ trống.
  fail('I4', 'Dòng lịch sử có trạng thái sai', await q(`SELECT d.id, d.action_code, d.status, d.status_id FROM public.auto_campaign_details d
    LEFT JOIN public.auto_status s ON s.id = d.status_id WHERE d.campaign_id = ANY($1::bigint[]) AND (s.id IS NULL OR s.component_type <> 'campaign_detail'
    OR s.status_value IS DISTINCT FROM d.status)`, [campaigns]))
  fail('I4b', 'Câu lịch sử lộ mã nội bộ / chỗ trống mẫu', await q(`SELECT d.id, d.action_code, d.status, left(d.log, 160) AS log FROM public.auto_campaign_details d
    WHERE d.campaign_id = ANY($1::bigint[]) AND (coalesce(btrim(d.log), '') = '' OR d.log ~ '(\\[[ax]\\]|\\{(name|code|until|action|message)\\}|undefined|\\[object Object\\]|\\berr_[a-z_]+|\\bnull\\b)')`,
    [campaigns]))
  fail('I4c', 'Mã lỗi trong lịch sử không có trong danh mục', await q(`SELECT d.id, d.error_code FROM public.auto_campaign_details d
    LEFT JOIN public.auto_error e ON e.error_code = d.error_code WHERE d.campaign_id = ANY($1::bigint[]) AND d.error_code IS NOT NULL AND e.error_code IS NULL`, [campaigns]))
  // I5 quyết định: lỗi phải có mã nội bộ + mã công khai.
  fail('I5', 'Kết quả lỗi không có mã công khai', await q(`SELECT o.result_key, o.action_code, o.error_code, o.decision->'result'->>'publicCode' AS pc
    FROM public.auto_engine_outcomes o LEFT JOIN public.auto_error e ON e.error_code = o.error_code
    WHERE o.campaign_id = ANY($1::bigint[]) AND NOT o.ok AND (o.error_code IS NULL OR e.public_code IS NULL)`, [campaigns]))
  // I6 tín hiệu chưa có luật.
  const unmatched = await q(`SELECT platform, action_code, phase, signal_kind, pattern_key, fallback_error_code, hit_count FROM public.auto_outcome_unmatched ORDER BY hit_count DESC`)
  // I7 data đã có thể nhận mà về hàng đợi / tạm dừng.
  fail('I7', 'Data đã gửi được / không rõ mà còn chờ chạy lại', await q(`SELECT i.id, i.status, i.note, array_agg(DISTINCT o.action_code || ':' || o.delivery_state) AS d
    FROM public.auto_campaign_input_data i JOIN public.auto_engine_outcomes o ON o.input_data_id = i.id
    WHERE i.campaign_id = ANY($1::bigint[]) AND i.status = 'chờ xử lý' AND o.delivery_state IN ('delivered', 'partial', 'unknown')
    GROUP BY i.id, i.status, i.note`, [campaigns]))
  // I8 trạng thái chiến dịch / tài khoản hợp lệ, không ai kẹt "đang chạy".
  fail('I8', 'Chiến dịch / tài khoản kẹt "đang chạy" hoặc trạng thái lạ', await q(`SELECT 'campaign' k, id, status, note FROM public.auto_campaigns
    WHERE id = ANY($1::bigint[]) AND (status = 'đang chạy' OR status NOT IN ('chờ xử lý', 'tạm dừng', 'hoàn thành'))
    UNION ALL SELECT 'account', a.id, a.status, a.login_status FROM public.auto_accounts a JOIN public.auto_campaigns c ON c.account_id = a.id
    WHERE c.id = ANY($1::bigint[]) AND a.status = 'đang chạy'`, [campaigns]))
  // I9 runUnit không ném, lý do kết thúc đã biết, không lỗi hợp đồng.
  fail('I9', 'runUnit ném ngoại lệ / lý do lạ', log.units.filter(u => u.thrown || !KNOWN_REASONS.has(u.reason)))
  fail('I9b', 'Lượt kết thúc vì lỗi (error / report_rejected)', log.units.filter(u => u.reason === 'error' || u.reason === 'report_rejected'))
  // I10 hạn mức ngày: số đã dùng không vượt giới hạn hiệu lực.
  fail('I10', 'Vượt hạn mức trong ngày', await q(`SELECT s.account_id, s.action_code, s.count_action_in_day, (l.v->>'daily')::numeric AS daily
    FROM public.auto_account_action_status s JOIN public.auto_campaigns c ON c.account_id = s.account_id AND c.id = ANY($1::bigint[])
    CROSS JOIN LATERAL (SELECT public.aka_agent_engine_action_limit(c.id, s.account_id, s.action_code) AS v) l
    WHERE s.count_date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AND s.count_action_in_day > (l.v->>'daily')::numeric`, [campaigns]))
  fail('I10b', 'Vượt hạn mức khung giờ', await q(`WITH c AS (SELECT DISTINCT ON (account_id) id, account_id FROM public.auto_campaigns WHERE id = ANY($1::bigint[]))
    SELECT d.account_id, d.action_code, count(*) n, (l.v->>'windowCount')::numeric AS window_count
    FROM public.auto_campaign_details d JOIN c ON c.account_id = d.account_id
    CROSS JOIN LATERAL (SELECT public.aka_agent_engine_action_limit(c.id, d.account_id, d.action_code) AS v) l
    WHERE d.counts_toward_limit AND d.created_at > now() - make_interval(mins => (l.v->>'windowMinutes')::int)
      AND d.action_code NOT IN ('zalo_find_phone_user', 'zalo_cancel_sent_friend_request')
    GROUP BY d.account_id, d.action_code, l.v HAVING count(*) > (l.v->>'windowCount')::numeric`, [campaigns]))
  // I11 dòng tiến trình: mã ở cuối câu có trong danh mục, không lộ chữ kỹ thuật.
  const publicCodes = new Set((await q(`SELECT DISTINCT public_code FROM public.auto_error WHERE public_code IS NOT NULL`)).map(r => r.public_code))
  fail('I11', 'Tiến trình có mã không có trong danh mục', log.lines.filter(l => scope.campaignSet.has(l.campaignId) && l.code && !publicCodes.has(l.code))
    .map(l => ({ campaignId: l.campaignId, code: l.code, text: l.text.slice(0, 140) })))
  fail('I11b', 'Tiến trình lộ chữ kỹ thuật', log.lines.filter(l => scope.campaignSet.has(l.campaignId)
    && /undefined|\[object Object\]|\berr_[a-z_]+|\bnull\b|TypeError|stack|\{(?:name|code|until|action|message)\}|\[[ax]\]/.test(l.text))
    .map(l => ({ campaignId: l.campaignId, text: l.text.slice(0, 160) })))
  // I12 tương tác: chỉ đăng ký cho dòng lịch sử thành công của nhắn tin / kết bạn.
  const reg = log.events.filter(e => e.type === 'engagement_register' && scope.campaignSet.has(e.campaignId))
  const regRows = reg.length ? await q(`SELECT id, action_code, status FROM public.auto_campaign_details WHERE id = ANY($1::bigint[])`, [reg.map(e => e.detailId)]) : []
  fail('I12', 'Đăng ký tương tác cho dòng không phải gửi thành công', reg.filter(e => {
    const row = regRows.find(r => Number(r.id) === Number(e.detailId))
    return !row || row.status !== 'thành công' || !['zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend'].includes(row.action_code)
  }))
  // I13 lỗi ghi DB của mình không đổi kết quả tra số (F1).
  const ownErr = log.events.filter(e => e.type === 'own_db_error' && e.what === 'lưu danh bạ' && scope.campaignSet.has(e.campaignId))
  const f1 = ownErr.length ? await q(`SELECT input_data_id, status FROM public.auto_campaign_details WHERE action_code = 'zalo_find_phone_user'
    AND input_data_id = ANY($1::bigint[]) AND status <> 'thành công'`, [ownErr.map(e => e.inputDataId)]) : []
  fail('I13', 'Lỗi ghi danh bạ làm tra số thất bại', f1)
  // I14 tên gợi nhớ quá 50 ký tự / nội dung rỗng / mẫu chưa thay mà vẫn gửi.
  fail('I14', 'Gửi nội dung lỗi (tên gợi nhớ > 50, chữ rỗng, mẫu chưa thay)', log.events.filter(e => scope.campaignSet.has(e.campaignId)
    && ['alias_too_long', 'empty_text_sent', 'unrendered_template_sent', 'friend_message_too_long', 'media_without_files'].includes(e.type)))
  // I15 data gửi thành công mà còn ghi chú lỗi của lần trước (về hàng đợi rồi chạy lại được).
  fail('I15', 'Data hoàn thành thành công nhưng còn ghi chú lỗi cũ', await q(`SELECT i.id, i.status, left(i.note, 100) AS note FROM public.auto_campaign_input_data i
    WHERE i.campaign_id = ANY($1::bigint[]) AND i.status = 'hoàn thành' AND i.note IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = i.id AND tr.close_reason = 'reported' AND tr.final_error_code IS NULL
                   AND tr.id = (SELECT max(x.id) FROM public.auto_engine_target_runs x WHERE x.input_data_id = i.id))`, [campaigns]))
  return { violations: v, unmatched }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Báo cáo
// ---------------------------------------------------------------------------------------------------------------------------

async function coverage(db, campaigns) {
  const q = async (sql, params = []) => (await db.query(sql, params)).rows
  return {
    outcomes: await q(`SELECT c.action_id AS campaign_type, o.action_code, CASE WHEN a.is_zalo_server THEN 'fly' ELSE 'desktop' END AS rt, o.phase,
      coalesce(o.error_code, 'ok') AS error_code, e.public_code, o.delivery_state,
      -- Từ V517 decision chỉ còn result + contrib (contrib.targetEffect rỗng khi thành công); trước V517 đọc chính sách đã gộp.
      coalesce(o.decision->'contrib'->>'targetEffect', o.decision->'policy'->>'target_effect') AS target_effect,
      coalesce(o.decision->'contrib'->>'campaignEffect', o.decision->'policy'->>'campaign_effect') AS campaign_effect,
      coalesce(o.decision->'contrib'->>'runEffect', o.decision->'policy'->>'run_effect') AS run_effect, count(*)::int AS n
      FROM public.auto_engine_outcomes o JOIN public.auto_campaigns c ON c.id = o.campaign_id JOIN public.auto_accounts a ON a.id = o.account_id
      LEFT JOIN public.auto_error e ON e.error_code = o.error_code WHERE o.campaign_id = ANY($1::bigint[])
      GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ORDER BY n DESC`, [campaigns]),
    targetStates: await q(`SELECT c.action_id, i.status, count(*)::int n FROM public.auto_campaign_input_data i JOIN public.auto_campaigns c ON c.id = i.campaign_id
      WHERE c.id = ANY($1::bigint[]) AND NOT coalesce(i.is_delete, false) GROUP BY 1, 2 ORDER BY 1, 2`, [campaigns]),
    campaignStates: await q(`SELECT action_id, status, left(coalesce(note, ''), 90) AS note, count(*)::int n FROM public.auto_campaigns WHERE id = ANY($1::bigint[])
      GROUP BY 1, 2, 3 ORDER BY n DESC`, [campaigns]),
    closeReasons: await q(`SELECT close_reason, final_target_status, final_error_code, count(*)::int n FROM public.auto_engine_target_runs
      WHERE campaign_id = ANY($1::bigint[]) GROUP BY 1, 2, 3 ORDER BY n DESC`, [campaigns])
  }
}

async function main() {
  const startedAt = new Date()
  const E = await loadEngine()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-engine-scen-', timeoutMs: 4 * 3600 * 1000 })
  const db = await connect()
  const clients = []
  const report = { startedAt: startedAt.toISOString(), seed: SEED, options: { TARGETS, ROUNDS, CHAOS, INJECT, DBCHAOS, CONCURRENCY }, notes: [] }
  const log = { sends: [], events: [], lines: [], traces: [], units: [], db: [] }
  try {
    await bootstrap(db, report.notes)
    for (let i = 0; i < CONCURRENCY + 1; i++) clients.push(await connect())
    console.log('== 1. Lệch danh mục DB thử so với production')
    report.drift = await catalogDrift(db)
    for (const [k, d] of Object.entries(report.drift)) if (d && d.prod !== undefined) {
      console.log(`  ${k}: production ${d.prod}, thử ${d.local}; chỉ production ${d.onlyProd.length}, chỉ thử ${d.onlyLocal.length}, khác ${d.changed.length}`)
    }
    console.log('== 2. Từng luật đang bật')
    report.conformance = await conformance(db)
    console.log(`  ${report.conformance.ok}/${report.conformance.checked} khớp; bị luật khác che: ${report.conformance.shadowed.length}; thiếu mã công khai: ${report.conformance.noPublicCode.length}; chính sách sai: ${report.conformance.invalidPolicy.length}`)

    const run = { E, client: clients[0], otherClient: clients[CONCURRENCY], log }
    const allCampaigns = []
    if (!flag('--skip-general')) {
      console.log('== 3. Chạy cấu hình mẫu')
      const samples = profile.campaigns.filter(c => !ONLY || ONLY.has(c.sampleId))
      const entries = await createWorld(db, E, samples)
      allCampaigns.push(...entries.map(e => e.campaignId))
      report.general = { campaigns: entries.length, rounds: [] }
      for (let round = 1; round <= ROUNDS; round++) {
        const t0 = Date.now()
        let idx = 0
        await pool(entries, CONCURRENCY, async entry => {
          const client = clients[(idx++) % CONCURRENCY]
          await runCampaignToRest({ ...run, client }, entry, { scenario: `round${round}`,
            faults: { report: { before: DBCHAOS, after: DBCHAOS }, markSending: { before: DBCHAOS, after: DBCHAOS }, heartbeat: { before: DBCHAOS },
              release: { before: DBCHAOS / 2, after: DBCHAOS / 2 }, reportBatch: { before: DBCHAOS, after: DBCHAOS }, claimTarget: { before: DBCHAOS },
              claimBatch: { before: DBCHAOS }, tag: `r${round}` } })
        })
        const acted = await operatorActions(db, entries, round)
        // Thời gian trôi qua giữa hai vòng (như bộ lập lịch quay lại sau khung giờ): lịch sử ra khỏi khung hạn mức giờ, khoá theo phút hết hạn.
        await db.query(`UPDATE public.auto_campaign_details SET created_at = created_at - interval '70 minutes' WHERE campaign_id = ANY($1::bigint[])`,
          [entries.map(e => e.campaignId)])
        await db.query(`UPDATE public.auto_engine_target_runs SET marks = (SELECT coalesce(jsonb_agg(m.value || jsonb_build_object('markedAt',
          ((m.value->>'markedAt')::timestamptz - interval '70 minutes')::text)), '[]'::jsonb) FROM jsonb_array_elements(marks) m)
          WHERE campaign_id = ANY($1::bigint[]) AND completed_at IS NULL`, [entries.map(e => e.campaignId)])
        acted.unlocked = (await db.query(`SELECT public.aka_agent_scenario_time_passes($1::bigint[]) AS n`, [entries.map(e => e.accountId)])).rows[0].n
        const reasons = {}
        for (const u of log.units.filter(u => u.scenario === `round${round}`)) reasons[u.reason] = (reasons[u.reason] || 0) + 1
        report.general.rounds.push({ round, ms: Date.now() - t0, reasons, operator: acted })
        console.log(`  vòng ${round}: ${Math.round((Date.now() - t0) / 1000)} giây; kết thúc lượt ${JSON.stringify(reasons)}; người dùng ${JSON.stringify(acted)}`)
      }
    }
    if (!flag('--skip-faults')) {
      console.log('== 4. Kịch bản sự cố')
      const before = new Set(allCampaigns)
      report.faults = await faultScenarios(run, db, E)
      const scen = (await db.query(`SELECT id FROM public.auto_campaigns WHERE id >= 993000 + 9000`)).rows.map(r => Number(r.id))
      for (const id of scen) if (!before.has(id)) allCampaigns.push(id)
    }
    console.log('== 5. Dọn và kiểm bất biến')
    report.finalCloseStale = await expireAndCloseStale(db)
    const scope = { campaignIds: allCampaigns, campaignSet: new Set(allCampaigns) }
    const inv = await invariants(db, log, scope)
    report.invariants = inv.violations
    report.unmatched = inv.unmatched
    report.coverage = await coverage(db, allCampaigns)
    report.units = { total: log.units.length, byReason: log.units.reduce((m, u) => (m[u.reason] = (m[u.reason] || 0) + 1, m), {}) }
    report.unitDetails = log.units
    report.sends = { total: log.sends.length, byPart: log.sends.reduce((m, s) => (m[s.part] = (m[s.part] || 0) + 1, m), {}) }
    report.dbFaults = log.db.reduce((m, f) => (m[`${f.name}:${f.when}`] = (m[`${f.name}:${f.when}`] || 0) + 1, m), {})
    report.traces = log.traces.reduce((m, t) => (m[t.type] = (m[t.type] || 0) + 1, m), {})
    report.traceSamples = log.traces.slice(0, 40)
    report.events = log.events.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {})
    report.lineSamples = sampleLines(log.lines)
    console.log(`  phủ: ${report.coverage.outcomes.length} tổ hợp (loại chiến dịch, thao tác, nơi chạy, pha, mã, hiệu ứng); ${report.coverage.outcomes.reduce((n, o) => n + o.n, 0)} kết quả`)
    for (const c of report.coverage.campaignStates.slice(0, 14)) console.log(`    chiến dịch ${c.n} ${c.action_id} ${c.status}: ${c.note}`)
    for (const x of inv.violations) {
      const known = KNOWN_INVARIANTS[x.code]
      console.log(`  ${known ? '- đã biết' : '✗'} ${x.code} ${x.title}: ${x.count}${known ? ` (${known})` : ''}\n      ${JSON.stringify(x.sample.slice(0, 3)).slice(0, 700)}`)
    }
    if (!inv.violations.length) console.log('  ✓ không vi phạm bất biến nào')
    console.log(`  tín hiệu chưa có luật: ${inv.unmatched.length} mẫu`)
    for (const u of inv.unmatched.slice(0, 12)) console.log(`    ${u.hit_count} ${u.platform}/${u.action_code}/${u.phase} ${u.signal_kind} "${u.pattern_key}" → ${u.fallback_error_code}`)
  } finally {
    for (const c of clients) await c.end().catch(() => {})
    await db.end().catch(() => {})
    stop()
  }
  report.finishedAt = new Date().toISOString()
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1))
  const failedFaults = (report.faults || []).filter(f => !f.pass).length
  const newViolations = (report.invariants || []).filter(x => !KNOWN_INVARIANTS[x.code]).length
  const knownViolations = (report.invariants || []).length - newViolations
  console.log(`\nXong: ${report.units.total} lượt, ${report.sends.total} lần gửi; vi phạm mới ${newViolations}, đã biết ${knownViolations}; kịch bản sự cố lỗi ${failedFaults}`)
  process.exitCode = newViolations || failedFaults ? 1 : 0
}

/** Các dạng câu tiến trình khác nhau (tên, số, giờ thay bằng ký hiệu) kèm số lần, để soát câu chữ cho khách. */
function sampleLines(lines) {
  const shape = text => text.replace(/"[^"]*"/g, '"…"').replace(/\b0\d{8,10}\b/g, '<sđt>').replace(/\d{1,2}:\d{2}( \d{1,2}\/\d{1,2})?/g, '<giờ>')
    .replace(/\b\d+\b/g, '#').replace(/(Đã tìm thấy SĐT [^:]+: ).*/, '$1<tên>').replace(/(cho ).*( vào group)/, '$1<tên>$2')
    .replace(/^(Thêm thành viên vào group: ).*( đã là thành viên)/, '$1<tên>$2').replace(/(đến ).*( qua link)/, '$1<tên>$2')
  const by = new Map()
  for (const l of lines) {
    const key = `${l.level}|${shape(l.text)}`
    const cur = by.get(key) || { level: l.level, code: l.code, shape: shape(l.text), n: 0, example: `[${l.rt}] ${l.text}`.slice(0, 220) }
    cur.n++
    by.set(key, cur)
  }
  return [...by.values()].sort((a, b) => b.n - a.n)
}

main().catch(error => { console.error(error); process.exit(1) })
