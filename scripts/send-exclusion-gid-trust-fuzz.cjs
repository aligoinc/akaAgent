#!/usr/bin/env node
// Bộ kiểm ngẫu nhiên cho ĐỀ XUẤT kiểm Global ID theo nguồn gốc dòng zalo_users (scripts/build-gid-trust-proposal-sql.cjs), so với V657
// đang chạy. Nạp nguyên scripts/send-exclusion-v657-fuzz.cjs (không sửa file đó), vá trong bộ nhớ:
//   - mỗi dòng zalo_users có raw_payload như production (đo 26/11/2026): dòng ghi sai = hồ sơ quét nhóm (zaloGroupId, globalId của người
//     xem, không có khoá hồ sơ); dòng đúng = hồ sơ đọc trực tiếp (userId, globalId), hoặc không có raw, hoặc quét nhóm rồi đọc hồ sơ ghi đè;
//   - --holes 1 (mặc định) thêm các ca mà luật đếm dòng / tên của V657 không chặn được: nick không ghi Global ID ở đâu mà chỉ có 1 dòng
//     sai (bộ kiểm gốc cố ý đổi ca này thành dòng đúng), tài khoản đổi nick chỉ còn 1–3 dòng của nick cũ, dòng sai có tên rỗng, dòng đúng
//     bị quét nhóm đè cột global_id (raw_payload.globalId vẫn đúng);
//   - --mode proposal: sau V657 nạp SQL đề xuất; bản tính độc lập (JS) đổi theo đề xuất (chỉ dùng dòng tin được).
// "Sự thật" (ai là ai) giữ nguyên của bộ kiểm gốc: không bao giờ loại nhầm người; gid_ok nhận một Global ID thì mọi dòng được dùng là
// của đúng một người.
//   PG_MODULE_DIR=<thư mục có node_modules/pg> LC_ALL=C node scripts/send-exclusion-gid-trust-fuzz.cjs [--mode both|current|proposal]
//     [--holes 1] [--rounds 8] [--seed 1] [--rows 120]
// --mode both (mặc định): chạy hai bản cùng seed; đạt khi bản đề xuất sạch và (với --holes 1) bản đang chạy có lỗi "sự thật".
'use strict'
// Production đã có V666 (17:43:55 VN 26/11): fixture nạp V666 sau V657 (SX_WITH_V666, xem send-exclusion-v657-fixture.cjs).
process.env.SX_WITH_V666 ??= '1'
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const { spawnSync } = require('node:child_process')

const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const MODE = flag('mode', 'both')
const HOLES = Number(flag('holes', 1)) > 0

if (MODE === 'both') {
  const rest = args.filter((a, i) => a !== '--mode' && args[i - 1] !== '--mode')
  const out = {}
  for (const mode of ['current', 'proposal']) {
    const r = spawnSync(process.execPath, [__filename, '--mode', mode, ...rest], { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 })
    const text = (r.stdout || '') + (r.stderr || '')
    const types = /Lỗi theo loại: (\{.*\})/.exec(text)
    out[mode] = { code: r.status, types: types ? JSON.parse(types[1]) : {}, clean: /SẠCH: 0 lỗi/.test(text),
      rounds: text.split('\n').filter(l => l.startsWith('vòng ')), tail: text.split('\n').slice(-25).join('\n'), info: /Theo dõi: (\{.*\})/.exec(text)?.[1] }
    console.log(`\n===== ${mode === 'current' ? 'V657 đang chạy' : 'đề xuất'} (holes ${HOLES ? 1 : 0}) =====`)
    for (const l of out[mode].rounds) console.log(l)
    console.log(out[mode].clean ? 'SẠCH: 0 lỗi' : 'Lỗi theo loại: ' + JSON.stringify(out[mode].types))
    if (!out[mode].clean && !Object.keys(out[mode].types).length) console.log(out[mode].tail)
  }
  const truthErrors = t => (t['loại nhầm người (bước A)'] ?? 0) + (t['loại nhầm người (bước B)'] ?? 0) + (t['gid_ok nhận Global ID ghi sai'] ?? 0)
  const okProposal = out.proposal.clean
  const okCurrent = !HOLES || truthErrors(out.current.types) > 0
  console.log(`\nĐề xuất: ${okProposal ? 'sạch' : 'CÓ LỖI'}. V657 đang chạy: ${truthErrors(out.current.types)} lỗi "sự thật"${HOLES ? ' (phải > 0: bộ kiểm bắt được lỗ hổng)' : ''}.`)
  process.exit(okProposal && okCurrent ? 0 : 1)
}

