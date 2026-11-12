# Lọc trùng trong "Thêm data" của chiến dịch đã tạo (Desktop) — 12/11/2026

Trạng thái: **đã merge `dev_3` qua #645 (nhánh `claude/jolly-lamport-3rmla9`, tạo từ `dev_3` tại `24ff928`), chưa build/phát hành Desktop**. Không migration, không RPC mới, không đổi quyền DB. Bản Web: akaAgentWebApp `docs/CAMPAIGN_ADD_DATA_DUPLICATES.md` (đã merge `dev` qua #209, chưa deploy). Nền: [CAMPAIGN_INPUT_DUPLICATES_DESKTOP_V493.md](CAMPAIGN_INPUT_DUPLICATES_DESKTOP_V493.md) (lọc trùng với chiến dịch khác, V491/V493).

## Khách thấy gì

Màn Thêm data (menu Hành động của chiến dịch → Thêm data; [AddDataToCurrentCampaignModal.tsx](../src/renderer/src/components/CampaignPanels/AddDataToCurrentCampaignModal.tsx), tách khỏi `CampaignPanel.tsx`) giống Web:

- Dòng đầu có thêm **Tài khoản** của chiến dịch.
- Khối **Kiểm tra trùng** trên "Data chờ thêm" (khi danh sách có data, không hiện với "Thêm bằng nhóm"); không bao giờ khóa nút Thêm.
- **Dòng 1 "Trong chiến dịch này"** (mọi loại có Thêm data, kể cả Facebook/email/link group): tự xem trước sau mỗi lần chèn, `2/5 data đã có trong chiến dịch này · sẽ bỏ qua khi thêm.`, ô **Bỏ qua khi thêm** (ô "Bỏ qua data đã có trong chiến dịch" cũ dời lên), **Xem**, **Excel** (9 cột template, nhập lại được). Lỗi: "Chưa xem trước được…" + **Thử lại**. Công tắc tắt hoặc loại không hỗ trợ: chỉ còn câu "Khi bấm Thêm, hệ thống bỏ qua data đã có trong chiến dịch này." và thôi gọi.
- **Dòng 2 "Với chiến dịch khác"** (chỉ `zalo_message_phone`, khi công tắc lọc trùng mở cho phiên và chiến dịch có tài khoản): nút **Kiểm tra trùng** mở hộp đối chiếu cả danh sách chờ thêm; data chèn từ cửa sổ Upload với lựa chọn 2/3 tính là đã đối chiếu.
- Bộ lọc **Tất cả / Chưa có / Đã có trong chiến dịch** + cột "Kiểm tra trùng". Cột theo loại định danh: SĐT, UID/link, Email chỉ hiện khi loại chiến dịch cần hoặc có dòng nào có giá trị (trước đây luôn đủ ba cột).
- Chèn nhiều lần: dòng cùng khóa với danh sách chờ thêm bị bỏ (`Bỏ N data đã có trong danh sách.`). Trước đây Desktop giữ cả hai và chỉ lọc lúc ghi.
- Chân form: `Sẽ thêm 3 data · bỏ qua 2 data đã có trong chiến dịch.`, nút **Thêm 3 data**. Riêng Desktop: dòng không có định danh hợp lệ (biết ngay trên máy, cùng luật lúc ghi) bị trừ khỏi số và ghi thêm `· bỏ N data không hợp lệ`.

Hộp **Kiểm tra trùng với chiến dịch khác** ([CampaignAddDataDuplicateDialog.tsx](../src/renderer/src/components/CampaignPanels/CampaignAddDataDuplicateDialog.tsx)), chép từ Web: chọn sẵn **Các tài khoản Zalo bạn chọn** (tài khoản Zalo chưa xoá của danh sách tài khoản đã tải trong app; lần đầu chọn hết, sau đó nhớ) hoặc **Chỉ tài khoản của chiến dịch này**; 7/14/30/90 ngày hoặc tự nhập; nhớ chung khóa `aka.campaignImportDuplicates.v1:<org>:<staff>` với cửa sổ Upload ([utils/inputDuplicateMemory.ts](../src/renderer/src/utils/inputDuplicateMemory.ts)); gọi IPC `campaign:input-duplicates` tuần tự 1.000 số/lượt, luôn kèm `excludeCampaignId`; IPC không hủy được nên **Hủy kiểm tra** dừng trước lượt kế và bỏ kết quả lượt đang chạy. Kết quả, **Tải Excel**, **Bỏ N số** / **Giữ nguyên** / **Xong** như Web.

