# Lưu DOM của trang khi block Facebook lỗi

20/11/2026. Chỉ áp dụng cho engine v2 Facebook, bộ cũ không đổi.

**Tình trạng (20/11/2026):**
- Code xong ở nhánh `claude/fb-error-evidence`, [PR #739](https://github.com/aligoinc/akaAgent/pull/739) vào `dev_3`, chưa merge, chưa build Desktop.
- Migration [V595](../migrations/migration_v595_desktop_diagnostic_dom.sql) và [bản gỡ](../migrations/rollback_v595_desktop_diagnostic_dom.sql) đã
  viết, **chưa apply**. Sổ đã có V594 (`engine_error_watch_hourly_skip` của phiên khác, apply 20/11); kiểm lại sổ ngay trước khi apply.
- Bộ kiểm đã chạy:
  - `screenshots-smoke.cjs` 10/10 nhóm, PG17 với V595 thật: DB chưa có V595, đã có V595, các trường hợp bị từ chối, bản gỡ;
  - `desktop-fb-smoke.cjs` 38/38;
  - `electron-real-smoke.cjs` 6/6, Chromium thật;
  - `scenarios.cjs --seeds 8`: không vi phạm bất biến nào;
  - hai typecheck 0 lỗi.

## 1. Anh yêu cầu

Làm giống ảnh lỗi. Block lỗi thì hôm nay chụp một ảnh; giờ lưu thêm DOM của cả trang ngay lúc đó. Khi cần tìm nguyên nhân thì lấy cả DOM
lẫn ảnh để tìm cho chính xác.

## 2. Hôm nay

- **Ảnh lỗi:**
  - Chụp khi block ném lỗi hoặc trả `ok: false`.
  - Trần: 3 ảnh mỗi lượt data, 5 ảnh mỗi mã lỗi mỗi chiến dịch mỗi giờ.
  - Lưu trên máy khách: `engine-screenshots/<ngày>/<mã>.jpg` và tệp mô tả `<mã>.json`, giữ 14 ngày hoặc 1 GB (Q14).
  - Chỉ gửi lên máy chủ khi có yêu cầu chẩn đoán (Q12, V556). Ảnh gửi lên nằm ở bảng `auto_desktop_diagnostic_files`, giữ 7 ngày.
- **DOM:** không lưu ở đâu cả.

## 3. Làm gì

### 3.1 Lấy DOM cùng lúc, cùng điều kiện với ảnh

- Ngay sau khi chụp ảnh lỗi (`afterNode` trong `src/main/services/campaignScheduler.ts`), đọc DOM cả trang
  (`document.documentElement.outerHTML`) của chính trang đó.
- Dùng chung trần với ảnh. Đọc trong trang tối đa 2 giây, quá thì bỏ, giống bước đọc chữ trên trang hiện có.
- Ảnh và DOM độc lập: chụp ảnh hỏng thì vẫn lưu DOM nếu đọc được, và ngược lại.
- Chỉ bỏ những thứ sau, vì lý do an toàn:
  - `script`: có mã phiên đăng nhập Facebook của khách. Ai có tệp chứa mã này là vào được tài khoản.
  - `style`: chỉ là CSS, rất nặng, không giúp tìm lỗi.
  - Giá trị của ô ẩn (`input[type="hidden"]`): đo trên trang thật, sau khi bỏ `script` vẫn còn ô ẩn `h` (mã đăng xuất) và `ref`.
- Kiểm trên trang thật 20/11: sau khi bỏ ba thứ trên, DOM không còn `fb_dtsg`, `lsd`, `jazoest`, mã `EAAG…` hay `access_token`.

### 3.2 Lưu cạnh ảnh, cùng mã

- Lưu tệp `<mã>.dom.html.gz` (nén gzip) cạnh `<mã>.jpg`. Tệp `<mã>.json` ghi thêm có DOM hay không và cỡ.
- Bộ dọn 14 ngày / 1 GB hiện có quét mọi tệp trong thư mục, nên tự dọn luôn tệp DOM.
- Tín hiệu lỗi vẫn ghi `screenshotId` bằng mã đó, như hôm nay. Bộ kiểm lỗi trên cloud (V588, V593) không phải đổi gì.

### 3.3 Gửi lên khi có yêu cầu

- Yêu cầu chẩn đoán gửi ảnh nào thì gửi kèm DOM của ảnh đó, cùng `image_id`.
- Migration V595 chỉ thêm đối tượng mới; không đổi bảng hay hàm của V556, không đổi hàm tick V593:
  - **bảng riêng** `auto_desktop_diagnostic_doms`: DOM nén gzip, ≤ 2 MB, giống ảnh JPEG; RLS; chỉ service_role đọc; xoá cùng yêu cầu sau 7
    ngày;
  - `aka_agent_desktop_diagnostic_dom_upload_v1`: Desktop gửi một tệp DOM gzip (mã base64), kiểm 2 byte đầu `1f8b`, tối đa 50 DOM mỗi yêu cầu,
    các bước kiểm khác giống hàm gửi ảnh;
  - `aka_agent_desktop_diagnostic_doms_v1`: chỉ đọc, service_role, trả gzip mã base64. Người đọc lưu ra tệp rồi giải nén.
- **Vì sao không thêm vào bảng ảnh:** V593 đếm số dòng của bảng ảnh để báo "ảnh đã về: N ảnh" và tính trần dung lượng theo cỡ bảng ảnh. Thêm DOM
  vào đó thì hai số này sai.
- **Vì sao gửi dạng nén:** đúng bản anh duyệt. Lúc code em có thử gửi dạng chữ cho tiện tìm bằng SQL, nhưng đo 20/11 (mục 4.1) thấy gửi request
  lớn lên Supabase rất chậm:
  - DOM dạng chữ 270–460 KB mất khoảng 8–16 giây; trang đã cuộn có thể không gửi xong trong hạn 60 giây;
  - DOM đã nén 50–80 KB chỉ mất 1–2,5 giây.

  Postgres không giải nén được gzip, nên không tìm thẳng trong DOM bằng SQL được.
- DB chưa có V595 (hoặc đã gỡ) thì Desktop bản mới chỉ gửi ảnh như cũ (`skipped` ghi `dom_rpc_missing`). Bản Desktop cũ không đổi gì.
- `docs/FB_ERROR_WATCH_TASK.md` mục 7 đã thêm cách đọc DOM.

## 4. Số đo trên Facebook thật (20/11/2026)

Đo bằng trình duyệt trong app Claude, tài khoản thử Lee Danh. Mở trang, chờ vài giây, không cuộn.

| Trang | DOM gốc | Bỏ `script`, `style` | Sau gzip | Thời gian |
|---|---|---|---|---|
| Trang chủ | 4,9 MB | 425 KB | 50 KB | 4 ms |
| Trang nhóm "Nhóm private 1" | 4,5 MB | 710 KB | 77 KB | 10 ms |

- DOM gốc to chủ yếu vì `script`.

### 4.1 Kiểm thêm ngày 20/11 (anh: "Làm 1–3")

**1. Trang treo đúng lúc đọc DOM.** Thêm ca vào `desktop-fb-smoke.cjs`, chạy đạt 38/38 nhóm:
- sau 2 giây bỏ DOM, vẫn có ảnh;
- lượt chạy xong, kết quả lỗi như trước.

**2. Quét mã phiên trên DOM thật.**
- Cách làm: chạy đúng `PAGE_DOM_SCRIPT` trên Facebook thật bằng trình duyệt trong app, tài khoản thử, chỉ đọc. Tìm `fb_dtsg`, `EAA…`,
  `access_token`, `jazoest`, `lsd`, `DTSG`, `c_user`, `xs=`, `"token":"…"`, `session_key`, ô mật khẩu, chữ `token`.
- Kết quả trên 5 trang:

  | Trang | DOM sau khi rút gọn | Chuỗi giống mã phiên | Ô ẩn còn giá trị | `script` |
  |---|---|---|---|---|
  | Trang chủ | 322 KB | 0 | 0 | 0 |
  | Trang nhóm | 386 KB | 0 | 0 | 0 |
  | Trang nhóm, đang mở hộp đăng bài | 435 KB | 0 | 0 | 0 |
  | Trang cá nhân | 461 KB | 0 | 0 | 0 |
  | Hộp thư Page (Business Suite) | 270 KB | 0 | 0 | 0 |

- Trang gốc của hộp thư Page có 6 chỗ `fb_dtsg` / `DTSG`, đều nằm trong `script` và đã bị bỏ.
- Mở hộp thư Page thì Business Suite tự mở lại cùng một hội thoại, như lần đo trước.

**3. Tốc độ gửi lên Supabase.** Gửi từ máy dev tới hàm có thật (`upload_v1`), bị từ chối quyền nên không ghi gì; hàm không tồn tại cho kết quả
tương tự.

| Cỡ request | Thời gian |
|---|---|
| 1 KB | 1,7 giây |
| 100 KB (cỡ DOM đã nén, đã chuyển base64) | 0,9–2,5 giây |
| 0,5 MB | 7–16 giây |
| 1,5 MB | 47 giây, có lần quá 90 giây chưa gửi xong |

- Cùng mạng đó, gửi 1,5 MB tới máy chủ đo tốc độ của Cloudflare chỉ mất 0,4 giây. Vậy chậm nằm ở đường vào Supabase, không phải mạng máy dev.
- Cổng không chặn theo cỡ: 0,5 và 1,5 MB đều tới được PostgREST. Chỉ là gửi chậm, càng to càng chậm hơn tỉ lệ.
- Hệ quả:
  - DOM dạng chữ (270–460 KB) mất khoảng 8–16 giây mỗi cái; DOM 1–2 MB (trang đã cuộn) có thể quá hạn 60 giây;
  - DOM đã nén (50–80 KB) chỉ mất khoảng 1–2,5 giây.

  Vì vậy V595 và Desktop gửi DOM dạng nén, đúng bản anh duyệt (mục 3.3). Bộ kiểm ảnh/DOM chạy lại đạt 10/10.
- Trang đã cuộn (vòng comment, lướt newsfeed) có nhiều bài hơn nên DOM sẽ to hơn. Tệp gzip quá 2 MB thì không gửi lên được; trường hợp này
  hiếm.
- Trên máy khách: mỗi lần lỗi có ảnh thêm khoảng 50–80 KB, dùng chung trần 14 ngày / 1 GB với ảnh (mỗi ảnh khoảng 100 KB).

## 5. Riêng tư

- DOM cả trang có cả những phần không hiện trong ảnh: thanh bên (danh bạ, tin nhắn riêng), hộp Thông báo đang ẩn (tên và hoạt động của
  người khác), các bài trong feed.
- Xử lý giống ảnh: chỉ nằm trên máy khách, chỉ gửi lên khi có yêu cầu (Q12), không báo khách (Q13).

## 6. Code

- `src/main/engineAdapters/facebook/errorScreenshots.ts`:
  - `PAGE_DOM_SCRIPT` đọc DOM cả trang;
  - `gzipErrorDom` nén DOM;
  - `saveErrorEvidence` lưu ảnh và / hoặc DOM cùng một mã; `saveErrorScreenshot` giữ nguyên tên, gọi qua hàm này;
  - `findErrorEvidence` tìm cả ảnh lẫn DOM; `findErrorScreenshots` (AI đọc ảnh Q11) vẫn chỉ trả mã có ảnh.
- `src/main/services/campaignScheduler.ts` (`afterNode`): `readFacebookPageDom` đọc DOM ngay sau khi chụp ảnh, trong cùng trần.
- `src/main/engineAdapters/facebook/diagnosticsResponder.ts`: gửi DOM qua `dom_upload_v1` sau ảnh. Kết quả yêu cầu ghi thêm `doms`, `domIds`.
- Migration V595 và bản gỡ; `docs/FB_ERROR_WATCH_TASK.md` mục 7.

## 7. Kiểm thử

- `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-facebook/screenshots-smoke.cjs` (10 nhóm, PG17 cục bộ, V595 thật):
  - lưu ảnh + DOM cùng mã; chỉ có DOM vẫn lưu được;
  - AI đọc ảnh (Q11) chỉ lấy mã có ảnh;
  - DB chưa có V595 thì vẫn gửi ảnh như cũ;
  - V595: gửi cả hai; bảng ảnh chỉ có ảnh; DOM giải nén ra đúng từng chữ; đọc qua hàm chỉ đọc rồi giải nén;
  - quyền: Desktop chỉ gọi được hàm gửi, không đọc được DOM;
  - các lý do từ chối: không phải HTML, quá 2 MB, chưa đăng nhập, yêu cầu của nhân viên khác, yêu cầu đã đóng, quá 50 DOM; gửi lại không
    nhân đôi;
  - gỡ V595 rồi apply lại được;
  - bộ dọn 14 ngày / 1 GB.
- `CHAT_REPO=… LC_ALL=C node scripts/engine-v2-facebook/desktop-fb-smoke.cjs` (38 nhóm):
  - block lỗi thì có ảnh và DOM cùng mã, tệp DOM đọc lại đúng;
  - đọc DOM lỗi thì vẫn có ảnh như trước, kết quả lỗi không đổi;
  - trang treo đúng lúc đọc DOM: bỏ DOM sau 2 giây, vẫn có ảnh, lượt chạy xong.
- `node scripts/engine-v2-facebook/electron-real-smoke.cjs` (6 nhóm, Chromium thật, trang giả có mã phiên giả trong script, JSON và ô ẩn):
  - DOM không còn `script`, `style`, mã phiên, giá trị ô ẩn; còn đủ phần còn lại (cả thanh bên);
  - trang thật không bị đổi;
  - gzip đọc lại đúng.
- Worktree mới cần `ln -s <repo chính>/node_modules node_modules` trước khi chạy bộ kiểm Electron.

## 8. Triển khai

- Apply migration trước, ngoài giờ cao điểm (đổi bảng làm PostgREST nạp lại schema). Sau đó mới phát hành bản Desktop (anh build, anh
  phát hành).
- Máy khách chưa cập nhật thì vẫn chỉ có ảnh như hôm nay.

## 9. Ngoài phạm vi

- Vết thao tác bị bỏ với các lỗi có dòng lịch sử (lệch Q15; xem pitfall "Engine FB không lưu DOM" trong CLAUDE.md): việc riêng, chưa làm.
- Chụp ảnh / lưu DOM cả khi block tự báo mã lỗi (FB40, FB41…): anh để sau.