globalThis.__gidTrust = { proposal: MODE === 'proposal', holes: HOLES }
const file = path.join(__dirname, 'send-exclusion-v657-fuzz.cjs')
let src = fs.readFileSync(file, 'utf8')
const patch = (from, to) => {
  const n = src.split(from).length - 1
  if (n !== 1) throw new Error(`đoạn vá xuất hiện ${n} lần trong send-exclusion-v657-fuzz.cjs: ${from.slice(0, 120)}`)
  src = src.replace(from, () => to)
}

// Cờ + điều kiện "dòng tin được" (bản JS của private.aka_agent_zalo_user_gid_trusted).
patch(`const RECYCLE = Number(arg('recycle', 0)) > 0\n`, `const RECYCLE = Number(arg('recycle', 0)) > 0
const GT = globalThis.__gidTrust || {}
const PROPOSAL = !!GT.proposal
const HOLES = !!GT.holes
const PROFILE_KEYS = ['userId', 'username', 'bizPkg', 'phoneNumber']
function trustedRow(z) {
  const g = btrim(z.gid ?? ''); if (!g) return false
  const r = z.raw || {}
  if ('zaloGroupId' in r && !PROFILE_KEYS.some(k => k in r)) return false
  const rg = btrim(r.globalId ?? '')
  return !rg || rg === g
}
`)
// Bản tính: gid_ok theo đề xuất.
patch(`    const rs = rows(account, btrim(gid)).slice(0, 4)
    const names = new Set(rs.map(nameKey).filter(x => x != null))`, `    const rs = rows(account, btrim(gid)).slice(0, 4)
    if (PROPOSAL) {
      const tr = rs.filter(trustedRow)
      const tn = new Set(tr.map(nameKey).filter(x => x != null))
      return rs.length < 4 && (rs.length === 0 || tr.length >= 1) && !(tr.length >= 2 && tn.size === tr.length)
    }
    const names = new Set(rs.map(nameKey).filter(x => x != null))`)
// Bản tính: chỉ dùng dòng tin được khi đổi Global ID ra Zalo ID, khi lấy Global ID của data, khi xác minh Zalo ID của data đã gửi.
patch(`const uidsOf = (account, gid) => (gid && gidOk(account, gid) ? rows(account, gid).map(z => z.uid) : [])`,
  `const uidsOf = (account, gid) => (gid && gidOk(account, gid) ? rows(account, gid).filter(z => !PROPOSAL || trustedRow(z)).map(z => z.uid) : [])`)
patch(`      const g = btrim(z?.gid ?? '') || null\n`, `      const g = z && (!PROPOSAL || trustedRow(z)) ? (btrim(z.gid ?? '') || null) : null\n`)
patch(`M.zaloUsers.some(z => z.account === d.account && z.uid === iu && z.gid === G))`,
  `M.zaloUsers.some(z => z.account === d.account && z.uid === iu && z.gid === G && (!PROPOSAL || trustedRow(z))))`)
