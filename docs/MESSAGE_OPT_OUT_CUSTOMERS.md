# Khách hàng từ chối nhận tin

Menu chỉ đọc trong Cài đặt chung, ngay dưới Danh sách không gửi tin. Chỉ lấy `confirmed_at IS NOT NULL` của đúng staff/organization đã xác thực; 50 dòng/trang, mới nhất trước, tìm kiếm tại DB. Không thêm polling hoặc connection.

## Nguồn gửi

Desktop/App Server và Chat system-worker thêm `data.messageOptOutSource` vào kết quả gửi cá nhân thành công có link đã prepare. Metadata phiên bản 1 gồm UUID opt-out, global ID, tên, avatar và thời điểm nội dung gửi thành công. Không kiểm tra/khôi phục link sau AI và không đổi thứ tự cá nhân hóa, footer, AI hoặc chính sách gửi.

Trigger chỉ chạy với INSERT kết quả nhắn tin bạn bè/người lạ thành công có metadata; xác minh campaign/account/input cùng staff/organization và global ID của target khớp opt-out. Snapshot mới hơn thắng theo `(sentAt, detailId)`. Thời điểm gửi được chụp ngay sau khi thao tác gửi nội dung thành công, trước các bước ghi kết quả/phụ; clock của máy runtime cần được đồng bộ như các timestamp runtime khác.

Xác nhận và cập nhật nguồn cùng khóa row opt-out. Kết quả ghi trễ vẫn được nhận nếu đã gửi trước `confirmed_at`; lần gửi sau đó không thay nguồn. Kết quả thất bại/partial send và hành động phụ không cập nhật nguồn. Snapshot không có FK cascade nên còn sau khi xóa campaign/detail. Dữ liệu cũ hoặc runtime cũ thiếu metadata hiển thị `—`; không tự động suy diễn nguồn.

## API

`electronAPI.listMessageOptOutCustomers({ search?, page? })` trả `{ items, total, page, pageSize: 50 }`. IPC chỉ chấp nhận main frame của cửa sổ ứng dụng. Repository lấy credential từ main process và gọi `aka_agent_list_message_opt_out_customers`; credential không đi qua renderer.

RPC dùng `auto_assert_automation_identity`, kiểm tra staff active/chưa xóa và luôn lọc staff + organization. `anon`/`authenticated` không có quyền đọc trực tiếp bảng. Tìm kiếm coi `%` và `_` là ký tự thường. Tên, avatar, Email và nguồn có thể null.

## Audit v295 — 20/09/2026

Target đã verify: `cgjbsmqtfhqvttudyjzq` / akachat. Migration: `migration_v295_message_opt_out_customers.sql`, history version `20260920131101` (`message_opt_out_customers_v295`). Đã apply riêng qua MCP sau khi chạy toàn bộ migration và smoke trong transaction rollback trên linked production. Schema cache đã refresh do bổ sung public RPC/cột; HTTP smoke trả `automation_auth_invalid`, xác nhận RPC đã vào cache và từ chối credential sai. Không có tin Zalo thật được gửi trong kiểm thử.

Hai function mới không tồn tại lúc audit; preflight từ chối nếu function/cột đã xuất hiện. Definition, owner, security mode, volatility, config và ACL baseline nằm ở `scripts/fixtures/message-opt-out-live-baseline.json`.

| Signature | Source checksum | Target checksum |
| --- | --- | --- |
| `auto_capture_message_opt_out_source()` | absent | `d3c668ebc4c10a51d2e34926b6ca3535` |
| `aka_agent_list_message_opt_out_customers(bigint,bigint,text,text,text,integer)` | absent | `e68d635b48d4a15a18db0f338904d7bd` |
| `aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)` | `92b00c0827a801e9ffece28d14805f84` | unchanged |
| `aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)` | `0217c031e0d6aaef63c2589cbe1f7b94` | unchanged |
| `aka_agent_inspect_zalo_message_opt_out(uuid)` | `abd87ff2937831d2ee3ab999f2ebe091` | unchanged |
| `aka_agent_confirm_zalo_message_opt_out(uuid)` | `4fe1c52c866b3afec96e956302a52eee` | unchanged |

Các function mới owner `postgres`, `SECURITY DEFINER`, `search_path=pg_catalog, public`; list `STABLE`, timeout 10 giây; trigger `VOLATILE`. List có EXECUTE cho anon/authenticated/service_role và không PUBLIC; trigger không PUBLIC/anon/authenticated. Không thay body hoặc ACL của bốn RPC cũ, bao gồm quyền `aka_agent_chat_api` đang chạy.

## Kiểm chứng

- `node scripts/run-message-opt-out-customers-db-smoke.cjs`: PGlite trong bộ dependency repo akaAgentChatApi kế bên; migration rollback, baseline nguyên vẹn, nguồn A/B, failure/auxiliary, scope, kết quả đến lệch thứ tự, trước/sau xác nhận, xóa nguồn, phân trang và tìm kiếm ký tự đặc biệt.
- `supabase db query --linked --file migrations/tests/migration_v295_message_opt_out_customers_smoke.sql`: smoke production rollback, không thao tác Zalo.
- `node scripts/zalo-message-opt-out-smoke-test.cjs`: rendering cũ và đường gửi phone/friend thật với runtime giả lập.
- `node scripts/run-message-opt-out-customers-ui-smoke.cjs`: Electron thật, chặn HTTP, IPC fixture; menu, lazy load, cột, ngày Việt Nam, avatar lỗi, search/page/retry/stale response và màn hình hẹp.
- `node scripts/run-campaign-settings-ui-smoke.cjs`: giữ luồng mở/đóng Settings từ form campaign.
- Hai typecheck, `npm run build`, `npm run build:server`; Chat `npm test` và `npm run build`.

Rollout: migration trước, worker/runtime ghi metadata sau, Desktop UI qua build mới. Rollback code dùng binary/image trước và giữ schema additive; không xóa lịch sử hoặc thay đổi confirmed_at.

Chat worker `784574da214578` đã cập nhật image `opt-out-customers-v295-20260920` (digest `sha256:b96fc50ccbaa8e85d7ac353b3ae234281137609df7566e3b373225c5002fc10a`). Không đổi API/Zalo runtime machine hoặc cấu hình/số replica; health live/ready đều HTTP 200. Desktop/App Server đã build local, chưa đóng gói/phát hành installer mới.
