# Chẩn đoán chiến dịch — v390

Tab thứ ba trong chi tiết chiến dịch Facebook/Zalo/Email: **Thông tin → Tài khoản → Chẩn đoán**. Các tab cũ, gồm Chạy ngẫu nhiên Facebook, nằm sau đó. Mở tab tự kiểm tra; **Chẩn đoán AI** chỉ chạy khi bấm. Không có hội thoại, tự sửa cấu hình hoặc chạy thử chiến dịch.

## Hành vi

- `Kiểm tra lại` lấy snapshot mới. Các mục kiểm tra tự động mở rộng thành **Kết quả kiểm tra / Chi tiết / Thao tác**; gộp phần diễn giải trùng nhau, không gọi thông tin bình thường là nguyên nhân hoặc giải pháp. Kết quả AI vẫn đủ năm phần: vấn đề, nguyên nhân, vì sao phát sinh, giải pháp và thao tác.
- AI dùng cấu hình riêng `app_campaign_diagnostics`, `gpt-6.1-sol`, Responses API, reasoning medium, 120 giây. Không thay cấu hình trợ lý khác, không tự retry hoặc đổi model.
- AI chỉ trả action trong allowlist. Nút mở form tài khoản/đăng nhập đúng kênh, quản lý hành động, lịch, giới hạn, nội dung và media, Data ban đầu, form Bổ sung data, Kết quả chạy hoặc Lịch sử gần đây.
- Mỗi nút nằm trong mục liên quan: **Sửa lịch chạy** ở **Lịch chạy**, **Cập nhật nội dung và media** ở **Nội dung, media và cấu hình**, **Tiếp tục chiến dịch** ở **Bộ chạy chiến dịch** khi chiến dịch đang **tạm dừng**. Không có box Hành động xử lý nhanh riêng. Nút Tiếp tục dùng cùng `handleResume`/`updateCampaign` và kiểm tra quyền/trạng thái trong IPC hiện có, đưa chiến dịch về **chờ xử lý**, không bỏ qua lịch hoặc quota. Khóa nút khi đang xử lý để tránh gửi trùng; thành công lấy snapshot mới và đánh dấu AI cũ, lỗi giữ kết quả và cho thử lại. Đổi chiến dịch/tab/logout bỏ cập nhật UI đến muộn. Nút này do Desktop quyết định theo trạng thái chiến dịch hiện tại, không cần gọi AI; không đổi prompt/RPC hoặc thêm action AI.
- Form cũ tiếp tục kiểm tra quyền và trạng thái cho phép lưu. Đóng form được mở từ chẩn đoán thì cập nhật snapshot và đánh dấu AI cũ; đăng nhập Zalo thành công cũng làm mới. Chuyển sang tab data rồi quay lại lấy snapshot mới, giữ kết quả AI cũ để đối chiếu.
- Không tự xác minh phiên, khôi phục runtime, điều chỉnh quota, claim hoặc thay đổi trạng thái. Đăng nhập chỉ được khởi động khi người dùng bấm nút tương ứng.
- Lỗi tải một nhóm trả **Chưa xác minh**, không biến thành dữ liệu rỗng hoặc bình thường. Lỗi AI giữ kết quả kiểm tra bằng quy tắc.
- Đếm lỗi gần đây theo `report_group` đã lưu; chỉ dùng trạng thái `lỗi`/`thất bại` cho dòng cũ có `report_group=NULL` hoặc thiếu trường này. Không phân loại lại kết quả `success`/`skipped`/`pending` theo text cũ; giữ nguyên evidence đưa cho AI. Smoke kiểm tra trên cả ba kênh.
- Kết quả AI chỉ nêu vấn đề cần xử lý, điều kiện đang chờ/chặn hoặc thiếu bằng chứng có liên quan. Không dựng box từ điều kiện bình thường hay nguyên nhân đã loại trừ; gộp tình trạng và phần chưa rõ nguyên nhân vào một mục. Giữ `info` cho trạng thái tạm dừng/chờ lịch, không lọc bỏ toàn bộ `info` trong UI. Không có bất thường hoặc điều kiện chờ cần giải thích thì `issues=[]`.

## Giao diện Desktop

