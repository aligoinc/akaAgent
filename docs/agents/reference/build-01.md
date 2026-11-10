# Build và kiểm tra

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 324–344. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

## Hướng dẫn hiện hành — 10/11/2026

Bổ sung, không thay thế câu nào trong vùng bảo toàn bên dưới.

**Build bộ cài phát hành.** Làm theo biên nhận gần nhất trong
`docs/audits/akaagent-<ver>-*/` ([9.4.0](../../audits/akaagent-9.4.0-20261106/README.md),
[9.5.0](../../audits/akaagent-9.5.0-20261110/README.md)): nhánh `codex/release-<ver>` từ
`origin/dev_3`, commit chỉ đổi `package.json`, `package-lock.json`, `version.txt`; hai typecheck và
smoke phù hợp; `build:win` → `build:mac` → `build:mac:intel`. Ghi manifest checksum đầu vào build
trước/sau khi build (làm bù sau build là không được). Hậu kiểm tối thiểu: `version.txt` trong
`resources/` của cả ba bản (updater đọc file này) và version ASAR/PE/Info.plist; kiến trúc executable
và mọi `.node` (Mac có thêm `fsevents.node`); quét JWT `service_role`/anon, `sb_secret_` và resource
Server trên toàn bộ file đóng gói; payload installer Windows và DMG mount read-only khớp app; installer
cũ giữ checksum; native host khôi phục; log lệnh có thời điểm.

**Có cần build lại App Server không.** Server chỉ đóng gói đồ thị import tĩnh từ
`src/server/{main,preload,renderer}` (`electron.server.vite.config.ts`). Lấy danh sách file bằng
`esbuild` `bundle`+`metafile` (`packages:'external'`, alias `@shared`/`@server`), giao với
`git diff --name-only <source_commit của Server lần trước> <commit build>` (commit nằm trong
`build-receipt.json`), rồi xét file giao có chạy trên đường Zalo Server (`runtimeTarget==='server'`;
Server không chạy Facebook/webview) hay không. 9.3.0 → 9.5.0: 3/166 file giao, chỉ dùng cho Desktop,
nên không build lại.

**Mẹo hậu kiểm trên máy Mac.** Thử SQLite trong app đóng gói:
`ELECTRON_RUN_AS_NODE=1 <app>/Contents/MacOS/akaAgent probe.js` và require
`Resources/app.asar/node_modules/better-sqlite3` (đường `app.asar.unpacked` lỗi `Cannot find module
'bindings'`); bản Intel thêm `arch -x86_64`. `node_modules/7zip-bin/mac/arm64/7za x <Setup.exe>
resources/app.asar …` đọc thẳng payload NSIS để so với `dist/win-unpacked`. `strings` của macOS
không có `-el`; đọc version PE bằng `toString('utf16le')`.

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
