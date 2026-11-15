# Giới thiệu nhận hoa hồng trên Desktop

Mục "Giới thiệu nhận hoa hồng" trong menu tài khoản mở một hộp thoại. Hộp thoại hiện mã giới thiệu, link trang giới thiệu riêng (`https://crm.akabiz.net/gt/<MÃ>`), số liệu tóm tắt, mức hoa hồng theo từng sản phẩm và cách tính. Nút "Mở trang quản lý hoa hồng" mở cổng CRM `/gia-han/doi-tac` bằng trình duyệt ngoài. Trang đó quản lý người đã giới thiệu, lịch sử hoa hồng và tài khoản nhận tiền.

## Thành phần

- Hợp đồng dữ liệu: `src/shared/affPartner.ts`, chép nguyên văn từ akaAgentWebApp `packages/control-api/src/affPartner.ts`. Sửa ở WebApp trước rồi chép lại. Phần riêng Desktop ở `src/shared/affPartnerDesktop.ts` (tên kênh IPC, mã lỗi, kiểm link).
- Repository: `src/main/data/repositories/affPartnerRepository.ts`.
- IPC: `src/main/ipc/handlers/affPartnerHandlers.ts`, preload `affPartnerSummary()` và `affPartnerOpenPortal()`.
- Giao diện: `src/renderer/src/components/AffPartner/AffPartnerModal.tsx`, mục menu ở `TopBar.tsx`, CSS cuối `global.css` (lớp `aff-partner-*`).

## Luồng IPC

| Kênh | Việc | Kết quả |
|---|---|---|
| `aff-partner:summary` | Gọi `aka_agent_aff_partner(p_create => true)`. Chưa có mã thì DB cấp mã. | `{ ok: true, data: { summary } }` |
| `aff-partner:open-portal` | Đọc lại tóm tắt chỉ đọc (`p_create => false`), xin vé `aka_agent_renewal_link_ticket(null)`, kiểm link rồi `shell.openExternal`. | `{ ok: true, data: { signed } }` |

Mọi kênh trả `{ ok: false, code, message }` khi lỗi, không ném ra renderer. Link có vé chỉ đi trong tiến trình chính. Tiến trình chính chỉ mở link `https:` cùng origin với `portalUrl` trong tóm tắt, không kèm tên hay mật khẩu trong URL.

## Khi nào gọi DB

- Ẩn hay hiện mục menu: đọc khoá `affiliate.program` trong cùng câu đọc cài đặt lúc đăng nhập (`getDesktopPollingSettings`). Không thêm request.
- Mở hộp thoại: 1 request. Bấm "Thử lại": thêm 1 request.
- Bấm "Mở trang quản lý hoa hồng": 2 request (tóm tắt chỉ đọc, xin vé).
- Không có đồng hồ hẹn giờ, không đọc lúc đăng nhập.

## Công tắc `affiliate.program`

Dòng `auto_system_settings` key `affiliate.program`, JSON `{"audience": "off" | "admin_akabiz" | "all"}`. Thiếu dòng, sai JSON hoặc giá trị lạ đều là `off`, mục menu ẩn. `admin_akabiz` chỉ hiện cho admin akaBiz. Đổi công tắc có hiệu lực sau khi nhân viên đăng nhập lại. Quyền thật do DB quyết định lúc mở hộp thoại: nhân viên nội bộ vẫn nhận `internal_staff`.

## Phụ thuộc migration

1. CRM `20261115100000_aff_partner_program.sql` (bảng và quy tắc chương trình).
2. akaAgent V546 `migrations/migration_v546_aff_partner_app.sql` (hàm `aka_agent_aff_partner`).

Cả hai đã apply akachat ngày 15/11/2026 lúc 13:17:05 và 13:18:27 giờ VN (`20261115061705 / aff_partner_program`, `20261115061827 / migration_v546_aff_partner_app`). Không apply lại, không sửa hai file. md5 trong sổ bằng md5 file (V546 `d5b18ab7…`). Chương trình vẫn tắt. [Biên nhận](../migrations/snapshots/aff-partner-v546/apply-receipt.json).

Vé mở cổng dùng V521 đã có trên production.

## Khi hàm chưa có

PostgREST trả `PGRST202`, repository đổi thành `{ enabled: false, reason: 'not_installed' }`, hộp thoại báo chương trình chưa mở. Lỗi khác thành `unavailable`, hộp thoại có nút "Thử lại". Không được vé thì app mở link không vé, khách đăng nhập cổng bằng mật khẩu rồi cổng đưa về trang quản lý.

## Kiểm thử

```bash
node scripts/aff-partner-desktop-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
```

Smoke kiểm md5 hợp đồng và so với WebApp nếu có, repository với Supabase giả, kiểm origin, công tắc menu.

## Giới hạn

- Chưa chạy trên Electron thật. Hàm V546 đã có trên DB thật nhưng mới gọi thử ngoài phiên Desktop (trả `no_session`); chưa gọi bằng phiên Desktop thật.
- Trang quản lý mở bằng trình duyệt ngoài, không mở trong cửa sổ Gia hạn của app: cửa sổ đó gắn với lượt gia hạn và lời nhắc, dùng chung một phân vùng.
- Renderer không nhận link có vé: kênh `aff-partner:open-portal` để tiến trình chính tự mở link và chỉ trả `{ signed }`.
