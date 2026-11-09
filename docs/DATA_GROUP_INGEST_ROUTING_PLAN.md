# Phương án sửa gốc hàm nạp nhóm data (09/11/2026)

**Trạng thái:** phương án, chưa làm. Đi sau bản chia lô phía app (aligoinc/akaAgent#612,
aligoinc/akaAgentWebApp#175) và V483.
Bối cảnh sự cố: akaAgentWebApp `docs/DATA_GROUP_INGEST_CHUNKING.md`.

## Tóm tắt

- **Gốc lỗi:** khi thêm data vào nhóm, DB đẩy từng dòng vào từng chiến dịch đang bật "nhận data mới từ nhóm"
  ngay trong giao dịch của người dùng, trần 60 giây. Chi phí ≈ số dòng × (8 ms + số chiến dịch × 5 ms).
- **Bản chia lô đã merge chỉ chia nhỏ mỗi lần gửi**, tổng việc không đổi. Nhóm 600 chiến dịch thì 1.000 dòng
  vẫn mất khoảng 50 phút, và nhập file thì không chia được.
- **Đề xuất ba phần:**
  1. Tách việc đẩy vào chiến dịch ra hàng đợi chạy nền. Chỉ sửa DB, app cũ hưởng ngay.
  2. Nhập file lớn theo nhiều phần rồi chốt một lần. Cần sửa Desktop, Web và iOS.
  3. Làm rẻ việc đẩy: kiểm tra một lần cho mỗi chiến dịch thay vì mỗi dòng, ghi theo tập.
- **Cái giá:** data vào chiến dịch trễ vài giây đến vài chục giây thay vì ngay lập tức.

## 1. Hiện trạng

Đọc từ migration trong repo. Trước khi làm phải đối chiếu định nghĩa live bằng `pg_get_functiondef` và md5.

### Chuỗi gọi

- Mọi lối vào cùng đi qua `aka_agent_ingest_data_group_v186_internal`: wrapper Desktop 14/15 tham số, hàm lõi
  12/13 tham số (Web, API công khai, iOS), Google Sheet worker (`external_sync`) và bước "thêm vào nhóm" của quy
  trình tự động. Bản mới nhất trong repo:
  [v297 L461–L1234](../migrations/migration_v297_data_group_google_sheet_sync.sql#L461-L1234), có
  `SET statement_timeout '60s'`. Hàm lõi còn chặn quá 10.000 dòng/lần
  ([v198 L48](../migrations/migration_v198_data_group_ingest_row_limit_guard.sql#L48)).
- Trong hàm nạp:
  - Khoá dòng nhóm `FOR UPDATE` suốt giao dịch
    ([L542](../migrations/migration_v297_data_group_google_sheet_sync.sql#L542)), nên các lượt nạp cùng nhóm xếp hàng.
  - Vòng từng dòng ([L710](../migrations/migration_v297_data_group_google_sheet_sync.sql#L710)): tìm hoặc tạo
    contact, ghi thành viên, origin, dataset member.
  - Với **mỗi dòng**, kể cả dòng đã là thành viên, gọi hàm đẩy cho **mọi** nguồn `baselining`/`active` của nhóm
    ([L1115–L1138](../migrations/migration_v297_data_group_google_sheet_sync.sql#L1115-L1138)).
- Hàm đẩy `aka_agent_internal_route_data_group_member` gồm ba lớp:
  [v409 L2669](../migrations/migration_v409_group_sharing.sql#L2669) → `_v205_internal` (v193) →
  `_v186_internal` ([v409 L2261](../migrations/migration_v409_group_sharing.sql#L2261)).
  Mỗi cặp (dòng, chiến dịch) tốn khoảng 20 câu lệnh:
  - đọc lại nguồn, chiến dịch, thành viên, contact, tài khoản;
  - kiểm tra chia sẻ và tương thích kiểu data;
  - khoá advisory theo chiến dịch ([L2737](../migrations/migration_v409_group_sharing.sql#L2737)) và `FOR UPDATE`
    dòng chiến dịch hai lần ([L2750](../migrations/migration_v409_group_sharing.sql#L2750),
    [L2315](../migrations/migration_v409_group_sharing.sql#L2315));
  - tính khoá đích, tra alias, INSERT input, upsert alias, INSERT origin;
  - UPDATE `last_ingest_at` của nguồn ([L2652](../migrations/migration_v409_group_sharing.sql#L2652)) và ghi chú
    chiến dịch ([L2656](../migrations/migration_v409_group_sharing.sql#L2656)) ở **mỗi** cặp.
- Gắn chiến dịch vào nhóm (bind, [v409 L704](../migrations/migration_v409_group_sharing.sql#L704),
  [L850](../migrations/migration_v409_group_sharing.sql#L850)) và bật lại công tắc (reactivate,
  [L1022](../migrations/migration_v409_group_sharing.sql#L1022)) cũng đẩy cả nhóm bằng
  `aka_agent_internal_route_group_snapshot` (v186): từng thành viên một, trong một giao dịch.

### Số đo đã có

- Khoảng 7–11 ms/dòng khi nhóm cấp data cho 0–1 chiến dịch (08/11, file 3.757–4.911 dòng).
- Khoảng 4,3–5 ms cho mỗi cặp (dòng × chiến dịch) (02/11, nhóm khoảng 575 chiến dịch).
- Nhóm 1770 của staff 724 (630 chiến dịch): khoảng 3,2 giây/dòng, tức 45 dòng mất khoảng 140 giây.

### Hệ quả

1. **Quá 60 giây là rollback toàn bộ:** việc đã làm bỏ phí, khách thử lại vẫn hỏng.
2. **Chiến dịch đang chạy của nhóm bị đứng theo, tới 60 giây.** Khoá advisory và `FOR UPDATE` giữ tới hết giao
   dịch, mà các thao tác sau cũng cần đúng khoá advisory đó:
   - claim lượt chạy (`aka_agent_claim_campaign_run_unit_v2`,
     [v387 L363](../migrations/migration_v387_facebook_random_run.sql#L363));
   - ghi kết quả (`aka_agent_settle_action_results_v1`,
     [v366 L33](../migrations/migration_v366_action_status_runtime_fixes.sql#L33));
   - đổi trạng thái (`aka_agent_set_desktop_campaign_status_v2`,
     [v234 L97](../migrations/migration_v234_queue_desktop_campaign_while_account_running.sql#L97)).

   INSERT vào bảng con của `auto_campaigns` (ví dụ `auto_campaign_details`) cũng phải chờ, vì `FOR UPDATE` chặn
   khoá `FOR KEY SHARE` mà bước kiểm FK cần.
3. **Chia lô phía app không giảm tổng thời gian:** mỗi lần gửi không quá 60 giây, nhưng tổng thời gian giữ nguyên.
4. **Nhập file lớn vẫn hỏng.** `upload` và `external_sync` là ảnh chụp cả file nên không chia được.
5. **Tạo chiến dịch từ nhóm lớn hoặc bật lại công tắc** tốn khoảng 4–5 ms × số thành viên, nên nhóm từ khoảng
   12.000–14.000 thành viên có thể chạm trần. Chưa kiểm production có ca nào.

## 2. Mục tiêu và ràng buộc

- Thời gian chờ khi thêm data không phụ thuộc số chiến dịch nhận data.
- Không còn giao dịch dài giữ khoá chiến dịch. Mục tiêu: mỗi giao dịch giữ khoá không quá khoảng 2 giây.
- Nhập file lớn không vướng trần 60 giây và 10.000 dòng/lần.
- Giữ nguyên:
  - luật đã chốt 09/11: công tắc là quy tắc duy nhất;
  - chống trùng (`canonical_target_key`, alias, conflict);
  - luật tương thích kiểu data;
  - nguồn gốc (`auto_campaign_input_origins`).
- App cũ (Desktop, Web, iOS) vẫn chạy; Phần 1 không bắt khách cập nhật.
- Không thêm nguồn kết nối DB mới.
- Job nền tự dừng dưới khoảng 100 giây, vì nền tảng cắt mọi câu lệnh ở 120 giây.
- DDL chỉ apply ngoài giờ cao điểm, vì PostgREST nạp lại schema sau mỗi lần đổi.

## 3. Các hướng đã cân nhắc

| Hướng | Được | Không được |
|---|---|---|
| A. Chỉ tối ưu hàm đẩy, vẫn chạy trong lượt nạp | Ít đổi hành vi | Vẫn nhân theo số chiến dịch; vẫn giữ khoá suốt giao dịch |
| B. Tách việc đẩy ra hàng đợi chạy nền | Chỉ còn chờ phần ghi thành viên; khoá ngắn; app cũ hưởng ngay | Data vào chiến dịch trễ; thêm một worker |
| C. Đổi luật (chiến dịch tạm dừng không nhận, giới hạn số chiến dịch mỗi nhóm) | Đơn giản | Trái quyết định đã chốt 09/11 |

**Đề xuất:** làm B trước (Phần 1), rồi A (Phần 3) để giảm tổng tải. Nhập file nhiều phần (Phần 2) độc lập với hai
phần kia.

## 4. Phần 1 — Hàng đợi đẩy vào chiến dịch (chỉ sửa DB)

### Thiết kế

- **Bảng mới `private.auto_data_group_route_jobs`** lưu:
  - job, nhóm, batch, revision nhóm, staff và tổ chức;
  - `membership_ids bigint[]` (theo thứ tự, không trùng);
  - trạng thái `pending`/`running`/`done`/`failed`;
  - con trỏ: nguồn đang làm và vị trí thành viên;
  - số đếm (inserted, existing, incompatible, conflict) kèm mẫu conflict;
  - số lần thử, lỗi cuối, các mốc thời gian.
- **Hàm nạp:**
  - Thay vòng `FOR v_source` bằng việc gom id thành viên. Cuối lượt, nếu nhóm có nguồn đang bật thì INSERT một job.
  - Kết quả trả về giữ đủ trường cũ, trong đó số input = 0, và thêm `routing_status: 'queued'`, `routing_job_id`,
    `receiving_campaign_count`.
- **Worker:**
  - Chạy bằng job pg_cron có sẵn `aka-agent-data-group-dynamic-filter-worker` (30 giây/lần,
    [v253 L524](../migrations/migration_v253_database_dynamic_filter_worker.sql#L524)), hoặc một job riêng 10 giây/lần.
  - Một runner tại một thời điểm, ngân sách không quá 40 giây mỗi lượt.
  - Chia việc thành đoạn không quá khoảng 2 giây, mỗi đoạn COMMIT riêng (thủ tục `CALL`), để khoá chiến dịch chỉ
    giữ trong đoạn đó.
  - Mỗi đoạn xử lý một job, một nguồn, tối đa khoảng 200 thành viên, và gọi **đúng hàm đẩy hiện tại**, nên kết quả
    giống hệt cách cũ.
  - Thứ tự: chiến dịch "đang chạy"/"chờ xử lý" trước, "tạm dừng" sau. Xoay vòng giữa các job để job lớn không chặn
    job nhỏ.
  - Xong job thì cộng số đếm vào `auto_data_ingest_batches.result`, để màn hình "Input mới (lần ingest gần nhất)"
    trên Desktop và Web vẫn có số.
  - Đoạn bị lỗi: ghi lỗi rồi thử lại ở lượt sau. Hàm đẩy idempotent nhờ `ON CONFLICT`. Lỗi quá N lần thì đánh
    `failed` kèm ghi chú.
- **Công tắc rollout:**
  - `auto_system_settings` `data_groups.routing_mode` =
    `{"mode":"sync"|"async","organizationIds":[...]|null}`. Hàm nạp đọc lại ở mỗi lượt.
  - Mặc định `sync`, chạy y như hiện tại.
  - Rollback: đổi về `sync`, không cần DDL. Worker vẫn xử lý nốt các job còn lại.
- **V483:** sửa công thức chặn sớm ngay trong cùng migration. Ở chế độ `async` không còn nhân theo số chiến dịch:
  chỉ chặn khi số dòng × 8 ms > 75 giây. Nếu để nguyên, V483 sẽ chặn nhầm những lượt giờ đã chạy nhanh.

### Hành vi thay đổi, cần anh/chị chấp nhận

- Data vào chiến dịch sau vài giây đến vài chục giây. Trước khi có Phần 3, nhóm cấp data cho hàng trăm chiến dịch
  có thể mất vài phút mới vào hết các chiến dịch tạm dừng.
- Số "Input mới" của lượt nạp chỉ có sau khi worker xong.
- Nếu có thay đổi xảy ra **trước** khi worker chạy, kết quả giống như thay đổi đó xảy ra trước khi thêm data:
  - công tắc bị tắt: chiến dịch không nhận data (hàm đẩy trả `source_stopped`);
  - thành viên bị gỡ khỏi nhóm: không đẩy (`membership_inactive`);
  - chiến dịch bị xoá hoặc hết hạn: kết thúc như cũ.

### Kết quả mong đợi

- Thêm 45 dòng vào nhóm 630 chiến dịch: lượt gọi khoảng 0,4 giây thay vì quá 60 giây, kể cả trên Desktop bản cũ.
- Không còn khoá chiến dịch bị giữ tới 60 giây.
- Tổng tải DB của Phần 1 không giảm (Phần 3 mới giảm), nhưng hết các lượt timeout làm xong rồi bỏ phí.

### Phần 1b — Gắn chiến dịch và bật lại công tắc

Dùng cùng cơ chế: tạo một job đẩy cả nhóm cho một nguồn, nguồn giữ trạng thái `baselining` tới khi xong. Làm sau
Phần 1, vì phải kiểm trước rằng luồng tạo chiến dịch và bundle (`provisioning_state`, `final_baseline_proven`)
không coi chiến dịch "chưa có data" là đã xong hay bị lỗi.

## 5. Phần 2 — Nhập file nhiều phần

- **RPC mới theo phiên, ba bước:**
  1. `begin`: tạo phiên và batch, gắn với dataset.
  2. `append`, gọi nhiều lần: mỗi lần không quá khoảng 2.000 dòng. Chỉ cộng thêm và đánh dấu dòng đã thấy trong
     phiên; không reset gì trước.
  3. `finish`, một giao dịch ngắn:
     - dòng của dataset không thuộc phiên chuyển thành `is_current=false`;
     - gỡ thành viên không còn origin current;
     - đếm lại `contact_count`;
     - tạo job đẩy vào chiến dịch.
- **Giữ đúng ngữ nghĩa ảnh chụp hiện tại.** Hiện hàm reset dữ liệu cũ ở đầu lượt
  ([v297 L661–L666](../migrations/migration_v297_data_group_google_sheet_sync.sql#L661-L666)) và gỡ thành viên ở cuối
  lượt ([L1141–L1185](../migrations/migration_v297_data_group_google_sheet_sync.sql#L1141-L1185)). Phương án mới dồn cả
  hai việc vào `finish`, nên trong lúc đang gửi các phần, thành viên cũ không biến mất.
- **Phiên hết hạn** (ví dụ sau 2 giờ) thì huỷ phiên, không gỡ gì.
- **Cần sửa:** nhập file trên Desktop, Web (`DataGroupsPage`) và iOS; Google Sheet worker (`external_sync`).
  App cũ vẫn gửi một lần như hiện tại.
- Bỏ được trần 10.000 dòng/lần cho nhập file.

## 6. Phần 3 — Làm rẻ việc đẩy

- **Kiểm tra một lần cho mỗi cặp (nguồn, đoạn)** thay vì mỗi dòng: chia sẻ, chiến dịch còn hạn và chưa xoá, tài
  khoản, action, bundle/provisioning, khoá chiến dịch.
- **Tách phần tính khoá đích theo action thành một hàm thuần dùng chung.** Hàm đẩy cũ cũng gọi hàm này, để hai cách
  không lệch luật.
- **Ghi theo tập:** mỗi đoạn một INSERT `auto_campaign_input_data` (`ON CONFLICT`), một upsert alias, một INSERT
  origin. `last_ingest_at` và ghi chú chiến dịch cập nhật một lần mỗi đoạn.
- **Bỏ qua sớm cả nguồn** khi action của chiến dịch không hợp kiểu data của nhóm.
- **Kiểm chứng trước khi bật:** chạy song song hàm cũ và hàm mới trên cùng dữ liệu (trong giao dịch rồi rollback)
  với mẫu lớn, so từng dòng input, alias và origin. Chỉ bật khi khớp 100%.
- **Mục tiêu:** từ khoảng 5 ms xuống dưới khoảng 0,5 ms mỗi cặp. Phải đo thật mới biết.

## 7. Phần 4 (tuỳ chọn) — Giảm 8 ms/dòng của phần ghi thành viên

Chỉ làm nếu sau Phần 1–2 vẫn cần: viết lại bước tìm hoặc tạo contact theo tập.

## 8. Bước 0 — Đo trước khi làm

Mọi câu đều chỉ đọc; chạy ngoài giờ cao điểm.

- **Phân bố số chiến dịch nhận data theo nhóm:**

  ```sql
  select s.group_id,
         count(*) as receiving,
         count(*) filter (where c.status in ('đang chạy', 'chờ xử lý')) as running,
         count(*) filter (where c.status = 'tạm dừng') as paused
  from public.auto_campaign_data_group_sources s
  join public.auto_campaigns c on c.id = s.campaign_id
  where s.status in ('baselining', 'active')
  group by s.group_id
  order by receiving desc
  limit 30;
  ```

- **Số lượt nạp hỏng và thời gian mỗi lượt, 7 ngày:** đọc `edge_logs` của `/rest/v1/rpc/aka_agent_ingest_data_group`
  (`response.status_code`, `response.origin_time`). Đừng tính thời gian bằng `updated_at − created_at` của
  `auto_data_ingest_batches`: cả hai đều là `now()` trong cùng một giao dịch nên luôn bằng nhau.
- **Cỡ lượt nạp thường gặp:** `auto_data_ingest_batches.result`, lấy tổng các trường đếm, nhóm theo `kind`.
- **Số thành viên của các nhóm đang cấp data**, để biết nhóm nào có nguy cơ khi bind hoặc reactivate.
- **Định nghĩa live và md5** của hàm nạp lõi, ba lớp hàm đẩy, `aka_agent_internal_route_group_snapshot`, bind và
  reactivate.
- **Thử pg_cron trên project có chạy được `CALL` thủ tục có COMMIT không.** Nếu không: dùng job riêng 10 giây/lần,
  mỗi lần một giao dịch không quá khoảng 3 giây.

## 9. Kiểm thử

- **Postgres cục bộ**, theo mẫu `scripts/test-v483-data-group-ingest-budget.sh`. Fixture: nhóm 600 nguồn (đang chạy
  và tạm dừng), lượt nạp 45 dòng và 1.000 dòng. Kiểm:
  - lượt nạp trả về nhanh;
  - worker đẩy đủ data;
  - kết quả giống hệt cách cũ (so sánh song song);
  - khoá giữ không quá khoảng 2 giây (đọc `pg_locks` trong lúc chạy);
  - đổi công tắc về `sync` thì chạy lại như cũ.
- **Ca biên:**
  - công tắc tắt giữa chừng;
  - chiến dịch bị xoá hoặc hết hạn;
  - thành viên bị gỡ khỏi nhóm;
  - nhóm bị thu hồi chia sẻ;
  - job lỗi rồi thử lại;
  - hai lượt nạp cùng một nhóm cùng lúc.
- **Production:**
  1. Bật cho một tổ chức (tổ chức của staff 724).
  2. Theo dõi delta `pg_stat_statements`, độ trễ của job và lỗi trong 7 ngày.
  3. Mở rộng dần.

## 10. Triển khai

- Mỗi phần một migration. Chọn số lúc bắt đầu làm, sau khi kiểm sổ migration và mọi nhánh.
- Mỗi migration có: preflight md5 định nghĩa live, postflight, rollback, script test. Apply ngoài giờ cao điểm.
- Phần 1 và Phần 3 chỉ sửa DB. Phần 2 làm DB trước, rồi deploy Web và phát hành Desktop/iOS.
- Sau Phần 1, bỏ hệ số chiến dịch trong ước tính chia lô phía app: `estimateDataGroupIngestRowMs` ở akaAgentWebApp
  `packages/control-api` và bản chép ở `src/shared`. Không sửa thì app vẫn chạy, chỉ gửi lô nhỏ hơn cần thiết.

## 11. Cần anh/chị chốt

1. Chấp nhận data vào chiến dịch trễ vài chục giây?
2. Ưu tiên chiến dịch đang chạy, chiến dịch tạm dừng làm sau?
3. Bật thử cho tổ chức của staff 724 trước?
4. Làm Phần 1b (bind và reactivate) cùng Phần 1 hay để sau?
