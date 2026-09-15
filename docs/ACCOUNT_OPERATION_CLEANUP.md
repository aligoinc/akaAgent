# Chống treo trạng thái sau thao tác tài khoản

## Trạng thái bản sửa

**DB v283 đã apply production lúc 13:42 ngày 15/09/2026 (giờ Việt Nam).** Chưa phát hành Desktop/Server hoặc khởi động lại VPS; logic retry/registry trong binary mới chưa hoạt động trên các bản đang chạy. V282 về tạo chiến dịch là thay đổi riêng đã có trước, không nằm trong bản sửa cleanup này.

Sự cố đối chiếu: tài khoản M Cương 1 (`3883`) gặp `PGRST002` lúc 10:19:44 ngày 15/09/2026. `executeCommand` gọi release một lần, sau đó bỏ reservation trong RAM dù DB chưa xác nhận đã trả trạng thái. Log cũ không ghi tên command nên không kết luận được đó là check session, logout hay đồng bộ nhãn.

## Hành vi sau sửa

1. Tạo token trước request claim đầu tiên; giữ nguyên account, staff, runtime, trạng thái trước claim và token trong suốt thao tác.
2. Claim có lỗi tạm thời thì chờ request kết thúc với lỗi, nghỉ 2 giây rồi thử lại cùng token. Chỉ chạy thao tác Zalo sau khi xác nhận claim thành công.
3. Khi thao tác xong, gọi cleanup có token. Lỗi mạng/DB tạm thời được retry tuần tự với cùng quy tắc 2 giây. **Không thêm timeout riêng cho mỗi request**, không gửi request chồng nhau và không chạy lại thao tác Zalo.
4. Chỉ bỏ hold trong RAM khi DB trả `cleaned` hoặc `not_owner`. Lỗi vĩnh viễn, response không hợp lệ hoặc shutdown giữ record cho recovery; scheduler trong cùng process không được lấy account đó.
5. Cleanup kiểm tra token dưới row lock. Token cũ không sửa trạng thái hoặc xóa token mới. Nếu người dùng đã đổi account sang pause/pending thì giữ trạng thái mới, chỉ xóa token của thao tác vừa xong.
6. Callback QR và reservation của Server cũng so token/identity trong RAM; callback cũ không xóa lượt QR hoặc reservation mới.

`not_owner` cũng là kết quả hợp lệ khi DB đã cleanup thành công nhưng response trước bị mất. Vì vậy retry cleanup không cần chạy lại công việc bên ngoài.

### Phạm vi

| Luồng | Thay đổi |
|---|---|
| Zalo App Server: QR, check session, logout, labels | Claim/cleanup có token; reservation RAM chỉ giải phóng khi cleanup xác nhận |
| akaAgent: QR trực tiếp và QR từ Chat local | Token cố định; callback completion/cancel/stop giữ đúng claim |
| Poller, warm session, setup/check realtime listener | Dùng cùng registry và cleanup |
| Quét dữ liệu Zalo/Facebook/Email | Dùng cùng retry, thay vòng retry hữu hạn cũ; Server dataset vẫn finalize trước release |
| Đổi subtype Zalo | Giữ token và staff của claim; cleanup được sau khi subtype đã đổi, kể cả account inactive |
| Chiến dịch | Dùng lại helper retry đã tách; giữ nguyên logic claim/settle và RPC chiến dịch; scheduler thêm guard cho account đang cleanup |

WebApp gọi App Server này sẽ hưởng bản sửa sau khi Server được triển khai. Runtime campaign/QR riêng của **Chat API ở repo khác** không được sửa trong task này.

### Shutdown và recovery

