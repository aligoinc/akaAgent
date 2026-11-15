# V545: bộ đếm "Đã gửi hôm nay" cho trang Chiến dịch của WebApp

**Trạng thái (15/11/2026): đã apply akachat 11:06:16 VN (`20261115040616 / migration_v545_today_sent_counter`, md5 sổ =
md5 tệp `579d6382f3b0dfcc7b5e01a893313b9b`, không apply lại) và bật đếm 11:07:36 VN** (`{"enabled":true,
"countingSince":"2026-11-15T04:07:36Z"}`) theo duyệt của người dùng sau khi xem số đo. Nhánh
`claude_bo-dem-da-gui-hom-nay_from_dev_3_15_11` (tách `dev_3` `06de94f`), chưa tạo PR. Phần API/Web ở WebApp nhánh
`claude/serene-gauss-3nadaj` (chưa gộp, chưa deploy): tới khi deploy, DB đếm nhưng chưa nơi nào đọc. Hậu kiểm ở mục
"Biên nhận apply" cuối tài liệu.

- Migration: `migrations/migration_v545_today_sent_counter.sql`; rollback: `migrations/rollback_v545_today_sent_counter.sql`.
- Kiểm thử (ở WebApp, đọc migration qua `AKA_AGENT_REPO`, như các bộ kiểm SQL khác):
  `AKA_AGENT_REPO=… PGBIN=/usr/lib/postgresql/16/bin sh scripts/test-today-sent-sql.sh` (chạy bằng người dùng không phải
  root; 50 khẳng định, đo chi phí ghi, áp lại bị chặn, rollback gỡ sạch, áp lại sau rollback).
- Hợp đồng phía Web/API: WebApp `packages/control-api/src/campaignList.ts` (`CampaignTodaySent`),
  `apps/api/src/modules/aka-agent-control/aka-agent-control.todaySent.ts`, mục 12.2 của WebApp
  `docs/WEB_UI_REVIEW_20261114.md`.

## Vì sao cần

Trang Chiến dịch của Web muốn hiện "Đã gửi hôm nay N". Đếm thẳng trên `auto_campaign_details` (khoảng 14,5 triệu dòng,
37 GB) không được: đo trên DB thật 15/11/2026 (chỉ đọc), trọn một ngày của nhân viên nhiều tài khoản nhất mất khoảng
5,2 giây, trong khi trang đọc lại mỗi 30 giây cho mỗi tab đang mở. `auto_account_action_status.count_action_in_day` rẻ
nhưng chỉ tính lượt tính hạn mức và bị đặt lại theo ngày, không phải số đã gửi.

## Thiết kế

- **Bảng `private.auto_account_sent_events (id, account_id, day)`** chỉ THÊM dòng: một dòng cho mỗi kết quả gửi thành công.
  Không khoá ngoại, không ràng buộc duy nhất ngoài khoá chính tự tăng, nên trigger không bao giờ chờ khoá dòng hay đụng
  ràng buộc. Chỉ mục `(account_id, day)`. Bật RLS, không chính sách; chỉ `service_role` được SELECT, không ai được ghi
  thẳng. Nằm ở schema `private` nên PostgREST không lộ ra.
- **Hai trigger theo dòng trên `public.auto_campaign_details`** gọi `private.auto_today_sent_capture()`
  (SECURITY DEFINER, `search_path = pg_catalog, pg_temp`, không ai có EXECUTE):
  - `trg_aka_agent_today_sent_insert` AFTER INSERT;
  - `trg_aka_agent_today_sent_update` AFTER UPDATE OF status, chỉ khi trạng thái cũ không thuộc nhóm thành công (null cũng
    tính là chưa thành công). `INSERT … ON CONFLICT DO UPDATE` theo `result_key` đi đường này: ghi lặp cùng kết quả không
    đếm lại.
  - Điều kiện nằm ở `WHEN` (PostgreSQL xét mà không gọi hàm): trạng thái thuộc danh sách của chỉ mục
    `idx_campaign_details_delivery_cooldown` (`thành công`, `đã gửi`, `đã nhận`, `đã xem`, `đã click`), `is_delete` không
    phải true, và hành động là gửi tin: `zalo_message_friend`, `zalo_message_stranger`, `zalo_message_group`, `sms_send`,
    `email_send`, `fb_message_friend`, `fb_message_stranger`, `fb_message_page_inbox_customer`. Theo thống kê của DB thật,
    29% kết quả là "Tìm SĐT" và 16% là "Đổi tên": không phải "đã gửi". Kết bạn, gắn tag, đăng bài, tham gia nhóm cũng không
    tính. Thêm hành động gửi tin mới thì phải sửa danh sách này (migration mới).
  - Hàm không có khối `EXCEPTION` (không mở giao dịch con mỗi dòng; xem bài học subtransaction ở tài liệu đồng bộ trạng
    thái tin nhắn Zalo của WebApp), không `ON CONFLICT`, không khoá dòng chung. Công tắc đọc thẳng trong hàm: giá trị không
    phải JSON object, thiếu dòng hay `is_active` khác true đều coi như tắt, không ném lỗi. Kết quả có `created_at` cũ hơn
    hôm qua (nhập từ hệ thống cũ) không được đếm; INSERT đếm theo ngày của `created_at`, UPDATE đếm theo ngày lúc đổi.
  - Xoá (đánh dấu `is_delete`) kết quả không trừ số: đã gửi vẫn là đã gửi.
