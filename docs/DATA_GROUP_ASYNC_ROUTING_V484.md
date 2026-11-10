# Sửa gốc hàm nạp nhóm data: V484, V485, V486 (09/11/2026)

**Trạng thái (09/11/2026 23:42 VN): đã apply đủ V483, V484 (3 phần), V485 (2 phần), V486 lên akachat, không apply
lại; công tắc `async` cho tổ chức 701 (staff 724) từ 23:39:34 VN, các tổ chức khác vẫn `sync`.** V483 `20261109120408`
(19:04:08 VN), V484 p1 `20261109140318` (21:03:18), p2 `20261109141035` (21:10:35), p3 `20261109142517` (21:25:17) qua
MCP `apply_migration`; V485 p1 `20261109163531` (23:35:31), p2 `20261109163859` (23:38:59), V486 `20261109163917`
(23:39:17) dán SQL Editor bằng script guarded, vì hộp xác nhận MCP hết hạn 4 lần không ai bấm (~21:50, ~22:15, ~22:24,
~23:02 VN; lần nào kiểm chỉ đọc cũng thấy không chạy gì). md5 sổ migration khớp file từng phần, md5 hàm đích khớp
postflight (hàm nạp lõi `dc8ccc8c…`, worker `dda4a682…`, 3 hàm kiểm quyền plpgsql). Job pg_cron 112
`aka-agent-data-group-route-worker` 10 giây/lượt, 816/816 lượt thành công tới 23:41 VN; 20:55–23:42 VN 0 lỗi 5xx/503
(phút apply V485 p1 có 45 request quá 1 giây, phút sau về 45 ms). Dòng sổ do script guarded ghi có `created_by` NULL
(dòng MCP ghi email). [Biên nhận](../migrations/snapshots/data-group-routing-v483-v486/apply-receipt.json).
Lượt nạp thật đầu tiên sau đó (tổ chức 1750, `scan`, 23:46:20 VN) chạy hàm nạp bản V485 theo đường `sync`: 11 thành
viên, 18 input. 3 RPC phiên nhập file chỉ được gọi bởi client mới (API WebApp sau akaAgentWebApp#177, Desktop bản sau);
tới 23:46 VN chưa có lời gọi nào, client cũ vẫn gửi một lần như cũ.
Phương án gốc: [DATA_GROUP_INGEST_ROUTING_PLAN.md](DATA_GROUP_INGEST_ROUTING_PLAN.md). Chia lô phía app (đã merge):
akaAgentWebApp `docs/DATA_GROUP_INGEST_CHUNKING.md`.

| Migration | Việc | Phần | Kiểm thử |
|---|---|---|---|
| V483 (đã apply 09/11 19:04:08 VN) | Chặn sớm lần nạp chắc chắn quá 60 giây (PT413) ở 2 wrapper Desktop | 1 file | `bash scripts/test-v483-data-group-ingest-budget.sh` |
| V484 (đã apply 09/11 21:03–21:25 VN) | Đẩy data nhóm vào chiến dịch chạy nền (hàng đợi + worker pg_cron), bật theo tổ chức | p1, p2, p3 | `python3 scripts/data-group-routing/test_v484.py` (67/67) |
| V485 (đã apply 09/11 23:35–23:39 VN) | Nhập file nhiều phần (begin → append × N → finish), tới 100.000 dòng | p1, p2 | `python3 scripts/data-group-routing/test_v485.py` (95/95) |
| V486 (đã apply 09/11 23:39:17 VN) | Kiểm quyền đọc nhóm chia sẻ dùng plan chung (đẩy nhanh ~2,4 lần) | 1 file | `python3 scripts/data-group-routing/test_v486.py` (33/33) |

File sinh bằng `scripts/build-v484-sql.py`, `build-v485-sql.py`, `build-v486-sql.py` từ định nghĩa live đã chụp
(kiểm checksum); đừng sửa tay. Mỗi chỗ vá là thay chuỗi nguyên văn, preflight kiểm md5 `pg_get_functiondef` của đúng
bản đang chạy, postflight kiểm md5 bản mới và quyền/cấu hình hàm không đổi. Fixture kiểm thử:
`scripts/data-group-routing/fixture.py` (cần `postgresql-17` + `postgresql-17-cron`).

## V484: đẩy data vào chiến dịch chạy nền

**Vì sao:** lượt nạp đẩy từng dòng vào từng chiến dịch đang bật "nhận data mới từ nhóm" ngay trong giao dịch của người
dùng (trần 60 giây) và giữ khoá advisory + `FOR UPDATE` của mọi chiến dịch đó tới hết giao dịch.

**Công tắc** `auto_system_settings.data_groups.routing_mode` (text JSON), mặc định
`{"mode":"sync","organizationIds":[],"workerBudgetMs":4000}`:

- `sync`: mọi hàm chạy đúng như trước V484 (kiểm thử so sánh song song: 11 bảng giống hệt).
- `async` + `organizationIds`: các tổ chức trong mảng (null hoặc thiếu = mọi tổ chức, `[]` = không tổ chức nào) chỉ ghi
  thành viên trong lượt nạp; việc đẩy ghi vào `private.auto_data_group_route_jobs` (+ `_job_members`).
- `workerBudgetMs`: ngân sách mỗi lượt worker, 200–20.000 ms.
- Đổi công tắc không cần DDL, có hiệu lực ngay ở lượt nạp sau. Hàm đọc: `private.aka_agent_data_group_route_async(org)`.

**Các đường được vá** (chỉ thêm nhánh, vòng cũ giữ nguyên từng byte trong nhánh còn lại): nạp nhóm
(`aka_agent_ingest_data_group_v186_internal`), gắn chiến dịch (bind, cả bundle), bật lại công tắc (reactivate), chuyển
data, 2 hàm đồng bộ nhóm tự động theo dataset, sao chép nhóm chia sẻ, guard V483 (tổ chức chạy nền thì không tính
chiến dịch vào ước tính).

**Worker** `private.aka_agent_run_data_group_route_worker()`, pg_cron `aka-agent-data-group-route-worker` mỗi 10 giây:

- Một runner (advisory try-lock), mỗi lượt ≤ `workerBudgetMs` và ≤ 32 đoạn; `lock_timeout` 2 giây.
- Mỗi đoạn = 1 nguồn (chiến dịch) × ≤ 100 thành viên, gọi đúng hàm đẩy hiện có `aka_agent_internal_route_data_group_member`.
- Chiến dịch "đang chạy"/"chờ xử lý" trước, "tạm dừng" sau. Xoay vòng giữa các nhóm; trong một nhóm làm đúng thứ tự
  tạo việc (data vào mỗi chiến dịch đúng thứ tự như khi đẩy ngay).
- Khoá bận/deadlock/timeout (55P03/40P01/40001/57014): thử lại sau 5 giây, không tính lỗi. Lỗi khác: thu nhỏ đoạn,
  rồi bỏ đúng một cặp (chiến dịch, thành viên) sau 3 lần, ghi vào `errors`.
- Công tắc nguồn tắt trước khi tới lượt thì bỏ nguồn đó (như tắt trước lúc thêm data).
- Xong việc `members`: cộng số input thật vào kết quả lượt nạp (`routing_status` 'queued' → 'done'). Xong việc
  `baseline` (bind): ghi chú "Chờ data phù hợp"/gỡ ghi chú chờ như bind đồng bộ, không đè ghi chú khác.
- Dọn việc xong quá 30 ngày.

**Khác biệt có chủ đích so với sync** (kiểm thử ghi rõ): lượt nạp trả `inserted_input_count = 0` kèm
`routing_status: 'queued'`, `routing_job_id`; số input thật có sau khi worker xong. Dòng trùng trong một lượt nạp chỉ
đẩy một lần (sync gọi lại hàm đẩy cho dòng trùng nên đếm thêm "đã thấy"). Data vào chiến dịch trễ vài giây đến vài
chục giây (đã chốt chấp nhận).

**Đo cục bộ:** nhóm 630 chiến dịch, 45 dòng: lượt nạp trả về trong 74 ms; worker đẩy đủ 28.305 input.

## V485: nhập file nhiều phần

`upload` là ảnh chụp cả file (đầu lượt đặt lại dataset, cuối lượt gỡ thành viên không còn trong file) nên không chia
lô được, và mỗi lần gọi tối đa 10.000 dòng (~8 ms/dòng ⇒ ~7.000 dòng là hết 60 giây).

- `aka_agent_begin_data_group_upload(staff, org, request_id, group, dataset_name, import_source, source_account,
  source_name, data_type, type_rows, total_rows)`: kiểm như lượt nạp một lần, chọn/tạo dataset cùng luật (loại/nền tảng
  tính trên `type_rows` = các cặp `contact_type`/`flatform_type` của cả file, cùng ngữ cảnh kiểu dữ liệu như hàm lõi 13
  tham số). Tối đa 100.000 dòng, phiên hết hạn sau 6 giờ. Gửi lại cùng mã trả phiên cũ kèm `parts` đã nhận. Phiên mới
  cùng dataset thay phiên đang mở (`superseded`).
- `aka_agent_append_data_group_upload(staff, org, session, part_offset, rows, payload_hash)`: một lượt nạp `upload`
  bình thường vào dataset của phiên (mã `<request>:part:<offset>+<len>`, gửi lại đúng phần trả kết quả cũ) nhưng không
  đặt lại dataset, không gỡ thành viên; vị trí dòng/`rowIndex` tính theo cả file; dòng trùng với phần trước không thêm
  origin thứ hai. Phần chồng phần đã nhận: `data_group_upload_part_conflict`.
- `aka_agent_finish_data_group_upload(staff, org, session)`: thiếu phần thì `data_group_upload_incomplete`; đủ thì đặt
  lại dòng/origin của dataset không thuộc phiên, gỡ thành viên như cuối lượt một lần, đếm lại dataset, ghi lượt nạp tổng
  `<request>:finish` (lượt "gần nhất" của nhóm). Chốt lại trả đúng kết quả cũ.
- Lối vào lõi chỉ `service_role` (API Web); 3 lối vào kèm `p_auth_username/p_auth_password` cho Desktop
  (`service_role`, `aka_agent_desktop`), append gọi guard V483 với kiểu `manual`.
- Lượt nhập một lần cùng dataset đánh dấu phiên đang mở là `superseded`. Phiên bỏ dở: dòng đã nhận vẫn còn, không gỡ gì.
- Mọi lối vào khoá nhóm trước phiên (không khoá chéo). Worker V484 cuối mỗi lượt cộng lại lượt tổng của phiên đã chốt
  còn phần chờ đẩy (`routing_pending`, `SKIP LOCKED`).
- **Khác biệt so với nhập một lần** (kiểm thử ghi rõ): dòng trùng nằm ở hai phần khác nhau được đẩy lại với lượt nạp
  của phần sau nên có thêm một dòng `auto_campaign_input_origins` (cùng input/nguồn/thành viên, khác batch) như nạp chia
  lô kiểu quét; dòng trùng có giá trị khác nhau ở hai phần không báo `duplicate_identity_conflict`.

**Đo cục bộ:** 12.000 dòng qua 6 phần (≤ 9,7 giây/phần với 2 chiến dịch, sync); chốt gỡ 12.000 thành viên cũ 1,2 giây.

**Client:** `runDataGroupUpload` (akaAgentWebApp `packages/control-api/src/dataGroupIngestChunks.ts`, Desktop chép
nguyên văn `src/shared/dataGroupIngestChunks.ts`). File > 2.000 dòng hoặc ước tính một lần gửi > 45 giây thì đi phiên;
DB chưa có V485 (`PGRST202`) thì gửi một lần như cũ. API Web chạy phiên trên server nên Web và iOS hiện tại được sửa mà
không cần cập nhật app. **Chưa làm:** nâng trần 10.000 dòng/file ở giao diện Desktop/Web/iOS (module xác minh nhập
dùng chung `IMPORT_MAX_ROWS`); Google Sheet (`external_sync`, `aka_agent_sheet_finish`) vẫn nạp một lần mỗi lượt.

## V486: plan chung cho kiểm quyền đọc nhóm chia sẻ

`private.group_access` / `can_read_data_group` / `shared_data_member_owner` từ `LANGUAGE sql` sang `plpgsql` (câu truy
vấn giữ nguyên), `group_access` thêm `SET plan_cache_mode = force_generic_plan`. Hàm SQL có `SET` không inline được
nên lập kế hoạch lại mỗi lần gọi; mỗi cặp (thành viên, chiến dịch) gọi 2 lần ≈ 52% thời gian đẩy. Migration tự đối
chiếu trên dữ liệu thật trong cùng giao dịch (≤ 500 nhóm × 6 người xem), lệch là huỷ. Độc lập V484/V485.

Định nghĩa cũ lấy từ live 09/11/2026 (`migrations/snapshots/group-access-v486/live-functions.json`), không từ bản chụp
27/10: `group_access` live đã che tên chủ nhóm (`ownerName` = `Nhân viên #<id>`) khi người gọi là phiên Desktop không
phải chủ (`private.aka_agent_staff_scope_for_request()`, khớp checksum ghi trong plan V436). Bản V486 đầu tiên sinh từ
bản 27/10 nên preflight sẽ dừng ở production; đã sinh lại, bước build kiểm câu truy vấn giữ nguyên từng chữ. md5
`pg_get_functiondef`: `group_access` `d173eaf2…` → `4f7d34cd…`, `can_read_data_group` `c4716555…` → `8d5f08ca…`,
`shared_data_member_owner` `529e0060…` → `0cf5471f…`; file migration md5 `93fde69a…`.

## Apply (ngoài giờ cao điểm, phiên có quyền DB)

DDL làm PostgREST nạp lại schema: không chạy 10:00–11:30 và 14:00–16:00 VN.

1. Kiểm sổ migration và mọi nhánh trước (CLAUDE.md: số `vN` dùng chung): `git fetch --all`,
   `git log --all -- 'migrations/migration_v48*'`, `select version, name from supabase_migrations.schema_migrations
   order by version desc limit 20`. Nếu V483–V486 đã bị nhánh khác giữ số thì đổi số trong bộ sinh rồi sinh lại.
2. Thứ tự: V483 → V484 p1 → p2 → p3 → V485 p1 → p2 → V486. Mỗi file một giao dịch, phần sau kiểm phần trước.
   Qua Supabase MCP `apply_migration`: hộp xác nhận chỉ chờ ~230 giây và có thể không hiện trên app điện thoại, nên mở
   phiên trên trình duyệt máy tính. Đường dự phòng: dán SQL Editor từng file
   `migrations/tests/<tên migration>_guarded_apply.sql` (sinh bằng `scripts/build-data-group-routing-guarded-apply-sql.py`):
   nguyên văn migration trong một giao dịch, chặn ngay sau `BEGIN` nếu tên đã có trong sổ hoặc phần trước chưa có, ghi
   `supabase_migrations.schema_migrations` với `statements[1]` = đúng nội dung file (md5 khớp như `apply_migration`),
   kiểm md5 trước `COMMIT`; thành công thì bảng kết quả có `status = 'applied'`, `md5_khop_file = true`. Lỗi thì không
   đổi gì (nếu lần chạy sau báo `current transaction is aborted` thì chạy `ROLLBACK;` một lần).
3. Sau mỗi file: `select md5(statements[1]) from supabase_migrations.schema_migrations order by version desc limit 1`
   phải bằng md5 file.
4. Sau V484 p3: công tắc vẫn `sync`, job cron có và chạy (hàng đợi rỗng thì mỗi lượt worker trả `slices: 0`; xem
   `cron.job_run_details` ở mục Theo dõi).

## Bật thử cho tổ chức của staff 724

**Đã bật 09/11/2026 23:39:34 VN** cho tổ chức 701; lúc bật tổ chức có 12 nguồn nhóm data `active`, 908 `stopped`.

```sql
UPDATE public.auto_system_settings
SET value = jsonb_build_object(
      'mode', 'async',
      'organizationIds', jsonb_build_array((SELECT organization_id FROM public.org_staff WHERE id = 724)),
      'workerBudgetMs', 4000
    )::text,
    updated_at = now()
WHERE key = 'data_groups.routing_mode';
```

Tắt nhanh (không DDL): đặt lại `"mode":"sync"`. Việc đang chờ vẫn được worker làm tiếp.

Kiểm lần đầu 10/11/2026 11:15 VN (chỉ đọc): worker 4.166/4.166 lượt thành công, lâu nhất 1,09 s, hàng đợi rỗng.
Tổ chức 701 mới có 5 lượt gắn nhóm 1770 vào chiến dịch mới. Mỗi chiến dịch nhận 85 input sau 0,6–9,4 s, đúng bằng
số input của các lượt gắn nhóm này lúc còn `sync`. Lệnh gắn trả về trung bình 238 ms (trước khi bật: 946 ms). Chưa có
lượt thêm data vào nhóm nào của tổ chức 701, nên đường nạp chạy nền chưa chạy thật trên production. Chi tiết ở mục
`trialChecks` của biên nhận.

## Theo dõi

```sql
-- Hàng đợi: phải về 0 pending/running sau vài chục giây mỗi lượt nạp.
select kind, status, count(*), min(created_at), max(finished_at - created_at) as max_lag
from private.auto_data_group_route_jobs group by 1, 2 order by 1, 2;

-- Việc gần nhất, lỗi và số đếm.
select id, kind, group_id, status, attempts, error_count, inserted_count, existing_count, incompatible_count,
       last_error, created_at, finished_at - created_at as lag
from private.auto_data_group_route_jobs order by id desc limit 20;

-- Lượt worker (mỗi lượt <= workerBudgetMs).
select status, return_message, start_time, end_time - start_time as took
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'aka-agent-data-group-route-worker')
order by start_time desc limit 20;

-- Phiên nhập file.
select status, routing_pending, count(*), max(total_rows) from private.auto_data_group_upload_sessions group by 1, 2;
```

Lỗi nạp còn lại đọc `edge_logs` của `/rest/v1/rpc/aka_agent_ingest_data_group` và 3 RPC phiên
(`response.status_code`, `response.origin_time`), đừng đo bằng `updated_at - created_at` của
`auto_data_ingest_batches` (cùng `now()`). Theo dõi 7 ngày rồi mở rộng `organizationIds`.

## Kiểm thử bằng dữ liệu thật (10/11/2026)

Chép CHỈ ĐỌC từ production (SELECT qua MCP, không ghi gì) 10 nhóm data mẫu (gồm 1770), 910 chiến dịch, 79.599 input,
95.716 origin, 7.150 contacts cùng định nghĩa 1.430 hàm, cột, index và trigger; dữ liệu nằm ở thư mục tạm, không commit.
Ba cụm Postgres 17 cục bộ cùng dữ liệu: `old` (trước V484), `sync`, `async` (tổ chức 701). Chạy
`python3 scripts/data-group-routing/test_realdata.py` (cần `REALDATA_DIR` đã chép bằng `extract_sql.py` + `save_bundle.py`).

- Môi trường thử cũ (bản chụp 27/10) lệch production 81 hàm (có `aka_agent_lock_campaign_input_serialization`, lối vào
  Desktop của bind/reactivate/stop) và thiếu 710 hàm chỉ có trên production (ví dụ
  `private.aka_agent_assert_request_ownership`); bộ mới nạp đè định nghĩa production (`realload.py`, `drift_check.py`).
- Nhóm 1770 (11 nguồn đang bật): nạp lại 85 thành viên (935 đã có), nạp 105 data thật mới từ nhóm anh em (1.133 input
  mới, 22 đã có), nhập file 50 dòng, gửi lại đúng mã: trạng thái 11 bảng `old` = `sync` = `async` (sau worker) ở mọi
  bước; kết quả lượt nạp async sau worker (`done`) = cách cũ. Thời gian một lời gọi: cũ 1,2–2,5 s, sync 0,5–1,05 s
  (V486), async 0,09–0,12 s. 22/23 đạt.
- Khác biệt tìm thấy: file có dòng trùng định danh (1 dòng) thì "đã có trong chiến dịch" của lượt nạp async ít hơn
  cách cũ đúng số chiến dịch (539 so với 550): cách cũ đẩy dòng trùng hai lần, hàng đợi async gộp theo thành viên. Dữ
  liệu giống hệt, chỉ khác con số báo cáo; chưa sửa.
- Chưa thử: bật lại nguồn (10 nhóm mẫu không có nguồn tắt nào thuộc chiến dịch còn hiệu lực), nhập file nhiều phần
  V485 và `group_access` V486 trên dữ liệu thật, kịch bản 630 chiến dịch cùng bật.

## Rollback (ngược thứ tự)

1. V486: `rollback_v486_group_access_plan_cache.sql` (bất cứ lúc nào).
2. V485: `rollback_v485_data_group_upload_sessions.sql`. Từ chối khi còn phiên mở chưa hết hạn: chờ, hoặc đặt
   `status = 'expired'` cho phiên bỏ dở. Trả hàm nạp và worker về bản V484.
3. V484: đặt công tắc `sync`, chờ hàng đợi rỗng (hoặc `select private.aka_agent_run_data_group_route_worker(20000);`
   tới khi hết pending/running), rồi `rollback_v484_..._p1.sql` → `_p2.sql`. Phải rollback V485 trước (hàm nạp phải đang
   là bản V484).
4. V483: `rollback_v483_data_group_ingest_budget_guard.sql`.

Mỗi rollback kiểm md5: hàm đang ở bản mới thì trả về nguyên văn cũ, đã cũ thì bỏ qua, khác cả hai thì dừng.

## Kiểm thử đã chạy (09/11/2026)

- `test_v484.py` 67/67: so sánh song song trước V484 / V484 sync / V484 async + worker trên cùng chuỗi thao tác
  (quét có dòng trùng, nạp lại, nạp SĐT, nhập file rồi nhập lại bớt dòng, gắn chiến dịch mới, tắt rồi bật lại công tắc,
  chiến dịch đã xoá): 11 bảng giống hệt; guard, 630 chiến dịch, ưu tiên, ngân sách, nguồn đã tắt, lỗi một cặp, khoá
  bận, quyền, pg_cron thật, rollback, thứ tự phần.
- `test_v485.py` 95/95: nhập một lần trên V485 giống hệt V484; nhiều phần (sync và async + worker) giống nhập một lần
  trên 11 bảng; số đếm khớp; gửi lại phần, phần chồng, thiếu phần, phiên bị thay/hết hạn/bỏ dở; 12.000 dòng; Desktop
  (xác thực, PT413); quyền; lượt tổng async; thứ tự data vào chiến dịch; rollback/apply lại.
- `test_v486.py` 33/33 (fixture dùng định nghĩa live 09/11 của `group_access`): 1.296 tổ hợp kiểm quyền giống hệt,
  cả khi gọi từ phiên Desktop (nhánh che tên chủ nhóm) và khi một phiên xen hai kiểu gọi; V486 + V484 sync/async
  giống trước V484. Bộ V484 (67/67) và V485 (95/95) chạy lại với fixture này vẫn đạt.
- `test_guarded_apply.py` 24/24: dán sai thứ tự / dán lại bị chặn không đổi gì; dán đúng thứ tự thì sổ migration
  md5 = file từng phần, hàm đúng md5 đích, vân tay hàm/bảng/cron/công tắc giống hệt khi apply thẳng file.
- WebApp: control-api 25/25, API nhóm data 6 ca mới, toàn API 1.579 đạt (3 ca hỏng có sẵn từ trước ở columnFilters và
  desktop-ai, không liên quan), typecheck 8 workspace. Desktop: typecheck node + web sạch.
