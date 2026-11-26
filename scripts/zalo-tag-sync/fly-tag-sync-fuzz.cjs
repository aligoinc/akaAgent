#!/usr/bin/env node
/*
 * Bộ kiểm ngẫu nhiên phần đọc tag trên Fly (ChatApi packages/zalo-zca-adapter/src/tagSync.ts) ghép với luật nhận của DB V660
 * (nguồn 'fly': chỉ so khi `c` = true và `p` = phiên bản đang lưu, không thì chỉ lấy mốc).
 *
 * "Sự thật" (anh chốt 26/11: người được gắn tag lúc mất kết nối thì bỏ): DB được phép so khi và chỉ khi mọi thay đổi tag kể từ
 * phiên bản đang lưu đều diễn ra giữa hai lần đọc liền nhau cách nhau không quá cửa sổ. Lần đọc mà phiên bản không đổi thì khoảng
 * trước nó không có thay đổi nào, nên trễ bao lâu cũng không làm mất gì.
 *   An toàn: cờ liền mạch không bao giờ đúng khi sự thật là "không được so" (thêm nhầm người gắn tag lúc mất kết nối).
 *   Đủ: sự thật là "được so" thì cờ phải đúng (không thì bỏ sót người được gắn tag lúc đang theo dõi).
 * Cách chạy: CHAT_REPO=<akaAgentChatApi> node scripts/zalo-tag-sync/fly-tag-sync-fuzz.cjs --seed 1 [--runs 2000]
 */
const path = require('path')
const CHAT_REPO = process.env.CHAT_REPO || path.resolve(__dirname, '../../../akaagentchatapi')
const esbuild = require(path.join(CHAT_REPO, 'node_modules/esbuild'))
const argv = process.argv.slice(2)
const arg = (n, f) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : f }
const SEED = Number(arg('seed', '1')); const RUNS = Number(arg('runs', '2000'))
const src = arg('src', path.join(CHAT_REPO, 'packages/zalo-zca-adapter/src/tagSync.ts'))
const out = esbuild.buildSync({ entryPoints: [src], bundle: true, platform: 'node', format: 'cjs', write: false,
  nodePaths: [path.join(CHAT_REPO, 'node_modules')], absWorkingDir: CHAT_REPO })
const mod = { exports: {} }
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require)
const { createTagSync } = mod.exports

let s = SEED >>> 0 || 1
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const chance = p => rnd() < p

let unsafe = 0, missed = 0, events = 0, diffs = 0, checks = 0
const samples = []
;(async () => {
  for (let run = 0; run < RUNS; run++) {
    const interval = 60_000, window = interval * 3
    let now = 0, version = ri(1, 9)
    let readFails = false, emitFails = false
    const reads = [] // {at, version} lần đọc thành công
    let stored = null // phiên bản DB đang lưu
    let watched = true
    const sync = createTagSync({ getLabels: async () => { if (readFails) throw new Error('zalo'); return { version, labelData: [] } } },
      { onEvent: async (_t, p) => {
        if (emitFails) throw new Error('chat down')
        events++
        // Sự thật lúc DB nhận sự kiện này.
        let truth = watched && p.previousVersion !== null && p.previousVersion === stored
        if (truth) {
          let L = -1
          for (let i = reads.length - 2; i >= 0; i--) if (String(reads[i].version) === p.previousVersion) { L = i; break }
          if (L < 0) truth = false
          else for (let i = L + 1; i < reads.length; i++) {
            if (reads[i].version !== reads[i - 1].version && reads[i].at - reads[i - 1].at > window) { truth = false; break }
          }
        }
        const dbDiff = watched && p.continuous === true && p.previousVersion === stored
        checks++
        if (dbDiff && !truth) { unsafe++; if (samples.length < 5) samples.push({ kind: 'unsafe', run, reads: reads.slice(-6), p }) }
        if (!dbDiff && truth) { missed++; if (samples.length < 5) samples.push({ kind: 'missed', run, reads: reads.slice(-6), p }) }
        if (dbDiff) diffs++
        if (watched) stored = p.version
      } }, () => now)
    for (let step = 0; step < 40; step++) {
      // Nhịp đọc: thường đúng 60 giây; có lúc trễ (máy bận, mất kết nối ngắn), có lúc dồn.
      now += chance(0.12) ? ri(4, 30) * 60_000 : chance(0.1) ? ri(1, 10) * 1000 : interval + ri(-3000, 3000)
      if (chance(0.3)) version += ri(1, 2) // khách gắn / gỡ tag
      readFails = chance(0.08); emitFails = chance(0.06)
      if (chance(0.03)) watched = !watched
      const before = reads.length
      const pushRead = () => { if (!readFails) reads.push({ at: now, version }) }
      // Ghi lần đọc trước khi gọi để sự thật thấy được lần đọc đang xử lý.
      pushRead()
      try { await sync.sync({ continuousWindowMs: window }) } catch { if (reads.length > before && readFails) reads.pop() }
    }
  }
  console.log(`seed ${SEED}: ${RUNS} kết nối, ${events} sự kiện, ${checks} lần so, ${diffs} lần DB so, không an toàn ${unsafe}, bỏ sót ${missed}`)
  for (const x of samples) console.log(JSON.stringify(x))
  process.exit(unsafe || missed ? 1 : 0)
})()
