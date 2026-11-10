# Tải đủ dữ liệu nhóm Facebook ở tab "Data tìm được" (Tìm kiếm data bằng search)

## Trạng thái — 10/11/2026

- **Đã làm ở source Desktop** (nhánh `claude/festive-cannon-vpy9rt`): file Excel 14 cột; bảng trong tab có thêm cột
  nhóm (thành viên, bài/ngày, riêng tư, tham gia, bài chưa đọc, tham gia từ, bạn bè trong nhóm), cột Link Facebook/Nguồn
  cho SĐT/UID và cột Tài khoản (mục 3b). Khi mở tab (và lúc Xuất nếu chưa đọc), app đọc lại chữ gốc của thẻ nhóm trong
  log chạy để điền dữ liệu mà kết quả chạy chưa lưu. **Chưa build bộ cài, chưa phát hành.** Không đổi DB, block hay
  workflow.
- **Chưa làm (việc riêng theo yêu cầu):** sửa block `fb_collect_search_groups` (2723) và
  `fb_find_search_data_summary` (2724) để lưu sẵn các trường ở mục 4 khi chạy. Bộ chạy chiến dịch và bản xuất đã nhận
  sẵn các trường đó (mục 4), nên việc sửa block chỉ cần một migration đổi dữ liệu `auto_blocks`.

Số liệu đo chỉ đọc trên akachat (`cgjbsmqtfhqvttudyjzq`) ngày 10/11/2026.

## 1. Yêu cầu

File tải từ tab **Data tìm được → Xuất Excel** của chiến dịch **Facebook - Tìm kiếm data bằng search**
(`facebook_find_data_search`) phải có đủ dữ liệu nhóm: ít nhất các cột của file mẫu (`Tên, UID, Số thành viên, Số bài,
Đơn vị bài, Privacy`) và mọi thông tin khác Facebook có hiện. Đây là tính năng tải dữ liệu: không thêm cột phân loại
AI, không đổi điều kiện lọc. Yêu cầu sau (10/11): bảng trong tab cũng hiện đủ các thông tin đó (mục 3b).

## 2. Vì sao file trước đây thiếu dữ liệu

Block `fb_collect_search_groups` ghi nguyên văn chữ của mỗi thẻ nhóm vào `auto_campaign_run_events.debug_data.rawText`
(event `extract_facebook_group_data`, có từ 05/06/2026, chưa có job dọn), ví dụ:

- `… Công khai · 16K thành viên · 20+ bài viết/ngày 5 người bạn là thành viên Tham gia`
- `… Công khai · 1,6K thành viên · 25 bài viết chưa đọc · Là thành viên từ tháng 2 năm 2026 2 người bạn là thành viên Truy cập`
- `… Public · 7.5K members · 90+ posts a day 1 friend is a member Join`

Đo 154.529 thẻ trong 30 ngày: block chỉ khớp `bài viết/ngày`/`posts/day`, nên **thẻ giao diện tiếng Anh (`posts a day`,
6,7%) luôn có số bài 0** và tên dính `Profile photo of …` (tên lấy từ link ảnh đại diện). Dấu `+` (74% số bài có hiện),
số bạn bè trong nhóm (~31%), trạng thái tham gia (100%), tham gia từ, bài chưa đọc có trên thẻ nhưng không được lưu.
Không thẻ nào ghi số bài theo tuần/tháng, nên `Đơn vị bài` chỉ là `ngày`. Số bài trống ở nhóm Facebook không hiện số bài
(nhóm ít hoạt động, hoặc tài khoản đã tham gia: Facebook hiện "bài viết chưa đọc" thay cho số bài/ngày) là đúng.

## 3. File Excel

Sáu cột đầu giữ đúng tên và thứ tự của mẫu cũ; tám cột sau là dữ liệu thêm.

