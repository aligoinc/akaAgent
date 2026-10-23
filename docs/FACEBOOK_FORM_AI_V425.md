# AI điền form Facebook — V425

## Phạm vi

Desktop có sáu cấu hình mới, model Sol 6.1 (`ai_model.id=21`):

| Section | Slot | Config ID |
|---|---|---|
| Cài đặt chung | `campaign.facebook.general` | 14 |
| Cấu hình tìm kiếm + Điều kiện chạy | `campaign.facebook.search` | 15 |
| Danh sách từ khóa | `campaign.facebook.keywords` | 16 |
| Điều kiện tìm kiếm bài post | `campaign.facebook.post_search` | 17 |
| Lướt newsfeed | `campaign.facebook.newsfeed` | 18 |
| Kiêm comment | `campaign.facebook.group_comment` | 19 |

Giữ hai section tìm kiếm trên UI, đặt Điều kiện chạy ngay dưới Cấu hình tìm kiếm ở cả nội dung và sidebar. Một nút AI trên tiêu đề Cấu hình tìm kiếm điền cả hai. Danh sách từ khóa dùng AI riêng, chỉ hiện khi danh sách được sửa (không hiện ở sửa chiến dịch đã lưu/nguồn nhóm data). Mặc định bổ sung từ khóa, giữ từ khóa cũ; thay thế/xóa theo yêu cầu rõ.

Giữ nguyên Nội dung, Lịch chạy, Giới hạn hành động và Loại trừ. Không làm Kiêm up tin, các section đơn giản, nhóm data/Xử lý data tìm được, Tin nhắn chờ chưa có runtime. Web/Mobile bindings NULL. Không đổi runtime Facebook, media, quota, lịch hay tự lưu/chạy chiến dịch.

## Hợp đồng

- `campaignFacebookAi.ts`: sáu kind cố định, allowlist trường/action, schema nullable (`null` = giữ nguyên), parser kiểm tra kiểu/giới hạn/quan hệ nguồn–mục tiêu và trường đang khóa. Không nhận schema/prompt/model từ renderer.
- `campaignFacebookAiService.ts`: lấy config và model đang bật từ DB, kiểm tra scope/khả năng dùng loại chiến dịch. Dùng Structured Outputs hiện có và parser trước khi trả patch. `ai_log.form_config_id` theo config tương ứng.
- Main chỉ đọc tên/ID tài khoản được cấp cho staff/tổ chức/nền tảng, giao với danh sách selectable của form. Page đọc từ danh mục đã lưu theo account/staff; không gọi Facebook/Load Page, không gửi cookie/key/session vào prompt. Page phải thuộc đúng một tài khoản đã chọn. Tên Page trong patch do Main lấy từ catalog.
- Danh mục tối đa 500 tài khoản và 500 Page mỗi yêu cầu; vượt giới hạn từ chối toàn bộ, không chọn trên danh sách bị cắt. Các điều kiện thông thường không tải catalog tài khoản/Page. Tái dùng Supabase HTTP singleton; không thêm pool, connection, polling, RPC hay query snapshot ngày/trạng thái.
- Các mục tiêu tìm kiếm đang sở hữu liên kết nhóm data/chiến dịch khác bị khóa với AI. Không xóa liên kết khi đổi trường. Loại search và loại trong group có allowlist khác nhau; bộ lọc chỉ điền khi nguồn tương ứng có hiệu lực.
- Dùng controller IPC chung: một flight cho mọi section, deadline 120 giây, hủy đúng channel/request/credential. Renderer snapshot kind/action/current/locks/accounts và phiên form để bỏ kết quả cũ. Các AI khác và Lưu bị khóa trong lúc chạy; kết quả lỗi không sửa form.
- Chọn tài khoản và Page cùng lúc được áp dụng atomic; hiệu ứng đổi tài khoản thủ công vẫn xóa Page cũ. AI sửa tên dùng cùng marker chống ghi đè bởi gợi ý tên nền. Nhóm data khóa phần đổi account. Chỉ snapshot các trường được phép; dữ liệu nháp không hợp lệ bị từ chối thay vì bị bỏ khỏi ngữ cảnh.

## Migration và production

Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq**, ngày 23/10/2026, history **`20261023150638 / migration_v425_facebook_form_ai`**. Canonical: `migrations/migration_v425_facebook_form_ai.sql`, tạo ban đầu bằng Supabase CLI rồi chuyển sang quy ước V425. **Không apply lại.**

