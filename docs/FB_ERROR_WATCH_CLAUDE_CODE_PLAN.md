# Phương án: Claude Code tự kiểm lỗi chạy chiến dịch Facebook qua hàng việc `ai_*`

Ngày lập: 18/11/2026. Bản 10 (đợt 2 "lỗi không xác định" đã viết code 19/11, V588 đã apply 20:02 VN 19/11, mục 12; đã làm đợt 0, kết quả ở [FB_ERROR_WATCH_DOT0_20261118.md](FB_ERROR_WATCH_DOT0_20261118.md); migration đợt 1 đã apply 17:25 VN 18/11 và phần đọc lỗi đã bật 17:26 VN, mục 5.6; **bật chạy thật 08:31 VN 19/11: agent, chèn việc và tác vụ cloud đều đang bật, ca đầu tiên đã có báo cáo**, mục 5.7). Xin ảnh tự động và đường đánh thức vẫn tắt. Các câu còn mở ở mục 10.

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
| 11 | (19/11) **Đưa lỗi mới vào bảng mã lỗi cũng phải anh duyệt trước** | Claude chỉ đề xuất mã, câu cho khách, chính sách và luật nhận dạng; đề xuất nằm ở trạng thái chờ duyệt, không tự ghi vào database. Tự gọi hàm sửa (cấp 2) chưa làm |

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
| Lượt bị bỏ dở | Lượt đóng `stale` khi máy vẫn mở (presence còn mới). Từ V602: bỏ lượt `data.via = desktop_reset` (app khởi động lại); lượt `orphan` thành ca riêng | lý do đóng + thao tác (+ `\|orphan` với lượt mồ côi) |

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

### 5.7 Bật chạy thật (19/11, 08:31 VN)

Anh đồng ý bật ("Bật ngay") sau khi xem sổ ca gom qua đêm. [Biên nhận](../migrations/snapshots/engine-error-watch-v574/go-live-receipt.json).

| Bước | Kết quả |
|---|---|
| Sổ ca trước khi bật (08:26 VN) | 23 ca, 91 lượt lỗi, 8 lần dừng chiến dịch, gom từ 17:27 VN 18/11: 12 ca mã chưa có kết luận, 7 ca chưa phân loại, 4 ca lượt bị bỏ dở. Job đọc lỗi không lỗi lượt nào |
| Kiểm trước | Tệp công việc và lệnh nhận việc có trên `dev_3`. Câu lệnh phiên Hỏi đáp (lượt hẹn tạo 08:26 VN) vẫn giữ bản sửa 18/11. Nhân viên 4 không có câu nào đang chờ |
| Bật agent và chèn việc (08:31:15 VN) | Một giao dịch: `ai_project` 15 `is_active = true`; thiết lập thêm `enqueue: true` và `enqueueWindow` phút 54–58. Xin ảnh và đường đánh thức giữ tắt |
| Bật tác vụ cloud (08:31:18 VN) | Lịch phút 01 mỗi giờ, lượt theo lịch đầu tiên 09:01 VN |
| Đổi mô hình (08:40 VN) | Anh bảo dùng Fable 5.2 (lúc tạo là Sonnet 5.5) |
| Chạy ngay một ca (08:41 VN) | Anh bảo chạy ngay một cái để xem. Trong một giao dịch: mở khung phút, gọi hàm tạo việc, trả lại khung 54–58. Hàm chèn câu 529 (ca FB46 hộp thư Page, 20 lượt, 3 lần dừng). Rồi cho tác vụ cloud chạy tay |
| Phiên cloud đầu tiên | Khởi động 4 giây, nhận câu 08:41:39, nộp báo cáo đúng khuôn 08:44:23, cả phiên 188 giây, 32 lượt gọi công cụ. Đọc database qua connector được (chỉ có lệnh đọc), gọi API nhận / nộp việc từ môi trường `full` được |
| Thông báo | Phiên cloud có công cụ gửi thông báo đẩy của app Claude và đã gửi một thông báo tóm tắt ca. Không cần connector nào thêm |
| Lượt tự động đầu tiên | 08:54:00 VN job tự chèn câu 530 (ca FB41 "Facebook yêu cầu xác minh tài khoản" khi comment). Tác vụ cloud chạy theo lịch 09:01:31, nhận câu 09:01:51, nộp báo cáo 09:03:33. Ca FB46 chuyển "đã báo cáo" ở lượt 08:46 |

Báo cáo ca đầu (câu 529, FB46 "Không tìm thấy ô để nhập tin nhắn"): kết luận "chưa đủ dữ liệu", cần ảnh. 19 trên 20 lượt ở một chiến dịch của tổ chức 441; cùng tài khoản và cùng Page vẫn gửi được 308 lượt trong ngày. Báo cáo nêu thêm một điểm mới chưa ai kiểm lại: chuỗi data lỗi của chiến dịch không về 0 khi khách bấm tiếp tục, nên chiến dịch đó bị dừng lại 2 lần, mỗi lần chỉ sau một data lỗi.