| Cột | Tên cột | Nguồn | Quy tắc |
| --- | --- | --- | --- |
| A | Tên | tên đã lưu, bỏ tiền tố `Profile photo of`/`Ảnh đại diện của`; trống thì lấy từ thẻ | chuỗi |
| B | UID | URL nhóm | chuỗi |
| C | Số thành viên | thẻ, thiếu thì số đã lưu | số; Facebook làm tròn (16K → 16000) |
| D | Số bài | thẻ, thiếu thì số đã lưu (> 0) | số; `90+` ghi 90; Facebook không hiện → trống |
| E | Đơn vị bài | `ngày` khi D có số | |
| F | Privacy | thẻ, thiếu thì số đã lưu | Công khai/Riêng tư |
| G | Số bài Facebook hiển thị | nguyên văn số bài trên thẻ | `90+`, `7`; chỉ ghi khi khớp D |
| H | Bài chưa đọc | thẻ | chỉ nhóm đã tham gia |
| I | Trạng thái tham gia | nút cuối thẻ | Đã tham gia / Chưa tham gia / Đã gửi yêu cầu, theo tài khoản đã tìm |
| J | Tham gia từ | thẻ | `MM/YYYY`, `YYYY` hoặc `Mới tham gia` |
| K | Bạn bè trong nhóm | thẻ | Facebook không hiện khi bằng 0 → trống |
| L | Từ khóa | từ khóa của các lượt tìm ra nhóm | `a, b` theo thứ tự tìm ra |
| M | Tài khoản tìm | tài khoản của các lượt tìm ra nhóm | gộp |
| N | Thời gian tìm | lượt sớm nhất tìm ra nhóm | `toLocaleString('vi-VN')` như các file khác |

- Thẻ: mỗi trường lấy theo thẻ mới nhất có giá trị của nhóm trong log chiến dịch; số bài và nguyên văn số bài đi theo
  cặp. Nhóm có kết quả chạy đã lưu đủ trường thêm (`cardVersion` ≥ 2) thì giữ nguyên, không trộn thẻ khác thời điểm.
- Gộp nhóm trùng giữa các lượt như trước: khoá URL, dòng đến trước (lượt mới hơn) thắng số liệu, dòng sau chỉ điền chỗ
  trống. Không có giá trị thì để trống, không ghi 0 hay "Chưa tham gia" giả.
- Sheet như cũ: chỉ chọn Link group Facebook → `Sheet1`; chọn lẫn loại khác → nhóm ở sheet `Group Facebook`, loại khác
  giữ mẫu 9 cột. Chiến dịch "Tìm data trong group" không đổi.

## 3b. Bảng trong tab

Cột hiện theo loại data có trong tab (không có loại đó thì không có cột):

| Cột | Khi nào có | Giá trị |
| --- | --- | --- |
| Loại data, Giá trị, Tên | luôn | như cũ; tên nhóm sạch tiền tố, trống thì lấy từ thẻ |
| Thành viên, Bài/ngày, Riêng tư, Tham gia, Bài chưa đọc, Tham gia từ, Bạn bè trong nhóm | có Link group Facebook | cùng quy tắc với cột C–K của file Excel ([`describeFacebookGroup`](../src/renderer/src/components/CampaignPanels/foundDataExport.ts)); Bài/ngày hiện nguyên văn (`90+`) khi khớp số bài; số định dạng `vi-VN` |
| Link Facebook, Nguồn | có SĐT/UID mang link hoặc nơi tìm (`phoneProfiles`/`uidProfiles`/`groupMembers`) | link trang người đăng/bình luận/thành viên; Nguồn: Bài post, Comment, Tương tác mới, Thành viên group (mã khác để trống) |
| Tài khoản | luôn | tài khoản của lượt tìm ra |
| Từ khóa (chiến dịch search) / Group (tìm trong group) | luôn | như cột Group cũ |
| Thời gian | luôn | như cũ |

- Mỗi lượt tìm ra là một dòng như cũ (file Excel mới gộp nhóm trùng). Ô không có giá trị hiện `-` mờ; ô không áp dụng
  cho loại data đó để trống.
- Thanh chọn loại + nút Xuất đứng yên, bảng tự cuộn hai chiều, tiêu đề dính. Bảng rộng hơn khung (cửa sổ ~1.440 px khi
  có cột nhóm) thì cuộn ngang.

## 4. Thiết kế

- [facebookSearchGroupCard.ts](../src/shared/facebookSearchGroupCard.ts): bộ đọc thẻ tiếng Việt/tiếng Anh thuần TS
  (dùng ở main, renderer, sau này chép sang WebApp), làm sạch tên, khoá URL nhóm (`facebook.com/groups/<id|slug>`),
  gộp nhiều thẻ của một nhóm, và `readFacebookSearchGroupCardFields` đọc trường thêm từ payload không tin cậy. Mẫu chữ
  không nhận ra thì để trống, không đoán.
