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
for (const file of ['src/shared/zaloMessageStatusSync.ts', 'src/main/services/zaloMessageStatusRuntime.ts']) {
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const target = path.join(outDir, file.replace(/\.ts$/, '.js'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, js)
}
const contract = require(path.join(outDir, 'src/shared/zaloMessageStatusSync.js'))
const { ZaloMessageStatusRuntime, CONFIG_MAX_AGE_MS } = require(path.join(outDir, 'src/main/services/zaloMessageStatusRuntime.js'))

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
  })

  await check('chưa có dòng cấu hình: tắt hẳn, không gọi hàm nhận lô, chỉ đọc cấu hình 5 phút một lần', async () => {
    const { runtime, state, advance, ready } = harness()
    await ready()
    assert.equal(runtime.enabled(7), false)
    const send = runtime.beginSend(account, 'U1', 'message')
    assert.deepEqual(send.detailData({ message: { msgId: 'm1' } }), {})
    for (let i = 0; i < 200; i += 1) runtime.receive('message', message('U1', `r${i}`, START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 0)
    assert.equal(state.timers.length, 0)
    await advance(4 * MINUTE)
    runtime.enabled(); await runtime.settled()
    assert.equal(state.settingsReads, 1, 'trong 5 phút chỉ một lượt đọc')
    await advance(2 * MINUTE)
    runtime.enabled(); await runtime.settled()
    assert.equal(state.settingsReads, 2, 'quá 5 phút thì đọc lại một lượt')
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

  await check('DB báo đang tắt hoặc tạm ngừng: bỏ bộ đệm, ngừng thu, đọc lại cấu hình ngay', async () => {
    const { runtime, state, advance, ready } = harness({ settings: { enabled: 'true' },
      ingest: () => ({ enabled: false, paused: true, accepted: 0, matched: 0, stored: 0, rejectedAccountIds: [] }) })
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
    assert.equal(runtime.pending, 0, 'vẫn đang tạm ngừng thu')
    await advance(CONFIG_MAX_AGE_MS + 1000)
    runtime.receive('message', message('U1', 'r4', START), 501, 'acc501', 7)
    assert.equal(runtime.pending, 1, 'hết thời gian tạm ngừng thì thu lại')
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

  await check('độc lập với theo dõi tương tác cũ và được gắn đủ các điểm gửi / bộ nghe', async () => {
    const importsOf = file => [...read(file).matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map(match => match[1])
    for (const file of ['src/shared/zaloMessageStatusSync.ts', 'src/main/services/zaloMessageStatusRuntime.ts', 'src/main/services/zaloMessageStatusSync.ts']) {
      assert.ok(!importsOf(file).some(name => /zaloCampaignEngagement/.test(name)), `${file} không được import cơ chế cũ`)
      assert.ok(!/campaign_engagement|zaloEngagementSource|zaloEngagementPending|auto_campaign_detail_zalo_engagement/.test(
        read(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')), `${file} không được dùng khoá hay bảng của cơ chế cũ`)
    }
    assert.deepEqual(importsOf('src/shared/zaloMessageStatusSync.ts'), [], 'hợp đồng dùng chung không import gì')
    assert.deepEqual(importsOf('src/main/services/zaloMessageStatusRuntime.ts'), ['../../shared/zaloMessageStatusSync'])
    const scheduler = read('src/main/services/campaignScheduler.ts')
    assert.equal((scheduler.match(/beginZaloMessageStatusSend\(account, /g) || []).length, 4,
      'bộ chạy cũ: nhắn người lạ, nhắn bạn bè, kết bạn, chia sẻ cho bạn bè')
    assert.equal((scheduler.match(/statusSend\?\.detailData\(/g) || []).length, 4)
    const zaloRuntime = read('src/main/services/zaloRuntimeService.ts')
    for (const type of ['message', 'reaction', 'friend_event', 'seen_messages', 'delivered_messages']) {
      assert.ok(zaloRuntime.includes(`receiveStatus('${type}'`), `bộ nghe phải chuyển sự kiện ${type}`)
    }
    assert.ok(/campaignEngagementEnabled\(\) \|\| zaloMessageStatusSyncEnabled\(\)/.test(zaloRuntime), 'bộ nghe được mở khi một trong hai tính năng bật')
    assert.ok(read('src/main/engineAdapters/desktopZaloPort.ts').includes('messageStatusBegin:'), 'bộ chạy mới của Desktop')
    assert.ok(read('packages/campaign-engine/src/zalo/engagement.ts').includes('port.messageStatusBegin?.('), 'lõi gọi cổng')
    const wiring = read('src/main/services/zaloMessageStatusSync.ts')
    assert.ok(wiring.includes("MESSAGE_STATUS_INGEST_RPC, { p_source: 'server', p_events: items }"), 'App Server gọi hàm nhận lô chung')
    assert.ok(wiring.includes('MESSAGE_STATUS_DESKTOP_INGEST_RPC, { p_events: items }'), 'Desktop gọi hàm bọc theo phiên')
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
