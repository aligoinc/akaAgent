# Chia sẻ bài viết nguồn vào nhóm — 23/10/2026

Đã apply production **akachat** ngày 23/10/2026 lúc **22:54 VN**: `20261023155415 / facebook_native_group_share`. Code Desktop đã chuyển về repo chính `/Users/lequangnhut/Repos/akaAgent` trên `dev_3`, dưới dạng thay đổi chưa commit; chưa đóng gói/phát hành và chưa đăng bài thật để kiểm chứng. **Không apply lại migration.** Các ghi chú “chưa apply” trong lịch sử sửa bên dưới là trạng thái trước lần apply này.

Ngày 23/10/2026 đã chuyển đủ 26 file từ worktree `codex/facebook-native-group-share`, đối chiếu 12 file tracked bằng merge ba chiều và giữ nguyên các chỉnh sửa có sẵn ở repo chính. Hai typecheck, 72 ca logic/migration local, 18 fixture DOM + 7 ca React và form native share đều đạt trên repo chính. Worktree đã được archive bằng Codex, thư mục và đăng ký Git worktree đã xóa; snapshot khôi phục vẫn được giữ. Không apply lại DB trong lượt chuyển code này.

## Đồng nhất log với nhánh chia sẻ có sẵn — 24/10/2026

Theo phản hồi người dùng, bỏ toàn bộ bốn log thao tác UI đã thêm ngày 23/10: lấy tên nhóm, mở bài/tìm nhóm, chọn nhóm và gửi bài. Nhánh native giữ log `▶️ Xử lý ...`/`✅ Hoàn thành ...` chung; kết quả thành công dùng chung hàm với nhánh kiêm chia sẻ và câu chữ người dùng yêu cầu: `🔁 Đã chia sẽ bài viết vào nhóm "tên nhóm"`. Tên/UID fallback dùng `getInputDataDisplayName` như các luồng hiện có. Link nguồn tiếp tục do logger nguồn nội dung cũ ghi.

Đã đối chiếu `groupPostMilestonePayload`, `finishGroupPostShareTarget`, luồng timeline/Page và vòng xử lý data chung trong scheduler. Tách duy nhất phần ghi kết quả thành công của nhánh kiêm chia sẻ thành `logGroupPostShareSuccess`, dùng lại cho native; không gọi phần settle data của nhóm chia sẻ phụ. Log kết quả vẫn nằm trong receipt chống lặp, sau khi detail đã ghi thành công. Giữ message/detail, lỗi/Bỏ qua, trạng thái, quota và DOM; không migration. Phần ẩn tùy chọn vẫn giữ nguyên. Cần restart main từ source mới; chưa đóng gói/phát hành.

Kiểm chứng: 90 ca native share gồm không phát log thao tác từ callback, mẫu log khớp nhánh cũ, tên/UID fallback và chống lặp kết quả; 7 ca đăng nhóm, rotation Page, 25 ca mixed output, hai typecheck và production build đạt. Không đăng Facebook thật.

## Ẩn tùy chọn và bổ sung tiến trình — 23/10/2026

**Ghi chú lịch sử:** phần log từng bước dưới đây đã được thay thế bằng quy tắc ngày 24/10 ở trên; phần ẩn và giữ cấu hình tiếp tục áp dụng.

Khi bật chia sẻ bài nguồn, form ẩn **Kiêm comment**, **Kiêm up tin**, **chia sẻ thêm cho ba nhóm** và **tự tham gia nhóm sau đăng**. Hai section comment/up tin và các mục tương ứng trong thanh điều hướng cũng được ẩn; số thứ tự theo danh sách section còn hiện. Không xóa giá trị cũ: lưu/mở lại hoặc nháp rồi tắt chia sẻ vẫn khôi phục các lựa chọn đã tích.

