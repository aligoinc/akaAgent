// Kiểm bước "chỉ gửi bạn bè" cho dòng do gắn tag thêm (V660) của lõi engine. Cách chạy: node scripts/zalo-tag-sync/engine-friend-check-smoke.cjs
const path = require('path')
const esbuild = require('esbuild')
const assert = require('assert')
const root = path.resolve(__dirname, '../..')
const out = esbuild.buildSync({ entryPoints: [path.join(root, 'packages/campaign-engine/src/zalo/tagAutoAdd.ts')], bundle: true,
  platform: 'node', format: 'cjs', write: false })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { checkZaloTagAutoAddFriend, isZaloTagAutoAddTarget } = mod.exports
const ctx = { signal: new AbortController().signal }
const row = (key) => ({ id: 1, campaign_id: 1, name: 'A', phone: null, uid: '901', email: null, control_append_idempotency_key: key })
const port = (value) => ({ calls: 0, async friendStatus() { this.calls++; if (value instanceof Error) throw value; return value } })
let n = 0
const ok = (cond, label) => { assert.ok(cond, label); n++; console.log('PASS:', label) }
;(async () => {
  ok(isZaloTagAutoAddTarget(row('zalotag:1:901')) && !isZaloTagAutoAddTarget(row(null)), 'nhận ra dòng do gắn tag thêm')
  let p = port(false)
  let r = await checkZaloTagAutoAddFriend(p, ctx, row(null))
  ok(r.kind === 'allowed' && p.calls === 0, 'dòng thường không kiểm, không gọi Zalo')
  r = await checkZaloTagAutoAddFriend(port(true), ctx, row('zalotag:1:901'))
  ok(r.kind === 'allowed', 'đã là bạn bè thì gửi')
  r = await checkZaloTagAutoAddFriend(port(false), ctx, row('zalotag:1:901'))
  ok(r.kind === 'blocked' && r.outcome.signal.code === 'zalo_tag_not_friend' && r.outcome.phase === 'before_send'
    && r.outcome.signal.message === 'Chưa là bạn bè nên không gửi', 'chưa là bạn bè thì bỏ qua (EXC04)')
  r = await checkZaloTagAutoAddFriend(port(null), ctx, row('zalotag:1:901'))
  ok(r.kind === 'blocked' && r.outcome.signal.code === 'zalo_tag_friend_unavailable', 'Zalo không trả lời rõ thì hẹn chạy lại (EXC05)')
  r = await checkZaloTagAutoAddFriend(port(new Error('mạng lỗi')), ctx, row('zalotag:1:901'))
  ok(r.kind === 'blocked' && r.outcome.signal.code === 'zalo_tag_friend_unavailable' && /mạng lỗi/.test(r.outcome.signal.message), 'lỗi đọc thì hẹn chạy lại (EXC05)')
  const ac = new AbortController(); ac.abort()
  await assert.rejects(checkZaloTagAutoAddFriend(port(true), { signal: ac.signal }, row('zalotag:1:901'))); n++; console.log('PASS: lượt bị huỷ thì dừng, không báo kết quả')
  // Tổ hợp ngẫu nhiên: khoá dòng, UID, câu trả lời của Zalo (đúng / sai / null / lỗi / treo), lượt bị huỷ.
  let seed = Number(process.env.SEED || 1)
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const pick = xs => xs[Math.floor(rnd() * xs.length)]
  for (let i = 0; i < 3000; i++) {
    const key = pick([null, '', 'zalotag:1:901', 'zalotag:', 'ZALOTAG:1:9', 'x zalotag:1', 'zalotag:9:abc'])
    const uid = pick(['901', ' 902 ', '', null, 'g55'])
    const answer = pick([true, false, null, 'err', 'hang', 1, 'yes'])
    let calls = 0
    const p = { async friendStatus(_c, u) { calls++; if (u !== String(uid ?? '').trim()) throw new Error('uid lệch'); if (answer === 'err') throw new Error('mạng'); if (answer === 'hang') return new Promise(() => {}); return answer } }
    const aborted = rnd() < 0.05; const ac2 = new AbortController(); if (aborted) ac2.abort()
    const target = { ...row(key), uid }
    let res, threw = false
    try { res = await checkZaloTagAutoAddFriend(p, { signal: ac2.signal }, target, 20) } catch { threw = true }
    const isTag = String(key ?? '').startsWith('zalotag:')
    const hasUid = String(uid ?? '').trim() !== ''
    if (!isTag || !hasUid) { assert.ok(!threw && res.kind === 'allowed' && calls === 0, `không kiểm khi không phải dòng gắn tag / thiếu UID (${key}, ${uid})`); continue }
    if (aborted) { assert.ok(threw, 'huỷ thì ném'); continue }
    assert.ok(!threw && calls === 1, `gọi Zalo đúng một lần (${answer})`)
    if (answer === true) assert.equal(res.kind, 'allowed')
    else if (answer === false) assert.ok(res.kind === 'blocked' && res.outcome.signal.code === 'zalo_tag_not_friend')
    else assert.ok(res.kind === 'blocked' && res.outcome.signal.code === 'zalo_tag_friend_unavailable' && res.outcome.phase === 'before_send', `không rõ thì hẹn lại (${answer})`)
  }
  n++; console.log('PASS: 3.000 tổ hợp ngẫu nhiên')
  console.log(`ALL PASS (${n})`)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
