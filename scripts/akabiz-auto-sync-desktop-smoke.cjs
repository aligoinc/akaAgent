// Smoke: đồng bộ akaBiz Auto → akaAgent, phương án 2 (docs/AKABIZ_AUTO_SYNC_DESKTOP.md).
// Chạy service thật của tiến trình chính (src/main/services/akaBizAutoSyncService.ts) trên một file SQLite tạm có cột như
// akaBiz Auto và một API giả làm đúng hợp đồng akaAgentWebApp docs/AKABIZ_AUTO_SYNC.md: thứ tự lời gọi, khuôn dữ liệu,
// vé hết hạn, con trỏ lệch, máy chủ bận, chiến dịch đã chép, file chỉ đọc, mật khẩu chỉ đi ở lời gọi verify.
// Chạy: node scripts/akabiz-auto-sync-desktop-smoke.cjs   (cần better-sqlite3 build cho Node: `npm rebuild better-sqlite3`)
'use strict'
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const http = require('node:http')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const Database = require('better-sqlite3')

const ROOT = resolve(__dirname, '..')
const PASSWORD = 'mat-khau-akabiz-9x!'
const TOKEN = 'desktop-jwt-token'
let failed = 0
let passed = 0

async function group(label, run) {
  try {
    await run()
    passed++
    console.log('PASS', label)
  } catch (error) {
    failed++
    console.log('FAIL', label)
    console.log('  ', error && error.stack ? error.stack.split('\n').slice(0, 4).join('\n   ') : error)
  }
}

