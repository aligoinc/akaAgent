# Lấy thông tin quản trị viên của group (Facebook - Tìm kiếm data bằng search)

## Trạng thái — 18/11/2026

- **V577 đã apply akachat 22:08:23 VN 18/11** theo yêu cầu ("Apply rồi thử thật"; sổ `20261118150822`, md5 sổ = file `74347e2d…`, **không apply
  lại**; block mới id 2922; chỉ dữ liệu, không nạp lại schema; [biên nhận](../migrations/snapshots/engine-facebook-v577/apply-receipt.json)).
- **Thử thật đạt 22:10–22:31 VN 18/11** (app chạy từ source, tài khoản fb LD, chiến dịch 58476 tạo bằng form thật, engine + workflow 319):
  - "bất động sản đà nẵng": 6/6 group, 20 quản trị viên, 12 người có SĐT, 4 người có email, 99 giây; khớp trang Facebook xem tay (nhóm
    607488220217840 đúng 5 quản trị viên, không lấy 2 người kiểm duyệt);
  - chạy lại cùng từ khoá: 6 group đã biết, block thoát sau 3 ms, không mở trang nào;
  - thêm từ khoá "cho thuê căn hộ đà nẵng": 6/6 group, 25 quản trị viên, 142 giây. Khoảng 4,5 giây mỗi trang.
- **V578 đã apply akachat 22:43:05 VN 18/11** theo yêu cầu (anh hỏi "các element mới có lưu vào bảng auto element chưa", rồi "chuyển đi"; sổ
  `20261118154304`, md5 sổ = file `5fe998a9…`, **không apply lại**; [biên nhận](../migrations/snapshots/engine-facebook-v577/apply-receipt-v578.json)):
  chỗ tìm phần tử của block lấy từ 8 element trong `auto_elements` (mục "Element" bên dưới). Thử thật lại 22:44–22:46 VN (chiến dịch 58486, cùng
  từ khoá): 6/6 group, 20 quản trị viên, 96 giây, **từng group và từng người giống hệt lượt V577**.
- Code Desktop ở PR [#718](https://github.com/aligoinc/akaAgent/pull/718) (nhánh `claude/fb-search-group-admins`, mở 18/11, chưa merge), **chưa build Desktop**: khách chỉ có ô chọn khi có bản Desktop mới. Tới lúc đó
  workflow đã có node mới nhưng app không gửi biến nên block thoát ngay.
- Chỉ chạy với engine v2 (workflow 319). Chiến dịch chạy bộ cũ (tài khoản "chạy ngẫu nhiên", `engine.facebook` tắt) thì ô chọn không có tác
  dụng: anh chốt 17/11 không đụng bộ cũ.

## Yêu cầu và quyết định của anh (18/11)

"Search tìm group fb: thêm checkbox: lấy thông tin admin của group: link profile, tên, phone, email". Anh chốt qua hộp chọn:

| Việc | Quyết định |
| --- | --- |
| Lấy ai | Chỉ quản trị viên (không lấy người kiểm duyệt) |
| Số người mỗi group | Lấy hết quản trị viên Facebook hiện |
| Nguồn SĐT / email | Mục "Thông tin liên hệ" của trang cá nhân, tên, và dòng giới thiệu (bio) dưới tên |
| Dùng kết quả | Chỉ xem ở tab "Data tìm được" và xuất Excel; không đẩy sang chiến dịch khác / nhóm data |

## Facebook hiện gì (xem trang thật 18/11/2026, giao diện tiếng Việt)

- `/groups/<nhóm>/members/admins`, group **công khai hoặc đã tham gia**: tiêu đề "Quản trị viên và người kiểm duyệt · N"; mỗi người một
  `[role="listitem"]` có link `/groups/<nhóm>/user/<uid>/` (`aria-label` = tên) và một dòng chữ đúng bằng "Quản trị viên" hoặc "Người kiểm
  duyệt". Quản trị viên có thể là Trang.
- Group **riêng tư chưa tham gia**: cùng địa chỉ nhưng Facebook hiện trang Giới thiệu, chỉ có hàng ảnh đại diện (listitem không chữ, link trang
  cá nhân, tên ở `svg[aria-label]`) và câu "A và 7 thành viên khác là quản trị viên. B là người kiểm duyệt.", không ghi vai trò từng người.
  Không lấy (không đoán theo thứ tự ảnh): `adminScan = not_listed`.
- Trang cá nhân `profile.php?id=<uid>&sk=directory_contact_info` (Facebook tự đổi sang `/<tên riêng>/directory_contact_info/`):
  - không có thẻ `h1` cho tên; vùng tên + số người theo dõi + dòng giới thiệu + hạng mục nằm ngay trước hàng tab của trang cá nhân
    (`[role="tablist"]` đầu tiên trong `[role="main"]`);
  - cột trái của mục Giới thiệu là một `[role="tablist"]` chứa link `.../directory_<mục>`. Chỉ khi người đó để công khai mới có link
    `directory_contact_info`; nội dung ở khối bên phải: "Số điện thoại | 090 322 12 29 | Di động | Email | a@b.com | Email | Số WhatsApp | …";
  - người không công khai: không có mục "Thông tin liên hệ", khối phải trống. Trang cá nhân thường không công khai, Trang thì hay có;
  - nhiều quản trị viên ghi số ngay trong tên ("Mỹ Trinh - 0908.111.404") hoặc dòng giới thiệu ("Hotline: 0903221229"). Số nằm trong ảnh đại
    diện là ảnh, không đọc được.
- `sk=about_contact_and_basic_info` (địa chỉ cũ) trên một số trang bị chuyển về trang cá nhân của chính tài khoản đang đăng nhập: không dùng.

## Cách chạy

1. Form (thường + AI): trong khung "Group Facebook" của điều kiện chạy có ô **"Lấy thông tin quản trị viên của group (tên, link trang cá nhân,
   SĐT, email)"**, lưu ở `extra_settings.isFindFacebookGroupAdmins` (chỉ khi bật tìm link group Facebook).
