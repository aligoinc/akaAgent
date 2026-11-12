// Sinh docs/CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md: chính sách xử lý kết quả của bộ chạy mới (auto_outcome_policies) đang có
// trên production, xếp theo hành vi (đăng xuất, dừng chiến dịch, khoá có thời hạn, bỏ qua…). Chỉ đọc.
//   node scripts/campaign-outcome-engine-policy-groups.cjs                 đọc production qua `supabase db query --linked`
//   node scripts/campaign-outcome-engine-policy-groups.cjs --input x.json  dựng từ kết quả đã lưu (khoá "result" của câu SQL bên dưới)
// Thư mục có supabase/.temp/project-ref: --workdir, AKA_SUPABASE_WORKDIR, hoặc checkout chính của repo. Ref phải là akachat.
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const DOC = path.join(ROOT, 'docs/CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md')
const PROD_REF = 'cgjbsmqtfhqvttudyjzq'

// Chính sách hiệu lực của mỗi mã có public_code × thao tác (thao tác khai trong zalo_action_codes, thao tác có dòng chính sách
// riêng cho mã; mã không gắn thao tác thì một dòng chung). Pha chỉ ảnh hưởng mặc định an toàn của các trường chính sách bỏ trống.
const SQL = `
WITH errs AS (
  SELECT e.error_code, e.public_code, e.error_class, e.error_type, e.error_name, e.customer_title,
         coalesce(e.zalo_error_codes, '{}') AS zalo_codes, coalesce(e.zalo_action_codes, '{}') AS zalo_actions
    FROM public.auto_error e
   WHERE e.is_active AND NOT coalesce(e.is_delete, false) AND e.public_code IS NOT NULL
), pairs AS (
  SELECT DISTINCT e.error_code, a.action_code
    FROM errs e
    CROSS JOIN LATERAL (
      SELECT unnest(e.zalo_actions) AS action_code
      UNION SELECT p.action_code FROM public.auto_outcome_policies p
             WHERE p.error_code = e.error_code AND p.is_active AND NOT p.is_delete AND p.action_code IS NOT NULL
      UNION SELECT NULL::text WHERE cardinality(e.zalo_actions) = 0
    ) a
)
SELECT jsonb_build_object(
  'fetched_at', now(),
  'pairs', (SELECT jsonb_agg(jsonb_build_object(
      'error_code', e.error_code, 'public_code', e.public_code, 'error_class', e.error_class, 'error_type', e.error_type,
      'error_name', e.error_name, 'customer_title', e.customer_title, 'zalo_codes', e.zalo_codes, 'action_code', p.action_code,
      'phase', ph.phase, 'policy', public.aka_agent_engine_resolve_policy(e.error_code, NULL, p.action_code, NULL, NULL, ph.phase))
      ORDER BY e.public_code, e.error_code, p.action_code NULLS FIRST)
    FROM pairs p JOIN errs e USING (error_code)
    CROSS JOIN LATERAL (SELECT CASE WHEN cardinality(e.zalo_codes) > 0 THEN 'after_send'
                                    WHEN e.error_class = 'unknown_delivery' THEN 'in_flight' ELSE 'before_send' END AS phase) ph),
  'statuses', (SELECT jsonb_agg(jsonb_build_object('id', s.id, 'code', s.code, 'value', s.status_value)) FROM public.auto_status s),
  'status_policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.auto_outcome_policies p
                       WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NOT NULL),
  'guards', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.auto_outcome_policies p
              WHERE p.is_active AND NOT p.is_delete AND p.status_id IS NULL AND p.error_code IS NULL AND p.error_class IS NULL),
  'class_policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.auto_outcome_policies p
              WHERE p.is_active AND NOT p.is_delete AND p.error_class IS NOT NULL),
  'by_source', (SELECT jsonb_object_agg(x.source, x.n) FROM (SELECT source, count(*) AS n FROM public.auto_outcome_policies
                 WHERE is_active AND NOT is_delete GROUP BY source) x),
  'actions', (SELECT jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name)) FROM public.auto_account_actions a),
  'rules', (SELECT jsonb_agg(jsonb_build_object('error_code', r.error_code, 'platform', r.platform, 'action_code', r.action_code,
              'kind', r.signal_kind, 'pattern', r.pattern)) FROM public.auto_outcome_signal_rules r WHERE r.is_active)
) AS result;`

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function supabaseWorkdir() {
  const candidates = [arg('--workdir'), process.env.AKA_SUPABASE_WORKDIR, ROOT]
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim()
    candidates.push(path.dirname(common))
  } catch { /* không phải repo git: chỉ dùng các đường dẫn trên */ }
  for (const dir of candidates) {
    if (!dir) continue
    const refFile = path.join(dir, 'supabase/.temp/project-ref')
    if (fs.existsSync(refFile)) {
      const ref = fs.readFileSync(refFile, 'utf8').trim()
      if (ref !== PROD_REF) throw new Error(`${refFile} trỏ tới ${ref}, không phải akachat (${PROD_REF})`)
      return dir
    }
  }
  throw new Error('Không tìm thấy supabase/.temp/project-ref; truyền --workdir <checkout đã supabase link>')
}

