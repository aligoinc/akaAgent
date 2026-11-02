# Metadata nhóm Facebook trong Excel — V443

Ngày 02/11/2026, nhánh `codex/facebook-group-export-metadata`, nền `4c5081bf`
(PR573 đã merge). **DB đã apply V443 lúc 17:11:04 Việt Nam, 02/11/2026**;
source Desktop đã build local, chưa đóng gói/phát hành. Migration ledger:
`20261102101104 / migration_v443_facebook_group_export`.
Đổi candidate từ V442 sang V443 vì V442 đã được task khác dùng cho
`migration_v442_campaign_agent_form`; body/checksum RPC không đổi khi đánh số lại.

## Hợp đồng

- Tab **Data tìm được** bỏ `Loại nhóm AI`, còn mẫu 6 cột cố định. Không đổi
  collector/workflow, quét nhóm đã tham gia hoặc mẫu tìm được của action khác.
- **Nhóm data** và **Kết quả chạy** giữ cột cũ, thêm từng cột `Số thành viên`,
  `Số bài`, `Đơn vị bài`, `Privacy` chỉ khi có ít nhất một giá trị hợp lệ trong
  **toàn bộ phạm vi xuất**. Thiếu dữ liệu để trống, không tạo số 0 giả.
- Số thành viên 0 hợp lệ; số bài 0 hiện chưa phân biệt được với lỗi đọc activity,
  nên để trống. Đơn vị `ngày` chỉ có khi postsPerDay > 0. Privacy chỉ nhận
  Public/Công khai hoặc Private/Riêng tư, chuẩn hóa tiếng Việt.
- Metadata là thông tin hiện lưu ở contact, không phải snapshot tại thời điểm
  chạy. Trạng thái/Trạng thái phụ, log, link bài viết và automation giữ nguyên.

## Loại hành động và nguồn

Renderer chỉ yêu cầu metadata khi xuất `facebook_group_post`,
`facebook_join_group`, `facebook_find_data_group`, `facebook_comment_seeding`.
RPC kiểm tra lại action của campaign trước mọi truy vấn origins/contact.
Nhắn tin/kết bạn UID, mời bạn vào nhóm, comment link bài viết, tìm kiếm keyword,
Zalo/Email/SMS không vào đường đọc metadata kết quả chạy.

Input đã có semantic type khác `facebook_group` bị loại trước JOIN nguồn, kể cả
trong comment hỗn hợp. Data legacy cần bằng chứng Facebook/group hoặc URL nhóm
gốc hợp lệ; UID số đơn độc không xác định được loại data. Không lấy metadata của
người/page/Zalo. URL bài viết trong nhóm (path hoặc query permalink) không được
coi là URL nhóm gốc.

Nhóm data giữ membership ID; reader nối đúng `contact_id`. Kết quả chạy dùng:
`detail.input_data_id → input.id → input_origins.membership_id → member.contact_id`.
Không dò thêm bằng tên/UID/URL. UID/URL chỉ kiểm tra contact nguồn vẫn cùng target;
không suy hai alias khác nhau là cùng nhóm. Không tìm được liên kết, membership
hoặc contact bị xóa, nhóm bị thu hồi quyền: metadata trống, không mất dòng kết quả.

Một input có nhiều origins: gom các contact nguồn hợp lệ; từng trường chỉ nhận
một giá trị nhất quán. Trường mâu thuẫn để trống; thiếu ở một nguồn không chặn giá
trị từ nguồn khác. Không nhân đôi dòng detail; hai kết quả khác nhau của cùng input
vẫn là hai dòng như trước.

## Đường đọc và chi phí

- `CampaignDetailPageQuery.includeFacebookGroupMetadata` chỉ bật từ nút xuất.
  Mỗi trang tối đa 500 detail IDs gọi một RPC bổ sung qua client HTTP hiện có,
  không gọi theo từng dòng. Trang thường giữ nguyên query/cột/payload.
- RPC kiểm tra ownership campaign, ID hợp lệ/không trùng/thuộc đúng campaign;
  dedupe input trước đọc origins; JOIN dùng các PK/index input_data_id đang có.
  Không thêm index, SQL pool, connection, polling hoặc worker.