Cửa sổ Upload mở từ Thêm data: mô tả lựa chọn 2 đổi thành chữ của Web ("Chỉ so với chiến dịch khác của tài khoản <tên>…"); form tạo giữ chữ cũ. Mặc định vẫn "Chỉ trong file này".

## Hợp đồng

- Luật dùng chung: [src/shared/campaignAppendData.ts](../src/shared/campaignAppendData.ts) — khóa so trùng (`appendInputDataDedupeKeys`, chuyển nguyên từ `campaignRepository.ts`), chuẩn hóa định danh như lúc ghi, `classifyAppendInputData` (không hợp lệ → trùng trong lượt → đã có → nhận), hợp đồng IPC, công tắc. **Không chép từ WebApp**: luật Desktop rộng hơn (`CAMPAIGN_INPUT_DATA_REQUIREMENTS`: Facebook, email, link group, SĐT hoặc UID…), WebApp chỉ 9 loại Zalo/SMS. `parseAppendPreviewEnabled` giống nguyên văn WebApp.
- Đường ghi `addCampaignInputDataRows` ([campaignRepository.ts](../src/main/data/repositories/campaignRepository.ts)) dùng đúng hàm phân loại đó; hành vi và con số trả về không đổi (smoke so với luật của `dev_3` trên 151.200 dòng). Câu đọc khóa đã có thêm `order('id')` để các trang 1.000 dòng ổn định khi dòng đang bị cập nhật (PostgREST phân trang bằng OFFSET); xem số đo bên dưới.
- IPC `campaign:add-data-preview` ([service](../src/main/services/campaignAddDataPreviewService.ts), preload `campaignAddDataPreview`): yêu cầu `{campaignId, items:[{phone?,uid?,email?}]}` 1–10.000 dòng (phone ≤ 64, uid ≤ 10.000, email ≤ 320 ký tự), trả `{ok:true,data:{checkedAt, campaignInputCount, itemCount, existingIndexes[], batchDuplicateIndexes[], invalidIndexes[]}}` hoặc `{ok:false,code,message}`, không ném lỗi. Chỉ đọc: một dòng công tắc, chiến dịch theo `id + staff_id + organization_id + is_delete=false` (không chặn theo trạng thái), cột định danh của data chiến dịch (trang 1.000 dòng theo id). Tối đa 2 lượt cùng lúc mỗi tiến trình (`append_preview_busy`, không xếp hàng), hạn 20 giây (`append_preview_timeout`, hủy cả câu đọc). Mã khác: `append_preview_disabled`, `campaign_append_unsupported` (Nhóm data, realtime, hủy lời mời, newsfeed), `campaign_not_found`, `invalid_append_preview_request`, `append_preview_failed` (đọc công tắc lỗi cũng vào đây để khách bấm Thử lại), `session_invalid`.
- Renderer chỉ gửi dòng có khóa chưa xem trước, nhớ kết quả theo khóa trong phiên form, gửi tuần tự 10.000 dòng/lượt; `append_preview_disabled`/`campaign_append_unsupported` = thôi gọi trong phiên, lỗi khác chờ Thử lại; đổi danh sách giữa chừng thì bỏ kết quả lượt cũ.
- Công tắc: trường tùy chọn `appendPreview` trong `web.campaign_input_duplicates` (chung với Web; thiếu = bật, chỉ `false` tắt), main đọc lại mỗi lượt. `audience` của dòng này chỉ quyết định dòng 2 (đọc một lần khi mở form qua `campaign:input-duplicates` kind `setting`).

## Số đo (chỉ đọc, production 12/11/2026)

Chiến dịch lớn nhất kiểm (9811, `zalo_message_phone`, 11.792 dòng sống), `EXPLAIN (ANALYZE, BUFFERS)` câu PostgREST tạo ra: có `ORDER BY id` mỗi trang đọc hết dòng của chiến dịch qua `idx_campaign_input_data_campaign_id` rồi sắp xếp (3.035–3.041 buffer, 10–26 ms); không sắp xếp thì trang k đọc (k+1)×1.000 dòng (trang đầu 54 buffer, trang cuối 3.035). Cả lượt 12 trang có sắp xếp ≈ 36.000 buffer (~0,2 s), gấp khoảng đôi bản không sắp xếp; chỉ chạy khi xem trước hoặc bấm Thêm. Web đọc cùng cách.

## Kiểm thử

