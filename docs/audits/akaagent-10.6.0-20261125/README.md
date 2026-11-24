# Build akaAgent Desktop + App Server 10.6.0 — 25/11/2026

Theo yêu cầu "cần deploy và build những gì thì làm đi, sau đó tôi sẽ phát hành", đã làm đủ các bước đưa lên của PR #780–#786 trừ phần anh tự làm. Theo thứ tự:

1. Apply V650 lúc 00:52 VN.
2. Deploy ChatApi `worker` lúc 00:56 VN.
3. Build ba bộ cài Desktop 10.6.0 (Windows x64, macOS ARM64, macOS Intel x64) và bộ cài App Server nội bộ 10.6.0.

Web không cần deploy: bản đang chạy (Fly v143, 23:24 VN 24/11) đã có #305–#308 của WebApp.

**Nguồn**

- Worktree `.claude/worktrees/release-10.6.0`, nhánh `codex/release-10.6.0`, source commit `dc3ca1577317bd8f29077c39a22b10d1cad6e179`.
- Commit này chỉ đổi version 10.5.0 → 10.6.0 ở `package.json`, `package-lock.json` (hai chỗ của gói gốc) và `version.txt`.
- Nền là `origin/dev_3` `5f0f20e3c8cf17a7d96c28b217129adc4b4539c9`, sau PR #786.
- Dependency cài sạch bằng `npm ci` trong worktree, xong lúc 00:58:05 VN. `better-sqlite3` dựng cho Electron arm64, checksum `ced697fc…`, trùng repo chính.

**Thời điểm build (VN, 25/11/2026)**

| Bản | Thời gian | Thời lượng |
| --- | --- | ---: |
| Windows | 00:59:38–01:01:06 | 88 giây |
| Mac ARM64 | 01:01:06–01:02:09 | 63 giây |
| Mac Intel | 01:02:09–01:03:12 | 63 giây |
| App Server nội bộ (Windows x64) | 01:03:12–01:04:03 | 51 giây |

**Phát hành:** anh tự phát hành. Kiểm 02:07 VN 25/11: feed Windows, Mac, Mac Intel trả 10.6.0; ba bộ cài trên akabiz.net tải lên 01:07:16–01:07:33 VN 25/11, cùng số byte với bản build (chỉ so số byte). App Server chưa rõ đã cài VPS chưa (anh cài). Bộ cài App Server có khoá backend trích được: chỉ cài trên VPS do akaBiz quản lý, không phát hành.

## Có gì mới so với 10.5.0

10.5.0 (`dd4395ed`) đang trên feed. Mọi PR dưới merge `dev_3` ngày 24–25/11, sau lúc build 10.5.0.

- **#780 — AI lọc bài / comment Facebook.**
  - DB đã apply V640–V646 và V642 ngày 24/11, có hiệu lực ngay ở mọi bản app.
  - Bản này thêm phần Desktop: ô "Ý nghĩa … (dùng AI)" có ví dụ và chặn lưu khi bật mà để trống; ô nổi aka Cài đặt có danh sách ô đã đổi, Hoàn tác, nhãn "aka điền".
- **#781 — người lạ nhận ảnh mà thiếu chữ (Z127).**
  - Bộ chạy cũ dùng câu mới "Người nhận đã nhận ảnh nhưng chưa nhận được chữ".
  - Form có cảnh báo khi nhắn người lạ từ 3 ảnh mà nghỉ dưới 300 giây. Chỉ cảnh báo, không chặn lưu.
  - V647 đã apply 24/11.
- **#783 — kiểm cú pháp nội dung ở đường lưu Desktop.**
  - Chặn biến / ngoặc viết dở khi tạo / sửa chiến dịch và lưu mẫu nội dung. Form hỏi lại "Sửa giúp" / "Vẫn lưu".
  - Công tắc `campaign.content_syntax_guard` chưa có dòng, mà thiếu dòng nghĩa là `block` (chặn).
  - Theo PR #783, câu hiện cho khách là bản nháp chờ anh duyệt.
