# V682: chống gửi lặp đọc lịch sử theo data ở cả hai nhánh (28/11/2026)

Trạng thái: **đã apply akachat 08:59:48 VN 28/11/2026** theo yêu cầu ("Apply ngay"; sổ `20261128015948`, md5 sổ = file `482d6d69…`,
không apply lại; [biên nhận](../migrations/snapshots/delivery-cooldown-v682/apply-receipt.json)). Chưa commit
(worktree `.claude/worktrees/delivery-cooldown-v682`, nhánh `claude/delivery-cooldown-v682`).
File: [migration](../migrations/migration_v682_delivery_cooldown_history_by_input.sql),
[bản gỡ](../migrations/rollback_v682_delivery_cooldown_history_by_input.sql), sinh bằng `node scripts/build-v682-sql.cjs`.

Nối tiếp [COOLDOWN_HISTORY_V431.md](COOLDOWN_HISTORY_V431.md): bản 28/10 (md5 `018db885…`, đang chạy) tìm các data trùng người nhận trước
rồi đọc lịch sử qua `idx_campaign_details_input_data_id`. V682 giữ đúng cách đọc đó cho nhánh kết quả `committed`, nơi planner đã đi lệch.

## Lỗi

- Chiến dịch 53573 (nhân viên 1108, Desktop 10.9.0, Nhắn tin theo SĐT, chống gửi lặp 90 ngày, tính trên mọi tài khoản của nhân viên:
  54 tài khoản) không nhận được data nào từ 13:11 VN 27/11.
- Claim engine v2 (`aka_agent_engine_claim_target_v1`) gọi `aka_agent_apply_campaign_delivery_cooldown` cho data đầu đang chờ; lời gọi
  quá trần 3 giây của Desktop nên claim trả 500 khoảng một lần mỗi phút (24 giờ tới 08:30 VN 28/11: 343 lần của riêng máy này).
- Không có ghi chú, data không bị tạm dừng: ngân sách `engine.cooldown_scan_ms` (1,5 giây) chỉ được kiểm giữa hai data, và hết giờ (57014)
  không bắt được bằng `EXCEPTION`, nên phút sau claim gặp lại đúng data đó. Lease, lượt mở, trạng thái tài khoản đều bình thường, nên câu dò
  tài khoản kẹt / lượt treo không thấy. Dò: `postgres_logs` "canceling statement due to statement timeout" có `parsed.context` chứa
  `aka_agent_apply_campaign_delivery_cooldown`.

## Nguyên nhân

- Hàm là plpgsql (`RETURN QUERY`), nên câu bên trong chạy theo kế hoạch tính với giá trị thật (custom plan).
- SĐT của data đầu có trong 1.017 dòng data trên toàn hệ thống (CTE `matching_input_ids`).
- Trong CTE `recipient_history`, nhánh kết quả `committed` (`policy_snapshot->>'operationState' = 'committed'`) được chọn chỉ mục
  `auto_detail_committed_delivery_v367 (account_id, action_code, created_at DESC, input_data_id)` và lặp theo từng tài khoản của
  `history_accounts` (planner ước 1 dòng, thật 54): 1.017 × 54 = 54.918 lần quét, mỗi lần đọc cả 90 ngày tin của tài khoản vì
  `input_data_id` đứng sau `created_at` trong chỉ mục. 707 nghìn buffer, 3,8–4,3 giây dù đã nằm trong bộ nhớ.
- Nhánh kết quả kiểu cũ (`operationState` trống) cùng câu đi `idx_campaign_details_input_data_id`.
- Ở generic plan, bản đang chạy đã đi đúng chỉ mục `input_data_id` (17 ms); chỉ custom plan mới lệch.

## Bản sửa

```sql
-- hai chỗ, cả hai nhánh của recipient_history
AND (hd.account_id + 0) IN (SELECT account.id FROM history_accounts AS account)
```

- `account_id + 0` không dùng được chỉ mục bắt đầu bằng `account_id` (v367 và `idx_campaign_details_delivery_cooldown`), nên câu đi
  `idx_campaign_details_input_data_id`. Chi phí lúc đó theo số dòng lịch sử của các data trùng người nhận, không còn nhân với
  số tài khoản × độ dài khoảng ngày.
- Cùng tập dòng, cùng kết quả (`account_id` trống vẫn bị loại), cùng chữ ký, chủ, quyền, cấu hình.
  md5 `pg_get_functiondef` `018db8850de2f967b13240e6cd36158c` → `fb517d00c3446f82579223fe2ceb002e`.
- Có hiệu lực ngay cho mọi nơi gọi hàm (claim engine v2, bộ cũ Desktop / App Server, Fly); không cần build, deploy.
  Chiến dịch 53573 chạy lại ở lần claim kế tiếp.

## Kiểm

Postgres 17 cục bộ: `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/delivery-cooldown-v682-smoke.cjs` (84 nhóm, ~5 giây).

- Migration chạy thử trong giao dịch rồi apply; chỉ thân hàm này đổi; chạy lại bị chặn; bản gỡ.
- So kết quả với bản đang chạy ở mọi thao tác, UID / SĐT, phạm vi tài khoản / nhân viên / tổ chức, xoá mềm, ranh giới ngày VN,
  lô 500, ba chế độ `plan_cache_mode`, quyền Desktop / anon.
- Postgres cục bộ không tái hiện kế hoạch xấu (cả hai bản ~9 ms), nên phần chậm chỉ đo được trên production.

