# Phụ lục: bản rà nguồn lỗi của cơ chế chạy chiến dịch

> Phụ lục của [docs/CAMPAIGN_OUTCOME_ENGINE.md](CAMPAIGN_OUTCOME_ENGINE.md). **Mỗi dòng sẽ thành một ca kiểm thử** của engine v2 (adapter giả sinh đúng lỗi đó; kiểm tín hiệu, mã, nhóm và chỉ thị).

- **Nguồn:** đọc code, **không truy vấn DB**. Số dòng theo:
  - akaAgent `08e7572a` (bản rà Zalo và Facebook/Email/workflow) và `2d7518e3` (bản rà scheduler/hạ tầng);
  - akaAgentChatApi `65b85ca`.
- **Cách đọc:** bản rà ghi lại hành vi tại thời điểm đọc. Số dòng có thể lệch sau các commit mới; luôn đối chiếu lại code khi viết ca kiểm thử.

## Chú giải

**Pha** (cột "Pha"):

| Ký hiệu | Nghĩa |
|---|---|
| B | `before_send`: chưa có gì tác động lên nền tảng |
| I | `in_flight`: đã gửi đi / đã bấm, không rõ kết quả |
| A | `after_send`: nền tảng đã trả lời |
| * | tuỳ node / bước nào lỗi |
| — | không áp dụng |

**Nhóm đề xuất:** 13 nhóm của [§2.2](CAMPAIGN_OUTCOME_ENGINE.md):
`target_permanent`, `target_temporary`, `unknown_delivery`, `already_done`, `account_restricted`, `quota`, `auth`, `content_config`, `ui_changed`, `transient`, `internal`, `cancelled`, `run_control`.

Quy đổi từ bản rà gốc:
- `cancel` và `ownership_lost` → `cancelled`
- `maintenance` → `run_control`
- `success` (mã 178/240) → `already_done`
- `unknown` giữ nguyên: chưa đủ thông tin để xếp, thường là `unknown_delivery`
- "theo mã", "theo nguyên nhân", "lẫn lộn", "kế thừa": phụ thuộc từng trường hợp

**Khoảng hở** (cột "Khoảng hở"):

| Ghi | Nghĩa |
|---|---|
| Nuốt | lỗi bị bỏ hoặc chỉ log |
| Sai nhóm | bị xếp sai loại (vd lỗi mạng thành lỗi nghiệp vụ) |
| Không mã | ghi kết quả không có mã lỗi |
| Thoát / Treo | lỗi thoát khỏi chỗ bắt, hoặc treo vô hạn |
| Kẹt | để lại lease / trạng thái kẹt |
| — | không có khoảng hở |

Bảng Facebook giữ ký hiệu gốc: S = nuốt, M = sai nhóm, N = không mã, E = thoát/treo.

---

## 1. Đường Zalo

**Đường dẫn viết tắt:**

| Ký hiệu | Đường dẫn |
|---|---|
| CS | `/Users/lequangnhut/Repos/akaAgent/src/main/services/campaignScheduler.ts` |
| ZR | `/Users/lequangnhut/Repos/akaAgent/src/main/services/zaloRuntimeService.ts` |
| ZW | `/Users/lequangnhut/Repos/akaAgent/src/main/services/zaloWebRuntimeService.ts` |
| CME | `/Users/lequangnhut/Repos/akaAgent/src/main/services/campaignMediaExecution.ts` |
| ZPS | `/Users/lequangnhut/Repos/akaAgent/src/main/services/zaloPhoneSearch.ts` |
| RGM | `/Users/lequangnhut/Repos/akaAgent/src/main/services/zaloRealtimeGroupCampaignManager.ts` |
| ENG | `/Users/lequangnhut/Repos/akaAgent/src/main/services/zaloCampaignEngagement.ts` |
| BE | `/Users/lequangnhut/Repos/akaAgent/src/main/v2/runtime/blockExecutor.ts` |
| ZCA | `/Users/lequangnhut/Repos/akaAgent/node_modules/zca-js/dist` (v2.1.2) |
| ACC | `/Users/lequangnhut/Repos/akaAgent/src/main/data/repositories/accountRepository.ts` |
| EPR | `/Users/lequangnhut/Repos/akaAgent/src/main/data/repositories/errorPolicyRepository.ts` |
| CCR | `/Users/lequangnhut/Repos/akaAgent/src/main/data/repositories/campaignContentRepository.ts` |
| CCP | `/Users/lequangnhut/Repos/akaAgent/src/shared/campaignContentPreparation.ts` |
| TPL | `/Users/lequangnhut/Repos/akaAgent/src/shared/campaignContentTemplate.ts` |
| SEX | `/Users/lequangnhut/Repos/akaAgent/src/shared/campaignSendExclusion.ts` |
| ZPC | `/Users/lequangnhut/Repos/akaAgent/src/shared/zaloPhoneCheck.ts` |
| SNAP | `/Users/lequangnhut/Repos/akaAgent/migrations/snapshots/fb-composer-target-error-v376/after.json` cùng migration_v378 (mã 222): bảng chính sách lỗi tại snapshot đó, không phải DB live |

**Viết tắt cho cột "Hiện xử lý":**
- **BF:** không chính sách nào khớp mã nên rơi về `err_zalo_api_business_failed` (policy id 18: detail `thất bại`, tính hạn mức, tính chuỗi mục tiêu lỗi). Input đánh `hoàn thành`, không thử lại; 5 lần liên tiếp thì tạm dừng chiến dịch (CS:14332-14341, CS:14560-14642).
- **UNDEF:** helper ném lỗi, block executor bắt (BE:91-99), bước lỗi, không ghi detail. Input `hoàn thành` kèm câu lỗi thô (CS:4503-4511); áp `err_undefined` cho chuỗi mục tiêu lỗi (CS:4527-4553).
- **RUN:** lỗi thoát lên catch cấp lượt (CS:3575-3603). Áp một lần chính sách `err_undefined` (bỏ qua nếu unit đã chạy chính sách), rồi gọi RPC dọn dẹp.
- **UNC:** ghi chú dừng runtime "không xác định kết quả" (CS:683-689). Input `hoàn thành`, chiến dịch `chờ xử lý`, không detail.