Báo cáo ca thứ hai (câu 530, FB41 trên trang xác minh): kết luận "lỗi app", độ chắc cao. Block comment bản engine (2869) nhận ra trang `/checkpoint/` nhưng trả mã FB41 thay vì FB04, nên 2 data bị đóng, chuỗi lỗi bị cộng và trạng thái đăng nhập của tài khoản không đổi sang checkpoint, khác quyết định Q6. Báo cáo đề xuất hai cách (sửa block trong database, hoặc sửa bộ lập lịch Desktop). Chưa ai kiểm lại.

Chạy ngay một ca, không chờ phút 54 (dùng lại được): trong MỘT giao dịch đặt `enqueueWindow.fromMinute` thành 0, gọi `select public.aka_agent_engine_error_watch_tick_v1()`, đặt lại 54 rồi COMMIT; job pg_cron không bao giờ thấy khung mở. Tránh giây đầu của phút chẵn vì hàm bỏ lượt khi job đang giữ khoá. Sau đó cho tác vụ cloud chạy tay.

Dừng: đặt `enqueue` thành `false` (ngừng chèn việc, có hiệu lực ở lượt kế); tắt tác vụ cloud ở trang quản lý (ngừng nhận việc); tắt agent bằng `is_active = false`.

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

### 7.4b Tác vụ cloud (đã tạo 18/11 17:01 VN, BẬT từ 08:31 VN 19/11)

Anh đồng ý tạo sẵn ("Tạo sẵn, để tắt"). Tác vụ **Kiểm lỗi chiến dịch Facebook (engine v2)**, mã `trig_01QRNCgX959THHTS7mkdCS3K`, quản lý ở `https://claude.ai/code/routines/trig_01QRNCgX959THHTS7mkdCS3K`.

| Mục | Giá trị | Ghi chú |
|---|---|---|
| Trạng thái | Bật từ 08:31 VN 19/11 | Lượt đầu chạy tay 08:41 VN 19/11 (mục 5.7) |
| Lịch | Mỗi giờ một lượt (phút 01) | Lưới đỡ; lịch của tác vụ cloud không được dày hơn một giờ. Đánh thức ngay khi có việc thì dùng đường `/fire` (mục 7.5) |
| Mỗi lượt | Một phiên mới, làm một câu rồi kết thúc | Không giữ phiên lâu dài, không tự hẹn lại |
| Repo | `aligoinc/akaAgent` | Nhánh mặc định trên GitHub là `dev_2` (cũ), nên câu lệnh bảo phiên chuyển sang `dev_3` trước. Tệp công việc vào `dev_3` qua PR #708 (merge 18/11); thiếu tệp thì phiên dừng với một dòng báo |
| Mô hình | Fable 5.2 | Anh chốt 19/11 ("dùng model fable 5.2 đi"); lúc tạo là Sonnet 5.5. Đổi được trên trang quản lý |
| Môi trường cloud | `full` | Tài khoản có hai môi trường (`full`, `Default`); em chọn `full` để phiên gọi được API và GitHub. Chưa thử `Default` |
| Công cụ | Bash, Read, Write, Glob, Grep | Không có công cụ sửa tệp |
| Connector | Chỉ Supabase, và chỉ công cụ `execute_sql` | Lúc tạo, máy chủ tự gắn cả ba connector của tài khoản (Supabase, Claude Docs, Claude Code Remote); em đã gỡ hai cái không cần và bỏ các công cụ Supabase khác (apply migration, deploy, tạo / dừng project…) |
| Câu lệnh | Chuyển sang `dev_3`, đọc `docs/FB_ERROR_WATCH_TASK.md`, làm đúng một lượt, kèm các giới hạn cứng | Nội dung công việc nằm trong repo nên sửa không cần đụng tác vụ |

**Chuyển tài khoản 19/11 20:33 VN** (anh: "chuyển sang làm trên tài khoản claude này", "Tạo luôn"). Tác vụ ở bảng trên nằm ở tài khoản akabiz và không nhận việc từ 12:01 VN 19/11. Tác vụ thay thế tạo trên tài khoản claude.ai đang đăng nhập ở Desktop: `trig_01SVrvfyyrHvxoRHihkkeovq`, quản lý ở `https://claude.ai/code/routines/trig_01SVrvfyyrHvxoRHihkkeovq`. Cấu hình y hệt (lịch phút 01 mỗi giờ, Fable 5.2, công cụ Bash / Read / Write / Glob / Grep, câu lệnh chép nguyên văn), môi trường `full` của tài khoản này (`env_01K9qSmTVRGkifC1kQxbBidM`), connector chỉ còn Supabase với riêng `execute_sql` (lúc tạo máy chủ lại tự gắn Supabase, Claude Docs, Claude Code Remote; đã gỡ hai cái sau). Lượt thử 20:33:58 VN: khởi động 4 giây, chuyển `dev_3`, lệnh `next` gọi API được và báo hết việc, cả phiên 22 giây; chưa có lượt nào dùng connector Supabase trên tài khoản này. Tác vụ cũ bên akabiz anh tự tắt. Mã `/fire` tạo trên tác vụ mới.

Hai điều cần biết trước khi bật:

