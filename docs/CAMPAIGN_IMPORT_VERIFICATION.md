# Kiểm tra và xuất kết quả Upload dữ liệu Desktop — 21/10/2026

## Phạm vi

Form `CampaignDataUploadModal` dùng chung cho tạo/thêm dữ liệu chiến dịch,
Nhóm data và Kiểm tra SĐT. Chỉ thay luồng đọc/kiểm tra và báo cáo trong Desktop;
không sửa Web, SQL, runtime gửi tin, chuẩn hóa SĐT toàn hệ thống hoặc đồng bộ
Google Sheet nền. Không thêm lịch sử nhập vào DB, truy vấn trùng với đích,
connection hay polling. Giữ các sink lưu/chèn và hạn mức Kiểm tra SĐT hiện có.

## Hợp đồng kết quả

`src/shared/campaignImportVerification.ts` cung cấp `ImportVerificationResult`:

- `valid`: dữ liệu chuẩn hóa, đủ điều kiện nhập theo hành động, giữ dòng đầu của
  mỗi khóa người nhận.
- `rejected`: dữ liệu sai/thiếu hoặc bị bỏ theo lựa chọn nhiều SĐT, có lý do.
- `duplicates`: dữ liệu đúng nhưng đã có cùng khóa sau chuẩn hóa trong lần
  upload, có tham chiếu dòng/mục được giữ. Không so với dữ liệu đích.
- `sourceRowCount`: số dòng nguồn có dữ liệu, không tính tiêu đề bị bỏ hoặc
  dòng hoàn toàn trống; TXT phân cách nhiều số trên một dòng vẫn là một dòng nguồn.
- `itemCount = valid.length + rejected.length + duplicates.length`.
- `limitExceeded`: hơn 10.000 mục hợp lệ sau tách; giữ đầy đủ báo cáo nhưng chặn chèn.

Giới hạn 10.000 dòng nguồn được kiểm tra trước khi phân loại. Không tự cắt dữ liệu.
Mỗi mục có ID, nguồn, sheet, dòng/mục gốc, thông tin ban đầu, thông tin chuẩn hóa,
lý do và tham chiếu trùng nếu có. Không có dòng hợp lệ vẫn hiện báo cáo, xem và
tải được nhóm bị loại. “Hợp lệ” không khẳng định số có Zalo/email tồn tại hoặc
đã lưu thành công vào đích.

Giao diện hiện ba nhóm với số đếm trực tiếp từ kết quả, phân trang 100 mục/nhóm.
Chèn luôn dùng toàn bộ `valid`, không lấy riêng trang đang xem. Chỉ tải nhóm có dữ liệu:

| Nhóm | Tên file | Cột bổ sung |
| --- | --- | --- |
| Hợp lệ | `du-lieu-hop-le-{timestamp}.xlsx` | Nguồn, sheet, dòng/mục gốc, giá trị gốc/hiển thị/chuẩn hóa |
| Bị loại | `du-lieu-bi-loai-{timestamp}.xlsx` | Các cột truy vết và Lý do |
| Trùng | `du-lieu-trung-{timestamp}.xlsx` | Các cột truy vết, Lý do và Trùng với dòng |

Cả ba file mở đầu bằng `Fullname, Uid, Mobile, Email, Info1…Info5`. File hợp lệ
dùng giá trị chuẩn hóa để nhập lại qua template; hai file còn lại giữ thông tin
của mục bị loại để đối chiếu. Giá trị gốc giữ cả ô trước tách. Tất cả ô xuất là
chuỗi, bảo toàn số 0 đầu/UID dài/mã Info và không biến chuỗi bắt đầu bằng `=`
thành công thức. Xuất dùng `xlsx` hiện có, không đọc lại Sheet/gọi AI/ghi DB.
Nội dung quá dài cho một ô Excel được lưu theo từng phần ở sheet **Nội dung dài**;
bảng kết quả giữ tham chiếu ngắn. Các dòng kết quả và chín cột đầu không đổi vị trí.
Importer tự ghép lại khi nhập báo cáo này; xem chi tiết bản sửa review bên dưới.

