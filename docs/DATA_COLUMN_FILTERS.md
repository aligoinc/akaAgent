# Bộ lọc cột Quét data / Data — V421

Ngày 21/10/2026. Đã triển khai trong branch `codex/data-column-filters`, từ `dev_3` tại `6920afe3`. **Đã apply riêng backend trên akachat lúc 14:28:52 Việt Nam: `20261021072852 / data_column_filters_v421`. Chưa deploy, đóng gói hoặc phát hành app. Không apply lại.** Các ghi chú “candidate/chưa apply” ở phần lịch sử bên dưới mô tả những lượt kiểm chứng trước thời điểm này.

## Apply production và tương thích app cũ — 21/10/2026

Người dùng đã cho phép apply migration bộ lọc, yêu cầu kiểm tra app cũ trước/sau và chưa phát hành app. Target được xác nhận bằng MCP là `cgjbsmqtfhqvttudyjzq` / **akachat**, PostgreSQL 17.6, trạng thái healthy. Chỉ apply một migration qua Supabase MCP; không bulk push, không thay app hoặc dữ liệu nghiệp vụ. Canonical giữ đúng byte đã kiểm chứng: SHA-256 `26045b91bf6367e09ce3715a120352a1c0bda86b0a9f74054bc8739d0059e6f3`. Comment candidate trong SQL giữ nguyên để bảo toàn bản đã apply; trạng thái hiện hành nằm trong receipt này.

### Trước apply

- Resolve lại đủ 14 exact signature; lưu full definition/checksum/owner/security/volatility/config/ACL trong `production-before.json`. Tất cả khớp snapshot, gồm patch V414 giữ tên tài khoản nguồn của nhóm chia sẻ. Cả 12 target mới chưa tồn tại.
- Kiểm tra qua role `anon`, credential được đọc và dùng trong server memory, không trả ra client/log: hai mẫu danh sách liên hệ, nhóm sở hữu 832 dòng và nhóm chia sẻ 3 dòng, cùng chặn thiếu xác thực của RPC cũ. Chỉ lưu checksum/số lượng, không lưu dữ liệu liên hệ hoặc credential.
- Chạy nguyên candidate rồi 25 ca đọc/đối chiếu/quyền/cursor trong transaction **ROLLBACK**, qua CLI Management API đã xác nhận linked project; không dùng `apply_migration` cho lượt giả vì công cụ đó ghi migration history. Đọc lại metadata xác nhận 12 target đã biến mất và 14 dependency không đổi trước khi apply thật.
- HTTP cũ đọc quan hệ `auto_account_contacts → zalo_users` thành công; hai RPC cũ vẫn trả đúng lỗi thiếu xác thực. Ba endpoint mới trả `PGRST202` trước apply.

### Sau apply

- Migration history xác nhận **`20261021072852 / data_column_filters_v421`**. Đủ 12 target có đúng checksum/owner/ACL/config như local; ba public RPC vẫn `STABLE SECURITY DEFINER`, `search_path=pg_catalog,public`, `statement_timeout=60s`; chín helper private chỉ postgres có EXECUTE. 14 dependency giữ nguyên mọi thuộc tính đã chụp.
- **25 ca SQL sau apply đạt**: luồng đọc legacy, kết quả cũ/mới trên cùng phạm vi, UID filter, upload, cursor chọn ID, nhóm sở hữu/chia sẻ và redaction, thiếu auth/quyền account/group. Group-members và remarketing được kiểm tra biên không có kết quả; không coi đây là load test lịch sử lớn trên production.
- **6 HTTP probes sau apply đạt**: đọc contacts/quan hệ cũ vẫn 200; hai RPC cũ giữ guard; ba RPC mới đã xuất hiện trong schema cache và trả đúng lỗi thiếu xác thực, không còn `PGRST202`. Không cần gửi reload schema thủ công.
- Guarded rollback được thử trong transaction rồi **ROLLBACK**: chỉ 12 target bị gỡ trong transaction; các luồng đọc cũ vẫn chạy, sau rollback cả 26 definition/quyền/config trở lại đúng trạng thái đã xác nhận. Backend bộ lọc vẫn đang được cài.
- Catalog bảng/view/index/sequence (2.264 relation), cột (12.646), policy (33) và role/database settings (11) giữ nguyên fingerprint. Transaction apply chỉ chạm **12 function mới, 0 function không liên quan**; không đổi timeout global/role, không tạo pool/polling.

