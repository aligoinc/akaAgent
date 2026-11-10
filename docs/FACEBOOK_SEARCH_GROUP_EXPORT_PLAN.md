# Phương án: tải đủ dữ liệu nhóm Facebook ở tab "Data tìm được" (Tìm kiếm data bằng search)

Ngày 10/11/2026. Bản sửa cùng ngày theo góp ý: đây là tính năng tải dữ liệu, chỉ cần tải về
đầy đủ dữ liệu. **Chỉ là phương án: chưa sửa code, block hay DB.** Làm cho Desktop akaAgent
trước, Web làm sau. Số liệu đo chỉ đọc trên akachat (`cgjbsmqtfhqvttudyjzq`) lúc ~18:00 VN
10/11/2026.

## 1. Yêu cầu và phạm vi

File tải từ tab **Data tìm được → Xuất Excel** của chiến dịch **Facebook - Tìm kiếm data bằng
search** (`facebook_find_data_search`) phải có đủ dữ liệu nhóm: ít nhất các cột của file mẫu
(`Tên, UID, Số thành viên, Số bài, Đơn vị bài, Privacy`) và mọi thông tin khác Facebook có hiện.

Không làm trong phương án này: cột `Loại nhóm AI` (không phải dữ liệu tải về; trong file mẫu
cột này toàn `Không biết`; đã bỏ từ 02/11), đổi điều kiện lọc của chiến dịch, đổi bảng hiển thị
trong tab, mở từng nhóm để lấy thêm thông tin, sửa dữ liệu cũ trong DB.

## 2. Hiện trạng

### 2.1 Bản đang phát hành

Feed Desktop ba nền tảng đang là **9.5.0**. Từ 9.2.0, xuất nhóm ở tab này ra 6 cột
`Tên, UID, Số thành viên, Số bài, Đơn vị bài, Privacy`
([foundDataExport.ts](../src/renderer/src/components/CampaignPanels/foundDataExport.ts));
9.1.0 trở về trước chỉ có mẫu 9 cột chung (`Tên, Uid, Sđt, Email, Info1..5`). Lịch sử mẫu:
[FACEBOOK_SEARCH_GROUP_EXCEL.md](FACEBOOK_SEARCH_GROUP_EXCEL.md).

### 2.2 Chiến dịch trong ảnh khách gửi

Chiến dịch trong ảnh là 4 chiến dịch cùng tên (19119–19122, staff 251, máy đang chạy 9.5.0).
Ảnh chụp chiến dịch 19119 (2.429 dòng). File xuất hôm nay:

| Chiến dịch | Giao diện Facebook của tài khoản | Nhóm sau gộp trùng | Có Số bài | Tên nhóm |
| --- | --- | --- | --- | --- |
| 19119 | Tiếng Việt | 2.129 | 737 (35%) | sạch |
| 19121 | Tiếng Việt | 616 | 452 (73%) | sạch |
| 19120 | Tiếng Anh | 581 | 0 | 100% dính `Profile photo of …` |
| 19122 | Tiếng Anh | 731 | 0 | 100% dính `Profile photo of …` |

Số thành viên và Privacy có đủ 100%.

### 2.3 Facebook hiện gì trên thẻ nhóm

Block `fb_collect_search_groups` (id 2723, workflow 239) ghi nguyên văn chữ của mỗi thẻ nhóm vào
`auto_campaign_run_events.debug_data.rawText` (event `extract_facebook_group_data`), nên đo được
chính xác. 30 ngày gần nhất: **154.529 thẻ** của ~100 chiến dịch. Ví dụ:

- `… Công khai · 16K thành viên · 20+ bài viết/ngày 5 người bạn là thành viên Tham gia`
- `… Công khai · 1,6K thành viên · 25 bài viết chưa đọc · Là thành viên từ tháng 2 năm 2026 2 người bạn là thành viên Truy cập`
- `… Public · 7.5K members · 90+ posts a day 1 friend is a member Join`
- `… Public · 1.6K members · 25 unread posts · Member since February 2026 3 friends are members Visit`