Chỉ INSERT sáu dòng config. Không đổi schema/RLS/RPC hoặc reload PostgREST. Transaction ghi config cùng history hiện có, không tạo DDL phụ. Guard model 21 và checksum bốn config cũ, chặn trùng slot/code. Sáu config mới ID 14–19; khoảng ID trước đó do smoke transaction rollback của identity sequence.

Checksum toàn bộ hàng cũ trước/sau giữ nguyên:

| Code | MD5 |
|---|---|
| `app_campaign_action_limits` | `243aa41a6f4111f6ffaa69392be2dbb4` |
| `app_campaign_schedule` | `8d5756e1b68cf0ad5aad3c5c3a2fa7e6` |
| `app_campaign_content` | `6dd75fc8e4cd95821602d3088397fb43` |
| `app_campaign_send_exclusions` | `cf5c07d8f50596be2db9c26b193bec63` |

Nội dung tiếp tục Haiku 24. Cấu hình mới chỉ xuất hiện trong Desktop có code mới; bản cũ bỏ qua slot chưa biết. Restart Main/preload và mở lại form khi chạy dev. Chưa đóng gói/phát hành.

Audit: `migrations/snapshots/facebook-form-ai-v425/{configs.json,apply-audit.json,db-parity.json,provider-smoke.json}`. Generator là công cụ dựng candidate, không phải công cụ apply lại migration đã live.

## Kiểm chứng

- 93 ca contract/schema: allowlist, scope, request, tài khoản/Page sở hữu, trường khóa, min/max, mục tiêu/nguồn, từ khóa, nullable array/schema sai.
- Service qua runtime thật với DB/provider fixtures: sáu section, schema từ DB, catalog tenant, prompt/template chính xác, scope/config/model tắt, quyền tính năng, model tương thích khác, hủy trước/trong fetch và `form_config_id`.
- IPC thật với I/O giả: main frame, scope sai, cross-section single flight, cancel khác channel không hủy, deadline, đổi credentials.
- Electron form thật với IPC fixtures: sáu nút AI, vị trí/section tìm kiếm, từ khóa, chọn account + Page một lượt, giữ nội dung/media qua Lưu nháp, cancel, timeout, đổi form, không tự ghi campaign. Hồi quy AI Nội dung/biến thể/email/media, V416 parity, Lịch/Giới hạn/Loại trừ đều đạt.
- **6/6 ca Sol 6.1 thật** qua service/runtime với catalog nhân tạo (không dùng dữ liệu khách hàng, không ghi campaign/log production trong smoke). Receipt lưu patch đã qua parser; đây không phải kiểm thử chạy chiến dịch Facebook thật.
- SQL pre-apply trong transaction rồi rollback tạo đủ sáu cấu hình; drift checksum cố ý bị từ chối. Sau apply đối chiếu nguyên văn prompt/template, cấu trúc schema, scope/model/binding. Diễn tập rollback tắt sáu dòng dưới role anon chỉ thấy bốn config cũ; rollback transaction khôi phục sáu dòng mới.
- Hai typecheck và production build Desktop đạt. Có các cảnh báo dynamic/static import đã có từ trước.

Commands:

