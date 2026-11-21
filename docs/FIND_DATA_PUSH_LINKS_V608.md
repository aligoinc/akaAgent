# Đẩy data của chiến dịch tìm data qua DB — V608

Trạng thái (21/11/2026): code + migration ở nhánh `claude/kind-pasteur-a6nwxo`, **Desktop chưa build, V610 chưa apply**. **V608 đã apply akachat
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

## V610 — nhận ra cùng một data dù viết khác (`migrations/migration_v610_find_data_push_match_key.sql`, đã apply akachat 15:39:34 VN 21/11/2026, sổ `20261121083934`, không apply lại; [biên nhận](../migrations/snapshots/find-data-push-v610/apply-receipt.json))

Đổi số 21/11/2026 ~16:00 VN: bản này viết với số V609, nhưng sổ migration production đã có `migration_v609_campaign_result_groups` (apply 15:16:54 VN 21/11 bằng SQL Editor, phiên khác; nhóm kết quả chiến dịch + sự kiện đến muộn của Quy trình). Bản đó không đụng hàm đẩy, sổ đẩy hay bảng liên kết; chỉ đọc `auto_campaign_input_data` và thêm trigger trên `auto_campaign_details` / `auto_campaign_detail_zalo_engagement` (hàm đẩy không ghi hai bảng này). Chỉ đổi số, SQL sinh lại giống hệt bản cũ trừ con số.

Tìm ra khi kiểm thử 21/11 (lô "cách viết khác"): V608 so data gửi lên với data đang có ở đích bằng nguyên chuỗi, nên đích có data viết
khác thì thêm trùng. Thử trên DB thật trong giao dịch huỷ (đích 4168, 5 link bài thật viết kiểu m.facebook.com + tham số theo dõi):
V608 thêm 6 dòng (5 trùng), V610 thêm 1 (đúng), gọi lại thêm 0.

- `private.aka_agent_find_data_match_key(kind, value)`: khoá so sánh theo loại đầu ra (group = mã sau `/groups/`; link bài = bỏ giao thức,
  m./web. → www., bỏ "/" cuối, bỏ tham số `__*` / `mibextid` / `ref` / `locale` / `comment_id`; link Zalo = bỏ giao thức / www. / "/";
  UID = bỏ "/" cuối; SĐT = `normalize_phone`), không phân biệt hoa thường. Khoá của sổ đẩy và bỏ trùng trong lượt dùng khoá này (không
  dùng khoá app gửi).
- `private.aka_agent_find_data_coarse_key`: khoá thô SQL thuần để lọc dòng của đích trước khi tính khoá đầy đủ (cùng khoá đầy đủ ⇒ cùng
  khoá thô). Đích 60.000 dòng, 2.000 data: 0,36 s (group) / 0,47 s (link bài); không lọc thô: 4,8 s / 6,3 s (`scripts/find-data-push/perf_v610.sh`).
- Chỉ thay thân hàm đẩy (kiểm `md5(prosrc)` V608 `d04c4711…`), không đổi bảng / quyền / khuôn trả về; sổ đẩy production 0 dòng nên đổi
  nghĩa khoá không cần chuyển dữ liệu. Sinh bằng `python3 scripts/find-data-push/build-v610-sql.py`; gỡ: `rollback_v610_…` (về đúng thân V608).

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
- **Nhóm data gửi lại khi lỗi mạng** (`retryFindDataTransient`, 1 s / 3 s / 9 s, cùng mã yêu cầu nên DB trả lại lô đã ghi): đối chiếu
  production 30 ngày 2.216/2.223 lượt nạp khớp đúng nhóm, đúng số; 7 lượt lệch đều do `fetch failed` mà không có lần gửi lại nào
  (app báo khách "thử lại để thêm tiếp", phần còn lại không bao giờ vào nhóm vì lượt sau coi data đó đã thấy).
