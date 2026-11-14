# V532: lỗi ở bước phụ không tạm dừng chiến dịch ngay; câu nhận data không quét khoá chính

Hai lỗi của engine v2, tìm ra khi kiểm sức khoẻ lúc 13:35 VN ngày 14/11/2026. Anh chốt "Sửa cả hai".
Migration [V532](../migrations/migration_v532_engine_aux_step_pause_claim_order.sql) được sinh bằng `node scripts/build-v532-sql.cjs`, không sửa tay. Bản gỡ là [rollback](../migrations/rollback_v532_engine_aux_step_pause_claim_order.sql).
Trạng thái: **đã apply akachat 14/11/2026 20:01:44–47 VN** (`20261114130144 / migration_v532_engine_aux_step_pause_claim_order`; không apply lại; md5 sổ = file `e89902cd…`; [biên nhận](../migrations/snapshots/engine-aux-step-pause-claim-order-v532/apply-receipt.json)).

Kết quả sau apply:
- PostgREST nạp lại schema mất 5,1 giây. Trong phút apply, p99 lên 295 ms và có 63 request quá 1 giây; không phát sinh lỗi 5xx mới.
- Từ 20:02 không còn lượt claim nào của Desktop lỗi 500 (trước đó 2 lượt / phút); p99 của claim còn 105–174 ms.
- Chiến dịch 34061 chạy lại được ngay.
- Lúc 20:02:05 đã cho 49746 và 50194 chạy lại.

## 1. Lỗi ở bước phụ tạm dừng chiến dịch ngay

**Lỗi.**

- Chính sách NET01 (`err_network_offline`) anh đã duyệt: lỗi mạng thì khoá thao tác của tài khoản 5 phút. Chỉ khi 4 data liền gặp lỗi thì mới tạm dừng chiến dịch.
- Bước phụ (gắn tag, đổi tên Zalo) không bao giờ cộng vào chuỗi lỗi, vì dòng chính sách theo thao tác đặt `target_streak_effect = ignore`.
- Nhưng `aka_agent_engine_report_v1` (thân V517) áp hiệu ứng chiến dịch ngay khi kết quả không cộng chuỗi, kể cả khi mã đó có ngưỡng.
- Hệ quả: chỉ một lỗi NET01 ở bước phụ là chiến dịch bị tạm dừng.

**Gặp thật ngày 14/11.** Trạng thái đọc lúc khoảng 15:30 VN.

| Chiến dịch | Nơi chạy | Giờ | Bước | Lỗi | Trạng thái lúc kiểm |
|---|---|---|---|---|---|
| 49746 | Fly | 10:15 | đổi tên | runtime mất kết nối giữa lệnh | vẫn tạm dừng |
| 50194 | Fly | 11:32 | gắn tag | runtime mất kết nối giữa lệnh | vẫn tạm dừng |
| 55619 | Desktop | 12:03 | đổi tên | "Failed to get account: fetch failed" | khách đã tự chạy lại |
| 55806 | Desktop | 13:58 | đổi tên | NET01 | khách đã tự chạy lại |

**Sửa.**

- Hiệu ứng chiến dịch có ngưỡng chỉ được áp qua nhánh ngưỡng: kết quả phải cộng chuỗi, và chuỗi đủ ngưỡng ở cuối data. Kết quả không cộng chuỗi thì không áp.
- Hiệu ứng không có ngưỡng vẫn áp ngay như cũ (Z223, Z224, thiếu media, cấu hình sai…).
- Khoá thao tác, dừng lượt (`end_unit`), data đi đâu của mã không đổi.
- Đây chính là nguyên tắc V501 đã viết cho trường hợp giao một phần.
- Cùng điều kiện được sửa ở hai chỗ trong `report_v1`: chỗ áp hiệu ứng ngay, và hạng dừng lượt.

**Phạm vi đổi hành vi.**

Đã dò mọi cặp (mã có ngưỡng × thao tác Zalo có dòng chính sách) bằng `aka_agent_engine_resolve_policy` trên production ngày 14/11: 20 mã × 11 thao tác × 3 pha × 2 nơi chạy.