Hai thay đổi độc lập được ghi rõ khi đối chiếu:

1. Migration **`20261021072601 / migration_v422_akabiz_sql_zalo_web_mapped_reuse`** từ công việc khác đã apply giữa lúc chụp baseline và apply bộ lọc, thay `public.akabiz_import_sql_zalo_web_v1(jsonb)`. Vì vậy fingerprint tổng 1.205 function cũ khác; không được báo toàn bộ DB giữ nguyên. Function này có transaction `527373756`, trước transaction bộ lọc `527409098`; không nằm trong 14 dependency và không bị task này ghi đè/rollback. Tên “V421” trong file bộ lọc cũng không phải migration nhập Zalo `20261021070657`; dùng đúng tên/timestamp receipt để phân biệt.
2. Mẫu liên hệ đang được hoạt động thật cập nhật, nên checksum dữ liệu giữa các thời điểm có thay đổi (đã thấy cả trước apply). Không dùng hash hàng sống để kết luận dữ liệu bất biến. Các so sánh reader cũ/mới cùng lượt đều đạt; checksum và tổng của hai mẫu nhóm vẫn khớp trước/sau.

### Kiểm tra security advisor và giới hạn xác nhận

Advisor có 988 finding từ trước; sau apply thêm đúng **6 WARN** vì ba RPC chủ đích cho `anon` và `authenticated` gọi `SECURITY DEFINER`, theo cơ chế credential/staff/tenant hiện có. Đây không phải quyền đọc không xác thực: entrypoint gọi `auto_assert_automation_identity` trước, rồi kiểm tra account/group; không cấp EXECUTE cho helper. **12 ca bổ sung** cho cả hai role xác nhận ba RPC đều từ chối thiếu credential và truy cập chéo tenant. Các warning được giữ có chủ ý, không tự thu hồi quyền làm hỏng Desktop. Tham chiếu advisor: [anon SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). Không sửa các finding cũ ngoài phạm vi.

Lượt này kiểm tra **hợp đồng SQL/API mà app cũ dùng**, không mở tất cả bộ cài Desktop/Server cũ. Không gây khóa/timeout 60 giây có chủ ý trên production; kiểm chứng timeout cưỡng bức và tải lớn vẫn là các kết quả local trước đó. Hai typecheck/build đã đạt ở lượt sửa app trước; lượt apply này chỉ thêm script/audit/docs, không sửa runtime hoặc build/phát hành app.

Receipt và bằng chứng trong `migrations/snapshots/column-filters-v421/production-*.json`; probe tái sử dụng ở `scripts/column-filters/production-{smoke,security}.sql`, `production-http.cjs`, `production-rehearsal.cjs`. Không chạy mode `rehearsal` sau khi đã apply (CREATE sẽ từ chối target đang tồn tại). Rollback thật chỉ dùng khi có yêu cầu riêng, phải đọc lại exact checksums trước, không CASCADE.

## Phạm vi và hành vi

- `DataScanModal`: danh sách liên hệ/nhóm/page, upload dataset, thành viên nhóm Zalo, remarketing Zalo và Page Inbox lưu ở SQLite.
- `DataGroupManagerModal`: bảng thành viên nhóm Data, bao gồm khi dùng làm picker.
- Không mở rộng sang Web, modal Kiểm tra SĐT hoặc bảng nhập liệu chiến dịch riêng.
- Mỗi tiêu đề cột dữ liệu có biểu tượng lọc; checkbox và STT không có bộ lọc. Menu có điều kiện phù hợp kiểu dữ liệu. Nhập nháp không gọi backend; bấm **Áp dụng** mới đọc.
- Thanh điều kiện hiển thị các điều kiện cột, cho sửa, bỏ từng điều kiện và xóa tất cả điều kiện cột. Tìm kiếm và các phạm vi nguồn có sẵn vẫn nằm ở thanh công cụ cũ.
- Điều kiện khác cột kết hợp AND; nhiều giá trị của cùng cột kết hợp OR. Chưa hỗ trợ nhóm AND/OR lồng nhau hay lưu bộ lọc thành preset.
- Áp dụng/xóa điều kiện đưa về trang đầu, bỏ lựa chọn cũ và dữ liệu của lần đọc trước. Lỗi không được hiện các dòng cũ như kết quả của điều kiện mới. Điều kiện được giữ để người dùng thu hẹp và thử lại.
- Các control cũ trùng cột (trạng thái, tag, tài khoản, loại data) và lọc cột thay thế nhau. Phạm vi tài khoản bị khóa trong picker luôn được giữ.
- Cột **Nguồn data chính** khác bộ chọn nguồn cũ: cột xét primary origin; bộ chọn nguồn cũ xét bất kỳ origin hiện tại. Lịch sử hành động/ngày của remarketing được giới hạn trước khi gộp người nhận; cột hành động/ngày gần nhất xét kết quả đã gộp.
- Đổi tài khoản, hành động, dataset, group hoặc đóng form vô hiệu hóa lượt cũ. Đổi phiên đăng nhập hủy các lượt đang đọc. Hủy được ràng buộc window + form + request; hủy muộn không hủy lượt mới.