| Thông tin trên thẻ | Tỉ lệ thẻ | Block hiện tại |
| --- | --- | --- |
| Privacy (Công khai/Riêng tư; Riêng tư 0,3%) | 100% | đọc đúng |
| Số thành viên (`16K`, `1,6K`, `7.5K`, `1 triệu`) | 100% | đọc đúng (0 lệch) |
| Số bài tiếng Việt `N bài viết/ngày` | 72,8% | đọc đúng |
| Số bài tiếng Anh `N posts a day` | 6,7% (17 chiến dịch) | **đọc ra 0** |
| Không hiện số bài (nhóm ít hoạt động) | 14,6% | 0 → trống, đúng |
| Nhóm đã tham gia: `N bài viết chưa đọc · Là thành viên từ…` thay cho số bài/ngày | 5,8% | không lấy |
| Số bài dạng `N+` (10+ … 90+, lớn nhất Facebook hiện là 90+) | 74% số bài có hiện | mất dấu `+` |
| `N người bạn là thành viên` / `N friend(s) is/are member(s)` | ~31% | không lấy |
| Nút cuối thẻ: `Tham gia`/`Join` (chưa tham gia), `Truy cập`/`Visit` (đã tham gia) | 100% (đã tham gia 6,2%) | không lấy |
| `Là thành viên từ tháng M năm Y`, `Member since …`, `Mới tham gia`, `Recently joined` | ~6% | không lấy |
| `By <Trang>` (nhóm của Trang) | 71 thẻ | bỏ qua |

Không thẻ nào ghi số bài theo tuần/tháng/năm, nên `Đơn vị bài` chỉ có thể là `ngày`. Số bài
trống ở chiến dịch tiếng Việt (65% ở 19119) là do Facebook không hiện trên thẻ, không phải lỗi
tải; muốn có phải mở từng nhóm, nằm ngoài phạm vi.

### 2.4 Vì sao file đang thiếu dữ liệu

- **Tài khoản giao diện tiếng Anh không có số bài.** Block chỉ khớp `bài viết/ngày` và
  `posts/day`, còn Facebook ghi `posts a day`.
- **Tên nhóm dính `Profile photo of `.** Tên lấy từ link ảnh đại diện; block chỉ bỏ tiền tố
  tiếng Việt `Ảnh đại diện của`. Toàn bộ lịch sử chiến dịch search chưa xoá: 14.437 dòng nhóm,
  87 lượt chạy, 19 chiến dịch (từ 19/06/2026).
- **Thông tin có trên thẻ nhưng không được tải:** dấu `+`, bài chưa đọc, trạng thái tham gia,
  tham gia từ, số bạn bè trong nhóm.
- **Thêm trường phải sửa ba tầng.** Block tổng kết `fb_find_search_data_summary` (id 2724, hàm
  `uniqueGroups`) và app
  ([`normalizeFoundFacebookGroup`](../src/main/services/campaignScheduler.ts) dòng 12909) đều
  dựng lại object nhóm chỉ với 6 trường `url, name, privacy, memberCount, postsPerDay, keyword`.
- **File chỉ có cột nhóm.** Từ khóa, tài khoản và thời gian tìm đang hiện trong tab nhưng
  không có trong file.

## 3. File Excel đích

Sáu cột đầu giữ đúng tên và thứ tự của mẫu. Các cột thêm nối phía sau.