function loadData() {
  const input = arg('--input')
  if (input) {
    const parsed = JSON.parse(fs.readFileSync(input, 'utf8'))
    const data = parsed.result ?? parsed
    if (!data.fetched_at) data.fetched_at = fs.statSync(input).mtime.toISOString()
    return data
  }
  const dir = supabaseWorkdir()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-policy-groups-'))
  const file = path.join(tmp, 'query.sql')
  fs.writeFileSync(file, SQL)
  const out = execFileSync('supabase', ['db', 'query', '--linked', '--workdir', dir, '-f', file], { encoding: 'utf8', maxBuffer: 64 << 20 })
  fs.rmSync(tmp, { recursive: true, force: true })
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1)
  return JSON.parse(json).rows[0].result
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

function render(data) {
  const actionName = Object.fromEntries((data.actions || []).map(a => [a.code, String(a.name || a.code).replace(/^Zalo - /, '')]))
  const statusName = Object.fromEntries((data.statuses || []).map(s => [s.id, s.value || s.code]))
  const act = code => actionName[code] || code

  /**
   * Data đi đâu, tách hai trường hợp: data chưa gửi được gì (theo chính sách), và data đã gửi được tin / ảnh trước đó (luật cố định
   * no_requeue_after_delivery của report_v1: "về hàng đợi" / "hẹn lại" thành "hoàn thành, không gửi lại"; giao một phần luôn hoàn thành).
   */
  function dataTexts(p) {
    const locked = (p.lock_action_codes || []).length > 0
    const done = 'hoàn thành, không gửi lại'
    switch (p.target_effect) {
      case 'requeue': return [locked ? 'về hàng đợi, chạy lại khi mở khoá' : 'về hàng đợi, chạy lại ở lượt sau', done]
      case 'requeue_after': return [locked ? 'hẹn chạy lại lúc mở khoá' : `hẹn chạy lại sau ${p.requeue_after_minutes || 0} phút`, done]
      case 'hold': return ['tạm dừng, không tự chạy lại', 'tạm dừng, không tự chạy lại']
      default: return [done, done]
    }
  }
  /** Các hiệu ứng khác của chính sách (ngoài data đi đâu). */
  function effects(p) {
    const out = []
    const lockCodes = (p.lock_action_codes || []).map(act)
    if (p.login_effect === 'logged_out') out.push('đánh dấu tài khoản chưa đăng nhập')
    if (p.login_effect === 'checkpoint') out.push('đánh dấu tài khoản checkpoint')
    if (p.account_effect === 'pause') out.push('tạm dừng tài khoản')
    if (p.campaign_effect === 'pause') out.push(p.streak_threshold ? `tạm dừng chiến dịch khi ${p.streak_threshold} data lỗi liền` : 'tạm dừng chiến dịch')
    if (p.campaign_effect === 'hold') {
      const when = p.campaign_hold_minutes ? `chạy lại sau ${p.campaign_hold_minutes} phút` : 'chạy lại ở lần quét sau'
      out.push(p.streak_threshold ? `chiến dịch về chờ khi ${p.streak_threshold} data lỗi liền (${when})` : `chiến dịch về chờ, ${when}`)
    }
    if (lockCodes.length) out.push(`khoá ${lockCodes.join(', ')} ${lockWhen(p)}`)
    out.push(p.quota_effect === 'count' ? 'tính lượt' : p.quota_effect === 'count_if_committed' ? 'tính lượt nếu đã gửi đi' : 'không tính lượt')
    if (p.target_streak_effect === 'increment' && !(p.campaign_effect !== 'none' && p.streak_threshold)) out.push('tăng chuỗi data lỗi')
    if (p.target_streak_effect === 'reset') out.push('xoá chuỗi data lỗi')
    if ((p.remember_target_days || 0) > 0) out.push(`nhớ người nhận ${p.remember_target_days} ngày trên tài khoản, không gửi lại`)
    if (p.remaining_steps === 'skip') out.push('bỏ các bước còn lại của data')
    if (p.run_effect === 'end_unit') out.push('kết thúc lượt chạy sau data này')
    if (p.run_effect === 'stop_campaign' && p.campaign_effect !== 'pause') out.push('dừng chiến dịch')
    if (p.run_effect === 'stop_account' && p.account_effect !== 'pause') out.push('dừng tài khoản')
    if (p.detail_mode === 'suppress') out.push('không ghi lịch sử')
    else out.push(`lịch sử: "${statusName[p.detail_status_id] || '?'}"`)
    if (p.pace_mode === 'none') out.push('không nghỉ trước data kế')
    if (p.pace_mode === 'short') out.push('nghỉ ngắn')
    return out.join('; ')
  }
  function lockWhen(p) {
    if (p.lock_mode === 'indefinite') return 'không thời hạn (mở bằng tay)'
    if (p.lock_mode === 'end_of_day') return 'tới hết ngày'
    if (p.lock_mode === 'days_at_time') return `tới ${String(p.lock_time || '').slice(0, 5)} sau ${p.lock_days} ngày`
    return `${p.lock_minutes} phút`
  }

  // Nhóm theo hành vi chính (thứ tự ưu tiên: hành vi nặng nhất quyết định nhóm); các hành vi khác ghi trong cột "Xử lý".
  const GROUPS = [
    ['account', '1. Đăng xuất / dừng tài khoản', 'Tài khoản không dùng được nữa: đánh dấu chưa đăng nhập / checkpoint hoặc tạm dừng tài khoản.'],
    ['campaign_pause', '2. Tạm dừng chiến dịch ngay', 'Cấu hình hoặc nội dung sai: dừng chiến dịch một lần; data chưa gửi gì thì về hàng đợi, khách sửa rồi chạy lại.'],
    ['lock', '3. Khoá thao tác có thời hạn', 'Zalo hạn chế tài khoản: khoá đúng thao tác tới lúc mở; data chưa gửi gì thì chờ tới khi mở khoá. Nhiều mã còn đếm data lỗi liền để tạm dừng chiến dịch.'],
    ['streak', '4. Đếm lỗi liền, đủ ngưỡng thì tạm dừng chiến dịch', 'Không khoá; chỉ dừng chiến dịch khi lỗi lặp lại nhiều data liên tiếp.'],
    ['campaign_hold', '5. Chiến dịch tạm chờ rồi tự chạy lại', 'Lỗi hạ tầng (mạng, máy chủ, DB): không đốt data, chiến dịch về chờ và tự chạy tiếp.'],
    ['requeue', '6. Data chưa gửi gì thì về hàng đợi, chạy lại sau', 'Lỗi trước khi gửi: data quay lại chờ (ngay ở lượt sau hoặc sau N phút).'],
    ['hold_target', '7. Tạm dừng data', 'Data dừng hẳn, không tự chạy lại (người nhận từ chối nhận tin, nhóm không còn…).'],
    ['unknown', '8. Không rõ kết quả, không gửi lại', 'Có thể đã tới người nhận: data hoàn thành, không gửi lại để tránh trùng.'],
    ['skip', '9. Bỏ qua data, không tính lượt', 'Data hoàn thành mà không tốn lượt (thiếu dữ liệu, người nhận không nhận được, đã làm trước đó…).'],
    ['failed', '10. Ghi kết quả, có tính lượt', 'Nền tảng đã trả lời: data hoàn thành, tốn lượt như hôm nay (phần lớn ghi thất bại, vài mã ghi thành công).']
  ]
  function groupOf(p) {
    if (p.login_effect !== 'none' || p.account_effect === 'pause' || p.run_effect === 'stop_account') return 'account'
    if (p.campaign_effect === 'pause' && !p.streak_threshold) return 'campaign_pause'
    if ((p.lock_action_codes || []).length) return 'lock'
    if (p.campaign_effect !== 'none' && p.streak_threshold) return 'streak'
    if (p.campaign_effect === 'hold') return 'campaign_hold'
    if (p.target_effect === 'requeue' || p.target_effect === 'requeue_after') return 'requeue'
    if (p.target_effect === 'hold') return 'hold_target'
    if (p.quota_effect === 'count_if_committed' || p.error_class === 'unknown_delivery') return 'unknown'
    if (p.quota_effect !== 'count') return 'skip'
    return 'failed'
  }

  const platformOf = pair => /^FB/.test(pair.public_code) ? 'facebook' : /^EM/.test(pair.public_code) ? 'email' : 'zalo'
  // Gộp các thao tác của cùng một mã có cùng chính sách hiệu lực thành một dòng.
  const rows = new Map()
  for (const pair of data.pairs || []) {
    const text = effects(pair.policy)
    const [notSent, sent] = dataTexts(pair.policy)
    const key = `${pair.error_code}|${notSent}|${sent}|${text}`
    let row = rows.get(key)
    if (!row) {
      row = { pair, text, notSent, sent, group: groupOf(pair.policy), platform: platformOf(pair), actions: [] }
      rows.set(key, row)
    }
    if (pair.action_code) row.actions.push(pair.action_code)
  }
  const allRows = [...rows.values()]
  const codeRowCount = new Map()
  for (const row of allRows) codeRowCount.set(row.pair.error_code, (codeRowCount.get(row.pair.error_code) || 0) + 1)
  const actionsText = row => {
    if (!row.actions.length) return codeRowCount.get(row.pair.error_code) > 1 ? 'thao tác khác' : 'mọi thao tác'
    return row.actions.map(act).join(', ')
  }
  // Mẫu câu trong tiêu đề: {until} là giờ mở khoá, {message} là câu lỗi gốc…
  const meaning = p => String(p.customer_title || p.error_name || p.error_code)
    .replace(/\{until\}/g, '(giờ mở khoá)').replace(/\{message\}/g, '(câu lỗi)').replace(/\{(\w+)\}/g, '($1)')
  // Mã Zalo nhận biết: luật phân loại zalo_code của mã (đúng thao tác hoặc mọi thao tác), cộng cột cũ của auto_error.
  const rulesByCode = new Map()
  for (const rule of data.rules || []) {
    if (!rulesByCode.has(rule.error_code)) rulesByCode.set(rule.error_code, [])
    rulesByCode.get(rule.error_code).push(rule)
  }
  const zaloCodes = row => {
    const rules = (rulesByCode.get(row.pair.error_code) || []).filter(rule => rule.kind === 'zalo_code'
      && (!rule.action_code || !row.actions.length || row.actions.includes(rule.action_code)))
    const codes = new Set([...rules.map(rule => rule.pattern), ...(row.pair.zalo_codes || [])])
    const byMessage = (rulesByCode.get(row.pair.error_code) || []).some(rule => rule.kind === 'message_like')
    const list = [...codes].sort((a, b) => Number(a) - Number(b)).join(', ')
    if (!list && row.pair.public_code === 'Z999') return 'mã khác (chưa có luật riêng)'
    return list || (byMessage ? 'theo câu lỗi' : '—')
  }
  const sortKey = row => `${row.pair.public_code}|${row.actions.join(',')}`

  const lines = []
  const sources = Object.entries(data.by_source || {}).sort().map(([k, v]) => `${k} ${v}`).join(', ')
  const total = Object.values(data.by_source || {}).reduce((a, b) => a + Number(b), 0)
  lines.push('# Chính sách xử lý kết quả của bộ chạy mới, xếp theo hành vi')
  lines.push('')
  lines.push(`Sinh bởi \`scripts/campaign-outcome-engine-policy-groups.cjs\` từ production akachat (chỉ đọc) lúc ${new Date(data.fetched_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} giờ VN.`)
  lines.push(`Bảng \`auto_outcome_policies\` có ${total} dòng đang bật (${sources}). Chỉ bộ chạy mới (engine v2) đọc các dòng này; bộ cũ vẫn chạy theo \`auto_error\`.`)
  lines.push('')
  lines.push('**Cách đọc.**')
  lines.push('- Mỗi dòng là một mã lỗi (mã công khai, kèm mã Zalo nếu có) trên một hoặc nhiều thao tác. Chính sách là bản đã gộp (`aka_agent_engine_resolve_policy`): mặc định an toàn < theo trạng thái < theo nhóm lỗi < theo mã < chặn theo thao tác.')
  lines.push('- Mỗi mã nằm ở một nhóm theo hành vi nặng nhất: đăng xuất/dừng tài khoản > dừng chiến dịch ngay > khoá có thời hạn > đếm lỗi liền > chiến dịch tạm chờ > về hàng đợi > tạm dừng data > không rõ kết quả > bỏ qua > ghi kết quả có tính lượt.')
  lines.push('- Data đi đâu tách hai cột. "Data chưa gửi gì": lỗi xảy ra trước khi có gì tới người nhận (lỗi ở bước gửi đầu tiên, hoặc ở bước đọc như tra số, đọc hồ sơ); đây là cột lấy từ chính sách. "Data đã gửi được tin / ảnh": lỗi xảy ra ở bước sau khi data đã gửi được tin hoặc ảnh; cột này là luật cố định của DB, không do chính sách. "Hiệu ứng khác" (khoá, lượt, chuỗi lỗi, dừng chiến dịch…) áp như nhau ở cả hai trường hợp.')
  lines.push('- **"Về hàng đợi" / "hẹn chạy lại" chỉ áp khi data đó chưa gửi được gì.** Data đã gửi được một phần thì DB luôn đổi thành "hoàn thành, không gửi lại" (luật `no_requeue_after_delivery` trong `aka_agent_engine_report_v1`, không do chính sách), ví dụ:')
  lines.push('  - đã nhắn tin xong rồi bước kết bạn lỗi (221, 802, NET01…): data hoàn thành, tin không gửi lại, lời mời kết bạn của người đó không thử lại; khoá thao tác và chuỗi data lỗi của mã kết bạn vẫn áp;')
  lines.push('  - đã gửi ảnh/tệp rồi phần chữ lỗi (hoặc chữ đi rồi tệp lỗi): luôn ghi "thất bại" với câu "Đã gửi file nhưng gửi nội dung thất bại. …" (hoặc ngược lại), tính lượt, không cộng chuỗi data lỗi, không dừng chiến dịch theo ngưỡng; data hoàn thành;')
  lines.push('  - đang gửi thì bị ngắt (không rõ đã tới chưa): hoàn thành, không gửi lại (SYS02 / UNK01).')
  lines.push('  Trường hợp về hàng đợi thật: lỗi ngay ở bước gửi đầu tiên (chưa gì tới người nhận), hoặc lỗi ở bước đọc trước khi gửi (tra số, đọc hồ sơ).')
  lines.push('- Dừng chiến dịch / tài khoản / lượt chỉ có hiệu lực sau data đang xử lý.')
  lines.push('- "Chuỗi data lỗi": số data lỗi liên tiếp của chiến dịch. "Nhớ người nhận": không gửi lại người nhận đó trên cùng tài khoản trong N ngày.')
  lines.push('')

  for (const platform of ['zalo', 'facebook', 'email']) {
    const scoped = allRows.filter(row => row.platform === platform)
    if (!scoped.length) continue
    if (platform === 'zalo') lines.push('## A. Zalo và mã hệ thống (đang dùng cho chiến dịch Zalo)')
    if (platform === 'facebook') lines.push('## B. Facebook (đã có trong DB, chưa dùng: bộ chạy mới chưa chạy Facebook)')
    if (platform === 'email') lines.push('## C. Email (đã có trong DB, chưa dùng: bộ chạy mới chưa chạy Email)')
    lines.push('')
    for (const [id, title, blurb] of GROUPS) {
      const groupRows = scoped.filter(row => row.group === id).sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'vi'))
      if (!groupRows.length) continue
      const codes = new Set(groupRows.map(row => row.pair.error_code))
      lines.push(`### ${title} (${codes.size} mã)`)
      lines.push('')
      lines.push(blurb)
      lines.push('')
      if (platform === 'zalo') {
        lines.push('| Mã | Mã Zalo | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |')
        lines.push('|---|---|---|---|---|---|---|')
      } else {
        lines.push('| Mã | Thao tác | Ý nghĩa | Data chưa gửi gì | Data đã gửi được tin / ảnh | Hiệu ứng khác |')
        lines.push('|---|---|---|---|---|---|')
      }
      for (const row of groupRows) {
        const zalo = platform === 'zalo' ? ` ${cell(zaloCodes(row))} |` : ''
        lines.push(`| ${cell(row.pair.public_code)} |${zalo} ${cell(actionsText(row))} | ${cell(meaning(row.pair))} | ${cell(row.notSent)} | ${cell(row.sent)} | ${cell(row.text)} |`)
      }
      lines.push('')
    }
  }

  const pending = PENDING.filter(item => !(data.pairs || []).some(pair => pair.public_code === item.code))
  if (pending.length) {
    lines.push('## Sắp thêm (migration ở local, chưa apply production)')
    lines.push('')
    lines.push('| Mã | Nhóm | Ý nghĩa | Xử lý | Migration |')
    lines.push('|---|---|---|---|---|')
    for (const item of pending) {
      const title = (GROUPS.find(g => g[0] === item.group) || [])[1] || item.group
      lines.push(`| ${item.code} | ${cell(title)} | ${cell(item.meaning)} | ${cell(item.effects)} | ${item.migration} |`)
    }
    lines.push('')
  }

  lines.push('## D. Lớp nền')
  lines.push('')
  lines.push('Áp khi mã lỗi không nói gì về một trường (mã đặt trường nào thì trường đó thắng).')
  lines.push('')
  lines.push('**Theo trạng thái kết quả** (cả kết quả thành công):')
  lines.push('')
  lines.push('| Trạng thái | Thao tác | Xử lý |')
  lines.push('|---|---|---|')
  for (const p of data.status_policies || []) {
    const parts = []
    if (p.quota_effect) parts.push(p.quota_effect === 'count' ? 'tính lượt' : p.quota_effect === 'no_count' ? 'không tính lượt' : 'tính lượt nếu đã gửi đi')
    if (p.target_streak_effect === 'increment') parts.push('tăng chuỗi data lỗi')
    if (p.target_streak_effect === 'reset') parts.push('xoá chuỗi data lỗi')
    if (p.target_effect === 'complete') parts.push('data hoàn thành')
    if (p.pace_mode === 'none') parts.push('không nghỉ trước data kế')
    lines.push(`| ${cell(statusName[p.status_id] || p.status_id)} | ${cell(p.action_code ? act(p.action_code) : 'mọi thao tác')} | ${cell(parts.join('; ') || '—')} |`)
  }
  lines.push('')
  lines.push('**Theo thao tác** (luôn thắng mã lỗi):')
  lines.push('')
  for (const p of data.guards || []) {
    lines.push(`- ${act(p.action_code)}: ${p.quota_effect === 'no_count' ? 'không tính lượt' : p.quota_effect}${p.target_streak_effect === 'ignore' ? ', không đổi chuỗi data lỗi' : ''}.`)
  }
  lines.push('')
  lines.push('**Theo nhóm lỗi** (mã mới chỉ cần khai nhóm là có cách xử lý mặc định):')
  lines.push('')
  lines.push('| Nhóm lỗi | Data chưa gửi gì | Hiệu ứng khác |')
  lines.push('|---|---|---|')
  for (const p of data.class_policies || []) {
    const merged = { ...p, lock_action_codes: p.lock_action_codes || [], campaign_effect: p.campaign_effect || 'none',
      account_effect: p.account_effect || 'none', login_effect: p.login_effect || 'none', remember_target_days: p.remember_target_days || 0 }
    lines.push(`| ${cell(p.error_class)} | ${cell(dataTexts(merged)[0])} | ${cell(effects(merged))} |`)
  }
  lines.push('')
  return lines.join('\n')
}