- **`execute_sql` vẫn chạy được lệnh ghi.** Câu lệnh và tệp công việc cấm ghi, nhưng đó là lời dặn, không phải chặn kỹ thuật. Trong các phiên có người, connector Supabase hỏi xác nhận trước mỗi lệnh ghi và không ai bấm thì lệnh không chạy; em chưa kiểm được phiên cloud không người có được hỏi như vậy không. Cách chặn chắc là một connector Supabase ở chế độ chỉ đọc cho riêng tác vụ này.
- **Thông báo qua app Claude: có đường (kiểm 19/11).** Phiên cloud có sẵn công cụ gửi thông báo đẩy và lượt đầu đã gửi được, dù em đã gỡ connector Claude Code Remote (connector đó cho phiên tạo và xoá tác vụ, quá rộng với một phiên đọc dữ liệu không tin cậy). Mỗi lượt cũng là một phiên xem được trong danh sách phiên của anh.

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
| 1 | Migration đã viết (mục 5.1) và đã chạy thử trong một giao dịch rồi huỷ (mục 5.5). **Đã làm 18/11 (mục 5.6)**: (a) chọn số thật ngay trước khi apply; (b) apply, mọi công tắc tắt, agent chưa bật; (c) bật `enabled`. **Đã làm 19/11 (mục 5.7)**: (d) câu lệnh phiên Hỏi đáp đã sửa 18/11, agent bật; (e) tác vụ cloud bật, chèn việc bật với trần 10 việc mỗi ngày, chưa xin ảnh. **Còn lại**: theo dõi 3 ngày theo tiêu chí nghiệm thu bên dưới | 1 migration, 2 dòng dữ liệu, 1 job |
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

- Đã chạy thật 19/11 (mục 5.7): chèn việc, phiên cloud đọc database qua connector, gọi API từ môi trường `full`, nộp báo cáo đúng khuôn, gửi thông báo. Hai ca đầu: một ca chèn bằng lượt gọi tay và chạy tay, một ca chèn tự động 08:54 và chạy theo lịch 09:01.
- Chưa thử lần nào: xin ảnh, mã lỗi tăng bất thường, gửi lại câu quá hạn, báo lại ca tăng gấp 3.
- Chưa kiểm lại nội dung hai báo cáo đầu ("chuỗi lỗi không về 0 khi bấm tiếp tục"; "trang xác minh ra FB41 thay vì FB04").
- Chưa thử đọc ảnh 2 MB dạng base64 qua connector Supabase trong phiên cloud.
- Thời gian kiểm một ca trên phiên cloud: ca đầu 188 giây (Fable 5.2, 32 lượt gọi công cụ, 11 lượt đọc database). Chưa đo số token.
- Câu phát hiện ca lỗi mới chạy trên 23 giờ dữ liệu; chưa xét được loại "mã lỗi tăng bất thường" vì chưa đủ 7 ngày làm mức nền.
- Chưa gọi thử đường `/fire` (mới đọc tài liệu chính thức); chưa thử gọi nó từ database bằng `pg_net`; chưa đo số token của một phiên cloud làm một ca.
- Phiên Hỏi đáp đang ghi hạn "đến hết ngày 19/11/2026" trong câu lệnh; phiên kiểm lỗi dựng theo cùng cách sẽ có cùng điểm yếu là phải có người gia hạn.

## 12. Đợt 2: "Lỗi không xác định" (viết 19/11; V588 đã apply 20:02:31 VN 19/11; code đã merge `dev_3` qua #726 lúc 20:09 VN 19/11)

Yêu cầu được giao: có bảng lưu từng lỗi không xác định (khách hàng, tài khoản, chiến dịch, data, câu lỗi); Claude kiểm xong thì kết luận nằm trong bảng và hiện ra ở kết quả chạy cùng ghi chú data; app có tab "Lỗi không xác định"; có công tắc toàn hệ thống trong database; cấp 1 biến lỗi không xác định thành lỗi có mã, cấp 2 tự gọi hàm sửa.

### 12.1 Anh đã chốt (19/11)

| # | Quyết định |
|---|---|
| 1 | Phạm vi giữ engine Facebook và các loại ca đang chạy; Zalo làm sau |
| 2 | Tab cho admin akaBiz trước. Khách chỉ thấy một câu ngắn trong kết quả chạy, anh duyệt từng câu |
| 3 | Phiên cloud giữ quyền đọc database để điều tra, cấm ghi; kết quả nộp qua API |
| 4 | ~~Lịch mỗi giờ một lượt như hiện tại~~ Anh đổi cuối chiều 19/11: tác vụ cloud không tự dậy theo giờ để hỏi "có việc không" nữa, vì lượt trống vẫn tốn token |
| 5 | **Job trong database kiểm trước, có câu hỏi thì mới gọi Claude dậy** bằng đường `/fire` ("chỉ query db, khi nào db có lỗi thì mới gọi prompt"; đổi quyết định "không dùng `/fire`" hôm 18/11). Mã do anh tạo trên trang tác vụ và tự lưu vào Vault |
| 6 | **Cấp 1 chỉ đề xuất, anh duyệt trước rồi mới ghi vào database** ("cấp 1 cũng đừng tự đưa vào db, cũng cần phải tôi duyệt trước"). Cấp 2 chưa làm |

### 12.2 Database: V588 (`migrations/migration_v588_engine_error_review.sql`, sinh bằng `node scripts/build-v588-sql.cjs`)

