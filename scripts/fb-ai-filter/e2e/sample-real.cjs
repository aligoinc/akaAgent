// Lấy mẫu ngẫu nhiên lượt lọc AI thật (ai_log của 5 mã lọc cũ) trên nhiều chiến dịch, mô tả lấy từ cài đặt hiện tại của chiến dịch.
// Gắn nhãn bằng Claude Opus làm trọng tài theo cùng quy tắc với bộ mẫu chấm tay. Không ghi gì vào database.
'use strict'
const lib = require('./lib.cjs')
const OLD = ['fb_prepare_seeding_iterations_ai_filter', 'fb_extract_data_from_group_posts_ai_filter', 'fb_collect_group_comments_ai_filter',
  'fb_extract_data_from_search_posts_ai_filter', 'fb_collect_search_post_comments_ai_filter']
const COMMENT_CODES = new Set(['fb_collect_group_comments_ai_filter', 'fb_collect_search_post_comments_ai_filter'])
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

async function sample({ seed, target = 150, perCampaign = 4, minId = 300000, exclude = new Set() }) {
  const r = rng(seed)
  const [top] = await lib.rest('/ai_log?select=id&order=id.desc&limit=1')
  const rows = []
  const campsSeen = new Set()
  for (let w = 0; w < 160 && campsSeen.size < Math.ceil(target / perCampaign) * 2; w++) {
    const start = Math.floor(minId + r() * (top.id - minId - 20000))
    const got = await lib.rest(`/ai_log?select=id,using_code,campaign_id,rendered_user_prompt&id=gte.${start}&id=lt.${start + 20000}&using_code=eq.fb_prepare_seeding_iterations_ai_filter&status=eq.success&limit=200`)
    rows.push(...got)
    for (const g of got) campsSeen.add(g.campaign_id)
  }
  // Các mã lọc tìm data ít lượt: đọc thẳng theo id giảm dần (bộ lọc comment chưa có lượt nào trong ai_log).
  // Đọc một lần rồi giữ ở <DATA>/real-pool.json (câu đọc theo mã quét bảng ai_log lớn, không chạy lặp lại / song song).
  const poolPath = require('node:path').join(lib.DATA, 'real-pool.json')
  let pool = []
  if (require('node:fs').existsSync(poolPath)) pool = JSON.parse(require('node:fs').readFileSync(poolPath, 'utf8'))
  else {
    for (const code of OLD.slice(1)) {
      let before = top.id + 1
      for (let page = 0; page < 6; page++) {
        let got = null
        for (let t = 0; t < 3 && !got; t++) { try { got = await lib.rest(`/ai_log?select=id,using_code,campaign_id,rendered_user_prompt&using_code=eq.${code}&status=eq.success&id=lt.${before}&order=id.desc&limit=500`) } catch (e) { await new Promise(s => setTimeout(s, 5000)) } }
        if (!got || !got.length) break
        pool.push(...got)
        before = got.at(-1).id
      }
    }
    require('node:fs').writeFileSync(poolPath, JSON.stringify(pool))
  }
  rows.push(...pool.filter(() => r() < 0.5))
  const camps = [...new Set(rows.map(x => x.campaign_id).filter(Boolean))]
  const descs = new Map()
  for (let i = 0; i < camps.length; i += 80) {
    const part = await lib.rest(`/auto_campaigns?select=id,extra_settings&id=in.(${camps.slice(i, i + 80).join(',')})`)
    for (const c of part) descs.set(c.id, c.extra_settings || {})
  }
  const byCamp = new Map()
  const seenText = new Set()
  for (const x of rows.sort(() => r() - 0.5)) {
    const m = String(x.rendered_user_prompt || '').match(/Nội dung cần kiểm tra:\n([\s\S]*?)\n\nFormat JSON:/)
    if (!m) continue
    let content
    try { content = JSON.parse(m[1]) } catch { continue }
    const es = descs.get(x.campaign_id) || {}
    const isComment = COMMENT_CODES.has(x.using_code)
    const description = String((isComment ? es.commentContentAI : es.postContentAI) || '').trim()
    if (!description || !String(content).trim()) continue
    const key = description + '\u0001' + content
    if (seenText.has(key) || exclude.has(x.id)) continue
    seenText.add(key)
    const list = byCamp.get(x.campaign_id) || []
    if (list.length >= perCampaign) continue
    list.push({ src: 'real', log_id: x.id, campaign_id: x.campaign_id, using_code: x.using_code, entity: isComment ? 'comment' : 'post', description, content })
    byCamp.set(x.campaign_id, list)
  }
  // Chia đều theo mã lọc để không bị một chiến dịch Comment seeding lớn chiếm hết mẫu.
  const all = [...byCamp.values()].flat().sort(() => r() - 0.5)
  const byCode = new Map()
  for (const x of all) { const l = byCode.get(x.using_code) || []; l.push(x); byCode.set(x.using_code, l) }
  const out = []
  while (out.length < target && [...byCode.values()].some(l => l.length)) for (const l of byCode.values()) if (l.length && out.length < target) out.push(l.shift())
  return out
}

const JUDGE_SYSTEM = 'Bạn là người chấm dữ liệu cẩn thận cho phần mềm marketing Facebook. Khách hàng mô tả loại bài viết / bình luận họ muốn tìm; bạn quyết định một nội dung có đúng thứ khách cần hay không, như một nhân viên hiểu ý khách sẽ chọn. Chỉ trả về JSON.'
function judgePrompt(c) {
  return `Mô tả của khách (nguyên văn, có thể nhiều dòng):\n<<<\n${c.description}\n>>>\n\nLoại nội dung: ${c.entity === 'comment' ? 'bình luận' : 'bài viết'}\n\nNội dung:\n<<<\n${c.content}\n>>>\n\n` +
    'Quy tắc chấm:\n- Hiểu cả mô tả như lời dặn của một người: phần khách cần tìm, và phần khách muốn loại bỏ (Loại bỏ / KHÔNG / không lấy / trừ). Câu hướng dẫn chung (ưu tiên, phân tích hình ảnh) không phải điều kiện.\n' +
    '- Xét ý định thật của người viết nội dung. Khách cần tìm người mua / người thuê / người hỏi thì bài của người bán, cho thuê, môi giới, quảng cáo là KHÔNG, trừ khi mô tả muốn lấy cả họ.\n' +
    '- Mô tả chỉ là danh sách từ khoá / chủ đề thì nội dung nói về chủ đề đó là CÓ.\n- Nội dung trống, chỉ tên nhóm, ngày giờ, hoặc quá ít chữ để biết thì KHÔNG. Không đoán nội dung hình ảnh.\n' +
    '- Nếu thật sự hai cách hiểu đều hợp lý, đặt confidence = "low".\n\nTrả về đúng: {"label": "yes" hoặc "no", "confidence": "high" hoặc "low", "reason": "ngắn gọn"}'
}
async function label(cases) {
  const opus = await lib.loadModel('campaign_form_aka_settings_sonnet_5_5')
  await Promise.all(cases.map(async c => {
    const res = await lib.judge(opus, JUDGE_SYSTEM, judgePrompt(c))
    const v = res.ok ? lib.parseVerdict(res.content) : null
    c.label = v && (v.label === 'yes' || v.label === 'no') ? v.label : null
    c.labelConfidence = v ? v.confidence : null
    c.labelReason = v ? String(v.reason || '').slice(0, 300) : (res.error || 'judge failed')
  }))
  return cases
}
module.exports = { sample, label, judgePrompt, JUDGE_SYSTEM }