| Mã ca | Lớp | Lỗi gì | Ở đâu | Hiện xử lý | Pha | Nhóm đề xuất | Khoảng hở |
|---|---|---|---|---|---|---|---|
| ZL-A1 | lifecycle | Chưa tạo Zalo runtime | CS:14981 và dòng đầu mọi helper; preflight CS:9434-9439 | Helper ném "Zalo runtime chưa sẵn sàng" → UNDEF; preflight chỉ ghi note | B | internal | Thoát; đốt mục tiêu |
| ZL-A2 | lifecycle | Yêu cầu tắt/bàn giao trước khi helper chạy | CS:1155; unit đã đánh dấu bắt đầu ở CS:4316; catch CS:4658-4685 | UNC dù chưa gửi gì | B | internal | Mất mục tiêu |
| ZL-A3 | lifecycle | Tắt/bàn giao chen giữa lúc đang gửi hoặc lúc nhận phản hồi | CS:1158/1163, 15395 → 15418, 4377, 4455-4463; chia sẻ CS:6188, 6278 → 6573-6597 | UNC; kết quả đã biết bị bỏ (không detail, không tính hạn mức). Batch chia sẻ: input đã bắt đầu → `hoàn thành` + UNC, chưa bắt đầu → `chờ xử lý` | I | unknown_delivery | Nhỏ: bỏ kết quả đã biết |
| ZL-A4 | lifecycle | Runtime bỏ claim (write barrier) | CS:1150-1152, 4437, 4662, 9321-9325 | Return im lặng; chủ mới phục hồi | * | internal | — |
| ZL-B1 | session | Kiểm phiên trước lượt ném lỗi (DB/mạng) | CS:9443-9461 | Log; note chiến dịch "chưa đăng nhập hoặc phiên đăng nhập đã hết hạn"; không chạy | B | transient/internal | Báo nhầm thành lỗi đăng nhập |
| ZL-B2 | session | Kiểm session đã lưu lỗi tạm thời (fetch failed, timeout, ECONN*, 429, 5xx), sau một lần thử đăng nhập lại | ZR:2969-2993 → 2883-2895 → ACC:794 | Giữ session nhưng `login_status='chưa đăng nhập'`; sau đó "Tài khoản bị đăng xuất" → `err_logout` (CS:9426, 9475-9477) | B | transient | Lỗi tạm thời thành đăng xuất |
| ZL-B3 | session | Kiểm session lỗi với câu "chắc chắn" (so khớp chữ) | ZR:2913-2954 → 2898-2910 | Xoá session local, phải quét QR lại. Chỉ so chữ: "Request failed with status code 401/403" không khớp nên bị coi là tạm thời | B | auth | Nhỏ |
| ZL-B4 | session | Lúc gửi: `ensureApi` đọc DB lỗi, thiếu tài khoản, "Chưa có session Zalo", hoặc tài khoản không phải Zalo | ZR:600-610, 1883-1884 | Trong try của helper → BF | B | auth/internal | Sai nhóm |
| ZL-B5 | session | Đăng nhập cookie zca lỗi giữa lượt ("Missing required params", "Đăng nhập thất bại", "Khởi tạo ngữ cảnh thất bại", "Failed to fetch login/server info", "Missing signkey") | ZR:3003-3006; ZCA zalo.js:42,61,70 và apis/login.js:8,24,33,36 | BF cho mọi mục tiêu còn lại; session không bị vô hiệu | B | auth/transient | Có |
| ZL-B6 | session | Tra proxy hoặc tạo proxy agent lỗi | ZR:3009-3012, 3265-3268 | BF | B | content_config/transient | Có |
| ZL-B7 | session | Proxy của tài khoản đã tắt | ZR:3010 | Lặng lẽ kết nối không qua proxy | B | content_config | Đổi IP âm thầm |
| ZL-B8 | session | Zalo trả mã 600 | Policy `err_zalo_session_invalid` (SNAP id 16) → CS:14397-14402 | Login → `chưa đăng nhập`, vô hiệu tài khoản, dừng sau mục tiêu, input về hàng đợi | A | auth | — |
| ZL-B9 | session | Guard tài khoản 5 giây hoặc server control thấy đăng xuất, đổi trạng thái, dừng hẳn | CS:4270-4302, 5815-5832, 9420-9429 | Huỷ; input về hàng đợi trừ khi đã giao (CS:4439-4453); lỗi đọc của guard chỉ console.error | B/I | auth/internal | Nhỏ: nuốt lỗi guard |
| ZL-B10 | session | Kết bạn / thêm thành viên / vào nhóm thành công rồi bị dừng tài khoản hoặc huỷ | CS:14714-14718 (cờ đã giao chỉ cho nhắn tin), CS:4444-4449 | Input về hàng đợi → lần sau làm lại | A | internal | Nhỏ: lặp tác động |
| ZL-C1 | listener | `listener.start()` ném lỗi (không phải "already started") | ZR:2531-2543 | Chỉ được await với tệp không phải ảnh (ZR:1907) → BF; còn lại bị nuốt (ZR:1910-1915) | B | transient | Có |
| ZL-C2 | listener | Listener chưa sẵn sàng sau 20 giây | ZR:2786-2789 (hằng ZR:425) | Gửi tệp → BF | B | transient | Có |
| ZL-C3 | listener | Listener đóng trước khi sẵn sàng (3000 trùng kết nối, 3003 bị đá, mã khác) | ZR:2658-2666, 2781-2783; ZCA apis/listen.js:12-16, 121-139 | BF; mã đóng chỉ nằm trong câu lỗi | B | auth/transient | Không map mã đóng |
| ZL-C4 | listener | Trạng thái listener hoặc QR runtime bị reset lúc khởi động | ZR:2773-2775, 766-771 | BF / UNDEF | B | internal | Có |
| ZL-C5 | listener | Buộc khởi động lại listener cũ hơn 30 phút trước khi gửi tệp, lỗi | ZR:1904, 2497-2506 | BF | B | transient | Có |
| ZL-C6 | listener | Listener rớt khi đang chờ callback upload video/tệp | ZCA apis/uploadAttachment.js, CME:69-91 | Chờ tới hạn media 180 giây → xem ZL-E6 | I | unknown_delivery | — |
| ZL-D1 | content | Mẫu render rỗng, hoặc HTML định dạng chuyển ra rỗng | CS:14765-14777, 14814-14817 → ZCA sendMessage.js "Missing message content" | BF (tính hạn mức và chuỗi lỗi); đường theo mục tiêu không kiểm rỗng trước khi gửi (batch chia sẻ có, CS:5551, 5849) | B | content_config | Sai nhóm |
| ZL-D2 | content | Token ngày tương đối cần đồng hồ DB và đọc lỗi | CS:14740-14746, TPL:13; gọi ngoài try của helper ở CS:15382, 15463, 15534, 15781-15787, 16057 | UNDEF | B | transient/internal | Thoát |
| ZL-D3 | content | RPC chỉ số nội dung lỗi, hoặc thiếu unit token | CS:16919-16929; CCR:5-30; CCP:37-45 | UNDEF (ngoài try) | B | transient/internal | Thoát |
| ZL-D4 | content | AI viết lại lỗi hoặc trả rỗng (theo mục tiêu) | CS:14862-14927 | Nuốt → dùng câu gốc + sự kiện cảnh báo | B | content_config | — |
| ZL-D5 | content | AI viết lại lỗi (batch chia sẻ) | CS:6059-6087 | Nuốt; chỉ console, không log tiến trình | B | content_config | Nhỏ: im lặng |
| ZL-D6 | content | Tin quá dài → Zalo 118 | SNAP id 14 | `thất bại`, chiến dịch `tạm dừng` | A | content_config | — |
| ZL-D7 | content | Lời mời kết bạn quá 150 ký tự | CS:15781-15783 | Cắt im lặng còn 150 | B | content_config | Nhỏ |
| ZL-D8 | content | Tên gợi nhớ render rỗng | CS:16057-16078 | Detail `tham số không hợp lệ`, không gọi API | B | content_config | — |
| ZL-D9 | content | Tài khoản chưa cấu hình tag | CS:15942-15948 | Bỏ qua kèm log, không detail | B | content_config | Nhỏ |
| ZL-D10 | content | Nội dung nâng cao sai, hoặc nội dung chia sẻ rỗng | CS:5542-5560, 5849-5853, 16870-16904 | Chiến dịch `chờ xử lý` + note, hoặc batch về hàng đợi | B | content_config | — |
| ZL-D11 | content | RPC kiểm opt-out lỗi | CS:7017-7025, 7088-7096 | Thêm cảnh báo, **vẫn gửi** | B | internal | Nuốt (có thể nhắn người đã từ chối) |
| ZL-D12 | content | Tạo link opt-out lỗi | CS:7151-7171 | Cảnh báo; footer dùng trang lỗi | B | internal | Nhỏ |
| ZL-M1 | media | Thiếu tệp media local; tải cloud non-2xx, lỗi mạng, quá 60 giây | CS:17431-17486 | Không trì hoãn: input về hàng đợi + chiến dịch `tạm dừng` (CS:4741-4744, 17512-17520); chia sẻ: tạm dừng (CS:5972). **Trì hoãn** (workflow Zalo 260/262/266-277/280/281 bật qua migration_v351 → CS:3669): media giải trong helper, ngoài try (CS:16937) → UNDEF, không tạm dừng | B | content_config/transient | Thoát khi trì hoãn; tải tạm thời lại tạm dừng chiến dịch |
| ZL-M2 | media | Media giải ra URL `data:` | CS:17437, 17446 cho qua → ZCA uploadAttachment.js "File not found" | BF | B | content_config | Có |
| ZL-M3 | media | Không đọc được kích thước ảnh, hoặc tệp đã mất | ZR:177-186 → ZCA utils.js:306-309 "Failed to get image metadata"; mã fs ENOENT | BF; log thành "mã Zalo: ENOENT" | B | content_config | Có |
| ZL-M4 | media | SDK kiểm trước upload: quá số tệp, đuôi bị chặn, quá dung lượng, nguồn sai | ZCA uploadAttachment.js / sendMessage.js | BF, lặp cho mọi mục tiêu | B | content_config | Có |
| ZL-M5 | media | Tài khoản Zalo Web + tệp không phải ảnh | ZR:1886-1888 | BF cho mọi mục tiêu | B | content_config | Có |
| ZL-T1 | target | Thiếu SĐT/UID/ID nhóm/link (mã 114 do app tự đặt) | CS:14983, 15082, 15153, 15176, 15216, 15440, 15519, 15585, 15667, 15831; chia sẻ CS:5741, 6310, 6328-6353 | Policy `err_zalo_invalid_param` (SNAP id 8): `thất bại`, tính hạn mức + chuỗi lỗi | B | target_permanent | Nhỏ: dữ liệu xấu đẩy chuỗi tạm dừng |
| ZL-T2 | target | SĐT không được chuẩn hoá/kiểm (chỉ kiểm rỗng) | CS:14982, 10489; ZR:1579-1583 (chỉ đổi 0 đầu → 84) | Số sai định dạng tới Zalo → 219/216 | A | target_permanent | Phí lượt tra |
| ZL-T3 | target | findUser thành công nhưng không có UID | ZR:3429-3444 → CS:15007-15019 (mã 216 tự đặt) | `không tồn tại` | A | target_permanent/ui_changed | Nhỏ: đổi cấu trúc API trông như không tồn tại |
| ZL-T4 | target | findUser mã 216/214/212, 219, 210 | SNAP id 7, 56, 58 qua CS:15066-15071 | `không tồn tại` | A | target_permanent | — |
| ZL-T5 | target | Lần tra đầu (request source 32) lỗi | ZPS:27-40 | Mã không phải hạn mức → ném lại. Không mã ("fetch failed" thuần) → lặng lẽ thử lại với source 40. Lỗi proxy mang mã ECONNRESET → ném lại, không thử lại | B/A | transient | Thử lại không nhất quán; tra gấp đôi |
| ZL-T6 | target | Mã hạn mức tra 221/312 (giờ), 313/304 (ngày) | ZPS:33-56; SNAP id 9, 36 | Tự tra lần hai (source 40) sau khi chạm hạn mức; rồi khoá tra 60 phút / tới cuối ngày; input về hàng đợi | A | quota | Lần tra thêm sau 221 có nguy cơ khoá 312 |
| ZL-T7 | target | Đọc chính sách hạn mức lỗi | ZR:1611-1624 | Nuốt → coi như không phải hạn mức | A | quota | Nhỏ |
| ZL-T8 | target | `getUserProfile` lỗi trước khi gửi bạn bè/người lạ | CS:14283-14297 | Nuốt (chỉ giữ cho kiểm loại trừ); vẫn gửi | B | transient/auth | Nhỏ |
| ZL-T9 | target | Tra số OK rồi ghi DB lỗi (upsert danh bạ, cập nhật input, tạm dừng opt-out) | CS:15023-15035, 15048 → 6890; catch CS:15066 | BF "Tìm SĐT thất bại" dù tra được | A | internal | Sai nhóm |
| ZL-T10 | target | Upsert hồ sơ lỗi (ngoài try) | CS:15108, 15134, 15202, 15242, 15460; chia sẻ CS:5753 | UNDEF / RUN | B | internal | Thoát |
| ZL-T11 | target | Đọc nguồn loại trừ gửi lỗi | SEX:137; CS:6974-6984 | Thành "unknown" → input `tạm dừng`; lỗi mang mã Zalo áp thêm chính sách | B | transient | Nhỏ |
| ZL-T12 | target | RPC loại trừ gửi lỗi | Luồng SĐT: CS:7125-7133 → 4415 → RUN + chiến dịch `tạm dừng` (CS:3580); luồng khác: CS:4006 → 7071 không bắt → RUN + `err_undefined` | Như cột "Ở đâu" | B | internal | Không nhất quán |
| ZL-T13 | target | Opt-out, loại trừ, blocklist hoặc cooldown chặn gửi | CS:6885-6905, 6984, 4000, 4010-4019 | Input `tạm dừng`, bỏ qua, hoặc hoãn | B | target_permanent | — |
| ZL-E1 | transport | Upload lỗi mạng (socket hang up / ECONNRESET tới tt-files-wpa.chat.zalo.me) | ZCA uploadAttachment.js (upload chunk song song) → CME:104-117 → CS:15425 | Mã null hoặc "ECONNRESET" → BF; không thử lại | B | transient | Sai nhóm |
| ZL-E2 | transport | Lỗi mạng ở chính request gửi tin | ZCA sendMessage.js `send()` | BF | I | unknown_delivery | Có |
| ZL-E3 | transport | HTTP 429, 5xx, 401/403 | ZCA utils.js:580-585 "Request failed with status code N" | BF (không mã) | A | quota/transient/auth | Có |
| ZL-E4 | transport | Không đọc/giải mã được phản hồi | ZCA utils.js:604-610 | BF | A | unknown_delivery | Có |
| ZL-E5 | transport | Gửi chữ quá 90 giây (chỉ hẹn giờ, không huỷ request) | ZR:1929-1936, 2817-2847 | Error thường → BF; Zalo có thể vẫn giao sau | I | unknown_delivery | Có |
| ZL-E6 | transport | Gửi media quá 90 giây (ảnh) / 180 giây (tệp) | CME:93-118, 14-22; ZR:1918-1927 | Mã `campaign_media_timeout` → không thử lại, dừng các bước còn lại (CS:14573, 14625) nhưng trạng thái `thất bại` qua BF; tính hạn mức + chuỗi lỗi | I | unknown_delivery | Nhỏ: hiện thành thất bại |
| ZL-E7 | transport | Session dừng giữa lúc gửi media | CME:120-128 (mã `command_result_unknown`) | Không thử lại + dừng sau mục tiêu (CS:14574, 14629); trạng thái `thất bại` | I | unknown_delivery | Nhỏ |
| ZL-E8 | transport | Media execution đã dừng (API cũ/vô hiệu) | ZR:1925 + CME:94, 24-28 (mã `campaign_runtime_unavailable`) | Không xử lý riêng → BF | B | transient | Có |
| ZL-E9 | transport | Upload trả file/photo ID "-1" | ZCA uploadAttachment.js để rỗng → TypeError trong sendMessage | BF ("Cannot read properties of undefined") | A | account_restricted/unknown | Có |
| ZL-E10 | transport | Gửi trả `message` null hoặc "" (không msgId) | ZR:1861-1937; CS:15253-15314 (không kiểm) | Ghi `thành công`, đã giao, tính hạn mức | A | unknown_delivery | Có |
| ZL-E11 | transport | Giao một phần ẩn trong một lời gọi SDK: 1 tệp không phải ảnh (hoặc GIF) + chữ thường | CS:15308; ZCA sendMessage.js gửi chữ trước | Tệp lỗi làm cả lời gọi lỗi → BF, không cờ giao một phần, chữ đã tới | I/A | unknown_delivery | Có |
| ZL-E12 | transport | Album 2+ tệp giao một phần | ZCA `send()` song song; CME:113 huỷ phần còn lại; CS:15270-15284 | Mã của lỗi đầu tiên → chính sách hoặc BF; ảnh đã tới không được ghi; chữ không gửi | I | unknown_delivery | Có |
| ZL-E13 | transport | Giao một phần rõ ràng (media rồi chữ, hoặc chữ rồi media) | CS:15276-15305 → 15316-15370 | `thất bại`, đánh dấu đã giao, không thử lại; buộc tính hạn mức kể cả 122 | A | theo nguyên nhân + giao một phần | Nhỏ |
| ZL-E14 | transport | Mã Zalo đã có luật: 122/119 (người nhận chặn), 120/802 (hạn chế người lạ), 123/127/126 (quá nhanh, trùng, từ chối), 221 (giờ) | SNAP id 10-11, 42-52, 60-62 | Theo chính sách; 120/802 khoá nhắn người lạ 24/48 giờ, không detail → về hàng đợi | A | target_permanent/account_restricted/quota | Theo CLAUDE.md, RPC settle biến lần về hàng đợi đó thành `tạm dừng` vĩnh viễn |
| ZL-E15 | transport | Zalo trả mã chưa có luật (vd 112 nhóm từ chối, mã mới) | CS:14332-14341 | BF | A | unknown | Mã lạ mặc định thành lỗi mục tiêu |
| ZL-E16 | transport | SDK kiểm: thiếu threadId, mention sai, lỗi mã hoá | ZCA sendMessage.js | BF | B | internal | Có |
| ZL-E17 | transport | Lời gọi Zalo không phải gửi tin, hoặc đăng nhập QR, bị treo | ZR:1598, 1632, 1653, 2178, 2183, 1698-1769, 1810-1816, 2204, 2251, 2260, 3005; BE:79-83 (VM timeout chỉ phủ code đồng bộ) | Không hạn giờ, không huỷ; chiến dịch kẹt `đang chạy` (khoảng 300 giây với fetch mặc định; có proxy thì không giới hạn) | I | transient | Treo |
| ZL-S1 | share | Lời gọi forward cho tới 50 mục tiêu quá 90 giây, lỗi mạng hoặc HTTP | ZR:1991-1997; CS:6268-6276, 6407-6416 | BF cho mọi mục tiêu; batch không có thành công nào → chiến dịch `tạm dừng` (CS:6546-6552) + `err_undefined` từng mục tiêu (CS:6525-6544) | I | unknown_delivery | Thất bại giả hàng loạt |
| ZL-S2 | share | Phản hồi forward thiếu dòng của một mục tiêu | ZR:2160-2164, 2010-2014 | "Không xác định được kết quả…" không mã → BF | A | unknown_delivery | Có |
| ZL-S3 | share | Ghép dòng theo vị trí (dự phòng theo số lượng) | ZR:2116-2118, 2141-2159 | Thành công/thất bại gán theo thứ tự | A | unknown_delivery | Nhỏ |
| ZL-S4 | share | Dòng thất bại có mã theo từng mục tiêu | ZR:2122-2131; CS:6417-6433, 6670-6703 | Chính sách theo mã; batch lẫn lộn thì chỉ áp mục tiêu (không hiệu ứng phụ) | A | theo mã | — |
| ZL-S5 | share | Forward tới chính UID tài khoản gửi (mã 114 tự đặt) | ZR:1969-1985 | `err_zalo_invalid_param` | B | content_config | — |
| ZL-S6 | share | Chính sách dừng ở pha media; chữ chưa được forward | CS:6245-6259 | Lỗi tổng hợp → BF + "Đã gửi file nhưng gửi nội dung thất bại" | B | internal | Nhỏ: ghi nhầm nhãn |
| ZL-S7 | share | Media hết giờ hoặc không rõ theo từng mục tiêu | CS:6194-6225 | Ghi detail ngay + xử lý mục tiêu lỗi | I | unknown_delivery | — |
| ZL-S8 | share | Ghi kết quả batch vào DB lỗi | CS:6561-6567 → 5972-5978 | RUN; mục tiêu đã gửi không có detail | A | internal | Thoát |
| ZL-S9 | share | Đọc sức chứa/trạng thái khoá lỗi | CS:5984-6038 | RUN | B | internal | Nhỏ |
| ZL-S10 | share | Input thiếu UID/ID nhóm | CS:5740-5743, 6328-6377 | Chính sách mã 114 | B | target_permanent | — |
| ZL-W1 | web | Không có tab Zalo Web, hoặc tab đóng khi đang chờ (khởi động bị chặn bởi CS:957-959) | ZW:570-572, 1032-1034 | BF theo từng mục tiêu giữa lượt | B | auth | Có |
| ZL-W2 | web | Debugger trình duyệt chưa gắn/chưa sẵn sàng | ZW:573-575, 600-625 | BF | B | internal | Có |
| ZL-W3 | web | Không bắt được bootstrap đăng nhập (getlogininfo/getserverinfo) trong 30 giây, hoặc không đọc được | ZW:1026-1052, 642-658, 725-768, 117-129 | BootstrapUnavailableError → BF, hoặc note preflight | B | auth/ui_changed | Có |
| ZL-W4 | web | Đã thử phục hồi session rồi | ZW:577-579 | BF | B | auth | Có |
| ZL-W5 | web | Xác minh: không có hồ sơ, UID lệch, generation đổi, thiếu settings | ZW:931, 933-935, 937-943, 953-960, 862 | BF | B | auth/internal | Có |
| ZL-W6 | web | Trang bootstrap lại hoặc đổi tài khoản huỷ request đang bay | ZW:781, 753, 1066-1070, 994, 1020-1021 | "Phiên Zalo Web đã thay đổi…", hoặc lỗi abort mã 20 bị log thành "Zalo code 20" → BF | I | unknown_delivery | Có |
| ZL-W7 | web | Gửi web quá 90 giây (chữ và ảnh; không media execution, không abort) | ZR:1892-1898 | BF | I | unknown_delivery | Có |
| ZL-W8 | web | Chiến dịch realtime trên tài khoản web | ZR:762-764; ZW:925-927 | Realtime manager log cảnh báo; không có sự kiện | B | content_config | Nhỏ: im lặng |
| ZL-G1 | add-member | Đọc thông tin nhóm lỗi, hoặc thiếu/tắt link nhóm cho cách chia sẻ | ZR:1698, 1709-1713 | BF (không tính hạn mức, có tính chuỗi lỗi) | B | content_config/transient | Có |
| ZL-G2 | add-member | Phản hồi mời có dòng rỗng | ZR:1747-1758 | Coi như "đã mời" thành công | A | unknown_delivery | Nhỏ |
| ZL-G3 | add-member | Mã 178 (đã là thành viên), 0/262/263 (đã thêm/đã mời); mã khác ném kèm mã (264/269, 314, 120/802, 126) | ZR:1729-1788; SNAP id 17, 35, 43, 45, 51, 59 | Tương đương thành công hoặc theo chính sách | A | theo mã | — |
| ZL-G4 | add-member | Phản hồi thêm liệt kê thành viên là error member | ZR:1789-1801 | "Đã mời" thành công | A | — | — |
| ZL-G5 | join | Đọc thông tin link trước khi vào lỗi (227…); vào nhóm trả 178/240 | ZR:1810, 1825-1838; SNAP id 57 | Chính sách; 178 → `đã tham gia`, 240 → thành công đang chờ duyệt | A | target_permanent/already_done | — |
| ZL-G6 | join | Đã vào nhóm rồi upsert danh bạ lỗi | CS:15689 (trong try) | BF dù đã vào được | A | internal | Có |
| ZL-G7 | friend request | Mã 222 (đã chấp nhận → thành công từ v378), 225, 215/251, 221, 223/224 (tạm dừng), 311 | CS:15809-15818; SNAP | ok/fail suy từ trạng thái detail | A | theo mã | — |
| ZL-G8 | cancel request | undoFriendRequest lỗi | CS:15878-15890 | Chính sách hoặc BF | A | target_temporary/unknown | Nhỏ |
| ZL-G9 | tag | Ngữ cảnh tag vô hiệu, hoặc thuộc tài khoản khác | ZR:2192-2198, 2220-2222 | BF (không tính hạn mức) | B | internal | Có |
| ZL-G10 | tag | Tag không tồn tại | ZR:2225 → CS:16008-16031 | `tag không tồn tại` | B | content_config | — |
| ZL-G11 | tag/alias | Kiểm quan hệ bạn bè trước lỗi | CS:15907-15913 (`catch {}`) | Chạy tiếp kèm cảnh báo | B | transient | Nhỏ: nuốt |
| ZL-G12 | alias | changeFriendAlias lỗi | CS:16094-16103 | Chính sách hoặc BF | A | theo mã | — |
| ZL-P1 | persistence | Chèn detail lỗi sau khi đã gửi thành công | CS:11207-11220 → 4627-4732 | Input `hoàn thành` + `err_undefined`; không detail, hạn mức đếm thiếu; RUN nếu unit đã chạy chính sách (CS:4641) | A | internal | Có |
| ZL-P2 | policy | Ghi hiệu ứng chính sách lỗi | CS:14386-14429; CS:9925-9934 lưu lỗi lại | UNDEF; mọi lần gọi chính sách sau trong unit ném lại lỗi đó → RUN; mất phản hồi của Zalo | A | internal | Thoát |
| ZL-P3 | policy | Tra chính sách lỗi ngoài catalog đã nạp | EPR:52-80 | Như ZL-P2 | A | internal | Có |
| ZL-P4 | persistence | Chèn log lỗi API Zalo lỗi | CS:14520-14527 | Chỉ console.warn | A | internal | Nuốt |
| ZL-P5 | persistence | Claim hoặc settle unit lỗi | CS:9118-9143, 9330-9373 | Thử lại mỗi 2 giây vô hạn | B | internal | — |
| ZL-P6 | persistence | Mất quyền sở hữu unit | CS:1875, 1893, 5263, 7596 → 3578 | RUN return im lặng | B | internal | Nhỏ |
| ZL-P7 | persistence | Catalog / khai báo kết quả workflow sai | CS:3531-3555 | RUN + chiến dịch `tạm dừng` | B | content_config | — |
| ZL-P8 | persistence | Đẩy SMS fallback lỗi | CS:11069-11078 | Chỉ cảnh báo | A | internal | Nuốt |
| ZL-P9 | engine | Không nạp được workflow hoặc block (engine run ném) | CS:4317 → 4627 | Input `hoàn thành` + `err_undefined` | B | internal | Nhỏ |
| ZL-R1 | materialize | Đọc bạn bè/nhãn/gợi ý/lời mời đã gửi lỗi | CS:8095-8128, 7994-8019 | HTTP 429 thử lại sau 15/30/60 giây; còn lại → RUN + `err_undefined` | B | quota/transient/auth | Nhỏ |
| ZL-R2 | materialize | Tag nguồn thiếu hoặc sai | CS:8154-8156 | RUN + `err_undefined` | B | content_config | Có |
| ZL-R3 | materialize | Đọc lời mời đã gửi trả mã 112 | ZR:1234-1241 | Coi như danh sách rỗng | A | — | — |
| ZL-RT1 | realtime | Lưu sự kiện nhóm realtime lỗi (DB hoặc đồng hồ) | RGM:458-505 | Nuốt → mất sự kiện | A | internal | Mất im lặng |
| ZL-RT2 | realtime | Listener ngắt hoặc đóng | RGM:265-283 | Sự kiện trong khoảng ngắt không được bù | I | transient | Có |
| ZL-RT3 | realtime | Khởi động listener hoặc kiểm session lỗi | RGM:235-241, 294-352 | Cảnh báo; tài khoản đã đăng xuất có note chiến dịch | B | auth/transient | Nhỏ |
| ZL-Z1 | codes (công cụ kiểm SĐT, không phải chiến dịch) | classifyZaloPhoneCheckApiCode | ZPC:24-31 | 312/221 → hạn mức giờ, 313/304 → hạn mức ngày, 0 → tìm thấy, **mọi số khác → not_found** | A | quota/target_permanent | 600/120… thành not_found |
| ZL-X1 | swallow | Bỏ lỗi hoàn toàn (`catch {}`, `.catch(() => {})`, `.catch(() => null)`) trên đường chạy | ZR:461, 540, 895, 984, 2607, 2828, 2905, 3335; CS:1275-1276, 3596, 4337, 4347, 4594, 4644, 6869, 6881, 6925, 9389, 9411, 9448, 9458, 14414, 15911, 16173, 17528; ZW:304-306, 349-356, 557, 683; RGM:80, 153, 536, 611, 619 | Bỏ đi | — | internal | 4594/4644/9389: đọc điều khiển lỗi bị coi là "không dừng"; 6869: mất note input |
| ZL-X2 | swallow | Log rồi chạy tiếp, làm đổi kết quả | CS:14288, 7020, 7091, 7161, 6079, 14906, 7937, 15986, 14520, 14853, 4299, 5830, 9453; ZR:823, 833-856, 1617, 1910, 2454, 2572, 2579-2590, 2803; ZW:828-837; RGM:114, 235, 316, 345, 490, 563; ENG:389, 421, 453, 484 | console warn/error rồi chạy tiếp | — | — | Xem ZL-B1, ZL-D11, ZL-T7, ZL-T8, ZL-RT1 |

**Mã Zalo viết cứng trong TS:**
- **114:** tham số sai. App tự đặt khi thiếu SĐT/UID/nhóm/link (các dòng CS ở ZL-T1) và khi forward tới chính UID (ZR:1979-1982).
- **216:** không tồn tại. Tự đặt khi findUser không trả UID (CS:15016).
- **112:** đọc lời mời đã gửi coi như danh sách rỗng (ZR:1235).
- **178:** đã là thành viên / đã tham gia (ZR:1461, 1735, 1772, 1827).
- **240:** yêu cầu tham gia chờ duyệt (ZR:1461, 1827).
- **0 / 262 / 263:** mời: đã thêm / đã mời (ZR:1747).
- **221/312, 313/304:** hạn mức tra giờ / ngày trong công cụ kiểm SĐT (ZPC:28-29).
- **429:** HTTP giới hạn tốc độ khi đọc (CS:8010-8014).
- **32 / 40:** giá trị request source của findUser (ZR:152, ZPS:28, 43).

Mọi mã Zalo khác (600, 120, 802, 122, 221 theo thao tác…) chỉ được map trong bảng chính sách DB.

**Khoảng hở lớn (Zalo):**
1. **Nhiều loại lỗi khác nhau cùng rơi vào BF:** lỗi mạng, HTTP 429/5xx, phản hồi không đọc được, hết giờ hẹn (chữ 90 giây, forward 90 giây, web 90 giây), mã execution cũ `campaign_runtime_unavailable`, abort web, dòng forward không ghép được. Tất cả thành `thất bại`, tính hạn mức và chuỗi lỗi, không thử lại, kể cả khi chưa có gì tới Zalo hoặc không rõ kết quả.
2. **Pha gửi vô hình bên trong sendMessage của zca:** không tách được upload với request gửi. "Chữ + 1 tệp" bị tách ngầm; album có thể giao một phần; thành công mà msgId rỗng vẫn bị ghi là đã giao.
3. **Chuẩn bị nội dung chạy ngoài try của helper:** đồng hồ DB, RPC chỉ số nội dung, giải media, upsert hồ sơ. Workflow Zalo dùng nội dung trì hoãn nên các lỗi này thành `err_undefined` và đốt mục tiêu; thiếu media không còn tạm dừng chiến dịch.
4. **Lỗi ghi DB của mình sau khi thành công bị báo sai:**
   - tra số + ghi DB lỗi thành "Tìm SĐT thất bại";
   - vào nhóm + upsert lỗi thành thất bại;
   - chèn detail lỗi sau khi đã gửi thành `err_undefined`, hạn mức đếm thiếu.
5. **Auth:** kiểm session lỗi tạm thời đặt `login_status='chưa đăng nhập'`. Lúc gửi chỉ mã 600 được coi là auth; lỗi đăng nhập, bootstrap, đóng listener (3000/3003) đều làm hỏng từng mục tiêu theo BF.
6. **Batch chia sẻ:**
   - một lần forward hết giờ làm hỏng cả ≤50 mục tiêu và tạm dừng chiến dịch;
   - ghép kết quả theo vị trí;
   - lỗi DB giữa lúc ghi làm mất kết quả của mục tiêu đã gửi.
7. **Lỗi cài đặt làm hỏng từng mục tiêu thay vì dừng chiến dịch một lần:** chữ rỗng, đuôi / dung lượng bị chặn, URL `data:`, ảnh không đọc được, tệp không phải ảnh trên web, link nhóm tắt, ngữ cảnh tag.
8. **Treo:** chỉ sendMessage và forward có hạn giờ. Các lời gọi Zalo khác và đăng nhập QR không có hạn giờ hay abort; VM timeout của block không phủ code async.
9. **Tra số:** findUser tự tra lần hai sau mã 221; cách thử lại khi lỗi mạng khác nhau giữa có và không có proxy; SĐT không được chuẩn hoá.
10. **Mất im lặng:**
    - lưu sự kiện realtime lỗi; khoảng ngắt listener không được bù;
    - kiểm opt-out lỗi mà vẫn gửi;
    - AI lỗi ở chế độ chia sẻ;
    - dừng runtime trước khi gửi bị ghi thành "không xác định".

**Đường thoát / treo (Zalo):**
- **Code helper ngoài try** → bước lỗi → UNDEF:
  - CS:15382, 15454-15463, 15534, 15781-15787, 16057;
  - upsert hồ sơ ở CS:15108, 15134, 15202, 15242, 15460;
  - câu "Zalo runtime chưa sẵn sàng" ở mọi helper.