Giao diện Desktop được chỉnh theo `akaBizWebClient/src/features/zalo/Campaign/pages/Manage/components/CampaignDetailPanel/CampaignDiagnosticsTab.jsx`: cột nội dung tối đa 768px, banner trạng thái có hai nút riêng, thẻ kiểm tra có icon/mô tả ngắn và mở sẵn các mục khác `ok`. Giới hạn có thanh tiến độ trong mục tương ứng, dùng đúng khung phút; giá trị chưa xác minh có nhãn và thanh trung tính, không hiển thị thành 0. Bảng hạn chế nằm trong mục hành động. Thẻ **Trợ lý akaBiz** xuất hiện phía trên kết quả quy tắc khi người dùng bấm AI; giữ đủ năm phần, nút mở form cũ và cảnh báo kết quả cũ. Hỗ trợ theme sáng/tối, bàn phím và giảm chuyển động. Đây chỉ là đổi trình bày Desktop; không thay RPC/model hoặc tự chạy AI.

Rà soát câu chữ ngày 14/10/2026: thống nhất **Chẩn đoán**, **Nội dung, media và cấu hình**, **Cập nhật nội dung và media** và **Thao tác**. Câu cố định dùng “giới hạn lượt”, “quy tắc xử lý”, “thông tin tệp” và “lịch sử có thể chưa đầy đủ” thay thuật ngữ kỹ thuật. Mục thiếu bằng chứng không mặc định là lỗi mạng; trạng thái hoàn thành dùng “Chiến dịch đã hoàn thành”. Mốc lịch đã lưu gọi là **Lịch chạy hiện tại**, hiển thị cùng ngày kết thúc theo ngày giờ Việt Nam; không đổi cách tính lịch. Các thời điểm cập nhật/AI/mở lại cũng hiển thị theo múi giờ Việt Nam và ngày lỗi trả **Chưa xác minh**. Đây là thay đổi câu chữ/trình bày trên Desktop, không sửa prompt DB V395. Padding dưới tab là 32px ở mọi breakpoint, hàng nhãn cuối cách đáy khoảng 40px khi cuộn hết.

## Nguồn và quy tắc

Bổ sung ngày 15/10/2026: khi phiên **Làm giàu lịch sử Web** thực sự đang chạy trên đúng tài khoản Facebook, observer bận dùng chung trả **“Tài khoản đang bận làm giàu lịch sử Web. Chiến dịch này đang chờ đến lượt.”**. Pending reason giữ ưu tiên note cũ; Chẩn đoán hiển thị tại **Bộ chạy chiến dịch**, không thêm box hoặc suy từ cờ bật/lịch/cấu hình của tác vụ phụ. Chiến dịch tạm dừng/hoàn thành/đang chạy vẫn giữ diễn giải trạng thái hiện có.

Trạng thái và phiên bản chuyển phiên đọc trong RAM; kiểm tra lại trước trả note/snapshot, trước/sau AI, kể cả phiên bắt đầu rồi kết thúc trong lúc phân tích. Sự kiện IPC sẵn có xóa note tạm và bỏ phản hồi cũ của đúng tài khoản; Chẩn đoán đánh dấu kết quả kiểm tra/AI cũ và cho bấm kiểm tra lại. Không tự tải lại DB hoặc gọi AI khi có sự kiện, không sửa prompt/migration, thêm pool hay polling. Smoke pending reason, adapter scheduler, diagnostics và hai UI smoke bao phủ note, tài khoản khác, bật nhưng chưa chạy, kết thúc, phản hồi muộn và giữ trạng thái chiến dịch.

`campaignDiagnosticsRepository` đọc qua singleton Supabase HTTP hiện có. `collectCampaignDiagnostics` dùng cùng observer `CampaignScheduler.getDiagnosticRuntime`, schedule/input reason, entitlement, browser admission và quota preflight như nút **Tại sao CD không chạy?**. Nút cũ giữ điều kiện hiển thị và hành vi ghi chú tạm.

