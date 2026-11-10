# Phương án: Excel nhóm Facebook ở tab "Data tìm được" (Tìm kiếm data bằng search)

Ngày 10/11/2026. **Chỉ là phương án: chưa sửa code, block hay DB.** Làm cho Desktop
akaAgent trước, Web làm sau (mục 9). Số liệu đo chỉ đọc trên akachat
(`cgjbsmqtfhqvttudyjzq`) lúc ~18:00 VN 10/11/2026.

## 1. Yêu cầu

Ở chiến dịch **Facebook - Tìm kiếm data bằng search** (`facebook_find_data_search`),
file tải từ tab **Data tìm được → Xuất Excel** phải có ít nhất các cột của file mẫu
(mẫu akaBizAuto): `Tên | UID | Số thành viên | Số bài | Đơn vị bài | Privacy | Loại nhóm AI`.
Facebook có thêm thông tin thì bổ sung.

## 2. Hiện trạng

### 2.1 Bản đang phát hành

- Feed Desktop ba nền tảng đang là **9.5.0**. Từ 9.2.0, xuất nhóm ở tab này ra 6 cột
  `Tên, UID, Số thành viên, Số bài, Đơn vị bài, Privacy`
  ([foundDataExport.ts](../src/renderer/src/components/CampaignPanels/foundDataExport.ts)).
  9.1.0 trở về trước chỉ có mẫu 9 cột chung (`Tên, Uid, Sđt, Email, Info1..5`).
- Cột `Loại nhóm AI` từng có ở bản nháp 7 cột và **đã bị bỏ ngày 02/11/2026 theo yêu cầu**
  ([FACEBOOK_SEARCH_GROUP_EXCEL.md](FACEBOOK_SEARCH_GROUP_EXCEL.md)), vì chưa có AI phân loại
  thật. Phương án này đưa lại cột đó với giá trị do AI phân loại (mục 5.6, cần chốt ở mục 8).

### 2.2 Chiến dịch trong ảnh khách gửi

Chiến dịch trong ảnh là 4 chiến dịch cùng tên (19119–19122, staff 251, máy đang chạy 9.5.0).
Ảnh chụp chiến dịch 19119 (2.429 dòng). File xuất hôm nay sẽ như sau:

| Chiến dịch | Giao diện Facebook của tài khoản | Nhóm sau gộp trùng | Có Số bài | Tên nhóm |
| --- | --- | --- | --- | --- |
| 19119 | Tiếng Việt | 2.129 | 737 (35%) | sạch |
| 19121 | Tiếng Việt | 616 | 452 (73%) | sạch |
| 19120 | Tiếng Anh | 581 | 0 | 100% dính `Profile photo of …` |
| 19122 | Tiếng Anh | 731 | 0 | 100% dính `Profile photo of …` |

Số thành viên và Privacy có đủ 100%. Không có cột Loại nhóm AI.

### 2.3 Facebook hiện gì trên thẻ nhóm

Block `fb_collect_search_groups` (id 2723, workflow 239) ghi nguyên văn chữ của mỗi thẻ
nhóm vào `auto_campaign_run_events.debug_data.rawText` (event `extract_facebook_group_data`),
nên đo được chính xác. 30 ngày gần nhất: **154.529 thẻ** của ~100 chiến dịch. Ví dụ:

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
| Nhóm đã tham gia: `N bài viết chưa đọc · Là thành viên từ…` thay cho số bài/ngày | 5,8% | 0 → trống, không lấy gì |
| Số bài dạng `N+` (10+ … 90+, lớn nhất Facebook hiện là 90+) | 74% số bài có hiện | mất dấu `+` |
| `N người bạn là thành viên` / `N friend(s) is/are member(s)` | ~31% | không lấy |
| Nút cuối thẻ: `Tham gia`/`Join` (chưa tham gia), `Truy cập`/`Visit` (đã tham gia) | 100% (đã tham gia 6,2%) | không lấy |
| `Là thành viên từ tháng M năm Y`, `Member since …`, `Mới tham gia`, `Recently joined` | ~6% | không lấy |
| `By <Trang>` (nhóm của Trang) | 71 thẻ | bỏ qua |

Không thẻ nào ghi số bài theo tuần/tháng/năm, nên từ trang kết quả search thì `Đơn vị bài`
chỉ có thể là `ngày`.

### 2.4 Lỗi tìm thấy