| Cột | Tên cột | Nguồn | Quy tắc |
| --- | --- | --- | --- |
| A | Tên | `name` đã bỏ tiền tố ảnh đại diện | chuỗi |
| B | UID | `url` dạng `https://www.facebook.com/groups/<id hoặc slug>/` | chuỗi, như mẫu |
| C | Số thành viên | `memberCount` | số; Facebook làm tròn (16K → 16000) |
| D | Số bài | `postsPerDay` > 0 | số; `90+` ghi 90; Facebook không hiện → trống |
| E | Đơn vị bài | `ngày` khi D có số | còn lại trống |
| F | Privacy | `privacy` | Công khai/Riêng tư |
| G | Số bài Facebook hiển thị | `postsText` | `90+`, `7`; cho biết D là mức tối thiểu |
| H | Bài chưa đọc | `unreadPosts` | chỉ nhóm đã tham gia |
| I | Trạng thái tham gia | `joinState` | Đã tham gia / Chưa tham gia, theo tài khoản đã tìm |
| J | Tham gia từ | `memberSince` | `02/2026` hoặc `Mới tham gia` |
| K | Bạn bè trong nhóm | `friendMemberCount` | Facebook không hiện khi bằng 0 → trống |
| L | Từ khóa | `keyword` của các lượt tìm ra nhóm | gộp `a, b` |
| M | Tài khoản tìm | tài khoản của lượt chạy | gộp |
| N | Thời gian tìm | `created_at` sớm nhất của lượt chạy | `dd/MM/yyyy HH:mm` |

- Facebook không hiện thì để trống, không ghi 0 hay `Chưa tham gia` giả.
- Gộp trùng giữ quy tắc hiện có: khoá là URL nhóm, trường đo lấy theo lượt mới nhất có giá trị;
  Từ khóa và Tài khoản gộp danh sách; Thời gian tìm lấy sớm nhất.
- Sheet giữ như hiện tại: chỉ chọn Link group Facebook → một sheet `Sheet1`; chọn lẫn loại khác
  → nhóm ở sheet `Group Facebook`. Giữ bộ lọc tiêu đề và độ rộng cột.

## 4. Cách làm

### 4.1 Bộ đọc thẻ nhóm dùng chung

File mới `src/shared/facebookSearchGroupCard.ts`, TypeScript thuần (không Electron/Node) để
sau chép sang WebApp. Hàm `parseFacebookSearchGroupCard(cardText, linkTexts)` trả các trường
ở mục 3. Quy tắc cho tiếng Việt và tiếng Anh:

- Privacy: `(Công khai|Riêng tư|Public|Private)\s*·`, neo bằng dấu `·` để tên nhóm có chữ
  "Public" không bị nhận nhầm.
- Số thành viên: giữ `parseNumber` hiện có (K/N/M/Tr/triệu/nghìn, dấu phẩy thập phân tiếng Việt).
- Số bài: `(\d[\d.,]*)(\+)?\s*(bài viết\s*/\s*ngày|posts? (a|per) day)`; không được khớp
  `chưa đọc`/`unread`.
- Bài chưa đọc: `(\d+)\+?\s*(bài viết chưa đọc|unread posts?)`.
- Bạn bè: `(\d[\d.,]*)\s*(người bạn là thành viên|friends? (is|are) (a )?members?)`.
- Tham gia từ: `Là thành viên từ tháng (\d{1,2}) năm (\d{4})`, `Member since <tháng> (\d{4})`
  → `MM/YYYY`; `Mới tham gia`, `Recently joined` → `Mới tham gia`.
- Trạng thái: chữ cuối thẻ `Truy cập`/`Visit`, hoặc có `Là thành viên từ`, `Member since`,
  `Mới tham gia`, `Recently joined`, `Bạn hiện là thành viên`, `You are in this group` → đã tham
  gia; chữ cuối `Tham gia`/`Join` → chưa tham gia; còn lại để trống.
- Tên: ưu tiên chữ của link tiêu đề, bỏ tiền tố `^(Ảnh đại diện của|Profile photo of)\s+`.
- Mẫu chữ không nhận ra thì để trống, không đoán.

### 4.2 Block 2723 và 2724 (DB)

- Block 2723 `fb_collect_search_groups`: thay `parseGroupCard` bằng bản sinh từ 4.1. Script mới
  `scripts/facebook-search-groups/build-block-sql.cjs` biên dịch module chung thành JS thuần, chèn
  vào code block và sinh migration, để không phải viết tay hai bản. Trả thêm `postsText`,
  `unreadPosts`, `friendMemberCount`, `joinState`, `memberSince` và `cardVersion: 2`; chỉ ghi khoá
  khi đọc được để payload không phình.
