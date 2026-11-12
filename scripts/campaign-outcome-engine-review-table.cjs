// Sinh bảng mã Zalo cho docs/CAMPAIGN_OUTCOME_ENGINE_REVIEW_ZALO.md từ chính sách THẬT của V495 (mô phỏng trên PG17
// cục bộ với danh mục chụp từ production). Chạy lại sau mỗi thay đổi chính sách để bảng duyệt luôn khớp seed.
// node scripts/campaign-outcome-engine-review-table.cjs [--write]
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')

const DOC = path.join(ROOT, 'docs/CAMPAIGN_OUTCOME_ENGINE_REVIEW_ZALO.md')
const BEGIN = '<!-- BEGIN:ZALO_CODE_TABLE (sinh bởi scripts/campaign-outcome-engine-review-table.cjs) -->'
const END = '<!-- END:ZALO_CODE_TABLE -->'
const ACTION_NAMES = { zalo_find_phone_user: 'tra số', zalo_message_stranger: 'nhắn người lạ', zalo_message_friend: 'nhắn bạn bè',
  zalo_message_group: 'nhắn nhóm', zalo_add_friend: 'kết bạn', zalo_add_group_member: 'thêm vào nhóm', zalo_join_group_link: 'vào nhóm bằng link',
  zalo_join_group: 'vào nhóm', zalo_tag_contact: 'gắn tag', zalo_change_alias: 'đổi tên', zalo_cancel_sent_friend_request: 'huỷ lời mời' }
const ZALO_ACTIONS = Object.keys(ACTION_NAMES)
const SYSTEM_CODES = ['err_undefined', 'err_network_offline', 'err_proxy_failed', 'err_server_unreachable', 'err_media_file_missing',
  'err_input_invalid', 'err_campaign_config_invalid', 'err_device_sleep']
// SYS01/SYS02 không có ở đây: pg_cron (aka_agent_engine_close_stale_v1) đóng data trực tiếp, không qua chính sách.
const ENGINE_ORDER = ['err_engine_unknown_delivery', 'err_engine_runtime_unavailable', 'err_engine_no_outcome', 'err_engine_cancelled',
  'err_cfg_zalo_web_image_only', 'err_cfg_zalo_too_many_files', 'err_cfg_zalo_file_extension', 'err_cfg_template_missing_column']
// Cột "Duyệt": chỉ dòng có số đề xuất mới khác hành vi hiện nay (chi tiết ở mục 4 của tài liệu).
const PROPOSALS = {
  err_zalo_user_not_found: 'Đổi #1, #2', err_zalo_219_find_phone_invalid: 'Đổi #1, #2', err_zalo_210_target_unavailable: 'Đổi #1, #2',
  err_zalo_receiver_blocks_stranger_message: 'Đổi #1, #2', err_zalo_receiver_blocks_message: 'Đổi #2',
  err_zalo_802_message_stranger: 'Đổi #3', err_zalo_120_message_stranger: 'Đổi #3', err_zalo_802_add_group_member: 'Đổi #3',
  err_zalo_120_add_group_member: 'Đổi #3', err_zalo_session_invalid: 'Đổi #4', err_zalo_api_business_failed: 'Đổi #5',
  err_zalo_invalid_param: 'Đổi #6'
}

const fmtLock = p => {
  const codes = (p.lock_action_codes || []).map(c => ACTION_NAMES[c] || c)
  if (!codes.length) return '—'
  const when = p.lock_mode === 'indefinite' ? 'vô thời hạn' : p.lock_mode === 'end_of_day' ? 'tới hết ngày'
    : p.lock_mode === 'days_at_time' ? `tới ${String(p.lock_time || '').slice(0, 5)} sau ${p.lock_days} ngày` : `${p.lock_minutes} phút`
  return `${codes.join(', ')} ${when}`
}
const fmtEffect = p => {
  const out = []
  if (p.campaign_effect === 'pause') out.push(p.streak_threshold ? `tạm dừng chiến dịch khi ${p.streak_threshold} data lỗi liền` : 'tạm dừng chiến dịch')
  if (p.campaign_effect === 'hold') out.push('chiến dịch về chờ')
  if (p.account_effect === 'pause') out.push('tạm dừng tài khoản')
  if (p.login_effect === 'logged_out') out.push('đánh dấu chưa đăng nhập')
  if (p.login_effect === 'checkpoint') out.push('checkpoint')
  if (p.run_effect === 'end_unit') out.push('dừng lượt sau data này')
  if (p.run_effect === 'stop_campaign') out.push('dừng chiến dịch')
  if (p.remaining_steps === 'skip') out.push('bỏ bước còn lại')
  if (p.remember_target_days > 0) out.push(`nhớ ${p.remember_target_days} ngày trong tổ chức`)
  return out.join('; ') || '—'
}
const TARGET = { complete: 'hoàn thành', requeue: 'chờ xử lý', requeue_after: 'hẹn lại', hold: 'tạm dừng' }
const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

