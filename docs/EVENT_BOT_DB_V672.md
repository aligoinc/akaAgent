# Bot sự kiện: DB V672

> **Đã apply akachat 12:53:55 VN 27/11/2026** (sổ `20261127055355`, md5 sổ = file `4b798fb6…`; không apply lại). Công tắc `event_bot` = `{"audience":"all","organizationIds":[],"runtimes":{"desktop":true,"server":true,"fly":false},"pollSeconds":30}` từ 12:54:23 VN (tắt: `audience` `off`). Job dọn `aka-agent-event-bot-maintenance` id 137. [Biên nhận](../migrations/snapshots/event-bot-v672/apply-receipt.json). Sửa DB từ nay phải là migration mới, dựng trên thân đang chạy.


Phần DB của [hợp đồng](EVENT_BOT_TECH.md) (mục 7a ghi các chi tiết thêm so với bản hợp đồng đầu). **Chưa apply production.**

- Migration: [migration_v672_event_bot.sql](../migrations/migration_v672_event_bot.sql) (~104 KB, md5 file `a29d091d893dbdc74079db3f97475c17`), gỡ: [rollback_v672_event_bot.sql](../migrations/rollback_v672_event_bot.sql).
- Kiểm: `bash scripts/event-bot/db/v672-smoke.sh` (PG16/17 cục bộ; fixture `v672-fixture.sql` theo cột production đọc chỉ
  đọc 26/11/2026, chạy V660 thật rồi V672).

## Đối tượng

| Loại | Tên |
|---|---|
| Bảng (RLS bật, thu hồi mọi quyền bảng và sequence) | `auto_event_bot_settings`, `auto_event_bot_rules`, `auto_event_bot_jobs`, `auto_event_bot_exclusions` |
| Công tắc | `auto_system_settings` `event_bot` = `{"audience":"off",…}` (`private.aka_agent_event_bot_config()` đọc; JSON sai = off) |
| Trigger | `trg_aka_agent_event_bot_tag_events` (AFTER INSERT câu lệnh, bảng chuyển tiếp, trên `auto_zalo_tag_member_events`); `trg_aka_agent_event_bot_group_origin_insert` / `_update` (AFTER dòng, `WHEN dynamic_filter_id IS NOT NULL`, trên `auto_account_contact_group_member_origins`) |
| Sửa hàm có sẵn | `private.aka_agent_zalo_tag_sync_watched` (V660, md5 thân `d21d55c1…` → `4bb3fc3d…`): thêm nhánh tài khoản có quy tắc `tag_change` bật (bot bật, qua công tắc, không phải akaChat) |
| RPC nơi chạy (`service_role`, `aka_agent_chat_api` chỉ `fly`) | `aka_agent_event_bot_sync_v1(p_source, p_account_ids)`, `_birthdays_v1(p_source, p_account_id, p_people)`, `_claim_v1(p_source, p_runner_id, p_account_ids, p_limit)`, `_report_v1(p_source, p_job_id, p_claim_token, p_result)` |
| RPC Desktop (`aka_agent_desktop`, nhân viên lấy từ `private.aka_agent_desktop_data_context()`) | `aka_agent_desktop_event_bot_sync_v1()`, `_birthdays_v1(p_account_id, p_people)`, `_claim_v1(p_runner_id, p_account_ids, p_limit)`, `_report_v1(p_job_id, p_claim_token, p_result)` |
| RPC trang (`service_role`, 15 giây) | `aka_agent_control_event_bot(p_staff_id, p_organization_id, p_action, p_payload)` |
| Job | pg_cron `aka-agent-event-bot-maintenance` mỗi phút → `private.aka_agent_event_bot_maintenance()` (trần 90 giây, dọn tối đa ~60 giây mỗi lượt) |
| Hàm private | config / access / runs_on / norm_phone / excluded / gap_hit / create_ctx / các lõi `*_core`, trigger, các hàm của RPC trang. Mọi hàm mới thu hồi EXECUTE khỏi PUBLIC, anon, authenticated, service_role (schema `private` có USAGE cho anon) |

