# Engine v2 cho chiến dịch Facebook: phương án (16/11/2026)

> **Trạng thái: phương án; anh đã chốt đủ Q1–Q24 ngày 16/11.** Phương án ở commit `e8859777` (nhánh `claude/fb-engine-v2-plan`, tách từ
> `dev_3` `0ae0d6f2`); code làm ở nhánh `claude/fb-engine-v2` tách từ commit đó. Chưa apply migration nào, không ghi gì lên production.
> **Thứ tự (anh chốt 16/11 tối): làm hoàn chỉnh code đợt 0–3 trước, bảng duyệt FB để cuối** (trước khi apply migration chính sách và bật
> tổ chức thử; mục 10). Danh sách thay đổi schema chờ anh duyệt trước khi viết migration: [CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_SCHEMA.md](CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_SCHEMA.md).
> Cập nhật 16/11 chiều theo trao đổi với anh: bắt lỗi theo từng thao tác nhỏ (3.6), sửa block / workflow không ảnh hưởng bản cũ (3.7),
> ghi dấu ba mức (3.3), ảnh chụp khi lỗi và lấy ảnh từ máy khách (12), câu hỏi Q7 sửa lại, Q12–Q14 mới.
> Đã chốt: Q1 bật FB chỉ theo tổ chức, không có công tắc theo loại (như Zalo), danh sách tổ chức nằm trong thiết lập `engine.facebook`;
> Q2 tạm dừng giữa data thì dừng sau mốc đang chạy; Q3 duyệt bảng FB trước lần bật đầu; Q4 làm sớm trang cá nhân và newsfeed; Q5 đưa
> tìm data vào engine; Q9 gộp đợt 3–7 thành một đợt làm cả 13 loại cùng lúc; Q6 checkpoint chỉ là trạng thái đăng nhập, không khoá, kèm vá AutoCheck; Q7 chép hết
> block / workflow FB đang dùng sang bản riêng cho engine; Q8 engine ghi mọi bước như bộ cũ; Q12 chỉ lấy ảnh lỗi theo yêu cầu, Q13 không báo
> khách, Q14 giữ ảnh trên máy 14 ngày hoặc 1 GB; Q17, Q18 ảnh chỉ lấy khi chụp được, không bắt buộc, không thêm gì; Q19 làm như Zalo:
> không tách cổng bảo trì, chỉ mở cho khách khi engine đủ 13 loại FB; Q20 block treo = 10 phút liền không có thao tác, huỷ cửa sổ ẩn;
> Q21 thêm câu chờ khi chiến dịch đến lịch quá 10 phút chưa chạy được (cả Zalo trên Desktop); Q24 Zalo giữ nguyên cổng bảo trì như hôm nay; Q10 giữ
> hạn mức giữa vòng comment như bộ cũ, ô số comment (cả "Số bài cần comment…" của comment seeding) tối đa 20, chiến dịch cũ
> chỉ chạy tới 20, con số 20 sửa được ở DB; Q11 giữ AI đọc ảnh để viết câu lý do cho lỗi chưa phân loại như bộ cũ;
> Q15 block lỗi thì giữ toàn bộ vết thao tác (trần 200 thao tác / 64 KB); Q16 tra lỗi bằng hàm + script trước, màn hình Web sau;
> Q23 mỗi mã lỗi một câu cho khách dùng chung mọi chỗ, kèm câu bước tiếp theo, anh duyệt từng câu; Q22 không gửi báo giám sát,
> anh hỏi trong phiên thì chạy hàm kiểm (16/11).
>
> **Tình trạng code (16/11 khuya, worktree `akaAgent-fb-engine-plan`, nhánh `claude/fb-engine-v2`, chưa commit, chưa apply gì):**
> - Migration (chưa apply): V556 p1/p2 (bảng, thiết lập, hàm tra lỗi / ảnh lỗi; bỏ bảng T4 "việc sau kết quả" theo anh chốt), V557 (lượt
>   theo lịch), V558 (thân hàm engine; `resolve_policy` giải `inherit` đúng như bộ cũ; claim nhận đúng danh sách data trong lượt đang giữ
>   lease; `report_v1` nhận dòng "Tìm data" không gắn thao tác; gỡ V558 từ chối khi còn chính sách `inherit`), **V559 bản nháp chính sách
>   FB** (4 mã FB42–FB45, 15 luật phân loại, 86 dòng chính sách = đúng bộ cũ trừ Q6 / Q20 và 4 mã có dấu hiệu (17/11, như mã hôm nay), dòng thiết lập `facebook.error_signs`; anh duyệt xong bảng 17/11
>   [CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_FULL_REVIEW.md](CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_FULL_REVIEW.md)), **V560 chép 84 block + 14 workflow
>   "[engine]"** kèm sổ chép và 24 dòng danh mục bước. Số migration kiểm lại sổ + `git log --all` ngay trước khi apply (sổ 16/11 tới V552).
> - Desktop: hook workflow, vết thao tác, cổng FB trong bộ lập lịch, ảnh lỗi + trả lời yêu cầu chẩn đoán, vá AutoCheck (Q6), block treo (Q20),
>   câu chờ (Q21) và nút "Lý do đang chờ" hiểu engine (R17, cả Zalo), trần comment (Q10), mã lượt workflow trong mọi kết quả + script
>   `scripts/engine-v2-facebook/trace.cjs` (`--data` / `--run` / `--health` / `--drift`, R1 / R18), nghỉ / lướt FB chạy bản "[engine]". **Cả
>   13 loại chạy bộ mới khi tổ chức bật** (hàm phủ không còn trả loại nào về bộ cũ, trừ chạy ngẫu nhiên theo tài khoản).
> - Kiểm (PostgreSQL 17 cục bộ): `sql-smoke` 34/34 (3 nhóm "kết thúc lượt" tự bỏ qua sau 22:00 giờ VN), `policy-parity-smoke` 12/12 (2.640
>   cặp khớp bộ cũ), `copy-smoke` 7/7, `desktop-fb-smoke` 20/20, `core-smoke` 11/11, `workflow-hooks-smoke` 10/10, `page-trace-smoke` 5/5,
>   `screenshots-smoke` 4/4, `autocheck-smoke` 4/4, `wait-reason-smoke` 6/6, typecheck Desktop + lõi; `campaign-outcome-engine-check-all`
>   (Zalo) đạt; bộ kịch bản Zalo trên DB có V556–V558 (`SCENARIO_FACEBOOK_MIGRATIONS=1`): 0 vi phạm mới.
> - **Ba việc còn lại, anh chốt 16/11 khuya, đã làm:**
>   (1) **Đăng nhóm kèm chia sẻ sang nhóm đã tham gia** (1.479 chiến dịch đăng nhóm trong 30 ngày): anh chọn "làm y bộ cũ". Ứng viên, số
>   nhóm tối đa (`min(3, lượt còn - 1)`), chống gửi lặp cho ứng viên và block chọn nhóm giữ nguyên bộ cũ; ngay trước cú bấm Đăng, nhóm đã
>   chọn được nhận vào lượt (`claimExtraTargets` → `claim_batch_v1` với `inputDataIds`, cùng lease, mỗi nhóm một lượt data riêng) và ghi dấu
>   "sắp gửi" từng nhóm. Dòng "Đăng bài dạng chia sẻ vào …" của bộ dựng cũ ghi vào lượt data của nhóm đó. Đã đăng: nhóm hoàn thành, ghi chú
>   "Đăng bài dạng chia sẻ" như bộ cũ; chưa bấm Đăng: nhóm về hàng đợi (SYS01, trả lại lượt); bấm rồi không rõ: nhóm đóng, ghi "không rõ"
>   (UNK01), không đăng lại (bộ cũ trả về hàng đợi nên có thể đăng trùng). Nhóm đã chọn mà không nhận / không ghi dấu được thì không bấm Đăng.
>   (2) **Tìm data** (162 chiến dịch): anh nói "cái tìm data này đâu phải là hành động thực hiện fb gì đâu", giữ Q5 đưa vào engine: dòng
>   "Tìm data" ghi không gắn thao tác như bộ cũ (V558 `report_v1`), không tính lượt, không khoá; lỗi có mã (FB42 theo trạng thái), ảnh lỗi,
>   giữ lượt; đẩy data đi như bộ cũ.
>   (3) **Đẩy nốt việc bị ngắt**: anh chọn "Như bộ cũ": việc sau kết quả (đẩy data tìm được, sinh lượt Up tin) chạy trong cùng lượt như bộ
>   cũ, bị ngắt thì mất phần chưa làm, không trùng. Bỏ bảng T4 `auto_engine_followups` và `aka_agent_engine_followup_v1` khỏi V556 (anh chốt).
> - **Kiểm như lúc kiểm Zalo (anh bảo "test trước rồi duyệt sau", 16–17/11):**
>   (a) **Phát lại lịch sử thật** `scripts/engine-v2-facebook/replay.cjs` (mẫu chỉ đọc 3 ngày 14–16/11 bằng `export-replay.cjs`, 114 chiến
>   dịch 12 loại, 1.081 lượt bộ cũ; dữ liệu khách chỉ ở scratchpad): bộ lập lịch Desktop thật chạy bằng engine, block trả lại đúng kết quả bộ
>   cũ đã ghi, nhánh / vòng lặp theo đúng lượt bộ cũ. **1.168 / 1.178 data / mốc so được khớp dòng lịch sử bộ cũ** (thao tác, trạng thái, tính lượt) và
>   trạng thái data; 11/12 loại khớp hết. 10 dòng còn lệch là một câu hỏi cho anh (dưới). 16 lượt bộ cũ thiếu bước trong `auto_run_steps`
>   (production mất dòng) không so được.
>   (b) **Bộ kịch bản sự cố** `scripts/engine-v2-facebook/scenarios.cjs`: đăng nhóm (kèm comment, chia sẻ) và trang cá nhân trên trang
>   Facebook giả ghi mọi cú gửi thật, tiêm lỗi trang (không thấy nút, script lỗi sau cú bấm, form không đóng, cửa sổ ẩn chết, chết tiến trình
>   ngay sau cú bấm rồi bộ chạy mới nhận lại), DB mất yêu cầu / mất câu trả lời; kiểm bất biến B1–B7 (không đăng / comment trùng, không gửi
>   khi chưa ghi dấu, data đã gửi không về hàng đợi, không còn lượt mở, không "thành công giả", mỗi mốc một bài). Lần chạy cuối 20 hạt giống:
>   1.033 cú gửi, 307 lỗi trang, 210 lỗi DB, 88 lần chết tiến trình: **0 vi phạm**. Bộ kịch bản Zalo chạy lại trên DB có V556–V559: 0 vi phạm mới.
>   **Lỗi engine tìm ra và đã sửa** (đều để y bộ cũ, Q8): engine coi "block chạy xong mà bộ dựng cũ không ghi dòng nào" là thành công và
>   tính lượt (Like khi comment seeding thêm dòng + tính lượt Like; comment tự bỏ qua khi bài chờ duyệt thành "Comment: thành công") → mã
>   mới **FB45** `err_engine_fb_no_history` (không ghi, không in, không tính, không cộng chuỗi); comment seeding không có bài hợp điều kiện
>   bị ghi "lỗi SYS07" và tạm dừng chiến dịch sau 4 lần → đóng data im lặng như bộ cũ (FB45); **FB06** không chuyển được sang Page trước data:
>   engine đánh data hoàn thành và tính lượt, bộ cũ giữ data và tạm dừng chiến dịch (`pauseBeforePageIdentityTarget`) → chính sách V559 như
>   bộ cũ; nhắn inbox Page: bộ cũ tự chạy lại một lần sau 4 lỗi liền (tạm dừng ở 8) → V559 thêm ngưỡng 8 cho SYS99 của thao tác này; lỗi
>   trước khi gửi ghi sai thao tác (khoá jsonb không giữ thứ tự: "Comment" thay cho "Đăng bài") → lấy thao tác chính theo thứ tự của loại;
>   newsfeed like cùng một bài ở hai vòng bị bỏ một dòng (khoá chống ghi trùng dùng nội dung output) → khoá theo `stepKey`.
>   **Anh chốt 17/11: giữ dòng "lỗi"** khi block không phải mốc gửi ném lỗi (gõ nội dung, tệp media không dùng được, Facebook không nhận
>   HTML đã dán…): bộ cũ không ghi dòng lịch sử, chỉ ghi câu lỗi vào ghi chú data và cộng chuỗi; engine ghi thêm dòng "lỗi" (SYS99 / FB44,
>   không tính lượt, cộng chuỗi) để khách thấy lỗi trong lịch sử. Đây là khác biệt có chủ ý duy nhất trong phát lại (10/1.178); `replay.cjs`
>   tách riêng khác biệt đã chốt và trả mã thoát 1 khi còn khác biệt chưa giải thích.
>   Kèm theo: tạm dừng giữa data trước mốc gửi đầu tiên mà data đã có dòng khác (tham gia nhóm) thì data về hàng đợi như bộ cũ (trước đó
>   bị đóng theo dòng đã có mà chưa đăng bài).
> - Còn ghi ở bảng duyệt: kết quả "đã gửi lời mời" (mời vào nhóm) DB không coi là đã giao nên dấu gửi thành `not_delivered`; data vẫn hoàn
>   thành.
> - **Duyệt bảng mã lỗi FB (17/11), phần hành vi đã chốt**, đều trùng bản nháp nên chính sách engine không đổi:
>   FB02 / FB03 (Facebook báo đăng nhóm / bình luận quá nhanh) như bộ cũ: tạm dừng chiến dịch ngay để khách giảm tốc độ rồi bấm Tiếp tục.
>   FB35 / FB41 / FB44 (không thấy ô viết bài trang cá nhân / ô bình luận / nút, ô khác trước khi gửi) như bộ cũ: ghi "lỗi", bỏ data, cộng
>   chuỗi, 4 lần liền thì tạm dừng. Nhóm mua bán (ô "Bạn đang bán gì?") và nhóm không có ô đăng bài ra FB40 từ V459 (04/11): bỏ qua, không
>   đếm gì (anh muốn đúng như vậy); 46 chiến dịch đăng nhóm đang dừng vì "Không tìm thấy ô đăng bài" đều dừng 02/10–04/11, trước V459.
>   FB12 / FB30 như bộ cũ (chưa có code nhận ra; khi viết code nhận ra thì duyệt lại). **FB04: V559 sửa luôn dòng của bộ cũ** (anh chốt:
>   khoá rồi khách phải tự mở lại): bỏ khoá 11 thao tác và bỏ tạm dừng tài khoản, giữ chiến dịch về chờ xử lý và đăng nhập → checkpoint;
>   bộ cũ không phát FB04 nên khách không thấy khác; bản gỡ trả lại. **Câu cho khách (Q23): anh duyệt từng câu 17/11** (44 mã, bảng duyệt
>   mục 1–2) theo bốn nguyên tắc anh chốt: bước tiếp theo chỉ hiện khi khách cần làm gì; chữ dễ hiểu với người bình thường; câu lỗi đã tự rõ thì
>   không cần bước tiếp theo; bước tiếp theo không đoán nguyên nhân (lỗi giao diện: "Mở tab trình duyệt của tài khoản để kiểm tra."). V559 ghi
>   câu vào `customer_title` / `customer_help` (bộ cũ không đọc) và chính sách engine dùng câu lỗi cho lịch sử, tiến trình, ghi chú data; ghi chú
>   chiến dịch khi mã làm dừng / chờ là "câu lỗi (mã). bước tiếp theo"; V558 nối bước tiếp theo của mã FB sau câu "Dừng sau N data lỗi liên tiếp"
>   (Zalo giữ câu cũ). Bộ cũ giữ câu cũ. Kiểm lại sau khi đưa câu vào (17/11 chiều): `policy-parity-smoke` 14/14 (2.574 cặp khớp bộ cũ, câu và
>   dòng FB04 đúng như anh chốt, gỡ trả lại), `sql-smoke` 34/34 (sửa mã chiến dịch trùng 96013/96014 giữa nhóm "kết thúc lượt" và hai nhóm
>   thêm 16/11 tối, lỗi chỉ lộ ban ngày), `desktop-fb-smoke` 20/20 (ghi chú dừng theo chuỗi đúng nguyên văn câu FB44 + bước tiếp theo), các bài
>   FB khác đạt; phát lại lịch sử thật 1.168 khớp, 10 khác đã chốt, 0 khác chưa giải thích; kịch bản sự cố FB 20 hạt giống (1.108 cú gửi, 248
>   lỗi trang, 211 lỗi DB, 89 lần chết tiến trình): 0 vi phạm; kịch bản Zalo trên DB có V556–V559: 708 lượt, 0 vi phạm mới.
> - **Q11 làm 17/11** (tìm ra lúc duyệt câu là engine chưa có; anh bảo "Làm luôn", chốt **chỉ SYS99**, FB44 giữ câu đã duyệt): `report_v1`
>   (V558) trả thêm `streak.lastErrorCode`; lõi chế độ workflow có `reviseCampaignNote` (gọi trước khi in câu dừng, hạn 60 giây, lỗi chỉ ghi vết;
>   lượt đang dừng thì không gọi); Desktop FB (`reviseFacebookEnginePauseNote`) khi chiến dịch vừa tạm dừng theo chuỗi mà mã lỗi cuối là SYS99
>   thì lấy ảnh lỗi engine của data đó (không có thì ảnh mới nhất của chiến dịch trong 30 phút), gọi AI `campaign_error_screenshot_diagnosis`
>   cùng tham số như bộ cũ, ghi lại ghi chú "Dừng sau N data lỗi/thất bại liên tiếp (ngưỡng N): <câu AI> (SYS99)" bằng CAS
>   (`reviseEnginePausedCampaignNote`: chỉ khi còn tạm dừng với đúng câu DB vừa ghi, updated_at tiến 1 ms từ giá trị DB); không có ảnh, AI
>   không trả câu hay lỗi thì giữ câu của DB. Kiểm: `desktop-fb-smoke` ca Q11 (AI viết lại câu, AI không trả câu thì giữ, FB44 không gọi AI);
>   phát lại / kịch bản dùng AI giả (`aiwrap` trong `desktop-harness.cjs`), không gọi mạng. Kiểm lại sau Q11: `desktop-fb-smoke` 21/21, các bài FB khác đạt, typecheck
>   Desktop / lõi / renderer sạch; phát lại lịch sử thật 1.168 khớp, 10 khác đã chốt, 0 chưa giải thích; kịch bản sự cố FB 20 hạt giống 0 vi phạm;
>   kịch bản Zalo 708 lượt 0 vi phạm mới; `campaign-outcome-engine-check-all` (Zalo) đạt.
> - **Thử thật trong Electron 17/11** (mục 9.5, phần chỉ Chromium thật kiểm được; `scripts/engine-v2-facebook/electron-real-smoke.cjs`, Electron 33
>   của repo, trang giả cục bộ, không chạm Facebook; code block 27 / 30 và XPath lấy từ ảnh chụp production 17/11): block 27 (mở hộp đăng bài)
>   và 30 (bấm Đăng) thật chạy đúng trên cửa sổ chạy ngầm cấu hình như `BackgroundPageManager`, vết ghi đúng tên phần tử, cú bấm Đăng được
>   nhận là đã gửi; trang "Bạn hiện không xem được nội dung này" ra FB40 rồi dấu hiệu đổi thành FB14 (chỉ đọc vùng chính, không đọc thanh bên);
>   chụp được ảnh cửa sổ ẩn. **Tìm ra:** huỷ cửa sổ KHÔNG làm `executeJavaScript` đang chờ kết thúc (vẫn treo sau 2 phút), chỉ `loadURL` đang
>   chờ báo ERR_FAILED, nên block treo (Q20) trước đó không thoát dù cửa sổ đã bị huỷ. Sửa: vết thao tác kết thúc mọi lời gọi đang chờ
>   (`PageTrace.abandonPending`) khi bộ chạy huỷ cửa sổ hoặc thấy cửa sổ đã đóng, bằng câu lỗi không thuộc nhóm "chắc chắn chưa gửi" (cú gửi
>   đang dở là không rõ kết quả, không gửi lại); `page-trace-smoke` 6/6. Bộ cũ không đổi.
>
> Nguồn: kế hoạch engine v2 (`~/.claude/plans/t-i-mu-n-t-ch-c-composed-wolf.md`, mục 4 quyết định 11, 5.4, 8.2, 10 giai đoạn 7),
> [thiết kế](CAMPAIGN_OUTCOME_ENGINE.md), [phủ Zalo](CAMPAIGN_OUTCOME_ENGINE_ZALO_COVERAGE.md),
> [chính sách theo hành vi](CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md), [bảng duyệt Zalo](CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md),
> [bộ kịch bản](CAMPAIGN_OUTCOME_ENGINE_SCENARIO_TEST.md); code `dev_3` `0ae0d6f2`; production akachat đọc chỉ đọc 16/11/2026
> 14:00–15:30 VN (từng câu một, phụ lục A).

## 0. Tóm tắt

- **Phạm vi.** 13 loại chiến dịch FB, 9.354 chiến dịch / 244 tổ chức chạy trong 30 ngày, ~730 nghìn dòng lịch sử, ~21 nghìn lượt
  chạy mỗi ngày (khoảng gấp đôi số lượt data Zalo mà engine đang chạy trên Desktop). Đăng nhóm 53%, hộp thư Page 17%, nhắn UID 10%,
  Up tin 7%, tham gia nhóm 5%.
