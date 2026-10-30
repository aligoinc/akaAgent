# Context: bỏ kích hoạt tự động từ lịch sử Zalo — V439

**Đã apply trên akachat `cgjbsmqtfhqvttudyjzq` lúc 15:13:24 VN, 30/10/2026.**
Ledger `20261030081324 / migration_v439_chat_zalo_context_skip_history`.
Không deploy/restart API, worker, ChatWeb, Zalo runtime hoặc Desktop.

## Hành vi đã chốt

Người dùng yêu cầu chặn tin đồng bộ ở trigger để giảm tải. Trigger
`public.chat_zalo_message.trg_context_xep_hang` giữ điều kiện tin đến có nội dung,
thêm `NEW.sync_source IS DISTINCT FROM 'old'` ngay trong `WHEN`.

- Tin lịch sử vẫn được insert vào Chat, nhưng không gọi function Context,
  nhận diện khách hàng hoặc ghi hàng đợi từ trigger này.
- Tin realtime và nguồn `api` giữ điều kiện cũ. Tin đi/nội dung rỗng không gọi
  trigger; tin nhóm realtime vẫn đi qua bộ lọc Context hiện có.
- Không xóa/hủy/chỉnh các job Context đã tồn tại. Không thêm job bù sau đồng
  bộ. Khách chỉ có lịch sử mới nhập có thể chưa được cập nhật Context.
- Các luồng thu thập thủ công/định kỳ độc lập vẫn có thể đọc dữ liệu lịch sử;
  không cam kết chúng tự thu thập toàn bộ lịch sử mới nhập.
- Áp dụng cho mọi row `old`, không chỉ org 1 hoặc một account. Giữ các bộ lọc,
  quyền, ngưỡng chờ và ngữ nghĩa nguồn tin khác.

## Nguồn và ràng buộc

Đã dùng `safe-supabase-rpc-migration`, đọc live PostgreSQL 17.6 và tìm migration
liên quan. Root V435 chỉ giữ patch quyền của các function Context; không dùng
nó để dựng lại body. V437/V438 canonical ở Chat API đã live; V439 là version
kế tiếp đã kiểm tra trên repo và ledger.

[Migration](../migrations/migration_v439_chat_zalo_context_skip_history.sql)
chỉ thay trigger trong một DO block nguyên tử, khóa bảng trước preflight,
`lock_timeout=2s`, `statement_timeout=10s` theo transaction và kiểm checksum
trước/sau. Trigger bị tắt, thiếu, đổi định nghĩa hoặc function/quyền drift đều
fail closed. Không đổi function, connection/pool, timeout global hoặc EXECUTE.

| Đối tượng | MD5 trước | MD5 sau |
|---|---|---|
| `trg_context_xep_hang` | `21da2094428e85bfb7ce8cfbf0b57750` | `8c7c490bc897f189910b9f8d2f8bdbfa` |
| `public.fn_context_trg_chat_zalo_message()` | `0e0e281069b421112dcf78b4d2eb4407` | Giữ nguyên |
| `public.fn_context_xep_hang(text,text,text)` | `35cae0ef11d7f53c385d229523ddf410` | Giữ nguyên |

Hai function giữ owner postgres, SECURITY DEFINER, volatility volatile,
`search_path=''`, ACL chỉ postgres/service_role và không có timeout mới.
Backend giữ SELECT/INSERT message, không được cấp gọi trực tiếp function
trigger. Hai trigger contact-info và touch timestamp giữ checksum. Không
reload PostgREST thủ công vì không đổi hợp đồng API.

SHA-256 migration đã apply:
`87d2d56b596285996bd4533cafc5c7a3112afc76840d148f90cbc3926c1f2979`.
SQL trong ledger khớp nguyên văn file canonical. Không apply lại như migration mới.

## Kiểm chứng

PostgreSQL 17 disposable, dữ liệu giả, tối đa hai connection harness hiện có;
đúng definition/checksum của chín function Context live cùng schema/index/FK và
trigger phụ. Không gọi Zalo hoặc AI.

- Tám ca INSERT dưới role `aka_agent_chat_api`: old cá nhân/nhóm/khách mới đều
  insert 20 row, gọi Context 0 lần; live/api incoming gọi đủ 20 và xếp job;
  live outgoing/rỗng gọi 0; live nhóm vẫn bị bộ lọc loại khỏi hàng đợi.
- Các ca old giữ nguyên profile, mapping và pending job Context.
- Apply hai lần trong transaction không đổi kết quả; ROLLBACK khôi phục đúng
  trigger cũ và dữ liệu. Rollback SQL riêng đã được diễn tập.
- Drift định nghĩa trigger, trigger disabled và ACL đều bị guard từ chối.
- Old INSERT hoàn tất khi connection thứ hai vẫn giữ khóa pending job Context.
- Production hậu kiểm bằng catalog/ledger; không insert tin giả vào Chat
  production. Đây không phải pilot Zalo thật hoặc đo tốc độ end-to-end mới.

[Capture trước](../migrations/snapshots/context-skip-history-v439/before.json),
[local verification](../migrations/snapshots/context-skip-history-v439/local-verification.json),
[hậu kiểm production](../migrations/snapshots/context-skip-history-v439/after.json).
Full fixture/harness riêng ở `$HOME/.codex/diagnostics/context-skip-history-v439/`;
đo chi phí trước đó ở `$HOME/.codex/diagnostics/context-trigger-cost-20261030/`.

Trước PR ngày 30/10/2026, đã đọc lại live đúng project akachat: SQL V439 khớp
nguyên byte với ledger `20261030081324`; trigger vẫn enabled với checksum đích,
hai function vẫn khớp body/checksum/owner/ACL/security/config đã capture. Bản
kiểm chứng PostgreSQL phía trên có cùng SHA-256 với SQL đưa vào PR. Lượt này chỉ
đối chiếu read-only và lưu hồ sơ vào Git, không apply/replay hoặc rollback DB.

Nếu cần hoàn tác, dùng [rollback có guard](../migrations/snapshots/context-skip-history-v439/rollback.sql)
sau khi đối chiếu lại live và có chỉ thị. Rollback cho tin old phát sinh sau
đó kích hoạt Context trở lại; không tự tạo job bù cho tin đã nhập lúc chặn.
