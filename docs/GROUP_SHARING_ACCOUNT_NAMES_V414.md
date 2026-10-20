# Tên tài khoản nguồn và thông báo lưu chia sẻ — V414

## Hành vi

Theo lựa chọn người dùng ngày 20/10/2026, người nhận nhóm data thấy **tên tài khoản
nguồn** trong cột Tài khoản. V409 từng đặt `source_account_name = NULL`, khiến Desktop
không tìm thấy tài khoản trong catalog riêng và hiện chữ dự phòng “Tài khoản”.
Web cũng thiếu tên. V414 giữ tên vốn đã được reader đọc; không đọc thêm tài khoản.

Tên chỉ là thông tin nguồn. Không cấp quyền mở chi tiết, điều khiển hoặc chọn tài
khoản của chủ nhóm để chạy chiến dịch. Giữ kiểm tra quyền/cùng tổ chức/thu hồi,
ẩn lịch sử, chiến dịch, cấu hình đồng bộ, automation và provenance riêng. Bản sao
khác nhân viên vẫn độc lập, không gắn tài khoản hay bằng chứng quan hệ Zalo.
Tài khoản đã xóa mềm vẫn có tên và dấu đã xóa; data không có tài khoản vẫn hiện `—`.

Desktop và Web báo **Đã lưu chia sẻ nhóm.** bằng hộp thông báo thành công hiện có,
sau khi lưu và làm mới xong. Dialog chia sẻ đóng trước khi báo. Lỗi/CAS giữ thông báo
lỗi tại dialog; phản hồi lưu muộn sau đổi nhóm hoặc phiên không báo thành công.
Không thêm polling, connection, provider hoặc thư viện UI.

## Apply và checksum

- Project: **akachat** (`cgjbsmqtfhqvttudyjzq`).
- Đã apply: `20261020093520 / migration_v414_shared_group_source_account_name`,
  ngày 20/10/2026 lúc 16:35:20 giờ Việt Nam.
- Canonical: `migrations/migration_v414_shared_group_source_account_name.sql`.
- SHA256: `15df77f46aebee945a3dd8d1eca68d3387053604d9d5805357e4ebd637b46844`.
- Chữ ký: `public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)`.
- MD5 nguồn: `75e14dbec647c96812bed7d8c165fc18`.
- MD5 đích: `d6bbdca20f780005a411e8a6be6ae8e5`.

Migration dựng từ `pg_get_functiondef` live mới chụp, khớp V409 đã apply.
Diff body chỉ bỏ `'source_account_name',NULL,` khỏi nhánh redaction người nhận
trong `data_members`. Owner `postgres`, SECURITY DEFINER, VOLATILE, search_path,
statement_timeout và ACL giữ nguyên. Preflight/postflight kiểm tra cả checksum và
thuộc tính, fail nếu không khớp. Private reader giữ MD5
`bcae895d24daf017a1e52a83e834f1a9`. Không thay schema/chữ ký/result keys hoặc reload schema.
Không apply lại V409 hoặc V414.

## Kiểm chứng

`node scripts/group-sharing/verify-account-name.cjs` đã chạy trước apply:

- Baseline V409 tái hiện tên bị ẩn.
- Candidate V414 hiện tên với role thật `anon` và `service_role`, credential fixture.
- Chủ nhóm/người nhận admin, người không được chọn/khác tổ chức; lọc tài khoản,
  phân trang, data không có tài khoản, tài khoản xóa mềm, copy và thu hồi.
- Toàn bộ SQL smoke V409 giữ quyền Zalo, CAS, snapshot/bind/intake/thu hồi và bản sao.
- Chạy thử rollback khôi phục đúng body V409 và hành vi ẩn tên.

Sau apply, `node scripts/group-sharing/verify-account-name.cjs --applied` đã chạy
lại fixture V414, toàn bộ smoke V409 và rollback rehearsal. Mỗi lượt dùng transaction
kết thúc bằng `ROLLBACK`; cuối cùng kiểm tra live vẫn là V414. Không chạy campaign
thật hoặc gửi tin. Bằng chứng tại `migrations/snapshots/group-sharing-v414/`:
`live-before.json`, `manifest.json`, `change.diff`, `preflight-verification.json`,
`apply-verification.json` và `application-checks.json`.

Smoke Electron kiểm tra tên nguồn khi catalog tài khoản người nhận rỗng, ô tên
không có link/nút điều khiển; lưu từ cả manager data/nội dung có thông báo thành công.
Smoke component Desktop/Chromium giữ lỗi CAS và bỏ phản hồi đọc/lưu cũ.
Browser Web trên bundle production kiểm tra ô tên nguồn, dialog và thông báo lưu
data/nội dung ở 1440/850px. Hai typecheck Desktop, build Desktop/Web và 22 test
trang quản lý Web đạt.

## Rollout và rollback

DB V414 đã hoàn tất. API mapper/IPC/renderer hiện có dùng sẵn `source_account_name`,
nên không đổi hợp đồng. Client đã có reader chia sẻ nhận tên khi mở/tải lại data.
Tính năng tổng thể vẫn theo thứ tự **DB → API → Desktop/Web** của V409.
Thông báo mới cần bản Desktop/Web được cập nhật. Chưa deploy Web/API hoặc đóng gói,
phát hành Desktop trong lượt này.

Nếu cần hoàn nguyên riêng tên nguồn, dùng
`migrations/tests/migration_v414_shared_group_source_account_name_rollback.sql`.
File kiểm tra checksum/thuộc tính V414 trước khi khôi phục RPC đã chụp của V409;
dừng nếu có patch mới hơn. Rollback chỉ ẩn tên nguồn, không xóa chia sẻ/data/bản sao,
không hoàn nguyên V409. Không chạy file rollback chỉ để kiểm thử: dùng script
`verify-account-name.cjs --applied` để rehearsal trong transaction không lưu.