- Snapshot cấu hình chiến dịch chứa chữ, media và snapshot mẫu nội dung/biến trong `extraSettings`, quyền/gói tài khoản và nơi thực thi. Không gửi password/session hoặc token claim; chỉ ghi nhận boolean đang có ownership.
- `refresh_data` được đọc vào `refreshData` và tham gia phiên bản snapshot, để AI nhận đúng cài đặt làm mới data của lịch tuần/tháng và phát hiện khi cài đặt đổi.
- `facts.schedule` ghi giờ DB dùng để kiểm tra, múi giờ Việt Nam, nguồn data, vai trò và tình trạng ngày kết thúc. Data trực tiếp áp ngày kết thúc khi chuyển kỳ/hoàn tất, không tự chặn data còn chờ chỉ vì ngày cũ; Nhóm data dùng mốc này để chặn lượt mới khi hết hạn. Thiếu giờ DB, nguồn data hoặc ngày không hợp lệ trả chưa xác minh. Mục Lịch chạy chỉ kết luận về lịch, không cam kết chiến dịch đang tạm dừng sẽ chạy.
- Hướng dẫn AI nằm trong `ai_prompt.id=47`, được `ai_using.app_campaign_diagnostics` liên kết; V394 chuyển hướng dẫn lịch vào DB, V395 tinh chỉnh cách chọn vấn đề. Không hardcode chỉ dẫn hoặc ghép prefix trong Desktop. Main chỉ tạo snapshot/kiểm tra lịch; `campaignDiagnosticsSchedule.ts` giữ dữ liệu và diễn giải cho mục kiểm tra. Mỗi lần bấm AI đọc cấu hình DB hiện tại. Prompt phân biệt direct/data_group, hỗ trợ snapshot cũ chưa có `facts.schedule`, không quy nguyên nhân tạm dừng cho ngày kết thúc hoặc một dòng log. Xem [audit V395 hiện hành](CAMPAIGN_DIAGNOSTICS_FOCUS_V395.md) và [V394 lịch sử](CAMPAIGN_DIAGNOSTICS_PROMPT_V394.md).
- Phân biệt Zalo QR, trình duyệt, legacy Server và akaChat. Bộ chạy từ xa chưa được xác minh trực tiếp sẽ ghi rõ thiếu bằng chứng.
- Quota hiển thị ngày theo giờ DB và cửa sổ phút thực tế, kể cả **65 phút**. Giữ cách tính legacy/explicit `counts_toward_limit` của từng bộ chạy, cấu hình nhóm/gói và continuation. Hạn chế của từng hành động được trình bày riêng; kết luận chặn chiến dịch do preflight hiện có quyết định.
- Lịch sử tài khoản: tối đa 30 mới nhất theo `created_at DESC, id DESC`; chỉ tài khoản thuộc chiến dịch/staff/tenant.
- Lịch sử chạy: tối đa 30 dòng không rỗng cuối chuỗi log, cắt tại DB, mới nhất trước. Đây là **dòng**, không phải 30 nhóm sự kiện nhiều dòng.
- Main giữ nguyên thứ tự và số dòng của mẫu lịch sử; áp che văn bản đơn giản cho từng dòng. Không ghép sự kiện hoặc ẩn log chỉ vì thiếu timestamp/chạm giới hạn. Lịch sử gốc không thay đổi.
- Kết quả: tối đa 30 mới nhất của đúng campaign/account, gồm mã lỗi và `policy_snapshot` đã ghi nhận. Không suy ra chuỗi lỗi liên tiếp hoặc tổng ngày từ mẫu này.
- Mẫu kết quả rỗng hiển thị **Chưa có kết quả chạy để đối chiếu**, giữ icon thông tin. Mục nội dung cũng giữ icon thông tin vì chỉ thu thập cấu hình/metadata; không dùng dấu tích để ngụ ý đã xác minh toàn bộ nội dung hoặc thực thi thành công.
- Data: tổng hợp trạng thái và tối đa 30 mẫu, ưu tiên chờ xử lý rồi mới đến các trạng thái khác. Mỗi nhóm mới nhất trước.
- Account logs vẫn best effort, chỉ hỗ trợ giải thích. Chỉ kiểm tra metadata media, chưa có thị giác/kiểm tra tồn tại mọi file. Không gồm SMS/gọi điện.

## IPC, vòng đời và bảo vệ dữ liệu

Shared contract: `src/shared/campaignDiagnostics.ts`. IPC/preload: `getCampaignDiagnostics`, `analyzeCampaignDiagnostics`, `cancelCampaignDiagnostics`.

Main kiểm tra main renderer frame, ID và UUID request, credential identity, staff/tenant và quyền đọc. Renderer gửi campaign ID/snapshot ID, không cung cấp evidence cho AI. Request trùng dùng chung promise và có lease theo request ID; hủy một lease không hủy request còn người dùng. Tối đa bốn request đang hoạt động; read deadline 20 giây, AI 120 giây. Snapshot RAM tối đa 5 phút, cache tối đa 32; không localStorage, file, polling hoặc pool mới. Snapshot hết hạn hoặc cấu hình đổi được lấy lại trước AI; cấu hình đổi trong khi AI chạy thì bỏ kết quả.

Đổi campaign, tab ẩn, đóng detail hoặc logout hủy request; UI kiểm tra generation, main kiểm tra credential object nên cả đăng xuất/đăng nhập lại cùng staff cũng không nhận phản hồi cũ. Snapshot được lọc secret trước IPC, system prompt và log AI. Nội dung/log được đánh dấu dữ liệu không đáng tin trong prompt. JSON được kiểm tra đủ các trường và action allowlist trước hiển thị nút.