- [foundFacebookGroupCardService.ts](../src/main/services/foundFacebookGroupCardService.ts) qua IPC
  `campaign:found-facebook-group-cards` ([hợp đồng](../src/shared/foundFacebookGroupCardsIpc.ts)), trả
  `{ok,data}|{ok:false,code,message}`: kiểm chiến dịch thuộc nhân viên và đúng loại tìm bằng search, rồi đọc
  `auto_campaign_run_events` (event `extract_facebook_group_data`, `status = 'success'`, chỉ 4 cột) bằng
  [`listFacebookSearchGroupCardEventPage`](../src/main/data/repositories/campaignRunEventRepository.ts): mới → cũ,
  1.000 dòng/trang, keyset `created_at <= X AND (created_at < X OR id < Y)`. Một lượt chạy ghi cả loạt thẻ trong một
  lệnh nên nhiều dòng trùng hệt `created_at` (522 dòng ở chiến dịch 19119); điều kiện `<=` đứng riêng để Postgres đưa
  vào Index Cond (EXPLAIN production: nhảy thẳng tới con trỏ, ~150 ms/trang khi nguội), viết chỉ bằng OR thì mỗi
  trang quét lại mọi dòng mới hơn. Trần 60.000 dòng (lớn nhất hiện có 19.329 thẻ), hạn cả lượt 65 s; quá thì trả phần
  mới nhất đã đọc kèm `truncated`. Gộp lượt bấm trùng, không cache, không hẹn giờ.
- [foundDataExport.ts](../src/renderer/src/components/CampaignPanels/foundDataExport.ts) +
  [useFoundFacebookGroupCards](../src/renderer/src/components/CampaignPanels/useFoundFacebookGroupCards.ts) +
  [CampaignPanel](../src/renderer/src/components/CampaignPanels/CampaignPanel.tsx): chỉ gọi IPC khi chiến dịch tìm bằng
  search có nhóm chưa lưu đủ trường thêm. Đọc một lần khi mở tab (sau khi nạp xong kết quả chạy của đúng chiến dịch),
  nút Xuất dùng lại kết quả đó nếu đọc trong 2 phút hoặc đã đủ mọi nhóm, không thì đọc lại; đang đọc thì lượt sau chờ
  cùng lượt. Mở lại tab sau 2 phút mà còn nhóm thiếu thẻ thì đọc lại. Không hẹn giờ; lỗi không tự đọc lại, chỉ đọc lại
  khi mở lại tab, bấm "Thử lại" hoặc bấm Xuất. Giữ kết quả 6 chiến dịch gần nhất trong RAM của cửa sổ. Trong lúc đọc,
  dưới thanh xuất hiện "Đang đọc thêm số liệu nhóm…", nút Xuất (nếu bấm) hiện "Đang xuất..." và bị khoá. Không đọc được
  log (lỗi, hết giờ, IPC hỏng) thì bảng/file vẫn có phần đã lưu, báo "Chưa đọc được log chạy…"; đọc chưa hết báo log
  quá dài.
- **Hợp đồng cho việc sửa block:** mỗi phần tử `facebookGroups` có thể mang thêm `postsText` (`90+`), `unreadPosts`,
  `friendMemberCount`, `joinState` (`joined`/`not_joined`/`requested`), `memberSince` (`MM/YYYY`/`YYYY`/`Mới tham gia`)
  và `cardVersion: 2`; `postsPerDay` giữ nghĩa cũ (số bài/ngày khi Facebook hiện, còn lại 0). Block tổng kết 2724
  (`uniqueGroups`) hiện dựng lại object chỉ với 6 trường, phải cho các trường trên đi qua. `normalizeFoundFacebookGroup`
  trong [campaignScheduler.ts](../src/main/services/campaignScheduler.ts) đã giữ các trường hợp lệ. Nên sinh code
  block từ `facebookSearchGroupCard.ts` để không có hai bộ đọc lệch nhau.

## 5. Kiểm chứng (10/11/2026, container cloud)

