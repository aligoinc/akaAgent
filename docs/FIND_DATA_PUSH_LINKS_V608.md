# Đẩy data của chiến dịch tìm data qua DB — V608

Trạng thái (21/11/2026): code + migration ở nhánh `claude/kind-pasteur-a6nwxo`, **Desktop chưa build**. **V608 đã apply akachat
14:21:53 VN 21/11** theo yêu cầu ("appply v608"; sổ `20261121072153`, không apply lại, md5 sổ = file `45f944b9…`; PostgREST nạp lại
schema 5,2 s, 0 lỗi 5xx; 365 liên kết điền sẵn đúng như chạy thử; [biên nhận](../migrations/snapshots/find-data-push-v608/apply-receipt.json)).
Kiểm thử cục bộ đạt (xem cuối trang).

## Vì sao

Rà 21/11/2026 (chỉ đọc production) chiến dịch "Tìm data trong group" / "Tìm data bằng search":

- Đẩy sang **Nhóm data** đúng: 60 ngày 5.697 lượt, 0 lỗi; DB tự lọc thành viên đã có và data đã vào từng chiến dịch nhận.
- Đẩy thẳng sang **chiến dịch đích** (nhắn UID, comment bài, đăng nhóm, comment seeding nhóm, tham gia nhóm, Zalo nhắn SĐT,
  Zalo tham gia nhóm) do app tự thêm dòng:
  - đích đã xoá hoặc đích chạy bằng Nhóm data bị từ chối mà khách không được báo (365 liên kết: 153 trỏ chiến dịch đã xoá,
    17 trỏ chiến dịch chạy bằng Nhóm data; chiến dịch 34369 mất 8.042 group trong 30 ngày, tiến trình vẫn in "sẽ đẩy N mới");
  - lọc trùng chỉ theo lịch sử của chính chiến dịch nguồn (500 dòng gần nhất): hai chiến dịch nguồn đẩy cùng data vào một đích
    thì đích nhận trùng (30 ngày: "Tham gia group" 226 group / 334 dòng thừa);
  - ghi dòng "Tìm data" lỗi vẫn đẩy (engine dừng giữa lúc báo cũng đẩy);
  - quy tắc "đầu ra nào đi sang loại chiến dịch nào" viết cứng trong code; liên kết là mảng id trong `extra_settings`;
    không có sổ data nào đã đẩy từ A sang B.
- Lỗi lưu form `Failed to bind campaign data group source: campaign_creation_bundle_child_invalid` (khách 2481, 10.2.0,
  12:38 VN 21/11): chiến dịch tìm data chạy bằng Nhóm data (có gói tạo) mà chiến dịch đích tạo kèm cũng chạy bằng Nhóm data
  ⇒ app gửi mã gói của chiến dịch chính khi gắn Nhóm data cho chiến dịch đích; mỗi lần bấm lưu lại tạo thêm một bộ chiến dịch đích.

## DB — `migrations/migration_v608_find_data_push_links.sql`

Chỉ thêm đối tượng mới; không ALTER bảng có sẵn, không trigger trên bảng nóng.

| Đối tượng | Nội dung |
|---|---|
| `auto_campaign_data_link_rules` | 11 quy tắc: (loại chiến dịch nguồn, đầu ra, khoá bật `isFind*`, khoá chứa id đích, loại chiến dịch đích, loại dữ liệu ngữ nghĩa, cột ghi `uid`/`phone`, tên cho câu tiến trình). Đích phải nhận loại dữ liệu đó theo `auto_campaign_action_data_types` (`can_target`) |
| `auto_campaign_data_links` | Mỗi (chiến dịch nguồn, quy tắc, chiến dịch đích): `active` / `blocked` + lý do / `removed`, bộ đếm, lần đẩy cuối. Migration điền sẵn từ `extra_settings` (chạy thử chỉ đọc 21/11: 365 liên kết = 193 active, 153 `target_deleted`, 17 `target_data_group_mode`, 2 `target_action_mismatch`) |
| `auto_campaign_data_link_deliveries` | Sổ đẩy: mỗi (liên kết, khoá data) một dòng `inserted` (kèm id dòng đích, id dòng "Tìm data") hoặc `existing` |
| `aka_agent_find_data_push_v1(jsonb)` | Chỉ `aka_agent_desktop`, nhân viên lấy từ phiên. Payload `{sourceCampaignId, outputKind, items:[{value,key,name}], sourceDetailId?, sourceInputDataId?, allowedTargetActionIds?}` (≤ 5.000 data) |

Hàm đẩy, với mỗi đích trong cấu hình của chiến dịch nguồn:

1. Kiểm đích: còn, cùng nhân viên / tổ chức, chưa xoá, đúng loại chiến dịch, nhận loại dữ liệu, không chạy bằng Nhóm data,
   có trong `allowedTargetActionIds` (gói). Không đạt ⇒ liên kết `blocked` + lý do, không thêm gì.
2. Khoá theo đích (`pg_advisory_xact_lock`), lọc data đã có: sổ đẩy của đích (mọi nguồn, theo khoá chuẩn hoá do app gửi) hoặc
   dòng data đang có cùng giá trị (`md5(lower(btrim(uid)))` / `md5(normalize_phone(phone))`, dùng chỉ mục có sẵn).
3. Thêm dòng "chờ xử lý", ghi chú `Đã thêm từ chiến dịch "<nguồn>"` (như app cũ), ghi sổ, mở lại đích "hoàn thành".
4. Liên kết đã bỏ khỏi cấu hình ⇒ `removed`.