- **Nháp cũ có đích tạo kèm chạy bằng Nhóm data**: lưu thành nhập data trực tiếp (đích chạy bằng Nhóm data không nhận data tìm được).
- Không đổi: cách đẩy sang Nhóm data (`pushFoundDataToDataGroups`), đẩy sang akaBiz ngoài (SMS / Zalo Web / akaBiz Desktop; đã ẩn
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

## Kiểm thử bằng dữ liệu thật (21/11/2026)

Theo yêu cầu ("kiểm thử theo lô… đến khi không còn nhầm lẫn"). Dữ liệu xuất chỉ đọc (không commit): 31 chiến dịch tìm data có đích nội bộ,
35 đích + 13.862 dòng data đích, 1.128 lượt "Tìm data" thành công (từ 20/10).

| Lô | Cách kiểm | Kết quả |
|---|---|---|
| 1–2 phát lại | `node scripts/find-data-push/replay-realdata.cjs <dữ liệu>`: dòng "Tìm data" thật → `logMilestonesV2` thật (nạp nguyên lớp bằng `load-scheduler.cjs`) → hàm DB thật; bộ kiểm độc lập tính kết quả đúng theo data đang có ở đích sau mỗi lượt; đích đã xoá chỉ tính từ lúc sửa cuối | 1.128 lượt, 1.381 lượt đẩy, 0 vấn đề (dòng "Tìm data" khớp data thật, câu ✅ / ⚠️ đúng số, đích "hoàn thành" mở lại). Số dòng mỗi đích bằng app cũ trừ dòng trùng app cũ đã thêm (54699: 334, 51047 / 51048: 72); đích 41716 app cũ hụt 336 group (một lượt đẩy lỗi im lặng), mã mới đủ |
| 3 cách viết khác | `--variants`: data thật của đích viết kiểu khác, đẩy qua bộ dựng data + `pushFoundDataToLinkedCampaigns` | V608: group / UID / link bài / link Zalo thêm trùng (SĐT đúng) → **V610**; với V610 15/15 ca đúng |
| 4 trạng thái | `--states`: 5 lý do chặn (câu ⚠️ đúng, đích người khác không lộ tên), cảnh báo mỗi giờ một lần, engine dừng giữa lúc báo (không đẩy), engine ghi dòng (sổ có id dòng), lượt lỗi, ghi dòng lỗi vì lý do khác, Nhóm data lỗi mạng / lỗi cố định, hai nguồn cùng lúc (hai kết nối DB) | 24/24 |
| 5 Nhóm data production | đối chiếu chỉ đọc từng dòng "Tìm data" (94 nguồn, 30 ngày) với `auto_data_ingest_batches` | 2.216/2.223 khớp; 7 lệch do lỗi mạng → thêm gửi lại |
| 6 form thật | `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/find-data-push/run-form-bundle-ui-smoke.cjs` (Electron, IPC giả theo luật DB: mã gói, gói / chiến dịch theo mã yêu cầu); `--form <bản cũ>` chạy bản trước sửa | 10/10; bản cũ hiện đúng lỗi của khách 2481 |
| 7 DB thật | `build-prod-dryrun-sql.py` → khối DO kết thúc bằng RAISE (huỷ hết), phiên Desktop thật của nhân viên chủ chiến dịch | V608 thêm 5 trùng, V610 đúng; sau đó DB không đổi (đích 2.454 dòng, sổ 0, hàm V608) |

Chạy lại: `PG_MODULE=<node_modules/pg> node scripts/find-data-push/replay-realdata.cjs <dữ liệu> --variants --states --migrations migration_v610_find_data_push_match_key.sql`.

## Kiểm thử

- `scripts/find-data-push/test_v608.sh` (PG16 cục bộ, fixture theo định nghĩa production 21/11): 42 ca SQL chạy trên V608 + V610
  (`WITH_V610=0` để chỉ V608) + hai nguồn đẩy cùng lúc (bỏ khoá theo đích thì ca này hỏng: 2 dòng) + gỡ V610 về V608 + gỡ V608 + chặn chạy
  lại theo sổ (44 PASS).
- `node scripts/find-data-push/app-smoke.cjs`: hàm thật của bộ lập lịch gọi hàm DB thật V608 (11 nhóm: câu tiến trình, thử lại,
  chia lượt, gói, cách cũ khi chưa có V608, kiểm mã nguồn form và nhánh "Tìm data").
- `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `electron-vite build`: sạch.
- Chưa: chạy trong app Desktop thật với Facebook thật (bản Desktop chưa build).

## Ca của khách 2481 (21/11)

Chiến dịch 60313 (tìm data, chạy bằng nhóm "BĐS Hà Nội" chỉ có 532 người dùng Facebook ⇒ "Chờ data phù hợp"); 60316 (nhắn UID,
đã liên kết); bản thừa 60314 (nhắn UID, không liên kết), 60315 / 60317 (comment seeding, chạy bằng Nhóm data nhưng không gắn
nhóm, ghi chú lỗi). Chưa dọn: chờ anh duyệt.
