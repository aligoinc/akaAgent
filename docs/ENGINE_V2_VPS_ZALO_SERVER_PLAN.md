# Engine v2 cho tài khoản Zalo Server chạy trên VPS (App Server): phương án

26/11/2026. **Anh đã chốt các điểm ở mục 9 (26/11, qua hộp chọn) rồi "Code luôn", sau đó "Làm luôn" cho tài khoản Zalo QR / trình duyệt
của cùng tổ chức (mục 3.5). Đã code trên nhánh `claude/engine-v2-vps-server` (chưa commit, chưa merge); migration V667 chưa apply, App Server
và Desktop chưa build bộ cài / chưa phát hành; chưa đổi gì trên production. Tình trạng ở mục 10.** Số liệu ở đây đọc từ production bằng truy
vấn chỉ đọc ngày 26/11.

## 1. Bối cảnh

- Tài khoản Zalo Server chạy ở một trong hai nơi. Tổ chức bật `org_organization.use_new_zalo_runtime` chạy trên Fly bằng engine v2.
  Tổ chức tắt cờ chạy trên VPS (App Server) bằng bộ cũ. Cờ này làm cả hai việc cùng lúc: bật engine và chuyển phiên Zalo sang Fly (V497).
- Chép phiên đang sống từ VPS sang Fly làm Zalo đá phiên: 14/11 có 62/330 tài khoản mất phiên trong vài giờ (`KICKOUT_BY_WORKER`), nên anh
  chốt không chép phiên sống nữa. Vì vậy tổ chức có tài khoản Server đang đăng nhập phải ở lại VPS, và do đó chạy bộ cũ.
- Quy mô lúc đo (26/11): VPS có 394 tổ chức (gói Server còn hạn, có tài khoản Server đang đăng nhập), 1.061 tài khoản, 803 chiến dịch chờ
  hoặc đang chạy (266 đang chạy lúc đo). Fly có 138 tổ chức, 377 tài khoản. Khoảng 3/4 tài khoản Server vẫn chạy bộ cũ.

**Mục tiêu:** App Server chạy engine v2 cho tài khoản Server của các tổ chức này ngay trên VPS, phiên Zalo không di chuyển. Bật theo từng tổ
chức, tắt được ngay không cần cài lại.

**Ngoài phạm vi:** Facebook / Website trên App Server, cách chuyển tổ chức giữa VPS và Fly, Web / iOS (không phải cập nhật), ChatApi
(không phải sửa). Desktop chỉ đổi một chỗ: tài khoản Zalo QR / trình duyệt của tổ chức trong công tắc cũng chạy engine v2 (mục 3.5), cần
bản Desktop mới.

## 2. Vì sao làm được mà không phải viết bộ chạy mới

- App Server dùng đúng `CampaignScheduler` của Desktop với `runtimeTarget: 'server'`, mỗi nhân viên một bộ lập lịch, chạy trong
  `runWithCurrentUser` nên `getCurrentUser()` trả đúng nhân viên ([zaloServerRuntimeManager.ts:950](../src/server/main/zaloServerRuntimeManager.ts)).
- Engine v2 trên Desktop chạy tài khoản Zalo QR qua `createDesktopZaloPort` → `zaloRuntimeService` (zca-js trong tiến trình). VPS chạy tài
  khoản Server bằng chính `zaloRuntimeService` này, nên cổng Zalo dùng lại nguyên. Không cần cổng của Fly (lệnh gửi sang `zalo_runtime`).
- Đã có sẵn trên App Server:
  - gọi DB bằng service_role, đã có quyền chạy mọi RPC engine (V495);
  - theo dõi tương tác có chủ sở hữu riêng cho App Server (`attachServerCampaignEngagementOwner`);
  - kiêm akaBiz Sms, AI viết lại, lưu danh bạ dùng chung hàm với bộ cũ trên VPS;
  - dòng tiến trình (`logCampaignProgress`) đã có nhánh `server`, đi cùng đường với dòng tiến trình của bộ cũ trên VPS;
  - bộ cài App Server đã đóng gói `better-sqlite3` (cho nhật ký kết quả của engine);
  - `scheduler.stop()` gọi `engineRunner.abortAll()`, `waitForIdle` chờ cả lượt engine, lõi tự nhả lease khi kết thúc lượt.
- Fly không đụng tới: Fly chỉ nhận tổ chức bật cờ (`aka_agent_engine_enabled_orgs_v1`), còn VPS chỉ giữ tổ chức không đi Fly.

## 3. Những chỗ phải sửa

### 3.1 DB: một migration, hai phần

Số migration lấy lúc code (kiểm sổ production và mọi nhánh; 26/11 các nhánh đã tới V663). Mọi hàm thay đều sinh từ thân production bằng
script, kiểm md5 trước / sau, có bản gỡ (cách của V576, V585).

**p1: ràng buộc (DDL, giao dịch riêng, `lock_timeout` 2 giây, làm buổi tối)**

