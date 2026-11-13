// Đồng bộ trạng thái tin nhắn Zalo (đã nhận, đã xem, đã tương tác, đã phản hồi): phần chạy trong chương trình gửi tin.
// Chạy đúng mã thật của src/main/services/zaloMessageStatusRuntime.ts + src/shared/zaloMessageStatusSync.ts với đồng hồ giả
// và DB giả; không mạng, không Electron, không gửi gì tới Zalo.
// Run: node scripts/zalo-message-status-sync-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

// Bản chép nguyên văn của akaAgentWebApp packages/control-api/src/zaloMessageStatusSync.ts. Sửa ở WebApp trước, chép lại,
// rồi cập nhật mã băm này. Lệch nghĩa là có người sửa tay bản chép ở đây.
const SHARED_CONTRACT_SHA256 = '72673f207f35e91c4c1d0ceb08cd7ba0e525964867d20d6dd6201f9a21153828'

// ---------------------------------------------------------------------------------------------------------------------
// Nạp mã thật: dịch hai file TypeScript sang CommonJS vào thư mục tạm, giữ nguyên đường dẫn tương đối giữa chúng.
// ---------------------------------------------------------------------------------------------------------------------
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zalo-message-status-smoke-'))
const emit = (file, js) => {
  const target = path.join(outDir, file.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, js)
}
for (const file of ['src/shared/zaloMessageStatusSync.ts', 'src/main/services/zaloMessageStatusRuntime.ts',
  'src/main/services/zaloMessageStatusSync.ts', 'packages/campaign-engine/src/zalo/engagement.ts']) {
  emit(file, ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText)
}
// File nối DB (zaloMessageStatusSync.ts) import ba module có IO thật. Ở đây chúng là đồ giả, điều khiển qua `wiringWorld`,
// để chính mã của file nối được chạy: chọn hàm DB theo loại tiến trình, tổ chức dùng để xét phạm vi, bỏ bộ đệm khi đổi người.
const wiringWorld = { server: false, user: null, settings: {}, rpcCalls: [], settingsQueries: [], sessionListeners: [],
  rpcResult: () => ({ enabled: true, accepted: 0, matched: 0, stored: 0, rejectedAccountIds: [] }) }
global.__zaloMessageStatusSmoke = wiringWorld
emit('src/main/data/currentUser.ts', `
  const world = global.__zaloMessageStatusSmoke
  exports.getCurrentUser = () => world.user
  exports.onCurrentUserSessionChanged = listener => { world.sessionListeners.push(listener); return () => {} }
`)
emit('src/main/data/supabaseClient.ts', `
  const world = global.__zaloMessageStatusSmoke
  exports.isTrustedServerSupabaseConfigured = () => world.server
  exports.getSupabaseClient = () => ({
    from: table => ({ select: columns => ({ in: (column, keys) => ({ abortSignal: async () => {
      world.settingsQueries.push({ table, columns, column, keys })
      return { data: Object.entries(world.settings).map(([key, value]) => ({ key, value })), error: null }
    } }) }) }),
    rpc: (name, args) => ({ abortSignal: async () => {
      world.rpcCalls.push({ name, args })
      return { data: world.rpcResult(name, args), error: null }
    } })
  })
`)
emit('src/main/data/repositories/runtimeClockRepository.ts', `
  exports.peekDatabaseRuntimeClock = () => ({ dbNow: '2026-11-13T03:00:00.000Z' })
`)
const contract = require(path.join(outDir, 'src/shared/zaloMessageStatusSync.js'))
const { ZaloMessageStatusRuntime, CONFIG_MAX_AGE_MS, CONFIG_MAX_AGE_OFF_MS, LONG_PAUSE_MS } =
  require(path.join(outDir, 'src/main/services/zaloMessageStatusRuntime.js'))
const engineEngagement = require(path.join(outDir, 'packages/campaign-engine/src/zalo/engagement.js'))