Nguyên nhân thiếu lịch sử: ba block native trả kết quả explicit nhưng chưa có adapter tiến trình cho nhánh này; thành công không đi qua block verify của đăng thường. Scheduler nay đọc sự kiện bước chạy hiện có để ghi **đang lấy tên nhóm → đang mở bài nguồn và tìm nhóm → đã chọn nhóm → đang gửi bài chia sẻ**. Tên nhóm được cập nhật từ output prepare, kể cả data ban đầu không có tên. Mỗi mốc chỉ ghi một lần trong lượt chạy, ghi theo thứ tự qua hàng đợi log hiện có trước tổng kết.

Kết quả thành công dùng nguyên thông báo từ block, sau khi detail đã ghi thành công, bên trong receipt theo source key để không lặp khi relay/tổng kết. Giữ logger lỗi và note Bỏ qua hiện có; không báo thành công khi submit không chắc chắn hoặc ghi detail lỗi. “Đã chia sẻ” chỉ phản ánh xác nhận đóng form sau gửi, không xác nhận quản trị viên đã duyệt.

Lượt sửa này chỉ đổi Desktop UI/scheduler; không đổi block/DOM/XPath, quy tắc chờ 10 giây, workflow, policy/quota hoặc DB/RPC. **Không cần migration.** Cần khởi động lại tiến trình Desktop/main đang dùng source mới để nhận log; chưa đóng gói/phát hành.

Kiểm chứng local: **88 ca native share** gồm callback scheduler thật, nhiều target, chống log lặp, kết quả thành công/Bỏ qua/không chắc chắn, lỗi ghi detail và nhánh đăng thường; form React thật kiểm tra ẩn/hiện, giá trị sau lưu/mở lại và nháp; **25 ca mixed output**, **7 ca kết quả đăng nhóm cũ**, vòng quay Page; hai typecheck và `npm run build` đạt. Build chỉ có cảnh báo mixed static/dynamic import hiện có. Không đăng Facebook thật trong lượt kiểm thử này.

## Sửa chờ tìm nhóm và chọn cùng lượt DOM — 23/10/2026

Đã apply akachat lúc **23:28 VN**, migration **`20261023162807 / facebook_native_group_share_search_wait`**. Chỉ sửa code block **2835** `fb_select_native_share_group`. Không apply lại migration đầu hoặc migration sửa này.

Lịch sử chiến dịch 38779 ghi “Kết quả chọn nhóm đã thay đổi” lúc 23:14:05, sau khi đã thấy đúng nhóm. Source cũ đọc kết quả rồi mới truy vấn lần nữa để click; scope lần hai rộng hơn dialog tìm nhóm và so nguyên URL. Đã tái hiện local trường hợp nhóm có trong gợi ý ban đầu, nhập query rồi đọc trúng gợi ý cũ, danh sách trống khi render lại trước lần click. Log production không lưu DOM nên không kết luận chắc chắn nguyên nhân cụ thể của lượt chạy đó.

Bản sửa thực hiện **nhập tên → chờ đủ 10.000 ms có thể hủy → một `page.evaluate` đồng bộ để xác minh query, lọc UID/slug và click trong dialog chứa ô tìm kiếm**. Không đọc/chọn kết quả sớm. Nhóm trùng định danh trong chính dialog vẫn báo lỗi; link trong dialog khác không tham gia chọn. Giữ nguyên XPath, helper nhập `rawClear/rawType`, nút click, chờ sau click, Bỏ qua/note, quota/streak và ranh giới submit.

| C# tham chiếu | Workflow sau sửa | Khác DOM | Lý do |
|---|---|---|---|
| Xóa/nhập ô tìm nhóm trong `PostFb` | Giữ nguyên hai helper từ block 2794 | Không đổi so với bản đã xác minh | Dùng cách nhập React hiện có |
| Chờ sau nhập rồi tìm nhóm | Chờ đủ 10 giây trước lần đọc đầu tiên | Có, đã được người dùng chốt | Để danh sách gợi ý được thay bởi kết quả tìm kiếm |
| Tìm rồi click kết quả | Tìm đúng UID/slug và click đồng bộ trong cùng dialog | Có, đã được người dùng chốt | Không để Facebook render xen giữa hai lượt đọc DOM |

