# V571: engine v2 kiểm người nhận trên toàn hệ thống trước khi gọi Zalo

Anh chốt 18/11/2026 (thiết kế mở rộng duyệt cùng ngày). **Đã apply production 13:42:37 (p1) / 13:42:56 (p2) VN 18/11** theo yêu cầu ("Apply tối nay", rồi "apply luôn bây giờ được không"), `mode: off`, không apply lại; md5 sổ = file; [biên nhận](../migrations/snapshots/engine-target-check-v571/apply-receipt.json). Code mang số cũ V569 đã merge `dev_3` qua [#699](https://github.com/aligoinc/akaAgent/pull/699) ngày 18/11 theo yêu cầu ("Mở PR, merge ngay"); đổi số V571 + biên nhận ở [#700](https://github.com/aligoinc/akaAgent/pull/700). Đổi số hai lần trưa 18/11 (V565 → V569 → V571): phiên khác apply `migration_v565_aka_assistant` (11:48 VN), rồi `migration_v569_aka_assistant_core_guard` (13:07 VN) và `migration_v570_aka_assistant_data_prompt` (13:10 VN); bản V569 đã merge `dev_3` qua #699 (13:31 VN) trước khi biết số bị lấy, PR sau đổi tên file. Kiểm lại sổ ngay trước khi apply. Sinh bằng `scripts/build-v571-sql.cjs` (không sửa tay các
file migration): [p1](../migrations/migration_v571_engine_target_check_p1.sql), [p2](../migrations/migration_v571_engine_target_check_p2.sql),
gỡ [p2](../migrations/rollback_v571_engine_target_check_p2.sql) rồi [p1](../migrations/rollback_v571_engine_target_check_p1.sql).

## Làm gì

Người nhận mà lịch sử của **mọi tổ chức** đã ghi là hỏng với một thao tác thì bước đó không gọi Zalo nữa. Data vẫn chạy theo thứ tự như
thường; tới lượt thì chốt ngay với đúng kết quả của mã đã biết. Tính năng ngầm: khách thấy dòng tiến trình và lịch sử y như khi Zalo trả lỗi,
không câu nào nhắc tới việc kiểm.

Chiến dịch được kiểm (chỉ engine v2, không kiêm SMS):

| Chiến dịch | Người nhận nhận ra bằng |
|---|---|
| Nhắn tin theo SĐT | SĐT (chuẩn hoá); data đã có UID từ lần chạy trước thì thêm global id |
| Thành viên nhóm, group thời gian thực, đề xuất Zalo, khách hàng cũ (theo UID) | global id, lấy ở `zalo_users` theo (tài khoản, UID), vì UID gắn theo từng tài khoản gửi |

Mã đang bật (anh duyệt 18/11), xét 365 ngày:

| Thao tác | Mã | Mã Zalo gốc gộp vào | Bỏ |
|---|---|---|---|
| Tìm SĐT | `err_zalo_user_not_found` (Z216) | 216 không có Zalo, 212 tắt tìm SĐT (cả 214, "không có uid") | bước tìm SĐT, tức cả data |
| Tìm SĐT | `err_zalo_219_find_phone_invalid` (Z219) | 219 | bước tìm SĐT, tức cả data |
| Nhắn tin người lạ | `err_zalo_receiver_blocks_stranger_message` (Z122) | 122 | bước nhắn tin; tài khoản gửi đã là bạn bè thì không bỏ |

Cách đi của từng data:

- Bước tìm SĐT bỏ được cả khi đang khoá / hết lượt tìm SĐT. Bước gửi chỉ bỏ khi đang được phép; đang chờ (hết lượt, khoá) thì vẫn chờ như
  thường, nên tài khoản đạt giới hạn thì không lấy data mới.
- "Nhắn tin theo SĐT": mọi bước gửi của chiến dịch đã biết hỏng (ví dụ chỉ nhắn tin + Z122) và không tag Zalo / đổi tên / tag akaBiz thì bỏ cả
  bước tìm SĐT; report tách thành một dòng cho mỗi bước gửi (nhắn tin trước, kết bạn sau), như khi các bước đó chạy và Zalo trả lỗi.