async function main() {
  const { connect, stop } = startCluster({ port: Number(process.env.V495_REVIEW_PORT || 55496), label: 'aka-v495-review-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    await db.query(MIGRATION)
    const errors = (await db.query(`SELECT e.error_code, e.public_code, e.error_class, e.error_name, e.noti_running_process, e.zalo_error_codes, e.zalo_action_codes, e.error_type
      FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete
        AND (e.error_type ILIKE '%zalo%' OR e.error_code = ANY($1) OR e.error_type = 'engine v2' OR e.error_code = 'err_zalo_session_invalid')
      ORDER BY CASE WHEN e.error_type = 'engine v2' THEN 2 WHEN e.error_code = ANY($1) THEN 1 ELSE 0 END, e.public_code, e.error_code`, [SYSTEM_CODES])).rows
      .filter(e => e.error_type !== 'engine v2' || ENGINE_ORDER.includes(e.error_code))
    const statusName = new Map((await db.query(`SELECT id, status_value FROM public.auto_status`)).rows.map(r => [Number(r.id), r.status_value]))
    const lines = ['| Mã | Lỗi | Mã Zalo · thao tác | Câu tiến trình hiện nay | Lịch sử | Tính lượt | Chuỗi lỗi | Data | Khoá | Ảnh hưởng khác | Nghỉ | Duyệt |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|']
    for (const e of errors) {
      const actions = (e.zalo_action_codes || []).length ? e.zalo_action_codes : [e.error_code.startsWith('err_cfg_fb') ? 'zalo_message_stranger' : 'zalo_message_stranger']
      const sim = (await db.query(`SELECT public.aka_agent_engine_simulate_v1('zalo_message_phone', 'fly', $1::jsonb) AS r`,
        [JSON.stringify({ actionCode: actions[0], ok: false, phase: 'after_send', signal: { errorCode: e.error_code } })])).rows[0].r
      const p = sim.policy
      const zalo = [(e.zalo_error_codes || []).join('/') || '—', (e.zalo_action_codes || []).map(a => ACTION_NAMES[a] || a).join(', ') || 'mọi thao tác'].join(' · ')
      lines.push(`| ${cell(e.public_code)} | ${cell(e.error_name)} | ${cell(zalo)} | ${cell(e.noti_running_process || '—')} | ` +
        `${cell(p.detail_mode === 'write' ? statusName.get(Number(p.detail_status_id)) : 'không ghi')} | ${p.quota_effect === 'count' ? 'có' : p.quota_effect === 'count_if_committed' ? 'nếu đã gửi' : 'không'} | ` +
        `${p.target_streak_effect === 'increment' ? '+1' : p.target_streak_effect === 'reset' ? 'về 0' : '—'} | ${TARGET[p.target_effect] || p.target_effect} | ` +
        `${cell(fmtLock(p))} | ${cell(fmtEffect(p))} | ${p.pace_mode === 'full' ? 'có' : p.pace_mode === 'short' ? 'ngắn' : 'không'} | ` +
        `${e.error_type === 'engine v2' ? 'Cấu trúc mới' : PROPOSALS[e.error_code] || 'Giữ'} |`)
    }
    const rules = (await db.query(`SELECT r.pattern, coalesce(r.action_code, '*') AS action_code, r.error_code, e.public_code
      FROM public.auto_outcome_signal_rules r JOIN public.auto_error e ON e.error_code = r.error_code
      WHERE r.platform = 'zalo' AND r.signal_kind = 'zalo_code' ORDER BY r.pattern::int, r.action_code NULLS LAST`)).rows
    const table = lines.join('\n') + `\n\n${errors.length} mã; ${rules.length} luật mã Zalo → mã nội bộ (dựng 1:1 từ auto_error.zalo_error_codes × zalo_action_codes).\n`
    if (process.argv.includes('--write')) {
      const doc = fs.readFileSync(DOC, 'utf8')
      const a = doc.indexOf(BEGIN), b = doc.indexOf(END)
      if (a < 0 || b < a) throw new Error('Không thấy cặp đánh dấu bảng trong ' + DOC)
      fs.writeFileSync(DOC, doc.slice(0, a + BEGIN.length) + '\n' + table + doc.slice(b))
      console.log(`Đã ghi ${errors.length} dòng vào ${path.relative(ROOT, DOC)}`)
    } else {
      console.log(table)
    }
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