- **#784 + #786 — ba lỗi hẹn giờ khách báo 24/11.**
  1. Hằng ngày có giờ dừng mà không tích "hôm sau tiếp tục" thì chỉ chạy ngày đầu.
  2. Lịch tuần / tháng có làm mới data không còn báo "hoàn thành" mà hẹn ngày chạy kế.
  3. Data tạm dừng không còn chặn làm mới lịch.
  - Bộ chạy cũ ở Desktop / App Server; engine v2 ở V650 (viết là V648, đổi số ở #786).
- #782, #785 chỉ tài liệu / version.

## Deploy trước khi build

**V650** (`migrations/migration_v650_engine_recurring_refresh_pass.sql`, [biên nhận](../../../migrations/snapshots/engine-recurring-refresh-v650/apply-receipt.json)):
- Trước khi apply (chỉ đọc, 00:52:11):
  - thân `aka_agent_engine_finish_campaign_v2` đúng bản nguồn `ed7406cb…`;
  - sổ chưa có V650;
  - 1 backend đang chạy.
- Chạy thử trong giao dịch tự huỷ (00:52:24): trong giao dịch, thân hàm đúng bản mới `9b29fe98…`; sau khi huỷ, vẫn là bản cũ.
- Apply 00:52:34–00:52:36 VN, cùng dòng sổ trong một giao dịch: sổ `20261124175234`, md5 sổ = file `521e6ac6…`. Không apply lại.
- Sau apply:
  - thân hàm `9b29fe98…`, quyền / chủ sở hữu / cấu hình giữ nguyên;
  - PostgREST nạp lại schema trong 1,9 giây;
  - 00:50–00:58 VN: 0 lỗi 5xx / 503, phút 00:52 có 83 request quá 1 giây.

**ChatApi `worker`:**
- Bản deploy: `dev` `1a808cb` (#192, CI đạt). Image `dev-1a808cb-20261125@sha256:bef5169bf07102edb7a7024a48247ebe57dd3b3692c68c57f29acaaea08e73de`, dựng 00:53:30–00:54:41 VN từ `git archive` của `1a808cb`.
- So với bản `worker` trước (`dev-69b941a-20261124`), chỉ thêm #192: bảo trì lịch đầu ngày như Desktop.
- `api` giữ `dev-69b941a-20261124`, `zalo_runtime` giữ `dev-da53b11-20261118`.
- Trình tự:
  - 00:55:41 kiểm: 0 lượt Fly đang mở, 0 lượt bắt đầu trong 10 phút, 0 lệnh Zalo đang chờ trong 1 giờ;
  - 00:55:54 SIGTERM Node (PID 640), máy dừng lúc 00:56:03;
  - 00:56:08 `fly machine update 784574da214578 --image … --skip-start --yes`, 00:56:20 `fly machine start`.
- Kiểm: `packages/database/dist/campaignRuntimeRepository.js` trên máy có `SINGLE_DAY_STOP_CAMPAIGN_NOTE` / `SCHEDULE_DAY_TOKEN`; worker nhận lượt engine lúc 00:56:56.
- Gỡ: SIGTERM Node, chờ `stopped`, rồi `fly machine update 784574da214578 --image registry.fly.io/aka-agent-chat-api:dev-69b941a-20261124@sha256:7a132f368e8b03c56e3cda149b7b719000cc8c5f312a6b82946770f3c6f30079 --skip-start --yes` và `fly machine start 784574da214578`.

## App Server: có build lại

Gói App Server có 258 file nguồn; 9 file đổi so với bản App Server 10.3.0 (`120d54a7`). Trong đó có `campaignScheduler.ts`, `campaignRepository.ts` (ba lỗi hẹn giờ, câu Z127), `contentSyntaxGuard.ts`, `contentSyntax.ts`, `campaignRecurringPass.ts`. Danh sách ở `dist/build-10.6.0-work/server-graph.json`.

`scripts/staff-rls/verify-private-server-build.cjs` đạt:
- Windows x64;
- payload installer khớp bản dựng;
- khoá backend chỉ nằm trong tài nguyên riêng;
- main Server khớp `out-server`;
- quét 5.243 tệp không lộ khoá;
- bộ cài cũ và module gốc giữ nguyên.

## Bộ cài

| Bản | File | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Windows x64 | `dist/build-10.6.0/akaAgent-Setup-10.6.0.exe` | 153594530 | `b4f842ef1ddb1517fbc2ef4fb2c2af9b60756747c737caa5c53f0f77259b1fb2` |
| macOS ARM64 | `dist/build-10.6.0/akaAgent.dmg` | 183240459 | `d7f5188d8a3d44e523d86f735611cc2bd9e57e3ee1dbe69a9701cf7ab1f8f190` |
| macOS Intel x64 | `dist/build-10.6.0/akaAgentIntel.dmg` | 190422464 | `8fb96d705d4a162de88bf56e4dae51f92ffbf79aee2e9bb2bcd5dde8be81a8ba` |
| App Server nội bộ | `dist-server/akaAgent-Zalo-Server-Internal-Setup-10.6.0.exe` | 140585784 | `5f962fd85621a0c1bf05ce39b9305f261305e9cbe1df0da33f2454799e2ba748` |

Đường dẫn tính từ repo chính. Bản gốc App Server và hai file verification nằm ở `dist-server/private/2026-11-24T18-03-12-354Z/`. `dist/build-10.6.0-work/` chứa log, file kiểm, script và các bản chép đã vá.

## Kiểm chứng

Thứ tự theo build-01: hai typecheck trước khi build; build xong cả bốn bản rồi mới chạy toàn bộ bộ kiểm (01:04–01:39 VN), không chạy song song với build.

**Mã nguồn.** Hai typecheck không lỗi. 117/140 bước đạt. 23 bước lỗi đều đã giải thích, không bước nào do bản build:

| Bước | Vì sao |
| --- | --- |
| `server-rest-smoke`, `post-bump-fixes-smoke`, `post-bump-rotation-smoke`, `upgrade-portal-desktop-smoke` | Lỗi của bài kiểm như 10.3.0 → 10.5.0, thông báo giống hệt 10.5.0. Bản chép đã vá (`*-patched`) trong bộ kiểm: đạt. |
| `message-status-sync-smoke`, `pending-reason-smoke`, `engagement-smoke` | Hỏng sẵn, thông báo giống hệt 10.5.0. |
| `share-repeat-smoke`, `repeat-scheduler-smoke`, `repeat-runtime-e2e` | Lỗi của bài kiểm do #784. `handleCampaignCompletion` gọi thêm `handleRecurringRefreshAfterCompletion`, mà bài dựng lại hàm của bộ lập lịch không có hàm này. Bản chép `patched-repeat/` thêm hàm giả trả `false` cạnh hàm giả `handleRerunAfterCompletion` có sẵn (ca của bài đều là lịch hằng ngày): cả ba đạt. |
| `campaign-schedule-ai-ui-smoke` | Lỗi của bài kiểm do #784: bài dựng lại `resolveNextSchedule` trong VM mà thiếu hằng `SCHEDULE_DAY_TOKEN`. Bản chép `patched-schedule-ai/` thêm tên này: đạt. |
| `multi-slot-v585-smoke` | Theo giờ chạy. Ca 6 hẹn 08:00 VN hôm nay; chạy lúc 01:18 thì lịch chưa tới, bài báo lỗi trước dòng bỏ qua của chính nó. Nhóm 1–5 đạt. Bản chép `patched-v585/` bỏ ca 6 khi trước 08:00: đạt phần còn lại (gồm gỡ / apply lại). |
| `campaign-result-groups-desktop-smoke` | Lỗi môi trường của lần này: bản WebApp `dev_1` dùng để so md5 thiếu thư mục `apps/web`. Chạy lại với bản đủ: 5/5. |
| `fb-ai-filter-test-v641`, `-v641_paste`, `-v643`, `-v644`, `-v645`, `-v646` (#780) | Lỗi môi trường: bài dựng Postgres bằng `initdb -U postgres` còn `psql` dùng user của máy (bài viết cho container Linux). Chạy lại với `PGUSER=postgres`: cả 6 đạt. |
| `fb-replay`, `fb-replay-20261118`, `post-bump-rotation-replay`, `post-bump-rotation-replay-patched` | **Không chạy được, không tính là đạt.** Tệp đầu vào (bản chép production ở scratchpad) đã bị dọn lúc 00:04 VN 25/11. Không dựng lại được cùng dữ liệu: đó là lượt bộ cũ ngày 16 / 18/11, và từ 18/11 Facebook chạy hết bằng engine. |

Chạy lại ngoài bộ kiểm: `03-reruns-summary.log`. Hai lượt đầu của `repeat-runtime-e2e` / `campaign-schedule-ai-ui-smoke` bản chép lỗi vì `require('./…')` tương đối; sửa đường dẫn thì đạt (`-b`).

Bài kiểm của các PR mới đều đạt:
- #780:
  - `form-helpers-smoke`, `v641-blocks-smoke` (code thật 10 block lọc trong vm), `v643-schema-check`;
  - 6 bài migration trên PG17;
  - bản chép UI `campaign-schedule-ai`.
- #781:
  - `zalo-partial-send-log-smoke`, `zalo-stranger-media-pacing-smoke`;
  - `zalo-stranger-media-pacing-ui-smoke` (form thật trên Electron, 18 ca).
- #783: `content-syntax-desktop-smoke` (so md5 với WebApp `dev_1`); `content-syntax-fuzz` (3.030 nội dung, không vi phạm).
- #784 / #786:
  - `campaign-schedule-fixes-smoke` 12/12;
  - `recurring-refresh-v650-smoke` 7/7;
  - giả lập `schedule-fixes-sim` (1.800 ca, engine chạy 481 ca qua V650, 0 sai lệch).
- V621 / V622 / V624 chạy lúc 01:36 VN bằng bản chép bash 3.2: đạt (sau 00:02 nên không dính giờ chạy).

Số liệu nổi bật:

- `campaign-outcome-engine-check-all`: 35 bước đạt.
- Kịch bản sự cố Facebook, cả ba bộ 0 vi phạm:
  - mặc định: 3 hạt giống / 182 cú gửi;
  - DB như production: 20 hạt giống / 1.108 cú gửi;
  - dừng app ngẫu nhiên + chạy bằng Page: 12 hạt giống / 799 cú gửi.
- Kịch bản engine trên DB như production: 532 lượt, 2.981 lần gửi; 0 vi phạm mới, 1 vi phạm đã biết (I1b).
- Giả lập dài theo dõi tương tác: Desktop 100% / 99,81%, VPS 100% / 99,92%.

**Bộ cài Desktop.** `dist/build-10.6.0-work/verify-build.cjs` đạt cả ba bản:

- Version: `version.txt` trong `resources/` và version trong ASAR là 10.6.0; PE FileVersion / ProductVersion `(10<<16)+6`; Info.plist 10.6.0.
- 108 file `out/` trong ASAR khớp checksum bản dựng. Quét 627 (Windows) / 631 (Mac) tệp: không có tài nguyên Server, JWT `service_role`, `sb_secret_` hay anon key cũ.
- 96 dấu kiểm có đủ: các dấu của 10.0.0 → 10.5.0, cộng 7 dấu mới của #780 / #781 / #783 / #784 (`markers-new.json`). 7 dấu mới đều vắng trong main / renderer của bộ cài 10.5.0 đang trên feed. Lời gọi V498 vắng.
- Windows: payload NSIS khớp `win-unpacked`.
- Mac:
  - kiến trúc executable và mọi `.node` đúng;
  - chữ ký ad-hoc kiểm được;
  - SQLite nạp được (Intel qua Rosetta);
  - DMG mount chỉ đọc, nội dung khớp app.
- Manifest 1.935 tệp đầu vào giống hệt trước / sau build.
- 89 bộ cài cũ của repo chính giữ nguyên checksum.

**Thiết lập DB đọc lúc build** (chỉ đọc, 01:07 VN):
- `engine.facebook` mode all;
- `notifications.default_reports` audience all;
- `campaign.content_syntax_guard` chưa có dòng (= chặn);
- `web.akabiz_auto_sync`, `desktop.sleep_guard`, `zalo.message_status_sync.enabled` chưa có dòng;
- `web_scan.campaigns` chỉ tổ chức 1.
- Migration từ 23/11 20:00 VN: V640–V650.

## Giới hạn

- Windows chưa ký Authenticode, chưa cài / chạy trên Windows thật. Mac ký ad-hoc, chưa notarize; Intel chỉ thử SQLite qua Rosetta.
- Chưa chạy luồng đăng nhập, chiến dịch hay Facebook / Zalo thật trên bộ cài.
- App Server 10.6.0 chưa cài VPS. Tới khi cài, chiến dịch Zalo Server trên VPS vẫn chạy bản cũ của ba lỗi hẹn giờ. Engine v2 (V650) và Fly (worker) đã có bản sửa.
- Ba bài phát lại dữ liệu thật không chạy được (xem bảng).
- Kiểm cú pháp nội dung (#783): câu cho khách là bản nháp chờ duyệt; muốn tắt chặn mà không phát hành lại thì đặt `campaign.content_syntax_guard` = `warn` hoặc `off` (Desktop đọc lúc đăng nhập).

[Receipt](build-receipt.json).
