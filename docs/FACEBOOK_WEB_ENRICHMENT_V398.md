# Làm giàu lịch sử Web — V398

Đã triển khai mã Desktop và apply trên **akachat / cgjbsmqtfhqvttudyjzq** ngày 14/10/2026. History: `20261014155154 / migration_v398_facebook_web_enrichment`. Desktop build local thành công; **chưa đóng gói/phát hành**. Không apply lại migration khi phát hành.

Yêu cầu số lượng và mặc định được cập nhật ngày 15/10/2026 qua [V401](FACEBOOK_WEB_ENRICHMENT_DEFAULTS_V401.md): tối thiểu ba từ khóa, đúng ba website khi lưu bật; mới mặc định 12:00 và ngày hiện tại theo Việt Nam +7. Giữ cấu hình đã lưu và khả năng chạy/tắt cấu hình năm website cũ. Các giá trị năm mục phía dưới mô tả hợp đồng V398 ban đầu.

## Phạm vi

Menu Facebook **Làm giàu lịch sử Web** mở modal React theo HTML nguồn trong `Downloads/Thiết kế akaAgent (11)/Làm giàu trình duyệt web.dc.html`: card tối đa 640px, bo góc 16px, màu tím, body cuộn, footer cố định. Không nhúng prototype, không dữ liệu khách hàng mẫu. Có bật/tắt sau lưu, mô tả, chip từ khóa/sở thích, đúng 5 website, thời lượng 5–240 phút bước 5 và các preset, giờ Việt Nam sắp xếp, ngày dừng. Cảnh báo lịch chồng không chặn lưu. Draft giữ lại khi lỗi/CAS conflict; tải lại là thao tác chủ động. Có focus trap, Escape, trạng thái tải/lưu và bản 390px.

Chỉ thêm `auto_accounts.facebook_web_enrichment_enabled` (mặc định false, NOT NULL) và `facebook_web_enrichment_config` (JSONB). Không bảng lịch sử/phiên, runtime DB claim/token/lock, quota, detail, bộ đếm lỗi hoặc thay đổi trạng thái nghiệp vụ. `auto_account_logs` vẫn là HTTP best effort hiện có; không chờ log để trả tài khoản. Không AI, phân loại trang, crawl trang con hoặc retry phiên lỗi.

## RPC và dữ liệu

Signature mới: `public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)`; chỉ `get` / `save`. Bốn tham số đầu là staff, organization, username, password; sau đó account, operation, input. Input save `{enabled,config}`. Config: `{version:1,revision,industry,keywords,websites,hobbies,minutesPerSession,slots,stopDate}`. Revision tăng trong cùng transaction với cờ enabled; tài khoản khóa hàng chỉ khi **lưu cấu hình**, không trong tác vụ lướt.

RPC xác thực qua helper live `auto_assert_automation_identity`, kiểm tra staff active, đúng staff/tenant/account Facebook chưa xóa. Bật yêu cầu gói Facebook 3/10 còn hạn theo ngày Việt Nam. Đọc và tắt vẫn cho phép chủ tài khoản khi gói hết hạn; tắt chấp nhận draft chưa đủ dữ liệu. Schema metadata mới nên chủ động reload PostgREST một lần. Runtime đọc enabled/revision qua account projection hiện có; đọc nội dung cấu hình theo nhu cầu, không thêm polling hay connection/pool.