- **L1 — tài khoản giao diện tiếng Anh không có số bài.** Block chỉ khớp `bài viết/ngày`
  và `posts/day`, còn Facebook ghi `posts a day`. Ngoài cột Số bài trống, **điều kiện
  "Số bài đăng tối thiểu/ngày" loại oan nhóm**: 30 ngày có 7.901 thẻ tiếng Anh bị loại vì
  lý do này, 6.196 thẻ trong đó có hiện số bài trên Facebook.
- **L2 — tên nhóm dính `Profile photo of `.** Tên lấy từ link ảnh đại diện (aria-label);
  block chỉ bỏ tiền tố tiếng Việt `Ảnh đại diện của`. 30 ngày: 8,3% thẻ. Toàn bộ lịch sử
  chiến dịch search chưa xoá: 14.437 dòng nhóm, 87 lượt chạy, 19 chiến dịch (từ 19/06/2026).
- **L3 — nhóm đã tham gia bị loại vì số bài.** Với nhóm tài khoản đã tham gia, Facebook không
  hiện số bài/ngày. Khi đặt "Số bài đăng tối thiểu/ngày" > 0, block loại 6.385/9.530 nhóm
  đã tham gia (67%), đúng những nhóm đăng bài được ngay.
- **L4 — thêm trường phải sửa ba tầng.** Block tổng kết `fb_find_search_data_summary`
  (id 2724, hàm `uniqueGroups`) và app
  ([`normalizeFoundFacebookGroup`](../src/main/services/campaignScheduler.ts) dòng 12909)
  đều dựng lại object nhóm chỉ với 6 trường `url, name, privacy, memberCount, postsPerDay, keyword`.

Ghi nhận, ngoài phạm vi phương án này:

- **N1.** `fb_apply_search_group_filters` chỉ có nhãn tiếng Việt (Nhóm công khai, Gần tôi,
  Nhóm của tôi, Tỉnh/Thành phố), nên nghi các bộ lọc này không áp dụng được cho tài khoản
  tiếng Anh. Chưa soi DOM thật.
- **N2.** Tab chỉ nạp 500 lượt chạy gần nhất
  ([`listCampaignDetailsByCampaign`](../src/main/data/repositories/campaignRepository.ts) dòng 6210).
  Hiện 16 chiến dịch **Tìm data trong group** vượt mức này (lớn nhất 9.095 lượt); chưa có
  chiến dịch search nào vượt.

## 3. Mẫu Excel đích

Cột A–G giữ **đúng tên và thứ tự của mẫu** để file dùng thay được mẫu cũ. Cột bổ sung nối
sau G, nên công cụ đọc theo vị trí cột vẫn đúng.

| Cột | Tên cột | Nguồn | Quy tắc |
| --- | --- | --- | --- |
| A | Tên | `name` đã bỏ tiền tố ảnh đại diện | chuỗi |
| B | UID | `url` dạng `https://www.facebook.com/groups/<id hoặc slug>/` | chuỗi, như mẫu |
| C | Số thành viên | `memberCount` | số; Facebook làm tròn (16K → 16000) |
| D | Số bài | `postsPerDay` > 0 | số; `90+` ghi 90; Facebook không hiện → trống |
| E | Đơn vị bài | `ngày` khi D có số | còn lại trống |
| F | Privacy | `privacy` | Công khai/Riêng tư |
| G | Loại nhóm AI | AI phân loại theo tên nhóm (mục 5.6) | một giá trị trong danh sách; không chắc hoặc AI lỗi → `Không biết` |
| H | Số bài Facebook hiển thị | `postsText` | `90+`, `7`; cho biết D là mức tối thiểu |
| I | Bài chưa đọc | `unreadPosts` | chỉ nhóm đã tham gia; là tín hiệu hoạt động duy nhất Facebook hiện cho các nhóm này |
| J | Trạng thái tham gia | `joinState` | Đã tham gia / Chưa tham gia, theo tài khoản đã tìm |
| K | Tham gia từ | `memberSince` | `02/2026` hoặc `Mới tham gia` |
| L | Bạn bè trong nhóm | `friendMemberCount` | số bạn bè của tài khoản tìm có trong nhóm; Facebook không hiện khi bằng 0 → trống |
| M | Từ khóa | `keyword` của các lượt tìm ra nhóm | gộp `a, b` |
| N | Tài khoản tìm | tài khoản của lượt chạy | gộp |
| O | Thời gian tìm | `created_at` sớm nhất của lượt chạy | `dd/MM/yyyy HH:mm` |

