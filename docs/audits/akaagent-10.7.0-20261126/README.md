# Build akaAgent Desktop + App Server 10.7.0 — 26/11/2026

Theo yêu cầu "sync code mới rồi deploy giúp tôi" (chọn "Tất cả ngay bây giờ" và "Build luôn"). Theo thứ tự:

1. Merge nhánh `claude/loving-mendel-zig1jb` (tự gửi cho người được gắn tag Zalo): akaAgent `dev_3` qua #797, ChatApi `dev` qua #195,
   WebApp `dev_1` qua #320 (cùng #321 sửa build Web).
2. Deploy ChatApi `api` → `worker` → `zalo_runtime` (image `dev-3ca5b90-20261126`) lúc 14:04–14:06 VN; biên nhận ở ChatApi
   `docs/DEPLOY_FLY_IO.md` (#196).
3. Deploy API/Web v144 lúc 14:21 VN; biên nhận ở WebApp `docs/WEB_APP_DEPLOY_20261126.md` (#322).
4. Build ba bộ cài Desktop 10.7.0 và bộ cài App Server nội bộ 10.7.0 (tài liệu này).

DB: mọi migration của các PR (V652–V661) đã apply trước, không apply gì thêm.

**Nguồn**

- Worktree `.claude/worktrees/release-10.7.0`, nhánh `codex/release-10.7.0`, source commit `3832c81d`, chỉ đổi version 10.6.0 → 10.7.0
  ở `package.json`, `package-lock.json` (hai chỗ của gói gốc), `version.txt`.
- Nền `origin/dev_3` `f45d44c8`, sau PR #797. `npm ci` sạch trong worktree; hai typecheck sạch trước build.

**Thời điểm build (VN, 26/11/2026)**

| Bản | Thời gian | Thời lượng |
| --- | --- | ---: |
| Windows | 14:24:32–14:25:58 | 86 giây |
| Mac ARM64 | 14:25:58–14:27:01 | 63 giây |
| Mac Intel | 14:27:01–14:28:04 | 63 giây |
| App Server nội bộ (Windows x64) | 14:28:04–14:28:58 | 54 giây |

**Bộ cài**

| Bản | Tệp | SHA-256 |
| --- | --- | --- |
| Windows | `dist/build-10.7.0/akaAgent-Setup-10.7.0.exe` | `5d137d2f5c2b424467d2de4cb22a7a80296d52874dcbdf27bed4021acb051375` |
| Mac ARM64 | `dist/build-10.7.0/akaAgent.dmg` | `62668f0deafe4ac774224f1abba5e4fef790096508a95e0bbf59f9335890dddd` |
| Mac Intel | `dist/build-10.7.0/akaAgentIntel.dmg` | `a29736d21519446671ba027ff177ffb78602947112b195e3f1dff96dbd4363ec` |
| App Server nội bộ | `dist-server/akaAgent-Zalo-Server-Internal-Setup-10.7.0.exe` | `93201a4b5cd21f7b36e2be8265626344562b11d89d05f59e370e10aeb07f61ed` |

App Server phải build lại: 27/265 file của gói App Server đổi sau 10.6.0 (dịch vụ hỏi tag Zalo, loại trừ gửi, lõi engine). Bộ cài nội bộ có
khoá backend, chỉ cài trên VPS do akaBiz quản lý.

## Có gì mới so với 10.6.0

- #789 form xin email sau đăng nhập (V652 + V656).
- #790 Zalo "Đã nhận" ở bộ lọc / danh sách / báo cáo (V653).
- #792 loại trừ gửi theo nhiều Zalo, Nhóm data, chiến dịch đã gửi (V654 / V655 / V657).
- #793 comment seeding mở nhóm ra trang xác minh / đăng nhập: FB04 / FB43 thay FB45 (V658).
- #794 lỗi mạng / proxy khi mở trang Facebook → NET01 / NET02 (V659).
- #797 tự gửi cho người được gắn tag Zalo: dịch vụ hỏi tag ở Desktop / App Server, ô chọn, công tắc Dừng / Tiếp tục, lõi engine kiểm bạn bè (V660).
- #791 / #795 / #796: chỉ tài liệu hoặc chỉ DB.

## Hậu kiểm

- `verify-build.cjs`: cả ba bộ cài đạt (version 10.7.0 ở ASAR / `resources/version.txt` / PE / Info.plist, kiến trúc executable và `.node`,
  không có khoá `service_role` / `sb_secret_` / anon cũ, payload khớp app). Dấu của #789–#797 có trong bản mới và vắng trong main / renderer của
  bộ cài 10.6.0 đang trên feed; dấu của 10.0.0 → 10.6.0 vẫn còn.
- `verify-private-server-build.cjs`: App Server đạt.
- Manifest đầu vào build trước / sau giống nhau (2.009 file).

## Bộ kiểm

158 bước: 132 đạt, 26 hỏng, tất cả đã giải thích (`build-receipt.json` mục `checks_failed_explained`):

- 21 bước hỏng giống hệt 10.6.0 (so log). Các bước có bản chép đã vá hoặc cần đúng biến môi trường thì chạy lại đều đạt
  (`03-reruns-summary.log`). Ba bài phát lại dữ liệu thật không chạy được vì tệp đầu vào đã bị dọn.
- 5 bài mới của 10.7.0 hỏng do môi trường máy build (Chromium riêng của Playwright, bash 3.2, đường dẫn PG, checkout ChatApi cũ); chạy lại đúng
  môi trường thì 4 bài đạt.
- `email-prompt-ui-smoke` (#789) vẫn hỏng ở bước 7: DB trả gợi ý tên miền nhưng form không hiện gợi ý. Bài này hỏng y như vậy ở chính commit
  merge #789, nên lỗi có từ trước bản build. Chưa rõ do bài kiểm hay do form, cần kiểm riêng.

## Chưa làm / giới hạn

- Chưa phát hành (anh tự phát hành); App Server chưa cài VPS. Tài khoản Server trên VPS chỉ đọc tag sau khi cài bản này.
- Windows chưa ký Authenticode, chưa chạy trên Windows thật; Mac ký ad-hoc, chưa notarize.
- Chưa chạy luồng đăng nhập, chiến dịch hay Zalo / Facebook thật trên bộ cài; tự gửi cho người được gắn tag chưa thử với chiến dịch thật.

Script, log, manifest: `dist/build-10.7.0-work/` của repo chính.
