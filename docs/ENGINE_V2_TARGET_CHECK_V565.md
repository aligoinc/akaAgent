# V565: engine v2 kiểm SĐT trên toàn hệ thống trước khi gọi Zalo

Anh chốt 18/11/2026. Chưa apply production. Sinh bằng `scripts/build-v565-sql.cjs` (không sửa tay các file migration):
[p1](../migrations/migration_v565_engine_target_check_p1.sql), [p2](../migrations/migration_v565_engine_target_check_p2.sql),
gỡ [p2](../migrations/rollback_v565_engine_target_check_p2.sql) rồi [p1](../migrations/rollback_v565_engine_target_check_p1.sql).

## Làm gì

Chiến dịch "Nhắn tin theo SĐT" (`zalo_message_phone`) chạy bằng engine v2: SĐT mà lịch sử của **mọi tổ chức** đã ghi là hỏng với một thao tác
thì bước đó không gọi Zalo nữa. Data vẫn được xử lý theo thứ tự như thường, khi tới lượt thì chốt ngay với đúng kết quả của mã đã biết.
Đây là tính năng ngầm: khách thấy dòng tiến trình và lịch sử y như khi Zalo trả lỗi, không có câu nào nhắc tới việc kiểm.

| Thao tác | Mã | Mã Zalo gốc gộp vào | Bỏ qua |
|---|---|---|---|
| Tìm SĐT | `err_zalo_user_not_found` (Z216) | 216 không có Zalo, 212 tắt tìm SĐT (cả 214 và "Zalo trả không có uid" nếu có, cùng mã) | bước tìm SĐT, tức cả data |
| Tìm SĐT | `err_zalo_219_find_phone_invalid` (Z219) | 219 | bước tìm SĐT, tức cả data |
| Nhắn tin người lạ | `err_zalo_receiver_blocks_stranger_message` (Z122) | 122 | chỉ bước nhắn tin; chiến dịch chỉ nhắn tin thì cả bước tìm SĐT |

- Xét 365 ngày. Lần hỏng mất hiệu lực khi sau đó cùng SĐT có lần thành công của cùng thao tác (ở bất kỳ tổ chức nào).
- "Chỉ nhắn tin" = bật nhắn tin, không bật kết bạn, tag Zalo, đổi tên, tag akaBiz (giá trị JSON `true`, đúng như lõi đọc).
- Chiến dịch kiêm SMS (nội bộ hoặc akaBiz Sms) không kiểm: SMS đẩy theo kết quả thật của từng bước.
- Bước tìm SĐT bị bỏ qua kể cả khi đang khoá / hết lượt tìm SĐT (không gọi Zalo). Bước gửi chỉ bị bỏ qua khi đang được phép; đang chờ (hết lượt,
  khoá) thì vẫn chờ như thường, nên khi tài khoản đạt giới hạn thì không lấy data mới (đúng ý "đạt giới hạn thì dừng").
- Dòng lịch sử thay cho bước bỏ qua: cùng chính sách, trạng thái, câu, data đi đâu như kết quả Zalo thật; khác: không tính lượt
  (`counts_toward_limit = false`), không cộng chuỗi data lỗi, không nghỉ giữa data, không khoá thao tác, không đổi chiến dịch / tài khoản.

Khách thấy (lượt chạy lõi thật trong bài kiểm, SĐT thử):

```
▶️ Xử lý "0901000001" ...        ← SĐT đã biết Z216: không gọi Zalo
Tìm SĐT: Không tồn tại (Z216)
✅ Hoàn thành "0901000001"
▶️ Xử lý "0907000216" ...        ← Zalo trả 216 thật: giống hệt
Tìm SĐT: Không tồn tại (Z216)
✅ Hoàn thành "0907000216"
▶️ Xử lý "0901000005" ...        ← đã biết Z122, chiến dịch chỉ nhắn tin
Nhắn tin người lạ: Người nhận chặn tin nhắn từ người lạ (Z122)
✅ Hoàn thành "0901000005"
```

Khác duy nhất nhìn thấy được: data "chỉ nhắn tin" đã biết Z122 không có dòng "Tìm SĐT: Đã tìm thấy SĐT …: <tên Zalo>" (bước tìm không chạy).

## Cách chạy

Không cần phát hành app: lõi engine (Desktop 9.6.0+, worker Fly) đã xử lý quyết định `skip` của claim (báo bước bị bỏ qua, bước phụ thuộc
cũng bỏ). Bộ chạy cũ không đổi.

1. `aka_agent_engine_claim_target_v1`: data `zalo_message_phone` có SĐT, tổ chức bật `engine.target_check` → tra
   `private.aka_agent_engine_target_check_probe(phone)` → thao tác nào có lần hỏng còn hiệu lực thì quyết định
   `{decision: 'skip', gate: 'target_check', errorCode}`. Kiểm lỗi thì coi như chưa biết.
