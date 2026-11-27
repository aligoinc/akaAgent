#!/usr/bin/env node
'use strict'
/*
 * Giả lập sự kiện Zalo cho Bot sự kiện, chạy qua đúng code production từ chỗ Zalo đổi tới tin bot gửi:
 *   - Tag: ZaloTagSyncRuntime thật (src/main/services/zaloTagSyncRuntime.ts) đọc `getLabels` giả theo đúng khuôn zca-js
 *     ({version, labelData:[{id, text, conversations}]} → peekLabels), gửi xuống V660 thật → trigger V672 → EventBotRuntime thật gửi.
 *   - Nhóm điều kiện: dữ liệu Zalo đổi theo đúng cách app ghi (danh sách bạn bè → auto_account_contacts.is_friend, quét thành viên
 *     nhóm → zalo_group_members, tag trong Chat → chat_zalo_account_conversation_tag, chiến dịch gắn tag → extra_data.zaloTagIds,
 *     tag akaBiz) → trigger hàng đợi + job Bộ lọc động production chép nguyên văn (scripts/event-bot/db/dynfilter-prod-20261127.sql)
 *     → trigger V672 → bot gửi.
 *   - Sinh nhật: EventBotRuntime đọc getAllFriends giả (trang 500 người, sdob như Zalo trả) → RPC sinh nhật V672 → bot gửi.
 * Mỗi ca có kết quả mong đợi. Ca ghi KNOWN là giới hạn đã biết của thiết kế (in ra, không tính lỗi).
 * Cách chạy: PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/event-bot/fuzz/zalo-events-sim.cjs [--only tag|group|birthday] [--verbose]
 */
const path = require('path')
const { startCluster, buildTs, REPO } = require('./cluster.cjs')

const args = process.argv.slice(2)
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1] : null })()
const VERBOSE = args.includes('--verbose')
const { ZaloTagSyncRuntime } = buildTs('src/main/services/zaloTagSyncRuntime.ts')
const { EventBotRuntime } = buildTs('src/main/services/eventBotRuntime.ts')

const results = []
function check(suite, id, title, ok, detail = {}, known = false) {
  results.push({ suite, id, title, status: ok ? (known ? 'KNOWN' : 'PASS') : 'FAIL', detail })
}

const ORG = 10
const S1 = 100
const S2 = 101
const ACC = { qr: 1001, server: 1002, web: 1003, chat: 1004, other: 1011 }
const uidOf = (acc, i) => String(7_000_000_000_000_000_000n + BigInt(acc) * 1000n + BigInt(i))

async function makeWorld(c) {
  await c.query(`INSERT INTO org_staff (id, organization_id, name) VALUES ($1,$3,'NV 1'),($2,$3,'NV 2')`, [S1, S2, ORG])
  const accs = [[ACC.qr, S1, 'qr'], [ACC.server, S1, 'server'], [ACC.web, S1, 'web'], [ACC.chat, S1, 'qr'], [ACC.other, S2, 'qr']]
  for (const [id, staff, kind] of accs) {
    await c.query(`INSERT INTO zalo_accounts (id, zalo_uid, display_name) VALUES ($1,$2,$3)`, [id, '9' + id, 'Zalo ' + id])
    await c.query(`INSERT INTO auto_accounts (id, name, staff_id, organization_id, flatform_type, is_zalo_server, is_zalo_show_web, zalo_account_id)
      VALUES ($1,$2,$3,$4,'zalo',$5,$6,$1)`, [id, 'TK ' + id, staff, ORG, kind === 'server', kind === 'web'])
    for (let i = 1; i <= 30; i++) {
      await c.query(`INSERT INTO auto_account_contacts (account_id, contact_type, name, uid, phone, staff_id, organization_id, flatform_type, is_friend)
        VALUES ($1,'person',$2,$3,$4,$5,$6,'zalo',false)`, [id, 'Khách ' + i, uidOf(id, i), '09' + String(10000000 + id * 100 + i).slice(-8), staff, ORG])
    }
  }
  // Tài khoản 1004 có akaChat (hội thoại + tag của Chat).
  await c.query(`INSERT INTO chat_zalo_account_organization (chat_zalo_account_id, organization_id, auto_account_id, is_active) VALUES (501, $1, $2, true)`, [ORG, ACC.chat])
  await c.query(`UPDATE auto_system_settings SET value='true' WHERE key='zalo.tag_sync.enabled'`)
  await c.query(`UPDATE auto_system_settings SET value=$1 WHERE key='event_bot'`, [JSON.stringify({ audience: 'all', runtimes: { desktop: true, server: true, fly: false } })])
}

async function asDesktop(c, staff, sql, params) {
  await c.query('BEGIN')
  try {
    await c.query(`SELECT set_config('test.staff', $1, true)`, [String(staff)])
    await c.query('SET LOCAL ROLE aka_agent_desktop')
    const res = await c.query(sql, params)
    await c.query('COMMIT')
    return res.rows[0].r
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e }
}

async function control(c, staff, action, payload) {
  return (await c.query('SELECT public.aka_agent_control_event_bot($1,$2,$3,$4::jsonb) r', [staff, ORG, action, JSON.stringify(payload)])).rows[0].r
}

async function saveBot(c, staff, accountId, rules, { enabled = true, blocklistIds = [] } = {}) {
  const st = (await c.query('SELECT revision FROM auto_event_bot_settings WHERE account_id=$1', [accountId])).rows[0]
  const out = await control(c, staff, 'save', { accountId, revision: st ? Number(st.revision) : 0, enabled, blocklistIds, rules })
  if (!out || out.ok === false) throw new Error('save lỗi: ' + JSON.stringify(out))
  return out
}

async function existingRules(c, accountId) {
  return (await c.query('SELECT * FROM auto_event_bot_rules WHERE account_id=$1 AND NOT is_delete ORDER BY position, id', [accountId])).rows
    .map(e => ({ id: Number(e.id), eventType: e.event_type, name: e.name, enabled: e.enabled, position: e.position, config: e.config, dataGroupId: e.data_group_id == null ? null : Number(e.data_group_id), minGapMinutes: e.min_gap_minutes }))
}

