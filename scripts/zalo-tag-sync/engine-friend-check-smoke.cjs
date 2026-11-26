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
  ok(r.kind === 'blocked' && r.outcome.signal.code === 'gate_unavailable', 'Zalo không trả lời rõ thì về hàng chờ')
  r = await checkZaloTagAutoAddFriend(port(new Error('mạng lỗi')), ctx, row('zalotag:1:901'))
  ok(r.kind === 'blocked' && r.outcome.signal.code === 'gate_unavailable' && /mạng lỗi/.test(r.outcome.signal.message), 'lỗi đọc thì về hàng chờ')
  const ac = new AbortController(); ac.abort()
  await assert.rejects(checkZaloTagAutoAddFriend(port(true), { signal: ac.signal }, row('zalotag:1:901'))); n++; console.log('PASS: lượt bị huỷ thì dừng, không báo kết quả')
  console.log(`ALL PASS (${n})`)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