2. Lõi không gọi Zalo cho bước đó, báo `{ok: true, statusCode: 'campaign_detail_skipped', data: {gate, rememberedErrorCode}}`.
3. `aka_agent_engine_report_v1` đổi kết quả đó thành kết quả lỗi của mã đã biết (tín hiệu `engine/target_check` chỉ lưu ở
   `auto_engine_outcomes`), bỏ hiệu ứng phụ như trên. Dòng lịch sử không ghi tín hiệu / dữ liệu cổng; `policy_snapshot.v2.targetCheck = true`
   là dấu nội bộ để việc nạp lịch sử bỏ qua dòng này (không tự nuôi).

## Dữ liệu

- `private.auto_engine_phone_results`: mỗi SĐT (`md5(normalize_phone(phone))::uuid`, như `idx_campaign_input_cooldown_phone`) × thao tác một
  dòng: lần hỏng gần nhất (mã, mã Zalo gốc, lúc, id dòng lịch sử), lần thành công gần nhất. Chỉ SĐT từng hỏng mới có dòng.
- `private.auto_engine_phone_results_state` (một dòng): mốc nạp (`last_detail_id`), số đo (`stats`), lần chạy gần nhất (`last_run`).
- `private.aka_agent_engine_phone_results_ingest(budget_ms, chunk)`: nạp `auto_campaign_details` theo id (chỉ dòng ghi trên 3 phút), job pg_cron
  `aka-agent-engine-phone-results` mỗi phút. Dọn lần hỏng quá số ngày xét lớn nhất + 1 ngày, mỗi ngày một lần.
- Hai bảng bật RLS, không vai trò ứng dụng nào có quyền; 6 hàm `private.aka_agent_engine_target_check_*` / `phone_*` chỉ chủ sở hữu chạy.

Số đo (`stats`, cộng dồn, chỉ đúng ở lần nạp đầu):

- `<thao tác>|all|<bad|ok|other>`: mọi kết quả đã nạp.
- `<thao tác>|pred|<mã hỏng trước>/<mã Zalo gốc>|<d007|d030|d090|d365|d999>|<bad|ok|other>`: kết quả mà lúc đó SĐT đã có lần hỏng còn hiệu lực
  (theo tuổi lần hỏng), tức kết quả lẽ ra bị bỏ qua nếu đã bật. `…|ok` là bỏ qua nhầm (Zalo lại thành công), `…|bad` là bỏ qua đúng.

## Bật / tắt

`auto_system_settings` `engine.target_check` (claim đọc lại mỗi lần nhận data, đổi là có hiệu lực ngay, không DDL):

```json
{"mode":"off","organizationIds":[],"ingest":true,"ingestBudgetMs":20000,"ingestChunk":5000,
 "backfillDayBudgetMs":3000,"backfillDayHours":[8,18],"backfillThresholdIds":50000}
```

- `mode`: `off` | `orgs` (chỉ `organizationIds`) | `all`. Thiếu dòng / sai định dạng = off. Tắt khẩn cấp: `{"mode":"off", ...}`.
- `ingest: false`: job ngừng nạp (claim vẫn đọc bảng đã nạp nếu mode bật).
- Ngân sách job: `ingestBudgetMs` mỗi phút, `ingestChunk` id mỗi phần. Còn tồn hơn `backfillThresholdIds` id (nạp lần đầu) trong
  `backfillDayHours` giờ VN thì chỉ `backfillDayBudgetMs`.

Mã nào kiểm: cột `auto_outcome_policies.target_check_enabled` / `target_check_days` (chỉ dòng mã × thao tác, không giới hạn loại chiến dịch /
nơi chạy). `NULL` = không kiểm, không nạp; `false` = chỉ nạp (theo dõi số đo), không bỏ qua; `true` = bỏ qua. Thêm mã mới (đặt `false` rồi
`true`) thì phải nạp lại lịch sử cũ: `TRUNCATE private.auto_engine_phone_results; UPDATE private.auto_engine_phone_results_state SET
last_detail_id = 0, stats = '{}', cleaned_at = NULL;` (nạp lại cả bảng, như lần đầu). Claim chỉ kiểm thao tác `zalo_find_phone_user` (bỏ cả data)
và thao tác gửi có trong kế hoạch của chiến dịch "Nhắn tin theo SĐT".

## Triển khai

1. Kiểm sổ migration production ngay trước khi apply (V565 phải còn trống; số V5xx dùng chung mọi repo).
2. Apply p1 rồi p2 ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema; p1 sửa bảng danh mục engine đọc mỗi lần báo kết quả, giao dịch vài
   mili giây). Lúc apply mode = off: claim / report trả đúng như trước (bộ kịch bản Zalo 708 lượt / 5.250 lần gửi giống hệt khi chưa có V565).