Không đọc / ghi `auto_account_action_status`, `auto_campaign_details`, `auto_engine_leases`, `auto_campaigns` (bài kiểm so
md5 nội dung trước / sau và quét thân hàm).

## Cách chạy

- **Trigger tag:** một lần tra `auto_event_bot_rules (account_id, event_type)` mỗi tài khoản trong câu lệnh; không có quy
  tắc tag bật thì thoát. Mỗi dòng sổ tag khớp quy tắc đứng đầu (`position`, `id`) cùng chiều có tag đó. Lý do theo thứ
  tự: `not_person` (mã `g…`) → `tag_deleted` (gỡ ≥ 2 người và tag không còn ai trong `auto_zalo_tag_members`) →
  `bulk_tag` (> 20 dòng cùng tài khoản + tag + chiều trong câu lệnh; ghi từng dòng để báo cáo đếm đúng; chỉ ghi cho tag
  có quy tắc nên tag không cài bot không sinh dòng) → `excluded` → `min_gap`.
- **Trigger nhóm:** chỉ khi giao dịch đang giữ khoá advisory `data-group-dynamic-filter:<staff>` của job Bộ lọc động
  (xoá thành viên tay, chuyển / xoá nhóm không tạo việc). `enter` = nguồn bộ lọc mới / thành `is_current = true`,
  `leave` = `true → false`. Quy tắc khớp theo `data_group_id` = nhóm của thành viên và tài khoản của liên hệ.
- Mọi lỗi trong trigger: `RAISE WARNING`, câu gốc vẫn chạy (bài kiểm làm hỏng bảng việc bằng một CHECK rồi gửi lô tag).
- **Nhận việc:** khoá dòng settings `FOR UPDATE SKIP LOCKED` + chỉ mục duy nhất một việc `sending` mỗi tài khoản (bài
  kiểm 4 phiên đồng thời → đúng 1 việc). Kiểm lại trước khi giao như hợp đồng mục 5; tối đa 50 việc bị loại mỗi tài
  khoản mỗi lượt.
- **Tạm dừng:** chỉ ghi `auto_event_bot_settings.paused_until` / `pause_code` / `pause_reason`.

## Apply

Một giao dịch (`lock_timeout` 3 giây). Preflight dừng khi: sổ đã có `migration_v672_*`; bảng / công tắc đã có; thiếu
bảng, cột, hàm phụ thuộc; md5 thân `aka_agent_zalo_tag_sync_watched` khác `d21d55c1ea0d6396c6d16e39ca70ff2e`.
Postflight kiểm bảng, 3 trigger, md5 thân mới, công tắc off, quyền.

- DDL + CREATE TRIGGER trên `auto_account_contact_group_member_origins` (≈ 4 triệu dòng, 6 trigger sẵn có) và bảng sổ
  tag: PostgREST nạp lại schema; apply buổi tối, ngoài giờ cao điểm.
- File ~104 KB: gửi qua MCP có thể quá nặng (xem pitfall V525 trong CLAUDE.md: bảng tạm + `EXECUTE`), hoặc dán SQL
  Editor bản tự ghi sổ (`node scripts/make-migration-ledger-apply.cjs`).
- Sau apply: công tắc vẫn `off`. Mở dần: `admin_akabiz` → `orgs` → `all`.

## Gỡ

`rollback_v672_event_bot.sql`: bỏ job cron, 3 trigger, trả `aka_agent_zalo_tag_sync_watched` về nguyên văn V660 (kiểm
md5), xoá hàm, bảng (mất quy tắc, nhật ký, loại trừ của bot), dòng `event_bot`. Không xoá dòng sổ migration. Bài kiểm
chạy gỡ rồi apply lại.

## Kiểm thử (26/11/2026)