Giao diện thu gọn chọn sheet/trạng thái template và ba nhóm kết quả, mỗi nhóm
vẫn có nút tải Excel riêng. Khung lựa chọn nhiều SĐT giữ tiêu đề đầy đủ, ba
lựa chọn nằm cùng hàng với **Lấy SĐT hợp lệ đầu tiên** đứng đầu và được chọn
mặc định. Phần chọn cột và bảng nguồn có khoảng cách rõ ràng; sheet/checkbox
tự xuống hàng ở cửa sổ hẹp. Bảng **Hợp lệ** ẩn cột Nguồn / dòng gốc; bảng
**Lỗi/Trùng** và cả ba file Excel vẫn giữ tên file, sheet, dòng gốc. Kiểm tra
Electron ở chiều rộng 1280/900/520 px xác nhận bố cục không tràn ngang, các
lựa chọn vẫn hoạt động và xuất Excel giữ đủ thông tin truy vết.

## Quy tắc đọc và chuẩn hóa

`campaignImportWorkbook.ts` giữ đồng thời giá trị gốc và định dạng hiển thị.
Cột SĐT/UID đọc giá trị gốc, Tên/Info đọc phần hiển thị (ngày tháng, phần trăm,
mã có số 0 đầu...). CSV được đọc cấu trúc và giữ text trước khi tách ô SĐT;
nhận BOM UTF-8/UTF-16LE/UTF-16BE, không tách hàng CSV bằng dấu phẩy. UID Zalo vẫn đi qua bộ kiểm tra hiện có,
không nhận số nguyên ngoài miền chính xác của JavaScript.

Chuẩn hóa SĐT mới chỉ nằm trong importer. Nhận các dạng `840…`, `+84 (0)…`,
`084…` đủ độ dài; SĐT nội địa 10 chữ số bắt đầu `084` giữ nguyên. Nhận số nguyên
có đuôi `.0`. Chuỗi khoa học chỉ chuyển khi không phải bổ sung chữ số chưa
được cung cấp; ví dụ `8.49123E+10` bị loại với lý do cần nhập số đầy đủ, còn
số Excel gốc `84912345678` dù hiển thị rút gọn vẫn dùng được. Không ghép các
cụm số có chữ/ghi chú xen giữa thành một SĐT. Nhãn tên trước số hoặc chú thích
không chứa số ở cuối tiếp tục được xử lý như trước.

Đối với Excel khách hàng, template và Link sheet, chỉ tách ô đã chọn là SĐT
bằng `,` hoặc `;`. Mỗi lần mở form mặc định **Lấy SĐT hợp lệ đầu tiên**:

1. **Bỏ dòng có nhiều SĐT:** mọi phần không rỗng bị loại theo lựa chọn.
2. **Lấy SĐT hợp lệ đầu tiên:** phần sai vào nhóm lỗi; giữ số đúng đầu tiên;
   các số đúng phía sau bị loại theo lựa chọn. Nếu số đầu trùng, không chuyển
   sang số phía sau.
3. **Lấy tất cả:** mỗi số đúng thành một mục, sao chép Tên/Info, sau đó lọc trùng.

TXT lấy tất cả mục phân cách bởi xuống dòng/dấu phẩy, thêm dấu chấm phẩy cho
SĐT. TXT có tab mở bước chọn cột và giữ thông tin đi kèm. TXT không chịu lựa
chọn lấy số đầu của Excel. Dòng tiêu đề TXT chỉ tự bỏ khi khớp nhãn trường bắt
buộc, có checkbox cho người dùng đổi.

Excel/template chọn một sheet mỗi lần, mặc định sheet đầu; không gộp sheet.
Gợi ý mapping theo nhãn rõ ràng, không tự gán Mã căn/Ghi chú vào Info. Nếu không
có tiêu đề, chỉ gợi ý cột đích khi có một ứng viên tốt nhất; không bỏ dòng đầu.
Cột bắt buộc chưa xác định chặn verify. Preview giữ số dòng gốc.
Template giữ cấu trúc chín cột, tự kiểm tra sau khi tải/đổi sheet/đổi lựa chọn.
Sai mẫu có thể chuyển bảng đã đọc sang Excel khách hàng mà không đọc lại file.

## IPC và vòng đời

Hai IPC Sheet/Ảnh nhận tùy chọn `responseMode: 'source'`:

- Sheet trả `ImportTableSource` gồm các bảng với raw/display và số dòng gốc;
  quyền phiên, URL export Google Sheet, timeout HTTP 30 giây và kiểm tra HTML
  vẫn dùng nhánh hiện có. Google Sheet dạng URL được export CSV của `gid` đã chọn.
