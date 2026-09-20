# Google Sheet: chuẩn hóa SĐT và index lượt đang chạy

Ngày 21/09/2026 (Việt Nam). Linked production đã xác minh: `cgjbsmqtfhqvttudyjzq`.

## Thay đổi đã triển khai

- Desktop preview và Edge v3 cùng gọi `normalizeVietnamMobilePhone` từ `src/shared/phone.ts`. Hai giá trị `333875455`, `703576704` được chuẩn hóa thành `0333875455`, `0703576704`. Hàm chung, UID và quy tắc SQL không đổi.
- Import `.ts` trực tiếp để CLI thu thập đúng dependency. TypeScript 5.9.3 của repo hỗ trợ `rewriteRelativeImportExtensions`, được bật ở hai tsconfig. Parser chạy được bằng cả Node và Deno, không cần bản sao helper hay import map.
- Migration v301 thêm `idx_data_group_external_sync_runs_running`, B-tree `(source_id, started_at) WHERE status='running'`. History `20260920173109`, ghi vào bảng migration đã có trong cùng transaction.
- Không đổi RPC, ACL, cron 66, lịch nguồn, worker concurrency, pool hay ngân sách connection. Dispatcher vẫn bật; dữ liệu đã nhập giữ nguyên.

## Bằng chứng chọn index

Audit trước apply: lịch sử có 3 lượt, total relation size 98.304 byte. `EXPLAIN` cho hai predicate trong RPC live:

```sql
WHERE source_id = ... AND status = 'running'
WHERE source_id = ... AND status = 'running'
  AND started_at < now() - interval '180 seconds'
```

Cả hai phải dùng seq scan và chưa có index phù hợp. Các predicate này xuất hiện khi save/toggle/delete nguồn và khi claim phục hồi lượt cũ. Partial index loại các lượt hoàn tất khỏi tập tìm kiếm; không cần thêm index toàn bộ lịch sử theo nguồn.

Các đường đọc còn lại đã có index:

| Đường đọc | Index/plan được kiểm tra |
| --- | --- |
| Nguồn đến hạn | `idx_data_group_external_sync_due(next_run_at,id)` với predicate khớp dispatcher/claim; bảng nhỏ hiện có thể chọn seq scan |
| Nguồn theo nhóm | `idx_data_group_external_sync_group(group_id,id)` |
| 30 lượt gần nhất | Index scan `idx_data_group_external_sync_runs_group(group_id,id DESC)` |
| Contact trong phạm vi staff/org/type | Index scan `idx_auto_account_contacts_dynamic_filter_scope`; kiểm tra cả phone không binding và Zalo có binding |
| Thành viên đang hoạt động | Index scan `idx_auto_account_contact_group_members_active` |
| Origin của membership / contact ID | Index `uq_auto_account_contact_group_member_origins_identity` và contact PK |
| Định danh đã xử lý | PK `(group_id,data_type_code,account_scope,identity_key)` |

Không thêm index lớn cho contact/member: query đang dùng index, còn việc tính canonical identity trên các dòng trong nhóm/account là chi phí xử lý mà index thông thường không tự loại bỏ. Chưa benchmark Sheet 10.000 dòng với nhóm lớn. Smoke dùng `enable_seqscan=off` **chỉ trong transaction rollback** để chứng minh index mới dùng được cho đúng predicate; không coi đây là benchmark hoặc thay đổi planner production.

## An toàn migration và RPC live

Đã lấy đúng `pg_get_functiondef()` cùng owner/security/volatility/config/ACL và checksum trước apply. v301 fail-closed theo checksum của claim và RPC CRUD; nếu bảng run lớn hơn 10 MiB mà index chưa tồn tại thì dừng để đánh giá lại cách build. `lock_timeout=5s`, `statement_timeout=15s`, index hiện nhỏ nên dùng transaction ngắn. Postflight xác minh chính xác definition, `indisvalid` và `indisready`; cùng tên khác cấu trúc sẽ rollback.

