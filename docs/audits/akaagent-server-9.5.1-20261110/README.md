# Build akaAgent Zalo Server 9.5.1 — 10/11/2026

Đã build local App Server Windows x64 nội bộ từ repo chính `/Users/lequangnhut/Repos/akaAgent`, nhánh `claude/server-rest-request-reduction` (chưa push), source commit `d1400ddb37be5df697a3699085afe72bb1c7a29c`. Nhánh có hai commit trên `dev_3` = `origin/dev_3` tại `0700b2e4` (sau PR #622): `8e35255e` giảm request REST của App Server, `d1400ddb` chỉ đổi version trong `package.json`, `package-lock.json`, `version.txt`. Không dùng worktree.

Build **13:28:54–13:29:42 VN ngày 10/11/2026** (48 s) bằng `npm run build:server:win:private`, publish never. **Chưa cài lên VPS, chưa upload.** Không đổi DB, không deploy service, không build lại Desktop.

## Vì sao 9.5.1

Desktop 9.5.0 build từ `cf29bc19` (chưa phát hành) không có thay đổi giảm request, nên Server dùng số khác. App Server không có updater hay feed; số phiên bản chỉ để phân biệt khi cài và đối chiếu. Bản Server trước là 9.3.0 (05/11, `646ddd98`).

## Thay đổi so với Server 9.3.0

Gói Server có 166 file nguồn (đồ thị import từ `src/server/{main,preload,renderer}`, renderer vào từ `src/server/renderer/index.ts`). Từ `646ddd98`, 5 file trong số đó đổi:

- `campaignScheduler.ts`, `campaignRepository.ts`, `supabase.ts` (commit `8e35255e`), chạy trên Zalo Server:
  - nghỉ giữa hai mục tiêu: kiểm run control 15 giây/lần thay vì 5 giây; lần kiểm cuối trước mục tiêu kế tiếp giữ nguyên;
  - `enable_due_auto_account_actions()`: tối đa 1 lần/30 giây cho cả tiến trình;
  - một câu đọc chiến dịch đến hạn cho mọi tài khoản của tick; trang đầy 500 dòng, quá 200 tài khoản hoặc lỗi thì đọc từng tài khoản như cũ;
  - chiến dịch Zalo đã có đúng note hạn mức được bỏ qua tới hết thời gian chờ, muộn nhất 5 phút; sửa chiến dịch hoặc nhóm tài khoản thì kiểm lại ngay.
- `campaignScheduler.ts` (ghi chiến dịch đang chạy vào RAM cho heartbeat Desktop), `dataGroupRepository.ts` và `dataGroupIngestChunks.ts` (V483/V485): đã có trong Desktop 9.4.0/9.5.0, không chạy trên đường Zalo Server (xem [mục App Server của 9.5.0](../akaagent-9.5.0-20261110/README.md#app-server)).

Hành vi khác đi: lệnh tạm dừng/dừng hẳn bấm lúc chiến dịch đang nghỉ được nhận trễ tối đa 15 giây, nhưng không gửi thêm mục tiêu nào sau khi đã dừng. Chiến dịch đang bị chặn hạn mức chạy lại trễ tối đa 5 phút khi hạn mức được nới bằng cách khác ngoài sửa chiến dịch hoặc nhóm tài khoản. Facebook không đổi.

## Bộ cài

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `dist-server/private/2026-11-10T06-28-54-835Z/akaAgent-Zalo-Server-Internal-Setup-9.5.1.exe` | 140360184 | `257a6a5b6b507ed12f4b99ab7ced675cb23d6ba963e7172df6f5252634744ca1` |

Bản chép để mang đi cài: `dist-server/akaAgent-Zalo-Server-Internal-Setup-9.5.1.exe` cùng file `.sha256` (cùng checksum). Bộ cài chứa credential backend ở resource riêng ngoài ASAR: chỉ cài trên máy chủ quản lý, không upload công khai, không đưa vào Git hay Desktop.

## Kiểm chứng

- Hai typecheck đạt, cả bản incremental lẫn bản đầy đủ (`--composite false --incremental false`). Smoke giảm request 17/17, smoke phục hồi phiên Zalo Web và smoke chọn key 14 ca đều đạt.
- Manifest checksum 1.231 file đầu vào build (`src`, `scripts`, `build`, cấu hình gốc và version) chụp trước build, khớp sau build.
- `scripts/staff-rls/verify-private-server-build.cjs` đạt: payload giải nén từ installer khớp `win-unpacked`; executable x64; `out-server/main/index.js` trong ASAR khớp bản build; loader đọc credential trên profile sạch; credential không có trong ASAR, source, `out/`, `out-server/` (4.076 file); thư mục private bị Git ignore; 28 bộ cài/file Server cũ và native host giữ checksum.
- Version 9.5.1 ở `resources/version.txt` và `package.json` trong ASAR (main `out-server/main/index.js`). PE FileVersion 9.5.1, app x64 (`8664`), installer NSIS (`14c`), chưa có Authenticode.
- Main Server trong ASAR có mã mới (`getPendingCampaignsForAccounts`, `preclaimLimitSkips`, `claimEnableDueAccountActionsSlot`, nhịp 15 giây).
- Quét 162 file đóng gói: JWT duy nhất là credential `service_role` trong `resources/server-private/`; không có `sb_secret_` hay credential ở file khác. Log, receipt và file phụ trong thư mục build không chứa credential.
- Native SQLite của máy build khôi phục đúng checksum; Electron 33.4.11 arm64 nạp better-sqlite3 và `SELECT 1` đạt.

## Giới hạn và việc tiếp theo

Chưa ký Authenticode, chưa cài/chạy trên Windows thật, chưa cài lên VPS `103.153.72.222`. Không chạy runtime nghiệp vụ hay gửi tin. Mức giảm request (ước tính ~145 trên ~384 request/giây của VPS) chưa đo. Sau khi cài, so `edge_logs` theo IP VPS, trước và sau, trong cùng khung cao điểm 09:45–12:00 VN cho ba endpoint:

- `rpc/aka_agent_get_zalo_server_run_control_state`
- `rpc/enable_due_auto_account_actions`
- GET `/rest/v1/auto_campaigns`

## Cài lên VPS và đo sau cài — 10/11/2026

Người dùng báo đã cài bản này lên VPS. Theo `edge_logs` của IP VPS, tiến trình mới gửi request từ **13:41:50 VN** (câu đọc gộp `account_id=in.(…)`, `enable_due` 2 lần/phút). Agent không kiểm trực tiếp trên máy Windows.

- Lúc tiến trình cũ tắt (13:41:16–24 VN) có 97 lỗi 406 `PATCH auto_campaigns … status=eq.đang chạy`. Loại lỗi này có sẵn ở bản cũ (1 lần lúc 09:58 và 1 lần lúc 12:39 cùng ngày). Từ khi bản mới chạy tới 13:48 VN: 0 lỗi 4xx/5xx từ VPS. Chiến dịch Server vẫn chạy: lúc 13:47 có 412 lượt ghi kết quả hành động/phút, trước khi cài ~220/phút (đang chạy bù).
- 13:42–13:46 VN, p50 REST toàn hệ (cả client không phải VPS) từ ~60 ms lên ~580 ms rồi về 85 ms lúc 13:47. Postgres rảnh, nghẽn ở PostgREST. Khoảng này trùng đợt mọi tài khoản Zalo Server đăng nhập lại (`auto_account_logs` ~1.200/phút so với ~100). Lần sau nên cài ngoài giờ cao điểm.
- Request VPS mỗi phút, phút 13:47 so với trung bình 13:36–13:41 VN:

| Endpoint | Trước | Sau |
| --- | ---: | ---: |
| `enable_due_auto_account_actions` | 1.032 | 2 |
| Đọc chiến dịch đến hạn (từng tài khoản → gộp) | 2.935 | 978 |
| `auto_account_action_status` | 1.763 | 371 |
| Run control | 3.168 | 2.054 |
| `HEAD auto_campaign_details` | 1.258 | 985 |
| `GET auto_accounts` | 2.319 | 3.439 |
| `getCampaign` theo id | 3.266 | 3.517 |
| **Tổng** | **~23.000** | **19.854** |

Tổng mới giảm 14% vì Server đang chạy bù sau khi khởi động lại; chưa đo lúc ổn định.

- Hệ quả hiển thị: note đếm ngược mã Zalo 127 ("tạm nghỉ gửi tin N phút") và dòng "⚠️ Chưa thể chạy chiến dịch" trong lịch sử chạy chỉ đổi ~5 phút/lần thay vì mỗi phút (108–203 dòng/10 phút trước khi cài, 38 dòng/6 phút sau). Giờ chạy lại, hạn mức, dữ liệu và tạm dừng/xoá trên Web không đổi. Đã sửa ở code nhánh `claude/preclaim-countdown-note`, chưa build/cài.

[Receipt](build-receipt.json). Log, manifest và script kiểm chứng ở `/Users/lequangnhut/.codex/builds/akaagent-server-9.5.1-20261110T062619Z` (ngoài Git).