- Ảnh trả `ImportImageSource` từ các mục AI cung cấp trước lọc lỗi/trùng.
  Báo cáo chỉ bao phủ những mục này; không thể đếm phần AI chưa nhận diện.
  QR link nhóm Zalo vẫn ưu tiên giải mã cục bộ như trước.
- Không truyền tùy chọn vẫn trả mảng đã chuẩn hóa/lọc theo hợp đồng legacy.
  Shared request types và preload được cập nhật cùng form.

Đổi tab, dữ liệu nguồn, sheet, mapping, checkbox tiêu đề, lựa chọn nhiều SĐT
hoặc action làm mất hiệu lực báo cáo cũ. Revision nguồn và operation ID chặn
success/error/finally cũ sau đổi action hoặc đóng/mở modal. Bảng Sheet đã đọc
được dùng lại khi đổi mapping/verify/export. Báo cáo chỉ tồn tại trong modal.

## Kiểm chứng

Các fixture và dịch vụ giả lập chạy local; không gọi AI thật, không gửi tin và
không ghi DB khách hàng.

- `node scripts/campaign-import-verification-smoke.cjs`: **56 ca đạt**, gồm bộ
  30 dạng SĐT, số khoa học raw/display, ghi chú nhiều cụm số, `.0`, `084`, ba
  chế độ, dòng đầu trùng, giữ metadata, TXT/CSV/TSV, tiêu đề, UID dài, ba XLSX
  round-trip, template nhập lại, ô text và mốc 10.000/10.001.
- `node scripts/campaign-import-ui-smoke.cjs`: **đạt**, Electron chạy form thật
  ở cả năm tab, chọn sheet/cột, ba nhóm/file, zero valid, pagination 251 mục,
  chèn toàn bộ, tiêu đề TXT, fallback template, không fetch lại Sheet/AI khi
  xuất, phản hồi success/error muộn, đổi action trong cùng modal và hai giới hạn.
- `node scripts/zalo-group-member-uid-smoke.cjs`: **đạt**, hồi quy IPC legacy/source,
  năm nguồn UI, UID dài/unsafe, Info hiển thị, tạo và thêm dữ liệu chiến dịch.
- `node scripts/run-zalo-phone-check-ui-smoke.cjs`: **đạt**, hồi quy 600 dòng, hạn mức
  upload, account kế thừa, QR/Web/Server, kết quả usage muộn, chèn/xuất/lưu nhóm,
  dừng/chạy tiếp.
- `node scripts/google-sheet-sync-smoke-test.cjs`: **đạt**, hồi quy đồng bộ Sheet nền.
- `node scripts/zalo-phone-input-identity-smoke-test.cjs`: **đạt**, hồi quy định danh SĐT.
- Hai typecheck `tsconfig.node.json`, `tsconfig.web.json` sạch.
- `npm run build`: **đạt**, main/preload/renderer xuất thành công; còn các cảnh
  báo Vite về module vừa import tĩnh vừa import động, không lỗi build.
- `git diff --check`: sạch; đã xem ảnh giao diện Electron sau khi sửa CSS.

Desktop cần chạy bản source/build mới để có giao diện này. Không migration,
không yêu cầu nâng Server cho riêng thay đổi importer này; chưa đóng gói/phát hành.

## Sửa ba finding review — 21/10/2026

1. **Ảnh mất alias:** adapter source chọn trường theo đúng thứ tự của từng action
   trong IPC cũ, bao gồm `zaloGroupLink`, `zalo_group_link`, `facebookGroupLink`,
   `facebook_group_link`, `group`, `tu khoa` và fallback `name`. Mục AI có nội dung
   nhưng không có trường nhận diện được vẫn vào nhóm bị loại, giữ JSON nguồn ở
   Giá trị gốc để đối chiếu; chỉ bỏ mục hoàn toàn trống. Nhánh IPC legacy giữ nguyên.
2. **Link CSV UTF-16 bị hỏng:** reader nhận BOM trước khi giải mã và vẫn đọc text
   `raw: true`. Cùng đường đọc áp dụng cho CSV tải file và Link sheet; không đoán
   encoding ngoài UTF-8 khi nguồn không có BOM. SĐT/UID dài, dấu tiếng Việt và
   nội dung CSV có dấu phẩy trong ô vẫn giữ nguyên.
