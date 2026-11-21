// Kiểm khoá so sánh của hàm đẩy data tìm được (V614) bằng một bộ nhận diện độc lập (đọc link bằng URL của JS, không dùng lại SQL).
//   PG_MODULE=<node_modules/pg> PGHOST=<thư mục socket> PGPORT=<cổng> node scripts/find-data-push/key-holes.cjs <corpus.json>
// corpus.json: { "facebook_uid": [giá trị thật...], "facebook_group": [...], "post_link": [...], "zalo_group_link": [...] } (xuất chỉ đọc).
// Kiểm:
//   A. mỗi giá trị thật + các cách viết khác của nó (giao thức, máy chủ m./web./www., "/" cuối, tham số theo dõi, chữ hoa, dạng khác của
//      cùng một UID / group / bài): khoá DB phải bằng nhau;
//   B. gom mọi giá trị (thật + cách viết) theo khoá DB: một khoá chỉ ứng với một danh tính của bộ nhận diện (không gộp nhầm), một danh tính
//      chỉ ứng với một khoá (không bỏ sót);
//   C. hai giá trị cùng khoá thì chung ít nhất một mảnh không phải từ dừng (bước lọc nhanh của hàm đẩy không bỏ sót);
//   D. giá trị lạ (rỗng, chỉ dấu, rất dài, chữ Unicode, giao thức lạ) không làm hàm lỗi.
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require(process.env.PG_MODULE || 'pg')

const corpus = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const STOP = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'v614-stop-tokens.json'), 'utf8')).stopTokens)
const TRACKING = new Set(['mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id', 'rdid', 'share_url', 'sfnsn', 'extid', 'paipv',
  'eav', '_rdr', '_rdc', 'refsrc', 'hc_ref', 'fref', 'notif_id', 'notif_t', 'acontext', 'aref', 's', 'app'])
const SUBPAGES = new Set(['about', 'about_contact_and_basic_info', 'directory_contact_info', 'photos', 'friends', 'videos', 'followers', 'following', 'reels'])
const RESERVED = new Set(['groups', 'marketplace', 'people', 'share', 'watch', 'reel', 'pages', 'events', 'hashtag', 'photo', 'photo.php',
  'story.php', 'permalink.php', 'profile.php', 'search', 'messages', 'friends', 'videos'])

