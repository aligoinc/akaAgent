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

**Build riêng App Server.** Server cần thay đổi mà Desktop cùng số chưa có thì tăng bản vá
(vd [9.5.1](../../audits/akaagent-server-9.5.1-20261110/README.md)); Server không có updater/feed.
Chụp lại `dist-server/private/verification-before.json` (mọi `.exe` dưới `dist-server/` và native
host) ngay trước build, vì `scripts/staff-rls/verify-private-server-build.cjs` so với file này.
Dựng đồ thị bằng esbuild thì renderer Server vào từ `src/server/renderer/index.ts`.

**Build trong worktree (13/11/2026, 9.6.0).** `git worktree add .claude/worktrees/release-<ver> -b codex/release-<ver>
origin/dev_3`, commit version, rồi `npm ci` (~15 giây; postinstall dựng `better-sqlite3` cho Electron arm64). Script build chỉ dọn
`dist/`/`dist-server/` của chính worktree, không đụng bộ cài trong repo chính. Bộ kiểm App Server đọc
`dist-server/private/verification-before.json` của checkout đang build, nên tạo file này trong worktree ngay trước
`build:server:win:private`. Xong thì chép bộ cài sang `dist/build-<ver>/` và `dist-server/` của repo chính. Script hậu kiểm Desktop
của 9.4.0 (`~/.codex/builds/akaagent-9.4.0-*/verify-build.cjs`) dùng lại được: đổi `root`, số bản, `(9<<16)+<minor>`, và dùng
`path.resolve` cho file nằm ngoài worktree. Script, log, manifest của 9.6.0 ở `dist/build-9.6.0-work/` của repo chính.

**Bộ script dùng lại (14/11/2026, 9.7.0).** `dist/build-9.7.0-work/` của repo chính có đủ một lượt build, chạy trong worktree
release: `snapshot.cjs before` (manifest đầu vào, checksum bộ cài cũ của repo chính, `before.json`) → `run-checks.sh` (typecheck +
smoke, gồm smoke của các PR mới phải tự thêm) → `run-builds.sh` → chụp `dist-server/private/verification-before.json` →
`build:server:win:private` → `verify-private-server-build.cjs <thư mục private>` → `verify-build.cjs` (sinh từ bản trước bằng sed:
đường dẫn worktree, số bản, `(9<<16)+<minor>`, tiền tố thư mục tạm) → `snapshot.cjs after` → `server-graph.cjs` (đồ thị App Server
giao diff từ Server lần trước) → `make-receipt.cjs` (receipt JSON từ các file kiểm). Đổi số bản trong các script rồi chạy đúng thứ tự.
Smoke hỏng thì chạy lại ở commit trước PR liên quan (worktree tạm, `node_modules` symlink) để biết lỗi có sẵn hay do bản build.

**Chỉ build Desktop (16/11/2026, 9.8.0).** `dist/build-9.8.0-work/` của repo chính là bộ script trên, bỏ hai bước App Server.
`verify-build.cjs` kiểm thêm dấu nguồn của các PR mới trong `out/main/index.js` và một dấu phải vắng (lời gọi V498 đã bỏ).
`server-graph.cjs` phải chạy từ **gốc worktree** (`node dist/build-<ver>-work/server-graph.cjs`): khoá `metafile` của esbuild tính
theo thư mục đang đứng. Chạy từ thư mục work thì mọi đường dẫn lệch và kết quả luôn là 0 file đổi, không báo lỗi (9.8.0: 0 → 12 khi
chạy đúng chỗ).

**Dấu kiểm trong `out/main/index.js` (17/11/2026, 9.9.0).** Chỉ chọn chuỗi của code thật sự được gọi: hàm repository export mà
không nơi nào gọi bị bỏ khỏi bản build (9.9.0: `aka_agent_campaign_repeat_state_v1` của `getCampaignRepeatStates`), hậu kiểm báo
thiếu dấu dù bản build đúng. Kiểm trước bằng `grep -o` trên `out/main/index.js` của worktree sau `npm run build`. Smoke dò mã nguồn bằng
regex dễ lệch khi PR khác thêm phần tử vào cùng danh sách (`aff-partner-desktop-smoke` hỏng ở 9.9.0 vì #690 thêm khoá sau
`affiliate.program`): xem log trước khi coi là lỗi app.