Đã đọc event trigger `extensions.pgrst_ddl_watch()`: `CREATE INDEX` không nằm trong các command tag yêu cầu reload. Migration không có DDL chuẩn bị history, `COMMENT`, thay đổi metadata API hoặc `NOTIFY pgrst`.

Tất cả signature dưới đây có checksum **source = target**; definition và toàn bộ metadata nêu trên khớp trước/sau:

| Exact signature (`public`) | MD5 giữ nguyên |
| --- | --- |
| `aka_agent_sheet_identity(text,jsonb)` | `b6e2126aadbf1b9c558dd83e20b7bacd` |
| `aka_agent_sheet_classify(bigint,text,jsonb)` | `f064ef6f96b48aaaac9bcfdf7483bb6b` |
| `aka_agent_sheet_claim(uuid)` | `00bc55ed63fadabdb76c8a3f0283a639` |
| `aka_agent_sheet_finish(uuid,jsonb,integer,integer,text,boolean)` | `163200693b2fb2425d54fd9f3a7eaca3` |
| `aka_agent_sheet_dispatch()` | `b1e53361c281257759bc8ebdaed1fb15` |
| `aka_agent_data_group_external_sync(bigint,bigint,text,text,text,jsonb)` | `b85a58727a68514b9a5837861adfe35b` |
| `aka_agent_data_group_background_tick()` | `873b2939cc09a51e0e9d71f685dfd0e0` |

Các patch Facebook/legacy identity v299–300, thứ tự khóa claim v298, tenant guards, token/revision, binding và ingest giữ nguyên vì không thay body RPC. SQL normalizer live `aka_agent_internal_normalize_phone(text)` (`b3ad52bceed9a68a6648956fbc622629`) đã nhận đúng hai số thiếu `0`; chỉ mapper TypeScript cũ loại nhầm.

## Kiểm chứng

- Parser smoke PASS: hai số báo lỗi; có/thiếu `0`, `84`, `0084`, đầu số cũ, định dạng số mũ, idempotence và số không hợp lệ; các ca CSV/UID/link/giới hạn cũ tiếp tục qua.
- Hai typecheck, `npm run build`, Deno check và thực thi mapper bằng Deno PASS.
- SQL smoke v301 chạy trước và sau apply, kết thúc `ROLLBACK`: preview không ghi; nhập đúng hai số; chống trùng cùng lượt/giữa nguồn; replay không nhập lại; recovery/cancel/delete; giữ lịch sử thành công; index phù hợp cả recovery và cancel. Fixture chỉ ưu tiên lịch của chính nó, không đổi lịch nguồn thật. Run count production vẫn là 3 sau kiểm tra.
- Preflight với checksum giả bị từ chối đúng. Postflight thấy index valid/ready; migration history đúng v301. Reapply trong rollback cũng qua.
- Edge `aka-agent-google-sheet-sync` version **3**, ACTIVE. Tải lại source từ server và so sánh byte-for-byte entrypoint, mapper và `phone.ts` đều khớp local.
- Anonymous HTTP **401**; Vault → pg_net → Edge với token không claim trả **200 / skipped**, kiểm tra được xác thực và RPC mà không chạy nguồn thật.
- Advisors không có cảnh báo trên index mới; cảnh báo EXECUTE SECURITY DEFINER của RPC tenant vẫn là quyền hiện có với credential guards, không thay ACL.

Rollback index có thể dùng migration riêng `DROP INDEX public.idx_data_group_external_sync_runs_running`, không ảnh hưởng data. Không rollback helper về regex cũ vì sẽ tái tạo lỗi. Không reset nguồn, ledger hoặc dữ liệu để thử lại.

Tài liệu tham chiếu: [PostgreSQL partial indexes](https://www.postgresql.org/docs/current/indexes-partial.html), [TypeScript rewriteRelativeImportExtensions](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html).
