# Cài akaAgent Zalo Server trên Windows VPS

## 1. Chuẩn bị database một lần

Chạy toàn bộ file `migrations/migration_v163_server_zalo_recovery_and_atomic_campaign_log.sql`
trong Supabase SQL Editor của project hiện tại. Bước này dùng phiên Dashboard đã đăng nhập,
không cần nhập token vào app server.

Migration thêm một cột vào `org_staff`:

- `is_zalo_server=false`: staff chạy Zalo trên app desktop;
- `is_zalo_server=true`: staff chạy Zalo trên app server.

Migration đồng thời tạo các RPC transaction để:

- claim campaign/account atomically cho desktop hoặc server;
- claim/release các thao tác tài khoản như QR, kiểm tra session, logout và quét data;
- append log atomically;
- kiểm tra trạng thái Zalo đang chạy trong lúc bàn giao;
- recovery Zalo server sau khi app bị tắt đột ngột;
- recovery runtime desktop theo đúng phạm vi.
- đọc cờ kèm revision giao dịch của row staff để loại marker VPS cũ sau mọi lần đổi mode.

Product 16 và product 18 đều cấp cùng quyền Zalo. Nếu organization có cả hai,
app lấy giới hạn từ entitlement Zalo còn hạn được tạo sau cùng, không dùng product
để quyết định local/server.

Sau khi migration chạy xong, bật server cho đúng staff cần sử dụng, ví dụ:

```sql
UPDATE public.org_staff
SET is_zalo_server = true, updated_at = now()
WHERE id = 1;
```

Đổi lại `false` nếu muốn staff đó chạy Zalo local. Không tự backfill cờ này từ product.

## 2. Cài app server

1. Chép `akaAgent-Zalo-Server-Setup-3.3.0.exe` lên VPS.
2. Chạy installer và cài như app Windows bình thường.
3. Mở shortcut **akaAgent Zalo Server** trên Desktop hoặc Start Menu.
4. Không nhập Supabase URL, key hay token. App dùng sẵn cấu hình Supabase của akaAgent.
5. Giữ cửa sổ app mở. Đóng app nghĩa là dừng toàn bộ runtime Zalo server.

Chỉ chạy **một** app akaAgent Zalo Server cho cùng database (một VPS production). Không mở
thêm bản server trên VPS thứ hai; recovery startup được thiết kế theo invariant một server.
Database cho phép đổi cờ bất kỳ lúc nào và không tạo trigger chặn. Desktop đang mở sẽ
phát hiện thay đổi trong tối đa 30 giây, dừng nhận tác vụ Zalo mới và hiện thông báo bắt
buộc thoát/mở lại app. Không đóng modal để tiếp tục dùng Zalo trong phiên cũ.

Khi đổi từ local sang server, giao diện server có thể hiển thị staff ở trạng thái **Đang chờ
app desktop cũ đóng**. Server không recovery hoặc chạy campaign cho staff đó cho tới khi
desktop cleanup xong account/campaign/input đang chạy. Input có kết quả chưa xác định được
đánh dấu hoàn thành và không tự gửi lại. Khi đổi từ server về local, server dừng runtime;
desktop mở lại sẽ gọi `POST /api/runtime-handoff` qua chính domain HTTPS và chỉ chạy Zalo
local sau khi server xác nhận đã dừng/cleanup xong. Vì IIS proxy toàn bộ `(.*)`, endpoint này
không cần tạo rule riêng.

App lưu marker ownership tại
`C:\ProgramData\akaAgentServer\runtime-ownership.json`. Marker này cho phép lần mở sau
recovery công việc do chính server bị crash để lại. Marker chỉ hợp lệ khi revision giao dịch
của row `org_staff` vẫn khớp; đổi `false → true` hoặc `true → false` tự làm revision đổi dù
không có trigger. Nếu marker thiếu/cũ, server coi trạng thái `đang chạy` là có thể thuộc
desktop còn sống và chỉ chờ, không tự reset.

Sau khi Windows/VPS reboot, dùng Remote Desktop (RDP) đăng nhập vào Windows rồi mở lại
shortcut. Bản này cố ý không tự chạy cùng Windows.

## 3. Cho phép IIS reverse proxy WebSocket

Trên Windows Server, bật/cài các thành phần:

- IIS **WebSocket Protocol**;
- IIS URL Rewrite;
- IIS Application Request Routing (ARR).

Trong **IIS Manager**:

1. Chọn node server, mở **Application Request Routing Cache** → **Server Proxy Settings**.
2. Bật **Enable proxy** và Apply.
3. Chọn site dành cho `akazalo.akabiz.net`.
4. Tạo inbound URL Rewrite rule:
   - Match URL: `(.*)`
   - Action type: `Rewrite`
   - Rewrite URL: `http://127.0.0.1:8787/{R:1}`
   - Append query string: bật
   - Stop processing subsequent rules: bật
5. Bảo đảm site/IIS bật WebSocket và restart site sau khi lưu.

Port `8787` chỉ bind vào `127.0.0.1`, không mở port này ra Internet. IIS là cổng công khai
duy nhất và chuyển cả HTTPS lẫn WSS vào app.

## 4. Gắn HTTPS từ win-acme

1. Trong IIS site bindings, thêm/sửa binding:
   - Type: `https`
   - Port: `443`
   - Host name: `akazalo.akabiz.net`
   - Bật SNI
   - Chọn certificate mà win-acme đã cấp cho domain.
2. Giữ port `80` nếu win-acme đang dùng HTTP validation/renewal.
3. Windows Firewall chỉ cần inbound `80` (nếu dùng) và `443`; không mở `8787`.

## 5. Kiểm tra

Khi app server đang mở, chạy trên VPS:

```powershell
Invoke-RestMethod https://akazalo.akabiz.net/health
```

Kết quả đúng có `ok: true`, `state: running`, `timeZoneOk: true` và số runtime staff.
Sau khi mở lại, desktop của staff có `is_zalo_server=true` sẽ tự đăng nhập kênh server bằng
phiên akaBiz hiện tại; user không phải nhập cấu hình Supabase hay token lần nữa.

Khi đóng app server, domain có thể trả `502` từ IIS. Đây là hành vi đúng vì runtime đã dừng.

## 6. Log và dữ liệu recovery

- Giao diện app server hiển thị health, staff runtime, client đang kết nối và log realtime.
- File log máy chủ: `C:\ProgramData\akaAgentServer\logs\server.log`.
- File ownership phục vụ crash recovery: `C:\ProgramData\akaAgentServer\runtime-ownership.json`.
- Nếu app dừng đột ngột, lần mở sau sẽ đưa campaign/account Zalo đang chạy về `chờ xử lý`.
- Input/input-data đang chạy được chuyển sang `hoàn thành` với note:
  `Dừng đột ngột, không xác định kết quả; không tự thực hiện lại`.
- Campaign `tạm dừng` được giữ nguyên.

Nếu server hiển thị **đang chờ app desktop cũ đóng** sau một lần crash, nhưng bạn đã xác
nhận chắc chắn mọi app desktop của staff đó đều đã tắt, có thể dọn state server cũ thủ công
trong Supabase SQL Editor:

```sql
SELECT public.recover_server_zalo_running_state(1, NULL, false);
```

Thay `1` bằng đúng `staff_id`. Không chạy lệnh này khi desktop còn sống, vì đây là recovery
cưỡng bức; input đang chạy sẽ được hoàn thành với note không tự retry. Sau đó chờ tối đa
60 giây để app server reconcile lại staff.