Candidate `supabase/migrations/20261023162331_facebook_native_group_share_search_wait.sql`, SHA-256 `3f1277d8dfaf3d3f12f217869f0947b876fc4b18baa2e5a85ef061b402319ca5`. Guard so toàn bộ metadata/code trừ ID và timestamps, giải block theo tên, chỉ UPDATE code/updated_at. MD5 code đổi từ `ef549f46016fe693ce3a5b67bfcba98a` sang **`df2493043c83179b3d457744ec4cbeed`**; MD5 row trừ timestamps sau apply **`d719af3d329443f2e910fc19407bdead`**. Hai block native còn lại, hai workflow và tám element liên quan không đổi sau apply.

Kiểm chứng: **24 ca DOM + 7 ca React**, gồm gợi ý ban đầu render lại/biến mất, trùng ngoài dialog, URL có tham số, query thay đổi, mất input, hủy lúc chờ và các ca submit cũ; **72 ca runtime/DAG/policy**, **15 ca migration apply/idempotent/rollback/drift và giữ migration cũ**, hai typecheck đều đạt. Không đăng Facebook thật. Migration ban đầu và rollback ban đầu giữ nguyên byte; generator ban đầu dùng code đã apply trong `search-wait-before.json`, fixture runtime dùng source hiện tại.

Receipt: [search-wait-apply-20261023.json](../migrations/snapshots/facebook-native-group-share/search-wait-apply-20261023.json). Hoàn nguyên riêng patch bằng `migrations/snapshots/facebook-native-group-share/search-wait-rollback.sql` sau khi dừng lượt native đang chạy; guard từ chối ghi đè patch mới hơn. Engine nạp block từ DB cho mỗi lượt workflow, nên lần chạy mới nhận bản sửa, không cần đóng gói Desktop cho riêng thay đổi block này. Giới hạn 10 giây là quy tắc chờ đã chốt, không phải tín hiệu chắc chắn Facebook đã hoàn tất tìm kiếm.

## Apply production — 23/10/2026

- Xác nhận project liên kết `cgjbsmqtfhqvttudyjzq` trước thao tác. Preflight: migration và ba block/bốn element mới chưa tồn tại; hai workflow khớp snapshot, 29 block dùng chung và bốn element tái sử dụng khớp code/XPath.
- Apply đúng nội dung file `supabase/migrations/20261023142009_facebook_native_group_share.sql`, SHA-256 `8643d7a14c482dfff5990cca43213c9eb5fc01f37eb1f9004db5fc25f385ce80`. Migration history ghi version thực tế `20261023155415`; timestamp của file candidate được giữ nguyên.
- Sau apply, toàn bộ row workflow **1/252** khớp candidate sinh từ generator sau khi giải ID block theo tên, chỉ bỏ qua timestamps. Cả hai có `groupPostShareWorkflowVersion=1` và mặc định `groupPostShareFromPost=false`; nhánh đăng thường được giữ.
- Block mới: **2834** `fb_prepare_native_group_share`, **2835** `fb_select_native_share_group`, **2836** `fb_submit_native_group_share`. MD5 code lần lượt `fde5a4b592c39cfff6e4b5c22677b771`, `ef549f46016fe693ce3a5b67bfcba98a`, `f5425652ce36b9f43d2126227b16cda0`, đều khớp candidate.
- Element mới: **1794** `fb_group_share_target_title`, **1795** `fb_share_to_group_button`, **1796** `fb_share_group_result`, **1797** `fb_share_group_search_empty`; XPath và metadata khớp candidate.
- Kiểm chứng lúc **22:54:37 VN**: MD5 toàn row trừ timestamps của workflow 1 là `3ddcde0d2213758204efe37c797de76f`, workflow 252 là `cf2b75944e486c61bf60a3b4deba6607`. Toàn row trừ timestamps của **29 block + 4 element dùng chung không đổi** so với preflight.
- Receipt: [apply-20261023.json](../migrations/snapshots/facebook-native-group-share/apply-20261023.json). Guarded rollback bên dưới đã được kiểm chứng local; lượt apply này không hoàn nguyên production. Không đổi RPC/schema/policy, chưa đóng gói/phát hành Desktop hoặc thử gửi bài thật trên Facebook.