/** Môi trường chung: DB, Zalo giả, bot. */
async function makeEnv(cluster) {
  const db = await cluster.fresh()
  const c = await db.connect()
  await makeWorld(c)
  const env = { c, db, clock: 1_000_000, sends: [], zalo: new Map(), friends: new Map(), readFail: new Set(), sessionless: new Set(), conns: [] }
  const conn = async () => { const x = await db.connect(); env.conns.push(x); return x }

  // ---- Zalo giả: getLabels theo khuôn zca-js; peekLabels trả {version: String(version), labels: labelData}; chỉ tài khoản có phiên
  // zca-js (QR / Server) mới đọc được, Zalo trình duyệt không có.
  env.label = (acc, id, text, members) => {
    const z = env.zalo.get(acc) || { version: 1, labels: new Map() }
    z.labels.set(String(id), { id: Number(id), text, textKey: text, conversations: [...members], color: '#ff0000', offset: 0, emoji: '', createTime: 0 })
    env.zalo.set(acc, z)
  }
  env.mutate = (acc, fn, { bump = true } = {}) => {
    const z = env.zalo.get(acc)
    fn(z.labels)
    if (bump) z.version += 1
  }
  const peekLabels = async acc => {
    if (env.readFail.has(acc)) throw new Error('getLabels failed: socket hang up')
    if (acc === ACC.web || env.sessionless.has(acc)) return null
    const z = env.zalo.get(acc)
    if (!z) return null
    const response = { labelData: [...z.labels.values()].map(l => ({ ...l, conversations: [...l.conversations] })), version: z.version, lastUpdateTime: Date.now() }
    return { version: String(response.version), labels: response.labelData }
  }

  // ---- ZaloTagSyncRuntime thật: Desktop (nhân viên S1) và App Server (tài khoản Server đang có phiên).
  const tagDesktop = await conn()
  const tagServer = await conn()
  env.tagCalls = []
  env.tagRt = {
    desktop: new ZaloTagSyncRuntime({
      loadAccounts: () => asDesktop(tagDesktop, S1, 'SELECT public.aka_agent_desktop_zalo_tag_sync_accounts() r'),
      sync: async items => { env.tagCalls.push({ rt: 'desktop', items }); return asDesktop(tagDesktop, S1, 'SELECT public.aka_agent_desktop_sync_zalo_tags($1::jsonb) r', [JSON.stringify(items)]) },
      readLabels: peekLabels, now: () => env.clock, setTimer: () => 1, clearTimer: () => {}, warn: (k, d) => { env.tagWarn = [k, d] }
    }),
    server: new ZaloTagSyncRuntime({
      loadAccounts: async () => (await tagServer.query(`SELECT public.aka_agent_zalo_tag_sync_accounts('server', $1::bigint[]) r`, [[ACC.server]])).rows[0].r,
      sync: async items => { env.tagCalls.push({ rt: 'server', items }); return (await tagServer.query(`SELECT public.aka_agent_sync_zalo_tags('server', $1::jsonb) r`, [JSON.stringify(items)])).rows[0].r },
      readLabels: peekLabels, now: () => env.clock, setTimer: () => 1, clearTimer: () => {}, warn: (k, d) => { env.tagWarn = [k, d] }
    })
  }
  env.tagTick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      env.clock += 60_000
      await env.tagRt.desktop.tick()
      await env.tagRt.server.tick()
    }
  }

  // ---- Bot gửi: EventBotRuntime thật cho Desktop S1, Desktop S2 và App Server.
  const vnDate = async () => (await c.query(`SELECT to_char(timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date, 'YYYY-MM-DD') d`)).rows[0].d
  const makeBot = async (kind, staff) => {
    const x = await conn()
    const mine = kind === 'server' ? [ACC.server] : staff === S1 ? [ACC.qr, ACC.web, ACC.chat] : [ACC.other]
    const unwrap = async (sql, params) => kind === 'desktop' ? asDesktop(x, staff, sql, params) : (await x.query(sql, params)).rows[0].r
    let clock = 0
    const rt = new EventBotRuntime({
      source: kind, runnerId: `${kind}:${staff ?? 'vps'}`, active: () => true, canStartWork: () => true,
      isHeld: id => mine.includes(id) && !env.sessionless.has(id), listHeldAccounts: () => mine.filter(id => !env.sessionless.has(id)),
      sync: heldIds => kind === 'desktop' ? unwrap('SELECT public.aka_agent_desktop_event_bot_sync_v1() r') : unwrap(`SELECT public.aka_agent_event_bot_sync_v1('server', $1::bigint[]) r`, [heldIds]),
      birthdays: (accountId, people) => kind === 'desktop' ? unwrap('SELECT public.aka_agent_desktop_event_bot_birthdays_v1($1, $2::jsonb) r', [accountId, JSON.stringify(people)]) : unwrap(`SELECT public.aka_agent_event_bot_birthdays_v1('server', $1, $2::jsonb) r`, [accountId, JSON.stringify(people)]),
      claim: (runnerId, ids, limit) => kind === 'desktop' ? unwrap('SELECT public.aka_agent_desktop_event_bot_claim_v1($1, $2::bigint[], $3) r', [runnerId, ids, limit]) : unwrap(`SELECT public.aka_agent_event_bot_claim_v1('server', $1, $2::bigint[], $3) r`, [runnerId, ids, limit]),
      report: (jobId, token, result) => kind === 'desktop' ? unwrap('SELECT public.aka_agent_desktop_event_bot_report_v1($1, $2::uuid, $3::jsonb) r', [jobId, token, JSON.stringify(result)]) : unwrap(`SELECT public.aka_agent_event_bot_report_v1('server', $1, $2::uuid, $3::jsonb) r`, [jobId, token, JSON.stringify(result)]),
      port: {
        async sendText(accountId, uid, text) { env.sends.push({ accountId, uid, text, at: Date.now() }); return { msgId: 'z' + env.sends.length } },
        async getProfile(accountId, uid) { return { displayName: 'Hồ sơ ' + String(uid).slice(-3), originalName: null, gender: 1 } },
        errorHints: () => ({}),
        businessNow: async () => new Date()
      },
      readFriendsPage: async (accountId, count, page) => {
        const f = env.friends.get(accountId)
        if (!f) return []
        if (f.failPage === page) { f.failPage = null; throw new Error('getAllFriends failed: ECONNRESET') }
        return f.rows.slice((page - 1) * count, page * count)
      },
      vietnamDate: vnDate, isRpcMissing: e => e && e.code === 'PGRST202', now: () => clock, wallNow: () => Date.now(),
      sleep: async ms => { clock += ms }, setTimer: () => 1, clearTimer: () => {}, random: Math.random,
      warn: k => { env.botWarn = k }, info: () => {}
    })
    rt.start()
    return { rt, bump: ms => { clock += ms } }
  }
  env.bots = [await makeBot('desktop', S1), await makeBot('desktop', S2), await makeBot('server', null)]
  env.drain = async () => {
    // Bot gửi tối đa 1 việc / tài khoản mỗi nhịp (claim bỏ qua tài khoản đang có việc `sending`): chạy tới khi hết việc đến hạn.
    for (let k = 0; k < 80; k++) {
      await c.query(`UPDATE auto_event_bot_jobs SET send_after = clock_timestamp() - interval '1 second' WHERE status='pending' AND send_after > clock_timestamp()`)
      for (const b of env.bots) { b.bump(120_000); b.rt.refreshSoon(); await b.rt.tick() }
      if (k >= 2 && Number((await c.query(`SELECT count(*) n FROM auto_event_bot_jobs WHERE status IN ('pending','sending') AND expires_at > clock_timestamp()`)).rows[0].n) === 0) break
    }
  }
  env.mark = async () => Number((await c.query('SELECT COALESCE(max(id),0) m FROM auto_event_bot_jobs')).rows[0].m)
  env.jobsSince = async m => (await c.query('SELECT * FROM auto_event_bot_jobs WHERE id > $1 ORDER BY id', [m])).rows
  env.sendsSince = n => env.sends.slice(n)
  env.worker = async () => (await c.query('SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5,100) r')).rows[0].r
  env.close = async () => {
    for (const b of env.bots) { b.rt.stop(); await b.rt.waitForIdle(1000) }
    for (const x of env.conns) await x.end().catch(() => {})
    await c.end(); await cluster.drop(db.name)
  }
  return env
}

const summarize = jobs => jobs.map(j => `${j.event_type}/${j.direction}/${j.status}${j.reason_code ? ':' + j.reason_code : ''}→…${String(j.recipient_uid).slice(-4)}`)
const pick = (jobs, f) => jobs.filter(f)