- **Cách nối.** Giữ workflow trong DB (sửa block không cần phát hành app, như V472). Lõi thêm chế độ "workflow" (cùng kiểu chế độ lô của
  gửi chia sẻ); `workflowEngine` thêm hai hook có await trước / sau block; DB có danh mục block nào là mốc không đảo được. Mỗi mốc (đăng bài,
  từng comment, tin nhắn, kết bạn) có `stepKey`, dấu "sắp gửi" và `result_key` riêng.
- **Bắt lỗi tới từng thao tác nhỏ** (bấm, gõ, chờ phần tử…) cho 11/19 block gửi nhờ bọc `PageController`; 8 block làm thao tác trong
  `page.evaluate` thì tách cú bấm ra ở bản engine. Không cần bảng log mới (mục 3.6).
- **Bản riêng cho engine** (anh chốt Q7): chép hết workflow / block FB đang dùng (14 workflow, 84 block) sang bản "[engine] …", bỏ qua cái
  không còn dùng; bản cũ không nạp bản engine nên không bị ảnh hưởng. Đổi lại phải sửa block hai nơi khi hai bộ cùng chạy (mục 3.7).
- **Ảnh chụp khi lỗi, nếu chụp được** (không bắt buộc), lưu JPEG trên máy khách có giới hạn; anh lấy ảnh về bằng yêu cầu chẩn đoán, máy khách tải lên bucket riêng tư
  (mục 12). Hôm nay chỉ 9/245 node FB có chụp, ảnh nằm mãi trên máy khách và không lấy về được.
- **Được gì.** Đóng hai đường có thể gửi trùng của bộ cũ (dừng tài khoản giữa lượt, lô chia sẻ / mời nhóm); 48 chiến dịch FB đang dừng vì
  lỗi ghi DB thì sẽ tự chạy tiếp; lịch sử không mất khi crash; tạm dừng từ Web có hiệu lực trong ≤ 60 giây; mã ngắn FBxx trong tiến trình.
- **Seed V495 cho FB không khớp bộ cũ** ở ba điểm, không chỉ `actionResultRuntime.ts:151`. Lệch lớn nhất: FB35 / FB41 (bộ cũ ghi "lỗi" và
  dừng sau 4 lần, seed cho về hàng đợi mãi). Anh chốt Q3: duyệt bảng FB theo (mã, thao tác) trước lần bật đầu; seed mới sinh từ bảng đã
  chốt, hành vi bộ cũ là một cột đối chiếu sinh từ code.
- **41 mã FB nhưng chỉ 11 mã có code phát** (còn lại là danh mục từ V346). Phần còn lại phải thêm producer theo từng block (kiểu V472),
  làm trong đợt 3.
- **Hạn mức** cùng công thức với Zalo; engine còn thiếu trần gói FB (sản phẩm 3 / 10) và giới hạn số tài khoản FB chạy cùng lúc; giữa vòng
  comment bộ cũ không kiểm.
- **Bật riêng, chỉ theo tổ chức** (anh chốt Q1). 24/244 tổ chức dùng FB đang bật cờ Zalo nên không dùng chung cờ đó; danh sách tổ chức
  nằm trong thiết lập `engine.facebook` (anh chốt), claim kiểm lại để tắt khẩn cấp không cần đăng nhập lại. Không có công tắc theo loại: loại
  nào chạy bộ mới do bản Desktop quyết định, như Zalo.
- **Lộ trình.** Code xong hết đợt 0–3 trước, bảng duyệt FB để cuối (anh chốt 16/11 tối). Đợt 0 DB (không đổi hành vi) → đợt 1 Desktop (thiết lập tắt) → đợt 2 công cụ chép bản engine → đợt 3 làm cả 13 loại cùng
  lúc (anh chốt gộp, Q9), loại nào xong thì tổ chức thử chạy bằng bản cài nội bộ, phát hành Desktop một lần khi đủ 13 loại → mở cho khách
  theo lô như Zalo (Q19). 24 câu hỏi ở mục 11 (Q15–Q23 từ rà soát 16/11, mục 13), đã chốt Q1–Q24.

## 1. Phạm vi: khách dùng gì trong 30 ngày (đọc 16/11/2026)

### 1.1 Theo loại chiến dịch

Chiến dịch có `last_run_at` trong 30 ngày (kể cả đã xoá về sau). Lịch sử ước tính từ mẫu 240.000 dòng `auto_campaign_details`
(6 dải id liền 40.000 dòng rải đều 30 ngày, 2,9% tổng ~8,4 triệu dòng); lượt chạy đọc từ `auto_runs` 15/11 11:32 – 16/11 14:28 VN
(~27 giờ, 23.789 lượt FB). Số ước tính làm tròn, chỉ dùng để xếp thứ tự.

| Loại (`action_id`) | Workflow | Chiến dịch | Tổ chức | Tài khoản | Lịch sử 30 ngày (ước) | Lượt/27 giờ | Thời lượng lượt p50 / p99 / max | Mốc không đảo được trong workflow |
|---|---|---|---|---|---|---|---|---|
| `facebook_group_post` | 1 (56 node) | 4.532 | 205 | 603 | ~386 nghìn (53%) | 12.671 | 44 s / 341 s / 73 phút | đăng bài, chia sẻ nguyên bài, từng comment (vòng lặp), tham gia nhóm, rời nhóm |
| `facebook_page_to_message` | 227 (2 node) | 128 | 15 | 32 | ~124 nghìn (17%) | 4.875 | 33 s / 57 s / 3 phút | gửi tin hộp thư Page |
| `facebook_message_uid` | 208 | 160 | 33 | 93 | ~72 nghìn (10%) | 783 | 8 s / 58 s / 25 phút | nhắn tin, kết bạn |
| `facebook_comment_seeding_post` (gồm "Up tin") | 207 | 2.582 | 47 | 132 | ~48 nghìn (7%) | 1.030 | 27 s / 45 s / 71 s | từng comment + like (vòng lặp) |
| `facebook_join_group` | 284 | 341 | 42 | 147 | ~37 nghìn (5%) | 1.942 | 15 s / 205 s / 9 phút | tham gia nhóm |
| `facebook_comment_seeding` | 157 | 274 | 51 | 139 | ~27 nghìn (4%), trung bình 3,4 dòng/data, tới 40 | 2.193 | 149 s / 815 s / **6,3 giờ** | từng comment + like (vòng lặp) |
| `facebook_find_data_group` | 206 | 36 | 7 | 13 | ~14 nghìn | 6 | 55 s / 90 s | không (chỉ đọc, sinh data) |
| `facebook_newsfeed_interaction` | 238 | 205 | 24 | 91 | ~7 nghìn, **không có dòng data** | 14 | 25 phút / 2 giờ | like, comment (vòng `while`) |
| `facebook_message_friend` | 3 | 8 | 3 | 5 | ~5 nghìn | 96 | 17 s / 25 s | nhắn tin, kết bạn |
| `facebook_timeline_post` | 2 | 692 | 17 | 46 | ~4 nghìn, **không có dòng data** | 123 | 47 s / 107 s | đăng bài / reels / chia sẻ |
| `facebook_find_data_search` | 239 | 126 | 31 | 61 | ~4 nghìn | 12 | 97 s / 267 s | không (chỉ đọc) |
| `facebook_page_post` | 226 | 267 | 9 | 16 | ~0,5 nghìn | 44 | 25 s / 112 s | đăng Page (265/267 bằng Graph API, 2 bằng giao diện) |
| `facebook_group_invite` | 304 (1 node) | 3 | 2 | 3 | không có trong mẫu | 0 | | mời bạn vào nhóm (theo lô) |
| **Tổng** | | **9.354** | **244** | | **~730 nghìn (~24 nghìn/ngày)** | **~21 nghìn/ngày** | | |

So sánh: Zalo có 10.616 chiến dịch chạy trong 30 ngày; engine v2 hiện chạy ~9.400 lượt data/ngày trên Desktop và ~2.800 trên Fly
(`auto_engine_target_runs` 7 ngày). Đưa FB vào engine sẽ thêm khoảng 2 lần số lượt Desktop hiện có.

Loại không có dòng data (`timeline_post`, `newsfeed_interaction`: 0 dòng `auto_campaign_input_data` ở 45 chiến dịch chạy 3 ngày qua) chạy
theo lịch của chiến dịch, mỗi lần một lượt; lịch sử ghi `input_data_id` NULL. Engine hiện chỉ nhận được data (`auto_engine_target_runs.input_data_id NOT NULL`), xem mục 4.4.

### 1.2 Theo tính năng (chỉ đếm khi bật)

| Tính năng | Chiến dịch dùng (30 ngày) |
|---|---|
| Đăng nhóm: tự tham gia nhóm sau khi đăng (`autoJoinGroupAfterPost`) | 2.900 / 4.531 |
| Đăng nhóm: trộn thứ tự nhóm | 3.642 / 4.531 |
| Đăng nhóm: comment sau khi đăng (`enableComment`) | 1.529 (`own` 1.101, `others` 174, `all` 253); số comment (đăng nhóm + seeding): 1–4 ở 1.584 chiến dịch, 5–49 ở 183, 50–500.000 ở 35 |
| Đăng nhóm: nội dung định dạng | 1.525 |
| Đăng nhóm: chia sẻ vào nhóm đã tham gia (`enableGroupPostShareToJoinedGroups`) | 1.479 |
| Kiêm nghỉ/lướt FB (`facebookRestBrowse.enabled`) | đăng nhóm 1.385, comment seeding 89, nhắn UID 59 |
| Kiêm up tin (`enablePostBump`) | 1.060 đăng nhóm (sinh các chiến dịch `comment_seeding_post`) |
| Nhóm data làm nguồn | đăng nhóm 917, comment seeding 37, tham gia nhóm 19, nhắn UID 18 |
| Nội dung nâng cao | đăng nhóm 791, đăng trang cá nhân 564, Page 4 |
| Bỏ qua nhóm cần duyệt / rời nhóm khi bài chờ duyệt | 735 / 702 |
| Chống gửi lặp N ngày | đăng nhóm 428, hộp thư Page 18, nhắn UID 11, Page 8, nhắn bạn bè 4 |
| Đăng dưới danh tính Page (`runAsPage`) | đăng nhóm 231, comment seeding 29, tham gia nhóm 6, tìm data 6 |
| Ảnh comment | đăng nhóm 383, comment seeding 150 |
| AI viết lại mỗi lượt | đăng nhóm 134, newsfeed 32, comment seeding 20 |
| Copy nội dung từ bài nguồn | đăng nhóm 91, trang cá nhân 54 |
| Nhiều khung giờ trong ngày | trang cá nhân 97, Page 10 |
| Tài khoản phụ (`secondary_account_id`) | đăng nhóm 46, nhắn UID 4 |
| Chia sẻ nguyên bài vào nhóm (`groupPostShareFromPost`) | 19 |

### 1.3 Tổ chức đang bật cờ `use_new_zalo_runtime`

479 tổ chức đang bật cờ (đếm 16/11). Trong đó **24/244 tổ chức dùng FB** (30 nhân viên, 341 chiến dịch FB chạy 30 ngày: đăng nhóm 123,
hộp thư Page 100, comment seeding 32…). Nếu FB dùng chung cờ thì bản Desktop đầu tiên có FB sẽ chuyển ngay các chiến dịch này sang bộ mới,
không chọn được tổ chức thử (mục 8).

### 1.4 Vì sao đáng làm (lý do tạm dừng của chiến dịch FB đang dừng, chạy trong 30 ngày)

| Ghi chú chiến dịch | Chiến dịch | Engine v2 xử lý thế nào |
|---|---|---|
| "Facebook báo giới hạn tần suất bạn đăng bài" (FB02) | 202 | chính sách DB: khoá đúng thao tác có hạn, tự chạy lại, thay vì tạm dừng chờ khách |
| "Dừng sau N data lỗi/thất bại liên tiếp: Không tìm thấy ô đăng bài…" (FB35) hoặc "…: waitForSelector timeout…" | 42 + 7 + 7 | mã riêng theo trạng thái trang, data chưa đăng thì về hàng đợi; ngưỡng do DB quyết |
| "Lượt chạy gặp lỗi: output_invalid:…:write:TypeError: fetch failed" (DB/mạng lỗi lúc ghi kết quả) | 30 + 12 + 6 | nhật ký trên máy giữ kết quả, gửi bù, không tạm dừng (DB01) |
| "Không lấy được / không chuyển về được danh tính…" (chạy dưới danh tính Page) | 23 | mã FB06/FB07 theo chính sách, khôi phục danh tính đầu lượt sau (mục 7.6) |
| "Có lỗi xảy ra" (`err_undefined`) | 19 | phân loại theo luật, câu có mã ngắn |

## 2. Bộ chạy FB hôm nay (đọc code `dev_3` `0ae0d6f2`)

FB luôn chạy bộ cũ: `DesktopEngineRunner.support()` trả `runtime` cho mọi tài khoản không phải Zalo (`desktopEngineRunner.ts:106-108`).

| Phần | Bộ cũ | Engine v2 (đề xuất) |
|---|---|---|
| Giữ chỗ | Claim token (UUID của máy) ghi vào chiến dịch và `auto_accounts.runtime_operation_claim_token`; unit token mỗi data (lô tối đa 50); RPC ghi kết quả và lấy nội dung xoay vòng đòi cả hai token. 16/11: 122/123 chiến dịch FB "đang chạy" giữ claim token, 119 tài khoản FB giữ token thao tác | Lease có hạn 180 giây, heartbeat 60 giây |
| Một data (`campaignScheduler.ts:4281-5187`) | Kiểm tạm dừng, mốc ngày, chống gửi lặp, bỏ qua nhóm cần duyệt, khoá / hạn mức → trang ẩn + proxy → biến (`buildVariablesV2`) → unit token → `engineV2.run(persist)` → ghi mốc → áp chính sách → trạng thái data → settle → nghỉ | claim (cổng, hạn mức) → workflow với hook → mỗi mốc báo DB → chốt → nghỉ theo `pace` |
| Ghi kết quả | **Sau khi cả workflow chạy xong** (newsfeed ghi trong lúc chạy), qua `aka_agent_write_action_result_v1`. DB / mạng lỗi lúc ghi → `ResultContractError` → tạm dừng chiến dịch | Mỗi mốc báo ngay; nhật ký SQLite; DB lỗi thì chờ và gửi bù (DB01) |
| Data sau lượt | Thành công hay thất bại đều "hoàn thành" (lỗi vào ghi chú); `ok: false` của block = "thất bại"; ngoại lệ = "lỗi" + mã đoán theo câu (`:10091-10135`) | Theo chính sách DB, theo pha |
| Đếm data lỗi liền | `handleCampaignBadTarget`: ngưỡng `count_consecutive_errors`; với `err_undefined` câu lý do được thay bằng AI đọc ảnh chụp màn hình (`:10508`) | Chuỗi lỗi trong `report_v1`; host giữ AI đọc ảnh như bộ cũ (Q11) |
| Tạm dừng từ Desktop | Cờ trong RAM, chỉ ngắt workflow với newsfeed và lướt FB; còn lại chờ hết data | Dừng ở ranh giới mốc (Q2) |
| Tạm dừng từ Web / iOS (V476, đang bật cho tổ chức 1) | Chỉ thấy ở đầu data kế tiếp. Đổi trạng thái xoá claim token, mà RPC ghi kết quả đòi token đó: kết quả của data đang chạy có thể bị từ chối (`action_result_claim_invalid`) rồi đi đường dọn lỗi (đọc từ SQL, chưa thử thật) | Heartbeat thấy trong ≤ 60 giây, dừng ở ranh giới mốc, kết quả đã có vẫn ghi |
| Đăng xuất / checkpoint | AutoCheck 30 giây trên **tab hiển thị** (cookie `c_user`, `#checkpoint_title`, URL có "checkpoint", `accountPoller.ts:19-46`) đổi trạng thái đăng nhập; guard 5 giây ngắt workflow; chính sách `err_logout` | Heartbeat thấy trạng thái đăng nhập; host đọc URL trang ẩn khi block lỗi (mục 5.2) |
| Hạn mức | Kiểm trước claim và trước mỗi data (`:3532`, `:4459`). **Không kiểm giữa workflow**: vòng comment chạy hết, vượt rồi mới chặn data sau | Claim kiểm; mốc lặp kiểm khi ghi dấu (mục 6.3) |
| Thoát app | `stop()` ngắt workflow → data "hoàn thành" "Lỗi không xác định" và **tính là data lỗi**; rồi `runScopedRecovery('quit')` đóng data còn "đang chạy" "Dừng đột ngột…" | RUN01 / SYS01 / SYS02, không tính là data lỗi |
| Crash, máy ngủ | Dọn ở lần đăng nhập / đăng xuất sau; không gửi lại, nhưng **lịch sử các mốc đã làm có thể mất** (ghi sau workflow) | Lease hết hạn, `close_stale` đóng data; mốc đã báo không mất |

**Đường có thể gửi trùng ở bộ cũ** (đọc code, chưa tái hiện):
1. **Tài khoản bị dừng giữa lượt** (guard 5 giây, ngoại lệ của bộ chạy): data về "chờ xử lý" trừ khi đã có kết quả `committed`
   (`:4806-4811`, `:5028-5039`). Với FB chỉ kết bạn thành công và chia sẻ nguyên bài mới đánh dấu `committed`; tin nhắn lỗi ghi "lỗi"
   `not_committed`, comment lỗi không ghi dòng nào. Nếu cú bấm đã xảy ra rồi mới lỗi, data quay lại hàng đợi và có thể gửi lần hai.
2. **Lô chia sẻ vào nhóm đã tham gia / mời vào nhóm** trả mọi dòng chưa báo về hàng đợi (`requeueRemainingOnSettle`, `:4604`, `:5515`); dựa vào
   việc block liệt kê đủ những gì đã làm.
3. **Lặp theo thiết kế**: nhiều khung giờ (trang cá nhân, Page), chạy lại sau khi hoàn thành, Up tin thêm lượt mà không kiểm URL bài
   (`:14256`). Ngoài phạm vi; chống gửi lặp N ngày (cổng `delivery_cooldown` của engine) chặn được khi khách bật.

Engine đóng (1) và (2): mỗi mốc có dấu "sắp gửi" ghi trước cú bấm; data chỉ về hàng đợi khi không có dấu nào chưa giải quyết. Với (2),
engine chỉ nhận vào lượt các nhóm block đã chọn, ngay trước cú bấm Đăng, và ghi dấu từng nhóm; nhóm không được chọn không bị giữ chỗ.

**Tính năng bộ cũ mà cổng FB phải giữ** (đặc tả từng phần ở đợt tương ứng): mở hộp thư Page một lần mỗi lượt và tự mở lại một lần khi lỗi
(`:10479-10526`); mời vào nhóm theo lô ≤ 50 (`:5212-5637`); chia sẻ vào nhóm đã tham gia (`min(3, lượt còn - 1)`, `:7783-7880`); sinh lượt
Up tin sau khi đăng nhóm thành công (`:11128`, `:14235-14398`); nghỉ / lướt FB khi chạm hạn mức giờ (`:4463`, `:9858-9940`); xoay link nguồn
(lưu `sourceLinkIndex` trước lượt); nội dung xoay vòng (kiểu cũ theo vị trí data; kiểu mới `campaignContentPreparationVersion = 1` qua RPC
đòi token cũ, cần bản theo lease `aka_agent_engine_take_content_index_v1` đã có ở V495); kiểm media CFG14 / CFG15 (`:10676`, `:10679`,
`:10726`); "comment tất cả" dựng sẵn mảng vị trí (`:10635-10755`, số comment không có trần); bỏ qua nhóm cần duyệt; chạy dưới danh tính
Page (`facebookCampaignPageIdentity.ts`, khôi phục tối đa 45 giây); tìm data chạy lại (`:2711`); Nhóm data; nhiều khung giờ.
Hàng đợi ngẫu nhiên theo tài khoản (`facebookRandomRunEnabled`, `:1924-2066`): 0 tài khoản FB đang bật (16/11), để bộ cũ.

## 3. Nối engine với workflow v2

### 3.1 Ràng buộc đọc từ code

- **Bước FB nằm trong DB và sửa được không cần phát hành app.** 13 workflow, 82 block (`auto_workflows`, `auto_blocks`; cộng workflow nghỉ /
  lướt FB `fb_campaign_rest_browse` là 14 workflow, 84 block); app đọc block
  từ DB mỗi lượt (`workflowEngine.loadBlocks` → `getBlock`), nên V472 sửa block 2616 có hiệu lực ngay cho mọi bản. Code block chỉ có ở
  DB (repo chỉ có bản chép rời trong 124 migration).
- **Chỉ chạy trên Desktop**, trong một `BrowserWindow` ẩn mỗi tài khoản (`backgroundPageManager.getOrCreate`, dùng chung phân vùng
  `persist:account_<id>` với tab hiển thị). Đóng tab hiển thị không dừng lượt đang chạy.
- **Bộ chạy workflow** (`src/main/v2/runtime/workflowEngine.ts`): chạy theo cụm node sẵn sàng (`Promise.all`), `if_else`, `merge`
  (`any` vẫn chờ mọi nhánh cha), `loop` (`forEach` / `count` / `while` tối đa 1.000 vòng). Huỷ chỉ có hiệu lực giữa hai cụm hoặc hai vòng;
  **block đang chạy không ngắt được** (`executeJavaScript`, `PageController` không nhận tín hiệu huỷ). Hạn giờ mỗi block 5 phút chỉ phủ
  phần đồng bộ của `vm`; cả lượt không có hạn giờ.
