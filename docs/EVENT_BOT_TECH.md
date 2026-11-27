# Bot sự kiện: hợp đồng kỹ thuật đợt 1

Đi cùng [phương án bản 3](EVENT_BOT_PLAN.md). Đây là hợp đồng mà DB (migration V672), Desktop / App Server và
WebApp cùng bám theo. Đổi hợp đồng thì sửa file này trước.

Câu mục 12 của phương án lấy theo đề xuất (anh chưa trả lời riêng): trang dưới "Tự động hóa"; tài khoản đã ở akaChat
dùng bot akaChat; bot không đọc khoá thao tác chiến dịch; giữ ngưỡng gắn tag hàng loạt 20 người; sinh nhật 08:30, không
gửi bù qua ngày; chỉ vào / ra do điều kiện; hạn 30 phút (tag, nhóm), hết ngày (sinh nhật); nhân viên cài cho tài khoản
của chính mình; mở dần bằng công tắc `event_bot`.

Đợt 1 gồm: DB, Desktop (Zalo QR, Zalo trình duyệt cho sinh nhật và nhóm), App Server (Zalo Server trên VPS), trang
Web, khung nhúng Desktop. Fly (ChatApi) để đợt 2: công tắc `runtimes.fly` mặc định `false`, tài khoản Zalo Server đi
Fly hiện "chưa hỗ trợ trên máy chủ mới".

## 1. Công tắc

`auto_system_settings` key `event_bot`, value (text JSON), V672 đặt:

```json
{"audience":"off","organizationIds":[],"runtimes":{"desktop":true,"server":true,"fly":false},"pollSeconds":30}
```

`audience`: `off` | `admin_akabiz` (chỉ nhân viên `org_staff.is_admin_akabiz`) | `orgs` (tổ chức trong
`organizationIds`) | `all`. Hàm `private.aka_agent_event_bot_access(p_organization_id, p_staff_id)` trả boolean.
Thiếu dòng, JSON sai = `off`.

## 2. Bảng (public, RLS bật, REVOKE ALL khỏi PUBLIC/anon/authenticated/service_role; chỉ RPC SECURITY DEFINER)

`auto_event_bot_settings` (mỗi tài khoản một dòng)
- `account_id bigint PK`, `organization_id bigint`, `staff_id bigint`
- `enabled boolean default false`
- `blocklist_ids bigint[] default '{}'` (danh sách không gửi dùng chung của nhân viên, cùng bảng thẻ "Không gửi cho")
- `paused_until timestamptz`, `pause_code text`, `pause_reason text`
- `birthday_scanned_on date` (ngày VN đã đọc sinh nhật)
- `last_claim_at timestamptz`, `last_claim_source text` (dải trạng thái)
- `revision integer default 1`, `updated_by bigint`, `created_at`, `updated_at`

`auto_event_bot_rules`
- `id bigint identity PK`, `account_id`, `organization_id`, `staff_id`
- `event_type text` CHECK in (`birthday`, `tag_change`, `condition_group`)
- `name text`, `enabled boolean`, `position integer`, `revision integer`
- `config jsonb` (khuôn ở mục 3), `data_group_id bigint null` (chỉ `condition_group`), `min_gap_minutes integer`
- `is_delete boolean default false`, `created_at`, `updated_at`
- Trần: 1 quy tắc sinh nhật, 50 quy tắc tag, 30 nhóm điều kiện mỗi tài khoản.

