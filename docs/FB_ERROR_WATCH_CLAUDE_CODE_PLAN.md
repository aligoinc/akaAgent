# Phương án: Claude Code tự kiểm lỗi chạy chiến dịch Facebook qua hàng việc `ai_*`

Ngày lập: 18/11/2026. Bản 8 (đã làm đợt 0, kết quả ở [FB_ERROR_WATCH_DOT0_20261118.md](FB_ERROR_WATCH_DOT0_20261118.md); **migration đợt 1 đã apply 17:25 VN 18/11 và phần đọc lỗi đã bật 17:26 VN**, mục 5.6). Chưa chèn việc nào: công tắc chèn việc, xin ảnh, đánh thức, agent và tác vụ cloud đều còn tắt. Các câu còn mở ở mục 10.

### Anh đã chốt (18/11/2026)

| # | Quyết định | Hệ quả |
|---|---|---|
| 1 | **Chỉ báo cáo.** Claude Code không soạn bản sửa, không mở PR | Mỗi ca lỗi ra một báo cáo: bằng chứng, kết luận, đề xuất. Sửa là việc của một phiên riêng do anh mở |
| 2 | **Chỉ engine v2 Facebook** | Không đọc lịch sử bộ cũ |
| 3 | **Chạy trên cloud như bộ Hỏi đáp** | Một phiên Claude Code trên cloud, đọc database bằng connector Supabase, đọc code từ repo |
| 4 | **Nhịp như bộ Hỏi đáp: 2 phút nhận việc một lần** | Không phải lượt rà theo giờ. Lỗi phát sinh thì thành việc trong hàng `ai_message`, phiên cloud thấy trong vòng 2 phút |
| 5 | **Lỗi chưa phân loại thì tự lấy ảnh từ máy khách** | Đổi quyết định Q12 hôm 16/11 (ảnh chỉ lấy khi anh yêu cầu). Trần số yêu cầu mỗi ngày ở mục 6 |
| 6 | **Có ca mới thì báo anh bằng thông báo của app Claude** | Đổi quyết định Q22 hôm 16/11 (không báo) |
| 7 | **Phiên cloud riêng** cho việc kiểm lỗi | Phải sửa câu lệnh phiên Hỏi đáp để nó bỏ qua agent mới, trước khi bật agent |
| 8 | Bộ tạo việc: **chọn cách đỡ tốn token AI nhất** | Là job trong database (mục 5 và mục 7.5): phát hiện lỗi bằng SQL, không tốn token nào |
| 9 | **Cả 5 loại ca** ở mục 5.2 đều thành việc | — |
| 10 | Xin ảnh tự động: **không đặt trần theo ngày** | Chỉ giữ mỗi ca một yêu cầu và mỗi khách một yêu cầu mỗi ngày; thêm chốt dung lượng ở mục 6 |

## 1. Tóm tắt

```
 Engine FB trên máy khách        Supabase akachat                         Claude Code trên cloud
 ────────────────────────        ─────────────────────────────────        ────────────────────────────
 kết quả lỗi, mẫu lỗi lạ  ─────▶ auto_engine_outcomes, auto_outcome_unmatched
                                 │
                                 ▼  (A) bộ tạo việc: hàm DB + pg_cron 2 phút
                                 gom thành "ca lỗi", chống trùng, có trần
                                 │  aka_agent_ai_chat_insert
                                 ▼
                                 ai_message  "chờ câu trả lời"  ◀──── (B) /list mỗi 2 phút
                                 │                                     /start → đọc dữ liệu + code
                                 │  (ca chưa phân loại) tạo yêu cầu    /progress → /answer (báo cáo)
                                 ▼  lấy ảnh từ máy khách               └─▶ thông báo app Claude
                                 auto_desktop_diagnostic_requests / _files
```

- **(A) Bộ tạo việc** nằm trong database: 2 phút một lần gom lỗi mới của engine Facebook thành "ca lỗi", ca nào chưa báo thì chèn một câu vào `ai_message` của agent mới.
- **(B) Bộ trả lời** là một phiên Claude Code trên cloud, dựng đúng kiểu phiên Hỏi đáp AI đang chạy: 2 phút gọi `/list` một lần, có việc thì nhận, kiểm, ghi báo cáo.
- Một câu `ai_message` = một ca lỗi. Một hội thoại = lịch sử của một ca (ca tái diễn hoặc có ảnh về thì hỏi tiếp trong cùng hội thoại).

## 2. Bộ Hỏi đáp AI đang chạy thế nào (đọc cấu hình và log 18/11)

Phương án này chép cách làm của nó, nên ghi lại ở đây:

