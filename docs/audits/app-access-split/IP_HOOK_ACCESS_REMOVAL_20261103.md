# Bỏ kiểm quyền akaAgent trong hook IP — V453 / 03/11/2026

**Đã apply lúc 12:16:02 Việt Nam**, production `cgjbsmqtfhqvttudyjzq`, ledger
`20261103051602 / remove_aka_agent_access_from_ip_hook_v453`. Không apply lại.
[Receipt](ip-hook-access-removal-receipt-20261103.json).

## Quyết định hiện hành

Người dùng yêu cầu trực tiếp bỏ riêng lời gọi
`PERFORM public.aka_agent_app_access_check_request();` khỏi
`public.aka_agent_block_denied_ip_request()`. Quyết định này thay yêu cầu chặn
quyền akaAgent tại hook chung trên từng request trong rollout V445–V447.
Không tự gắn lại lời gọi đó trong các lần bảo trì hoặc deploy tiếp theo.

Hook vẫn chặn IP ở cả ba header và các forwarded hop như trước; giữ cấu hình
`pgrst.db_pre_request`, STABLE/SECURITY INVOKER, owner, ACL và search_path.
Helper `aka_agent_app_access_check_request()` vẫn tồn tại nguyên trạng; không drop
hoặc cấp lại quyền. Guard đăng nhập, RLS, quota, account/campaign, QR, tenant,
claim/receipt/cleanup và các backend khác không thay đổi.

Phạm vi bị bỏ là nhánh role `aka_agent_desktop`. Desktop hiện tại giữ token trong
RAM; thoát hẳn tiến trình rồi mở lại, kể cả auto-login, đi qua đăng nhập/kiểm quyền
hiện tại. Ngoại lệ cleanup/stopping vẫn giữ. Đóng cửa sổ khi app còn chạy nền
không phải đăng nhập lại. Không bảo đảm thu hồi tức thời trên mọi đường của phiên
đang mở; không mặc định chỉ chờ JWT hết hạn vì có refresh token. Các guard riêng
vẫn chặn theo điều kiện của chúng.

## Source và checksum

Full capture, SQL candidate, trial, rollback và kết quả nằm ngoài Git tại:
`$HOME/.codex/incident-recovery/akaAgent-ip-block/remove-app-access-20261103-u_c7j6ta/`.
Migration canonical: `migration_v453_remove_app_access_from_ip_hook.sql`.
[Manifest V453](../../../migrations/migration_v453_remove_app_access_from_ip_hook.private.json)
giữ số phiên bản, không chứa body/IP. Không chạy các candidate IP cũ từ rollout.

- Exact signature: `public.aka_agent_block_denied_ip_request()`.
- Source MD5: `3d14fd34e0b35dac896876b9e6ec1604`.
- Target/live MD5: `ecfc014981c5058f9cd84e0e8e504bed`.
- Live capture khớp private candidate đã apply trước đó; target được tạo bằng
  việc bỏ đúng một dòng, không dựng lại deny-list từ lịch sử.
- Guard fail-closed kiểm checksum/properties, ACL, cấu hình hook và 31 hàm liên
  quan. Rollback có guard ngược về đúng source; chỉ dùng khi có chỉ thị mới.

## Kiểm chứng và giới hạn

- Trial production kết thúc ROLLBACK: candidate, 64 ca IP/header/role, hoàn nguyên
  definition/metadata đều đạt. Lần trial đầu không hoàn tất do Management API
  không được SET ROLE sang `aka_agent_chat_api`; transaction đã rollback. Không
  thêm grant để vượt lỗi. Role đó vẫn không có EXECUTE, được kiểm qua catalog.
- 64 ca thực thi trên Desktop/anon/authenticated/service_role gồm header rỗng,
  malformed, IP hợp lệ, toàn bộ IPv4/IPv6-mapped bị chặn, x-real-ip và forwarded
  hop; role Desktop với claims rỗng không còn bị helper app-access gọi ngầm.
- Sau apply chạy lại 64 ca trong ROLLBACK và capture live: chỉ một dòng mất đi;
  31 hàm liên quan, ACL, owner/config và hook setting giữ nguyên. Security advisors:
  9 trước / 9 sau / 0 mới. Không ghi business rows, không explicit NOTIFY/reload;
  cơ chế DDL hiện có không đổi, ledger ghi đúng một SQL payload.
- Paired benchmark 1.000 calls cùng ngữ cảnh Desktop trong trial: execution
  **925,671 ms → 12,883 ms**; shared hit blocks **57.080 → 17**, disk reads **0 → 0**.
  Có chi phí chuẩn bị lần đầu; đây là một ngữ cảnh mẫu, không phải phép đo toàn
  workload, không suy ra phần trăm CPU toàn DB giảm tương ứng.
- Không thử đăng nhập khách hàng, quét QR, gửi tin hoặc chạy chiến dịch thật.
  Không deploy Edge/API/Web/CRM, không build/phát hành Desktop/App Server.
  Thay đổi trong repo là tài liệu/manifest; kiểm tra JSON, link và diff.