// =====================================================================================================================
// Tag Zalo
// =====================================================================================================================
async function tagSuite(cluster) {
  const env = await makeEnv(cluster)
  const { c } = env
  const T = (id, title, ok, detail, known) => check('tag', id, title, ok, detail, known)
  const u = i => uidOf(ACC.qr, i)
  const R_ADD = { eventType: 'tag_change', name: 'Gắn tag Khách mới', enabled: true, config: { direction: 'added', tagIds: ['5'], tagNames: ['Khách mới'], message: 'Chào #{FULL_NAME}, cảm ơn đã quan tâm', delay: { minSeconds: 0, maxSeconds: 5 } } }
  const R_REM = { eventType: 'tag_change', name: 'Gỡ tag VIP', enabled: true, config: { direction: 'removed', tagIds: ['6'], tagNames: ['VIP'], message: 'Hẹn gặp lại #{FULL_NAME}', delay: { minSeconds: 0, maxSeconds: 5 } } }
  env.label(ACC.qr, 5, 'Khách mới', [u(1), u(2)])
  env.label(ACC.qr, 6, 'VIP', [u(3), u(4), u(5)])
  env.label(ACC.qr, 7, 'Khác', [u(8)])
  env.label(ACC.qr, 9, 'Một người', [u(9)])

  // T00: lưu quy tắc rồi người được gắn tag trước lần đọc đầu tiên.
  await saveBot(c, S1, ACC.qr, [R_ADD, R_REM, { ...R_REM, name: 'Gỡ tag Một người', config: { ...R_REM.config, tagIds: ['9'] } }])
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(20)))
  let m = await env.mark(); let s = env.sends.length
  await env.tagTick()
  T('T00', 'Lần đọc đầu sau khi bật quy tắc: chỉ lấy mốc, người được gắn tag trước lần đọc này không nhận tin', (await env.jobsSince(m)).length === 0,
    { baselined: env.tagCalls.at(-1)?.items?.length }, true)

  // T01: nhịp đều, không đổi.
  m = await env.mark(); const calls0 = env.tagCalls.length
  await env.tagTick(2)
  T('T01', 'Không đổi gì, phiên bản giữ nguyên: chỉ gửi nhịp {a,v}, không xin danh sách, không tạo việc',
    (await env.jobsSince(m)).length === 0 && env.tagCalls.slice(calls0).every(x => x.items.every(i => !i.tags)), { calls: env.tagCalls.length - calls0 })

  // T02: gắn thêm 1 người vào tag có quy tắc "được gắn".
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(6)))
  await env.tagTick(); await env.drain()
  let jobs = await env.jobsSince(m)
  T('T02', 'Gắn tag "Khách mới" cho 1 người → 1 tin "được gắn" gửi đúng người, đúng nội dung',
    jobs.length === 1 && jobs[0].direction === 'added' && jobs[0].status === 'sent' && env.sendsSince(s).length === 1 && env.sendsSince(s)[0].uid === u(6) && /^Chào Khách 6, cảm ơn/.test(env.sendsSince(s)[0].text),
    { jobs: summarize(jobs), sends: env.sendsSince(s).map(x => x.text) })

  // T03: tag không có quy tắc.
  m = await env.mark()
  env.mutate(ACC.qr, L => L.get('7').conversations.push(u(10)))
  await env.tagTick(); await env.drain()
  T('T03', 'Gắn tag không có quy tắc → không tạo việc', (await env.jobsSince(m)).length === 0)

  // T04: gỡ 1 người khỏi tag có quy tắc "bị gỡ".
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => { const t = L.get('6'); t.conversations = t.conversations.filter(x => x !== u(3)) })
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T04', 'Gỡ tag "VIP" của 1 người → 1 tin "bị gỡ"', jobs.length === 1 && jobs[0].direction === 'removed' && jobs[0].status === 'sent' && env.sendsSince(s)[0]?.uid === u(3), { jobs: summarize(jobs) })

  // T05: chuyển người từ tag 6 sang tag 5 trong một lần đổi.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => { const t = L.get('6'); t.conversations = t.conversations.filter(x => x !== u(4)); L.get('5').conversations.push(u(4)) })
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T05', 'Chuyển 1 người từ "VIP" sang "Khách mới" → 2 quy tắc khác nhau, người đó nhận cả 2 tin cùng lúc',
    jobs.length === 2 && jobs.every(j => j.status === 'sent') && env.sendsSince(s).length === 2, { jobs: summarize(jobs) }, true)

  // T06: đổi tên tag.
  m = await env.mark()
  env.mutate(ACC.qr, L => { L.get('5').text = 'Khách mới 2026' })
  await env.tagTick(); await env.drain()
  T('T06', 'Đổi tên tag (phiên bản tăng, người giữ nguyên) → không tạo việc', (await env.jobsSince(m)).length === 0)

  // T07: phiên bản tăng, nội dung giữ nguyên.
  m = await env.mark()
  env.mutate(ACC.qr, () => {})
  await env.tagTick(); await env.drain()
  T('T07', 'Phiên bản tăng mà danh sách không đổi → không tạo việc', (await env.jobsSince(m)).length === 0)

  // T08: danh sách đổi nhưng Zalo chưa tăng phiên bản.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(11)), { bump: false })
  await env.tagTick(2)
  const silent = (await env.jobsSince(m)).length === 0
  env.mutate(ACC.qr, () => {})
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T08', 'Danh sách đổi mà phiên bản chưa tăng: chưa thấy; lần phiên bản tăng sau mới gửi (dựa vào Zalo tăng phiên bản)',
    silent && jobs.length === 1 && jobs[0].recipient_uid === u(11), { jobs: summarize(jobs) }, true)

  // T09: hội thoại nhóm được gắn tag.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.get('5').conversations.push('g' + '81234567890123456'))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T09', 'Gắn tag cho hội thoại nhóm (g…) → ghi bỏ qua not_person, không gửi', jobs.length === 1 && jobs[0].status === 'skipped' && jobs[0].reason_code === 'not_person' && env.sendsSince(s).length === 0, { jobs: summarize(jobs) })

  // T10: gắn hàng loạt 21 / đúng 20 người.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => { for (let i = 1; i <= 21; i++) L.get('5').conversations.push(uidOf(ACC.qr, 100 + i)) })
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T10', 'Gắn 21 người cùng lúc → 21 việc bỏ qua bulk_tag, không gửi', jobs.length === 21 && jobs.every(j => j.reason_code === 'bulk_tag') && env.sendsSince(s).length === 0, { n: jobs.length, reasons: [...new Set(jobs.map(j => j.reason_code))] })
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => { for (let i = 1; i <= 20; i++) L.get('5').conversations.push(uidOf(ACC.qr, 200 + i)) })
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T10b', 'Gắn đúng 20 người cùng lúc → 20 tin (người ngoài danh bạ vẫn nhận, tên lấy từ hồ sơ Zalo)', jobs.length === 20 && jobs.every(j => j.status === 'sent') && env.sendsSince(s).length === 20 && env.sendsSince(s).every(x => /^Chào Hồ sơ/.test(x.text)),
    { n: jobs.length, statuses: [...new Set(jobs.map(j => j.status))], sample: env.sendsSince(s)[0]?.text })

  // T11: mã hội thoại lạ.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => { L.get('5').conversations.push(' ' + u(12) + ' ', 'abc', '', null, '1'.repeat(41), u(13), u(13)) })
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T11', 'Mã hội thoại có dấu cách / chữ / rỗng / null / quá 40 số / trùng → chỉ nhận mã hợp lệ, mỗi người 1 tin',
    jobs.length === 2 && new Set(jobs.map(j => j.recipient_uid)).size === 2 && jobs.every(j => [u(12), u(13)].includes(j.recipient_uid)), { jobs: summarize(jobs) })

  // T11b: mã tag lạ (zca-js trả số; tag có ký tự lạ bị bỏ).
  m = await env.mark()
  env.mutate(ACC.qr, L => { L.set('x y', { id: 'x y', text: 'lạ', conversations: [u(14)] }) })
  await env.tagTick(); await env.drain()
  T('T11b', 'Tag có mã không hợp lệ → bỏ qua, không lỗi nhịp', (await env.jobsSince(m)).length === 0 && !(env.tagWarn && /sync/.test(env.tagWarn[0])), { warn: env.tagWarn })

  // T12: xoá tag có từ 2 người.
  env.mutate(ACC.qr, L => L.get('6').conversations.push(u(23), u(24)))
  await env.tagTick()
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.delete('6'))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T12', 'Xoá tag "VIP" còn ≥ 2 người → ghi bỏ qua tag_deleted, không gửi', jobs.length >= 2 && jobs.every(j => j.reason_code === 'tag_deleted') && env.sendsSince(s).length === 0, { jobs: summarize(jobs) })

  // T13: xoá tag chỉ có 1 người.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.delete('9'))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T13', 'Xoá tag chỉ có 1 người → không phân biệt được với gỡ tag, người đó nhận tin "bị gỡ"', jobs.length === 1 && jobs[0].status === 'sent', { jobs: summarize(jobs) }, true)

  // T14: gỡ rồi gắn lại trong khoảng cách tối thiểu (720 phút mặc định).
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => { const t = L.get('5'); t.conversations = t.conversations.filter(x => x !== u(6)) })
  await env.tagTick()
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(6)))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T14', 'Gỡ rồi gắn lại người vừa nhận tin (trong 12 giờ) → bỏ qua min_gap', jobs.length === 1 && jobs[0].reason_code === 'min_gap' && env.sendsSince(s).length === 0, { jobs: summarize(jobs) })

  // T15: đọc tag lỗi một nhịp rồi đọc lại được.
  m = await env.mark(); s = env.sends.length
  env.readFail.add(ACC.qr)
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(15)))
  await env.tagTick()
  env.readFail.delete(ACC.qr)
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T15', 'getLabels lỗi một nhịp → nhịp sau đọc được vẫn gửi đúng 1 tin', jobs.length === 1 && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // T16: mất phiên quá stale_minutes (30) rồi có lại.
  m = await env.mark(); s = env.sends.length
  env.sessionless.add(ACC.qr)
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(16)))
  await env.tagTick()
  await c.query(`UPDATE auto_zalo_tag_sync_accounts SET last_seen_at = last_seen_at - interval '31 minutes' WHERE account_id=$1`, [ACC.qr])
  env.sessionless.delete(ACC.qr)
  await env.tagTick(); await env.drain()
  T('T16', 'Mất phiên Zalo > 30 phút: lần đọc lại chỉ lấy mốc, người được gắn tag lúc mất phiên không nhận tin', (await env.jobsSince(m)).length === 0, {}, true)

  // T16b: mất phiên ngắn (< 30 phút).
  m = await env.mark()
  env.sessionless.add(ACC.qr)
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(17)))
  await env.tagTick(5)
  env.sessionless.delete(ACC.qr)
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T16b', 'Mất phiên 5 phút → đọc lại vẫn gửi người được gắn tag lúc đó', jobs.length === 1 && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // T17: người trong danh sách không gửi.
  m = await env.mark(); s = env.sends.length
  await control(c, S1, 'exclusion_add', { accountId: ACC.qr, items: [{ kind: 'uid', value: u(18) }] })
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(18)))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T17', 'Gắn tag người nằm trong danh sách không gửi → bỏ qua excluded', jobs.length === 1 && jobs[0].reason_code === 'excluded' && env.sendsSince(s).length === 0, { jobs: summarize(jobs) })

  // T18: hai quy tắc cùng tag cùng chiều.
  await saveBot(c, S1, ACC.qr, [...await existingRules(c, ACC.qr), { ...R_ADD, name: 'Gắn tag Khách mới (2)', config: { ...R_ADD.config, message: 'Tin thứ hai' } }])
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(19)))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T18', 'Hai quy tắc cùng tag + cùng chiều → chỉ quy tắc đứng trên chạy, người nhận 1 tin', jobs.length === 1 && env.sendsSince(s).length === 1 && !/Tin thứ hai/.test(env.sendsSince(s)[0]?.text || ''), { jobs: summarize(jobs) })

  // T19: tắt bot rồi bật lại trong 30 phút.
  const rulesNow = await existingRules(c, ACC.qr)
  await saveBot(c, S1, ACC.qr, rulesNow, { enabled: false })
  env.tagRt.desktop.refreshSoon(); env.tagRt.server.refreshSoon()
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(21)))
  await env.tagTick(3)
  const whileOff = (await env.jobsSince(m)).length
  await saveBot(c, S1, ACC.qr, await existingRules(c, ACC.qr), { enabled: true })
  env.tagRt.desktop.refreshSoon()
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T19', 'Tắt bot, gắn tag lúc tắt, bật lại sau 3 phút → sổ tag lấy mốc lại, không gửi bù người được gắn lúc tắt',
    whileOff === 0 && jobs.length === 0, { whileOff, jobs: summarize(jobs) })
  m = await env.mark()
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(25)))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T19b', 'Sau khi bật lại: người được gắn tag tiếp theo nhận tin bình thường', jobs.length === 1 && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // T20: tài khoản Zalo Server qua App Server.
  await saveBot(c, S1, ACC.server, [R_ADD])
  env.label(ACC.server, 5, 'Khách mới', [uidOf(ACC.server, 1)])
  await env.tagTick(3) // App Server đọc lại danh sách tài khoản mỗi 2 phút: lần đọc đầu lấy mốc
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.server, L => L.get('5').conversations.push(uidOf(ACC.server, 2)))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T20', 'Tài khoản Zalo Server: App Server đọc tag, gửi đúng 1 tin', jobs.length === 1 && jobs[0].status === 'sent' && env.sendsSince(s)[0]?.accountId === ACC.server, { jobs: summarize(jobs) })

  // T21: Zalo trình duyệt.
  await saveBot(c, S1, ACC.web, [R_ADD])
  env.label(ACC.web, 5, 'Khách mới', [uidOf(ACC.web, 1)])
  env.tagRt.desktop.refreshSoon()
  await env.tagTick()
  m = await env.mark()
  env.mutate(ACC.web, L => L.get('5').conversations.push(uidOf(ACC.web, 2)))
  await env.tagTick(2); await env.drain()
  const watchedWeb = (await asDesktop(c, S1, 'SELECT public.aka_agent_desktop_zalo_tag_sync_accounts() r')).accountIds || []
  T('T21', 'Zalo trình duyệt: không được hỏi tag, quy tắc tag không bao giờ chạy', (await env.jobsSince(m)).length === 0 && !watchedWeb.map(Number).includes(ACC.web), { watched: watchedWeb }, true)

  // T22: người gắn tag là chính tài khoản / người có UID số lớn đi qua JSON số (không xảy ra với zca-js: conversations là chuỗi).
  m = await env.mark()
  env.mutate(ACC.qr, L => L.get('5').conversations.push(Number('7000000000001001777')))
  await env.tagTick(); await env.drain()
  jobs = await env.jobsSince(m)
  T('T22', 'Mã hội thoại dạng số JS (mất chính xác) → vẫn đúng 1 tin cho chuỗi đã làm tròn (zca-js trả chuỗi nên không gặp)', jobs.length <= 1, { jobs: summarize(jobs) }, true)

  // T23: bot dừng 2 phút sau khi có việc (tài khoản mất phiên): việc hết hạn 30 phút, không gửi muộn.
  m = await env.mark(); s = env.sends.length
  env.mutate(ACC.qr, L => L.get('5').conversations.push(u(22)))
  await env.tagTick()
  await c.query(`UPDATE auto_event_bot_jobs SET send_after = send_after - interval '40 minutes', expires_at = expires_at - interval '40 minutes', created_at = created_at - interval '40 minutes' WHERE id > $1`, [m])
  await c.query('SELECT private.aka_agent_event_bot_maintenance()')
  await env.drain()
  jobs = await env.jobsSince(m)
  T('T23', 'Việc chờ quá 30 phút (máy tắt) → hết hạn, không gửi muộn', jobs.length === 1 && jobs[0].status !== 'sent' && env.sendsSince(s).length === 0, { jobs: summarize(jobs) })

  await env.close()
}

