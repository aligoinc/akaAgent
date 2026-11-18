# Engine v2 Facebook: tiến trình và mã lỗi về như bộ cũ (18/11/2026)

Nguồn: kiểm production 18/11 (engine FB bật mọi tổ chức từ 10:44 VN), so log tiến trình của cùng chiến dịch giữa bộ cũ (17/11) và
engine (18/11), cộng đọc code bản build Desktop 9.9.0 (`c6d41791`). Anh chốt từng mục qua hộp chọn chiều 18/11.

## Quyết định của anh

| # | Mục | Anh chốt | Ở đâu |
|---|-----|----------|-------|
| 1 | Comment seeding có Like thiếu "✅ Hoàn thành" (bước Like báo FB45 pha `in_flight` nên lõi coi là "không rõ đã gửi") | Đưa về như bộ cũ | lõi |
| 2 | Chiến dịch hẹn chạy lại sau N giờ: lõi thiếu 5 lý do kết thúc (`rerun_scheduled`, `completed_rerun_next_day`, `completed_rerun_after_cutoff`, `completed_rerun_no_data`, `completed_no_rerun_page`) nên không in dòng kết thúc | Đưa về như bộ cũ (câu bộ cũ) | lõi |
| 3 | Nhắn UID "Lấy đề xuất bạn bè": engine không có bước lấy đề xuất khi hết data | Làm bước này trong engine | Desktop |
| 4 | Mời vào nhóm: bộ cũ in dòng theo lô, engine in từng người | Giữ dòng từng người | (không đổi) |
| 5 | Đăng nhóm kèm chia sẻ bị bỏ qua: bộ cũ in `ℹ️ Bỏ qua "<data>": …`, engine in "✅ Hoàn thành" | Đưa về như bộ cũ | Desktop + lõi |
| 6 | Newsfeed hằng ngày khi mọi thao tác hết lượt: bộ cũ chuyển chiến dịch "hoàn thành" kèm lý do, engine chờ hôm sau | Về như bộ cũ | Desktop |
| 7 | Lỗi rơi về SYS99/FB42 kèm câu thô (XPath): phát mã cụ thể, tính lượt/chuỗi/dừng giữ như hiện tại (nguyên tắc 17/11) | Phát mã cụ thể; SYS99 còn lại vẫn "Có lỗi xảy ra" | DB (+ Desktop cho câu) |
| 7a | Comment không thấy ô bình luận → FB41, câu `Không comment được bài thứ 2: không thấy ô bình luận` (cả Lịch sử hành động của engine) | Duyệt | DB + Desktop |
| 7b | Hộp thư Page không thấy ô nhập tin → mã mới FB46 "Không thấy ô nhập tin nhắn trong hộp thư Page", bước tiếp theo "Mở tab trình duyệt của tài khoản để kiểm tra." | Duyệt | DB |
| 7c | Lỗi tệp ảnh / video (xem mục dưới) | Hai mã theo nguyên nhân, dừng ngay như Zalo | DB + Desktop |
| 8 | Dòng trùng (comment lỗi, inbox không thấy khách): dòng ⚠️ của bộ cũ + dòng có mã của engine | Giữ dòng có mã, bỏ dòng ⚠️ | Desktop |
| 9 | Dòng lỗi của engine (cả Zalo) không emoji, không tên data | Emoji + tên data, cả Facebook và Zalo: ❌ data đã đóng mà không thành công, ⚠️ data sẽ chạy lại hoặc không rõ kết quả | lõi (Zalo trên Fly cần chép lõi sang ChatApi + deploy worker) |
| 10 | `ERR_NETWORK_IO_SUSPENDED` (và `ERR_INTERNET_DISCONNECTED`, `ERR_NETWORK_CHANGED`) khi mở trang trước lúc gửi đang ra FB44, đóng data | NET01 "Kết nối mạng tạm thời gián đoạn", trả data về hàng đợi, không tính chuỗi | DB |
| 11 | Câu chờ hạn mức ngày "chạy tiếp lúc 00:00 19/11" (chiến dịch thật ra chạy theo giờ đã cài) | `Đạt giới hạn trong ngày, chạy tiếp vào ngày 19/11 (LIM01)` | DB |
| 12 | Dòng 🔀 xáo trộn danh sách nhóm, dòng ⏸ khi chính sách tạm dừng | Đã có ở `dev_3` (7009f631, 876a6ab4), vào lần build kế tiếp | — |