| Bảng | Hiện tại | Sau |
|---|---|---|
| `auto_engine_leases` | `runtime_target IN ('desktop','fly')` | thêm `'server'` |
| `auto_engine_target_runs` (~766 nghìn dòng) | như trên | thêm `'server'` |
| `auto_outcome_policies` | như trên (cột cho phép NULL) | thêm `'server'` |

Đổi bằng `DROP CONSTRAINT` + `ADD CONSTRAINT … NOT VALID` trong một giao dịch ngắn, rồi `VALIDATE CONSTRAINT` ở lệnh riêng (không khoá ghi).
Không để chung giao dịch với phần hàm: V495 từng giữ khoá bảng danh mục 7 giây làm 5 chiến dịch bị tạm dừng.

**p2: hàm và dữ liệu**

| Đối tượng | Sửa gì |
|---|---|
| `aka_agent_engine_claim_target_v1` | Nhận `runtimeTarget = 'server'`. Chỉ tài khoản Zalo Server (không phải Zalo trình duyệt), như nhánh `fly`. Tổ chức đang đi Fly (`aka_agent_zalo_server_flag_route(org)` đúng) trả `runtime_not_owner`. Tổ chức chưa bật công tắc trả `not_enabled`. Phiên Desktop vẫn chỉ được `desktop` như hiện nay. Claim lô (V503) gọi lại hàm này nên không phải sửa riêng. |
| Công tắc mới `engine.zalo_server_vps` (`auto_system_settings`) | Cùng kiểu `engine.facebook`: `{"mode":"off\|orgs\|all","organizationIds":[…]}`, chưa có dòng = tắt. Hàm đọc `aka_agent_engine_server_org_enabled(org)` (chép thân `aka_agent_engine_facebook_org_enabled`) và `aka_agent_engine_server_enabled_orgs_v1()` (service_role, App Server đọc 60 giây một lần). Claim kiểm lại ở mỗi lần nhận data, nên tắt công tắc có hiệu lực ngay lần nhận kế tiếp. |
| `aka_agent_engine_finish_campaign_v2` | Nhánh "tài khoản Server bị tạm dừng giữa lượt thì chiến dịch về chờ xử lý, không hoàn thành" (đang viết `l.runtime_target = 'fly'`, theo finalizer của VPS) áp cho cả `server`. |
| `auto_outcome_policies` | Chép dòng 255/256 (tra số không rõ kết quả; hai dòng giống hệt nhau, chỉ khác nơi chạy) thành bản `server`. 458 dòng còn lại không ghi nơi chạy nên tự áp cho `server`. |
| `recover_server_zalo_running_state` | Trước bước đánh "hoàn thành – Dừng đột ngột…" mọi data "đang chạy" của tài khoản Server: đóng các lượt engine `runtime_target = 'server'` còn mở của nhân viên bằng `aka_agent_engine_close_run_v1(id, 'server_reset')`. Chưa ghi dấu "sắp gửi" thì về hàng đợi, đã ghi dấu thì hoàn thành, không gửi lại. Đúng cách V576 A làm cho Desktop. Không đụng lượt `fly` / `desktop`; giữ nguyên phần ghi mốc `vps_released_at` (V497). |
| Bộ kiểm lỗi (`aka_agent_engine_error_watch_tick_v1`) | Không phải sửa: hàm chỉ xét tài khoản Facebook (`a.flatform_type = 'facebook'`), nên lượt Zalo Server đóng với lý do `server_reset` không thành ca lỗi. |
| Hàm mới `aka_agent_engine_desktop_vps_enabled_v1()` | Chỉ phiên Desktop gọi được. Trả tổ chức trong phiên có trong `engine.zalo_server_vps` không (mục 3.5). Không sửa `aka_agent_engine_desktop_enabled_v1` (V513): Desktop từ 9.9.0 dùng chính hàm đó để chọn tài khoản Zalo Server chạy ở Fly hay App Server (`resolveZaloServerOnFlyAtLogin`), sửa thì Desktop của tổ chức trong công tắc đưa quét QR / kiểm phiên / đăng xuất / quét data của tài khoản Server sang ChatApi trong khi tài khoản vẫn ở VPS. |

Lý do phải vá hàm khôi phục: App Server gọi nó mỗi lần khởi động và mỗi lần dừng runtime của một nhân viên (Fly cũng gọi lúc lên leader).
Hàm hiện chưa biết engine, nên không vá thì mỗi lần App Server khởi động lại, data engine đang nhận dở (chưa gửi gì) bị đóng "hoàn thành" thay
vì về hàng đợi. Desktop gặp đúng lỗi này và đã sửa ở V576.

### 3.2 Lõi engine (`packages/campaign-engine`)

- `RuntimeTarget = 'desktop' | 'fly' | 'server'` ([contracts.ts:8](../packages/campaign-engine/src/contracts.ts)).
- Ba câu tiến trình khác nhau theo nơi chạy ([progress.ts](../packages/campaign-engine/src/progress.ts): tạm dừng chiến dịch, tạm dừng tài
  khoản, `account_control_won`). Câu của `fly` vốn chép từ bộ cũ VPS (`completePauseAtBoundary`), nên `server` dùng câu của `fly` và khách
  trên VPS thấy câu như hôm nay.