- **Không có hook chờ được trước / sau block.** `onStepProgress` đồng bộ, không await, và nếu ném lỗi thì `run()` hỏng, dòng `auto_runs`
  kẹt `running`. Hook await duy nhất là chụp ảnh sau block.
- **Cú bấm không đảo được nằm giữa block**, không phải ở đầu hay cuối: `fb_click_post_button` bấm rồi chờ form đóng 60 giây (180 giây nếu
  có video); `fb_send_message` mở hộp chat, gõ, bấm gửi; `fb_comment_current_post` gõ rồi nhấn Enter; `fb_open_composer` có thể trả
  `actionResult` "chưa đăng" trước khi bấm gì.
- **Bộ cũ đã có hợp đồng kết quả gần với engine.** Block trả `actionResult` / `actionResults` gồm `actionCode`, `statusCode`, `errorCode`,
  `operationState` (`not_committed` / `committed` / `unknown`); DB ghi qua `aka_agent_write_action_result_v1` với `result_key`
  `["action-result-v1", <unitKey>, <inputDataId>, <actionCode>, <mốc>]` và `policy_snapshot.settlement` (mẫu 16/11: 2.072/2.072 dòng FB có
  `result_key` và `operationState`). Nhưng bộ cũ chỉ ghi **sau khi cả workflow chạy xong** (trừ newsfeed), không có nhật ký, và lỗi ghi DB
  thành `ResultContractError` → tạm dừng chiến dịch (48 chiến dịch đang dừng vì "output_invalid:…:write:TypeError: fetch failed").

### 3.2 Ba cách nối

| Cách | Làm gì | Kết luận |
|---|---|---|
| A. Tách bước FB vào lõi TypeScript như Zalo | Viết lại 13 workflow thành bước của lõi | **Bỏ.** Mất khả năng sửa block bằng DB (cách đang dùng mỗi khi Facebook đổi giao diện); FB chỉ chạy Desktop nên không có lợi "một lõi cho hai nơi chạy" |
| B. Cả workflow là một bước gửi | Ghi một dấu "sắp gửi" trước khi chạy cả workflow | **Bỏ.** Lỗi trước cú bấm (không mở được ô đăng bài FB35/FB40: ~4,6% lịch sử FB trong mẫu) thành "không rõ kết quả" nên đóng data thay vì về hàng đợi; không tách được đăng bài và từng comment; không chặn được hạn mức giữa vòng comment |
| **C. Chế độ workflow trong lõi + hook trong `workflowEngine` + điểm cam kết trong block** | Lõi giữ nhận data, lease, nhật ký, chỉ thị; workflow vẫn chạy từ DB; mỗi mốc không đảo được ghi dấu và báo kết quả riêng | **Đề xuất** |

### 3.3 Cách C

**Lõi (`packages/campaign-engine`).** Thêm chế độ `workflow` cho `runUnit`, cùng kiểu chế độ `batch` của gửi dạng chia sẻ:

```text
claim_target ─▶ workflow.runTarget(api) ─────────────────────────────────────────▶ chốt data (lô rỗng final) hoặc SYS07
                  │ api.beginMilestone(stepKey, actionCode) = mark_sending      (không ghi được dấu → không bấm)
                  │ api.reportMilestone(stepKey, actionCode, raw) = report, trả quyết định của DB
                  │ api.shouldStop() / api.signal / api.progress
```

- Giữ nguyên mọi bất biến của `runUnit`: heartbeat, nhật ký trước rồi gửi, mất lease thì dừng ngay, dừng mềm, nghỉ theo `pace`, không có
  kết quả nào thì SYS07.
- `reportMilestone` trả quyết định; DB nói data xong (`remaining_steps = skip`) hoặc dừng lượt thì host dừng workflow ở ranh giới kế tiếp.
- Không dùng `withDeadline` cắt ngang lượt workflow: block không ngắt được, cắt ngang thì lõi nhả lease trong khi block còn bấm trên trang.
  Thay bằng hạn giờ cấp data (mặc định theo loại, ví dụ newsfeed theo `newsfeedTimeMinutes`) và chờ block đang chạy xong rồi mới chốt.

**`workflowEngine` (code app).** Thêm hai hook có await, bọc `try/catch` để lỗi của host không làm hỏng `run()`:
- `beforeNode({ nodeId, blockName, loopPath, vars })` → `run` / `skip` / `stop`, chạy trước khi block bắt đầu (sau khi lấy block,
  `workflowEngine.ts:297`).
- `afterNode({ nodeId, blockName, loopPath, result })`, chạy sau khi block có kết quả (`:345-355`).
- Không có host thì hai hook không làm gì, bộ cũ và trình sửa workflow chạy như hôm nay.

**Danh mục bước FB trong DB.** Bảng mới (đề xuất `auto_engine_block_steps`), mỗi dòng một block (ghi đè được theo workflow + node): `action_code`
(hoặc lấy từ cấu hình node, như `composerActionCode` của `fb_click_post_button` dùng chung cho đăng nhóm và trang cá nhân), loại
(`delivery` / `idempotent` / `result` / `read`), cách cam kết (`helper` / `block_start`), **cú bấm gửi** của block (thao tác + phần tử, ví dụ
`click fb_post_button`, `press Enter`; vết thao tác ở mục 3.6 dựa vào đây), cách đọc kết quả (`action_result` / bảng ánh xạ của bộ cũ). Cùng
danh mục có **bảng chọn workflow cho engine theo loại chiến dịch**, trỏ tới bản "[engine] …" của từng loại (Q7, mục 3.7). Sửa được bằng SQL, bản Desktop cũ không đọc. Không ghi vào cấu hình node của workflow: bản cũ chưa có khoá
mới trong `RUNTIME_NODE_CONFIG_KEYS` sẽ chuyển khoá đó vào đầu vào của block. Bảng 3.5 là bản seed đề xuất.

**Ghi dấu "sắp gửi" đúng chỗ, ba mức:**

| Mức | Chỗ ghi dấu | Lỗi xảy ra sau dấu | Áp cho | Cần |
|---|---|---|---|---|
| 1. Đầu block | `beforeNode` của block `delivery` | thành "không rõ kết quả" (đóng data, không gửi lại), trừ khi block trả `operationState: not_committed` | block chưa thuộc hai mức dưới | chỉ code app |
| 2. Đầu block + vết thao tác | `beforeNode`; vết thao tác (mục 3.6) cho biết cú bấm gửi đã chạy chưa | cú bấm gửi chưa chạy (hoặc "Element not found") thì chắc chắn chưa gửi; đã chạy rồi lỗi mới là "không rõ kết quả" | 11 block bấm qua `PageController` | chỉ code app, **không sửa block** |
| 3. Điểm cam kết trong block | block gọi `await helpers.commitPoint?.({ actionCode })` ngay trước cú bấm | chỉ lỗi thật sự sau cú bấm mới thành "không rõ kết quả" | 8 block làm cú bấm trong `page.evaluate` | bản block riêng cho engine (mục 3.7); hoặc sửa tại chỗ theo đúng luật 3.7 |

- Mức 3 an toàn với bản cũ cả khi sửa tại chỗ: helper chỉ có khi engine chạy; bản cũ không có helper nên `?.` bỏ qua, block chạy y như hôm
  nay. Engine mất lease khi ghi dấu thì helper ném lỗi huỷ, block dừng trước cú bấm.
- Danh mục ghi mỗi block đang ở mức nào; block mới chưa khai thì mặc định mức 1 (an toàn: không bao giờ bấm khi chưa có dấu).

**Pha của kết quả:**

| Tình huống | Pha | Hệ quả mặc định |
|---|---|---|
| Lỗi trước khi ghi dấu (mở trang, tìm ô nhập, AI viết lại, chuyển danh tính) | `before_send` | data được về hàng đợi theo chính sách |
| Đã ghi dấu, block trả `actionResult.operationState = not_committed` | `before_send` (dấu được giải quyết là "chưa giao") | như trên |
| Đã ghi dấu, block trả `committed` hoặc kết quả thành công | `after_send` | ghi lịch sử, tính lượt theo chính sách |
| Đã ghi dấu, block trả `unknown`, ném lỗi, hết giờ, cửa sổ ẩn chết | `in_flight` | đóng data, không gửi lại |
| Block `delivery` trả output kiểu cũ (không có `actionResult`) | theo bảng ánh xạ của `logMilestonesV2` (mục 2) | như bộ cũ |

### 3.4 Thứ tự chạy một data

```text
claim (lease, cổng, hạn mức)
 └▶ chuẩn bị lượt: khôi phục danh tính nếu lượt trước bị ngắt khi đang dùng Page (mục 7.6)
     └▶ workflowEngine.run(workflow cho engine, vars, page, { beforeNode, afterNode, runtimeHelpers.commitPoint })
          ├ mọi thao tác nhỏ qua PageController: ghi vết trong RAM; thao tác lỗi thì chụp ảnh tạm (mục 3.6, 12.2)
          ├ block thường: chạy như cũ
          ├ block delivery: mark_sending(stepKey) ─▶ block (commitPoint ở mức 3) ─▶ report(stepKey, bước lỗi, mã ảnh) ─▶ chỉ thị
          ├ block lỗi: lưu ảnh (JPEG, trên máy), gửi bước lỗi + mã ảnh kèm kết quả
          └ dừng từ ngoài / DB chỉ thị dừng: beforeNode trả stop trước mốc kế tiếp
 └▶ chốt data (final) ─▶ nghỉ theo pace (kèm "nghỉ / lướt FB" nếu bật) ─▶ claim data kế
```

### 3.5 Mốc không đảo được theo block (bản seed đề xuất của danh mục)

Đọc từ `auto_workflows` / `auto_blocks` production 16/11 (`AR` = block đã trả `actionResult`).

| Block (id) | Workflow | `action_code` | Loại | Cú bấm trong block | Ghi chú |
|---|---|---|---|---|---|
| `fb_open_composer` (27) AR | 1, 2 | `fb_post_group` / `fb_post_my_profile` | result | bấm mở hộp đăng bài (đảo được) | trả FB35 / FB40 khi không mở được, `not_committed` |
| `fb_click_post_button` (30) | 1, 2 | theo `composerActionCode` | delivery | `page.click(fb_post_button)` rồi chờ form đóng 60/180 s | lỗi sau bấm ("Form đăng bài chưa đóng…") là `in_flight` → FB30 |
| `fb_submit_native_group_share` (2836) AR | 1 | `fb_post_group` | delivery | bấm chia sẻ | |
| `fb_comment_at_position` (34) | 1, 157 | `fb_comment` | delivery, trong vòng lặp | bấm ô comment, gõ, gửi | phát hiện giới hạn tần suất comment (FB03) trước khi gõ |
| `fb_click_like` (2074) | 157 | `fb_like_post` | delivery, trong vòng lặp | bấm thích | bấm lại là bỏ thích: tuyệt đối không làm lại |
| `fb_comment_current_post` (2616) AR | 207 | `fb_comment` | delivery, trong vòng lặp | Enter | V472: FB15–FB18, FB41 |
| `fb_click_like_current_post` (2615) | 207 | `fb_like_post` | delivery | bấm thích | như trên |
| `fb_join_group` (2793), `fb_join_group_if_not_member` (33) | 284, 1 | `fb_join_group` | idempotent | bấm tham gia | làm lại vô hại; với 33 (tự tham gia sau khi đăng) chưa xác minh bộ cũ có ghi mốc |
| `fb_leave_group_if_pending` (32) | 1 | (không có) | idempotent | bấm rời nhóm | không tính lượt |
| `fb_post_reels` (37), `fb_share_post` (36) | 2 | `fb_post_my_profile` | delivery | bấm đăng / chia sẻ | |
| `fb_send_message` (38) | 3, 208 | `fb_message_friend` / `fb_message_stranger` | delivery | bấm gửi | phát hiện FB01 trước khi gõ |
| `fb_add_friend` (39) | 3, 208 | `fb_add_friend` | delivery | bấm kết bạn | FB22 |
| `fb_page_post_api` (2669) | 226 | `fb_post_page` | delivery | gọi Graph API | 265/267 chiến dịch Page dùng API |
| `fb_post_current_identity_ui` (2672) | 226 | `fb_post_page` | delivery | bấm đăng | 2 chiến dịch |
| `fb_send_page_inbox_message` (2679) | 227 | `fb_message_page_inbox_customer` | delivery | bấm gửi | FB23–FB26, FB37 |
| `fb_newsfeed_like_post` (2705), `fb_newsfeed_comment_submit` (2710) | 238 | `fb_like_post`, `fb_comment` | delivery, vòng `while` | | lượt không có data |
| `fb_group_invite` (2819) | 304 | `fb_group_invite` | delivery theo lô (`actionResults`) | | 3 chiến dịch |
| `fb_switch_identity_by_name` (2671) | 1, 157, 206, 207, 226, 239, 284 | (không có) | trạng thái phiên | đổi danh tính Page | phải khôi phục (mục 7.6) |
| block tìm data (2599–2605, 2638–2639, 2714–2724), `fb_scrape_post`, `fb_collect_suggested_friends` | 206, 239, 1, 2, 208 | (không có) | read | | sinh data, không gửi |

### 3.6 Bắt lỗi theo từng thao tác nhỏ

- Mọi thao tác nhỏ đi qua `PageController` (bấm, gõ, dán, nhấn phím, chờ phần tử, tải tệp, gọi Graph API) đều chạy ở tiến trình chính và đã
  ném lỗi riêng: "Element not found", "waitForSelector timeout", "Cannot find editable element for typing", "Facebook không nhận nội dung
  HTML đã paste", "apiCall failed"… (`pageController.ts:223-1150`).
- Engine bọc `PageController` để ghi **vết thao tác** trong RAM của lượt: thao tác, phần tử (tên trong `auto_elements` lấy qua
  `helpers.element`, không phải XPath), thời lượng, lỗi, URL trang.
- Block lỗi thì tín hiệu gửi DB là thao tác nhỏ cuối cùng bị lỗi và phần tử của nó, ví dụ `{ kind: 'block', code: 'wait:fb_post_button' }`.
  Luật DB theo (thao tác, phần tử) đổi ra mã: không thấy nút đăng → FB36, dán nội dung định dạng bị từ chối → FB33 (hai mã này hôm nay chưa
  có code phát). Thêm luật bằng SQL, không cần phát hành app.
- Vết còn cho biết cú bấm gửi (khai trong danh mục, ví dụ `click fb_post_button`) đã thật sự chạy chưa: chưa chạy, hoặc chạy mà báo "Element
  not found", thì chắc chắn chưa gửi (`before_send`, data về hàng đợi được) dù dấu đã ghi ở đầu block.
- **Giới hạn**: 8/19 block gửi làm thao tác bên trong `page.evaluate` (JS chạy thẳng trong trang: `.click()`, `dispatchEvent`, `execCommand`),
  app chỉ thấy một lần `evaluate`: like (2074, 2615, 2705), tham gia nhóm (2793), đăng Page bằng giao diện (2672), hộp thư Page (2679, 17% lịch
  sử FB), mời vào nhóm (2819), chia sẻ nguyên bài (2836). Muốn chi tiết thì block phải tự báo bước (mục 3.7). 11 block còn lại bấm qua
  `PageController`. Đếm theo code block đọc từ DB 16/11, chưa chạy thử.
- **Không cần bảng log mới**: không ghi DB từng thao tác (~21 nghìn lượt/ngày × hàng chục thao tác). Chỉ khi lỗi mới gửi toàn bộ vết thao tác của
  block lỗi (anh chốt Q15; trần 200 thao tác / 64 KB), vào `auto_engine_outcomes.signal` (giữ 30 ngày theo V517); `auto_campaign_details.data` chỉ thêm một dòng tóm tắt (ví dụ
  `bấm fb_post_button`). Dòng thời gian dùng `auto_engine_target_events` (loại `note` có sẵn); mẫu lỗi chưa có luật vào `auto_outcome_unmatched`.
- **Chính sách vẫn quyết theo mốc**: một thao tác nhỏ lỗi không tự tính lượt, không tự đổi data. Nó chỉ quyết mã lỗi, pha (chưa gửi / không
  rõ kết quả), câu cho khách, dòng thời gian và ảnh (mục 12). Thao tác thử phần tử có hay không (`waitForSelector` / `page.$` trong `try`, block
  chạy tiếp) không phải lỗi, trừ khi chính block đó kết thúc lỗi.