## Hành vi

- Chiến dịch `facebook_group_post`, tab **Nội dung từ bài viết nguồn** có một checkbox **Đăng bài bằng cách chia sẻ bài viết từ Facebook cá nhân/fanpage**. Dùng chung luồng cho hai loại nguồn; mặc định tắt.
- `groupPostShareFromPost` bật nhánh mới; `groupPostShareCaption` là chữ thuần tùy chọn. `sourceLinks` chỉ nhận link bài viết cụ thể, luân phiên bằng `sourceLinkIndex` hiện có. Không nhận UID/link profile, fanpage hoặc group như nguồn bài.
- Mỗi lượt xử lý đúng một data/nhóm: mở nhóm → đọc tên hiện tại → mở bài nguồn → Chia sẻ → Nhóm → tìm tên → đối chiếu UID/slug → chọn một nhóm → Đăng.
- Data chỉ cần UID/link nhóm. Tên lưu trong data và cờ đã tham gia không dùng làm điều kiện lọc; không tự tham gia nhóm, không chọn nhóm chỉ dựa trên tên.
- Giữ account và cơ chế chạy bằng Page/khôi phục identity hiện có. Tắt chế độ mới giữ traversal đăng thường/copy nguồn cũ.
- Nội dung/media/phông nền, nhóm mẫu nội dung và nháp thủ công được giữ khi lưu chế độ chia sẻ. Runtime không chuẩn bị media/AI/copy nguồn hay chia sẻ thêm ba nhóm ở nhánh mới.
- Form ẩn comment/up tin/chia sẻ thêm ba nhóm/tự tham gia khi bật native; giữ giá trị để hiện lại khi tắt. Lịch sử dùng log xử lý/hoàn thành chung và một dòng kết quả theo mẫu kiêm chia sẻ hiện có; không ghi từng thao tác UI.
- Bản này chưa xác định permalink bài chia sẻ tại nhóm đích. `postUrl` và `groupPostUrl` được xóa trước thao tác; `destinationPostUrl` là null. Không chạy comment/like/up tin; tùy chọn cũ giữ để dùng khi đăng thường. Quota/preflight của nhánh mới chỉ dùng `fb_post_group`.

## Trạng thái và note

Sau khi nhập tên, chờ đủ 10 giây rồi xác minh query, tìm UID/slug và click trong cùng một lượt DOM, chỉ trong dialog chứa ô tìm kiếm. Không chọn sớm từ danh sách gợi ý. Khi ô tìm kiếm vẫn đúng query và có thông báo rỗng hoặc danh sách kết quả nhưng không có UID/slug đích, block trả:

```js
{ actionCode: 'fb_post_group', statusCode: 'campaign_detail_skipped',
  operationState: 'not_committed', message: 'Không tìm thấy nhóm để chia sẻ, chưa tham gia nhóm' }
```

Câu note nằm trong `fb_select_native_share_group` (nguồn ở `scripts/workflows/facebook-native-group-share/select.js`). Scheduler nhận cùng `actionResult.message` để ghi lịch sử và note data, không đặt một bản nội dung riêng trong policy/TypeScript. Đây là cách diễn đạt đã chốt; không coi kết quả tìm kiếm là bằng chứng tuyệt đối về membership.

Policy Bỏ qua hiện có giữ nguyên: không tính quota, không tăng hoặc reset chuỗi lỗi, data hoàn thành. Bốn lượt Bỏ qua không dừng chiến dịch; ba lỗi trước đó + Bỏ qua + một lỗi thật vẫn chạm ngưỡng bốn. `bỏ qua` được thêm vào bucket bỏ qua của thống kê chiến dịch và báo cáo legacy.