- Một **phiên cloud giữ lâu dài**. Cuối mỗi lượt, phiên tự hẹn lượt kế sau 2 phút bằng công cụ hẹn giờ của cloud, với nguyên văn câu lệnh. Câu lệnh hiện ghi "tiếp tục đến hết ngày 19/11/2026 hoặc đến khi người dùng bảo dừng".
- Song song có một script `curl` gọi `GET /list?limit=20&projectCodes=hoi-dap-chien-dich,hoi-dap-chien-dich-desktop` mỗi 120 giây. Log Edge Function 24 giờ: 1.095 lượt `/list`, 10 lượt `/start`, từ 52 địa chỉ của Anthropic.
- Có câu chờ thì `/start`, đọc dữ liệu của đúng tổ chức và chiến dịch qua **connector Supabase (chỉ đọc)** và codebase, rồi `/answer`. Mỗi lần một câu.
- **Điểm phải xử lý:** câu lệnh của phiên đó bảo mỗi lần bật lại script thì đọc bảng `ai_project`, và *agent kiểu `claude_code` nào mới bật thì tự thêm vào danh sách nhận*. Agent kiểm lỗi của phương án này cũng là kiểu `claude_code`, nên phiên Hỏi đáp sẽ tự nhận việc của nó và trả lời theo giọng viết cho khách (cấm mã lỗi, tên bảng, XPath). Anh chốt dùng phiên riêng, nên phải sửa câu lệnh phiên Hỏi đáp trước (mục 7.4).
- **Đã sửa 17:50 VN 18/11** (anh bảo em làm luôn). Câu lệnh giờ ghi: danh sách nhận cố định là hai mã Hỏi đáp; không tự thêm agent `claude_code` nào khác; agent `kiem-loi-chien-dich-facebook` là việc của phiên khác, không xem, không nhận, không trả lời. Hạn "đến hết ngày 19/11/2026" em không đổi. Cách sửa: câu lệnh nằm trong lượt hẹn một lần mà phiên tự tạo lại mỗi lượt, nên em sửa nội dung của lượt hẹn đang chờ (17:52 VN); lượt đó chạy xong, lượt hẹn kế (17:56 VN) chép lại đúng bản sửa, vẫn gắn đúng phiên cũ. Chưa kiểm được ở lần phiên bật lại script (tối đa 30 phút một lần) nó có giữ đúng hai mã không; khi agent kiểm lỗi còn tắt thì không có gì để nhận nhầm.

## 3. Số đo hiện tại (chiều 18/11, chỉ đọc)

Engine FB mở cho mọi tổ chức từ 10:44 VN 18/11, chỉ máy Desktop ≥ 9.9.0 chạy. 24 giờ gần nhất:

- 2.375 lượt data của 154 chiến dịch, 24 tổ chức. 2.597 kết quả, 1.868 thành công.
- Lỗi theo mã: FB40 349, FB45 107, FB11 67, FB02 54, FB23 32, FB24 25, FB42 21, **SYS99 19** (7 chiến dịch), FB14 19, FB44 18, còn lại dưới 10.
- Mẫu lỗi lạ của Facebook trong `auto_outcome_unmatched`: 9 mẫu, 30 lượt. Ba mẫu đáng xem, **chưa xác minh**:
  - `ERR_NETWORK_IO_SUSPENDED (-331)` khi mở trang nhóm, 18 lượt, rơi vào FB44. Nghi máy ngủ.
  - `Không dùng được media "…": local path không tồn tại và không có cloud URL fallback`, 9 lượt, rơi vào SYS99.
  - `Block không tìm thấy: blockId=# blockName="nav_to_url"`, 1 lượt.
- 3 lượt đóng `stale`, 14 lượt còn mở.

Chạy thử câu phát hiện ở đợt 0 trên toàn bộ dữ liệu engine Facebook (khoảng 23 giờ đầu): 814 kết quả lỗi gom thành **16 ca chưa có kết luận**; tính cả báo lại khi số lượt tăng gấp 3 là 26 việc trong ngày đầu, dưới trần 30. Ngày đầu ca nào cũng là mới; các ngày sau ít hơn.

## 4. Loại việc: một dòng `ai_project`

| Cột | Giá trị | Lý do |
|---|---|---|
| nhóm | nhóm mới `van-hanh-noi-bo` | Web và iOS chỉ đọc nhóm `hoi-dap-chien-dich`, Desktop chỉ đọc `akaagent-desktop`, nên nhóm mới không hiện trong app của khách |
| `code` | `kiem-loi-chien-dich-facebook` | Bộ trả lời lọc đúng mã này |
| `answer_mode` | `claude_code` | Làn mà Edge Function `ai-chat-agent` phục vụ |
| `audience` | `admin_akabiz` | Để `off` thì hàm gửi câu từ chối (`ai_chat_agent_unavailable`) |
| `requires_campaign` | `false` | Một ca lỗi có thể trải nhiều chiến dịch; mã chiến dịch nằm trong `intake` |
| `timeout_seconds` | `3600` | Mức tối đa bảng cho phép. Quá hạn thì câu tự sang `lỗi` |
| `rules` | Cách kiểm, giới hạn quyền, giọng báo cáo nội bộ (mục 7, 8) | Bộ trả lời nhận kèm mỗi câu; sửa không cần deploy |
| `output_schema` | Khuôn báo cáo ở mục 7.2 | Hàm kiểm khoá bắt buộc khi ghi câu trả lời |

Hệ quả: nhân viên akaBiz thấy agent này trong panel Hỏi đáp AI của dashboard và tự hỏi được ("kiểm giúp chiến dịch 12345 vì sao lỗi"). Câu hỏi đó đi cùng hàng việc.

## 5. (A) Bộ tạo việc trong database

### 5.1 Thành phần (một migration, đã apply 18/11)

[migration_v574_engine_error_watch.sql](../migrations/migration_v574_engine_error_watch.sql) và [bản gỡ](../migrations/rollback_v574_engine_error_watch.sql). Số 574 lúc viết là số tạm; lúc apply sổ chưa có V574 nên giữ nguyên. Migration chỉ thêm đối tượng mới, không sửa bảng hay hàm nào đang có.