- `node scripts/campaign-add-data-preview-smoke.cjs` (không DB, PostgREST giả trong bộ nhớ, bundle đường ghi + service thật): luật mới = luật `dev_3` trên 151.200 dòng × 14 loại (cả dòng thô và dòng đã chuẩn hóa như lúc ghi); xem trước = đường ghi thật trên 6 loại (đã có / trùng trong lượt / không hợp lệ / số dòng chèn), câu đọc theo trang id, xem trước không ghi gì; công tắc, kiểm tra yêu cầu, quyền sở hữu, loại không hỗ trợ, giới hạn 2 lượt, hạn giờ, phiên. 8/8.
- `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/campaign-add-data-duplicates-ui-smoke.cjs` (form thật + cửa sổ Upload thật trên Electron, IPC giả, chặn mọi mạng): 14/14 — form trống; chèn → một lượt xem trước, "2/5 đã có", câu/nút chân form, cột theo loại; bộ lọc, Xem, Excel; ô Bỏ qua khi thêm; chèn lặp bị khử trùng, chỉ xem trước khóa mới, xoá dòng không gọi lại; hộp Kiểm tra trùng (chọn sẵn tài khoản, 14 ngày, một lượt kèm `excludeCampaignId`, Excel, Bỏ 1 số, nhớ số ngày); Kiểm tra lại (chỉ tài khoản chiến dịch, Hủy, lỗi + Thử lại, Xong); Giữ nguyên; Upload lựa chọn 3 tính là đã đối chiếu; gửi Thêm đúng danh sách/cờ; xem trước lỗi/Thử lại/kết quả cũ bị bỏ/công tắc tắt; công tắc lọc trùng tắt; chiến dịch email và thêm thành viên; danh sách 3.000 dòng (một lượt xem trước; cả chuỗi chèn → xem trước → vẽ 4,4 s trong bài, bundle phát triển, gồm cửa sổ Upload); không lỗi trang.
- **Dữ liệu thật, chỉ đọc** (`node scripts/campaign-add-data-replay.cjs <file>`, SQL lấy dữ liệu ở đầu script): 269 phiên "thêm data sau khi tạo" của 6 ngày tới 12/11/2026 (132 chiến dịch, 6 loại: SĐT Zalo, tham gia nhóm Facebook, bạn bè Zalo, thành viên nhóm Zalo, nhắn UID Facebook, đăng nhóm Facebook), 58.182 dòng, chép 88.395 dòng định danh. Bộ phân loại Desktop so với kỳ vọng tính bằng khóa của DB (`normalize_phone`, UID `lower(trim, bỏ / cuối)`): 0 phiên lệch, 0 khóa lệch. 48/1.017 dòng tham gia nhóm Facebook là nhóm đã có sẵn trong chiến dịch (xem trước sẽ báo "đã có"). Hàm chuẩn hóa SĐT Desktop trùng nguyên văn WebApp, bản đã khớp `normalize_phone` trên ~1 triệu biến thể (kiểm của Web).
- Chạy lại sau khi đổi: `scripts/campaign-input-duplicates-service-smoke.cjs` 11/11, `scripts/campaign-input-duplicates-ui-smoke.cjs` (cửa sổ Upload) 11/11 — locator lựa chọn 3 phải neo đầu chuỗi vì mô tả lựa chọn 2 mới nhắc tên lựa chọn 3; thêm khẳng định chữ lựa chọn 2 của Thêm data và của form tạo. `run-campaign-data-sort-ui-smoke.cjs` (dựng `CampaignPanel` thật) hỏng ở `assertTwoRowToolbar` cả trên `dev_3` sạch `24ff928`, không do thay đổi này.
- Hai typecheck, `NODE_OPTIONS=--max-old-space-size=8192 npm run build` đạt.

## Giới hạn

- Dòng 2 chỉ cho `zalo_message_phone` (như V491). "Thêm bằng nhóm" không đổi.
- Số xem trước có thể cũ nếu chiến dịch nhận data từ nơi khác trước khi bấm Thêm; lúc ghi vẫn lọc lại.
- Tài khoản để chọn trong hộp lấy từ danh sách đã tải của app (không đọc lại DB); DB kiểm lại quyền từng tài khoản.
- Trạng thái đã đối chiếu chỉ sống trong phiên form; "Xoá tất cả" hoặc chọn nhóm thì đặt lại.

## Gỡ

Tắt xem trước cho cả Web và Desktop: thêm `"appendPreview": false` vào giá trị `web.campaign_input_duplicates` (không cần phát hành). Gỡ code: revert các commit của nhánh; không có gì trong DB.
