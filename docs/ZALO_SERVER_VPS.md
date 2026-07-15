# Cài akaAgent Zalo Server trên Windows VPS

## 1. Chuẩn bị database một lần

Chạy toàn bộ file `migrations/migration_v163_server_zalo_recovery_and_atomic_campaign_log.sql`
trong Supabase SQL Editor của project hiện tại. Bước này dùng phiên Dashboard đã đăng nhập,
không cần nhập token vào app server.

Khi triển khai web/PWA, chạy tiếp
`migrations/migration_v164_control_web_sessions.sql`. Migration này tạo phiên control web
và RPC tối thiểu để app server kiểm tra phiên đã hết hạn/thu hồi mà không mở quyền đọc bảng.

Sau v164, áp dụng v165 theo đúng ba lệnh riêng và đúng thứ tự sau:

```powershell
supabase db query --linked --file migrations/migration_v165_01_control_web_atomic_columns.sql
supabase db query --linked --file migrations/migration_v165_02_control_web_atomic_append_index.sql
supabase db query --linked --file migrations/migration_v165_03_control_web_atomic_functions.sql
```

Không gộp phase `02` vào transaction vì phase này tạo index bằng `CONCURRENTLY`.
Phase `03` sẽ tự dừng nếu index chưa tạo xong hoặc không hợp lệ.

Sau các migration control web, áp dụng tiếp
`migrations/migration_v171_organization_product_zalo_runtime_mode.sql`. Thứ tự rollout
cho v171 là: **dừng runtime test → database v171 → akaBizApi → akaAgent Zalo Server →
akaAgent desktop**. `akaAgentWebApp` và app SMS mobile không cần deploy lại vì contract
capability không đổi.

Migration thêm một cột vào `org_organization_product`:

- `is_zalo_server=false`: toàn bộ staff của organization chạy Zalo trên app desktop;
- `is_zalo_server=true`: toàn bộ staff của organization chạy Zalo trên app server.

Chỉ row product Zalo `16`/`18` còn hạn, chưa soft-delete và mới nhất theo
`created_at DESC, id DESC` có hiệu lực. Cột cũ cùng tên trên `org_staff` chỉ được
giữ để binary cũ không lỗi schema và không còn quyết định runtime.

Migration đồng thời tạo các RPC transaction để:

- claim campaign/account atomically cho desktop hoặc server;
- claim/release các thao tác tài khoản như QR, kiểm tra session, logout và quét data;
- append log atomically;
- kiểm tra trạng thái Zalo đang chạy trong lúc bàn giao;
- recovery Zalo server sau khi app bị tắt đột ngột;
- recovery runtime desktop theo đúng phạm vi.
- đọc cờ kèm revision `entitlement_id:xmin` của row organization product để loại
  marker VPS cũ sau mọi lần đổi mode.
- discover toàn bộ staff chạy server bằng RPC keyset tối đa 1.000 row mỗi trang,
  không query entitlement/mode riêng cho từng organization.

Product 16 và product 18 đều cấp cùng quyền Zalo. Nếu organization có cả hai,
app lấy cả giới hạn và chế độ runtime từ entitlement Zalo còn hạn được tạo sau cùng.

Migration không backfill từ staff và mọi row hiện tại mặc định `false`. Sau khi đã
deploy API, desktop và app server mới, bật server trên đúng row entitlement cần dùng:

```sql
UPDATE public.org_organization_product
SET is_zalo_server = true
WHERE id = 219;
```

Đổi lại `false` nếu muốn organization đó chạy Zalo local. Không đồng bộ cờ này về
`org_staff`. Không bật cờ trên product Facebook, Email hoặc SMS vì runtime sẽ bỏ qua.

## 2. Cài app server

1. Chép `akaAgent-Zalo-Server-Setup-3.3.0.exe` lên VPS.
2. Chạy installer và cài như app Windows bình thường.
3. Mở shortcut **akaAgent Zalo Server** trên Desktop hoặc Start Menu.
4. Không nhập Supabase URL, key hay token. App dùng sẵn cấu hình Supabase của akaAgent.
5. Giữ cửa sổ app mở. Đóng app nghĩa là dừng toàn bộ runtime Zalo server.