- Chép lõi sang ChatApi ở lần đồng bộ kế tiếp (`scripts/sync-campaign-engine.cjs`); Fly không đổi hành vi.

### 3.3 App Server (`src/main`, dùng chung với Desktop)

- [campaignScheduler.ts:1099](../src/main/services/campaignScheduler.ts): tạo `DesktopEngineRunner` cả khi `runtimeTarget === 'server'`,
  host không có `facebook` / `web`; `engineEnabled` xét theo tổ chức của tài khoản, đọc từ bộ nhớ đệm công tắc (60 giây, dùng chung cả tiến
  trình App Server).
- [desktopEngineRunner.ts](../src/main/engineAdapters/desktopEngineRunner.ts):
  - nhận `runtimeTarget` (`desktop` | `server`), `runnerId` dạng `server:<uuid>`, truyền `runtimeTarget` cho `runUnit`;
  - `support()` khi chạy `server`: chỉ tài khoản Zalo Server, không phải Zalo trình duyệt, tổ chức đã bật công tắc; phần còn lại như Desktop
    (`zaloCampaignV2Support` với theo dõi tương tác và kiêm akaBiz Sms);
  - claim trả `not_enabled` (công tắc vừa tắt): chiến dịch đó chạy bộ cũ trong 5 phút rồi xét lại. Desktop giữ bộ cũ tới hết phiên, nhưng App
    Server chạy liền nhiều tuần;
  - claim trả `runtime_not_owner` (tổ chức vừa chuyển sang Fly): dừng lượt, để vòng 60 giây của App Server thả nhân viên như hôm nay.
- Gắn tag akaBiz: bộ cũ trên VPS gọi `aka_agent_apply_zalo_server_campaign_tags` (kiểm token của bộ cũ), còn cổng Desktop gọi
  `aka_agent_mutate_contact_tags`. Đã kiểm 26/11: hàm này qua `auto_assert_automation_identity`, mà hàm đó cho service_role qua không cần mật
  khẩu, nên cổng Desktop chạy được trên VPS, không phải sửa. Lưu danh bạ dùng chung hàm với bộ cũ VPS.
- Nhật ký kết quả: SQLite `userData/local-data/campaign_engine_journal.db` của App Server, phạm vi `nhân viên:tài khoản`. Sửa chú thích "App
  Server không chạy engine v2" ở [desktopEngineJournal.ts](../src/main/engineAdapters/desktopEngineJournal.ts).
- Không đổi: tạm dừng / tiếp tục chiến dịch Server vẫn đi DB trước (`aka_agent_set_zalo_server_campaign_status`), bảo trì đầu ngày
  (`maintainZaloServerCampaignSchedules`), khôi phục phiên, QR, group thời gian thực.

### 3.5 Desktop: tài khoản Zalo QR / trình duyệt của tổ chức trong công tắc (anh: "Làm luôn", 26/11)

Trước khi sửa, tổ chức trong công tắc mà có cả tài khoản Server lẫn tài khoản Zalo trên Desktop sẽ chạy hai bộ khác nhau: tài khoản Server
chạy engine v2 trên VPS, tài khoản QR / trình duyệt vẫn chạy bộ cũ trên Desktop (Desktop chỉ chạy engine v2 khi cờ `use_new_zalo_runtime`
bật). Đo 26/11 (chỉ đọc): 16/394 tổ chức VPS có thêm tài khoản Zalo trên Desktop, 23 tài khoản đang đăng nhập (17 QR, 6 trình duyệt);
12 tổ chức trong đó có 57 chiến dịch chờ / đang chạy.

- Lúc đăng nhập, cờ tắt và tổ chức có quyền Zalo thì Desktop hỏi thêm `aka_agent_engine_desktop_vps_enabled_v1()`
  (`loadDesktopVpsEngineEnabled`, [campaignEngineFlagRepository.ts](../src/main/data/repositories/campaignEngineFlagRepository.ts)).
- [zaloServerOnFly.ts](../src/shared/zaloServerOnFly.ts) `resolveDesktopZaloAtLogin`: `campaignEngineV2` = cờ hoặc công tắc; `zaloServerOnFly`
  chỉ theo cờ. Tài khoản Server của tổ chức trong công tắc vẫn đi App Server.
- Claim của nơi chạy `desktop` không đổi (không xét cờ hay công tắc; Desktop tự chọn bộ chạy lúc đăng nhập).
- Bật / tắt có hiệu lực ở lần đăng nhập sau, như cờ V513. Desktop bản cũ không hỏi hàm mới nên chạy bộ cũ như hôm nay; DB chưa có V667
  (PGRST202) thì coi như tắt.