- Câu cho khách nêu đúng bước: "❌ Không tìm thấy nút đăng (FB36)" thay cho ghi chú có XPath như hôm nay ("Dừng sau … waitForSelector timeout:
  //div…", 14 chiến dịch FB đang dừng với câu kiểu này).

### 3.7 Sửa block / workflow mà không ảnh hưởng khách bản cũ

Mọi bản app đọc block và workflow từ DB mỗi lượt, nên sửa tại chỗ (UPDATE) là áp ngay cho bản cũ (V472 như vậy). Sửa tại chỗ phải giữ:
- `actionResult.statusCode` là trạng thái bản cũ đã có và có chính sách cho thao tác đó; sai thì bản cũ báo `ResultContractError` và **tạm dừng
  chiến dịch** (`campaignScheduler.ts:3943`, `actionStatusPolicy.ts:123-148`). Trường thêm đặt trong `actionResult.data`: parser của bản cũ không
  chặn trường lạ (`actionResultSession.ts:61-73`).
- Helper mới gọi kiểu `helpers.commitPoint?.()` (tiền lệ trong block: `typeof helpers.callAIUsing !== 'function'`).
- Không thêm khoá vào cấu hình node: bản cũ đẩy khoá lạ vào đầu vào của block (`workflowEngine.ts:751`). Không thêm node vào workflow dùng chung.
- Chỉ DML, preflight md5 thân block đang chạy, kèm bản gỡ, chạy bộ kiểm danh mục của bản cũ.

| | Sửa tại chỗ | Block / workflow mới, chỉ engine dùng |
|---|---|---|
| Ảnh hưởng bản cũ | có, sai là tạm dừng chiến dịch | không, bản cũ không nạp |
| Khi Facebook đổi giao diện | sửa 1 chỗ | sửa code block 2 chỗ; XPath vẫn 1 chỗ (`auto_elements` dùng chung) |
| Đổi cấu trúc (tách block, đưa cú bấm ra khỏi `evaluate`) | không nên | làm thoải mái |
| Thử trên tổ chức nội bộ trước | không tách được | tách được |
| Quay lại | chạy bản gỡ | trỏ lại workflow cũ |

**Đã chốt (Q7, 16/11): chép hết block / workflow FB đang dùng sang bản riêng cho engine, bỏ qua cái không còn dùng.** Em đã đề xuất kết
hợp (chỉ chép block cần đổi) để đỡ sửa hai nơi; anh chọn chép hết để bản cũ và bản engine tách hẳn nhau.

Bộ chép (đọc production 16/11, phụ lục A mục 25):

| Chép | Không chép |
|---|---|
| 13 workflow của 13 loại FB (`auto_campaign_actions.workflow_id`; cả 13 loại có chiến dịch chạy trong 30 ngày, ít nhất 3 chiến dịch) | 13 workflow test (`test_workflow_id`): 0 nhân viên bật chế độ test (`org_staff.use_test_workflow`); nhân viên bật thì chạy bộ cũ |
| `fb_campaign_rest_browse` (nghỉ / lướt FB giữa các data) | 7 workflow quét data và `fb_web_enrichment` (làm giàu lịch sử Web): không phải chiến dịch, engine không chạy; 16 block chỉ chúng dùng |
| 84 block các workflow trên dùng (72 nhóm `facebook`, 12 điều khiển / data / tiện ích / điều hướng) | `fb_collect_posts_in_feed` và 20 block khác không nằm trong workflow nào |
| | `auto_elements`: XPath dùng chung, Facebook đổi giao diện thì phần lớn chỉ sửa một chỗ; bản engine cần XPath khác thì thêm phần tử tên mới |

- Bản engine đặt tên "[engine] …" để trình sửa workflow của admin không nhầm; engine chọn workflow qua danh mục, không đụng
  `auto_campaign_actions.workflow_id` (bản cũ đọc). Bản cũ không nạp bản engine nên sửa bản engine không ảnh hưởng khách bản cũ.
- Chép một lần cho cả 13 loại khi bắt đầu đợt 3 (anh chốt gộp đợt, Q9), không chép sớm hơn, để khoảng thời gian phải sửa hai nơi ngắn nhất.
- Giữ hai bản khớp nhau: danh mục ghi từng cặp (block cũ ↔ bản engine) kèm md5 lúc chép; một script / view liệt kê cặp có bên này sửa sau
  lần chép mà bên kia chưa theo, chạy sau mỗi lần sửa block. Danh mục cũng ghi md5 bản engine lúc duyệt; bản engine bị sửa mà danh mục chưa
  cập nhật thì engine lùi về ghi dấu ngay đầu block (an toàn nhất: không gửi trùng, có thể mất mốc chưa gửi) và báo.
- Bản engine đổi cấu trúc thoải mái: 8 block bấm trong `page.evaluate` tách cú bấm ra để bắt lỗi từng thao tác (mục 3.6), block trả
  `actionResult` theo mã mới mà không lo bộ kiểm hợp đồng của bản cũ.
- Cái giá: sửa block hai nơi suốt thời gian hai bộ cùng chạy, không có hạn chót (bật theo tổ chức, app không ép cập nhật); 10/84 block được
  sửa trong 30 ngày qua. Bỏ hẳn bộ cũ FB rồi thì trỏ `workflow_id` sang bản engine và xoá bản cũ.

## 4. Nhiều mốc trên một data

### 4.1 Khoá của mốc

- `stepKey = <nodeId>` cho block ngoài vòng lặp; trong vòng lặp thêm chỉ số vòng: `comment#0`, `comment#1`…; vòng lồng nhau `#<i>.<j>`;
  block trả `actionResults` nhiều phần tử thêm `:<k>` (mời vào nhóm theo lô, chia sẻ vào nhiều nhóm).
- `result_key = v2:<target_run_id>:<stepKey>` như Zalo (tối đa 200 ký tự; `nodeId` FB dài nhất ~32 ký tự). Không dùng bộ đếm nguồn kết quả
  trong RAM của `workflowEngine` (`__akaActionResultSource`, `:887-927`), vì nó đếm theo tiến trình.
- Khoá ổn định trong một lượt data là đủ: lượt bị ngắt không chạy lại workflow (data được đóng SYS01/SYS02 hoặc về hàng đợi nếu chưa có
  kết quả nào), nên không có trường hợp cùng mốc mang hai chỉ số vòng khác nhau.

### 4.2 Dấu "sắp gửi" và hạn mức theo mốc

- `auto_engine_target_runs.marks` đã là mảng theo `stepKey` (V495), mỗi comment một dấu. `mark_sending_v1` giữ chỗ hạn mức ngày cho đúng
  thao tác của mốc, `report_v1` hoàn lại nếu chính sách không tính lượt. Không cần đổi cấu trúc.
- Thiếu: `mark_sending_v1` **không kiểm hạn mức**, chỉ cộng. Claim cho phép `fb_comment` khi còn 2 lượt mà vòng lặp có 5 comment thì cả 5
  đều được ghi dấu. Xem mục 6.3.

### 4.3 Khi nào data xong

- Mỗi `reportMilestone` là một lần `report_v1` không `final`. DB đóng data khi chính sách nói bỏ các bước còn lại (`remaining_steps = skip`)
  hoặc dừng lượt; host dừng workflow trước mốc kế tiếp.
- Workflow chạy hết mà DB chưa đóng: lõi chốt bằng lô rỗng `final`. Chưa có kết quả nào: SYS07 (`err_engine_no_outcome`), không bao giờ
  "thành công giả".
- Nhánh không đi qua mốc gửi nào vẫn phải ra một kết quả: bỏ qua nhóm cần duyệt (`fb_skip_group_post_for_known_approval`), không mở được
  hộp đăng bài (`fb_open_composer` trả `actionResult`), lỗi trước khi tới mốc. Danh mục 3.5 ghi các block "result" này.
- Bất biến của engine giữ nguyên: đăng bài đã `committed` mà comment sau đó lỗi thì data không bao giờ về hàng đợi (`no_requeue_after_delivery`).
  Bộ cũ còn một luật riêng cho FB: comment lỗi sau khi data đã có kết quả `committed` không cộng chuỗi data lỗi
  (`actionResultRuntime.ts:160-161`); seed phải giữ luật này (mục 5.3).

### 4.4 Loại chiến dịch không có dòng data

`facebook_timeline_post` (692 chiến dịch) và `facebook_newsfeed_interaction` (205) chạy theo lịch, mỗi lần một lượt, lịch sử ghi
`input_data_id` NULL (bộ cũ ghi `result_key` với data `0`). Engine nhận lượt theo data (`auto_engine_target_runs.input_data_id NOT NULL`,
chỉ mục duy nhất theo data). Hai cách:
- **Giữ bộ cũ cho hai loại này ở các đợt đầu** (~1,5% lịch sử FB, tối đa 41 tổ chức).
- **Lượt theo lịch**: cho `auto_engine_target_runs` một khoá lượt theo chiến dịch + mốc lịch thay cho data (đổi bảng của engine, không đụng
  bảng cũ), claim kiểu `campaign_slot`, `finish_campaign` tính lịch kế tiếp (nhiều khung giờ: 97 chiến dịch trang cá nhân). Newsfeed còn phải
  dừng theo `newsfeedTimeMinutes` (lượt 25 phút tới 2 giờ).

**Đã chốt (Q4, 16/11): làm sớm, không để tới đợt cuối.**

- Đợt 0 (DB): `auto_engine_target_runs` thêm khoá lượt theo lịch (chiến dịch + mốc lịch), `input_data_id` bỏ NOT NULL, mỗi lượt có đúng một
  trong hai (ràng buộc thêm `NOT VALID` rồi `VALIDATE` riêng); chỉ mục duy nhất theo (chiến dịch, mốc lịch) dựng `CONCURRENTLY`. Claim kiểu
  `campaign_slot` nhận lượt khi tới lịch, mỗi mốc lịch một lần; `finish_campaign` tính lịch kế tiếp như bộ cũ.
- Bảng này Zalo đang dùng. Lệnh ALTER để giao dịch riêng chỉ vài mili giây, apply ngoài giờ cao điểm (bài học V495: ALTER chung giao dịch
  dài giữ khoá tới hết giao dịch, app quá giờ và deadlock). Mọi hàm engine đọc `input_data_id` (claim, report, `close_stale`, dọn 30 ngày
  của V517) phải xử lý lượt không có data; chạy lại bộ kiểm và bộ kịch bản Zalo để chắc Zalo không đổi.
- Đợt 1 (Desktop): bộ chạy nhận lượt theo lịch; newsfeed dừng theo `newsfeedTimeMinutes` ở ranh giới mốc (Q2).
- Trang cá nhân (một mốc: đăng bài / reels / chia sẻ) và newsfeed (like / comment trong vòng `while`) làm trong đợt 3 cùng các loại khác.

### 4.5 Tìm data trong group / bằng search

**Đã chốt (Q5, 16/11): đưa vào engine**, làm trong đợt 3 cùng các loại khác. Hai loại này không gửi gì lên Facebook nhưng **không chỉ đọc**: mỗi lượt ghi một
dòng lịch sử "Tìm data" (danh sách tìm được nằm trong `data`) rồi đẩy data mới đi nhiều nơi (`campaignScheduler.ts:11820-12090`):
- chiến dịch khác trong hệ thống: UID, link bài, link group FB, SĐT, link group Zalo (`createCampaignInputDataBatch` rồi mở lại chiến dịch
  nhận, `:12559` trở đi);
- nhóm data: `ingestDataGroup` kiểu `scan`, mã lượt nạp ghép từ chiến dịch, data, lượt, nhóm, phần và băm nội dung (`:12960-12978`);
- akaBiz Desktop: ghi thẳng vào SQLite của app akaBiz Desktop trên cùng máy (`akaBizDesktopSqliteClient.ts:183`).

Bộ cũ ghi lịch sử trước rồi mới đẩy, và lọc "data mới" bằng cách đọc lại lịch sử các lượt trước. App tắt giữa hai bước thì lượt sau coi
data đó là đã tìm thấy và không đẩy nữa: mất, nhưng không trùng. Engine (anh chốt 16/11 khuya):
- Dòng "Tìm data" ghi **không gắn thao tác như bộ cũ** (anh: "cái tìm data này đâu phải là hành động thực hiện fb gì đâu"): claim không có
  thao tác nào để kiểm (bộ cũ không kiểm hạn mức); V558 `report_v1` nhận kết quả không mã thao tác của chiến dịch Facebook khi có tên ghi
  lịch sử (`action_code` trống, `action_name` "Tìm data", không tính lượt, không ghi dấu, luật phân loại theo nền tảng của loại chiến dịch).
  Lỗi có mã và ảnh như các loại khác; dòng "lỗi" không mã đi luật `status:*` → FB42, cộng chuỗi như `err_undefined` của bộ cũ.
- **Đẩy data đi như bộ cũ** (anh chọn "Như bộ cũ" cho việc đẩy nốt): code đẩy của bộ cũ chạy ngay sau dòng "Tìm data" trong cùng lượt, còn
  giữ lease; app tắt giữa hai bước thì mất phần chưa đẩy, không trùng. Không có dấu "đã đẩy", không có RPC đẩy mới.
- "Chạy lại sau N giờ khi xong" (`findDataRerunEnabled`, `:2711-2735`) dùng chung cho tìm data, comment seeding và newsfeed, nên làm một
  lần ở bước kết thúc lượt của engine (`finish_campaign`) từ đợt 0. 6 chiến dịch tìm data chạy dưới danh tính Page cần khôi phục như mục 7.6.
- Chiến dịch nhận data không phụ thuộc bộ chạy của chiến dịch tìm data.

## 5. Tín hiệu lỗi và seed

### 5.1 Ai đang phát mã FB hôm nay

41 dòng `auto_error` FB (FB01–FB41, `error_type = 'external facebook'`). Phần lớn được thêm ở V346 dưới dạng danh mục, **chưa có code
nào phát** ("new policies active, no runtime mappings added"). Đọc code block (DB) và code app 16/11:

| Có code phát | Mã | Nơi phát |
|---|---|---|
| có | FB01 `err_limit_waiting_message` | block `fb_send_message` (38) ném lỗi có `code`; bộ cũ còn đoán mã theo câu lỗi (`campaignScheduler.ts:10091-10135`) |
| có | FB02 `err_group_post_frequency_limit`, FB03 `err_comment_frequency_limit` | block ném câu "giới hạn tần suất…", bộ cũ đoán mã theo câu (`:10091-10135`); `auto_error.error_element` có XPath |
| có | FB22 `err_fb_add_friend_unavailable` | block `fb_add_friend` (39) |
| có | FB15–FB18, FB41 | block `fb_comment_current_post` (2616, V472) |
| có | FB35, FB40 | block `fb_open_composer` (27) |
| có | SYS99 `err_undefined` | mọi ngoại lệ khác (catch-all của bộ cũ) |
| **chưa** | FB04 (checkpoint), FB05–FB14, FB19–FB21, FB23–FB34, FB36–FB39 | danh mục sẵn, chưa block / code nào trả |

Mã gặp trong mẫu lịch sử FB 30 ngày (20.828 dòng): `err_fb_composer_editor_not_found` 522, `err_fb_group_composer_editor_not_found` 440,
`err_fb_add_friend_unavailable` 265, `err_undefined` 186, `err_group_post_frequency_limit` 105, `err_fb_comment_unavailable_post_not_found` 79,
`err_fb_comment_box_not_found` 32, `err_fb_comment_unavailable_post_pending` 12. Còn lại là "thất bại" / "lỗi" **không mã** (comment 265,
đăng nhóm 57, nhắn tin 23…): block trả kiểu cũ `{ ok: false, error }` hoặc ném lỗi.

### 5.2 Tín hiệu FB gửi lên engine

Engine đã có loại tín hiệu `block` (V495) nhưng FB chỉ có **một** luật phân loại: bắt-tất-cả `engine *` → `err_undefined`.

| Nguồn | Tín hiệu | Luật |
|---|---|---|
| Block trả `actionResult` có `errorCode` | `{ kind: 'block', code: errorCode, errorCode }` | bước 0 của phân loại (mã đang bật dùng luôn) |
| Vết thao tác: thao tác nhỏ cuối cùng bị lỗi khi block kết thúc lỗi (mục 3.6) | `{ kind: 'block', code: '<thao tác>:<phần tử>', message }` kèm toàn bộ vết thao tác của block (trần 200 thao tác / 64 KB, Q15) và mã ảnh nếu có | luật FB theo (thao tác, phần tử), ví dụ `wait:fb_post_button` → FB36; thêm bằng SQL |
| Block trả `actionResult` thất bại không mã | `{ kind: 'block', code: 'status:<statusCode>' }` | luật FB theo thao tác → mã mới "Thao tác Facebook thất bại" (như Z999) |
| Block trả kiểu cũ `{ ok: false, error }` | `{ kind: 'message_like', message }` | luật FB theo câu, còn lại về mã "thất bại" chung |
| Block ném lỗi trước điểm cam kết (`waitForSelector timeout: <xpath>`…) | `{ kind: 'exception', message }`, pha `before_send` | luật theo câu → mã giao diện chưa sẵn sàng (nhóm `ui_changed`, về hàng đợi); không khớp thì SYS99 như hôm nay |
| Block ném lỗi sau điểm cam kết | pha `in_flight` | UNK01 (không rõ kết quả, không gửi lại) hoặc mã riêng của thao tác (FB30 đăng bài chưa xác nhận) |
| Host thấy trang checkpoint / đăng nhập (URL `/checkpoint`, `/login`, `two_step_verification`…; `facebookLoginService.ts:442`) | `{ kind: 'engine', code: 'fb_checkpoint' / 'fb_logged_out' }` | FB04 / mã mới đăng xuất (nhóm `auth`) |
| Host thấy câu chặn trên trang (XPath `auto_error.error_element` của FB01–FB03, "Bạn tạm thời bị chặn") | `{ kind: 'engine', code: 'error_element', errorCode }` | mã tương ứng |
| Cửa sổ ẩn chết (`render-process-gone`), trang bị đóng | `{ kind: 'engine', code: 'browser_gone' }` | SYS04 `err_runtime_browser` (đã có, nhóm `transient`) |
| Proxy lỗi / mất mạng / AI không dùng được | `errno` / `engine` | NET02 / NET01 / SYS06 (đã có, `system`) |

Trạng thái trang cần nhận ra thêm (có mã sẵn nhưng chưa producer): nhóm chỉ admin đăng (FB13), chưa là thành viên (FB11), chờ duyệt
tham gia (FB12), nhóm không khả dụng (FB14), không nhắn được cho người nhận (FB19), Messenger đòi PIN (FB20), bị hạn chế nhắn tin (FB21),
hộp thư Page (FB23–FB26, FB37), tham gia nhóm (FB27–FB29), bài bị từ chối / trùng (FB31, FB32), nội dung định dạng bị từ chối (FB33), tải
media chưa xong / form đổi (FB34, FB38), không thấy nút đăng (FB36), mời vào nhóm (FB39), danh tính Page (FB06, FB07), Graph API (FB08–FB10).
Phương án ban đầu: mỗi trạng thái là một sửa ở bản "[engine]" của block (trả `actionResult` như V472), làm trong đợt 3. **Đợt 3 chưa làm phần này** (chép nguyên block, giữ y bộ cũ). **Anh chốt 17/11:** làm ngay; bắt lỗi theo dấu hiệu có mặt (nút / hộp thoại / chữ của đúng lỗi), không suy ra lỗi từ việc "không thấy"; mã mới chỉ đổi câu cho khách, tính lượt / chuỗi lỗi / dừng chiến dịch giữ như cách đang xử lý trường hợp đó hôm nay; FB40 / FB22 (bỏ qua data khi không thấy ô đăng bài / nút kết bạn) giữ như bộ cũ.

Xem trang Facebook thật 17/11 (tài khoản thử của anh, 4 nhóm thử anh cho, chỉ đăng 2 bài thử): nhóm / trang không tồn tại hiện tiêu đề "Bạn hiện không xem được nội dung này"; nhóm công khai chưa tham gia có nút "Tham gia nhóm" nhưng vẫn mở đủ hộp "Tạo bài viết" có nút Đăng (chưa vào nhóm chỉ lộ ra sau cú bấm Đăng); nhóm mua bán có nút "Bán gì đó", mở ra hộp "Tạo bài niêm yết mới" / "Chọn loại bài niêm yết"; quản trị viên đăng vào nhóm "cần duyệt bài" thì bài lên ngay; cùng một nội dung đăng liền vào hai nhóm không bị báo trùng; trang cá nhân đã gửi lời mời kết bạn có nút "Hủy lời mời <tên>". Tài khoản thử là quản trị viên 3/4 nhóm thử nên chưa thấy chờ duyệt bài, chỉ quản trị viên được đăng, câu hỏi khi tham gia.

**Đã làm 17/11 ("phần chắc", anh chọn):** cơ chế dấu hiệu `src/main/engineAdapters/facebook/errorSigns.ts` (câu lỗi do chính block viết: chứa; chữ trên trang lúc block lỗi: tiêu đề / hộp thoại / nút, bằng đúng chữ; đọc trang ≤ 2 giây ngay sau block lỗi hoặc trả mã lỗi, chỉ khi có dấu hiệu dùng được) + dòng thiết lập `facebook.error_signs` (V559, sửa chữ bằng SQL). Bốn mã có chỗ phát: FB23, FB24 (câu block inbox Page "không tìm thấy (đúng) khách hàng trong inbox page"), FB38 (câu block `fb_drop_post_images` "không có ô chọn ảnh", chỉ trước khi gửi), FB14 (trang hiện "Bạn hiện không xem được nội dung này" khi đăng nhóm ra FB40). Chính sách của 4 mã = bản chép chính sách của FB42 / FB44 / FB40 (mã đang xử lý trường hợp đó hôm nay), chỉ đổi câu; bài kiểm so 528 cặp (mã, thao tác, pha, trạng thái) khớp. Chưa làm: 23 mã còn lại cần chữ thật trên trang ở đúng tình huống (tài khoản thử đang là quản trị viên các nhóm thử) hoặc chỉ có câu block đoán nguyên nhân (FB08, FB26, FB33, FB34 bỏ theo nguyên tắc); FB29, FB30, FB39 lỗi ở pha đang gửi (mốc mức 1) nên hôm nay ra SYS99, chưa gắn.

Mã mới đề xuất (`error_type = 'engine v2'` để bộ cũ bỏ qua): FB42 "Thao tác Facebook thất bại" (bắt-tất-cả sau khi gửi, như Z999), FB43
"Phiên Facebook đã đăng xuất" (`auth`), FB44 "Giao diện Facebook chưa sẵn sàng" (`ui_changed`, trước khi gửi). Số mã chọn lúc làm.

### 5.3 Seed giữ đúng hành vi bộ cũ

Seed V495 dựng chính sách FB "theo mã" bằng luật của Zalo. Bộ cũ của FB tính khác ở **ba** chỗ (đọc `actionResultRuntime.ts:139-185`,
`src/shared/actionStatusPolicy.ts:157-200`, V495 `:2017-2066`):

1. **Trạng thái lịch sử lấy từ block, không từ `auto_error.detail_status`.** Bộ cũ ghi trạng thái theo `statusCode` của `actionResult`
   (chỉ `detail_mode = 'override'` mới đổi). Seed V495 coi `detail_status` trống là "không ghi lịch sử, về hàng đợi" (luật của Zalo).
2. **Cột đếm của `auto_error` chỉ áp khi `detail_mode` khác NULL hoặc thao tác là `fb_add_friend`** (`:151`); còn lại đếm theo chính sách
   của trạng thái (`auto_account_action_status_policies`, ví dụ "thất bại" = tính lượt + tăng chuỗi). Seed V495 luôn đếm theo mã.
3. **Comment lỗi sau khi data đã có kết quả `committed` không cộng chuỗi data lỗi** (`:160-161`). Engine chưa có luật tương đương.

Hệ quả theo nhóm mã:

| Nhóm | Mã | Bộ cũ | Seed V495 | Lệch |
|---|---|---|---|---|
| `inherit`, `detail_status` trống | FB35 `err_fb_composer_editor_not_found`, FB41 `err_fb_comment_box_not_found` | ghi "lỗi" (trạng thái block), không tính lượt, **tăng chuỗi** (4 liền → tạm dừng; 46 chiến dịch đăng nhóm còn dừng như vậy đều dừng 02/10–04/11: từ V459 đăng nhóm ra FB40 "bỏ qua", FB35 chỉ còn ở trang cá nhân), data hoàn thành | không ghi lịch sử, về hàng đợi, không chuỗi | **lớn**: chiến dịch không bao giờ tự dừng, data bị thử lại mãi; mẫu ~554 dòng (≈19 nghìn / 30 ngày) |
| `inherit`, có `detail_status` | FB15–FB18 | trạng thái block (khớp `detail_status`), không lượt, không chuỗi | như vậy | khớp nếu block trả đúng trạng thái |
| `override` | FB40 | "bỏ qua", không lượt, không chuỗi, hoàn thành | như vậy | khớp |
| `fb_add_friend` | FB22 | theo cột `auto_error` | như vậy | khớp |
| `detail_mode` trống, có `detail_status`, thao tác khác `fb_add_friend` | FB11–FB14, FB19, FB23–FB26, FB28, FB30–FB32 | đếm theo trạng thái ("thất bại": tính lượt + tăng chuỗi) | theo cột `auto_error` (phần lớn không tính lượt, không chuỗi) | lệch, nhưng **chưa có producer** nên hôm nay không khách nào gặp |
| `detail_mode` trống, `detail_status` trống | FB01–FB10, FB20, FB21, FB27, FB29, FB33, FB34, FB36–FB39 | có producer (FB01–FB03): ghi dòng lịch sử theo trạng thái block (mẫu: FB02 ghi "lỗi" 105 dòng) rồi áp tạm dừng / khoá | không ghi lịch sử, áp tạm dừng / khoá / về hàng đợi | lệch ở dòng lịch sử và chuỗi lỗi |

**Đã chốt (Q3, 16/11): duyệt bảng FB trước lần bật đầu**, không bật với hành vi bộ cũ rồi mới duyệt.

- Script (như `build-v500-sql.cjs`) đọc đúng code bộ cũ để dựng cột "bộ cũ hôm nay" cho mọi cặp **(mã, thao tác)** FB, kiểm bằng chính
  `ActionStatusCatalog.resolve` + luật `:151` / `:160`. Cùng bảng có cột seed V495, đề xuất, câu cho khách, câu "bước tiếp theo" khi dừng
  (Q23) và anh chốt, như
  [bảng duyệt Zalo](CAMPAIGN_OUTCOME_ENGINE_ZALO_FULL_REVIEW.md). Tệp đề xuất: `docs/CAMPAIGN_OUTCOME_ENGINE_FACEBOOK_FULL_REVIEW.md`.
- Ví dụ dòng cần anh chốt: FB35 / FB41 nên về hàng đợi (như seed V495) hay ghi "lỗi" và dừng chiến dịch sau 4 lần (như bộ cũ).
- Mỗi dòng có thêm cột "áp cả cho bộ cũ?". Mặc định **không**, như Zalo (V500 chỉ đổi chính sách của engine). Chọn có thì sửa luôn
  `auto_error` như V472, và mọi Desktop đang chạy bộ cũ đổi hành vi ngay khi apply.
- Seed chính sách FB của đợt 0 viết trước bằng bản nháp giữ đúng hành vi bộ cũ (sinh từ code bộ cũ), đủ để kiểm thử cục bộ; anh duyệt bảng
  xong thì sửa file migration chính sách theo bảng trước khi apply. Engine thêm cách ghi "trạng thái do block trả" cho chính sách FB
  (tương đương `inherit`).
- Bảng đầy đủ (mọi cặp đã có hoặc sắp có code phát mã, gồm mã mới của đợt 3 như FB42–FB44) duyệt một lần ở cuối, sau khi code xong cả 13
  loại (anh chốt 16/11 tối), trước khi apply migration chính sách và bật tổ chức thử.
- Phát lại dữ liệu thật vẫn so với bộ cũ: mọi chỗ khác nhau phải nằm trong các dòng anh đã duyệt đổi.

V472 là tiền lệ cho dòng "áp cả cho bộ cũ": thêm `detail_mode = 'inherit'` cho 74–77 chính vì bộ cũ bỏ cột đếm của mã FB. Trạng thái của
một mã nằm ở cả `auto_error` (bộ cũ) lẫn `auto_outcome_policies` (engine), và `aka_agent_engine_policy_lint` (V514) báo khi trạng thái lịch sử
hai bên lệch; dòng nào chỉ đổi engine thì bảng duyệt ghi rõ là lệch có chủ ý.

### 5.4 Tiến trình cho khách

- Giữ nguyên câu FB của bộ cũ (`logMilestonesV2`, `campaignScheduler.ts:11729-12557`): "📝 Đăng bài thành công vào "<nhóm>"", "⏳ Group cần
  duyệt bài" / "✅ Group không cần duyệt bài", "🔗 Link bài post: …", câu comment, kết bạn, nhắn tin. Cổng FB dựng `customerLog` cho từng mốc
  từ đầu ra block; lõi in theo thứ tự mốc → metadata → link như quy ước log của repo.
- Dòng lỗi lấy `log_template` của chính sách hoặc tên ngắn của mã, thêm mã công khai ở cuối: "❌ Không tìm thấy ô đăng bài trong nhóm Facebook
  (FB40)". Câu chờ / tạm dừng / dừng theo chuỗi lỗi do lõi in như Zalo. XPath, `waitForSelector timeout`, mã nội bộ `err_*` không lộ ra.
- Đặc tả từng loại liệt kê đủ câu cho khách nguyên văn trước khi code, như `docs/engine-v2-specs/` của Zalo.

## 6. Hạn mức

### 6.1 Công thức: giống Zalo, thiếu trần gói FB

- Bộ cũ dùng chung `getAccountRateLimitStatus` (`campaignRepository.ts:6536-6650`) cho FB và Zalo: hạn mức ngày đọc
  `auto_account_action_status.count_action_in_day`; khung giờ đếm `auto_campaign_details` theo `(account_id, action_code)` có
  `counts_toward_limit`; cấu hình chiến dịch (`actionLimits.byActionCode`) → nhóm tài khoản → trần gói; mặc định 30 / ngày, 9 lượt / 65 phút.
- Trần gói của FB lấy theo sản phẩm: `facebookCore` (sản phẩm 3) cho mọi thao tác FB, `facebookFanpage` (sản phẩm 10) cho `fb_post_page` và
  `fb_message_page_inbox_customer` (`entitlementRepository.ts:67-70`, `:300-311`): gói demo không đặt số thì 30, gói trả phí không đặt số thì
  không giới hạn, có nhiều gói thì lấy số lớn nhất.
- `aka_agent_engine_action_limit` (V495) đã đúng công thức chung nhưng **chỉ có trần gói Zalo** (sản phẩm 16 / 18). Đợt 0 thêm nhánh FB
  (sản phẩm 3, và 10 cho hai thao tác Page) cùng luật demo / trả phí.

### 6.2 Thao tác kiểm theo loại chiến dịch (`src/shared/campaignActionDescriptors.ts:193-296`; DB `limitCheckActionCodes` thay được danh sách)

| Loại | Thao tác kiểm |
|---|---|
| Đăng nhóm | `fb_post_group`, thêm `fb_comment` / `fb_like_post` khi bật (không áp cho chia sẻ nguyên bài) |
| Trang cá nhân | `fb_post_my_profile`, thêm như trên |
| Page | `fb_post_page` |
| Nhắn bạn bè | `fb_message_friend` |
| Hộp thư Page | `fb_message_page_inbox_customer` |
| Nhắn UID | `fb_message_stranger` (trừ khi tắt nhắn tin), thêm `fb_add_friend` khi bật |
| Comment seeding, Up tin | `fb_comment`, thêm like khi bật |
| Tham gia nhóm / mời vào nhóm | `fb_join_group` / `fb_group_invite` |
| Tìm data | không kiểm |

"Tiếp tục khi chạm giới hạn" của bộ cũ (`:9097-9191`) là `requireAny` + `skippableGates` của claim (đã có); câu "⚠️ Bỏ qua <thao tác> vì đã
đạt giới hạn: …" lõi đã in đúng như Desktop.

### 6.3 Hạn mức giữa vòng lặp

Bộ cũ không kiểm: vòng comment chạy hết (35 chiến dịch đăng nhóm / seeding đặt 50–500.000 comment), lượt vượt được đếm sau đó và chỉ chặn
data kế tiếp. Engine `mark_sending_v1` cũng không kiểm. Hai cách (Q10):
- **Giữ như bộ cũ** (vượt trong một data, chặn từ data sau).
- **Kiểm khi ghi dấu** (`mark_sending` bản mới nhận thêm cờ kiểm hạn mức cho mốc lặp): hết lượt thì trả `quota_reached` kèm giờ mở, host bỏ
  các vòng còn lại của **thao tác đó** (comment), không bỏ data; in một dòng "⚠️ Bỏ qua Comment vì đã đạt giới hạn…" như bộ cũ.

**Đã chốt (Q10, 16/11): giữ như bộ cũ** (không kiểm hạn mức giữa vòng comment), và **giới hạn số comment cài đặt ở giao diện tối đa 20**.
Chỉ Desktop có ô này (Web / iOS chưa tạo / sửa được chiến dịch FB, V476): ô "Số comment tối đa" của form tạo / sửa và form Agent hôm nay chỉ
có `min={1}` (`CampaignFormModal.tsx:13220-13253`), AI điền form cũng phải theo trần này (`campaignFacebookAi.ts:70`). Đo 16/11 (chiến dịch
chưa xoá, chạy trong 30 ngày): 29/710 chiến dịch đăng nhóm / trang cá nhân bật comment đặt hơn 20 (28 trong khoảng 21–50, 1 trong 51–1.000);
comment seeding: 9/132 chiến dịch đặt "Số bài cần comment trên mỗi group/page/profile" hơn 20 (tối đa 1.000). **Trần 20 áp cả cho ô "Số bài
cần comment trên mỗi group/page/profile" của comment seeding** (anh chốt 16/11). **Chiến dịch cũ đang đặt hơn 20 chỉ chạy tối đa 20** (anh
chốt 16/11): bản Desktop mới cắt về trần lúc chạy và form mở ra hiện số trần; máy bản cũ vẫn chạy số cũ tới khi cập nhật app.