- Bảng `private.auto_engine_error_items`: mỗi kết quả lỗi thuộc một ca là một dòng (tổ chức, nhân viên, tài khoản, chiến dịch, data, lượt, mã công khai, câu lỗi, dòng lịch sử). Khoá `result_key` nên một kết quả chỉ ghi một lần; lượt bỏ dở dùng khoá `stale:<lượt>`. Giữ `itemRetentionDays` ngày (mặc định 30, tối thiểu 7).
- Sổ ca `private.auto_engine_error_cases` thêm 17 cột: báo cáo (`report`, `report_message_id`, `report_at`, `summary`, `conclusion`, `confidence`), câu cho khách (`customer_note`, trạng thái `none / proposed / approved / rejected`, người và giờ duyệt), đề xuất mã lỗi (`code_proposal`, trạng thái thêm `applied`, người và giờ duyệt), lượt gọi `/fire` (`fired_message_id`, `fired_at`, `fire_count`).
- Hàm tick (thân V574 md5 `a93263ce…` → `b4e8c500…`, vá 10 chỗ): ghi từng lượt lỗi; khi câu của ca có báo cáo thì chép kết luận về sổ ca, `cau_cho_khach` và `de_xuat_ma_loi` của báo cáo vào trạng thái **chờ duyệt** (không đè cái đã duyệt); câu đã duyệt thì ghi vào `auto_campaign_details.log` (câu + mã công khai trong ngoặc, câu cũ giữ ở `data.errorReview.originalLog`) và `auto_campaign_input_data.note` (chỉ khi ghi chú còn đúng câu cũ), tối đa 100 lượt mỗi tick; bỏ duyệt thì trả câu cũ. Kết quả tick thêm `items`, `notes`, `refired`. Bước gọi `/fire` viết lại, xem 12.5.
- Hàm `public.aka_agent_engine_error_review(p_action, p_payload)`: chỉ `aka_agent_desktop`, chỉ nhân viên `is_admin_akabiz`, trần 8 giây. Thao tác `list`, `case`, `note` (duyệt / bỏ câu cho khách, 5–200 ký tự, admin sửa được câu), `code` (duyệt / bỏ đề xuất mã lỗi, **chỉ ghi quyết định**; thêm mã vào bảng mã lỗi vẫn bằng migration do anh duyệt), `mark` (đã biết / mở lại).
- `ai_project.output_schema` của agent thêm hai thuộc tính tuỳ chọn `cau_cho_khach`, `de_xuat_ma_loi`.
- Công tắc toàn hệ thống: vẫn là `auto_system_settings` `engine.error_watch` (`enabled` tắt thì không đọc lỗi, không ghi lượt, không ghi câu). Không thêm công tắc mới.
- Bản gỡ `rollback_v588_engine_error_review.sql` dừng nếu còn lượt mang câu đã ghi, trừ khi `SET LOCAL aka.v588_rollback_keep_notes = 'on'`.
- **Đã apply akachat 20:02:31 VN 19/11/2026** theo yêu cầu ("ok apply V586 đi"; sổ `20261119130229 / migration_v588_engine_error_review`, không apply lại, md5 sổ = file `a851282c…`; [biên nhận](../migrations/snapshots/engine-error-review-v588/apply-receipt.json)). Viết với số 586; lúc kiểm trước apply sổ đã có V586 / V587 `aka_assistant` của phiên khác nên đổi số trong bộ sinh rồi sinh lại. Trước đó chạy thử nguyên văn trên production trong một giao dịch rồi huỷ (migration 2,6 giây, chép 460 lượt lỗi của 50 ca và 3 báo cáo sẵn có, tick 13–21 ms, `list` 7 ms, `case` 15 ms bằng phiên admin). Sau apply: PostgREST nạp lại schema 3,3 giây, 0 lỗi 5xx, 52 request REST chậm hơn 1 giây trong 20 giây; hai lượt job đầu 62–67 ms, lượt 20:06 ghi 4 lượt lỗi mới. Thiết lập `engine.error_watch` không đổi (`fire` vẫn tắt).
- Kiểm: `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-facebook/error-review-v588-smoke.cjs` (11 nhóm, PG17 cục bộ; có nhóm `/fire` với `net.http_post` và Vault giả), `error-watch-smoke.cjs` (17 nhóm, V574 không đổi hành vi).

### 12.3 Phiên cloud

- Khuôn báo cáo thêm `cau_cho_khach` (một dòng 5–200 ký tự, không mã nội bộ, không tên block / selector, không tự kèm mã công khai) và `de_xuat_ma_loi` (`ten_loi`, `cau_cho_khach`, `buoc_tiep_theo`, `cach_xu_ly`, `dau_hieu`). Lệnh nộp `error-watch-agent.cjs` từ chối báo cáo sai khuôn (`error-watch-agent-smoke.cjs`, 10 nhóm).
- [FB_ERROR_WATCH_TASK.md](FB_ERROR_WATCH_TASK.md) ghi rõ hai trường này chỉ là đề xuất. Phiên cloud đọc tệp này từ `dev_3`, nên chỉ có hiệu lực sau khi merge.

### 12.4 Desktop: tab "Lỗi không xác định" (admin akaBiz)