| Thứ | Việc |
|---|---|
| Bảng `private.auto_engine_error_cases` | Sổ ca lỗi: khoá ca, loại, mã lỗi, thao tác, bước, mẫu câu lỗi, số lượt, số lần dừng chiến dịch, 5 lượt mẫu, lượt có ảnh, hội thoại của ca, lần báo gần nhất, mã yêu cầu ảnh, trạng thái (`new` / `queued` / `reported` / `failed` / `known` / `muted`) |
| Bảng `private.auto_engine_error_hourly` | Số kết quả lỗi theo giờ cho từng mã và thao tác, giữ 15 ngày, để xét tăng bất thường |
| Bảng `private.auto_engine_error_watch_state` | Một dòng: đã đọc tới đâu, số việc đã chèn trong ngày, lỗi và kết quả của lượt gần nhất |
| Hàm `aka_agent_engine_error_watch_tick_v1()` | Đọc kết quả lỗi mới của engine Facebook, cập nhật sổ, chèn việc bằng `aka_agent_ai_chat_insert`, xin ảnh bằng `aka_agent_desktop_diagnostic_request_v1`, tuỳ chọn gọi `/fire`. Chỉ `service_role` và pg_cron gọi được |
| Job pg_cron `aka-agent-engine-error-watch` | `*/2 * * * *`. Câu lệnh tạo job nằm trong migration, anh duyệt cùng lúc |
| Thiết lập `engine.error_watch` (JSON) | Bốn công tắc tách rời: `enabled` (đọc lỗi, ghi sổ ca), `enqueue` (chèn việc), `imageRequests` (xin ảnh), `fire` (đánh thức tác vụ cloud). Migration đặt cả bốn là tắt |
| Nhóm `van-hanh-noi-bo` và agent `kiem-loi-chien-dich-facebook` | Tạo sẵn với `is_active = false`. Chỉ bật sau khi đã sửa câu lệnh phiên Hỏi đáp (mục 2) |

Nhờ `enabled` tách khỏi `enqueue`, có thể bật riêng phần đọc lỗi vài ngày để xem sổ ca trước khi cho chèn việc nào.

Số đo trên production (chỉ đọc, 18/11): ba câu đọc chính của một lượt tick mất 2,6 / 6,5 / 2,4 mili giây (563 / 2.267 / 344 trang). Bản đầu quét bảng lượt data theo 3 giờ mất 1,4 giây mỗi lượt nên đã bỏ: lượt dừng chiến dịch nay tra theo khoá chính từ các kết quả lỗi 10 phút gần nhất; lượt bị bỏ dở xét mỗi lượt đúng một lần, 30 phút sau khi bắt đầu.

Hàm không đọc `auto_campaign_details` hay `auto_run_steps`. `statement_timeout` 20 giây, `lock_timeout` 2 giây, có khoá chống hai lượt chạy chồng.

Kiểm cục bộ (PostgreSQL 17, không chạm database thật): `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-facebook/error-watch-smoke.cjs`, 17 nhóm đạt. Bài kiểm dùng bản giả của nền Hỏi đáp AI (bảng `ai_*` và `aka_agent_ai_chat_insert` viết lại theo thân hàm production); phần chạy với hàm thật ở mục 5.5.

### 5.2 Loại ca nào thành việc (anh chốt 18/11: cả 5 loại)

| Loại | Điều kiện | Khoá ca |
|---|---|---|
| Mẫu lỗi lạ | Dòng mới của nền tảng Facebook trong `auto_outcome_unmatched`, hoặc số lượt của mẫu vượt mốc 5 / 20 / 100 | thao tác + pha + mẫu đã chuẩn hoá |
| Lỗi chưa phân loại | Kết quả SYS99 mà chưa thuộc ca nào | thao tác + bước lỗi + câu lỗi đã chuẩn hoá |
| Chiến dịch bị engine tạm dừng | Dừng theo chính sách vì SYS99, FB42, FB44, FB45 hoặc mã chưa có trong danh sách "đã biết" | mã + thao tác + bước lỗi |
| Mã lỗi tăng bất thường | Số lượt 60 phút gần nhất gấp 3 lần trung bình cùng giờ 7 ngày và từ 20 lượt trở lên | mã + thao tác |
| Lượt bị bỏ dở | Lượt đóng `stale` khi máy vẫn mở (presence còn mới) | lý do đóng + thao tác |

Các mã đã có kết luận (FB40, FB02, FB11, FB22, FB23, FB14…) nằm trong danh sách "đã biết": chỉ thành việc khi tăng bất thường.

### 5.3 Chống trùng và trần

- Một ca chỉ có một câu đang chờ. Ca đã báo chỉ được báo lại khi số lượt tăng gấp 3 so với lần báo trước, hoặc sau 7 ngày vẫn còn.
- Hạn mức sẵn có của Hỏi đáp AI là 3 câu chờ và 50 câu mỗi ngày cho mỗi nhân viên (dùng chung với khách, không nới). Bộ tạo việc tự giữ **tối đa 2 câu chờ** và số việc mỗi ngày theo `maxPerDay` (migration đặt 10, mục tiêu 30); ca còn lại nằm trong sổ chờ lượt sau. Thứ tự: ca làm chiến dịch bị dừng trước, rồi ca nhiều lượt.
- **Mỗi lúc chỉ có một ca mới đang chờ.** Lõi Hỏi đáp AI không cho một nhân viên có hai câu mở hội thoại mới cùng chờ ở cùng một agent (đọc thân hàm 18/11). Ca mới thứ hai phải chờ ca trước có báo cáo; câu hỏi tiếp trong hội thoại đã có thì không bị chặn. Với 5–15 phút mỗi ca, một ngày làm được vài chục ca, đủ cho trần 30.
- Tài khoản đứng tên (đề xuất nhutlq, mã 4) dùng chung hạn mức 50 câu mỗi ngày với các câu chính anh hỏi ở Hỏi đáp AI.
- Câu quá hạn 60 phút (bộ trả lời không chạy) sang `lỗi`. Bộ tạo việc gửi lại ca đó tối đa 2 lần mỗi ngày, nên bộ trả lời tắt lâu cũng không làm đầy hàng.

### 5.4 Nội dung một việc

- `question`: một đoạn chữ ngắn: loại ca, mã lỗi, thao tác, số lượt / chiến dịch / tài khoản / tổ chức trong khoảng nào, câu lỗi mẫu.
- `intake` (≤ 16 KB): `khoa`, `loai`, tối đa 5 mã lượt data mẫu, mã chiến dịch, mã yêu cầu ảnh nếu có, số liệu so với 7 ngày.
- Người hỏi: một nhân viên akaBiz ở tổ chức 1 (câu Q-D). `source = 'api'`.