- Nhóm data dùng `includeFacebookGroupMetadata` trên hai reader hiện hữu khi
  export. Projection chỉ thêm ba key cho contact Facebook bằng JOIN khóa contact
  trên các dòng đã phân trang. Cờ false/absent không chạy lookup bổ sung và giữ
  nguyên JSON cũ. Filter service tự đặt cờ theo mode; `ids`/`page` không bật.
- Giữ filter, selected membership IDs, cursor/offset, count và redaction của
  reader. Shared data vẫn đi qua `group_access`; không mở raw contact cross-staff.
- Main chỉ trả `facebookGroupMetadata` đã lọc/chuẩn hóa, không trả toàn bộ
  extra_data. Backend chưa có projection/RPC thì báo lỗi export; không âm thầm
  xuất file thiếu metadata như thể dữ liệu không tồn tại.

Kiểm tra hiệu năng bổ sung: truy vấn metadata trên mẫu thật 160 kết quả/84 input
dùng index ở các JOIN nguồn, khoảng 179 ms trong lần đọc có truy cập đĩa. Chỉ
chạy truy vấn read-only có giới hạn, không thử nhiều máy xuất đồng thời hoặc
10.000 dòng xuyên suốt HTTP production. Nhóm data giữ deadline toàn lượt 65 giây,
giới hạn 32 MiB/100.000 dòng; Kết quả chạy giữ phân trang OFFSET và đếm tổng mỗi
trang như trước. Setting `campaign.input_data.max_rows=10000` giới hạn tạo chiến
dịch mới, không giới hạn tổng lịch sử kết quả xuất. Benchmark XLSX 10k–100k dòng
trong [receipt hiệu năng](../migrations/snapshots/facebook-group-export/performance-review.json)
đo RAM máy khách, không phải RAM Supabase. Không thay query count/cursor, timeout,
connection hoặc cách tạo workbook trong lượt kiểm tra hiệu năng này.

## DB và bảo toàn live

Áp dụng skill safe-supabase-rpc-migration, chụp live trên **akachat /
`cgjbsmqtfhqvttudyjzq`**. Source hiện có patch staff token/ownership, V414 tên tài
khoản nguồn, V421 filter/cursor và patch revoke 28/10. Generator chỉ thêm projection
export + JOIN có điều kiện vào hai reader, giữ nguyên các patch đó, auth, owner,
ACL, volatility và timeout. Không sửa `private.read_shared_group_members`.

| Exact signature | Source MD5 | Candidate MD5 |
| --- | --- | --- |
| `public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)` | `0e17dec0570937cfea8a1ae035e2af4d` | `1d683e7bd73dcd86276b44b27f91901f` |
| `public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)` | `17ffadd05bb48b245a4382789c6d59ea` | `f4c329181aa3a2e1a3c1f41a6d89f237` |
| `public.aka_agent_get_campaign_group_export_metadata(bigint,bigint,bigint,bigint[],text,text)` | chưa tồn tại | `3b9d5d422593121d936effa8b225b496` |

RPC mới dùng cùng guard token + credential + campaign ownership như reader kết
quả hiện hành, `STABLE SECURITY DEFINER`, owner postgres, function-local timeout
60s; chỉ service_role/Desktop được EXECUTE, không mở anon/authenticated/Chat API.
Contact nguồn phải thuộc chủ nhóm/cùng org và nhóm còn quyền đọc. Không đổi quyền
của caller/entrypoint cũ. Một RPC public mới cần schema reload khi apply thật;
NOTIFY nằm trong transaction, rehearsal rollback không phát thông báo.

- [Source capture](../migrations/snapshots/facebook-group-export/source.json),
  [target](../migrations/snapshots/facebook-group-export/target.json),
  [new RPC attributes](../migrations/snapshots/facebook-group-export/new-rpc-target.json).
- [Migration V443](../migrations/migration_v443_facebook_group_export.sql),
  [guarded rollback](../migrations/snapshots/facebook-group-export/rollback.sql).