`bash scripts/event-bot/db/v672-smoke.sh`: 140 kiểm trong `v672-smoke.sql` + 10 kiểm ở script (apply, chặn apply lần
hai, vai `aka_agent_chat_api` đăng nhập thật, 4 phiên hỏi việc đồng thời, gỡ sạch, apply lại) đạt. Gồm: công tắc (4 mức,
JSON sai), trang (accounts / get / save + mọi lỗi kiểm quy tắc / revision / stop / exclusions / log / log_detail /
report / stats), sổ tag (lấy mốc, gắn, gỡ, quy tắc đứng đầu, nhóm Zalo, hàng loạt, tag bị xoá, loại trừ UID / SĐT /
danh sách dùng chung, `min_gap`, trigger lỗi, công tắc / runtime tắt), nhận việc và báo kết quả (một việc mỗi tài khoản,
sai token, báo lại, `no_msg_id` 30 phút, 120 24 giờ, 221 60 phút, mã khác, `unknown`, `tagged_again`,
`no_longer_tagged`, `rule_changed`, `expired`, tài khoản người khác / sai nơi chạy), job dọn (hết hạn, `runner_lost`, báo
muộn, 90 ngày), nhóm điều kiện (ngoài job lọc, vào, `no_uid`, tài khoản khác, true → true, ra, `left_group`, vào lại,
`min_gap` theo chiều), sinh nhật + App Server (sync, khoá năm VN, hạn 23:59:59 VN, gọi lại, sai nơi chạy), độc lập với
chiến dịch, quyền theo vai.

## Kiểm thử ngẫu nhiên lặp (27/11/2026)

Theo yêu cầu "Kiểm thử và cải tiến … cho đến khi ít nhất 3 vòng không còn vấn đề". Bộ thử ở `scripts/event-bot/fuzz/`:

- `db-fuzz.cjs`: dựng thế giới ngẫu nhiên (3–4 tổ chức, nhân viên nghỉ / xoá / admin, tài khoản Zalo QR / trình duyệt /
  Server / xoá / sai nền tảng / akaChat / đi Fly, danh bạ có UID nhóm, UID trống, SĐT nhiều kiểu, tag, danh sách không
  gửi, nhóm điều kiện có / không bộ lọc động) rồi chạy hàng trăm thao tác qua đúng đường production gọi: sổ tag qua
  `aka_agent_sync_zalo_tags` / `aka_agent_desktop_sync_zalo_tags` thật của V660; vào / ra nhóm bằng đúng các câu ghi của
  `aka_agent_process_data_group_dynamic_filters_core` (đọc production 27/11, chỉ đọc); sinh nhật, hỏi việc, báo kết quả
  (Desktop theo phiên, App Server, Fly), job dọn, lưu / dừng / loại trừ / nhật ký / báo cáo của trang; chạy đồng thời trên
  4 kết nối; thời gian trôi bằng cách lùi mọi mốc giờ; dữ liệu sai cố ý (quy tắc rác ghi thẳng vào bảng, payload sai kiểu,
  công tắc JSON hỏng, khoảng trắng Unicode, emoji, số ngoài khoảng). Mỗi thao tác so với mô hình độc lập (`model.cjs`,
  `save-model.cjs`, viết lại từ hợp đồng, luật kiểm theo `validateEventBotRule` của TS) và kiểm bất biến (một việc
  `sending` mỗi tài khoản, không gửi UID nhóm, không đụng bảng chiến dịch, báo sai token không đổi gì…). Cùng lúc so
  `normalizeEventBotPhone` (TS) với `aka_agent_event_bot_norm_phone` (DB) và phân trang nhật ký.