// ---------------------------------------------------------------------------------------------------------------------
// Đồ giả: đồng hồ, hẹn giờ, bảng cấu hình, hàm nhận lô.
// ---------------------------------------------------------------------------------------------------------------------
const START = Date.UTC(2026, 10, 13, 3, 0, 0)
const MINUTE = 60_000
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness({ settings = {}, ingest } = {}) {
  const state = {
    now: START, timers: [], settingsReads: 0, settingsError: null, settings: { ...settings },
    ingestCalls: [], ingestHandler: ingest || (items => ({ enabled: true, accepted: items.length, matched: 0, stored: 0,
      rejectedAccountIds: [], flushIntervalSeconds: 60, flushMaxRows: 500, trackFriendAccept: false, replyIgnoredKinds: ['ecard', 'system'] })),
    warnings: []
  }
  const runtime = new ZaloMessageStatusRuntime({
    loadSettings: async () => {
      state.settingsReads += 1
      if (state.settingsError) throw state.settingsError
      return Object.entries(state.settings).map(([name, value]) => ({ key: contract.MESSAGE_STATUS_SYNC_PREFIX + name, value }))
    },
    ingest: async items => {
      state.ingestCalls.push(items.map(item => ({ ...item })))
      return state.ingestHandler(items, state.ingestCalls.length)
    },
    nowIso: () => new Date(state.now).toISOString(),
    now: () => state.now,
    setTimer: (run, delayMs) => { const timer = { at: state.now + delayMs, run }; state.timers.push(timer); return timer },
    clearTimer: handle => { state.timers = state.timers.filter(timer => timer !== handle) },
    warn: kind => state.warnings.push(kind)
  })
  /** Tua đồng hồ; chạy mọi hẹn giờ đến hạn theo thứ tự và chờ các việc nền của chúng. */
  const advance = async ms => {
    const end = state.now + ms
    for (;;) {
      const due = state.timers.filter(timer => timer.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      state.timers = state.timers.filter(timer => timer !== due)
      state.now = Math.max(state.now, due.at)
      due.run()
      await tick(); await tick()
    }
    state.now = end
    await tick()
  }
  /** Lượt dùng đầu tiên kích hoạt đọc cấu hình ở nền; chờ nó xong. */
  const ready = async () => { runtime.enabled(); await runtime.settled(); await tick() }
  return { runtime, state, advance, ready }
}

const account = { id: 501, zaloUid: 'acc501', isZaloShowWeb: false, organizationId: 7 }
const message = (from, msgId, tsMs, extra = {}) => ({ type: 0, isSelf: false, threadId: from,
  data: { uidFrom: from, idTo: 'acc501', msgId, ts: String(tsMs), msgType: 'webchat', content: 'nội dung không được lưu', ...extra } })
const receipt = (peer, msgId, kind) => ({ type: 0, threadId: peer, isSelf: false,
  data: kind === 'seen' ? { msgId, idTo: peer } : { msgId, deliveredUids: [peer], seenUids: [] } })
const reaction = (from, targetMsgId, tsMs) => ({ isGroup: false, isSelf: false, threadId: from,
  data: { uidFrom: from, ts: String(tsMs), content: { rIcon: '/-heart', rType: 5, rMsg: [{ gMsgID: targetMsgId }] } } })

const results = []
async function check(name, run) {
  await run()
  results.push(name)
  console.log(`ok ${name}`)
}

async function main() {
  await check('bản chép hợp đồng giống bản đã ghi nhận', async () => {
    const actual = crypto.createHash('sha256').update(read('src/shared/zaloMessageStatusSync.ts')).digest('hex')
    assert.equal(actual, SHARED_CONTRACT_SHA256,
      'src/shared/zaloMessageStatusSync.ts khác bản đã ghi nhận: chép lại từ akaAgentWebApp rồi cập nhật SHARED_CONTRACT_SHA256')
    // Mã băm chỉ giữ bản ở đây không bị sửa tay. Khi máy có sẵn repo akaAgentWebApp (AKA_WEBAPP_REPO hoặc thư mục bên cạnh)
    // thì so thẳng với bản gốc, kèm bốn file SQL.
    const webApp = process.env.AKA_WEBAPP_REPO || path.resolve(root, '..', 'akaAgentWebApp')
    const original = path.join(webApp, 'packages/control-api/src/zaloMessageStatusSync.ts')
    if (fs.existsSync(original)) {
      assert.equal(read('src/shared/zaloMessageStatusSync.ts'), fs.readFileSync(original, 'utf8'), 'hợp đồng lệch so với bản gốc ở akaAgentWebApp')
      for (const [here, there] of [['migration_v522_zalo_message_status_sync.sql', 'migration_zalo_message_status_sync.sql'],
        ['rollback_v522_zalo_message_status_sync.sql', 'rollback_zalo_message_status_sync.sql'],
        ['migration_v523_zalo_message_status_statuses.sql', 'catalog_zalo_message_status_statuses.sql'],
        ['rollback_v523_zalo_message_status_statuses.sql', 'catalog_rollback_zalo_message_status_statuses.sql']]) {
        assert.equal(read(`migrations/${here}`), fs.readFileSync(path.join(webApp, 'scripts/sql/zalo-message-status-sync', there), 'utf8'),
          `migrations/${here} lệch so với akaAgentWebApp ${there}`)
      }
      console.log('   (đã so với bản gốc ở akaAgentWebApp: hợp đồng và bốn file SQL giống từng byte)')
    }
  })

  await check('chưa có dòng cấu hình: tắt hẳn, không gọi hàm nhận lô, chỉ đọc cấu hình 15 phút một lần', async () => {
    const { runtime, state, advance, ready } = harness()
    await ready()
    assert.equal(runtime.enabled(7), false)
    const send = runtime.beginSend(account, 'U1', 'message')
    assert.deepEqual(send.detailData({ message: { msgId: 'm1' } }), {})
    for (let i = 0; i < 200; i += 1) runtime.receive('message', message('U1', `r${i}`, START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0)
    assert.equal(state.timers.length, 0)
    for (let minute = 1; minute <= 14; minute += 1) { await advance(MINUTE); runtime.enabled(7); await runtime.settled() }
    assert.equal(state.settingsReads, 1, 'đang tắt: trong 15 phút chỉ một lượt đọc')
    await advance(2 * MINUTE)
    runtime.enabled(); await runtime.settled()
    assert.equal(state.settingsReads, 2, 'quá 15 phút thì đọc lại một lượt')
    assert.equal(CONFIG_MAX_AGE_OFF_MS, 15 * MINUTE)
    assert.equal(state.ingestCalls.length, 0)
    // Một giờ có sự kiện tới liên tục khi đang tắt: tổng cộng không quá 4 lượt đọc nữa, không lần gọi hàm nào.
    const before = state.settingsReads
    for (let i = 0; i < 360; i += 1) { await advance(10_000); runtime.receive('message', message('U1', `x${i}`, START), 501, 'acc501', 7); await runtime.settled() }
    assert.ok(state.settingsReads - before <= 4, `đọc ${state.settingsReads - before} lượt trong một giờ`)
    assert.equal(state.ingestCalls.length, 0)
  })

  await check('đang bật: lượt gửi đầu tiên vẫn có dấu tham chiếu dù cấu hình mới được đọc trong lúc gửi', async () => {
    const { runtime, state } = harness({ settings: { enabled: 'true' } })
    const send = runtime.beginSend(account, 'U1', 'message') // cấu hình chưa có; lượt đọc bắt đầu ở nền
    assert.equal(state.settingsReads, 1)
    await runtime.settled()
    const data = send.detailData({ message: { msgId: 'm1' }, attachment: [{ msgId: 'm2' }] })
    assert.deepEqual(data, { zaloStatusRef: { v: 1, a: 'acc501', t: 'U1', s: new Date(START).toISOString(), m: ['m1', 'm2'], k: 'message' } })
    assert.equal(runtime.metrics.refs, 1)
  })

  await check('giờ gửi: lấy lúc bắt đầu, lô chia sẻ đánh dấu lại ngay trước khi gửi cho từng người', async () => {
    const { runtime, state, ready } = harness({ settings: { enabled: 'true' } })
    await ready()
    const send = runtime.beginSend(account, 'U2', 'message')
    state.now += 90_000
    send.markSending()
    state.now += 5_000
    assert.equal(send.detailData([{ message: { msgId: 'm9' } }, undefined]).zaloStatusRef.s, new Date(START + 90_000).toISOString())
  })

  await check('không theo dõi: tài khoản trình duyệt, thiếu UID, gửi cho chính mình', async () => {
    const { runtime, ready } = harness({ settings: { enabled: 'true' } })
    await ready()
    assert.equal(runtime.beginSend({ ...account, isZaloShowWeb: true }, 'U1', 'message'), null)
    assert.equal(runtime.beginSend({ ...account, zaloUid: '' }, 'U1', 'message'), null)
    assert.equal(runtime.beginSend(account, '', 'message'), null)
    assert.equal(runtime.beginSend(account, 'acc501', 'message'), null)
  })

  await check('lời mời kết bạn chỉ có dấu tham chiếu khi bật ghi nhận "đồng ý kết bạn"', async () => {
    const off = harness({ settings: { enabled: 'true' } })
    await off.ready()
    assert.deepEqual(off.runtime.beginSend(account, 'U1', 'friend_request').detailData(null), {})
    const on = harness({ settings: { enabled: 'true', track_friend_accept: 'true' } })
    await on.ready()
    assert.deepEqual(on.runtime.beginSend(account, 'U1', 'friend_request').detailData(null),
      { zaloStatusRef: { v: 1, a: 'acc501', t: 'U1', s: new Date(START).toISOString(), m: [], k: 'friend_request' } })
  })

  await check('phạm vi thí điểm theo tổ chức: ngoài phạm vi thì không ghi dấu, không thu; không biết tổ chức thì cứ thu', async () => {
    const { runtime, ready } = harness({ settings: { enabled: 'true', organization_ids: '[5]' } })
    await ready()
    assert.deepEqual(runtime.beginSend(account, 'U1', 'message').detailData({ msgId: 'm1' }), {})
    assert.ok(runtime.beginSend({ ...account, organizationId: 5 }, 'U1', 'message').detailData({ msgId: 'm1' }).zaloStatusRef)
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0)
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 5)
    runtime.receive('message', message('U2', 'r2', START, { idTo: 'acc502' }), 502, 'acc502', undefined)
    assert.equal(runtime.pending, 2)
  })

  await check('thu sự kiện: năm loại của hội thoại 1-1, bỏ tin nhóm và tin tự gửi, không mang nội dung', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true', track_friend_accept: 'true' } })
    await ready()
    runtime.receive('message', message('U1', 'r1', START + 1000), 501, 'acc501', 7)
    runtime.receive('message', { ...message('U1', 'g1', START), type: 1 }, 501, 'acc501', 7) // tin nhóm
    runtime.receive('message', { ...message('U1', 's1', START), isSelf: true }, 501, 'acc501', 7) // tin tự gửi
    runtime.receive('delivered_messages', [receipt('U1', 'm1', 'delivered')], 501, 'acc501', 7)
    runtime.receive('seen_messages', [receipt('U1', 'm1', 'seen')], 501, 'acc501', 7)
    runtime.receive('reaction', reaction('U1', 'm1', START + 2000), 501, 'acc501', 7)
    runtime.receive('friend_event', { type: 0, data: 'U3', threadId: 'U3', ts: START + 3000 }, 501, 'acc501', 7)
    runtime.receive('typing', { data: {} }, 501, 'acc501', 7)
    assert.equal(runtime.pending, 5)
    assert.equal(state.timers.length, 1, 'một hẹn giờ cho cả lô')
    assert.equal(state.timers[0].at, START + 60_000, 'gửi sau flush_interval_seconds kể từ sự kiện đầu')
    await advance(61_000)
    assert.equal(state.ingestCalls.length, 1)
    const sent = state.ingestCalls[0]
    assert.deepEqual(sent.map(item => item.k).sort(), ['delivered', 'friend', 'reaction', 'reply', 'seen'])
    assert.deepEqual(sent.find(item => item.k === 'reply'), { a: '501', p: 'U1', k: 'reply', t: new Date(START + 1000).toISOString(), m: 'r1' })
    assert.deepEqual(sent.find(item => item.k === 'delivered'), { a: '501', p: 'U1', k: 'delivered', t: new Date(START).toISOString(), m: 'm1' })
    for (const item of sent) assert.deepEqual(Object.keys(item).sort(), ['a', 'k', 'm', 'p', 't'])
    assert.ok(!JSON.stringify(sent).includes('nội dung'), 'lô không mang nội dung tin')
    assert.equal(runtime.pending, 0)
    assert.equal(state.timers.length, 0, 'bộ đệm rỗng thì không hẹn giờ tiếp')
  })

  await check('sự kiện tới sau không đẩy lùi hạn gửi; lô đầy thì gửi tiếp ngay', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true', flush_max_rows: '50' },
      ingest: items => ({ enabled: true, accepted: items.length, matched: 0, stored: 0, rejectedAccountIds: [],
        flushIntervalSeconds: 60, flushMaxRows: 50, trackFriendAccept: false, replyIgnoredKinds: ['ecard', 'system'] }) })
    await ready()
    runtime.receive('message', message('U1', 'r0', START), 501, 'acc501', 7)
    state.now += 30_000
    for (let i = 1; i <= 119; i += 1) runtime.receive('message', message('U1', `r${i}`, START + i), 501, 'acc501', 7)
    assert.equal(state.timers.length, 1)
    assert.equal(state.timers[0].at, START + 60_000)
    await advance(31_000)
    assert.equal(state.ingestCalls.length, 1)
    assert.equal(state.ingestCalls[0].length, 50)
    await advance(5_000)
    assert.deepEqual(state.ingestCalls.map(call => call.length), [50, 50], 'còn đầy một lô thì gửi tiếp sau vài giây, không chờ hết chu kỳ')
    await advance(61_000)
    assert.deepEqual(state.ingestCalls.map(call => call.length), [50, 50, 20], 'phần lẻ còn lại đi theo chu kỳ thường')
  })

  await check('tài khoản bị DB từ chối: ngừng thu 10 phút, bị từ chối tiếp thì 20 phút', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: items => ({ enabled: true, accepted: 0, matched: 0, stored: 0,
        rejectedAccountIds: [...new Set(items.map(item => item.a))].filter(id => id === '502'),
        flushIntervalSeconds: 60, flushMaxRows: 500, trackFriendAccept: false, replyIgnoredKinds: ['ecard', 'system'] }) })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    runtime.receive('message', message('U9', 'r2', START, { idTo: 'acc502' }), 502, 'acc502', 7)
    await advance(61_000)
    assert.equal(state.ingestCalls.length, 1)
    runtime.receive('message', message('U9', 'r3', START, { idTo: 'acc502' }), 502, 'acc502', 7)
    assert.equal(runtime.pending, 0, 'tài khoản bị từ chối không được thu')
    runtime.receive('message', message('U1', 'r4', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 1, 'tài khoản khác vẫn thu bình thường')
    await advance(10 * MINUTE)
    runtime.receive('message', message('U9', 'r5', START, { idTo: 'acc502' }), 502, 'acc502', 7)
    assert.equal(runtime.pending, 1, 'hết 10 phút thì thu lại')
    await advance(61_000) // bị từ chối lần hai
    await advance(11 * MINUTE)
    runtime.receive('message', message('U9', 'r6', START, { idTo: 'acc502' }), 502, 'acc502', 7)
    assert.equal(runtime.pending, 0, 'lần hai bị chặn 20 phút')
    await advance(10 * MINUTE)
    runtime.receive('message', message('U9', 'r7', START, { idTo: 'acc502' }), 502, 'acc502', 7)
    assert.equal(runtime.pending, 1)
  })

  await check('gọi hàm nhận lô lỗi: giữ lô, gửi lại thưa dần, không ném lỗi ra ngoài', async () => {
    let fail = true
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: items => {
        if (fail) throw Object.assign(new Error('fetch failed'), { code: '' })
        return { enabled: true, accepted: items.length, matched: 1, stored: 0, rejectedAccountIds: [],
          flushIntervalSeconds: 60, flushMaxRows: 500, trackFriendAccept: false, replyIgnoredKinds: ['ecard', 'system'] }
      } })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    await advance(61_000)
    assert.equal(state.ingestCalls.length, 1)
    assert.equal(runtime.pending, 1, 'lô lỗi được giữ lại')
    await advance(58_000) // lô lỗi lúc 60 giây; hạn thử lại là 120 giây
    assert.equal(state.ingestCalls.length, 1, 'chưa tới hạn thử lại')
    await advance(2_000)
    assert.equal(state.ingestCalls.length, 2, 'thử lại sau 1 phút')
    await advance(118_000) // lỗi lần hai lúc 120 giây; hạn kế tiếp là 240 giây
    assert.equal(state.ingestCalls.length, 2, 'lần kế tiếp cách 2 phút')
    fail = false
    await advance(2_000)
    assert.equal(state.ingestCalls.length, 3)
    assert.deepEqual(state.ingestCalls[2], state.ingestCalls[0], 'gửi lại đúng lô cũ')
    assert.equal(runtime.pending, 0)
    assert.equal(runtime.metrics.matched, 1)
  })

  await check('lỗi liên tiếp trong lúc sự kiện vẫn tới đều: vẫn thưa dần, không gửi lại mỗi chu kỳ', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => { throw Object.assign(new Error('fetch failed'), { code: '' }) } })
    await ready()
    let n = 0
    const feed = () => runtime.receive('message', message('U1', `r${n += 1}`, START), 501, 'acc501', 7)
    feed()
    // Mỗi 10 giây có một sự kiện mới, suốt 10 phút. Các lần gọi phải ở 60, 120 (sau 1 phút), 240 (sau 2 phút), 540 (sau 5 phút) giây.
    for (let i = 0; i < 60; i += 1) { await advance(10_000); feed() }
    assert.equal(state.ingestCalls.length, 4)
    assert.equal(runtime.pending, 61, 'không sự kiện nào bị mất trong lúc chờ')
  })

  await check('đổi người đăng nhập trong lúc một lô đang gửi: lô cũ không quay lại bộ đệm', async () => {
    let release
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => new Promise((resolve, reject) => { release = () => reject(new Error('fetch failed')) }) })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    await advance(61_000)
    assert.equal(state.ingestCalls.length, 1)
    runtime.reset()
    release()
    await tick(); await tick()
    assert.equal(runtime.pending, 0)
    assert.equal(state.timers.length, 0)
  })

  await check('DB từ chối kiểu gửi lại cũng không khác (thiếu quyền, sai dữ liệu): bỏ lô, nghỉ 30 phút', async () => {
    for (const code of ['42501', '22P02', 'PGRST203']) {
      const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
        ingest: () => { throw Object.assign(new Error('từ chối'), { code }) } })
      await ready()
      runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
      await advance(61_000)
      assert.equal(state.ingestCalls.length, 1, code)
      assert.equal(runtime.pending, 0, `${code}: lô bị bỏ, không giữ lại`)
      await advance(LONG_PAUSE_MS - 2 * MINUTE)
      runtime.receive('message', message('U1', 'r2', START), 501, 'acc501', 7)
      assert.equal(runtime.pending, 0, `${code}: đang nghỉ thì không thu`)
      assert.equal(state.ingestCalls.length, 1, `${code}: không gọi lại trong lúc nghỉ`)
      assert.ok(state.warnings.includes('ingest_rejected'))
    }
  })

  await check('lỗi tạm thời kéo dài (quá giờ, mạng): sau 6 lần liên tiếp thì bỏ lô và nghỉ 30 phút, không giữ mãi', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }) } })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    await advance(30 * MINUTE)
    assert.equal(state.ingestCalls.length, 6, 'các lần gọi ở phút 1, 2, 4, 9, 14, 19')
    assert.equal(runtime.pending, 0)
    assert.ok(state.warnings.includes('ingest_given_up'))
    runtime.receive('message', message('U1', 'r2', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0, 'đang nghỉ')
    await advance(20 * MINUTE)
    runtime.receive('message', message('U1', 'r3', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 1, 'hết 30 phút thì thu lại')
  })

  await check('DB chưa có hàm nhận lô: bỏ lô, không gọi lại trong 30 phút', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => { throw Object.assign(new Error('Could not find the function'), { code: 'PGRST202' }) } })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    await advance(61_000)
    assert.equal(state.ingestCalls.length, 1)
    assert.equal(runtime.pending, 0)
    runtime.receive('message', message('U1', 'r2', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0, 'đang tạm ngừng thì không thu')
    await advance(29 * MINUTE)
    runtime.receive('message', message('U1', 'r3', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0)
    await advance(2 * MINUTE)
    runtime.receive('message', message('U1', 'r4', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 1, 'sau 30 phút thử lại')
    // Dấu tham chiếu vẫn được ghi trong lúc đó: trigger đăng ký lượt gửi không phụ thuộc hàm nhận lô.
    assert.ok(runtime.beginSend(account, 'U1', 'message').detailData({ msgId: 'm1' }).zaloStatusRef)
  })

  await check('DB báo công tắc đã tắt: bỏ bộ đệm, ngừng thu, đọc lại cấu hình ngay', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => ({ enabled: false, accepted: 0, matched: 0, stored: 0, rejectedAccountIds: [] }) })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    runtime.receive('message', message('U1', 'r2', START), 501, 'acc501', 7)
    await advance(61_000)
    assert.equal(state.ingestCalls.length, 1)
    assert.equal(runtime.pending, 0)
    const readsBefore = state.settingsReads
    runtime.receive('message', message('U1', 'r3', START), 501, 'acc501', 7)
    await runtime.settled()
    assert.equal(state.settingsReads, readsBefore + 1, 'cấu hình được đọc lại ở lần dùng kế tiếp')
    assert.equal(runtime.pending, 0, 'vẫn đang ngừng thu')
    await advance(CONFIG_MAX_AGE_MS + 1000)
    runtime.receive('message', message('U1', 'r4', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 1, 'hết thời gian ngừng thì thu lại (bảng cấu hình vẫn ghi đang bật)')
  })

  await check('DB báo tạm ngừng nhận (chạm trần trong ngày): nghỉ 30 phút, không đọc lại cấu hình dồn dập', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => ({ enabled: false, paused: true, accepted: 0, matched: 0, stored: 0, rejectedAccountIds: [] }) })
    await ready()
    let n = 0
    const feed = () => runtime.receive('message', message('U1', `r${n += 1}`, START), 501, 'acc501', 7)
    feed()
    const readsBefore = state.settingsReads
    // Hai giờ có sự kiện tới đều mỗi 10 giây trong lúc DB tạm ngừng nhận.
    for (let i = 0; i < 720; i += 1) { await advance(10_000); feed(); await runtime.settled() }
    assert.ok(state.ingestCalls.length <= 4, `gọi hàm ${state.ingestCalls.length} lần trong hai giờ`)
    assert.ok(state.settingsReads - readsBefore <= 24, 'chỉ các lượt đọc cấu hình theo nhịp thường')
    // Dấu tham chiếu vẫn được ghi: tạm ngừng nhận sự kiện không phải là tắt tính năng.
    assert.ok(runtime.beginSend(account, 'U1', 'message').detailData({ msgId: 'm1' }).zaloStatusRef)
  })

  await check('tắt công tắc: sau lượt đọc cấu hình kế tiếp thì ngừng ghi dấu, ngừng thu, bỏ bộ đệm', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true', flush_interval_seconds: '600' } })
    await ready()
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 1)
    state.settings.enabled = 'false'
    await advance(CONFIG_MAX_AGE_MS + 1000)
    assert.equal(runtime.enabled(7), true, 'lần gọi này dùng bản cũ và kích hoạt đọc lại')
    await runtime.settled()
    assert.equal(runtime.enabled(7), false)
    assert.equal(runtime.pending, 0)
    assert.equal(state.timers.length, 0)
    assert.deepEqual(runtime.beginSend(account, 'U1', 'message').detailData({ msgId: 'm1' }), {})
    await advance(20 * MINUTE)
    assert.equal(state.ingestCalls.length, 0, 'không lô nào được gửi sau khi tắt')
  })

  await check('tắt riêng việc thu (capture_enabled): vẫn ghi dấu tham chiếu, không thu sự kiện', async () => {
    const { runtime, ready } = harness({ settings: { enabled: 'true', capture_enabled: 'false' } })
    await ready()
    assert.ok(runtime.beginSend(account, 'U1', 'message').detailData({ msgId: 'm1' }).zaloStatusRef)
    runtime.receive('message', message('U1', 'r1', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0)
  })

  await check('đọc cấu hình lỗi: giữ trạng thái đang có, thử lại thưa dần', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' } })
    state.settingsError = new Error('fetch failed')
    await ready()
    assert.equal(runtime.enabled(7), false, 'chưa từng đọc được thì coi như tắt')
    runtime.enabled(); await runtime.settled()
    assert.equal(state.settingsReads, 1, 'chưa tới hạn thử lại')
    await advance(61_000)
    state.settingsError = null
    runtime.enabled(); await runtime.settled()
    assert.equal(state.settingsReads, 2)
    assert.equal(runtime.enabled(7), true)
    // Đã bật rồi mà lượt đọc sau lỗi: giữ nguyên "đang bật".
    state.settingsError = new Error('fetch failed')
    await advance(CONFIG_MAX_AGE_MS + 1000)
    runtime.enabled(); await runtime.settled()
    assert.equal(runtime.enabled(7), true)
  })

  await check('bộ đệm có trần 5.000 dòng; đổi người đăng nhập thì bỏ hết', async () => {
    const { runtime, state, ready } = harness({ settings: { enabled: 'true' } })
    await ready()
    for (let i = 0; i < 5200; i += 1) runtime.receive('message', message(`U${i}`, `r${i}`, START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 5000)
    assert.equal(runtime.metrics.dropped, 200, 'sự kiện bị bỏ vì đầy được đếm')
    assert.ok(state.warnings.includes('buffer_full'))
    runtime.reset()
    assert.equal(runtime.pending, 0)
    assert.equal(state.timers.length, 0)
  })

  await check('sự kiện hỏng không làm hỏng luồng nhận tin', async () => {
    const { runtime, ready } = harness({ settings: { enabled: 'true' } })
    await ready()
    for (const payload of [null, undefined, 42, 'x', [], { data: null }, { type: 0, data: { uidFrom: {}, msgId: [] } }]) {
      for (const type of ['message', 'reaction', 'seen_messages', 'delivered_messages', 'friend_event', 'khác']) {
        assert.doesNotThrow(() => runtime.receive(type, payload, 501, 'acc501', 7))
      }
    }
    assert.equal(runtime.pending, 0)
  })

  // -------------------------------------------------------------------------------------------------------------------
  // File nối DB chạy thật (IO là đồ giả): hẹn giờ của tiến trình được bắt lại để tự cho chạy.
  // -------------------------------------------------------------------------------------------------------------------
  const wiringPath = path.join(outDir, 'src/main/services/zaloMessageStatusSync.js')
  const withWiring = async (world, run) => {
    Object.assign(wiringWorld, { server: false, user: null, settings: {}, rpcCalls: [], settingsQueries: [], sessionListeners: [] }, world)
    const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout
    const timers = []
    global.setTimeout = (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer }
    global.clearTimeout = timer => { const index = timers.indexOf(timer); if (index >= 0) timers.splice(index, 1) }
    try {
      delete require.cache[wiringPath] // mỗi lần một bộ chạy mới, như một tiến trình vừa khởi động
      const wiring = require(wiringPath)
      wiring.zaloMessageStatusSyncEnabled() // lượt dùng đầu tiên kích hoạt đọc cấu hình
      await tick(); await tick()
      await run(wiring, { timers, fire: async () => { const timer = timers.shift(); assert.ok(timer, 'phải có hẹn giờ gửi lô'); timer.fn(); await tick(); await tick() } })
    } finally {
      global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout
    }
  }
  const ON = { 'zalo.message_status_sync.enabled': 'true' }

  await check('file nối DB, App Server: đọc đúng 18 khoá cấu hình, gọi hàm nhận lô chung với nguồn "server"', async () => {
    await withWiring({ server: true, user: { staffId: 11, organizationId: 7 }, settings: ON }, async (wiring, clock) => {
      assert.deepEqual(wiringWorld.settingsQueries, [{ table: 'auto_system_settings', columns: 'key,value,is_active,is_secret',
        column: 'key', keys: [...contract.MESSAGE_STATUS_SYNC_KEYS] }])
      assert.equal(wiringWorld.settingsQueries[0].keys.length, 18)
      assert.equal(wiring.zaloMessageStatusSyncEnabled(), true)
      // UID lấy từ phiên Zalo đang chạy được ưu tiên hơn cột trong DB; giờ gửi theo đồng hồ DB.
      const send = wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: 'uidTrongDb', isZaloShowWeb: false }, 'acc501', 'U1', 'message')
      assert.deepEqual(send.detailData({ msgId: 'm1' }),
        { zaloStatusRef: { v: 1, a: 'acc501', t: 'U1', s: '2026-11-13T03:00:00.000Z', m: ['m1'], k: 'message' } })
      assert.equal(wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: null }, undefined, 'U1', 'message'), null)
      wiring.receiveZaloMessageStatus('message', message('U1', 'r1', START), 501, 'acc501')
      assert.equal(clock.timers.length, 1)
      assert.equal(clock.timers[0].ms, 60_000)
      await clock.fire()
      assert.deepEqual(wiringWorld.rpcCalls, [{ name: 'aka_agent_ingest_zalo_message_status',
        args: { p_source: 'server', p_events: [{ a: '501', p: 'U1', k: 'reply', t: new Date(START).toISOString(), m: 'r1' }] } }])
      // App Server không có "người đăng nhập": tín hiệu đổi phiên không được xoá bộ đệm dùng chung của mọi nhân viên.
      wiring.receiveZaloMessageStatus('message', message('U1', 'r2', START), 501, 'acc501')
      for (const listener of wiringWorld.sessionListeners) listener()
      assert.equal(clock.timers.length, 1, 'lô đang chờ vẫn còn')
    })
  })

  await check('file nối DB, Desktop: gọi hàm bọc theo phiên (chỉ p_events); đổi người đăng nhập thì bỏ bộ đệm', async () => {
    await withWiring({ server: false, user: { staffId: 11, organizationId: 7 }, settings: ON }, async (wiring, clock) => {
      wiring.receiveZaloMessageStatus('message', message('U1', 'r1', START), 501, 'acc501')
      await clock.fire()
      assert.deepEqual(wiringWorld.rpcCalls, [{ name: 'aka_agent_desktop_ingest_zalo_message_status',
        args: { p_events: [{ a: '501', p: 'U1', k: 'reply', t: new Date(START).toISOString(), m: 'r1' }] } }])
      wiring.receiveZaloMessageStatus('message', message('U1', 'r2', START), 501, 'acc501')
      assert.equal(clock.timers.length, 1)
      assert.equal(wiringWorld.sessionListeners.length, 1)
      wiringWorld.sessionListeners[0]()
      assert.equal(clock.timers.length, 0, 'đổi người đăng nhập: lô đang chờ bị bỏ')
      assert.equal(wiringWorld.rpcCalls.length, 1)
    })
  })

  await check('file nối DB: phạm vi thí điểm xét theo tổ chức của nhân viên phụ trách, như DB', async () => {
    const pilot = { ...ON, 'zalo.message_status_sync.organization_ids': '[7]' }
    // Nhân viên thuộc tổ chức 7 (trong phạm vi), cột tổ chức của tài khoản ghi 99: vẫn ghi dấu và thu sự kiện.
    await withWiring({ server: true, user: { staffId: 11, organizationId: 7 }, settings: pilot }, async (wiring, clock) => {
      assert.ok(wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: 'acc501', organizationId: 99 }, 'acc501', 'U1', 'message').detailData({ msgId: 'm1' }).zaloStatusRef)
      wiring.receiveZaloMessageStatus('message', message('U1', 'r1', START), 501, 'acc501')
      assert.equal(clock.timers.length, 1)
    })
    // Nhân viên thuộc tổ chức 8 (ngoài phạm vi), cột tổ chức của tài khoản ghi 7: không ghi dấu, không thu.
    await withWiring({ server: true, user: { staffId: 12, organizationId: 8 }, settings: pilot }, async (wiring, clock) => {
      assert.equal(wiring.zaloMessageStatusSyncEnabled(), false)
      assert.deepEqual(wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: 'acc501', organizationId: 7 }, 'acc501', 'U1', 'message').detailData({ msgId: 'm1' }), {})
      wiring.receiveZaloMessageStatus('message', message('U1', 'r1', START), 501, 'acc501')
      assert.equal(clock.timers.length, 0)
    })
    // Không biết nhân viên (sự kiện tới ngoài ngữ cảnh): dùng cột tổ chức của tài khoản cho dấu tham chiếu, sự kiện thì cứ thu.
    await withWiring({ server: true, user: null, settings: pilot }, async (wiring, clock) => {
      assert.ok(wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: 'acc501', organizationId: 7 }, 'acc501', 'U1', 'message').detailData({ msgId: 'm1' }).zaloStatusRef)
      assert.deepEqual(wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: 'acc501', organizationId: 99 }, 'acc501', 'U1', 'message').detailData({ msgId: 'm1' }), {})
      wiring.receiveZaloMessageStatus('message', message('U1', 'r1', START), 501, 'acc501')
      assert.equal(clock.timers.length, 1)
    })
  })

  await check('file nối DB: chưa có dòng cấu hình thì không ghi dấu, không thu, không gọi hàm nào', async () => {
    await withWiring({ server: true, user: { staffId: 11, organizationId: 7 }, settings: {} }, async (wiring, clock) => {
      assert.equal(wiring.zaloMessageStatusSyncEnabled(), false)
      assert.deepEqual(wiring.beginZaloMessageStatusSend({ id: 501, zaloUid: 'acc501' }, 'acc501', 'U1', 'message').detailData({ msgId: 'm1' }), {})
      for (let i = 0; i < 50; i += 1) wiring.receiveZaloMessageStatus('message', message('U1', `r${i}`, START), 501, 'acc501')
      assert.equal(clock.timers.length, 0)
      assert.equal(wiringWorld.rpcCalls.length, 0)
      assert.equal(wiringWorld.settingsQueries.length, 1, 'chỉ một lượt đọc cấu hình')
    })
  })

  // -------------------------------------------------------------------------------------------------------------------
  // Lõi bộ chạy mới (packages/campaign-engine): hàm thật beginZaloEngagement với cổng giả.
  // -------------------------------------------------------------------------------------------------------------------
  await check('lõi bộ chạy mới: hai tính năng độc lập trong cùng một lần gửi', async () => {
    const { beginZaloEngagement } = engineEngagement
    const ctx = {}
    let marks = 0
    const statusPort = { messageStatusBegin: (_ctx, uid, kind) => ({ markSending: () => { marks += 1 },
      detailData: responses => ({ zaloStatusRef: { t: uid, k: kind, r: responses } }) }) }
    const oldSend = { revision: 'rev1', sentAt: '2026-11-13T03:00:00.000Z', accountZaloUid: 'acc501', operationId: 'op1' }
    const staged = []
    let abandoned = 0
    const oldPort = { engagementBegin: () => ({ ...oldSend }), engagementStage: (_ctx, source) => staged.push(source),
      engagementAbandon: () => { abandoned += 1 } }

    // Chỉ tính năng mới (theo dõi tương tác tắt): vẫn có dấu tham chiếu.
    const onlyNew = beginZaloEngagement(statusPort, ctx, 'U1', 'message')
    assert.equal(onlyNew.active, false)
    onlyNew.markSending()
    assert.equal(marks, 1)
    assert.deepEqual(onlyNew.finish('resp'), { zaloStatusRef: { t: 'U1', k: 'message', r: 'resp' } })

    // Chỉ cơ chế cũ: dữ liệu như trước khi có tính năng mới, không thêm khoá nào.
    const onlyOld = beginZaloEngagement(oldPort, ctx, 'U1', 'message').finish({ msgId: 'm1' })
    assert.deepEqual(Object.keys(onlyOld).sort(), ['zaloEngagementPending', 'zaloEngagementSource'])
    assert.equal(staged.length, 1)

    // Cả hai: đủ khoá của cả hai bên.
    const both = beginZaloEngagement({ ...oldPort, ...statusPort }, ctx, 'U1', 'friend_request').finish(null)
    assert.deepEqual(Object.keys(both).sort(), ['zaloEngagementPending', 'zaloEngagementSource', 'zaloStatusRef'])
    assert.equal(both.zaloStatusRef.k, 'friend_request')

    // Không cổng nào: rỗng, markSending không lỗi.
    const none = beginZaloEngagement({}, ctx, 'U1', 'message')
    none.markSending()
    assert.deepEqual(none.finish('resp'), {})

    // Bên mới lỗi (lúc bắt đầu, lúc đánh dấu, lúc dựng dữ liệu): bên cũ vẫn nguyên.
    const traces = []
    const brokenBegin = beginZaloEngagement({ ...oldPort, trace: event => traces.push(event.type),
      messageStatusBegin: () => { throw new Error('hỏng') } }, ctx, 'U1', 'message').finish({ msgId: 'm1' })
    assert.deepEqual(Object.keys(brokenBegin).sort(), ['zaloEngagementPending', 'zaloEngagementSource'])
    assert.deepEqual(traces, ['message_status_begin_failed'])
    const brokenData = beginZaloEngagement({ ...oldPort, messageStatusBegin: () => ({
      markSending: () => { throw new Error('hỏng') }, detailData: () => { throw new Error('hỏng') } }) }, ctx, 'U1', 'message')
    brokenData.markSending()
    assert.deepEqual(Object.keys(brokenData.finish({ msgId: 'm1' })).sort(), ['zaloEngagementPending', 'zaloEngagementSource'])

    // Bên cũ lỗi hoặc đã bỏ giữ chỗ: bên mới vẫn có dấu tham chiếu.
    const oldBroken = beginZaloEngagement({ ...statusPort, engagementBegin: () => { throw new Error('hỏng') } }, ctx, 'U1', 'message')
    assert.deepEqual(Object.keys(oldBroken.finish('resp')), ['zaloStatusRef'])
    const abandonedFirst = beginZaloEngagement({ ...oldPort, ...statusPort }, ctx, 'U1', 'message')
    abandonedFirst.abandon()
    assert.equal(abandoned, 1)
    assert.deepEqual(Object.keys(abandonedFirst.finish('resp')), ['zaloStatusRef'])
  })

  await check('độc lập với theo dõi tương tác cũ và được gắn đủ các điểm gửi / bộ nghe', async () => {
    const importsOf = file => [...read(file).matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(match => match[1])
    for (const file of ['src/shared/zaloMessageStatusSync.ts', 'src/main/services/zaloMessageStatusRuntime.ts', 'src/main/services/zaloMessageStatusSync.ts']) {
      assert.ok(!importsOf(file).some(name => /zaloCampaignEngagement/.test(name)), `${file} không được import cơ chế cũ`)
      assert.ok(!/campaign_engagement|zaloEngagementSource|zaloEngagementPending|auto_campaign_detail_zalo_engagement/.test(
        read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${file} không được dùng khoá hay bảng của cơ chế cũ`)
    }
    assert.ok(!/zaloMessageStatus|zaloStatusRef|message_status_sync/.test(read('src/main/services/zaloCampaignEngagement.ts')),
      'cơ chế cũ không được biết gì về tính năng mới')
    assert.deepEqual(importsOf('src/shared/zaloMessageStatusSync.ts'), [], 'hợp đồng dùng chung không import gì')
    assert.deepEqual(importsOf('src/main/services/zaloMessageStatusRuntime.ts'), ['../../shared/zaloMessageStatusSync'])

    // Bộ chạy cũ: bốn điểm gửi, mỗi điểm bắt đầu trước lệnh gửi và trải dữ liệu vào kết quả gửi thành công với đúng phản hồi.
    const scheduler = read('src/main/services/campaignScheduler.ts')
    const count = pattern => (scheduler.match(pattern) || []).length
    assert.equal(count(/beginZaloMessageStatusSend\(account, this\.zaloRuntime\.getCachedOwnUid\?\.\(account\.id\), /g), 4)
    assert.equal(count(/beginZaloMessageStatusSend\([^\n]*, 'message'\)/g), 3, 'nhắn người lạ, nhắn bạn bè, chia sẻ cho bạn bè')
    assert.equal(count(/beginZaloMessageStatusSend\([^\n]*target\.uid, 'friend_request'\)/g), 1, 'kết bạn')
    assert.equal(count(/\.\.\.\(statusSend\?\.detailData\(response\) \?\? \{\}\)/g), 2, 'tin 1-1: phản hồi của lệnh gửi')
    assert.equal(count(/\.\.\.\(statusSend\?\.detailData\(null\) \?\? \{\}\)/g), 1, 'kết bạn: không có mã tin')
    assert.equal(count(/\.\.\.\(isGroup \? \{\} : statusSend\?\.detailData\(\[mediaResponse, mappedForwardResponse\]\) \?\? \{\}\)/g), 1, 'chia sẻ: không áp cho group')
    assert.equal(count(/statusSendByInput\.get\(item\.detail\.id\)\?\.markSending\(\)/g), 2, 'chia sẻ: giờ gửi theo từng người')
    for (const site of scheduler.split('beginZaloMessageStatusSend(account, ').slice(1)) {
      const upToCatch = site.slice(0, site.indexOf('} catch (err)') > 0 ? site.indexOf('} catch (err)') : 4000)
      assert.ok(/detailData\(|statusSendByInput\.set\(/.test(upToCatch), 'dấu tham chiếu chỉ nằm ở nhánh gửi thành công, trước khối xử lý lỗi')
    }

    // Bộ nghe: khối của tính năng mới đứng SAU khối của cơ chế cũ, ngoài try/catch của nó, và chỉ theo công tắc của chính mình.
    const zaloRuntime = read('src/main/services/zaloRuntimeService.ts')
    const from = zaloRuntime.indexOf('private notifyRealtimeSubscribers(')
    const body = zaloRuntime.slice(from, zaloRuntime.indexOf('const subscribers = this.realtimeListenerSubscribers.get(accountId)', from))
    const oldCatch = body.indexOf("catch { console.warn('[ZaloEngagement] Event metadata unavailable'")
    const gate = body.indexOf('if (zaloMessageStatusSyncEnabled()) {')
    assert.ok(from > 0 && oldCatch > 0 && gate > oldCatch, 'khối mới nằm sau khối cũ đã đóng try/catch')
    const oldBlock = body.slice(0, oldCatch), newBlock = body.slice(gate)
    assert.ok(!/receiveZaloMessageStatus|zaloMessageStatusSyncEnabled/.test(oldBlock), 'khối cũ không gọi tính năng mới')
    assert.ok(!/campaignEngagementEnabled|receiveCampaignEngagement/.test(newBlock), 'khối mới không phụ thuộc công tắc hay hàm của cơ chế cũ')
    for (const type of ['message', 'reaction', 'friend_event', 'seen_messages', 'delivered_messages']) {
      assert.ok(newBlock.includes(`receiveStatus('${type}'`), `bộ nghe phải chuyển sự kiện ${type}`)
    }
    assert.ok(newBlock.includes("catch { console.warn('[ZaloMessageStatus] Event metadata unavailable'"), 'khối mới có try/catch riêng')
    assert.ok(/return campaignEngagementEnabled\(\) \|\| zaloMessageStatusSyncEnabled\(\)/.test(zaloRuntime), 'bộ nghe được mở khi một trong hai tính năng bật')
    assert.equal((zaloRuntime.match(/this\.optionalTrackingWantsListener\(\)/g) || []).length, 2, 'cả hai chỗ mở bộ nghe dùng điều kiện chung')

    // Bộ chạy mới: cổng Desktop trả nguyên lần gửi (có markSending); lõi gọi markSending ở hai điểm gửi của lô chia sẻ.
    const port = read('src/main/engineAdapters/desktopZaloPort.ts')
    assert.ok(/messageStatusBegin: \(_ctx, targetUid, actionType\) => \{\s*const send = beginZaloMessageStatusSend\(/.test(port))
    const share = read('packages/campaign-engine/src/zalo/share.ts')
    assert.equal((share.match(/engagements\.get\(v\.item\.targetRunId\)\?\.markSending\(\)/g) || []).length, 2)
    assert.equal(contract.MESSAGE_STATUS_INGEST_RPC, 'aka_agent_ingest_zalo_message_status')
    assert.equal(contract.MESSAGE_STATUS_DESKTOP_INGEST_RPC, 'aka_agent_desktop_ingest_zalo_message_status')
  })

  console.log(`\nzalo message status sync smoke: ${results.length} nhóm đạt`)
}

main().then(() => fs.rmSync(outDir, { recursive: true, force: true }), error => {
  fs.rmSync(outDir, { recursive: true, force: true })
  console.error(error)
  process.exit(1)
})
