// Bộ kiểm ngẫu nhiên Cách A (anh chốt 26/11/2026: chiến dịch "Nhắn tin bạn bè" gửi cho mọi người được gắn tag, kể cả người chưa là bạn
// bè; V669 xử lý Zalo hạn chế nhắn người lạ 120 / 802). Bộ chạy engine v2 THẬT của Desktop (src/main/engineAdapters) trên PG cục bộ
// (V495 → V499 → V500 → V501 → V669), danh mục chính sách / luật / mã lỗi lấy từ bản sao production (engine-catalog-*.json), Zalo giả
// theo kết quả ngẫu nhiên, data sai lệch cố ý. Không chạm DB thật, không gọi Zalo.
//
//   CHAT_REPO=<akaAgentChatApi> node scripts/zalo-tag-sync/cach-a-engine-fuzz.cjs --seed 1 [--scenarios 40] [--real <pool.json ngoài repo>]
//     [--no-v669] [--catalog <engine-catalog.json>] [--dump <tệp>]
//   --no-v669: đối chứng, chạy không có V669 (phải thấy chiến dịch bị tạm dừng vì 120 / 802).
//   pool.json (tuỳ chọn): {"uids": [...], "names": [...]} lấy từ data thật đã ẩn danh (mã người băm, tên che giữ dạng chữ).
//
// Bất biến (vi phạm thì mã thoát 1):
//   A1 không hỏi trạng thái bạn bè, không câu "Chưa là bạn bè" / mã err_engine_zalo_tag_not_friend.
//   A2 dòng gắn tag (zalotag:) và dòng thường cùng hành vi Zalo cho ra cùng kết quả (so từng data, sau khi bỏ mã riêng).
//   A3 không gửi lại data đã có lần gửi tới Zalo (after_send / in_flight); chỉ gửi lại data "chưa gửi" (before_send).
//   A4 có V669: 120 / 802 khi nhắn bạn bè → data "chờ xử lý" hẹn đúng giờ mở khoá "Nhắn tin người lạ", không tính lượt, không cộng chuỗi,
//      không tạm dừng chiến dịch, data sau trong lượt vẫn được xử lý; câu cho khách có giờ gửi lại (không ghi sai "24 giờ").
//   A5 tin gửi đi không còn biến chưa thay (#{...}), không "undefined"/"null"; hồ sơ Zalo có tên thì tin dùng tên hồ sơ.
//   A6 UID là SĐT / rỗng / không phải số → không gửi.
//   A7 sau khi chạy: không data / chiến dịch nào còn "đang chạy", không lượt engine còn mở.
//   A8 có V671 (mặc định; --no-v671 để đối chứng): khoá thao tác đến sau không ghi đè khoá đang còn hiệu lực và dài hơn (vd NET01 5 phút sau
//      120 tới 09:45), khoá dài hơn vẫn thay khoá ngắn; ghi nhận bằng trigger trên auto_account_action_status, đếm từng lần ghi khoá.
'use strict'
const assert = require('node:assert/strict')
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

const { build } = require('esbuild')
const { MIGRATION, buildFixture, startCluster } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('../build-v499-sql.cjs')
const v501 = require('../build-v501-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const V669 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v669_zalo_friend_stranger_restricted.sql'), 'utf8')
const v671 = require('../build-v671-sql.cjs')

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const flag = name => args.includes(name)
const SEED = Number(opt('--seed', 1))
const SCENARIOS = Number(opt('--scenarios', 40))
const NO_V669 = flag('--no-v669')
const NO_V671 = flag('--no-v671')
const CATALOG = opt('--catalog', path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/engine-catalog-20261126.json'))
const REAL = opt('--real')
const DUMP = opt('--dump')
const PORT = Number(process.env.CACH_A_FUZZ_PORT || 55669)

// --- ngẫu nhiên có hạt giống ---
let state = (SEED * 2654435761) >>> 0 || 1
const rnd = () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296 }
const pick = arr => arr[Math.floor(rnd() * arr.length)]
const weighted = pairs => { const total = pairs.reduce((s, [, w]) => s + w, 0); let x = rnd() * total; for (const [v, w] of pairs) { if ((x -= w) < 0) return v } return pairs[0][0] }
const digits = n => Array.from({ length: n }, (_, i) => (i === 0 ? 1 + Math.floor(rnd() * 9) : Math.floor(rnd() * 10))).join('')

const pool = REAL ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : { uids: [], names: [] }