**Con số 20 sửa được ở DB** (anh yêu cầu 16/11): một dòng `auto_system_settings` (đề xuất `facebook.max_comments`, chưa có dòng hoặc sai thì
dùng 20). Desktop đọc chung câu đọc cài đặt lúc đăng nhập (`getDesktopPollingSettings`, `desktopUiRepository.ts:33-38`, không thêm request),
dùng cho trần của form, AI điền form và lúc chạy; đổi số có hiệu lực khi nhân viên đăng nhập lại.

### 6.4 Số tài khoản FB chạy cùng lúc

Bộ cũ giới hạn số tài khoản FB chạy đồng thời của nhân viên (cài đặt `facebookMax`, `src/shared/browserRunLimits.ts`, đếm trong claim của bộ
cũ từ V340 / V397). Claim của engine chỉ kiểm giới hạn Zalo trình duyệt (`org_staff.max_running_zalo_web_accounts`, V532 `:773-790`); đợt 0
thêm giới hạn FB theo cùng cách (`concurrency_limit`).

### 6.5 Nghỉ giữa hai data

- "Nghỉ giữa 2 lần" của nhóm tài khoản rồi tới chiến dịch, sau mỗi data đã chạy (`:9373`, `:5166-5186`), như Zalo; lõi dùng `pace` của DB
  (nghỉ đủ mặc định).
- Nghỉ / lướt FB (1.533 chiến dịch bật) chạy khi chạm hạn mức giờ: cổng FB cài như một "việc trong lúc chờ" của host (lõi chờ `wait`,
  host lướt trong thời gian đó, có thể huỷ), không phải bước của data.

## 7. Phục hồi và điều khiển

### 7.1 Lượt dài

- Lease 180 giây, heartbeat 60 giây chạy song song với workflow, nên lượt 6 giờ (comment seeding) hay 2 giờ (newsfeed) không mất lease.
- Không cắt ngang workflow bằng hạn giờ của bước (block không ngắt được). Hạn giờ cấp data đặt theo loại (newsfeed theo `newsfeedTimeMinutes`
  cộng dư). Hết hạn: host dừng ở ranh giới kế tiếp, chờ block đang chạy xong rồi mới chốt và nhả lease.
- Bộ cũ không có hạn giờ cấp data; lượt treo hôm nay giữ claim token tới khi khách đăng xuất / thoát app.

### 7.2 Tạm dừng, xoá chiến dịch, dừng tài khoản giữa data

- Nguồn: nút Desktop (cờ trong RAM, đã có `shouldStopAfterTarget`), Web / iOS (DB "tạm dừng", heartbeat thấy trong ≤ 60 giây), xoá chiến
  dịch, tài khoản tạm dừng / đăng xuất (heartbeat), DB chỉ thị dừng (`report_v1`).
- **Đã chốt (Q2, 16/11): dừng ở ranh giới mốc**: `beforeNode` trả `stop` trước block gửi kế tiếp; lõi báo RUN01 cho mốc chưa chạy. DB chốt: data đã
  có mốc gửi → "hoàn thành" kèm ghi chú (ví dụ đã comment 3/10), các mốc còn lại của data đó không chạy tiếp; chưa có → về hàng đợi. Zalo chờ
  hết data vì một data Zalo chỉ vài giây; data FB có thể dài hàng giờ.
- Bỏ được lỗi Web / iOS ở bộ cũ (kết quả bị từ chối vì claim token bị xoá), vì engine không dùng token đó.
- Web / iOS (V476) nhận biết chiến dịch đang chạy qua trạng thái "đang chạy" và token của bộ cũ (`runtimeBusy`). Chiến dịch chạy bằng engine
  không có token cũ, nên theo SQL của V476 `runtimeBusy` sẽ tắt dù chiến dịch "đang chạy" (chưa kiểm WebApp có đọc lease của engine không;
  Zalo Desktop chạy engine cũng đi qua cùng hàm). Xoá chiến dịch vẫn bị chặn vì trạng thái "đang chạy". Kiểm lại ở WebApp khi làm đợt 1.

### 7.3 Đăng xuất, checkpoint

- Checkpoint là một trạng thái đăng nhập (`checkpoint`), như "chưa đăng nhập". AutoCheck của bộ cũ kiểm 30 giây/lần cho tài khoản đang mở
  tab trong app và đổi trạng thái **cả hai chiều** (`accountPoller.ts:50-80`): tài khoản bật đăng nhập tự động thì hỏi thẳng Facebook,
  thấy chuyển hướng tới `/checkpoint/` là checkpoint (`facebookSessionRequest.ts:26`); tài khoản thường thì chỉ xem cookie `c_user`
  (`accountPoller.ts:31-34`), nút "Kiểm tra đăng nhập" cũng vậy (`accountHandlers.ts:705-711`, cố ý giữ cách cũ). Heartbeat đọc trạng thái
  → dừng ở ranh giới mốc.
- Đọc 16/11: 1.638 tài khoản FB chưa xoá, 13 đang `checkpoint` (8 tài khoản thường, 5 trong 11 tài khoản bật đăng nhập tự động); 3 tài
  khoản đổi trong 7 ngày qua.
- **Đã chốt (Q6, 16/11): coi checkpoint đúng như trạng thái đăng nhập.** Host đọc URL trang ẩn khi block lỗi
  hoặc không thấy phần tử: trang checkpoint → FB04, trang đăng nhập → mã đăng xuất mới. FB04 đổi trạng thái tài khoản sang `checkpoint`;
  data chưa gửi mốc nào thì về hàng đợi, đã gửi thì chốt như Q2; chiến dịch chờ. Không khoá thao tác, không tạm dừng tài khoản; claim chỉ
  nhận tài khoản "đã đăng nhập" như bộ cũ, nên hết checkpoint thì trạng thái tự về và chiến dịch chạy tiếp. Chính sách FB04 đang có trong DB
  (khoá **mọi** thao tác FB không thời hạn, tạm dừng tài khoản; chưa từng có code phát) đổi theo, qua bảng duyệt (Q3).
- **Cần sửa kèm ở bản Desktop:** tài khoản thường còn cookie `c_user` thì AutoCheck báo "đã đăng nhập" kể cả khi đang checkpoint. FB04 vừa
  đặt `checkpoint` thì ≤ 30 giây sau AutoCheck nâng lại, app chạy vào tài khoản đang bị checkpoint lần nữa, cứ thế lặp. Sửa: tài khoản đang
  `checkpoint` chỉ được nâng về "đã đăng nhập" khi kiểm thấy hết checkpoint thật (hỏi thẳng Facebook như tài khoản bật đăng nhập tự động,
  vài phút một lần), không theo cookie. Code hiện cố ý giữ cách kiểm cũ cho tài khoản thường, nên phần này thử kỹ ở đợt 1. AutoCheck dùng
  chung cho cả bộ cũ, nên bản vá đổi luôn hành vi của bộ cũ ở đúng chỗ này (tài khoản `checkpoint` không còn được nâng lại theo cookie).
- Tài khoản bật đăng nhập tự động (`facebookLoginService`) có thể tự đăng nhập lại; engine không can thiệp, lượt sau claim lại khi trạng
  thái "đã đăng nhập".

### 7.4 Thoát app, crash, máy ngủ, cửa sổ ẩn chết

- Thoát app / đăng xuất: dừng ở ranh giới; block đang chạy được chờ tới hạn ngắn rồi bỏ; mốc chưa chạy báo RUN01 (không tính data lỗi, khác bộ
  cũ đang tính "Lỗi không xác định" là data lỗi).
- Crash / máy ngủ quá lease: `close_stale` đóng data: còn dấu "sắp gửi" chưa giải quyết → SYS02 (không gửi lại); không có kết quả nào →
  `requeue_unstarted` trả về hàng đợi (V515); có kết quả rồi → SYS01. Các mốc đã báo không mất.
- Cửa sổ ẩn chết (`render-process-gone`) → SYS04 (`err_runtime_browser`, `transient`); sau dấu thì `in_flight`.
- Đóng tab hiển thị không dừng lượt (như bộ cũ); lượt sau không bắt đầu khi tab chưa mở, host kiểm trước claim như `tick` của bộ cũ
  (`:1799-1804`).

### 7.5 DB / mạng của mình lỗi

Nhật ký SQLite (`desktopEngineJournal.ts`) giữ kết quả, gửi bù đúng một lần theo `result_key`; tiến trình "Mất kết nối máy chủ, đang chờ để
chạy tiếp (DB01)"; không tạm dừng chiến dịch. Hôm nay 48 chiến dịch FB đang dừng vì lỗi này.

### 7.6 Danh tính Page bị bỏ dở

Đăng nhóm, comment seeding, tham gia nhóm, tìm data, Page có thể đổi sang danh tính Page rồi đổi lại cuối workflow. Lượt bị ngắt giữa chừng để
tài khoản ở danh tính Page; lượt sau (bất kỳ chiến dịch nào của tài khoản) sẽ chạy dưới danh tính sai. Đề xuất: host ghi "đang ở danh tính
Page" vào nhật ký trên máy trước khi đổi, xoá khi đã đổi về; đầu lượt kế tiếp của tài khoản còn dấu này thì chạy nhánh khôi phục có sẵn trong
workflow (`pageIdentityRestoreOnly`) trước khi claim data. Khôi phục lỗi → FB07 (đã có chính sách tạm dừng tài khoản).

## 8. Cách bật riêng cho Facebook

### 8.1 Vì sao không dùng chung cờ `use_new_zalo_runtime`

- 479 tổ chức đang bật cờ, 24 trong đó dùng FB (30 nhân viên, 341 chiến dịch FB chạy 30 ngày). Dùng chung cờ thì bản Desktop đầu tiên có
  FB chuyển ngay các chiến dịch này, không chọn được tổ chức thử, không quay lại được nếu không tắt luôn Zalo của họ (tắt cờ còn kéo tài
  khoản Server từ Fly về App Server).
- Desktop chỉ đọc cờ khi tổ chức có quyền Zalo (`authRepository.ts:179`); tổ chức chỉ có FB không bao giờ đọc.
- Cờ chỉ đọc lúc đăng nhập; claim của engine với Desktop không kiểm cờ (V532 chỉ kiểm cờ khi nơi chạy là Fly). Tắt khẩn cấp phải chờ
  khách đăng nhập lại.

### 8.2 Ba cách

| Cách | Bật / tắt | Phạm vi | Ghi chú |
|---|---|---|---|
| Dùng chung cờ | UPDATE `org_organization` | tổ chức | không nên (8.1) |
| Cột cờ mới `org_organization.use_engine_v2_facebook` + hàm đọc mới | UPDATE `org_organization` | tổ chức | DDL trên bảng nóng; mỗi UPDATE chạy trigger đồng bộ đơn CRM (`trg_sync_organization_orders`), phải chia lô, đặt `lock_timeout` |
| **Thiết lập `auto_system_settings` `engine.facebook`** | UPDATE một dòng thiết lập | tổ chức | **anh chọn 16/11**. Không DDL, không trigger CRM; tắt cả hệ thống bằng một UPDATE (`mode: off`) |

### 8.3 Đã chốt: thiết lập riêng theo tổ chức, kiểm ở cả Desktop lẫn DB

Anh chốt Q1 (16/11): **chỉ bật theo tổ chức, không có công tắc theo loại chiến dịch**, giống quyết định 10 của Zalo; **danh sách tổ chức nằm
trong thiết lập `engine.facebook`**, không thêm cột trên `org_organization`. Zalo hôm nay cũng chỉ theo tổ chức:
Desktop đọc cờ tổ chức một lần lúc đăng nhập (V513), cờ tắt thì `DesktopEngineRunner.support()` trả `org_flag_off`; cờ bật thì loại nào chạy
bộ mới do lõi trong bản cài quyết định (`zaloCampaignV2Support`, `desktopEngineRunner.ts:105-114`), DB không có danh sách loại.

```json
{"mode": "off", "organizationIds": []}
```

- `mode`: `off` (mặc định, chưa có dòng = off) / `orgs` (chỉ `organizationIds`) / `all`.
- Desktop đọc lúc đăng nhập qua một RPC mới (đọc theo phiên như V513), **không phụ thuộc quyền Zalo**.
- `claim_target` kiểm lại thiết lập với tài khoản FB: tắt thì trả `not_enabled`. Tắt khẩn cấp có hiệu lực ở lần nhận lượt kế tiếp, không cần
  khách đăng nhập lại; Desktop nhận `not_enabled` thì chạy bộ cũ cho chiến dịch đó tới hết phiên. Chỗ này khác Zalo: claim của Zalo trên
  Desktop không kiểm cờ (8.1).
- **Loại nào chạy bộ mới do bản Desktop quyết định**: lõi có hàm phủ cho FB (cùng kiểu `zaloCampaignV2Support`) liệt kê loại đã làm xong
  và đã qua kiểm thử ở bản đó; loại chưa có trong hàm thì chạy bộ cũ kể cả khi tổ chức đã bật. Bản Desktop cũ không biết thiết lập này nên
  luôn chạy bộ cũ.
- Hệ quả, như Zalo: bản Desktop thêm loại mới thì **mọi tổ chức đã bật chạy loại đó bằng bộ mới ngay khi nhân viên cập nhật app**, không chọn
  riêng được. Vì vậy mỗi bản thêm loại phải qua phát lại dữ liệu thật, bộ kịch bản và cài thử máy nội bộ trước khi đưa lên feed.
