# Desktop: "Sau khi chạy: đưa khách vào nhóm" và Tự động hóa mới của Web — phương án

Ngày 22/11/2026. Người dùng gửi ảnh mục 9 của form chiến dịch trên Web và yêu cầu: áp dụng tính năng này cho Desktop, áp dụng luôn Tự động hóa mới của Web sang Desktop, "lên phương án, chưa code".

**Trạng thái: chỉ là phương án, chưa viết mã, chưa đổi DB.** Năm điều chờ người dùng chốt ở mục 6.

## 1. Hiện trạng (đọc mã và DB thật 22/11, chỉ đọc)

| Phần | Web | Desktop |
|---|---|---|
| Khung "Sau khi chạy: đưa khách vào nhóm" | Có (WebApp #277, vào `dev_1` 21/11). DB V609 + V613 đã áp. Đã có khách dùng thật: 1 đồng bộ tạo 11:28 VN 22/11 (tổ chức 1910), quy trình đang chạy. | Chưa có gì. Desktop mở rồi lưu lại một bản nháp của Web thì mất các dòng nhóm. |
| Tự động hóa | Quy trình kéo thả + dựng bằng Agent (V473–V475, V547–V549, #239). Bộ máy chạy trong API trên Fly, 30 giây một nhịp. DB: 27 quy trình (2 đang chạy, 1 tạm dừng, còn lại là nháp). | Trang cũ "Chuyển dữ liệu theo kết quả chiến dịch" (`auto_automation`) + `AutomationProcessor` gọi 3 RPC mỗi 5 giây trên mọi máy. |
| Quy tắc cũ đang dùng | Không hiện trên Web. | 15 dòng, 8 đang bật của 5 nhân viên; 7/8 có nguồn là chiến dịch Facebook; 84 lượt chuyển trong 30 ngày, lượt gần nhất 13/11. |

Ba điều quyết định cách làm:

1. **Mọi RPC của hai tính năng chỉ cấp cho `service_role`** và nhận `p_staff_id` / `p_organization_id` như tham số được tin. Không cấp thẳng cho `aka_agent_desktop` được.
2. **Phần việc chính nằm ở TypeScript của API**, không ở SQL: dựng sơ đồ quy trình, tính mã kiểm (sha256) và danh sách nguồn lúc bật, tạo chiến dịch `[Quy trình] …` cho bước gửi, máy trạng thái tắt / bật / bỏ. RPC `create` của khung nhóm chỉ tạo bản nháp, bật là việc của API.
3. **API đã có sẵn đường xác thực phiên Desktop** (`authenticateDesktopSession`, đang dùng cho AI, ảnh Hỏi đáp, đồng bộ akaBiz Auto, log cảnh báo). Chưa có bộ đổi từ phiên Desktop sang ngữ cảnh mà service của Web cần (`ControlAuthContext`).

Nên Desktop gọi API Web bằng token phiên Desktop, không thêm hàm DB cho Desktop.

Bộ máy quy trình không phụ thuộc Desktop: kết quả do bộ chạy nào ghi (Desktop, Fly, App Server) thì bộ máy trên Fly cũng thu. Dấu "đã xem / đã phản hồi" của tài khoản Zalo QR do Desktop ghi nên dùng được; Zalo trình duyệt không được theo dõi, các ô "Sau khi gửi" của tài khoản đó bị khóa như Web.

## 2. Đợt 1: khung "Sau khi chạy: đưa khách vào nhóm" trong form Desktop

Viết giao diện ngay trong form Desktop (khung nằm trong form, không nhúng Web được).

### 2.1 Người dùng thấy gì

- Mục cuối của form (sau "Cài đặt thêm" / "Gửi tin nhắn Sms"), ở cả form thường và form Agent, với 11 loại chiến dịch như Web (Zalo gửi tới người, SMS, cuộc gọi). Không có ở chiến dịch Facebook, gửi vào group, email (đúng như Web).
- Nội dung như ảnh: lời giới thiệu, "+ Thêm nhóm" (tối đa 5), mỗi dòng gồm ô chọn nhóm khách hàng của chính nhân viên (chỉ loại nhận được), nút "+ Tạo nhóm" (hộp tạo nhanh sẵn có, khóa loại), các ô kết quả theo từng hành động đang bật, phần "Sau khi gửi · trong 7 ngày", dòng "Khách vào nhóm khi: …".
- Lưu: chiến dịch tạo ở trạng thái tạm dừng như hiện nay, bật đồng bộ từng (chiến dịch, nhóm), rồi mới bật chiến dịch. Lỗi thì chiến dịch giữ tạm dừng và hiện bảng ba nút Thử lại / Chọn nhóm khác / Bỏ nhóm này và chạy.
- Sửa chiến dịch: các dòng đã có hiện trạng thái, số khách đã vào nhóm, công tắc Đồng bộ và nút Bỏ có hiệu lực ngay. Nhân bản chép các dòng còn dùng.
- Link "Tự động hóa › Từ chiến dịch" mở thẻ mới **Từ chiến dịch** trong trang Tự động hóa của Desktop: danh sách 200 đồng bộ mới nhất, lọc, tìm, Tắt / Bật lại / Bỏ tại dòng (dùng lại đúng thành phần dòng của form sửa).

### 2.2 WebApp (API)

- Bộ đổi `desktopControlContext(staffId, organizationId)` từ phiên Desktop sang `ControlAuthContext` (dùng chung cho Đợt 2).
- Năm đường dưới `/api/aka-agent/desktop/v1/` gọi đúng `CampaignResultGroupsService` hiện có: `options`, danh sách của một chiến dịch, lưu (`PUT`), đổi trạng thái, danh sách của nhân viên. Không sửa service, không sửa SQL.
- Kiểm thử: bài kiểm route với token Desktop giả; bộ mô phỏng `campaign-result-groups-e2e.mts` chạy thêm một lô đi qua đường Desktop.

### 2.3 Desktop

- `src/shared/campaignResultGroups.ts`: chép nguyên văn `packages/control-api/src/campaignResultGroups.ts` (515 dòng, không import gì; smoke giữ md5 như các hợp đồng khác).
- Main: `campaignResultGroupsApi.ts` theo mẫu `aiChatImageApi.ts` (token phiên Desktop, hạn 30 giây, không tự gửi lại, API chưa có đường thì `campaign_result_groups_not_ready` và ẩn cả mục), một kênh IPC `campaign-result-groups:call`.
- Renderer: `components/CampaignResultGroups/` chuyển từ hai tệp của Web (khoảng 500 dòng): thay `controlApi` bằng IPC, danh sách nhóm đọc qua IPC `data-groups:list` sẵn có, tạo nhóm bằng `QuickCreateDataGroupDialog`.
- Hai form (`CampaignFormModal`, `CampaignAgentFormModal`): thêm bước cuối; đăng ký `campaignResultGroups` vào nháp bằng `useCampaignDraftField` (cùng khóa với Web nên nháp mở chéo được, và sửa luôn lỗi mất dòng); bước lưu đồng bộ đặt trong `saveCompletion.finish`, trước `resumeStagedCampaigns()`; kiểm lỗi vào danh sách cần hoàn thành; mở form sửa / nhân bản loại có khung thì một lượt đọc.
- Trang Tự động hóa: thêm thanh thẻ, thẻ "Từ chiến dịch".

### 2.4 Lượt gọi

Không gọi gì khi khách chưa thêm dòng. Thêm dòng đầu: 1 lượt `options` + 1 lượt danh sách nhóm. Mở form sửa loại có khung: 1 lượt. Lưu: 1 lượt cho mỗi (chiến dịch, nhóm). Thẻ Từ chiến dịch: 1 lượt khi mở và khi bấm Làm mới. Không polling, không kết nối nền mới.

### 2.5 Chỗ Desktop khác Web phải xử lý

- Chiến dịch chạy bằng Nhóm data trong một gói tạo kèm được tạo thẳng ở trạng thái cuối (không qua tạm dừng). Với trường hợp này gửi `includeExisting: true` để không sót kết quả của vài giây đầu.
- Xóa chiến dịch trên Desktop không gọi API Web; đồng bộ của nó được bộ máy tự dừng ở nhịp kế (tối đa khoảng 30 giây), không cần thêm gì.
- Desktop bản cũ mở nháp có dòng nhóm rồi lưu lại vẫn làm mất dòng (đã biết); đồng bộ đã bật thì không bị ảnh hưởng.

## 3. Đợt 2: Tự động hóa mới trên Desktop

### 3.1 Hai cách

| | A. Nhúng trang Tự động hóa của Web vào Desktop (đề xuất) | B. Viết lại giao diện trong Desktop |
|---|---|---|
| Khối lượng | Web: chế độ nhúng + đường vào từ Desktop. Desktop: một trang webview theo mẫu trang Chat. | Chuyển 5.641 dòng giao diện + 1.019 dòng CSS, lõi `journey-core` 5.303 dòng (kéo theo `campaign-core`), 19 đường API cho Desktop. |
| Form của bước gửi | Dùng form chiến dịch của Web (bộ máy tạo chiến dịch `[Quy trình]` từ đúng form này). | Form Desktop (18.000 dòng) phải sinh ra đúng dữ liệu mà API cần; nếu không vẫn phải nhúng form Web cho bước gửi. |
| Về sau | Web sửa gì Desktop có ngay, không phát hành lại. | Mỗi thay đổi làm hai lần, hai bộ kiểm thử. |
| Điểm yếu | Giao diện trong khung là của Web; cần mạng tới `agent.akabiz.net`. | Lâu, dễ lệch Web. |

Người dùng đã chọn cách nhúng cho "Nâng cấp và mua gói" (19/11), và Desktop đã nhúng Chat, CRM theo cùng kiểu.

### 3.2 Cách A cụ thể

**Trang Tự động hóa của Desktop có ba thẻ:**

1. **Quy trình**: webview mở `agent.akabiz.net/automation` ở chế độ nhúng (danh sách, tạo bằng Agent, trình dựng, chạy thử, bật, theo dõi).
2. **Từ chiến dịch**: thẻ của Đợt 1.
3. **Quy tắc cũ**: trang hiện tại, chỉ hiện với nhân viên còn quy tắc (mục 4).

**WebApp:**

- Đường vào từ Desktop: main gọi API bằng token phiên Desktop ngay trong phân vùng của webview (như trang Chat đăng nhập), API tạo một phiên Web và đặt cookie; token không tới renderer hay trang Web. Phiên mang loại riêng (ví dụ `desktop`) để không tính vào hạn 3 thiết bị Web và không đẩy phiên trình duyệt của khách. Có thể cần một migration nhỏ nới ràng buộc `client_type` của `auto_control_sessions`; kiểm ở bước đầu.
- Chế độ nhúng (`?embed=desktop`): ẩn thanh bên và thanh trên, chỉ cho đi trong `/automation/*` và form bước gửi, ẩn thanh thẻ của Web, nhận màu sáng / tối của Desktop.
- Link sang chiến dịch, nhóm data: phát thành điều hướng để Desktop chặn và mở màn của chính nó.

**Desktop:**

- `journeyWebService.ts` + thành phần webview theo mẫu `chatWebService.ts`: phân vùng `persist:akaagent_web_<tổ chức>_<nhân viên>`, chỉ cho nạp đúng origin, chặn tải xuống và cửa sổ mới, đổi phiên thì xóa cookie.
- Webview chỉ tạo khi mở thẻ lần đầu; rời trang thì báo trạng thái ẩn cho trang Web (tránh lỗi đã gặp ở trang Chat: webview ẩn vẫn chạy nền).
- "Xem tự động hóa" ở dòng nhóm của form mở thẻ Quy trình tại đúng quy trình (màn chỉ xem).

**Điều không đổi:** bước gửi dùng tài khoản Zalo QR / trình duyệt chỉ gửi khi Desktop đang mở (giới hạn sẵn có của bộ máy).

## 4. Quy tắc cũ và `AutomationProcessor`

- Không chuyển tự động ở đợt này: 7/8 quy tắc đang bật có nguồn là chiến dịch Facebook, mà khung nhóm mới không có cho Facebook; hàm chuyển `legacyRuleToJourney` có sẵn trong `journey-core` nhưng chưa từng chạy trên dữ liệu thật.
- Quy tắc cũ tiếp tục chạy như hiện nay. Thẻ "Quy tắc cũ" chỉ hiện với nhân viên còn quy tắc chưa xóa; không cho tạo quy tắc mới (việc mới làm bằng khung nhóm hoặc Quy trình).
- `AutomationProcessor` chỉ khởi động khi nhân viên có quy tắc đang bật (đọc một lần lúc đăng nhập). Hôm nay mọi máy gọi 3 RPC mỗi 5 giây dù chỉ 5 nhân viên có quy tắc.
- Chuyển quy tắc cũ sang quy trình mới và gỡ hẳn bộ xử lý: việc riêng, sau khi đã thử hàm chuyển trên 8 quy tắc thật.

## 5. Thứ tự và kiểm thử

**Đợt 0 (kiểm trước khi viết, chỉ đọc):** commit API/Web đang chạy trên Fly (biên nhận mới nhất là 17/11, nhưng DB cho thấy khung nhóm đã chạy); ràng buộc `client_type` và luật hạn thiết bị Web; trang Web trong webview Electron 33 (service worker PWA, cookie, tải tệp lên).

**Đợt 1:** API Desktop cho khung nhóm → deploy API → Desktop (hai form + thẻ Từ chiến dịch) → phát hành Desktop. Desktop bản mới gặp API chưa deploy thì ẩn mục, không lỗi.

**Đợt 2:** đường vào + chế độ nhúng trên Web → deploy → trang nhúng trên Desktop + thu hẹp `AutomationProcessor` → phát hành Desktop.

Mỗi bước deploy, migration, phát hành đều hỏi người dùng trước.

**Kiểm thử:**

- Smoke hợp đồng (md5 với WebApp), smoke transport (mã thật của main gọi một API cục bộ làm đúng hợp đồng).
- Smoke giao diện hai form trên Electron với IPC giả: thêm dòng, lỗi chặn lưu, lưu bật đồng bộ trước khi bật chiến dịch, lỗi giữ tạm dừng rồi "Bỏ nhóm này và chạy", nháp giữ dòng, nhân bản, sửa.
- Chạy trọn luồng bằng mã thật của Desktop + API thật + Postgres cục bộ (fixture V473 + V609 + V613 của WebApp), so khách vào nhóm với đáp án tính độc lập.
- Đợt 2: smoke trang nhúng (đăng nhập, chặn điều hướng, đổi phiên) với một máy chủ Web cục bộ; chạy lại bộ e2e quy trình của Web ở chế độ nhúng.
- Hai typecheck, `electron-vite build`.

## 6. Điều chờ người dùng chốt

1. Tự động hóa mới: nhúng trang Web (cách A, đề xuất) hay viết lại trong Desktop (cách B).
2. Quy tắc cũ: giữ chạy, ẩn nút tạo mới, thẻ chỉ hiện với người còn quy tắc (đề xuất); hay vẫn cho tạo; hay chuyển sang quy trình mới ngay.
3. Phát hành: Đợt 1 trước rồi Đợt 2 (đề xuất), hay gom một bản.
4. Chiến dịch Facebook: không có khung "Sau khi chạy" như Web (đề xuất giữ đúng Web); mở rộng cho Facebook là việc riêng ở cả Web, API và DB.
5. Câu chữ: dùng nguyên câu của Web như trong ảnh (đề xuất), chỉ đổi link thành mở thẻ trong phần mềm.

## 7. Chưa xác minh

- Chưa chạy trang Web trong webview của Desktop.
- Chưa đọc luật hạn thiết bị Web đủ để biết phiên loại mới cần đổi những gì.
- Nguồn "kết quả chiến dịch" của quy trình với chiến dịch Facebook: có mẫu `facebook_chain` nhưng chưa thử trên dữ liệu thật.
- Bản API/Web đang chạy trên Fly: suy từ dữ liệu, không có biên nhận sau 17/11.
