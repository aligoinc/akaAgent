# Audit form thêm chiến dịch bằng Agent — local và apply V442

Ngày: 02/11/2026. Base ban đầu `dev_3` / `686af0b638b8b45b7ff236477b47a1b0125da1e9`; trước sửa review đã fast-forward nền tới `4c5081bf` và áp lại toàn bộ thay đổi đang làm, không xung đột. Nhánh `codex/campaign-agent-form`. [Hợp đồng](../../CAMPAIGN_AGENT_FORM.md).

## Bảng thay đổi hạn mức dễ đọc — 02/11/2026

- Tách map hạn mức thành dòng ngày/khoảng thời gian với tên hành động và đơn vị tiếng Việt; chỉ hiện phần thay đổi. Bấm dòng tới đúng thẻ trên form. Nhãn lựa chọn phổ biến được dịch; không dump key của object vào chat.
- Loại `zalo_find_phone_user` khỏi snapshot/allowlist Agent, guard lại ở main và renderer; phản hồi chứa hạn mức ẩn bị từ chối nguyên khối. Không thêm control, đổi quota runtime/default/save, sửa form thường hoặc cấu hình AI/DB.
- Raw before/after và revision giữ nguyên cho Hoàn tác. Nháp cũ không cần migration; format mới áp dụng khi render. Metadata `limitWindows` tùy chọn giữ số phút hiển thị thực tế theo tài khoản cho lượt mới, không ghi đè giá trị raw; lịch sử cũ thiếu metadata dùng giá trị đã lưu.
- PASS smoke Agent (parser, snapshot router/section, forbidden hidden patch, readable rows, inherited/mixed windows, draft validation), full Electron smoke và lượt `--limits-only` bổ sung. Electron dùng component thật với IPC/stores/AI fixture: row click, control value, lưu/mở nháp mới/cũ, undo, từ chối nguyên khối, cửa sổ theo tài khoản; không gọi AI/DB thật. Hai typecheck node/web và production build PASS. Build giữ cảnh báo dynamic/static import sẵn có.
- Source form cũ giữ hash `24ebc9682965d94815845552ee8c4f3cf7c74a105f05cea6563d611ac36bdce3`. Lượt này không apply migration, gọi provider live, tạo/chạy campaign production hoặc phát hành bộ cài.
- Bằng chứng: [UI receipt](readable-limits-verification.json), [screenshot](readable-limits.png), [build](readable-limits-build.txt). Các receipt/screenshot trước đó giữ lịch sử riêng.

## Nguồn và phạm vi

Đã đọc source HTML `Form chiến dịch + Agent chat.dc.html` trong thư mục thiết kế akaAgent (13), đối chiếu form production. Trình xem chặn URL file thiết kế nên không xác nhận render prototype. UI triển khai bằng React/control sẵn có; đã kiểm tra hình thực tế từ Electron harness ở 1500×1000 và 900×800, dark/light. Không dùng ảnh làm UI.

`CampaignFormModal.tsx` SHA-256 trước/sau: `24ebc9682965d94815845552ee8c4f3cf7c74a105f05cea6563d611ac36bdce3`. Thêm thường/sửa/clone vẫn route cũ. Bản Agent tách riêng theo yêu cầu, có chi phí duy trì hai bố cục khi form nghiệp vụ thay đổi.

## Kiểm chứng

- `campaign-agent-smoke.cjs`: request/schema/allowlist; bỏ field ngoài scope; main kiểm tra account/quyền; thứ tự general/options/limits; data có thật đúng loại; dữ liệu thiếu, ID tài nguyên giả và field khóa bị từ chối; section sau hỏi lại không trả patch trước; action selection; clarification/OCR; cancel; draft metadata; undo revision; hash/form routing; schema candidate khớp source.
- `run-campaign-agent-ui-smoke.cjs`: component form thật và IPC/stores giả lập; nhiều section; before/after/highlight; undo; sửa tay rồi sửa về giá trị cũ vẫn conflict; Hỏi Agent theo section; xác nhận/khước từ đổi loại; vòng tiếp theo dùng snapshot mới; undo/rollback cả lượt đổi loại; lỗi mạng/timeout/hủy; close/reopen/auth stale; draft save/reopen/chat/composer; ảnh không tự thêm vào media; giới hạn type/size, missing-device image; hội thoại mới giữ form; Facebook/Zalo QR/Web/Server/Email/SMS/voice; responsive/themes; bấm Lưu gọi đúng createCampaign qua fixture, không lưu chat vào campaign.
- `run-campaign-agent-images-smoke.cjs`: Electron 33.4.11, PNG/JPEG/WebP thật; file 0600; scope org/staff/draft; không trả bytes trong refs; missing files; traversal/type/count/size/corrupt rejected; gỡ ảnh.
- `campaign-schedule-ai-smoke.cjs`: parser và main-frame IPC/deadline/auth/cross-channel mutex cũ; bổ sung Agent + image frame và cancel isolation.
- Smoke AI cũ: `campaign-content-ai-smoke.cjs`, `campaign-exclusion-ai-smoke.cjs`, `campaign-facebook-ai-smoke.cjs`, `campaign-facebook-ai-service-smoke.cjs`, `ai-form-configs-smoke.cjs` đạt. Bao gồm account/Page ownership và 3 subtype Zalo trong dịch vụ general hiện có.
- `run-campaign-schedule-ai-ui-smoke.cjs` đạt với form cũ: lịch, limits, draft/save thật qua fixture, preservation múi giờ, mixed windows, error/cancel/close/auth.
- Hai typecheck node/web và production build đã chạy; kết quả ban đầu xem [verification.json](verification.json), lần sửa review xem [review-fixes-verification.json](review-fixes-verification.json). Build có cảnh báo dynamic/static import chung có sẵn, không lỗi.

Screenshots: [dark](dark-wide.png), [light](light-wide.png), [narrow](light-narrow.png). Dữ liệu/tên tài khoản trong ảnh là fixture.

## Giữ ảnh nháp và toàn bộ OCR ở lượt tiếp nối — 02/11/2026

- Đã fast-forward nền từ `4c5081bf` tới `c40be4b3` (`dev_3`), khôi phục các thay đổi chưa commit không xung đột; giữ thay đổi export nhóm Facebook mới của nền.
- Controller giữ ID ảnh từ nháp đã mở và mọi payload trước khi gọi lưu. Gỡ các ảnh này chỉ đổi composer, không xóa file mà nháp đã lưu/có thể đã lưu còn tham chiếu. Đóng không lưu, lỗi trước commit và mất phản hồi sau commit đều mở lại được ảnh. Lưu thành công ghi nhận ảnh đã gỡ khỏi composer; ảnh mới chưa từng gửi lưu vẫn được xóa file ngay khi gỡ. Các file được giữ lại chưa có tác vụ dọn tự động như ảnh lịch sử hiện hành.
- Bỏ cắt history ở 8.000 ký tự. Shared constants đồng bộ giới hạn message 16.000, OCR 16.000 và history entry 32.001 (hai phần cộng một dấu xuống dòng); main vẫn giữ tối đa 20 entry và tổng request 1.500.000 ký tự. OCR vượt giới hạn bị từ chối trong response/draft validation, không cắt âm thầm.
- Smoke dịch vụ đạt các biên OCR/history/draft và toàn bộ ca cũ. Smoke Electron đạt đóng không lưu, lưu lỗi trước commit, mất phản hồi sau commit, lưu thành công sau gỡ và xóa ảnh mới; OCR 16.000 ký tự cộng câu làm rõ 2.000 ký tự đi nguyên vẹn qua lưu/mở nháp, request tiếp theo và validator main thật. Fixture không gọi DB/provider production.
- Hai typecheck và production build đạt; form cũ và V442 giữ nguyên SHA-256. Không apply DB, phát hành hoặc restart app người dùng trong lượt này. Receipt: [draft-image-ocr-verification.json](draft-image-ocr-verification.json); build: [draft-image-ocr-build.txt](draft-image-ocr-build.txt).