## Hợp đồng dùng chung và thêm cột

`src/shared/dataColumnFilters.ts` là catalog chung cho tên cột, kiểu, toán tử, nguồn và danh sách lựa chọn. `ColumnFilterHeader`, `ColumnFilterBar`, editor và parser dùng catalog đó. Frontend không tải hết dữ liệu về để lọc.

Kiểu có sẵn: chữ, định danh, số, ngày, một/nhiều lựa chọn, có/không dữ liệu. UID và điện thoại giữ kiểu chuỗi để không mất số 0. Chữ được chuẩn hóa NFC, không phân biệt hoa/thường, vẫn phân biệt dấu; `%` và `_` là ký tự thường. Ô trống gồm NULL/chuỗi rỗng/khoảng trắng thông dụng; số 0 và false không phải trống. Điều kiện phủ định không bao gồm ô trống. Khoảng ngày theo Việt Nam, đầu ngày bao gồm và đầu ngày kế tiếp không bao gồm.

Thêm cột mới theo quy trình:

1. Khai báo một mục trong `DATA_COLUMNS`, chọn kiểu và các nguồn hỗ trợ.
2. Khai báo biểu thức lấy giá trị thực tế trong adapter nguồn: generator SQL `generate-group.py`, `generate-contacts.py`, `generate-remarketing.py`, hoặc `PAGE_INBOX_FILTER_EXPRESSIONS` cho SQLite. Cột tính toán phải có biểu thức tương đương tại backend.
3. Dùng `ColumnFilterHeader` với `field` của cột. Editor, toán tử, chip, validation và luồng query được dùng lại, không viết bộ lọc riêng.
4. Chạy generator và ca kiểm chứng cho biểu thức mới. Generator từ chối cột thiếu projection SQL; contract test kiểm tra đủ ánh xạ SQLite. Sau V421 đã live, thêm cột bằng migration kế tiếp, không sửa/apply lại migration cũ.

Việc thêm một cột vật lý vào DB không tự công khai cột đó qua API. Catalog và ánh xạ là allowlist bắt buộc để bảo toàn quyền và kiểm soát chi phí truy vấn.

Request gồm `source`, `accountId` nếu cần, `formId`, `requestId`, `query.columnFilters={version:1,filters:[...]}`. Danh tính/credential lấy trong Main từ phiên hiện tại, không lấy từ renderer. SQL chỉ nhận tên cột/toán tử được phép; toàn bộ giá trị điều kiện, cursor, offset và limit truyền qua `EXECUTE ... USING`. Các đoạn cấu trúc SQL tin cậy được ghép một lần, không thay marker trong dữ liệu người dùng.

## Backend và kiểm soát tài nguyên

Ba RPC mới, không thay định nghĩa reader cũ:

| Signature | Checksum target cục bộ `md5(pg_get_functiondef)` |
|---|---|
| `public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)` | `788154e11ff9c302ed14cabd866fa1da` |
| `public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)` | `17ffadd05bb48b245a4382789c6d59ea` |
| `public.aka_agent_read_filtered_remarketing_v1(bigint,bigint,text,text,jsonb)` | `6f5c7a310643cf7d63782974ffcdc933` |