Mẫu dòng lỗi đã duyệt:

```
❌ Đăng bài group "Cộng Đồng iPhone Việt Nam": Không thấy ô đăng bài trong nhóm (FB40)
⚠️ Đăng bài group "Chợ Nha Trang": Kết nối mạng tạm thời gián đoạn (NET01)
❌ Nhắn tin người lạ "0912 345 678": Người nhận chặn tin nhắn từ người lạ (Z122)
⚠️ Nhắn tin người lạ "0987 654 321": Không xác nhận được tin đã tới; không gửi lại để tránh trùng (UNK01)
```

Câu đã mở đầu bằng tên thao tác thì tên data chèn ngay sau tên thao tác (`⚠️ Nhắn tin người lạ "Khánh" thất bại: read ECONNRESET (Z999)`);
câu đã chứa tên data thì không lặp. Dòng thành công và dòng "đã làm từ trước" (đã là bạn bè…) giữ như cũ, không emoji.

### Lỗi tệp ảnh / video (mục 7c)

Anh hỏi lại 18/11 khi thấy Zalo đã có CFG01 "Không dùng được tệp media của chiến dịch" (Zalo tạm dừng chiến dịch ngay, data giữ lại) và
Facebook cũng gặp lỗi tải tệp từ kho lưu trữ (log 14–17/11: Facebook 50 lần tệp không còn trên máy, 8 lần tải không được; Zalo 12 và 45).
Anh chốt **hai mã theo nguyên nhân**, cùng bước tiếp theo, cùng cách xử lý của CFG01 (tạm dừng chiến dịch ngay, data về hàng đợi, không ghi
lịch sử, không cộng chuỗi):

| Mã | Khi | Câu | Bước tiếp theo |
|----|-----|-----|----------------|
| CFG20 `err_media_local_file_missing` (mới) | tệp chỉ có đường dẫn trên máy mà không còn | Ảnh, video hoặc tệp của chiến dịch không còn trên máy | Mở chiến dịch, chọn lại ảnh, video hoặc tệp rồi bấm Tiếp tục chiến dịch. |
| CFG01 `err_media_file_missing` (đổi câu) | tải tệp từ kho lưu trữ không được, mục không có nguồn | Không tải được ảnh, video hoặc tệp của chiến dịch | như trên |

Facebook: luật theo câu lỗi trong block (V575) + Desktop gửi thẳng mã ở bước dựng biến (bản app sau). Zalo: Desktop gửi CFG20 từ bản app sau
(`campaignMediaSource.ts` mang nguyên nhân `failure`, `campaignMediaErrorCode`); tới lúc đó Zalo vẫn CFG01 cho cả hai nguyên nhân. Fly chỉ có
lỗi tải (máy chủ không có tệp trên máy khách) nên không cần sửa ChatApi. Bộ cũ không đổi (đọc `noti_*`, câu lỗi giữ nguyên).

## Đã làm (nhánh `claude/fb-engine-progress-parity`)

- Lõi (`packages/campaign-engine`): `formatTargetActionLog`, `outcomeProgress` (mục 9), 5 lý do kết thúc chạy lại sau N giờ (mục 2),
  `targetSkippedProgress` + `WorkflowTargetEnd.skippedNote` (mục 5), FB45 không làm mất "✅ Hoàn thành" (mục 1),
  `mediaUnavailableError(message, errorCode)` (mục 7c).