Không lấy được tên nhóm, selector thiếu/trùng, query thay đổi, hết 10 giây mà vùng kết quả vẫn trống (không có cả thông báo rỗng lẫn nhóm) hoặc lỗi DOM vẫn là lỗi thật. Không chuyển những lỗi này thành Bỏ qua. Cửa sổ 10 giây là quy tắc chờ đã được người dùng chấp thuận, không phải tín hiệu chứng minh Facebook đã tìm xong. Hủy trước bấm Đăng không gửi; lỗi/hủy sau ranh giới click trả `campaign_detail_error`, `operationState: unknown` với nguyên nhân để chặn tự chạy lại. Xác nhận thành công hiện dựa trên nút/form Đăng đã đóng, không suy ra bài đã được quản trị viên duyệt.

## Đối chiếu C# và DOM

Nguồn tham chiếu: akaBizAuto `akaBizAuto.AutomationModule/Services/mbasicFbChromeSeleniumService.cs:3884` (`SharePostFromUid_Fb`) và `mFbChromeSeleniumService.cs` (`PostFb`, chọn thêm nhóm). C# chưa có đúng toàn bộ luồng một bài nguồn → một nhóm này; phần thiếu dùng DOM đã khảo sát theo phạm vi người dùng chấp thuận.

| C# step | Workflow | Khác DOM | Lý do |
|---|---|---|---|
| Navigate nguồn, tìm nút Share, click JS, chờ theo bước | `fb_select_native_share_group` | Scope bài/dialog nguồn đã khảo sát | Nguồn là một bài cụ thể, không chọn nhiều bài trên feed |
| SharePostFromUid_Fb chọn chia sẻ lên trang cá nhân | Chọn Chia sẻ lên nhóm rồi tìm nhóm | Có | Đích yêu cầu là nhóm |
| PostFb tìm nhóm trong form đăng và thêm ba nhóm | Tái sử dụng selector input tìm nhóm, đối chiếu link định danh rồi chọn một nhóm | Có | Luồng ba nhóm là tính năng cũ riêng |
| Điền nội dung, click xác nhận | Tái sử dụng editor/nút Đăng, scope form chứa nút Đăng | Scope đã khảo sát | Dialog lồng nhau có nhiều editor; form đích có đúng một editor |

Tái sử dụng, không sửa các element chung:

| Element | ID | Scope |
|---|---:|---|
| `fb_share_button_inner` | 257 | Trong dialog bài nguồn |
| `SearchAddGroupToPostInp` | 1729 | Trong dialog chọn nhóm |
| `fb_composer_dialog` | 3 | Giao với descendants của form chứa nút Đăng |
| `fb_post_button` | 5 | Selector hiện có, yêu cầu đúng một nút |

Element mới (đã đối chiếu tên trong DB để tránh trùng):

```xpath
-- fb_group_share_target_title
//*[@role='main']//h1
-- fb_share_to_group_button
//*[@role='dialog']//*[@role='button' and @aria-label='Chia sẻ lên nhóm']
-- fb_share_group_result
//*[@role='dialog']//a[contains(@href,'/groups/') and ancestor::*[@role='button']]
-- fb_share_group_search_empty
//*[@role='dialog']//*[normalize-space(text())='Không có nhóm nào khớp với tìm kiếm của bạn.']
```

DOM thực tế ngày 23/10: tên nhóm và link đích đã đọc, tìm kiếm rỗng có đúng câu trên; form chia sẻ có một nút Đăng và một editor sau khi scope. Đã mở đến form để kiểm chứng selector, không bấm Đăng. Không thêm bộ lọc visibility, selector tiếng Anh mới hay fallback phỏng đoán.

## Migration, rollout và hoàn nguyên