- Chỉ hai thao tác phụ `zalo_tag_contact` và `zalo_change_alias` đổi hành vi, với 7 mã:
  - `err_network_offline` (NET01)
  - `err_engine_runtime_unavailable` (NET03)
  - `err_undefined`
  - `err_engine_zalo_cancel_friend_day_limit`
  - `err_engine_zalo_join_group_day_limit`
  - `err_email_send_failed`
  - `err_email_missing_recipient`
- Không cặp nào khác bị ảnh hưởng: mọi dòng chính sách có ngưỡng (43 dòng) đều đi cùng `target_streak_effect = increment`.
- Lịch sử `auto_engine_outcomes` tính tới 14/11: chỉ có 4 kết quả đi đường "áp ngay có ngưỡng", đều là NET01 ở gắn tag / đổi tên.

## 2. Câu nhận data quét khoá chính, Desktop chạm trần 3 giây

**Lỗi.**

- Câu chọn data trong `aka_agent_engine_claim_target_v1` (thân V527) là `... WHERE d.campaign_id = v_campaign_id AND d.status = 'chờ xử lý' ... ORDER BY d.id LIMIT 1 FOR UPDATE SKIP LOCKED`.
- Với kế hoạch theo tham số, planner coi data chờ của chiến dịch rải đều theo id. Vì vậy nó chọn quét `auto_campaign_input_data_pkey` từ id nhỏ nhất rồi lọc theo chiến dịch.
- Data của chiến dịch thường nằm ở cuối bảng, nên lần quét này rất dài.

**Số đo chỉ đọc ngày 14/11** (chiến dịch 34061):

| Câu | Kế hoạch theo tham số | Kế hoạch chung |
|---|---|---|
| Cũ | 6,8 giây (lọc 12,26 triệu dòng, 3,9 triệu buffer) | 8 ms |

- Desktop có trần 3 giây (`aka_agent_desktop`), nên lệnh nhận data lỗi 500.
- Từ 08:00 đến 13:45 có 256 trên 10.057 lượt claim của Desktop lỗi.
- Gần hết đến từ 2 máy: nhân viên 1703 (179 lỗi / 286 lượt) và một máy dùng chung của nhân viên 1307 / 1292 (69 lỗi).
- Chiến dịch 34061 còn 4.016 data chờ mà cả ngày chưa chạy được lượt nào.

**Sửa.**

- Đổi thành `ORDER BY d.id + 0`. Thứ tự giữ nguyên, nhưng planner không còn dùng khoá chính để sắp được.
- Planner buộc phải lấy data của chiến dịch qua chỉ mục theo chiến dịch (`idx_sms_input_data_campaign_status_schedule`) rồi mới sắp. Đó cũng là đường kế hoạch chung vẫn chạy.

**Số đo câu mới, chỉ đọc ngày 14/11:**

| Chiến dịch | Data chờ | Kế hoạch theo tham số | Kế hoạch chung |
|---|---|---|---|
| 34061 | 4.016 | 40 ms | – |
| 32684 (nhiều data chờ nhất) | 14.966 | 48 ms | 28 ms |
| 50107 | 4.513 | 8,7 ms | – |

Trong 930 chiến dịch Zalo đang chờ / đang chạy của các tổ chức bật cờ: nhiều nhất 14.966 data chờ, p99 là 7.124.

## Không đổi

- Bảng, dữ liệu, chính sách, thiết lập, quyền.
- Chủ sở hữu, SECURITY DEFINER, `search_path` của hai hàm.
- Bộ chạy cũ: không gọi hai hàm này.
- Chiến dịch đã bị tạm dừng trước V532: giữ nguyên trạng thái. Cho chạy lại là việc riêng, ghi lên production, cần anh duyệt.

## Kiểm thử