- `runtime-fuzz.cjs`: `EventBotRuntime` thật (bản Desktop và App Server) + lõi gửi thật với V672 thật, Zalo giả; chèn lỗi
  RPC trước / sau khi DB ghi, mất phiên, máy ngủ, app dừng / chết ngay sau khi Zalo nhận lệnh, danh sách bạn bè sai khuôn;
  kiểm mỗi lệnh gửi ứng với đúng một việc `sending`, không gửi hai lần, không gửi người bị loại trừ / tài khoản đang tạm
  dừng, kết quả DB khớp Zalo giả; dựng nội dung từ 400 mẫu tin thật.
- Một vòng: `PG_MODULE_DIR=<thư mục có node_modules/pg> EVENT_BOT_POOL=<mẫu thật ngoài repo> bash
  scripts/event-bot/fuzz/fuzz-round.sh <hạt giống> [số DB] [số vòng chạy] [ops]`. Mẫu thật mỗi vòng lấy mới bằng
  `tablesample … repeatable (<n>)` (SĐT / UID đã che trong SQL, tên, ngày sinh, tag, nội dung tin của chiến dịch) rồi tách bằng
  `extract-pool.py`; không commit mẫu.

Lỗi tìm ra và đã sửa trong V672 (chưa apply nên sửa thẳng file):

1. Nội dung chỉ gồm xuống dòng / tab / khoảng trắng Unicode (NBSP, U+3000, BOM) vẫn lưu được vì `btrim` chỉ cắt dấu cách;
   trang chặn (JS `trim`). Thêm `private.aka_agent_event_bot_blank`, dùng ở kiểm quy tắc và lúc nhận việc.
2. Báo kết quả lần hai cho việc đã báo `unknown` (lý do NULL) bị ghi đè: `j.reason_code = 'runner_lost'` ra NULL nên
   điều kiện "đã báo rồi" không chặn. Sửa `COALESCE`.
3. Quy tắc nhóm điều kiện thiếu `onEnter` / `onLeave` lưu được với `enabled: null` (vượt kiểm "bật ít nhất một tin", trang
   đọc sai kiểu). Sửa `COALESCE(…, false)`.
4. Cả tag bị thay hết người trong một lần đọc thì việc "gỡ tag" bị đánh `tag_deleted` (trigger câu xoá chạy trước câu thêm
   người mới). Thêm `private.aka_agent_event_bot_tag_alive`: có bảng tạm `v660_snapshot` của lần đọc thì xét theo nó.
5. API Web nhận tới 5.000 mục loại trừ mỗi lượt, DB chỉ 500 → dán quá 500 dòng ra "Yêu cầu không hợp lệ". DB nay nhận 5.000.
6. `position` ngoài khoảng integer (gửi sai) làm `save` ném lỗi tràn số chưa bắt (API trả 503). Ngoài ±1.000.000 thì dùng
   vị trí trong danh sách.

Các vòng (mỗi vòng: smoke 153 kiểm + các hạt giống DB + hạt giống vòng chạy, mẫu thật mới):

| Vòng | Mẫu thật | DB | Vòng chạy | Kết quả |
|---|---|---|---|---|
| thử bộ | 27/11 lần đầu | ~60 hạt giống × 150–900 | 6 | lỗi 1–4 (và lỗi của chính bộ thử) |
| 1 | `repeatable (201)` | 16 × 800 | 8 (571 lệnh gửi) | lỗi 6 |
| 2 | `repeatable (202)` | 16 × 800 | 8 (656) | 3 cảnh báo của bộ thử (lượt cố ý sai nhân viên), sửa phép kiểm; thêm kiểm phân trang nhật ký |
| 3 | `repeatable (203)` | 16 × 800 | 8 (404) | sạch |
| 4 | `repeatable (204)` | 24 × 1.000 | 12 (888) | sạch |
| 5 | `repeatable (205)` | 24 × 1.000 | 12 (1.006) | sạch |