- **Ném lại khi runtime dừng:** mọi catch của helper gọi lại `throwIfZaloRuntimeStopping` (CS:1145-1166, 15067, 15418, 15497, 15553, 15641, 15762, 15811, 15879, 16006, 16095) → UNC.
- **Nhiễm lỗi chính sách:** sau lần lỗi chính sách đầu, CS:9925-9934 ném lại lỗi đó ở mọi lần gọi chính sách sau trong unit → RUN.
- **Catch theo mục tiêu ném lại:** CS:4641 ném lại khi unit đã chạy chính sách → RUN.
- **Preflight trước khi claim unit:** opt-out / loại trừ (CS:4006 → 7071), ghi tạm dừng input chờ ở CS:6896 → RUN.
- **Batch chia sẻ:** CS:6561-6567 → 5972-5978; CS:5753 và 5984-6038 không bắt → RUN.
- **Materialize:** ZaloCampaignReadError (CS:8114) và Error thường (CS:8154-8156) → RUN.
- **Ghi mốc và input:** CS:11207, 4445-4511 → catch theo mục tiêu, hoặc RUN.
- **Mất quyền unit:** CampaignRunUnitOwnershipLostError → return im lặng ở CS:3578.
- **Treo:** mọi lời gọi zca trừ sendMessage/forward, và đăng nhập QR (ZR:3005); VM timeout chỉ phủ code đồng bộ (BE:79-83).
- **Async bắn-rồi-quên không tới trạng thái chiến dịch:** ZR:1910 (chuẩn bị listener), ZR:2452-2457 (listener tương tác), RGM:532-537, ZW:797 (xác minh bootstrap), ZW:304 (thông điệp debugger).

---

## 2. Facebook / Email / workflow

**Đường dẫn viết tắt:**

| Ký hiệu | Đường dẫn |
|---|---|
| WE | `/Users/lequangnhut/Repos/akaAgent/src/main/v2/runtime/workflowEngine.ts` |
| BX | `/Users/lequangnhut/Repos/akaAgent/src/main/v2/runtime/blockExecutor.ts` |
| BH | `/Users/lequangnhut/Repos/akaAgent/src/main/v2/runtime/blockHelpers.ts` |
| PC | `/Users/lequangnhut/Repos/akaAgent/src/main/v2/runtime/pageController.ts` |
| BPM | `/Users/lequangnhut/Repos/akaAgent/src/main/v2/runtime/backgroundPageManager.ts` |
| CS | `/Users/lequangnhut/Repos/akaAgent/src/main/services/campaignScheduler.ts` |
| ERS | `/Users/lequangnhut/Repos/akaAgent/src/main/services/emailRuntimeService.ts` |
| ARR | `/Users/lequangnhut/Repos/akaAgent/src/main/services/actionResultRuntime.ts` |
| ASP | `/Users/lequangnhut/Repos/akaAgent/src/shared/actionStatusPolicy.ts` |
| CR | `/Users/lequangnhut/Repos/akaAgent/src/main/data/repositories/campaignRepository.ts` |
| FPI | `/Users/lequangnhut/Repos/akaAgent/src/main/services/facebookCampaignPageIdentity.ts` |
| AP | `/Users/lequangnhut/Repos/akaAgent/src/main/domain/accounts/accountPoller.ts` |
| FLS | `/Users/lequangnhut/Repos/akaAgent/src/main/services/facebookLoginService.ts` |
| FSR | `/Users/lequangnhut/Repos/akaAgent/src/main/services/facebookSessionRequest.ts` |
| CCP | `/Users/lequangnhut/Repos/akaAgent/src/shared/campaignContentPreparation.ts` |
| RCR | `/Users/lequangnhut/Repos/akaAgent/src/main/services/runtimeCleanupRetry.ts` |

- File ghi tên trần (`blockRepository.ts`, `workflowV2Repository.ts`, `elementV2Repository.ts`) nằm trong `/Users/lequangnhut/Repos/akaAgent/src/main/data/repositories/`.
- `proxyRuntimeService.ts`, `facebookRestBrowse.ts`, `actionResultSession.ts` nằm trong `src/main/services` hoặc `src/shared`.
- Code block built-in nằm trong DB và không được đọc; output của block được suy ra từ cách scheduler đọc nó.

**Viết tắt cho cột "Hiện xử lý":** inp = trạng thái input, cmp = trạng thái chiến dịch, acc = trạng thái tài khoản, BT+ = tăng bộ đếm mục tiêu lỗi và áp chính sách.