// ------------------------------------------------------------ SQLite như akaBiz Auto
function makeDb(file, { withInstallTable = false } = {}) {
  const db = new Database(file)
  db.exec(`
    CREATE TABLE autoCampaign ([Id] integer PRIMARY KEY AUTOINCREMENT NOT NULL, [AccountId] integer, [StaffId] integer, [ShopId] integer,
      [Name] nvarchar(200), [CampaignActionId] nvarchar(200), [Status] nvarchar(200), [ContentMessage] text, [Media] nvarchar(4000),
      [Schedule] datetime, [ScheduleTime] datetime, [ScheduleType] nvarchar(50), [ScheduleList] nvarchar(500), [IsScheduleList] BIT,
      [IsAddFriend] BIT, [IsDelete] BIT, [ShopContactId] integer, [FanpageUid] nvarchar(4000), [AkaBizTagIds] nvarchar(4000),
      [DateCreate] datetime, [DateEdit] datetime, [DateUpdateCampaignDetail] datetime, [Log] text, [CountSendingOfDay] integer);
    CREATE TABLE autoCampaignDetail ([Id] integer PRIMARY KEY AUTOINCREMENT NOT NULL, [CampaignId] integer, [Status] tinyint,
      [Name] nvarchar(200), [Phone] nvarchar(20), [Uid] nvarchar(4000), [ZaloId] nvarchar(200), [Email] nvarchar(200),
      [Info1] text, [Info2] text, [Info3] text, [Info4] text, [Info5] text, [PostLink] text, [ErrorMessage] text,
      [ContentMessage] text, [ErrorImagePath] text, [DateProcessed] datetime, [IsDelete] BIT);
    CREATE TABLE autoShopContact ([Id] integer PRIMARY KEY AUTOINCREMENT NOT NULL, [ContactName] nvarchar(500), [Uid] nvarchar(200),
      [ZaloId] nvarchar(200), [Type] nvarchar(50), [ShopId] integer, [IsFriend] BIT, [IsDelete] BIT);
    CREATE TABLE AkaBizTag ([Id] integer PRIMARY KEY AUTOINCREMENT NOT NULL, [AccountId] integer, [StaffId] integer,
      [Name] nvarchar(50), [Color] nvarchar(50), [IsActive] BIT, [DateCreate] datetime, [IsDelete] BIT);
    CREATE TABLE autoLimit ([Id] integer PRIMARY KEY AUTOINCREMENT NOT NULL, [StaffId] integer, [CampaignAction] nvarchar(200),
      [LimitCount] integer, [LimitCountSendingOfHour] integer);
  `)
  if (withInstallTable) {
    db.exec("CREATE TABLE akaAgentSyncSetting ([Key] nvarchar(100) PRIMARY KEY, [Value] nvarchar(4000)); INSERT INTO akaAgentSyncSetting VALUES ('install_id','6f1c2e8a-1111-4222-8333-944455556666')")
  }
  const now = new Date()
  const local = daysAgo => {
    const d = new Date(now.getTime() - daysAgo * 86400000 + 7 * 3600000)
    return d.toISOString().slice(0, 19).replace('T', ' ') + '.1234567'
  }
  const insertCampaign = db.prepare(`INSERT INTO autoCampaign (Id, AccountId, StaffId, ShopId, Name, CampaignActionId, Status, ContentMessage, Media,
    Schedule, ScheduleType, IsAddFriend, IsDelete, ShopContactId, FanpageUid, AkaBizTagIds, DateCreate, DateEdit, DateUpdateCampaignDetail, Log, CountSendingOfDay)
    VALUES (@Id,@AccountId,@StaffId,@ShopId,@Name,@CampaignActionId,@Status,'Chào [fullname]',@Media,@Schedule,'',@IsAddFriend,@IsDelete,@ShopContactId,@FanpageUid,@AkaBizTagIds,@DateCreate,@DateEdit,@DateUpdate,'NHẬT KÝ RẤT DÀI',30)`)
  const base = { AccountId: 100, StaffId: 101, Media: null, IsAddFriend: 1, IsDelete: null, ShopContactId: null, FanpageUid: null, AkaBizTagIds: null,
    Schedule: local(1), DateCreate: local(200), DateEdit: null, DateUpdate: null }
  // 1: Zalo, Dừng, cập nhật 2 ngày trước, 1.203 dòng, có tham chiếu nhóm + nhãn.
  insertCampaign.run({ ...base, Id: 1, ShopId: 55, Name: 'Khách cũ tháng 10', CampaignActionId: 'zalo_send_to_phone', Status: 'Dừng',
    DateUpdate: local(2), ShopContactId: 7, AkaBizTagIds: '3, 4,x', Media: 'C:\\anh\\a.jpg' })
  // 2: Facebook, Chờ xử lý, 10 ngày, có fanpage.
  insertCampaign.run({ ...base, Id: 2, ShopId: 70, Name: 'Đăng nhóm', CampaignActionId: 'group_post', Status: 'Chờ xử lý', DateEdit: local(10), FanpageUid: '9988' })
  // 3: Zalo, Hoàn thành → ngoài phạm vi paused_pending.
  insertCampaign.run({ ...base, Id: 3, ShopId: 55, Name: 'Đã xong', CampaignActionId: 'zalo_send_to_friend', Status: 'Hoàn thành', DateUpdate: local(1) })
  // 4: Zalo, Dừng, cập nhật 200 ngày trước → ngoài giới hạn 90 ngày.
  insertCampaign.run({ ...base, Id: 4, ShopId: 55, Name: 'Cũ', CampaignActionId: 'zalo_send_to_group', Status: 'Dừng' })
  // 5: nhân viên khác cùng file → không bao giờ đọc.
  insertCampaign.run({ ...base, Id: 5, StaffId: 999, ShopId: 55, Name: 'Của người khác', CampaignActionId: 'zalo_send_to_phone', Status: 'Dừng', DateUpdate: local(1) })
  // 6: đã xoá.
  insertCampaign.run({ ...base, Id: 6, ShopId: 55, Name: 'Đã xoá', CampaignActionId: 'zalo_send_to_phone', Status: 'Dừng', IsDelete: 1, DateUpdate: local(1) })
  // 7: TikTok → không có nền tảng.
  insertCampaign.run({ ...base, Id: 7, ShopId: 55, Name: 'TikTok', CampaignActionId: 'tiktok_surfing', Status: 'Dừng', DateUpdate: local(1) })
  // 8: Zalo, Dừng, Shop không được chọn.
  insertCampaign.run({ ...base, Id: 8, ShopId: 56, Name: 'Shop khác', CampaignActionId: 'zalo_send_to_phone', Status: 'Dừng', DateUpdate: local(1) })
  const insertDetail = db.prepare(`INSERT INTO autoCampaignDetail (CampaignId, Status, Name, Phone, Uid, ZaloId, ContentMessage, ErrorImagePath, ErrorMessage, IsDelete, DateProcessed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  const fill = db.transaction(() => {
    for (let i = 0; i < 1203; i++) insertDetail.run(1, i % 3 === 0 ? 2 : 1, `Khách ${i}`, `09${String(i).padStart(8, '0')}`, null, null, 'nội dung đã gửi', 'C:\\loi.png', i === 5 ? 'x'.repeat(900) : null, null, local(1))
    insertDetail.run(1, 1, 'Đã xoá', '0900000000', null, null, null, null, null, 1, null)
    for (let i = 0; i < 4; i++) insertDetail.run(2, 1, `Nhóm ${i}`, null, `https://facebook.com/groups/${i}`, null, null, null, null, 0, null)
    for (let i = 0; i < 3; i++) insertDetail.run(3, 2, `B ${i}`, null, null, `u${i}`, null, null, null, null, null)
  })
  fill()
  db.prepare("INSERT INTO autoShopContact (Id, ContactName, Uid, ZaloId, Type, ShopId, IsFriend) VALUES (7,'Nhóm A','g123','123','group',55,0),(8,'Trang Shop','9988',NULL,'page',70,1),(9,'Trang khác','9988',NULL,'page',71,1)").run()
  db.prepare("INSERT INTO AkaBizTag (Id, AccountId, StaffId, Name, Color, IsActive) VALUES (3,100,101,'VIP','#ff0000',1),(4,100,101,'Mới',NULL,1),(5,100,101,'Không dùng',NULL,1)").run()
  db.prepare("INSERT INTO autoLimit (StaffId, CampaignAction, LimitCount, LimitCountSendingOfHour) VALUES (101,'zalo_send_to_phone',80,9),(999,'x',1,1)").run()
  db.close()
}