| Đối tượng | Trước | Sau |
|---|---|---|
| RPC cấu hình mới | Không tồn tại | MD5 `4505f7334baa90908454c354dd091db5` |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` | Giữ nguyên |
| `aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)` | `2c7b2243ebe72dbd544a270dd56310fc` | Giữ nguyên |
| `aka_agent_claim_campaign_runtime_checked(bigint,bigint,bigint,text)` | `dc5d650ca0f8e63c00ce97c4606ef245` | Giữ nguyên |
| `aka_agent_cleanup_failed_campaign_runtime(bigint,bigint,bigint,text,uuid,uuid,bigint[],text,boolean,text,text)` | `f506f8695e3e874642e3c845e103e42d` | Giữ nguyên |

RPC mới: owner `postgres`, SECURITY DEFINER, VOLATILE, `search_path=pg_catalog, public`, statement timeout 15s. PUBLIC không có EXECUTE; cấp `anon`, `authenticated`, `service_role` theo hợp đồng credential của Desktop. Preflight kiểm tra helper checksum, RPC/cột/tên seed chưa tồn tại, fail closed. Không dựng lại body RPC nghiệp vụ V393–V397.

Workflow `fb_web_enrichment` có một block `fb_web_enrichment_browse`, MD5 code V398 ban đầu `d106492c55706db94fbc8daa44514d8b`; [V404](FACEBOOK_WEB_ENRICHMENT_DWELL_V404.md) cập nhật hai khoảng thời gian, MD5 hiện tại `8d1223574f8fc342317da3ce63db240b`. Hai element `fb_web_enrichment_result` / `fb_web_enrichment_captcha` giữ nguyên. Workflow/block/element nạp nền một lần trong phiên scheduler. Engine nhận block snapshot chỉ khi `persist:false`; luồng campaign giữ nguyên loader. Không tạo `auto_runs` / `auto_run_steps`.

Snapshot, owner/ACL/definition và receipt: [preflight](audits/web-enrichment-v398/preflight.json), [apply](audits/web-enrichment-v398/apply.json), [verify](audits/web-enrichment-v398/verify.json), [API](audits/web-enrichment-v398/api.json).

## Điều phối

`WebEnrichmentPlanner` chỉ giữ RAM theo account/ngày. Mỗi mốc nhận tối đa một lần và cho phép bắt đầu ngay khi tài khoản rảnh trong cửa sổ 30 phút, cắt trước mốc tiếp theo/0h. Không chọn giờ bắt đầu ngẫu nhiên. Lượt đang chờ chiến dịch hoặc chờ chỗ Desktop cũng hết hạn ở cuối cửa sổ, không chạy bù. Phiên đã bắt đầu giữ thời lượng cấu hình, vẫn giới hạn bởi nửa đêm và các điều kiện hủy hiện có. Khoảng chạy thực tế được lưu RAM để bỏ mốc xảy ra lúc đang lướt, kể cả hai tick không quan sát được ranh giới. Bật/lưu cấu hình vẫn xét mốc chưa chạy nếu còn trong cửa sổ; không chạy lại mốc đã dùng. Pause/resume và thao tác tài khoản vẫn bỏ các mốc cũ, chỉ mốc tương lai được xét tiếp. Restart không phục hồi; có thể nhận lại mốc còn cửa sổ, chấp nhận trùng giữa thiết bị.

Scheduler hiện có quan sát lịch trước khi bỏ qua account bận. Tác vụ phụ chỉ đặt chỗ nếu config/workflow/đồng hồ DB/profile-proxy đã sẵn sàng. Không chờ tải chúng trên luồng campaign. Có tối đa một phiên phụ trên Desktop; account khác vẫn chạy campaign. Xen sau `executeCampaign` đã trả về và không có cleanup lỗi; random xen sau finish/cleanup của đợt. Không có campaign vẫn xét lịch. Sau phiên phụ, campaign đến lịch được ưu tiên trước lần xét tiếp.

Trang nền riêng cùng partition `persist:account_<id>` và proxy đã chuẩn bị; không điều hướng trang campaign. Không mở popup hoặc tải file từ trang phụ. Theo V404, search Google xem 10–30 giây rồi mở một kết quả thông thường; website đọc/cuộn 1–3 phút (cả kết quả Google và website mở thẳng). Các danh sách xáo trộn, tránh lặp liền mục trước, sở thích khoảng 20% truy vấn khi có. Không vượt deadline phiên (gồm điều hướng/tải/chờ), trang cuối bị cắt theo thời gian còn lại, phiên dừng tại 0h Việt Nam. CAPTCHA ngừng Google trong phiên; URL lỗi bị loại, hết nội dung dừng sớm.

Mỗi thao tác page tối đa 30 giây và không vượt deadline. Abort/timeout/crash đóng BrowserWindow; facade từ chối gọi muộn. Promise đua timeout luôn kèm hủy/đóng page. `finally` xóa giữ chỗ và trạng thái theo đúng run ID, đánh thức scheduler; không có DB cleanup/retry. Pause/resume, thao tác account, login/scan qua registry và đổi proxy hủy phụ trước thao tác chính. Registry không claim cho phiên phụ. UI nhận event/snapshot RAM **Đang chạy · Làm giàu lịch sử Web**, không sửa `auto_accounts.status`.

## Kiểm chứng

- Hai typecheck sạch; `npm run build` đạt (cảnh báo chunk/dynamic import hiện có, không lỗi).
- `node scripts/web-enrichment-runtime-smoke.cjs`: 55 checks validation, ba mốc/45 phút, cửa sổ trễ, random ổn định, revision, pause/resume, deadline, treo, crash, HTTP lỗi, callback muộn, logger lỗi, một phiên/desktop, ưu tiên, từ khóa trùng sở thích, cache proxy (cả phản hồi trễ sau sửa proxy), staff hết quyền và boundary scheduler.
- `node scripts/web-enrichment-workflow-smoke.cjs`: chạy code block trích từ migration; thời lượng min/max, clipping, cuộn, chỉ URL đã cung cấp/kết quả Google, CAPTCHA, hết website.
- `node scripts/run-web-enrichment-browser-smoke.cjs`: Electron thật với profile/HTTP fixture riêng; partition/cookie, DOM selector Google (lọc quảng cáo), navigate/evaluate/scroll, HTTP 503, navigation treo, renderer crash, đóng page và chặn gọi muộn. Không thao tác tài khoản khách.
- `node scripts/run-web-enrichment-ui-smoke.cjs`: menu, dữ liệu trống/mặc định tắt, validation, chip, URL, giờ trùng/sắp xếp, cảnh báo không chặn, CAS giữ draft, tắt thiếu dữ liệu, lỗi tải/retry và viewport 390px. Đã xem ảnh [desktop](audits/web-enrichment-v398/modal-desktop.png), [lịch](audits/web-enrichment-v398/modal-schedule.png), [nhỏ](audits/web-enrichment-v398/modal-mobile.png).
- SQL pre-apply chạy DDL/fixture âm trong transaction rồi ROLLBACK, không tiêu thụ sequence catalog; post-apply smoke cũng ROLLBACK. Bao phủ CAS, validation, tenant/staff/account, credential, ACL và toàn bộ business fields của account giữ nguyên. [Smoke](audits/web-enrichment-v398/smoke.json), [post-smoke](audits/web-enrichment-v398/post-smoke.json).
- API thật: RPC tới được, credential thiếu/sai bị từ chối, hai cột mới có trong schema cache. Chỉ query `limit(0)`; không đọc dữ liệu/credential tài khoản khách.
- Hồi quy: `facebook-random-run-runtime-smoke.cjs` 30 checks; `facebook-random-run-stop-reason-smoke.cjs` 4 tình huống; `campaign-shared-schedule-smoke.cjs` 1.440 policy/30 RPC/18 parity/6 scheduler cases; `account-operation-cleanup-smoke-test.cjs` 41 checks; `facebook-rest-browse-smoke-test.cjs` đạt.
- Sau apply: enabled accounts = 0, configured accounts = 0, workflow runs = 0. Không chạy phiên Google thật trên tài khoản khách; DOM Google thực tế thay đổi vẫn có thể khiến bỏ lượt, đúng cơ chế best effort.

## Rollback

Rollback vận hành ưu tiên tắt cờ, giữ API/config và history migration để Desktop hiện tại vẫn đọc được. Đóng/dừng Desktop trước, chạy [rollback SQL](../migrations/tests/migration_v398_facebook_web_enrichment_rollback.sql) để kiểm tra. File mặc định ROLLBACK, guard đúng RPC/block checksum; đổi sang COMMIT chỉ khi thật sự rollback. Nó chỉ tắt enabled, tăng config revision chống draft cũ bật lại và cập nhật updated_at, không đổi trạng thái account/campaign. Không cần schema reload.

Quay lại Desktop cũ tương thích với metadata bổ sung. Không DROP cột/RPC/workflow khi còn Desktop mới; không reapply V398 hoặc các migration V393–V397. Có thể bật lại từng account qua modal sau khi xử lý nguyên nhân. Không có lịch sử/progress để khôi phục.

## Sửa hai finding review Desktop — 14/10/2026

Review đã tái hiện hai lỗi mà smoke ban đầu chưa bao phủ:

1. Hàng đợi thường/ngẫu nhiên có thể gọi tác vụ phụ bằng snapshot tài khoản trước khi chạy chiến dịch, kể cả khi claim bị từ chối, tài khoản vừa tạm dừng hoặc hàng đợi đã dừng vì boundary. Bỏ các lần gọi phụ vô điều kiện ở cuối hàng đợi. Giữa hai lượt, chỉ xét sau cleanup và bằng kết quả đọc tài khoản sẵn có ở đầu lượt kế tiếp; chưa nhả unit hoặc cleanup lỗi thì không bàn giao. Kiểm tra thêm enabled/revision của snapshot mới với cache cấu hình. Khi hết hàng đợi, tick scheduler hiện có xét lại bằng snapshot mới, có thể chậm tối đa khoảng một chu kỳ tick trong điều kiện đọc bình thường. Không thêm request đọc, timer, polling hoặc connection cho việc xác minh bàn giao.
2. `getEligibleAccounts()` loại tài khoản vô hiệu hóa khỏi snapshot. Trước đây service xóa cả planner, khiến bật lại có thể nhận mốc đã dùng trong cùng cửa sổ 30 phút. Nay giữ planner và dấu gián đoạn trong RAM, hủy phiên đang chạy và bỏ lượt đang chờ; khi tài khoản trở lại, bỏ các mốc đã qua và giữ ưu tiên chiến dịch. `stop()` vẫn dọn RAM; giới hạn chấp nhận chạy trùng sau restart/giữa thiết bị không đổi.

Kiểm chứng mới: `node scripts/web-enrichment-handoff-smoke.cjs` — 28 ca trên scheduler/service/planner thật với adapter DB/page offline. Bao phủ claim từ chối, ngày/boundary, concurrency, pause/logout/disable, config revision/proxy đổi, account bị xóa, mất ownership, cleanup/unit chưa xong, thao tác thủ công; thứ tự cleanup → đọc account mới → lướt → chiến dịch kế tiếp ở luồng thường/ngẫu nhiên; cuối hàng đợi chờ tick; bật lại sau phiên hoàn tất/đang chờ/đang chạy và khi cache giờ lạnh. Ca luồng thường xác nhận chỉ dùng hai lần đọc sẵn có cho hai chiến dịch. Không chạy trình duyệt tài khoản khách.

Sau bản sửa, hai typecheck và production build đều đạt. Hồi quy đạt: 55 checks runtime, block workflow, Electron browser thật trên HTTP fixture local, 30 checks random runtime, 4 ca stop reason, 41 checks account operation. Scheduler → SQL fixture đạt 1.440 policy / 30 RPC / 18 parity / 6 queue cases; receipt mới nằm trong [review-shared-schedule.json](audits/web-enrichment-v398/review-shared-schedule.json), giữ nguyên receipt lịch sử V397. [Kết quả và checksum mã bản sửa](audits/web-enrichment-v398/review-fix.json).

Chỉ sửa Desktop và smoke/audit. Không sửa hoặc apply DB/migration/RPC/workflow, không đổi chính sách lỗi, quota hay trạng thái nghiệp vụ. Rollback riêng bản sửa bằng thay đổi mã Desktop; nếu cần tạm ngưng tính năng, dùng công tắc hiện có. Desktop chưa đóng gói/phát hành.

## Sửa ưu tiên khi planner ngẫu nhiên rỗng — 14/10/2026

Review tiếp theo tái hiện P2: sau phiên lướt đầu tiên, scheduler ưu tiên chiến dịch dựa vào giờ đến lịch. Nếu chiến dịch không thuộc quy tắc ngẫu nhiên hoặc chưa có data đến lượt, planner trả rỗng nhưng ưu tiên vẫn chặn mọi phiên lướt sau. Tài khoản có thể rảnh cả ngày mà không lướt.

Nhánh planner trả rỗng nay xét một lần bàn giao nếu random vẫn bật và revision của phản hồi khớp cấu hình vừa đọc. `canRun()` chỉ xét cache/slot/profile/RAM, không giữ chỗ và không xóa ưu tiên chiến dịch. Chỉ khi phiên lướt thực sự đến giờ và sẵn sàng mới gọi `getAccount` một lần qua client hiện có để xác minh lại account sau planner; timeout tối đa 5 giây, hủy request bằng `AbortSignal` và bỏ kết quả muộn. Đây là lần đọc có điều kiện được bổ sung so với bản sửa đầu, không thêm polling, nguồn connection hay pool.

Trước khi bắt đầu lướt, kiểm tra lại random enabled/revision, trạng thái/đăng nhập/active, web enabled/revision, proxy, thao tác chủ động, boundary và cleanup. Thiếu cache, planner lỗi/tắt/khác revision, account đổi trạng thái hoặc đọc lỗi/timeout thì không bắt đầu lướt. Không lưu kết luận “không có lượt” sang tick sau; nếu lần xét này chưa lướt được, lần sau vẫn ưu tiên chiến dịch đủ điều kiện mới xuất hiện.

Phiên lướt đang chạy **không bị hủy chỉ vì chiến dịch đến lịch**. Chiến dịch cùng tài khoản chờ phiên lướt kết thúc; sau đó mới được chạy theo ưu tiên hiện có. Pause/logout/tắt tính năng, thao tác account chủ động, lỗi và deadline vẫn hủy theo cơ chế đã triển khai.

Kiểm chứng mới: `node scripts/web-enrichment-handoff-smoke.cjs` đạt **58 ca** (giữ 28 ca cũ, bổ sung 30 ca). Dùng tick, bộ lọc điều kiện random, service, planner và browser fence thật với DB/page adapters offline; kiểm tra chiến dịch ngoài rules, chưa có data, campaign đủ điều kiện chạy trước lướt, có data mới sau lần đọc lỗi, campaign đến trong khi đang lướt, account đổi trong lúc planner/đọc xác minh, planner lỗi/tắt/đổi revision, cache lạnh, hết slot, đọc treo và callback muộn. Xác nhận không đọc bổ sung khi chưa có slot hoặc slot đã dùng.

Hai typecheck và production build đạt. Hồi quy đạt: 55 checks web runtime, 30 checks random runtime, 4 ca stop reason, 41 checks account operation, workflow và Electron browser trên HTTP fixture local. Không chạy Google hoặc thao tác tài khoản khách trong kiểm chứng. [Receipt và checksum](audits/web-enrichment-v398/random-idle-fix.json).

Chỉ sửa `campaignScheduler.ts`, `webEnrichmentService.ts`, chuyển tiếp signal tùy chọn trong `SupabaseService.getAccount`, smoke và tài liệu. Không sửa/apply SQL hay RPC V398/V393–V397, không đổi quota/error policy hoặc trạng thái DB. Rollback riêng bằng hoàn nguyên nhánh `browseAfterEmptyRandomPlan` cùng preflight/signal mới; giữ hai bản sửa chống snapshot cũ và chống lặp slot. Có thể tắt tính năng bằng công tắc hiện có. Desktop chưa đóng gói/phát hành.

## Bổ sung theme tối cho modal

Modal giữ bảng màu sáng của HTML thiết kế khi `body.theme-light`; ở theme tối dùng token màu hiện có của app cho nền, chữ, đường viền, ô nhập, chip, website, nút chọn thời lượng, trạng thái bật/tắt, cảnh báo/lỗi và footer. `color-scheme` đồng bộ cả ô ngày/giờ và checkbox. Chuyển theme ngay khi modal đang mở không mất dữ liệu nháp; chỉ sửa CSS, không đổi form hoặc runtime.

Đã chạy bộ UI smoke Electron hiện có, chuyển cả hai theme và kiểm tra hình ở desktop/390px; hai typecheck và production build đều đạt. Desktop chưa đóng gói/phát hành. Ảnh đối chiếu riêng, không ghi đè ảnh audit ban đầu: [tối trống](audits/web-enrichment-v398/theme-fix/modal-dark-empty.png), [tối có dữ liệu](audits/web-enrichment-v398/theme-fix/modal-desktop.png), [lịch/cảnh báo tối](audits/web-enrichment-v398/theme-fix/modal-schedule.png), [lỗi tối](audits/web-enrichment-v398/theme-fix/modal-dark-error.png), [tối 390px](audits/web-enrichment-v398/theme-fix/modal-mobile.png), [sáng](audits/web-enrichment-v398/theme-fix/modal-light-desktop.png), [sáng 390px](audits/web-enrichment-v398/theme-fix/modal-light-mobile.png).

## Sửa tách từ khóa khi gõ tiếng Việt

Tái hiện bằng IME Chromium: Enter khi còn composition tạo chip `bóng đa` trước khi bộ gõ hoàn tất, sau đó phần hoàn tất được thêm thành chip `bóng đá` riêng. Bộ nhập chip dùng chung cho từ khóa/sở thích nay bỏ xử lý Enter, dấu phẩy và Backspace khi `isComposing` hoặc mã phím IME `229`; chỉ xử lý thêm/xóa chip sau khi bộ gõ hoàn tất. Giữ hành vi thêm bằng Enter/dấu phẩy, thêm nguyên cụm khi rời ô và chống trùng hiện có.

UI smoke bổ sung `Input.imeSetComposition`/`Input.insertText` trong Electron cho cả từ khóa và sở thích, kiểm tra hai dấu kết thúc, phím 229 và Backspace không xóa chip trước đó khi còn ghép chữ. Cả bộ UI smoke và hai typecheck đạt; không đổi CSS/runtime/DB. Chạy lại bằng `WEB_ENRICHMENT_UI_OUTPUT_DIR=docs/audits/web-enrichment-v398/ime-fix node scripts/run-web-enrichment-ui-smoke.cjs` để giữ ảnh audit ban đầu. Desktop chưa đóng gói/phát hành.

Rà soát tiếp ngày 15/10/2026: bổ sung cùng guard cho ô website, Hỏi AI chiến dịch, tên nhóm media, đổi tên danh sách không gửi tin và hai ô chọn nhóm Facebook/Zalo; ô hỏi chẩn đoán bổ sung trường hợp mã phím `229`. Các ô này không thêm mục/gửi/lưu/chọn nhóm khi bộ gõ còn cập nhật chữ. Enter thường giữ hành vi hiện có; Shift+Enter vẫn xuống dòng trong ô hỏi. Đây là bảo vệ xử lý bàn phím, không kết luận mọi ô đều có biểu hiện tách thành hai mục.

Kiểm chứng bản sửa tiếp: UI smoke Electron dùng composition thật cho ô website, không thêm URL chưa hoàn chỉnh, chỉ thêm một URL hoàn chỉnh và không submit modal; hồi quy từ khóa/sở thích và các ca UI hiện có đạt. 53 kiểm tra handler thực tế với callback giả lập đạt cho bảy ô: composition, mã `229`, Enter thường, Shift+Enter và mở danh sách bằng phím xuống. Hai typecheck sạch; không gọi AI/ghi dữ liệu thật trong smoke, không đổi DB/runtime, chưa đóng gói/phát hành.

## Sửa finding Enter tự lưu modal

Review sau đó phát hiện guard IME chỉ `return`, nên Enter vẫn có thể kích hoạt implicit submit của form. Đã tái hiện trong Electron/CDP: nhập composition rồi `input.press('Enter')` làm lưu một lần và đóng modal; smoke cũ chỉ phát DOM `keydown` nên bỏ sót hành vi mặc định này.

Đã sửa ở bộ chip dùng chung cho từ khóa/sở thích và ô website: khi đang composition hoặc mã phím `229`, Enter gọi `preventDefault()` trước khi trả về. Giữ nguyên draft cho bộ gõ hoàn tất, không thêm mục chưa hoàn chỉnh. Dấu phẩy/Backspace trong IME và Enter thường giữ hành vi cũ; nút Lưu vẫn dùng submit của form.

Smoke mới thất bại trên code trước sửa (`saved.length=1` thay vì `0`), đạt sau sửa. Kiểm tra bằng `Input.imeSetComposition` + `input.press('Enter')`, và `Input.dispatchKeyEvent` với mã `229` sau khi composition kết thúc: cả ba ô giữ modal mở, không gọi save và không mất draft; sau hoàn tất, Enter thường thêm đúng một mục. Enter khi focus nút Lưu cũng lưu đúng một lần. Cả UI smoke, hai typecheck và `git diff --check` đạt. Chỉ sửa Desktop; không đổi DB/RPC/default V401, chưa đóng gói/phát hành.

## Bật hoặc lưu trong cửa sổ 30 phút — 15/10/2026

Đây là bản sửa trước khi người dùng làm rõ cơ chế. Phần chọn giờ ngẫu nhiên và chờ đến mốc kế tiếp bên dưới đã được thay bằng [cửa sổ bắt đầu khi rảnh](#cửa-sổ-bắt-đầu-khi-rảnh--15102026).

Theo yêu cầu người dùng, bật/lưu cấu hình sau mốc nhưng trước khi hết cửa sổ vẫn cho nhận mốc chưa chạy. Ví dụ mốc `00:25`, lưu lúc `00:30`: chọn thời điểm trong phần còn lại trước `00:55`, cắt trước mốc kế tiếp hoặc nửa đêm nếu đến sớm hơn. Không tính lại một cửa sổ 30 phút mới từ lúc lưu. Lượt đã được nhận và không sửa cấu hình vẫn được chờ chiến dịch đến trước mốc tiếp theo theo hợp đồng cũ.

`configurationChanged()` chỉ trả lại mốc đang chờ chưa chạy để xét theo cấu hình mới; giữ các mốc đã chạy/lỗi/hủy hoặc bị bỏ do trùng phiên. Service tách vô hiệu hóa cache cấu hình khỏi `preempt()` của pause/login/thao tác tài khoản. Tắt riêng tính năng rồi bật lại được nhận mốc chưa dùng còn hạn; tạm dừng/vô hiệu hóa tài khoản hoặc thao tác chủ động vẫn không chạy bù. Khi sửa cấu hình trong lúc lướt, hủy trang phụ và không chạy lại mốc vừa dùng; giữ ưu tiên chiến dịch.

Mỗi cache account có generation trong RAM để loại phản hồi đọc cấu hình cũ đến sau khi lưu, không để phản hồi cũ đặt lại khoảng chờ tải cho cấu hình mới. Không thay RPC, bảng/cột, connection/pool, timer/polling hoặc dữ liệu tài khoản. Không có claim/runtime token DB mới.

Kiểm chứng: smoke mới thất bại trước sửa ở ca lưu lại mốc đang chờ trong cửa sổ, đạt sau sửa. `node scripts/web-enrichment-late-slot-smoke.cjs` đạt 23 ca trên planner/service/browser cancellation thật với clock/DB/page adapters offline: bật lần đầu, bật lại, sửa cục bộ/từ máy khác, biên 29:59/30:00/30:01, random trong phần còn lại, mốc kế tiếp/nửa đêm, hết ngày rồi gia hạn, slot trùng phiên, đã dùng/lỗi/hủy, pause/thao tác tài khoản, ưu tiên chiến dịch, cache giờ lạnh và phản hồi cấu hình cũ. Hồi quy 70 runtime + 58 scheduler handoff checks, hai typecheck và production build đạt. Log build: `/tmp/akaagent-web-enrichment-late-slot-build.log`. Không chạy chiến dịch hoặc điều hướng trên tài khoản khách để kiểm thử.

Rollback Desktop: hoàn nguyên thay đổi ở `webEnrichmentPlanner.ts` và `webEnrichmentService.ts` cùng kỳ vọng smoke; DB không đổi. Bản main cần khởi động lại `npm run dev` để có hiệu lực; HMR renderer không thay bộ chạy đang nằm trong RAM. Chưa đóng gói/phát hành Desktop.

## Cửa sổ bắt đầu khi rảnh — 15/10/2026

Người dùng xác nhận 30 phút là khoảng được phép bắt đầu, không phải khoảng bốc giờ ngẫu nhiên. Planner bỏ `random`/`due`, trả mốc sẵn sàng ngay từ mốc danh nghĩa và đặt `expires = min(mốc + 30 phút, mốc kế tiếp, nửa đêm Việt Nam)`. Lượt đã nhận nhưng còn chờ chiến dịch, profile/cache hoặc chỗ Desktop cũng không được bắt đầu từ `expires` trở đi. Lưu/bật trong phần còn lại không gia hạn cửa sổ.

Ví dụ `08:00`, mốc kế tiếp `12:00`: tài khoản rảnh lúc `08:00` hoặc trả về sau chiến dịch lúc `08:20` thì được bắt đầu ở lần xét kế tiếp; bận đến `08:30` thì bỏ mốc `08:00`. Bắt đầu lúc `08:29` với thời lượng 45 phút vẫn được lướt đến khoảng `09:14`, trừ khi có điều kiện hủy. Cửa sổ chỉ giới hạn giờ bắt đầu. Chu kỳ scheduler 30 giây và các lần bàn giao sau chiến dịch giữ nguyên, không thêm timer/polling/connection. Giữ ưu tiên chiến dịch sau phiên phụ, hủy do pause/thao tác tài khoản, chống chạy lại và giới hạn một phiên/Desktop. Ghi chú modal được sửa đồng bộ.

Kiểm chứng: smoke tái hiện việc chưa nhận ngay mốc đang còn hạn trên code cũ. Các ca mới chạy planner/service/browser fence và hàng đợi scheduler thật với adapter offline: rảnh ngay, chiến dịch kết thúc ở 29:59/30:00/sau hạn, mốc tiếp theo xa, chỗ Desktop/profile chỉ sẵn sàng sau hạn, và phiên bắt đầu sát hạn vẫn giữ đủ thời lượng. Không điều hướng hoặc chạy chiến dịch thật để kiểm thử.

Kết quả: 31 ca `web-enrichment-late-slot-smoke.cjs`, 70 checks `web-enrichment-runtime-smoke.cjs`, 62 ca `web-enrichment-handoff-smoke.cjs`, hai typecheck và production build đều đạt. Log build: `/tmp/akaagent-web-enrichment-start-window-build.log`.

Rollback riêng điều chỉnh này: hoàn nguyên planner, ghi chú trong `facebookWebEnrichment.ts` và kỳ vọng smoke liên quan; giữ bản sửa cache/revision/pause trước đó. Không sửa/apply DB/RPC. Main cần restart `npm run dev`; chưa đóng gói/phát hành Desktop.

Chạy lại: `WEB_ENRICHMENT_UI_OUTPUT_DIR=/tmp/akaagent-ime-submit-fix node scripts/run-web-enrichment-ui-smoke.cjs`.

## Hiển thị phiên lướt trong giao diện — 15/10/2026

Theo yêu cầu người dùng, phiên lướt có hình ảnh trực tiếp trong **Trình duyệt → tài khoản đang lướt**, với nhãn **Làm giàu lịch sử Web**, chấm đang chạy và thời điểm cập nhật. Dùng cùng kênh `CAMPAIGN_BROWSER_PREVIEW` và giao diện theo dõi của chiến dịch, cập nhật mỗi 2 giây. Không tự chuyển trang ứng dụng hoặc chọn thay tài khoản người dùng đang xem. Đây là hình ảnh của trang thực thi thật, chỉ để theo dõi; trang tạm vẫn dùng partition/proxy đã chuẩn bị và đóng được ngay khi hủy. Chưa có frame thì hiển thị đang tải; chuyển tài khoản vẫn giữ frame gần nhất của từng tài khoản.

`webEnrichmentPreview.ts` gắn capture vào đúng vòng đời trang tạm. Mỗi phiên chỉ có một capture đang chờ; lỗi capture/IPC không đi vào workflow hay error policy. Đóng trang, pause, timeout, renderer trang lỗi hoặc hoàn tất đều dọn timer và gửi kết thúc mà không chờ capture. Frame đến muộn bị bỏ. Payload mang `context=web-enrichment` và `runId` đã có của service; renderer chỉ nhận cleanup đúng chủ preview, không lấy frame cũ của chiến dịch/scan/phiên trước để gắn nhãn phiên mới.

Kiểm chứng:

- `node scripts/web-enrichment-preview-smoke.cjs`: factory thật của scheduler → kênh IPC, capture treo/lỗi, IPC lỗi, giới hạn một capture, cleanup timer và chống callback cũ xóa phiên/campaign/scan mới.
- `node scripts/run-web-enrichment-browser-smoke.cjs`: Electron thật trên HTTP local; frame thay đổi sau đọc/cuộn/đổi nội dung, cùng cookie partition; hoàn tất/HTTP lỗi/navigation treo/crash/pause đều đóng trang và gỡ preview, chặn lời gọi muộn.
- `node scripts/run-web-enrichment-preview-ui-smoke.cjs`: `BrowserPage` thật với fixture offline; ảnh trang thật, đang tải, đổi tab tài khoản, theme tối/sáng, chiều rộng 900px, phiên cũ kết thúc muộn, bàn giao chiến dịch. Đã xem screenshot tại `/tmp/akaagent-web-enrichment-preview/`.
- Hồi quy 31 ca cửa sổ + 70 checks runtime + 62 ca handoff đạt; hai typecheck và production build đạt. Log build: `/tmp/akaagent-web-enrichment-preview-build.log`.

Không chạy phiên Google hoặc chiến dịch thật trên tài khoản khách để kiểm thử. Không đổi DB/RPC/workflow/lịch/ưu tiên/tài nguyên admission; timer 2 giây chỉ capture trang, không query DB hay thêm polling nghiệp vụ. Rollback riêng phần hiển thị bằng gỡ wrapper preview ở factory, phục hồi kiểu/nhận preview và loading UI; giữ nguyên runtime hủy/lịch/config. Main/preload cần restart `npm run dev`; Desktop chưa đóng gói/phát hành.

## Sửa hai finding review preview — 15/10/2026

1. `observeWebEnrichmentChanges.ts` dùng `Array.from()` cho hai iterator `Map.keys()` và biến `before` giữ snapshot trước đó. Bản sửa này đã có trong working tree khi bắt đầu lượt xử lý hai finding; giữ nguyên và xác nhận bằng renderer typecheck. Không đổi target hoặc bật downlevelIteration toàn dự án.
2. Ảnh quét data trả chậm từng có thể vượt qua `stopBackgroundPreview`, ghi đè ảnh Web rồi khiến sự kiện kết thúc Web bị guard khác chủ bỏ qua. `ContactLoader` nay lưu timer trước capture đầu tiên, kiểm tra đúng timer trước khi chụp, sau khi chụp và trước khi bỏ dấu đang capture trong `finally`. Dừng/stop-all/lượt quét mới thay timer sẽ vô hiệu hóa callback cũ; kết quả hay lỗi muộn không thể ảnh hưởng lượt mới. Giữ nguyên kiểm tra chủ preview ở renderer, không dùng timestamp để suy ra thứ tự.

Smoke mở rộng trích đúng ba phương thức producer quét và chạy cùng `mergeBrowserPreview` thật. Ca stop → Web → ảnh quét muộn → Web kết thúc đã fail trên code cũ và pass sau sửa; bổ sung stop-all cùng tình huống, khởi động lại lượt quét khi capture cũ thành công/thất bại muộn, xác nhận callback cũ không bỏ dấu capture mới và không tạo hai capture cùng lúc. `node scripts/web-enrichment-preview-smoke.cjs`, Electron browser smoke và BrowserPage UI smoke đều đạt. Hai typecheck sạch; production build xác minh riêng với log `/tmp/akaagent-web-enrichment-review-fix-build.log`.

Chỉ sửa guard preview Desktop và smoke/audit; không thay logic quét data, scheduler/ưu tiên, RPC/DB hoặc thêm timer/connection. Rollback riêng guard tại `ContactLoader` sẽ trở lại rủi ro ảnh muộn; nên giữ chuyển iterator sang `Array.from()` để không làm hỏng typecheck. Main cần restart `npm run dev`; chưa đóng gói/phát hành Desktop.

## Kiểm chứng trước PR — 15/10/2026

Nhánh PR được dựng riêng từ `origin/dev_3`, chỉ gồm tính năng Web và các bản sửa Enter/preview liên quan. Phần tích hợp Chẩn đoán/pending reason nằm trong PR #495; PR này cung cấp runtime/IPC/types mà phần đó sử dụng.

- Hai typecheck Node và Web đạt; production build đạt trong 29,92 giây (`out/main` 2,9 MB, `out/preload` 64 KB, `out/renderer` 34 MB).
- 70 ca runtime/validation, 62 ca bàn giao scheduler, 31 ca cửa sổ lịch và 30 ca hồi quy chạy ngẫu nhiên đạt.
- Smoke workflow V404, preview và Electron browser đạt; kiểm tra timeout/crash/hủy, callback muộn, cùng partition và hình ảnh theo trang/cuộn thực tế.
- Smoke modal và BrowserPage đạt: Enter/IME, ba từ khóa/website, ô giờ 12:00, ngày dừng +7, cảnh báo lịch chồng, lỗi lưu, màn hình nhỏ, theme và bàn giao preview.
- Không chạy lại migration, không gọi Google/Facebook thật trên tài khoản khách, chưa đóng gói/phát hành Desktop.
