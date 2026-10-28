# Hợp đồng client đã đối chiếu với code

Đối chiếu ngày 28/10/2026 với akaAgent `dd250481` và akaAgentWebApp
`059f81d8`. Đây là hướng dẫn đọc/sửa code, không xác nhận một bản đã được deploy.
Các đính chính dưới đây thay thế đúng câu mâu thuẫn được chỉ ra trong reference;
các guard, timeout, quyền và chức năng khác vẫn giữ nguyên.

<a id="sms-credentials"></a>

## Credential staff/runtime và tài khoản SMS

- Credential xác thực staff/RPC dùng trong main/backend; không trả qua preload,
  renderer hoặc `AuthUser`. Raw session Zalo, cookie runtime và provider key
  cũng không được xuất ra UI/log.
- Ngoại lệ có chủ đích: `auto_accounts.username/password` của **account SMS** là
  thông tin đăng nhập app mobile. `mapAccountFromDB` trả hai field này cho SMS;
  cùng field của account không phải SMS trả `null`. `AccountInfoView` hiển thị
  tên đăng nhập/mật khẩu cho SMS. Không mở rộng lệnh cấm credential staff thành
  việc xoá chức năng SMS này; ngoại lệ không cho phép ghi secret vào log hoặc
  trả credential của staff/session/provider.
- Giữ nguyên các luồng nhập/chỉnh sửa credential được UI hiện tại hỗ trợ;
  không suy từ một quy tắc runtime thành lệnh cấm mọi field tên `password`.

Nguồn: [mapper account](../../src/main/data/mappers.ts:30),
[thông tin tài khoản SMS](../../src/renderer/src/components/CampaignPanels/AccountInfoView.tsx:179),
[credential process](../../src/main/data/currentUser.ts).
Hợp đồng SMS gốc vẫn ở [campaigns-01](reference/campaigns-01.md).

<a id="chat-routing"></a>

## Kết nối tenant Chat: Desktop và WebApp

| Client | Hành vi hiện tại cần giữ |
| --- | --- |
| akaAgent Desktop, `isChatSync=true` | `startZaloRemoteClients` dừng `ZaloServerClient`, khởi động `ZaloChatApiClient` và local Chat sync. Không mở thêm socket App Server cũ để nhận command/operation. |
| akaAgent Desktop, không Chat | Dừng Chat client/local Chat sync và khởi động `ZaloServerClient`; client vẫn tự kiểm tra entitlement/capability. |
| akaAgentWebApp | `RealtimeProvider` giữ socket operation/runtime và socket campaign riêng. Socket chính bật khi phiên authenticated có capability Zalo Server; socket campaign còn phụ thuộc Chat và ticket trả về. Giữ health/sequence/reconnect riêng; không dùng luồng này để suy Desktop cũng phải mở hai socket. |

Nguồn Desktop: [startZaloRemoteClients](../../src/main/ipc/handlers.ts:241),
[ZaloServerClient](../../src/main/services/zaloServerClient.ts:123),
[ZaloChatApiClient](../../src/main/services/zaloChatApiClient.ts:270).
Nguồn WebApp: [RealtimeProvider tại commit đã đối chiếu](https://github.com/aligoinc/akaAgentWebApp/blob/059f81d8537b6b7bd4646f6ea7c1fa2acb3d834b/apps/web/src/realtime/RealtimeContext.tsx#L67).

Đoạn “Tenant Chat giữ nguyên socket App Server…” trong
[browser-04](reference/browser-04.md) đã gộp sai phạm vi Desktop/WebApp.
Phần hai kết nối chỉ mô tả WebApp ở commit trên; không áp dụng cho Desktop.
Không tự bỏ một kết nối WebApp hoặc khôi phục kết nối Desktop vì câu lịch sử đó.

<a id="content-group-selection"></a>

## Chọn nhóm mẫu và lưu snapshot

Luồng Desktop hiện tại trong `CampaignFormModal`:

1. Chuyển chế độ nội dung sang **Nhóm mẫu nội dung** giữ cách khôi phục nhóm đã
   chọn/snapshot cũ của `switchToDataGroupContentMode`.
2. Ô trông như dropdown và nút **Chọn nhóm** đều gọi
   `openContentTemplateGroupPicker` để mở modal; không có thao tác chọn nhóm mới
   trực tiếp ở dropdown của form hiện tại. **Xem nội dung** cũng mở preview của
   nhóm trong modal này.
3. Chọn một hàng trong modal chỉ đổi `previewContentTemplateGroupId` và preview.
   **Dùng nhóm này** mới đặt `candidateContentTemplateGroupId` cùng
   `pendingContentTemplateGroupId`, rồi đóng modal. **Huỷ** đóng preview, không
   áp nhóm đang xem vào lựa chọn form.
4. Xác nhận trong modal chưa ghi snapshot xuống DB. Khi lưu chiến dịch,
   `prepareAdvancedContentForSave` giữ snapshot đã lưu còn phù hợp nếu không
   chọn lại; khi tạo/thay snapshot, tải lại nhóm/mẫu, validate rồi dựng dữ liệu
   để lưu. Lỗi không được ghi đè snapshot cũ.

Giữ giới hạn tối đa 100 item **chỉ cho SMS**, các guard kênh/media/trạng thái
nhóm và semantics snapshot runtime hiện có. Không tự thêm/bỏ bước xác nhận.
Câu “dropdown chọn ngay, không có bước Dùng nhóm này” trong
[campaigns-01](reference/campaigns-01.md) đã cũ; câu “dropdown chỉ là candidate”
trong [pitfalls-02](reference/pitfalls-02.md) cũng không mô tả đúng control hiện
tại. Hành vi chọn hàng/preview rồi xác nhận thuộc modal như mô tả ở trên.

Nguồn: [chuyển chế độ](../../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:13698),
[mở picker](../../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:13738),
[control trên form](../../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:13757),
[modal và xác nhận](../../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:15412),
[chuẩn bị snapshot khi lưu](../../src/renderer/src/components/CampaignPanels/CampaignFormModal.tsx:5899).