- `mode: all` còn bật engine v2 cho tài khoản Zalo trên Desktop của mọi tổ chức chưa bật cờ, kể cả tổ chức không có tài khoản Server
  (26/11: 119 tổ chức, 177 tài khoản Zalo trên Desktop đang đăng nhập).

### 3.4 Khối lượng (ước lượng)

Không viết lại engine v2. Phần chạy thật (lõi, cổng Zalo, các RPC engine) đã chạy production cho Desktop và Fly, giữ nguyên.

| Phần | Thay đổi |
|---|---|
| Lõi | 1 dòng kiểu nơi chạy, ~6 dòng câu tiến trình |
| `desktopEngineRunner.ts` | ~25 dòng: nhận nơi chạy, nhánh `server` của `support()`, nhớ `not_enabled` 5 phút |
| `campaignScheduler.ts` | ~15 dòng: tạo bộ chạy cho `server`, công tắc theo tổ chức |
| Đọc công tắc | ~30 dòng mới (đọc RPC 60 giây một lần) |
| DB | 3 ràng buộc; 4 hàm nhỏ mới (2 hàm chép từ công tắc Facebook, 1 hàm chép từ `close_desktop_runs_v1`, 1 hàm cho Desktop); vá 3 hàm có sẵn (claim thêm nhánh ~10 dòng, kết thúc lượt 1 điều kiện, khôi phục thêm 1 lời gọi); 1 dòng chính sách |
| Desktop | ~20 dòng: hỏi hàm mới lúc đăng nhập, `resolveDesktopZaloAtLogin` |
| Kiểm thử | Phần lớn công sức (mục 6) |

## 4. Khách trên VPS thấy gì khác

Giống những gì tổ chức Fly / Desktop đã có sau khi lên engine v2:

- Mã lỗi Zalo theo bảng đã duyệt (V500 và các bản sau), dòng tiến trình có mã công khai ngắn ("… (Z122)").
- Data không rõ đã gửi hay chưa thì đóng, không gửi lại; lỗi do tài khoản / mạng thì data về hàng đợi.
- Kiểm người nhận trên toàn hệ thống trước khi gọi Zalo (V571, đang bật cho mọi tổ chức).
- "Lặp lại sau khi chạy xong" chạy thẳng trong hàm kết thúc lượt (bộ cũ trên VPS không gọi, phải chờ bộ quét mở lại).
- Không còn kiểu kẹt cổng bảo trì đầu ngày do unit lease của bộ cũ bị bỏ lại (vd xoá chiến dịch giữa lượt): lượt engine không giữ unit
  lease, lease của engine tự hết hạn, không phải gỡ tay.
- Tài khoản Zalo QR / trình duyệt trên Desktop của cùng tổ chức cũng chạy engine v2, sau khi khách cập nhật Desktop và đăng nhập lại
  (mục 3.5).

## 5. Tải

- **VPS hôm nay (14:00–14:55 VN 26/11, `edge_logs`):** 924 nghìn request REST, 280 request/giây, 44% toàn hệ thống. Nhiều nhất: GET
  `auto_campaigns` 204 nghìn, GET `auto_accounts` 136 nghìn, `aka_agent_get_zalo_server_run_control_state` 104 nghìn, HEAD
  `auto_campaign_details` 53 nghìn, `append_auto_campaign_log` 41 nghìn. Cùng lúc `aka_agent_write_action_result_v1` có 16,7 nghìn lượt, tức
  khoảng 55 request REST cho mỗi dòng kết quả.
- **Engine v2 cùng lúc (Desktop + Fly + Facebook, đo 40 giây bằng `pg_stat_statements`):** claim 6,1 lượt/giây × 32,7 ms (~2.000 block),
  report 6,3 lượt/giây × 14,7 ms, mark / heartbeat / release mỗi lượt dưới 2 ms; tổng ~0,3 core. Mỗi data khoảng 3–5 lời gọi engine, cộng dòng
  tiến trình.
- **Dự kiến khi VPS chuyển:** request REST của VPS giảm mạnh (bỏ vòng hỏi run control 5–15 giây, bỏ đọc lại chiến dịch / tài khoản mỗi lượt).
  Đổi lại claim của engine nặng hơn mỗi lần gọi: nếu toàn bộ VPS chuyển, RPC engine thêm cỡ 0,2–0,3 core. Phần bộ cũ bớt đi chưa đo được trước,
  nên đo khi mở dần (mục 7).
- Bảng `auto_engine_*` thêm dòng (tự dọn sau 30 ngày, V517).

## 6. Kiểm thử

1. **DB** (PG17 cục bộ, thân hàm production): claim `server` nhận / từ chối theo công tắc, theo định tuyến Fly, theo loại tài khoản; phiên
   Desktop không gọi được `server`; hàm kết thúc lượt; hàm khôi phục (chưa ghi dấu về hàng đợi, đã ghi dấu hoàn thành không gửi lại, lượt
   `fly` / `desktop` không bị đụng, mốc `vps_released_at` vẫn ghi); bản gỡ; apply lại bị từ chối.