- Dữ liệu tìm trước khi block mới chạy không có cột H–L: để trống, không ghi
  `Chưa tham gia` hay 0 giả. Nhận biết bằng `cardVersion` (mục 5.2).
- Gộp trùng (giữ quy tắc hiện có, mở rộng): khoá là URL nhóm; trường đo lấy theo lượt mới
  nhất có giá trị; Từ khóa và Tài khoản gộp danh sách; Thời gian tìm lấy sớm nhất.
- Sheet giữ như hiện tại: chỉ chọn Link group Facebook → một sheet `Sheet1`; chọn lẫn loại
  khác → nhóm nằm ở sheet `Group Facebook`. Giữ bộ lọc tiêu đề và độ rộng cột.

## 4. Bảng trong tab

- Chiến dịch search: đổi tiêu đề cột `Group` thành `Từ khóa` (cột này đang hiện từ khóa,
  ví dụ `ninh cường`). Chiến dịch tìm trong group giữ `Group`.
- Thêm cột `Thông tin nhóm` cho dòng Link group Facebook, ví dụ
  `Công khai · 25K thành viên · 90+ bài/ngày · Chưa tham gia · 3 bạn bè`, kèm Loại nhóm nếu
  máy này đã phân loại. Dòng loại khác để `-`.
- Không thêm lọc/sắp xếp ở bản này; Excel đã có bộ lọc.

## 5. Thiết kế kỹ thuật

### 5.1 Bộ đọc thẻ nhóm dùng chung

File mới `src/shared/facebookSearchGroupCard.ts`, TypeScript thuần (không Electron/Node)
để sau chép sang WebApp. Hàm `parseFacebookSearchGroupCard(cardText, linkTexts)` trả
`name, privacy, memberCount, postsPerDay, postsText, unreadPosts, friendMemberCount,
joinState, memberSince`. Quy tắc cho tiếng Việt và tiếng Anh:

- Privacy: `(Công khai|Riêng tư|Public|Private)\s*·`. Neo bằng dấu `·` để tên nhóm có chữ
  "Public" không bị nhận nhầm (block hiện tại tìm chữ trong cả tên).
- Số thành viên: giữ `parseNumber` hiện có (K/N/M/Tr/triệu/nghìn, dấu phẩy thập phân tiếng Việt).
- Số bài: `(\d[\d.,]*)(\+)?\s*(bài viết\s*/\s*ngày|posts? (a|per) day)`; không được khớp
  `chưa đọc`/`unread`.
- Bài chưa đọc: `(\d+)\+?\s*(bài viết chưa đọc|unread posts?)`.
- Bạn bè: `(\d[\d.,]*)\s*(người bạn là thành viên|friends? (is|are) (a )?members?)`.
- Tham gia từ: `Là thành viên từ tháng (\d{1,2}) năm (\d{4})`, `Member since <tháng tiếng Anh> (\d{4})`
  → `MM/YYYY`; `Mới tham gia`, `Recently joined` → `Mới tham gia`.
- Trạng thái: chữ cuối thẻ `Truy cập`/`Visit`, hoặc có `Là thành viên từ`, `Member since`,
  `Mới tham gia`, `Recently joined`, `Bạn hiện là thành viên`, `You are in this group` →
  đã tham gia. Chữ cuối `Tham gia`/`Join` → chưa tham gia. Phòng hờ `Đã gửi yêu cầu`/
  `Requested` → đã gửi yêu cầu (chưa gặp trong dữ liệu). Còn lại để trống.
- Tên: ưu tiên chữ của link tiêu đề (link có chữ), bỏ tiền tố
  `^(Ảnh đại diện của|Profile photo of)\s+`; cuối cùng mới cắt từ thẻ, phần trước privacy.
- Ngôn ngữ khác hoặc mẫu chữ mới: trường không nhận ra thì để trống, không đoán.

### 5.2 Block 2723 `fb_collect_search_groups` (DB)

- Thay `parseGroupCard` bằng bản sinh từ 5.1. Script mới
  `scripts/facebook-search-groups/build-block-sql.cjs` biên dịch module chung thành JS thuần,
  chèn vào code block và sinh migration. Không viết tay hai bản.
- Trả thêm trường, chỉ ghi khi đọc được để payload nhỏ: `postsText`, `unreadPosts`,
  `friendMemberCount`, `joinState` (`joined`/`not_joined`/`requested`), `memberSince`,
  `cardVersion: 2`.