- Mục menu tài khoản, chỉ hiện khi `user.isAdminAkabiz`; mở hộp thoại `components/EngineErrorReview/EngineErrorReviewModal.tsx`: danh sách ca (lọc trạng thái, loại ca, chờ duyệt, tìm theo mã / câu lỗi), chi tiết ca (kết luận của Claude, báo cáo đầy đủ, câu cho khách, đề xuất mã lỗi, các lượt lỗi theo khách hàng / tài khoản / chiến dịch / data).
- Một kênh IPC `engine-error-review:call` (`handlers/engineErrorReviewHandlers.ts` → `engineErrorReviewRepository.ts`), hợp đồng ở `src/shared/engineErrorReview.ts`. Tiến trình chính lọc payload theo từng thao tác và chặn tài khoản không phải admin trước khi gọi DB. DB chưa có V588 (`PGRST202`) thì hộp thoại báo "đang được cập nhật".
- Chỉ đọc DB khi mở tab, đổi bộ lọc hoặc bấm nút; không hẹn giờ. Duyệt câu cho khách phải qua hộp xác nhận ghi rõ số lượt và câu khách sẽ thấy.
- Kiểm: hai typecheck 0 lỗi; `CHROMIUM_PATH=<Chrome> node scripts/run-engine-error-review-ui-smoke.cjs` (10 nhóm, hộp thoại thật với IPC giả lập).

### 12.5 Cách chạy bền: database kiểm trước, có câu hỏi mới gọi Claude (chờ mã của anh)

Mỗi lượt theo lịch của tác vụ cloud là một phiên Claude mới, kể cả khi không có việc (đọc câu lệnh, hỏi hàng việc, thấy trống, kết thúc). Với trần 10 việc mỗi ngày thì ít nhất 14 trong 24 lượt theo giờ là lượt trống. Tác vụ cloud không có kiểu "chỉ chạy một câu SQL": lượt nào cũng là một phiên có mô hình (tài liệu Anthropic đọc 19/11: không có chế độ chỉ chạy script, không có điều kiện "có việc mới chạy câu lệnh"; script cài đặt của môi trường chạy trước Claude nhưng được lưu snapshot nên các phiên sau bỏ qua, không làm bước kiểm trước được). Nên phần kiểm phải nằm ngoài Claude, và nó đã có sẵn: job pg_cron 2 phút một lượt, không tốn token.

Bước 6c của hàm tick từ V588:

- Chỉ gọi khi có câu của bộ kiểm lỗi đang "chờ câu trả lời" (chưa phiên nào nhận) và còn hơn 5 phút mới hết hạn. Không có câu thì không gọi gì.
- Lượt đầu gọi ngay trong tick chèn câu. Sau `fireRetryMinutes` phút (mặc định 10, tối thiểu 4) câu vẫn chưa ai nhận thì gọi lại, tối đa `fireMaxPerMessage` lượt mỗi câu (mặc định 3). Lý do: pg_net gửi sau khi giao dịch xong và không báo lỗi HTTP về hàm, nên "đã gọi" chưa chắc tác vụ đã chạy.
- Chạy cả ngoài khung chèn việc (V574 chỉ gọi một lần và chỉ trong khối chèn việc).
- Mỗi lượt gọi là `POST …/routines/<trig>/fire` với body `{"text":"messageId=<id>"}`; `fireRoutineId` phải đúng dạng `trig_…`, mã đọc từ Vault.

Để bật: anh tạo mã trên trang tác vụ mới (tài khoản đang đăng nhập ở Desktop) và tự chạy `select vault.create_secret('<mã>', 'AKA_AGENT_ENGINE_ERROR_WATCH_FIRE_TOKEN');`, rồi đặt `fire: true`, `fireRoutineId: "trig_01SVrvfyyrHvxoRHihkkeovq"` (tác vụ mới, xem 7.4b) và bỏ `enqueueWindow` (khung phút 54–58 chỉ cần khi chờ lịch theo giờ).

Lịch theo giờ của tác vụ cloud: sau khi `/fire` chạy được một ca thật thì **gỡ trigger lịch** (trang sửa tác vụ, biểu tượng thùng rác ở dòng lịch, rồi Save changes), giữ trigger API. Không dùng công tắc tạm dừng: tác vụ đang tạm dừng trả 400 cho lệnh `/fire`. Phải làm bằng tài khoản akabiz.