### 5.5 Chạy thử trên production trong một giao dịch rồi huỷ (18/11, 16:43:24–16:43:28 VN)

Anh đồng ý chạy thử ("ok chạy thử đi"). Cả migration cùng các bước dưới đây chạy trong một giao dịch kết thúc bằng `ROLLBACK`; tệp không có lệnh `COMMIT` nào. Lúc chạy có 3 phiên đang hoạt động, không phiên nào chờ khoá.

| Bước | Kết quả |
|---|---|
| Apply migration (kiểm trước, tạo bảng / hàm / job / thiết lập / agent, kiểm sau) | Đạt. Job `aka-agent-engine-error-watch` có lịch `*/2 * * * *` |
| Bật `enabled`, cho đọc 6 giờ gần nhất | 843 kết quả lỗi → 22 ca: 12 ca mã chưa có kết luận, 6 ca chưa phân loại, 4 ca lượt bị bỏ dở; 6 lượt dừng chiến dịch được cộng vào ca. Lượt đọc bù 6 giờ này mất 1,9 giây |
| Bật agent và `enqueue`, gọi `aka_agent_ai_chat_insert` **thật** | Chèn đúng một câu cho ca đứng đầu (mở trang nhóm bị `ERR_NETWORK_IO_SUSPENDED`, 18 lượt, 4 lần dừng chiến dịch). Câu ở làn `claude_code`, hạn 60 phút, hội thoại đứng tên nhân viên 4 của tổ chức 1, nguồn `api`, `intake` đủ trường. Lượt tick này mất 28 mili giây |
| Tick lần nữa khi câu còn chờ | Không chèn thêm ca mới |
| `aka_agent_ai_chat_worker('list')` **thật** với mã agent mới | Thấy đúng 1 câu |
| `list` với hai mã của bộ Hỏi đáp (`hoi-dap-chien-dich`, `hoi-dap-chien-dich-desktop`) | Không thấy câu này |
| `claim` theo mã câu | Nhận được; gói việc có `rules`, `outputSchema`, `intake`, `history` |
| `answer` với `answerJson` theo khuôn | `hoàn thành`. Gọi `answer` lần hai bị từ chối (`not_claimed`) |
| Tick sau khi có báo cáo | Ca đầu sang `reported`, ca kế (form đăng bài không đóng, 15 lượt) được chèn |

Hậu kiểm sau khi huỷ (chỉ đọc): không còn bảng, hàm, thiết lập, agent, nhóm agent, job hay dòng sổ migration nào; không còn câu hay hội thoại nào của lần thử; nhân viên 4 không có câu chờ; không có yêu cầu ảnh nào. PostgREST không nạp lại schema; REST phút đó 0 lỗi 5xx, p50 48 mili giây như các phút trước.

Điều còn lại sau lần thử: các bộ đếm mã tự tăng (`ai_project`, `ai_message`, `ai_message_thread`, `auto_system_settings`, mã job pg_cron) đã nhảy vài số; không ảnh hưởng gì.

Lần thử này chưa phủ: xin ảnh (`imageRequests`), đường `/fire`, mã lỗi tăng bất thường (chưa đủ 3 ngày dữ liệu), và job pg_cron tự chạy theo lịch.

### 5.6 Apply và bật phần đọc lỗi (18/11, 17:25 VN)

Anh đồng ý làm tiếp ngay ("ok giờ làm tiếp luôn được ko?"). [Biên nhận](../migrations/snapshots/engine-error-watch-v574/apply-receipt.json).

| Bước | Kết quả |
|---|---|
| Kiểm trước (17:25:11 VN) | 2 phiên đang hoạt động, không phiên nào chờ khoá. Sổ migration chưa có V574; mới nhất là V575 của phiên khác (17:08 VN) |
| Apply (17:25:16–17:25:20 VN) | Đạt. Dòng sổ `20261118102303`, md5 nội dung trong sổ trùng md5 tệp |
| Hậu kiểm | Có đủ 3 bảng (đã bật RLS), 3 hàm (chỉ `service_role` gọi được), job số 122 lịch `*/2 * * * *`, thiết lập cả bốn công tắc tắt, agent `is_active = false` |
| Ảnh hưởng tới API | PostgREST nạp lại schema mất 3,4 giây. Trong 30 giây đó có 211 request chậm hơn 1 giây (bình thường 0–2), 0 lỗi 5xx |
| Bật `enabled` (17:26:58 VN) | Chỉ đổi công tắc đọc lỗi. Ba công tắc còn lại và agent giữ tắt |
| Hai lượt đầu (17:28, 17:30 VN) | 316 và 73 mili giây, không lỗi. Lượt đầu sau khi bật đọc lùi 30 phút. Sổ có 6 ca: 5 ca mã chưa có kết luận, 1 ca lượt bị bỏ dở. Không câu nào được chèn, không yêu cầu ảnh nào |

Tắt lại phần đọc lỗi: đặt `enabled` thành `false` trong thiết lập `engine.error_watch`; có hiệu lực ở lượt kế, không cần migration.

Cùng lúc đó phiên khác đã apply `migration_v575_engine_specific_codes_wait_note` (17:08 VN), cho hai trong ba ca của đợt 0 mã riêng: lỗi mạng khi mở trang Facebook ra NET01, tệp media không còn trên máy ra CFG20. Anh chốt tối 18/11 là hai mã này không báo nữa: em đã đặt `knownCodes` trong thiết lập lúc 20:00:50 VN (9 mã mặc định của hàm cộng `err_network_offline` và `err_media_local_file_missing`; danh sách này thay cả danh sách mặc định nên phải ghi đủ). Lúc đặt, sổ chưa có ca nào của hai mã đó. Chúng chỉ thành việc khi tăng bất thường.