`auto_event_bot_jobs`
- `id bigint identity PK`, `account_id`, `organization_id`, `staff_id`, `rule_id`, `rule_revision`
- `event_type`, `direction text` (`birthday` | `added` | `removed` | `enter` | `leave`)
- `recipient_uid text`, `recipient_name text`, `contact_id bigint null`, `tag_id text null`
- `source_ref text` (mã dòng sổ tag / mốc nguồn thành viên), `dedupe_key text UNIQUE`
- `status text` CHECK in (`pending`, `sending`, `sent`, `skipped`, `expired`, `failed`, `unknown`)
- `reason_code text`, `zalo_error_code text`, `error_message text` (≤ 300 ký tự)
- `message_template text` (mẫu chưa dựng, có biến / spin; không lưu câu khách đã nhận)
- `send_after timestamptz`, `expires_at timestamptz`
- `claim_token uuid`, `claimed_at`, `claimed_by text` (`desktop:<staff>` | `server` | `fly`), `sent_at`, `zalo_msg_id text`
- `created_at`, `updated_at`
- Chỉ mục: `(account_id, send_after) WHERE status = 'pending'`; `(account_id, created_at DESC)`;
  `(expires_at) WHERE status = 'pending'`; `(claimed_at) WHERE status = 'sending'`;
  `(rule_id, recipient_uid, sent_at DESC) WHERE status = 'sent'`.

`auto_event_bot_exclusions`
- `id`, `account_id`, `kind text` (`uid` | `phone`), `value text` (SĐT đã chuẩn hoá), `name text`, `source text`
  (`manual` | `log`), `created_by`, `created_at`; UNIQUE (`account_id`, `kind`, `value`); trần 5.000 mỗi tài khoản.

## 3. Khuôn `config` của quy tắc

Nội dung tin là một chuỗi `message` (biến `#{FULL_NAME}`, `#{SEX{anh|chị}}`… và spin `{a|b}` như chiến dịch; biến
cột file `#{INPUT_…}` bị chặn).

```jsonc
// birthday
{"sendTime":"08:30","message":"Chúc mừng sinh nhật #{FULL_NAME}!"}
// tag_change
{"direction":"added","tagIds":["3"],"tagNames":["Khách mới"],"message":"…","delay":{"minSeconds":20,"maxSeconds":60}}
// condition_group (data_group_id trên cột riêng)
{"onEnter":{"enabled":true,"message":"…"},"onLeave":{"enabled":false,"message":""},"delay":{"minSeconds":20,"maxSeconds":60}}
```

`min_gap_minutes`: tag mặc định 720 (12 giờ), nhóm mặc định 0, sinh nhật bỏ qua (một lần mỗi năm).

## 4. Tạo việc (DB)

Chung: chỉ khi `private.aka_agent_event_bot_access` đúng, `settings.enabled`, quy tắc bật, tài khoản Zalo chưa xoá,
không phải tài khoản cài ở akaChat (mục 6). Không qua được thì **không tạo việc** (không ghi dòng). Qua thì luôn ghi
một dòng việc; dòng bị bỏ ghi `status = 'skipped'` + `reason_code`.

| Sự kiện | Nguồn | Khoá chống trùng | Hạn |
|---|---|---|---|
| Sinh nhật | RPC `birthdays_v1` của nơi chạy | `birthday:<account>:<uid>:<năm VN>` | 23:59:59 hôm đó giờ VN |
| Tag | Trigger AFTER INSERT (câu lệnh, bảng chuyển tiếp) trên `auto_zalo_tag_member_events` | `tag:<rule>:<uid>:<tag>:<dir>:<event id>` | +30 phút |
| Nhóm điều kiện | Trigger AFTER INSERT OR UPDATE OF `is_current` trên `auto_account_contact_group_member_origins` có `dynamic_filter_id` (vào: thành `true`; ra: `true` → `false`) | `group:<rule>:<contact>:<dir>:<epoch ms của updated_at>` | +30 phút |

- `send_after`: tag / nhóm = lúc phát hiện + ngẫu nhiên trong `delay`; sinh nhật = `sendTime` hôm nay giờ VN, đã qua
  thì ngay.
- `reason_code` khi tạo: `excluded` (UID / SĐT trong loại trừ hoặc danh sách dùng chung), `min_gap`, `bulk_tag`
  (> 20 dòng cùng tài khoản + tag + chiều trong một câu lệnh), `tag_deleted` (gỡ hàng loạt mà tag không còn thành viên),
  `not_person` (mã bắt đầu bằng `g`), `no_uid` (liên hệ nhóm điều kiện không có UID Zalo).