2. **Bộ kịch bản sự cố** ([scripts/engine-v2-scenarios/run.cjs](../scripts/engine-v2-scenarios/run.cjs), đang có Desktop và Fly): thêm nơi
   chạy `server` (lõi thật + cổng Desktop + hàm DB mới) và kịch bản "App Server khởi động lại giữa lượt" (chết tiến trình → hàm khôi phục →
   chạy tiếp). Bất biến: không gửi trùng, không mất data.
3. **Bộ lập lịch thật ở chế độ server với Zalo giả** (smoke mới, đã làm 26/11, mục 10): chiến dịch chuyển từ bộ cũ sang engine giữa chừng
   (bộ cũ đang giữ lượt thì engine chờ `legacy_busy`); nhiều nhân viên một tiến trình; dừng runtime nhân viên (dừng có chờ, tiến trình chết).
   Tắt công tắc giữa lượt kiểm ở bài kiểm bộ chạy (`engine-v2-server-runtime-runner-smoke.cjs`).
4. **Phát lại lịch sử thật** của chiến dịch VPS (`scripts/engine-v2-realdata/`), so kết quả bộ cũ với quyết định của engine (đã làm 26/11,
   mục 10).
5. **Hậu kiểm bộ cài App Server:** `better-sqlite3` nạp được trong app đóng gói, có code engine trong `out-server`.

## 7. Đưa lên

1. Merge code. Apply p1 rồi p2 buổi tối (DDL làm PostgREST nạp lại schema). Chưa có dòng công tắc nên mọi tổ chức VPS vẫn chạy bộ cũ.
2. Build App Server, cài VPS ngoài giờ: khởi động lại làm mọi tài khoản đăng nhập lại cùng lúc (lần cài 10/11, p50 REST lên ~580 ms trong 5
   phút). Build Desktop (anh tự phát hành); thiếu bản Desktop mới thì chỉ tài khoản Server của tổ chức thử chạy engine v2.
3. Bật `engine.zalo_server_vps` = `{"mode":"orgs","organizationIds":[…]}` cho 2–3 tổ chức thử.
4. Theo dõi 1–2 ngày:
   - lượt `runtime_target = 'server'` bị bỏ dở (`close_reason = 'stale'`), mã lỗi lạ;
   - tỉ lệ UNK01 / SYS02 so với Desktop và Fly;
   - dòng tiến trình trên Desktop / Web của khách;
   - request REST từ IP VPS, CPU / RAM của App Server.
5. Mở dần theo lô (vd 20 tổ chức → 100 → `all`).

**Tắt khẩn:** `{"mode":"off"}`, có hiệu lực ở lần nhận data kế tiếp (chiến dịch quay về bộ cũ sau data đang chạy), không phải cài lại. Phía
Desktop (tài khoản QR / trình duyệt) tắt ở lần đăng nhập sau. **Gỡ hẳn:** cài lại App Server bản trước, rồi chạy bản gỡ migration khi không
còn lượt `server` nào mở.

## 8. Rủi ro

- Một tiến trình App Server chạy cho mọi tổ chức trên VPS: lỗi của bộ mới ảnh hưởng nhiều khách cùng lúc, nên phải bật theo tổ chức và tăng
  dần.
- Tổ chức đang chạy engine trên VPS sau này bật cờ đi Fly: App Server dừng runtime nhân viên, hàm khôi phục đóng lượt engine, rồi chép phiên
  như hôm nay. Lease được nhả khi lượt kết thúc, chậm nhất 180 giây nếu nhả lỗi.
- Nhật ký kết quả nằm trên đĩa VPS: mất đĩa thì mất các kết quả chưa báo được về DB (giống Desktop).

## 9. Anh đã chốt (26/11/2026, qua hộp chọn)

1. **Công tắc:** riêng `engine.zalo_server_vps` theo tổ chức, không dùng lại cờ `use_new_zalo_runtime` (cờ này đang chuyển tổ chức sang Fly).
2. **Lý do đóng lượt khi App Server khởi động lại:** `server_reset`. Không còn là câu hỏi: anh hỏi lại "VPS với Desktop là riêng, sao không
   phân biệt được?" và anh đúng. Lượt nào cũng ghi nơi chạy (`runtime_target = 'server'`, mã bộ chạy `server:…`), nên dùng chữ nào cũng phân
   biệt được VPS với Desktop. Lựa chọn "phải sửa bộ kiểm lỗi" cũng sai: bộ kiểm lỗi chỉ xét tài khoản Facebook, nên tên mới không tốn gì thêm.
3. **Tắt công tắc giữa chừng:** chiến dịch về bộ cũ 5 phút rồi xét lại.
4. **Tổ chức thử đầu tiên:** em đề xuất 2–3 tổ chức trên VPS ít tài khoản, đang chạy đều, lập danh sách theo dữ liệu lúc sắp bật (sau khi đã
   cài App Server mới), anh duyệt rồi mới bật.