- Desktop: `prepareFacebookSuggestedFriends` qua `prepareTargets` của lõi, chỉ khi chiến dịch chưa có data (`hasTargets`, như bộ cũ) (mục 3);
  `reportFacebookEngineRows` trả `skippedInputNote` (mục 5), bỏ dòng ⚠️ trùng (mục 8), câu FB41 bỏ XPath (`rewriteFacebookSignMessage`, mục
  7a); `completeEngineNewsfeedDailyWhenLimited` (mục 6: claim báo like / comment đều chờ hạn mức khi bật "Tiếp tục khi chạm giới hạn", đọc lại
  đúng bước kiểm của bộ cũ rồi `completeNewsfeedDailyWithoutNextDay`); mã lỗi tệp theo nguyên nhân (mục 7c).
- DB: [V575](../migrations/migration_v575_engine_specific_codes_wait_note.sql) (sinh bằng `scripts/build-v575-sql.cjs`, đã apply 17:08:06 VN 18/11):
  FB46 + CFG20, câu mới của CFG01, chính sách FB41 khi comment ở 4 loại có dấu hiệu (đăng nhóm, comment seeding, trang cá nhân, newsfeed:
  tính lượt, câu như FB42 hôm nay; Up tin giữ FB41 của block như bộ cũ), FB46 (như SYS99 hộp thư Page), CFG20 (như CFG01), dấu
  hiệu FB41 / FB46, luật NET01 cho 3 lỗi mạng trước lúc gửi, luật lỗi tệp Facebook, `aka_agent_engine_wait_note` chờ tới 00:00 chỉ ghi ngày
  (áp cả Zalo vì cùng mã LIM01). Kiểm trước / sau trong file so chính sách gộp của mã mới với mã hôm nay.

## Kiểm thử (anh hỏi 18/11)

1. `node scripts/engine-v2-facebook/v575-smoke.cjs`: bản sao danh mục production đọc 18/11 (`scripts/fixtures/engine-v2-facebook/v575-catalog-20261118.json`,
   cột / chỉ mục / ràng buộc / trigger / dòng của 5 bảng, thân 10 hàm), chạy nguyên văn V575, so mọi quyết định trước / sau (chính sách gộp
   của mọi mã × 9 thao tác FB + 5 thao tác Zalo × nơi chạy × pha, phân loại tín hiệu mẫu, câu chờ của mọi mã): chỉ đổi đúng chỗ anh chốt;
   không apply lại được; bản gỡ trả về như cũ. 10/10.
2. `node scripts/engine-v2-facebook/desktop-fb-smoke.cjs` (bộ lập lịch Desktop thật, trang Facebook giả, V575 trên DB thử): thêm FB41 (một
   dòng ❌ có tên nhóm, không XPath, không dòng ⚠️ trùng, tính lượt như FB42), CFG20 / CFG01 (dừng ngay, data giữ lại), lấy đề xuất bạn bè,
   newsfeed hết lượt (hoàn thành như bộ cũ / chờ với câu chỉ ghi ngày). 32/32.
3. `node scripts/engine-v2-facebook/core-smoke.cjs` (FB45 vẫn "✅ Hoàn thành", "ℹ️ Bỏ qua") 13/13;
   `node scripts/engine-v2-facebook/progress-format-smoke.cjs` (định dạng dòng, câu chạy lại so chữ bộ cũ, dấu hiệu, nguyên nhân lỗi tệp) 6/6.
4. Bộ kiểm có sẵn: engine FB (error-signs, wait-reason, page-trace, policy-parity, sql, workflow-hooks), engine Zalo
   (`scripts/campaign-outcome-engine-check-all.cjs`; sửa câu mong đợi theo định dạng mục 9 ở core, Desktop, V504, V506).