3. Nạp lần đầu: đo 18/11 (chỉ đọc, 2.000 id cũ, giờ cao điểm) ~1 ms mỗi id đọc nguội (1 trang đĩa mỗi dòng lịch sử). ~15,4 triệu id ≈ 4 giờ DB;
   với ngân sách mặc định (20 giây / phút ban đêm, 3 giây / phút 8–18h khi còn tồn) xong trong khoảng một đêm. Muốn nhanh hơn ban đêm thì tăng
   `ingestBudgetMs` (tối đa 90 giây, job bị nền tảng cắt ở 120 giây).
4. Xem số đo (dưới), báo anh tỉ lệ bỏ qua đúng / nhầm theo mã, tuổi lần hỏng, mã Zalo gốc (212 riêng 216).
5. Anh duyệt thì bật `orgs` cho vài tổ chức, theo dõi, rồi `all`.

## Theo dõi

```sql
-- Tiến độ nạp
SELECT last_detail_id, (SELECT max(id) FROM public.auto_campaign_details) AS top, runs, last_run, updated_at
  FROM private.auto_engine_phone_results_state;
-- Số đo: tỉ lệ bỏ qua đúng / nhầm
SELECT split_part(key, '|', 1) AS action, split_part(key, '|', 3) AS prior, split_part(key, '|', 4) AS age, split_part(key, '|', 5) AS outcome,
       value::bigint AS n
  FROM private.auto_engine_phone_results_state, jsonb_each_text(stats) WHERE key LIKE '%|pred|%' ORDER BY 1, 2, 3, 4;
-- Kích thước
SELECT pg_size_pretty(pg_total_relation_size('private.auto_engine_phone_results')), count(*) FROM private.auto_engine_phone_results;
-- Job
SELECT status, count(*), max(end_time - start_time) FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'aka-agent-engine-phone-results') AND start_time > now() - interval '1 hour' GROUP BY 1;
-- Đã bỏ qua bao nhiêu (dòng lịch sử thay cho bước bỏ qua)
SELECT action_code, error_code, count(*) FROM public.auto_campaign_details
 WHERE id > <mốc> AND policy_snapshot->'v2'->>'targetCheck' = 'true' GROUP BY 1, 2;
```

## Gỡ

`rollback_v565_engine_target_check_p2.sql` (trả claim về bản V564, report về bản V558, bỏ job, thiết lập, hàm, hai bảng) rồi
`rollback_v565_engine_target_check_p1.sql` (bỏ hai cột). Gỡ p1 trước p2 bị chặn. Dòng lịch sử đã ghi giữ nguyên.

## Kiểm thử

- `node scripts/engine-v2-target-check-v565-smoke.cjs` (PG17 cục bộ, module `pg` ở `../akaAgentChatApi` hoặc `CHAT_REPO`; `V565_DUMP=1` in dòng
  tiến trình): 17 nhóm, gồm apply / gỡ / chạy lại / quyền, nạp lịch sử (thành công lại, quá hạn, dòng do việc kiểm ghi, SĐT khác định dạng, mốc
  3 phút, chia phần không đổi kết quả và số đo, giới hạn ban ngày), từng quyết định của claim, report so với kết quả Zalo thật cùng mã, và một lượt
  lõi thật với cổng Zalo giả (SĐT đã biết không gọi Zalo, dòng tiến trình giống hệt, không nghỉ sau data bỏ qua).
- Bộ kịch bản Zalo trên DB có V565 (mode off):
  `CHAT_REPO=… SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_CAMPAIGN_REPEAT=1 SCENARIO_TARGET_CHECK=1 node scripts/engine-v2-scenarios/run.cjs --rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01`
  18/11: 708 lượt, 5.250 lần gửi, 0 vi phạm mới, trùng từng số với lần chạy không có V565 (chỉ khác phần theo giờ chạy).

## Giới hạn đã biết

- Z122 là "chặn tin người lạ": tài khoản đã là bạn bè với người nhận thì nhắn được, nhưng claim chưa biết bạn bè lúc nhận data nên vẫn bỏ
  qua bước nhắn tin. Số đo `zalo_message_stranger|pred|…|ok` cho biết mức này trước khi bật.
- Đã bỏ qua thì không còn lần gọi Zalo để phát hiện SĐT đổi trạng thái: lần hỏng chỉ hết hiệu lực khi có thành công ở nơi chưa bật (bộ cũ,
  tổ chức chưa bật) hoặc quá số ngày xét.
- Chỉ engine v2 và chỉ "Nhắn tin theo SĐT"; loại theo UID (thành viên nhóm, bạn bè…) chưa kiểm.
- Thân claim / report từ nay là bản V565: migration sau sửa hai hàm này phải dựng trên thân V565 (md5 ở đầu file p2).