Theo yêu cầu người dùng ngày **14/10/2026**, bỏ phần che phức tạp và chỉ giữ mức cơ bản:

- Object: bỏ các field có tên nhạy cảm như password/pass/cookie/token/session/authorization, duyệt object/array lồng thông thường.
- Văn bản: che giá trị cùng dòng sau nhãn credential rõ ràng (gồm Cookie/Set-Cookie, Authorization/Proxy-Authorization và pass/password); giữ prefix và các dòng nghiệp vụ tiếp theo. Vẫn che Bearer, API key/JWT nhận diện được, userinfo/tham số URL và rút gọn media base64.
- Cắt chuỗi về 8.000 ký tự **trước** khi xử lý; lịch sử tối đa 30 dòng giữ đúng thứ tự. Không còn bộ quét khóa tổng quát gây chậm với chuỗi dấu chấm/gạch ngang.
- Bỏ parse JSON lồng trong chuỗi, suy luận header pairs/name-value, ghép sự kiện theo timestamp và che cả sự kiện/mảng. Dữ liệu không có nhãn, credential nhiều dòng hoặc nhúng theo định dạng khác có thể được giữ nguyên. Đây là che cơ bản, không bảo đảm loại mọi credential trong văn bản tự do.

Smoke đã được đổi theo phạm vi này, thay bộ 942 biến thể cũ: field/header cơ bản (cả Basic base64), giữ log không timestamp/log bị cắt và dữ liệu nghiệp vụ, thứ tự/giới hạn, lọc lặp và chuỗi dài 30.000–100.000 ký tự. Fixture kiểm tra snapshot, system prompt, request và log AI qua transport giả lập; không gọi model thật hoặc gửi dữ liệu khách hàng. Quyền IPC, snapshot, refresh_data và AI chỉ khi bấm giữ nguyên. Không đổi RPC/DB/model hoặc tăng lượng dữ liệu đọc.

Hồi quy ngày kết thúc: `node scripts/campaign-diagnostics-smoke.cjs` dùng hàm kiểm tra lịch thật cho Facebook/Zalo/Email, đối chiếu direct/data_group với ngày kết thúc cũ, tạm dừng, lịch tương lai, giờ dừng, đúng mốc hết hạn và thiếu thông tin. Fixture prompt lấy từ snapshot migration V395; kiểm tra request/log AI dùng prompt do repository trả về, không có prefix từ code. Kiểm tra Responses/Chat nhận phiên bản prompt DB mới ở lượt gọi tiếp theo.

Smoke model thật: `node scripts/campaign-diagnostics-ai-live-smoke.cjs --live --schedule` dùng 7 tình huống dữ liệu giả (gồm snapshot Desktop cũ, đang chạy bình thường và hết quota), không ghi log AI production; request phải có system prompt đúng bằng prompt DB sau nội suy. Kết quả lưu `/tmp/akaagent-diagnostics-focused-ai-smoke.json`; `--verify-schedule-receipt` kiểm tra lại response đã lưu mà không gọi mạng. Ca chưa đến giờ chỉ cần giải thích chờ, không bắt buộc nút sửa lịch. Tạm dừng với nguyên nhân chưa xác minh có thể là `info` hoặc `unknown` nhưng phải gộp thành một vấn đề. Kết quả áp dụng/kiểm chứng ở [audit V395](CAMPAIGN_DIAGNOSTICS_FOCUS_V395.md).

## Migration và audit production

Đã áp dụng **14/10/2026**, project **akachat / `cgjbsmqtfhqvttudyjzq`**, history **`20261014085205 / migration_v390_campaign_diagnostics`**. Không apply lại. v390 được chọn sau v389 đang được triển khai ở phần việc khác.