5. Phát lại lịch sử thật: `export-replay.cjs` chép thêm dòng tiến trình bộ cũ (`auto_campaign_logs`, chỉ đọc), `replay.cjs` in bảng loại dòng
   tiến trình bộ cũ → engine trong cửa sổ các lượt đã phát lại (`--before-v575` để so trước V575). Chạy 18/11 trên mẫu 3 ngày (120 chiến dịch,
   1.101 lượt bộ cũ, 51.281 dòng tiến trình; dữ liệu khách chỉ ở scratchpad): dòng lịch sử khớp 1.138, khác chưa giải thích 2, cả hai có sẵn
   trước V575 (Up tin 51975: bộ cũ không ghi dòng, engine ghi FB03 + SYS99; đăng nhóm 55640: bộ cũ không ghi dòng, engine ghi "Đăng bài thành
   công"). Lần chạy đầu bắt được dòng FB41 viết chung cho mọi loại làm Up tin (FB41 do block tự phát từ V472) bị tính lượt và đổi câu; đã thu
   hẹp về 4 loại có dấu hiệu, phát lại lại không còn. Chiến dịch 18648 (ảnh không còn trên máy): trước V575 ghi "lỗi" SYS99 và đóng data, sau
   V575 tạm dừng ngay với câu CFG20, data giữ lại (bộ cũ cũng để data chờ). Bảng loại dòng tiến trình chỉ còn khác đúng các chỗ anh chốt
   (dòng lỗi có emoji + tên data, FB41 không XPath, CFG20, FB03 / FB40 câu đã duyệt) và chỗ của bản giả (nghỉ 0 giây nên không có "⏳ Nghỉ";
   bộ giả chưa có `listDataTypeCategoryItems`, `getGroupContactByTarget`, `createCampaign` nên thiếu dòng đẩy data, "Bỏ qua đăng bài", "Đã thêm
   lượt up tin").

Không dùng giao diện Facebook thật; mục nào phụ thuộc trang thật thì xin anh thử ở "Nhóm private 1".

## Triển khai

1. Apply V575 (đã làm 17:08:06 VN 18/11; ngoài giờ cao điểm: `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema). Kiểm sổ và mọi repo (akaAgent, akaAgentWebApp,
   akaAgentChatApi, SqlServerDashboard) ngay trước khi apply vì số dùng chung. Hiệu lực ngay với mọi bản app: FB41 / FB46 / NET01 / lỗi tệp
   Facebook trong block / câu chờ / câu CFG01.
2. Build Desktop (sau V575: bản app gửi thẳng mã CFG20, DB chưa có mã thì phân loại theo luật cũ): định dạng dòng (mục 9), các mục 1, 2,
   3, 5, 6, 8, câu FB41 bỏ XPath.
3. Zalo trên Fly: chép lõi sang ChatApi (`scripts/sync-campaign-engine.cjs`), PR ChatApi, deploy `worker` (định dạng dòng mục 9).

## Tình trạng

Code + V575 + bộ kiểm đã merge `dev_3` qua [#709](https://github.com/aligoinc/akaAgent/pull/709) ngày 18/11 theo yêu cầu ("ok create pr rồi merge đi"),
nhánh `claude/fb-engine-progress-parity`. Chưa build Desktop, chưa chép lõi sang ChatApi.

**V575 đã apply akachat 17:08:06 VN 18/11** theo yêu cầu ("apply bây giờ luôn được ko?"). Dòng sổ `20261118100806`, md5 sổ = file
`80d0fc41…`, **không apply lại**. Trước khi apply, các điểm kiểm trước của file khớp production (đọc 17:07 VN). Sau apply:
- kiểm sau trong file đạt; thân câu chờ `17e1824c…`, dấu hiệu `797af974…`; `aka_agent_engine_policy_lint` rỗng.
- PostgREST nạp lại schema 5,2 s: trong 10 giây đó có 704 request REST quá 1 s (lâu nhất 4,8 s), 0 lỗi 5xx / 503, từ 17:08:20 về như cũ.

[Biên nhận](../migrations/snapshots/engine-v2-progress-parity-v575/apply-receipt.json).

Chạy lại toàn bộ trên code cuối, 18/11 ~17:20–17:35 VN (DB thử như production sau V575; scratchpad, không chạm DB thật):
- **Kiểm tĩnh:** typecheck main / renderer / lõi đều 0 lỗi; `npm run build` đạt.
- **Smoke Facebook (18 bộ, đều đạt):** sql 34, policy-parity 15, copy 7, core 13, workflow-hooks 10, page-trace 6, screenshots 4, autocheck 4,
  wait-reason 6, error-signs 6, legacy-catalog 4, progress-format 6, v575 10, desktop-fb 32, v564 12, v563 16, v572 17, electron-real 5.
- **Kịch bản sự cố Facebook** (`scenarios.cjs --seeds 20 --crash 0.08 --dbchaos 0.05`, có V575): 20 hạt giống, 120 chiến dịch, 1.108 cú
  gửi, tiêm 248 lỗi trang và 211 lỗi DB, không vi phạm bất biến nào.
- **Phát lại dữ liệu thật:** khớp 1.138 dòng lịch sử, 0 khác đã chốt, 2 khác chưa giải thích. Hai chỗ này đã có trước V575 (lần đó khớp 1.135,
  3 đã chốt, 2 chưa giải thích): một lượt Up tin engine ghi lỗi + thất bại, một lượt đăng nhóm engine ghi thành công, cả hai bộ cũ không ghi
  dòng nào. Kết quả trùng lần chạy trước khi đổi số (chỉ khác đường dẫn thư mục tạm).
- **Zalo:** check-all 33/33 bước. Kịch bản 708 lượt / 5.250 lần gửi, chạy hai lần (DB như hôm 14/11, và DB như production tới V575 với
  `SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_CAMPAIGN_REPEAT=1 SCENARIO_TARGET_CHECK=1 SCENARIO_V575=1`), cả hai 0 vi phạm mới, 1 đã biết (data
  trùng trong cùng lô chia sẻ, bộ cũ cũng vậy).

Thấy thêm khi chạy, chưa sửa: lỗi "không tìm thấy ô để nhập tin nhắn" ở hộp thư Page ra pha `in_flight` / không rõ đã gửi. Lý do: bước gửi
block 2885 khai `commit_level` 1, `send_ops` rỗng. Production 30 giờ: 7/8 lượt SYS99 hộp thư Page. Data và cách tính không đổi, nhưng dòng mới
sẽ hiện ⚠️ thay ❌ của bộ cũ. Đổi pha là đổi hành vi, chờ anh quyết.

Hiệu lực:
- ngay với mọi bản app: FB46, CFG20, câu CFG01, luật NET01 và lỗi tệp Facebook, câu chờ chỉ ghi ngày;
- FB41 / FB46 theo dấu hiệu: trong vòng 10 phút, vì Desktop đọc lại `facebook.error_signs` mỗi 10 phút;
- phần còn lại chờ bản Desktop mới và lõi trên ChatApi.

Đổi số từ V574 lúc ~17:05 VN 18/11: nhánh `claude/fb-error-watch` (PR #708) đã đẩy `migration_v574_engine_error_watch.sql` lúc 16:20 VN.
Lúc đổi, V575 còn trống ở sổ production và ở nhánh của akaAgent, akaAgentWebApp, akaAgentChatApi, SqlServerDashboard. Số chỉ chắc khi
đã có dòng trong sổ, nên ngay trước khi apply phải kiểm lại. md5 file: migration `80d0fc41…`, bản gỡ `360b8c6c…`. Thân câu chờ sau apply
(`17e1824c…`) và dấu hiệu sau apply (`797af974…`) không đổi khi đổi số. Chạy lại sau khi đổi số: `v575-smoke` 10/10, `desktop-fb-smoke`
32/32, `progress-format-smoke` 6/6.