Gọi lại cùng data không thêm trùng (sổ + kiểm đích), nên app thử lại lỗi tạm thời an toàn. Đo cục bộ: 2.000 data vào đích có sẵn
20.000 dòng ~75 ms.

App cũ (chưa gọi hàm) vẫn tự thêm dòng; hàm mới thấy các dòng đó qua phần kiểm "đã có ở đích".

## App (Desktop)

- **Lưu form** (`CampaignFormModal.tsx`, `CampaignAgentFormModal.tsx`): chỉ chiến dịch thuộc gói của lần lưu gửi mã gói khi gắn
  Nhóm data (`campaignBundleId`); chiến dịch đích tạo kèm luôn "tạm dừng" tới khi lưu xong cả bộ; tạo dở thì xoá bản dở
  (`discardOnFailure`); lưu lại với cùng mã yêu cầu (luồng Nhóm data) dùng lại chiến dịch đích đã tạo (`linkedDraftCampaignIdsRef`).
- **Form chọn đích**: chiến dịch chạy bằng Nhóm data không hiện trong danh sách chọn đích (đã chọn từ trước thì vẫn hiện để gỡ);
  đích đã chọn mà không nhận được (đã xoá / chạy bằng Nhóm data) có dòng cảnh báo; chiến dịch đích tạo kèm không có lựa chọn
  "Chọn nhóm data để chạy" (kèm câu hướng dẫn); chọn Nhóm data mà nhóm có 0 data hợp lệ thì có câu nhắc (không chặn: nhóm có thể
  nhận data sau, ví dụ từ chiến dịch tìm data).
- **Bộ chạy** (`campaignScheduler.ts`, nhánh "Tìm data"): 5 loại đầu ra sang đích nội bộ đi qua `pushFoundDataToLinkedCampaigns`
  → `aka_agent_find_data_push_v1` (chia lượt 2.000, thử lại lỗi tạm thời 1 s / 3 s). Câu tiến trình:
  `✅ Đã đẩy N <loại> sang chiến dịch "<đích>" (bỏ qua M … đã có ở chiến dịch đó)`, `ℹ️ … đã có … nên không thêm lại`,
  `⚠️ Không đẩy được <loại> sang chiến dịch "<đích>": <lý do>.` (mỗi nguồn / đích / lý do tối đa mỗi giờ một lần).
  DB chưa có V608 (PGRST202, nhớ 10 phút) ⇒ cách đẩy cũ, nhưng đích không nhận được thì cũng in câu ⚠️ thay vì chỉ ghi console.
  Engine dừng giữa lúc báo (`FacebookEngineReportStop`) thì không đẩy (data chạy lại ở lượt sau); ghi dòng "Tìm data" lỗi vì lý
  do khác vẫn đẩy (DB lọc trùng nên không còn rủi ro trùng).
- Không đổi: đẩy sang Nhóm data (`pushFoundDataToDataGroups`), đẩy sang akaBiz ngoài (SMS / Zalo Web / akaBiz Desktop; đã ẩn
  khỏi form, 24 chiến dịch cũ vẫn đẩy), lọc theo lịch sử của chính nguồn trước khi gửi.

## Thứ tự đưa vào dùng

1. Apply V608 (DDL ⇒ PostgREST nạp lại schema; chọn giờ thấp điểm). Bản Desktop đang dùng không gọi hàm nên không đổi gì. **Đã làm 14:21 VN 21/11.**
2. Build + phát hành Desktop. Bản mới chạy được cả khi V608 chưa apply (dùng cách cũ, có câu ⚠️).

Theo dõi sau khi bật:

```sql
-- liên kết đang bị chặn theo lý do
select block_reason, count(*) from public.auto_campaign_data_links where status = 'blocked' group by 1;
-- data đã đẩy 24 giờ theo kết quả
select result, count(*) from public.auto_campaign_data_link_deliveries where created_at > now() - interval '24 hours' group by 1;
```

## Gỡ

`migrations/rollback_v608_find_data_push_links.sql` (xoá hàm, 2 hàm phụ, 3 bảng; dòng data đã thêm giữ nguyên). Desktop bản mới
tự quay về cách cũ. Dòng sổ migration giữ lại nên V608 không chạy lại được nếu chưa xoá dòng sổ.

## Kiểm thử

- `scripts/find-data-push/test_v608.sh` (PG16 cục bộ, fixture theo định nghĩa production 21/11): 42 ca SQL + hai nguồn đẩy cùng
  lúc (bỏ khoá theo đích thì ca này hỏng: 2 dòng) + gỡ + chặn chạy lại theo sổ.
- `node scripts/find-data-push/app-smoke.cjs`: hàm thật của bộ lập lịch gọi hàm DB thật V608 (11 nhóm: câu tiến trình, thử lại,
  chia lượt, gói, cách cũ khi chưa có V608, kiểm mã nguồn form và nhánh "Tìm data").
- `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `electron-vite build`: sạch.
- Chưa: chạy form trên Electron thật, gọi hàm bằng phiên Desktop thật (hàm đã có trên DB thật từ 21/11 14:21 VN).

## Ca của khách 2481 (21/11)

Chiến dịch 60313 (tìm data, chạy bằng nhóm "BĐS Hà Nội" chỉ có 532 người dùng Facebook ⇒ "Chờ data phù hợp"); 60316 (nhắn UID,
đã liên kết); bản thừa 60314 (nhắn UID, không liên kết), 60315 / 60317 (comment seeding, chạy bằng Nhóm data nhưng không gắn
nhóm, ghi chú lỗi). Chưa dọn: chờ anh duyệt.