5. **Tài khoản Zalo QR / trình duyệt của tổ chức trong công tắc** (anh: "Làm luôn", 26/11): cũng chạy engine v2 trên Desktop theo cùng công
   tắc (mục 3.5). Cách làm khác dự định ban đầu (vá V513) vì V513 còn chọn nơi chạy tài khoản Server.

## 10. Tình trạng code (26/11/2026)

Nhánh `claude/engine-v2-vps-server` (worktree `.claude/worktrees/engine-v2-vps-server`), chưa commit, chưa merge.

**DB: V667** (sinh bằng `node scripts/build-v667-sql.cjs` từ thân hàm production đọc chỉ đọc 26/11, lưu ở
`scripts/fixtures/engine-v2-server/live-20261126.json`; không sửa tay các file sinh ra):

| File | Nội dung |
|---|---|
| `migrations/migration_v667_engine_server_runtime_p1.sql` | 3 ràng buộc `runtime_target` nhận `'server'` (NOT VALID), `lock_timeout` 2 giây |
| `migrations/migration_v667_engine_server_runtime_p2.sql` | claim / finish / `recover_server_zalo_running_state`; 4 hàm mới; chính sách bản `'server'` (chép từ 255); dòng `engine.zalo_server_vps` = `{"mode":"off","organizationIds":[]}` |
| `migrations/migration_v667_engine_server_runtime_p3.sql` | VALIDATE 3 ràng buộc (chạy lại được) |
| `migrations/rollback_v667_engine_server_runtime_p2.sql`, `…_p1.sql` | gỡ ngược, p2 trước. Gỡ p2 từ chối khi còn lượt `'server'` đang mở; gỡ p1 từ chối khi còn dòng `'server'` |

md5 `pg_get_functiondef`: claim `8f574b0a…` → `fd173e5b…`, finish `9b29fe98…` → `e9988535…`, recover `e51b1240…` → `48b966d5…`; hàm mới
`aka_agent_engine_server_org_enabled` `043e87cc…`, `aka_agent_engine_server_enabled_orgs_v1` `dc808103…`,
`aka_agent_engine_close_server_runs_v1` `6db47b78…`, `aka_agent_engine_desktop_vps_enabled_v1` `916ded11…` (chỉ `aka_agent_desktop`). Số V667: lúc viết sổ production tới V662, một nhánh khác đã có V663; kiểm lại sổ và mọi
nhánh ngay trước khi apply. p2 nặng ~116 KB (chép nguyên 3 thân hàm): công cụ MCP không nhận thì apply bằng `supabase db query --linked -f`.

**Lõi** (`packages/campaign-engine`): `RuntimeTarget` thêm `'server'`; 3 câu tạm dừng theo nơi chạy, `'server'` dùng câu của Fly (vốn chép từ
bộ cũ VPS). Chép sang ChatApi ở lần đồng bộ lõi kế tiếp; Fly không đổi hành vi.

**App Server:**
- `src/main/engineAdapters/serverEngineGate.ts` (mới): công tắc dùng chung cả tiến trình, đọc RPC 60 giây một lần. Chưa đọc được → `'loading'`
  (bộ lập lịch bỏ qua chiến dịch tới lượt quét sau, không để bộ cũ chạy chiến dịch của tổ chức đã bật); DB chưa có hàm → tắt; lỗi tạm → giữ
  lần đọc trước; chưa đọc được lần nào sau 120 giây → tắt (bộ cũ chạy).
- `desktopEngineRunner.ts`: nhận `runtimeTarget` (`'desktop'` | `'server'`), `serverSupport()`, mã bộ chạy `server:<uuid>`, claim trả
  `not_enabled` thì chiến dịch chạy bộ cũ 5 phút (đồng hồ đơn điệu) rồi xét lại.
- `campaignScheduler.ts`: tạo bộ chạy cả khi chạy `'server'` (host có `serverEngineState`, không có Facebook / Website).
- `zaloServerRuntimeManager.ts`: đọc công tắc (`ensureLoaded`) trước `scheduler.start()` của mỗi nhân viên.

**Desktop** (mục 3.5): `campaignEngineFlagRepository.ts` thêm `loadDesktopVpsEngineEnabled`; `authRepository.ts` chỉ hỏi khi cờ tắt;
`zaloServerOnFly.ts` thêm `resolveDesktopZaloAtLogin` (bộ chạy theo cờ hoặc công tắc, nơi chạy tài khoản Server chỉ theo cờ). Tổ chức
không có trong công tắc: Desktop không đổi hành vi.

