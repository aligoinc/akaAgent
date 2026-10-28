# Nguồn triển khai quản lý ngoài repo

Theo yêu cầu ngày 28/10/2026, `index.ts` và `handler.ts` của endpoint này đã chuyển nguyên vẹn sang kho bảo mật ngoài repo, cùng migration chặn IP, bản chụp DB và kiểm thử riêng.

Thư mục mặc định: `$HOME/.codex/incident-recovery/akaAgent-ip-block/`. Biến `AKA_AGENT_PRIVATE_SECURITY_DIR` cho phép các script kiểm thử dùng thư mục khác; đường dẫn con giữ cấu trúc của repo.

Endpoint production vẫn hoạt động với mã đã triển khai. Repo không còn entrypoint triển khai endpoint này: không dựng lại entrypoint từ lịch sử Git hoặc deploy bản cũ vì sẽ mất quy tắc chặn đang chạy. Khi cập nhật, đọc source live và source trong kho bảo mật, giữ các bản vá hiện hành rồi mới triển khai riêng endpoint được yêu cầu.

Kiểm tra source đã chuyển bằng `node scripts/desktop-session-rls/edge-typecheck.cjs` và `node scripts/desktop-session-rls/auth-http-smoke.cjs`. Hai script kiểm thử IP riêng nằm trong kho bảo mật; đặt `AKA_AGENT_REPO_DIR` trỏ tới checkout khi chạy chúng.

Lần chuyển này không deploy, không apply SQL và không sửa lịch sử Git cũ.
