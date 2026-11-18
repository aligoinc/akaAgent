# V576: engine v2 đóng lượt data bị bỏ dở cho đúng (A, B, D1)

Số V576 là số tạm: sổ production tới V575 lúc viết (18/11/2026 17:40 VN). Kiểm lại sổ và `git log --all` ngay trước khi apply; đổi số thì
sửa `NUMBER` trong `scripts/build-v576-sql.cjs` rồi sinh lại (md5 thân hàm không đổi theo số).

Anh chốt 18/11/2026 "Làm A, B, D1" sau khi chẩn đoán hai lượt lạ lúc kiểm sức khoẻ engine Facebook. Chỉ đổi DB, không phát hành app.

## Hai lượt đã tra

- **175931** (staff 661, Windows 9.9.0, đăng nhóm): 13:20:20 VN claim tạo lượt cho một nhóm, DB trả 200 sau 63 ms nhưng app không nhận được
  câu trả lời ("Mất kết nối máy chủ (DB01)"), 1 giây sau gọi lại claim cùng lease và nhận nhóm kế. Lượt cũ thành mồ côi, lease được heartbeat
  giữ suốt 3 giờ nên `close_stale` không đóng được, `release_v1` bị từ chối (`open_target_runs`). 16:13 khách thoát app: hàm reset của Desktop
  đánh nhóm đó "hoàn thành – Dừng đột ngột…" dù chưa đăng. Nhóm không được đăng ngày 18/11. Không gửi trùng.
- **179149** (staff 462, Windows 9.9.0, nhắn khách inbox Page): gửi thành công lúc 14:00:11, máy ngủ ngay sau đó 11 phút (thức dậy đổi IP),
  lease 180 giây hết hạn. 14:11:35 app báo kết quả: DB ghi lịch sử "thành công" nhưng trả `ownership_lost`; lõi dừng không gửi lần chốt
  (`runUnit.ts:802`, `:953`). 14:13 `close_stale` thấy dấu gửi nên đóng SYS02 "Bị ngắt khi đang gửi, không rõ kết quả". Không trùng, không mất,
  ghi chú sai.

## Sửa gì

| | Ở đâu | Trước | Sau |
|---|---|---|---|
| A | `reset_desktop_running_statuses_no_retry` (Desktop đăng nhập / đăng xuất / thoát), thêm đúng một lời gọi `aka_agent_engine_close_desktop_runs_v1` trước bước đánh dấu data | data "đang chạy" của lượt engine bị đánh "hoàn thành – Dừng đột ngột…" (FB / Email) hoặc "Dừng do thay đổi chế độ runtime…" (Zalo), kể cả khi chưa gửi gì | lượt engine còn mở của nhân viên trên Desktop đóng như engine: chưa ghi dấu → về hàng đợi (SYS01), đã ghi dấu → hoàn thành (SYS02); data không có lượt engine giữ cách cũ |
| B | `aka_agent_engine_close_stale_v1`, vòng mới trước vòng cũ | lượt mồ côi treo tới khi lease hết hạn + 10 phút (lượt dài: hàng giờ) | lượt chưa ghi dấu, chưa có kết quả, mở quá 2 phút, mà cùng lease đã có lượt bắt đầu sau nó ≥ 3 giây (≤ 15 phút) đã chốt `reported` → về hàng đợi ngay (lượt sau chạy lại; lượt này không nhận lại vì claim bỏ qua data đã thử với lease) |
| D1 | `aka_agent_engine_close_run_v1` (hàm đóng một lượt, dùng chung cho close_stale và A) | lượt đã ghi dấu bị bỏ dở luôn đóng SYS02, kể cả khi mọi bước gửi đã có kết quả | mọi dấu đã có kết quả (không còn `pending`) → chốt theo kết quả đã ghi bằng lần chốt rỗng của `report_v1`; giữ nguyên chuỗi data lỗi; dấu còn `pending` hoặc chiến dịch có token bộ cũ → như cũ |

Chi tiết từng điều kiện:

- **B không đụng**: lượt cùng một lần nhận cả lô (`claim_batch_v1` nhận cả lô trong một lần gọi ≤ 1,5 giây, nên lượt sau < 3 giây không tính);
  lượt đã ghi dấu; lượt có kết quả; lượt mới nhận < 2 phút (`engine.orphan_target_seconds`, mặc định 120, tối thiểu 30; chưa có dòng thiết lập).
  Nhóm kèm chia sẻ Facebook chỉ chốt sau cú bấm Đăng, lúc data chính đã ghi dấu, nên data chính đang chạy không khớp điều kiện.
  Lần gọi lại claim nhanh (≤ 3 giây) thì B chờ tới khi data kế tiếp nữa chốt.