- Desktop ngắt retry ngay khi bắt đầu logout/expire/quit hoặc dọn login lỗi, trước khi chờ QR cleanup.
- Khi tắt Server, ngắt retry của các staff runtime ngay trước khi chờ discovery/lifecycle khởi động. Warm session nằm trong hàng đợi khởi động nên phải nhận tín hiệu này trước; stop riêng từng staff vẫn ngắt retry như cũ.
- Chờ producer thực sự dừng, gồm request claim đang gửi, QR, scan, command, poller/warm session và campaign. Giữ deadline drain 30 giây hiện có; không biến nó thành timeout cho request DB.
- Request claim đang gửi không bị coi là đã dừng chỉ vì HTTP bị abort: SQL có thể vẫn commit. Chờ response/error; khi lifecycle đã stop thì kết quả claim không được bắt đầu thao tác Zalo.
- Sau drain, chạy recovery theo staff/runtime hiện có, rồi đối soát các token còn giữ trong registry. Desktop cũng đối soát token đổi subtype mà runtime target trước đó là Server.
- Giữ chính sách recovery hiện có: account còn `đang chạy` được đưa về `chờ xử lý`. Không thêm snapshot trạng thái trước claim vào DB để khôi phục sau khi process đã mất RAM.
- Không reset định kỳ chỉ vì không thấy campaign chạy. Account có thể đang QR, scan hoặc một thao tác hợp lệ khác.

## RPC audit và migration v283

Nguồn đã đọc trực tiếp bằng `pg_get_functiondef()` từ linked production **akachat / `cgjbsmqtfhqvttudyjzq`**, ngày 15/09/2026; đã capture lại definition/checksum/attributes ngay trước apply.

Hai RPC mới chưa tồn tại khi audit:

| Exact signature | Source | Target MD5 của `pg_get_functiondef()` |
|---|---|---|
| `public.aka_agent_claim_account_operation(bigint,bigint,text,text,text,uuid,boolean,text)` | Không tồn tại | `15517ca7d3dd7af4bf1bd46f4e9cf653` |
| `public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)` | Không tồn tại | `f941b9177b447ca5da721d10dacf55e8` |

Hai dependency được giữ nguyên, preflight kiểm tra fail-closed trước DDL:

| Exact signature | Source = target MD5 | Đối chiếu repo |
|---|---|---|
| `public.claim_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)` | `78d5cdd05a02bdf3b78349e598e9d512` | Body live trùng v231 |
| `public.claim_non_zalo_account_runtime_operation(bigint,bigint,text,text,uuid,boolean)` | `300b0873302bddc8f9db6ecf404eeeea` | Body live trùng v184 |

Không phát hiện patch chỉ có trên DB ở body hai dependency này. Wrapper gọi chính RPC live hiện có, giữ guard staff/tenant, capability, owner theo subtype, đăng nhập, account soft-delete và runtime unit/input đang chạy. Wrapper bổ sung active guard cho thao tác thường kể cả QR không yêu cầu login; đổi subtype vẫn giữ quyền dùng account inactive. Non-Zalo scan bổ sung barrier campaign unit/input như Zalo.

RPC mới là `SECURITY INVOKER`, `VOLATILE`, owner `postgres`, `search_path=pg_catalog, public`; quyền execute cho `postgres`, `anon`, `authenticated`, `service_role`, không cấp `PUBLIC`. Không thay owner/ACL/body của RPC cũ. Giữ cả overload legacy để binary cũ tiếp tục dùng contract cũ.

Preflight chấp nhận RPC mới chưa tồn tại hoặc đúng target checksum/attributes để reapply; body/owner/ACL khác dự kiến sẽ bị chặn. Postflight xác minh lại target. Hai signature mới là thay đổi metadata API: migration dùng DDL event trigger hiện có; sau apply đã xác minh PostgREST nhận cả hai RPC, không thêm `NOTIFY` trùng.

**Trạng thái rollout:** DB đã sẵn sàng và đã xác minh checksum/ACL/API. Phát hành Desktop/Server sử dụng RPC mới là bước riêng, chưa được triển khai trong lần apply này. Binary cũ tiếp tục gọi RPC legacy với hành vi cũ.

### Apply production và kiểm chứng