- Dòng lịch sử thay cho bước bỏ qua: cùng chính sách, trạng thái, câu, data đi đâu như kết quả Zalo thật; khác: không tính lượt
  (`counts_toward_limit = false`), không cộng chuỗi data lỗi, không nghỉ giữa data, không khoá thao tác, không đổi chiến dịch / tài khoản.

Khách thấy (lượt chạy lõi thật trong bài kiểm, dữ liệu thử):

```
▶️ Xử lý "0901000001" ...                      ← đã biết Z216: không gọi Zalo
Tìm SĐT: Không tồn tại (Z216)
✅ Hoàn thành "0901000001"
▶️ Xử lý "0907000216" ...                      ← Zalo trả 216 thật: giống hệt
Tìm SĐT: Không tồn tại (Z216)
✅ Hoàn thành "0907000216"
▶️ Xử lý "Khách Hai" ...                        ← thành viên nhóm, đã biết Z122 qua global id
Nhắn tin người lạ: Người nhận chặn tin nhắn từ người lạ (Z122)
✅ Hoàn thành "Khách Hai"
```

Khác duy nhất nhìn thấy được: data "Nhắn tin theo SĐT" chỉ nhắn tin đã biết Z122 không có dòng "Tìm SĐT: Đã tìm thấy SĐT …: <tên Zalo>" và
data không được điền tên / UID Zalo (bước tìm không chạy).

## Vì sao không kiểm theo lô

Anh hỏi 18/11 vì sao không làm như ý ban đầu: đầu chiến dịch lấy một lô theo số lượng gửi trong ngày, kiểm trên toàn hệ thống, chạy tới data
nào thì chốt luôn, hết lô mà chưa đạt giới hạn thì lấy lô mới. Kết quả với khách giống hệt; khác ở chỗ lưu kết quả kiểm:

- **Tra thẳng lịch sử theo lô quá chậm.** Bảng `auto_campaign_details` (41 GB, 22 GB dữ liệu, 17 index) không có cột SĐT; một người nhận
  có lịch sử rải khắp bảng (một SĐT thường đã được tra ở 17–19 tài khoản), mỗi dòng gần như một lần đọc đĩa. Đo 12/11: lô 500 SĐT 43,9 giây
  lần đầu (~90 ms mỗi số), lô 2.000 quá 90 giây; Desktop gọi DB có trần 3 giây, hàm khác 60 giây. Thêm index phủ thì ước còn 15–25 ms mỗi
  số (lô 100 số ~2 giây) nhưng thêm ~1 GB index vào hai bảng ghi nhiều nhất; ghi khoá SĐT vào bảng lịch sử thì phải ghi lại ~9 triệu dòng của
  bảng 41 GB.
- **Có sổ thì gom lô không rẻ hơn.** Sổ gộp sẵn lịch sử theo người nhận, mỗi lần kiểm một data là một lần đọc khoá chính (dưới 1 ms); gom
  30 data vào một lần tra cũng chỉ là 30 lần đọc đó.
- **Kiểm theo lô phải lưu kết quả lô** tới lúc chạy tới data (có khi vài giờ sau), tức thêm bảng / cột; còn kiểm lúc nhận data thì không.
- **Kết quả lô cũ đi trong lúc chờ**: lô kiểm lúc 8h, 15h mới chạy tới, trong khoảng đó số có thể đã nhắn được ở tổ chức khác. Kiểm lúc nhận
  data luôn dùng sổ mới nhất (trễ ~3–4 phút).
- **Cỡ lô "theo số lượng gửi trong ngày" khó đúng**: mỗi thao tác (tìm SĐT / nhắn tin / kết bạn) có hạn mức riêng, đổi trong ngày (khoá, hết
  lượt), data thêm giữa chừng, chiến dịch tạm dừng rồi chạy lại, nhiều tài khoản dùng chung nhóm data.
- "Lấy lô mới" tự diễn ra: data kế tiếp đã có trong sổ; data hỏng chốt ngay không tốn lượt; đủ giới hạn thì dừng như thường.

## Cách chạy