3. **Excel lỗi khi ô nguồn dài:** exporter dùng sheet `Nội dung dài` cho chuỗi
   vượt 32.767 đơn vị UTF-16; mỗi chuỗi chỉ lưu một lần trong file, chia phần
   không cắt giữa surrogate pair. Sheet chính dùng `[Nội dung dài: ND…]`;
   số dòng trong sheet kết quả vẫn bằng số mục của nhóm. Cách này áp dụng cả
   truy vết và các cột Tên/Info dài, không cắt mất nội dung.

Báo cáo có phần dài mang custom property `akaAgentImportLongText=1`. Reader chỉ
giải tham chiếu khi có marker này; kiểm tra header, thứ tự/tổng phần và độ dài
trước khi ghép. Thiếu sheet, thiếu tham chiếu hoặc thiếu phần phải báo lỗi,
không nhập chuỗi tham chiếu hay nội dung bị cắt. Sheet phụ không hiện như một
sheet nguồn để nhập. Chuỗi dữ liệu thật trùng cú pháp tham chiếu cũng được lưu
riêng, nên không bị thay nhầm. Khi nhập lại cần giữ file đầy đủ gồm sheet phụ
và metadata; file thông thường không có marker giữ nguyên cách đọc cũ.

Kiểm chứng local bổ sung:

- `node scripts/campaign-import-review-smoke.cjs`: **đạt** — 29 alias qua IPC
  thật với AI mock, đối chiếu legacy/source, giữ mục lạ và trace; bốn encoding
  qua IPC/reader; 3.000 SĐT/ô xuất cả ba nhóm; ghép lại đủ nội dung và không lặp
  chuỗi dài trên hàng nghìn dòng; biên 32.767/32.768, Unicode, công thức dạng
  text, chuỗi giống tham chiếu, Tên/Info dài nhập lại qua template, lỗi thiếu
  sheet/sai thứ tự/mất phần cuối.
- `node scripts/campaign-import-ui-smoke.cjs`: **đạt** thêm ca Electron alias
  ảnh/fallback tên/mục lạ, CSV UTF-16, xuất ba nhóm từ ô 3.000 số và nhập lại
  file hợp lệ qua template; giữ các ca năm tab/phân trang/đổi action/kết quả muộn.
- 56 ca `campaign-import-verification-smoke.cjs` và hồi quy
  `zalo-group-member-uid-smoke.cjs` tiếp tục đạt.
- `run-zalo-phone-check-ui-smoke.cjs` đạt với 600 dòng; cả hai typecheck
  `tsconfig.node.json`/`tsconfig.web.json`, production build Desktop và
  `git diff --check` đều đạt sau sửa review. Build chỉ còn các cảnh báo Vite
  import tĩnh/động đã ghi ở trên.

Không đổi Web, SQL, runtime gửi tin hay nhánh IPC legacy; chưa đóng gói/phát hành.

## Sửa UID khoa học và dấu phân cột CSV — 21/10/2026

- **UID khoa học:** nhánh UID thông thường của importer chuyển chuỗi khoa học
  đủ chữ số bằng thao tác chuỗi trước khi lọc trùng. Ví dụ
  `1.00123456789012E+14` và `100123456789012` là cùng một người nhận. Không đi
  qua `Number` cho phần chữ số, nên UID text 30 chữ số vẫn nguyên vẹn. Chuỗi
  phải thêm chữ số chưa cung cấp, giá trị không nguyên/âm và số JavaScript
  ngoài miền chính xác vào nhóm lỗi với lý do; giữ nguyên giá trị nguồn.
  Parser khoa học dùng chung với SĐT trong importer, không đổi chuẩn hóa runtime.
  Giữ bộ kiểm tra UID Zalo hiện có: không tự nới để nhận chuỗi khoa học; link
  và từ khóa cũng không bị chuyển thành số.
- **CSV nhiều SĐT:** reader chọn dấu phân cột từ tối đa 50 hàng CSV hoàn chỉnh,
  chỉ xét dấu ngoài ô có nháy kép, rồi truyền `FS` cho `xlsx` đọc cấu trúc.
  Bản đầu yêu cầu dấu phân cột xuất hiện ở hàng đầu có nội dung; quy tắc này
  được thay bằng nhận diện header/cấu trúc phía sau dòng mô tả trong bản sửa
  tiếp theo bên dưới. Nhận `sep=` và giữ
  hỗ trợ comma/semicolon/tab, BOM, nháy kép lồng và xuống dòng trong ô.
  CSV `Tên,SĐT` với ô `0900000000;0900000001;0900000002;0900000003` giữ đủ bốn
  số cho bộ verify, không biến dấu chấm phẩy thành cột mới. Cùng reader dùng
  cho file và Sheet source; không đổi nhánh Sheet legacy.