Tài liệu Anthropic đọc lại 19/11 ([trang tác vụ](https://code.claude.com/docs/en/routines.md), [API fire](https://platform.claude.com/docs/en/api/claude-code/routines-fire)):

- Tạo mã: claude.ai/code/routines → mở tác vụ → Edit → dòng Trigger bấm `+` → API → Generate token. Mã (`sk-ant-oat01-…`) hiện một lần, có hiệu lực ngay; Regenerate thì mã cũ hết hiệu lực ngay; Delete token gỡ luôn trigger API.
- Tác vụ chỉ có trigger API (không lịch) là hợp lệ: "A task with only an API trigger runs when you call its endpoint". Tài liệu không nói rõ gỡ trigger lịch có giữ nguyên trigger API hay không, nên gỡ xong phải kiểm lại.
- Lệnh gọi trả 200 kèm `claude_code_session_id` ngay, không chờ phiên chạy; mỗi lệnh một phiên mới, không có khoá chống gọi trùng. Lỗi: 400 (tác vụ tạm dừng), 401, 403, 404, 429 kèm `Retry-After`.
- Header `anthropic-beta` không bắt buộc (hàm tick vẫn gửi, vô hại); `anthropic-version` từ `2023-06-01` trở lên.
- Trần: 30 lượt mỗi giờ mỗi tác vụ (chung với Run now), 100 lượt mỗi giờ mỗi tài khoản. Lượt `/fire` tính vào hạn mức sử dụng của gói như phiên thường; hết hạn mức thì lượt bị từ chối tới khi cửa sổ sử dụng đặt lại (trừ khi tổ chức bật usage credits).

**Việc phải xem trước:** từ lượt 12:01 VN 19/11 tác vụ cloud không nhận việc (câu 534, 536, 543 hết hạn thành "lỗi"; câu 550 chèn 15:54 chưa ai nhận lúc 16:52). Mỗi câu hết hạn vẫn tính vào trần 10 việc mỗi ngày. Chưa rõ lý do; phiên Desktop đang đăng nhập tài khoản claude.ai khác nên không đọc được lịch sử chạy của tác vụ. Nếu tác vụ hỏng thật thì `/fire` cũng không chạy được.

### 12.6 Thứ tự đưa vào dùng

1. Apply V588: **xong 20:02 VN 19/11**.
2. Merge `dev_3` để phiên cloud đọc khuôn báo cáo mới: **xong qua #726, 20:09 VN 19/11**.
3. Build Desktop thì admin mới có tab (trước đó duyệt được bằng cách gọi hàm trong SQL với phiên admin).
4. Bật `/fire`: **xong 20:49 VN 19/11** trên tác vụ mới `trig_01SVrvfyyrHvxoRHihkkeovq` (gọi thử từ database: HTTP 200, phiên chạy và báo hết việc; [biên nhận](../migrations/snapshots/engine-error-review-v588/fire-on-receipt.json)). Còn lại: một ca thật đi qua `/fire` (dự kiến 00:54 VN 20/11), rồi gỡ lịch theo giờ của tác vụ và bỏ `enqueueWindow`.

### 12.7 Chưa kiểm

- V588 đã chạy trên production; chưa có ca nào được duyệt câu nên bước ghi câu vào kết quả chạy và ghi chú data chưa chạy trên dữ liệu thật.
- Tab chưa chạy trong Electron thật (hàm `list` / `case` đã gọi trên DB thật bằng phiên admin trong lượt chạy thử, các thao tác duyệt thì chưa).
- Chưa có báo cáo thật nào mang `cau_cho_khach` / `de_xuat_ma_loi`.
- Đường `/fire` đã gọi thử một lượt trên production (20:49 VN 19/11, không kèm mã câu) nhưng chưa có ca thật nào đi qua; chưa biết tác vụ tắt lịch có còn nhận `/fire` không; chưa đo token của một lượt trống.

## 13. V593: chọn ca theo mức ảnh hưởng, ảnh lỗi trước khi hỏi, thông báo kèm lệnh xử lý (viết 20/11; V593 đã apply 11:21:16 VN 20/11, [biên nhận](../migrations/snapshots/engine-error-watch-v593/apply-receipt.json))

Vì sao (đo 20/11/2026): sổ có 45 ca `new` và 6 ca `failed`; ba ca nặng nhất (FB46 hộp thư Page 58 lần dừng, FB42 "form đăng bài chưa đóng"
90 lượt ở 18 tổ chức, FB41 56 lượt) đều `failed` từ lúc tác vụ cũ bên akabiz ngừng nhận việc 19/11. Hàm tick V588 xếp `ORDER BY (k.status =
'failed'), …` nên ca `failed` chỉ tới lượt khi không còn ca `new` nào, tức gần như không bao giờ. Ca cần ảnh nhất là ca mã chung (FB41, FB42) mà
V588 chỉ xin ảnh cho ca chưa phân loại, và câu hỏi chèn ngay cùng lúc xin ảnh nên phiên cloud kiểm lần đầu không có ảnh (5/10 ca đêm 19–20/11 kết
luận "chưa đủ dữ liệu, cần ảnh"). Thông báo gửi cả các ca không có việc gì cho anh làm và không nói phải làm gì tiếp.

Đã làm (nhánh `claude/error-watch-v593`):

- [V593](../migrations/migration_v593_engine_error_watch_order_images.sql), sinh bằng `node scripts/build-v593-sql.cjs`, chỉ thay thân hàm tick:
  - chọn ca theo `pauses DESC, hits DESC`, trạng thái chỉ để phá hoà; trần gửi lại mỗi ngày (`resendPerDay`) giữ nguyên;
  - xin ảnh cho mọi loại ca có ảnh (trừ lượt bị bỏ dở), vẫn mỗi ca một yêu cầu, mỗi khách một yêu cầu mỗi ngày, trần `imageMaxTableMb`;
  - ca đang chờ ảnh (`pending` / `uploading`) chưa hỏi tối đa `imageWaitMinutes` phút (mặc định 15, 0 = như V588), không tốn chỗ trong ngày; ảnh
    về thì câu hỏi có dòng `anh da ve: N ảnh` và `image_followup_at` đặt luôn; quá hạn thì hỏi không ảnh, ảnh về sau bước 6a hỏi tiếp như cũ;
  - kết quả tick thêm `imageWaiting`.
- `engine.error_watch`: `imageRequests: true`, `imageWaitMinutes: 15` (bật 11:18:14 VN 20/11 theo yêu cầu). Tắt xin ảnh: `imageRequests: false`;
  chỉ tắt việc chờ: `imageWaitMinutes: 0`.
- [Tệp việc](FB_ERROR_WATCH_TASK.md): ảnh đã về thì xem trước khi kết luận; thông báo chỉ khi có việc cho anh, theo khuôn có mã câu và lệnh xử lý.
- Lệnh [`/xu-ly-loi`](../.claude/commands/xu-ly-loi.md) cho session Claude Code trên máy.

Chưa kiểm: chưa có yêu cầu ảnh nào do bộ kiểm lỗi tạo trên production (yêu cầu ảnh số 1 ngày 20/11 do phiên khác tạo tay, về sau
33 giây); lệnh `/xu-ly-loi` chưa chạy thật.

## 14. Hộp thư lỗi, không thông báo, bỏ qua tạm thời (viết 20/11; V594 đã apply 12:11:07 VN 20/11, [biên nhận](../migrations/snapshots/engine-error-watch-v594/apply-receipt.json))

Anh chốt 20/11/2026: "ko cần đẩy thông báo lên điện thoại hay lên đâu gì nữa cả… chỉ cần 1 session hộp thư lỗi, cứ 1 tiếng check db 1 lần, nếu có
lỗi đem ra nghiên cứu tìm nguyên nhân luôn… thấy lỗi nào cần fix thì sẽ mở session con để fix, lỗi nào cần bỏ qua thì tôi kêu bỏ qua… nhưng bỏ qua
đó là tạm thời nếu loại đó xuất hiện quá nhiều trên toàn hệ thống vẫn phải đưa vào"; qua hộp chọn: nghiên cứu chạy trên cloud để máy tắt vẫn chạy,
bỏ qua mở lại khi từ 30 lượt / 24 giờ, tối đa 2 ca mỗi giờ và 10 ca mỗi ngày.

Một session cloud lâu dài vừa nghiên cứu vừa làm hộp thư thì không làm được (tài liệu Anthropic đọc 20/11): mỗi lượt của tác vụ cloud (theo lịch hay
`/fire`) là một session mới, session cloud tự dừng khi không hoạt động (nên phiên Hỏi đáp tự hẹn giờ ngừng hẳn 19/11), và session cloud không mở
được session trên máy hay gửi tin vào đó. Nên chia hai chỗ:

- **Nghiên cứu ở cloud** (như hiện nay, chạy cả khi máy tắt): job database kiểm mỗi 2 phút, mỗi giờ đưa tối đa `maxPerHour` ca (10 ca mỗi ngày) và
  gọi `/fire`; phiên cloud nộp báo cáo vào database. Câu lệnh của tác vụ và [tệp việc](FB_ERROR_WATCH_TASK.md) cấm gửi thông báo (câu lệnh sửa
  12:00 VN 20/11 theo yêu cầu, có hiệu lực ngay; tệp việc có hiệu lực khi vào `dev_3`).
- **Hộp thư trên máy** ([`/hop-thu-loi`](../.claude/commands/hop-thu-loi.md), [script](../scripts/engine-v2-facebook/error-watch-inbox.cjs)): hiện các
  ca đã có báo cáo đang chờ quyết (đọc thẳng sổ ca, nên máy tắt không mất gì), tự xem lại mỗi giờ khi máy mở; "sửa câu N" mở session con chạy
  `/xu-ly-loi N` và ẩn ca khỏi hộp thư (ghi trên máy) tới khi có báo cáo mới; "bỏ qua câu N" ghi ca sang `muted`.

[V594](../migrations/migration_v594_engine_error_watch_hourly_skip.sql), sinh bằng `node scripts/build-v594-sql.cjs` từ thân V593
(md5 `88a4fb4b…` → `022dfb36…`):

- `maxPerHour`: tối đa N câu mỗi giờ đồng hồ (đếm câu của agent trong giờ, cả câu hỏi tiếp khi ảnh về); bỏ trống = như V593. Bật: `"maxPerHour": 2`.
- Bước 5b: ca `muted` có từ `skipReopenHits24h` (mặc định 30) lượt lỗi trong 24 giờ (đếm `auto_engine_error_items`) thì về `new` với ghi chú
  "Mở lại sau khi bỏ qua: từ N lượt trong 24 giờ", được hỏi trong hội thoại cũ của ca, câu hỏi có dòng `ghi chu:`. Ca "tăng bất thường" có ngày
  trong khoá nên bỏ qua chỉ có tác dụng trong ngày.
- Bước 6a (hỏi tiếp khi ảnh về) chỉ nhận ca `reported`; ca `failed` để bước 6b hỏi bằng câu đầy đủ kèm `anh da ve` (sửa chỗ lệch của V593, câu 585).
- Hàm `private.aka_agent_engine_error_case_skip_v1(câu, bỏ qua?)` cho lệnh `skip` / `unskip` của hộp thư: chỉ role postgres; từ chối ca đang
  được nghiên cứu (`queued`) vì bước chép báo cáo chỉ nhận ca `queued`.

Kiểm: `LC_ALL=C node scripts/engine-v2-facebook/error-watch-v594-smoke.cjs` (7 nhóm, có đối chứng V593 cho câu 585). Đã apply 12:11 VN 20/11 và
đặt `"maxPerHour": 2, "skipReopenHits24h": 30` lúc 12:12 VN. Chưa làm: gỡ lịch mỗi giờ của tác vụ cloud (lịch chỉ còn là lưới đỡ; mỗi lượt
trống vẫn mở một session; gỡ ở trang sửa tác vụ trên claude.ai, giữ trigger API).

## 15. Đánh giá sau ba ca đầu qua hộp thư, V599 xin ảnh từ nhiều lượt (viết 20/11; merge `dev_3` qua #747 lúc 14:47 VN, V599 đã apply 14:48:13 VN 20/11, [biên nhận](../migrations/snapshots/engine-error-watch-v599/apply-receipt.json))

Anh thử ba ca qua hộp thư ngày 20/11: câu 572, 584, 585. Phần trên máy chạy đúng. Hộp thư mở mỗi ca một session con và đánh dấu ca đang sửa. Session
con chỉ đọc production cho tới khi anh duyệt. Kết quả: 584 sửa bằng V598, 585 bằng V597, 572 bỏ qua.

Báo cáo của phiên cloud sai hoặc thiếu ở cả ba ca, nên session con phải làm lại:

| Ca | Báo cáo cloud | Session con tìm ra |
|---|---|---|
| 585 | block 2624; 1 ảnh, một mã đề xuất | engine chạy 2871; 6 ảnh, 4 tình huống |
| 584 | mọi link chờ duyệt ra FB15 | 17/78 lượt là trang "Chưa có bài viết nào để xem xét", ra FB15 là sai |
| 572 | cần ảnh; cùng lỗi với 567 | chỉ có ở 9.9.0, lên 10.0.0 thì 168 lần không lỗi; hỏng ở lần chờ khác với 567 |

Sửa:

- **Tệp việc** (`FB_ERROR_WATCH_TASK.md`):
  - tra block bằng `blockId` của node trong `auto_workflows.nodes`, không theo tên;
  - đếm data kế tiếp trên cùng tài khoản có chạy được không, có câu mẫu (anh yêu cầu ở câu 585);
  - kiểm lỗi đã hết sau khi khách lên bản app mới chưa;
  - chia ca theo bằng chứng trước khi đề xuất;
  - chỉ có một ảnh thì độ chắc không quá trung bình.
- **`/xu-ly-loi`**:
  - ca không cần sửa thì đề nghị "bỏ qua", không đề nghị "Đã biết" (ca "Đã biết" không tự mở lại);
  - tìm số migration theo tên tệp, và ghi số vừa giữ vào thư mục ghi chú chung;
  - bản sửa có hiệu lực thì đề nghị đóng ca.
- **V599** (`migrations/migration_v599_engine_error_watch_multi_images.sql`, sinh bằng `node scripts/build-v599-sql.cjs`; thân tick
  `022dfb36…` → `2cade73e…`):
  - Ca được hỏi lần đầu: xin ảnh từ tối đa `imageRunsPerCase` lượt (mặc định 5, 1–10), mỗi lượt của một nhân viên khác nhau, ưu tiên nhân viên
    đang mở app.
    - Mỗi nhân viên khách vẫn một yêu cầu mỗi ngày.
    - Lấy trong 300 lượt gần nhất của ca trong 3 ngày, cộng lượt `screenshot_run`.
    - Đo chỉ đọc trên ca 585: 172 ms, 21 nhân viên có ảnh.
  - Cột mới `image_request_ids`; `image_request_id` vẫn là mã đầu tiên.
  - Chờ mọi yêu cầu xong, hoặc quá `imageWaitMinutes` phút, rồi mới hỏi. Câu hỏi ghi mọi mã ở dòng `yeu cau anh`.
  - Lệnh `next` của phiên cloud đọc được danh sách mã.
  - Hỏi tiếp vì ảnh: hỏi khi đã có ảnh và không còn yêu cầu nào chờ dưới 60 phút.
  - Gỡ: bản gỡ, hoặc đặt `"imageRunsPerCase": 1`.
  - Kiểm: `CHAT_REPO=… LC_ALL=C node scripts/engine-v2-facebook/error-watch-v599-smoke.cjs` (10 nhóm).

Thứ tự đưa vào dùng:
1. Merge PR (tệp việc và lệnh `next` mới có hiệu lực từ lượt cloud kế tiếp; `next` đọc được cả câu một mã lẫn nhiều mã).
2. Apply V599 vào phút lẻ, ngoài giờ cao điểm.

Chưa làm: tick vẫn coi yêu cầu chỉ có DOM (không ảnh) là chưa có ảnh, và câu hỏi chưa báo DOM đã về (để sau khi phát hành bản Desktop có #739).
