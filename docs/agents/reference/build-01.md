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

**Build 10.2.0 (20/11/2026).** `dist/build-10.2.0-work/` của repo chính, script sinh từ 10.1.0 (đổi worktree, số bản, `(10<<16)+2`, bỏ phần
đối chiếu lần 1). Bản đối chứng là main / renderer giải nén bằng `7za` từ bộ cài 10.1.0 lần 2 đang trên feed; dấu của 10.0.0 và 10.1.0 đều phải
còn. Hai bài kiểm hỏng vì chính bài kiểm, không phải app: `upgrade-portal-desktop-smoke` (#732) so nguyên đối tượng thông báo của `uiStore` bằng
`assert.deepEqual`, nên vỡ khi #749 thêm khoá `extraAction` (bản chép bỏ khoá đó khỏi phép so: 22/22 đạt); `campaign-repeat-v561-smoke` có nhánh
theo giờ chạy coi từ 22:00 VN là "quá giờ trong ngày", nhưng chiến dịch thử dừng 23:59 và chạy lại sau 1 giờ nên 22:00–22:59 hàm DB vẫn hẹn chạy lại
(đúng V558): chạy bộ kiểm trước 22:00 hoặc sau 23:00. Smoke mới cần Chrome: `run-upgrade-portal-ui-smoke.cjs` qua `UPGRADE_UI_CHROMIUM`,
`v591/v597/v598/v603-smoke` và `facebook-messages-smoke` qua `CHROMIUM_PATH`. Giả lập dừng app: `scenarios.cjs --seeds 12 --interrupt 0.08 --pages 3`.

**Build 10.3.0 (21/11/2026, Desktop + App Server).** `dist/build-10.3.0-work/` của repo chính, script sinh từ 10.2.0 (đổi worktree, số bản,
`(10<<16)+3`); đối chứng là main / renderer giải nén từ bộ cài 10.2.0 đang trên feed. **Không chạy bộ kiểm song song với build:** `build:win`,
`build:mac:intel` và `build:server:win:private` thay `node_modules/better-sqlite3` của worktree bằng bản Windows / x64 trong lúc đóng gói (dựng lại
khi xong), nên các bài dùng SQLite cùng lúc lỗi `dlopen` hoặc báo đạt mà không chạy gì (phát lại Facebook ra 0 dòng khớp, thoát 0). Build trước
thì xong mọi build rồi mới chạy toàn bộ bộ kiểm. Bài kiểm dựng hàm của bộ lập lịch trong VM / harness phải được thêm hàm import mới mỗi khi PR thêm
lời gọi vào hàm được dựng (10.3.0: `isWebAccountPlatform` trong `server-rest-request-reduction-smoke`, `isGroupPostAnonymous` trong harness
`post-bump-content-rotation`); bài dò mã nguồn theo cửa sổ ký tự cố định vỡ khi hàm dài ra (`post-bump-fixes-smoke`, cửa sổ 6.000). Nhánh theo giờ
chạy của `campaign-repeat-v561-smoke` còn hỏng ở khoảng 23:3x VN (gửi lặp lại x phút sang ngày mới): chạy bộ kiểm trước 22:00 hoặc sau 00:00.
`zalo-campaign-engagement-smoke-test` và `campaign-pending-reason-smoke` hỏng sẵn trên `dev_3` (cũng hỏng trên `37efb347`). App Server: chụp
`dist-server/private/verification-before.json` (mọi `.exe` dưới `dist-server/` + module gốc, đường dẫn tương đối gốc worktree) ngay trước build,
bản build tự lấy khoá backend bằng `supabase projects api-keys` của phiên đã đăng nhập.

**Build 10.4.0 (22/11/2026, chỉ Desktop).** `dist/build-10.4.0-work/` của repo chính, script sinh từ 10.3.0 (đổi worktree, số bản,
`(10<<16)+4`); đối chứng là main / renderer giải nén từ bộ cài 10.3.0 đang trên feed. Typecheck trước build, build xong cả ba bản rồi mới chạy
toàn bộ bộ kiểm. Bản chép đã vá của các bài kiểm hỏng ở 10.3.0 (`server-rest`, `post-bump-*`, `upgrade-portal`) chạy luôn trong `run-checks.sh`
dưới tên `*-patched`, khỏi chạy lại riêng. Bài kiểm DB dùng `scripts/notification-daily-reports/pgenv.sh` (V621 / V622 / V624) không chạy được
trên bash 3.2 của Mac (`"${AS[@]}"` rỗng dưới `set -u`, `declare -A`): dùng bản chép `dist/build-10.4.0-work/bash32/`. Ngoài
`campaign-repeat-v561-smoke` (22:00–22:59 VN), bài kiểm V621 / V622 cũng hỏng theo giờ chạy từ 23:00 VN (fixture đặt lịch `now() + 1 giờ`):
chạy bộ kiểm trước 22:00 hoặc từ 00:02 (lúc 00:00:44 `campaign-repeat-v561-smoke` còn hỏng ở nhóm engine kết thúc lượt, 00:01:13 thì đạt). `akabiz-auto-sync-desktop-smoke` cần `better-sqlite3` cho Node: chạy bằng
`ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron …` thay vì `npm rebuild` (rebuild đổi module của worktree mà build đang dùng).

**Build 10.5.0 (23/11/2026, chỉ Desktop).** `dist/build-10.5.0-work/` của repo chính, script sinh từ 10.4.0 (đổi worktree, số bản,
`(10<<16)+5`); đối chứng là main / renderer giải nén từ bộ cài 10.4.0 đang trên feed. Ba bài DB V621 / V622 / V624 chạy thẳng bằng bản chép
`bash32/` trong `run-checks.sh`. Đính chính 10.4.0: `smoke_v622` hỏng theo giờ chạy từ **21:00 VN**, không phải 23:00 (`v622_tests.sql` đặt
chiến dịch đăng fanpage ở `now() + 3 giờ`); V621 vẫn từ 23:00. Muốn chạy V622 sau 21:00 thì dùng bản chép `dist/build-10.5.0-work/patched-v622/`
(chỉ đổi hai khoảng thành + 20 / + 40 phút). Bộ kiểm chạy 20:57–21:33 VN (~36 phút cho 122 bước), nên bắt đầu trước 21:00 thì mọi bài theo giờ đều qua
trừ V622.

**Build 10.6.0 (25/11/2026, Desktop + App Server).** `dist/build-10.6.0-work/` của repo chính; `run-builds.sh` nay chạy luôn App Server sau ba
bản Desktop (chụp `dist-server/private/verification-before.json` → `build:server:win:private` → `verify-private-server-build.cjs`). Bài kiểm dựng
lại hàm của bộ lập lịch theo danh sách tên (zalo-share-repeat, campaign-repeat-scheduler / runtime-e2e, run-campaign-schedule-ai-ui) vỡ mỗi khi PR
thêm lời gọi / hằng mới vào hàm được dựng (10.6.0: `handleRecurringRefreshAfterCompletion`, `SCHEDULE_DAY_TOKEN` của #784); bản chép đã vá ở
`patched-repeat/`, `patched-schedule-ai/`, và bản chép nằm ngoài `scripts/` thì phải đổi `require('./…')` sang đường tuyệt đối.
`engine-v2-multi-slot-array-v585-smoke` hỏng trước 08:00 VN (ca 6 hẹn 08:00 hôm nay). Bài Python `scripts/fb-ai-filter/test_*.py` trên Mac cần
`PGUSER=postgres`. `WEBAPP_REPO` nên là bản `git archive origin/dev_1 packages apps` (đủ `apps/web`). Tệp phát lại dữ liệu thật ở scratchpad
(`replay-inputs/`) có thể bị dọn giữa hai lần build (25/11 00:04 VN): mất thì ba bài phát lại không chạy được, ghi rõ trong biên nhận.

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