- RPC mới: `public.aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)`.
- Trước apply: signature chưa tồn tại. Preflight từ chối overwrite và từ chối đụng row AI cùng code đã tồn tại.
- Helper live `auto_assert_automation_identity(bigint,bigint,text,text)` được giữ nguyên, MD5 **`5a9a503db72b965eb644739f5f60905d`**.
- RPC đích MD5 **`2b0ba11c25cc61f111f5ed068a31626c`**; owner postgres, STABLE SECURITY DEFINER, search path `pg_catalog, public`, statement timeout 15 giây. Execute cho anon/authenticated/service_role; PUBLIC bị revoke. Mọi caller vẫn phải cung cấp credential hợp lệ và sở hữu campaign/account.
- Không thay definition/helper/policy/runtime RPC cũ. Không cấp SELECT trực tiếp `auto_account_logs` cho anon/authenticated.
- Chỉ thêm ba row `ai_model`/`ai_prompt`/`ai_using`. Credential được clone server-side từ `openai_luna`; không in hoặc lưu key vào audit. Các cấu hình AI cũ không đổi.
- Có reload schema vì thêm API signature. HTTP sau apply đạt 200 cho cả ba kênh, ~0,24–0,31 giây trong smoke; sai credential/campaign bị chặn. Không thêm SQL connection/pool/index/timer đọc DB.

Nguồn kiểm chứng ở `migrations/snapshots/campaign-diagnostics-v390/`: `before.json`, `live-preflight.json`, `rollback-smoke.json`, `after.json`, `postapply-smoke.json`, `http-smoke.json`, `model-access.json`, `ai-structured-smoke.json`, `disable-rollback-smoke.json`. Snapshot không chứa API key hoặc credential tài khoản.

## Kiểm chứng

- `node scripts/campaign-diagnostics-smoke.cjs`: lọc secret, action allowlist, ba kênh, incomplete evidence, 65 phút, config race, main-frame/owner, dedup/cap/deadline/cancel/relogin/expiry và AI chỉ theo yêu cầu.
- `node scripts/campaign-pending-reason-smoke.cjs` và `node scripts/campaign-pending-reason-chat-smoke.cjs`: hồi quy pending reason, quota/continuation, group/cap, workflow local vs akaChat, DB time và đọc không mutation.
- `node scripts/run-campaign-diagnostics-ui-smoke.cjs`: component CampaignPanel thật với IPC giả lập; tab thứ ba, loading/AI riêng, bàn phím mở/đóng, quota 65 phút/chưa xác minh, hạn chế hành động, stale/error preservation, mở form giới hạn/bổ sung data/lịch/nội dung thật, tab/auth cancellation, lỗi tải ban đầu và không tràn nội dung ở 850/1024/1600 với cả theme sáng/tối. Kiểm tra từng nút ở đúng card, không có box thao tác riêng; Tiếp tục chỉ trong Bộ chạy chiến dịch tạm dừng, không gọi từ kiểm tra/AI, pending/failure/gửi trùng, đúng ID/trạng thái, refresh + AI cũ và phản hồi đến muộn sau đổi chiến dịch. Ảnh ở `/tmp/akaagent-diagnostics-ui/`.
- `node scripts/run-campaign-pending-reason-ui-smoke.cjs`: hồi quy nút cũ, note tạm và race.
- SQL migration + smoke chạy trong transaction rollback trước apply, rồi smoke quyền/giới hạn lại sau apply. HTTP kiểm tra cả ba kênh thực tế, newest-first/pending-first và tối đa 30.
- `node scripts/campaign-diagnostics-ai-live-smoke.cjs --live`: **có tính phí một request AI**, dùng dữ liệu giả qua service/runtime thật và prompt/model hiện hành. Đã đạt structured output đủ năm phần, medium, system snapshot, lọc secret và giữ nguyên ký tự `$&`; không gửi dữ liệu khách hàng hoặc ghi production AI log trong smoke này.
- Hai typecheck và `npm run build` chạy trước bàn giao. Bundle có cảnh báo static/dynamic import hiện hữu; không chặn build.
- Smoke ngoài phạm vi `facebook-message-waiting-limit-smoke.cjs` có lỗi harness `managedTargetEffects is not defined` ở phần policy sau các kiểm tra workflow. Không tính script này là PASS; hai smoke pending/quota ở trên là kiểm chứng quota của tính năng này.

## Rollback và phát hành

Desktop mới đã build local; **chưa đóng gói hoặc phát hành bộ cài**. DB v390 đã sẵn sàng trước Desktop.

Nếu cần ngừng AI, dùng `migrations/tests/migration_v390_campaign_diagnostics_disable.sql`: guard signature/config rồi tắt riêng `ai_using.app_campaign_diagnostics`. Đã smoke UPDATE trong transaction và ROLLBACK, xác nhận production vẫn bật. Không reload schema cho thay đổi dữ liệu này.

Nếu cần bỏ giao diện, quay về bản Desktop trước tính năng; giữ RPC/config/history để tránh mất tham chiếu AI log. Không xóa model/prompt/log hoặc ghi đè helper đang live. Gỡ RPC sau này phải có audit và migration mới theo skill an toàn.