Không cần phát hành app: lõi engine (Desktop 9.6.0+, worker Fly) đã xử lý quyết định `skip` của claim. Bộ chạy cũ không đổi.

1. `aka_agent_engine_claim_target_v1`: chiến dịch được kiểm, tổ chức bật `engine.target_check` → lấy global id + cờ bạn bè ở `zalo_users`
   (data có UID) → tra `private.aka_agent_engine_target_check_probe(SĐT, global id)` → bước có lần hỏng còn hiệu lực nhận
   `{decision: 'skip', gate: 'target_check', errorCode}` (bỏ cả bước tìm SĐT: `errorCode` là JSON `{thao tác gửi: mã}`). Kiểm lỗi thì như
   chưa biết.
2. Lõi không gọi Zalo cho bước đó, báo `{ok: true, statusCode: 'campaign_detail_skipped', data: {gate, rememberedErrorCode}}`.
3. `aka_agent_engine_report_v1` tách JSON thành một kết quả cho mỗi bước gửi, đổi mỗi kết quả thành kết quả lỗi của mã đã biết (tín hiệu
   `engine/target_check` chỉ lưu ở `auto_engine_outcomes`), bỏ hiệu ứng phụ. Dòng lịch sử không ghi tín hiệu / dữ liệu cổng;
   `policy_snapshot.v2.targetCheck = true` là dấu nội bộ để việc nạp lịch sử bỏ qua dòng này.

## Dữ liệu

- `private.auto_engine_receiver_results`: khoá người nhận `md5('p:'||normalize_phone(SĐT))::uuid` hoặc `md5('g:'||global id)::uuid` × thao
  tác × mã: lần hỏng gần nhất (mã Zalo gốc, lúc, id dòng lịch sử), lần thành công gần nhất của cùng thao tác. Một kết quả có cả SĐT lẫn global
  id thì ghi cả hai khoá (học chéo giữa chiến dịch theo SĐT và theo UID). Chỉ người nhận từng hỏng mới có dòng.
- Thành công của tài khoản đã là bạn bè (`data.target.isFriend`) không xoá lần hỏng (bạn bè luôn nhắn được dù người nhận chặn người lạ).
  Lần hỏng hết hiệu lực khi có thành công sau đó ở bất kỳ khoá nào của người nhận, hoặc quá số ngày xét.
- Nạp nền mọi mã "thuộc về người nhận" của Tìm SĐT / Nhắn tin người lạ / Kết bạn (`auto_error` nhóm `target_permanent`, trừ
  `err_zalo_api_business_failed`, `err_zalo_invalid_param`, `err_zalo_add_friend_failed`), kể cả mã chưa bật: bật mã sau này có hiệu lực ngay.
- Nguồn: `auto_campaign_details` theo id (dòng ghi trên 3 phút): SĐT ở data hoặc `data.target.phone`, global id ở `data.target.globalId`.
- `private.auto_engine_receiver_results_state`: mốc nạp, số đo (`stats`), lần chạy gần nhất (`last_run`). Job pg_cron
  `aka-agent-engine-receiver-results` mỗi phút. Giữ ít nhất 365 ngày (hoặc số ngày xét lớn nhất) + 1, dọn mỗi ngày một lần.
- Hai bảng bật RLS, không vai trò ứng dụng nào có quyền; 7 hàm `private.aka_agent_engine_target_check_*` / `receiver_*` chỉ chủ sở hữu chạy.

Số đo (`stats`, cộng dồn, chỉ đúng ở lần nạp đầu):

- `<thao tác>|all|<mã lỗi|ok|other>`: mọi kết quả đã nạp.
- `<thao tác>|pred|<mã hỏng trước>/<mã Zalo gốc>|<phone|global>|<d007|d030|d090|d365|d999>|<same|bad|ok|other>`: kết quả mà lúc đó người
  nhận đã có lần hỏng còn hiệu lực (khoá, tuổi lần hỏng), tức lẽ ra bị bỏ qua nếu mã đó bật. `same` = hỏng lại đúng mã (bỏ đúng), `ok` = Zalo
  lại thành công (bỏ nhầm), `other` = lỗi khác hoặc bạn bè nhắn được.