Cũng tối 18/11 anh chốt: bật chạy thật (agent, chèn việc, tác vụ cloud) chờ tới 19/11; không dùng đường đánh thức `/fire`, tác vụ cloud chạy mỗi giờ một lượt. Vì mỗi câu có hạn 60 phút tính từ lúc chèn, khi bật chèn việc phải đặt `enqueueWindow` để database chỉ chèn trong vài phút cuối mỗi giờ, ngay trước lượt chạy của tác vụ cloud (phút 01).

## 6. Ảnh lỗi từ máy khách (anh chốt điểm 5)

- Khi một ca **lỗi chưa phân loại** hoặc **mẫu lỗi lạ** được tạo, bộ tạo việc gọi luôn `aka_agent_desktop_diagnostic_request_v1(nhân viên của lượt mẫu, {"targetRunId": …}, 'error-watch')`. Hàm này có sẵn từ V556.
- **Không đặt trần theo ngày** (anh chốt 18/11). Hai giới hạn còn giữ: mỗi ca 1 yêu cầu, mỗi nhân viên khách tối đa 1 yêu cầu mỗi ngày.
- Chốt dung lượng (em đề xuất thêm, không phải trần theo ngày): ảnh lưu thẳng trong database, mỗi ảnh tới 2 MB, giữ 7 ngày, mà ổ database từng đầy ngày 12/11. Bộ tạo việc ngừng xin ảnh khi bảng `auto_desktop_diagnostic_files` vượt 2 GB và xin lại khi job dọn đưa nó xuống dưới mức đó.
- Máy khách tải ảnh lên qua nhịp presence 30 giây khi app đang mở. Ảnh là JPEG ≤ 2 MB lưu trong bảng `auto_desktop_diagnostic_files`, yêu cầu hết hạn sau 7 ngày, job dọn có sẵn.
- Khi ảnh về, bộ tạo việc hỏi tiếp một câu trong hội thoại của ca ("đã có N ảnh của ca này"). Bộ trả lời đọc ảnh bằng `aka_agent_desktop_diagnostic_files_v1` rồi bổ sung kết luận.
- Giới hạn: máy tắt, hoặc ảnh đã bị dọn khỏi máy khách (14 ngày / 1 GB) thì không có ảnh; báo cáo ghi rõ "chưa có ảnh".
- Ảnh là màn hình Facebook của khách. Quyết định 16/11 không báo khách về việc này (Q13) vẫn giữ. Báo cáo không chép chữ riêng tư trong ảnh, chỉ mô tả hộp thoại / nút / câu báo lỗi của Facebook.

## 7. (B) Bộ trả lời trên cloud

### 7.1 Một lượt (2 phút một lần)

1. `GET /list?limit=5&projectCodes=kiem-loi-chien-dich-facebook`. Không có câu thì hẹn lượt kế và dừng.
2. `POST /start` câu cũ nhất còn hạn. Phản hồi có `question`, `intake`, `project.rules`, `outputSchema` và tối đa 20 câu đã xong của cùng hội thoại (lịch sử ca).
3. Kiểm ca, chỉ đọc, qua connector Supabase:
   - `aka_agent_engine_trace_v1` cho từng lượt data mẫu: bước lỗi, vết thao tác, kết quả, chính sách đã áp;
   - code block "[engine]" và workflow liên quan trong `auto_blocks` / `auto_workflows`;
   - repo akaAgent: lõi `packages/campaign-engine`, cổng FB, dấu hiệu lỗi `errorSigns.ts`, các tài liệu rà lỗi và ghi chú đã có (để biết ca nào anh đã kết luận);
   - ảnh lỗi nếu đã về.
4. `POST /progress` trước mỗi bước dài (gia hạn giữ chỗ 15 phút).
5. `POST /answer` với báo cáo theo khuôn 7.2. Không kết luận được vẫn `/answer` với `ket_luan = chua_du_du_lieu` và nêu cần thêm gì. Chỉ dùng `/status` khi lỗi kỹ thuật phía mình.
6. Ca thuộc loại mới hoặc tăng bất thường: gửi thông báo app Claude (mục 7.3).
7. Hẹn lượt kế sau 2 phút.

### 7.2 Khuôn báo cáo (`output_schema`)

```json
{
  "tom_tat": "một hai câu: ca gì, kết luận gì, anh có cần làm gì không",
  "khoa": "khoá ca lỗi",
  "ma": "FB44",
  "so_lieu": { "so_luot": 0, "so_chien_dich": 0, "so_tai_khoan": 0, "so_to_chuc": 0, "khoang": "từ … đến … (giờ VN)" },
  "ket_luan": "loi_app | facebook_doi_giao_dien | do_cau_hinh_cua_khach | do_may_khach | chua_du_du_lieu",
  "nen_sua_app": true,
  "bang_chung": ["mã lượt data, bước lỗi, đoạn vết thao tác, mô tả ảnh"],
  "nguyen_nhan": "giải thích ngắn, chỉ điều đã kiểm được",
  "de_xuat": ["việc nên làm, theo thứ tự"],
  "do_chac": "cao | trung_binh | thap",
  "da_tung_ket_luan": "tên tài liệu / ghi chú trong repo nếu ca này đã có kết luận",
  "can_anh_quyet": "câu hỏi cho anh, nếu có"
}
```

Chỉ `tom_tat` bắt buộc. Trường `answer` là bản chữ thường của cùng nội dung. `nen_sua_app` thêm sau đợt 0: một ca do khách (ví dụ tệp ảnh không còn trên máy) vẫn có thể kèm việc nên sửa ở app (thiếu mã riêng, câu cho khách khó hiểu). Ba báo cáo mẫu theo khuôn này ở tài liệu kết quả đợt 0.

### 7.3 Thông báo cho anh (anh chốt điểm 6)