RPC dùng `STABLE SECURITY DEFINER`, owner postgres, `search_path=pg_catalog,public`, `statement_timeout=60s`; bỏ EXECUTE của PUBLIC, cấp anon/authenticated/service_role theo hợp đồng identity hiện có. Chín helper private chỉ postgres được EXECUTE. Không thêm bảng/index, không tăng timeout role, không thêm pool/SQL connection/polling trong sản phẩm. Dùng `getSupabaseClient()` HTTP hiện có.

Kiểm tra lại staff/tenant, account/dataset hoặc quyền nhóm chia sẻ trước khi đọc. Giữ bản vá V414 cho phép hiện tên tài khoản nguồn trong nhóm chia sẻ; provenance/dataset/automation nhạy cảm vẫn bị che. Lọc cột automation của nhóm chia sẻ cũng không được suy ra giá trị ẩn.

Điều kiện áp dụng trước count và phân trang. Count và page của một RPC dùng cùng snapshot statement. Xuất, chọn toàn bộ và chọn khoảng dùng cùng điều kiện; Data dùng membership ID. Export PostgreSQL dùng cursor có ID làm khóa phụ, chỉ đếm ở trang đầu. Page Inbox dùng thứ tự thời gian + ID và offset trên SQLite. Export nhiều trang **không phải snapshot đóng băng xuyên suốt** khi dữ liệu đang thay đổi; có chặn ID trùng, cursor không tiến và số dòng không khớp. Nếu cần snapshot bất biến toàn lượt thì phải bổ sung thiết kế riêng.

| Giới hạn | Giá trị |
|---|---:|
| Đọc đồng thời | 2 / Main process, chung các form |
| Hàng chờ | 8 |
| Deadline trang gồm cả chờ và kiểm tra quyền | 65 giây |
| Timeout truy vấn PostgreSQL/PostgREST | 60 giây |
| HTTP một trang | 65 giây |
| Deadline toàn lượt export/chọn tất cả | 65 giây |
| Kích thước trang | tối đa 500 dòng |
| Export/chọn tất cả | tối đa 100.000 dòng, 32 MiB kết quả |
| Offset | tối đa 100.000 |
| Điều kiện / giá trị danh sách / chuỗi | 40 / 200 / 1.000 ký tự |
| Payload query | tối đa 2 MiB |

Không tự retry timeout hoặc chuyển sang lọc trên các dòng đã tải. Hủy/đổi điều kiện vô hiệu hóa kết quả ngay; RPC đang gửi giữ slot đến khi có phản hồi xác nhận kết thúc, không abort HTTP chỉ vì đổi form. Lỗi mạng/HTTP deadline không chứng minh SQL đã dừng: coordinator giữ slot thêm tối đa ngân sách 60 giây, kể cả khi form đã hủy. Không nhả slot khi transport chưa settle. Đây là hạn trong một process, **không phải giới hạn tổng tải trên toàn bộ Desktop của khách hàng**; vẫn cần quan sát tổng tải DB khi rollout.

Đọc account ở bước kiểm tra quyền nhận cùng AbortSignal của lượt đọc: hết deadline, hủy form hoặc đổi phiên đều hủy HTTP này. Chờ transport kết thúc rồi giữ ngân sách server 60 giây nếu bị abort; không dùng `Promise.race` để bỏ lại request đang chạy. Vì vậy timeout giao diện 65 giây không đồng nghĩa slot được nhả ngay. Các kiểm tra gói/capability vẫn đọc snapshot hiện có, không thêm query hoặc thay quyền.

Page Inbox dùng process Electron Node đọc SQLite readonly, mở transaction count+page, timeout 3 giây, kill process và đợi đóng thật khi hủy. Thử nghiệm cho thấy terminate Worker không ngắt được một native SQLite call đang chạy nên dùng process có thể dừng. Không giữ worker/pool nền. Cần smoke lại native helper trên bộ cài Windows/macOS khi đến lượt đóng gói.

