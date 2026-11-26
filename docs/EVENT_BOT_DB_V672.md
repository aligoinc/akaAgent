# Bot sự kiện: DB V672

Phần DB của [hợp đồng](EVENT_BOT_TECH.md) (mục 7a ghi các chi tiết thêm so với bản hợp đồng đầu). **Chưa apply production.**

- Migration: [migration_v672_event_bot.sql](../migrations/migration_v672_event_bot.sql) (~101 KB, md5 file `f905a5fd02a11109abea5e38deb5a779`), gỡ: [rollback_v672_event_bot.sql](../migrations/rollback_v672_event_bot.sql).
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
- File ~101 KB: gửi qua MCP có thể quá nặng (xem pitfall V525 trong CLAUDE.md: bảng tạm + `EXECUTE`), hoặc dán SQL
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

## Giới hạn

- Danh sách không gửi dùng chung so theo UID Zalo của liên hệ trong danh sách; danh sách của tài khoản khác chỉ khớp khi
  UID trùng chuỗi (không đổi qua Global ID như V666).
- `leave` không đợi thành viên bị gỡ khỏi nhóm (người còn nguồn khác vẫn nhận tin "khi ra").
- Fly (`runtimes.fly`) mới có quyền và nhánh `source='fly'`; chưa có nơi chạy.
- Trường Tag Zalo của Bộ lọc động vẫn chưa đọc sổ tag V660 (mục 4.3 của phương án), chưa làm ở V672.
- Chưa chạy trên bản sao production (chỉ đọc cột / md5 thân hàm / chỉ mục / trigger hiện có). Fixture là bản tối thiểu,
  các trigger sẵn có của bảng nguồn thành viên không được dựng lại.