- Không tắt riêng được một loại: loại mới gặp lỗi thì tắt tổ chức (hoặc `mode: off` cho cả hệ thống) để mọi loại FB của tổ chức đó quay về
  bộ cũ ở lần nhận lượt kế tiếp, rồi sửa và phát hành lại.
- Trong một tổ chức, nhân viên dùng bản Desktop khác nhau thì cùng một loại có thể chạy bộ mới ở máy người này, bộ cũ ở máy người kia. Hai
  bộ không đụng nhau: Desktop chỉ nạp tài khoản của nhân viên đang đăng nhập (`accountRepository.ts:302-311`, lọc `staff_id`), và claim của
  engine còn trả `legacy_busy` khi bộ cũ đang giữ tài khoản / chiến dịch, như Zalo.
- Đổi thiết lập chỉ là UPDATE một dòng `auto_system_settings`, không cần migration hay phát hành app. Bật cho tổ chức mới có hiệu lực khi
  nhân viên đăng nhập lại (Desktop đọc lúc đăng nhập, như Zalo); tắt có hiệu lực ở lần nhận lượt kế tiếp nhờ claim kiểm lại.

## 9. Kiểm thử

1. **SQL trên PostgreSQL 17 cục bộ** (`scripts/fixtures/campaign-outcome-engine/pg-fixture.cjs`): apply trong transaction rồi ROLLBACK,
   apply thật, chặn apply lần hai, rollback; claim FB (thiết lập bật / tắt, quyền gói 3/10, số tài khoản FB chạy cùng lúc), trần gói FB trong
   `aka_agent_engine_action_limit`, nhiều dấu trên một data (`mark_sending` không kiểm hạn mức giữa vòng, Q10), chính sách FB khớp bảng duyệt đã chốt cho
   **mọi cặp mã × thao tác FB**; cặp nào khác bộ cũ (so với `ActionStatusCatalog.resolve` kèm luật `actionResultRuntime.ts:151` và `:160`)
   phải là dòng anh đã duyệt đổi. Lượt theo lịch (Q4): mỗi mốc lịch nhận đúng một lần, nhiều khung giờ, lịch kế tiếp như bộ cũ, mọi hàm engine
   chạy đúng với lượt không có data. Tìm data (Q5): dòng "Tìm data" không gắn thao tác (chỉ chiến dịch FB, phải có tên, không tính lượt);
   chạy lại sau N giờ đúng như bộ cũ. Đăng nhóm kèm chia sẻ: claim chỉ nhận đúng danh sách data trong lượt đang giữ lease. Đợt 0 đổi bảng Zalo đang dùng nên chạy lại cả bộ kiểm của Zalo
   (`scripts/campaign-outcome-engine-check-all.cjs`).
2. **Bộ kiểm danh mục của bản cũ** (`scripts/legacy-catalog-validator-smoke.cjs`): Desktop 8.2.0, 9.3.0, 9.7.0 và chat-sync vẫn đạt sau mọi
   dòng `auto_error` / `auto_status` mới. Bộ chạy FB cũ kiểm mọi dòng `auto_error` có `error_type` chứa "facebook" lúc bắt đầu chạy
   (`actionResultRuntime.ts:42-53`); một dòng sai làm dừng **mọi** chiến dịch FB của bản cũ, nên mã mới của engine dùng
   `error_type = 'engine v2'` như Zalo.
3. **Phát lại dữ liệu thật** (mở rộng `scripts/engine-v2-realdata/`): chép chỉ đọc chiến dịch FB, data, lịch sử (`data`,
   `policy_snapshot.operationState`) và đầu ra từng node của lượt mẫu (`auto_run_steps`, đọc theo `run_id` của lượt đã chọn, không quét bảng
   lớn này). Cổng FB giả trả đúng đầu ra block đã ghi; so lịch sử, trạng thái data / chiến dịch do engine ghi với bộ cũ. Khác nhau chỉ được ở
   các điểm anh đã duyệt. Trang cá nhân / newsfeed so theo chiến dịch + mốc lịch, vì lịch sử bộ cũ ghi `input_data_id` NULL. Dữ liệu chép
   nằm ở scratchpad, không vào repo.
4. **Bộ kịch bản sự cố** (mở rộng `scripts/engine-v2-scenarios/`): "thế giới FB" rút theo phân bố 30 ngày (đăng được, không mở được hộp đăng
   bài, bài chờ duyệt, nhóm cần duyệt, comment bị tắt, giới hạn tần suất, checkpoint, đăng xuất…), cộng lỗi tiêm: block ném lỗi trước / sau
   điểm cam kết, cửa sổ ẩn chết, tắt app giữa vòng comment, tạm dừng từ Web giữa vòng comment, DB lỗi trước / sau khi nhận. Bất biến thêm cho
   FB: mỗi `stepKey` tối đa một lần bấm; không về hàng đợi sau `committed`; không bấm khi chưa có dấu; danh tính Page được khôi phục; vòng comment không vượt trần số comment (`facebook.max_comments`, Q10); newsfeed dừng đúng số phút khách cài; một mốc lịch không chạy hai lượt; tìm data tắt app sau khi có kết quả mà chưa đẩy xong thì
   như bộ cũ (anh chốt): mất phần chưa đẩy, không trùng; đăng nhóm kèm chia sẻ: không bấm Đăng khi nhóm đã chọn chưa có dấu, bấm rồi thì
   nhóm chia sẻ không đăng lại. Thêm lỗi ở từng loại thao tác nhỏ (chờ phần tử, gõ, dán, tải tệp, gọi API) trước và sau cú bấm gửi: phải ra
   đúng mã và đúng pha. Bộ kịch bản Zalo hiện có chạy lại nguyên vẹn, vì đợt 0
   đổi bảng `auto_engine_target_runs` mà Zalo đang dùng.
5. **Webview thật, không chạm Facebook**: chạy `workflowEngine` + `PageController` thật trong Electron (`xvfb-run`) với trang HTML giả lập
   (hộp đăng bài, nút đăng, ô comment, trang checkpoint, trang đăng nhập, form không đóng), block và element lấy từ ảnh chụp DB (fixture JSON
   `auto_blocks` / `auto_workflows` / `auto_elements`, không dữ liệu khách). Kiểm thứ tự: dấu "sắp gửi" luôn có trước cú bấm; dừng ở ranh
   giới mốc; block không ngắt được thì lõi chờ block xong mới nhả lease. Kiểm vết thao tác và ảnh: thao tác thử phần tử không bị tính lỗi; ảnh
   chụp đúng lúc thao tác lỗi (trước khi trang đổi) và chỉ lưu khi block lỗi; dọn đúng 14 ngày / 1 GB, kể cả thư mục `block-screenshots` cũ.
   Chạy cùng block dưới runtime của bản cũ (không có hook, không có helper mới) để chắc bản cũ chạy y như trước. AutoCheck (Q6): tài khoản
   `checkpoint` còn cookie `c_user` không bị nâng lại; bước hỏi thẳng Facebook (giả lập) trả hết checkpoint thì nâng lại trong vài phút.
   Bản "[engine] …" của từng block chạy trên cùng trang giả lập ra cùng đầu ra như bản cũ, trừ chỗ cố ý đổi (Q7); script kiểm hai bản khớp
   báo đúng cặp bị lệch khi chỉ sửa một bên. Block treo (Q20): trang giả lập không trả lời lệnh thì sau 10 phút không có thao tác cửa sổ ẩn bị
   huỷ, lời gọi đang chờ kết thúc thật, data chạy tiếp; block nghỉ theo cài đặt, block cuộn trang lâu và máy ngủ thì không bị tính là treo.
6. **Thử thật trên tổ chức nội bộ** (tổ chức 1, đã bật quản lý chiến dịch FB trên Web), tài khoản FB nội bộ, mỗi loại vài data, khi anh bảo.
   Gồm cả ảnh lỗi: lỗi có ảnh khi chụp được, dọn đúng giới hạn, yêu cầu chẩn đoán tải đúng ảnh lên bucket riêng tư; phiên Desktop không ghi được
   vào thư mục của nhân viên khác, không đọc được bucket (kiểm chính sách lưu trữ bằng hai phiên).
7. **Đo tải DB** trên tổ chức thử trước khi mở rộng: số RPC mỗi data (claim, mark, report, heartbeat, release) so với bộ cũ, và có tiếp tục
   ghi `auto_runs` / `auto_run_steps` hay không (Q8). Đo 16/11: `auto_run_steps` 71 GB (`auto_runs` 22 GB, `auto_campaign_run_events`
   26 GB); mỗi lượt FB ghi trung bình 27 bước, ~10 KB, mỗi bước 2 lần ghi (thêm rồi sửa); 50.000 lượt gần nhất (5,7 giờ) có 9.493 lượt FB,
   trong đó 140 lỗi, 7 huỷ (~1,5%). **Anh chốt Q8: engine ghi mọi bước như bộ cũ.** Ba bảng này không có job dọn (lượt cũ nhất 07/05/2026)
   và FK `auto_campaign_run_events.run_step_id` chưa có chỉ mục, nên dọn dữ liệu cũ là việc riêng, phải dựng chỉ mục trước.

## 10. Lộ trình theo đợt

**Thứ tự (anh chốt 16/11 tối): làm hoàn chỉnh code cả đợt 0–3 trước, bảng duyệt FB để cuối.** Code mỗi loại theo đặc tả đọc từ code
hiện tại (`docs/engine-v2-specs/facebook-*.md`, có số dòng và câu cho khách nguyên văn). Chính sách FB trong migration đợt 0 viết trước bằng
bản nháp giữ đúng hành vi bộ cũ (mục 5.3), đủ để kiểm thử cục bộ; bảng duyệt sinh từ bản nháp đó (bộ cũ là một cột đối chiếu, Q3). Anh
duyệt xong thì sửa file migration chính sách và câu cho khách theo bảng. Migration nào cũng chỉ apply khi anh bảo, và migration chính sách
chỉ apply sau khi duyệt bảng, nên sửa theo bảng không cần migration gỡ. Sau đó: phát lại dữ liệu thật + bộ kịch bản → apply → cài thử máy
nội bộ, bật tổ chức thử → đưa bản Desktop lên feed.
**Làm như Zalo (anh chốt Q19, 16/11):** trong lúc engine chưa phủ đủ 13 loại FB, thiết lập `engine.facebook` chỉ có tổ chức thử (nội bộ);
đủ 13 loại mới mở cho khách, theo lô như Zalo 13–14/11. Nhờ vậy khách đã bật gần như không còn lượt FB bộ cũ, nên engine không cần tách khỏi
cổng bảo trì đầu ngày của bộ cũ.

| Đợt | Nội dung | Migration (apply ngoài giờ cao điểm) | Phát hành Desktop | Sửa block bằng DML | Đổi hành vi khi xong |
|---|---|---|---|---|---|
| 0. Nền DB | Thiết lập `engine.facebook` (chưa có dòng = tắt) + RPC đọc cho Desktop; thiết lập trần số comment (đề xuất `facebook.max_comments` = 20, Q10); hàm chỉ đọc tra lỗi theo data / lượt và liệt kê chiến dịch đứng / lỗi lạ tăng (R1, R18; Q16, Q22); claim: kiểm thiết lập với tài khoản FB, quyền gói FB (sản phẩm 3/10), số tài khoản FB chạy cùng lúc; trần gói FB trong `aka_agent_engine_action_limit`; `mark_sending` giữ như bộ cũ, không kiểm hạn mức giữa vòng (Q10); khoá lượt theo lịch trong `auto_engine_target_runs` cho trang cá nhân / newsfeed (claim `campaign_slot`, lịch kế tiếp, mục 4.4); chạy lại sau N giờ khi xong trong `finish_campaign` (tìm data, comment seeding, newsfeed, mục 4.5); bảng danh mục bước FB (kèm cú bấm gửi, bảng chọn workflow cho engine) + seed; luật phân loại FB, cả luật theo (thao tác, phần tử); mã mới `engine v2`; chính sách FB bản nháp giữ hành vi bộ cũ, sửa theo bảng duyệt trước khi apply (Q3; thứ tự chốt 16/11 tối); phần ảnh lỗi ở mục 12.6 (bảng yêu cầu chẩn đoán, bucket riêng tư, bản presence mới) | có (hàm mới / thay thân hàm engine, bảng mới, dữ liệu; đổi bảng `auto_engine_target_runs` mà Zalo đang dùng, ALTER để giao dịch riêng) | không | không | không (chỉ engine đọc; thiết lập tắt) |
| 1. Desktop | Lõi chế độ workflow; hook `beforeNode` / `afterNode` trong `workflowEngine`; bọc `PageController` ghi vết thao tác; chụp ảnh ở mọi bước lỗi, lưu JPEG, dọn theo giới hạn, trả lời yêu cầu chẩn đoán; cổng FB (trang ẩn, danh tính Page, nội dung xoay vòng theo lease, nghỉ / lướt FB, nhóm data, chống gửi lặp); `helpers.commitPoint`; bộ chạy Desktop chọn theo thiết lập tổ chức và hàm phủ FB của lõi (mục 8.3); nhận lượt theo lịch, newsfeed dừng theo số phút khách cài (mục 4.4); vá AutoCheck: tài khoản đang `checkpoint` chỉ nâng lại khi hỏi thẳng Facebook thấy hết (Q6, mục 7.3); nhận ra block treo (10 phút liền không có thao tác) và huỷ cửa sổ ẩn (Q20, R16); câu chờ khi chiến dịch đến lịch quá 10 phút chưa chạy được, nút "Lý do đang chờ" hiểu trạng thái engine (Q21, R17); trần số comment đọc từ thiết lập (mặc định 20) cho ô "Số comment tối đa" và "Số bài cần comment…" ở form, AI điền form và lúc chạy, chiến dịch cũ đặt hơn trần chỉ chạy tới trần (Q10); ghi mã lượt engine vào `auto_runs` và script tra lỗi (R1, Q16); nhật ký SQLite dùng chung | không | **có**; cài thử máy nội bộ trước | không | không (thiết lập tắt); riêng việc dọn thư mục ảnh cũ, bản vá AutoCheck, câu chờ và trần 20 comment có hiệu lực ngay với máy cài bản mới, kể cả lượt chạy bộ cũ và Zalo |
| 2. Công cụ chép bản engine | Script chép + sổ cặp (block cũ ↔ bản engine, md5) + kiểm hai bản khớp (Q7, mục 3.7). Bảng chọn workflow nằm trong danh mục của engine | không (chỉ thêm dòng dữ liệu) | không | thêm dòng mới, không sửa dòng đang dùng | không với bản cũ |
| 3. Cả 13 loại cùng lúc (anh chốt gộp, Q9) | Chép bản "[engine] …" cho cả 13 loại một lần; 8 block `evaluate` tách cú bấm ra. Một mốc: hộp thư Page (17% lịch sử), tham gia nhóm (5%), nhắn UID + nhắn bạn bè (10%), trang cá nhân (lượt theo lịch, Q4). Vòng comment / like: comment seeding bài (gồm Up tin, 7%; hạn mức giữa vòng, nội dung theo data V531), newsfeed (lượt theo lịch 25 phút – 2 giờ, Q4). Đăng nhóm (53%): đăng, chia sẻ nguyên bài, comment sau đăng, tham gia / rời nhóm, danh tính Page, sinh lượt Up tin, bỏ qua nhóm cần duyệt. Comment seeding (lượt tới 6 giờ), đăng Page (Graph API), mời vào nhóm (theo lô). Đăng nhóm kèm chia sẻ sang nhóm đã tham gia: nhận thêm nhóm đã chọn vào lượt, ghi dấu từng nhóm. Tìm data (Q5, mục 4.5): dòng "Tìm data" không gắn thao tác, đẩy data như bộ cũ | chính sách theo bảng duyệt; claim nhận đúng danh sách data, report_v1 nhận kết quả không gắn thao tác (V558) | **có, một lần** khi cả 13 loại qua phát lại dữ liệu thật và bộ kịch bản; trong lúc làm, loại nào xong thì tổ chức thử chạy bằng bản cài nội bộ (không phát hành) | thêm producer ở bản "[engine]" khi cần | chỉ tổ chức thử (Q19) |
| 4. Mở cho khách | Thêm tổ chức vào `engine.facebook` theo lô, như Zalo 13–14/11; tắt khẩn cấp bằng `mode: off` | không (chỉ UPDATE thiết lập) | không | không | tổ chức được thêm chạy bộ mới cho cả 13 loại |

Ảnh lỗi và yêu cầu chẩn đoán đi cùng đợt 0 (DB) và đợt 1 (Desktop), chi tiết ở mục 12.6.

Cả 13 loại làm trong một đợt (anh chốt 16/11, Q9), không chia thứ tự. Loại nào xong trước thì cho tổ chức thử chạy ngay bằng bản cài nội
bộ, để lỗi ở cách nối (ghi dấu "sắp gửi", ghi từng mốc) lộ ra sớm trước khi phải sửa trên cả 13 loại. Không có công tắc theo loại (Q1), nên
hàm phủ FB của lõi chỉ liệt kê loại đã qua phát lại dữ liệu thật và bộ kịch bản; bản Desktop có đủ 13 loại cài thử máy nội bộ trước khi đưa
lên feed. Sau khi mở cho khách, mọi tổ chức đã bật nhận bản Desktop mới ngay khi cập nhật. Dòng dữ liệu (danh mục bước, workflow riêng cho
engine, chính sách) phải có trên DB trước khi bản Desktop lên feed; thêm dòng không đổi gì với bản cũ.

**Không đổi hành vi khi apply / phát hành:** migration đợt 0 chỉ thêm (hàm, bảng, dòng dữ liệu `engine v2`) hoặc thay thân hàm mà chỉ
engine gọi; bản Desktop đợt 1 chạy bộ cũ khi thiết lập tắt, chỉ đổi bốn chỗ dùng chung với bộ cũ (cả Zalo) là dọn thư mục ảnh cũ (Q14), vá
AutoCheck cho tài khoản `checkpoint` (Q6), câu chờ khi chiến dịch đến lịch mà chưa chạy được (Q21) và trần 20 của ô số comment (Q10); đợt 2 chỉ thêm block / workflow mới mà bản cũ không nạp. DDL làm PostgREST nạp lại schema nên apply
ngoài giờ cao điểm, như các bản V495–V532. Đợt 0 còn đổi bảng `auto_engine_target_runs` mà Zalo đang dùng (Q4, mục 4.4): không được đổi
hành vi Zalo, nên chạy lại bộ kiểm và bộ kịch bản Zalo trước khi apply. Ngoại lệ: dòng nào trong bảng duyệt anh chọn "áp cả cho bộ cũ" (sửa `auto_error`, như V472) thì
đổi hành vi mọi Desktop ngay khi apply, nên tách thành migration riêng và qua bộ kiểm danh mục của bản cũ (mục 9).

**Trước mỗi migration:** đọc thân hàm đang chạy trên production (theo repo, `claim_target_v1` và `report_v1` hiện là bản V532) và để preflight kiểm md5,
không chép thân từ migration cũ; kiểm sổ migration và `git log --all` ngay trước khi đặt số (sổ 16/11 tới V551; V531 đang thuộc nhánh
`claude/post-bump-content-rotation`, chưa apply).