- `postsPerDay` giữ nghĩa cũ (số bài/ngày khi Facebook hiện, còn lại 0). Quy tắc lọc giữ nguyên;
  riêng tài khoản tiếng Anh hết bị loại oan khi đặt "Số bài đăng tối thiểu/ngày", vì nay đọc
  được số bài.
- Block 2724 `fb_find_search_data_summary`: `uniqueGroups` giữ thêm các trường trên theo danh sách
  cho phép, không đổi phần khác.
- Migration V49x chỉ đổi dữ liệu `auto_blocks`. Đặt số khi làm (kiểm sổ migration và
  `git log --all`; lúc viết, mới nhất là V489). Preflight kiểm md5 code hiện tại: 2723
  `91e809e62911aea2c2391ae14676dc3b`, 2724 `c78abe7a868cedbd8db485278d109ba7`; khác thì dừng.
  Postflight kiểm md5 code mới. Rollback đặt lại đúng code cũ, lưu nguyên văn trong
  `migrations/snapshots/`.
- Không có DDL nên PostgREST không nạp lại schema, apply giờ nào cũng được. Engine đọc block theo
  id từ DB ở mỗi lượt chạy, không cache
  ([`loadBlocks`](../src/main/v2/runtime/workflowEngine.ts) dòng 622): lượt kế tiếp của mọi máy
  dùng code mới. Bản 9.2–9.5 bỏ qua trường mới nhưng lưu được tên sạch và số bài tiếng Anh, nên
  file 6 cột hiện tại đã đủ hơn trước khi có app mới.

### 4.3 App Desktop

- Main: `FindDataFacebookGroup` (campaignScheduler.ts dòng 581) và `normalizeFoundFacebookGroup`
  nhận các trường mới và bỏ tiền tố tên. Chỉ ghi khoá khi có giá trị: mỗi lượt chạy thành công
  đọc lại tối đa 500 lượt cũ để lọc trùng (`getPreviouslyFoundValues`, dòng 13217).
- Renderer: `toFacebookGroupList` đọc trường mới và bỏ tiền tố tên của dữ liệu cũ;
  `getUniqueItems` gộp Từ khóa/Tài khoản/Thời gian; `buildFoundDataWorkbook` dựng 14 cột theo
  mục 3, số là số, chuỗi là chuỗi. `CampaignPanel.tsx` truyền thêm từ khóa và tài khoản của mỗi
  lượt chạy vào dữ liệu xuất. Bảng trong tab giữ nguyên.

### 4.4 Dữ liệu đã tìm trước đây

Dữ liệu cũ thiếu số bài (tài khoản tiếng Anh) và các cột G–K. Nguyên văn thẻ vẫn còn trong log
chạy từ 05/06/2026 (chưa có job dọn), nên điền được lúc xuất mà không sửa DB:

- Khi bấm xuất, nếu có nhóm chưa có `cardVersion: 2`, main đọc log của chiến dịch qua hàm mới
  (event `extract_facebook_group_data`, `status = 'success'`; chỉ lấy `target_url`, `created_at`
  và `debug_data->>rawText`; mỗi trang 1.000 dòng theo index `(campaign_id, created_at, id)`).
  Đọc lại bằng đúng bộ đọc 4.1, lấy thẻ mới nhất của từng URL, chỉ điền chỗ còn trống.
- Quy mô: 149 chiến dịch có log, tổng 142.206 thẻ; lớn nhất 19.329 thẻ (~3 MB, 20 trang); trung
  vị 156 thẻ.
- Không đọc được log (lỗi mạng, quyền, quá thời gian): vẫn xuất bằng dữ liệu đang có và báo số
  nhóm thiếu cột thêm.

## 5. Thứ tự triển khai

| Bước | Nội dung | Loại thay đổi | Có hiệu lực |
| --- | --- | --- | --- |
| 1 | Bộ đọc 4.1 + kiểm thử bằng mẫu thật | code | — |
| 2 | V49x: block 2723, 2724 | DB, chỉ dữ liệu | lượt chạy mới, mọi bản app |
| 3 | App: lưu đủ trường, xuất 14 cột, điền dữ liệu cũ từ log | bản Desktop mới, build theo AGENTS.md và build-01..03 | sau khi khách cập nhật |
| 4 | Hậu kiểm 3–7 ngày | — | — |