- Snapshot live `migrations/snapshots/facebook-native-group-share/before.json` từ project `cgjbsmqtfhqvttudyjzq`.
- Candidate CLI: `supabase/migrations/20261023142009_facebook_native_group_share.sql`. Sinh lại bằng `node scripts/build-facebook-native-group-share.cjs` (không kết nối DB).
- Chỉ thêm bốn element, ba block; patch atomic workflow production **1** và test **252**. Giữ mọi node cũ, chỉ đổi cạnh trước composer sang gate native. Nhánh mới kết thúc ở merge khôi phục identity; không đi qua khối đăng/comment cũ.
- So toàn bộ workflow trước thay đổi (trừ timestamps), kiểm tra XPath tái sử dụng và collision theo tên; khác snapshot thì fail closed. Apply lại candidate không tạo trùng. Không đổi RPC, schema nghiệp vụ, policy hoặc connection/polling.
- DB đã apply và đối chiếu rows/XPath; bước phát hành Desktop chưa thực hiện. Desktop mới từ chối chạy native nếu workflow chưa có `groupPostShareWorkflowVersion: 1`. Desktop cũ không tự bật cờ mới.
- Hoàn nguyên: dừng các chiến dịch native trước, dùng `migrations/snapshots/facebook-native-group-share/rollback.sql`. Script có guard cả hai workflow, giữ block/element bổ sung để không phá tham chiếu lịch sử. Không tự hoàn nguyên khi có patch mới khác candidate.

MD5 live trước apply (toàn row trừ timestamps): workflow 1 `b14ee0e3e68f4fb0c10536d6bb3534c5`, workflow 252 `635995d256f019df7081dff6631b4602`. Guard SQL dùng so JSONB trực tiếp thay vì phụ thuộc thứ tự JSON khi hash trong Node.

## Kiểm chứng local

- `node scripts/facebook-native-group-share-smoke.cjs`: **72 ca đạt** — migration apply/idempotent/drift/rollback, giữ block/element chung, DAG thật hai workflow, bật/tắt và Page identity, URL, scheduler/rotation/note, policy/quota/streak, báo cáo, chặn retry khi kết quả không chắc chắn.
- `env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/facebook-native-group-share-dom-smoke.cjs`: 18 fixture DOM/XPath thật và 7 ca input React qua `PageController` thật; chọn đúng UID giữa tên trùng, data không có tên, rỗng/timeout, kết quả chậm/mốc 10 giây, caption, submit/hủy. Toàn bộ là HTML local.
- `node scripts/run-campaign-schedule-ai-ui-smoke.cjs --native-group-share-only`: form React thật, lưu/mở lại, URL sai, caption, nháp, media/phông nền và snapshot/nháp riêng; IPC giả lập, chặn HTTP.
- Hồi quy: 25 ca mixed action output, 7 ca kết quả đăng nhóm cũ, vòng quay nội dung Page và chuẩn bị nội dung/AI/media.
- `npx tsc --noEmit -p tsconfig.node.json`, `npx tsc --noEmit -p tsconfig.web.json` và `npm run build`: **đạt**. Build có cảnh báo mixed static/dynamic import hiện có, không có lỗi. Chưa có kiểm chứng đăng bài thật trên Facebook hoặc phát hành Desktop.

## Sửa nhập ô tìm nhóm theo tính năng kiêm chia sẻ — 23/10/2026

Người dùng đã thử đoạn JavaScript tương đương `page.fill()` trên Facebook và xác nhận tên hiện trong ô nhưng tìm kiếm không hoạt động. Finding số 1 ban đầu chỉ có fixture React nên đã được rút; kết quả thử thực tế này bổ sung bằng chứng trước khi sửa.

Đọc lại block live `fb_select_group_post_share_targets` **2794**, MD5 code `ba3dde28271aa8c9cff3528f3591efe0`, và element `SearchAddGroupToPostInp` **1729**. Source trùng snapshot đã lưu. Block có sẵn `rawClear()`/`rawType()` dùng setter của prototype và `InputEvent`; copy nguyên hai hàm đó vào `fb_select_native_share_group`, thay lời gọi `page.fill()` cho ô tìm nhóm. Giữ scope dialog/XPath mới đã khảo sát, khối tìm kết quả/submit và `PageController` dùng chung. Lỗi xóa/nhập vẫn là lỗi thao tác, không phải Bỏ qua.