## 11. Câu hỏi cần anh chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| Q1 | Bật FB bằng gì? | **Đã chốt 16/11: chỉ theo tổ chức**, không có công tắc theo loại, như Zalo; loại nào chạy bộ mới do bản Desktop quyết định. **Danh sách tổ chức nằm trong thiết lập `engine.facebook`** (`auto_system_settings`), không thêm cột trên `org_organization` (mục 8.2, 8.3) |
| Q2 | Tạm dừng / đăng xuất khi đang chạy một data dài (vòng comment, lượt tới 6 giờ): dừng ở ranh giới mốc hay chờ hết data như Zalo? | **Đã chốt 16/11: dừng ở ranh giới mốc**; data đã gửi ít nhất một mốc thì "hoàn thành" kèm ghi chú, mốc còn lại không chạy tiếp (mục 7.2) |
| Q3 | Seed: giữ đúng cách đếm của bộ cũ (mục 5.3, gồm chỗ lệch `actionResultRuntime.ts:151`) ở lần bật đầu, rồi duyệt bảng FB sau? | **Đã chốt 16/11: duyệt bảng FB trước lần bật đầu**; seed sinh từ bảng đã chốt, bộ cũ là một cột đối chiếu, mặc định chỉ đổi engine (mục 5.3). **Thứ tự (16/11 tối): code xong hết đợt 0–3 rồi mới duyệt bảng**, trước khi apply migration chính sách và bật tổ chức thử (mục 10) |
| Q4 | Trang cá nhân, newsfeed (không có dòng data): giữ bộ cũ ở các đợt đầu? | **Đã chốt 16/11: làm sớm**: lượt theo lịch vào đợt 0 (DB) và đợt 1 (Desktop); trang cá nhân và newsfeed làm trong đợt 3 cùng các loại khác (mục 4.4, 10) |
| Q5 | Tìm data trong group / bằng search (chỉ đọc): đưa vào engine không? | **Đã chốt 16/11: đưa vào engine**, làm trong đợt 3. Không chỉ đọc: đẩy data sang chiến dịch khác, nhóm data, akaBiz Desktop, nên engine đẩy theo lease và chống trùng (mục 4.5) |
| Q6 | Checkpoint (FB04): chính sách đang có khoá mọi thao tác FB không thời hạn, tạm dừng tài khoản; chưa từng có code phát mã này. Giữ hay khoá có hạn? | **Đã chốt 16/11: coi checkpoint như trạng thái đăng nhập**, không khoá thao tác, không tạm dừng tài khoản, hết checkpoint thì tự chạy tiếp; kèm vá AutoCheck cho tài khoản thường (mục 7.3) |
| Q7 | Sửa block: kết hợp (11 block không sửa, block cần đổi thì tạo bản riêng cho engine) hay sửa tại chỗ có điều kiện? | **Đã chốt 16/11: chép hết** block / workflow FB đang dùng sang bản riêng cho engine (14 workflow, 84 block), bỏ qua cái không còn dùng, chép một lần khi bắt đầu đợt 3 (mục 3.7) |
| Q8 | Engine có ghi tiếp `auto_runs` / `auto_run_steps` cho mỗi node không? | **Đã chốt 16/11: ghi mọi bước như bộ cũ** (em đã đề xuất chỉ ghi khi lượt lỗi). Engine dùng lại `workflowEngine` nên không phải làm gì thêm; bảng tiếp tục lớn theo số lượt (mục 9.7) |
| Q9 | Thứ tự loại: đơn giản trước (hộp thư Page, tham gia nhóm, nhắn UID) rồi mới đăng nhóm? | **Đã chốt 16/11: gộp đợt 3–7 thành một đợt, làm cả 13 loại cùng lúc**; loại nào xong thì tổ chức thử chạy bằng bản cài nội bộ; phát hành Desktop một lần khi đủ 13 loại (mục 10) |
| Q10 | Hạn mức giữa vòng comment: giữ như bộ cũ (vượt trong một data) hay kiểm khi ghi dấu và bỏ các comment còn lại? | **Đã chốt 16/11: giữ như bộ cũ, và giới hạn số comment cài đặt ở giao diện tối đa 20**, áp cả ô "Số bài cần comment…" của comment seeding; chiến dịch cũ đặt hơn 20 chỉ chạy tối đa 20; con số 20 nằm trong `auto_system_settings`, sửa được ở DB (mục 6.3) |
| Q11 | Câu lý do "dừng sau N data lỗi" của `err_undefined` hôm nay do AI đọc ảnh chụp màn hình: engine giữ tính năng này không? | **Đã chốt 16/11: giữ AI đọc ảnh như bộ cũ**, cho lỗi chưa phân loại (SYS99) khi dừng theo chuỗi lỗi; ảnh gửi tới dịch vụ AI như hôm nay (mục 12.5) |
| Q12 | Ảnh lỗi: chỉ lấy lên máy chủ khi anh yêu cầu, hay tự tải lên thêm ảnh của lỗi chưa phân loại (SYS99, mẫu lỗi chưa có luật) để thêm luật? | **Đã chốt 16/11: chỉ theo yêu cầu.** Không tự tải ảnh nào lên máy chủ (mục 12.4) |
| Q13 | Có báo khách (chính sách riêng tư / màn hình) rằng app chụp và giữ ảnh lỗi trên máy, và akaBiz có thể lấy về khi hỗ trợ? | **Đã chốt 16/11: không báo** (mục 12.5) |
| Q14 | Giữ ảnh trên máy khách bao lâu? | **Đã chốt 16/11: 14 ngày hoặc 1 GB, cái nào tới trước** (mục 12.3) |
| Q15 | Vết thao tác của block lỗi: giữ toàn bộ (có trần, ví dụ 200 thao tác / 64 KB) hay chỉ 5–10 thao tác cuối? | **Đã chốt 16/11: giữ toàn bộ**, trần 200 thao tác / 64 KB (R4) |
| Q16 | Công cụ tra lỗi theo data cho admin: hàm chỉ đọc dùng bằng SQL / script trước, hay làm luôn màn hình Web admin? | **Đã chốt 16/11: script trước**: hàm chỉ đọc ở đợt 0, script ở đợt 1; màn hình Web admin làm sau (R1, R5) |
| Q17 | Có cần lấy ảnh khi không lỗi ("chụp ngay", "chụp mọi bước")? | **Đã chốt 16/11: không** (anh xác nhận "Đúng, không cần"). Ảnh chỉ lấy khi lấy được, không bắt buộc (mục 13.2) |
| Q18 | Lớp chụp ảnh lỗi có áp cho cả lượt bộ cũ không? | **Đã chốt 16/11: không thêm** (mục 13.2) |
| Q19 | Cổng bảo trì đầu ngày và khoá "lượt bộ cũ chờ dọn" đang chặn cả lượt engine của nhân viên / tài khoản: (a) engine FB không đi qua hai khoá này, chỉ chờ đúng chiến dịch / tài khoản bộ cũ đang giữ, và tự dời lịch ngày mới cho chiến dịch của mình (hôm nay engine còn nhờ bước bảo trì của bộ cũ); hay (b) sửa luôn cổng của bộ cũ (lease có hạn, chỉ chặn chiến dịch dính lease), đổi cả Zalo và bộ cũ? | **Đã chốt 16/11 (đổi lại sau khi bàn thêm): làm như Zalo, không tách cổng.** Trong lúc engine chưa phủ đủ 13 loại FB chỉ bật tổ chức thử; đủ rồi mới mở cho khách, nên khách đã bật gần như không còn lượt FB bộ cũ (R19, mục 13.5) |
| Q20 | Block treo: coi là treo khi nào, rồi làm gì? | **Đã chốt 16/11:** không giới hạn thời gian chạy của block; treo = 10 phút liền không có thao tác nào (không tính lúc nghỉ theo cài đặt và lúc máy ngủ); treo thì huỷ cửa sổ ẩn, chạy data kế (R16) |
| Q21 | Chiến dịch đến lịch mà không chạy được bao lâu thì ghi câu chờ cho khách? Có báo cả chuông thông báo không? | **Đã chốt 16/11: thêm câu chờ** (Zalo hôm nay cũng chưa có). Quá 10 phút chưa chạy được thì ghi câu chờ vào ghi chú chiến dịch và tiến trình, mỗi khi lý do đổi; nằm trong vòng lặp dùng chung nên Zalo trên Desktop cũng có. Chuông thông báo: chưa thêm (R17) |
| Q22 | Giám sát chiến dịch FB đứng, lỗi chưa phân loại tăng, claim lỗi liên tục: báo cho admin ở đâu (chuông admin trên Web, email, Lark…), bao lâu một lần? | **Đã chốt 16/11: không báo.** Khi cần anh vào phiên Claude kiểm; có hàm chỉ đọc + script để chạy lúc đó (R18) |
| Q23 | Câu cho khách: mỗi mã một câu dùng chung cho mọi chỗ (tiến trình, ghi chú, thông báo, Web / iOS) kèm câu "bước tiếp theo" khi dừng, anh duyệt từng câu trong bảng duyệt? | **Đã chốt 16/11: đồng ý** (R12, R13, mục 5.3) |
| Q24 | Tách khỏi cổng bảo trì (Q19) có áp luôn cho engine Zalo trên Desktop không? Hai loại dùng chung một đường chạy trong `tick()`, hôm nay chiến dịch Zalo chạy engine cũng đứng theo cổng của bộ cũ | **Đã chốt 16/11: không tách, Zalo giữ nguyên** (Q19 làm như Zalo). Đo 16/11 18:10 VN: 78 nhân viên tổ chức chạy engine Zalo đang mở app, không ai kẹt cổng; máy duy nhất đang kẹt là một nhân viên dùng FB bộ cũ, kẹt từ 00:00 (phụ lục A mục 28) |

## 12. Ảnh chụp khi lỗi và lấy ảnh từ máy khách

### 12.1 Hôm nay

- Chụp theo cấu hình từng node (`screenshotCaptureOn`, `screenshotCaptureTiming`), chỉ sau khi block chạy xong. Trong 13 workflow FB chỉ **9/245
  node** có cấu hình, đều "khi lỗi": nút đăng bài, xác nhận đăng nhóm, reels, nhắn tin (2), Page API / giao diện, hộp thư Page. Lỗi ở comment,
  kết bạn, mở hộp đăng bài, tham gia nhóm… không có ảnh.
- Ảnh PNG lưu trên máy khách ở `userData/local-data/block-screenshots/campaign-<id>/<ngày>/` (`blockScreenshotService.ts:35-73`). **Không có
  code nào dọn thư mục này**, nên ổ của khách đầy dần.
- DB chỉ giữ đường dẫn trên máy khách: mỗi ảnh một dòng `auto_campaign_run_events` (`browser_screenshot`, `debug_data.screenshotPath`). Đo
  12–16/11: 2.083 ảnh trong ~4,2 ngày (~490 ảnh/ngày), trung bình 508 KB, lớn nhất 2,1 MB.
- Ảnh chỉ xem được trên chính máy đó (IPC đọc tệp). Lỗi `err_undefined` đủ ngưỡng thì bộ cũ gửi ảnh lên dịch vụ AI để viết câu lý do
  (`campaign_error_screenshot_diagnosis`, `campaignScheduler.ts:10242-10295`). Anh không lấy được ảnh nếu không vào máy khách.

### 12.2 Chụp ở mọi bước lỗi

Ở engine, chụp không phụ thuộc cấu hình node:
1. **Thao tác nhỏ ném lỗi** (mục 3.6): chụp ngay lúc lỗi vào RAM, giữ ảnh mới nhất của block. Chỉ lưu ra đĩa khi block hoặc mốc kết thúc là lỗi;
   block vẫn thành công thì bỏ ảnh, vì nhiều block cố ý thử phần tử có hay không (`waitForSelector` / `page.$` trong `try`) rồi đi tiếp.
2. **Block lỗi, trả kết quả thất bại, hoặc mốc gửi không rõ kết quả**: chụp ngay sau block (như "khi lỗi" hôm nay, nhưng cho mọi block).
3. **Host phát hiện trạng thái trang**: checkpoint, đăng xuất, câu chặn (FB01–FB03), hết hạn giờ của data.

Không chụp được (cửa sổ ẩn đã chết, lỗi DB, lỗi cấu hình, chạm hạn mức) thì thôi: ảnh chỉ lấy khi lấy được, không bắt buộc (anh nói rõ
16/11).

- Ảnh JPEG chất lượng ~70, rộng tối đa 1.280 px (cửa sổ ẩn 1.920 × 1.080), cỡ ~100 KB thay vì ~500 KB PNG. Kèm tệp JSON nhỏ: URL, tiêu đề
  trang, thao tác nhỏ lỗi, phần tử, mã lỗi và mã công khai, thời điểm, phiên bản app, chiến dịch, data, lượt data, `stepKey`.
- Trần: mỗi mốc một ảnh, mỗi lượt data tối đa 3 ảnh; cùng mã lỗi trên cùng chiến dịch quá vài ảnh mỗi giờ thì chỉ đếm (vòng 500.000 comment
  không làm đầy ổ).
- Ước tính: FB có ~1.700 kết quả "lỗi" / "thất bại" mỗi ngày (mẫu lịch sử) và ~500 lượt workflow lỗi (`auto_runs`), tức ~2.200 ảnh/ngày,
  ~220 MB/ngày trên toàn bộ máy khách.

### 12.3 Lưu trên máy khách

- Thư mục `userData/local-data/engine-screenshots/<ngày>/<mã ảnh>.jpg` và `.json`; chỉ mục trong SQLite nhật ký engine đã có
  (`campaign_engine_journal.db`, thêm một bảng trong SQLite, không phải Supabase).
- **Anh đã chốt (Q14, 16/11): giữ 14 ngày hoặc 1 GB, cái nào tới trước**, xoá cũ nhất trước. Cùng bản phát hành, dọn luôn thư mục
  `block-screenshots` của bộ cũ theo cùng giới hạn.
- DB chỉ giữ con trỏ: mã ảnh (uuid), sha256, cỡ, thời điểm, đi trong `evidence` của kết quả gửi `report_v1` → `auto_engine_outcomes.signal`
  (30 ngày) và `auto_campaign_details.data.screenshotId` (vài chục byte). Không thêm dòng `auto_campaign_run_events` cho mỗi ảnh như hôm nay.
- Khách tự xem được ảnh lỗi trên máy, ở dòng thời gian của data.

### 12.4 Lấy ảnh từ máy khách khi anh cần

**Anh đã chốt (Q12, 16/11): chỉ theo yêu cầu.** Ảnh chỉ rời máy khách khi có yêu cầu chẩn đoán; không tự tải ảnh nào lên máy chủ.
1. Anh (admin akaBiz) tạo yêu cầu cho một data, một chiến dịch, một khoảng giờ, hoặc danh sách mã ảnh. Bảng mới
   `auto_desktop_diagnostic_requests`: nhân viên, tổ chức, người yêu cầu, bộ lọc, trạng thái (chờ / đang gửi / xong / máy không còn ảnh / hết
   hạn), hạn chót 7 ngày, kết quả. Giai đoạn đầu tạo bằng SQL (em làm khi anh bảo); màn tạo và xem trên Web admin làm sau.
2. Máy khách biết có yêu cầu qua nhịp presence 30 giây sẵn có, **không thêm lượt gọi định kỳ**. `aka_agent_device_presence` hiện trả `boolean`
   và Desktop bỏ qua kết quả (`devicePresenceService.ts:14`), nên bản Desktop mới gọi một bản mới trả thêm "có yêu cầu chẩn đoán"; bản cũ vẫn
   gọi bản cũ.
3. Desktop tìm ảnh trong chỉ mục SQLite và tải lên **bucket riêng tư mới** trên Supabase Storage (ví dụ `desktop-diagnostics`, không công khai,
   chỉ nhận JPEG / JSON, ≤ 2 MB mỗi tệp), đường dẫn `<nhân viên>/<mã yêu cầu>/<mã ảnh>.jpg`. Chính sách lưu trữ chỉ cho phiên Desktop ghi vào
   đúng thư mục của chính nhân viên đó và chỉ khi yêu cầu còn mở; không cho đọc, không cho xoá. Supabase Storage đã có bucket riêng tư
   (`outbox-attachments`, `agent-support-od-inputs`).
4. Anh xem bằng link ký có hạn vài phút (API Web dùng `service_role`). Ảnh trên bucket tự xoá sau 7 ngày (job dọn).

- Giới hạn: máy khách phải đang mở app; ảnh phải còn trong giới hạn lưu ở 12.3; cài lại máy hoặc xoá dữ liệu app thì mất.
- Đã cân nhắc và bỏ (Q12): tự tải ảnh của lỗi chưa phân loại (SYS99, `auto_outcome_unmatched`) để thêm luật, và tự tải mọi ảnh lỗi
  (~220 MB/ngày). Lỗi chưa phân loại vẫn có bước lỗi và phần tử trong `auto_engine_outcomes.signal` / `auto_outcome_unmatched`; cần ảnh thì tạo
  yêu cầu như mọi lỗi khác.
- **Không dùng đường tải R2 hiện có** (`mediaStorageService.ts`): bucket media là công khai, và khoá R2 nằm trong `auto_system_settings`
  (`media.storage.secret_access_key`) mà phiên Desktop đọc được (chỉ khoá DeepSeek bị chặn đọc). Việc khoá R2 lộ là vấn đề riêng, đã đề xuất
  một phiên riêng điều tra và lên cách sửa (chưa chạy).

### 12.5 Riêng tư

- Ảnh có dữ liệu cá nhân của khách và của người khác trên Facebook. Chỉ admin akaBiz được tạo yêu cầu và xem; DB ghi ai yêu cầu, lúc nào; link
  xem có hạn; ảnh trên máy chủ tự xoá.
- **Anh đã chốt (Q13, 16/11): không báo khách.** Không thêm câu nào vào chính sách riêng tư hay màn hình về việc chụp, giữ và lấy ảnh; tải ảnh
  theo yêu cầu chạy nền, khách không thấy. Khách vẫn xem được ảnh lỗi của chính mình ở dòng thời gian của data, như bộ cũ đang hiện dòng "📸 Ảnh
  chụp màn hình trạng thái trình duyệt" (`campaignScheduler.ts:16894-16960`, sự kiện `is_user_visible`).
- Ảnh có dữ liệu cá nhân của khách và của người khác trên Facebook; nên để người phụ trách pháp lý xem lại cách làm này trước khi bật.
- AI đọc ảnh lỗi: **engine giữ như bộ cũ (anh chốt Q11, 16/11)**. Lỗi chưa phân loại (SYS99) làm chiến dịch dừng theo chuỗi lỗi thì ảnh
  được gửi tới dịch vụ AI để viết câu lý do cho khách, như hôm nay (`campaignScheduler.ts:10242-10295`). Đây là đường duy nhất ảnh tự rời máy
  khách; lưu ảnh trên máy chủ của mình vẫn chỉ theo yêu cầu (Q12).

### 12.6 Việc thêm theo đợt

| Đợt | Việc |
|---|---|
| 0 (DB) | Bảng yêu cầu chẩn đoán; bucket riêng tư và chính sách lưu trữ; bản presence mới; RPC nhận / báo xong yêu cầu; job dọn bucket |
| 1 (Desktop) | Chụp ở mọi bước lỗi, lưu JPEG, chỉ mục SQLite, dọn theo giới hạn (cả thư mục cũ), trả lời yêu cầu, xem ảnh ở dòng thời gian |
| sau | Màn tạo yêu cầu và xem ảnh trên Web admin |

## 13. Rà soát 16/11 theo yêu cầu của anh: đã có, còn thiếu, cần anh quyết

> **Câu hỏi của mục này (Q15–Q24) anh đã chốt hết ngày 16/11** (bảng ở mục 11); mục R nào không ghi "anh chốt" là việc em đề xuất đi
> kèm, làm theo các quyết định đó. Năm yêu cầu anh đặt ra (16/11): ghi đủ các bước để dễ tra lỗi; cần ảnh thì lấy được
> ảnh trình duyệt (khi chụp được, không bắt buộc); lỗi gì ở đâu cũng phải được trả về và điều khiển được; câu ghi ra cho khách phải dễ hiểu, không lộ lỗi kỹ thuật; không để
> chiến dịch treo khi gặp lỗi như bộ cũ. Các mục R là việc đề xuất thêm vào phương án; Q15–Q23 là câu cần anh quyết (bảng ở mục 11).

### 13.1 Ghi đủ các bước để dễ tra lỗi

Đã có: mọi node ghi `auto_runs` / `auto_run_steps` (Q8); vết thao tác nhỏ trong RAM, khi lỗi gửi toàn bộ vết của block lỗi vào
`auto_engine_outcomes.signal` (giữ 30 ngày; Q15); dòng thời gian của data ở `auto_engine_target_events`; lỗi chưa có luật vào
`auto_outcome_unmatched`; tiến trình cho khách ở `auto_campaign_logs`.

Còn thiếu:
- **R1. Một mã tra cứu xuyên suốt.** Hôm nay muốn tra một lỗi phải ghép tay `auto_runs` (lượt workflow), `auto_engine_target_runs` (lượt data
  của engine), `result_key`, mã ảnh, dòng lịch sử. Đề xuất: lượt workflow của engine ghi `target_run_id` + `stepKey` vào `auto_runs` (trong
  phần biến đầu vào, không cần DDL), `signal` ghi lại `run_id` + `nodeId`; một hàm chỉ đọc nhận mã data hoặc mã lượt và trả đủ: các bước,
  vết thao tác, mã lỗi, câu đã hiện cho khách, mã ảnh nếu có.
- **R2. Lỗi ngoài workflow cũng phải có dấu vết.** Lỗi lúc nhận lượt, ghi dấu, báo kết quả, mở cửa sổ ẩn, gắn proxy, chuẩn bị nội dung (AI
  viết lại, tải media), đổi danh tính Page xảy ra khi chưa có hoặc không còn `auto_runs`. Mỗi lỗi như vậy phải thành một kết quả có mã (qua
  `report_v1`) hoặc một sự kiện `note` của lượt data, không có chỗ nào chỉ in `console.error`.
- **R3. Lượt engine luôn đóng dòng `auto_runs` của mình** (lỗi, huỷ, tắt app, hạn giờ cứng ở R17); hôm nay hook ném lỗi là dòng kẹt
  `running` mãi (mục 3.1).
- **R4. Vết thao tác của block lỗi** (anh chốt Q15, 16/11): giữ toàn bộ vết của block đó, trần 200 thao tác / 64 KB, thay vì 5–10 thao tác cuối.
- **R5. Công cụ tra lỗi cho admin** (anh chốt Q16, 16/11): hàm ở R1 (đợt 0) kèm một script chạy từ máy (đợt 1), đưa mã data hoặc mã lượt vào
  là ra đủ thông tin; màn hình trên Web admin làm sau.

### 13.2 Ảnh trình duyệt khi cần

**Anh nói rõ (16/11): ảnh chỉ lấy khi lấy được, không bắt buộc.** Mục 12 đã đủ: lỗi mà chụp được thì có ảnh trên máy khách (14 ngày /
1 GB), anh cần thì lấy về theo yêu cầu; không chụp được (cửa sổ ẩn đã chết, máy tắt, ảnh đã quá hạn) thì thôi. Không thêm việc gì ở mục này.

### 13.3 Lỗi gì ở đâu cũng được trả về và điều khiển được

Đã có: bảng tín hiệu (5.2), pha trước / trong / sau khi gửi, DB quyết theo chính sách sửa được bằng SQL, lỗi chưa phân loại thành SYS99 và
vào `auto_outcome_unmatched`, nhật ký trên máy gửi bù khi mất DB (DB01).