Production, chỉ đọc (28/11 08:40 VN): `SUPABASE_WORKDIR=<checkout đã link> node scripts/delivery-cooldown-v682-prod-compare.cjs 12`.
Mỗi câu chạy trong `BEGIN READ ONLY … ROLLBACK`; đo phần tra lịch sử của data đầu đang chờ ở 53573 và 11 chiến dịch khác đang bật
chống gửi lặp (chọn ngẫu nhiên). Thời gian / buffer, bản đang chạy → V682:

| Chiến dịch | Loại | Mọi tài khoản | Ngày | Data trùng | Custom plan | Generic plan |
|---|---|---|---|---|---|---|
| 53573 | Nhắn tin theo SĐT | có | 90 | 1.017 | 3.795 ms / 707.865 → 17,0 ms / 10.570 | 16,7 → 16,7 ms |
| 63744 | Nhắn tin theo SĐT | có | 7 | 1 | 6,9 ms / 338 → 2,5 ms / 114 | 2,4 → 2,8 ms |
| 57257 | Nhắn tin theo SĐT | không | 30 | 73 | 8,2 ms / 1.151 → 7,4 ms / 1.110 | 7,0 → 7,0 ms |
| 47262 | Nhắn tin theo SĐT | không | 10 | 57 | 5,4 ms / 1.057 → 5,9 ms / 775 | 5,9 → 5,9 ms |
| 57674 | Nhắn tin theo SĐT | không | 3 | 44 | 5,4 ms / 1.027 → 5,7 ms / 797 | 5,9 → 5,8 ms |
| 54826 | Nhắn tin theo SĐT | không | 30 | 9 | 3,3 ms / 243 → 3,1 ms / 229 | 3,1 → 3,0 ms |
| 46981 | Nhắn tin theo SĐT | không | 3 | 5 | 2,7 ms / 171 → 2,7 ms / 179 | 2,9 → 2,8 ms |
| 55398 | Nhắn tin theo SĐT | không | 90 | 1 | 2,8 ms / 128 → 2,3 ms / 113 | 2,4 → 2,2 ms |
| 58309 | Nhắn tin thành viên nhóm | không | 3 | 3 | 2,4 ms / 110 → 2,2 ms / 98 | 2,1 → 2,2 ms |
| 64088 | Nhắn tin thành viên nhóm | không | 4 | 2 | 2,5 ms / 103 → 2,3 ms / 90 | 2,2 → 2,3 ms |
| 61933 | Nhắn tin thành viên nhóm | không | 1 | 1 | 2,1 ms / 74 → 2,3 ms / 68 | 2,0 → 2,1 ms |
| 19368 | SMS | không | 7 | 1 | 2,6 ms / 114 → 5,9 ms / 112 | 2,4 → 2,6 ms |

12/12 cùng kết quả. Chênh lệch vài mili giây ở các dòng nhỏ là nhiễu của một lần đo (số buffer không tăng).
Chạy lại riêng 53573 lúc 08:55 VN: 4.257 ms → 18,1 ms.

## Apply, theo dõi, gỡ

1. Ngay trước khi apply, kiểm sổ (số chỉ thật sự là của mình khi đã vào sổ):
   `select name from supabase_migrations.schema_migrations where name like 'migration\_v682\_%' or name like 'migration\_v683\_%'`.
   Lúc viết (08:53 VN 28/11) sổ tới V681, không nhánh / worktree nào ở akaAgent, akaAgentWebApp, akaAgentChatApi, SqlServerDashboard có V682.
2. `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema: apply ngoài giờ cao điểm. File tự kiểm md5 thân hàm, chủ, quyền,
   cấu hình trước và sau; chạy lại bị sổ chặn.
3. Sau khi apply: md5 `fb517d00…`; máy của nhân viên 1108 không còn `rpc/aka_agent_engine_claim_target_v1` trả 500;
   `auto_engine_target_runs` có lượt mới của 53573; `postgres_logs` không còn timeout có hàm này trong context.
4. Gỡ: [bản gỡ](../migrations/rollback_v682_delivery_cooldown_history_by_input.sql) (tự kiểm hàm đang là bản V682 trước khi trả về).

## Sau khi apply (28/11/2026)

- 08:59:48–08:59:50 VN, lúc DB nhẹ (1 tiến trình đang chạy, 0 chờ khoá). Thân hàm mới `fb517d00…`, chủ / quyền / cấu hình không đổi.
- PostgREST nạp lại schema trong 4,8 giây; 0 lỗi 5xx / 503. Khoảng 200 request chậm hơn 1 giây trong 30 giây sau đó
  (p50 lên 96 ms rồi về 42–55 ms); cùng mốc 08:00 VN chỉ 1–2 request chậm, nên phần lớn là do lần nạp lại.
- Lần hết giờ cuối của hàm là 01:59:20 UTC, trước apply 28 giây; sau đó không còn lần nào.
- 53573 nhận lại đúng data đã kẹt (14274941) lúc 09:00:20 VN; Tìm SĐT, nhắn tin, kết bạn, đổi tên đều thành công.

## Chưa làm

- Claim hết giờ ở bước chống gửi lặp vẫn không để lại ghi chú cho khách và vẫn gặp lại đúng data, vì ngân sách chỉ kiểm giữa hai data.
  V682 bỏ nguyên nhân làm một data mất vài giây, không đổi cơ chế đó.
- Data có SĐT trùng rất nhiều (hàng chục nghìn dòng data) vẫn tốn theo số dòng lịch sử của các data trùng.