// ---------- Bộ nhận diện độc lập: giá trị → danh tính ----------
function parse(raw) {
  const v = String(raw ?? '').trim().split('#')[0]
  if (!v) return null
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v)
  let url = null
  try { url = new URL(hasScheme ? v : `https://${v}`) } catch { url = null }
  const host = url ? url.hostname.toLowerCase() : ''
  const fb = /(^|\.)(facebook|fb)\.com$/.test(host)
  const zalo = /(^|\.)zalo\.me$/.test(host)
  if (hasScheme && !fb && !zalo) return { other: v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').toLowerCase().replace(/\/+$/, '') }
  if (!fb && !zalo) {
    // Không có máy chủ: mã / tên riêng trần (đọc tay, không qua URL để không coi đoạn đầu là máy chủ).
    const [p, q = ''] = v.split('?')
    return { bare: true, segs: p.split('/').filter(Boolean), rawSegs: p.split('/').filter(Boolean), params: new URLSearchParams(q), fb: false, zalo: false }
  }
  const rawPath = v.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^/?]*/, '').split('?')[0]
  return { bare: false, segs: rawPath.split('/').filter(Boolean), rawSegs: rawPath.split('/').filter(Boolean), params: url.searchParams, fb, zalo }
}
const lc = s => s.toLowerCase()
const caseKeep = s => (/^pfbid/i.test(s) ? s : lc(s))
function generic(p) {
  const kept = []
  for (const [k, val] of p.params) {
    const kk = lc(k)
    if (TRACKING.has(kk) || kk.startsWith('__')) continue
    const vv = lc(val).replace(/\/+$/, '')
    kept.push(vv ? `${kk}=${vv}` : kk)
  }
  kept.sort()
  return `generic:${p.fb ? 'fb/' : ''}${p.segs.map(lc).join('/')}${kept.length ? '?' + kept.join('&') : ''}`
}
function uidIdentity(p) {
  const segs = p.segs.map(lc)
  if (segs.length === 1 && /^\d{5,20}$/.test(segs[0])) return `person:${segs[0]}`
  const id = p.params.get('id')
  if (id && /^\d{5,20}$/.test(id)) return `person:${id}`
  for (let i = 0; i < segs.length - 1; i++) {
    if ((segs[i] === 'user' || (segs[i] === 'profile' && segs[i - 1] === 'marketplace')) && /^\d{5,20}$/.test(segs[i + 1])) return `person:${segs[i + 1]}`
    if (segs[i] === 'people' && segs[i + 2] && /^\d{5,20}$/.test(segs[i + 2])) return `person:${segs[i + 2]}`
  }
  if (segs[0] === 'share' && segs.length >= 3) return `share:${segs[1]}:${p.rawSegs[2]}`
  if (segs[0] && /^[a-z0-9.]{5,50}$/.test(segs[0]) && !RESERVED.has(segs[0]) && (segs.length === 1 || (segs.length === 2 && SUBPAGES.has(segs[1])))) {
    return `person:${segs[0]}`
  }
  return generic(p)
}
function identity(kind, raw) {
  if (kind === 'phone') {
    let d = String(raw ?? '').replace(/\D/g, '')
    if (!d) return null
    if (d.startsWith('0084') && d.length >= 13) d = '0' + d.slice(4)
    else if (d.startsWith('84') && d.length >= 11) d = '0' + d.slice(2)
    return `phone:${d}`
  }
  const p = parse(raw)
  if (!p) return null
  if (p.other) return `other:${p.other}`
  const segs = p.segs.map(lc)
  if (kind === 'zalo_group_link') {
    if (!p.zalo && segs.length === 1 && /^\d+$/.test(segs[0]) && ![...p.params].length) return `zalo-id:${segs[0]}`
    if (p.zalo || segs[0] === 'g') return `zalo:${segs.join('/')}`
    return generic(p)
  }
  if (kind === 'facebook_group') {
    if (!p.fb && segs.length === 1 && /^\d{5,}$/.test(segs[0])) return `group:${segs[0]}`
    if (segs[0] === 'groups' && segs[1]) return `group:${segs[1]}`
    if (segs[0] === 'share' && segs.length >= 3) return `share:${segs[1]}:${p.rawSegs[2]}`
    return `profile-of-${uidIdentity(p)}`
  }
  if (kind === 'facebook_uid') return uidIdentity(p)
  if (kind === 'post_link') {
    if (segs[0] === 'groups' && ['posts', 'permalink', 'pending_posts'].includes(segs[2]) && segs[3]) return `post:${segs[1]}:${caseKeep(p.rawSegs[3])}`
    const mp = p.params.get('multi_permalinks')
    if (segs[0] === 'groups' && segs.length === 2 && mp) return `post:${segs[1]}:${caseKeep(mp.split(',')[0])}`
    if (segs.length === 1 && (segs[0] === 'permalink.php' || segs[0] === 'story.php') && p.params.get('story_fbid')) {
      return `story:${caseKeep(p.params.get('story_fbid'))}:${/^\d+$/.test(p.params.get('id') || '') ? p.params.get('id') : ''}`
    }
    if (segs.length >= 3 && segs[1] === 'posts' && segs[0] !== 'groups') return `ownerpost:${segs[0]}:${caseKeep(p.rawSegs[2])}`
    if ((segs[0] === 'photo' || segs[0] === 'photo.php') && segs.length === 1 && /^\d+$/.test(p.params.get('fbid') || '')) return `photo:${p.params.get('fbid')}`
    if (segs[1] === 'photos' && /^\d+$/.test(segs[segs.length - 1]) && segs.length <= 4) return `photo:${segs[segs.length - 1]}`
    if (segs.length === 1 && segs[0] === 'watch' && /^\d+$/.test(p.params.get('v') || '')) return `video:${p.params.get('v')}`
    const vi = segs.indexOf('videos')
    if (vi >= 0 && vi <= 1 && /^\d+$/.test(segs[segs.length - 1])) return `video:${segs[segs.length - 1]}`
    if (segs[0] === 'reel' && segs.length === 2 && /^\d+$/.test(segs[1])) return `reel:${segs[1]}`
    if (segs[0] === 'share' && segs.length >= 3) return `share:${segs[1]}:${p.rawSegs[2]}`
    return generic(p)
  }
  return generic(p)
}