| C# step | Workflow sau sửa | Khác DOM không | Lý do |
|---|---|---|---|
| `SendKeys(Control+A+Delete)` | `rawClear()` từ block 2794, chờ `stepMs + 500` | Cách nhập Electron hiện có | Dùng lại phép xóa đã có trong kiêm chia sẻ group |
| `SendKeys(groupName)` | `rawType()` từ block 2794 | Cách nhập Electron hiện có | Gọi native prototype setter rồi phát `InputEvent`, tránh setter giá trị do React theo dõi |
| Chờ kết quả | Giữ `stepMs + 2000` và vòng chờ của luồng native hiện tại | Giữ khác biệt luồng đã khảo sát | Lượt sửa này chỉ xử lý thao tác nhập, chưa thay cách kết luận kết quả |

Smoke DOM không còn tự đổ danh sách trong mock `fill()`: fixture chỉ cập nhật kết quả từ sự kiện input. Bảy ca React chạy `PageController.evaluate/fill` thật: tái hiện cách nhập cũ, đối chiếu helper kiêm chia sẻ, tìm từ ô trống/ô có chữ cũ, kết quả rỗng, hủy sau xóa và hủy sau nhập. Candidate được sinh lại; chưa apply DB, chưa kiểm chứng bản sửa trên Facebook thật hay đăng bài.

Kiểm chứng lượt sửa: 72 ca candidate/runtime, 13 fixture DOM, 7 ca React và cả hai typecheck đều đạt. Hai helper khớp nguyên văn source live; candidate/rollback trên đĩa khớp generator, `git diff --check` sạch.

Lượt sửa nhập ô ở trên chưa xử lý ba điểm còn lại; kết quả xử lý tiếp được ghi bên dưới.

## Sửa ba điểm review còn lại — 23/10/2026

- **#2 — chờ tìm nhóm:** kiểm tra Facebook thật chỉ thấy vùng kết quả trống khi đổi query rồi hiện danh sách/thông báo rỗng; chưa có tín hiệu tải riêng đáng tin và chưa tái hiện danh sách cũ đứng yên. Người dùng chốt chờ đủ 10 giây. Bỏ điều kiện hai snapshot giống nhau; kiểm tra mỗi 500 ms, tìm đúng UID/slug thì chọn, chưa có đích thì chỉ kết luận sau đủ 10 giây tính từ lúc nhập. Không thêm XPath/loading heuristic. Kết quả đúng ở mốc 10 giây vẫn được chọn; vùng trống hoặc query sai giữ lỗi thật.
- **#3 — cờ định dạng:** native share đi qua phần chuẩn bị/lưu cấu hình nội dung hiện có thay vì nhận override `formattedContentEnabled=false` của chế độ copy nguồn. Giữ HTML cùng cờ định dạng cho cả Cơ bản và Nâng cao, kể cả lưu/mở lại rồi chuyển về đăng thường.
- **#4 — lựa chọn nguồn:** lưu theo `advancedContentSourceMode`/pending group hiện tại. Chỉ giữ nguyên payload snapshot gốc khi vẫn đang dùng chính snapshot đó; chọn Cơ bản/Nâng cao trước khi bật chia sẻ thì lưu nháp thủ công và bỏ metadata snapshot cũ. Snapshot không thay đổi vẫn được giữ nguyên, nháp thủ công vẫn tách riêng.

Đọc lại live trước sửa: workflow 1/252 và helper block 2794 giữ checksum đã ghi phía trên; `fb_select_native_share_group` chưa có trong production. Candidate/rollback được sinh lại từ cùng snapshot, chưa apply DB.

Kiểm chứng: 72 ca candidate/runtime, 18 fixture DOM + 7 ca React, form React thật cho hai chế độ rich text và hai cách chuyển từ nhóm mẫu sang thủ công rồi quay về đăng thường; hồi quy chuẩn bị nội dung, vòng quay Page và 7 ca kết quả đăng nhóm cũ đạt. Hai typecheck và production build đạt (chỉ cảnh báo mixed import hiện có); candidate/rollback khớp generator, helper nhập khớp nguyên văn block cũ, `git diff --check` sạch. Không đăng bài Facebook thật trong kiểm thử.