- Apply riêng v283 bằng `supabase db query --linked --file`, hoàn tất lúc `2026-09-15T06:42:26Z`. Migration và INSERT history cùng một transaction; dùng bảng history có sẵn, không phát sinh DDL chuẩn bị hoặc file timestamp trùng nội dung.
- History có đúng một row: version `20260915063919`, name `v283_account_operation_cleanup`. `statements[1]` khớp nguyên văn file migration, MD5 `09927c19a3194f9d2f80308f615bdea0`. Các row history cũ được đối chiếu giữ nguyên.
- Hai RPC mới khớp target checksum, owner, security, volatility, config và ACL ở trên. Đối chiếu 10 định nghĩa RPC cũ gồm claim/release các overload, campaign claim, core tạo campaign v282 và Desktop/Server recovery: definition/attributes đều giữ nguyên. Schema, constraint, trigger của account và DDL reload trigger cũng giữ nguyên.
- Trước apply, chạy chính migration + history INSERT + smoke trên schema production trong transaction kết thúc bằng `ROLLBACK`; sau apply chạy lại smoke và rollback. Dùng hai account Facebook/Email thử với ID tường minh để không tăng sequence; kiểm tra claim, retry cùng token, token cạnh tranh, cleanup lặp, callback cũ, pause mới hơn, khôi phục pause, inactive và cleanup sau soft-delete. Sau mỗi lượt xác minh không còn row thử; account thật không bị cập nhật.
- Lượt smoke đầu timeout ở câu DELETE fixture do FK tới bảng `auto_campaign_run_events`; transaction đã rollback toàn bộ RPC/history/fixture. Bài thử được sửa để chỉ dùng ROLLBACK loại bỏ fixture, không DELETE; lượt pre-apply chạy lại và post-apply đều PASS. Nội dung migration không đổi.
- API sau apply: `auto_accounts` và `auto_campaigns` trả HTTP 200. Cả hai RPC mới gọi qua PostgREST bằng role `anon` với account không tồn tại cũng trả HTTP 200 và đúng `account_not_found` / `not_owner`. Không phát hiện `PGRST002`/503 trong các lượt kiểm tra này.
- Capture trước/sau, apply SQL, rollback smoke và kết quả API được giữ tại `/var/folders/cn/vjc7x3sn3gxc_nr3qz4nd7q80000gn/T/aka-v283-apply-nikbbu8p`.

## Kiểm chứng để review

```bash
node scripts/account-operation-cleanup-smoke-test.cjs
node scripts/run-account-operation-cleanup-sql-smoke.cjs
node scripts/campaign-failure-cleanup-smoke-test.cjs
node scripts/run-zalo-server-contact-dataset-smoke-test.cjs
node scripts/run-zalo-local-chat-sync-status-smoke-test.cjs
node scripts/run-zalo-chat-data-scan-smoke-test.cjs
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
npm run build:server
```

- Account smoke chạy code registry/repository/Server manager thật với transport và đồng hồ giả: 17 ca gồm PGRST002 lặp, request chậm, mất response, pause, lỗi vĩnh viễn, shutdown đang claim/đang chạy/đang retry, QR cũ và scan ba nền tảng. Ba ca mới gọi public `stop()` khi startup đang warm session: đang chờ retry claim, đang chờ retry cleanup và đang thực hiện kiểm tra Zalo. Hai ca retry phải thoát mà không cần chờ timer 2 giây; ca kiểm tra Zalo phải chờ producer xong trước recovery.
- Campaign cleanup smoke giữ 24 ca pause executor và các kiểm tra retry/ownership/shutdown; kiểm tra claim/settle chiến dịch không đổi.
- Dataset smoke: 11 ca, gồm finalize trước release và credential isolation của Desktop/Server.
- SQL smoke tạo PostgreSQL 16 cục bộ, UNIX socket riêng, không kết nối production. Nạp snapshot dependency đã audit và fixture giả; chạy migration lần đầu/lần hai + hành vi trong transaction kết thúc bằng `ROLLBACK`. Kiểm tra rollback không để lại account/RPC mới và checksum dependency sai phải chặn DDL.
- SQL kiểm tra token/staff khác, mất quyền/soft-delete sau claim, inactive subtype, pause/resume mới hơn, token legacy trên account idle, unit/input đang chạy và legacy RPC.

Giới hạn kiểm chứng: bộ SQL cục bộ dùng bảng tối thiểu và capability resolver giả. Smoke production bổ sung kiểm tra schema/trigger thật cho Facebook/Email và endpoint PostgREST, chưa thay thế kiểm tra entitlement Zalo đầy đủ hoặc chạy thao tác với tài khoản Zalo thật cùng binary mới. Desktop/Server chưa được phát hành.
