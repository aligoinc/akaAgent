// Chạy toàn bộ kiểm tra cục bộ của engine kết quả v2 theo thứ tự, dừng ở bước hỏng đầu tiên.
// node scripts/campaign-outcome-engine-check-all.cjs
'use strict'
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const steps = [
  ['Typecheck lõi', [require.resolve('typescript/bin/tsc', { paths: [path.resolve(__dirname, '..')] }), '-p', 'packages/campaign-engine/tsconfig.json', '--noEmit']],
  ['Kiểm ranh giới', ['scripts/campaign-engine-boundary-check.cjs', '--self-test']],
  ['Smoke SQL V495', ['scripts/campaign-outcome-engine-sql-smoke.cjs']],
  ['Kiểm V496 (thôi ép bật cờ)', ['scripts/test-v496-new-zalo-runtime-default.cjs']],
  ['Kiểm V497 (định tuyến theo cờ)', ['scripts/test-v497-zalo-server-flag-route.cjs']],
  ['Kiểm V498 (Desktop biết tổ chức chạy trên Fly)', ['scripts/test-v498-zalo-server-on-fly-desktop.cjs']],
  ['Kiểm V529 (Desktop chọn nơi chạy tài khoản Server như Web)', ['scripts/test-v529-desktop-server-on-fly-flag-route.cjs']],
  ['Kiểm V513 (Desktop đọc cờ engine v2 của tổ chức)', ['scripts/test-v513-engine-desktop-flag.cjs']],
  ['Kiểm V514 (giữ khớp trạng thái hệ thống V494 với engine)', ['scripts/test-v514-status-system-group-guard.cjs']],
  ['Kiểm V499 (nhớ mục tiêu theo tài khoản)', ['scripts/test-v499-target-memory-per-account.cjs']],
  ['Kiểm V500 (chính sách lỗi Zalo đã duyệt)', ['scripts/test-v500-zalo-error-policies.cjs']],
  ['Smoke Desktop nghe tiến trình từ ChatApi', ['scripts/run-zalo-chat-realtime-only-smoke-test.cjs']],
  ['Smoke V501 (lịch chạy, thử lại data, kết thúc lượt)', ['scripts/campaign-outcome-engine-v501-smoke.cjs']],
  ['Smoke V503 (nhận / báo cả lô gửi dạng chia sẻ)', ['scripts/campaign-outcome-engine-v503-smoke.cjs']],
  ['Smoke V504 (loại trừ gửi: RPC theo lease, lõi, nhắn bạn bè / SĐT / chia sẻ)', ['scripts/campaign-outcome-engine-v504-smoke.cjs']],
  ['Smoke V505 (lấy data đầu lượt: bạn bè toàn bộ / theo tag, sinh nhật, đề xuất, huỷ lời mời)', ['scripts/campaign-outcome-engine-v505-smoke.cjs']],
  ['Smoke V506 (group thời gian thực, kiêm gửi SMS)', ['scripts/campaign-outcome-engine-v506-smoke.cjs']],
  ['Smoke V507 (bỏ nhớ mục tiêu theo tài khoản: xoá bảng, cột, đoạn kiểm)', ['scripts/campaign-outcome-engine-v507-smoke.cjs']],
  ['Smoke V508 (126/127 nhắn group: group chặn riêng tài khoản, không khoá, không dừng)', ['scripts/campaign-outcome-engine-v508-smoke.cjs']],
  ['Smoke V509 (112 nhắn người lạ / bạn bè: xử lý như 118 "Nội dung quá dài")', ['scripts/campaign-outcome-engine-v509-smoke.cjs']],
  ['Smoke V512 (luật tín hiệu lệnh Fly: lệnh đọc chưa gửi, tag / đổi tên như Desktop, tham số sai, phiên tag)', ['scripts/campaign-outcome-engine-v512-smoke.cjs']],
  ['Smoke V515 (mất câu trả lời của lần chốt data / của claim, ghi chú cũ sau khi gửi thành công)', ['scripts/campaign-outcome-engine-v515-smoke.cjs']],
  ['Smoke V517 (dọn bảng vận hành engine v2 giữ 30 ngày, decision gọn)', ['scripts/campaign-outcome-engine-v517-smoke.cjs']],
  ['Smoke V527 (claim bỏ qua claim token bộ cũ treo trên chiến dịch đã xoá / tạm dừng)', ['scripts/campaign-outcome-engine-v527-smoke.cjs']],
  ['Smoke V532 (lỗi có ngưỡng ở bước phụ không tạm dừng chiến dịch ngay; câu nhận data không quét khoá chính)', ['scripts/campaign-outcome-engine-v532-smoke.cjs']],
  ['Smoke lõi: Fly ra cùng kết quả với Desktop (đọc hồ sơ treo, câu lỗi rỗng)', ['scripts/campaign-engine-fly-parity-smoke.cjs']],
  ['Smoke theo dõi tương tác (nguồn, cờ chờ đăng ký, đăng ký đúng dòng, kết bạn, group không theo dõi)', ['scripts/campaign-outcome-engine-engagement-smoke.cjs']],
  ['Smoke lõi + tích hợp', ['scripts/campaign-outcome-engine-core-smoke.cjs']],
  ['Smoke gửi tệp, nội dung định dạng / nâng cao, AI', ['scripts/campaign-outcome-engine-media-smoke.cjs']],
  ['Smoke loại theo UID, bạn bè, group, thêm thành viên, vào group bằng link', ['scripts/campaign-outcome-engine-uid-smoke.cjs']],
  ['Smoke gửi dạng chia sẻ (bạn bè / group theo lô)', ['scripts/campaign-outcome-engine-share-smoke.cjs']],
  ['Smoke bộ chạy Desktop', ['scripts/campaign-engine-desktop-smoke.cjs']],
  ['Bộ kiểm danh mục bản cũ', ['scripts/legacy-catalog-validator-smoke.cjs']]
]
for (const [label, args] of steps) {
  const started = Date.now()
  const r = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const tail = (r.stdout || '').trim().split('\n').slice(-1)[0] || ''
  if (r.status !== 0) {
    console.error(`FAIL ${label}\n${r.stdout}\n${r.stderr}`)
    process.exit(1)
  }
  console.log(`OK   ${label} (${((Date.now() - started) / 1000).toFixed(1)} s) ${tail}`)
}
