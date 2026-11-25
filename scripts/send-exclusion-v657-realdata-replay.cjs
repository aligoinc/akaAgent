#!/usr/bin/env node
// Phát lại V657 trên dữ liệu thật đã xuất (send-exclusion-v657-realdata-export.cjs), PostgreSQL cục bộ, không chạm DB thật.
// Với mỗi tài khoản Zalo đã chạy chiến dịch: lấy data thật của các chiến dịch đó, chọn MỌI danh sách Zalo ID của nhân viên, MỌI Nhóm data
// SĐT / Zalo UID của tổ chức, MỌI chiến dịch đã xuất của nhân viên làm nguồn loại trừ, rồi so bản V657 cũ (--old-ref, mặc định 838bb4f7 = trước khi sửa Global ID ghi sai) với bản
// hiện tại ở bước A (khoá có sẵn) và bước B (Global ID thật lấy từ kết quả gửi / tra số của chính data đó). Mỗi chỗ khác nhau được phân loại:
//   - old_junk_gid: bản cũ dùng Global ID không dùng được (của chính nick / gom nhiều người) ⇒ bản cũ loại nhầm;
//   - old_wrong_gid: Global ID bản cũ dùng khác Global ID thật của data ⇒ bản cũ loại nhầm;
//   - new_same_nick_uid: bản mới khớp thẳng Zalo ID cùng nick;
//   - khác: in ra để xem tay.
// Kiểm thêm "nhận lại chính mình": data đã nhận tin thành công ở chiến dịch của nó (chiến dịch đó nằm trong nguồn) phải bị loại ở bước B.
//   PG_MODULE_DIR=... LC_ALL=C node scripts/send-exclusion-v657-realdata-replay.cjs <thư mục đã xuất> [--old-ref 838bb4f7] [--per-account 300]
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { buildDb, ROOT } = require('./send-exclusion-v657-fixture.cjs')

const args = process.argv.slice(2)
const dir = args[0]
const arg = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const OLD_REF = arg('old-ref', '838bb4f7') // V657 trước khi sửa Global ID ghi sai (25/11)
const PER_ACCOUNT = Number(arg('per-account', 300))
// --seed N: lấy ngẫu nhiên data mỗi tài khoản (mỗi vòng kiểm một mẫu khác); không có thì lấy data đầu tiên.
const SEED = arg('seed', null)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const R = SEED == null ? null : rng(Number(SEED))
const sample = (arr, n) => { if (!R) return arr.slice(0, n); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a.slice(0, n) }
const FILES = ['migration_v657_send_exclusion_global_match_p1.sql', 'migration_v657_send_exclusion_global_match_p2.sql',
  'rollback_v657_send_exclusion_global_match_p2.sql', 'rollback_v657_send_exclusion_global_match_p1.sql']
const oldSql = Object.fromEntries(FILES.map(f => [f, execFileSync('git', ['-C', ROOT, 'show', `${OLD_REF}:migrations/${f}`]).toString()]))
const newSql = Object.fromEntries(FILES.map(f => [f, fs.readFileSync(path.join(ROOT, 'migrations', f), 'utf8')]))
const SUCCESS = ['thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click']
const isSent = d => ['zalo_message_friend', 'zalo_message_stranger'].includes(d.action_code) && !d.is_delete &&
  (d.op === 'committed' || (d.op == null && SUCCESS.includes(d.status)))