**Build 10.0.0 (18/11/2026).** `dist/build-10.0.0-work/` của repo chính: script để luôn ở thư mục này (không chép vào worktree), đường
dẫn worktree ghi cứng trong script, log ghi thẳng vào đây; `make-receipt.cjs` ghi biên nhận vào `docs/audits/` của worktree.
`CLAUDE.md` của checkout chính thường có thay đổi chưa commit của phiên khác và có thể đổi giữa lúc build, nên chỉ ghi checksum trước /
sau, không kiểm giữ nguyên. Lên số chính (9 → 10): trước khi build kiểm mọi chỗ so phiên bản (updater `compareVersions`, ngưỡng
`desktop.updates.startup_prompt_max_version`, V511 `desktopMinVersion`) và chạy `updater.ts` thật với máy chủ phiên bản giả
(`00-v10-updater-check.cjs`); PE kiểm `(10<<16)+0`. `scripts/startup-update-prompt-smoke-test.cjs` hỏng từ `321e41fc` (bản giả chỉ có
`.from`, repository đọc RPC `aka_agent_desktop_startup_policy`), đừng dùng làm bằng chứng. Dấu kiểm mới phải vắng trong main của bản
trước (đọc `out/main/index.js` từ `app.asar` bản trước): nhiều câu tiến trình của engine trùng câu bộ cũ đã có ("🔀 Đã xáo trộn danh
sách", "đã được tạm dừng."), nên chọn tên hàm / khoá riêng của PR. `v572-smoke` chạy code block trong Chrome, có lúc lệch ở bản đối
chứng V563 (thời điểm hộp thoại của trang giả): chạy lại trước khi kết luận.

**Build lại cùng số bản (18/11/2026, 10.0.0 lần 2).** Bản đã build mà `dev_3` có code mới thì build lại cùng số: đổi tên
`dist/build-<ver>/` thành `dist/build-<ver>-r1-<base>/` (không xoá) và chuyển bằng chứng lần 1 vào thư mục con `r1-<base>/` của thư mục
work trước khi chạy lại, vì script ghi đè log cùng tên. Trước khi build lại, chép `out/main/index.js` và renderer từ `app.asar` của lần 1
để kiểm dấu của PR mới vắng ở lần 1. Version đã merge vào `dev_3` thì nhánh build lại không có commit đổi version. Biên nhận giữ lần 1 ở
mục riêng (receipt khoá `rebuild.replaces_round_1`).

**Build 10.1.0 (19/11/2026).** `dist/build-10.1.0-work/` của repo chính, cùng bộ script của 10.0.0 (đổi worktree, số bản,
`(10<<16)+1`). Bản đối chứng cho dấu mới là `app.asar` giải nén bằng `7za` từ bộ cài 10.0.0 đang trên feed; dấu mới của bản trước
(`markers-new.json` của nó) chuyển thành dấu phải còn. Hai smoke cần chú ý: `run-ai-chat-images-ui-smoke.cjs` dùng Chromium riêng của
Playwright (không có trên máy build) và chỉ nhận Chrome qua `AI_CHAT_UI_CHROMIUM`, không qua `CHROMIUM_PATH`;
`server-rest-request-reduction-smoke.cjs` chạy nguyên văn thân `sleepBetweenTargets` trong VM nên hỏng khi thân hàm gọi thêm hàm import (sau #724
cần cấp `monotonicNow`). Kịch bản engine trên DB như production thêm `SCENARIO_MULTI_SLOT_ARRAY=1` (V585, cần kèm `SCENARIO_CAMPAIGN_REPEAT=1`).
Build lại lần 2 cùng ngày vì #726 merge sau khi cắt nhánh: nhánh `codex/release-<ver>-r2` từ `dev_3` mới + cherry-pick commit version
(version chưa merge), cất bộ cài / bằng chứng lần 1 như 10.0.0. Chạy lại smoke bằng script lấy từ commit khác phải `git fetch` trước:
`git show <sha>:<file> > tệp` với commit chưa có trên máy cho tệp rỗng, và node chạy tệp rỗng vẫn thoát 0.

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