- Trigger không bao giờ làm hỏng câu lệnh gốc: `EXCEPTION WHEN OTHERS` → `RAISE WARNING`; tài khoản không có quy tắc
  thì thoát sau một lần tra theo `account_id`.
- Danh sách tài khoản cần hỏi tag: `private.aka_agent_zalo_tag_sync_watched` thêm tài khoản có quy tắc `tag_change`
  bật (UNION; kiểm md5 thân `d21d55c1ea0d6396c6d16e39ca70ff2e` trước khi thay).

## 5. RPC cho nơi chạy

Desktop gọi bản theo phiên (`aka_agent_desktop`, nhân viên lấy từ `private.aka_agent_staff_scope_for_request()`,
chỉ tài khoản Zalo QR / trình duyệt của chính nhân viên). App Server gọi bản `service_role` với `p_source = 'server'`
(chỉ tài khoản `is_zalo_server` không đi Fly). Mọi kết quả là `jsonb` `{ok:true,…}` hoặc `{ok:false,code,message}`.

| Hàm (Desktop / service_role) | Vào | Ra |
|---|---|---|
| `aka_agent_desktop_event_bot_sync_v1()` / `aka_agent_event_bot_sync_v1(p_source text, p_account_ids bigint[])` | | `{ok, enabled, pollSeconds, accounts:[{accountId, staffId, birthday:{enabled, sendTime, scanToday}}]}`; `enabled=false` khi công tắc tắt cho nhân viên / runtime |
| `aka_agent_desktop_event_bot_birthdays_v1(p_account_id bigint, p_people jsonb)` / `aka_agent_event_bot_birthdays_v1(p_source, p_account_id, p_people)` | `p_people`: `[{uid,name}]` người có sinh nhật **hôm nay giờ VN** (≤ 2.000) | `{ok, created, skipped}`; đặt `birthday_scanned_on` = hôm nay |
| `aka_agent_desktop_event_bot_claim_v1(p_runner_id text, p_account_ids bigint[], p_limit int)` / `aka_agent_event_bot_claim_v1(p_source, p_runner_id, p_account_ids, p_limit)` | tài khoản nơi chạy đang giữ (đã đăng nhập) | `{ok, jobs:[{jobId, claimToken, accountId, eventType, direction, recipientUid, recipientName, message}], paused:[{accountId, until, code}]}` |
| `aka_agent_desktop_event_bot_report_v1(p_job_id bigint, p_claim_token uuid, p_result jsonb)` / `aka_agent_event_bot_report_v1(p_source, p_job_id, p_claim_token, p_result)` | `{status:'sent'|'failed'|'unknown', msgId?, zaloCode?, errorMessage?}` | `{ok, status, pausedUntil?}` |

Nhận việc (mỗi tài khoản tối đa 1 việc `sending`; `FOR UPDATE SKIP LOCKED`; ghi `last_claim_at`):
- Kiểm lại ngay trước khi giao: công tắc, bot bật, quy tắc bật, `rule_revision` còn khớp (không → `skipped`
  `rule_changed`), chưa quá hạn (không → `expired`), bot không tự tạm dừng (giữ `pending`), người nhận không bị loại
  trừ (không → `skipped` `excluded`), tag `added` thì người đó vẫn còn trong `auto_zalo_tag_members` (không → `skipped`
  `no_longer_tagged`), tag `removed` thì vẫn không có (không → `skipped` `tagged_again`), nhóm `enter` thì nguồn vẫn
  `is_current` (không → `skipped` `left_group`), `leave` thì vẫn không (không → `skipped` `back_in_group`).
- Giao: `status = 'sending'`, `claim_token`, `claimed_at`, `claimed_by`.

Báo kết quả (sai token → `{ok:false,code:'claim_lost'}`; báo lại cùng kết quả → trả lại kết quả cũ):
- `sent` có `msgId` → `sent`, `sent_at`, `zalo_msg_id`.
- `sent` không `msgId` → `failed`, `reason_code = 'no_msg_id'`, bot tạm dừng 30 phút.
- `failed` + `zaloCode` 120 / 802 → `failed`, tạm dừng 24 giờ (`pause_code` = mã); 221 → tạm dừng 60 phút; mã khác →
  `failed`, không dừng.
