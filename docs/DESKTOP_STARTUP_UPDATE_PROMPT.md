# Form cập nhật khi mở Desktop

`auto_system_settings.key = 'desktop.updates.startup_prompt_max_version'` điều khiển việc tự mở form **khi khởi động và đã phát hiện bản mới**. Migration v329 tạo giá trị SQL `NULL`, `is_active=true`, `is_secret=false`.

| Giá trị | Hành vi lúc khởi động |
| --- | --- |
| SQL `NULL` hoặc để trống trong Admin akaBiz | Mở form với mọi phiên bản hiện tại khi có bản mới |
| `6.0.0` | Mở nếu local <= `6.0.0`, bao gồm đúng `6.0.0`; local `6.0.1` trở lên chỉ hiện nút |
| `x.y.z` khác | So sánh số major/minor/patch, bao gồm ngưỡng bằng nhau |
| Thiếu row, tắt, secret, sai định dạng hoặc lỗi đọc | Chỉ hiện nút báo bản mới và tiếp tục đăng nhập |

Không nhập chữ `null` vào ô text; xóa nội dung nếu sửa bằng Admin akaBiz. Đóng form bằng “Để sau” tiếp tục auth bootstrap như trước. Kiểm tra thủ công vẫn mở form khi có bản mới; kiểm tra mỗi 60 phút vẫn chỉ cập nhật nút.

Main dùng Supabase HTTP client hiện có, đọc đúng một key public trước đăng nhập, timeout 5 giây, chỉ trong startup check có bản mới. Không thêm pool, RPC, timer, retry hay đọc setting ở kiểm tra định kỳ/thủ công. Mở lại app để nhận cấu hình mới. Các binary đã phát hành trước thay đổi này vẫn giữ điều kiện hardcode cũ; cần phát hành Desktop chứa code mới.

## Migration và kiểm chứng

- Production: `akachat / cgjbsmqtfhqvttudyjzq`; baseline key chưa tồn tại, checksum `d751713988987e9331980363e24189ce` (MD5 JSONB `[]`).
- `migrations/migration_v329_desktop_startup_update_prompt.sql` fail-closed nếu key đã được tạo từ sau baseline; unique key bảo vệ race. Không ghi đè giá trị admin và không apply lại.
- Chỉ seed dữ liệu; apply SQL và ghi history trong cùng transaction bằng `supabase db query --linked`. Không DDL phụ, không schema reload.
- Đã apply ngày 28/09/2026 với history `20260928161350 / migration_v329_desktop_startup_update_prompt`; SHA-256 SQL local/history khớp `e806f814577785408824bef8459efeeed580093334b2280fc645b7a54aa2aabc`. Không apply lại khi phát hành Desktop.
- Rollback smoke và commit đều kiểm tra với SQL role `anon`; sau commit, HTTP PostgREST dùng anon trả `200` với đúng `[{"value":null}]`.
- Smoke: `node scripts/startup-update-prompt-smoke-test.cjs` chạy updater/repository thật với version server và DB fixture; kiểm tra NULL/empty, dưới/bằng/trên ngưỡng, minor/patch, lỗi đọc, trước auth và không đọc thêm khi periodic/manual/không có bản mới.
- Typecheck: `npx tsc --noEmit -p tsconfig.node.json` và `npx tsc --noEmit -p tsconfig.web.json`.
- Kết quả 28/09/2026: smoke fixture đạt; hai typecheck sạch; `npm run build` thành công (còn cảnh báo Vite về các import động/tĩnh vốn có).