**Kiểm thử (26/11, trên máy dev):**
- `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-server-runtime-v667-smoke.cjs`: 20/20. PostgreSQL 17 cục bộ có đúng thân hàm
  production (`scripts/fixtures/engine-v2-server/db.cjs`, kèm V513 bản production); trước V667 claim từ chối `'server'`; p1 / p2 / p3; apply rồi
  ROLLBACK không để lại gì; quyền; chính sách; công tắc; hàm Desktop mới theo công tắc trong khi V513 vẫn theo cờ; claim `desktop` cho tài
  khoản QR của tổ chức tắt cờ vẫn nhận; claim theo công tắc / định tuyến Fly / loại tài khoản / phiên Desktop; kết thúc lượt khi tài khoản bị
  tạm dừng; hàm khôi phục (chưa ghi dấu về hàng đợi, đã ghi dấu hoàn thành không gửi lại, lượt Desktop không bị đóng, data bộ cũ như trước);
  gỡ p2 / p1 rồi apply lại.
- `node scripts/zalo-server-on-fly-login-smoke.cjs`: 6/6 (thêm nhóm V667: công tắc bật engine v2 cho Zalo QR / Web, tài khoản Server vẫn ở
  App Server).
- `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-server-runtime-runner-smoke.cjs`: 5/5. Bộ chạy + cổng Zalo Desktop + lõi thật,
  nhật ký SQLite thật, Zalo giả: công tắc đọc RPC thật, chọn bộ chạy, chạy hết một chiến dịch Zalo Server, tắt công tắc giữa chừng, dừng giữa
  lượt → hàm khôi phục → chạy lại không gửi trùng.
- `node scripts/campaign-engine-desktop-smoke.cjs`: 11/11. Hai typecheck và typecheck lõi sạch; `npm run build:server` và `npm run build`
  (Desktop) đạt, hai bản dựng có code mới.
- `node scripts/campaign-outcome-engine-check-all.cjs` (typecheck lõi, ranh giới, các smoke engine): đạt hết. Bộ kịch bản sự cố
  `scripts/engine-v2-scenarios/run.cjs --rounds 2 --targets 20 --chaos 2 --inject 0.01 --dbchaos 0.01`: 380 lượt, 3.622 lần gửi, 0 vi phạm mới
  (1 vi phạm đã biết E1 có từ trước), kịch bản sự cố 0 lỗi: phần lõi sửa không đổi hành vi Desktop / Fly.
- `CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-server-runtime-scheduler-smoke.cjs`: 8/8 (mục 6.3). Bộ lập lịch thật
  (`CampaignScheduler`, `runtimeTarget: 'server'`), `ServerEngineGate` thật đọc RPC thật, người dùng hiện tại thật (`runWithCurrentUser` như App
  Server), DB thử V667 qua 4 kết nối song song như PostgREST, Zalo giả; chỉ bộ chạy cũ được thay bằng bản ghi lại. Các ca:
  1. bộ lập lịch App Server có bộ chạy engine nơi chạy `server` (mã `server:…`); tài khoản Facebook / Zalo QR không thuộc nơi này;
  2. lần đọc công tắc đầu tiên của tiến trình còn treo (giữ khoá bảng thiết lập ở kết nối khác): hàng đợi bỏ qua chiến dịch ngay (dưới 5
     giây), không chạy bộ cũ, không gửi; đọc xong thì lượt quét sau chạy engine;
  3. công tắc bật: hàng đợi tài khoản chạy engine, lượt ghi đúng nhân viên, lease nhả, chiến dịch hoàn thành, dòng tiến trình đi qua
     `appendCampaignLog` và `logSink` (đường lên gateway App Server);
  4. tổ chức không có trong công tắc: bộ cũ, engine không nhận lượt nào;
  5. bộ cũ còn giữ tài khoản (token thao tác + claim chiến dịch) lúc bật công tắc: engine `legacy_busy`, không gửi; bộ cũ nhả thì engine làm
     phần còn lại, không gửi lại data bộ cũ đã gửi hoặc đang gửi lúc chuyển;
  6. ba nhân viên cùng tiến trình chạy đồng thời (mỗi người một bộ lập lịch): mỗi lượt đúng nhân viên, tổ chức tắt đi bộ cũ;
  7. dừng runtime giữa lượt như `stopRuntime` (chặn Zalo, `stop()`, `waitForIdle`, bước dọn): lease nhả ngay, chiến dịch / tài khoản về chờ
     xử lý, tiến trình mới chạy tiếp, mỗi data gửi đúng một lần;
  8. tiến trình chết giữa lúc gửi (client DB của tiến trình bị cắt, lệnh gửi không trả về): khởi động lại chạy bước dọn của `startRuntime`
     (`requireServerMode`, đúng phiên bản quyền gói), lượt dở đóng SYS02 (`err_engine_interrupted_while_sending`, sự kiện `via =
     server_reset`), data đã gửi không gửi lại. **Lease của tiến trình chết vẫn còn 180 giây** (`engine.lease_seconds`; V667 đóng lượt nhưng
     không nhả lease) nên tài khoản đó chờ tới hết lease rồi engine mới chạy tiếp, như Desktop / Fly sau khi tiến trình chết. Dừng có chờ
     (ca 7) thì nhả ngay. Không nhả lease lúc khởi động vì không chắc tiến trình khác đã chết.
  `scripts/send-exclusion-v657-fixture.cjs` (`buildDb`) trả thêm `connect` cho bài kiểm cần thêm kết nối.