// Thế giới: raw_payload theo nguồn gốc + các ca lọt.
patch(`        const row = { id: id(), account: a.id, uid: u, gid: junk ? pick(viewerGids) : chance(0.05) ? '' : p.gid, zaloName: v > 0 && chance(0.1) ? p.name + ' mới' : p.name, junk }
        pending.push(row)`, `        const row = { id: id(), account: a.id, uid: u, gid: junk ? pick(viewerGids) : chance(0.05) ? '' : p.gid, zaloName: v > 0 && chance(0.1) ? p.name + ' mới' : p.name, junk }
        if (junk) row.raw = { id: u, globalId: row.gid, source: 'profile', zaloGroupId: 'g' + a.id, zaloName: row.zaloName }
        else { const k = R(); row.raw = k < 0.6 ? { userId: u, globalId: row.gid, zaloName: row.zaloName } : k < 0.85 ? {}
          : { id: u, source: 'profile', zaloGroupId: 'g' + a.id, userId: u, globalId: row.gid } }
        if (HOLES && junk && chance(0.3)) { row.zaloName = ''; row.raw.zaloName = ''; bump('world:hole_empty_name') }
        if (HOLES && !junk && row.gid && junkAccounts.has(a.id) && chance(0.08)) {
          row.raw = { userId: u, globalId: row.gid, zaloName: row.zaloName }; row.gid = pick(viewerGids); row.junk = true; row.clobbered = true
          bump('world:hole_clobbered')
        }
        pending.push(row)`)
patch(`    if (!known.length && junkRows.length === 1) { const r = junkRows[0]; r.gid = M.persons[owner.get(a.nick + '|' + r.uid)].gid; r.junk = false }`,
  `    if (!HOLES && !known.length && junkRows.length === 1) { const r = junkRows[0]; r.gid = M.persons[owner.get(a.nick + '|' + r.uid)].gid; r.junk = false; r.raw = { userId: r.uid, globalId: r.gid } }
    if (HOLES && !known.length && junkRows.length === 1) bump('world:hole_single_unknown_nick_row')`)
patch(`  { const ps = M.persons.filter(p => versions['N5:' + p.i]).slice(0, 4 + Math.floor(R() * 4))
    for (const p of ps) { const u = versions['N5:' + p.i][0]; if (!M.zaloUsers.some(z => z.account === E.id && z.uid === u)) M.zaloUsers.push({ id: id(), account: E.id, uid: u, gid: M.nicks.N5.own, zaloName: p.name, junk: true, oldNick: 'N5' }) }`,
  `  { const ps = M.persons.filter(p => versions['N5:' + p.i]).slice(0, HOLES ? 1 + Math.floor(R() * 3) : 4 + Math.floor(R() * 4))
    if (HOLES && ps.length) bump('world:hole_old_nick_' + ps.length + '_rows')
    for (const p of ps) { const u = versions['N5:' + p.i][0]; const nm = HOLES && chance(0.4) ? '' : p.name
      if (!M.zaloUsers.some(z => z.account === E.id && z.uid === u)) M.zaloUsers.push({ id: id(), account: E.id, uid: u, gid: M.nicks.N5.own, zaloName: nm, junk: true, oldNick: 'N5',
        raw: { id: u, globalId: M.nicks.N5.own, source: 'profile', zaloGroupId: 'gN5', zaloName: nm } }) }`)
patch(`zalo_name: z.zaloName, staff_id: a.staff, organization_id: a.org, is_fr: 0 } }))`,
  `zalo_name: z.zaloName, raw_payload: z.raw ?? {}, staff_id: a.staff, organization_id: a.org, is_fr: 0 } }))`)
// Sự thật của gid_ok: dòng được dùng (đề xuất: chỉ dòng tin được) phải là của đúng một người.
patch(`const owners = new Set(M.zaloUsers.filter(z => z.account === a.id && z.gid === r.g).map(`,
  `const owners = new Set(M.zaloUsers.filter(z => z.account === a.id && z.gid === r.g && (!PROPOSAL || trustedRow(z))).map(`)
// DB: nạp SQL đề xuất sau V657.
patch(`    await T.applyV657()\n`, `    await T.applyV657()
    if (PROPOSAL) await db.query(require('./build-gid-trust-proposal-sql.cjs').sql)
    console.log(PROPOSAL ? 'DB: V657 + đề xuất' : 'DB: V657 đang chạy')
`)

const m = new Module(file, module)
m.filename = file
m.paths = Module._nodeModulePaths(path.dirname(file))
m._compile(src, file)