- `postsPerDay` giữ nghĩa cũ (số bài/ngày khi Facebook hiện, còn lại 0). Nhờ vậy bản app
  9.2–9.5 không cần đổi mà vẫn xuất đúng hơn.
- Điều kiện lọc:
  - Số bài tối thiểu: tài khoản tiếng Anh đọc được số nên hết loại oan.
  - Nhóm **đã tham gia** mà Facebook không hiện số bài: không loại vì số bài; ghi lý do
    "Đã tham gia, Facebook không hiện số bài/ngày" (cần chốt, mục 8).
  - Nhóm chưa tham gia và không hiện số bài: giữ như cũ, coi là dưới 1 bài/ngày.
- `debugData` của event thêm các trường mới, giữ nguyên `rawText` để đối chiếu.

### 5.3 Block 2724 `fb_find_search_data_summary` (DB)

`uniqueGroups` giữ thêm các trường ở 5.2 theo danh sách cho phép, chuẩn hoá kiểu dữ liệu.
Không đổi phần khác của block.

### 5.4 Migration V49x (chỉ dữ liệu `auto_blocks`)

- Đặt số khi làm: kiểm sổ migration và `git log --all`; lúc viết, mới nhất là V489.
- Preflight: md5 code hiện tại của 2723 là `91e809e62911aea2c2391ae14676dc3b`, của 2724 là
  `c78abe7a868cedbd8db485278d109ba7`; khác thì dừng. Postflight kiểm md5 code mới. Rollback
  đặt lại đúng code cũ, lưu nguyên văn trong `migrations/snapshots/`.
- Không có DDL nên PostgREST không nạp lại schema, apply giờ nào cũng được. Engine đọc block
  theo id từ DB ở mỗi lượt chạy, không cache
  ([`loadBlocks`](../src/main/v2/runtime/workflowEngine.ts) dòng 622): lượt kế tiếp của mọi
  máy dùng code mới, lượt đang chạy giữ code cũ.
- Có tác dụng ngay trên mọi bản đang dùng, kể cả 9.5.0: lượt chạy mới có tên sạch, có số bài
  cho tài khoản tiếng Anh và không loại nhóm đã tham gia. File 6 cột của bản hiện tại đã tốt
  hơn trước khi phát hành app mới. App cũ bỏ qua trường mới, không lỗi.

### 5.5 App Desktop — main process

- `FindDataFacebookGroup` (campaignScheduler.ts dòng 581) và `normalizeFoundFacebookGroup`
  (dòng 12909): nhận và chuẩn hoá các trường mới, bỏ tiền tố tên.
- Chỉ ghi khoá khi có giá trị để `auto_campaign_details.data` không phình: mỗi lượt chạy
  thành công đọc lại tối đa 500 lượt cũ để lọc trùng (`getPreviouslyFoundValues`, dòng 13217).
- Không đổi luồng đẩy nhóm sang chiến dịch đích hay nhóm data. Đưa trường mới vào Excel
  Nhóm data cần đổi projection của reader V443, để giai đoạn sau.

### 5.6 Loại nhóm AI

- Danh sách loại đề xuất (cần chốt): Mua bán - Rao vặt; Cộng đồng - Cư dân; Đồng hương -
  Quê hương; Bất động sản; Việc làm; Ăn uống; Mẹ và bé; Xe ghép - Vận chuyển; Học tập -
  Trường lớp; Kinh doanh - Nguồn hàng; Sở thích - Giải trí; Khác; Không biết.
- Cấu hình AI chỉ là dữ liệu (migration V49y): `ai_prompt` + `ai_using` mã
  `app_facebook_group_type`, model id 1 `gpt-5-nano` (đã chạy qua proxy AI Desktop với
  `app_ai_rewrite_content`), trả JSON. Id là cột identity nên dùng `RETURNING id`. Rollback
  tắt `is_active`.
