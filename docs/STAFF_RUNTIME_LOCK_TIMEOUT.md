# Giữ thời gian chờ khóa staff của luồng gọi — 27/10/2026

**Đã apply akachat lúc 15:50 VN ngày 27/10/2026 (`20261027085042 / staff_runtime_inherit_lock_timeout`). `org_staff` vẫn RLS=false. Không apply lại.** Chỉ sửa helper của B, không bật C hoặc đổi client.

## Vấn đề và phạm vi

B chuyển khóa trực tiếp trên `org_staff` sang `public.aka_agent_staff_runtime_scope(bigint,text)`. Helper thêm `lock_timeout=3s`, vì vậy request có ngân sách chờ dài hơn có thể lỗi sớm. Các kiểm tra cũ xác nhận khóa được giữ đến cuối transaction nhưng chưa kiểm tra chờ quá 3 giây; chúng không chứng minh tương đương timeout khi tranh chấp.

Đã tái hiện bằng PostgreSQL local, role anon với ngân sách statement/lock 8 giây và giao dịch khác giữ khóa 4,2 giây: khóa trực tiếp thành công, helper B lỗi `55P03` sau khoảng 3 giây, helper sửa thành công. Kết quả giống nhau với FOR SHARE và FOR UPDATE. Đây là kiểm chứng cơ chế, không phải bằng chứng khách cụ thể đã gặp lỗi production. Request có deadline ngắn hơn vẫn chịu deadline đó.

Candidate dùng `ALTER FUNCTION ... RESET lock_timeout` để kế thừa cấu hình từ luồng gọi. **Không đặt timeout thành 0 hoặc nâng timeout toàn hệ thống.** Giữ nguyên body, kết quả 13 cột, validation, FOR SHARE/FOR UPDATE và vòng đời khóa, owner postgres, SECURITY DEFINER, volatility, search_path và ACL. Không sửa 34 RPC runtime, V397/V389, quyền bảng/view, timeout HTTP/SQL đăng nhập và khôi phục, role defaults, pool hoặc polling.

## Audit và migration

- Project duy nhất: `cgjbsmqtfhqvttudyjzq` (akachat).
- Chữ ký: `public.aka_agent_staff_runtime_scope(bigint,text)`.
- Source MD5: `092a2f9248212405948944410f40172c`.
- Target MD5: `41d7a8af8bb781e59157a5b919621492`.
- [Capture live và thuộc tính](../migrations/snapshots/staff-runtime-lock-timeout/source.json), [target](../migrations/snapshots/staff-runtime-lock-timeout/target.json).
- [Candidate](../supabase/migrations/20261027083342_staff_runtime_inherit_lock_timeout.sql), tạo tên bằng Supabase CLI. Chặn checksum/owner/security/config/ACL khác trước khi ALTER; kiểm tra lại target trong cùng transaction. Không sửa migration A/B đã apply.
- [Rollback riêng](../migrations/snapshots/staff-runtime-lock-timeout/rollback.sql): chỉ nhận target chính xác và khôi phục giới hạn 3 giây; không đổi RLS hoặc quyền bảng. Đây là đường hoàn nguyên kỹ thuật, không phải khuyến nghị khôi phục regression.

Generator, C chưa apply và rollback C đã cập nhật guard helper mới; giữ đủ 44 guard hàm sau khi tích hợp v3. C phải từ chối nếu helper còn giới hạn 3 giây. Candidate này độc lập với v3, nhưng thứ tự phát hành v3/C vẫn theo [hợp đồng v3](DEVICE_IDENTITY_V3.md) và [rollout staff](STAFF_RLS_ROLLOUT.md).

## Kiểm chứng

- `node scripts/staff-rls/lock-timeout-smoke.cjs`: **33 kiểm tra trên PostgreSQL 16.15 và 33 trên 17.11**, fixture riêng không dữ liệu khách. So sánh trước/sau, caller lock timeout 100ms, statement timeout 100ms, kết quả/quyền/RLS không đổi, validation, drift body/ACL/config/missing function, diễn tập migration trong transaction ROLLBACK, rollback riêng và apply lại sau rollback.
- `STAFF_RLS_RECEIPT_DIR=staff-runtime-lock-timeout node scripts/staff-rls/run-sql-smoke.cjs`: **126 kiểm tra PG16 và 132 PG17**. Giữ 34 RPC/metadata, quyền và recovery, khóa đến cuối transaction, C từ chối helper cũ, local C và rollback; gồm candidate v3 trong fixture; lượt kiểm thử local này không apply migration lên production.
- Receipts: [timeout PG16](../migrations/snapshots/staff-runtime-lock-timeout/timeout-verification-pg16.json), [timeout PG17](../migrations/snapshots/staff-runtime-lock-timeout/timeout-verification-pg17.json), [RLS PG16](../migrations/snapshots/staff-runtime-lock-timeout/rls-verification-pg16.json), [RLS PG17](../migrations/snapshots/staff-runtime-lock-timeout/rls-verification-pg17.json).
- JS syntax và `git diff --check` đạt. Không sửa mã ứng dụng. Hai typecheck đạt; production build trên worktree PR #556 đạt trong 26,3 giây, output 39.246.249 byte. [Receipt PR](../migrations/snapshots/staff-runtime-lock-timeout/pr-verification.json). Các kiểm tra của PR #556 chạy trên `dev_3` tại thời điểm đó, chưa gồm phần v3 được merge sau trong PR #557.

## Apply production — 27/10/2026

Đã apply riêng canonical SQL qua Supabase MCP lên `cgjbsmqtfhqvttudyjzq`, lịch sử `20261027085042 / staff_runtime_inherit_lock_timeout`. Trước apply đã chụp lại đầy đủ định nghĩa/thuộc tính helper, 38 hàm liên quan, ba bảng, view và role defaults; chạy candidate trong transaction ROLLBACK và xác nhận toàn bộ metadata không đổi.

Sau apply, helper khớp target `41d7a8af8bb781e59157a5b919621492`, chỉ bỏ `lock_timeout=3s`. Body/owner/security/ACL, 38 hàm khác, RLS/grants của ba bảng, view và role defaults giữ nguyên. Sáu kiểm tra SQL qua anon đạt: staff/mode sai bị từ chối, staff sentinel không tồn tại trả rỗng với share/update, caller lock/statement timeout giữ nguyên. Không trả dữ liệu hoặc khóa hàng staff khách. Đã diễn tập rollback riêng trong transaction ROLLBACK, rồi xác nhận target vẫn giữ nguyên.

[Preflight](../migrations/snapshots/staff-runtime-lock-timeout/production-preflight.json), [sau apply](../migrations/snapshots/staff-runtime-lock-timeout/production-applied.json), [SQL smoke](../scripts/staff-rls/lock-timeout-production-smoke.sql). `production-unchanged.json` lưu lần kiểm tra lịch sử trước apply.

Trong lượt sửa timeout này, không bật RLS C, apply v3, chạy lại A/B, deploy hoặc đóng gói app. V3 được apply trong lượt riêng sau đó, theo [audit v3](DEVICE_IDENTITY_V3.md#apply-production--27102026). Bản sửa không cần build lại app. Nó chỉ xử lý regression chờ khóa đã xác nhận; không phải chứng nhận mọi luồng RPC tương đương toàn bộ hành vi cũ. Rollback riêng chỉ khi có quyết định hoàn nguyên và live còn khớp target.