- **Phát lại lịch sử thật của chiến dịch VPS (mục 6.4, 26/11):** mẫu 67 chiến dịch của tài khoản Zalo Server chạy trên VPS trong 7 ngày tới
  26/11 (chép chỉ đọc bằng `export-snapshot.cjs`; 3.227 data, 8.458 dòng lịch sử bộ cũ; mẫu là dữ liệu khách, chỉ để ở scratchpad), danh mục
  engine chép chỉ đọc từ production (chính sách, luật, trạng thái, thân `report_v1`). Chạy:
  `ENGINE_REPLAY_SERVER=1 ENGINE_REPLAY_CATALOG=<danh mục> CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-realdata/replay.cjs <mẫu> --out <file>`
  (DB thử V667, tổ chức tắt cờ, công tắc `all`, tài khoản Server chạy nơi chạy `server`); `ENGINE_REPLAY_SERVER_AS=fly` chạy cùng DB và mẫu
  nhưng như Fly (cờ bật) để so hai nơi chạy. Kết quả:
  - 64 chiến dịch chạy (3 bỏ qua vì loại trừ gửi không phát lại được): 47 chạy hết, 12 dừng ở giới hạn ngày (LIM01) / khoá theo thời gian, 5
    bị từ chối vì gói đã hết hạn sau lúc chiến dịch chạy (đúng).
  - 3.669 dòng lịch sử khớp, 1.346 khác; 709 là data engine chưa chạy tới (giới hạn / khoá khi phát lại dồn thời gian). Phần còn lại đều đã
    giải thích: tính lượt theo chính sách V500 đã duyệt (Z122 tính lượt; 215/251, Z114, không tồn tại khi kết bạn không tính); TAG01 thay
    "Tham số không hợp lệ" (V581); lỗi mạng / quá giờ gửi media ra UNK01 (V500); engine làm thêm bước kết bạn / nhắn tin ở chiến dịch bật
    "Tiếp tục khi chạm giới hạn" vì phát lại bỏ hạn mức theo khung giờ, còn bộ cũ đã bỏ bước đó khi chạm khung giờ; 46 lần tra số không chạy
    vì data trong mẫu đã có UID bộ cũ ghi lại; tên gợi nhớ `#{INPUT_FULLNAME}` ra tên Zalo vì mẫu chứa tên đã bị ghi đè (đã biết, xem
    `docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_COVERAGE.md`); 802 khi nhắn bạn bè thì V500 (Q4) trả data về hàng đợi và Zalo giả chỉ lỗi lần đầu nên lần
    thử lại thành công; câu có thêm mã công khai (Z216, Z122…).
  - **`server` so với Fly trên cùng DB và mẫu:** 67/67 nhóm kết quả trùng từng data, trạng thái data cuối và câu lịch sử trùng; chỉ 2 chiến
    dịch khác giờ "chạy tiếp lúc" (17:55 / 17:58) vì hai lượt phát lại cách nhau 3 phút. Nơi chạy `server` không thêm khác biệt nào so với engine
    v2 đang chạy trên Fly.
  - Lần chạy đầu 20 chiến dịch dừng ở "Không thể kiểm tra giới hạn gửi/đăng lặp" (`campaign_delivery_cooldown_scope_not_found`): mẫu không chép
    `org_staff` mà hàm chống gửi lặp production (V431) đòi nhân viên đang hoạt động. Lỗi của môi trường phát lại; `replay.cjs` nay dựng dòng
    nhân viên giả ở chế độ server.

**Chưa làm / chưa kiểm:**
- Bộ kịch bản sự cố (`scripts/engine-v2-scenarios/run.cjs`) chưa có nơi chạy `'server'` (mục 6.2): DB của bộ kịch bản dựng tới V532, không có
  thân claim của production nên không apply nguyên V667 được. Ca App Server dừng / chết giữa lượt nay có ở bài kiểm bộ lập lịch (ca 7, 8).
- Chưa chạy App Server thật (Electron + zca-js thật) với tài khoản Zalo Server; chưa hậu kiểm bộ cài App Server.
- Chưa chạy Desktop thật với tổ chức trong công tắc (đăng nhập, chiến dịch Zalo QR chạy engine v2, tài khoản Server vẫn quét QR qua App
  Server).
- Danh sách tổ chức thử (mục 9.4): lập lúc sắp bật.

**Tra cứu sau khi bật:** lượt chạy trên VPS là `auto_engine_target_runs.runtime_target = 'server'` (mã bộ chạy `server:…`); lượt App Server dọn
khi khởi động / dừng runtime là sự kiện `auto_engine_target_events` kind `interrupted` có `data->>'via' = 'server_reset'`. Bật thử:
`UPDATE public.auto_system_settings SET value = '{"mode":"orgs","organizationIds":[<mã tổ chức>]}' WHERE key = 'engine.zalo_server_vps'`;
tắt khẩn: `{"mode":"off","organizationIds":[]}`.