// =====================================================================================================================
// Nhóm điều kiện (Bộ lọc động production)
// =====================================================================================================================
async function groupSuite(cluster) {
  const env = await makeEnv(cluster)
  const { c } = env
  const G = (id, title, ok, detail, known) => check('group', id, title, ok, detail, known)
  const mkGroup = async (name, rules, { bound = null, staff = S1 } = {}) => {
    const g = Number((await c.query(`INSERT INTO auto_account_contact_groups (contact_type, name, staff_id, organization_id, purpose, data_type_category_item_id, bound_zalo_account_id)
      VALUES ('person',$1,$2,$3,'data_group',40,$4) RETURNING id`, [name, staff, ORG, bound])).rows[0].id)
    const f = Number((await c.query(`INSERT INTO auto_account_contact_group_dynamic_filters (group_id, staff_id, organization_id, is_enabled, effective_from_at) VALUES ($1,$2,$3,true, clock_timestamp() - interval '1 minute') RETURNING id`, [g, staff, ORG])).rows[0].id)
    let k = 0
    for (const r of rules) {
      await c.query(`INSERT INTO auto_account_contact_group_dynamic_filter_rules (dynamic_filter_id, scope_category_item_id, join_category_item_id, field_category_item_id, operator_category_item_id, sort_order, value_keys)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`, [f, r.scope === 'leave' ? 203 : 202, r.join === 'or' ? 205 : 204, { zalo_tag: 212, akabiz_tag: 213, zalo_group_membership: 214, zalo_friend_status: 215 }[r.field], { contains: 206, not_contains: 207, equals: 208, in: 210 }[r.op], k++, JSON.stringify(r.values)])
    }
    return { g, f }
  }
  const botRule = (g, { enter = true, leave = true, gap = 0 } = {}) => ({ eventType: 'condition_group', name: 'Nhóm ' + g, enabled: true, dataGroupId: g, minGapMinutes: gap,
    config: { onEnter: { enabled: enter, message: 'Chào mừng #{FULL_NAME} vào nhóm' }, onLeave: { enabled: leave, message: 'Tạm biệt #{FULL_NAME}' }, delay: { minSeconds: 0, maxSeconds: 5 } } })
  const contactId = async (acc, i) => Number((await c.query(`SELECT id FROM auto_account_contacts WHERE account_id=$1 AND uid=$2 AND contact_type='person'`, [acc, uidOf(acc, i)])).rows[0].id)
  const ruleOf = async (acc, g) => Number((await c.query(`SELECT id FROM auto_event_bot_rules WHERE account_id=$1 AND data_group_id=$2 AND NOT is_delete`, [acc, g])).rows[0]?.id)
  const step = async () => { const w = await env.worker(); await env.drain(); return w }

  const friends = await mkGroup('Bạn bè', [{ field: 'zalo_friend_status', op: 'equals', values: ['friend'] }])
  const inGroup = await mkGroup('Thành viên nhóm Zalo', [{ field: 'zalo_group_membership', op: 'in', values: [`${ACC.qr}:G777`] }])
  const tagged = await mkGroup('Tag Zalo 5', [{ field: 'zalo_tag', op: 'contains', values: ['5'] }])
  const chatTag = await mkGroup('Tag Chat', [{ field: 'zalo_tag', op: 'contains', values: [`${ACC.chat}:T1`] }])
  const akaTag = await mkGroup('Tag akaBiz', [{ field: 'akabiz_tag', op: 'contains', values: ['77'] }])
  const mixed = await mkGroup('Bạn bè nhưng chưa vào nhóm', [{ field: 'zalo_friend_status', op: 'equals', values: ['friend'] }, { scope: 'leave', field: 'zalo_group_membership', op: 'in', values: [`${ACC.qr}:G888`] }])
  await c.query(`INSERT INTO auto_contact_tags (id, staff_id, organization_id, name) VALUES (77, $1, $2, 'VIP akaBiz')`, [S1, ORG])
  await saveBot(c, S1, ACC.qr, [botRule(friends.g), botRule(inGroup.g), botRule(tagged.g), botRule(akaTag.g), botRule(mixed.g, { leave: false })])
  await saveBot(c, S1, ACC.chat, [botRule(chatTag.g), botRule(friends.g)])

  // Lấy mốc đúng như sau lần lưu bộ lọc: hàng đợi sạch.
  await c.query('DELETE FROM auto_account_contact_dynamic_filter_queue')

  // G01: trở thành bạn bè (quét danh sách bạn bè ghi is_friend = true).
  let m = await env.mark(); let s = env.sends.length
  await c.query(`UPDATE auto_account_contacts SET is_friend=true, updated_at=now() WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 1)])
  let w = await step()
  let jobs = await env.jobsSince(m)
  G('G01', 'Đồng ý kết bạn (is_friend → true) → vào "Bạn bè" (+ "Bạn bè nhưng chưa vào nhóm") → tin chào mừng',
    pick(jobs, j => j.direction === 'enter' && j.status === 'sent').length === 2 && env.sendsSince(s).every(x => x.uid === uidOf(ACC.qr, 1) && /^Chào mừng Khách 1/.test(x.text)), { worker: w, jobs: summarize(jobs) })

  // G02: huỷ kết bạn.
  m = await env.mark(); s = env.sends.length
  await c.query(`UPDATE auto_account_contacts SET is_friend=false, updated_at=now() WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 1)])
  await step(); jobs = await env.jobsSince(m)
  G('G02', 'Huỷ kết bạn → rời "Bạn bè" → tin tạm biệt (nhóm kia tắt tin rời)', jobs.length === 1 && jobs[0].direction === 'leave' && jobs[0].status === 'sent' && /^Tạm biệt/.test(env.sendsSince(s)[0]?.text || ''), { jobs: summarize(jobs) })

  // G03: vào nhóm Zalo (quét thành viên nhóm ghi zalo_group_members).
  m = await env.mark(); s = env.sends.length
  await c.query(`INSERT INTO zalo_group_members (account_id, zalo_uid, zalo_group_id, staff_id, organization_id) VALUES ($1,$2,'G777',$3,$4)`, [ACC.qr, uidOf(ACC.qr, 2), S1, ORG])
  await step(); jobs = await env.jobsSince(m)
  G('G03', 'Vào nhóm Zalo G777 (quét thành viên) → vào nhóm điều kiện → tin chào mừng', jobs.length === 1 && jobs[0].direction === 'enter' && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // G04: rời nhóm Zalo (quét lại không thấy: is_current = false).
  m = await env.mark()
  await c.query(`UPDATE zalo_group_members SET is_current=false, updated_at=now() WHERE account_id=$1 AND zalo_uid=$2 AND zalo_group_id='G777'`, [ACC.qr, uidOf(ACC.qr, 2)])
  await step(); jobs = await env.jobsSince(m)
  G('G04', 'Rời nhóm Zalo (is_current → false) → tin tạm biệt', jobs.length === 1 && jobs[0].direction === 'leave' && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // G05: vào lại rồi bị xoá hẳn dòng thành viên.
  await c.query(`UPDATE zalo_group_members SET is_current=true, updated_at=now() WHERE account_id=$1 AND zalo_uid=$2`, [ACC.qr, uidOf(ACC.qr, 2)])
  await step()
  m = await env.mark()
  await c.query(`DELETE FROM zalo_group_members WHERE account_id=$1 AND zalo_uid=$2`, [ACC.qr, uidOf(ACC.qr, 2)])
  await step(); jobs = await env.jobsSince(m)
  G('G05', 'Vào lại nhóm Zalo rồi dòng thành viên bị xoá → rời → tin tạm biệt', jobs.length === 1 && jobs[0].direction === 'leave' && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // G06: hai thay đổi bù nhau trước khi job chạy.
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 3)])
  await c.query(`UPDATE auto_account_contacts SET is_friend=false WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 3)])
  await step()
  G('G06', 'Kết bạn rồi huỷ trước khi job lọc chạy (30 giây) → không đổi gì, không gửi', (await env.jobsSince(m)).length === 0)

  // G07: sửa thông tin khác của người đang trong nhóm.
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 4)])
  await step()
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET extra_data = '{"note":"đổi"}'::jsonb WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 4)])
  await step()
  G('G07', 'Người đang trong nhóm đổi thông tin khác → xét lại nhưng vẫn trong nhóm → không gửi lại', (await env.jobsSince(m)).length === 0)

  // G08: bị xoá khỏi danh bạ (is_delete).
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_delete=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 4)])
  await step(); jobs = await env.jobsSince(m)
  G('G08', 'Liên hệ bị xoá trong app → rời nhóm điều kiện nhưng không gửi tin tạm biệt', pick(jobs, j => j.direction === 'leave').length === 0, { jobs: summarize(jobs) })

  // G09: tag do chiến dịch gắn (chép vào extra_data.zaloTagIds, chỉ thêm, không bao giờ gỡ).
  m = await env.mark(); s = env.sends.length
  await c.query(`UPDATE auto_account_contacts SET extra_data = jsonb_build_object('zaloTagIds', '["5"]'::jsonb, 'zaloTags', '[{"id":"5","name":"Khách mới"}]'::jsonb) WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 5)])
  await step(); jobs = await env.jobsSince(m)
  G('G09', 'Chiến dịch gắn tag 5 (app chép vào liên hệ) → vào nhóm "Tag Zalo 5" → tin chào mừng', jobs.length === 1 && jobs[0].direction === 'enter' && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // G10: gắn / gỡ tag ngay trong Zalo của tài khoản QR không có akaChat (chỉ sổ tag V660 đổi).
  env.label(ACC.qr, 5, 'Khách mới', [])
  await env.tagTick()
  m = await env.mark()
  env.mutate(ACC.qr, L => L.get('5').conversations.push(uidOf(ACC.qr, 6)))
  await env.tagTick(); await step()
  env.mutate(ACC.qr, L => { L.get('5').conversations = [] ; L.get('5').conversations.push(uidOf(ACC.qr, 7)) })
  await env.tagTick(); await step()
  jobs = await env.jobsSince(m)
  G('G10', 'Gắn / gỡ tag trực tiếp trong Zalo (tài khoản không có akaChat) → nhóm điều kiện "Tag Zalo" không đổi, không gửi (Bộ lọc động chưa đọc sổ tag V660)',
    jobs.filter(j => j.event_type === 'condition_group').length === 0, { jobs: summarize(jobs) }, true)

  // G11: tài khoản có akaChat: tag hội thoại trong Chat.
  const conv = Number((await c.query(`INSERT INTO chat_zalo_account_conversation (chat_zalo_account_id, zalo_id, conversation_type) VALUES (501,$1,'user') RETURNING id`, [uidOf(ACC.chat, 1)])).rows[0].id)
  const ctag = Number((await c.query(`INSERT INTO chat_zalo_account_tag (chat_zalo_account_id, zalo_id, name) VALUES (501,'T1','Quan tâm') RETURNING id`)).rows[0].id)
  m = await env.mark(); s = env.sends.length
  const link = Number((await c.query(`INSERT INTO chat_zalo_account_conversation_tag (chat_zalo_account_id, chat_zalo_account_conversation_id, chat_zalo_account_tag_id) VALUES (501,$1,$2) RETURNING id`, [conv, ctag])).rows[0].id)
  await step(); jobs = await env.jobsSince(m)
  G('G11', 'akaChat: gắn tag T1 cho hội thoại → vào nhóm "Tag Chat" → tin chào mừng từ tài khoản 1004', jobs.length === 1 && jobs[0].direction === 'enter' && jobs[0].status === 'sent' && env.sendsSince(s)[0]?.accountId === ACC.chat, { jobs: summarize(jobs) })
  m = await env.mark()
  await c.query('DELETE FROM chat_zalo_account_conversation_tag WHERE id=$1', [link])
  await step(); jobs = await env.jobsSince(m)
  G('G12', 'akaChat: gỡ tag T1 → rời nhóm → tin tạm biệt', jobs.length === 1 && jobs[0].direction === 'leave' && jobs[0].status === 'sent', { jobs: summarize(jobs) })

  // G13: akaChat: người chưa có trong danh bạ.
  const conv2 = Number((await c.query(`INSERT INTO chat_zalo_account_conversation (chat_zalo_account_id, zalo_id, conversation_type) VALUES (501,'8800000000000000001','user') RETURNING id`)).rows[0].id)
  m = await env.mark(); s = env.sends.length
  await c.query(`INSERT INTO chat_zalo_account_conversation_tag (chat_zalo_account_id, chat_zalo_account_conversation_id, chat_zalo_account_tag_id) VALUES (501,$1,$2)`, [conv2, ctag])
  await step(); jobs = await env.jobsSince(m)
  G('G13', 'akaChat: gắn tag cho người chưa có trong danh bạ → trigger tạo liên hệ → vào nhóm → tin (tên = mã Zalo nên lấy tên từ hồ sơ Zalo)',
    jobs.length === 1 && jobs[0].status === 'sent', { jobs: summarize(jobs), text: env.sendsSince(s)[0]?.text })

  // G13b: akaChat: tag cho hội thoại nhóm.
  const convG = Number((await c.query(`INSERT INTO chat_zalo_account_conversation (chat_zalo_account_id, zalo_id, conversation_type) VALUES (501,'5550000000000000001','group') RETURNING id`)).rows[0].id)
  m = await env.mark()
  await c.query(`INSERT INTO chat_zalo_account_conversation_tag (chat_zalo_account_id, chat_zalo_account_conversation_id, chat_zalo_account_tag_id) VALUES (501,$1,$2)`, [convG, ctag])
  await step()
  G('G13b', 'akaChat: gắn tag cho hội thoại nhóm → không vào nhóm điều kiện người, không gửi', (await env.jobsSince(m)).length === 0)

  // G14: tag akaBiz.
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET akabiz_tag_ids = '{77}' WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 8)])
  await step(); jobs = await env.jobsSince(m)
  G('G14', 'Gắn tag akaBiz 77 → vào nhóm "Tag akaBiz" → tin chào mừng', jobs.length === 1 && jobs[0].direction === 'enter' && jobs[0].status === 'sent', { jobs: summarize(jobs) })
  m = await env.mark()
  await c.query(`UPDATE auto_contact_tags SET is_delete=true WHERE id=77`)
  await c.query(`UPDATE auto_account_contacts SET updated_at=now(), extra_data = COALESCE(extra_data,'{}'::jsonb) || '{"t":1}' WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 9)])
  await step()
  G('G14b', 'Xoá tag akaBiz 77: người đang trong nhóm chưa được xét lại tới khi liên hệ đó đổi (không có ai rời ngay)', (await env.jobsSince(m)).length === 0, {}, true)

  // G15: điều kiện ra (bạn bè nhưng vào nhóm G888 thì không thuộc).
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 10)])
  await step()
  m = await env.mark()
  await c.query(`INSERT INTO zalo_group_members (account_id, zalo_uid, zalo_group_id, staff_id, organization_id) VALUES ($1,$2,'G888',$3,$4)`, [ACC.qr, uidOf(ACC.qr, 10), S1, ORG])
  await step(); jobs = await env.jobsSince(m)
  G('G15', 'Khớp điều kiện ra (vào nhóm G888) → rời "Bạn bè nhưng chưa vào nhóm"; quy tắc tắt tin rời → không gửi', jobs.length === 0, { jobs: summarize(jobs) })

  // G16: người của tài khoản khác (cùng nhân viên) vào nhóm điều kiện.
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.server, uidOf(ACC.server, 1)])
  await step(); jobs = await env.jobsSince(m)
  const memberOther = Number((await c.query(`SELECT count(*) n FROM auto_account_contact_group_members m JOIN auto_account_contacts ct ON ct.id=m.contact_id WHERE m.group_id=$1 AND ct.account_id=$2 AND NOT m.is_delete`, [friends.g, ACC.server])).rows[0].n)
  G('G16', 'Liên hệ của tài khoản Server vào nhóm "Bạn bè" (nhóm không gắn tài khoản) → chỉ quy tắc của chính tài khoản đó chạy; tài khoản 1001 không gửi', memberOther === 1 && jobs.length === 0, { memberOther, jobs: summarize(jobs) }, true)

  // G17: người trong danh sách không gửi.
  await control(c, S1, 'exclusion_add', { accountId: ACC.qr, items: [{ kind: 'uid', value: uidOf(ACC.qr, 11) }] })
  m = await env.mark(); s = env.sends.length
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 11)])
  await step(); jobs = await env.jobsSince(m)
  G('G17', 'Người trong danh sách không gửi vào nhóm → bỏ qua excluded', jobs.length >= 1 && jobs.every(j => j.reason_code === 'excluded') && env.sendsSince(s).length === 0, { jobs: summarize(jobs) })

  // G18: liên hệ không có UID.
  await c.query(`UPDATE auto_account_contacts SET uid=NULL WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 12)])
  const noUid = Number((await c.query(`SELECT id FROM auto_account_contacts WHERE account_id=$1 AND uid IS NULL AND contact_type='person' LIMIT 1`, [ACC.qr])).rows[0].id)
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE id=$1`, [noUid])
  await step(); jobs = await env.jobsSince(m)
  G('G18', 'Liên hệ không có UID vào nhóm → bỏ qua no_uid, không gửi', jobs.every(j => j.reason_code === 'no_uid'), { jobs: summarize(jobs) })

  // G19: khoảng cách tối thiểu cho nhóm điều kiện.
  await saveBot(c, S1, ACC.qr, (await existingRules(c, ACC.qr)).map(r => r.dataGroupId === inGroup.g ? { ...r, minGapMinutes: 60 } : r))
  m = await env.mark(); s = env.sends.length
  for (const cur of [true, false, true]) {
    if (cur) await c.query(`INSERT INTO zalo_group_members (account_id, zalo_uid, zalo_group_id, staff_id, organization_id) VALUES ($1,$2,'G777',$3,$4) ON CONFLICT (account_id, zalo_group_id, zalo_uid) DO UPDATE SET is_current=true`, [ACC.qr, uidOf(ACC.qr, 13), S1, ORG])
    else await c.query(`UPDATE zalo_group_members SET is_current=false WHERE account_id=$1 AND zalo_uid=$2`, [ACC.qr, uidOf(ACC.qr, 13)])
    await step()
  }
  jobs = await env.jobsSince(m)
  G('G19', 'Vào → rời → vào lại trong 60 phút (khoảng cách 60) → lần vào thứ hai bỏ qua min_gap',
    summarize(jobs).join() === [`condition_group/enter/sent→…${uidOf(ACC.qr, 13).slice(-4)}`, `condition_group/leave/sent→…${uidOf(ACC.qr, 13).slice(-4)}`, `condition_group/enter/skipped:min_gap→…${uidOf(ACC.qr, 13).slice(-4)}`].join(), { jobs: summarize(jobs) })

  // G20: người vào nhóm điều kiện mà đã nằm trong nhóm qua nguồn khác (tải file).
  const cid = await contactId(ACC.qr, 14)
  const mem = Number((await c.query(`INSERT INTO auto_account_contact_group_members (group_id, contact_id) VALUES ($1,$2) RETURNING id`, [friends.g, cid])).rows[0].id)
  await c.query(`INSERT INTO auto_account_contact_group_member_origins (membership_id, kind, is_current) VALUES ($1,'upload',true)`, [mem])
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE id=$1`, [cid]); await step()
  await c.query(`UPDATE auto_account_contacts SET is_friend=false WHERE id=$1`, [cid]); await step()
  jobs = await env.jobsSince(m)
  const still = (await c.query('SELECT is_delete FROM auto_account_contact_group_members WHERE id=$1', [mem])).rows[0].is_delete === false
  const rf = await ruleOf(ACC.qr, friends.g)
  G('G20', 'Người đã có trong nhóm "Bạn bè" (tải file) thoả rồi hết thoả bộ lọc → vẫn ở trong nhóm nhưng nhận cả tin chào và tin tạm biệt của nhóm đó',
    still && pick(jobs, j => Number(j.rule_id) === rf && j.status === 'sent').map(j => j.direction).join() === 'enter,leave', { still, jobs: summarize(jobs) }, true)

  // G21: nhóm gắn tài khoản + liên hệ tài khoản khác.
  const bound = await mkGroup('Bạn bè 1001', [{ field: 'zalo_friend_status', op: 'equals', values: ['friend'] }], { bound: ACC.qr })
  await saveBot(c, S1, ACC.server, [botRule(bound.g)]).catch(e => { env.boundSaveErr = e.message })
  G('G21', 'Quy tắc nhóm gắn tài khoản 1001 cho tài khoản 1002 → DB từ chối lúc lưu', !!env.boundSaveErr, { err: (env.boundSaveErr || '').slice(0, 120) })

  // G22: tài khoản gắn nhóm hết gói Zalo QR → bộ lọc bỏ qua.
  await saveBot(c, S1, ACC.qr, [...await existingRules(c, ACC.qr), botRule(bound.g)])
  await c.query(`INSERT INTO test_org_no_entitlement VALUES ($1,'qr')`, [ORG])
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 15)])
  await step(); jobs = await env.jobsSince(m)
  const rb = await ruleOf(ACC.qr, bound.g)
  G('G22', 'Hết gói Zalo QR: nhóm gắn tài khoản QR không nhận ai; nhóm không gắn tài khoản vẫn nhận → bot gửi tin của nhóm không gắn',
    jobs.length >= 1 && jobs.every(j => j.status === 'sent') && !jobs.some(j => Number(j.rule_id) === rb), { jobs: summarize(jobs) })
  await c.query('DELETE FROM test_org_no_entitlement')

  // G23: bộ lọc tắt.
  await c.query('UPDATE auto_account_contact_group_dynamic_filters SET is_enabled=false WHERE id=$1', [friends.f])
  m = await env.mark()
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 16)])
  await step(); jobs = await env.jobsSince(m)
  G('G23', 'Bộ lọc của nhóm "Bạn bè" bị tắt → không gửi tin của nhóm đó (các nhóm khác vẫn chạy)', !jobs.some(j => Number(j.rule_id) === rf) && jobs.length >= 1, { jobs: summarize(jobs) })
  await c.query('UPDATE auto_account_contact_group_dynamic_filters SET is_enabled=true WHERE id=$1', [friends.f])

  // G24: lưu lại bộ lọc (effective_from_at mới): thay đổi cũ trong hàng đợi không tính.
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 17)])
  await c.query(`UPDATE auto_account_contact_group_dynamic_filters SET effective_from_at = clock_timestamp() + interval '1 second', revision = revision + 1`)
  m = await env.mark()
  await step(); jobs = await env.jobsSince(m)
  G('G24', 'Đổi xảy ra trước lúc lưu lại bộ lọc → không tính (chỉ thay đổi sau lúc lưu)', pick(jobs, j => j.recipient_uid === uidOf(ACC.qr, 17)).length === 0, { jobs: summarize(jobs) })
  await c.query(`UPDATE auto_account_contact_group_dynamic_filters SET effective_from_at = clock_timestamp() - interval '1 minute'`)

  // G25: 2 job lọc chạy cùng lúc (cron + hàng đợi dồn): không tạo việc trùng.
  m = await env.mark(); s = env.sends.length
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.qr, uidOf(ACC.qr, 18)])
  const [x1, x2] = [await env.conns[0], await env.conns[1]]
  await Promise.all([x1.query('SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5,100)'), x2.query('SELECT public.aka_agent_run_data_group_dynamic_filter_worker(5,100)')])
  await env.drain(); jobs = await env.jobsSince(m)
  G('G25', 'Hai lượt job lọc chạy đồng thời → mỗi nhóm khớp (3 nhóm) đúng 1 tin, không trùng', jobs.length === 3 && jobs.every(j => j.status === 'sent') && new Set(jobs.map(j => j.rule_id)).size === jobs.length, { jobs: summarize(jobs) })

  // G26: nhóm điều kiện của nhân viên khác cùng tổ chức (tài khoản 1011) không lẫn.
  const other = await mkGroup('Bạn bè NV2', [{ field: 'zalo_friend_status', op: 'equals', values: ['friend'] }], { staff: S2 })
  await saveBot(c, S2, ACC.other, [botRule(other.g)])
  m = await env.mark(); s = env.sends.length
  await c.query(`UPDATE auto_account_contacts SET is_friend=true WHERE account_id=$1 AND uid=$2`, [ACC.other, uidOf(ACC.other, 1)])
  await step(); jobs = await env.jobsSince(m)
  G('G26', 'Nhân viên khác: liên hệ của tài khoản 1011 vào nhóm của NV2 → tin từ 1011, nhóm của NV1 không nhận', jobs.length === 1 && env.sendsSince(s)[0]?.accountId === ACC.other, { jobs: summarize(jobs) })

  await env.close()
}