## Sửa ba lỗi ảnh sau review — 02/11/2026

- `callAiUsing` có option nội bộ main `imageInput.maxImages`; Agent bật 5 sau validator ảnh. Responses/chat/custom/native Claude đều nhận đủ 5 ảnh theo thứ tự, kể cả request chỉ có prompt không có mảng messages. Caller cũ giữ body/giới hạn ảnh; không thay key, endpoint, timeout, proxy hay cấu hình DB. Native Claude dùng image content block theo [Vision](https://platform.claude.com/docs/en/build-with-claude/vision).
- Router giữ `extractedText` đã kiểm tra trong phản hồi section hỏi lại/không hỗ trợ và các nhánh kiểm tra phụ thuộc; vẫn không trả patch dở dang. Smoke dịch vụ kiểm tra General hỏi tài khoản và Data hỏi nhóm sau section khác đã chạy. Electron kiểm tra đính kèm → hỏi lại → lưu/mở nháp → trả lời; request tiếp theo không có ảnh mới nhưng có nội dung ảnh trong lịch sử.
- Nút gỡ ảnh/hội thoại mới và guard controller cùng kiểm tra trạng thái khóa form. Electron giữ request lưu nháp pending, kiểm tra không gọi xóa file, rồi hoàn tất và mở lại đúng ảnh; gỡ ảnh khi hết khóa vẫn hoạt động. `addImages` cũng kiểm tra khóa khi callback chọn file trả về.
- Đã đạt: smoke Agent dịch vụ, toàn bộ smoke form Electron, 16 HTTP parity cũ và 8 ca năm ảnh qua HTTP proxy local/provider giả, smoke cấu hình AI V416, hai typecheck và production build. HTTP probe kiểm cả thứ tự ảnh và base64 không lọt AI log. React checklist không cần đổi cấu trúc hook/layout; callback dùng state hiện tại và functional setter. Build chỉ có cảnh báo import chung hiện hành.
- `CampaignFormModal.tsx` và V442 giữ nguyên SHA-256 nêu trong receipt. Không apply DB, gọi provider thật, restart app người dùng hoặc phát hành trong lượt sửa. Kết quả transport giả lập không chứng minh chất lượng OCR/provider production.
- Receipt: [image-review-verification.json](image-review-verification.json); build: [image-review-build.txt](image-review-build.txt). Runner làm mới screenshot fixture, không đổi width 90%/sidebar 260px/theme.

## Sửa sau review — 02/11/2026

- Nhóm loại trừ đi cùng ID tài khoản đã xác minh ở main sau General. Smoke dịch vụ kiểm tra context/response tài khoản B; Electron đổi A→B rồi soạn nhóm trong cùng lượt, xác nhận chỉ bấm **Lưu nhóm** mới ghi và payload dùng B.
- Bắt đầu Agent vô hiệu hóa request đặt tên cũ ngay; effect theo dõi busy để dừng debounce. Electron kiểm tra cả request đã chạy trả muộn và timer chưa chạy, lịch/tên do Agent điền không bị đổi revision ngoài ý muốn.
- Snapshot bổ sung tag nguồn đã chọn; main xác minh theo tài khoản, prompt nhận lựa chọn hiện tại và phân biệt append/remove/replace. Smoke kiểm tra giữ tag cũ, bỏ một tag, thay/xóa toàn bộ, tag trùng, ID tài khoản khác, lựa chọn đã bị xóa và đổi tài khoản. Electron kiểm tra nháp không có chat vẫn gửi lựa chọn cũ, lưu/mở lại/hoàn tác bảo toàn danh sách.
- Đã sinh lại V442 candidate/schema/prompt/guarded rollback tại local; capture/checksum của 10 config cũ giữ nguyên. Không truy cập DB trong lượt sửa này.
- Kết quả kiểm chứng bổ sung: [review-fixes-verification.json](review-fixes-verification.json). Receipt [verification.json](verification.json) giữ kết quả của lần triển khai đầu; build.txt/screenshots được làm mới bởi lần kiểm thử sau review.

## Sửa hai lỗi bất đồng bộ sau review tiếp theo — 02/11/2026

- `useCampaignAgent` kiểm tra epoch/mounted sau lần chờ ổn định, trước vòng IPC và trước khi tạo lịch sử thành công. Electron tái hiện hủy ở timer cuối trước IPC, sau khi áp dụng tên/lịch và sau khi chọn loại mới: không gửi vòng tiếp theo, khôi phục dữ liệu trước lượt, báo đã dừng và không tạo lịch sử thay đổi. Deadline ở timer cuối cũng khôi phục đúng.
- Callback `listZaloLabels` đọc tag từ state hiện tại bằng functional setter, kiểm tra effect còn hiệu lực và danh sách tài khoản khớp. Electron mở nháp có tag đã xóa, Agent thay sang VIP trước khi catalog trả về: giữ tag mới, quyền Hoàn tác và dữ liệu lưu nháp. Trả catalog tài khoản cũ sau khi chuyển tài khoản không xóa tag của tài khoản mới.
- Smoke Agent dịch vụ, toàn bộ smoke form Electron, hai typecheck và production build đều đạt. Form cũ, V442 candidate và capture 10 config cũ giữ nguyên checksum. Không truy cập/apply DB, không gọi provider live hoặc phát hành trong lượt này.
- Receipt: [async-review-fixes-verification.json](async-review-fixes-verification.json); log build: [async-review-build.txt](async-review-build.txt). Screenshots được runner làm mới; lượt sửa này không thay layout/CSS. Các receipt trước giữ nguyên lịch sử kiểm chứng.

## Sửa phản hồi nhóm data trả muộn sau Hoàn tác — 02/11/2026

- `hydrateSelectedGroupName` kiểm tra `disposed` ngay sau mỗi lần `await listDataGroups`, trước khi đọc trang và cập nhật tên/metadata nhóm. Phản hồi thuộc lựa chọn cũ bị bỏ khi đổi nhóm, Hoàn tác, bỏ nguồn nhóm hoặc đóng form.
- Smoke Electron dùng component thật và IPC giả lập: chọn A → B → Hoàn tác A, trả request A mới trước và B cũ sau; giao diện, snapshot chat và payload nháp đều giữ A/ID 101. Ca chuyển về danh sách trực tiếp khi còn request tải nhóm cũng giữ ID null/tên rỗng sau phản hồi muộn.
- Smoke Agent, toàn bộ smoke form Electron, hai typecheck và build production local đạt. Form cũ, migration V442 và capture config AI giữ nguyên checksum; không truy cập DB/provider production hoặc phát hành.
- Receipt: [group-hydration-verification.json](group-hydration-verification.json); log build: [group-hydration-build.txt](group-hydration-build.txt). Các receipt trước giữ lịch sử kiểm chứng; runner làm mới screenshots, không thay layout/CSS.

## Sửa metadata nhóm trong lúc chờ tải sau Hoàn tác — 02/11/2026

- Tách metadata đã tải khỏi giá trị nhóm dùng trên form: chỉ lấy metadata khi ID khớp `formData.dataGroupId`. Trong lúc request nhóm A còn chờ sau Hoàn tác/hủy từ B, tên đã khôi phục của A được hiển thị; màu, số lượng và semantic compatibility của B không được sử dụng.
- Smoke Electron giữ cả request B cũ và A mới chưa trả về sau Hoàn tác, kiểm tra giao diện hiển thị A, snapshot chat là A và nút lưu nháp hoạt động. Ca hủy lượt sau khi áp dụng B cũng hiển thị A; bấm Lưu nháp trước khi trả request metadata vẫn lưu A/ID 101. Các ca phản hồi cũ trả cuối và bỏ nguồn nhóm tiếp tục đạt.
- Smoke Agent, toàn bộ smoke form Electron, hai typecheck và build production local đạt. Không thay query, thêm request, đổi DB/migration hoặc sửa form cũ. Receipt: [group-metadata-verification.json](group-metadata-verification.json); log build: [group-metadata-build.txt](group-metadata-build.txt). Chưa kiểm thử provider live hoặc phát hành.

## Apply production và mở app — 02/11/2026

- Theo yêu cầu người dùng, đã apply V442 trên **akachat — `cgjbsmqtfhqvttudyjzq`**, ledger **`20261102093125`**, lúc **16:31:25 VN**. [Receipt đầy đủ](../../../migrations/snapshots/campaign-agent-v442/apply-receipt.json).
- Preflight khớp cả 10 config cũ và model 21 active/global. Transaction trial đã thử insert, kiểm tra payload chính xác, quyền đọc `aka_agent_desktop` và guarded rollback, rồi kết thúc ROLLBACK; DB trở lại 10 row và không có ledger V442.
- Apply dùng transaction DML và ghi SQL nguyên bản vào ledger đang có, tránh DDL phụ/reload PostgREST. Hậu kiểm 12 config, ID mới 22/23 active, payload khớp source; checksum 10 row cũ, owner/ACL/RLS/policies/trigger giữ nguyên. Không đổi RPC hoặc ngân sách connection. SHA-256 SQL: `abf4ea7e87e2c44e53865e4fcb440e827fe2aa8fe5c02da849f0822437d10e51`. Giữ nguyên SQL đã apply; chú thích candidate trong file là lịch sử chuẩn bị.
- Đã chạy `npm run dev` từ worktree `campaign-agent-form/akaAgent`; main/preload build thành công. CUA xác nhận cửa sổ Electron với phiên đăng nhập hiện có, hai nút thêm nằm cạnh nhau và form Agent/chat đang hiển thị. App được giữ chạy để người dùng test. macOS báo không đăng ký được login item, nhưng cửa sổ và form đã mở bình thường. Không tự gửi chat hoặc tạo/chạy chiến dịch.
- Lượt này không sửa source app; hai typecheck/build và smoke gần nhất vẫn ở receipt metadata nhóm phía trên. Các ghi chú chưa apply trong những lượt kiểm chứng trước là lịch sử và được thay thế bởi receipt apply này.

## Sửa chat, form trống và chiều rộng — 02/11/2026

- Tái hiện bằng form Electron thật: không chọn action nhưng snapshot gửi cả Limits/Content, validator main từ chối trước khi gọi AI. Các smoke trước dùng action đã chọn và IPC giả lập nên không phát hiện. Sửa builder chỉ gửi General khi action rỗng; snapshot theo action được dựng lại sau bước router chọn loại. Validator main giữ nguyên.
- Sửa màu bong bóng chat và đường phân cách dùng đúng token theme hiện có; gợi ý wrap, không có thanh cuộn ngang. Form Agent rộng 100% với selector đủ ưu tiên so với CSS form gốc. Lỗi lượt chat không lặp lại ở composer.
- Smoke dịch vụ bổ sung chọn loại từ form trống và giữ chặn context action rỗng sai. Smoke Electron chạy request thật qua validator main, kiểm tra hai vòng từ form trống → Zalo, các trường được điền, lỗi chỉ hiện một lần, tương phản chữ/nền ≥4,5 và chiều rộng ở 900/1500/2200 px. Toàn bộ ca hồi quy cũ, hai typecheck và build production đạt. Form cũ và SQL V442 giữ nguyên SHA-256. [Receipt](ui-empty-form-verification.json), [build](ui-empty-form-build.txt).
- Canary trên app dev đang mở qua proxy/provider live đã nhận câu hỏi chọn tài khoản Zalo từ yêu cầu tạo chiến dịch nhắn tin/kết bạn trên form trống. Không bấm Lưu nháp/Lưu chiến dịch, không chạy campaign. Chỉ xác nhận đường gọi AI và clarification này; không coi là kiểm chứng mọi loại chiến dịch hoặc Windows. App giữ chạy để người dùng tiếp tục test; lịch sử lỗi trước sửa được giữ nguyên.

## Điều chỉnh 90%, sidebar và xác minh tiếng Việt — 02/11/2026

- Theo yêu cầu mới, chiều rộng 90% thay thế yêu cầu 100% ở lượt trước. Bỏ các override sidebar 205/170/190/140px; desktop dùng chung 260px của form thường, giữ bố cục mục lục ngang dưới 760px. Không sửa form thường.
- Câu mất ký tự ở canary trước do công cụ gõ tự động, không phải xử lý tiếng Việt của app. Đã dán nguyên câu có dấu “tôi muốn nhắn tin và kết bạn đến danh sách số điện thoại vào 8h tối nay”, kiểm tra giá trị trước gửi rồi gửi qua app thật: chữ được giữ nguyên và AI trả câu hỏi chọn tài khoản Zalo. Dòng lỗi đầu tiên vẫn là lịch sử trước sửa snapshot form trống. Không bấm Lưu hoặc chạy chiến dịch.
- Smoke Electron kiểm cả nội dung Unicode của request/lịch sử chat và width 90%/sidebar 260px ở 900/1500/2200px; toàn bộ smoke, hai typecheck và build đạt. [Receipt](width90-vietnamese-verification.json), [build](width90-build.txt). Không apply lại V442 hoặc phát hành.

## Sửa nguồn dữ liệu dài từ ảnh/lịch sử tới section Data — 02/11/2026

- Trước sửa, router đọc đủ nội dung nhưng Data chỉ nhận mô tả task tối đa 2.000 ký tự. Main nay truyền riêng mô tả gốc, lịch sử đã validate, OCR hiện tại và các ảnh đã validate của lượt gửi vào lời gọi Data hiện có. Router được hướng dẫn giao task ngắn, chỉ rõ nguồn; Data không phải suy dữ liệu từ bản tóm tắt hoặc mẫu `currentData`.
- Hướng dẫn bổ sung được nối vào prompt đang cấu hình tại main, chỉ cho router/Data; giữ model/schema, prompt các section khác, scope/allowlist/quyền, số lượt gọi và deadline/hủy. Không sửa hoặc apply lại V442.
- Smoke dịch vụ dựng output từ nguồn thực tế mà fixture Data nhận: đủ 120 người trong OCR 4.449 ký tự, đủ 120 người trong lịch sử khi không gửi lại ảnh, đủ 90 người từ mô tả nhập dài hơn 2.000 ký tự. Kiểm tra cả năm ảnh đúng thứ tự, không chuyển nguồn vào Options, Data không sửa Options/bỏ qua quyền data trực tiếp, task dài và scope sai vẫn bị chặn.
- Smoke Electron dùng renderer thật và IPC giả lập: áp dụng 120 dòng → lưu nháp → mở lại → snapshot vẫn đủ 120 dòng và đúng dòng cuối. Toàn bộ ca hồi quy form đạt. HTTP proxy local/provider giả đạt 16 ca cũ và 8 ca năm ảnh; hai typecheck và production build local đạt.
- Form cũ và SQL V442 giữ nguyên checksum. Không truy cập DB/provider production, restart app hoặc phát hành. Những kiểm thử này xác nhận đường truyền dữ liệu/guard/lưu nháp, không chứng minh chất lượng OCR của provider thật. [Receipt](data-source-handoff-verification.json), [build](data-source-handoff-build.txt).

## Chặn thay danh sách khi còn nhóm data chờ thêm — 02/11/2026

- Review đã tái hiện `replace` chỉ thay `details`, còn `directDataGroupSnapshots` được chuyển vào save bundle và có thể thêm người nhận ngoài danh sách mới. Snapshot nay gửi riêng `pendingGroupCount` cho router/Data; không tính các nhóm chờ như các dòng đã tải.
- Main trả `unclear` và hướng dẫn bỏ nhóm trên form rồi gửi lại khi `replace` gặp nhóm chờ/nguồn nhóm khóa. Renderer kiểm tra lại trạng thái thực trước toàn bộ patch. Giữ nguyên dữ liệu và OCR khi chặn lượt nhiều section, không tự bỏ nhóm hoặc chuyển replace thành append. Append vẫn được phép; sau khi người dùng bỏ nhóm bằng control hiện có, replace hoạt động bình thường. Không đổi schema prompt đã live hoặc payload nháp.
- Smoke dịch vụ kiểm tra số nhóm được validate/truyền vào prompt, chặn bằng count và khóa độc lập, không trả patch General trước Data bị chặn, giữ OCR, cho append và cho replace sau khi bỏ nhóm. Smoke Electron kiểm tra cả response thành công không hợp lệ bị renderer chặn, tên/dòng/nhóm giữ nguyên khi lưu/mở nháp, append/Hoàn tác, bỏ nhóm thủ công rồi replace và lưu/mở lại chỉ còn khách mới.
- Smoke dịch vụ, toàn bộ smoke Electron, hai typecheck và production build local đạt. Form cũ và SQL V442 giữ nguyên checksum. Không truy cập DB/provider production, restart app hoặc phát hành. [Receipt](pending-group-replace-verification.json), [build](pending-group-replace-build.txt).

## Giữ kiểm tra nhóm chờ đang ẩn khi đổi nguồn — 02/11/2026

- Nhóm trong `directDataGroupSnapshots` còn được giữ sau khi chọn chế độ `data_group`. Sửa snapshot đếm toàn bộ mảng này, không phụ thuộc nhóm đang hiển thị hay chế độ hiện tại. Ghi chú này bổ sung nhánh chuyển chế độ còn thiếu trong lần sửa trước.
- Main và renderer chặn `replace` với nhóm chờ, đồng thời chặn mọi Data patch đưa nguồn `data_group` về `direct` bằng thêm dòng hoặc `directSource` khi còn nhóm ẩn. Không áp dụng một phần lượt nhiều section; nhóm/dòng/tên/chế độ trước lượt vẫn giữ nguyên. Thông báo chỉ người dùng tới “Thêm trực tiếp” để kiểm tra/bỏ nhóm, không tự xóa nguồn. Append khi đã ở direct và đổi giữa các nhóm chạy tiếp tục hoạt động.
- Smoke dịch vụ kiểm tra đủ ba đường replace/append/directSource khi có nhóm ẩn, OCR và tính nguyên khối; cùng các đường đó khi không còn nhóm chờ và đổi nhóm chạy. Smoke Electron chuyển chế độ bằng control thật, kiểm tra cả ba phản hồi bị chặn trước khi đổi tên/nguồn, lưu/mở lại vẫn giữ đúng nhóm/dòng/chế độ; bỏ nhóm thủ công rồi replace, Hoàn tác chuyển nguồn và lưu/mở lại chỉ còn danh sách mới. Ở cửa sổ hẹp, runner thu gọn chat trước khi bấm control bị panel che rồi mở chat lại.
- Smoke dịch vụ, toàn bộ smoke Electron, hai typecheck và build production local đạt. Form cũ và SQL V442 giữ nguyên checksum; không truy cập DB/provider production, restart app hoặc phát hành. [Receipt](hidden-group-source-verification.json), [build](hidden-group-source-build.txt).

## Rà soát tổng thể và sửa trạng thái phụ thuộc giữa các section — 02/11/2026

- Rà lại route form thường/Agent/nháp, main-frame IPC và single-flight, hủy/timeout/phiên cũ, catalog và parser theo quyền, truyền ảnh/proxy/masking, apply nguyên khối, Hoàn tác, CAS nháp, nguồn data và các section phụ thuộc. Không thay query/RPC/quyền, source form thường hoặc SQL V442 đã live.
- Tách `directDataEditable` (khả năng nhập data với khóa cứng) khỏi `directDataAllowed` (điều kiện hiện tại gửi cho model). Data dùng trạng thái Options mới trong cùng lượt: tắt gợi ý Facebook hoặc chuyển Zalo từ tất cả/theo tag về danh sách chọn rồi thêm UID đều được; bật nguồn tự động đồng thời thêm dòng bị hỏi lại, không trả/apply patch một phần. Guard nhóm chờ/nhóm ẩn giữ nguyên.
- Snapshot giữ context của Nội dung có thể chỉnh sau khi bật nhắn tin hoặc bỏ chia sẻ/copy nguồn; nhóm mẫu vẫn khóa. Main kiểm tra sau Options/Extras; renderer dùng đúng chế độ cơ bản/nâng cao và giá trị nguồn hiệu lực của tab, tránh main và form hiểu khác các cờ đang giữ. Nhóm loại trừ dựng context sau chọn tài khoản/bật nhắn tin, hỏi lại khi chưa chọn hoặc có nhiều tài khoản, kể cả tài khoản phụ.
- Chọn nhóm data chuẩn hóa tùy chọn nguồn giống control hiện có, cập nhật context lịch và giữ đầy đủ các thay đổi để Hoàn tác. Yêu cầu đồng thời nguồn tự động và nhóm chạy được hỏi lại. Nháp không lưu snapshot IPC nên không cần migration payload. Prompt bổ sung tại main, không đổi model/schema/config live hoặc thêm lời gọi AI/connection.
- Smoke dịch vụ kiểm tra hai nguồn tự động Zalo, Facebook gợi ý, khóa cứng, yêu cầu mâu thuẫn, Nội dung ẩn và tài khoản đầu tiên cho Loại trừ. Smoke Electron kiểm tra cùng lượt → hoàn tác → lưu/mở nháp, chuyển sang nhóm rồi hoàn tác, nội dung cơ bản/nâng cao khi bỏ chia sẻ/copy, cờ nguồn theo tab và modal loại trừ đúng tài khoản. Ca mới ban đầu thiếu tên nháp và rule loại trừ hợp lệ; đã sửa dữ liệu fixture, giữ nguyên validation nghiệp vụ. Toàn bộ suite cuối cùng đạt.
- Đã đạt smoke Agent, form Electron, lưu/đọc ảnh Electron, schedule/IPC/limits, content, exclusions, Facebook parser/service/quyền, proxy HTTP local, hai typecheck và build production local. Không gọi provider/DB live, tạo/chạy campaign production, restart app hoặc phát hành trong lượt này. [Receipt và checksum](overall-dependencies-verification.json), [build](overall-dependencies-build.txt). Các receipt trước giữ nguyên lịch sử.

## Giữ đúng phạm vi cờ Nội dung khi đổi loại chiến dịch — 02/11/2026

- Review tái hiện Zalo ở chế độ chia sẻ → Email + nội dung mới: main chấp nhận snapshot Email đã loại cờ Zalo, nhưng renderer kiểm tra cả state đang giữ và rollback lượt hợp lệ. Sửa `agentContentEnabled` dùng allowlist `agentExtraFields(actionId)` cho từng cờ nhắn tin/copy/chia sẻ, áp dụng thống nhất ở hai caller hiện có. Không xóa giá trị loại cũ, không nới scope section hoặc quyền.
- Smoke kiểm tra cờ không thuộc Email/SMS/Gọi, Zalo nhắn số điện thoại và Facebook timeline không chặn editor; các cờ nhắn tin tắt hoặc nguồn/chia sẻ có hiệu lực vẫn bị chặn. Smoke Electron đi đủ hai vòng chọn loại/xác nhận/điền trong năm chuyển đổi: Zalo bạn bè → Email, Zalo nhóm → SMS, Zalo bạn bè → Facebook timeline, Facebook chia sẻ nhóm → Email, Facebook copy/chia sẻ → Zalo số điện thoại. Mỗi ca lưu/mở nháp, Hoàn tác về loại cũ rồi kiểm tra nguồn đang có hiệu lực vẫn từ chối patch nội dung và giữ nguyên dữ liệu.
- Đã đạt toàn bộ smoke Agent, toàn bộ smoke form Electron, smoke Content AI, hai typecheck và production build local. Source main service, form Agent và form thường giữ nguyên; chỉ helper shared cùng kiểm thử/tài liệu thay đổi. SQL V442 giữ nguyên checksum; không apply DB, gọi provider live, restart app hoặc phát hành. Nền `dev_3` đã fast-forward tới `37e68ef5` (các cập nhật tài liệu); giữ toàn bộ thay đổi Agent chưa commit.
- [Receipt và checksum](content-action-scope-verification.json), [build](content-action-scope-build.txt). Đây là bổ sung cho receipt rà soát tổng thể trước đó, không sửa lịch sử kiểm chứng cũ.

## Sửa tab nguồn khi đổi giữa các loại đăng Facebook — 02/11/2026

- Review tái hiện cả hai chiều chia sẻ nhóm → đăng tường và chia sẻ tường → đăng nhóm: Extras đã tắt các cờ của loại mới, nhưng `nextContentTab` còn xét cờ chia sẻ của loại cũ. Chat báo đã điền nội dung trong khi payload lưu vẫn bật copy nguồn và bỏ nội dung mới.
- `applyAgentReply` nay lọc các cờ copy/chia sẻ theo `agentExtraFields(next.actionId)` trước khi đồng bộ giá trị hiệu lực và chọn tab. Các cờ không thuộc action hiện tại được giữ nguyên cho Hoàn tác, không dùng để quyết định nguồn. Không thay builder lưu, allowlist, parser, form cũ hoặc SQL V442.
- Smoke Electron bổ sung hai chiều đổi loại qua router/xác nhận, tắt nguồn và viết nội dung trong cùng lượt, kiểm tra snapshot sau áp dụng, lưu/mở nháp và Hoàn tác về đúng tab/cờ/nội dung cũ. Sau mở lại nháp mới, bấm Tạo chiến dịch qua form thật và kiểm tra payload giữ nội dung mới, `copyContentFromSource/sharePost/groupPostShareFromPost=false`. IPC/stores là fixture, không tạo hoặc chạy campaign production. Runner ban đầu dùng nhầm nhãn “Lưu chiến dịch” khi mở nháp; đã đổi selector sang nhãn hiện hành “Tạo chiến dịch”, không sửa control/validation app.
- Các ca mới riêng lẻ, toàn bộ smoke form Electron, smoke Agent, hai typecheck và production build local đã đạt. Source main/shared, form thường và SQL V442 giữ nguyên checksum so với receipt trước. Không gọi provider/DB live, restart app, đóng gói hoặc phát hành. [Receipt và checksum](source-tab-action-scope-verification.json), [build log](source-tab-action-scope-build.txt).

## Tách giới hạn Content AI khỏi các section độc lập — 02/11/2026

- Review tái hiện nháp Facebook có 101 biến thể nâng cao vẫn tạo campaign được nhưng câu hỏi Cài đặt chung chỉ đổi tên bị validator Nội dung chặn. Các giới hạn AI về số biến thể, chiều dài từng nội dung/tiêu đề và tổng JSON nay được dùng chung giữa parser và bước dựng snapshot; giữ nguyên các giá trị và hành vi parser cũ.
- Khi vượt giới hạn, renderer gửi marker `contentUnavailable` cùng action/mode/format thay vì text/list. Không gửi mẫu hoặc cắt mất biến thể; dữ liệu form, nháp và builder lưu giữ nguyên. Main kiểm tra marker fail-closed (đúng reason/context, không kèm content, section Nội dung phải được khai báo), đưa khả năng này vào prompt router hiện có và cho phép task độc lập. Hỏi riêng Nội dung trả thông báo trước khi gọi provider; task Nội dung trong lượt nhiều section từ chối nguyên khối, giữ OCR. Renderer chặn lại trước commit nếu nhận Content patch không hợp lệ. Format được giữ để không bỏ qua guard HTML/nền bài viết.
- Smoke dịch vụ kiểm tra 100/101 biến thể, giới hạn từng text/tiêu đề và tổng JSON, raw input quá lớn vẫn bị parser chặn, marker sai bị từ chối, General/Limits và toàn form độc lập hoạt động, mixed turn không trả patch dở dang, scoped Content không gọi model và HTML vẫn chặn nền bài viết. Smoke Electron bổ sung 101 biến thể, 5 biến thể có tổng hơn 60.000 ký tự và một nội dung cơ bản dài hơn 16.000 ký tự: đổi tên theo scope, đổi lịch toàn form, lưu/mở nháp, Hoàn tác, chặn Content patch cưỡng ép và kiểm tra payload tạo campaign giữ nguyên mọi nội dung/biến thể.
- Runner đầy đủ ban đầu còn giữ cửa sổ hẹp từ ca responsive nên panel chat che nút Hỏi Agent của ca mới. Đã sửa runner thu gọn chat trước khi chọn section, giữ nguyên UI ứng dụng; các ca mới riêng lẻ trước đó đã đạt ở cửa sổ rộng.
- Các ca Electron mới riêng lẻ và toàn bộ smoke form Electron, smoke Agent/Content AI, hai typecheck và production build local đã đạt. Form thường và SQL V442 giữ nguyên checksum. Kiểm thử dùng renderer thật với IPC/store/provider fixture; không gọi provider/DB live, tạo/chạy campaign production, restart app hoặc phát hành. [Receipt và checksum](content-capability-verification.json), [build log](content-capability-build.txt).

## Chưa thực hiện

Chưa kiểm chứng toàn bộ chất lượng provider live cho các lượt điền nhiều section/loại chiến dịch hoặc Windows thật. Canary form trống/clarification đã đạt theo mục trên. Không tạo/chạy campaign production, không deploy API, đóng gói hoặc phát hành Desktop. DB trial/apply đã hoàn tất theo receipt trên; cần hoàn tất canary các luồng còn lại trước phát hành Desktop.

## Vùng nhập liệu rộng bằng form thường — 02/11/2026

- Người dùng xác nhận muốn phần nhập liệu rộng bằng form cũ. CSS Agent kế thừa `90vw/max-width:1200px` và padding 24px; không đổi source/style form thường. Từ 1800px, khung có thêm 420px cho chat; dưới ngưỡng này chat dùng panel chồng, không thu hẹp form. Thu gọn chat giữ nguyên chiều rộng vùng nhập liệu. Đây là quy tắc thay thế bố cục chia đôi trong khung 90% ở audit trước.
- [Số đo Electron](input-width-layout.json) xác nhận phần form bằng CSS form thường ở 900/1500/1799/1800/2200px, cả mở và thu gọn chat. Đã xem giao diện wide có chat và bản hot update trong app đang chạy.
- Hai typecheck, full smoke Electron và diff check đạt. Lượt smoke đầu vướng click nút section bị panel che; runner đã thu gọn chat trước thao tác và lượt đầy đủ sau đó đạt. Kiểm tra ngưỡng wide bật `enableLargerThanScreen` cho cửa sổ fixture vì macOS giới hạn kích thước mặc định. [Receipt](input-width-verification.json).
- App dev giữ chạy cho người dùng test. Không gọi AI live, tạo/chạy campaign production, apply DB hoặc phát hành; không chạy lại production build cho thay đổi CSS này.

## Trả bố cục cạnh nhau, thu gọn panel Agent — 02/11/2026

- Theo yêu cầu mới nhất, bỏ bố cục giữ vùng nhập liệu bằng form thường của lượt trước. Khôi phục modal 90% không giới hạn max-width và breakpoint panel chồng 1150px; chat desktop rộng `clamp(300px,24vw,360px)` thay mức cũ 320–420px. Ở cửa sổ 1500px, form được thêm 60px so với bố cục cạnh nhau ban đầu. Form thường không đổi.
- [Số đo](compact-chat-layout.json) và [receipt](compact-chat-verification.json): smoke giao diện Electron ở 2200/1500/1151/1150/900px, cả hai theme, không tràn ngang chat; mở/thu gọn giữ tên và hội thoại. Hai typecheck, kiểm tra cú pháp runner và diff check đạt. Đã xem hot update trong app thật đang chạy.
- Smoke nghiệp vụ đầy đủ đã pass ở lượt trước; lần CSS này chỉ chạy phần layout liên quan, không chạy lại AI live, production build, apply DB hay phát hành. Audit `input-width-*` là bằng chứng lịch sử của bố cục đã bị thay thế.


## Nhập data local, AI chỉ chọn nơi nhập — 03/11/2026

Hướng dẫn hiện hành: mục này thay thế các đoạn lịch sử về gửi toàn bộ data/OCR/5 ảnh cho router và section Data. Các receipt cũ giữ nguyên như bằng chứng tại thời điểm kiểm chứng, không còn là hợp đồng nhập dữ liệu hiện hành.

- Chat nhận text dán/gõ, Excel/CSV/TXT và ảnh data. Parser tách nguồn khỏi câu chỉ thị; file lưu private theo org/staff/draft UUID. AI chỉ nhận metadata, mode/count/khả năng chỉnh sửa; main loại dòng mẫu, OCR cũ khỏi history và từ chối model sinh rows. Danh sách 10.000 dòng tạo cùng instruction gửi AI như danh sách 120 dòng, không bị cắt mất dữ liệu nguồn.
- Data section trả append/replace để mở Upload hiện có. Kiểm tra/chọn sheet/cột, chuẩn hóa, giữ số 0 đầu/Info, lọc lỗi/trùng và chèn do app thực hiện sau xác nhận của user. Nhiều file duyệt lần lượt; chỉ file đầu replace. Hủy preview, file thiếu trên máy khác và phản hồi đọc đến muộn không thay form. Chat/lưu khóa lúc Upload mở; guard nguồn, nhóm chờ/nhóm ẩn và revision vẫn áp dụng. Dữ liệu chèn qua Upload là chỉnh sửa thủ công, không nằm trong undo của AI.
- OCR dùng worker Tesseract local, tối đa một lượt kể cả giai đoạn cleanup sau hủy/timeout. `vie+eng` model đi kèm dependency, `langPath` local rõ ràng, worker/WASM unpack khỏi ASAR; không cần key/provider và không tải model khi dùng. Kết quả đưa vào Form txt có thể sửa/chọn cột trước kiểm tra. Tab Ảnh ở Upload form Agent dùng cùng callback local, form thường giữ xử lý hiện có.
- Giới hạn 5 file; 10 MB/file Excel/CSV/TXT, 5 MB/ảnh và tổng ảnh 15 MB, tổng file 25 MB. Payload nháp chat chỉ chứa ref; dòng đã xác nhận vẫn nằm trong form/nháp nghiệp vụ. Gỡ file không xóa bytes có thể đang được nháp đã lưu tham chiếu. Chưa có dọn file tự động.
- Dependency cố định: `tesseract.js@7.0.0` và core đi kèm (Apache-2.0), `@tesseract.js-data/eng@1.0.0` + `vie@1.0.0` (MIT theo package metadata). Model trên đĩa khoảng 19 MiB; core WASM khoảng 43 MiB trước nén/đóng gói. Đối chiếu [API](https://github.com/naptha/tesseract.js/blob/master/docs/api.md), [local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md), [tessdata](https://github.com/naptha/tessdata/blob/gh-pages/README.md). Không thêm SQL connection, service hoặc migration.
- Đạt smoke Agent main/schema/catalog, main-frame IPC/auth/timeout/cancel, full Electron form regression, local import (120 dòng, Excel giữ số 0/Info, append/replace/queue, ảnh, nháp, thiếu file, callback OCR thủ công, hủy late read), importer cũ, hai typecheck và production build. Test OCR chạy worker thật cả thư mục thường và ASAR tối thiểu trên macOS arm64, đọc hai SĐT từ PNG và kiểm cleanup/hủy/concurrency. Screenshot đã kiểm tra bố cục Upload.
- App dev đã mở và kiểm bằng CUA thấy nút đính kèm/Dán data trong form Agent mới. Không gửi yêu cầu AI live hoặc lưu/chạy campaign test production. Chưa kiểm bộ cài Windows, OCR ảnh tùy ý hoặc canary prompt điều phối mới bằng provider production. Build local không phải phát hành. Form thường và SQL V442 giữ nguyên checksum; không apply lại DB.
- Nền `dev_3` fast-forward từ `37e68ef5` tới `6b7c75fe` bằng autostash, giữ công việc Agent chưa commit và feature Facebook random AI upstream. `npm install --ignore-scripts` thay symlink node_modules của worktree bằng dependency local; thư mục dependency repo chính giữ nguyên. Đã tải Electron chính thức và rebuild native dependency cho arm64 để chạy kiểm chứng.

[Receipt/checksum/lệnh](local-import-verification.json), [UI receipt](local-data-ui-verification.json), [ảnh Upload](local-data-import.png), [build](local-import-build.txt). Log full Agent UI được chạy trước bổ sung cuối về late-read/giới hạn tổng ảnh; targeted local UI, main/IPC, ASAR, hai typecheck và build được chạy lại trên source cuối. Smoke full UI không thay thế kiểm chứng provider hoặc DB thật.

## Sửa nhận diện nội dung và lỗi khởi tạo OCR — 03/11/2026

- Chỉ tự tách danh sách có cấu trúc hoặc yêu cầu nhập người nhận rõ ràng. SĐT/email trong yêu cầu viết nội dung, đổi tên và phần nội dung sau danh sách người nhận được giữ nguyên; sanitize lặp lại không lấy nhầm hotline sau placeholder. Scope Nội dung giữ nguyên cả một SĐT đơn lẻ và lưu dấu `contentRequest` tùy chọn trong lượt chat để lịch sử tiếp nối vẫn hiểu đúng; nháp cũ tương thích.
- Tesseract 7 có thể không settle `createWorker()` khi loadLanguage/initialize lỗi. Adapter nay giữ native Worker ngay từ lúc tạo, xử lý reject/error/exit/hủy/deadline ở mọi bước và chờ `worker.terminate()` hoàn tất trước khi nhả single-flight. Giữ một worker, timeout 120 giây, model local và che log nhạy cảm. Sau lỗi, lần đọc tiếp theo chuẩn bị lại model từ dependency đi kèm để phục hồi bản cache bị thiếu/hỏng, không tải mạng.
- Smoke main kiểm tra câu có dấu/không dấu, SĐT/email nội dung, câu trộn danh sách với nội dung, sanitizer lặp và lịch sử. Smoke Electron kiểm tra paste/send không tạo file nhầm, scope Nội dung và lịch sử sau bỏ scope, cùng toàn bộ hồi quy form/import/nháp. OCR thật trong ASAR đọc ảnh, thất bại có giới hạn khi model thiếu/hỏng rồi thử lại thành công; worker fixture bao phủ startup reject/error/exit/hang, hủy từng bước và xác nhận native worker đã dừng trước khi trả kết quả.
- Smoke Agent, IPC, OCR ASAR, toàn bộ smoke Electron, hai typecheck và production build local đạt. Nền đã đồng bộ `dev_3` tới `5315d1b7`; source form thường và SQL V442 giữ nguyên checksum. Không gọi provider/DB live, apply migration, đóng gói Windows hoặc phát hành. Chất lượng OCR ảnh tùy ý vẫn cần người dùng kiểm tra trong Upload.

[Receipt/checksum](review-data-ocr-fixes-verification.json), [smoke main](review-data-ocr-fixes-agent.txt), [OCR ASAR](review-data-ocr-fixes-ocr-asar.txt), [Electron](review-data-ocr-fixes-ui.txt), [build](review-data-ocr-fixes-build.txt).

## Sửa ngữ cảnh dán và bảng CSV — 03/11/2026

- Paste xét toàn bộ giá trị sau khi thay vùng chọn bằng clipboard, thay vì chỉ xét phần vừa dán. Câu dẫn, phần đuôi và scope Nội dung được giữ; nhập từng phần không biến hotline/email thành file người nhận. Khi tách data, description thay đúng nội dung còn lại thay vì nối vào cuối câu.
- Nhận diện bảng CSV có header của importer hoặc các hàng có cùng cột người nhận, với dấu phẩy/chấm phẩy, ô có dấu nháy kép/escaped quote/xuống dòng. Chỉ nhận diện ranh giới tại shared parser; giữ nguyên nguồn để workbook importer hiện có chọn cột/kiểm tra. Text CSV tự lưu thành file `.csv` qua cả send/paste/Dán data, giữ tên, số 0 đầu và Info. Câu chỉ thị sau bảng không bị nhập làm hàng data. CSV không xuất hiện trong description/history gửi AI.
- Smoke main bổ sung CSV có/không header, dòng lỗi, câu chỉ thị trước/sau bảng, content scope, quotes, 10.000 dòng và kiểm metadata tại router. Smoke Electron kiểm dán hotline ở cuối câu, thay vùng chọn giữa câu, CSV comma/semicolon → Upload → chèn → lưu/mở nháp → mở lại nguồn, giữ tên/SĐT/Info có xuống dòng, cùng CSV 180 dòng dài hơn 4.000 ký tự không bị cắt.
- Smoke main, toàn bộ smoke Electron, hai typecheck và production build local đạt. Kiểm chứng dùng renderer thật với IPC/store/provider fixture; không gọi provider/DB live, thay form thường, apply V442 hoặc phát hành. Worker OCR không đổi trong lượt này; receipt kiểm chứng worker thật ở mục trước vẫn là bằng chứng riêng.

[Receipt/checksum/lệnh](paste-csv-verification.json), [smoke main](paste-csv-agent.txt), [Electron](paste-csv-ui.txt), [build](paste-csv-build.txt).

## Giữ CSV qua dòng trống và chặn composer quá dài — 03/11/2026

- Khi tìm ranh giới CSV, bỏ qua bản ghi rỗng nhưng giữ span dòng gốc để Upload vẫn nhận đủ nguồn. Header và các dòng có người nhận tiếp tục được nối qua dòng trống/whitespace/ô rỗng; blank line bên trong ô nhiều dòng giữ nguyên. Không đưa phần đuôi CSV vào description/history.
- Paste quá 4.000 ký tự mô tả được giữ trong ô rút gọn riêng, chưa ghi composer hoặc tạo file đính kèm. Dùng mutex form hiện có để khóa Lưu/gửi/chỉnh form trong lúc xử lý; người dùng chọn Bỏ để giữ composer/hội thoại/file cũ hoặc rút gọn và Áp dụng. Áp dụng có guard độ dài độc lập; nhận đúng 4.000 ký tự, lưu/mở nháp vẫn qua isAgentDraft và giữ refs. Không nới schema/validator metadata. Chủ động đóng cả form vẫn bỏ các chỉnh sửa chưa lưu.
- Smoke main bao phủ CSV comma/semicolon, blank sau header/giữa các khách, headerless, whitespace, ô rỗng và blank bên trong quoted field; kiểm đủ nguồn và metadata-only tại router/history. Smoke Electron tái hiện CSV có dòng trống → Upload → chèn đủ hai khách → lưu nháp; paste quá dài → Bỏ giữ state → rút gọn đúng ngưỡng → lưu/mở lại vẫn còn chat và hai file, cùng paste chỉ có mô tả dài. Kiểm tra nút lưu/gửi bị khóa và không tạo file trước Áp dụng; panel hẹp/light không tràn ngang và thao tác xử lý vẫn tới được.
- Smoke main, toàn bộ smoke Electron, hai typecheck và production build local đạt.
- Không sửa form thường, OCR worker/service, dependency hoặc SQL V442. Không gọi provider/DB live, apply migration, đóng gói Windows hay phát hành. Kiểm chứng renderer dùng IPC/stores/provider fixture; ảnh panel là giao diện fixture Electron thật.

[Receipt/checksum/lệnh](paste-guard-verification.json), [smoke main](paste-guard-agent.txt), [Electron](paste-guard-ui.txt), [panel rộng](oversize-paste.png), [panel hẹp](oversize-paste-narrow.png), [build](paste-guard-build.txt).


## Ranh giới CSV: tên khách và câu chỉ thị — 03/11/2026

- Khi nhận diện bảng, bỏ chặn tên theo tiền tố câu lệnh; ưu tiên giá trị ở cột SĐT/UID/email được header xác định hoặc cột người nhận nhất quán ở bảng không header. Tên “Đạt Nguyễn” và ghi chú có từ giống lệnh vẫn thuộc nguồn CSV; Upload quyết định tính hợp lệ. Giữ ranh giới dòng gốc, dấu nháy, cột và dòng trống.
- Khi dòng không có giá trị người nhận ở cột đó, xét từng ô và tiền tố thời gian để tách câu yêu cầu sau bảng. “Vào 20h tối nay, gửi tin và kết bạn” không bị nhập làm khách hàng; các câu đặt số lượng, nội dung và thông tin liên hệ vẫn ở description. Reset ngữ cảnh danh sách sau bảng và khi gặp câu chỉ thị để sanitize lặp ở main/history không lấy hotline làm người nhận.
- Smoke shared/main bao phủ tên ở đầu/giữa bảng, bảng không header, đảo thứ tự cột, comma/semicolon, UID/email, ghi chú giống lệnh, dòng sai dữ liệu hiện có, câu chỉ thị có/không có câu dẫn Nhập danh sách và hotline trong nội dung. Kiểm cả context router/history không chứa người nhận nhưng giữ câu chỉ thị.
- Electron dùng renderer thật với IPC/store/provider fixture: dán nguyên bảng và câu yêu cầu → request giữ câu và chỉ metadata → Upload đủ hai khách → chèn → lưu/mở nháp → giữ tên/SĐT, lịch và kết bạn từ phản hồi fixture, lịch sử vẫn giữ câu ban đầu mà không gửi danh sách. Không coi phản hồi fixture là bằng chứng model production hiểu đúng ý định.
- Smoke main, full Electron regression, hai typecheck và production build local đạt. Full regression chạy trước chỉnh cuối giữ nhận diện lệnh Đặt nói chung; main, targeted local import Electron, hai typecheck và build chạy lại trên source cuối. Không thay component UI trong lượt này.
- Nền dev_3 fast-forward từ 5315d1b7 tới ee8dca61 (chỉ tài liệu upstream), giữ toàn bộ thay đổi Agent chưa commit. Không sửa form thường, OCR/data service, dependency hoặc SQL V442. Không gọi provider/DB live, apply migration, đóng gói Windows hoặc phát hành.

[Receipt/checksum/lệnh](csv-boundary-verification.json), [smoke main](csv-boundary-agent.txt), [Electron](csv-boundary-ui.txt), [build](csv-boundary-build.txt).


## Giữ dữ liệu chờ và phân biệt header với câu đặt tên — 03/11/2026

- Controller giữ text chưa đính kèm ở bộ nhớ local, độc lập payload composer. Guard Lưu/gửi kết hợp trạng thái nguồn chờ với mutex thao tác; lỗi ghi file, giới hạn 5 file hoặc hủy xử lý không mở khóa form khi nguồn chưa được xử lý. Gỡ file/sửa nguồn/retry vẫn hoạt động; bỏ nguồn hoặc đính kèm thành công mới mở khóa. Nháp tiếp tục chỉ giữ refs; không nới schema/giới hạn hoặc đưa raw data vào AI. Nút Bỏ dữ liệu đang chờ xóa rõ nguồn chưa lưu và lỗi tương ứng. Chủ động đóng toàn form vẫn bỏ chỉnh sửa chưa lưu.
- Fallback giữ header nay kiểm từng tên cột đầy đủ bằng importHeaderField, không dùng tiền tố Tên/Email/Phone. Bổ sung nhận diện câu đặt tên/tiêu đề email khi có dấu phân cách. Giữ header hợp lệ, câu chỉ thị trước/sau bảng, hotline nội dung và sanitize lặp trong main/history.
- Main smoke kiểm câu đặt tên, Email subject, dấu phẩy/chấm phẩy và header một cột. Electron fixture tái hiện đủ 5 file → paste thất bại → khóa lưu/gửi → thu gọn/mở lại → bỏ hoặc gỡ file/retry → lưu/mở nháp → Upload nhập đủ hai người nhận. Nhánh lỗi ghi file và Dán data thủ công cũng giữ guard. Câu đặt tên chỉ đi trong description/history, nguồn file chỉ có CSV; phản hồi fixture đổi tên, lưu/mở nháp giữ tên và dữ liệu. Screenshot rộng/dark và hẹp/light kiểm vùng thao tác không tràn ngang, nút vẫn cuộn tới được.
- Smoke main, toàn bộ smoke Electron, hai typecheck và production build local đạt trên source cuối. Đã xem ảnh giao diện rộng/dark và hẹp/light.
- Không sửa form thường, main data/OCR services, dependency hoặc SQL V442. Không gọi provider/DB live, apply migration, đóng gói Windows hoặc phát hành. IPC/store/provider trong smoke là fixture; không coi đó là bằng chứng model production hiểu yêu cầu.

[Receipt/checksum/lệnh](pending-header-verification.json), [smoke main](pending-header-agent.txt), [Electron](pending-header-ui.txt), [panel rộng](pending-data-retry.png), [panel hẹp](pending-data-retry-narrow.png), [build](pending-header-build.txt).


## Giữ ô nhiều dòng khi dán bảng Excel (TSV) — 03/11/2026

- Tái hiện trước sửa: bảng hai khách, Info1 của An chứa `Ghi chú\nkhách VIP`; splitter đưa phần `khách VIP` vào mô tả và bỏ dấu nháy đóng khỏi file, khiến importer nuốt hàng Bình vào ghi chú. Smoke bổ sung thất bại trên source cũ đúng ca này.
- Dùng scanner bản ghi có dấu nháy chung cho CSV/TSV, giữ nguyên span các dòng khi tách nguồn. Bảng tab được nhận diện như bảng CSV; bản ghi tab nhiều dòng đơn lẻ/không header vẫn được giữ nguyên. Nhánh `.txt`/bảng tab của Upload tiếp tục xử lý TSV; không đổi định dạng nháp, mapper, verifier, UI hoặc API import. Không đổi phạm vi Nội dung hay ngữ nghĩa lưu/chèn thủ công.
- Smoke main kiểm ô nhiều dòng, dòng trống, tab trong ô, escape nháy, dòng ghi chú bắt đầu “Nội dung:”, SĐT trong ghi chú, bản ghi cuối và bản ghi đơn không header; kiểm nguyên nguồn và không có nội dung bảng ở context/history AI. Electron mô phỏng sự kiện paste trên renderer thật → đính kèm local → Upload → chèn → lưu/mở nháp → mở lại nguồn, kiểm đủ hai khách và toàn bộ tên/SĐT/Info1, số 0 đầu và metadata-only request/history.
- Smoke main, toàn bộ suite Electron import local, hai typecheck và production build local đạt trên source cuối. Không chạy lại toàn bộ suite form ngoài luồng import trong lượt này.
- Không sửa form thường, main data/OCR services, dependency hoặc SQL V442. Không gọi provider/DB live, apply migration, đóng gói Windows hoặc phát hành; IPC/store/provider trong smoke là fixture.

[Receipt/checksum/lệnh](tsv-multiline-verification.json), [tái hiện trước sửa](tsv-multiline-before.txt), [smoke main](tsv-multiline-agent.txt), [Electron import](tsv-multiline-ui.txt), [build](tsv-multiline-build.txt).


## Kiểm chứng toàn bộ phạm vi trước PR — 03/11/2026

- Nền `dev_3` tại `ee8dca6112bb4cbbd34a1dbb270ffbd1caab75a0`; bao gồm toàn bộ form Agent, main/preload/shared, import/OCR local, migration đã apply, smoke và hợp đồng/audit. Không chỉ kiểm tra bản sửa TSV cuối.
- Hai typecheck và production build đạt. Smoke main Agent, toàn form Electron (gồm import CSV/TSV/ảnh, nháp, hoàn tác, cancellation và platform), IPC, ảnh private refs, OCR thật trong ASAR, content/config AI, importer thường và HTTP proxy đều đạt trên source chuẩn bị PR.
- Form thường khớp nguyên byte với `dev_3`; hướng dẫn/archive/preserved reference giữ nguyên; link tài liệu và diff whitespace sạch. SQL V442 và baseline snapshot giữ đúng checksum receipt đã apply, không apply thêm hoặc query lại DB trong lượt tạo PR.
- UI dùng renderer thật với IPC/store/provider fixture và sự kiện paste mô phỏng; HTTP proxy dùng bridge local/provider giả lập. Không coi đó là bằng chứng chất lượng AI live hoặc Windows; chưa đóng gói/phát hành Desktop.

[Receipt/checksum/lệnh và log](pr-verification.json), [Electron toàn form](pr-ui.txt), [OCR ASAR](pr-ocr.txt), [HTTP proxy](pr-proxy.txt), [build](pr-build.txt).
