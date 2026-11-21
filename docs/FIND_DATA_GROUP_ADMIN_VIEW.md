# Data tìm được: xem theo quản trị viên

21/11/2026. Anh yêu cầu: tab "Data tìm được" của chiến dịch tìm group bằng search có hai cách xem, chọn bằng nút radio, mặc định là danh sách group. Cách xem thứ hai là danh sách quản trị viên nối với thông tin group. Xuất Excel ở cách xem này thì ra toàn bộ quản trị viên.
Bản thiết kế: https://claude.ai/artifact/U9Vw8eeHKzB5z2HhsZuArT

Chỉ đổi giao diện Desktop. Không migration, không IPC mới, không thêm lượt đọc DB: bảng dựng từ kết quả chạy tab đã tải sẵn.

## Hiện ở đâu

[CampaignPanel.tsx](../src/renderer/src/components/CampaignPanels/CampaignPanel.tsx), tab Data tìm được. Dòng "Hiển thị" chỉ có ở chiến dịch `facebook_find_data_search` có tìm group: cài đặt `isFindFacebookGroup`, hoặc kết quả đã có group.
- **Danh sách group**: bảng như trước, có ô chọn loại data và nút Xuất Excel.
- **Danh sách quản trị viên**: bật được khi cài đặt `isFindFacebookGroupAdmins` bật, hoặc kết quả đã có group được quét quản trị viên. Nếu không, nút này bị khoá và có câu "Chiến dịch không bật "Lấy thông tin quản trị viên của group"."
- Đổi chiến dịch thì về Danh sách group.

## Bảng quản trị viên

Dòng dựng bằng `buildFoundGroupAdminList` ([foundDataExport.ts](../src/renderer/src/components/CampaignPanels/foundDataExport.ts)). Bảng và file Excel dùng chung hàm này.
- Mỗi dòng là một quản trị viên trong một group. Người quản trị nhiều group thì có nhiều dòng.
- Group trùng giữa các lượt được gộp như file Excel cũ: lấy lượt đọc được danh sách, gộp từ khoá và tài khoản. Lượt sau không đọc lại quản trị viên của group đã gặp, nên không mất người.
- Group đã trộn số liệu từ log chạy (`applyFacebookGroupCard`), nên cột số bài, tham gia đủ như bảng group.
- Cột: Quản trị viên (mở trang cá nhân), UID, Số điện thoại, Email (mỗi số / email một dòng), Trang cá nhân (Đã đọc / Chưa đọc được), Group (tên + link), Thành viên, Bài/ngày, Riêng tư, Tham gia, Từ khóa, Tài khoản, Thời gian.
- Dòng đếm trên bảng: số dòng, số quản trị viên không trùng (theo UID, không có thì theo link), số người có SĐT, số người có email, số group có danh sách / số group đã quét.
- Câu ghi chú khi có group không có trong danh sách: số group Facebook không hiện quản trị viên (riêng tư chưa tham gia) và số group chưa đọc được.
- Bảng chỉ vẽ 1.000 dòng đầu (`FOUND_GROUP_ADMIN_TABLE_LIMIT`), quá thì có câu "Bảng hiện 1.000 dòng đầu trong N dòng; file Excel có đủ.". Lý do: DB thật 21/11 có chiến dịch tìm group tới 18.914 group, lấy quản trị viên ở cỡ đó là hàng chục nghìn dòng.

Dòng giới thiệu dưới tên quản trị viên không có trong bảng vì kết quả chạy không lưu (`readFacebookGroupAdminFields` chỉ giữ tên, link, UID, SĐT, email, đã đọc trang).

## Excel

Nút "Xuất Excel danh sách quản trị viên" gọi `buildFoundGroupAdminWorkbook`, tệp `found-group-admins-<id>-<tên>-<giờ>.xlsx`:
- một sheet "Quản trị viên", không theo ô chọn loại data;
- 15 cột: Tên quản trị viên, UID, Link trang cá nhân, Số điện thoại, Email, Đã đọc trang cá nhân (Có / Không), Tên group, Link group, Số thành viên, Số bài/ngày, Privacy, Trạng thái tham gia, Từ khóa, Tài khoản tìm, Thời gian tìm;
- nhiều SĐT / email của một người nằm chung một ô, cách nhau bằng dấu phẩy;
- kết quả cũ chưa đủ số liệu group thì đọc log chạy trước như nút Xuất Excel cũ.

File Excel ở cách xem group không đổi: sheet "Admin group" 8 cột vẫn có.

## Kiểm thử

- `node scripts/facebook-search-groups/export-logic-smoke.cjs`: thêm nhóm "xem theo quản trị viên" (gộp group trùng, đếm người, group thiếu, file 15 cột, không có ai thì chỉ có dòng tiêu đề).
- `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-campaign-found-data-export-ui-smoke.cjs`: CampaignPanel thật trên Electron với IPC giả.
  - Mặc định group; chuyển sang quản trị viên thì ẩn ô loại data.
  - Bảng đúng dòng / cột, gộp group trùng giữa hai lượt, dòng đếm, câu ghi chú.
  - File Excel đúng 15 cột.
  - Đổi chiến dịch thì về group; khoá khi không lấy quản trị viên; chiến dịch tìm trong group không có dòng chọn.
  - 3.500 quản trị viên: bảng 1.000 dòng, có câu báo, Excel đủ 3.500.
- Dữ liệu thật (scratchpad, không commit): 4 lượt thật có quản trị viên, chạy lại, 800 group thật với người thật từ data quét được, group lặp giữa lượt, 10.000 group × tới 10 người. Bộ kiểm độc lập tự đếm và khớp ở mọi lô. Dựng 55.000 dòng mất 97 ms, file Excel 1,4 giây.

Chưa chạy trên app thật với chiến dịch thật.