// =====================================================================================================================
// Sinh nhật
// =====================================================================================================================
async function birthdaySuite(cluster) {
  const env = await makeEnv(cluster)
  const { c } = env
  const B = (id, title, ok, detail, known) => check('birthday', id, title, ok, detail, known)
  const vn = (await c.query(`SELECT to_char(timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date, 'DD/MM') d, to_char(timezone('Asia/Ho_Chi_Minh', clock_timestamp())::date + 1, 'DD/MM') t`)).rows[0]
  const R = { eventType: 'birthday', name: 'Sinh nhật', enabled: true, config: { sendTime: '00:00', message: 'Chúc mừng sinh nhật #{FULL_NAME}! 🎂' } }
  const friend = (acc, i, sdob, extra = {}) => ({ userId: uidOf(acc, i), username: 'u' + i, displayName: 'Bạn ' + i, zaloName: 'Z' + i, avatar: '', gender: 0, dob: 0, sdob, ...extra })
  const rows = []
  for (let i = 1; i <= 1200; i++) rows.push(friend(ACC.qr, 1000 + i, i % 3 === 0 ? '01/01/1990' : i % 3 === 1 ? '' : null))
  const cases = [
    ['B01', `sdob "${vn.d}/1990"`, friend(ACC.qr, 1, `${vn.d}/1990`), true],
    ['B02', `sdob "${vn.d}" (không năm)`, friend(ACC.qr, 2, vn.d), true],
    ['B03', 'sdob rỗng', friend(ACC.qr, 3, ''), false],
    ['B04', 'sdob null', friend(ACC.qr, 4, null), false],
    ['B05', `sdob ngày mai "${vn.t}/1990"`, friend(ACC.qr, 5, `${vn.t}/1990`), false],
    ['B06', 'sdob "00/00/0000"', friend(ACC.qr, 6, '00/00/0000'), false],
    ['B07', 'displayName rỗng → tên lấy zaloName', friend(ACC.qr, 7, vn.d, { displayName: '' }), true],
    ['B08', 'không có userId (chỉ uid)', { uid: uidOf(ACC.qr, 8), displayName: 'Bạn 8', sdob: vn.d }, true],
    ['B09', 'không có mã người', { displayName: 'Không mã', sdob: vn.d }, false]
  ]
  rows.splice(10, 0, ...cases.map(x => x[2]))
  rows.splice(700, 0, friend(ACC.qr, 1, `${vn.d}/1990`)) // B10: trùng ở trang 2
  rows.push(friend(ACC.qr, 11, vn.d)) // B11: trang 3
  rows.push(friend(ACC.qr, 12, vn.d)) // B12: trong danh sách không gửi
  env.friends.set(ACC.qr, { rows, failPage: 2 })
  await saveBot(c, S1, ACC.qr, [R])
  await control(c, S1, 'exclusion_add', { accountId: ACC.qr, items: [{ kind: 'uid', value: uidOf(ACC.qr, 12) }] })

  // Lần quét đầu: trang 2 lỗi → cả lượt quét thất bại, không tạo việc dở dang; 30 phút sau quét lại.
  let m = await env.mark()
  await env.bots[0].rt.tick()
  const afterFail = (await env.jobsSince(m)).length
  B('B13', 'Trang 2 danh sách bạn bè lỗi → không tạo việc nửa chừng, chờ quét lại', afterFail === 0, { afterFail })
  env.bots[0].bump(31 * 60_000)
  const s = env.sends.length
  await env.drain()
  const jobs = await env.jobsSince(m)
  const sentUids = env.sendsSince(s).map(x => x.uid)
  for (const [id, title, row, want] of cases) {
    const uid = String(row.userId || row.uid || '')
    const got = uid ? sentUids.filter(u => u === uid).length : 0
    B(id, title + (want ? ' → gửi 1 tin' : ' → không gửi'), want ? got === 1 : got === 0, { got })
  }
  B('B10', 'Cùng người xuất hiện ở 2 trang → 1 tin', sentUids.filter(u => u === uidOf(ACC.qr, 1)).length === 1)
  B('B11', 'Người ở trang 3 (1.200 bạn bè, 3 trang 500) → vẫn được quét', sentUids.includes(uidOf(ACC.qr, 11)))
  B('B12', 'Người trong danh sách không gửi → bỏ qua excluded', jobs.some(j => j.recipient_uid === uidOf(ACC.qr, 12) && j.reason_code === 'excluded') && !sentUids.includes(uidOf(ACC.qr, 12)), { jobs: summarize(jobs.filter(j => j.recipient_uid === uidOf(ACC.qr, 12))) })
  B('B14', 'Tên trong tin: displayName, rỗng thì zaloName', env.sendsSince(s).some(x => x.uid === uidOf(ACC.qr, 1) && /Bạn 1!/.test(x.text)) && env.sendsSince(s).some(x => x.uid === uidOf(ACC.qr, 7) && /Z7!/.test(x.text)),
    { sample: env.sendsSince(s).filter(x => [uidOf(ACC.qr, 1), uidOf(ACC.qr, 7)].includes(x.uid)).map(x => x.text) })

  // Quét lại cùng ngày (đặt lại dấu đã quét): không gửi trùng.
  await c.query('UPDATE auto_event_bot_settings SET birthday_scanned_on = NULL WHERE account_id=$1', [ACC.qr])
  const s2 = env.sends.length
  // App mở lại: tiến trình mới quên lần quét trong RAM, chỉ còn dấu birthday_scanned_on (đã xoá ở trên) chặn.
  env.bots[0].rt.stop(); env.bots[0].rt.start()
  const scans0 = env.bots[0].rt.metrics.birthdayScans
  env.bots[0].bump(31 * 60_000)
  await env.drain()
  B('B15', 'Quét lại sinh nhật trong cùng ngày (app mở lại) → có quét lại nhưng không gửi trùng', env.sends.length === s2 && env.bots[0].rt.metrics.birthdayScans > scans0,
    { extra: env.sends.length - s2, scans: env.bots[0].rt.metrics.birthdayScans - scans0 })

  // 2.100 người sinh nhật cùng ngày (2 lô).
  const many = []
  for (let i = 1; i <= 2100; i++) many.push(friend(ACC.server, 5000 + i, vn.d))
  env.friends.set(ACC.server, { rows: many })
  await saveBot(c, S1, ACC.server, [R])
  m = await env.mark()
  env.bots[2].rt.refreshSoon(); await env.bots[2].rt.tick()
  const jb = await env.jobsSince(m)
  B('B16', '2.100 người sinh nhật cùng ngày (2 lô) → đủ 2.100 việc, không trùng', jb.length === 2100 && new Set(jb.map(j => j.recipient_uid)).size === 2100, { n: jb.length })

  await env.close()
}

async function main() {
  const cluster = await startCluster({ patches: [path.join(REPO, 'scripts/event-bot/db/dynfilter-prod-20261127.sql')] })
  try {
    if (!ONLY || ONLY === 'tag') await tagSuite(cluster)
    if (!ONLY || ONLY === 'group') await groupSuite(cluster)
    if (!ONLY || ONLY === 'birthday') await birthdaySuite(cluster)
  } catch (e) {
    check('harness', 'ERR', e.message, false, { stack: e.stack?.split('\n').slice(0, 4).join(' | ') })
  } finally { await cluster.end() }
  for (const r of results) console.log(`${r.status.padEnd(5)} ${r.suite.padEnd(8)} ${r.id.padEnd(5)} ${r.title}${r.status === 'FAIL' || VERBOSE ? '  ' + JSON.stringify(r.detail).slice(0, 600) : ''}`)
  const n = s => results.filter(r => r.status === s).length
  console.log(JSON.stringify({ pass: n('PASS'), known: n('KNOWN'), fail: n('FAIL') }))
  process.exit(n('FAIL') ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