- `unknown` (không rõ đã gửi) → `unknown`, không gửi lại.
- Tạm dừng không đụng `auto_account_action_status`, `auto_campaign_details`, `auto_engine_leases`, `auto_campaigns`.

Job pg_cron `aka-agent-event-bot-maintenance` mỗi phút: `pending` quá hạn → `expired` (`reason_code = 'expired'`);
`sending` quá 5 phút → `unknown` (`reason_code = 'runner_lost'`); mỗi ngày xoá việc cũ hơn 90 ngày (theo lô).

## 6. Tài khoản nào bot chạy, nơi chạy nào

| Tài khoản | `runsOn` | Ghi chú |
|---|---|---|
| Zalo QR, Zalo trình duyệt | `desktop` | Sự kiện tag chỉ Zalo QR (sổ tag loại Zalo trình duyệt) |
| Zalo Server, tổ chức không đi Fly | `server` | |
| Zalo Server đi Fly (`aka_agent_zalo_server_flag_route`) | `fly` | Đợt 2 |
| Có binding akaChat và tổ chức có akaChat (`aka_agent_app_access_chat_runtime(org,false)`) | `akachat` | Không bật được, trang trỏ sang akaChat |

## 7. RPC cho trang: `aka_agent_control_event_bot(p_staff_id bigint, p_organization_id bigint, p_action text, p_payload jsonb)`

`service_role`, `SET statement_timeout = '15s'`. Lỗi trả `{ok:false, code, message}` (câu tiếng Việt cho khách).
Mọi `accountId` phải là tài khoản Zalo chưa xoá của chính nhân viên + tổ chức.

| `p_action` | `p_payload` | Ra (`data`) |
|---|---|---|
| `access` | | `{enabled, audience}` |
| `accounts` | | `[{accountId, name, avatarUrl, kind:'qr'|'web'|'server', loginStatus, runsOn, botEnabled, enabledEvents, pausedUntil, pauseCode, lastClaimAt}]` |
| `get` | `{accountId}` | `{account, settings:{enabled, blocklistIds, pausedUntil, pauseCode, pauseReason, revision, updatedAt, lastClaimAt, lastClaimSource}, rules:[…], exclusions:[…], blocklists:[{id,name,count,updatedAt}], tags:[{id,name}], dataGroups:[{id,name,hasDynamicFilter,memberCount}], conflicts:{birthdayCampaigns:[{id,name}], tagAutoAddCampaigns:[{id,name,tagIds}]}, stats:{groupRuleId:{inGroup, entered24h, left24h, sent7d}}}` |
| `save` | `{accountId, revision, enabled, blocklistIds, rules:[{id?, eventType, name, enabled, position, config, dataGroupId?, minGapMinutes}]}` | như `get`; revision lệch → `{ok:false, code:'revision_conflict'}`; quy tắc không có trong danh sách gửi lên thì xoá mềm |
| `stop` | `{accountId}` | tắt bot, đóng mọi việc `pending` thành `skipped` `bot_off` |
| `exclusion_add` | `{accountId, items:[{kind, value, name?, source?}]}` | `{added, exclusions}` |
| `exclusion_remove` | `{accountId, ids:[…]}` | `{removed, exclusions}` |
| `log` | `{accountId, days≤90, status?, eventType?, before?(id), limit≤100}` | `{items:[{id, eventType, direction, ruleName, recipientName, recipientUid, status, reasonCode, zaloErrorCode, sendAfter, sentAt, createdAt}], nextBefore}` |
| `log_detail` | `{accountId, jobId}` | một việc đủ trường + mẫu tin |
| `report` | `{accountId, days≤90}` | `{totals:{matched, sent, skipped, expired, failed, unknown}, byDay:[{date, sent, skipped, expired, failed}], byRule:[{ruleId, name, eventType, matched, sent}], byReason:[{code, count}]}` |