Bước 2 làm trước bước 3 được vì app cũ chịu được trường mới. Bước 3 không phụ thuộc bước 2.

Hậu kiểm sau bước 2 (SQL chỉ đọc trên event `extract_facebook_group_data`): thẻ tiếng Anh có
`posts a day` phải có số bài > 0; tên còn tiền tố = 0; lỗi block trong `auto_runs.error` không tăng.

## 6. Kiểm thử

- **Bộ đọc:** lấy khoảng 5.000 thẻ thật đủ dạng từ `rawText` 30 ngày (tiếng Việt, tiếng Anh, đã
  tham gia, có bạn bè, `N+`, `By <Trang>`), **thay tên nhóm bằng tên giả** trước khi lưu fixture.
  So với kết quả trích bằng regex SQL độc lập (số thành viên, số bài, bạn bè, nút cuối), yêu cầu
  khớp 100%. Thêm ca biên viết tay: tên có chữ "Public", "Tham gia" hoặc bắt đầu bằng `=`;
  `1 triệu`; `1,6K`; `Recently joined`; `1 unread post`.
- **Block:** chạy code block đã sinh trong engine v2 với DOM giả lập trang search tiếng Việt và
  tiếng Anh. Canary thật: một tài khoản tiếng Việt và một tài khoản tiếng Anh, 10 nhóm mỗi từ
  khóa, so tay với màn hình.
- **Migration:** preflight md5, chạy thử trong transaction ROLLBACK, thử rollback.
- **App:** logic smoke cho normalizer (payload cũ và mới); sửa
  `scripts/run-campaign-found-data-export-ui-smoke.cjs` (đọc lại bytes `.xlsx`: đúng 6 cột đầu,
  đủ cột thêm, gộp trùng và từ khóa, dữ liệu cũ được điền từ log, không đọc được log vẫn xuất);
  chạy thử xuất chiến dịch 19120 bằng phiên Desktop thật.
- `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`,
  `npm run build` (trong container cloud: `NODE_OPTIONS=--max-old-space-size=8192`).

## 7. Ước lượng

| Phần | Công |
| --- | --- |
| Bước 1–2 (bộ đọc, script sinh block, migration, kiểm thử) | 1–1,5 ngày |
| Bước 3 (lưu đủ trường, xuất 14 cột, điền dữ liệu cũ, kiểm thử) | 1,5–2 ngày |
| Build và phát hành theo AGENTS.md | 0,5 ngày |

## 8. Ghi nhận ngoài phạm vi

- Nhóm tài khoản đã tham gia không hiện số bài/ngày, nên khi đặt "Số bài đăng tối thiểu/ngày" > 0
  block loại 6.385/9.530 nhóm đã tham gia (67%) trong 30 ngày. Đây là quy tắc lọc, không thuộc
  phần tải dữ liệu.
- `fb_apply_search_group_filters` chỉ có nhãn tiếng Việt (Nhóm công khai, Gần tôi, Nhóm của tôi,
  Tỉnh/Thành phố), nên nghi bộ lọc này không áp dụng được cho tài khoản tiếng Anh; chưa soi DOM thật.
- Tab chỉ nạp 500 lượt chạy gần nhất
  ([`listCampaignDetailsByCampaign`](../src/main/data/repositories/campaignRepository.ts) dòng 6210).
  Hiện 16 chiến dịch **Tìm data trong group** vượt mức này (lớn nhất 9.095 lượt); chưa có chiến
  dịch search nào vượt.
- Số bài của nhóm Facebook không hiện trên thẻ chỉ lấy được bằng cách mở từng nhóm (chậm, khoảng
  5–8 giây mỗi nhóm, tăng rủi ro checkpoint).
- Web: chép `facebookSearchGroupCard.ts` và phần dựng file sang WebApp khi Web có tab tương tự.