Bản cài server đã chứa public key Ed25519 để xác minh ticket realtime 60 giây do
`akaBizApi` ký và đã cho phép sẵn hai origin:

- `https://aka-agent-web-app.vercel.app`;
- `https://*.akabiz.net`.

Vì vậy VPS không cần nhập secret, Supabase token hoặc chạy `setx`; chỉ cần cài rồi mở app.
Private key chỉ nằm ở akaBizApi/Vercel, không được chép sang VPS. Sau này gắn thêm subdomain
thuộc `*.akabiz.net` vào Vercel cũng không cần build hay cấu hình lại app server.

Chỉ khi dùng domain nằm ngoài hai origin mặc định, người quản trị mới cần tùy chọn override
`AKA_AGENT_REALTIME_ALLOWED_ORIGINS` bằng danh sách origin chính xác hoặc wildcard dạng
`https://*.example.com`, phân cách bằng dấu phẩy. Wildcard không bao gồm domain gốc; muốn
cho phép domain gốc phải thêm origin đó riêng. `AKA_AGENT_REALTIME_TICKET_PUBLIC_KEY` là
override public key dành cho rollout/rotation nội bộ, nhận PEM hoặc base64 của PEM và không
phải cấu hình bắt buộc trên VPS production thông thường.

Chỉ chạy **một** app akaAgent Zalo Server cho cùng database (một VPS production). Không mở
thêm bản server trên VPS thứ hai; recovery startup được thiết kế theo invariant một server.
Database cho phép đổi cờ bất kỳ lúc nào và không tạo trigger chặn. Desktop đang mở sẽ
phát hiện thay đổi trong tối đa 30 giây, dừng nhận tác vụ Zalo mới và hiện thông báo bắt
buộc thoát/mở lại app. Không đóng modal để tiếp tục dùng Zalo trong phiên cũ.

Khi đổi từ local sang server, giao diện server có thể hiển thị staff ở trạng thái **Đang chờ
app desktop cũ đóng**. Server không recovery hoặc chạy campaign cho staff đó cho tới khi
desktop đã dừng toàn bộ producer Zalo và gọi `POST /api/runtime-handoff-ready`. Endpoint
Để retry khi endpoint tạm offline, desktop lưu marker trong `local-data` và chỉ gửi lại
sau khi mở app nếu staff, organization và revision `entitlement_id:xmin` vẫn khớp.
Marker local chỉ cho phép thoát ngay khi DB đã sạch; nếu còn row Zalo `đang chạy`,
desktop chờ VPS xác nhận để server không bị kẹt ở trạng thái chờ vĩnh viễn.
Endpoint được serialize theo staff và tự kiểm tra revision; nó chỉ recovery/start khi
server đang chờ và trả no-op nếu server đã chạy, nên desktop mở lại muộn không thể
reset campaign server. Input có kết quả chưa xác
định được đánh dấu hoàn thành và không tự gửi lại. Cleanup quit/logout rộng cũng tự bỏ qua
Zalo khi product mode đang là server. Khi đổi từ server về local, server dừng runtime;
desktop mở lại sẽ gọi `POST /api/runtime-handoff` qua chính domain HTTPS và chỉ chạy Zalo
local sau khi server xác nhận đã dừng/cleanup xong. Vì IIS proxy toàn bộ `(.*)`, endpoint này
không cần tạo rule riêng cho các endpoint handoff.

App lưu marker ownership tại
`C:\ProgramData\akaAgentServer\runtime-ownership.json`. Marker này cho phép lần mở sau
recovery công việc do chính server bị crash để lại. Marker chỉ hợp lệ khi revision
`entitlement_id:xmin` của row Zalo hiệu lực trong `org_organization_product` vẫn khớp.
Nếu marker thiếu/cũ, server coi trạng thái `đang chạy` là có thể thuộc desktop còn sống
và chỉ chờ, không tự reset.

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
Sau khi mở lại, desktop thuộc organization có entitlement Zalo hiệu lực với
`is_zalo_server=true` sẽ tự đăng nhập kênh server bằng phiên akaBiz hiện tại; user
không phải nhập cấu hình Supabase hay token lần nữa.

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