// ---------- Cách viết khác của cùng một data ----------
const TRACK_TAILS = ['?__cft__[0]=AZxYz123&__tn__=R', '?mibextid=ZbWKwL', '?ref=share', '?rdid=abc&share_url=x']
function hostVariants(u) {
  const out = []
  const m = /^(https?:\/\/)?((?:www|m|web|mbasic)\.)?(facebook\.com|fb\.com)(\/.*)?$/i.exec(u)
  if (!m) return out
  const rest = m[4] || ''
  for (const h of ['www.', 'm.', 'web.', 'mbasic.', '']) out.push(`https://${h}facebook.com${rest}`)
  out.push(`facebook.com${rest}`, `http://www.facebook.com${rest}`, `HTTPS://WWW.FACEBOOK.COM${rest}`)
  return out
}
function withTail(u, tail) { return u.includes('?') ? `${u}&${tail.slice(1)}` : `${u.replace(/\/?$/, '/')}${tail}` }
function variants(kind, raw) {
  const v = String(raw).trim()
  const out = new Set([` ${v} `, v.endsWith('/') ? v.replace(/\/+$/, '') : `${v}${v.includes('?') ? '' : '/'}`])
  for (const h of hostVariants(v)) out.add(h)
  if (/facebook\.com|fb\.com|zalo\.me/i.test(v)) for (const t of TRACK_TAILS) out.add(withTail(v, t))
  const id = identity(kind, v)
  if (kind === 'facebook_uid' && /^person:\d+$/.test(id)) {
    const n = id.slice(7)
    for (const f of [n, `${n}/`, `https://www.facebook.com/profile.php?id=${n}`, `https://m.facebook.com/profile.php?id=${n}&comment_id=Y29t`,
      `https://www.facebook.com/groups/975457975877822/user/${n}/?__cft__[0]=AZ&__tn__=R`, `https://www.facebook.com/marketplace/profile/${n}/?product_id=1`,
      `facebook.com/${n}`, `https://www.facebook.com/people/Ten-Nguoi/${n}/`]) out.add(f)
  }
  if (kind === 'facebook_uid' && /^person:[a-z0-9.]+$/.test(id) && !/^person:\d+$/.test(id)) {
    const n = id.slice(7)
    for (const f of [n, `https://www.facebook.com/${n}`, `https://web.facebook.com/${n}/?mibextid=x`, `https://www.facebook.com/${n}/about`]) out.add(f)
  }
  if (kind === 'facebook_group' && /^group:/.test(id)) {
    const g = id.slice(6)
    for (const f of [`https://www.facebook.com/groups/${g}`, `https://m.facebook.com/groups/${g}/?ref=share`, `facebook.com/groups/${g}/`,
      `https://www.facebook.com/groups/${g}/posts/123456789/`]) out.add(f)
    if (/^\d+$/.test(g)) out.add(g)
  }
  if (kind === 'post_link' && /^post:/.test(id)) {
    const [, g, pid] = id.split(':')
    for (const f of [`https://www.facebook.com/groups/${g}/posts/${pid}/`, `https://www.facebook.com/groups/${g}/permalink/${pid}/`,
      `https://www.facebook.com/groups/${g}/pending_posts/${pid}`, `https://www.facebook.com/groups/${g}/?multi_permalinks=${pid}&ref=share`]) out.add(f)
  }
  if (kind === 'post_link' && /^story:/.test(id)) {
    const [, sf, oid] = id.split(':')
    for (const f of [`https://www.facebook.com/permalink.php?story_fbid=${sf}&id=${oid}`, `https://www.facebook.com/permalink.php?id=${oid}&story_fbid=${sf}`,
      `https://m.facebook.com/story.php?story_fbid=${sf}&id=${oid}&mibextid=x`]) out.add(f)
  }
  if (kind === 'zalo_group_link' && /^zalo:/.test(id)) {
    const p = id.slice(5)
    for (const f of [`https://zalo.me/${p}`, `zalo.me/${p}/`, `https://www.zalo.me/${p}`, `https://zalo.me/${p}?src=share`, `HTTPS://ZALO.ME/${p.toUpperCase()}`]) out.add(f)
  }
  out.delete(v)
  return [...out]
}

const GARBAGE = ['', ' ', '/', '?', '#', '???', 'https://', 'http://?id=', 'facebook.com', 'https://www.facebook.com/', 'zalo.me/g/',
  'x'.repeat(5000), 'Nguyễn Văn Ánh', '😀😀', "a'b\"c", 'javascript:alert(1)', 'mailto:a@b.com', 'https://www.facebook.com/groups//posts//',
  'https://www.facebook.com/profile.php?id=', '%%%%', '\u0000abc'.replace('\u0000', ''), '0', '84', '+84', '0084']