Chỉ gửi khi ca là mới hoặc tăng bất thường, một thông báo một ca, nội dung là `tom_tat`. Ca "đã biết" hoặc ca hỏi tiếp không có gì mới thì không gửi. **Chưa kiểm** phiên cloud có công cụ gửi thông báo tới app Claude của anh hay không; đợt 1 thử trước. Nếu không có, phương án dự phòng là anh xem danh sách hội thoại của agent trong panel Hỏi đáp AI của dashboard.

### 7.4 Lệnh cho phiên cloud và lệnh xem cho người vận hành (đã viết)

- [error-watch-agent.cjs](../scripts/engine-v2-facebook/error-watch-agent.cjs): phiên cloud dùng để nhận việc (`next`), gia hạn (`progress`), kiểm và nộp báo cáo (`check`, `answer`), trả việc (`requeue`, `fail`). Không cần thư viện ngoài. Lệnh chỉ nhận câu của đúng agent này (nhận nhầm thì trả về hàng đợi), chỉ lấy con số từ đoạn chữ gửi kèm lúc đánh thức, và từ chối báo cáo sai khuôn hoặc có chuỗi giống số điện thoại, UID dài, khoá, token. Nhờ vậy tệp công việc ngắn đi và phiên không phải tự ghép lệnh gọi API. Kiểm: `node scripts/engine-v2-facebook/error-watch-agent-smoke.cjs` (9 nhóm, máy chủ giả cục bộ); đã gọi thử `next` với API thật khi agent chưa tồn tại, trả "hết việc".
- [error-watch-status.cjs](../scripts/engine-v2-facebook/error-watch-status.cjs): chỉ đọc, cho anh xem công tắc, lượt tick gần nhất, sổ ca theo trạng thái, ca đang chờ báo, các câu gần đây của agent và yêu cầu ảnh. Đã chạy trên production sau khi apply (18/11 17:30 VN): in đúng công tắc, lượt gần nhất và 6 ca trong sổ; phần câu của agent và yêu cầu ảnh chưa có dữ liệu để in.

### 7.4b Tác vụ cloud (đã tạo 18/11 17:01 VN, đang TẮT)

Anh đồng ý tạo sẵn ("Tạo sẵn, để tắt"). Tác vụ **Kiểm lỗi chiến dịch Facebook (engine v2)**, mã `trig_01QRNCgX959THHTS7mkdCS3K`, quản lý ở `https://claude.ai/code/routines/trig_01QRNCgX959THHTS7mkdCS3K`.

| Mục | Giá trị | Ghi chú |
|---|---|---|
| Trạng thái | Tắt | Chưa chạy lượt nào |
| Lịch | Mỗi giờ một lượt (phút 01) | Lưới đỡ; lịch của tác vụ cloud không được dày hơn một giờ. Đánh thức ngay khi có việc thì dùng đường `/fire` (mục 7.5) |
| Mỗi lượt | Một phiên mới, làm một câu rồi kết thúc | Không giữ phiên lâu dài, không tự hẹn lại |
| Repo | `aligoinc/akaAgent` | Nhánh mặc định trên GitHub là `dev_2` (cũ), nên câu lệnh bảo phiên chuyển sang `dev_3` trước. Tệp công việc vào `dev_3` qua PR #708 (merge 18/11); thiếu tệp thì phiên dừng với một dòng báo |
| Mô hình | Sonnet 5.5 | Mặc định của công cụ tạo tác vụ; đổi được trên trang quản lý |
| Môi trường cloud | `full` | Tài khoản có hai môi trường (`full`, `Default`); em chọn `full` để phiên gọi được API và GitHub. Chưa thử `Default` |
| Công cụ | Bash, Read, Write, Glob, Grep | Không có công cụ sửa tệp |
| Connector | Chỉ Supabase, và chỉ công cụ `execute_sql` | Lúc tạo, máy chủ tự gắn cả ba connector của tài khoản (Supabase, Claude Docs, Claude Code Remote); em đã gỡ hai cái không cần và bỏ các công cụ Supabase khác (apply migration, deploy, tạo / dừng project…) |
| Câu lệnh | Chuyển sang `dev_3`, đọc `docs/FB_ERROR_WATCH_TASK.md`, làm đúng một lượt, kèm các giới hạn cứng | Nội dung công việc nằm trong repo nên sửa không cần đụng tác vụ |

Hai điều cần biết trước khi bật:

- **`execute_sql` vẫn chạy được lệnh ghi.** Câu lệnh và tệp công việc cấm ghi, nhưng đó là lời dặn, không phải chặn kỹ thuật. Trong các phiên có người, connector Supabase hỏi xác nhận trước mỗi lệnh ghi và không ai bấm thì lệnh không chạy; em chưa kiểm được phiên cloud không người có được hỏi như vậy không. Cách chặn chắc là một connector Supabase ở chế độ chỉ đọc cho riêng tác vụ này.
- **Thông báo qua app Claude chưa có đường.** Em đã gỡ connector Claude Code Remote vì nó cho phiên tạo và xoá tác vụ, quá rộng với một phiên đọc dữ liệu không tin cậy. Không có nó, em không biết phiên còn công cụ nào để gửi thông báo; câu lệnh bảo phiên bỏ qua bước thông báo nếu không có công cụ. Mỗi lượt vẫn là một phiên xem được trong danh sách phiên của anh.

Khi dùng đường `/fire`: anh tạo mã trên trang quản lý của tác vụ (thêm trigger API → Generate token), tự lưu vào Vault bằng `select vault.create_secret('<mã vừa tạo>', 'AKA_AGENT_ENGINE_ERROR_WATCH_FIRE_TOKEN');` trong SQL Editor, rồi thêm `"fire": true, "fireRoutineId": "trig_01QRNCgX959THHTS7mkdCS3K"` vào thiết lập `engine.error_watch`. Mã không đi qua chat và không nằm trong repo.