- `node scripts/campaign-outcome-engine-v532-smoke.cjs`, 7 nhóm, chạy trên PG17 với chuỗi V495 → … → V517 → V527 như production:
  1. Hai hàm trên cụm thử đúng md5 production.
  2. Trước V532 tái hiện cả hai lỗi:
     - NET01 hoặc lỗi code ở gắn tag / đổi tên tạm dừng chiến dịch ngay;
     - kế hoạch theo tham số quét khoá chính khi data của chiến dịch nằm cuối bảng.
  3. Preflight dừng khi: sổ đã có V532; thân lạ ở từng hàm; định nghĩa lạ; quyền rộng (hậu kiểm). Apply thử rồi ROLLBACK không đổi gì. Apply qua file bọc sổ migration được; chạy lại bị chặn.
  4. Sau V532:
     - bước phụ lỗi có ngưỡng không tạm dừng (Fly, Desktop, mọi pha), vẫn khoá thao tác, dừng lượt, không cộng chuỗi;
     - Z223 vẫn tạm dừng ngay;
     - lỗi code ở bước chính vẫn tạm dừng đúng ở data thứ 4.
  5. Câu mới không quét khoá chính, theo cả kế hoạch theo tham số lẫn kế hoạch chung. Vẫn lấy data đến hạn có id nhỏ nhất, bỏ data hẹn sau và data đang bị phiên khác khoá.
  6. Gỡ trả lại hai thân cũ. Gỡ lần hai bị chặn. Apply lại được sau khi bỏ dòng sổ.
- `node scripts/campaign-outcome-engine-check-all.cjs`: cả bộ kiểm engine, đã thêm V532. Ngày 14/11: 30 mục đều đạt, 107 giây.
- `node scripts/engine-v2-scenarios/run.cjs --rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01`: bộ kịch bản đã có V532 trong chuỗi. Đặt `SCENARIO_SKIP_MIGRATIONS=532` để so trước / sau. Ngày 14/11:

  | | Lượt data | Lần gửi | Lượt dừng vì chiến dịch tạm dừng | Báo kết quả trả `stop_campaign` |
  |---|---|---|---|---|
  | Trước V532 | 702 | 5.194 | 19 | 27 |
  | Có V532 | 708 | 5.250 | 11 | 19 |

  Cả hai lần: 0 vi phạm mới, 0 kịch bản sự cố lỗi. Phần giảm ở hai cột cuối là các lần lỗi tiêm ở bước phụ không còn tạm dừng chiến dịch.

## Apply production (khi anh bảo "làm")

1. Kiểm lại sổ migration: chưa có `migration_v532_%`.
2. Kiểm md5 bản live:
   - `report_v1`: prosrc `21afaaf3…`, định nghĩa `12b0bc8e…`;
   - `claim_target_v1`: prosrc `f8935a5a…`, định nghĩa `43e14ce4…`.
   Preflight cũng tự kiểm hai mục này.
3. Apply ngoài giờ cao điểm, vì `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema (V529 lúc 08:55 mất 7,1 giây).
   Dùng file bọc sổ: `node scripts/make-migration-ledger-apply.cjs migrations/migration_v532_engine_aux_step_pause_claim_order.sql migration_v532_engine_aux_step_pause_claim_order <file ra>` rồi `supabase db query --linked -f <file ra>`.
4. Hậu kiểm:
   - md5 sổ = md5 file;
   - md5 hai thân mới: `report_v1` `5d9ffe21…`, `claim_target_v1` `d7c5aa16…`;
   - quyền giữ nguyên;
   - `postgrest_logs` (thời gian nạp lại schema), `edge_logs` (5xx);
   - lỗi 500 của `rpc/aka_agent_engine_claim_target_v1` phải về gần 0.
5. Nếu anh duyệt, cho chạy lại các chiến dịch còn bị tạm dừng oan. Lúc khoảng 15:30 VN 14/11 còn 49746 và 50194; hai chiến dịch Desktop khách đã tự chạy lại.
   - Lấy danh sách bằng `auto_engine_outcomes`: `decision->'contrib'` có `campaignEffect` khác `none`, `streakThreshold` có giá trị, `streak` khác `increment`.
   - Đưa về `chờ xử lý`, `note = NULL`, như nút "Tiếp tục".
   - Chỉ làm khi chiến dịch không còn token, không còn lease và không còn data "đang chạy".

## Gỡ

`rollback_v532_engine_aux_step_pause_claim_order.sql` trả `report_v1` về thân V517 và `claim_target_v1` về thân V527. Preflight của bản gỡ đòi hai thân V532. Bản gỡ cũng làm PostgREST nạp lại schema.