Đối chứng: chạy bộ thử trên bản V672 trước khi sửa (`V672_FILE=<bản cũ>`) thì cả 5 hạt giống thử đều hỏng (`tag_job_diff`,
`save_mismatch`, `report_changed_on_reject`). Bộ thử cần `initdb -E UTF8` (cụm `SQL_ASCII` đếm `char_length` theo byte nên
emoji làm lệch giới hạn 2.000 ký tự); `v672-smoke.sh` vẫn dựng cụm mặc định.

## Giả lập sự kiện Zalo (27/11/2026)

`PG_MODULE_DIR=… node scripts/event-bot/fuzz/zalo-events-sim.cjs [--only tag|group|birthday] [--verbose]` chạy 72 ca có kết quả mong
đợi, đi qua đúng code production từ chỗ Zalo đổi tới tin bot gửi (Zalo giả, Postgres cục bộ, ~3 giây):

- Tag: `ZaloTagSyncRuntime` thật (Desktop + App Server) đọc `getLabels` giả đúng khuôn zca-js (`{version, labelData:[{id, text,
  conversations}]}` qua `peekLabels`) → V660 thật → trigger V672 → `EventBotRuntime` thật gửi.
- Nhóm điều kiện: dữ liệu đổi theo cách app ghi (quét bạn bè → `is_friend`, quét thành viên nhóm → `zalo_group_members`, tag trong
  Chat → `chat_zalo_account_conversation_tag`, chiến dịch gắn tag → `extra_data.zaloTagIds`, tag akaBiz) → trigger hàng đợi + job Bộ
  lọc động chép nguyên văn production ([dynfilter-prod-20261127.sql](../scripts/event-bot/db/dynfilter-prod-20261127.sql), 16 hàm
  + 3 trigger đọc chỉ đọc 27/11, sinh bằng `scripts/event-bot/fuzz/build-dynfilter-fixture.py` từ JSON để ngoài repo; phần bảng / cột
  thiếu viết tay ở `dynfilter-schema.sql`) → trigger V672 → bot gửi.
- Sinh nhật: `EventBotRuntime` đọc `getAllFriends` giả (trang 500, sdob `dd/mm/yyyy`, `dd/mm`, rỗng, null như mẫu thật) → RPC sinh
  nhật → bot gửi.

Kết quả 27/11: 61 đạt, 0 lỗi, 11 ca là giới hạn đã biết của thiết kế (in `KNOWN`; lần chạy đầu 60 / 12, G08 đã sửa, xem dưới):

| Ca | Điều xảy ra |
|---|---|
| T00, T16, T19 | Lần đọc tag đầu sau khi bật quy tắc, sau khi mất phiên > 30 phút, sau khi tắt / bật lại bot: chỉ lấy mốc, không gửi bù (T19 cố ý: `auto_zalo_tag_sync_resets`) |
| T05 | Chuyển người từ tag có quy tắc "bị gỡ" sang tag có quy tắc "được gắn": người đó nhận 2 tin cùng lúc |
| T08 | Dựa vào Zalo tăng `version` khi đổi người trong tag (đã kiểm bằng dữ liệu Zalo thật, mục dưới) |
| T13 | Xoá tag chỉ có 1 người không phân biệt được với gỡ tag: người đó nhận tin "bị gỡ" (≥ 2 người thì `tag_deleted`) |
| T21 | Zalo trình duyệt không được hỏi tag: quy tắc tag không chạy |
| T22 | Mã hội thoại là số JS sẽ mất chính xác; zca-js trả chuỗi nên không gặp |
| G10 | Gắn / gỡ tag ngay trong Zalo của tài khoản không có akaChat không đổi nhóm điều kiện "Tag Zalo" (Bộ lọc động chỉ đọc tag do chiến dịch gắn, chỉ thêm, hoặc tag của Chat; chưa đọc sổ V660) |
| G14b | Xoá tag akaBiz: người đang trong nhóm chỉ được xét lại khi liên hệ đó đổi |
| G16 | Nhóm không gắn tài khoản: người của tài khoản khác vào nhóm thì chỉ quy tắc của chính tài khoản đó chạy |
| G20 | Người đã ở trong nhóm qua nguồn khác (tải file) vẫn nhận tin vào / rời khi bộ lọc đổi |