- `node scripts/facebook-group-export/generate.cjs` dựng từ capture live; không
  kết nối/apply DB. Preflight kiểm checksum và attributes của cả target/dependency,
  dừng nếu drift hoặc RPC mới đã tồn tại. Không sửa checksum để vượt guard.

## Kiểm chứng và rollout

Đã chạy candidate + fixture + guarded rollback trong transaction kết thúc
**ROLLBACK** trên đúng project. Reader thường giữ JSON cũ; shared projection chỉ
ba field; Zalo bị loại; filter/selection/cursor giữ scope; nhiều origins không nhân
dòng; input người/unlinked trống; action nhắn tin bỏ qua; batch >500/IDs trùng/ID
chéo campaign bị chặn. Kiểm tra service_role và role Desktop với ánh xạ token fixture, gồm positive
read, sai staff/org, thiếu credential, mất quyền chia sẻ. Đã thử checksum sai và
xác nhận guard fail-closed. Hậu kiểm source checksum không đổi, RPC mới và fixture
staff/Auth user đều không tồn tại. [Receipt](../migrations/snapshots/facebook-group-export/verification.json).

Lô fixture 500 kết quả cùng một input có hai nguồn chạy khoảng 15 ms trong lần
rehearsal được ghi receipt; đây không phải benchmark toàn production hoặc cam kết
độ trễ. Không chạy chiến dịch/gửi tin thật, không kiểm thử DOM Facebook thật.

Kiểm tra app:

```bash
node scripts/facebook-group-export/logic-smoke.cjs
node scripts/facebook-group-export/ui-smoke.cjs
node scripts/run-campaign-found-data-export-ui-smoke.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

Smoke UI mở component thật trong Electron, HTTP bị chặn, đọc lại bytes XLSX thật:
501 kết quả qua hai trang, cột chỉ xuất hiện ở trang cuối, mixed/empty/privacy-only,
selected memberships, action gate, trạng thái phụ và bỏ AI. V443 đã apply riêng
theo yêu cầu người dùng; không apply lại khi merge PR hoặc phát hành client.

Kết quả cuối: logic smoke **PASS**; hai màn hình xuất + XLSX **PASS**; Data tìm
được 6 cột **PASS**; typecheck node/web **PASS**; `npm run build` **PASS**, output
39.3 MB (renderer build 25 giây). Build còn các cảnh báo static/dynamic imports
hiện hữu. Không tạo bộ cài hoặc phát hành. Rà React giữ hook/state/layout hiện có,
chỉ tính cột trong handler export; không thêm fetch trong render/effect.

## Apply và hậu kiểm — 02/11/2026

- Project `akachat / cgjbsmqtfhqvttudyjzq`, ledger `20261102101104`.
  [Receipt apply](../migrations/snapshots/facebook-group-export/apply-receipt.json)
  ghi SHA-256, exact signatures/checksums, owner, ACL, security mode và timeout.
- Chụp lại live trước apply; cả hai source và năm dependency khớp baseline.
  Candidate V443, fixture và guarded rollback chạy lại trong transaction ROLLBACK
  trước khi apply đúng một migration. Không bulk-push migration khác.
- Sau apply, ba RPC khớp target, năm dependency không đổi. Smoke dưới service_role
  và role Desktop cùng guarded rollback chạy trong transaction ROLLBACK; hậu kiểm
  xác nhận V443 vẫn live, không còn staff/Auth user fixture.
- Ba HTTP probe không xác thực trả `42501` đúng quyền, không có `PGRST202`:
  PostgREST đã nhận RPC mới. Project `ACTIVE_HEALTHY`. Probe này không thay thế
  kiểm thử xuất Excel bằng phiên Desktop đăng nhập thật.
- Typecheck node/web trước PR đạt; build đạt 39.3 MB, main 1,56 giây, preload
  0,08 giây, renderer 24 giây. Các smoke app ở trên dùng cùng source executable.
- Hai dòng chỉ chứa khoảng trắng trong migration/rollback được giữ nguyên từ
  `pg_get_functiondef` live để bảo toàn checksum; phần diff còn lại sạch. Không
  đổi timeout/connection hoặc phát hành bộ cài.