async function main() {
  const db = new Client({ host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER || 'postgres', database: process.env.PGDATABASE || 'postgres' })
  await db.connect()
  const kinds = Object.keys(corpus)
  if (!kinds.includes('phone')) {
    corpus.phone = ['0985794636', '0912345678', '0388111222', '0868123123', '0703999888']
    kinds.push('phone')
  }
  const items = []
  for (const kind of kinds) {
    for (const raw of corpus[kind]) {
      items.push({ kind, raw, base: raw, isBase: true })
      for (const vr of variants(kind, raw)) items.push({ kind, raw: vr, base: raw, isBase: false })
    }
    if (kind === 'phone') for (const p of corpus.phone) for (const f of [`+84 ${p.slice(1, 4)} ${p.slice(4, 7)} ${p.slice(7)}`, `84${p.slice(1)}`, `${p.slice(0, 4)}.${p.slice(4, 7)}.${p.slice(7)}`]) items.push({ kind, raw: f, base: p, isBase: false })
  }
  // Khoá DB theo lô.
  const keyOf = new Map()
  const toks = new Map()
  const uniq = [...new Map(items.map(it => [`${it.kind}\u0001${it.raw}`, it])).values()]
  for (let i = 0; i < uniq.length; i += 2000) {
    const chunk = uniq.slice(i, i + 2000)
    const r = await db.query(`SELECT t.k, t.v, private.aka_agent_find_data_match_key(t.k, t.v) AS key, private.aka_agent_find_data_match_tokens(t.k, t.v) AS toks
      FROM unnest($1::text[], $2::text[]) AS t(k, v)`, [chunk.map(c => c.kind), chunk.map(c => c.raw)])
    for (const row of r.rows) { keyOf.set(`${row.k}\u0001${row.v}`, row.key); toks.set(`${row.k}\u0001${row.v}`, row.toks || []) }
  }
  const K = it => keyOf.get(`${it.kind}\u0001${it.raw}`)
  const T = it => toks.get(`${it.kind}\u0001${it.raw}`)
  const problems = { A_variant_key_differs: [], B_false_merge: [], B_missed: [], C_token_invariant: [], D_error: [] }

  // A + C: cách viết khác so với giá trị thật.
  for (const it of items) {
    if (it.isBase) continue
    const base = { kind: it.kind, raw: it.base }
    if (K(it) !== K(base)) problems.A_variant_key_differs.push({ kind: it.kind, base: it.base, variant: it.raw, kb: K(base), kv: K(it) })
    else if (K(it)) {
      const baseToks = new Set(T(base).filter(t => !STOP.has(t)))
      if (!T(it).some(t => baseToks.has(t))) problems.C_token_invariant.push({ kind: it.kind, base: it.base, variant: it.raw })
    }
  }
  // B: gom theo khoá DB và theo danh tính của bộ nhận diện.
  for (const kind of kinds) {
    const byKey = new Map(); const byId = new Map()
    for (const it of items.filter(x => x.kind === kind)) {
      const k = K(it); const id = identity(kind, it.raw)
      if (!k || !id) continue
      if (!byKey.has(k)) byKey.set(k, new Map()); byKey.get(k).set(id, it.raw)
      if (!byId.has(id)) byId.set(id, new Map()); byId.get(id).set(k, it.raw)
    }
    for (const [k, ids] of byKey) if (ids.size > 1) problems.B_false_merge.push({ kind, key: k, identities: [...ids].slice(0, 4) })
    for (const [id, ks] of byId) if (ks.size > 1) problems.B_missed.push({ kind, identity: id, keys: [...ks].slice(0, 4) })
  }
  // D: giá trị lạ.
  for (const kind of kinds) for (const g of GARBAGE) {
    try { await db.query('SELECT private.aka_agent_find_data_match_key($1, $2), private.aka_agent_find_data_match_tokens($1, $2)', [kind, g]) } catch (e) { problems.D_error.push({ kind, value: g.slice(0, 40), error: e.message }) }
  }
  await db.end()
  const counts = Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, v.length]))
  console.log('giá trị thật:', Object.fromEntries(kinds.map(k => [k, corpus[k].length])), 'tổng (kèm cách viết khác):', items.length)
  console.log('lỗi theo loại:', JSON.stringify(counts))
  for (const [k, v] of Object.entries(problems)) for (const s of v.slice(0, 6)) console.log(`  ${k}:`, JSON.stringify(s).slice(0, 400))
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(problems, null, 1))
  if (Object.values(counts).some(n => n > 0)) process.exitCode = 1
}
main().catch(e => { console.error(e); process.exit(2) })