2. [`buildVariablesV2`](../src/main/services/campaignScheduler.ts) gửi `isFindFacebookGroupAdmins` và `findDataAdminSkipGroupKeys` (các group
   đã lưu ở lượt trước của cùng từ khoá: một lượt đọc `auto_campaign_details` theo data, chỉ khi bật ô này). Group đã biết không đọc lại, vì mỗi
   lượt app chỉ lưu group mới.
3. Workflow 319: node `collect_group_admins` (block `[engine] fb_collect_search_group_admins`) giữa "Tải group" và "Tổng kết". Với từng group
   mới của từ khoá: mở trang quản trị viên (nghỉ 3–5 giây), đọc danh sách (cuộn tới khi đủ số ở tiêu đề), rồi mở trang cá nhân từng quản trị
   viên (nghỉ 2,5–4,5 giây mỗi trang). Một người quản trị nhiều group trong cùng từ khoá chỉ mở trang cá nhân một lần. Chỉ đọc, không bấm gì.
4. Dừng sớm, phần chưa đọc ghi `failed`: gặp trang đăng nhập / xác minh; 3 group liên tiếp không đọc được; 3 trang cá nhân liên tiếp không mở
   được. Lỗi lẻ thì đi tiếp. Không mở được trang cá nhân thì vẫn giữ người đó với SĐT / email viết trong tên (`profileRead: false`).
5. Block tổng kết 2910 cho `adminScan` / `admins` của từng group đi qua; app đọc bằng
   [`readFacebookGroupAdminFields`](../src/shared/facebookGroupAdmins.ts) (chỉ giữ link `facebook.com`, UID số, SĐT / email hợp lệ) rồi lưu
   trong `auto_campaign_details.data.facebookGroups[]`.

Thời gian: mỗi group thêm 1 trang, mỗi quản trị viên thêm 1 trang, khoảng 5–8 giây mỗi trang. 20 group × 4 quản trị viên ≈ 100 trang ≈ 10–13
phút mỗi từ khoá. Không có trần số quản trị viên (anh chọn "Lấy hết").

## Element (V578)

Chỗ tìm phần tử trên trang nằm ở bảng `auto_elements` (category `facebook`, built-in), block đọc bằng `helpers.element()` rồi truyền XPath vào
đoạn chạy trong trang. Facebook đổi giao diện thì sửa XPath ở màn Cài đặt Workflow → Element, không cần migration (app đọc lại bảng khi khởi
động; tên mới thì đọc lại ngay).

| Element | XPath | Dùng để |
| --- | --- | --- |
| `fb_main_region` | `//*[@role='main']` | Chờ trang nạp; lấy chữ trên trang khi không đọc được |
| `fb_group_admin_row` | `//*[@role='main']//*[@role='listitem']` | Dòng của từng người ở trang quản trị viên (group riêng tư chưa tham gia: từng ảnh đại diện) |
| `fb_group_admin_profile_link` | `.//a[contains(@href,'/user/') or contains(@href,'profile.php')]` | Trong dòng: link tới người đó (UID, tên) |
| `fb_group_admin_avatar` | `.//a[@href]//*[local-name()='svg' or local-name()='img']` | Trong dòng: ảnh đại diện (dòng chỉ có ảnh = Facebook không hiện danh sách) |
| `fb_group_admin_heading` | `//*[@role='main']//*[self::h2 or self::h3 or @role='heading']` | Tiêu đề "Quản trị viên và người kiểm duyệt · N" (số người) |
| `fb_profile_tablist` | `//*[@role='main']//*[@role='tablist']` | Các hàng tab của trang cá nhân (hàng đầu: vùng tên + bio đứng ngay trước) |
| `fb_profile_directory_link` | `.//a[contains(@href,'directory_')]` | Nhận ra hàng tab nào là cột trái của mục Giới thiệu |
| `fb_profile_contact_link` | `.//a[contains(@href,'directory_contact_info')]` | Link "Thông tin liên hệ" ở cột trái |