PostgREST phải đọc được function setting khi tạo schema cache. Timeout này đã được kiểm chứng qua HTTP PostgREST cục bộ; gọi trực tiếp bằng psql phải đặt timeout session/transaction trước statement. Tham chiếu cơ chế [transaction-scoped settings của PostgREST](https://docs.postgrest.org/en/stable/references/transactions.html) và [hoisted settings](https://docs.postgrest.org/en/stable/references/configuration.html#db-hoisted-tx-settings).

## Kiểm chứng backend trước UI

Đã làm catalog/backend, correctness/security, đo tải 100k và hủy SQLite thật trước khi tích hợp giao diện. Sau tích hợp, dựng lại DB fixture sạch và chạy lại migration cuối.

Môi trường: PostgreSQL 16.15 cục bộ, ICU `und`, schema/index/function metadata đọc từ akachat PostgreSQL 17.6, dữ liệu tự sinh. Không sao chép dữ liệu khách hàng. Local PostgREST 16.5 dùng riêng DB fixture. Không chạy load test hoặc apply candidate trên production.

Gate đã đặt: phép đo 100k có tối đa 2 lượt song song phải dưới 2 giây/lượt trên máy thử; timeout phải dừng, trả lỗi và phục hồi được; quyền/dữ liệu/phân trang phải đúng. Các con số dưới là **maximum của mẫu nhỏ**, không phải SLA hoặc p95 production.

| Trường hợp | Dữ liệu fixture | Max một lượt | Max khi 2 lượt đồng thời |
|---|---:|---:|---:|
| Data, không lọc | 100.000 thành viên | 0,232 s | 0,149 s |
| Data, chứa tên | 100.000 thành viên | 0,258 s | 0,241 s |
| Data, nhiều điều kiện | 100.000 thành viên | 0,141 s | 0,175 s |
| Data, automation | 100.000 thành viên | 0,622 s | 0,466 s |
| Liên hệ | 100.000 | 0,095 s | 0,105 s |
| Upload | 100.000 | 0,136 s | 0,131 s |
| Thành viên nhóm Zalo | 10.000 | 0,049 s | 0,051 s |
| Remarketing | 100.000 lịch sử / 10.000 người nhận | 1,078 s | 1,082 s |
| Liên hệ, tìm SĐT không khớp | 100.000 | 0,212 s | 0,249 s |
| Upload, tìm SĐT không khớp | 100.000 | 0,208 s | 0,208 s |
| Thành viên nhóm Zalo, tìm SĐT không khớp | 10.000 | 0,059 s | 0,058 s |
| Page Inbox SQLite | 100.000 | 0,253 s | kiểm tra giới hạn qua coordinator |

- Stress 1.000.000 dòng lịch sử với timeout session cố ý rút xuống 3 giây (kiểm tra cưỡng bức hủy, không phải cấu hình RPC hiện tại): truy vấn remarketing rộng bị hủy khoảng **3,009 giây**; rollback fixture và truy vấn theo ngày phục hồi khoảng **0,205 giây**. Không thể cam kết mọi phạm vi dữ liệu đều không timeout.
- HTTP/PostgREST: khóa bảng fixture để làm reader chờ; nhận SQLSTATE `57014` sau **60,008 giây**, request sau khi nhả khóa thành công. Không chỉ thử `pg_sleep` trong một hàm giả.
- SQLite native query dài được hủy trong khoảng **108 ms**. Kết quả quá thời gian/phiên cũ không được chuyển sang renderer.
- 28 kiểm tra SQL nhóm Data; 20 kiểm tra SQL Quét data; 69 ca đối chiếu URL nguồn với normalizer cũ.
- 15 ca contract/coordinator; 13 ca service; 7 ca preflight qua IPC/repository/supabase-js và HTTP local thật; 6 ca native SQLite; 6 ca HTTP/PostgREST; 154 ca hồi quy SQL review (94 ca trước và 60 ca tìm kiếm SĐT).
- 15 ca UI Chromium cho form thật với IPC giả: nháp không gọi query, áp dụng/xóa/chọn tất cả, giữ UID số 0, reset lựa chọn, Escape, timeout và retry, kết quả muộn sau unmount, backend chưa cập nhật; thêm ba ca giữ bộ lọc/lựa chọn khi validation lỗi, đóng nháp lỗi và áp dụng lại hợp lệ; không có page error.
- Hồi quy cũ: 21 ca form Data, 10 nhóm smoke Page Inbox scan và 27 ca Inbox search đều đạt. Smoke loader cũ được bổ sung stub cho import mới và dependency đã có.
- Hai typecheck và `npm run build` đạt. Build có các cảnh báo chia chunk đã tồn tại; chưa build installer.

Kết quả máy đọc được: `scripts/column-filters/{postgres-results,scan-results,timeout-results,http-results,preflight-results,review-results,local-migration-audit,live-dependency-audit}.json`.

Một lần đo lại remarketing đồng thời đã chạm timeout session 3 giây trên máy đang có tải khác. Kiểm tra `EXPLAIN (ANALYZE, BUFFERS)` sau đó đạt 1,216 giây, hai lượt đồng thời chẩn đoán đạt 1,194 giây; chạy lại toàn bộ suite Quét data đạt gate 2 giây mà không thay query hoặc nới gate. Bảng trên dùng số đo Quét data mới nhất sau sửa tìm kiếm SĐT; số đo Data/SQLite và các ca hủy cưỡng bức là từ lượt kiểm chứng trước. Chưa xác định được nguyên nhân chắc chắn của lần chậm; không xem lần đo đạt sau đó là bảo đảm không timeout. Phải kiểm chứng tải tổng và độ trễ trên staging trước rollout.

## Sửa hai finding review — 21/10/2026

1. **Giá trị lọc/cursor bị đưa qua thay marker SQL nhiều lần:** compiler chỉ tạo cấu trúc từ catalog, toán tử và chỉ số điều kiện nội bộ; reader bind query/cursor/phân trang qua `USING`. `format()` ghép cấu trúc một lần, không quét lại giá trị. Cursor phải đủ trường, đúng kiểu, ID trong miền an toàn, rank nguyên và timestamp hợp lệ; thiếu/null/sai kiểu bị từ chối trước truy vấn. Hồi quy kiểm tra chuỗi marker, dấu nháy và chuỗi giống SQL vẫn là dữ liệu, phân trang khớp offset, cùng cấu trúc SQL khi đổi giá trị, quyền account/group và dữ liệu tenant.
2. **Trạng thái Data lệch nội dung bảng:** projection backend dùng cùng ý nghĩa với `getMemberStatus`: nhóm có `is_joined=false` hoặc NULL là `not_joined`; chỉ liên hệ người mới có trạng thái bạn bè; phone/email/page/campaign_input trả NULL tương ứng dấu gạch trên bảng. Ma trận 12 dòng kiểm tra cả count và ID cho từng trạng thái, gồm ô trống.

Đồng bộ ngân sách RPC bulk 60 giây/caller 65 giây theo `AGENTS.md`; không tăng timeout role/global. Hủy form vẫn trả ngay và bỏ kết quả cũ, còn suất xử lý chỉ nhả khi HTTP kết thúc; mất kết nối chưa biết SQL đã dừng phải giữ ngân sách server. Kiểm chứng service/coordinator bao gồm hủy rồi tiếp tục xếp hàng, không phát thêm request vượt hai lượt đang chạy.

Các sửa đổi chỉ nằm trong candidate và mã ứng dụng local. 14 dependency live được đọc lại và đối chiếu nguyên vẹn; không thay reader/RPC cũ, không apply production hoặc phát hành.

## Sửa tìm kiếm nhiều trường SĐT — 21/10/2026

Tìm kiếm chung của `contacts`, `upload` và `group_members` trước đây dùng `COALESCE` lấy SĐT đầu tiên, nên bỏ sót số ở trường sau khi trường trước đã có dữ liệu. Reader nay tìm trong cả năm khóa `phone`, `phoneNumber`, `phone_number`, `mobilePhone`, `mobile_phone` ở `extra_data` và năm khóa tương ứng trong `rawPayload`, giống `getContactPhoneSearchText` cũ. Bộ lọc cột SĐT vẫn xét giá trị hiển thị; tìm kiếm chung và điều kiện cột kết hợp AND trước count/phân trang/chọn/xuất.

60 ca mới kiểm tra cả mười trường cùng có số, số không khớp, tên/UID, dữ liệu thiếu/null/trống, kết hợp với lọc cột SĐT, cursor/offset/count và loại trừ ID trên cả ba nguồn. Toàn bộ 154 ca review và 20 ca SQL Quét data đạt. Bảy workload hiệu năng (sáu lượt đơn và sáu lượt chia hai luồng mỗi workload) đều đạt gate 2 giây; tìm kiếm không khớp trên 100k liên hệ/upload buộc xét cả phạm vi, chậm nhất 0,249 giây trong fixture local. Không phát sinh timeout trong lượt này. Không đổi cấu hình timeout; các ca HTTP 60 giây/SQLite/hủy cưỡng bức nêu trên đã chạy ở lượt trước, không chạy lại cho sửa biểu thức này. Lượt sửa SĐT không sửa TypeScript/UI; kết quả typecheck/build trước được giữ nguyên ở lượt đó.

Chỉ định nghĩa candidate `public.aka_agent_read_filtered_contacts_v1(bigint,bigint,text,text,text,jsonb)` thay đổi: checksum local cũ `db4aaaaf3860eb3ef8b06b0504eccdf5` → target `788154e11ff9c302ed14cabd866fa1da`. Đây là hai phiên bản candidate chưa apply, không phải thay một RPC production. Giữ owner/security/volatility/config/ACL, 11 function candidate còn lại và 14 dependency đã đối chiếu live; vẫn giữ bản vá chia sẻ tên nguồn V414. Migration và guarded rollback được cập nhật đồng bộ; transaction rollback/apply/audit chỉ chạy trên fixture local. Project dự kiến cho rollout vẫn là `cgjbsmqtfhqvttudyjzq` (akachat); **chưa apply production, deploy hoặc phát hành**.

## Sửa validate UI và timeout kiểm tra quyền — 21/10/2026

1. `useColumnFilters.replace` validate toàn bộ điều kiện mới trước khi xóa control lọc cũ, hủy lượt đọc hoặc thay state. Với “Hiển thị: Bạn bè”, bấm Áp dụng bộ lọc cột Trạng thái chưa chọn giá trị nay chỉ báo lỗi; giữ bộ lọc cũ, hàng đã chọn và request hiện tại. Sửa thành điều kiện hợp lệ mới thay bộ lọc cũ và reset lựa chọn như thiết kế.
2. `executeColumnRead` truyền AbortSignal của coordinator qua IPC `ensureContactAccess` tới `getAccount`/Supabase HTTP. Deadline 65 giây đã gồm cả chờ và kiểm tra quyền, không bắt đầu lại sau preflight. Hủy/đổi phiên cũng ngắt account HTTP. Service chờ transport settle rồi mới kết thúc công việc; abort được phân loại chưa xác nhận server kết thúc để giữ thêm ngân sách 60 giây hiện có. Giữ nguyên quyền account/gói, giới hạn hai lượt/process và cách hủy RPC lọc đang chạy.

Kiểm chứng lượt này: **15 ca UI, 15 ca contract/coordinator, 13 ca service và 7 ca preflight đều đạt**; hai typecheck và production build đạt. Preflight dùng IPC handler, account repository và `supabase-js` thật với HTTP fixture chỉ trên localhost: hai account read không trả header đều bị đóng bởi abort, không phát RPC sau timeout; lượt khỏe chờ đúng ngân sách rồi chạy lại được; hủy form, đổi phiên, account thiếu và gói thiếu vẫn chặn đọc. Test rút riêng deadline xuống 450 ms và ngân sách chưa xác nhận xuống 140 ms để kiểm tra lifecycle; trước khi rút có assert cấu hình thật vẫn 65.000/60.000 ms. Test này không phải đo timeout PostgreSQL mới.

Không đổi SQL candidate (SHA-256 vẫn khớp audit), schema, quyền DB, connection/polling hoặc query count. Kết quả SQL/load test/HTTP 60 giây từ các lượt trước được giữ nguyên, không chạy lại trong sửa Main/UI này. **Chưa apply migration production, deploy, đóng gói hoặc phát hành.**

## Audit migration và rollback

Canonical: `migrations/migration_v421_data_column_filters.sql`. Guarded rollback: `migrations/rollback_v421_data_column_filters.sql`. Phần dưới ghi kiểm chứng local trước rollout; trạng thái production hiện tại xem phần apply ở đầu tài liệu.

14 signature được resolve lại bằng `to_regprocedure`, đối chiếu checksum/owner/security/volatility/config/ACL với snapshot trong `migrations/snapshots/column-filters-v421/`. Mỗi dependency có guard fail-closed trong migration. Không overwrite bất kỳ function cũ nào; CREATE mới sẽ từ chối nếu target đã tồn tại.

Đã tìm tất cả migration có nhắc tên và so body live với body repo: readers v2/v205 khớp V290; sharing khớp **V414**, không dùng body V409 cũ có redaction tên tài khoản; private ACL/helper khớp V409; các overload list khớp V206; source code giữ `external_sync` của V297; identity V174, staff V186 và dataset IDs V170. Chi tiết exact signature, source checksum, target checksum và tất cả file được tìm nằm trong hai audit JSON. Không phát hiện body DB-only khác ở tập dependency này.

Local đã thử:

1. Tạo candidate trong transaction rồi ROLLBACK; target không còn tồn tại.
2. Apply vào DB fixture mới; xác nhận 12 function mới đúng owner/ACL/config và 14 dependency giữ nguyên toàn bộ thuộc tính.
3. Sửa một config dependency trong transaction cục bộ: preflight từ chối, transaction rollback.
4. Chạy guarded rollback trong transaction rồi ROLLBACK; candidate và các dependency còn nguyên.

## Quy trình rollout (backend đã apply, app chưa phát hành)

1. Đọc lại đúng project ref `cgjbsmqtfhqvttudyjzq`, exact signatures và checksum; nếu drift phải re-audit, không bỏ guard.
2. Kiểm chứng trên staging gần production: PostgreSQL/collation/PostgREST, kích thước JSON, phân bố tenant, concurrency tổng và pool wait. Thử các phạm vi lịch sử lớn và export nhiều trang. Không dùng kết quả local để bỏ bước này.
3. Backend đã apply duy nhất `20261021072852 / data_column_filters_v421`; **không apply lại**. HTTP đã xác nhận schema cache nhận ba RPC mới, không reload lặp hoặc tăng pool/role timeout. Giữ kiểm chứng tải gần thực tế trước rollout rộng app.
4. Đóng gói/test helper SQLite native trên các nền tảng, rồi mới phát hành Desktop khi có yêu cầu.
5. Nếu RPC chưa có: Desktop tự đọc đường cũ khi chưa áp dụng điều kiện cột, khóa nút lọc kèm thông báo. Có điều kiện thì báo lỗi, không fallback sang toàn bộ dữ liệu. Cache thiếu RPC 60 giây, chỉ xét lại khi có request, không polling.
6. Rollback: đóng form/hạ phiên bản ứng dụng phù hợp, kiểm tra checksum target rồi dùng file rollback không CASCADE. Không có backfill hoặc dữ liệu nghiệp vụ cần đảo. Sau gỡ RPC, cập nhật schema cache và xác nhận luồng legacy.

## Chạy lại cục bộ

Các script SQL fixture khóa cứng `127.0.0.1:55421/column_filters`. `reset-local.py` còn kiểm tra data_directory `/tmp/aka-column-filters-pg-20261021` trước khi drop/recreate **database fixture**. Không trỏ các script này đến production.

```sh
python3 scripts/column-filters/start-local.py
python3 scripts/column-filters/generate-group.py
python3 scripts/column-filters/generate-contacts.py
python3 scripts/column-filters/generate-remarketing.py
node scripts/column-filters/generate.cjs
python3 scripts/column-filters/reset-local.py
python3 scripts/column-filters/test-postgres.py
python3 scripts/column-filters/test-scan-postgres.py
python3 scripts/column-filters/test-review-regressions.py
python3 scripts/column-filters/test-timeout.py
python3 scripts/column-filters/audit-local.py
node scripts/column-filters/test-source-parity.cjs
node scripts/column-filters/test-contract.cjs
node scripts/column-filters/test-service.cjs
node scripts/column-filters/test-preflight.cjs
node scripts/column-filters/test-sqlite.cjs
node scripts/column-filters/test-ui.cjs
node scripts/column-filters/test-http.cjs # cần local PostgREST tại port 55422
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Dừng fixture sau kiểm thử: `/opt/homebrew/bin/pg_ctl -D /tmp/aka-column-filters-pg-20261021 stop -m fast`. Local PostgREST khi dùng chỉ trỏ database này, bind `127.0.0.1:55422`, pool 2 và tắt notification channel; không dùng cấu hình production.