- Phân loại lúc bấm xuất (khuyến nghị cho bản đầu):
  - IPC mới `foundData:classifyFacebookGroups` ở main nhận `{url, name}[]` (tối đa 20.000,
    tên cắt 200 ký tự), trả `{ok, data}` hoặc `{ok: false, code, message}`, có sự kiện tiến
    độ và hủy.
  - Lô 80 tên mỗi lần gọi, tối đa 3 lần song song, timeout theo cấu hình DB; tên trùng chỉ gửi một lần.
  - Kết quả ngoài danh sách, JSON hỏng hoặc lỗi mạng → `Không biết`. Không tự gọi lại để
    khỏi tính phí hai lần (đúng quy ước của proxy AI).
  - Cache trong SQLite cục bộ sẵn có (`userData/local-data/aka_agent_local.db`), bảng mới
    `facebook_group_types` khoá theo URL chuẩn hoá + phiên bản danh sách loại. Xuất lại thì
    có ngay, bảng trong tab hiện được loại đã phân.
  - Giao diện: ô chọn "Phân loại nhóm bằng AI" cạnh nút Xuất (mặc định bật khi chọn Link group
    Facebook); hộp tiến độ "Đang phân loại 300/2.129 nhóm…" kèm nút "Xuất luôn, để Không biết".
  - Ước tính: 2.129 nhóm ≈ 27 lần gọi, khoảng 1–2 phút ở lần xuất đầu.
- Lý do chưa phân loại lúc chạy chiến dịch: dữ liệu đã tìm (như 4 chiến dịch trong ảnh) vẫn
  phải phân loại lúc xuất, vì chạy lại chiến dịch cũ không tìm lại nhóm cũ (lọc trùng theo
  input). Một đường lúc xuất phủ cả dữ liệu cũ lẫn mới và không thêm thời gian hay rủi ro vào
  lượt chạy. Phân loại lúc chạy để giai đoạn sau.

### 5.7 Renderer

- `foundDataExport.ts`: `toFacebookGroupList` đọc trường mới và bỏ tiền tố tên của dữ liệu
  cũ; `getUniqueItems` gộp Từ khóa/Tài khoản/Thời gian; `buildFoundDataWorkbook` dựng 15 cột
  theo mục 3, số là số, chuỗi là chuỗi.
- `CampaignPanel.tsx`: `FoundDataItem` mang thêm từ khóa và tài khoản; bảng trong tab theo
  mục 4; nút xuất gọi IPC phân loại trước khi dựng workbook.

### 5.8 Dữ liệu đã tìm trước đây

- Tên: app bỏ tiền tố khi đọc, nên tên sạch ngay khi có bản mới, không sửa DB.
- Số bài của tài khoản tiếng Anh và cột H–L của dữ liệu cũ chỉ còn trong log chạy
  (`rawText`, giữ từ 05/06/2026, chưa có job dọn). Hai lựa chọn, cần chốt:
  - **A** (khuyến nghị nếu cần đủ số liệu cũ): migration bù một lần, ngoài giờ cao điểm. Với
    mỗi lượt `auto_campaign_details` của `facebook_find_data_search`, ghép event
    `extract_facebook_group_data` cùng `campaign_input_data_id` và URL nhóm (event gần nhất
    trước giờ tạo lượt), đọc lại bằng đúng bộ đọc 5.1, ghi đè trường đo, đánh dấu
    `cardVersion: 2` và thời điểm bù. Quy mô: 1.063 lượt, 150 chiến dịch, 90.645 dòng nhóm
    (14.437 dòng tiếng Anh). Trigger `trg_aka_agent_touch_campaign_last_run_at` có bắn khi
    UPDATE nhưng không đổi gì (chỉ cập nhật khi lượt mới hơn `last_run_at`); các trigger khác
    chỉ bắt `UPDATE OF status…`. Chụp `data` cũ ra snapshot để rollback.
  - **B**: không bù. Khách cần số liệu cũ thì nhân bản chiến dịch rồi chạy lại.

## 6. Thứ tự triển khai

| Bước | Nội dung | Loại thay đổi | Có hiệu lực |
| --- | --- | --- | --- |
| 1 | Bộ đọc 5.1 + kiểm thử bằng mẫu thật | code | — |
| 2 | V49x: block 2723, 2724 | DB, chỉ dữ liệu | lượt chạy mới, mọi bản app |
| 3 | V49y: cấu hình AI | DB, chỉ dữ liệu | khi có app mới |
| 4 | App: main, renderer, AI, cache | bản Desktop mới, build theo AGENTS.md và build-01..03 | sau khi khách cập nhật |
| 5 | Bù dữ liệu cũ (nếu chọn A) | DB | ngay |
| 6 | Hậu kiểm 3–7 ngày | — | — |

Bước 2 làm trước bước 4 được vì app cũ chịu được trường mới. Bước 4 không phụ thuộc bước 2:
dữ liệu chưa có trường mới thì cột tương ứng để trống.

