#!/usr/bin/env node
/*
 * Bộ kiểm ngẫu nhiên phần hỏi tag của Desktop / App Server (src/main/services/zaloTagSyncRuntime.ts) với Zalo và DB giả có lỗi
 * ngẫu nhiên. DB giả làm đúng luật V660 cho nguồn Desktop / App Server (nhịp phiên bản, xin danh sách, quá `stale` phút thì chỉ
 * lấy mốc). Kiểm:
 *   R1 không bao giờ ném lỗi;  R2 mỗi lời gọi ≤ 200 mục, nhiều nhất một mục kèm danh sách tag;
 *   R3 danh sách gửi đi khớp đúng lần đọc Zalo của nhịp đó, cùng phiên bản với nhịp phiên bản;
 *   R4 chỉ gửi danh sách cho tài khoản DB vừa xin;  R5 DB báo tắt / từ chối thì ngừng đọc tài khoản đó tới lần đọc lại danh sách;
 *   R6 không có lỗi (Zalo, DB ổn) thì mọi lần đổi tag được DB so (không chỉ lấy mốc) ngay ở nhịp kế tiếp.
 * Cách chạy: node scripts/zalo-tag-sync/runtime-fuzz.cjs --seed 1 [--runs 400]
 */
const path = require('path')
const esbuild = require('esbuild')
const root = path.resolve(__dirname, '../..')
const argv = process.argv.slice(2)
const arg = (n, f) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : f }
const SEED = Number(arg('seed', '1')); const RUNS = Number(arg('runs', '400'))
const build = entry => { const o = esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', write: false }); const m = { exports: {} }; new Function('module', 'exports', 'require', o.outputFiles[0].text)(m, m.exports, require); return m.exports }
const { ZaloTagSyncRuntime } = build('src/main/services/zaloTagSyncRuntime.ts')
const { zaloTagSnapshotFromLabels } = build('src/shared/zaloTagAutoAdd.ts')

let s = SEED >>> 0 || 1
const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 }
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const chance = p => rnd() < p
const fails = []; let checks = 0; let diffs = 0; let changesClean = 0
const bad = (run, msg, d) => { fails.push(msg); if (fails.length <= 10) console.log('FAIL', run, msg, d ? JSON.stringify(d).slice(0, 400) : '') }

;(async () => {
  for (let run = 0; run < RUNS; run++) {
    const clean = chance(0.3) // lượt không có lỗi nào: kiểm R6
    const n = chance(0.1) ? ri(150, 450) : ri(1, 6)
    const ids = Array.from({ length: n }, (_, i) => 100 + i)
    const zalo = new Map(ids.map(id => [id, { version: ri(1, 5), labels: [{ id: ri(1, 3), text: 'VIP', conversations: ['901', 'g5', ' 902 ', 'x', null] }] }]))
    const db = new Map() // id -> {version, lastSeen, baseline}
    let now = 0; const STALE = 30 * 60_000
    let enabled = true; const rejectedDb = new Set()
    let tickReads = new Map(); let tickHeartbeat = new Map(); let tickNeed = new Set()
    let afterDisable = false; let afterReject = new Set()
    let pendingChange = new Set()
    const rt = new ZaloTagSyncRuntime({
      now: () => now,
      loadAccounts: async () => { if (!clean && chance(0.05)) throw new Error('db down'); afterDisable = false; afterReject = new Set(); return { enabled, pollSeconds: 60, accountIds: ids } },
      readLabels: async id => {
        checks++
        if (afterDisable) bad(run, 'R5 vẫn đọc Zalo sau khi DB báo tắt')
        if (afterReject.has(id)) bad(run, 'R5 vẫn đọc tài khoản DB đã từ chối', id)
        if (!clean && chance(0.05)) throw new Error('zalo')
        if (!clean && chance(0.03)) return null
        const z = zalo.get(id); const read = { version: String(z.version), labels: JSON.parse(JSON.stringify(z.labels)) }
        tickReads.set(id, read); return read
      },
      sync: async items => {
        checks++
        if (!Array.isArray(items) || items.length > 200) bad(run, 'R2 quá 200 mục', items.length)
        const withTags = items.filter(x => x.tags)
        if (withTags.length > 1) bad(run, 'R2 hai danh sách một lần')
        if (!clean && chance(0.05)) throw new Error('timeout')
        if (!clean && chance(0.02)) enabled = false
        if (!enabled) { afterDisable = true; return { enabled: false } }
        const need = []; const rejected = []; const baselined = []
        for (const it of items) {
          const id = Number(it.a)
          if (rejectedDb.has(id)) { rejected.push(it.a); afterReject.add(id); continue }
          const st = db.get(id)
          if (!it.tags) {
            tickHeartbeat.set(id, it.v)
            if (st && st.baseline && st.version === it.v && it.v !== '') st.lastSeen = now
            else { need.push(it.a); tickNeed.add(id) }
            continue
          }
          if (!tickNeed.has(id)) bad(run, 'R4 gửi danh sách khi DB không xin', id)
          const read = tickReads.get(id)
          if (!read || read.version !== it.v || tickHeartbeat.get(id) !== it.v) bad(run, 'R3 phiên bản danh sách khác lần đọc / nhịp phiên bản', { id, v: it.v })
          else if (JSON.stringify(zaloTagSnapshotFromLabels(read.labels)) !== JSON.stringify(it.tags)) bad(run, 'R3 danh sách khác lần đọc')
          if (!st || !st.baseline || now - st.lastSeen > STALE) { db.set(id, { version: it.v, lastSeen: now, baseline: true }); baselined.push(it.a); if (clean && pendingChange.has(id) && st) bad(run, 'R6 lượt không lỗi mà DB chỉ lấy mốc', id) }
          else { st.version = it.v; st.lastSeen = now; diffs++ }
          pendingChange.delete(id)
        }
        return { enabled: true, pollSeconds: 60, needTags: need, rejected, baselined, added: 0, removed: 0, campaignRows: 0 }
      },
      warn: () => {}
    })
    for (let t = 0; t < 25; t++) {
      tickReads = new Map(); tickHeartbeat = new Map(); tickNeed = new Set()
      for (const id of ids) if (chance(0.15)) { zalo.get(id).version++; zalo.get(id).labels.push({ id: ri(1, 9), text: 't', conversations: [String(ri(1000, 9999))] }); if (db.get(id)) { pendingChange.add(id); changesClean++ } }
      if (!clean && chance(0.05)) rejectedDb.add(ids[ri(0, ids.length - 1)])
      if (!clean && chance(0.02)) enabled = true
      now += clean ? 60_000 : (chance(0.1) ? ri(10, 45) * 60_000 : 60_000)
      try {
        // Hai nhịp chồng nhau (bộ hẹn giờ + refreshSoon): phải gộp làm một.
        const a = rt.tick(); const b = chance(0.1) ? rt.tick() : a
        await Promise.all([a, b])
      } catch (e) { bad(run, 'R1 ném lỗi', String(e)) }
      if (chance(0.05)) rt.refreshSoon()
    }
  }
  console.log(`seed ${SEED}: ${RUNS} lượt, ${checks} lần so, ${diffs} lần DB so, ${fails.length} sai lệch`)
  process.exit(fails.length ? 1 : 0)
})()