- **Công tắc** `auto_system_settings` key `campaigns.today_sent`, migration thêm `{"enabled":false}` (không ghi đè nếu đã
  có dòng). Tắt: trigger đọc công tắc rồi thoát, hàm đọc trả `{"enabled":false}`, Web không hiện ô.
- **Hàm đọc `public.aka_agent_control_today_sent(p_staff_id, p_organization_id, p_platforms)`** (STABLE, SECURITY
  INVOKER, `search_path = pg_catalog, pg_temp`, `statement_timeout = 5s`, chỉ `service_role` EXECUTE) trả
  `{"enabled":true,"day":"YYYY-MM-DD","todaySent":N,"countingSince":<giờ>|null}`. Phạm vi tài khoản giống hệt
  `aka_agent_control_campaign_page` (tài khoản của nhân viên trong tổ chức, cùng điều kiện nền tảng theo token của phiên);
  tài khoản đã xoá vẫn được tính (lượt gửi hôm nay của nó vẫn là của nhân viên). `countingSince` lấy từ công tắc, chỉ trả
  khi rơi vào hôm nay (ô ghi "tính từ HH:MM").
- **Job pg_cron `aka-agent-today-sent-cleanup`** `41 20 * * *` (03:41 VN), một câu `DELETE` xoá dòng cũ hơn hai ngày (không
  TRUNCATE để không lấy khoá ACCESS EXCLUSIVE). Khoảng 70 nghìn dòng mỗi ngày (ước từ 200 nghìn kết quả/ngày, khoảng một
  phần ba là gửi tin), bảng giữ ba ngày.
- Không sửa hàm, trigger hay chỉ mục nào đang có; không đổi pool, kết nối, timeout chung. Hai lệnh `CREATE TRIGGER` là hai
  lệnh cuối của giao dịch và `lock_timeout` là 2 giây: lệnh không xếp hàng chặn các lượt ghi kết quả; quá hạn thì giao dịch
  huỷ, chạy lại lúc vắng hơn. Preflight chặn áp lại (bất kỳ đối tượng nào của V545 đã có thì dừng) và kiểm quyền SELECT của
  `service_role` trên hai bảng hàm đọc dùng, quyền USAGE trên `private`, kiểu các cột dùng tới.

## Số đo trên PostgreSQL 16 cục bộ (15/11/2026)

Bản dựng `auto_campaign_details` có đủ 21 cột và 17 chỉ mục như DB thật (không có bốn trigger theo dòng sẵn có của DB thật,
nên chi phí nền thật cao hơn). 20.000 dòng mỗi lượt, ba lượt, đo xen kẽ trên cùng trạng thái bảng (µs mỗi dòng):

| Trường hợp | INSERT từng lệnh | INSERT một lệnh nhiều dòng | UPDATE đang chạy → thành công |
|---|---:|---:|---:|
| Không có trigger (DISABLE) | 27–34 | 15 | 37–48 |
| Có trigger, công tắc tắt | 53–61 | 20–26 | 66–84 |
| Có trigger, công tắc bật | 59–72 | 25–28 | 80–88 |

- Trigger thêm khoảng 25–35 µs cho mỗi dòng **gửi tin thành công**; phần lớn là chi phí của cơ chế trigger AFTER (xếp hàng,
  đọc lại dòng), ghi dòng đếm chỉ thêm khoảng 8 µs. Dòng không phải gửi tin thành công bị loại ở `WHEN`, gần như không tốn.
- Gọi hàm phụ đọc công tắc (hàm SQL có `SET`, không gộp vào câu được) tốn thêm khoảng 15 µs mỗi dòng; vì vậy công tắc được
  đọc thẳng trong hàm trigger.
- Ở tốc độ ghi của DB thật (khoảng 200 nghìn kết quả mỗi ngày, cao điểm khoảng 5 kết quả mỗi giây) phần thêm vào cỡ 0,2 ms
  CPU mỗi giây.
- Hàm đọc: nhân viên 51 tài khoản (nhiều nhất trên DB thật), 20.000 lượt gửi hôm nay trong bảng 60.000 dòng: khoảng 10 ms
  (51 lượt dò chỉ mục). WebApp gọi kèm lượt đọc trang (mỗi 30 giây mỗi tab), nhớ 20 giây cho mọi tab của cùng nhân viên.