Hậu kiểm sau bước 2 (SQL chỉ đọc trên event `extract_facebook_group_data`): thẻ tiếng Anh có
`posts a day` phải có số bài > 0; tên còn tiền tố = 0; nhóm đã tham gia bị loại vì số bài = 0;
lỗi block trong `auto_runs.error` không tăng.

## 7. Kiểm thử

- **Bộ đọc:** lấy khoảng 5.000 thẻ thật đủ dạng từ `rawText` 30 ngày (tiếng Việt, tiếng Anh,
  đã tham gia, có bạn bè, `N+`, `By <Trang>`), **thay tên nhóm bằng tên giả** trước khi lưu
  fixture. So với kết quả trích bằng regex SQL độc lập (số thành viên, số bài, bạn bè, nút
  cuối), yêu cầu khớp 100%. Thêm ca biên viết tay: tên có chữ "Public", "Tham gia" hoặc bắt
  đầu bằng `=`; `1 triệu`; `1,6K`; `Recently joined`; `1 unread post`.
- **Block:** chạy code block đã sinh trong engine v2 với DOM giả lập trang search tiếng Việt
  và tiếng Anh (Electron smoke như các script hiện có). Canary thật: một tài khoản tiếng Việt
  và một tài khoản tiếng Anh, 10 nhóm mỗi từ khóa, so tay với màn hình.
- **Migration:** preflight md5, chạy thử trong transaction ROLLBACK, thử rollback.
- **App:** logic smoke cho normalizer (payload cũ và mới); sửa
  `scripts/run-campaign-found-data-export-ui-smoke.cjs` (đọc lại bytes `.xlsx`: đúng A–G, có
  cột bổ sung, gộp trùng và từ khóa, dữ liệu cũ trống H–L, `Không biết` khi AI lỗi hoặc bị
  hủy); smoke dịch vụ AI với transport giả (chia lô, lỗi một phần, JSON hỏng, ngoài danh
  sách, hủy, cache, đổi phiên bản danh sách); một canary AI thật bằng phiên Desktop.
- `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json`,
  `npm run build` (trong container cloud: `NODE_OPTIONS=--max-old-space-size=8192`).

## 8. Cần chốt

1. Đưa lại cột "Loại nhóm AI" (đã bỏ ngày 02/11) với AI phân loại thật? Danh sách loại ở 5.6
   dùng được chưa?
2. Model: `gpt-5-nano` (đề xuất) hay `deepseek-flash`?
3. Nhóm đã tham gia mà Facebook không hiện số bài: không loại khi đặt "Số bài đăng tối
   thiểu/ngày" (đề xuất), hay giữ như cũ?
4. Cột bổ sung H–O: giữ hết, hay bớt (ví dụ bỏ "Bài chưa đọc")?
5. Dữ liệu cũ: bù theo A hay để như B?
6. Có làm các việc ở mục 9 không?

## 9. Giai đoạn sau (không nằm trong bản đầu)

- **Lấy thêm từ trang nhóm** (mở từng nhóm, mục Giới thiệu): số bài hôm nay/tháng trước (khi
  đó `Đơn vị bài` có thể là `tháng`), tổng thành viên chính xác, ngày tạo, mô tả (giúp AI
  phân loại đúng hơn). Chậm (khoảng 5–8 giây mỗi nhóm; 2.000 nhóm mất 3–4 giờ) và tăng rủi ro
  checkpoint, nên chỉ làm thành tùy chọn có trần số nhóm, sau khi soi DOM thật.
- Phân loại AI ngay lúc chạy, lưu `groupType` vào lượt chạy và nhóm data.
- Cột mới trong Excel Nhóm data/Kết quả chạy (đổi projection reader V443).
- Bộ lọc nhóm cho giao diện tiếng Anh (N1); nạp quá 500 lượt (N2).
- **Web:** chép `facebookSearchGroupCard.ts` và phần dựng workbook sang WebApp khi Web có tab
  tương tự. Hiện Web chỉ hiện số đếm trong cột "Data tìm được" của Kết quả chạy.

## 10. Ước lượng

| Phần | Công |
| --- | --- |
| Bước 1–2 (bộ đọc, script sinh block, migration, kiểm thử) | 1–1,5 ngày |
| Bước 3 (cấu hình AI) | 0,25 ngày |
| Bước 4 (main 0,5; renderer 1; AI + cache + giao diện 1–1,5; kiểm thử 0,5) | 3–3,5 ngày |
| Bước 5, lựa chọn A | khoảng 1 ngày |
| Build và phát hành theo AGENTS.md | 0,5 ngày |