### 7a. Chi tiết theo V672 đã viết (bổ sung, không đổi tên hàm / khoá cũ)

- Thành công luôn là `{ok:true, data}`. Lỗi thêm `index` / `field` khi lỗi thuộc một quy tắc (`rule_invalid`,
  `data_group_not_found`, `data_group_no_filter`), `ruleId` với `rule_not_found`. Mã lỗi trang: `not_enabled`,
  `invalid_request`, `unknown_action`, `account_not_found`, `revision_conflict` (kèm `revision` hiện tại),
  `account_on_akachat`, `runtime_not_supported`, `blocklist_not_found`, `rule_not_found`, `rule_invalid`,
  `data_group_not_found`, `data_group_no_filter`, `duplicate_group`, `exclusion_invalid`, `exclusion_limit`, `job_not_found`.
- `get` của tài khoản chưa có dòng settings trả `revision: 0`; `save` đầu tiên gửi `revision: 0`.
- `exclusion_add` tối đa 5.000 mục mỗi lượt (= trần mỗi tài khoản, khớp API Web). Nội dung tin rỗng theo `trim` của JS
  (cả xuống dòng, tab, khoảng trắng Unicode) bị từ chối như trang. `position` ngoài ±1.000.000 dùng vị trí trong danh sách.
  Quy tắc nhóm thiếu `onEnter` / `onLeave` coi như tắt chiều đó (`enabled: false`). (Sửa sau kiểm thử lặp 27/11/2026.)
- `save` bật bot bị chặn khi `runsOn` là `akachat` (`account_on_akachat`) hoặc nơi chạy có runtime tắt, ví dụ `fly`
  (`runtime_not_supported`). Nhóm điều kiện phải là Nhóm data `zalo_person` của nhân viên (gắn đúng tài khoản hoặc không
  gắn) và có Bộ lọc động; mỗi nhóm một quy tắc mỗi tài khoản. `save` và `stop` trả thêm `data.closedJobs`: việc chờ bị
  đóng (`bot_off` khi tắt bot; `rule_off` khi tắt / xoá quy tắc; `rule_changed` khi đổi `config` / nhóm / khoảng cách,
  lúc đó `revision` của quy tắc tăng; đổi tên / thứ tự / bật không tăng).
- `blocklists[]` có thêm `accountId` (tài khoản của danh sách). DB so danh sách theo UID Zalo của liên hệ trong danh sách,
  nên danh sách của tài khoản khác hầu như không khớp (UID riêng theo tài khoản).
- `stop` / `save` đổi việc tài khoản có được hỏi tag: ghi `auto_zalo_tag_sync_resets` (khi không có chiến dịch tự thêm),
  sổ tag lấy lại mốc ở lần đọc kế tiếp.
- Nơi chạy: `claim` trả thêm `enabled`, `pollSeconds` (`enabled=false` khi công tắc `off`, runtime tắt, hoặc nhân viên
  Desktop không qua công tắc). `birthdays` trả thêm `duplicates`, `date`; lỗi `not_enabled`, `invalid_request`,
  `too_many_people`, `account_not_eligible`, `rule_off`. `report` báo lại trả `{ok, status, pausedUntil, replay:true}`;
  việc đã bị job dọn đóng `unknown`/`runner_lost` vẫn nhận báo kết quả thật đến muộn (cùng token). `claim` tối đa
  `p_limit` 20, `p_account_ids` 500.
- `reason_code` khi báo kết quả: 120/802 → `account_restricted`, 221 → `rate_limited`, mã Zalo khác → `recipient_error`,
  không mã → `send_error`, không `msgId` → `no_msg_id`; `unknown` không có lý do. Nhận việc còn ra `rule_off`.
- Tạo việc chỉ khi runtime của `runsOn` đang bật (tài khoản Fly lúc `runtimes.fly=false` không có việc). Vào / ra nhóm
  chỉ tính khi thay đổi do job Bộ lọc động ghi (giao dịch đang giữ khoá `data-group-dynamic-filter:<staff>`); `leave` theo
  nguồn bộ lọc thôi `is_current`, kể cả khi người đó còn trong nhóm do nguồn khác.