## Bật, tắt, gỡ

Apply: chạy nguyên tệp migration (đã chạy 15/11/2026, xem biên nhận); `lock_timeout` 2 giây báo lỗi thì chạy lại. Rồi bật:

```sql
UPDATE public.auto_system_settings
SET value = jsonb_build_object('enabled', true, 'countingSince', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text,
    updated_at = now()
WHERE key = 'campaigns.today_sent';
```

Ngày bật, số chỉ tính từ lúc bật (Web ghi "từ HH:MM (lúc bắt đầu đếm)"); từ 00:00 hôm sau là trọn ngày. Không chạy bù:
câu đếm bù một ngày trên bảng kết quả nặng như đã đo ở trên.

- Tắt nhanh: `{"enabled":false}` (trigger thoát ngay, Web ẩn ô; vẫn còn khoảng 25 µs mỗi dòng gửi tin thành công vì trigger
  vẫn được gọi).
- Gỡ hẳn: `migrations/rollback_v545_today_sent_counter.sql` (gỡ hai trigger trong giao dịch riêng, `lock_timeout` 2 giây,
  rồi gỡ job, hàm, bảng, dòng công tắc).
- Hậu kiểm sau apply: hai trigger có trên `auto_campaign_details`, ACL như bộ kiểm (anon/authenticated không gọi được hàm
  đọc, không ai gọi thẳng hàm trigger), job có trong `cron.job`, ghi thử một kết quả trong giao dịch ROLLBACK khi công tắc
  bật thấy thêm một dòng đếm.

## Giới hạn

- Kết quả đổi qua lại thành công → thất bại → thành công bị đếm hai lần (hiếm).
- Kết quả ghi trước lúc bật công tắc (hoặc trước khi có trigger) không được đếm; `TRUNCATE`/xoá dòng kết quả không trừ số.
- Danh sách hành động gửi tin cố định trong `WHEN`.

## Biên nhận apply (15/11/2026)

- Đọc trước (chỉ đọc, 11:05 VN): sổ migration mới nhất `20261115020925 / migration_v541_ai_chat_answer_mode`, chưa có dòng
  nào tên v545; chưa có bảng, hàm, trigger, job, dòng công tắc của V545; 7 trigger sẵn có trên `auto_campaign_details`.
- Apply qua công cụ apply migration của Supabase (nguyên văn tệp, cả `BEGIN`/`COMMIT`, như V540) lúc 11:06:16 VN, không
  vướng `lock_timeout`. Sổ: `20261115040616 / migration_v545_today_sent_counter`, md5 `statements` = md5 tệp
  `579d6382f3b0dfcc7b5e01a893313b9b`.
- Hậu kiểm: 9 trigger trên `auto_campaign_details` đều bật (7 cũ + 2 mới); hàm trigger SECURITY DEFINER, `search_path =
  pg_catalog, pg_temp`, ACL `{postgres=X}`; hàm đọc INVOKER, STABLE, `search_path = pg_catalog, pg_temp`,
  `statement_timeout = 5s`, ACL `{postgres, service_role}`, chủ `postgres`; anon, authenticated, `aka_agent_desktop` không
  EXECUTE; bảng ACL `{postgres, service_role=r}`, RLS bật; sequence chỉ `postgres`; job `aka-agent-today-sent-cleanup`
  `41 20 * * *` bật; công tắc `{"enabled":false}`.
- Chạy thử trong một khối tự huỷ (RAISE cuối khối, toàn bộ rollback; dùng một chiến dịch đã hoàn thành, không giữ claim):
  công tắc tắt thì ghi kết quả không sinh dòng đếm; bật trong khối: gửi tin thành công +1, "Tìm SĐT" không tính,
  "đang chạy → thành công" +1, "thành công → đã nhận" không tính lại, hàm đọc (role `service_role`) trả `todaySent` 0 → 2.
  Một lệnh INSERT kết quả thật (với mọi trigger sẵn có) 1,9 ms. Sau khối: công tắc vẫn tắt, 0 dòng đếm, 0 dòng thử còn lại.
- Bật 11:07:36 VN. Đối chiếu với số đếm thẳng trên `auto_campaign_details` (cùng điều kiện, `created_at` từ lúc bật):
  sau 11 giây 20/20, sau 50 giây 77/77.
- Nhật ký Postgres 10:30–11:10 VN: không có lỗi, chờ khoá, deadlock hay huỷ câu lệnh mới (một dòng lúc 11:05 là câu đọc
  của người kiểm viết sai kiểu, không liên quan).
- Hàm đọc cho nhân viên nhiều tài khoản nhất: khoảng 5 ms (702 trang đệm, không đọc đĩa).