// Mã do migration ở local thêm (chưa apply): sinh tài liệu vẫn liệt kê để biết trước; mã đã có trên production thì bỏ khỏi bảng này.
const PENDING = [
  { code: 'CFG17', group: 'campaign_pause', migration: 'V503', meaning: 'Gửi dạng chia sẻ chưa có nội dung hoặc media',
    effects: 'tạm dừng chiến dịch; data về hàng đợi; không tính lượt; không ghi lịch sử' },
  { code: 'SYS09', group: 'failed', migration: 'V503', meaning: 'Lô chia sẻ dừng theo chính sách sau khi đã gửi media; chưa chia sẻ phần chữ',
    effects: 'data hoàn thành, không gửi lại; tính lượt; lịch sử "thất bại"' },
  { code: 'EXC01', group: 'hold_target', migration: 'V504', meaning: 'Người nhận thuộc điều kiện loại trừ gửi',
    effects: 'data tạm dừng kèm câu; không tính lượt; không ghi lịch sử; không nghỉ trước data kế' },
  { code: 'EXC02', group: 'hold_target', migration: 'V504', meaning: 'Chưa đủ dữ liệu để kiểm điều kiện loại trừ',
    effects: 'data tạm dừng kèm câu; không tính lượt; không ghi lịch sử; không nghỉ trước data kế' },
  { code: 'EXC03', group: 'skip', migration: 'V504', meaning: 'Nằm trong danh sách không gửi tin (kiểu cũ)',
    effects: 'data hoàn thành, không gửi; không tính lượt; không ghi lịch sử' },
  { code: 'CFG18', group: 'campaign_pause', migration: 'V504', meaning: 'Cấu hình loại trừ gửi không hợp lệ',
    effects: 'tạm dừng chiến dịch; data về hàng đợi; không tính lượt; không ghi lịch sử' },
  { code: 'CFG19', group: 'campaign_pause', migration: 'V504', meaning: 'Danh sách không gửi tin Zalo không hợp lệ',
    effects: 'tạm dừng chiến dịch; data về hàng đợi; không tính lượt; không ghi lịch sử' }
]

const data = loadData()
fs.writeFileSync(DOC, render(data))
console.log(`Đã ghi ${path.relative(ROOT, DOC)}`)