- **CSV mơ hồ:** nếu nhiều dấu có cùng mức nhất quán, dừng đọc và hướng dẫn
  thêm tiêu đề rõ ràng, đặt ô chứa dấu phân cách trong nháy kép hoặc dùng XLSX.
  Ví dụ một hàng không có tiêu đề chứa cả comma và semicolon chưa đủ căn cứ
  chọn cấu trúc. Không tự chọn một cột rồi bỏ các số ngoài cột đó.

Kiểm chứng local bổ sung trong `campaign-import-review-smoke.cjs`: CSV file và
IPC Sheet, ba dấu phân cột, nháy kép/xuống dòng, `sep=`, nguồn không tiêu đề và
nguồn mơ hồ, cả ba lựa chọn nhiều SĐT; UID khoa học chính xác/thiếu chữ số,
UID dài, tham chiếu trùng, năm loại nguồn, IPC ảnh đối chiếu legacy và Sheet,
ba file xuất/nhập lại template, hồi quy UID Zalo/link/từ khóa. Ca 3.000 SĐT/ô
CSV nay dùng ô không có nháy kép quanh dấu chấm phẩy để bao phủ lỗi thực tế.

Smoke Electron bổ sung xác nhận CSV chèn đủ bốn số cùng Tên, chặn CSV mơ hồ,
UID chỉ chèn một dòng sau lọc trùng và vẫn xuất riêng hợp lệ/lỗi/trùng với
đúng lý do/tham chiếu; file hợp lệ nhập lại template được.

Kết quả sau sửa: review smoke và UI Electron **đạt**; 56 ca verifier, hồi quy
UID Zalo, Kiểm tra SĐT 600 dòng, Google Sheet sync và định danh SĐT **đạt**.
Cả hai typecheck sạch; production build Desktop **đạt** (main 1,55 giây,
renderer 24,45 giây), chỉ còn cảnh báo Vite import tĩnh/động hiện có.
`git diff --check` sạch. Toàn bộ kiểm thử dùng fixture local, không gọi AI thật
hoặc ghi dữ liệu khách hàng.

Không đổi Web, SQL, runtime gửi tin hay nhánh IPC legacy; chưa đóng gói/phát hành.

## Sửa số 0 của UID khoa học và CSV có dòng mô tả — 21/10/2026

- Chỉ kết quả chuyển từ dạng khoa học được bỏ số 0 không có ý nghĩa ở đầu:
  `0.100123456789012E+15`, `000.100123456789012E+15` và
  `100123456789012` cùng khóa người nhận. Giữ truy vết chuỗi nguồn, không qua
  `Number` cho phần chữ số; UID nhập sẵn `0100123456789012` giữ nguyên. Áp dụng
  kiểm tra số nguyên/đủ chữ số trước khi bỏ 0; không nới bộ kiểm tra UID Zalo.
- CSV ưu tiên header nhận diện được trong 20 bản ghi đầu của mẫu 50 bản ghi,
  dùng cùng bộ alias với importer; dò header trên bản ghi tối đa 4.096 ký tự
  để không phân tích lặp các ô dữ liệu dài. Đây là giới hạn dò header, không
  cắt hay giới hạn nội dung nhập. Dòng mô tả, dòng rỗng hoặc ô rỗng `""` trước
  header không ép dấu phẩy. Khi không có header rõ, xét số cột dương lặp lại
  nhiều nhất trên mẫu; nhiều ứng viên ngang nhau vẫn báo CSV mơ hồ.
- Header một cột SĐT giữ các dấu chấm phẩy trong ô dữ liệu. Cột đầu/cuối chưa
  đặt tên không làm header một trường bị nhận nhầm thành bảng một cột; dấu
  ở dòng mô tả không thắng header bảng bên dưới. Việc dò dấu không tự bỏ dòng
  hoặc đổi mapping; template tiếp tục dùng vị trí header trong 20 dòng đầu.