### 7.5 Chi phí token (anh hỏi 18/11: cách nào đỡ tốn nhất)

Token AI tiêu ở ba chỗ:

| Chỗ tiêu | Job trong database | Phiên cloud tự phát hiện | Chỉ việc do người hỏi |
|---|---|---|---|
| Phát hiện lỗi mới | **0 token** (SQL thuần) | Mỗi lượt mô hình chạy câu đọc lỗi rồi đọc kết quả, 720 lượt mỗi ngày | 0 token |
| Kiểm một ca và viết báo cáo | Như nhau | Như nhau | Như nhau, nhưng chỉ ca có người hỏi |
| Lượt nhận việc khi hàng trống | Xem dưới | Xem dưới | Xem dưới |

Vì vậy bộ tạo việc là **job trong database**. Phần chống trùng và trần ở 5.3 cũng làm bằng SQL nên một lỗi lặp nghìn lần chỉ tốn token cho một lần kiểm.

Khoản còn lại là **lượt nhận việc khi hàng trống**. Phiên Hỏi đáp hiện tự đánh thức mô hình 2 phút một lần, tức 720 lượt mỗi ngày kể cả khi không có câu nào; mỗi lượt mô hình đọc lại câu lệnh (bản của Hỏi đáp dài 5.195 ký tự) và gọi `/list`. Ba cách giảm, từ ít tốn nhất:

1. **Đánh thức khi có việc.** Job trong database vừa chèn việc xong thì gọi đường "fire" của tác vụ cloud; không có việc thì mô hình không chạy lượt nào. Số việc dự kiến dưới 30 mỗi ngày, nằm trong trần 30 lượt gọi mỗi giờ mà tài liệu của Anthropic ghi cho một tác vụ. Chưa ai thử đường này trên tài khoản của anh (phương án Trợ lý aka cũng ghi "chưa thử"); cần lưu một mã gọi trong database và gọi HTTP từ database.
2. **Giữ kiểu Hỏi đáp nhưng thưa hơn.** Ca lỗi không có khách ngồi chờ như câu hỏi, nên 10 phút một lượt là 144 lượt mỗi ngày thay vì 720.
3. **Giữ 2 phút như Hỏi đáp**, câu lệnh của lượt rút thật ngắn (trỏ tới tệp công việc trong repo).

**Kết quả tra tài liệu chính thức của Anthropic (18/11, em chưa gọi thử vì cần mã do anh tạo):**

- Có đường gọi từ ngoài: `POST https://api.anthropic.com/v1/claude_code/routines/{mã tác vụ}/fire`, header `Authorization: Bearer <mã>`, `anthropic-version`, và nên gửi `anthropic-beta: experimental-cc-routine-2026-04-01` (hai trang tài liệu nói khác nhau về việc có bắt buộc không). Thân có một trường `text` tuỳ chọn, tối đa 65.536 ký tự; phiên nhận nó như dữ liệu không tin cậy.
- Mã gọi gắn với đúng một tác vụ, **chỉ tạo được bằng tay trên web** (claude.ai/code/routines → sửa tác vụ → thêm trigger API → Generate token), hiện một lần, không xem lại được.
- **Mỗi lượt gọi tạo một phiên mới**, không gửi được vào phiên đang có, và không có khoá chống gọi trùng: gọi lại là thêm một phiên.
- Trần: 30 lượt mỗi giờ cho một tác vụ, 100 lượt mỗi giờ cho tài khoản; vượt thì trả 429 kèm `Retry-After`.
- Tác vụ có thể chỉ có trigger API, không cần lịch. Lịch theo giờ thì không được dày hơn một giờ một lần.
- Tính năng đang ở dạng thử nghiệm, Anthropic ghi có thể đổi.

Nguồn: `code.claude.com/docs/en/routines.md`, `platform.claude.com/docs/en/api/claude-code/routines-fire.md`.

Từ đó em đề xuất cho câu Q-F:

- Tác vụ cloud có **trigger API** và thêm **lịch mỗi giờ một lượt** làm lưới đỡ. Bộ tạo việc chèn việc xong thì gọi `/fire` một lần bằng `pg_net`, `text` chỉ ghi mã câu vừa tạo. Lượt mỗi giờ nhặt việc mà lượt gọi bị lỗi hoặc bị 429.
- Mỗi việc là một phiên cloud mới: phiên đọc tệp công việc, làm đúng một ca rồi kết thúc. Không cần giữ phiên lâu dài và không cần tự hẹn lại như bộ Hỏi đáp. Mục 7.1 bước 1 và bước 7 đổi theo: phiên nhận mã câu từ `text` rồi `/start` câu đó; không có mã thì `/list`.
- Token khi hàng trống: 24 lượt mỗi giờ thay cho 720 lượt 2 phút.
- Việc anh phải tự làm ở đợt 1: tạo tác vụ và mã trên web, rồi tự lưu mã vào Vault của database bằng câu lệnh em soạn sẵn. Mã không đi qua chat và không nằm trong repo.
- Vì không có khoá chống gọi trùng, bộ tạo việc chỉ gọi `/fire` đúng một lần cho mỗi câu; hai phiên cùng thấy một câu thì `/start` chỉ cho một phiên nhận.

## 8. An toàn