| Mã ca | Lớp | Lỗi gì | Ở đâu | Hiện xử lý | Pha | Nhóm đề xuất | Khoảng hở |
|---|---|---|---|---|---|---|---|
| FB-1 | engine | Thiếu workflow, hoặc `getWorkflow` lỗi DB (repo trả null khi lỗi) | WE:127-130; workflowV2Repository.ts:73-80; CS:3531-3532 | Đầu lượt: ResultContractError, cmp 'tạm dừng', không chính sách. Theo mục tiêu id được đọc lại mỗi lần; lỗi thì ném, CS:4627 đặt inp 'hoàn thành' + câu lỗi, err_undefined, BT+ | B | content_config/transient | M,N |
| FB-2 | engine | Thiếu định nghĩa block, hoặc `getBlock` lỗi DB (trả null) | WE:133-134, 309-311, 622-630; blockRepository.ts:83-91 | Node lỗi "Block không tìm thấy…", run failed, err_undefined, BT+, inp bị dùng | B | content_config/transient | M,N |
| FB-3 | engine | Ghi run hoặc run-step lỗi DB | WE:139-154, 233-244, 274-290, 357-370 | Chỉ console.error; runId/stepId undefined nên không có lịch sử bước, không chẩn đoán AI theo runId | — | internal | S |
| FB-4 | executor | Block ném bất cứ gì | WE:335-343; BX:91-99 | Bước 'error'; chỉ giữ chuỗi message (`String(err)` ra "[object Object]" với object); không mã, kiểu, stack | * | theo nguyên nhân | N |
| FB-5 | executor | VM timeout (mặc định 5 phút) | BX:79-83 | Chỉ phủ code đồng bộ, câu "Script execution timed out". Vòng CPU sau `await` đầu tiên chạy ngoài timeout và đóng băng main thread Electron | * | internal | E,N |
| FB-6 | executor | Block async không bao giờ xong (await treo hoặc lời gọi page) | BX:76-83; WE:313-333 | Không giới hạn đồng hồ, executor không race abort signal. Run và unit lease bị giữ vô hạn | * | transient/ui_changed | E |
| FB-7 | engine | Block trả `{ok:false}` hoặc `{success:false}` | WE:350-355, 869-873 | Bước tính 'success', workflow chạy tiếp, run 'completed'. Chỉ phần chụp màn hình coi đây là lỗi; còn lại scheduler cần adapter theo tên block, không có thì im lặng | * | theo output | M |
| FB-8 | engine | Điều kiện ifElse, cấu hình loop, `itemsExpr` hoặc điều kiện while ném lỗi | WE:434-457, 504-528, 578-588 | Node lỗi "ifElse condition lỗi" / "Loop config lỗi" / "while condition lỗi", rồi err_undefined, BT+ | B | content_config | M,N |
| FB-9 | engine | Lỗi thân loop và việc chọn câu lỗi cấp run | WE:563-566, 589-596, 605-611, 192-196; CS:9692-9697 | Node loop nhận câu chung "Body iteration #N lỗi". `result.error` là node lỗi cuối theo thứ tự mảng `workflow.nodes` (không theo thời gian) và được ưu tiên hơn lỗi bước trong normalizeRuntimeError, nên so khớp chữ có thể trượt câu thật | * | kế thừa | M |
| FB-10 | engine | count NaN, forEach không phải mảng, đồ thị có vòng, node không tới được, hoặc merge có mọi cha bị bỏ qua | WE:506-517, 661-739 | 0 lần lặp, hoặc node còn pending/skipped; run báo 'completed' | B | content_config | S,M |
| FB-11 | engine | Exception ngoài try của node: cạnh treo (node nguồn đã xoá), clone `actionResults` vòng/BigInt, `onStepProgress` ném | WE:707-708, 763-771, 271, 893-906, 291-294, 85-95 | TypeError hoặc ném lại sau khi các nhánh anh em xong, nên `engine.run` reject; run row và node còn 'running' | * | content_config/internal | E |
| FB-12 | engine | Abort signal bắn | WE:175, 185, 554, 576, 604 | Chỉ kiểm giữa các cohort và lần lặp; 'cancelled' đè 'failed'. Không có trạng thái bước huỷ: block bị huỷ thành bước 'error', node chưa chạy giữ 'pending' | * | cancelled | M |
| FB-13 | engine | Một nhánh song song lỗi | WE:85-95, 180-183 | Node anh em cùng cohort vẫn chạy và có thể gửi; chỉ báo 'failed' cấp run | * | kế thừa | N |
| FB-14 | helper | `helpers.sleep` bị huỷ | BH:299-312 | Chỉ ném "Block bị huỷ trong khi sleep" khi block truyền `signal`; không thì sleep không huỷ được | * | cancelled | M |
| FB-15 | helper | `element`/`elementWith`: tên lạ, nạp cache element lỗi DB, thiếu `${var}` | BH:365-375; elementV2Repository.ts:57-61, 74-85 | "Element không tìm thấy" hoặc "Failed to load elements cache", rồi err_undefined, BT+. Biến thiếu bị thay im lặng bằng '' | B | content_config/transient | M,N,S |
| FB-16 | helper | Helper tuỳ chọn lỗi hoặc không hỗ trợ (logRunEvent(s), callAIUsing); thiếu helper Zalo/Email | BH:267-286, 391-462, 470-503; CS:16166-16175 | Trả `{ok:false}` hoặc `{unsupported:true}` kèm log cảnh báo; thiếu helper thì ném "Runtime hiện tại không hỗ trợ…" | B | transient/internal | S,N |
| FB-17 | page | Script trong trang ném lỗi (`exec` / `evaluate`) | PC:139-155, 636-645 | `exec`: `{__error}` thành Error(message). `evaluate`: executeJavaScript reject nguyên bản | * | ui_changed/internal | N |
| FB-18 | page | Renderer chết hoặc cửa sổ bị huỷ giữa lượt | BPM:64, 130; PC:126-136, 150, 237 | Cửa sổ bị huỷ im lặng, run không được báo. Lời gọi sau lỗi "Object has been destroyed", waitForSelector nuốt nên hiện thành "waitForSelector timeout: <xpath>" | * | transient | M,S |
| FB-19 | page | XPath hoặc CSS selector sai cú pháp | PC:39, 47, 54; nuốt ở 237, 275, 283, 578 | Thành timeout, `null` hoặc `[]` | B | content_config | M,S |
| FB-20 | page | Phần tử không có/không hiện trong hạn, hoặc mất trước khi thao tác | PC:223-251 (15 giây cho click/type/fill/focus/paste/select/upload, 10 giây cho hover/getText/getValue/getAttribute); 297, 319, 408, 432, 502, 537, 593, 828 | "waitForSelector timeout" hoặc "Element not found", rồi err_undefined, BT+, inp bị dùng | B (I nếu chờ sau khi submit) | ui_changed/target_permanent/auth (trang login)/transient | M,N |
| FB-21 | page | XPath kết thúc bằng `[n]` được hiểu lại thành match hiển thị thứ n; `$$` đếm cả phần tử ẩn | PC:34-46, 279-289 | Lặng lẽ ra phần tử khác hoặc không có | B/I | ui_changed | S |
| FB-22 | page | Thao tác không có tác dụng: click bị lớp phủ chặn, Enter tổng hợp bị bỏ qua | PC:292-312, 553-574 | Luôn resolve: sự kiện không tin cậy và không có gì kiểm hiệu quả | I | unknown_delivery/ui_changed | S |
| FB-23 | page | Chữ vào nhầm chỗ: `type()` dự phòng activeElement hoặc contenteditable cuối trang; `insertText` sau khi mất focus | PC:337-340, 353-399, 488-491 | Resolve; chỉ ném khi không có phần tử nhập được hoặc trang đã ngắt | B | ui_changed | S |
| FB-24 | page | Dán nội dung định dạng bị từ chối | PC:482-484 | "Facebook không nhận nội dung HTML đã paste" | B | ui_changed | N |
| FB-25 | page | `navigate` dừng ở login/checkpoint/redirect; ERR_ABORTED | PC:158-185 | Resolve: không kiểm URL cuối, ERR_ABORTED bị nuốt | B | auth/account_restricted | S,M |
| FB-26 | page | `navigate` lỗi mạng, proxy, TLS hoặc treo | PC:166-181 | Electron "ERR_… (-n)" thô, rồi err_undefined, BT+, inp bị dùng. Không timeout cấp app, không abort | B | transient (proxy hỏng: content_config) | M,N,E |
| FB-27 | page | `reload` / `goBack` / `goForward` lỗi | PC:187-221 | Resolve ở did-stop-loading kể cả sau did-fail-load; goBack không có lịch sử chờ 30 giây rồi timeout | B | transient | M,S |
| FB-28 | page | Hộp thoại JS (alert/confirm) chặn renderer | PC:150, 644 (chỉ xử lý will-prevent-unload, 160-164) | executeJavaScript treo | * | ui_changed | E |
| FB-29 | page | `apiCall` trả HTTP ≥ 400 (Graph hoặc REST khác) | PC:676-684 | Trả `{status}`, không ném; việc map để block tự làm | A | Graph 190 auth, 368 account_restricted, 4/17/32/613 quota, 100/200 content_config, 5xx transient | N |
| FB-30 | page | `apiCall` timeout/abort, lỗi parse JSON, hoặc đọc body sau khi hẹn giờ đã xoá | PC:671-688 | "apiCall failed: …"; đọc body không giới hạn thời gian | I (POST) | unknown_delivery | M,N |
| FB-31 | page | `apiCall`/`downloadUrl` dùng fetch của main process, bỏ qua proxy của tài khoản | PC:676, 802 | Không lỗi; traffic Facebook đi từ IP máy kèm cookie tài khoản | B | account_restricted (rủi ro) | S |
| FB-32 | page | Input tệp: data URI sai, đường http, thiếu tệp local, thiếu tệp multipart, downloadUrl lỗi HTTP hoặc timeout | PC:1138-1161, 732, 781-817 | Ném với URI/http/multipart/HTTP. Thiếu tệp local chỉ console.warn và vẫn truyền cho CDP. Tệp tạm không bao giờ bị xoá | B | content_config/transient | S,N |
| FB-33 | page | Xung đột gắn/gỡ debugger CDP; thả tệp lỗi | PC:841, 860, 938, 957, 959-961, 1109, 1128, 1130-1132 | Lỗi gắn/gỡ bị nuốt; thả lỗi thì console.error và trả `fileCount` nhỏ hơn | B | internal/ui_changed | S |
| FB-34 | page | Chụp màn hình hoặc preview lỗi | PC:629-633; CS:16561-16565, 16787-16789 | Nuốt, nên không có sự kiện chụp màn hình và không có bằng chứng cho chẩn đoán AI | — | internal | S |
| FB-35 | browser | Tạo cửa sổ nền, tải trang đầu hoặc cài proxy (`getProxyById`, `setProxy`) lỗi | BPM:44-74; CS:4119-4121, 14203-14209; proxyRuntimeService.ts:40-45, 62-99 | Tải trang đầu: console.warn. Lỗi tạo / proxy nằm ngoài try theo mục tiêu nên catch ngoài (CS:3575) áp err_undefined, BT+ không có inputDataId, kèm dọn lượt lỗi | B | transient/internal | M,S |
| FB-36 | browser | Proxy chết hoặc từ chối xác thực (không kiểm lúc cài) | proxyRuntimeService.ts:62-99 | Lộ ra sau đó theo từng mục tiêu như FB-26 hoặc FB-20 | B | content_config/transient | M,N |
| FB-37 | browser | Tab hiển thị chưa mở cho chiến dịch trình duyệt | CS:1677-1680 | Một dòng log mỗi tick; không note, không mã; chiến dịch nằm chờ | B | content_config | N |
| FB-38 | session | Kiểm tay đăng nhập/checkpoint Facebook | AP:20-43, 50-80; accountHandlers.ts:700-751 | Chỉ kiểm tab hiển thị: có cookie `c_user` là 'đã đăng nhập'; URL chứa 'checkpoint' hoặc `#checkpoint_title` là 'checkpoint'. Trang nền không được kiểm; lỗi theo tài khoản bị bỏ qua (AP:78-80) | * | account_restricted/auth | M,S |
| FB-39 | session | Kiểm phiên HTTP Facebook được quản lý | FLS:428-457, 458-504; FSR:24-30, 118-166 | Cache theo vân tay cookie c_user/xs; chỉ vô hiệu khi tab hiển thị điều hướng. Challenge thành 'checkpoint', login thành 'chưa đăng nhập', lỗi truyền tải/timeout thành 'unknown' (không đổi) | * | account_restricted/auth | M |
| FB-40 | session | Tự khôi phục đăng nhập lúc khởi động lỗi | FLS:296-310, 352-364 | Nuốt; tài khoản vẫn đăng xuất | B | auth | S,N |
| FB-41 | session | loginStatus không phải 'đã đăng nhập' lúc scheduler giao việc | CS:1659-1661, 1786, 1826 | Tài khoản bị bỏ qua im lặng; chiến dịch chờ với note cũ | B | auth/account_restricted | N |
| FB-42 | scheduler | loginStatus hoặc trạng thái tài khoản đổi giữa lượt (kể cả 'checkpoint', hoặc người dùng tạm dừng tài khoản) | CS:4270-4302, 9420-9429, 4443-4453, 9469-9482 | Guard huỷ trong 5 giây. Mọi giá trị không đăng nhập thành "Tài khoản bị đăng xuất", và kiểm chữ `includes('đăng xuất')` đưa tới err_logout. Đổi trạng thái khác: cmp 'chờ xử lý' + note. inp về 'chờ xử lý' trừ khi đã giao | I/* | auth / account_restricted / người dùng điều khiển | M |
| FB-43 | scheduler | Block gặp trang checkpoint hoặc "tạm thời bị chặn" trong khi DB vẫn nói đã đăng nhập | không có bộ phát hiện trong CS | Block timeout, rồi err_undefined, BT+. Chẩn đoán AI chỉ chạy khi chạm ngưỡng lỗi (CS:10103-10111) | * | account_restricted | M,N |
| FB-44 | scheduler | Guard tài khoản đọc DB lỗi | CS:4270-4302 | console.error; guard bỏ qua lần kiểm đó | * | transient | S |
| FB-45 | scheduler | Lỗi DB quanh claim runtime: đọc trước claim, RPC claim | CS:3306-3322, 3576, 3328-3350 | Trước claim: ném lại tới `.catch` của hàng đợi (CS:1720-1723), chỉ một dòng log. RPC claim: thử lại mỗi 2 giây vô hạn | B | transient | E,N |
| FB-46 | scheduler | Chạm giới hạn chạy đồng thời của trình duyệt | CS:3379-3383; browserRunLimits.ts:39-44 | Note có CAS "Đã đạt giới hạn… chạy đồng thời"; trả 'concurrency_wait' | B | run_control | N |
| FB-47 | scheduler | Không có quyền gói; thao tác hoặc workflow chưa liên kết | CS:3478-3499 | Nhả: cmp 'chờ xử lý' + note; mỗi tick lại claim | B | auth (bản quyền)/content_config | N |
| FB-48 | scheduler | Catalog kết quả hoặc khai báo sai; `beginActionResultRun` | CS:3531-3555; ARR:29-55 | ResultContractError đặt cmp 'tạm dừng'. Lỗi DB catalog (Error thường) lại nhận err_undefined, BT+ | B | content_config/transient | M |
| FB-49 | scheduler | Wrapper workflow chạy-dưới-Page sai; cấu hình nội dung nâng cao sai | CS:3559-3571, 3879-3885; FPI:15-50 | cmp 'tạm dừng' hoặc 'chờ xử lý' + note | B | content_config | N |
| FB-50 | scheduler | Kiểm khi dựng biến: Reels cần đúng một video, đăng Page qua API chỉ ảnh, loại media Facebook, loại media comment | CS:10268-10276, 10318-10322, rồi 4741-4746 và 3575-3603 | Dọn lượt lỗi chung + err_undefined, BT+ (không inputDataId); lặp mỗi tick tới khi chạm ngưỡng | B | content_config | M,N |
| FB-51 | scheduler | Giải media lỗi (không trì hoãn) | CS:17431-17486, 4742-4744, 17512-17520 | inp 'chờ xử lý', cmp 'tạm dừng' + "Không dùng được media…" | B | content_config (lỗi tải cloud thực ra là transient) | M,N |
| FB-52 | scheduler | Chuẩn bị nội dung, media hoặc xoay vòng trong block (content-preparation v1) | CS:16179-16182, 16906-16960; CCP:23-52 | Lỗi qua sandbox thành chuỗi thường nên mất kiểu lỗi media/xoay; bước lỗi, err_undefined, BT+, inp bị dùng | B | content_config/transient | M,N |
| FB-53 | scheduler | Nội dung xuống cấp: AI viết lại lỗi, `#{FULL_NAME}` không giải được | CS:16973-16986, 16994-16998 | AI: cảnh báo + dùng câu gốc. FULL_NAME: im lặng thành '' | B | transient/ui_changed | S |
| FB-54 | scheduler | Đọc cooldown hoặc hạn mức lỗi DB | CS:4010-4025, 4110-4116, 4184-4189 | Nhả kèm note "…sẽ tự thử lại" | B | transient | N |
| FB-55 | scheduler | Chạm hạn mức cục bộ, hoặc thao tác bị khoá bởi chính sách trước | CS:4088-4105, 9569-9599; CR:6414+ | Chính sách error_limit_in_day / error_limit_in_hour; thao tác bị khoá: cmp 'chờ xử lý' + note | B | quota/account_restricted | — |
| FB-56 | scheduler | Đọc duyệt bài nhóm hoặc hạn mức chia sẻ lỗi | CS:7396-7399, 7503-7506 | Dùng mặc định (vẫn đăng / 0 lượt chia sẻ) | B | transient | S |
| FB-57 | scheduler | Claim unit bị từ chối hoặc phản hồi lệch | CS:9146-9154, 9202-9299 | Map thành stop/yield/release. Lệch số lượng hoặc token thì ném, rồi err_undefined, BT+. Lý do từ chối lạ chỉ có một dòng log | B | internal/auth | M,N |
| FB-58 | scheduler | Run trả 'failed' | CS:4503-4512, 4527-4573 | inp 'hoàn thành' + note lỗi (không thử lại trừ khi kết quả managed trả về hàng đợi); err_undefined trừ khi khớp một trong 3 câu; BT+ | * | theo nguyên nhân | M,N |
| FB-59 | scheduler | Run trả 'completed' nhưng không nhận ra mốc nào (block ok:false, tên block lạ) | CS:4486-4497 | inp 'hoàn thành', log "Hoàn thành", không detail, bộ đếm mục tiêu lỗi không đổi | * | unknown | M,N |
| FB-60 | scheduler | Run 'cancelled' không rõ nguyên nhân | CS:4503-4512, 4527-4529 | inp 'hoàn thành' + "Lỗi không xác định" + err_undefined | * | cancelled | M |
| FB-61 | scheduler | `engine.run` reject, hoặc ghi sổ sau run ném (ghi mốc ngoài hợp đồng, xoay nội dung, cập nhật input, chèn detail kết bạn, bump bài trên đường explicit) | CS:4627-4732, 4391, 11271-11275 | inp 'hoàn thành' + câu lỗi; `normalizeRuntimeError(campaign, [], msg)` nên mã thao tác chỉ là descriptor đầu; BT+ | A (thường) | internal | M |
| FB-62 | scheduler | Lỗi runtime newsfeed-daily (trừ tần suất comment) | CS:4531-4538, 4694-4700, 2538-2545 | Chiến dịch đặt 'hoàn thành' với note là lỗi; không chính sách, không BT | * | theo nguyên nhân | M |
| FB-63 | scheduler | Ghi mốc newsfeed lỗi giữa lượt | CS:4338-4352 | Huỷ run và ném lại, nên dọn lượt lỗi | A | internal | N |
| FB-64 | scheduler | Lỗi hạ tầng sau claim, trong vòng mục tiêu hoặc lúc hoàn tất (getCampaign, getAccountRunBlockReason, đồng hồ DB, kết thúc hard-end, hoàn tất, nhả tài khoản) | CS:3953-3984, 4826-4833, rồi 3575-3603 | Dọn lượt lỗi với note "Lượt chạy gặp lỗi: …", err_undefined, BT+ | B/A | transient/internal | M |
| FB-65 | scheduler | Settle unit, yield ranh giới ngày hoặc đồng hồ DB lỗi | CS:9313-9375, 2918-2974, 2801-2818 | Vòng thử lại kèm log; đồng hồ lỗi bị coi là "đã tới ranh giới" | A/B | transient | N |
| FB-66 | scheduler | Ghi hạ tầng bị nuốt: settle cuối, lỗi chính sách, reset bộ đếm mục tiêu lỗi, chỉ số link nguồn, log tiến trình | CS:3608-3620, 3595-3597, 10136-10146, 4130-4135, 14181-14196 | Chỉ console.error / console.warn | — | internal/transient | S |
| FB-67 | scheduler | CampaignRunUnitOwnershipLostError | CS:3578, 5262-5264, 7595-7597 | Return im lặng | * | cancelled | S |
| FB-68 | scheduler | RPC dọn lượt lỗi gặp lỗi vĩnh viễn; RPC tiến độ random-run Facebook lỗi | CS:1243-1277; RCR:4-11; CS:9344-9353, 3611-3617 | Log "cần recovery khi khởi động lại" và vẫn giữ quyền sở hữu; random-run thì dọn không chính sách | A | internal/transient | N |
| FB-69 | scheduler | Thu thập bạn bè gợi ý lỗi hoặc bị huỷ | CS:7531-7598 | Ném "Không lấy được đề xuất bạn bè", nên run failed + err_undefined, BT+ | B | ui_changed/transient/cancelled | M |
| FB-70 | scheduler | Kiểm bài chờ duyệt: trang tạm dừng ở login/checkpoint hoặc không render; kiểm timeout hoặc lỗi | CS:16586-16674 (16598-16600, 16662-16669) | Không render bị nuốt và báo `ok:true, conclusive:true, links:[]` (nghĩa là "không chờ duyệt"). Lỗi trả `{ok:false, conclusive:false}` | A | auth/ui_changed/transient | M,S |
| FB-71 | scheduler | Workflow con lướt-nghỉ lỗi | CS:9485-9567; facebookRestBrowse.ts:121-124 | Cố ý nuốt | B | — | S |
| FB-72 | fb-milestone | Đăng Timeline / Reels | CS:11909-11961 | Thành công chỉ khi fb_click_post_button hoặc fb_post_reels thành công với posted/ok. ok:false không ra detail; lỗi block chỉ tới err_undefined ở cấp run | I | unknown_delivery/ui_changed | S,N |
| FB-73 | fb-milestone | Đăng nhóm: không xác nhận được form đã đóng; trạng thái chờ duyệt không kết luận | CS:10616-10688, 11895-11907, 14087-14099 | 'thất bại' "Không xác nhận được form đăng bài đã đóng" không mã, hoặc 'lỗi' + mã khớp chữ; không kết luận thì sub-status null | I | unknown_delivery | M,N |
| FB-74 | fb-milestone | Chia sẻ vào nhóm đã tham gia qua composer | CS:10579-10599, 10693-10719 | Mọi nhóm được chọn nhận 'thành công' và inp 'hoàn thành' nếu bài chính thành công (không kiểm từng nhóm); lỗi ghi theo nhóm chỉ console.error | I | unknown_delivery | M,S |
| FB-75 | fb-milestone | Ghi sổ sau thành công: xếp bump bài, đồng bộ trạng thái liên hệ nhóm | CS:10723, 13828-13879, 14101-14117 | Đường cũ: nuốt. Đường explicit: thoát ra thành FB-61, nên mục tiêu thành công bị tính lỗi | A | internal | S,M |
| FB-76 | fb-milestone | Đăng fanpage qua API | CS:11774-11854 | ok/posted thì 'thành công'; ok:false thì 'thất bại' (lỗi Graph giữ trong data, không mã); bước lỗi thì 'lỗi' không errorCode | A | theo mã Graph | M,N |
| FB-77 | fb-milestone | Chuyển sang fanpage lỗi (chưa chạy bước đăng) | CS:11856-11893 | 'lỗi' / 'thất bại', không mã | B | ui_changed/auth | N |
| FB-78 | fb-milestone | Comment / comment seeding | CS:11983-12088, 9758 | 'thành công'; commentFailed thì 'thất bại' không mã; `commented:false` mà không có commentFailed thì bỏ qua im lặng; bước lỗi không ra detail; không có bài khớp chỉ log; comment lỗi không bao giờ "nặng" vì `actionName === 'Comment'` | I/A | lẫn lộn | S,N,M |
| FB-79 | fb-milestone | Nhắn tin / nhắn inbox page | CS:12090-12141 | ok thì 'thành công'; page-inbox lý do not_found hoặc wrong_conversation thì 'không tồn tại' (không tính); ok:false khác thì 'thất bại' không mã; bước lỗi thì 'lỗi' + mã khớp chữ | I/A | unknown_delivery/target_permanent/ui_changed | M,N |
| FB-80 | fb-milestone | Bảng kết quả kết bạn | CS:11248-11310 | already_requested, already_friend, legacy_skipped không tính; accepted và request_sent thì 'thành công' (tính, deliveryCommitted); 'cancelled' không ghi; còn lại qua chính sách (err_fb_add_friend_unavailable, khớp chữ, hoặc err_undefined), mặc định tính hạn mức | A/I | target_permanent/unknown_delivery/quota | M |
| FB-81 | fb-milestone | Tham gia nhóm | CS:11705-11772 | Lỗi thì 'lỗi' + mã khớp chữ; ok:false thì 'thất bại' không mã; already_joined thì 'đã tham gia'; requested thì 'thành công' | A | lẫn lộn | N |
| FB-82 | fb-milestone | Tìm data và đẩy kết quả sang chiến dịch đích | CS:11415-11689, 12154-13800 | Detail 'Tìm data' không có actionCode (không mã lỗi, bỏ qua writer managed và bộ đếm); lỗi đẩy chỉ console.error hoặc cảnh báo | A | internal | N,S |
| FB-83 | fb-milestone | Thích / comment newsfeed | CS:10548-10577, 10995-11018, 11691-11703 | Chỉ thành công mới ra detail; lỗi ghi ngoài hợp đồng kết quả bị nuốt | A | lẫn lộn | S,N |
| FB-84 | fb-milestone | Ghi mốc kiểu cũ lỗi | CS:11610, 11768, 11853, 11892, 11906, 11959, 11980, 12036, 12062, 12140 | console.error; tổng kết không cập nhật nên input hoàn thành mà không detail, không BT | A | internal | S |
| FB-85 | fb-milestone | Mặc định và bộ đếm khi chèn detail kiểu cũ | CR:6346-6405 (6353, 6396-6399) | Thiếu status thì mặc định 'thành công'; tăng bộ đếm thao tác lỗi bị nuốt | A | internal | S,M |
| FB-86 | fb-milestone | Đếm hạn mức theo chữ trạng thái | CR:260, 829-832 | 'thất bại' tính hạn mức, 'lỗi' không, nên phụ thuộc block ném hay trả về | A | quota | M |
| FB-87 | policy | `normalizeRuntimeError` | CS:9686-9730 | Ba câu tiếng Việt map thành err_limit_waiting_message / err_comment_frequency_limit / err_group_post_frequency_limit; còn lại err_undefined; mã thao tác lấy từ tên block | * | quota/account_restricted | M,N |
| FB-88 | policy | Ngưỡng gấp đôi của Page inbox | CS:10077-10089, 10113-10121 | Ở ngưỡng đầu, chiến dịch về 'chờ xử lý' và tự chạy lại | A | coi là transient chỉ vì loại thao tác | M |
| FB-89 | policy | Chẩn đoán ảnh chụp bằng AI | CS:9837-9891, 10103-10111 | Chỉ chạy với err_undefined khi chạm ngưỡng; viết lại note; lỗi của chính nó bị nuốt; không đổi mã hay nhóm | A | — | S |
| FB-90 | fb-invite | Batch mời nhóm: run lỗi, không có output, hoặc ném | CS:5210-5252, 5288-5326 | Một detail 'lỗi' cấp batch (không inputDataId, không tính); cmp 'tạm dừng'; cả batch về hàng đợi khi settle | I | unknown_delivery/ui_changed | M |
| FB-91 | fb-invite | `submitOk === false` cho dòng đã chọn | CS:5365-5375, 5453-5458 | inp 'chờ xử lý'; cmp 'tạm dừng' | I | unknown_delivery | M |
| FB-92 | fb-invite | Dòng kết quả có id lạ, hoặc mục tiêu không có dòng kết quả | CS:5355-5359 | Bỏ qua; mục tiêu thiếu lặng lẽ về hàng đợi khi settle | A | unknown | S |
| FB-93 | fb-invite | Map trạng thái theo mục tiêu | CS:5470-5481 | So chữ trạng thái tiếng Việt; 'selected' + submitOk thì 'thành công'; còn lại 'lỗi', err_undefined, BT+ | A | lẫn lộn | M,N |
| FB-94 | fb-invite | `output.ok === false` kèm lỗi; thiếu mục tiêu hợp đồng | CS:5460-5465, 5187-5190 | cmp 'chờ xử lý' + note; trên đường hợp đồng ResultContractError đặt 'tạm dừng' | A | unknown/content_config | N |
| FB-95 | fb-identity | Chuyển sang Page lỗi trước thao tác mục tiêu | CS:4361-4365, 4637-4640, 17339-17346; FPI:79-93 | cmp 'tạm dừng' với câu lỗi bước; unit về hàng đợi | B | ui_changed/auth (không có quyền Page)/transient | N |
| FB-96 | fb-identity | Guard tài khoản huỷ giữa lúc chuyển | CS:4361-4365 | Coi như chuyển lỗi: "Không chuyển được sang Page đã chọn.", cmp 'tạm dừng'; bỏ qua chính sách dừng tài khoản | B | cancelled/auth | M |
| FB-97 | fb-identity | Khôi phục danh tính gốc lỗi (ngân sách 45 giây, trang đã đóng, không có tên gốc) | FPI:108-128; CS:17348-17389, 17201, 17247, 17302-17306, 17319-17321 | Tài khoản và chiến dịch 'tạm dừng' + note; dừng hàng đợi. Khôi phục chạy trong mọi lần ghi trạng thái khác 'đang chạy', nên làm các lần ghi không liên quan cũng có thể ném lỗi | A | ui_changed/transient | N,E |
| FB-98 | result-contract | Kết quả explicit sai: sai khuôn, trạng thái lạ, thiếu chính sách, xung đột key, inputDataId sai | ARR:72-131; actionResultSession.ts:61-73 | Huỷ run và không ghi kết quả của bước bị từ chối, kể cả khi nó nói đã thực hiện; cmp 'tạm dừng' | * | content_config | M |
| FB-99 | result-contract | Ghi kết quả managed hoặc RPC settle lỗi (kể cả mạng) | ARR:173-180, 200-204 | Thành ResultContractError ('write:…' / 'settle:…'), nên cmp 'tạm dừng' | A | transient | M |
| FB-100 | result-contract | Chữ trạng thái cũ không có trong catalog hoặc mơ hồ | ASP:132-137; ARR:148-149 | ResultContractError, cmp 'tạm dừng' | A | content_config | — |
| FB-101 | result-contract | Cách adapter cũ đặt "đã giao chưa" | ARR:163-166 | Mọi kết quả không thành công đều ghi `not_committed` (chưa giao) | I | unknown_delivery | M |
| FB-102 | result-contract | Guard huỷ | ASP:168-171 | `guards.cancelled` có nhưng không ai đặt | — | cancelled | M |
| FB-103 | email | Thiếu email runtime, hoặc chuẩn bị nội dung ném (đồng hồ DB, chỉ số xoay, media, mẫu) | CS:16233, 16284-16296 (ngoài try) | Ném vào block nên bước không có `detail`, không ghi detail, err_undefined, BT+, inp bị dùng | B | internal/transient/content_config | M,N |
| FB-104 | email | Thiếu địa chỉ người nhận | CS:16237-16250 | 'thất bại', không mã; tính BT, không tính hạn mức | B | content_config | N |
| FB-105 | email | Sai định dạng, NXDOMAIN, null MX, SMTP 5.1.1 / 5.1.10 hoặc câu "user unknown" | ERS:390-415, 428-467, 554-568, 686-706; CS:16258-16282 | 'không tồn tại' + err_email_recipient_not_found; không hạn mức, không BT | B | target_permanent | — |
| FB-106 | email | Kiểm người nhận không kết luận (DNS timeout, cổng 25 bị chặn và cache 10 phút, 4xx, 5.7.x, exception) | ERS:409-415, 493-530; CS:16252-16257 | Vẫn gửi; không ghi sự không chắc chắn | B | — | S |
| FB-107 | email | Thiếu cấu hình SMTP hoặc tài khoản; chèn dòng tracking hoặc tracking link lỗi | ERS:106-111, 344-388, 744-761 | 'thất bại', tính hạn mức, BT | B | content_config/auth/transient | M,N |
| FB-108 | email | Thiếu đường dẫn tệp đính kèm | ERS:748-750 | Bỏ đi im lặng; vẫn báo 'thành công' | B | content_config | S |
| FB-109 | email | Lỗi xác thực SMTP (EAUTH / 535) | ERS:763-781; CS:16329-16344 | 'thất bại', không mã, tính hạn mức, BT | B | auth | M,N |
| FB-110 | email | Lỗi kết nối, chào hoặc DNS trước khi gửi nội dung thư (DATA) | như FB-109 | 'thất bại', tính hạn mức, BT, inp bị dùng | B | transient | M,N |
| FB-111 | email | Rớt socket hoặc timeout sau DATA | như FB-109 | 'thất bại', ghi chưa giao | I | unknown_delivery | M,N |
| FB-112 | email | Người nhận bị từ chối khi gửi (550 / 553, EENVELOPE) | như FB-109 | 'thất bại' | A | target_permanent | N |
| FB-113 | email | Từ chối tạm (421 / 450 / 451 / 452, greylisting) | như FB-109 | 'thất bại', inp bị dùng | A | target_temporary | M,N |
| FB-114 | email | Hạn mức hoặc giới hạn tốc độ của nhà cung cấp (vd 550 5.4.5, 421 4.7.0, 454) | như FB-109 | 'thất bại' theo mục tiêu; không dừng cấp tài khoản | A | quota | M,N |
| FB-115 | email | Bị từ chối vì nội dung hoặc spam (554 5.7.1, EMESSAGE) | như FB-109 | 'thất bại' | A | content_config/account_restricted | M,N |
| FB-116 | email | Ghi sổ tracking sau khi gửi (đánh dấu đã gửi, gắn với detail) | ERS:783-787; CS:11081-11117 | console.warn hoặc sự kiện cảnh báo | A | internal | S |
| FB-117 | email | Gửi thành công không được đánh dấu deliveryCommitted, và logger email cũ không áp helper controls | CS:16311-16328, 11119-11179 (so với 11200) | Khi dừng tài khoản hoặc huỷ do tạm dừng, scheduler đặt input về 'chờ xử lý' (CS:4443-4449); chỉ settle managed (ARR:193) chặn được gửi lại | A | — | M |
| FB-118 | email | `sendMail` không huỷ được | ERS:744-794 | Không có abort signal; dùng timeout mặc định của nodemailer | I | transient | E |
| FB-119 | executor | Promise hoặc timer do block tạo sống lâu hơn block | BX:58-73 (setTimeout/setInterval lộ cho block) | Reject hoặc throw muộn thành unhandledRejection hoặc uncaughtException trong main process | — | internal | E |

**Kết quả được quyết định theo tên block hoặc node id** (CS trừ khi ghi khác):
- **Mã thao tác của lỗi theo tên block:** 9702-9717.
- **Kiểm cấp run:**
  - 4368 `fb_page_inbox_open`
  - 4383-4389 `fb_page_post_api` / `fb_post_current_identity_ui` (xoay nội dung)
  - 4517-4518 `fb_add_friend` (lỗi kết bạn đã xử lý)
  - 5279 `fb_group_invite`
- **Logger mốc:**
  - 11130 `email_*`, 11193 `zalo_*`
  - 11417 các block tổng kết tìm data
  - 11707 `fb_join_group`
  - 11776-11785 block đăng / chuyển Page, cùng node id `switch_to_page` và `restore_original_identity`
  - 10797 và 11897 `fb_verify_group_post_form_closed`
  - 10624 `fb_get_first_group_post_link`
  - 10629, 11928, 11972 `fb_detect_pending_post`
  - 11914-11922 `fb_click_post_button` / `fb_post_reels`
  - 11925 `fb_get_first_profile_post_link`
  - 11964 `fb_adjust_group_post_comments_after_pending`
  - 11985 block comment
  - 12067 `fb_prepare_seeding_iterations`
  - 12092 block nhắn tin
  - 12143 `fb_add_friend`
  - 10553-10554 và 11696-11697 block thích / comment newsfeed
  - 10580 `fb_select_group_post_share_targets`
- **Nhãn chụp màn hình:** 16398-16414, 16455.
- **Danh tính Page:** FPI:7-13 (node id và tên block bắt buộc), FPI:81-92 (tiền tố `page_identity_`).
- **Theo loại chiến dịch:** 10077 (page inbox), 4531 (newsfeed daily), 9725 (đăng nhóm).

**Kết quả được quyết định theo câu chữ hoặc giá trị chuỗi:**
- CS:9719-9727: ba câu tiếng Việt về hạn mức.
- CS:9426 và 9475: mọi trạng thái không đăng nhập thành "đăng xuất", rồi đi tới err_logout.
- CS:9758: mức nặng phụ thuộc `actionName === 'Comment'`.
- CS:5474-5480: chữ trạng thái của mời nhóm.
- Giá trị block trả về:
  - CS:11260-11268 và 11287: giá trị kết quả kết bạn;
  - CS:11714-11729: `joinOutcome`;
  - CS:12101-12104: `reason` của page-inbox;
  - CS:10641: `/pending_posts/` trong URL bài.
- CS:698-706 và 761-764: regex kết nối của scheduler.
- Bảng chữ trạng thái: CR:260 và 829-832 (trạng thái tính hạn mức), ASP:132-137 (chữ trạng thái cũ).
- Page controller: PC:3-22 (`ERR_ABORTED`, `ERR_FAILED`, `(-2)` trong câu lỗi), PC:253-268 (chữ selector "bình luận / comment / trả lời / write a comment").
- Email: ERS:686-706 (regex SMTP "not found"), ERS:708-717 (regex mất mạng).
- RCR:4-11: regex dọn tạm thời.
- Đăng nhập: AP:32-34 và accountHandlers.ts:724-729 (`c_user=`, 'checkpoint', `#checkpoint_title`); FSR:24-30 và FLS:438-439 (regex đường auth).

**Các `catch` trên đường chạy bỏ lỗi:**
- **WE:**
  - Chỉ log: 151-153, 241-243, 287-289, 367-369, 396-398.
  - Chỉ giữ chuỗi message: 335-343, 448-456, 522-528, 582-588.
- **BX:** 47-51, 91-99, 118-122.
- **BH:** 345-347, 472-478, 484-490, 496-502.
- **PC:** 127-131, 171, 177, 237, 244, 275, 283, 541-545, 578, 775-777, 789, 792, 841, 860, 938, 957, 959-961, 1002, 1109, 1128, 1130-1132.
- **BPM:** 71-74, 110-112, 139-141, 151-153.
- **CS:**
  - Đầu lượt và finally: 3577, 3595-3597, 3607, 3609-3619, 3622-3624.
  - Vòng mục tiêu: 4023, 4114, 4135, 4187, 4299-4301, 4337, 4347, 4594.
  - Preflight, lướt-nghỉ, chính sách và AI: 7396-7399, 7503-7506, 9543-9545, 9886-9890, 10141-10145.
  - Ghi mốc: 10715-10718, 11013-11017, 11087-11115, 11610, 11768, 11853, 11892, 11906, 11959, 11980, 12036, 12062, 12140.
  - Đẩy tìm data: 12199, 12246, 12318, 12404, 12590.
  - Log và đồng bộ liên hệ: 14114-14116, 14152-14163, 14194-14196.
  - Helper và email: 16169-16175, 16254-16257, 16329-16344 (mất mã lỗi ở đây).
  - Chụp màn hình và kiểm nội dung chờ duyệt: 16392-16395, 16561-16565, 16598-16600, 16662-16669.
  - Preview, nội dung và khôi phục danh tính: 16728-16730, 16787-16789, 16982-16986, 16997, 17374-17381.
  - Dọn tệp tạm: 17492, 17528.
- **ERS:** 291-293, 382-384, 421-423, 448-450, 513-522, 572, 776-779, 784-786.
- **CR:** 6396-6399. `blockRepository.ts:89` và `workflowV2Repository.ts:79` biến lỗi DB thành `null`.
- **AP:** 78-80.
- **FLS:** 301-303, 357-359, 367-372, 377-380.
- **facebookRestBrowse.ts:** 82, 121-124.

**Cách phân biệt huỷ với lỗi hiện nay:**
- **Engine:** run chỉ 'cancelled' khi thấy abort signal giữa các cohort hoặc lần lặp (WE:175, 185, 554, 576, 604), và 'cancelled' được ưu tiên hơn 'failed' (WE:195).
  - Không có trạng thái bước huỷ: block bị huỷ qua `helpers.sleep` thành bước 'error' "Block bị huỷ…".
  - BlockExecutor và PageController không xem signal.
- **Nguồn huỷ trên đường Facebook:**
  - guard tài khoản (CS:4270-4302);
  - lỗi ranh giới hợp đồng (CS:4311; ARR:110-131);
  - ghi mốc newsfeed lỗi (CS:4342);
  - tạm dừng, chỉ với newsfeed và lướt-nghỉ (CS:1329, 1408-1411);
  - guard mời nhóm (CS:5110-5121);
  - khôi phục danh tính với abort 45 giây riêng (FPI:114-117).
- **Nguyên nhân được suy từ trạng thái bên lề, không từ kết quả:**
  - `accountStopReason` (CS:4443);
  - `pauseCancelledRun` (CS:4430-4432) và `pauseAbortTriggered` (CS:4655-4657);
  - `resultBoundary.error` (CS:4353-4359) và `milestoneWriteError` (CS:4351);
  - `cancelledAfterDelivery`, chỉ cho kết bạn (CS:4525-4527);
  - kết quả 'cancelled' của chính block kết bạn (CS:11256).
- **Không tìm ra nguyên nhân** thì coi là lỗi: "Lỗi không xác định" + err_undefined (CS:4503-4512).
- **Bước bị huỷ vẫn đi qua logger mốc**, nên một lần gửi bị huỷ vẫn ghi detail 'lỗi' (CS:12091-12110).
- **Chạy-dưới-Page:** huỷ trước thao tác mục tiêu bị báo thành chuyển Page lỗi và tạm dừng chiến dịch (CS:4361-4365).
- **Bạn bè gợi ý:** huỷ thành run lỗi (CS:7568-7570).
- **Lớp chính sách:** `guards.cancelled` không bao giờ được đặt (ASP:170).

**Khoảng hở lớn (Facebook / Email / workflow):**
1. **Hầu như mọi lỗi thành `err_undefined`.** Chỉ 3 mã khớp chữ, cùng err_fb_add_friend_unavailable, err_email_recipient_not_found và các mã hạn mức cục bộ có mã thật. Còn lại đều thành err_undefined: tính mục tiêu lỗi, input đánh 'hoàn thành', không có đường thử lại cho nguyên nhân tạm thời (mạng, proxy, DB, renderer chết). Xem CS:9686-9730, 4503-4512, 4693-4712.
2. **"Đã gửi nhưng không rõ kết quả" vô hình.** Trên đường cũ các lần gửi chưa xác nhận bị ghi 'thất bại' hoặc 'lỗi': form đăng nhóm không đóng, tin nhắn chưa xác minh, submit mời nhóm lỗi, SMTP rớt sau DATA, POST Graph API timeout. Adapter cũ còn ghi chúng là `not_committed` (ARR:165). Đường lỗi batch mời nhóm đưa cả batch về hàng đợi (CS:5148-5155, 5288-5326), nên có thể gửi lại.
3. **"Thành công" giả.** Block trả ok:false, hoặc tên block không có adapter, thì input đánh 'hoàn thành' kèm log "Hoàn thành" mà không có detail (CS:4486-4497). Gồm Timeline/Reels ok:false, `commented:false` và lỗi newsfeed.
4. **Không có giới hạn đồng hồ hay abort.** VM timeout chỉ phủ code đồng bộ (BX:79-83). PageController bỏ qua abort signal. navigate, executeJavaScript và sendMail không có timeout cấp app, nên treo là giữ unit lease và tài khoản vô hạn.
5. **Hai lỗi khác nhau trông như "không thấy phần tử".** Renderer chết và XPath sai đều hiện thành "waitForSelector timeout" (PC:237, 250; BPM:64).
6. **Không phát hiện checkpoint trong lúc chạy.**
   - Bộ kiểm chỉ xem cookie hoặc URL của tab hiển thị, hoặc kiểm HTTP có cache theo vân tay (AP:20-43, FLS:445-457).
   - Trạng thái 'checkpoint' bị gộp thành "Tài khoản bị đăng xuất" và err_logout qua so khớp chuỗi con (CS:9426, 9475).
   - Kiểm bài chờ duyệt đọc trang login hoặc checkpoint thành "không chờ duyệt" chắc chắn (CS:16598-16661).
7. **Lỗi email đều giống nhau.** Auth, hạn mức, tạm thời, vĩnh viễn, spam, rớt sau DATA, thiếu cấu hình và lỗi DB tracking đều thành 'thất bại' không mã, tính hạn mức và mục tiêu lỗi (CS:16329-16344, ERS:744-781). Thiếu tệp đính kèm bị bỏ im lặng (ERS:748-750). Gửi thành công không bao giờ được đánh dấu đã giao (CS:16311-16328).
8. **Lỗi DB tạm thời bị báo thành lỗi cấu hình hoặc mục tiêu:**
   - `getWorkflow` và `getBlock` biến lỗi DB thành "không tìm thấy";
   - lỗi RPC ghi / settle managed thành ResultContractError và tạm dừng chiến dịch (ARR:180, 204);
   - mọi lỗi DB sau claim đi đường mục tiêu lỗi err_undefined (CS:3575-3603).
9. **Huỷ không có biểu diễn riêng.**
   - Block bị huỷ ghi detail 'lỗi'.
   - Huỷ giữa lúc chuyển Page làm tạm dừng chiến dịch như chuyển lỗi (CS:4361-4365).
   - Lỗi newsfeed-daily được báo thành hoàn tất chiến dịch (CS:4531-4538).
   - `guards.cancelled` là code chết.
10. **Phân loại giòn.**
    - Dựa vào tên block, node id, và chữ trạng thái / kết quả tiếng Việt do block DB trả về.
    - Câu lỗi của run phụ thuộc thứ tự node trong workflow (WE:192-196).
    - Lỗi cấu hình như kiểm media Reels quay vòng err_undefined mỗi tick (CS:10268-10276 vào 3575).

**Đường thoát / treo (Facebook / Email / workflow):**
- **Lỗi trước claim:** ném lại ở CS:3576 và tới `.catch` của hàng đợi (CS:1719-1723), chỉ ghi một dòng log UI. Tương tự lỗi hàng đợi/RPC random-run (CS:1781-1866) và "DB runtime clock is invalid" (CS:1939).
- **`engine.run` reject vượt qua try của node:**
  - cạnh treo (WE:707-708);
  - clone input (WE:271);
  - `onStepProgress` ném (WE:291-294);
  - workflow null (WE:130).

  Run row còn 'running' vì `updateRun` không được gọi tới; scheduler coi là lỗi mục tiêu (CS:4627).
- **Treo không có timeout hay abort:**
  - await async của block (BX:79-83);
  - `loadURL` và `executeJavaScript`, kể cả hộp thoại JS (PC:150, 166, 644);
  - nodemailer `sendMail` (ERS:764);
  - đọc body `apiCall` (PC:680-681).
- **Đóng băng main thread:** vòng đồng bộ sau `await` đầu tiên trong block (BX:76).
- **Promise / timer trôi nổi từ block:** gây unhandledRejection hoặc uncaughtException trong main process Electron (BX:69).
- **Lỗi hạ tầng ngoài try theo mục tiêu** đi tới catch ngoài và bỏ qua phân loại mục tiêu:
  - `getAutomationPage` / cài proxy (CS:4119-4121);
  - đọc trong vòng (CS:3953-3984);
  - hoàn tất (CS:4826-4833).
- **Khôi phục danh tính trong lúc ghi trạng thái:** chạy bên trong `updateCampaignAndBroadcast`, `updateRunningCampaignAndBroadcast`, `updateAccountAndBroadcast` và `releaseRunningAccount` (CS:17201, 17247, 17302-17306, 17319-17321), nên mọi lần ghi trạng thái đều có thể ném lỗi khôi phục.
- **Renderer chết:** BPM:64 và 130 huỷ cửa sổ mà không báo cho run (không abort, không mã).
- **CampaignRunUnitOwnershipLostError:** return im lặng, không dọn (CS:3578).
- **`withTimeout` chỉ đua hẹn giờ:** không huỷ navigate hay evaluate bên dưới, các lời gọi này chạy tiếp tới khi cửa sổ tạm bị huỷ (CS:16677-16689, 16672).

---

## 3. Scheduler / hạ tầng (akaAgent)

**Đường dẫn viết tắt:**

| Ký hiệu | Đường dẫn |
|---|---|
| CS | `/Users/lequangnhut/Repos/akaAgent/src/main/services/campaignScheduler.ts` |
| CR | `.../src/main/data/repositories/campaignRepository.ts` |
| ARR | `.../src/main/services/actionResultRuntime.ts` |
| ASP | `.../src/shared/actionStatusPolicy.ts` |
| DMC | `.../src/main/services/dailyMaintenanceCoordinator.ts` |
| H | `.../src/main/ipc/handlers.ts` |
| SC | `.../src/main/data/supabaseClient.ts` |
| RCR | `.../src/main/services/runtimeCleanupRetry.ts` |
| WE | `.../src/main/v2/runtime/workflowEngine.ts` |
| CME | `.../src/main/services/campaignMediaExecution.ts` |
| CCP | `.../src/shared/campaignContentPreparation.ts` |
| AR | `.../src/main/data/repositories/accountRepository.ts` |
| ZSRM | `.../src/server/main/zaloServerRuntimeManager.ts` |
| ALS | `.../src/main/services/accountLogService.ts` |
| SXR | `.../src/main/data/repositories/campaignSendExclusionRepository.ts` |
| FRR | `.../src/main/data/repositories/facebookRandomRunRepository.ts` |
| MIG | `/Users/lequangnhut/Repos/akaAgent/migrations/` (migration v214, v231, v234, v340, v387, v392, v397, v444, v446, v454) |

`...` là `/Users/lequangnhut/Repos/akaAgent`. Tên lý do của các hàm DB lấy từ file SQL trong `migrations/`.

**"→ A31"** nghĩa là lỗi tới catch-all sau claim (dòng A31): run đánh lỗi, áp chính sách mục tiêu lỗi `err_undefined` một lần, rồi chạy dọn token.

| Mã ca | Lớp | Lỗi gì | Ở đâu | Hiện xử lý | Pha | Nhóm đề xuất | Khoảng hở |
|---|---|---|---|---|---|---|---|
| A01 | scheduler | Đồng hồ hoặc bảo trì chưa sẵn sàng (getRuntimeClock, ensureReady, maintainCampaignSchedules, quét nhóm data) | CS:1605,1624; DMC:127-179; H:292-332 | Huỷ cả tick cho mọi tài khoản. Lỗi khớp regex kết nối (CS:698-706) có một log "thử lại sau 30 giây", lỗi khác log "Lỗi scheduler". Thử lại theo chu kỳ 30 giây | B | run_control/transient | — |
| A02 | scheduler | Cổng đóng với 0 chiến dịch đang chạy, hoặc ngày đổi khi đang chờ | DMC:62-70 | Ném; log lỗi tick; thử lại mỗi tick | B | run_control | Sai nhóm (hiện thành lỗi chung); chặn mọi việc giao |
| A03 | scheduler | Cổng chờ khi còn dòng đang chạy hoặc unit lease của ngày cũ | DMC:55-76; H:314-325 | Hỏi lại mỗi 2 giây, không timeout trong tick | B | run_control | Kẹt |
| A04 | scheduler | enableDueAccountActions | CS:1608-1610; H:732-736 | console.error | B | transient | Nuốt |
| A05 | scheduler | getEligibleAccounts, getPendingCampaigns, refreshDueMobileManaged…, finalizeDataGroupCampaignAtHardEnd ném | CS:1614,1634,1641-1647 | Huỷ tick ở tài khoản đó; các tài khoản sau bị bỏ | B | transient | Sai nhóm (một lỗi bỏ đói mọi tài khoản) |
| A06 | scheduler | Làm mới note hạn mức mobile, theo chiến dịch | CS:2012-2021 | console.error | B | transient | Nuốt |
| A07 | scheduler | Tài khoản không đủ điều kiện (startup pending, operation registry, bận, enrichment, trạng thái, đăng nhập, Zalo Web chưa xác minh) | CS:1653-1667,1713 | Bỏ qua im lặng | B | auth/cancelled | — (không note) |
| A08 | scheduler | Tab trình duyệt chưa đăng ký | CS:1675-1680 | Log mỗi tick, bỏ qua | B | content_config | Spam log, không note chiến dịch |
| A09 | scheduler | Ném trước claim trong hàng đợi (getAccount, đồng hồ, getCampaign, đồng hồ sai, đọc trước claim) | CS:1719-1728,1925-1939,3306-3322 | Log "Lỗi hàng đợi"; thử lại tick sau | B | transient | — |
| A10 | scheduler | RPC hàng đợi random (settings, plan, finishRandomTurn, progress) | CS:1781-1866 | Ném → A09; lượt local bỏ ở `finally` | B/A | transient | Lượt DB có thể còn mở |
| A11 | scheduler | Kết thúc ngân sách random (không token, not_owner, !ok); tạm dừng muộn sau khi nhả | CS:1873-1916 | OwnershipLostError thoát im lặng; Error → run lỗi; tạm dừng muộn → chỉ cảnh báo | A | cancelled/transient | Nuốt |
| A12 | claim/lease | Trước claim: thao tác bị khoá hoặc chạm hạn mức | CS:3313-3321,3264-3287,9610-9626 | Ghi note có CAS trên dòng chờ chưa claim; log | B | quota | — |
| A13 | claim/lease | claimCampaignRuntimeV2 ném (mạng hoặc mất phản hồi; kiểm hợp đồng repository; exception từ RPC `claim` của random-run) | CS:3328-3350; CR:3034-3052; FRR:12-21 | Thử lại mỗi 2 giây mãi với cùng token; log một lần; hàng đợi tài khoản bị chặn | B | transient (hợp đồng → internal) | Kẹt / sai nhóm: lỗi vĩnh viễn lặp vô hạn; dừng giữa vòng để lại claim có thể đã commit |
| A14 | claim/lease | Claim `daily_maintenance_required` | CS:3352-3374 | invalidate + ensureReady rồi thử lại; lỗi → log và return | B | run_control | — |
| A15 | claim/lease | Claim `concurrency_limit_reached` | CS:3379-3383 | Note có CAS; trả `concurrency_wait` | B | run_control | — |
| A16 | claim/lease | Claim `daily_drain_due` / `vietnam_day_changed` | CS:3384-3386 | Dừng hàng đợi tài khoản, im lặng | B | run_control | `daily_stop_due` không được xử lý giống vậy |
| A17 | claim/lease | Từ chối khác: claim_rejected, unit_lease_busy, claim_lost, not_found, daily_stop_due, random_context_required, random_mode_changed | CS:3387 | Return im lặng, không note | B | auth/cancelled/run_control | Im lặng; claim_rejected gộp quyền gói, đăng nhập và lịch; unit_lease_busy mồ côi không bao giờ lộ ra |
| A18 | claim/lease | Claim ok nhưng token hoặc ngày lệch | CS:3389-3398 | Log, dừng hàng đợi, không dọn | B | internal | Kẹt (thực tế repository ném trước → A13) |
| A19 | preparation | RPC snapshot loại trừ gửi (timeout 20 giây) hoặc nhóm loại trừ sai | CS:3424-3434; SXR:25-32 | Chiến dịch 'tạm dừng' bằng update thường; nhả tài khoản | B | content_config | Sai nhóm (tạm thời → tạm dừng phải tiếp tục tay) |
| A20 | gate | Zalo runtime dừng ngay sau claim / trước runtime / sau materialize | CS:3444-3455,3514-3525,3676-3687,3795-3806 | Write barrier → return không ghi; không thì 'chờ xử lý' + note dừng + nhả | B | cancelled | Kẹt theo thiết kế tới khi phục hồi bàn giao |
| A21 | gate | Server run-control tạm dừng hoặc dừng hẳn lúc bắt đầu | CS:3457-3470,9041-9078 | Tạm dừng ở ranh giới, hoặc nhả kèm note map | B | cancelled/auth | — |
| A22 | gate | Tài khoản desktop bị chặn (thiếu, đăng xuất, đổi trạng thái) | CS:3466,9420-9429,9469-9482 | Nhả kèm note; đăng xuất → chính sách `err_logout` | B | auth | — |
| A23 | preparation | Chờ nguồn tìm data (đọc mọi chiến dịch) | CS:3472-3476,3239-3256 | Nhả kèm note chờ; lỗi đọc → A31 | B | content_config | — |
| A24 | gate | Không có quyền gói | CS:3478-3487 | Nhả kèm câu | B | auth | — |
| A25 | preparation | Thiếu thao tác hoặc workflow | CS:3489-3499,8600-8611 | 'chờ xử lý' + note + nhả | B | content_config | Sai nhóm (lỗi cấu hình thử lại mỗi tick) |
| A26 | preparation | Zalo checkSession ném, hoặc chưa đăng nhập | CS:3509-3512,9431-9467 | Note "chưa đăng nhập…" + nhả | B | auth | Sai nhóm (lỗi tạm thời hiện thành auth) |
| A27 | preparation | Thiếu workflow kết quả, hoặc khai báo sai | CS:3531-3553 | ResultContractError → run lỗi 'tạm dừng', không chính sách | B | content_config | — |
| A28 | preparation | Cấu hình chia sẻ nhóm native hoặc phiên bản workflow | CS:3533-3540 | 'tạm dừng' + nhả | B | content_config | — |
| A29 | preparation | beginActionResultRun: đọc catalog/timeout, action_unavailable, policy_*, error_override_invalid | ARR:29-55; CS:3554 | Lỗi hợp đồng → run lỗi 'tạm dừng'; lỗi đọc thường → A31 | B | content_config/transient | Sai nhóm (đọc catalog tạm thời → mục tiêu lỗi) |
| A30 | preparation | Kiểm runAsPage hoặc nạp workflow | CS:3559-3571 | 'tạm dừng' + nhả | B | content_config | Sai nhóm nếu tạm thời |
| A31 | preparation | Mọi exception sau claim (catch-all) | CS:3575-3603,1209-1241 | Note run lỗi "Lượt chạy gặp lỗi"; áp chính sách mục tiêu lỗi `err_undefined` một lần; RPC dọn token | * | internal | Sai nhóm: lỗi tạm thời / chuẩn bị tính thành mục tiêu lỗi |
| A32 | preparation | Đọc workflow nội dung hoặc danh sách input | CS:3668,3673 | → A31 | B | transient | Sai nhóm |
| A33 | preparation | Đọc bạn bè/sinh nhật Zalo (không phải 429, hoặc 429 sau 15/30/60 giây) | CS:8095-8128,8130-8322 | ZaloCampaignReadError → A31 (câu an toàn) | B | transient/quota/auth | Sai nhóm |
| A34 | preparation | Đọc gợi ý kết bạn hoặc lời mời đã gửi lỗi (không phải 429) | CS:8365-8384,8486-8505 | Đánh dấu materialize = 0 → chiến dịch hoàn thành | B | transient | Sai nhóm (tạm thời → hoàn thành) |
| A35 | preparation | Materializer lời mời đã gửi xoá input trước khi đọc | CS:8478-8481 | Input đã bị xoá nếu sau đó đọc lỗi | B | internal | Mất dữ liệu |
| A36 | preparation | Tag sai; upsert danh bạ, chèn lô, ghi extraSettings lỗi | CS:8154-8156,8209-8237,7515-7520 | Error thường → A31 | B | content_config/transient | Sai nhóm |
| A37 | preparation | Chờ nhịp/429 bị ngắt (tạm dừng, dừng hẳn, ranh giới, dừng) | CS:8062-8080,3705,3728,3743,3757 | Trả null; `stopped` → không nhả | B | cancelled | Kẹt tới khi phục hồi đăng nhập |
| A38 | preparation | Workflow bạn bè gợi ý FB lỗi, hoặc settle trả false | CS:7522-7598 | Run lỗi → A31; settle false → OwnershipLost im lặng | I | transient | Sai nhóm |
| A39 | preparation | Đọc snapshot blocklist bạn bè Zalo lỗi | CS:6789-6833,3825-3832 | 'chờ xử lý' + note "không hợp lệ" + nhả | B | content_config | Sai nhóm (tạm thời) |
| A40 | preparation | Nội dung nâng cao sai / nội dung Zalo rỗng | CS:3879-3885,5542-5560,16870-16904 | 'chờ xử lý' + note + nhả | B | content_config | Thử lại mỗi tick |
| A41 | preparation | Ghi chỉ số xoay link nguồn | CS:4130-4135 | `catch {}` | B | transient | Nuốt |
| A42 | preparation | buildVariablesV2 ném Error thường (vd loại media comment) | CS:4192-4201,10320-10343 | Catch theo mục tiêu ngoài ném lại → A31 | B | content_config | Sai nhóm |
| A43 | preparation | Giải/tải media (timeout 60 giây, lỗi HTTP, thiếu đường dẫn local) | CS:17431-17486,17512-17520,4741-4744,5972-5977 | Input về 'chờ xử lý'; chiến dịch 'tạm dừng' | B | content_config | Sai nhóm (tạm thời → tạm dừng); trong helper block thì thành lỗi mục tiêu (A86) |
| A44 | preparation | RPC xoay nội dung lỗi hoặc thiếu token | CS:16906-16960; CCP:37-45 | CampaignContentRotationError: trong helper → bước lỗi → mục tiêu lỗi; trong batch chia sẻ → A31 | I (trước nền tảng) | transient/internal | Sai nhóm |
| A45 | preparation | AI viết lại lỗi | CS:16973-16986,6059-6088,14862-14929 | Dùng câu gốc + log | B | transient | Nuốt (mở khi lỗi) |
| A46 | gate | Kiểm server drain (`!running`) | CS:3922,3955,3973,3978,3999,4039,4060,4089,4097,4122,4153,4202 | Return không nhả | B | cancelled | Kẹt theo thiết kế (manager phục hồi) |
| A47 | gate | Hết ngân sách batch random | CS:3930-3933 | finishRandomBudget | B | quota | — |
| A48 | gate | Ranh giới lượt (giờ dừng cấu hình, 23:59, đổi ngày; đọc đồng hồ lỗi → coi như tới) | CS:3935,2801-2829 | Yield (A78) | B | run_control | — |
| A49 | gate | Đọc điều khiển theo mục tiêu, chiến dịch hoặc đồng hồ DB lỗi | CS:3953-3968 | → A31 | B | transient | Sai nhóm |
| A50 | gate | Có yêu cầu tạm dừng, chiến dịch 'tạm dừng', hard end nhóm data, tài khoản bị chặn | CS:3956-3984 | Tạm dừng ở ranh giới / kết thúc / dừng + nhả | B | cancelled/run_control/auth | — |
| A51 | gate | Ghi bỏ qua blocklist hoặc ghi tạm dừng opt-out lỗi | CS:3998-4003,7269-7285,6885-6905 | → A31 | B | transient | Sai nhóm |
| A52 | gate | RPC kiểm opt-out, tra global-ID hoặc chuẩn bị link opt-out lỗi | CS:7013-7047,7084-7097,7151-7171 | Thêm cảnh báo; vẫn gửi | B | transient | Nuốt (cổng tuân thủ mở khi lỗi) |
| A53 | gate | Ghi note cảnh báo opt-out | CS:6849-6870 | `.catch(()=>{})` | B | transient | Nuốt |
| A54 | gate | Đọc nguồn Zalo của loại trừ gửi lỗi | CS:6974-6981 | Hiệu ứng chính sách Zalo; quyết định `unknown` → input tạm dừng | B | transient/auth | — |
| A55 | gate | RPC facts/tạm dừng của loại trừ gửi lỗi (trước claim) | CS:6966-6971,6984 | → A31 | B | transient | Sai nhóm |
| A56 | gate | Kiểm loại trừ sau khi tra số (input đã claim) lỗi | CS:7125-7133,4415,4633 | ZaloSendExclusionError → run lỗi 'tạm dừng' | I (trước khi gửi) | transient | Sai nhóm (tạm dừng) |
| A57 | gate | RPC cooldown lỗi, batch thiếu hoặc quyết định sai | CS:4010-4026,4162-4189,5717-5734,7183-7230 | Nhả kèm note "sẽ tự thử lại" + log | B | transient | — |
| A58 | gate | Quyết định cooldown tạm dừng/hoãn | CS:4013-4019,7248-7267 | Bỏ qua input; log tạm dừng | B | content_config | — |
| A59 | gate | Tra duyệt bài nhóm lỗi | CS:7388-7399 | console.error; vẫn đăng | B | transient | Nuốt (mở khi lỗi) |
| A60 | gate | Đọc hạn mức chia sẻ nhóm lỗi | CS:7483-7506 | Sức chứa 0 | B | transient | Nuốt |
| A61 | gate | Thao tác bị khoá / chạm hạn mức giờ / ngày | CS:4049-4109,9569-9599,8624-8890 | Note, hoặc chính sách lỗi `error_limit_in_*`; tuỳ chọn lướt-nghỉ FB | B | quota | — |
| A62 | gate | Đọc hạn mức/khoá lỗi | CS:4110-4116 | Nhả kèm "sẽ tự thử lại" | B | transient | — |
| A63 | gate | Tác vụ con lướt-nghỉ FB lỗi | CS:9485-9567 | `catch {}` | B | transient | Nuốt (theo thiết kế) |
| A64 | gate | getAutomationPage hoặc proxy prepareAccountSession lỗi | CS:4118-4121,14203-14210,5099-5101 | → A31 | B | transient/auth | Sai nhóm |
| A65 | claim/lease | beginCampaignRunUnit thiếu ngữ cảnh ranh giới | CS:9086-9091 | Log, trả false, không nhả | B | internal | Kẹt |
| A66 | claim/lease | Claim unit ném (mạng; kiểm: >50 id, UUID/ngày sai, token/input lệch) | CS:9118-9143; CR:3065-3144 | Thử lại mỗi 2 giây khi đang chạy; khi dừng trả false, không nhả | B | transient/internal | Kẹt (lỗi vĩnh viễn lặp mãi) |
| A67 | claim/lease | Claim unit ok nhưng số lượng hoặc token lệch | CS:9145-9154 | Ném trước khi lease được đăng ký local → dọn gửi `unitToken = null` → RPC `not_owner` → không ghi | B | internal | Kẹt (lease DB còn, dòng giữ 'đang chạy') |
| A68 | claim/lease | Thử lại đúng token ok, nhưng claim cha mất hoặc không còn chạy | CS:9168-9193 | Settle kèm requeue; tạm dừng nếu đang tạm dừng; trả false | B | cancelled | Kẹt nếu không tạm dừng |
| A69 | claim/lease | Huỷ bắt đầu unit (dừng hoặc Zalo dừng) | CS:9194-9198,4262-4265 | Settle kèm requeue; return | B | cancelled | Kẹt tới khi phục hồi |
| A70 | claim/lease | Lý do unit random_mode_changed, random_budget_exhausted, daily_*, runtime_control_paused | CS:9202-9232 | finishRandomBudget hoặc yield | B | quota/run_control/cancelled | — |
| A71 | claim/lease | Unit `runtime_not_owner` | CS:9236-9258 | Server: stopAcceptingNewZaloWork + onRuntimeOwnershipLost. Desktop Zalo: chặn tới khi khởi động lại. Không phải Zalo: không làm gì | B | cancelled | Im lặng với không phải Zalo |
| A72 | claim/lease | Unit app_access_denied, account_logged_out/inactive/deleted, campaign_deleted, not_found, input_not_pending | CS:9260-9293 | Dừng hoặc nhả | B | auth/cancelled | — |
| A73 | claim/lease | Lý do unit khác (runtime_claim_mismatch, unit_lease_*, unit_claim_*, invalid_claimed_vietnam_date) | CS:9295-9299 | Log, trả false, không nhả | B | cancelled/internal | Kẹt tới khi phục hồi |
| A74 | claim/lease | Settle ném, hoặc trả `not_found` / `unit_lease_corrupt` | CS:9330-9374; CR:3149-3195; MIG v387 | Thử lại mỗi 2 giây khi đang chạy; giữ bảo trì. Code chờ `unit_lease_not_found` mà RPC không bao giờ trả | A | transient/internal | Kẹt |
| A75 | claim/lease | Settle `unit_lease_mismatch` / `runtime_not_owner` | CS:9356-9361 | Bỏ lease, log, false | A | cancelled | — |
| A76 | claim/lease | Settle theo mục tiêu managed (finishActionResultUnit) lỗi | CS:9327; ARR:187-209,233-237 | ResultContractError(`settle:…`) → run lỗi 'tạm dừng' | A | transient | Sai nhóm (tạm dừng) |
| A77 | claim/lease | Đọc tiến độ random sau settle | CS:9344-9353,3609-3617 | FacebookRandomProgressReadError → run lỗi | A | transient | — |
| A78 | claim/lease | RPC yield lỗi, hoặc `unit_still_running` | CS:2943-2974 | Thử lại / chờ mỗi 2 giây mãi khi đang chạy | A | transient/internal | Kẹt (lease mồ côi) |
| A79 | claim/lease | Kết quả yield: điều khiển tạm dừng, từ chối, runtime_not_owner, khác (runtime_claim_mismatch, ngày sai) | CS:2982-3072 | Tạm dừng / nhả / chặn; "khác" → chỉ log | A | cancelled/auth | Kẹt ("khác" không nhả) |
| A80 | claim/lease | Kiểm ranh giới ngày tư vấn lỗi hoặc từ chối | CS:2836-2910 | Lỗi → yield với đồng hồ không dùng được; từ chối → dừng / nhả / chặn | B | transient/auth | — |
| A81 | scheduler | Đối soát bảo trì sau settle | CS:3093-3151 | Log; dừng hàng đợi | A | run_control | — |
| A82 | lifecycle | Guard tài khoản 5 giây lỗi | CS:4270-4302 | console.error | I | transient | Nuốt (không còn phát hiện đăng xuất / tạm dừng) |
| A83 | lifecycle | Guard điều khiển server trong batch chia sẻ | CS:5815-5832 | console.error | I | transient | Nuốt |
| A84 | preparation | Engine lỗi trước khi chạy (thiếu workflow, nạp block lỗi DB) | WE:127-134; CS:4317,4627-4712 | Catch trong: input 'hoàn thành' + note lỗi + chính sách mục tiêu lỗi | I (trước nền tảng) | transient/internal | Sai nhóm (input bị dùng) |
| A85 | recording | Ghi run/step của engine; chụp màn hình | WE:140-153,232-244,274-290,357-370,396-398 | console.error | I | transient | Nuốt |
| A86 | preparation | Exception trong helper block (DB, xoay, media) | WE:335-343 | Bước lỗi → mục tiêu lỗi `err_undefined` | I | lẫn lộn | Sai nhóm |
| A87 | lifecycle | dừng / đăng xuất / thoát / hết phiên huỷ một mục tiêu không phải Zalo | CS:1003-1038 → 4430-4591; H:802,1259,1393,1433 | Kết quả `cancelled` → input 'hoàn thành' "Lỗi không xác định" + chuỗi lỗi `err_undefined` | I | cancelled | Sai nhóm |
| A88 | lifecycle | Zalo runtime dừng hoặc bàn giao giữa mục tiêu | CS:1105-1166,4433-4470,4655-4685,4761-4782 | Input 'hoàn thành' với note không chắc chắn; chiến dịch 'chờ xử lý' với note dừng | I | unknown_delivery | Sai nhóm khi chưa gửi gì |
| A89 | transport | Hàng rào media Zalo hết giờ; session dừng khi đang gửi | CME:93-128; CS:6197-6225,14573-14629 | `campaign_media_timeout` / `command_result_unknown` → không thử lại, dừng sau mục tiêu | I | unknown_delivery | — |
| A90 | recording | Output block vi phạm hợp đồng kết quả | ARR:72-131; CS:4353-4359 | Kết quả đã nhận được log; run lỗi 'tạm dừng' | I | internal | — |
| A91 | recording | Ghi mốc newsfeed lỗi | CS:4338-4352 | Huỷ run → A31 | A | transient | Sai nhóm |
| A92 | preparation | Chưa bắt đầu chuyển danh tính Page; khôi phục danh tính lỗi | CS:4361-4365,4637-4640,17339-17389 | Chiến dịch tạm dừng (cả tài khoản khi khôi phục lỗi); settle kèm requeue | B/A | content_config/internal | Sai nhóm nếu tạm thời |
| A93 | recording | Ghi kết quả managed lỗi | ARR:139-185 (bọc ở 180) | ResultContractError(`write:…`) → run lỗi 'tạm dừng'; dọn hoàn thành input đã bắt đầu, không thử lại | A | transient | Sai nhóm (tạm dừng; thành công không được ghi) |
| A94 | recording | Chèn createCampaignDetail kiểu cũ lỗi | CR:6371-6384; CS:10821-10936 | Catch trong: input 'hoàn thành' kèm câu lỗi DB, chuỗi lỗi `err_undefined`, log "Lỗi engine v2" | A | transient | Sai nhóm (đã giao bị tính thất bại) |
| A95 | recording | Bộ đếm thao tác / reset lỗi liên tiếp | CR:6393-6400 | console.error | A | transient | Nuốt (hạn mức đếm thiếu) |
| A96 | recording | Ghi trạng thái input sau run | CS:4445-4512; CR:5413-5503 | Managed → lỗi hợp đồng → tạm dừng; cũ → catch trong viết lại input + chuỗi lỗi | A | transient/internal | Sai nhóm |
| A97 | recording | Tăng xoay nội dung sau khi đăng | CS:4390-4392,17066-17096 | Catch trong → lỗi mục tiêu | A | transient | Sai nhóm |
| A98 | recording | Đọc/ghi chính sách lỗi (chính sách, bộ đếm mục tiêu lỗi, disableActions, trạng thái) | CS:9925-10134,3583-3597 | Lỗi được cache lại; catch ngoài chỉ console.warn | A | transient | Nuốt (mất chính sách) |
| A99 | recording | resetCampaignBadTargetCount | CS:10136-10146 | console.error | A | transient | Nuốt |
| A100 | recording | appendCampaignLog, recordAccountLog, sự kiện run | CS:14166-14201,16157-16176; CR:2879-2939; ALS:26-45 | Nuốt | * | transient | Nuốt |
| A101 | recording | Batch mời nhóm FB lỗi ngoài hợp đồng (kể cả lỗi DB sau submit) | CS:5232-5252,5288-5326 | Detail 'lỗi' + chiến dịch 'tạm dừng' | I/A | lẫn lộn | Sai nhóm (tạm dừng) |
| A102 | recording | Thiếu hiệu ứng managed của mời nhóm | CS:5187-5189 | ResultContractError `batch_result_missing` → tạm dừng | A | internal | — |
| A103 | preparation | Lỗi media batch chia sẻ Zalo sau claim unit | CS:5841-5846,5972-5977 | Tạm dừng + nhả; settle unit với requeue = false | I (trước khi gửi) | content_config | Kẹt (input giữ 'đang chạy') |
| A104 | lifecycle | Dọn lượt lỗi gặp lỗi tạm thời | RCR:4-12,40-80; CS:1243-1277 | Thử lại mỗi 2 giây tới khi bị huỷ | A | transient | — |
| A105 | lifecycle | Dọn `recovery_required` (lỗi vĩnh viễn, insufficient_ownership, not_found, invalid_unstarted_ids, 22023, staff đổi, phản hồi sai) | RCR:53-65; CR:3197-3221; MIG v392 | Giữ run; chặn tài khoản tới khi phục hồi đăng nhập | A | internal | Kẹt (cả phiên) |
| A106 | lifecycle | Dọn bị huỷ (dừng, bàn giao, write barrier) | CS:1181-1185,1239 | `stopped` → giữ | A | cancelled | Kẹt tới khi phục hồi |
| A107 | lifecycle | Dọn `not_owner` | CS:1264-1270 | Xoá trạng thái local, dừng hàng đợi | A | cancelled | — |
| A108 | claim/lease | Ghi tạm dừng-ở-ranh-giới hoặc nhả-trước-chạy lỗi | CS:9377-9418,9628-9645 | Run lỗi + ném | B/A | transient | — |
| A109 | claim/lease | Nhả tài khoản Zalo không kèm token; ghi trạng thái thường | CS:17200-17241,17318-17337; AR:1285-1305; CR:2318-2474 | Quyết định nhả theo trạng thái đọc được; update vô điều kiện | A | cancelled | Có thể ghi đè chủ mới hoặc trạng thái điều khiển |
| A110 | claim/lease | Settle cuối trong `finally` lỗi | CS:3608-3620,3636 | console.error; lease giữ trong bộ nhớ | A | transient | Kẹt (lease DB có thể còn) |
| A111 | recording | Lý do finalize (campaign_control_won, specialized_finalizer_required, not_found, pending_input_remaining); server finalize hoặc tăng khung giờ !ok | CS:2074-2113,17153-17198,2402-2436; CR:1408-1447 | Trả false / log; đường server → A31 | A | run_control/internal | `specialized_finalizer_required` để chiến dịch 'đang chạy' |
| A112 | lifecycle | runScopedRecovery: producer không idle trong 30 giây, hoặc RPC lỗi (đăng xuất / thoát chỉ thử 1 lần) | H:682-748,811,1268,1442 | Trả false; đăng xuất / thoát vẫn tiếp | A | internal | Kẹt tới lần đăng nhập sau |
| A113 | lifecycle | Phiên hoặc quyền gói bị thu hồi | H:857-876 | stopAcceptingNewZaloWork; chờ ≤1 giây cho idle, không thì thử lại sau | I | auth | — |
| A114 | lifecycle | Bàn giao chế độ runtime Desktop↔server | H:530-635; CS:1091-1117,1168-1175 | Chặn + `handoff`; bỏ claim (write barrier) | I | cancelled | Kẹt theo thiết kế |
| A115 | lifecycle | App Server mất quyền / không idle trong 30 giây | ZSRM:963-978,1071-1143 | stopDeferred, thử lại | I | cancelled | — |
| A116 | lifecycle | Máy ngủ / thức | H:1200-1220 | Vô hiệu đồng hồ; khi thức chạy bảo trì rồi đánh thức (bảo trì lỗi thì không đánh thức) | — | run_control | — |
| A117 | transport | Supabase fetch không timeout, không thử lại | SC:28-39 | Lỗi đẩy lên; request treo không bị chặn (chỉ dọn, loại trừ gửi, random-run và catalog có abort signal) | * | transient | Thoát (làm kẹt claim/settle/yield) |

**Đường thoát / kẹt (akaAgent):**
- **Vòng lặp chặn hàng đợi tài khoản cả phiên:** CS:3328-3350, 9118-9143, 9330-9374, 2943-2974 (`unit_still_running`).
- **Return không nhả, để chiến dịch / tài khoản 'đang chạy' tới khi đăng nhập lại hoặc phục hồi cũ:**
  - Đường unit / claim: CS:9086-9091, 9119, 9192, 9197, 9236-9258 (không phải Zalo), 9295-9299, 3389-3398.
  - Đường dừng / tắt: 4821 và 5953 (sleep `stopped`); 3705/3728/3743/3757 (materializer khi dừng); các return drain của server (A46).
  - Return write barrier: 3448, 3518, 3680, 3799, 3943, 4437, 4610, 4662, 4679, 4765, 4773.
  - Thoát im lặng khi mất quyền: 3578.
- **Để lại unit lease DB hoặc input:**
  - CS:9145-9154: lease đã commit nhưng dọn gửi không kèm unit token → RPC `not_owner`.
  - CS:3608-3620: settle lỗi trong `finally`.
  - CS:5972-5977: batch chia sẻ settle với requeue = false để input 'đang chạy'.
- **Giữ run lỗi:** dọn `recovery_required` hoặc `stopped` giữ `hasFailedAccountRun` là true (CS:1177-1179, 1243-1277). Tài khoản bị chặn tới lần đăng nhập sau mới xoá (H:731, 1130).
- **Cổng bảo trì** chờ mãi khi còn dòng đang chạy hoặc lease ngày cũ (DMC:55-76); chặn tick của mọi tài khoản.
- **Phục hồi lúc đăng xuất / thoát** chỉ thử một lần (H:686); dòng giữ 'đang chạy' tới lần đăng nhập sau.
- **Không có hạn request** cho Supabase fetch (SC:28-39), nên request treo làm kẹt các vòng trên.
- **Lỗi tick / hàng đợi không bắt** chỉ được log (CS:1690-1700, 1720); lượt random có thể còn mở (CS:1838-1858).

---

## 4. chat-sync trên Fly (akaAgentChatApi)

**Đường dẫn viết tắt** (gốc `/Users/lequangnhut/Repos/akaAgentChatApi`):

| Ký hiệu | Đường dẫn |
|---|---|
| ZS | `apps/system-worker/src/zaloCampaignScheduler.ts` |
| ZE | `apps/system-worker/src/zaloCampaignExecutor.ts` |
| CCC | `apps/system-worker/src/campaignCommandClient.ts` |
| CFC | `apps/system-worker/src/campaignFailureCleanup.ts` |
| CSR | `apps/system-worker/src/campaignStartupRecovery.ts` |
| CWL | `apps/system-worker/src/campaignWorkerLeadership.ts` |
| CIM | `apps/system-worker/src/campaignInputMaterializer.ts` |
| CUP | `apps/system-worker/src/campaignUnitProgress.ts` |
| WM | `apps/system-worker/src/main.ts` |
| WK | `apps/system-worker/src/worker.ts` |
| CFG | `apps/system-worker/src/config.ts` |
| RR | `packages/database/src/campaignRuntimeRepository.ts` |
| CAR | `packages/database/src/campaignActionResults.ts` |
| CAP | `packages/database/src/campaignActionRepository.ts` |
| CAD | `apps/chat-api/src/campaignActionDispatcher.ts` |
| ZCC | `apps/chat-api/src/zaloCommandCoordinator.ts` |
| AS | `apps/zalo-server-runtime/src/accountSupervisor.ts` |
| CRV | `apps/zalo-server-runtime/src/commandRecovery.ts` |
| RB | `apps/zalo-server-runtime/src/runtimeBridge.ts` |
| ZRM | `apps/zalo-server-runtime/src/main.ts` |
| FLY | `fly.toml` |

| Mã ca | Lớp | Lỗi gì | Ở đâu | Hiện xử lý | Pha | Nhóm đề xuất | Khoảng hở |
|---|---|---|---|---|---|---|---|
| B01 | scheduler | Vòng lặp lỗi (bảo trì, tìm việc) | ZS:352-378 | onError; thử lại ở lần poll 1 giây sau | B | transient | — |
| B02 | scheduler | enableDueActions | ZS:359 | onError | B | transient | Nuốt |
| B03 | scheduler | Barrier bảo trì của chủ đóng với 0 chiến dịch ngày cũ | ZS:628-632,559-581 | Ném; observer log; chiến dịch của chủ đó không được tìm; thử lại mỗi 30 giây | B | run_control | Chặn chủ |
| B04 | scheduler | Barrier của chủ chờ khi còn dòng ngày cũ đang chạy | ZS:620-634 | Hỏi lại mỗi 2 giây mãi | B | run_control | Kẹt |
| B05 | scheduler | Đổi ngày khi đang barrier; maintainScheduleOwner hoặc publishMaintenanceRuntimeState lỗi | ZS:198-203,568-572,636-645 | Reset housekeeping / chủ chưa sẵn sàng / nuốt | B | run_control | — |
| B06 | scheduler | Phục hồi khởi động của chủ trả false hoặc `campaign_commands_unsettled` | ZS:602-616; RR:1037-1055 | Lỗi có mã bị observer bỏ qua im lặng; thử lại mỗi 30 giây | B | unknown_delivery | Kẹt (lệnh `waiting_socket` không được gỡ, xem B66/B88) |
| B07 | scheduler | Chặn trước claim (cấu hình nội dung, nội dung chia sẻ rỗng, hạn mức) | ZE:494-519; ZS:463-480 | Hoãn 30 giây; note CAS + log | B | content_config/quota | — |
| B08 | scheduler | Preclaim ném | ZS:416-421 | Hoãn 30 giây + onError | B | transient | — |
| B09 | claim/lease | claimRuntime: tạm thời, hết lượt thử, mất phản hồi rồi !ok, bị huỷ | ZS:720-772,1479-1512 | Thử lại có giới hạn (`WORKER_EVENT_MAX_ATTEMPTS` × 2 giây) → cleanupFailedRun (attemptAfterStop) | B | transient/cancelled | — |
| B10 | claim/lease | claimRuntime lỗi không tạm thời; claim không có ngày Việt Nam | ZS:1506,773 | Ném → cleanupFailedRun | B | internal | — |
| B11 | claim/lease | Claim `daily_maintenance_required` | ZS:750-763,683-704 | Ép bảo trì chủ; thiếu chủ → return im lặng | B | run_control | Im lặng |
| B12 | claim/lease | Kiểm quyền gói trước (`chat_sync_not_enabled`, `runtime_not_owner`) và từ chối khác | RR:1298-1315; ZS:765 | Return im lặng; không note, không hoãn | B | auth/cancelled | Im lặng; có thể lặp mỗi 1 giây (tìm việc không bỏ qua chiến dịch đang giữ unit lease) |
| B13 | preparation | beginResultRun (catalog, action_unavailable, error_override_invalid) / beginSendExclusionRun (snapshot, nhóm sai, không hỗ trợ) | ZS:774-775; ZE:385-397; CAR:58-80 | pauseOnFailure → dọn `tạm dừng` | B | content_config | Sai nhóm (tạm thời → tạm dừng) |
| B14 | recording | publishRuntimeState, appendOperationalLog, appendProgressLog của executor | ZS:1239-1254; ZE:1444-1455 | onError / cảnh báo | * | transient | Nuốt |
| B15 | preparation | Đọc listInputData hoặc hasLinkedFindDataSource | ZS:781-786 | Ném → dọn (không tạm dừng) | B | transient | — |
| B16 | preparation | Chờ tìm data; không còn input chờ | ZS:782-786,811-827 | releaseClaim kèm note / completeOrReschedule | B | content_config | — |
| B17 | preparation | Materializer thấy điều khiển tạm dừng/dừng | CIM:155-170; ZS:795-799 | CampaignMaterializationControlError → completeControlBoundary | B | cancelled | — |
| B18 | preparation | Materializer bị ngắt (lệnh không chắc, binding_changed, runtime_unavailable, cancelled) | CIM:106-114 | Ném lại → dọn | B | transient/cancelled | — |
| B19 | preparation | Materializer nhận 429 sau khi thử lại 15/30/60 giây | CIM:202-230 | Dọn chung, chiến dịch về `chờ xử lý` | B | quota | Sai nhóm (không xử lý hạn mức) |
| B20 | preparation | Đọc gợi ý / lời mời đã gửi lỗi | CIM:461-474,549-561 | Materialize = 0 → chiến dịch hoàn thành | B | transient | Sai nhóm |
| B21 | preparation | Materializer lời mời đã gửi xoá input trước khi đọc | CIM:531 | Mất dữ liệu nếu sau đó đọc lỗi | B | internal | Mất dữ liệu |
| B22 | preparation | paceRead appendLog lỗi | CIM:189-200 | Không nuốt → dọn | B | transient | Sai nhóm (lỗi ghi log làm hỏng lượt) |
| B23 | preparation | Ghi DB của materializer; ngày claim sai | CIM:97,377-387,420-430,498-518,586-596 | Ném → dọn | B | transient/internal | — |
| B24 | preparation | Snapshot blocklist bạn bè lỗi | ZS:1318-1356 | Note "không hợp lệ" → releaseClaim | B | content_config | Sai nhóm; lặp mỗi lần poll |
| B25 | gate | Điều khiển tạm dừng/dừng trước mục tiêu hoặc batch | ZS:853-858,1016-1020 | completeControlBoundary | B | cancelled | — |
| B26 | gate | Dừng hẳn: `account_logged_out` → chính sách đăng xuất; staff/app access bị từ chối → nhả + note; inactive/deleted/campaign_deleted/runtime_not_owner/chat_sync_not_enabled → note cleanupClaim chung | ZS:1280-1316; RR:1754-1807 | Như cột "Lỗi gì" | B | auth/cancelled | Sai nhóm (gộp lý do vào một note) |
| B27 | gate | Đọc getRunControl lỗi (trước mục tiêu, khi nghỉ, khi hoàn tất) | ZS:853,1164,1471 | Ném → dọn | B/A | transient | — |
| B28 | gate | Kiểm opt-out, giải global-ID hoặc chuẩn bị link lỗi | ZE:560-585,634-644,656-669 | Cảnh báo; vẫn gửi | B | transient | Nuốt (mở khi lỗi) |
| B29 | gate | Ghi cảnh báo opt-out | ZE:720-738 | `.catch` | B | transient | Nuốt |
| B30 | gate | Ghi chặn opt-out | ZE:704-718 | Ném → dọn | B | transient | — |
| B31 | gate | Lỗi nguồn loại trừ gửi (không chắc/tạm thời → ném; runtime không có; chính sách; unknown → tạm dừng input) | ZE:452-461 | Ném từ preflight trước unit → dọn chung | B | lẫn lộn | Sai nhóm (bỏ qua map requeue/stop của execute) |
| B32 | gate | RPC facts/tạm dừng của loại trừ gửi lỗi | ZE:444-449,464 | Ném → dọn | B | transient | — |
| B33 | gate | Lệnh đọc gửi trước khi claim unit (hồ sơ, nhãn, quan hệ) | ZE:578-579,429,435; ZS:861 | Không theo dõi trong submittedCommands | B | internal | Dọn không chờ được (chỉ đọc) |
| B34 | gate | Nhả ngữ cảnh nhãn | ZE:399-411 | `.catch` | A | transient | Nuốt |
| B35 | gate | RPC cooldown lỗi, thiếu hoặc quyết định sai | ZS:1358-1407 | Ném → dọn | B | transient | Sai nhóm (desktop nhả kèm note thử lại) |
| B36 | gate | Cooldown tạm dừng/hoãn | ZS:865-869,1047-1050 | Bỏ qua + log | B | content_config | — |
| B37 | claim/lease | claimUnit tạm thời, hết lượt thử, mất phản hồi, bị huỷ | ZS:879-903,1058-1078 | Thử lại có giới hạn → cleanupFailedRun | B | transient/cancelled | — |
| B38 | claim/lease | Số lượng claim lệch | ZS:904,1079 | Ném → dọn | B | internal | — |
| B39 | claim/lease | Unit `daily_*` → yieldDailyBoundary | ZS:907-912,1082-1087 | Không kiểm kết quả yield | B | run_control | Bỏ qua kết quả |
| B40 | claim/lease | Unit `account_logged_out` | ZS:913-914; RR:2062-2122 | stopLoggedOutClaim (chính sách đăng xuất) | B | auth | — |
| B41 | claim/lease | Unit `runtime_control_paused` / `runtime_not_owner` | ZS:915-916 | completeControlBoundary | B | cancelled | — |
| B42 | claim/lease | Lý do unit khác (input_not_pending, deleted/inactive, app_access_denied, unit_lease_*, runtime_claim_mismatch, chat_sync_not_enabled) | ZS:917-919; RR:1676-1684 | cleanupClaim với note chung | B | nhiều loại | Sai nhóm (gộp, im lặng) |
| B43 | preparation | Hạn mức hết giữa preclaim và claim unit | ZE:1180,1330-1341,771-787 | Về hàng đợi + dừng (hoặc hoàn thành nếu đã giao) | B | quota | — |
| B44 | preparation | takeContentIndex lỗi hoặc thiếu claim token | ZE:1836-1841,1895-1909 | CampaignContentRotationError → dọn (không tạm dừng) | B | transient/internal | Sai nhóm (kết hợp B45) |
| B45 | claim/lease | `command()` đánh dấu input đã bắt đầu ở lệnh đầu tiên, kể cả lệnh tra số chỉ đọc | ZE:1628 | Mọi lỗi sau đó hoàn thành input "Kết quả chưa xác nhận" | B | unknown_delivery | Sai nhóm (quá thận trọng) |
| B46 | preparation | Cấu hình media sai (không URL cloud, đường local, >10 tệp) | ZE:2279-2293,1342-1349,802-809 | CampaignMediaError → về hàng đợi + dừng + tạm dừng | B | content_config | — |
| B47 | transport | Runtime `campaign_media_download_failed` | ZE:115-117,1966-1968 | CampaignMediaError → tạm dừng | I | content_config | Sai nhóm (tạm thời → tạm dừng) |
| B48 | preparation | AI viết lại lỗi | ZE:2171-2193 | Dùng câu gốc + log | B | transient | Nuốt (mở khi lỗi) |
| B49 | preparation | Tra hồ sơ lỗi (không phải không chắc) | ZE:1803-1820 | Dùng UID/tên từ input | B | transient | Nuốt (mở khi lỗi) |
| B50 | recording | Ghi detail thành công lỗi sau khi gửi; dùng chung `try` với lệnh gửi | ZE:1953-1977,2000-2013 | Tạm thời → dọn (không rõ); hợp đồng → tạm dừng; khác → recordFailure ghi detail thất bại + chuỗi lỗi | A | transient/internal | Sai nhóm (đã giao bị ghi thất bại) |
| B51 | recording | Ghi hoặc settle managed lỗi DB | CAR:128-134,152-159 | Bọc thành ResultContractError mã `action_result_contract` → pauseOnFailure → `tạm dừng` | A | transient | Sai nhóm (tạm dừng) |
| B52 | recording | updateInput sau mục tiêu | ZE:1204,1289,1324,1333,1347,1355,1371,1402; RR:1809-1823 | Tạm thời → dọn; còn lại recordFailure hoặc tạm dừng | A | transient/internal | Sai nhóm |
| B53 | recording | Áp chính sách lỗi (getErrorPolicy, applyErrorSideEffects, applyBadTargetPolicy) | ZE:1478-1496,2322-2455; CUP:24-37 | policyFailed giữ lại → ném lại → tạm dừng (vĩnh viễn) hoặc dọn (tạm thời) | A | transient/internal | Sai nhóm (tạm dừng) |
| B54 | recording | createZaloApiErrorLog | ZE:2403-2425 | console.warn | A | transient | Nuốt |
| B55 | preparation | Lỗi không phải lệnh trong mục tiêu (bug, Zod, lỗi DB vĩnh viễn) | ZE:1385-1414 | recordFailure coi như lỗi Zalo (`err_undefined`, chuỗi lỗi) | * | internal | Sai nhóm |
| B56 | scheduler | `isTransientDatabaseError` so chữ ("timeout", "connection reset") | WK:276-314; ZE:126-132 | Lỗi không phải DB cũng đi đường dọn | * | internal | Sai nhóm |
| B57 | scheduler | Executor ném (CampaignTargetExecutionError) | ZS:931-940,987-996 | Log "Lỗi"; tạm dừng nếu lỗi hợp đồng hoặc không tạm thời; cleanupFailedRun | * | internal | Sai nhóm (mọi lỗi vĩnh viễn bất ngờ đều tạm dừng) |
| B58 | claim/lease | settleUnit: `finish` managed lỗi, lý do lạ, hoặc hết lượt thử tạm thời | ZS:1514-1552; RR:1703-1722 | Thử lại nếu tạm thời (regex câu), không thì `recovery_required` → dọn | A | transient/internal | — |
| B59 | claim/lease | Settle `unit_lease_mismatch` / `runtime_not_owner` | ZS:1523,947-951 | Bỏ unit, return không nhả | A | cancelled | — |
| B60 | claim/lease | Kết quả dừng, nghỉ bị ngắt, huỷ giữa các mục tiêu | ZS:958-984,1126-1142,1256-1270,1462-1477 | Control boundary / pauseClaim / releaseClaim / cleanupClaim ("Zalo runtime đang dừng.") | A | cancelled | — |
| B61 | claim/lease | advanceMultiDailySlot !ok và không tạm dừng | ZS:1207-1221; RR:2346-2371 | Ném → dọn; khi thành công, xoá claim và nhả tài khoản chạy thành các câu riêng | A | internal | Không nguyên tử |
| B62 | claim/lease | finalize: lý do lạ; lý do khác completed không được log; finalize, xoá claim và nhả tài khoản là các câu riêng | RR:1912-1947; ZS:1226-1237 | Ném → dọn / im lặng | A | internal | Kẹt (crash giữa các câu) |
| B63 | claim/lease | releaseClaim / pauseClaim / completePauseAtBoundary không làm gì nếu còn unit token hoặc token đã đổi | RR:1968-2017,2043-2058,2267-2287 | Không làm gì, im lặng | A | cancelled | Kẹt |
| B64 | lifecycle | cleanupFailedClaim `not_owner` | RR:2144-2159 | Bỏ run đang giữ | A | cancelled | — |
| B65 | lifecycle | cleanupFailedClaim `commands_running` | RR:2225-2227; CFC:65-80 | Thử lại mỗi 2 giây khi đang chạy | A | unknown_delivery | — |
| B66 | lifecycle | cleanupFailedClaim `command_outcome_unknown` (waiting_socket, hoặc trạng thái khác pending/completed/failed) | RR:2228-2231; CFC:65-80 | Thử lại mãi; giữ tài khoản | A | unknown_delivery | Kẹt |
| B67 | lifecycle | Dọn `recovery_required` (lỗi vĩnh viễn, huỷ chưa xong, phản hồi sai, RPC từ chối) | RR:2223,2242-2244; CFC:69-76 | Giữ suốt đời process | A | internal | Kẹt |
| B68 | lifecycle | Dọn khi signal đã huỷ và không có attemptAfterStop | CFC:56-57,78 | Trả `stopped` mà không thử | A | cancelled | Giữ tới khi phục hồi khởi động |
| B69 | fly_command | Tạo lệnh lỗi DB, hoặc idempotency key dùng lại cho kiểu lệnh khác | CCC:90-101; CAP:121-171 | Error thường: tạm thời → dọn; khác → recordFailure | B | transient/internal | Sai nhóm |
| B70 | fly_command | `get()` khi poll lỗi DB lúc lệnh đang chạy | CCC:108 | Error thường: tạm thời → dọn; khác → recordFailure (coi là chắc chắn) | I | transient | Sai nhóm |
| B71 | fly_command | Huỷ khi đang chờ: huỷ lệnh pending thành công → `campaign_command_cancelled` (chắc chắn); còn lại không chắc | CCC:111-122 | Như cột "Lỗi gì" | I | cancelled/unknown_delivery | — |
| B72 | fly_command | Hạn worker (210 giây): còn pending → `campaign_runtime_unavailable`; đang chạy → `command_result_unknown` | CCC:102-135; CFG:45 | Như cột "Lỗi gì" | I | transient/unknown_delivery | — |
| B73 | fly_command | `failed` cuối: chỉ không chắc khi mã là `command_result_unknown`. Mã hạ tầng (command_dispatch_failed, command_handler_unavailable, zalo_command_timeout) bị coi là chắc chắn | CCC:139-146 | recordFailure → chính sách nghiệp vụ Zalo + chuỗi lỗi | I | theo mã | Sai nhóm |
| B74 | fly_command | `waiting_socket` cuối | CCC:147-153 | Không chắc | I | unknown_delivery | — |
| B75 | fly_command | Trạng thái `cancelled` hoặc `api_succeeded` không được coi là cuối | CCC:138-155 | Poll tới hạn → báo không rõ | I | — | Sai nhóm |
| B76 | fly_command | Nhóm runtime không có (binding_changed, unavailable, cancelled) | ZE:2295-2301,2319-2321,1350-1357 | Về hàng đợi trừ khi đã giao; dừng → releaseClaim | B | cancelled/transient | — |
| B77 | fly_command | Kết quả tra số không chắc | ZE:1782 | CampaignRuntimeUnavailable (không chắc) → dọn | I | unknown_delivery | — |
| B78 | fly_command | claimPending đánh failed lệnh của generation cũ (generation/tài khoản lệch, binding/tài khoản không hoạt động, quyền app, gói hết hạn, capability tắt) | CAP:208-254 | Failed `campaign_runtime_binding_changed` | B | cancelled/auth | Sai nhóm (mất quyền gói báo thành đổi binding) |
| B79 | fly_command | Runtime offline lúc giao | CAD:100-103 | Bỏ qua; lệnh giữ pending tới hạn worker | B | transient | — |
| B80 | fly_command | Kiểm quyền ném hoặc từ chối; pending trùng; không có runtime; `send` ném | ZCC:157-180,209-218; CAD:162-164 | releasePending (về pending) | B | auth/transient | Từ chối bị xếp lại mỗi ~500 ms |
| B81 | fly_command | Không có kết quả trong 100 giây (chữ) / 190 giây (media) | ZCC:195-201; CAD:149 | markFailed `command_result_unknown` → waiting_socket | I | unknown_delivery | — |
| B82 | fly_command | Runtime ngắt giữa lệnh | ZCC:129-145 | Không chắc → waiting_socket | I | unknown_delivery | — |
| B83 | fly_command | Kết quả tới từ runtime không còn hiện hành | ZCC:222-230 | Bỏ → timeout → không chắc | I | cancelled | — |
| B84 | fly_command | markCompleted lỗi sau khi runtime báo thành công | CAD:160-174 | Bắt → markFailed `command_dispatch_failed`, không phải không chắc | A | transient | Sai nhóm (đã giao → thất bại chắc chắn) |
| B85 | fly_command | Lỗi kiểu khác do `execute` ném | CAD:166-173 | `command_dispatch_failed`, chắc chắn | I | internal | Sai nhóm |
| B86 | fly_command | Lỗi DB trong markFailed / releasePending / claimPending | CAD:93-123,139-175 | Tick onError; lệnh giữ running → quét stale | * | transient | — |
| B87 | fly_command | Quét lệnh running cũ (>240 giây; mỗi 30 giây và lúc khởi động) | CAP:437-453; CAD:59-65,96-99 | → waiting_socket `command_result_unknown` | I | unknown_delivery | — |
| B88 | fly_command | Phục hồi lệnh không chắc: runtime báo quiescent → failed; running → thử lại; rejected → không bao giờ giải quyết | CAD:125-137; ZCC:64-101; CRV:48-59; CAP:403-435 | Như cột "Lỗi gì" | A | unknown_delivery | Kẹt sau khi runtime khởi động lại |
| B89 | fly_command | Phản hồi phục hồi hết giờ (5 giây), lệch danh tính, lỗi quét | ZCC:73-77,95-97; CAD:105-113 | onError; thử lại sau 30 giây | A | transient/internal | — |
| B90 | transport | Runtime: generation lệch / tài khoản không hiện hành | AS:400-414 | Failed `campaign_runtime_binding_changed` | B | cancelled | — |
| B91 | transport | Runtime: socket tài khoản chưa sẵn sàng | AS:419-424 | Failed `campaign_runtime_unavailable` | B | transient | — |
| B92 | transport | Runtime: lệnh bị rào để phục hồi, hoặc producer trùng | CRV:14-32 | `command_result_unknown` | I | unknown_delivery | — |
| B93 | transport | Runtime hết giờ 90 giây / 180 giây media | AS:57-58,99-109,868-895 | Lệnh ghi → `command_result_unknown`; lệnh đọc → `zalo_command_timeout` (chắc chắn) | I | unknown_delivery/transient | Sai nhóm ở phía sau |
| B94 | transport | Không có handler lệnh; lỗi chưa map mặc định `zalo_command_failed` | RB:1171-1179,199-209 | Thất bại chắc chắn | B | internal | Sai nhóm ở phía sau |
| B95 | transport | Gửi kết quả về lỗi → kết nối lại | RB:1184-1203 | Mất kết quả → ngắt → không chắc | A | unknown_delivery | — |
| B96 | transport | runtimeId lệch → bridge lỗi | RB:1167-1169,1927-1940 | Mọi lệnh pending trên socket đó thành không chắc | B | cancelled | Quá thận trọng |
| B97 | lifecycle | Runtime tắt (SIGTERM, SIGINT, CONTROL_TERMINAL) | ZRM:32,85-110; FLY:3-4 | supervisor.stop; xả sự kiện ≤180 giây | I | cancelled | Process mới không xác nhận được lệnh cũ (B88) |
| B98 | lifecycle | Fly tự dừng hoặc khởi động lại máy api đang giữ lệnh pending trong bộ nhớ | FLY:27-33; ZCC:52 | Mất map pending → quét stale → waiting_socket | I | unknown_delivery | — |
| B99 | lifecycle | Worker SIGTERM/SIGINT | WM:145-147; ZS:343-350 | Huỷ → xả lượt; lệnh bị huỷ hoặc không chắc | I | cancelled | — |
| B100 | lifecycle | Mất session DB của leadership; xả lỗi | CWL:283-339 | CampaignLeadershipDrainError (vĩnh viễn) | I | cancelled | Thoát |
| B101 | lifecycle | Leadership hết lượt thử; lỗi phục hồi khởi động vĩnh viễn | CWL:408-425; CSR:40-44; WM:196-213 | Lỗi cuối | — | transient/internal | Thoát |
| B102 | lifecycle | onCampaignFailure | WM:159-161 | Chỉ console.error; inbox giữ process sống | — | internal | Thoát (mọi chiến dịch dừng im lặng) |

**Đường thoát / kẹt (akaAgentChatApi):**
- **`waiting_socket` sau khi runtime khởi động lại** (CRV:53-54) dẫn tới:
  - dọn thử lại mãi (CFC:65-80; RR:2228-2231), giữ tài khoản (ZS:392, 712-713);
  - leader kế tiếp lặp `campaign_commands_unsettled` (CSR:43; ZS:602-616);
  - bảo trì của chủ không bao giờ xong, nên mọi chiến dịch của chủ đó đứng im.
- **Barrier của chủ** chờ mãi khi còn claim ngày cũ (ZS:620-634).
- **Lỗi cuối của leadership** (CWL:334-339, 423-425; CSR:43) chỉ tới `onCampaignFailure`, nơi chỉ log (WM:159-161). Vai trò chiến dịch chết trong khi process vẫn sống; claim đang giữ ở 'đang chạy'.
- **Dọn `recovery_required`** giữ run tới khi process khởi động lại (CFC:69-76). Dọn bị huỷ trả `stopped` mà không thử (CFC:56-57).
- **Các hàm nhả lặng lẽ không làm gì** nếu còn unit token (RR:1982, 2011, 2055, 2283).
- **Finalize và tăng khung giờ không nguyên tử** (RR:1928-1929, 1944-1945, 2367-2368); crash giữa các bước để lại claim hoặc tài khoản cũ.
- **Từ chối claim im lặng, không hoãn** (ZS:765), và câu tìm việc không bỏ qua chiến dịch đang giữ unit lease. Lease mồ côi trả `unit_lease_busy` mỗi lần poll 1 giây, mãi mãi.
- **chat-api xếp lại lệnh bị từ chối quyền** mỗi ~500 ms (CAD:162-164) tới khi kiểm generation cũ hoặc hạn 210 giây của worker (CCC:124-135) kết thúc nó.

**Khoảng hở lớn (chung cho hai bảng hạ tầng):**
1. **Lỗi ghi / settle tạm thời làm tạm dừng chiến dịch.** Lỗi ghi / settle managed bị bọc thành lỗi hợp đồng (ARR:180,204; CAR:130-132,155-157), nên chiến dịch tạm dừng sau một lần gửi thực ra đã thành công (CS:3580; ZS:990).
2. **Lỗi ghi sổ trên Desktop bị tính vào mục tiêu.** Catch trong của Desktop (CS:4627-4732) coi lỗi sau khi gửi là lỗi mục tiêu của engine: chèn detail, ghi input, tăng xoay, đọc chính sách. Input bị dùng kèm câu lỗi DB và chuỗi lỗi tăng.
3. **Worker ghi tin đã giao thành thất bại.** Trong `sendMessage` và `friendRequest`, ghi detail thành công dùng chung `try` với lệnh gửi (ZE:1953-1977, 2000-2013). Ghi lỗi thành detail thất bại + chuỗi lỗi cho một tin đã giao.
4. **chat-api báo thành công thành thất bại chắc chắn.** Mọi lỗi không phải lỗi giao, kể cả markCompleted lỗi DB sau khi thành công, thành `command_dispatch_failed` chắc chắn (CAD:160-174). Nếu chính sách của mã đó trả về hàng đợi thì tin có thể bị gửi hai lần.
5. **`waiting_socket` không bao giờ được gỡ sau khi runtime khởi động lại.** Process runtime mới từ chối phục hồi lệnh nó không biết (CRV:53-54). Dọn trả `command_outcome_unknown` mãi và phục hồi khởi động trả `campaign_commands_unsettled` mãi. Bảo trì của chủ không bao giờ xong nên mọi chiến dịch của chủ đó dừng.
6. **Vòng thử lại trên Desktop không phân loại lỗi.** Vòng claim, claim unit, settle và yield thử lại mọi exception mỗi 2 giây không có điểm dừng (CS:3328, 9118, 9330, 2943), kể cả lỗi hợp đồng, lỗi kiểm, exception RPC random-run, và settle `not_found` / `unit_lease_corrupt`.
7. **Lỗi nội bộ tính thành mục tiêu lỗi hoặc tạm dừng chiến dịch.** Catch chung trên Desktop áp chính sách mục tiêu lỗi `err_undefined` cho cả lỗi tạm thời, chuẩn bị và cấu hình (CS:3584-3592). Worker tạm dừng với mọi lỗi vĩnh viễn bất ngờ (ZS:990-992; ZE:1385-1414).
8. **Huỷ bị xếp sai.** Desktop thoát / đăng xuất tính một mục tiêu Facebook bị huỷ thành lỗi (A87). Dừng Zalo, và việc worker "đánh dấu bắt đầu ở lệnh đầu tiên", đều đánh input "không chắc, không thử lại" dù chưa gửi gì (CS:4455-4463; ZE:1628).
9. **Cổng tuân thủ mở khi DB lỗi.** Khi kiểm opt-out, tra global-ID, link opt-out hoặc đọc duyệt bài nhóm lỗi, vẫn gửi (CS:7013-7047, 7151-7171, 7388-7399; ZE:560-585, 634-644).
10. **Lỗi tạm thời kết thúc ở trạng thái cuối:**
    - Tải media lỗi thì tạm dừng chiến dịch (CS:17467-17485; ZE:1966-1968).
    - Đọc gợi ý / lời mời đã gửi lỗi thì chiến dịch hoàn thành (CS:8377-8384, 8498-8505; CIM:461-474, 549-561).
    - 429 vượt quá lượt thử thì thành mục tiêu lỗi (Desktop) hoặc dọn chung (worker).
    - Runtime đọc hết giờ bị coi là lỗi nghiệp vụ Zalo (AS:107).

---

## 5. Lý do điều phối và mã lệnh Fly

Các chuỗi dưới đây giữ nguyên văn như bản rà hạ tầng ghi lại (tên lý do của hàm DB lấy từ file SQL trong `migrations/`). Chúng sẽ thành luật tín hiệu `run_control` / `fly_command` trong `auto_outcome_signal_rules`.

### Claim / unit / settle / ranh giới

- **Runtime claim v2 (v340) và phép kiểm bên trong (v397):** claimed, already_claimed, not_found, unit_lease_busy, daily_maintenance_required, daily_drain_due, daily_stop_due, vietnam_day_changed, claim_lost, claim_rejected, concurrency_limit_reached, random_context_required, random_mode_changed.
- **Exception của RPC random-run (v444/v392):** random_turn_claim_mismatch, random_turn_not_found, random_turn_not_owner, random_runtime_still_owned, random_config_conflict, random_account_not_found, random_invalid_*, random_rules_required, random_ai_retry_unavailable.
- **Unit claim v2 (v387):** claimed, already_claimed, not_found, campaign_deleted, account_deleted, account_inactive, account_logged_out, runtime_not_owner, runtime_claim_mismatch, runtime_control_paused, daily_stop_due, daily_drain_due, vietnam_day_changed, invalid_claimed_vietnam_date, input_not_pending, unit_lease_busy, unit_lease_corrupt, unit_lease_lost, unit_lease_payload_mismatch, unit_claim_count_mismatch, unit_claim_lost, unit_claim_rejected. Client còn xử lý app_access_denied, random_mode_changed, random_budget_exhausted.
- **Settle (v387):** settled, requeued_unstarted, already_settled, not_found, runtime_not_owner, unit_lease_mismatch, unit_lease_corrupt. Client chờ `unit_lease_not_found`, giá trị không bao giờ được trả. Dự phòng: unit_settlement_rejected.
- **Kiểm ranh giới ngày (v446):** allowed, not_found, campaign_deleted, account_deleted, account_inactive, account_logged_out, app_access_denied, runtime_not_owner, runtime_control_paused, daily_stop_due, daily_drain_due, vietnam_day_changed, invalid_claimed_vietnam_date.
- **Yield ranh giới ngày (v231):** yielded_daily_stop_due, yielded_daily_drain_due, yielded_vietnam_day_changed, boundary_not_due, unit_still_running, runtime_claim_mismatch, runtime_not_owner, runtime_control_paused, not_found, campaign_deleted, account_deleted, invalid_claimed_vietnam_date.
- **Trạng thái Desktop v2 (v234):** updated, already_target, not_found, campaign_deleted, account_deleted, account_inactive, runtime_busy, unit_lease_busy, runtime_not_owner, invalid_transition. Dự phòng: status_update_rejected.
- **Trạng thái Zalo Server:** updated, already_target, not_found, runtime_not_owner, invalid_transition.
- **`hard_stop_reason` của run-control (v454):** app_access_denied, account_logged_out, account_inactive, account_deleted, campaign_deleted, runtime_not_owner, not_found. Worker thêm staff_access_denied và chat_sync_not_enabled.
- **Dọn lượt lỗi (v392):** cleaned, already_cleaned, not_owner, not_found, insufficient_ownership, invalid_unstarted_ids, cùng RAISE 22023. Worker thêm commands_running và command_outcome_unknown. Kết quả của vòng thử lại: cleaned / not_owner / recovery_required / stopped.
- **Finalize (v214):** completed, not_found, pending_input_remaining, campaign_control_won, specialized_finalizer_required.
  - Server finalize thêm account_control_won.
  - Worker coi là thành công: completed, campaign_completed, campaign_deleted, hard_end_reached, no_active_source, data_group_finalized.
  - Dự phòng khác: unit_recovery_rejected; phục hồi khởi động dùng campaign_commands_unsettled.
- **Quyết định chống gửi lặp:** allowed, paused_recent_delivery, paused_unidentifiable, deferred_batch_duplicate, not_pending.

### Mã lệnh và trạng thái Fly

- **Mã lỗi:** campaign_command_cancelled, campaign_command_cancelled_before_dispatch, campaign_runtime_unavailable, campaign_runtime_unavailable_before_dispatch, campaign_runtime_binding_changed, campaign_failed_before_dispatch, command_result_unknown, command_dispatch_failed, command_handler_unavailable, zalo_command_failed, zalo_command_timeout, campaign_media_timeout, campaign_media_download_failed.
- **Trạng thái hành động:** pending, running, api_succeeded, waiting_socket, completed, failed, cancelled.
- **Phản hồi runtime:** accepted, succeeded, failed. Phản hồi phục hồi: running, quiescent, rejected.

### Lý do dừng runtime

- **Lý do dừng Zalo của akaAgent:** `handoff` | `shutdown` (CS:446). Suy ra từ map theo chiến dịch, generation vòng đời lệch, hoặc yêu cầu dừng (CS:1105-1148). Note được ghi:
  - trên input: note "không chắc chắn" của handoff hoặc shutdown;
  - trên chiến dịch: note khởi động lại hoặc tắt (CS:683-689).
- **Giá trị khác của akaAgent:**
  - ranh giới tạm dừng server `campaign` | `account` (CS:447);
  - loại ranh giới `configured_stop` | `end_of_day_drain`, cùng cờ "clock unavailable" (CS:304-322);
  - kết quả sleep `paused | boundary | stopped | completed | hard-stop` (CS:179-181);
  - câu dừng hẳn của server (CS:9041-9054).
- **Lý do vòng đời Desktop:**
  - phục hồi `login | logout | quit`;
  - hết phiên `login | daily | runtime | token`;
  - bảo trì `login | resume` (H).
- **zalo-server-runtime:** `SIGINT | SIGTERM | CONTROL_TERMINAL` (ZRM:32).
- **Worker:** huỷ khi SIGINT/SIGTERM; CampaignLeadershipDrainError; CampaignLeadershipRetryLimitError.
