# Đẩy quản trị viên group vào Nhóm data (UID / SĐT)

21/11/2026. Anh chốt chỉ làm phần đẩy vào Nhóm data, hai loại dữ liệu riêng. Không đẩy thẳng sang chiến dịch.
Bản thiết kế: https://claude.ai/artifact/JkQVnd7UhPekAMqWyrF4TG

## Hành vi

Chiến dịch "Tìm kiếm data bằng search" bật "Lấy thông tin quản trị viên của group" ([FACEBOOK_SEARCH_GROUP_ADMINS.md](FACEBOOK_SEARCH_GROUP_ADMINS.md))
có thêm hai ô, chỉ hiện khi ô đó đang bật:

| Ô | Khoá trong `extra_settings.findDataTargetDataGroups` | Nhóm data chọn được | Mỗi dòng |
|---|---|---|---|
| Đẩy UID quản trị viên sang Nhóm data | `facebook_group_admin_uid` | loại User Facebook | một quản trị viên |
| Đẩy SĐT quản trị viên sang Nhóm data | `facebook_group_admin_phone` | loại Số điện thoại | một số điện thoại |

Hai ô độc lập với nhau. Chúng cũng độc lập với các ô "Đẩy UID Facebook / SĐT / group Facebook sang Nhóm data" và với phần đẩy sang chiến dịch (V608/V614).

**Dòng UID** ([findDataGroupAdminRows.ts](../src/shared/findDataGroupAdminRows.ts)):
- Gộp theo UID trong một lượt: người quản trị nhiều group chỉ ra một dòng.
- Cột chính: tên, UID số, link trang cá nhân.
- Phần thêm: `adminGroups` (các group), `keywords`, `phones`, `emails`, `profileRead`, `sourceProfileKind: 'group_admin'`, cộng dữ liệu nguồn chung (chiến dịch, lượt, data đầu vào).
- Không có UID số thì dùng link.

**Dòng SĐT:**
- Mỗi số di động Việt Nam đã chuẩn hoá là một dòng. Một số dùng chung cho nhiều quản trị viên (hotline group) vẫn ra một dòng.
- Tên của dòng là tên quản trị viên đầu tiên có số đó.
- Phần thêm: `admins` (tên, UID, link, tối đa 20 người), `adminCount`, `adminGroups`, `keywords`.
- Người có hai số ra hai dòng.

**Quy tắc chung:**
- Bỏ chính tài khoản Facebook chạy chiến dịch, so theo `auto_accounts.facebook_uid`. Đọc tài khoản lỗi thì không bỏ ai. Số của tài khoản đó vẫn vào nhóm nếu có quản trị viên khác dùng chung.
- Quản trị viên là Trang (Page) vẫn vào nhóm UID.
- Danh sách trong phần thêm có trần 20.
- Mỗi người chỉ ra ở lượt tìm thấy group đó, vì group đã gặp thì không đọc lại quản trị viên. Data đã có trong nhóm thì DB báo "đã có".

**Đường ghi:** `pushFoundDataToDataGroups` ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts)) gọi `ingestDataGroup` kiểu `scan`, giống các loại khác.
- Mã yêu cầu mang `facebook_person~admin_uid` / `phone~admin_phone`, nên không trùng với lượt đẩy UID / SĐT thường vào cùng một nhóm.
- Khi lỗi mạng, gửi lại cùng mã (`retryFindDataTransient`).
- Hai loại này bị bỏ qua khi chiến dịch không bật `isFindFacebookGroupAdmins`, kể cả khi cài đặt còn giữ khoá.

**Câu tiến trình:**
- `✅ Đã đẩy N quản trị viên group (UID) sang Nhóm data "X" (a mới · b đã có).`
- `✅ Đã đẩy N SĐT quản trị viên group sang Nhóm data "Y" (…).`
- `⚠️ Không thể đẩy …: <lý do>` khi lỗi.
- Lượt không có quản trị viên thì không in gì.

**Câu đối chiếu A↔B:** `scripts/find-data-push/reconcile-prod.sql` (C5) đã bắt lượt nạp nhóm data lỗi hoặc treo, vì mọi mã yêu cầu đều bắt đầu bằng `find-data:`.

## Tạo nhóm ngay trong form

Mọi ô "Đẩy … sang Nhóm data" của chiến dịch tìm data có nút **Tạo nhóm mới**, trừ link group Zalo vì nhóm đó gắn tài khoản Zalo. Nút mở [QuickCreateDataGroupDialog](../src/renderer/src/components/DataGroups/QuickCreateDataGroupDialog.tsx):
- Tên điền sẵn.
- Loại nhóm khoá theo ô (lấy `dataTypeCode` trong `FIND_DATA_GROUP_DESTINATION_CONFIG`).
- Gọi `createDataGroup` có sẵn, kèm một mã yêu cầu cho cả lần mở hộp, nên bấm lại sau lỗi mạng không tạo hai nhóm.
- Tạo xong, ô đó chọn luôn nhóm mới và báo "Đã tạo nhóm data và chọn cho ô này.".
- Tạo lỗi thì hộp giữ nguyên và báo lỗi.

Lý do làm nút riêng: hộp chọn Nhóm data mở từ form có nút "Thêm nhóm", nhưng tạo xong không tự chọn nhóm mới. Loại nhóm cũng để khách tự chọn, chọn sai thì nhóm không hiện trong danh sách.

Form thường và form Agent sửa giống nhau. Bỏ "Lấy thông tin quản trị viên" thì khi lưu, hai khoá này bị xoá (`getFindDataTargetDataGroupsForSave`). AI mục Tìm kiếm không được tắt "Group Facebook" khi một trong hai khoá đang có.

## Không đổi DB

Không có migration. Phần này đi cùng bản build Desktop kế tiếp. Bản Desktop cũ không biết hai khoá mới nên bỏ qua.

## Kiểm thử

- `node scripts/find-data-push/group-admin-data-groups-smoke.cjs [<file dữ liệu thật đã ẩn danh>]`, 13 PASS:
  - hàm dựng dòng: gộp nhiều group, SĐT dùng chung, hai số, bỏ tài khoản chạy, không SĐT, chỉ có link, dữ liệu rỗng, trần 20;
  - lớp `CampaignScheduler` thật với supabase giả: 3 lượt nạp riêng, đúng loại và mã yêu cầu; tắt lấy quản trị viên; chỉ bật SĐT; đọc tài khoản lỗi; lượt không có quản trị viên;
  - dữ liệu thật 21/11: 3 lượt của 2 chiến dịch thử, tên / UID / SĐT thay bằng mã giả ngay trong SQL nhưng giữ chỗ trùng. 65 dòng quản trị viên ra 57 dòng UID (8 người quản trị nhiều group được gộp) và 19 dòng SĐT (12 số khác nhau).
- `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/find-data-push/run-form-group-admin-ui-smoke.cjs`: form thật trên Electron với IPC giả, 10/10:
  - hiện / ẩn theo ô lấy quản trị viên;
  - tạo nhóm UID (loại 38) và SĐT (loại 40), tự chọn;
  - lưu ra hai khoá;
  - bật ô mà chưa chọn nhóm thì báo "Vui lòng chọn Nhóm data nhận UID quản trị viên.".
- Hồi quy: `app-smoke.cjs` 11/11, `run-form-bundle-ui-smoke.cjs` 10/10, hai typecheck sạch, `electron-vite build`.

Chưa làm:
- Chạy thật với tài khoản Facebook và DB thật.
- Kiểm giao diện form Agent: cùng một đoạn sửa như form thường, đã qua typecheck nhưng chưa chạy UI.