## Bật / tắt, thêm / bớt mã, đổi số ngày

`auto_system_settings` `engine.target_check` (claim đọc lại mỗi lần nhận data, đổi là có hiệu lực ngay, không DDL):

```json
{"mode":"off","organizationIds":[],"ingest":true,"ingestBudgetMs":40000,"ingestChunk":5000,
 "backfillDayBudgetMs":3000,"backfillDayHours":[8,18],"backfillThresholdIds":50000}
```

- `mode`: `off` | `orgs` (chỉ `organizationIds`) | `all`. Thiếu dòng / sai định dạng = off. Tắt khẩn cấp: `{"mode":"off", ...}`.
- `ingest: false`: job ngừng nạp (claim vẫn đọc sổ đã nạp nếu mode bật).
- Ngân sách job: `ingestBudgetMs` mỗi phút, `ingestChunk` id mỗi phần. Còn tồn hơn `backfillThresholdIds` id (nạp lần đầu) trong
  `backfillDayHours` giờ VN thì chỉ `backfillDayBudgetMs`.

Mã: cột `auto_outcome_policies.target_check_enabled` / `target_check_days` (chỉ dòng mã × thao tác, không giới hạn loại chiến dịch / nơi chạy):
`NULL` = không kiểm; `false` = chỉ theo dõi (xem số đo); `true` = bỏ qua. Đổi số ngày, bật / tắt mã đang theo dõi: có hiệu lực ngay, không nạp
lại. Mã ngoài danh sách theo dõi (mã mới hoàn toàn, thao tác khác) thì sau khi khai cần nạp lại lịch sử cũ:
`TRUNCATE private.auto_engine_receiver_results; UPDATE private.auto_engine_receiver_results_state SET last_detail_id = 0, stats = '{}', cleaned_at = NULL;`
(như lần đầu, khoảng một đêm).

## Triển khai

1. Kiểm sổ migration production ngay trước khi apply (V571 phải còn trống; số V5xx dùng chung mọi repo).
2. Apply p1 rồi p2 ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema; p1 sửa bảng danh mục engine đọc mỗi lần báo kết quả, giao dịch vài
   mili giây). p2 ~129 KB: nếu MCP `apply_migration` không gửi nổi thì dùng `supabase db query --linked -f` với dòng sổ chèn trong cùng giao
   dịch (`node scripts/make-migration-ledger-apply.cjs`). Lúc apply mode = off: claim / report trả đúng như trước (bộ kịch bản Zalo 708 lượt /
   5.250 lần gửi trùng từng số với khi chưa có V571).
3. Nạp lần đầu: đo 18/11 (chỉ đọc, 2.000 id cũ, giờ cao điểm) ~1 ms mỗi id đọc nguội. ~15,4 triệu id ≈ 4 giờ DB; với ngân sách mặc định
   (40 giây / phút ban đêm, 3 giây / phút 8–18h khi còn tồn) xong trong khoảng một đêm. Muốn nhanh hơn ban đêm thì tăng `ingestBudgetMs`
   (tối đa 90 giây, job bị nền tảng cắt ở 120 giây).
4. Xem số đo, báo anh tỉ lệ bỏ đúng / nhầm theo mã, mã Zalo gốc (212 riêng 216), khoá (SĐT / global id), tuổi lần hỏng.
5. Anh duyệt thì bật `orgs` cho vài tổ chức, theo dõi, rồi `all`.

## Theo dõi