XPath bắt đầu bằng `.` là tương đối (tính từ dòng người, hoặc từ cột trái). Vẫn nằm trong code vì là cách xử lý chứ không phải chỗ tìm phần
tử: nhãn vai trò ("Quản trị viên" / "Admin", "Người kiểm duyệt" / "Moderator"), dạng link `/groups/<nhóm>/user/<uid>/` để lấy UID, cách đi từ
hàng tab ra vùng tên và từ cột trái ra khối liên hệ, quy tắc tách SĐT / email. Thiếu một element trong bảng thì lượt chạy báo lỗi
"Element không tìm thấy: <tên>" (chỉ với chiến dịch bật ô này).

## Hợp đồng dữ liệu

Mỗi phần tử `facebookGroups` có thể mang:

```json
{
  "adminScan": "listed",
  "admins": [
    { "uid": "100072022092879", "name": "Căn hộ cho thuê tại Đà Nẵng", "url": "https://www.facebook.com/canhodichvu43",
      "role": "admin", "phones": ["0903221229"], "emails": ["canhodn43@gmail.com"], "profileRead": true }
  ]
}
```

- `adminScan`: `listed` (đọc được danh sách, `admins` có thể rỗng), `not_listed` (group riêng tư chưa tham gia), `failed` (chưa đọc được).
  Không có trường này = lượt đó không quét (chiến dịch không bật, app / block cũ, group đã có từ lượt trước).
- SĐT: chỉ di động Việt Nam như các block tìm SĐT khác (`0[35789]xxxxxxxx`), nhận `+84` / `84` / dấu cách / chấm / gạch, chuẩn hoá về
  `0xxxxxxxxx`, bỏ trùng; số nằm trong dãy số dài hơn (mã Facebook, giá tiền) và số bàn không tính. Email về chữ thường.
- `url`: `https://www.facebook.com/<tên riêng>` khi trang cá nhân có, không thì `https://www.facebook.com/profile.php?id=<uid>`.

## Hiển thị

- Tab **Data tìm được**: thêm cột "Quản trị viên" (chỉ khi có group đã quét): mỗi người một dòng, tên mở trang cá nhân, SĐT / email đứng sau;
  không có danh sách thì ghi "Facebook không hiện" / "Chưa đọc được".
- **Excel**: sheet nhóm thêm cột "Quản trị viên" (số người hoặc lý do); thêm sheet **"Admin group"**, mỗi quản trị viên một dòng: Tên group,
  Link group, Tên quản trị viên, Link trang cá nhân, UID, Số điện thoại, Email, Từ khóa (nhiều SĐT / email của một người ghi chung một ô).
  Chiến dịch không bật thì file giữ đúng mẫu 14 cột cũ.
- Câu kết quả tìm data thêm một dòng: `Quản trị viên group: 7 người của 3/5 group (4 người có số điện thoại, 1 người có email)`.
- Màn xem chiến dịch: dòng "Lấy thông tin quản trị viên group: Bật / Tắt".

Câu cho khách (anh chưa duyệt từng câu):

| Chỗ | Câu |
| --- | --- |
| Ô chọn | Lấy thông tin quản trị viên của group (tên, link trang cá nhân, SĐT, email) |
| Ghi chú dưới ô chọn | Mở thêm trang quản trị viên của từng group và trang cá nhân của từng người nên chạy lâu hơn. Group riêng tư chưa tham gia thì Facebook không hiện danh sách quản trị viên. |
| Cột / ô khi không có danh sách | Facebook không hiện · Chưa đọc được |
| Kết quả chạy (từng group) | Group "<tên>": 2 quản trị viên, 2 người có số điện thoại, 1 người có email |
| Kết quả chạy | Group "<tên>": Facebook không hiện danh sách quản trị viên của group riêng tư khi chưa tham gia |
| Kết quả chạy | Group "<tên>": chưa đọc được danh sách quản trị viên |

## Migration V577 (đã apply 22:08:23 VN 18/11, không apply lại)

[migration](../migrations/migration_v577_engine_facebook_search_group_admins.sql), [bản gỡ](../migrations/rollback_v577_engine_facebook_search_group_admins.sql);
sinh bằng `node scripts/build-v577-sql.cjs` từ `scripts/facebook-search-groups/v577/*.fragment.js` (bản đóng băng của code đã apply)
và fixture `scripts/fixtures/engine-v2-facebook/v577-live-20261118.json` (đọc production 21:54 VN 18/11). Chỉ dữ liệu, không DDL:

