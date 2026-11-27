# Build akaAgent Desktop + App Server 10.8.0 — 26/11/2026

Theo yêu cầu ("rà soát task tôi làm trên máy này hôm nay xem đã xong hết chưa? đã merge hết chưa? xong hết rồi thì deploy đi", "Không chờ V669").
Theo thứ tự:

1. Rà task hôm nay trên máy: mọi PR code đã merge (akaAgent #798–#810, WebApp #324–#327, ChatApi #197–#199).
2. Deploy ChatApi `api` → `worker` → `zalo_runtime` (image `dev-972e138-20261126`) lúc 21:22–21:24 VN; biên nhận ở ChatApi `docs/DEPLOY_FLY_IO.md`.
3. Deploy API/Web v147 lúc 21:22 VN; biên nhận ở WebApp `docs/WEB_APP_DEPLOY_20261126.md`.
4. Build ba bộ cài Desktop 10.8.0 và bộ cài App Server nội bộ 10.8.0 (tài liệu này).

DB: mọi migration của các PR (V662–V668, V670) đã apply trước, không apply gì thêm. V669 (nhánh `claude/loving-mendel-zig1jb` của dung688) chưa
apply, không nằm trong bản này.

**Nguồn**

- Worktree `.claude/worktrees/release-10.8.0`, nhánh `codex/release-10.8.0`, source commit `5f91bbfc`, chỉ đổi version 10.7.0 → 10.8.0
  ở `package.json`, `package-lock.json` (hai chỗ của gói gốc), `version.txt`.
- Nền `origin/dev_3` `581826a0`, sau PR #810. `npm ci` sạch trong worktree; hai typecheck sạch trước build.

**Thời điểm build (VN, 26/11/2026)**

| Bản | Thời gian | Thời lượng |
| --- | --- | ---: |
| Windows | 21:25:37–21:26:56 | 79 giây |
| Mac ARM64 | 21:26:56–21:27:50 | 54 giây |
| Mac Intel | 21:27:50–21:28:46 | 56 giây |
| App Server nội bộ (Windows x64) | 21:28:46–21:29:32 | 46 giây |

**Bộ cài**

| Bản | Tệp | SHA-256 |
| --- | --- | --- |
| Windows | `dist/build-10.8.0/akaAgent-Setup-10.8.0.exe` | `d80848dc35ec805cf22efdc2973599fa866d52f9cb67ba0ed4e230cb7074ae93` |
| Mac ARM64 | `dist/build-10.8.0/akaAgent.dmg` | `2e399ebfc4f766495ef3d361fce7be31e25674e4f5a3322d83156bdaced283d3` |
| Mac Intel | `dist/build-10.8.0/akaAgentIntel.dmg` | `4fb43389654e06b941a91b980974f1762cea09c6bf7464aeb8ac619ca7ec8e94` |
| App Server nội bộ | `dist-server/akaAgent-Zalo-Server-Internal-Setup-10.8.0.exe` | `8e142c3924092221a0846d2d3259a1e999de136b3a469a5c7781c80376aaf65b` |

App Server phải build lại: 32/269 file của gói App Server đổi sau 10.7.0 (engine v2 cho tài khoản Server trên VPS, loại trừ gửi V666, chạy cùng
lúc, Global ID thành viên nhóm). Bộ cài nội bộ có khoá backend, chỉ cài trên VPS do akaBiz quản lý.

## Có gì mới so với 10.7.0

- #798 / #808 đồng bộ định kỳ Google Sheet vào data chiến dịch (V662 / V664).
- #803 FB06 chuyển Page: chờ menu tài khoản, đọc danh tính bằng `i_user` (V663), dừng mềm ra RUN01.
- #804 sửa lỗi review loại trừ gửi nhiều Zalo (V666): kiểm lúc nhận lượt, header `x-aka-send-exclusion-runner`, công tắc mới
  `campaign.send_exclusion_multi_zalo_v2`.
- #805 engine v2 cho tài khoản Zalo Server trên VPS (V667), nơi chạy `server`, công tắc `engine.zalo_server_vps`.
- #807 / #809 quét thành viên nhóm Zalo không ghi Global ID của chính nick (V668).
- #810 chạy cùng lúc chiến dịch Zalo trên một tài khoản (V670), ô tích theo chiến dịch.
- #799 / #800 / #801 / #802 / #806: biên nhận, sửa bài kiểm hoặc chỉ DB.

## Hậu kiểm

- `verify-build.cjs`: cả ba bộ cài đạt (version 10.8.0 ở ASAR / `resources/version.txt` / PE / Info.plist, kiến trúc executable và `.node`,
  không có khoá `service_role` / `sb_secret_` / anon cũ, payload khớp app). Dấu của #798–#810 có trong bản mới và vắng trong main / renderer
  của bộ cài 10.7.0 đang trên feed (`app.asar` Mac ARM64 cùng lần build với `akaAgent.dmg` sha256 `62668f0d…`); dấu của 10.0.0 → 10.7.0 vẫn còn.
- `verify-private-server-build.cjs`: App Server đạt.
- Manifest đầu vào build trước / sau giống nhau (2.079 file).

## Bộ kiểm

182 bước: 154 đạt, 28 hỏng, tất cả đã giải thích (`build-receipt.json` mục `checks_failed_explained`):

- 25 bước hỏng giống hệt 10.7.0 (so thông báo lỗi trong log). Các bước có bản chép đã vá hoặc cần đúng môi trường thì chạy lại đều đạt
  (`03-reruns-summary.log`, 18 bước). Ba bài phát lại dữ liệu thật không chạy được vì tệp đầu vào đã bị dọn.
- 3 bước hỏng mới, đều là bài kiểm / môi trường, chạy lại đạt:
  - `session-clock-skew-smoke`: từ #804 `supabaseClient.ts` import thêm `../../shared/campaignSendExclusion`, bài chưa giả module này
    (bản chép 15/15);
  - `notification-v622-smoke`: hỏng theo giờ chạy sau 21:00 VN (bản chép mốc +20 / +40 phút);
  - `sheet-sync-ui-smoke` (#798): chỉ nhận Chromium riêng của Playwright, máy build không có (bản chép dùng Chrome của máy, 10/10).
- `zalo-tag-fly-fuzz` hỏng ở 10.7.0 nay đạt (`CHAT_REPO` trỏ vào bản ChatApi `dev` mới).
- Bài mới của #798–#810 đều đạt: V662 / V664 / V665 / V666 / V667 / V670 trên PG17, engine v2 Server trên VPS (runner, scheduler), chạy
  cùng lúc (Desktop, giao diện, kịch bản), Global ID thành viên nhóm, FB06 V663 (Chromium + Electron).

## Sau build (cùng tối)

- Desktop 10.8.0 đã phát hành: feed ba nền tảng trả 10.8.0, bộ cài tải lên 21:47 VN cùng số byte với bản build.
- App Server 10.8.0 chạy trên VPS từ 21:45 VN; `engine.zalo_server_vps` = `{"mode":"all"}` từ 21:40 VN (không do phiên build đổi).
- Loại trừ gửi nhiều Zalo bản mới bật cho mọi khách 21:59:30 VN theo yêu cầu ("bật cho toàn bộ luôn đi"): `send_exclusion.runtime` =
  `{"server":true,"desktopMinVersion":"10.8.0"}`, `campaign.send_exclusion_multi_zalo_v2` = `{"audience":"all"}`.

- Cách A của tự gửi cho người được gắn tag Zalo (akaAgent #812, ChatApi #200, WebApp #328, của dung688) merge 22:09 VN, sau bản build này:
  Desktop 10.8.0, ChatApi `972e138` và Web v147 chưa có phần code đó. V669 / V671 của nhánh đó đã apply 21:46 VN (chạy được với bản cũ).

## Chưa làm / giới hạn

- Windows chưa ký Authenticode, chưa chạy trên Windows thật; Mac ký ad-hoc, chưa notarize.
- Chưa chạy luồng đăng nhập, chiến dịch hay Zalo / Facebook thật trên bộ cài; chạy cùng lúc chưa thử với chiến dịch thật trên Desktop.

Script, log, manifest: `dist/build-10.8.0-work/` của repo chính.