```sql
-- Tiến độ nạp
SELECT last_detail_id, (SELECT max(id) FROM public.auto_campaign_details) AS top, runs, last_run, updated_at
  FROM private.auto_engine_receiver_results_state;
-- Số đo: bỏ đúng / nhầm
SELECT split_part(key, '|', 1) AS action, split_part(key, '|', 3) AS prior, split_part(key, '|', 4) AS key_kind, split_part(key, '|', 5) AS age,
       split_part(key, '|', 6) AS outcome, value::bigint AS n
  FROM private.auto_engine_receiver_results_state, jsonb_each_text(stats) WHERE key LIKE '%|pred|%' ORDER BY 1, 2, 3, 4, 5;
-- Kích thước
SELECT pg_size_pretty(pg_total_relation_size('private.auto_engine_receiver_results')), count(*) FROM private.auto_engine_receiver_results;
-- Job
SELECT status, count(*), max(end_time - start_time) FROM cron.job_run_details
 WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'aka-agent-engine-receiver-results') AND start_time > now() - interval '1 hour' GROUP BY 1;
-- Đã bỏ qua bao nhiêu (dòng lịch sử thay cho bước bỏ qua)
SELECT action_code, error_code, count(*) FROM public.auto_campaign_details
 WHERE id > <mốc> AND policy_snapshot->'v2'->>'targetCheck' = 'true' GROUP BY 1, 2;
```

## Gỡ

`rollback_v571_engine_target_check_p2.sql` (trả claim về bản V564, report về bản V558, bỏ job, thiết lập, hàm, hai bảng) rồi
`rollback_v571_engine_target_check_p1.sql` (bỏ hai cột). Gỡ p1 trước p2 bị chặn. Dòng lịch sử đã ghi giữ nguyên.

## Kiểm thử

- `node scripts/engine-v2-target-check-v571-smoke.cjs` (PG17 cục bộ, module `pg` ở `../akaAgentChatApi` hoặc `CHAT_REPO`; `V571_DUMP=1` in dòng
  tiến trình): 23 nhóm. Gồm apply / gỡ / chạy lại / quyền; mã theo dõi; nạp lịch sử theo SĐT và global id (thành công lại, bạn bè không tính,
  quá hạn, dòng do việc kiểm ghi, SĐT khác định dạng, mã chỉ theo dõi, mốc 3 phút, chia phần không đổi sổ và số đo, giới hạn ban ngày, giữ ≥ 365
  ngày); từng quyết định của claim (theo SĐT, theo UID, bạn bè, không có global id, học chéo, bật mã có hiệu lực ngay, mọi bước gửi đã biết hỏng);
  report so với kết quả Zalo thật cùng mã và tách nhiều dòng; hai lượt lõi thật với cổng Zalo giả (theo SĐT và theo UID).
- Bộ kịch bản Zalo trên DB có V571 (mode off):
  `CHAT_REPO=… SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_CAMPAIGN_REPEAT=1 SCENARIO_TARGET_CHECK=1 node scripts/engine-v2-scenarios/run.cjs --rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01`
  trùng từng số với lần chạy không có V571 (708 lượt, 5.250 lần gửi, 0 vi phạm mới; chỉ khác phần theo giờ chạy).

## Giới hạn đã biết

- Z122 khi tài khoản gửi đã là bạn bè: chiến dịch theo SĐT chưa biết bạn bè trước khi tìm số (tìm SĐT của Zalo không trả cờ bạn bè); chiến
  dịch theo UID dựa `zalo_users.is_fr`, cờ này không cập nhật khi khách đồng ý kết bạn. Có thể bỏ nhầm; sửa tận gốc phải kiểm trong app sau
  bước tìm số / lấy hồ sơ (phát hành Desktop + deploy Fly).
- Z122 cũng có thể do người nhận chặn riêng một tài khoản (Zalo trả cùng câu "Không thể nhận tin nhắn từ bạn"); áp cho tài khoản khác là bỏ
  nhầm. 212 (tắt tìm SĐT): chưa rõ tài khoản đã là bạn có tìm được không. Số đo cho biết mức bỏ nhầm thật trước khi bật.
- Đã bỏ qua thì không còn lần gọi Zalo để biết người nhận đổi cài đặt: lần hỏng chỉ hết hiệu lực khi có thành công ở nơi khác, hoặc quá số ngày.
- Data theo UID chưa có global id trong `zalo_users` (đo 18/11: 10/320 data thành viên nhóm đang chờ) thì không kiểm.
- Chưa áp: nhắn tin vào nhóm, thêm thành viên vào nhóm, gửi dạng chia sẻ, chiến dịch nhắn bạn bè / sinh nhật.
- Thân claim / report từ nay là bản V571: migration sau sửa hai hàm này phải dựng trên thân V571 (md5 ở đầu file p2).
