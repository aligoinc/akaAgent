# Desktop không nhận việc mới khi máy vừa ngủ dậy mà chưa có người dùng

Trạng thái 18/11/2026: **code ở nhánh `claude/trusting-thompson-4fb2e9`, chưa commit / merge / build**.
Không migration, RPC, quyền hay index mới. Công tắc là một dòng tuỳ chọn trong `auto_system_settings`. **Chưa có dòng
nào trong DB, nên bản Desktop có mã này chạy theo mặc định: bật trên Mac, tắt trên Windows.**

## Vì sao làm

Đo chỉ đọc trên production (akachat) ngày 18/11/2026 (bằng chứng có dữ liệu khách nằm ở scratchpad của phiên chẩn đoán):

- Mac đang ngủ hệ thống vẫn thức tạm (dark wake) khoảng 16 phút một lần, mỗi lần 4–5 giây. Trong `edge_logs` theo IP,
  request đến theo từng đợt 4–5 giây, mỗi đợt đúng 1 ping `aka_agent_device_presence` (lúc thức là 2 ping/phút), giữa
  các đợt không có request nào. Presence `started_at` không đổi, tức app không khởi động lại.
- Mỗi lần thức tạm, mọi timer quá hạn chạy dồn. `tick()` của bộ lập lịch mở lượt cho mọi tài khoản, engine v2 nhận data,
  ghi dấu "sắp gửi" trong khoảng 2 giây, rồi máy ngủ lại giữa lệnh gửi Zalo. 13–14 phút sau hàm đóng lượt cũ đóng
  `stale` / `err_engine_interrupted_while_sending`. Nếu lần thức sau đến sớm hơn, lượt được báo kịp nhưng lệnh gửi đã lỗi
  đường truyền nên thành `err_engine_unknown_delivery`. Cả hai đều đóng "hoàn thành", không gửi lại.
- Từ 15/11 00:00 VN tới 18/11 khoảng 14:30 VN: Mac có 98 lượt `stale` đã ghi dấu gửi và 38 lượt "không rõ đã tới" do bị
  treo giữa lúc gửi. Windows chỉ có 14 lượt, rải rác ban ngày, không theo nhịp, vì Windows ngủ là app đứng hẳn.
- Lỗi đã có từ 9.7.0, không do 9.9.0.

## Cách chạy

Mã: [systemSleepGuard.ts](../src/main/services/systemSleepGuard.ts), nối ở [handlers.ts](../src/main/ipc/handlers.ts)
(tìm `sleepGuard`), bộ lập lịch nhận qua `CampaignSchedulerOptions.startWorkGate`.

- **Bật "giữ"** khi máy báo sắp ngủ (`powerMonitor` 'suspend'), hoặc khi nhịp đếm 1 giây bị trễ từ 60 giây trở lên
  (máy vừa bị đóng băng). Bộ lập lịch hỏi bộ giữ ngay lúc định bắt đầu việc, và bộ giữ tự kiểm nhịp tại đó, nên không
  thua các timer chạy dồn lúc máy thức.
- **Thôi giữ** khi có thao tác bàn phím/chuột sau lần thức (`powerMonitor.getSystemIdleTime()` nhỏ hơn thời gian đã
  thức, trừ hao 1 giây vì hệ điều hành làm tròn), khi mở khoá màn hình ('unlock-screen', 'user-did-become-active'),
  hoặc khi máy thức liên tục đủ `awakeMinutes` (mặc định 10 phút). Thôi giữ thì bộ lập lịch được đánh thức ngay.
- **Trong lúc giữ:**
  - `tick()` không chạy, nên không mở lượt mới cho tài khoản nào.
  - Hàng đợi chiến dịch của tài khoản không bắt đầu chiến dịch tiếp theo; lượt Facebook ngẫu nhiên không bắt đầu đợt mới.
  - Lượt engine v2 (Zalo, Facebook) đang chạy dừng sau data hiện tại (`acceptingWork()` = false). Lõi kiểm điều kiện
    này trước mỗi lần nhận data và mỗi 500 ms trong lúc nghỉ giữa 2 data, rồi nhả lease như khi đăng xuất. Lệnh đang gửi
    được chạy nốt và báo kết quả.
- Mac để thức suốt đêm (không ngủ) không bao giờ bị giữ, nên chiến dịch chạy đêm vẫn chạy như cũ.
- App Server không truyền bộ giữ nên không đổi gì.

Chưa phủ (cố ý, để đợt sau):

- Bộ cũ (Email, Facebook trên bản chưa có engine v2) đang chạy dở một chiến dịch lúc máy ngủ thì vẫn chạy tiếp ở các lần
  thức tạm. Bộ giữ chỉ chặn bắt đầu chiến dịch mới cho bộ cũ, vì dừng giữa chừng bộ cũ phải đi qua đường nhả ranh giới
  lượt và cổng bảo trì.
- Vòng automation (5 giây một lần) chạy riêng, chưa hỏi bộ giữ.
- Data đang ở giữa bước nhận và bước ghi dấu đúng lúc máy chuyển sang ngủ vẫn có thể bị gửi ở lần thức tạm sau. Chỉ có
  1 data mỗi tài khoản mỗi lần ngủ, thay vì cứ 16 phút một lần như trước.

## Bật, tắt

Khoá `desktop.sleep_guard` (đọc cùng điều kiện `is_active = true`, `is_secret = false`), giá trị JSON:

```json
{"mac": true, "win": false, "awakeMinutes": 10}
```

- Thiếu dòng, JSON sai, hay thiếu / sai từng khoá thì khoá đó lấy mặc định (`mac` true, `win` false, `awakeMinutes` 10;
  `awakeMinutes` hợp lệ từ 1 tới 120).
- Desktop đọc lúc đăng nhập và đọc lại mỗi 10 phút, kể cả khi đang giữ. Tắt công tắc khi máy đang giữ thì máy thôi
  giữ ngay ở lần đọc kế tiếp, không cần build lại hay mở lại app.
- Ghi dòng này là ghi vào production, phải được anh duyệt từng lần. Ví dụ tắt khẩn cấp trên Mac:

```sql
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('desktop.sleep_guard', '{"mac": false, "win": false}',
  'Desktop: giữ việc mới sau khi máy ngủ (docs/DESKTOP_SLEEP_GUARD.md)', false, true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, is_active = true, updated_at = now();
```

Cột và chỉ mục duy nhất `auto_system_settings_key_unique (key)` đã kiểm chỉ đọc ngày 18/11; câu trên chưa chạy thật.

## Kiểm sau khi khách lên bản mới

- Presence: lúc đang giữ, `auto_staff_device_presence.runtime_state` có thêm khoá `sleepHold` (`since`, `reason`:
  `suspend` | `clock_gap`). Web bỏ qua khoá lạ nên không đổi hợp đồng `normalizeDesktopRuntimeState`.
- Engine: máy Mac ngủ qua đêm phải về 0 lượt `auto_engine_target_runs` có `close_reason = 'stale'` và đã ghi dấu gửi
  trong các đợt thức tạm. Trong `edge_logs`, mỗi đợt thức tạm vẫn có ping presence nhưng không còn
  `rpc/aka_agent_engine_claim_target_v1`.
- Log app: `[SleepGuard] hold new work after system sleep` / `[SleepGuard] release`.

## Kiểm offline

```bash
node scripts/desktop-sleep-guard-smoke.cjs
node scripts/desktop-runtime-snapshot-smoke.cjs
```