Còn thiếu:
- **R8. Bảng kiểm kê lỗi đầy đủ**: mỗi chỗ có thể lỗi → tín hiệu → mã → xử lý data / tài khoản / chiến dịch → câu cho khách.
  Dựng từ code bộ cũ (13.6) cộng phần mới của engine; mỗi dòng là một ca của bộ kịch bản (mục 9.4). Chưa có dòng nào thì chưa được bật loại đó.
- **R9. Luật "không nuốt lỗi"** cho code engine FB: mọi `catch` phải báo kết quả có mã hoặc ném tiếp; thêm vào script kiểm ranh giới để chặn
  `.catch(() => {})` và `console.error` đứng một mình trong cổng FB. Lỗi của chính hook `beforeNode` / `afterNode` thành kết quả SYS, không chỉ
  bọc `try/catch` rồi bỏ qua. Mọi lời gọi RPC của engine có hạn giờ ở app (hôm nay lời gọi DB không có, 13.6).
- **R10. Việc sau kết quả (anh chốt 16/11 khuya: như bộ cũ)**: đẩy data tìm được, sinh lượt Up tin sau khi đăng nhóm thành công
  (`campaignScheduler.ts:14235-14398`), đẩy sang SMS / akaBiz chạy trong cùng lượt như bộ cũ; bị ngắt thì mất phần chưa làm, không trùng.
  Không làm dấu "đã làm" / "lượt sau làm nốt" (bỏ bảng T4 và `followup_v1` khỏi V556).
- **R11. Mọi trạng thái dừng do engine đặt phải có lối ra**: data / tài khoản / chiến dịch bị "tạm dừng" hoặc khoá thì hoặc có hạn tự mở lại,
  hoặc có câu nói khách cần làm gì. Bảng duyệt (Q3) thêm cột "lối ra" cho từng mã.

### 13.4 Câu cho khách dễ hiểu, không lộ lỗi kỹ thuật

Đã có (5.4): giữ câu thành công của bộ cũ; câu lỗi lấy từ chính sách kèm mã ngắn; không lộ XPath, `waitForSelector timeout`, mã `err_*`.

Còn thiếu:
- **R12. Phủ mọi chỗ khách đọc**, không chỉ tiến trình: ghi chú data, ghi chú chiến dịch khi dừng / chờ, lịch sử hành động, thông báo chuông /
  email (V457 / V475 lấy "Lý do" từ ghi chú chiến dịch), Web / iOS. Mỗi mã một câu dùng chung cho mọi chỗ; bảng duyệt (Q3) có cột câu cho
  khách, anh duyệt từng câu như Zalo (anh chốt Q23, 16/11).
- **R13. Câu dừng / chờ nói rõ bước tiếp theo** (anh chốt Q23): "…, xử lý xong bấm Tiếp tục", hoặc "app sẽ tự chạy lại lúc 14:30"; câu này
  cũng nằm trong bảng duyệt.
- **R14. Lỗi chưa phân loại** (SYS99, FB42): câu chung dễ hiểu kèm mã, chi tiết kỹ thuật chỉ nằm ở `signal` / `auto_run_steps`. Khi dừng theo
  chuỗi lỗi thì giữ AI đọc ảnh để viết câu lý do như bộ cũ (anh chốt Q11); AI không trả câu thì dùng câu chung.
- **R15. Lỗi cấu hình** (thiếu block / workflow, code block hỏng; hôm nay khách thấy "Block không tìm thấy: blockId=…", `workflowEngine.ts:310`)
  thành mã CFG với câu "Loại chiến dịch đang được cập nhật, app sẽ tự chạy lại"; hàm kiểm ở R18 liệt kê ra khi anh hỏi. Data không bị đóng (bộ cũ
  đánh "hoàn thành" dù chưa chạy gì, 13.6).

### 13.5 Không để chiến dịch treo

| Nguyên nhân treo | Bộ cũ hôm nay | Phương án hiện tại | Còn thiếu |
|---|---|---|---|
| Cổng bảo trì đầu ngày: lease bộ cũ còn treo thì `tick()` chờ mãi, đứng cả nhân viên | treo tới khi đăng xuất / đăng nhập lại; máy ngủ rồi thức không tự khỏi | **engine FB chạy bên trong `tick()` nên vẫn đứng sau cổng này** (`campaignScheduler.ts:1705`, `:2101`), như Zalo hôm nay | **Đã chốt Q19: làm như Zalo** (R19) |
| Lượt bộ cũ lỗi đang chờ dọn (`failedCampaignRuns`, RAM) chặn cả hàng đợi của tài khoản (`:1290`, `:1857`) | treo tới khi dọn được hoặc đăng nhập lại | trong thời gian hai bộ cùng chạy trên một tài khoản, lượt engine cũng bị chặn | **Đã chốt Q19: làm như Zalo** (R19) |
| Block không bao giờ trả về (trang treo, promise không xong) | lượt treo, giữ token | heartbeat vẫn chạy nên lease không hết hạn: **chiến dịch đứng mà DB tưởng còn chạy** (mục 7.1 chờ block xong mới chốt) | R16, Q20 |
| Tab tài khoản chưa mở, chưa đăng nhập, checkpoint | chiến dịch đứng im, chỉ thấy khi bấm "Lý do đang chờ" | như cũ | R17, Q21 |
| Nhận lượt lỗi liên tục (ví dụ claim quá 3 giây, sự cố V532 ngày 14/11) | (Zalo engine) chiến dịch đứng, khách không thấy gì | như cũ | R17, R18 |
| Dừng theo chính sách (chuỗi lỗi, lỗi cấu hình) | tạm dừng, khách phải bấm tiếp tục, ghi chú có XPath | DB quyết | R11, R13 |
| Dòng `auto_runs` kẹt `running` | có (hook / lỗi giữa lượt) | chưa nói | R3 |

- **R19. Làm như Zalo, không tách cổng (anh chốt Q19, 16/11).** Engine FB vẫn chạy bên trong `tick()` và đứng sau cổng bảo trì như engine
  Zalo. Cổng chỉ đóng khi chính nhân viên đó còn lượt bộ cũ treo từ hôm trước, nên chỉ mở cho khách khi engine đã phủ đủ 13 loại FB: khách
  đã bật gần như không còn lượt FB bộ cũ. Trong lúc làm dở, chỉ tổ chức thử chịu rủi ro này. Zalo giữ nguyên (Q24).
- **R16. Nhận ra block treo** (anh chốt Q20, 16/11). Không giới hạn thời gian chạy của block. Treo nghĩa là **10 phút liền không có thao tác nào** bắt đầu
  hoặc kết thúc (engine thấy mọi thao tác qua lớp bọc `PageController`), không tính lúc block nghỉ theo cài đặt (`helpers.sleep`) và lúc máy
  ngủ. Block chạy lâu mà vẫn đang làm việc (vòng comment, cuộn trang) không bị cắt. Treo thì huỷ cửa sổ ẩn của tài khoản, ghi "không rõ kết
  quả" nếu đã có dấu "sắp gửi", nhả lease rồi chạy data kế. Thử thật 17/11 (`electron-real-smoke.cjs`): huỷ cửa sổ KHÔNG làm `executeJavaScript`
  đang chờ kết thúc (chỉ `loadURL` báo ERR_FAILED), nên vết thao tác tự kết thúc mọi lời gọi đang chờ (`PageTrace.abandonPending`) để block
  thoát; câu lỗi không thuộc nhóm "chắc chắn chưa gửi". Hôm nay `executeJavaScript`, `loadURL` và phần đọc kết quả của `apiCall` không có hạn giờ (`pageController.ts:150`, `:166`,
  `:676-680`); hạn 5 phút của `vm` chỉ phủ phần chạy đồng bộ của block (`blockExecutor.ts:76-95`).
  Đo 16/11 (17,3 giờ, 9.868 lượt FB, phụ lục A mục 29): 14 bước chạy quá 10 phút. Bước dài hợp lệ vẫn làm thao tác liên tục (nút `loop` tới
  40 phút, `fb_prepare_seeding_iterations` cuộn trang tới 54 phút) hoặc đang nghỉ theo cài đặt (`sleep` tới 17 phút). Bước chỉ làm một việc mà
  đứng 11–17 phút: mở trang (`nav_to_url`, 17 phút), chờ form đăng bài đóng (16,6), bấm lời nhắc đăng bài (16,1), mở hộp đăng bài (11,5), gửi
  hộp thư Page (11,1). Đó là kẹt chờ trang, hoặc máy ngủ giữa chừng (giờ trong `auto_run_steps` là giờ máy khách).
- **R17. Chiến dịch đến lịch mà không chạy được phải nói ra** (anh chốt Q21, 16/11): quá 10 phút thì ghi câu chờ vào ghi chú chiến dịch và
  tiến trình (mỗi khi lý do đổi), ví dụ "⏳ Chưa chạy được vì tài khoản chưa mở tab trình duyệt". Hôm nay bộ cũ bỏ qua im lặng tài khoản chưa
  đăng nhập (`campaignScheduler.ts:1783-1785`) và chỉ in dòng chung khi tab chưa mở (`:1801-1804`). Phần này nằm trong vòng lặp dùng chung
  nên Zalo trên Desktop cũng có. Lý do lấy cùng chỗ với nút "Lý do đang chờ"; nút này hôm nay chưa hiểu trạng thái của engine
  (`campaignPendingReasonService.ts` không đọc lease / `legacy_busy`), cần thêm. Chuông thông báo chưa thêm.
- **R18. Kiểm khi cần, không báo** (anh chốt Q22, 16/11: "ko cần báo, khi cần check tôi sẽ vào đây check"): một hàm chỉ đọc (cùng chỗ với
  hàm tra lỗi ở R1) liệt kê chiến dịch FB chạy bằng engine đã đến lịch mà không có tiến triển quá N phút (kèm lý do), lỗi chưa phân loại tăng
  bất thường, claim lỗi liên tục. Không có job chạy định kỳ, không gửi báo; anh hỏi trong phiên Claude thì chạy hàm / script này.

### 13.6 Kiểm kê lỗi của bộ cũ (đọc code, để dựng bảng R8)

Đọc code `dev_3` 16/11, chưa chạy thử; số dòng thuộc `campaignScheduler.ts` nếu không ghi tệp. Danh sách đầy đủ đưa vào bảng R8 ở đợt 0.

Treo:
- Cổng bảo trì chờ 2 giây/lần, không hạn (`dailyMaintenanceCoordinator.ts:47-76`); Desktop không hiện gì; nút "Lý do đang chờ" có thể trả
  "Chưa phát hiện điều kiện chặn" (`campaignPendingReasonService.ts:177`).
- RPC nhận lượt / nhận unit / chốt unit / nhường lượt lỗi thì thử lại 2 giây/lần mãi, giữ hàng đợi tài khoản (`:3691-3713`, `:9491-9516`,
  `:9703-9747`, `:3197-3228`); DB trả lý do lạ thì bỏ mặc chiến dịch "đang chạy" kèm token (`:9668-9672`, `:3139-3141`). Lời gọi DB của app
  không có hạn giờ (`supabaseClient.ts:30-46`).
- Block treo (R16): tạm dừng chỉ chờ; đăng xuất bỏ cuộc sau 30 giây và đăng nhập lại trong cùng tiến trình thì hỏng (`handlers.ts:718-730`).
- Thiếu workflow / block: data bị đánh "hoàn thành" dù chưa chạy gì (`:4866-4874`, `:4990-5040`).
- Vòng `count` / `forEach` không có trần; `while` mặc định 1.000 vòng và không thấy đầu ra của thân vòng (`workflowEngine.ts:505-580`).
- Danh tính Page chỉ nhớ trong RAM: app tắt ngang thì tài khoản kẹt ở danh tính Page (`facebookCampaignPageIdentity.ts:53-61`).
- Khoá "không thời hạn" không bao giờ tự mở (`:10583`); data bị chống gửi lặp đặt "tạm dừng" không tự chạy lại (`:7584-7589`).

Câu kỹ thuật lộ cho khách (ghi chú chiến dịch / data, lịch sử hành động, tiến trình):
- `Lượt chạy gặp lỗi: <lỗi gốc>` (`:1345`), ví dụ `output_invalid:fb_comment:write:TypeError: fetch failed`.
- Ghi chú data là lỗi gốc của block (`:4866-4874`, `:5005`): `waitForSelector timeout: <XPath>`, `Element not found: …`, `Block không tìm thấy:
  blockId=…`, mã `ERR_*` của Electron.
- `Dừng sau N data lỗi…: <lỗi gốc>` (`:10535`); lỗi kiểm hạn mức `…: TypeError: fetch failed` (`:4475`); câu lỗi của đăng nhóm, Page qua API,
  comment, nhắn tin, tìm data, danh tính Page, media, mời vào nhóm đều nối lỗi gốc (`:11051`–`:12543`, `:17786`, `campaignMediaSource.ts:18`).
- Dòng chung `Lỗi scheduler: …` có cả câu tiếng Anh (`:1824`).

Lỗi chỉ in console, khách và admin không biết:
- Sinh lượt Up tin lỗi, có thể đã tạo một phần (`:12305-12311`, `:14256-14266`).
- Đẩy data của tìm data sang chiến dịch / SMS / Zalo / akaBiz (`:12604`–`:14204`).
- Lướt FB hết giờ thì thôi chờ nhưng workflow vẫn chạy nền trên trang đã đóng (`facebookRestBrowse.ts:43-63`).
- Lưu lượt / bước / ảnh lỗi (`workflowEngine.ts:151`, `:241`, `:287`, `:367`, `:396`).
- AI viết lại lỗi thì dùng nội dung gốc và ghi lỗi gốc vào tiến trình (`:17389-17400`).

### 13.7 Việc khác chưa có trong phương án

- **Hai bộ đọc chéo dữ liệu của nhau**: engine ghi `auto_campaign_details.data` đúng các trường bộ cũ đọc (tìm data lọc "data mới" theo lịch sử,
  chống comment lặp, sinh Up tin, báo cáo hiệu quả), để tắt engine, hoặc nhân viên dùng bản Desktop cũ trong cùng tổ chức, vẫn đọc đúng.
  Mỗi đặc tả loại phải có mục này.
- **Tài khoản phụ** (`secondary_account_id`: đăng nhóm 46, nhắn UID 4 chiến dịch) chưa có trong đặc tả.
- **Web / iOS** dùng `runtimeBusy` để hiện "App Desktop đang hoàn tất mục tiêu hiện tại rồi mới dừng" và chặn nút Tiếp tục khi chiến dịch vừa
  tạm dừng mà Desktop còn đang chạy (WebApp `packages/campaign-core/src/desktopAccounts.ts:177`, `:203`). Cờ này tính từ token của bộ cũ
  (V476, mục 7.2), nên chiến dịch chạy bằng engine không bao giờ bật: Web cho bấm Tiếp tục ngay khi engine còn giữ lease. Cần thêm lease của
  engine vào cách tính (Zalo chạy engine trên Desktop cũng đang như vậy).

## Phụ lục A. Câu đọc production (16/11/2026, chỉ đọc, từng câu một)

Mọi câu chạy bằng `supabase db query --linked --workdir /Users/lequangnhut/Repos/akaAgent -f <tệp>` trong
`begin read only; set local statement_timeout = …; …; rollback;`, tuần tự, không đọc bảng lớn theo thời gian. Tệp câu và kết quả (có dữ liệu
khách) nằm ở scratchpad của phiên, không vào repo.

| # | Đọc gì | Kết quả chính |
|---|---|---|
| 1 | Sổ migration, cờ, danh mục loại FB | sổ tới V551 (16/11 11:34 VN); V531 (Up tin, #680) **chưa** merge, chưa apply; 479 tổ chức bật cờ; 13 loại FB, workflow 1–304 |
| 2 | Chỉ mục, chiến dịch FB 30 ngày | bảng 1.1; chỉ mục `idx_auto_campaign_details_action_rate (account_id, action_code, created_at)` dùng cho hạn mức |
| 3–5 | `auto_account_actions` FB, `auto_error` FB, chính sách / luật / cổng engine | 11 thao tác FB (`operation_class` có sẵn: 10 `delivery`, `fb_join_group` `idempotent`); 41 mã FB01–FB41; 43 chính sách FB (41 `seed_v495_error`, 2 `seed_v495_status`); 1 luật FB (bắt-tất-cả) |
| 6–8 | Workflow và code block FB | 13 workflow, 82 block; chỉ 4 block trả `actionResult` (27, 2616, 2835, 2836) |
| 9–10 | Mẫu 240.000 dòng lịch sử (6 dải id) | 20.828 dòng FB (8,7%), phân bố theo loại / thao tác / trạng thái / mã |
| 11, 15 | Tính năng trong `extra_settings` | bảng 1.2 |
| 12 | Giao cờ / FB, phiên bản Desktop, lượt engine | 24/244 tổ chức FB bật cờ; 24 giờ: 176 nhân viên 9.7.0, 43 9.5.0, 32 9.6.0, 29 9.1.0…; engine 7 ngày: Desktop 65.506 lượt / 366 tài khoản, Fly 19.618 / 181 |
| 13–14 | `auto_runs` 27 giờ, thiết lập Web FB | thời lượng bảng 1.1; `web.facebook_campaigns` bật cho tổ chức 1; trang cá nhân / newsfeed 0 dòng data |
| 16 | Token bộ cũ | 122/123 chiến dịch FB "đang chạy" giữ claim token; 119 tài khoản FB giữ token thao tác |
| 17–18 | Khoá kết quả và `policy_snapshot` của lịch sử FB | 2.072/2.072 dòng có `result_key` dạng `action-result-v1` và `operationState` |
| 19 | Ghi chú chiến dịch FB đang tạm dừng | bảng 1.4 |
| 20 | Hàng đợi ngẫu nhiên FB | 0 tài khoản bật |
| 21–23 | Presence, bucket lưu trữ, ảnh chụp hiện có, quyền đọc thiết lập | `aka_agent_device_presence` trả `boolean`; bucket riêng tư `outbox-attachments`, `agent-support-od-inputs`; 2.083 ảnh `browser_screenshot` 12–16/11, trung bình 508 KB; phiên Desktop đọc được mọi dòng `auto_system_settings` trừ khoá DeepSeek (gồm `media.storage.secret_access_key`) |
| 24 | Tài khoản FB chưa xoá theo trạng thái đăng nhập × bật đăng nhập tự động (16/11 chiều) | 1.638 tài khoản; 13 `checkpoint` (8 thường, 5 trong 11 tài khoản bật đăng nhập tự động), 3 đổi trong 7 ngày |
| 25 | Workflow / block FB đang dùng (16/11 chiều) | 13 loại FB đều có chiến dịch chạy 30 ngày (3–4.535 chiến dịch); 14 workflow (13 + `fb_campaign_rest_browse`), 84 block; 13 workflow test, 0 nhân viên bật chế độ test; 17 block `fb_` ngoài workflow chiến dịch (15 quét data, 1 làm giàu Web, 1 không thuộc workflow nào); 21/142 block không thuộc workflow nào; 10/84 block sửa trong 30 ngày |
| 26 | Ghi bước chạy (16/11 chiều; 50.000 lượt `auto_runs` gần nhất theo id, 1.500 lượt FB mẫu) | `auto_run_steps` 71 GB, `auto_runs` 22 GB, `auto_campaign_run_events` 26 GB; 50.000 lượt trong 5,7 giờ, 9.493 lượt FB (140 lỗi, 7 huỷ, 44 đang chạy); lượt FB trung bình 27 bước, ~9,9 KB |
| 27 | Dọn bảng lượt chạy (16/11 chiều) | không job pg_cron nào chạm `auto_runs` / `auto_run_steps` / `auto_campaign_run_events`; lượt cũ nhất 07/05/2026; FK `auto_campaign_run_events.run_step_id` chưa có chỉ mục |
| 28 | Máy đang kẹt cổng bảo trì (16/11 18:10 VN, `auto_staff_device_presence.runtime_state`, máy online 5 phút) | 145 máy online, 111 báo trạng thái: 38 đang chạy, 72 rảnh, 1 kẹt cổng (Desktop 9.7.0, nhân viên có chiến dịch FB 7 ngày, tổ chức chưa bật engine, kẹt từ 00:00:17 VN); 78 nhân viên thuộc tổ chức chạy engine Zalo đang online, 11 người trong đó có dùng FB, không ai kẹt |
| 29 | Bước chạy lâu của FB (16/11 tối; 50.000 lượt `auto_runs` gần nhất = 17,3 giờ, 9.868 lượt FB, bước của 60 lượt dài quá 10 phút) | 14 bước quá 10 phút: `fb_prepare_seeding_iterations` 54 phút, nút `loop` 40, `nav_to_url` 17, `sleep` 17, `fb_verify_group_post_form_closed` 16,6, `fb_click_group_post_prompt_if_present` 16,1, `fb_open_composer` 11,5, `fb_send_page_inbox_message` 11,1; `fb_prepare_seeding_iterations` có vòng `while` cuộn trang |
| 30 | Số comment cài đặt (16/11 tối; chiến dịch FB chưa xoá, chạy trong 30 ngày) | đăng nhóm / trang cá nhân bật comment: 710, đặt hơn 20 comment: 29 (28 trong 21–50, 1 trong 51–1.000; 26 chưa hoàn thành); comment seeding: 132, "Số bài cần comment trên mỗi group/page/profile" hơn 20: 9 (tối đa 1.000; 6 chưa hoàn thành) |
