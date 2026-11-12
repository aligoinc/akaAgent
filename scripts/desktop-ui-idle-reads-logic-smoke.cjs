// Luật thuần của "giảm đọc khi không ai nhìn / khi số tiến độ không đổi" (docs/DESKTOP_UI_IDLE_READS.md):
// - bộ phân tích khóa cài đặt: thiếu/sai/ngoài khoảng = tắt;
// - chu kỳ đọc theo trạng thái cửa sổ/máy;
// - bộ nhớ số tiến độ: lượt nào đếm lại chiến dịch nào, số trả về lấy từ đâu.
// Không DB, không Electron. Chạy: node scripts/desktop-ui-idle-reads-logic-smoke.cjs
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

let passed = 0
const ok = label => { passed += 1; console.log(`ok ${passed} - ${label}`) }

async function load(directory, entry) {
  const outfile = join(directory, `${entry.replace(/[^a-z]/gi, '_')}.cjs`)
  await build({ entryPoints: [resolve(__dirname, '..', entry)], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
  return require(outfile)
}

async function main() {
  const directory = mkdtempSync(join(tmpdir(), 'akaagent-idle-reads-'))
  try {
    const shared = await load(directory, 'src/shared/desktopUiReads.ts')
    const { CampaignProgressReuse, CAMPAIGN_PROGRESS_SETTLE_MS } = await load(directory, 'src/main/data/campaignProgressReuse.ts')

    // ── Khóa cài đặt ────────────────────────────────────────────────────────────────
    assert.deepEqual(Object.values(shared.DESKTOP_UI_TUNING_KEYS), [
      'desktop.campaigns.hidden_pause_enabled', 'desktop.campaigns.idle_after_seconds',
      'desktop.campaigns.idle_poll_interval_seconds', 'desktop.campaigns.progress_recount_seconds'
    ])
    for (const value of ['true', ' TRUE ', true]) assert.equal(shared.parseDesktopUiFlag(value), true)
    for (const value of [undefined, null, '', 'false', '1', 'yes', '{"enabled":true}', false, 0]) assert.equal(shared.parseDesktopUiFlag(value), false)
    const range = shared.DESKTOP_UI_TUNING_RANGES
    assert.equal(shared.parseDesktopUiSeconds('600', range.idleAfterSeconds), 600)
    assert.equal(shared.parseDesktopUiSeconds(' 120 ', range.idlePollSeconds), 120)
    for (const value of [undefined, null, '', '0', '59', '86401', '-600', '600.5', '6e2', 'abc', '600s', NaN]) {
      assert.equal(shared.parseDesktopUiSeconds(value, range.idleAfterSeconds), 0, `idle_after ${String(value)}`)
    }
    for (const value of ['29', '3601', '0']) assert.equal(shared.parseDesktopUiSeconds(value, range.progressRecountSeconds), 0)
    ok('khóa cài đặt: thiếu, sai định dạng hoặc ngoài khoảng đều = tắt')

    // ── Chu kỳ đọc theo trạng thái ───────────────────────────────────────────────────
    const off = { campaigns: 30, accounts: 30 }
    const seen = { hidden: false, idleSeconds: 0 }
    const away = { hidden: true, idleSeconds: 9999 }
    assert.equal(shared.desktopUiAttentionEnabled(off), false)
    assert.equal(shared.desktopUiReadsPaused(off, away), false)
    assert.equal(shared.desktopUiIdle(off, away), false)
    assert.equal(shared.desktopUiPollSeconds(30, off, away), 30)
    ok('mọi khóa tắt: không ngừng, không giãn, kể cả khi cửa sổ ẩn và máy không có thao tác')

    const pause = { ...off, hiddenPauseEnabled: true }
    assert.equal(shared.desktopUiAttentionEnabled(pause), true)
    assert.equal(shared.desktopUiReadsPaused(pause, away), true)
    assert.equal(shared.desktopUiReadsPaused(pause, seen), false)
    assert.equal(shared.desktopUiPollSeconds(30, pause, away), 30, 'bật ngừng khi ẩn không tự bật giãn')
    const idle = { ...off, idleAfterSeconds: 600, idlePollSeconds: 120 }
    assert.equal(shared.desktopUiAttentionEnabled(idle), true)
    assert.equal(shared.desktopUiReadsPaused(idle, away), false, 'bật giãn không tự bật ngừng khi ẩn')
    assert.equal(shared.desktopUiPollSeconds(30, idle, { hidden: false, idleSeconds: 599 }), 30)
    assert.equal(shared.desktopUiPollSeconds(30, idle, { hidden: false, idleSeconds: 600 }), 120)
    assert.equal(shared.desktopUiPollSeconds(300, idle, { hidden: false, idleSeconds: 600 }), 300, 'chỉ giãn, không bao giờ rút ngắn chu kỳ thường')
    for (const half of [{ ...off, idleAfterSeconds: 600 }, { ...off, idlePollSeconds: 120 }]) {
      assert.equal(shared.desktopUiAttentionEnabled(half), false, 'giãn cần đủ cả hai khóa')
      assert.equal(shared.desktopUiPollSeconds(30, half, away), 30)
    }
    ok('ngừng khi ẩn và giãn khi không có thao tác là hai công tắc độc lập; giãn cần đủ hai khóa')

    for (const value of [undefined, null, 'x', 1, {}, { hidden: 'true', idleSeconds: -5 }, { hidden: 1, idleSeconds: 'abc' }]) {
      assert.deepEqual(shared.normalizeDesktopUiAttention(value), { hidden: false, idleSeconds: 0 })
    }
    assert.deepEqual(shared.normalizeDesktopUiAttention({ hidden: true, idleSeconds: 61.9, extra: 1 }), { hidden: true, idleSeconds: 61 })
    ok('trạng thái cửa sổ lạ hoặc thiếu = đang có người nhìn')

    for (const value of [undefined, null, 'reuse', {}, { progress: 'reuse' }, { progress: 'reuse', recountSeconds: 0 },
      { progress: 'reuse', recountSeconds: 29 }, { progress: 'reuse', recountSeconds: 3601 }, { progress: 'reuse', recountSeconds: '300' },
      { progress: 'reuse', recountSeconds: 300.5 }, { progress: 'skip', recountSeconds: 300 }]) {
      assert.equal(shared.normalizeDesktopCampaignPageReadOptions(value), null, JSON.stringify(value))
    }
    assert.deepEqual(shared.normalizeDesktopCampaignPageReadOptions({ progress: 'reuse', recountSeconds: 300, staffId: 9 }), { progress: 'reuse', recountSeconds: 300 })
    assert.deepEqual(shared.normalizeDesktopCampaignPageReadOptions({ progress: 'full', recountSeconds: 30 }), { progress: 'full', recountSeconds: 30 })
    ok('tùy chọn đếm tiến độ từ giao diện: sai là bỏ (đếm tất cả như trước), không nhận trường lạ')

    // ── Bộ nhớ số tiến độ ────────────────────────────────────────────────────────────
    let now = 1_000_000
    const reuse = new CampaignProgressReuse(() => now, 5)
    const scope = '1:41'
    // Hạn đếm lại dài hơn tổng thời gian của các bước bên dưới; riêng bước kiểm tra hạn sẽ đi đúng tới mốc này.
    const recountMs = 900_000
    const rows = () => [
      { id: 1, status: 'đang chạy', updatedAt: 'u1', lastRunAt: 'r1' },
      { id: 2, status: 'chờ xử lý', updatedAt: 'u2', lastRunAt: null },
      { id: 3, status: 'tạm dừng', updatedAt: 'u3', lastRunAt: 'r3' },
      { id: 4, status: 'hoàn thành', updatedAt: 'u4', lastRunAt: 'r4' }
    ]
    const db = new Map([[1, { completed: 5, total: 10 }], [2, { completed: 0, total: 20 }], [3, { completed: 7, total: 30 }]])
    const calls = []
    const loadCounts = async ids => { calls.push([...ids]); return new Map(ids.map(id => [id, { ...(db.get(id) || { completed: 0, total: 0 }) }])) }
    const read = (mode, list = rows(), selectedId = null) => reuse.resolve(scope, list, { mode, recountMs, selectedId }, loadCounts)
    const numbers = result => [...result].map(([id, value]) => [id, value.completed, value.total])

    let result = await read('reuse')
    assert.deepEqual(calls.pop(), [1, 2, 3, 4], 'chưa có số thì đếm tất cả')
    assert.deepEqual(numbers(result), [[1, 5, 10], [2, 0, 20], [3, 7, 30], [4, 0, 0]])
    now += 30_000
    await read('reuse')
    assert.deepEqual(calls.pop(), [1, 2, 3, 4], 'vừa ghi nhớ: còn trong khoảng chờ ổn định nên vẫn đếm')
    now += CAMPAIGN_PROGRESS_SETTLE_MS
    db.set(3, { completed: 9, total: 30 })
    result = await read('reuse')
    assert.deepEqual(calls.pop(), [1], 'ổn định rồi: chỉ đếm chiến dịch đang chạy')
    assert.deepEqual(numbers(result), [[1, 5, 10], [2, 0, 20], [3, 7, 30], [4, 0, 0]], 'chiến dịch không đổi dấu hiệu dùng số đã ghi nhớ')
    ok('lượt đầu đếm tất cả; sau khoảng chờ ổn định chỉ đếm chiến dịch đang chạy, 0 dòng data được ghi nhớ là 0/0')

    now += 30_000
    result = await read('reuse', rows(), 3)
    assert.deepEqual(calls.pop(), [1, 3], 'chiến dịch đang mở chi tiết luôn được đếm')
    assert.deepEqual(result.get(3), { completed: 9, total: 30 })
    now += CAMPAIGN_PROGRESS_SETTLE_MS
    const changed = rows(); changed[1].updatedAt = 'u2b'
    db.set(2, { completed: 0, total: 25 })
    result = await read('reuse', changed)
    assert.deepEqual(calls.pop(), [1, 2], 'updated_at đổi (thêm data, kết quả chạy) thì đếm lại')
    assert.deepEqual(result.get(2), { completed: 0, total: 25 })
    now += 30_000
    await read('reuse', changed)
    assert.deepEqual(calls.pop(), [1, 2], 'vừa đổi: đếm thêm trong khoảng chờ ổn định')
    now += CAMPAIGN_PROGRESS_SETTLE_MS
    await read('reuse', changed)
    assert.deepEqual(calls.pop(), [1])
    for (const [field, value] of [['status', 'hoàn thành'], ['lastRunAt', 'r3b'], ['dataGroupSourceUpdatedAt', 's1']]) {
      const next = changed.map(row => ({ ...row })); next[2][field] = value
      assert.deepEqual(reuse.plan(scope, next, { recountMs }), [1, 3], `${field} đổi thì đếm lại`)
    }
    for (const status of ['baselining', 'active']) {
      const next = changed.map(row => ({ ...row })); next[3].dataGroupSourceStatus = status
      await read('full', next)
      calls.pop()
      now += CAMPAIGN_PROGRESS_SETTLE_MS
      assert.deepEqual(reuse.plan(scope, next, { recountMs }), [1, 4], `nguồn nhóm data ${status} luôn đếm`)
    }
    await read('full', changed)
    calls.pop()
    now += CAMPAIGN_PROGRESS_SETTLE_MS
    ok('đếm lại khi: đang mở chi tiết, trạng thái/updated_at/last_run_at/nguồn nhóm data đổi, nguồn nhóm data còn sống')

    db.set(4, { completed: 3, total: 3 })
    now += recountMs - CAMPAIGN_PROGRESS_SETTLE_MS - 1
    await read('reuse', changed)
    assert.deepEqual(calls.pop(), [1], 'chưa tới hạn đếm lại')
    now += 1
    result = await read('reuse', changed)
    assert.deepEqual(calls.pop(), [1, 2, 3, 4], 'tới hạn: đếm lại cả chiến dịch không đổi dấu hiệu')
    assert.deepEqual(result.get(4), { completed: 3, total: 3 }, 'thay đổi không để lại dấu hiệu được bắt sau tối đa một hạn đếm lại')
    ok('số của chiến dịch không chạy cũ tối đa đúng bằng hạn đếm lại')

    now += CAMPAIGN_PROGRESS_SETTLE_MS
    db.set(4, { completed: 4, total: 4 })
    result = await read('full', changed)
    assert.deepEqual(calls.pop(), [1, 2, 3, 4], 'lượt đọc do người dùng gây ra đếm tất cả')
    assert.deepEqual(result.get(4), { completed: 4, total: 4 })
    now += CAMPAIGN_PROGRESS_SETTLE_MS
    result = await read('reuse', changed)
    assert.deepEqual(calls.pop(), [1])
    assert.deepEqual(result.get(4), { completed: 4, total: 4 }, 'lượt nền sau Làm mới không quay về số cũ')
    ok('lượt đếm đầy đủ ghi nhớ số mới: lượt nền kế tiếp không lùi về số cũ')

    const none = [{ id: 2, status: 'chờ xử lý', updatedAt: 'u2b', lastRunAt: null }, { id: 4, status: 'hoàn thành', updatedAt: 'u4', lastRunAt: 'r4' }]
    const before = calls.length
    result = await read('reuse', none)
    assert.equal(calls.length, before, 'không có chiến dịch nào cần đếm thì không gọi hàm đếm')
    assert.deepEqual(numbers(result), [[2, 0, 25], [4, 4, 4]])
    assert.deepEqual(numbers(await read('reuse', [])), [])
    assert.equal(calls.length, before)
    ok('không có gì cần đếm: bỏ hẳn lượt gọi DB, vẫn trả đủ số')

    await assert.rejects(reuse.resolve(scope, changed, { mode: 'reuse', recountMs }, async () => { throw new Error('rpc down') }), /rpc down/)
    assert.deepEqual(reuse.get(scope, 3), { completed: 9, total: 30 }, 'lỗi đếm không làm hỏng số đã ghi nhớ')
    await assert.rejects(reuse.resolve(scope, changed, { mode: 'full', recountMs }, async () => { throw new Error('rpc down') }), /rpc down/)
    ok('lỗi của hàm đếm được ném ra như trước, không trả số cũ thay thế')

    // Lượt đếm bắt đầu trước nhưng trả về sau không được ghi đè số của lượt bắt đầu muộn hơn.
    let release
    const slow = reuse.resolve(scope, changed, { mode: 'full', recountMs }, ids => new Promise(resolvePromise => {
      release = () => resolvePromise(new Map(ids.map(id => [id, { completed: 1, total: 1 }])))
    }))
    now += 10
    await reuse.resolve(scope, changed, { mode: 'full', recountMs }, async ids => new Map(ids.map(id => [id, { completed: 2, total: 2 }])))
    release()
    assert.deepEqual((await slow).get(3), { completed: 1, total: 1 }, 'lượt cũ vẫn trả đúng số nó đọc được')
    assert.deepEqual(reuse.get(scope, 3), { completed: 2, total: 2 }, 'bộ nhớ giữ số của lượt bắt đầu muộn hơn')
    ok('hai lượt đếm chồng nhau: bộ nhớ giữ số của lượt bắt đầu sau')

    await read('full', changed)
    calls.pop()
    now += CAMPAIGN_PROGRESS_SETTLE_MS
    now -= 3_600_000
    assert.deepEqual(reuse.plan(scope, changed, { recountMs }), [1, 2, 3, 4], 'đồng hồ máy lùi: coi số là đã cũ')
    now += 3_600_000
    assert.deepEqual(reuse.plan('1:42', changed, { recountMs }), [1, 2, 3, 4], 'đổi nhân viên: bỏ hết số của phiên trước')
    assert.equal(reuse.get(scope, 3), undefined)
    assert.equal(reuse.get('1:42', 3), undefined)
    await reuse.resolve('1:42', Array.from({ length: 8 }, (_, index) => ({ id: 100 + index, status: 'tạm dừng', updatedAt: 'u' })), { mode: 'full', recountMs }, loadCounts)
    calls.pop()
    assert.equal(reuse.get('1:42', 100), undefined, 'vượt giới hạn: bỏ mục cũ nhất')
    assert.equal(reuse.get('1:42', 102), undefined)
    assert.deepEqual(reuse.get('1:42', 103), { completed: 0, total: 0 })
    assert.deepEqual(reuse.get('1:42', 107), { completed: 0, total: 0 })
    reuse.clear()
    assert.equal(reuse.get('1:42', 107), undefined)
    ok('đồng hồ lùi, đổi phiên, giới hạn kích thước và xóa bộ nhớ')

    console.log(`\n${passed} nhóm kiểm tra đạt`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error); process.exit(1) })