- **Chỉ báo cáo.** Phiên không sửa code, không tạo nhánh hay PR, không ghi database. Đường ghi duy nhất là `ai-chat-agent` cho câu đang giữ.
- **Dữ liệu là dữ liệu.** Câu lỗi, tên chiến dịch, tên nhóm, chữ trong ảnh, câu nhân viên hỏi đều có thể chứa chữ kiểu mệnh lệnh. Phiên chỉ làm theo tệp công việc và `rules` của agent.
- **Edge Function đang mở không xác thực.** Ai biết địa chỉ và mã câu đều đọc được câu hỏi và báo cáo. Vì vậy câu hỏi và báo cáo chỉ ghi mã (tổ chức, chiến dịch, tài khoản, lượt data), không ghi SĐT, UID khách, nội dung tin, khoá hay token.
- **Không tranh việc với khách.** Hạn mức Hỏi đáp AI không nới; bộ tạo việc tự giữ trần ở 5.3. Bộ trả lời là phiên riêng nên câu của khách không phải xếp sau ca lỗi.
- **Tải database.** Một job 2 phút đọc theo chỉ mục trên bảng 0,5 GB, cộng một lượt `/list` mỗi 2 phút. Hàm tạo việc là lệnh ghi nhỏ (vài dòng mỗi ngày).
- **Tắt nhanh:** `engine.error_watch` → tắt (ngừng tạo việc và ngừng xin ảnh); dừng phiên cloud; hoặc `update ai_project set is_active = false` cho dòng này.

## 9. Lộ trình

| Đợt | Nội dung | Chạm production |
|---|---|---|
| 0 | **Đã làm 18/11** ([kết quả](FB_ERROR_WATCH_DOT0_20261118.md)): câu phát hiện ca lỗi [error-watch-dryrun.sql](../scripts/engine-v2-facebook/error-watch-dryrun.sql) chạy chỉ đọc; tệp công việc [FB_ERROR_WATCH_TASK.md](FB_ERROR_WATCH_TASK.md); kiểm tay 3 ca thật và viết 3 báo cáo mẫu. Đường đánh thức tác vụ cloud: xem mục 7.5 | Không |
| 1 | Migration đã viết (mục 5.1) và đã chạy thử trong một giao dịch rồi huỷ (mục 5.5). **Đã làm 18/11 (mục 5.6)**: (a) chọn số thật ngay trước khi apply; (b) apply, mọi công tắc tắt, agent chưa bật; (c) bật `enabled`. **Còn lại**: xem sổ ca 1–2 ngày; (d) anh sửa câu lệnh phiên Hỏi đáp để bỏ qua agent mới, rồi bật agent; (e) dựng tác vụ cloud riêng; bật job với trần thấp (10 việc mỗi ngày), chưa xin ảnh, chưa thông báo | 1 migration, 2 dòng dữ liệu, 1 job |
| 2 | Bật xin ảnh tự động và thông báo app Claude; nâng trần việc lên 30 mỗi ngày | Thiết lập |
| 3 | Tuỳ kết quả: mở sang engine Zalo (`auto_outcome_unmatched` Zalo đang có 316 mẫu, 1.362 lượt) | Thiết lập |

Nghiệm thu đợt 1, sau 3 ngày: mỗi việc có báo cáo `hoàn thành` đúng khuôn; không ca nào bị báo trùng; phiên Hỏi đáp không nhận việc của agent này và câu của khách không chậm đi (so thời gian trả lời trước và sau); không có lệnh ghi production nào ngoài hàm tạo việc và `ai_message`.

## 10. Câu còn mở

| # | Câu hỏi | Đề xuất của em |
|---|---|---|
| Q-D | Nhân viên nào đứng tên các hội thoại? | **Anh chốt tối 18/11: tạm dùng tài khoản nhutlq ở tổ chức 1 (nhân viên 4).** Lõi Hỏi đáp AI đếm 3 câu chờ và 50 câu mỗi ngày theo nhân viên, gộp mọi agent cùng làn, không miễn cho câu do máy tạo; nên việc kiểm lỗi dùng chung hạn mức với câu anh tự hỏi (bộ kiểm lỗi giữ tối đa 2 câu chờ). Muốn tách thì đổi `staffId` trong thiết lập sang một tài khoản akaBiz riêng, không cần sửa hàm |
| Q-F | Nhịp nhận việc của phiên cloud | **Anh chốt tối 18/11: mỗi giờ một lượt, không dùng đường `/fire`.** Việc này chỉ ra báo cáo nên không cần nhanh hơn; nếu sau này cần biết ngay khi chiến dịch bị dừng thì làm cùng phần thông báo |

Đã chốt 18/11 và chuyển lên bảng đầu tài liệu: Q-A (phiên riêng), Q-B (job trong database), Q-C (cả 5 loại ca), Q-E (không trần xin ảnh theo ngày).

## 11. Chưa kiểm

- Migration đã apply và job pg_cron đã tự chạy phần đọc lỗi (mục 5.6). Chưa thử trên production ngoài giao dịch thử ở mục 5.5: chèn việc. Chưa thử lần nào: xin ảnh, mã lỗi tăng bất thường.
- Tác vụ cloud đã tạo nhưng chưa chạy lượt nào: chưa biết phiên có đọc được database qua connector, có gọi được API từ môi trường `full`, và có công cụ gửi thông báo app Claude không (mục 7.4b).
- Chưa thử đọc ảnh 2 MB dạng base64 qua connector Supabase trong phiên cloud.
- Chưa đo thời gian kiểm một ca trên phiên cloud. Ba ca kiểm tay ở đợt 0 mỗi ca cần 5–10 lượt đọc database và vài tệp code, khớp ước lượng 5–15 phút.
- Câu phát hiện ca lỗi mới chạy trên 23 giờ dữ liệu; chưa xét được loại "mã lỗi tăng bất thường" vì chưa đủ 7 ngày làm mức nền.
- Chưa gọi thử đường `/fire` (mới đọc tài liệu chính thức); chưa thử gọi nó từ database bằng `pg_net`; chưa đo số token của một phiên cloud làm một ca.
- Phiên Hỏi đáp đang ghi hạn "đến hết ngày 19/11/2026" trong câu lệnh; phiên kiểm lỗi dựng theo cùng cách sẽ có cùng điểm yếu là phải có người gia hạn.