- **D1** gọi `report_v1(lượt, lease, '[]', p_final := true)`: như lõi chốt khi bị dừng. Lease đã mất nên không áp hiệu ứng chiến dịch / tài khoản;
  data đã giao không về hàng đợi (luật `no_requeue_after_delivery` của report_v1). Chuỗi data lỗi chụp trước và trả lại sau (lượt đã bị bỏ,
  data sau có thể đã chạy). Lỗi ở bước này thì quay về cách cũ (khối EXCEPTION).
- **A** chạy với quyền của hàm (SECURITY DEFINER), phiên Desktop chỉ đóng được lượt của chính nhân viên (`aka_agent_engine_scope_ok`). Lượt đang
  bị khoá ở giao dịch khác (job close_stale đang đóng) thì bỏ qua (`SKIP LOCKED`), không chờ khoá chéo.
  Desktop gọi hàm reset sau khi bộ lập lịch đã dừng (`runScopedRecovery` chờ rảnh 30 giây, không rảnh thì không gọi), nên lượt còn mở lúc đó
  không còn ai chạy.
- Mọi lượt đóng theo ba đường đều ghi `close_reason = 'stale'` (hàm kiểm lỗi V574 vẫn thấy) và sự kiện `interrupted` có `data.via` =
  `stale` / `orphan` / `desktop_reset`; D1 thêm `data.final = 'outcomes'`.

## Số đo trên production (chỉ đọc, 24 giờ tới 18/11 17:40 VN)

113 lượt đóng `stale` (Facebook 9, Zalo 104) trên ~54.400 lượt (hai câu đọc cách nhau vài phút nên số D1 lệch 2).

- B áp được: 8 (Facebook 2: 175931, 192791; Zalo 6). Cả 9 lượt mồ côi trong 24 giờ, 8 được close_stale trả về hàng đợi rồi chạy lại sau
  16–186 phút, 1 (175931) bị hàm reset đốt.