Hồi quy mới trong `campaign-import-review-smoke.cjs`: comma/semicolon/tab qua
file và IPC Sheet với dòng mô tả, dấu khác trong mô tả, dòng trắng/ô rỗng có
nháy kép, header ở dòng 20, header có cột rỗng, bảng một cột và CSV mơ hồ;
kiểm tra số dòng nguồn gốc thực tế. UID mantissa có một/nhiều số 0, UID dài,
đuôi 0 sau dấu thập phân, giữ UID text có 0 đầu, tham chiếu trùng và xuất/nhập
lại template; SĐT khoa học và đầu số nội địa `084` giữ đúng chuẩn hóa.

Smoke Electron xác nhận template CSV tự kiểm tra/chèn đủ Tên/SĐT/Info khi có
dòng mô tả hoặc ô rỗng trước header, cùng ba nhóm kết quả/xuất/chèn UID khoa
học có 0 đầu. Không đổi Web, SQL, runtime hay IPC legacy; chưa đóng gói/phát hành.

Sau sửa, review smoke và smoke Electron, 56 ca verifier, hồi quy UID Zalo,
Kiểm tra SĐT 600 dòng, Google Sheet sync và định danh SĐT đều **đạt**. Hai
typecheck sạch; production build Desktop **đạt** (main 1,52 giây, renderer
25,40 giây), chỉ còn cảnh báo import tĩnh/động hiện có. `git diff --check`
sạch; kiểm thử dùng fixture local, không gọi AI thật hoặc ghi dữ liệu khách hàng.

## Giữ dòng lỗi Excel và khôi phục XLS dạng XML — 21/10/2026

- `sheet_to_json` thay ô Excel kiểu `e` bằng giá trị trống ở cả chế độ raw và
  hiển thị. Adapter nay đọc lại kiểu ô theo đúng tọa độ sheet, giữ nhãn lỗi
  cùng marker qua `ImportCell.error` và `ImportSourceRow.errors`. Dòng chỉ có
  ô lỗi vẫn được tính là dòng nguồn; dòng thật sự trống vẫn bỏ qua.
- Lỗi ở trường người nhận, kể cả nguồn fallback từ Tên, vào nhóm **bị loại**
  trước chuẩn hóa/lọc trùng. Báo cáo và Excel giữ `#VALUE!`, `#N/A`… cùng lý do
  cần sửa ô nguồn; mã lỗi số của Excel không bị coi là UID. Cột lỗi không được
  dùng để gợi ý cột người nhận khi không có header. Lỗi ở Tên/Info vẫn được
  giữ dạng chữ để đối chiếu nếu người nhận hợp lệ; chữ người dùng nhập như
  từ khóa `#VALUE!` không tự bị coi là lỗi ô Excel.
- Gỡ điều kiện bắt buộc chữ ký OLE cho `.xls`: để thư viện hiện có đọc BIFF
  hoặc SpreadsheetML/XML ở cả tab khách hàng và template. Nhánh nguồn Sheet
  cũng nhận diện BIFF trực tiếp và XML trước khi dò dấu CSV. Giữ kiểm tra
  đuôi file, chữ ký ZIP của `.xlsx`, mapping/template và ba nhóm kết quả.

Hồi quy mới trong `campaign-import-review-smoke.cjs` bao phủ bảy mã lỗi Excel,
sáu loại người nhận, file/IPC Sheet/template, vùng dữ liệu bắt đầu tại C3,
dòng trống, Tên/Info lỗi, tham chiếu trùng, lỗi ở nguồn fallback và file bị
loại đọc lại. XLS XML/BIFF2/BIFF5/BIFF8 đi qua file và IPC, giữ SĐT, mã Info
có 0 đầu và nội dung chứa dấu phân cách.

Smoke Electron kiểm tra dòng lỗi xuất hiện trong số đếm/danh sách/Excel,
chỉ chèn dòng hợp lệ, template toàn lỗi vẫn tải được báo cáo, XLS XML ở hai
tab và BIFF2/BIFF8 chèn đủ Tên/SĐT/Info; XLSX hỏng vẫn bị chặn. Các fixture
chạy local, không gọi AI thật hay ghi DB khách hàng; không đổi Web, runtime
gửi tin hoặc IPC legacy, chưa đóng gói/phát hành.

Sau sửa, review smoke, smoke Electron, 56 ca verifier, hồi quy UID Zalo,
Kiểm tra SĐT 600 dòng, Google Sheet sync và định danh SĐT đều **đạt**. Hai
typecheck sạch; production build Desktop **đạt** (main 4,06 giây, renderer
26,90 giây), chỉ còn cảnh báo import tĩnh/động hiện có. `git diff --check` sạch.