async function main() {
  const snaps = fs.readdirSync(dir).filter(f => /^org-\d+\.json$/.test(f)).map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  const T = await buildDb({ label: 'aka-v657-real-' })
  const { db, q, one } = T
  const cols = {}
  const ins = async (table, rows) => {
    rows = Array.isArray(rows) ? rows : [rows]
    for (let i = 0; i < rows.length; i += 5000) {
      const part = rows.slice(i, i + 5000)
      cols[table] ??= (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table])).map(r => r.column_name)
      const keys = [...new Set(part.flatMap(r => Object.keys(r)))].filter(k => cols[table].includes(k))
      const list = keys.map(k => `"${k}"`).join(', ')
      await db.query(`INSERT INTO public."${table}" (${list}) OVERRIDING SYSTEM VALUE SELECT ${list} FROM jsonb_populate_recordset(NULL::public."${table}", $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(part)])
    }
  }
  const out = { orgs: [], cases: 0, diffs: {}, samples: [], selfRecall: { old: [0, 0], new: [0, 0] }, newMatches: { A: 0, B: 0 }, oldMatches: { A: 0, B: 0 }, unknownB: { old: 0, new: 0 } }
  try {
    // ------------------------------------------------------------ nạp dữ liệu thật
    const catId = {}
    for (const code of ['phone', 'zalo_person']) {
      let c = await one(`SELECT id FROM public.category_item WHERE code=$1 LIMIT 1`, [code])
      if (!c) { await ins('category_item', { id: code === 'phone' ? 990001 : 990002, code, name: code }); c = { id: code === 'phone' ? 990001 : 990002 } }
      catId[code] = Number(c.id)
    }
    const cases = []
    for (const s of snaps) {
      const catMap = Object.fromEntries(s.cats.map(c => [c.id, catId[c.code]]))
      await db.query(`INSERT INTO public.org_organization (id, name) VALUES ($1, 'Org thật') ON CONFLICT DO NOTHING`, [s.org])
      await ins('org_staff', s.staff.map(x => ({ ...x, password: 'pw' })))
      await ins('zalo_accounts', s.zaloAccounts.map(z => ({ id: z.id, zalo_uid: z.zalo_uid, metadata: z.globalId ? { globalId: z.globalId } : {} })))
      await ins('chat_zalo_account', s.chatAccounts)
      await ins('chat_zalo_account_organization', s.chatLinks)
      await ins('auto_accounts', s.accounts)
      const accById = new Map(s.accounts.map(a => [a.id, a]))
      await ins('zalo_users', s.zaloUsers.map(z => ({ ...z, staff_id: accById.get(z.account_id)?.staff_id, organization_id: s.org })))
      await ins('auto_account_contact_groups', s.groups.map(g => ({ ...g, data_type_category_item_id: g.data_type_category_item_id ? catMap[g.data_type_category_item_id] ?? null : null })))
      await ins('auto_account_contacts', s.contacts)
      await ins('auto_account_contact_group_members', s.members.filter(m => s.contacts.some(c => c.id === m.contact_id)))
      await ins('auto_campaigns', s.campaigns.map(c => ({ ...c, schedule: new Date().toISOString(), schedule_type: 'daily', extra_settings: {} })))
      await ins('auto_campaign_input_data', s.inputs)
      const campById = new Map(s.campaigns.map(c => [c.id, c]))
      // Bộ xuất giới hạn số data mỗi chiến dịch: bỏ kết quả của data không có trong bản xuất.
      const inputIds = new Set(s.inputs.map(i => i.id))
      s.details = s.details.filter(d => d.input_data_id == null || inputIds.has(d.input_data_id))
      await ins('auto_campaign_details', s.details.map(d => ({ id: d.id, campaign_id: d.campaign_id, input_data_id: d.input_data_id, account_id: d.account_id, action_code: d.action_code,
        action_name: d.action_code, status: d.status, is_delete: d.is_delete, created_at: d.created_at, data: d.target ? { target: d.target } : {},
        policy_snapshot: d.op ? { operationState: d.op } : null, staff_id: campById.get(d.campaign_id)?.staff_id, organization_id: s.org })))
      out.orgs.push({ org: s.org, accounts: s.accounts.length, zaloUsers: s.zaloUsers.length, groups: s.groups.length, inputs: s.inputs.length })
      // Trường hợp kiểm: data của chiến dịch chạy trên tài khoản A.
      const detailsByInput = new Map()
      for (const d of s.details) { if (!detailsByInput.has(d.input_data_id)) detailsByInput.set(d.input_data_id, []); detailsByInput.get(d.input_data_id).push(d) }
      for (const a of s.accounts.filter(a => a.flatform_type === 'zalo')) {
        const camps = s.campaigns.filter(c => c.account_id === a.id)
        if (!camps.length) continue
        // Nguồn riêng lẻ (một nguồn mỗi lần so) để lộ loại nhầm: chọn mọi nguồn cùng lúc thì ai cũng khớp một nguồn nào đó.
        const bls = s.groups.filter(g => g.purpose === 'zalo_friend_blocklist' && g.staff_id === a.staff_id).map(g => g.id)
        const dgs = s.groups.filter(g => g.purpose === 'data_group').map(g => g.id)
        const scs = s.campaigns.filter(c => c.staff_id === a.staff_id).map(c => c.id)
        const rows = s.inputs.filter(i => camps.some(c => c.id === i.campaign_id) && !i.is_delete && (i.phone || i.uid))
        let k = 0
        for (const r of sample(rows, PER_ACCOUNT)) {
          const ds = detailsByInput.get(r.id) ?? []
          const realGid = ds.map(d => d.target?.globalId).find(g => g && String(g).trim()) ?? null
          const base = { org: s.org, account: a.id, staff: a.staff_id, input: r, realGid: realGid ? String(realGid).trim() : null }
          const empty = { groupId: null, blocklistIds: [], dataGroupIds: [], sentCampaignIds: [] }
          cases.push({ ...base, kind: 'own_campaign', sel: { ...empty, sentCampaignIds: [r.campaign_id] }, selfSent: ds.some(isSent) })
          k++
          const pickOne = arr => arr[R ? Math.floor(R() * arr.length) : k % arr.length]
          if (dgs.length) cases.push({ ...base, kind: 'data_group', sel: { ...empty, dataGroupIds: [pickOne(dgs)] } })
          if (bls.length) cases.push({ ...base, kind: 'blocklist', sel: { ...empty, blocklistIds: [pickOne(bls)] } })
          const others = scs.filter(x => x !== r.campaign_id)
          if (others.length) cases.push({ ...base, kind: 'other_campaign', sel: { ...empty, sentCampaignIds: [pickOne(others)] } })
        }
      }
    }
    out.cases = cases.length
    console.log(`đã nạp ${snaps.length} tổ chức, ${cases.length} data để kiểm`)
    // Một chiến dịch chạy giả mỗi tài khoản (không trùng chiến dịch nguồn).
    const runCamp = new Map()
    let rid = 9_000_000_000
    for (const c of cases) {
      const key = c.account
      if (runCamp.has(key)) continue
      const id = ++rid
      runCamp.set(key, id)
      await ins('auto_campaigns', { id, name: 'run', action_id: 'zalo_message_phone', account_id: c.account, status: 'chờ xử lý', is_delete: false, staff_id: c.staff, organization_id: c.org,
        schedule: new Date().toISOString(), schedule_type: 'daily', extra_settings: { enableMessage: true } })
    }
    const matchSql = `SELECT private.aka_agent_send_exclusion_match(c, $2::bigint, $7::jsonb, $3::text, $4::text, $5::text, $6::boolean) m
      FROM public.auto_campaigns c WHERE c.id=$1`
    const run = async (sql, label) => {
      await db.query(sql[FILES[0]]); await db.query(sql[FILES[1]])
      for (let k = 0; k < 50; k++) { const r = await one(`SELECT private.aka_agent_zalo_phone_identity_ingest(60000, 200000) r`); if (Number(r.r.lastDetailId) >= Number(r.r.maxDetailId)) break }
      const res = []
      const t0 = Date.now()
      for (const c of cases) {
        const a = (await one(matchSql, [runCamp.get(c.account), c.account, c.input.phone, null, c.input.uid, false, c.sel])).m
        const b = (await one(matchSql, [runCamp.get(c.account), c.account, c.input.phone, c.realGid, c.input.uid, true, c.sel])).m
        res.push({ a, b })
      }
      console.log(`${label}: ${cases.length} data × 2 bước, ${Math.round((Date.now() - t0) / cases.length * 10) / 20} ms mỗi lần so`)
      return res
    }
    const oldRes = await run(oldSql, 'V657 bản cũ (' + OLD_REF + ')')
    await db.query(oldSql[FILES[2]]); await db.query(oldSql[FILES[3]])
    const newRes = await run(newSql, 'V657 bản hiện tại')
    // ------------------------------------------------------------ so sánh
    const key = m => (m ? m.kind + ':' + m.id : null)
    const gidOk = async (acc, g) => (g ? (await one(`SELECT private.aka_agent_zalo_gid_ok($1, $2) r`, [acc, g])).r : null)
    const nick = new Map()
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i], o = oldRes[i], n = newRes[i]
      for (const st of ['a', 'b']) {
        if (o[st].match) out.oldMatches[st.toUpperCase()]++
        if (n[st].match) out.newMatches[st.toUpperCase()]++
      }
      if (o.b.unknown) out.unknownB.old++
      if (n.b.unknown) out.unknownB.new++
      // Ngoài đời bước B có Global ID thật (tra số / đọc hồ sơ); ở đây chỉ data đã có kết quả gửi mới có. Không xác định khi đã có Global ID thật:
      if (c.realGid && n.b.unknown) { out.unknownBWithGid = (out.unknownBWithGid ?? 0) + 1; if (out.samples.filter(s => s.cls === 'unknown_with_gid').length < 6) out.samples.push({ cls: 'unknown_with_gid', org: c.org, account: c.account, input: c.input.id, kind: c.kind, n: n.b }) }
      out.byKind ??= {}
      const bk = (out.byKind[c.kind] ??= { cases: 0, oldA: 0, newA: 0, oldB: 0, newB: 0 })
      bk.cases++; if (o.a.match) bk.oldA++; if (n.a.match) bk.newA++; if (o.b.match) bk.oldB++; if (n.b.match) bk.newB++
      if (c.selfSent) {
        out.selfRecall.old[1]++; out.selfRecall.new[1]++
        if (o.b.match) out.selfRecall.old[0]++
        if (n.b.match) out.selfRecall.new[0]++
        else if ((out.samples.filter(s => s.cls === 'self_recall_miss').length) < 8) out.samples.push({ cls: 'self_recall_miss', org: c.org, account: c.account, input: c.input.id, n: n.b })
      }
      for (const st of ['a', 'b']) {
        const ko = key(o[st].match), kn = key(n[st].match)
        if (ko === kn) continue
        let cls
        if (ko && !kn) {
          const g = o[st].globalId
          const srcAccounts = c.kind === 'blocklist' || c.kind === 'data_group' ? (await q(`SELECT DISTINCT COALESCE(g.account_id, ct.account_id) a FROM public.auto_account_contact_groups g
            LEFT JOIN public.auto_account_contact_group_members m ON m.group_id=g.id LEFT JOIN public.auto_account_contacts ct ON ct.id=m.contact_id
            WHERE g.id = ANY($1::bigint[])`, [[...(c.sel.blocklistIds ?? []), ...(c.sel.dataGroupIds ?? [])]])).map(r => Number(r.a)).filter(Boolean) : []
          let junkAtSource = false
          for (const sa of srcAccounts) if (g && !(await gidOk(sa, g))) { junkAtSource = true; break }
          if (g && !(await gidOk(c.account, g))) cls = 'old_junk_gid'
          else if (junkAtSource) cls = 'old_junk_gid_at_source'
          else if (c.realGid && g && g !== c.realGid) cls = 'old_wrong_gid'
          else cls = 'old_only_other'
        } else if (!ko && kn) {
          if (!nick.has(c.account)) nick.set(c.account, (await one(`SELECT private.aka_agent_zalo_same_nick_accounts($1) r`, [c.account])).r.map(Number))
          // Bản mới khớp nhờ so thẳng Zalo ID ở tài khoản cùng nick (dòng zalo_users ở đó ghi sai hoặc không có): kiểm độc lập.
          const uid = String(c.input.uid ?? '').trim()
          let direct = false
          if (uid && (c.kind === 'blocklist' || c.kind === 'data_group')) {
            direct = !!(await one(`SELECT 1 x FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts ct ON ct.id=m.contact_id
              WHERE m.group_id = ANY($1::bigint[]) AND NOT m.is_delete AND NOT ct.is_delete AND ct.contact_type='person' AND ct.uid=$2 AND ct.account_id = ANY($3::bigint[]) LIMIT 1`,
              [[...(c.sel.blocklistIds ?? []), ...(c.sel.dataGroupIds ?? [])], uid, nick.get(c.account)]))
          } else if (uid && c.kind.endsWith('campaign')) {
            direct = !!(await one(`SELECT 1 x FROM public.auto_campaign_input_data i JOIN public.auto_campaign_details d ON d.input_data_id=i.id
              WHERE i.campaign_id = ANY($1::bigint[]) AND lower(btrim(i.uid))=lower($2) AND d.account_id = ANY($3::bigint[]) LIMIT 1`, [c.sel.sentCampaignIds, uid, nick.get(c.account)]))
          }
          // Data đã nhận tin thành công ở chính chiến dịch nguồn: bản mới nhận ra là đúng (bản cũ sót).
          cls = direct ? 'new_same_nick_uid' : c.kind === 'own_campaign' && c.selfSent ? 'new_self_recall' : 'new_only_other'
        } else cls = 'different_source'
        const k = `${st.toUpperCase()}:${c.kind}:${cls}`
        out.diffs[k] = (out.diffs[k] ?? 0) + 1
        if (!['old_junk_gid'].includes(cls) && out.samples.filter(s => s.cls === k).length < 6) out.samples.push({ cls: k, org: c.org, account: c.account, input: c.input.id, realGid: c.realGid, old: o[st], new: n[st] })
      }
    }
  } finally { await T.stop() }
  console.log(JSON.stringify({ ...out, samples: undefined }, null, 1))
  fs.writeFileSync(path.join(dir, 'replay-result.json'), JSON.stringify(out, null, 1))
  console.log('mẫu chỗ khác (ghi ở', path.join(dir, 'replay-result.json') + '):', out.samples.length)
}
main().catch(e => { console.error(e); process.exit(1) })
