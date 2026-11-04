# Build và kiểm tra

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 324–344. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Commands

```bash
npm install              # Lần đầu — auto chạy electron-builder install-app-deps
npm run dev              # Dev mode (HMR cho renderer, watch cho main)
npm run build            # Build production (out/main + out/preload + out/renderer)
npm run build:win        # Build → đóng gói NSIS installer (Windows)
npm run build:mac        # Build → đóng gói DMG (macOS Apple Silicon)
npm run build:mac:intel  # Build → đóng gói DMG (macOS Intel)
npm run preview          # Preview production build

# Typecheck — KHÔNG có lint/test commands
npx tsc --noEmit -p tsconfig.node.json   # Main + preload + shared
npx tsc --noEmit -p tsconfig.web.json    # Renderer
```

Project KHÔNG có test framework / lint config. Verify bằng tsc + manual smoke test. Sau migration_v4 (drop engine v1) typecheck phải sạch 0 errors — bất kỳ error nào là regression.

Windows packaging có native module `better-sqlite3`; luôn dùng `npm run build:win` để script prepare `win32-x64` `.node`, verify header `MZ`, rồi restore native module host. Không chạy trực tiếp `electron-builder --win` sau khi build macOS/Intel vì có thể đóng gói nhầm Mach-O vào installer Windows.
Zalo Server Windows cũng phải build bằng `npm run build:server:win`; verifier phải dùng executable/profile Server và không áp contract dependency riêng của desktop như `playwright-core`, vì bundle Server không import Playwright. Mọi hook trong `build/installer.nsh` dành cho desktop phải được compile-time gate bằng `PRODUCT_NAME == akaAgent`, nếu không Electron Builder sẽ tự áp chúng lên installer Zalo Server.


<!-- END PRESERVED SOURCE -->