| Lệnh | Kết quả |
| --- | --- |
| `node scripts/facebook-search-groups/card-parser-smoke.cjs` | PASS: 385 thẻ thật đủ dạng ([mẫu đã thay tên](../scripts/facebook-search-groups/card-samples.json)), ca biên, làm sạch tên, khoá URL, gộp thẻ, trường thêm |
| `node scripts/facebook-search-groups/card-service-smoke.cjs` | PASS: supabase-js thật + fetch giả: URL lọc (ngoặc kép, mã hoá `+`), 3 trang qua nhóm dòng trùng giờ, trần 60.000, quá hạn giữa chừng/từ đầu, lỗi DB không lộ SQL, quyền, gộp lượt trùng |
| `node scripts/facebook-search-groups/export-logic-smoke.cjs` | PASS: trộn thẻ, gộp nhóm trùng, thứ tự từ khóa, số bài/nguyên văn không lệch |
| `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-found-data-export-ui-smoke.cjs` | PASS: CampaignPanel thật trong Electron, đọc lại bytes `.xlsx`: 14 cột, số là số, khoá nút khi đang xuất, log lỗi vẫn xuất, mẫu cũ của loại khác/chiến dịch tìm trong group giữ nguyên; bảng: cột nhóm trước/sau khi đọc thẻ, đã lưu đủ không trộn thẻ, lỗi thì báo + Thử lại và không tự đọc lại, mở lại tab/xuất thì đọc lại, xuất lại không đọc log thêm, cột Link Facebook/Nguồn ở chiến dịch tìm trong group |
| `run-campaign-data-sort-ui-smoke.cjs`, `run-campaign-account-actions-ui-smoke.cjs` | PASS khi thay bước chụp ảnh bằng no-op (chụp ảnh cửa sổ ẩn treo trong container, cả mã gốc) |
| `node scripts/facebook-group-export/logic-smoke.cjs`, `…/ui-smoke.cjs` | PASS (Excel Nhóm data/Kết quả chạy không đổi) |
| `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `npm run build` | PASS |

Thêm (không lưu vào repo): bộ đọc chạy trên 3.000 thẻ ngẫu nhiên khác khớp 100% số thành viên/số bài tiếng Việt/
privacy với block đang chạy, 151/151 thẻ tiếng Anh có số bài. Chạy cả đường xuất trên dữ liệu thật của 4 chiến dịch
khách gửi (chỉ đọc):

| Chiến dịch | Nhóm | Có Số bài: trước → sau | Trạng thái tham gia | Bạn bè trong nhóm |
| --- | --- | --- | --- | --- |
| 19119 (tiếng Việt) | 2.129 | 737 → 737 | 2.129 (303 đã tham gia) | 926 |
| 19120 (tiếng Anh) | 581 | 0 → 372 | 581 | 282 |
| 19121 (tiếng Việt) | 616 | 452 → 452 | 616 | 475 |
| 19122 (tiếng Anh) | 731 | 0 → 342 | 731 (282 đã tham gia) | 313 |

Tên dính `Profile photo of` ở 19120/19122 (1.312 nhóm) sạch trong file. Chưa chạy bằng phiên Desktop đăng nhập thật
với PostgREST production (đã EXPLAIN đúng câu SQL trên production; URL lọc kiểm bằng supabase-js thật).

## 6. Ghi nhận ngoài phạm vi

- Nhóm tài khoản đã tham gia không hiện số bài/ngày, nên khi đặt "Số bài đăng tối thiểu/ngày" > 0 block loại
  6.385/9.530 nhóm đã tham gia (67%) trong 30 ngày; tài khoản tiếng Anh bị loại oan ~6.200 nhóm vì đọc số bài ra 0.
  Hết khi sửa block (riêng phần tiếng Anh) hoặc đổi quy tắc lọc.
- `fb_apply_search_group_filters` chỉ có nhãn tiếng Việt (Nhóm công khai, Gần tôi, Nhóm của tôi, Tỉnh/Thành phố); nghi
  không áp dụng cho tài khoản tiếng Anh, chưa soi DOM thật.
- Tab chỉ nạp 500 lượt chạy gần nhất
  ([`listCampaignDetailsByCampaign`](../src/main/data/repositories/campaignRepository.ts)); 16 chiến dịch "Tìm data
  trong group" vượt mức này, chưa có chiến dịch search nào vượt.
- Web: chép `facebookSearchGroupCard.ts` và phần dựng file sang WebApp khi Web có tab tương tự.