- D1 áp được: 70–72 (Facebook 2; 5 lượt mọi bước thành công, còn lại có bước lỗi như UNK01 / Z122). Không lượt nào có hiệu ứng "giữ": data
  vẫn "hoàn thành", chỉ ghi chú / mã lỗi cuối đổi từ SYS02 sang kết quả thật. Phần lớn lượt Zalo là máy Mac staff 1473 (ngủ chập chờn, #707).
- A: 2 data bị đốt khi lượt engine còn mở (Facebook 175931; Zalo 180563 qua nhánh "đổi chế độ runtime").
- Câu tìm mồ côi đo bằng EXPLAIN ANALYZE chỉ đọc: ~5 ms / ~1.200 buffer mỗi lượt ứng viên (quét chỉ mục giờ bắt đầu trong 15 phút), vài ứng
  viên mỗi phút.

## Kiểm

- `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-orphan-runs-v576-smoke.cjs` (24 nhóm, PostgreSQL 17, ~25 giây): dựng DB engine
  như production (bootstrap + engine Facebook + V571), nạp đúng thân production 18/11 (close_stale, report_v1, hàm reset Desktop và hàm reset
  bên trong); chạy trên bản cũ trước (thấy đủ ba lỗi), rồi apply / chạy lại bị chặn / gỡ trả đúng thân cũ / apply lại, quyền, B / D1 / A trên
  bản mới, và một lượt đầu cuối với claim / mark / report / release thật (mất câu trả lời claim → mồ côi → về hàng đợi → lượt sau chạy lại).
  Thêm tối 18/11 (anh hỏi "có cần giả lập gì nữa không"):
  - **X1 trần 3 giây**: hàm reset chạy dưới trần của phiên Desktop (vượt trần thì đăng nhập lỗi sau 3 lần thử, `LOGIN_RECOVERY_MAX_ATTEMPTS`).
    Cục bộ: 40 lượt mở (20 chốt theo kết quả, 20 về hàng đợi) 9 ms, bản cũ cùng dữ liệu 3 ms; 120 lượt 25 ms. Quy ra production: một lần chốt
    theo kết quả ≈ một lần `report_v1` (trung bình 12–13 ms trên ~590 nghìn lần gọi từ 11/11), về hàng đợi ≈ 1 ms, hàm reset hiện tại trung bình
    29–59 ms, nên 40 lượt ≈ 0,3–0,4 giây. Lúc 19:47 VN 18/11 chỉ 10 nhân viên có lượt mở, nhiều nhất 7 lượt một người.
  - **X2 báo muộn sau D1**: máy thức dậy gửi lại lần báo cũ, lần chốt rỗng, heartbeat: data, lịch sử, chuỗi data lỗi, sổ lượt không đổi; ghi
    dấu bước mới bị từ chối (`run_closed`) nên không gửi thêm được. Lần báo "đã dừng" (`__stopped`, khi lõi bị dừng) tới sau thì `report_v1`
    điền `final_error_code` của lượt đã đóng nếu đang trống (`err_engine_cancelled`, cách `report_v1` đang làm với mọi lượt đã đóng, V576 không
    đổi `report_v1`): chỉ sổ lượt, không thêm dòng lịch sử, data và chuỗi data lỗi giữ nguyên.
  - **X3 chạy đồng thời**: job close_stale và hàm reset Desktop giành cùng lượt, mỗi bên lần lượt bị dừng 0,8 giây ở 4 chỗ (khi sửa lượt, chuỗi
    data lỗi, data, khi ghi sự kiện) bằng trigger chỉ có trong bài kiểm, trên 4 kiểu lượt (đã gửi xong chờ D1; cùng chiến dịch hai lượt mở;
    chưa ghi dấu; mồ côi): 40 ca, 26 ca dừng được giữa chừng. Không khoá chéo, không lỗi, không lượt nào còn mở, data đã giao không về hàng đợi,
    chuỗi data lỗi giữ nguyên; hàm reset lâu nhất 0,81 giây (chờ job). Một ca data bị đánh "Dừng đột ngột…" như bản cũ: job đã khoá lượt
    nhưng chưa khoá data (giữa hai câu lệnh, hoặc lượt nằm sau trong lô 10 lượt job khoá trước) đúng lúc hàm reset chạy cho cùng nhân viên.
    Hàm reset bỏ qua lượt đang bị khoá rồi đánh dấu data như cũ. Khe này chỉ mở trong vài mili giây khi job đang đóng đúng lượt đó.
- Bộ kịch bản Zalo trên DB có V576: `SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_TARGET_CHECK=1 SCENARIO_ORPHAN_RUNS=1 node
  scripts/engine-v2-scenarios/run.cjs --rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01`: 708 lượt, 5.250 lần gửi, 0 vi phạm
  mới (giống hệt khi không có V576).
- Bộ kịch bản Facebook (bộ lập lịch Desktop thật): `FB_SCENARIO_ORPHAN_RUNS=1 node scripts/engine-v2-facebook/scenarios.cjs --seeds 8 --crash 0.08
  --dbchaos 0.05`: 8 hạt giống, 461 cú gửi, có mất câu trả lời claim / report / mark và chết tiến trình; 0 vi phạm bất biến, số cú gửi giống hệt
  khi không có V576.

## Apply / gỡ

- Tạo / thay hàm nên PostgREST nạp lại schema: apply ngoài giờ cao điểm. Không đổi bảng, không đổi dữ liệu lúc apply.
- Preflight chặn khi sổ đã có V576, khi hai hàm mới đã có, khi `close_stale_v1` / hàm reset Desktop / `report_v1` khác md5 bản đọc 18/11
  (`1208cfa1…`, `68035090…`, `09fe52a5…`). Postflight kiểm md5 bốn hàm sau khi tạo và quyền gọi.
- Gỡ: `migrations/rollback_v576_engine_orphan_runs.sql` (trả hai hàm về đúng bản đọc, xoá hai hàm mới; chặn nếu hai hàm không còn là bản V576).

## Chưa làm (để sau)

- **C** claim gọi lại an toàn (`claimId`): sửa gốc cho mất câu trả lời claim, kể cả lúc mở lượt (đang bị `busy` tới khi lease hết hạn).
  Cần Desktop mới + sửa `claim_target_v1`.
- **D2** lõi gửi lần chốt khi lần báo giữa chừng nhận `ownership_lost` (đóng ngay thay vì chờ close_stale ≥ 10 phút). Cần Desktop mới.
- `recover_server_zalo_running_state` (Fly / App Server) chưa biết engine: nếu runtime Fly khởi động lại khi lượt engine còn mở, data cũng có
  thể bị đánh "hoàn thành" như A. Chưa đo.
- `heartbeat_v1` nối lại lease đã hết hạn còn `report_v1` / `mark_sending_v1` thì không: sau khi máy thức, lời gọi nào tới trước quyết định
  lượt chạy tiếp hay dừng. Chưa đổi.
- Khe X3 (job đang đóng đúng lượt lúc hàm reset chạy): bịt hẳn bằng cách cho phần đánh dấu cũ của hàm reset bỏ qua data còn lượt engine mở
  (`NOT EXISTS` lượt mở, cả hàm reset bên trong cho Zalo). Chưa làm vì khe chỉ vài mili giây, kết quả khi trúng giống bản cũ, và phải ghim
  thêm thân hàm reset bên trong.
- `report_v1` sửa `final_error_code` của lượt đã đóng khi đang trống (X2). Chỉ sổ lượt; sửa thì phải thay `report_v1` (hàm gọi nhiều nhất của
  engine), không đáng.