```sh
node scripts/campaign-facebook-ai-smoke.cjs
node scripts/campaign-facebook-ai-service-smoke.cjs
node scripts/campaign-schedule-ai-smoke.cjs
node scripts/ai-form-configs-smoke.cjs
node scripts/campaign-content-ai-smoke.cjs
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --facebook-only
node scripts/run-campaign-schedule-ai-ui-smoke.cjs --content-only
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

## Rollback

`migrations/snapshots/facebook-form-ai-v425/rollback.sql` là snapshot rollback trước V426; checksum sẽ dừng sau khi prompt đã cập nhật. Trạng thái hiện tại dùng `migrations/snapshots/facebook-form-ai-v428/disable-ai.sql` để tắt cả sáu cấu hình, hoặc `v428/rollback.sql` để chỉ khôi phục prompt Cài đặt chung về V427. Sau đó có thể lần lượt dùng `v427/rollback.sql` và `v426/rollback.sql` để khôi phục prompt về các phiên bản trước. Các script kiểm tra toàn bộ giá trị cấu hình trước khi ghi, không xóa config/history/log. Đã diễn tập trong transaction rồi ROLLBACK, chưa tắt cấu hình production.

## Sửa hai finding review — V426, 23/10/2026

1. Form sửa chiến dịch đã lưu hoặc có tài khoản phụ chỉ cho chọn một tài khoản chính, dù catalog loại chiến dịch cho nhiều tài khoản. Renderer gửi `singleAccountOnly` trong snapshot; Main giao giới hạn này với `allow_multiple_accounts` từ DB và đưa kết quả vào catalog cho AI. Parser kiểm tra lại, từ chối toàn bộ patch nhiều tài khoản; không để UI âm thầm cắt danh sách hoặc xóa tài khoản phụ. Giới hạn Page được kiểm tra theo cấu hình sau sửa, nên form mới vẫn chuyển từ Page sang cá nhân và chọn nhiều tài khoản trong một yêu cầu hợp lệ. Renderer không thể dùng cờ mới để nới giới hạn DB.
2. Nguồn Những người tương tác mới dùng được số lượng/sắp xếp comment nhưng không dùng bộ lọc nội dung comment. Parser tách hai điều kiện; lọc từ khóa hoặc AI chỉ hợp lệ khi `isFindInComment=true`. Prompt trả `unsupported` cho yêu cầu lọc nội dung trên nguồn tương tác mới, không tự bật Comment để mở rộng đối tượng. Khi người dùng yêu cầu rõ lấy thêm nguồn Comment, AI được bật nguồn và bộ lọc cùng lúc. Kết quả lỗi giữ nguyên toàn bộ form.

Đã apply **`20261023153444 / migration_v426_facebook_form_ai_review_guards`** trên akachat. Chỉ sửa `prompt_system` config 14 và 15; checksum tám dòng khác giữ nguyên. Model 21, JSON Schema, template, scope, bindings và tùy chọn gọi AI không đổi. V425/snapshot/generator giữ nguyên lịch sử; snapshot `facebook-form-ai-v426/prompt-overrides.json` chứa đúng hai prompt hiện hành. Không apply lại V425/V426.

Kiểm chứng: 111 ca contract/schema; service/parser thật chặn output sai và trường hợp renderer cho nhiều nhưng DB chỉ cho một; Electron giữ nguyên form khi kết quả sai, giữ tài khoản phụ, cho phép chuyển Page sang nhiều tài khoản cá nhân, từ chối hai loại lọc comment ẩn và chấp nhận nguồn Comment được bật rõ. **6/6 ca Sol 6.1 thật** đạt với catalog nhân tạo: từ chối nhiều tài khoản/đổi một tài khoản, từ chối lọc từ khóa/ngữ nghĩa trên tương tác mới, chấp nhận số comment và nguồn Comment rõ ràng. Receipt tại `facebook-form-ai-v426/provider-smoke.json`.

SQL đã diễn tập apply/rollback, cố ý sai checksum bị từ chối; sau apply so prompt nguyên văn và checksum phần còn lại đạt. Tắt sáu config được diễn tập rồi ROLLBACK. Hồi quy IPC/Lịch/Giới hạn/Loại trừ, V416 parity, Nội dung service/Electron, hai typecheck và production build đạt. Không thêm RPC/query snapshot tài khoản/polling/connection. Chưa đóng gói/phát hành; chạy dev cần restart Main/preload.

## Giữ tài khoản phụ khi AI đổi tài khoản chính — V427, 23/10/2026

Finding tiếp theo: chỉ gửi cờ một tài khoản chưa đủ. Khi tài khoản chính A/phụ B và AI chọn B làm chính, parser trước đây chấp nhận rồi effect của form tự xóa B khỏi tài khoản phụ.

Snapshot nay gửi `secondaryAccountId` (ID nguyên dương hoặc NULL), đồng thời dùng nó để vô hiệu hóa phản hồi cũ. Main loại tài khoản phụ khỏi danh mục tài khoản chính/Page có thể chọn; tên/ID tài khoản phụ chỉ được đưa vào `catalog.secondaryAccount` nếu nằm trong kết quả đọc được cấp quyền hiện có. Không thêm truy vấn; không lộ tên tài khoản khác tổ chức. Cờ từ renderer không thể nới giới hạn một tài khoản khi đã có tài khoản phụ. Parser từ chối toàn bộ patch trùng chính/phụ và trả thông báo hướng dẫn đổi/bỏ tài khoản phụ trước; không áp dụng riêng tên hoặc bất kỳ trường nào của patch lỗi. Đổi sang tài khoản chính khác vẫn giữ tài khoản phụ qua Lưu nháp.

Sol thật với prompt V426 đã từ chối chọn trùng nhưng hướng dẫn tải danh mục không chính xác. V427 bổ sung đúng quy tắc tham chiếu tài khoản phụ vào prompt Cài đặt chung, không viết lại phần còn lại. Đã apply **`20261023155134 / migration_v427_facebook_ai_secondary_account_guard`** trên akachat: chỉ `prompt_system` config 14; model 21, schema, options, binding/scope và chín config khác giữ checksum. Không apply lại V425/V426/V427.

Kiểm chứng: 127 contract/schema; service chặn chọn trùng kể cả kèm sửa tên, catalog loại đúng tài khoản/Page, không lộ tên ngoài quyền và số truy vấn giữ nguyên. Electron dùng parser thật: patch lỗi giữ nguyên chính A/phụ B qua Lưu nháp; đổi chính sang C vẫn giữ B. Hồi quy hai finding trước và IPC đạt; hai typecheck, production build đạt. **2/2 Sol 6.1 thật** với catalog nhân tạo đạt: thông báo trùng chính/phụ đúng và chọn tài khoản khác. Không ghi campaign/log production trong smoke.

Audit/checksum, prompt override, receipt Sol và rollback nằm trong `migrations/snapshots/facebook-form-ai-v427/`. Đã diễn tập apply/khôi phục, checksum lệch bị chặn, so nguyên văn prompt và checksum sau apply; tắt sáu cấu hình chỉ diễn tập rồi ROLLBACK. Chưa đóng gói/phát hành; bản sửa code cần restart Main/preload khi test dev.

## Giữ tài khoản phụ khi AI chọn Page — V428, 23/10/2026

Finding: Page thuộc tài khoản chính khác tài khoản phụ vẫn qua parser; nhánh apply AI bật Page sau đó tự xóa tài khoản phụ. Parser nay từ chối toàn bộ patch thay đổi account/Page nếu kết quả chạy bằng Page mà form còn tài khoản phụ. Thông báo yêu cầu bỏ tài khoản phụ trên form trước; cả tên và tài khoản chính đi kèm đều không được áp dụng. Bỏ thao tác tự xóa phụ khỏi nhánh apply AI. Luồng bật Page thủ công giữ nguyên.

Main thêm `catalog.hasSecondaryAccount` từ snapshot để prompt hiểu cả trường hợp ID phụ không còn trong catalog được phép; không gửi tên ngoài quyền và không thêm query. Prompt chỉ hướng dẫn bỏ tài khoản phụ thủ công, kể cả khi người dùng yêu cầu AI tự bỏ phụ để chọn Page. Sau khi người dùng bỏ phụ trên form, snapshot mới cho phép chọn Page hợp lệ. Sửa tên đơn thuần hoặc chuyển về tài khoản cá nhân không làm mất tài khoản phụ.

Đã apply **`20261023160213 / migration_v428_facebook_ai_page_secondary_guard`** trên akachat, chỉ bổ sung `prompt_system` config 14. Model Sol 21, schema, template, scope/options và chín config khác giữ checksum. Không thêm RPC/polling/connection, không apply lại V425–V428. Audit, prompt override và guarded rollback trong `migrations/snapshots/facebook-form-ai-v428/`.

Kiểm chứng: **155 contract/schema**; service kiểm tra output Page sai bị từ chối atomic, cả khi tên tài khoản phụ không được phép đọc. Electron dùng parser thật: yêu cầu chọn Page trên tài khoản chính khác giữ nguyên form và nháp, bỏ phụ thủ công rồi AI chọn Page được lưu nháp đúng. **3/3 Sol 6.1 thật** với catalog nhân tạo đạt: từ chối Page khi còn phụ, từ chối yêu cầu AI bỏ phụ, cho chọn Page sau khi phụ đã được bỏ. Không ghi campaign/log production trong smoke. Hồi quy các finding trước và IPC, hai typecheck, production build đạt; cảnh báo import hiện có giữ nguyên.

Đã diễn tập apply/khôi phục trước apply, cố ý sai checksum bị chặn, đối chiếu nguyên văn prompt và checksum sau apply; rollback prompt và tắt sáu cấu hình sau apply chỉ diễn tập rồi ROLLBACK. Chưa đóng gói/phát hành; restart Main/preload khi chạy dev để nhận bản sửa code.