- thêm block `[engine] fb_collect_search_group_admins` (không có dòng danh mục bước: engine coi là bước đọc);
- workflow 319: thêm node `collect_group_admins`, đổi cạnh "Tải group" → node mới → "Tổng kết", thêm biến `isFindFacebookGroupAdmins` (mặc định tắt);
- block tổng kết 2910 (`c78abe7a…` → `0c15da28…`) giữ `adminScan` / `admins`.

App chưa có ô chọn (Desktop ≤ 9.9.0) không gửi biến nên block mới thoát ngay, không mở trang nào. Bộ cũ (workflow 239, block 2723 / 2724) không
đổi; postflight kiểm md5. Bản gỡ trả workflow / block tổng kết về đúng md5 cũ và xoá block mới (không bảng lịch sử nào có khoá ngoại tới
`auto_blocks`). Sau V577, sổ chép (`auto_engine_workflows.engine_md5`)
vẫn ghi md5 lúc chép nên `trace.cjs --drift` báo workflow 319 lệch bản cũ, đúng thực tế.

## Migration V578 (đã apply 22:43:05 VN 18/11, không apply lại)

[migration](../migrations/migration_v578_engine_facebook_group_admin_elements.sql), [bản gỡ](../migrations/rollback_v578_engine_facebook_group_admin_elements.sql);
sinh bằng `node scripts/build-v578-sql.cjs` từ `scripts/facebook-search-groups/*.fragment.js` (bản đang dùng; thêm `dom-xpath.fragment.js`).
Thêm 8 element (id 1798–1805), đổi code block 2922 (`8c90de28…` → `0dbc5efc…`); workflow, block tổng kết, bộ cũ không đổi. Bộ sinh chặn nếu
đoạn chạy trong trang còn `querySelector`, hoặc block gọi element khác danh sách thêm vào bảng. Bản gỡ trả code V577 và xoá 8 element (kể cả
khi XPath đã được sửa ở màn Element).

## Kiểm

| Lệnh | Kết quả 18/11 |
| --- | --- |
| `CHROMIUM_PATH=<Chrome> LC_ALL=C node scripts/facebook-search-groups/admins-smoke.cjs` | PASS 27 nhóm (bản V578 cho kết quả giống hệt bản V577 trên 9 lượt đọc trang; thiếu element thì báo lỗi rõ tên; migration + bản gỡ V577 và V578): tách SĐT / email (trong trang = app), đoạn trong trang trên Chromium với trang giả theo DOM thật, block với page giả (chỉ quản trị viên, nhớ trang đã mở, group đã biết, dừng sớm, huỷ), block tổng kết, bộ đọc của app, migration + bản gỡ + guard trên PG17 |
| `node scripts/facebook-search-groups/export-logic-smoke.cjs` | PASS (thêm nhóm quản trị viên: cột + sheet, gộp group trùng, không bật giữ 14 cột) |
| `node scripts/run-campaign-found-data-export-ui-smoke.cjs` | PASS trên Electron (thêm ca cột Quản trị viên + sheet "Admin group") |
| `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json` | 0 lỗi |

## Chưa làm / chưa kiểm

- Lượt thật chỉ gặp group công khai (12/12): đường `not_listed` (group riêng tư chưa tham gia) và `failed` mới kiểm bằng trang thật xem tay và
  bài kiểm, chưa gặp trong một lượt chạy thật. Chưa bấm Xuất Excel trong app thật (hộp lưu file); phần dựng file kiểm bằng bài kiểm giao diện.
- Chưa có bài kiểm tự động cho ô chọn của form (đã dùng form thật để tạo chiến dịch thử).
- Chưa gặp group có danh sách quản trị viên phải cuộn / bấm "Xem thêm" (các group đã gặp có 1–6 quản trị viên, hiện đủ ngay); block cuộn tới
  khi đủ số ở tiêu đề hoặc 3 lần không thêm ai.
- Giao diện Facebook tiếng Anh chỉ kiểm bằng trang giả (nhãn "Admin" / "Moderator"), chưa xem trang thật.
- Group riêng tư chưa tham gia: không lấy. Nếu muốn lấy thì phải đọc số quản trị viên từ câu "A và N thành viên khác là quản trị viên" và tin
  thứ tự ảnh đại diện (2 group đã xem đều xếp quản trị viên trước), tức là đoán.
- Chiến dịch bật ô này sau khi đã chạy: group đã lưu từ trước không được đọc quản trị viên (chỉ group mới).
- Web / iOS chưa có ô chọn và chưa hiện cột này.