- **Trang Web cần thêm ở `get` (đề xuất của phần WebApp, 26/11; trường tuỳ chọn, thiếu thì trang vẫn chạy):**
  (V672 đã trả) `desktop: {online, lastSeenAt, appVersion, supportsEventBot} | null` cho tài khoản `runsOn = 'desktop'`, đọc phiên
  `auto_staff_device_presence` mới nhất của nhân viên (`online` = heartbeat trong 120 giây và `ended_at IS NULL`,
  `supportsEventBot` = `runtime_state ? 'eventBot'`, null nếu không có `runtime_state`). Dải trạng thái dùng nó để phân
  biệt "app Desktop đang tắt" với "app cần cập nhật"; thiếu thì chỉ dựa vào `lastClaimAt` (dưới 5 phút = đang chạy).
- Nội dung có nhiều mẫu: trang ghép các mẫu bằng dấu `|` ở cấp ngoài cùng (như nội dung chiến dịch, `|` trong mẫu được
  thoát thành `\|`). Nơi chạy dựng tin như nội dung chiến dịch: chọn ngẫu nhiên một mẫu, rồi spin `{a|b}`, rồi biến.
- Cột thêm `auto_event_bot_jobs.runner_id` (`p_runner_id`), chỉ mục thêm: duy nhất `(account_id) WHERE status='sending'`,
  `(created_at)` cho job dọn.

## 8. Desktop / App Server

- `src/shared/eventBot.ts`: hợp đồng (kiểu dữ liệu, mã lý do, nhãn tiếng Việt, kiểm quy tắc) **chép nguyên văn**
  từ WebApp `packages/control-api/src/eventBot.ts`.
- Lõi gửi `packages/campaign-engine/src/eventBot/`: dựng nội dung (module nội dung của lõi), gửi qua cổng
  `{ sendText(accountId, uid, text) → {msgId?}, getProfile?(accountId, uid) }`, xếp loại lỗi Zalo thành `p_result`.
- `src/main/services/eventBotRuntime.ts`: một vòng cho cả tiến trình. Đọc `sync` lúc đăng nhập và 2 phút một lần;
  `enabled=false` hoặc không tài khoản nào thì không gọi gì thêm (`enabled=false`: `sync` đọc lại 30 phút một lần thay vì 2 phút;
  App Server không giữ tài khoản Zalo nào thì không gọi `sync`). Desktop không nhận việc khi bộ giữ sau khi máy ngủ đang giữ. Có tài khoản: mỗi `pollSeconds` gọi `claim` cho tài
  khoản đang đăng nhập mà nơi chạy này giữ, gửi lần lượt từng việc, báo kết quả. Sinh nhật: tài khoản có
  `birthday.scanToday` thì đọc danh sách bạn bè (đoạn lọc ngày sinh của chiến dịch sinh nhật), gọi `birthdays`.
  Hạn chờ đo bằng `monotonicNow`.
- Ảnh chụp bộ chạy Desktop (`desktopRuntimeSnapshot.ts`) thêm khối `eventBot: {state, accounts, lastClaimAt}`.
- Trang: mục menu "Bot sự kiện" mở Web `/automation/event-bot?embed=desktop` qua dịch vụ nhúng tách từ
  `JourneyWebService` (IPC `journey-web:prepare` / `reload` nhận thêm `view` = `automation` | `eventBot`; trạng thái mang `view`).
  Chi tiết phần Desktop: [EVENT_BOT_DESKTOP.md](EVENT_BOT_DESKTOP.md).

## 9. WebApp

- `packages/control-api/src/eventBot.ts`: hợp đồng gốc.
- API: route `event-bot` của control API gọi `aka_agent_control_event_bot`.
- Web: trang `/automation/event-bot` theo bản thiết kế https://claude.ai/artifact/4UQDyJzycDXBqeFpVLhGJ2.