Gửi tin lỗi / mất mạng / app chết giữa lúc gửi nằm ở `runtime-fuzz.cjs` (mục trên), không lặp lại ở đây.

Anh chốt 27/11 (đồng ý cả ba đề xuất): G08 sửa (trigger nhóm không tạo việc `leave` khi liên hệ đã `is_delete`; mô hình
`model.cjs` cùng luật; `db-fuzz` + `runtime-fuzz` vòng 6000 sạch, bài kiểm V672 153 PASS); G10 để sau (nối Bộ lọc động với sổ
tag V660 là việc riêng, đụng Nhóm data đang chạy); T05 giữ (2 tin).

## Dữ liệu Zalo thật (27/11/2026)

Runtime Fly ghi mỗi lần đọc `getLabels` thành sự kiện `account_tags_snapshot` (`payload.version`, `tags[].conversationZaloIds`)
trong `chat_zalo_runtime_event` (giữ 7 ngày). Đo chỉ đọc 20 giờ tới 27/11 09:25 VN, 446 tài khoản đang nối, 1.406 lần đọc:

- 602 lần người trong tag đổi giữa hai lần đọc liên tiếp: 601 lần `version` tăng; 1 lần (tài khoản Fly 149, 26/11 14:09 VN)
  Zalo trả danh sách sai cùng `version` và `lastUpdateTime` (tag 131 hội thoại: 80 người thay bằng 80 nhóm), lần đọc sau 33 giây
  trả lại đúng. 0 lần `version` tăng mà không có gì đổi giữa các lần đọc gần nhau (đổi tên tag / màu thì `version` vẫn tăng).
- Giả định T08 đúng. Lượt trả sai đó sẽ bị bỏ qua cả lô vì > 20 người cùng tag (`bulk_tag`); lượt trả sai ≤ 20 người thì bot
  sẽ gửi nhầm (chưa thấy lần nào).

Phát lại qua bot: `PG_MODULE_DIR=… node scripts/event-bot/fuzz/tag-replay.cjs <tệp.json>…` (mẫu che mã hội thoại bằng md5 có
muối, để ngoài repo; câu xuất: mỗi phiên bản ảnh đọc đầu tiên, seq 1 đầy đủ, seq sau là phần đổi). Chuỗi ảnh thật → getLabels
giả → `ZaloTagSyncRuntime` thật → V660 → V672 → `EventBotRuntime` thật, so với kết quả tính độc lập từ hai ảnh liên tiếp. Lần
27/11: 17 tài khoản (có "Khánh akabiz", 30 ngày; còn lại 22 giờ), 472 phiên bản, 0 chỗ lệch; 490 việc gửi, 172 bỏ `not_person`,
211 `bulk_tag`, 6 `tagged_again` lúc gửi (gỡ rồi gắn lại trước giờ gửi vì bộ phát lại không gửi giữa các bước), 484 tin, 0 trùng.

## Giới hạn

- Danh sách không gửi dùng chung so theo UID Zalo của liên hệ trong danh sách; danh sách của tài khoản khác chỉ khớp khi
  UID trùng chuỗi (không đổi qua Global ID như V666).
- `leave` không đợi thành viên bị gỡ khỏi nhóm (người còn nguồn khác vẫn nhận tin "khi ra").
- Fly (`runtimes.fly`) mới có quyền và nhánh `source='fly'`; chưa có nơi chạy.
- Trường Tag Zalo của Bộ lọc động vẫn chưa đọc sổ tag V660 (mục 4.3 của phương án), chưa làm ở V672.
- Chưa chạy trên bản sao production (chỉ đọc cột / md5 thân hàm / chỉ mục / trigger hiện có). Fixture là bản tối thiểu,
  các trigger sẵn có của bảng nguồn thành viên không được dựng lại.