const fileHash = file => createHash('sha256').update(readFileSync(file)).digest('hex')

// ------------------------------------------------------------ API giả theo hợp đồng
function startApi() {
  const state = {
    calls: [], tickets: new Set(), ticketSeq: 0, complete: new Set(), staged: new Map(),
    expireNextAt: null, conflictOnceAt: null, busyOnce: false, notFound: false
  }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      const path = req.url
      state.calls.push({ path, body, headers: req.headers, raw })
      const send = (status, payload, code) => {
        res.writeHead(status, { 'content-type': 'application/json', ...(code ? { 'x-akaagent-error-code': code } : {}) })
        res.end(JSON.stringify(payload))
      }
      const ok = data => send(200, { status: 1, errorCode: 0, message: 'Thành công!', data })
      const fail = (status, code, message, details) => send(status, { status: -1, errorCode: status, message, code, ...(details ? { details } : {}) }, code)
      if (state.notFound) return send(404, { message: 'Not Found' })
      if (path === '/api/aka-agent/desktop/v1/akabiz-auto-sync/verify') {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) return fail(403, 'akabiz_sync_desktop_session_invalid', 'Phiên không hợp lệ')
        if (body.source?.password !== PASSWORD) return fail(422, 'akabiz_sync_invalid_credentials', 'Sai mật khẩu', { side: 'source', remainingAttempts: 4 })
        const ticket = `ticket-${++state.ticketSeq}-${'x'.repeat(20)}`
        state.tickets.add(ticket)
        return ok({
          ticket, expiresAt: new Date(Date.now() + 1800000).toISOString(),
          target: { staffId: 123, username: 'admin.shopmau', name: 'Admin', organizationName: 'Shop Mẫu' },
          source: { staffId: 101, accountId: 100, username: body.source.username, name: 'Nhân viên 01' },
          options: { zalo: { zalo_server: { allowed: true, used: 3, max: 10 }, zalo_web: { allowed: false, used: 0, max: null }, zalo_qr: { allowed: true, used: 3, max: 10 } },
            facebook: { allowed: true, used: 1, max: 5 }, defaultZaloAccountType: 'zalo_server' },
          accounts: [{ shopId: 55, name: 'Zalo Bán hàng', platform: 'zalo', isActive: true, phone: '0912', mapped: null },
            { shopId: 70, name: 'Lan Nguyễn', platform: 'facebook', isActive: true, phone: null, mapped: { accountId: '9001', type: 'facebook', name: 'Lan' } }],
          inProgress: null
        })
      }
      const ticket = req.headers['x-akabiz-sync-ticket']
      if (!ticket || !state.tickets.has(ticket)) return fail(409, 'akabiz_sync_ticket_expired', 'Phiên xác minh đã hết hạn.')
      const op = path.replace('/api/aka-agent/akabiz-auto-sync/v1/', '')
      if (state.busyOnce && op === 'begin') { state.busyOnce = false; return fail(429, 'akabiz_sync_busy', 'Bận') }
      if (op === 'begin') {
        return ok({ runId: body.dryRun ? null : 'run-1', asOf: new Date().toISOString(), settings: body.settings,
          accounts: body.settings.shopIds.map(shopId => ({ shopId, result: body.dryRun ? (shopId === 70 ? 'would_reuse' : 'would_create') : (shopId === 70 ? 'reused' : 'created'),
            accountId: String(9000 + shopId), type: shopId === 70 ? 'facebook' : body.settings.zaloAccountType })),
          campaigns: { complete: [...state.complete], pending: [] } })
      }
      if (op === 'campaign') {
        const c = body.campaign
        const sourceId = `${state.installId}:${c.Id}`
        if (state.complete.has(sourceId)) return ok({ sourceId, verdict: 'already_copied' })
        if (c.CampaignActionId === 'group_post' && body.dryRun === false && !state.allowFacebook) {
          return ok({ sourceId, verdict: 'skip', code: 'UNSUPPORTED_ACTION', message: 'akaAgent chưa có loại này' })
        }
        const staged = state.staged.get(sourceId) || { rows: [], cursor: { afterId: null, consumed: 0 }, expected: body.detailCount }
        if (!body.dryRun) state.staged.set(sourceId, staged)
        state.campaignCache = state.campaignCache || new Map()
        state.campaignCache.set(`${ticket}|${sourceId}`, body.dryRun ? { rows: [], cursor: { afterId: null, consumed: 0 }, expected: body.detailCount } : staged)
        return ok({ sourceId, verdict: 'copy', actionId: c.CampaignActionId === 'group_post' ? 'facebook_group_post' : 'zalo_message_phone', accountId: '9055',
          desiredStatus: 'tạm dừng', adjustments: c.Media ? [{ code: 'MEDIA_NOT_COPIED', message: 'Chép không kèm ảnh' }] : [],
          cursor: body.dryRun ? { afterId: null, consumed: 0 } : staged.cursor })
      }
      if (op === 'inputs') {
        const entry = state.campaignCache && state.campaignCache.get(`${ticket}|${body.sourceId}`)
        if (!entry) return fail(409, 'akabiz_sync_campaign_unknown', 'Chưa gọi campaign')
        if (state.expireNextAt !== null && entry.cursor.consumed >= state.expireNextAt && !body.dryRun) {
          state.expireNextAt = null
          state.tickets.clear()
          return fail(409, 'akabiz_sync_ticket_expired', 'Hết hạn')
        }
        const exp = body.expectedCursor
        if (exp.afterId !== entry.cursor.afterId || exp.consumed !== entry.cursor.consumed) {
          return fail(409, 'akabiz_sync_cursor_conflict', 'Lệch', { cursor: entry.cursor })
        }
        if (state.conflictOnceAt !== null && entry.cursor.consumed >= state.conflictOnceAt && !body.dryRun) {
          // Lô trước đã ghi nhưng câu trả lời bị mất: máy chủ đi trước bên đọc 1 lô.
          state.conflictOnceAt = null
          entry.rows.push(...body.rows.map(r => r.Id))
          entry.cursor = { afterId: body.rows.at(-1).Id, consumed: entry.cursor.consumed + body.rows.length }
          return fail(503, 'akabiz_sync_failed', 'Mất câu trả lời')
        }
        entry.rows.push(...body.rows.map(r => r.Id))
        entry.cursor = { afterId: body.rows.at(-1).Id, consumed: entry.cursor.consumed + body.rows.length }
        return ok({ cursor: entry.cursor, imported: body.rows.length, dropped: 0 })
      }
      if (op === 'publish') {
        const entry = state.staged.get(body.sourceId)
        if (!entry || entry.cursor.consumed !== entry.expected) return fail(409, 'akabiz_sync_incomplete', 'Thiếu', { cursor: entry && entry.cursor })
        state.complete.add(body.sourceId)
        return ok({ campaignId: '7001', state: 'complete' })
      }
      if (op === 'finish') return ok({ state: body.hasIssues ? 'needs_resolution' : 'complete' })
      return send(404, {})
    })
  })
  return new Promise(resolvePromise => server.listen(0, '127.0.0.1', () => resolvePromise({ server, state, url: `http://127.0.0.1:${server.address().port}` })))
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'aka-akabiz-auto-sync-'))
  try {
    // Bản dựng nằm trong node_modules của repo để `require('better-sqlite3')` tìm được gói đã cài.
    const outDir = join(ROOT, 'node_modules', '.cache', 'akabiz-auto-sync-smoke')
    mkdirSync(outDir, { recursive: true })
    const out = join(outDir, 'service.cjs')
    await build({ entryPoints: [join(ROOT, 'src/main/services/akaBizAutoSyncService.ts')], bundle: true, platform: 'node', format: 'cjs',
      target: 'node20', outfile: out, external: ['better-sqlite3'], logLevel: 'silent' })
    const mod = require(out)
    const dbFile = join(dir, 'Resources2_akabiz_auto_local.db')
    makeDb(dbFile)
    const dbHashBefore = fileHash(dbFile)
    const api = await startApi()
    const sleeps = []
    const progressEvents = []
    const makeService = (overrides = {}) => new mod.AkaBizAutoSyncService({
      baseUrl: api.url, token: async () => TOKEN, fetch: (input, init) => fetch(input, init),
      sleep: async ms => { sleeps.push(ms) }, now: () => Date.now(), retryDelayMs: 1, ...overrides
    })
    const source = { dbPath: dbFile, username: 'nhanvien01' }
    const expectedInstall = createHash('sha256').update(resolve(dbFile).toLowerCase(), 'utf8').digest('hex').slice(0, 32)
    api.state.installId = expectedInstall
    const settings = { platforms: ['zalo', 'facebook'], zaloAccountType: 'zalo_server', shopIds: [55, 70], campaignScope: 'paused_pending', updatedWithinDays: 90 }
    let service = makeService()
    let connected

    await group('verify: sai mật khẩu trả mã + câu của máy chủ, không giữ phiên', async () => {
      await assert.rejects(service.connect(source, 'sai'), error => error.code === 'akabiz_sync_invalid_credentials' && error.message === 'Sai mật khẩu')
      await assert.rejects(service.run(settings, true, () => {}), error => error.code === 'akabiz_sync_no_session')
    })

    await group('connect: Bearer phiên Desktop, installId theo đường dẫn, chỉ chiến dịch của đúng nhân viên', async () => {
      api.state.calls.length = 0
      connected = await service.connect(source, PASSWORD)
      const verify = api.state.calls[0]
      assert.equal(verify.path, '/api/aka-agent/desktop/v1/akabiz-auto-sync/verify')
      assert.equal(verify.headers.authorization, `Bearer ${TOKEN}`)
      assert.deepEqual(verify.body, { source: { username: 'nhanvien01', password: PASSWORD }, installId: expectedInstall })
      assert.equal(connected.installId, expectedInstall)
      assert.deepEqual(connected.campaigns.map(c => c.id), [1, 2, 3, 4, 7, 8])
      assert.equal(connected.campaigns.find(c => c.id === 7).platform, null)
      assert.equal(connected.campaigns.find(c => c.id === 2).platform, 'facebook')
      assert.match(connected.campaigns.find(c => c.id === 1).lastUpdatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
      assert.equal(connected.options.zalo.zalo_web.allowed, false)
      assert.equal(connected.accounts[1].mapped.type, 'facebook')
      assert.equal(JSON.stringify(connected).includes(PASSWORD), false)
    })

    await group('installId lấy từ bảng akaAgentSyncSetting khi akaBiz Auto đã tạo', async () => {
      const other = join(dir, 'with-install.db')
      makeDb(other, { withInstallTable: true })
      const id = new Database(other, { readonly: true })
      try { assert.equal(mod.readInstallId(id, other), '6f1c2e8a-1111-4222-8333-944455556666') } finally { id.close() }
    })

    await group('xem trước: chỉ chiến dịch trong lựa chọn, dòng thô đúng khuôn, không publish/finish', async () => {
      api.state.calls.length = 0
      progressEvents.length = 0
      const report = await service.run(settings, true, event => progressEvents.push(event))
      const ops = api.state.calls.map(call => call.path.split('/').pop())
      assert.equal(ops[0], 'begin')
      assert.equal(api.state.calls[0].body.dryRun, true)
      assert.ok(!ops.includes('publish') && !ops.includes('finish'))
      const campaigns = api.state.calls.filter(call => call.path.endsWith('/campaign'))
      assert.deepEqual(campaigns.map(call => call.body.campaign.Id), [1, 2])
      const c1 = campaigns[0].body
      assert.equal(c1.campaign.Log, undefined)
      assert.equal(c1.campaign.IsAddFriend, true)
      assert.equal(c1.campaign.IsDelete, null)
      assert.match(c1.campaign.Schedule, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.1234567$/)
      assert.equal(c1.detailCount, 1203)
      assert.equal(c1.pendingCount, 802)
      assert.deepEqual(c1.refs.shopContacts.map(r => r.Id), [7])
      assert.equal(c1.refs.shopContacts[0].IsFriend, false)
      assert.deepEqual(c1.refs.akaBizTags.map(r => r.Id).sort(), [3, 4])
      assert.deepEqual(c1.refs.limits.map(r => r.CampaignAction), ['zalo_send_to_phone'])
      const c2 = campaigns[1].body
      assert.deepEqual(c2.refs.shopContacts.map(r => r.Id), [8])
      const inputs = api.state.calls.filter(call => call.path.endsWith('/inputs') && call.body.sourceId.endsWith(':1'))
      assert.deepEqual(inputs.map(call => call.body.rows.length), [500, 500, 203])
      const rows = inputs.flatMap(call => call.body.rows)
      assert.equal(new Set(rows.map(r => r.Id)).size, 1203)
      assert.ok(rows.every(r => r.ContentMessage === undefined && r.ErrorImagePath === undefined))
      assert.equal(rows.find(r => r.ErrorMessage).ErrorMessage.length, 500)
      assert.ok(!rows.some(r => r.Name === 'Đã xoá'))
      assert.equal(report.campaigns.total, 2)
      assert.equal(report.campaigns.copied, 2)
      assert.equal(report.mediaNotCopied, 1)
      assert.equal(report.rows.imported, 1207)
      assert.deepEqual(report.accounts.map(a => a.result), ['would_create', 'would_reuse'])
      const last = progressEvents.at(-1)
      assert.equal(last.campaignsDone, 2)
      assert.equal(last.rowsDone, last.rowsTotal)
    })

    await group('mật khẩu chỉ nằm ở lời gọi verify, không có trong tiến trình gửi giao diện', async () => {
      const leaked = api.state.calls.filter(call => !call.path.endsWith('/verify') && call.raw.includes(PASSWORD))
      assert.equal(leaked.length, 0)
      assert.equal(JSON.stringify(progressEvents).includes(PASSWORD), false)
    })

    await group('đồng bộ: vé hết hạn giữa chừng, mất câu trả lời (con trỏ lệch), máy chủ bận → đủ dòng, không trùng', async () => {
      api.state.calls.length = 0
      api.state.expireNextAt = 500
      api.state.conflictOnceAt = 1000
      api.state.busyOnce = true
      api.state.allowFacebook = true
      const report = await service.run(settings, false, () => {})
      const ops = api.state.calls.map(call => call.path.split('/').pop())
      assert.ok(ops.filter(op => op === 'verify').length >= 1, 'đã xác minh lại')
      assert.equal(ops.at(-1), 'finish')
      assert.ok(ops.includes('publish'))
      const staged = api.state.staged.get(`${expectedInstall}:1`)
      assert.equal(staged.rows.length, 1203)
      assert.equal(new Set(staged.rows).size, 1203)
      assert.ok(api.state.complete.has(`${expectedInstall}:1`) && api.state.complete.has(`${expectedInstall}:2`))
      assert.equal(report.campaigns.copied, 2)
      assert.equal(report.campaigns.issues.length, 0)
      assert.ok(sleeps.length >= 2, 'đã chờ khi máy chủ bận / lỗi tạm')
      const reverify = api.state.calls.find(call => call.path.endsWith('/verify'))
      assert.equal(reverify.body.source.password, PASSWORD)
    })

    await group('lượt sau: chiến dịch đã chép bỏ qua, không gọi campaign lại', async () => {
      api.state.calls.length = 0
      const report = await service.run(settings, false, () => {})
      assert.equal(api.state.calls.filter(call => call.path.endsWith('/campaign')).length, 0)
      assert.equal(report.campaigns.alreadyCopied, 2)
    })

    await group('chiến dịch bị bỏ qua vẫn đi hết thanh tiến độ; giới hạn ngày tắt thì lấy cả chiến dịch cũ', async () => {
      api.state.complete.clear()
      api.state.staged.clear()
      api.state.allowFacebook = false
      progressEvents.length = 0
      const report = await service.run({ ...settings, updatedWithinDays: null }, false, event => progressEvents.push(event))
      assert.equal(report.campaigns.total, 3)
      assert.equal(report.campaigns.skipped.length, 1)
      assert.equal(report.campaigns.skipped[0].code, 'UNSUPPORTED_ACTION')
      const last = progressEvents.at(-1)
      assert.equal(last.rowsDone, last.rowsTotal)
    })

    await group('API chưa có đường này (404) → akabiz_sync_not_ready', async () => {
      api.state.notFound = true
      const fresh = makeService()
      await assert.rejects(fresh.connect(source, PASSWORD), error => error.code === 'akabiz_sync_not_ready')
      api.state.notFound = false
    })

    await group('đóng phiên xoá mật khẩu khỏi bộ nhớ: không chạy được nữa', async () => {
      service.close()
      await assert.rejects(service.run(settings, true, () => {}), error => error.code === 'akabiz_sync_no_session')
    })

    await group('file SQLite không bị ghi', async () => {
      assert.equal(fileHash(dbFile), dbHashBefore)
    })

    await group('normalizeDateText', async () => {
      assert.equal(mod.normalizeDateText('2026-11-20 08:00:00'), '2026-11-20T08:00:00')
      assert.equal(mod.normalizeDateText('2026-11-20 08:00:00.0000000'), '2026-11-20T08:00:00')
      assert.equal(mod.normalizeDateText('2026-11-20T08:00:00.5Z'), '2026-11-20T08:00:00.5')
      assert.equal(mod.normalizeDateText('không phải ngày'), 'không phải ngày')
    })
    api.server.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`\n${passed} PASS, ${failed} FAIL`)
  if (failed) process.exit(1)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