const STUBS = {
  'zca-js': `class ZaloApiError extends Error { constructor(message, code) { super(message); this.name = 'ZaloApiError'; this.code = code ?? null } }
    module.exports = { ZaloApiError }`,
  electron: `module.exports = { app: { getPath: () => globalThis.__engineTest.userData } }`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__engineTest.client }`,
  errorPolicyRepository: `module.exports = { getZaloErrorPolicyByCode: async () => null }`,
  campaignRepository: `module.exports = {
    checkZaloMessageOptOut: async () => ({ isOptedOut: false, matchedBy: null }),
    prepareZaloMessageOptOut: async () => ({ id: '0b5d2f8e-1c2a-4d3b-8e4f-5a6b7c8d9e0f', isOptedOut: false }),
    updateCampaignInputData: async () => {} }`,
  zaloCampaignEngagement: `module.exports = { campaignEngagementEnabled: () => false,
    beginCampaignEngagementSend: () => ({ revision: '', sentAt: '' }), abandonCampaignEngagementSend: () => {},
    stageCampaignEngagementSource: () => {}, recordCampaignEngagementDetail: () => {} }`
}

async function loadRunner() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-cach-a-'))
  const outfile = path.join(out, 'runner.cjs')
  await build({
    entryPoints: [path.join(ROOT, 'src/main/engineAdapters/desktopEngineRunner.ts')], outfile, bundle: true, platform: 'node',
    format: 'cjs', logLevel: 'error',
    plugins: [{ name: 'cach-a-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^better-sqlite3$/ }, () => ({ path: require.resolve('better-sqlite3', { paths: [ROOT] }), external: true }))
      plugin.onResolve({ filter: /^(zca-js|electron)$|(supabaseClient|errorPolicyRepository|campaignRepository|services\/zaloCampaignEngagement)$/ }, a =>
        ({ path: a.path === 'zca-js' || a.path === 'electron' ? a.path : a.path.split('/').pop(), namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: STUBS[a.path], loader: 'js' }))
    } }]
  })
  return { mod: require(outfile), out }
}

/** Nạp dòng danh mục production (chính sách / luật / mã lỗi) vào DB thử: chỉ cột có ở cả hai bên. */
async function loadProductionCatalog(db) {
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'))
  const result = {}
  for (const table of ['auto_outcome_policies', 'auto_outcome_signal_rules', 'auto_error']) {
    await db.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`)
    await db.query(`DELETE FROM public.${table}`)
    await db.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`)
  }
  // Thao tác / trạng thái có ở production mà bản thử chưa có (chỉ thêm, không sửa dòng đang có).
  for (const table of ['auto_account_actions', 'auto_status']) {
    const data = cat.tables[table]
    const local = new Set((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]))
      .rows.map(r => r.column_name))
    const cols = data.columns.filter(c => local.has(c))
    const objects = data.rows.map(row => Object.fromEntries(data.columns.map((c, i) => [c, row[i]])))
    const list = cols.map(c => `"${c}"`).join(', ')
    await db.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`)
    await db.query(`INSERT INTO public.${table} (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb)
      ON CONFLICT DO NOTHING`, [JSON.stringify(objects)])
    await db.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`)
  }
  // Ràng buộc CHECK của production (bản thử dựng từ V495 có ràng buộc cũ, hẹp hơn).
  for (const table of ['auto_error', 'auto_outcome_signal_rules', 'auto_outcome_policies']) {
    for (const r of (await db.query(`SELECT conname FROM pg_constraint WHERE conrelid = ('public.' || $1)::regclass AND contype = 'c'`, [table])).rows) {
      await db.query(`ALTER TABLE public.${table} DROP CONSTRAINT "${r.conname}"`)
    }
  }
  for (const table of ['auto_error', 'auto_outcome_signal_rules', 'auto_outcome_policies']) {
    const data = cat.tables[table]
    const local = new Set((await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]))
      .rows.map(r => r.column_name))
    const cols = data.columns.filter(c => local.has(c))
    const objects = data.rows.map(row => Object.fromEntries(data.columns.map((c, i) => [c, row[i]])))
    await db.query(`ALTER TABLE public.${table} DISABLE TRIGGER USER`)
    const list = cols.map(c => `"${c}"`).join(', ')
    await db.query(`INSERT INTO public.${table} (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public.${table}, $1::jsonb)`,
      [JSON.stringify(objects)])
    await db.query(`ALTER TABLE public.${table} ENABLE TRIGGER USER`)
    const col = (await db.query(`SELECT pg_get_serial_sequence('public.${table}', 'id') AS s, column_default d FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'id'`, [table])).rows[0]
    const seq = col.s || /nextval\('([^']+)'/.exec(col.d || '')?.[1]
    if (seq) await db.query(`SELECT setval($1, (SELECT max(id) FROM public.${table}))`, [seq])
    for (const c of cat.checks.filter(c => c.table.replace(/^public\./, '') === table)) {
      await db.query(`ALTER TABLE public.${table} ADD CONSTRAINT "${c.name}" ${c.def} NOT VALID`).catch(e => {
        if (e.code !== '42703') throw new Error(`${c.name}: ${e.message}`) // cột production chưa có ở bản thử: bỏ ràng buộc đó
      })
    }
    result[table] = { rows: objects.length, missing: data.columns.filter(c => !local.has(c)) }
  }
  return result
}

class ZaloApiError extends Error { constructor(m, c) { super(m); this.name = 'ZaloApiError'; this.code = c ?? null } }
const markPreCall = e => Object.defineProperty(e, Symbol.for('aka-agent.zalo.preCall'), { value: true, configurable: true })

// --- sinh data ---
function makeUid(kind, used) {
  switch (kind) {
    case 'real': return pool.uids.length ? pick(pool.uids) : digits(16 + Math.floor(rnd() * 4))
    case 'valid': return digits(16 + Math.floor(rnd() * 4))
    case 'suffix0': return digits(18) + '_0'
    case 'spaces': return `  ${digits(18)} `
    case 'phone': return pick(['0', '84']) + '9' + digits(8)
    case 'empty': return ''
    case 'letters': return pick(['abc', 'uid-xyz', '12a45', 'null'])
    case 'long': return digits(26)
    case 'dup': return used.length ? pick(used) : digits(18)
    default: return digits(18)
  }
}
const NAME_KINDS = ['null', 'empty', 'uid', 'real', 'long', 'emoji', 'inject', 'newline', 'spaces']
function makeName(kind, uid) {
  switch (kind) {
    case 'null': return null
    case 'empty': return ''
    case 'uid': return uid
    case 'real': return pool.names.length ? pick(pool.names) : pick(['Anh Tuấn', 'Chị Lan', 'Nguyễn Văn A', 'Shop Hoa', 'Bé Na'])
    case 'long': return 'Tên '.repeat(80).trim()
    case 'emoji': return '🌸 Hoa 🌸'
    case 'inject': return '#{FULL_NAME} {a|b}'
    case 'newline': return 'Dòng 1\nDòng 2'
    case 'spaces': return '   '
    default: return 'Khách'
  }
}
const CONTENTS = ['Chào #{FULL_NAME}', 'Chào #{FULL_NAME}, cảm ơn bạn', 'Xin chào bạn', '#{FULL_NAME} ơi, shop có hàng mới', 'Chào {anh|chị} #{FULL_NAME}']
const SEND_OUTCOMES = [
  ['ok', 50], ['ok_empty', 4], ['z120', 9], ['z802', 6], ['z122', 6], ['z127', 2], ['z114', 3], ['z112', 2], ['z999', 2],
  ['net_reset', 3], ['precall', 3], ['http500', 1]
]
const PROFILE_OUTCOMES = [['name', 60], ['empty_name', 10], ['null', 10], ['throw', 8], ['other_uid', 4]]

function sendError(kind) {
  switch (kind) {
    case 'z120': return new ZaloApiError('Zalo: Bạn đang bị cấm nhắn tin cho người lạ.', 120) // câu thật (auto_engine_outcomes)
    case 'z802': return new ZaloApiError('Zalo: Bạn đang bị chặn nhắn tin với người lạ.', 802)
    case 'z122': return new ZaloApiError('Không thể nhận tin nhắn từ bạn.', 122)
    case 'z127': return new ZaloApiError('Không thể nhận tin nhắn từ bạn.', 127)
    case 'z114': return new ZaloApiError('Tham số không hợp lệ', 114)
    case 'z112': return new ZaloApiError('Lỗi không xác định', 112)
    case 'z999': return new ZaloApiError('Mã lạ', 999)
    case 'net_reset': return Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
    case 'precall': return markPreCall(new Error('Failed to get account Zalo session: TypeError: fetch failed'))
    case 'http500': return new ZaloApiError('Request failed with status code 500')
    default: return null
  }
}

async function main() {
  const { mod, out } = await loadRunner()
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-cach-a-' })
  const db = await connect()
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-cach-a-userdata-'))
  const violations = []
  const stats = { scenarios: 0, targets: 0, sends: 0, byOutcome: {}, deferred: 0, paused: 0, lockWrites: 0, lockKeep: 0, lockReplaced: 0, lockShortened: 0 }
  const violate = (code, detail) => { violations.push({ code, ...detail }); if (violations.length <= 30) console.log('VI PHẠM', code, JSON.stringify(detail)) }
  try {
    await buildFixture(db, [])
    for (const sql of [MIGRATION, v499.migration, V500, v501.migration]) await db.query(sql)
    const loaded = await loadProductionCatalog(db)
    console.log('Danh mục production:', JSON.stringify(Object.fromEntries(Object.entries(loaded).map(([t, v]) => [t, { rows: v.rows, thiếuCột: v.missing }]))))
    if (!NO_V669) await db.query(V669)
    // V671: thân report_v1 của bộ kiểm (bản V501) có đúng đoạn ghi khoá như production; vá cùng một chỗ.
    if (!NO_V671) {
      const { rows: [{ d }] } = await db.query(`SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p WHERE p.proname = 'aka_agent_engine_report_v1'`)
      if (d.split(v671.OLD).length !== 2) throw new Error('V671: đoạn ghi khoá report_v1 của bộ kiểm không đúng một chỗ')
      await db.query(d.replace(v671.OLD, v671.NEW))
    }
    // A8: ghi nhận mọi lần ghi khoá (lúc ghi = disabled_at = v_now của report_v1). BEFORE INSERT chạy trước bước ON CONFLICT nên thấy cả
    // lần bị giữ (không cập nhật); BEFORE UPDATE thấy lần thay thật. Bộ kiểm tự cho khoá ngắn hết hạn bằng UPDATE không đổi disabled_at.
    await db.query(`CREATE TABLE public.zz_lock_audit (id bigserial, kind text, account_id bigint, action_code text, old_date timestamptz, new_date timestamptz, at timestamptz);
      CREATE FUNCTION public.zz_lock_audit_ins() RETURNS trigger LANGUAGE plpgsql AS $f$
      DECLARE o record;
      BEGIN
        IF NEW.is_disable IS TRUE THEN
          SELECT s.is_disable, s.date_enable INTO o FROM public.auto_account_action_status s WHERE s.account_id = NEW.account_id AND s.action_code = NEW.action_code;
          IF FOUND THEN
            INSERT INTO public.zz_lock_audit (kind, account_id, action_code, old_date, new_date, at)
            VALUES (CASE WHEN o.is_disable AND NEW.date_enable IS NOT NULL AND (o.date_enable IS NULL OR (o.date_enable > NEW.disabled_at AND o.date_enable > NEW.date_enable))
                         THEN 'keep' ELSE 'write' END, NEW.account_id, NEW.action_code, o.date_enable, NEW.date_enable, NEW.disabled_at);
          END IF;
        END IF;
        RETURN NEW;
      END $f$;
      CREATE FUNCTION public.zz_lock_audit_upd() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN
        IF NEW.is_disable IS TRUE AND NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
          INSERT INTO public.zz_lock_audit (kind, account_id, action_code, old_date, new_date, at)
          VALUES (CASE WHEN OLD.is_disable AND NEW.date_enable IS NOT NULL AND (OLD.date_enable IS NULL OR (OLD.date_enable > NEW.disabled_at AND OLD.date_enable > NEW.date_enable))
                       THEN 'shortened' ELSE 'replaced' END, NEW.account_id, NEW.action_code, OLD.date_enable, NEW.date_enable, NEW.disabled_at);
        END IF;
        RETURN NEW;
      END $f$;
      CREATE TRIGGER zz_lock_audit_ins BEFORE INSERT ON public.auto_account_action_status FOR EACH ROW EXECUTE FUNCTION public.zz_lock_audit_ins();
      CREATE TRIGGER zz_lock_audit_upd BEFORE UPDATE ON public.auto_account_action_status FOR EACH ROW EXECUTE FUNCTION public.zz_lock_audit_upd();`)

    const client = {
      rpc(name, a) {
        const run = (async () => {
          const params = [], parts = []
          for (const [key, value] of Object.entries(a)) {
            const json = value !== null && typeof value === 'object'
            params.push(json ? JSON.stringify(value) : value)
            parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
          }
          try {
            const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
            return { data: r.rows[0].r, error: null, status: 200 }
          } catch (e) { return { data: null, error: { message: e.message, code: e.code }, status: 400 } }
        })()
        return { abortSignal: () => run }
      }
    }
    globalThis.__engineTest = { userData, client }

    let nextId = 5_000_000
    const org = 650, staff = 8001
    await db.query(`INSERT INTO public.org_organization(id, name, use_new_zalo_runtime) VALUES ($1, 'Org Fuzz', false) ON CONFLICT (id) DO NOTHING`, [org])

    const makeCampaign = async (rows, content) => {
      const account = ++nextId, campaign = ++nextId
      await db.query(`INSERT INTO public.auto_accounts(id, name, flatform_type, login_status, status, is_active, is_delete, staff_id, organization_id, is_zalo_server)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Zalo QR', 'zalo', 'đã đăng nhập', 'chờ xử lý', true, false, $2, $3, false)`, [account, staff, org])
      await db.query(`INSERT INTO public.auto_campaigns(id, name, action_id, account_id, status, schedule, is_delete, staff_id, organization_id, content, extra_settings)
        OVERRIDING SYSTEM VALUE VALUES ($1, 'Bạn bè theo tag', 'zalo_message_friend', $2, 'chờ xử lý', now() - interval '1 minute', false, $3, $4, $5, '{}'::jsonb)`,
        [campaign, account, staff, org, content])
      const ids = []
      for (const row of rows) {
        const id = ++nextId
        await db.query(`INSERT INTO public.auto_campaign_input_data(id, campaign_id, name, uid, status, is_delete, control_append_idempotency_key)
          OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, 'chờ xử lý', false, $5)`,
          [id, campaign, row.name, row.uid, row.key ? row.key.replace('<c>', String(campaign)) : null])
        ids.push(id)
      }
      return {
        ids,
        account: { id: account, name: 'Zalo QR', flatformType: 'zalo', isZaloServer: false, accountGroupSettings: { sleepBetweenActions: 0 } },
        campaign: { id: campaign, name: 'Bạn bè theo tag', actionId: 'zalo_message_friend', accountId: account, staffId: staff, content, extraSettings: {},
          images: [], dataTargetSourceMode: 'direct', note: null }
      }
    }

    const runScenario = async (rows, content, behaviors) => {
      const fx = await makeCampaign(rows, content)
      const sent = [], lines = []
      const attempts = new Map()
      const runtime = {
        findUserByPhoneOnce: async () => { throw new Error('không được tra SĐT trong chiến dịch bạn bè') },
        getFriendRequestStatus: async (accountId, uid) => { sent.push(`friend_status:${uid}`); return { raw: { is_friend: 0 } } },
        getUserProfile: async (accountId, uid) => {
          sent.push(`profile:${uid}`)
          const b = behaviors.get(String(uid).trim()) || { profile: 'name', send: 'ok' }
          switch (b.profile) {
            case 'empty_name': return { uid, displayName: '', originalName: '', globalId: `g-${uid}`, gender: 0, raw: { userId: uid } }
            case 'null': return null
            case 'throw': throw new Error('getUserInfo lỗi')
            case 'other_uid': return { uid: '999' + uid, displayName: `Người khác ${uid}`, originalName: '', globalId: `g2-${uid}`, gender: 0, raw: { userId: '999' + uid } }
            default: return { uid, displayName: `Hồ sơ ${uid}`, originalName: `Hồ sơ ${uid}`, globalId: `g-${uid}`, gender: 0, raw: { userId: uid, displayName: `Hồ sơ ${uid}` } }
          }
        },
        sendMessageToUser: async (accountId, uid, message) => {
          sent.push(`text:${uid}:${message}`)
          const key = String(uid).trim()
          attempts.set(key, (attempts.get(key) || 0) + 1)
          const b = behaviors.get(key) || { send: 'ok' }
          // Lần gửi lại (sau before_send) thì thành công, để thấy data được gửi lại đúng một lần.
          const kind = attempts.get(key) > 1 ? 'ok' : b.send
          const error = sendError(kind)
          if (error) throw error
          return { message: kind === 'ok_empty' ? '' : { msgId: `m-${uid}-${attempts.get(key)}` }, attachment: [] }
        },
        sendFriendRequestToUser: async () => { throw new Error('không được kết bạn') }
      }
      const host = {
        zaloRuntime: () => runtime, staffId: () => staff, engineEnabled: () => true, zaloRuntimeBlocked: () => false, acceptingWork: () => true,
        logProgress: async (campaign, text) => { lines.push(text) },
        broadcastCampaign: async () => {}, broadcastAccounts: () => {},
        isPauseRequested: () => false,
        completeReleasedPause: async () => {},
        saveContact: async () => {}, saveResolvedProfile: async () => {}, saveJoinedGroup: async () => {},
        businessNow: async () => new Date(),
        findDataSourceWaitNote: async () => null,
        noteCampaignWait: async (campaign, note) => { lines.push(`⚠️ Chưa thể chạy chiến dịch: ${note}`) }
      }
      const runner = new mod.DesktopEngineRunner(host)
      const results = []
      for (let pass = 0; pass < 5; pass++) {
        // Giả lập hết khoá theo phút ngắn (NET01 5 phút) để data "chưa gửi" được chạy lại; khoá dài (120/802) giữ nguyên.
        await db.query(`UPDATE public.auto_account_action_status SET date_enable = now() - interval '1 second'
          WHERE account_id = $1 AND date_enable < now() + interval '10 minutes'`, [fx.account.id]).catch(() => {})
        const c = (await db.query(`SELECT status FROM public.auto_campaigns WHERE id = $1`, [fx.campaign.id])).rows[0]
        if (c.status !== 'chờ xử lý') break
        const res = await runner.run(fx.account, fx.campaign)
        results.push(res.reason)
        if (res.reason === 'no_target') {
          const pending = (await db.query(`SELECT count(*)::int n FROM public.auto_campaign_input_data WHERE campaign_id = $1 AND status = 'chờ xử lý'
            AND (schedule IS NULL OR schedule <= now())`, [fx.campaign.id])).rows[0].n
          if (!pending) break
        }
      }
      const data = (await db.query(`SELECT id, uid, name, status, note, schedule FROM public.auto_campaign_input_data WHERE campaign_id = $1 ORDER BY id`, [fx.campaign.id])).rows
      const details = (await db.query(`SELECT input_data_id, action_code, status, error_code, log, counts_toward_limit FROM public.auto_campaign_details
        WHERE campaign_id = $1 ORDER BY id`, [fx.campaign.id])).rows
      const outcomes = (await db.query(`SELECT input_data_id, action_code, phase, error_code, delivery_state, decision FROM public.auto_engine_outcomes
        WHERE campaign_id = $1 ORDER BY created_at, result_key`, [fx.campaign.id])).rows
      const campaign = (await db.query(`SELECT status, note FROM public.auto_campaigns WHERE id = $1`, [fx.campaign.id])).rows[0]
      const streak = (await db.query(`SELECT count_consecutive_bad_targets n FROM public.auto_campaign_error_state WHERE campaign_id = $1`, [fx.campaign.id])).rows[0]?.n ?? 0
      const openRuns = (await db.query(`SELECT count(*)::int n FROM public.auto_engine_target_runs WHERE campaign_id = $1 AND completed_at IS NULL`, [fx.campaign.id]))
        .rows[0].n
      const locks = (await db.query(`SELECT action_code, date_enable FROM public.auto_account_action_status WHERE account_id = $1 AND date_enable > now()`,
        [fx.account.id])).rows
      const audit = (await db.query(`SELECT kind, count(*)::int n FROM public.zz_lock_audit WHERE account_id = $1 GROUP BY kind`, [fx.account.id])).rows
      const lockAudit = Object.fromEntries(audit.map(a => [a.kind, a.n]))
      return { fx, sent, lines, data, details, outcomes, campaign, streak, openRuns, locks, results, lockAudit }
    }

    // Tóm tắt kết quả theo data, bỏ mã / id riêng của từng chiến dịch, để so dòng gắn tag với dòng thường (A2).
    const summarize = (r) => r.data.map((d, i) => ({
      i, status: d.status, scheduled: d.schedule ? Math.round((new Date(d.schedule) - Date.now()) / 60000 / 10) : null,
      details: r.details.filter(x => x.input_data_id === d.id).map(x => [x.action_code, x.status, x.error_code]),
      outcomes: r.outcomes.filter(x => x.input_data_id === d.id).map(x => [x.action_code, x.phase, x.error_code])
    }))

    for (let s = 0; s < SCENARIOS; s++) {
      stats.scenarios++
      const n = 1 + Math.floor(rnd() * 10)
      const used = [], rows = [], behaviors = new Map()
      const content = pick(CONTENTS)
      for (let k = 0; k < n; k++) {
        const uidKind = weighted([['real', 3], ['valid', 10], ['suffix0', 1], ['spaces', 1], ['phone', 1], ['empty', 1], ['letters', 1], ['long', 1], ['dup', 1]])
        const uid = makeUid(uidKind, used)
        used.push(uid)
        const nameKind = pick(NAME_KINDS)
        const key = weighted([['tag', 6], ['none', 3], ['bad', 1]])
        rows.push({ uid, name: makeName(nameKind, uid), uidKind, nameKind,
          key: key === 'tag' ? `zalotag:<c>:${uid}` : key === 'bad' ? pick(['zalotag:', 'ZALOTAG:<c>:1', 'zalotag:x:y:z', 'tag:<c>:1']) : null })
        const trimmed = String(uid).trim()
        if (!behaviors.has(trimmed)) behaviors.set(trimmed, { send: weighted(SEND_OUTCOMES), profile: weighted(PROFILE_OUTCOMES) })
      }
      stats.targets += n
      const tagged = await runScenario(rows, content, behaviors)
      const plain = await runScenario(rows.map(r => ({ ...r, key: null })), content, behaviors)
      const ctx = { seed: SEED, scenario: s }

      for (const [label, r] of [['tag', tagged], ['plain', plain]]) {
        // A1
        if (r.sent.some(x => x.startsWith('friend_status:'))) violate('A1', { ...ctx, label, sent: r.sent })
        if (r.lines.some(l => /Chưa là bạn bè|không phải bạn bè/i.test(l)) || r.outcomes.some(o => o.error_code === 'err_engine_zalo_tag_not_friend')) {
          violate('A1', { ...ctx, label, lines: r.lines })
        }
        // A7
        if (r.openRuns) violate('A7', { ...ctx, label, openRuns: r.openRuns })
        if (r.data.some(d => d.status === 'đang chạy') || r.campaign.status === 'đang chạy') violate('A7', { ...ctx, label, campaign: r.campaign })
        if (r.campaign.status === 'tạm dừng') stats.paused++
        // A8: mỗi lần ghi khoá vào dòng đã có là "keep" (khoá cũ còn hiệu lực, dài hơn) hoặc "write". Có V671: không lần nào rút ngắn khoá
        // ("shortened"), mọi "write" đều thành "replaced". Không V671 (đối chứng): mọi lần đều cập nhật, keep = shortened.
        const la = { keep: 0, write: 0, replaced: 0, shortened: 0, ...r.lockAudit }
        stats.lockWrites += la.keep + la.write; stats.lockKeep += la.keep; stats.lockReplaced += la.replaced; stats.lockShortened += la.shortened
        const okLocks = NO_V671 ? (la.shortened === la.keep && la.replaced === la.write) : (la.shortened === 0 && la.replaced === la.write)
        if (!okLocks) violate('A8', { ...ctx, label, lockAudit: la })
        const texts = r.sent.filter(x => x.startsWith('text:'))
        stats.sends += texts.length
        for (const t of texts) {
          const [, uid, ...rest] = t.split(':'); const message = rest.join(':')
          // A5
          // Bỏ phần tên hồ sơ giả và chính UID (không có tên thì tin dùng UID, kể cả UID sai như "null").
          const bare = message.split(`Hồ sơ ${uid}`).join('').split(`Người khác 999${uid}`).join('').split(uid).join('')
          if (/#\{[A-Z_]+\}/.test(bare) || /\bundefined\b|\bnull\b/.test(bare)) {
            // Tên data có sẵn "#{FULL_NAME}" thì được chèn nguyên văn (không thay lần hai) là đúng; UID trùng thì xét mọi dòng cùng UID.
            const same = rows.filter(x => String(x.uid).trim() === uid)
            if (!(same.some(x => /#\{FULL_NAME\}/.test(String(x.name ?? ''))) && /#\{FULL_NAME\}/.test(content))) violate('A5', { ...ctx, label, message, rows: same })
          }
          const b = behaviors.get(uid)
          if (b?.profile === 'name' && /#\{FULL_NAME\}/.test(content) && !message.includes(`Hồ sơ ${uid}`)) violate('A5', { ...ctx, label, message, uid })
        }
        for (const [idx, d] of r.data.entries()) {
          const row = rows[idx]
          const uid = String(row.uid).trim()
          const b = behaviors.get(uid)
          const tries = texts.filter(t => t.startsWith(`text:${uid}:`)).length
          const outs = r.outcomes.filter(o => o.input_data_id === d.id && o.action_code === 'zalo_message_friend')
          stats.byOutcome[b?.send ?? '?'] = (stats.byOutcome[b?.send ?? '?'] || 0) + 1
          // A6
          // UID có chữ vẫn gửi cho Zalo trả lời (114), như mọi chiến dịch bạn bè trước Cách A; chỉ SĐT / rỗng là không gửi.
          if (['phone', 'empty'].includes(row.uidKind) && tries > 0) violate('A6', { ...ctx, label, row, tries })
          // A3: lần gửi tới Zalo (after_send / in_flight) không bao giờ được gửi lại.
          const delivered = outs.filter(o => o.phase !== 'before_send').length
          const dupUid = rows.filter(x => String(x.uid).trim() === uid).length > 1
          if (!dupUid && delivered >= 1 && tries > outs.filter(o => o.phase === 'before_send').length + 1) violate('A3', { ...ctx, label, row, tries, outs })
          // A4
          if (!NO_V669 && !dupUid && (b?.send === 'z120' || b?.send === 'z802') && tries === 1) {
            const o = outs[0]
            const contrib = o?.decision?.contrib || {}
            const lock = r.locks.find(l => l.action_code === 'zalo_message_stranger')
            const detail = r.details.find(x => x.input_data_id === d.id && x.action_code === 'zalo_message_friend')
            // Giờ hẹn = giờ mở khoá "Nhắn tin người lạ" của chính mã đó (120: 09:45 hôm sau, 802: 09:45 sau 2 ngày, giờ VN).
            const days = b.send === 'z120' ? 1 : 2
            const expected = (await db.query(`SELECT greatest((date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + make_interval(days => $1) + time '09:45')
              AT TIME ZONE 'Asia/Ho_Chi_Minh', now() + interval '1 second') AS t`, [days])).rows[0].t
            // Khoá "Nhắn tin người lạ" của tài khoản kiểm ở A8 (V671: lỗi đến sau không đè khoá dài hơn).
            const okState = d.status === 'chờ xử lý' && d.schedule && Math.abs(new Date(d.schedule) - new Date(expected)) < 2000
            if (!okState) violate('A4-hẹn', { ...ctx, label, data: d, expected, lock })
            if (contrib.streak && contrib.streak !== 'ignore') violate('A4-chuỗi', { ...ctx, label, contrib })
            if (detail?.counts_toward_limit) violate('A4-lượt', { ...ctx, label, detail })
            // Chiến dịch có thể dừng vì mã khác trong cùng kịch bản (Z112 nội dung dài, 127 liền...): chỉ bắt khi chính 120 / 802 đòi dừng
            // hoặc ghi chú dừng là của 120 / 802.
            if (contrib.campaignEffect && contrib.campaignEffect !== 'none') violate('A4-dừng', { ...ctx, label, contrib })
            if (r.campaign.status === 'tạm dừng' && /Z120|Z802|mã 120|mã 802|nhắn người lạ/.test(String(r.campaign.note || ''))) violate('A4-dừng', { ...ctx, label, campaign: r.campaign })
            const until = d.schedule ? (await db.query(`SELECT public.aka_agent_engine_format_vn($1::timestamptz) AS t`, [d.schedule])).rows[0].t : null
            const names = [row.name, String(row.name ?? '').trim(), row.uid, uid].filter(x => x != null && x !== '')
            const lineOk = !!until && r.lines.some(l => /\(Z(120|802)\)$/.test(l) && l.includes(`lúc ${until}`) && names.some(n => l.includes(`"${n}"`)))
            const noteOk = !!until && String(d.note || '').includes(`lúc ${until}`) && !/\{until\}|24 giờ|48 giờ/.test(String(d.note || ''))
            if (!lineOk || !noteOk) violate('A4-câu', { ...ctx, label, until, note: d.note, lines: r.lines.filter(l => /Z120|Z802/.test(l)) })
            if (d.status === 'chờ xử lý') stats.deferred++
          }
        }
      }
      // A2: cùng hành vi Zalo thì dòng gắn tag và dòng thường ra cùng kết quả.
      const a = JSON.stringify(summarize(tagged)), bsum = JSON.stringify(summarize(plain))
      if (a !== bsum) violate('A2', { ...ctx, tagged: summarize(tagged), plain: summarize(plain), rows })
      if (DUMP && s === 0) fs.writeFileSync(DUMP, JSON.stringify({ rows, tagged: { lines: tagged.lines, data: tagged.data, details: tagged.details } }, null, 2))
    }
  } finally {
    await db.end().catch(() => {})
    stop()
    fs.rmSync(out, { recursive: true, force: true })
    fs.rmSync(userData, { recursive: true, force: true })
  }
  console.log('Thống kê:', JSON.stringify(stats))
  const codes = [...new Set(violations.map(v => v.code))]
  console.log(`${violations.length} vi phạm${codes.length ? ' (' + codes.join(', ') + ')' : ''}${NO_V669 ? ' [không V669, đối chứng]' : ''}${NO_V671 ? ' [không V671, đối chứng]' : ''}`)
  process.exit(violations.length && !NO_V669 ? 1 : 0)
}

main().catch(err => { console.error(err); process.exit(2) })
