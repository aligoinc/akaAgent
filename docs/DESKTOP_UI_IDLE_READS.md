# Giảm đọc DB của giao diện Desktop khi không ai nhìn và khi số tiến độ không đổi

Trạng thái 12/11/2026: **code xong trên nhánh `claude/zealous-maxwell-nr8iy6`, chưa merge `dev_3`, chưa build/phát hành Desktop**.
Không migration, RPC, quyền, index, kết nối hay polling mới. **Chưa có dòng cài đặt nào trong DB, nên với mọi máy
tính năng đang tắt**: bản Desktop có mã này đọc đúng như bản trước cho tới khi quản trị thêm dòng (mục [Bật, tắt](#bật-tắt)).

Phần này nối tiếp [v327](DESKTOP_UI_READS_V327.md) và [v328](DESKTOP_UI_READ_DELTAS.md): vẫn một bộ điều phối, hai đồng hồ
độc lập, mặc định 30 giây, gộp sự kiện 300 ms.

## Vì sao làm

Số đo production (akachat, chỉ đọc) ngày 12/11/2026, 24 giờ gần nhất:

| | Web | Desktop |
| --- | --- | --- |
| Lượt đọc trang chiến dịch | 17.372 | 294.963 (511 IP) |
| Ước tính phần thời gian chạy truy vấn của DB | khoảng 0,3% | khoảng 5% |

- 91% lượt đọc của Desktop đến đều 2 lượt/phút mỗi máy (hẹn giờ); 9% dồn theo sự kiện.
- Từ 0 đến 6 giờ sáng VN vẫn có 57–72 máy đọc đều, khoảng 4.400–5.300 lượt/giờ (9,4% cả ngày).
- Mỗi lượt đọc đếm lại tiến độ cho cả trang (`aka_agent_control_campaign_progress`, trung bình 7,9 ms, khoảng 980
  block). Mẫu 40 nhân viên đang có chiến dịch hoạt động: trang đầu trung bình 13 chiến dịch, khoảng 6.100 dòng data;
  chỉ khoảng 9% số dòng thuộc chiến dịch có thay đổi trong 10 phút gần nhất.

Nguyên nhân phía app: cửa sổ chính đặt `backgroundThrottling: false` (để bộ chạy không chậm khi thu nhỏ), nên trang
trong cửa sổ luôn thấy `document.visibilityState = "visible"` kể cả khi thu nhỏ hoặc ẩn. Chốt "ẩn thì ngừng đọc" của
bộ điều phối vì vậy không có tác dụng trên app thật. Đã xác nhận bằng `scripts/run-desktop-ui-attention-smoke.cjs`
trên Electron 33 (Linux): cửa sổ ẩn và cửa sổ thu nhỏ đều báo `visible`.

## Khóa cài đặt

Bốn dòng trong `auto_system_settings`, đọc **chung một câu đọc** với hai khóa chu kỳ sẵn có, một lần mỗi phiên đăng
nhập (`getDesktopPollingSettings`). Đổi giá trị xong, từng máy nhận khi đăng nhập lại hoặc mở lại app. Áp cho mọi máy,
không bật riêng theo tổ chức.

| Khóa | Ý nghĩa | Giá trị hợp lệ | Đề xuất khi bật |
| --- | --- | --- | --- |
| `desktop.campaigns.hidden_pause_enabled` | Ngừng đọc khi cửa sổ chính thu nhỏ, ẩn hoặc màn hình khóa | `true` | `true` |
| `desktop.campaigns.idle_after_seconds` | Cả máy không có thao tác chuột/phím bao lâu thì coi là không ai nhìn | 60–86400 | `600` |
| `desktop.campaigns.idle_poll_interval_seconds` | Chu kỳ đọc khi không ai nhìn | 30–3600 | `120` |
| `desktop.campaigns.progress_recount_seconds` | Bao lâu đếm lại tiến độ của chiến dịch không chạy và không đổi | 30–3600 | `300` |

- **Thiếu dòng, `is_active=false`, `is_secret=true`, giá trị sai định dạng hoặc ngoài khoảng = tắt** (app đọc như trước).
  Không có giá trị mặc định "bật" trong mã.
- Ba khóa đầu áp cho cả hai đồng hồ của bộ điều phối (chiến dịch và tài khoản) dù tên khóa là `campaigns`.
- Giãn cần đủ cả hai khóa `idle_after_seconds` và `idle_poll_interval_seconds`. Chu kỳ giãn chỉ kéo dài, không bao giờ
  ngắn hơn chu kỳ thường (`max(chu kỳ thường, idle_poll_interval_seconds)`).
- Ngừng khi ẩn và giãn khi không thao tác là hai công tắc độc lập.

Giữ cố định trong mã (chốt kỹ thuật, không phải thông số vận hành): gộp sự kiện 300 ms; hỏi lại trạng thái cửa sổ 30
giây/lượt khi đang ngừng hoặc giãn (`DESKTOP_UI_ATTENTION_RECHECK_MS`); hạn chờ lệnh hỏi 5 giây; khoảng chờ ổn định
sau khi chiến dịch đổi 90 giây (`CAMPAIGN_PROGRESS_SETTLE_MS`); bộ nhớ số tiến độ tối đa 2.000 chiến dịch.

## Mục 1: ngừng hoặc giãn đọc khi không ai nhìn

Tiến trình chính trả lời "có ai đang nhìn không" qua IPC `desktop-ui:attention`
([desktopUiAttention.ts](../src/main/services/desktopUiAttention.ts)): `hidden` = cửa sổ chính `isMinimized()` hoặc
`!isVisible()` hoặc `powerMonitor.getSystemIdleState(1) === 'locked'`; `idleSeconds` = `powerMonitor.getSystemIdleTime()`.
Hàm chỉ hỏi cửa sổ và hệ điều hành tại lúc gọi, **không giữ cờ trạng thái**, không đọc DB/mạng. Khi cửa sổ thu
nhỏ/khôi phục/ẩn/hiện, tiến trình chính gửi `desktop-ui:attention-changed` (không kèm dữ liệu) để giao diện hỏi lại ngay.

Bộ điều phối [useDesktopUiPolling.ts](../src/renderer/src/hooks/useDesktopUiPolling.ts):

| Tình huống | Hành vi khi khóa tương ứng bật |
| --- | --- |
| Cửa sổ thu nhỏ, ẩn, màn hình khóa | Không đọc trang chiến dịch và tài khoản, kể cả khi có sự kiện trạng thái. Chỉ hỏi lại trạng thái cửa sổ 30 giây/lượt (lệnh nội bộ). Quay lại: đọc ngay đúng một lượt mỗi loại, không đọc bù |
| Cửa sổ hiện, cả máy không thao tác ≥ `idle_after_seconds` | Đồng hồ hẹn giờ giãn theo `idle_poll_interval_seconds`. Đọc theo sự kiện trạng thái (300 ms) giữ nguyên |
| Có người dùng máy | Như trước (chu kỳ thường) |

Trong mọi tình huống, trạng thái/ghi chú/lịch của chiến dịch chạy trên máy vẫn cập nhật tức thì trong bộ nhớ từ tín
hiệu của bộ chạy (`upsertCampaign`), không cần đọc DB. Nút Làm mới, đổi trang/bộ lọc và mọi lượt đọc sau thao tác không
đi qua chốt này.

### Luôn ngả về "đang có người nhìn"

Mọi trường hợp không chắc đều đọc như trước, để màn hình không bao giờ đứng số:

- Khóa tắt: bộ điều phối không gọi lệnh hỏi, đường mã cho đúng kết quả như trước khi có phần này.
- Lệnh hỏi lỗi, thiếu, trả dữ liệu lạ hoặc quá 5 giây chưa trả lời.
- Không có cửa sổ, cửa sổ đã hủy, hoặc lệnh của cửa sổ ném lỗi.
- Có thao tác chuột/phím **ngay trong cửa sổ app**: 30 giây sau đó luôn coi là có người nhìn, bất kể tiến trình chính
  trả lời gì; nếu đang ngừng/giãn thì đọc ngay một lượt khi số đã cũ.
- Lỡ tín hiệu "hiện lại": lượt hỏi định kỳ 30 giây tự bắt kịp.

## Mục 2: chỉ đếm tiến độ khi có khả năng thay đổi

Khi `progress_recount_seconds` bật, giao diện gửi kèm cách đếm cho mỗi lượt đọc trang
(`getDesktopCampaignPage(query, { progress, recountSeconds })`):

- `reuse`: lượt đọc nền (hẹn giờ hoặc theo sự kiện trạng thái).
- `full`: mọi lượt do người dùng gây ra (Làm mới, đổi trang/bộ lọc, sau lưu/sửa/xóa/đổi trạng thái) và mọi lượt đọc nối
  tiếp. Đếm tất cả như trước, rồi ghi nhớ kết quả.

Tiến trình chính ghi nhớ số đã đếm theo phiên (tổ chức + nhân viên) trong
[campaignProgressReuse.ts](../src/main/data/campaignProgressReuse.ts). Lượt `reuse` vẫn đọc trạng thái mọi dòng của trang
như trước, nhưng chỉ gửi vào hàm đếm hiện có các chiến dịch thuộc một trong các trường hợp:

1. chưa có số trong bộ nhớ;
2. đang ở trạng thái `đang chạy`;
3. đang được mở chi tiết (dòng được ghim của trang);
4. nguồn nhóm data còn sống (`baselining`, `active`);
5. trạng thái, `updated_at`, `last_run_at`, trạng thái hoặc mốc cập nhật của nguồn nhóm data khác lần đếm trước;
6. vừa đổi (hoặc vừa được ghi nhớ lần đầu) trong 90 giây gần nhất;
7. số đã cũ quá `progress_recount_seconds`, hoặc đồng hồ máy bị lùi.

Không có chiến dịch nào cần đếm thì bỏ hẳn lượt gọi RPC. Lỗi của hàm đếm vẫn làm lượt đọc trang lỗi như trước, không
trả số cũ thay thế. Chiến dịch 0 dòng data được ghi nhớ rõ là 0/0. Đổi nhân viên/tổ chức là bỏ hết số cũ.

Vì sao dấu hiệu ở điều 5 đủ dùng (đã đối chiếu DB production 12/11/2026):

- Mọi kết quả chạy ghi vào `auto_campaign_details` đều cập nhật `last_run_at` và `updated_at` của chiến dịch qua trigger
  `trg_aka_agent_touch_campaign_last_run_at`, với mọi bộ chạy (Desktop, Server, Chat).
- Thêm data từ Web/iOS (`add_control_campaign_input_rows`) và data tự động từ nhóm data
  (`aka_agent_reserve_automation_data_group_input`) cập nhật `updated_at` của chiến dịch.

### Độ trễ còn lại

Số tiến độ của một chiến dịch **không chạy, không mở chi tiết** có thể cũ tối đa `progress_recount_seconds` khi data của
nó đổi từ nơi khác mà không để lại dấu hiệu trên dòng chiến dịch. Trường hợp đã biết: đổi trạng thái dòng từ Web/iOS
(`update_control_campaign_input_statuses_atomic` không cập nhật dòng chiến dịch). Các đường ghi data khác chưa rà hết;
hạn đếm lại là lưới chặn chung. Mở chi tiết chiến dịch hoặc bấm Làm mới luôn cho số mới.

Số này chỉ để hiển thị (cột tiến độ ở danh sách và câu gợi ý "Có số liệu mới" ở tab Báo cáo). Bộ chạy, hạn mức, claim
và các đường đọc khác (`listCampaignSummaries`, tab Data, tab Báo cáo) không dùng bộ nhớ này.

## Không đổi

- `backgroundThrottling` của mọi cửa sổ, bộ lập lịch chiến dịch, heartbeat, claim, kiểm tra phiên, group watcher,
  hạn mức và việc ghi log.
- RPC, câu đọc trang, phạm vi quyền, thời hạn request. Giao diện không tự gửi phạm vi hay quyền; tùy chọn đếm được
  chuẩn hóa lại ở tiến trình chính và chỉ nhận hai trường.
- Chu kỳ mặc định 30 giây, gộp sự kiện 300 ms, chống đọc trùng, phân trang/bộ lọc/nháp/chọn nhiều trang.
- Mười hai tệp khác trong giao diện đang dùng `document.visibilityState` (thông báo, nhật ký chạy, đồng bộ Sheet, Hỏi
  đáp AI…) giữ nguyên; chưa chuyển sang tín hiệu mới.

## Bật, tắt

Chưa chạy lệnh nào dưới đây trên production. Bật là thay đổi dữ liệu production, cần quyết định của người vận hành,
và chỉ có tác dụng với máy đã cài bản Desktop có mã này.

`auto_system_settings.id` không có giá trị mặc định nên phải chọn id chưa dùng:

```sql
-- Bật (ví dụ với giá trị đề xuất). Kiểm tra id chưa dùng trước; ON CONFLICT giữ giá trị quản trị đã đặt.
INSERT INTO public.auto_system_settings (id, key, value, description, is_active, is_secret)
SELECT base.id + item.offset_id, item.key, item.value, item.description, true, false
FROM (SELECT COALESCE(MAX(id), 0) AS id FROM public.auto_system_settings) AS base
CROSS JOIN (VALUES
  (1, 'desktop.campaigns.hidden_pause_enabled', 'true', 'Desktop: ngừng đọc danh sách khi cửa sổ thu nhỏ/ẩn/khóa màn hình. true = bật; khác = tắt.'),
  (2, 'desktop.campaigns.idle_after_seconds', '600', 'Desktop: máy không thao tác từ ngần này giây (60–86400) thì giãn chu kỳ đọc. Cần cả idle_poll_interval_seconds.'),
  (3, 'desktop.campaigns.idle_poll_interval_seconds', '120', 'Desktop: chu kỳ đọc danh sách khi máy không thao tác (30–3600 giây).'),
  (4, 'desktop.campaigns.progress_recount_seconds', '300', 'Desktop: đếm lại tiến độ chiến dịch không chạy sau ngần này giây (30–3600).')
) AS item(offset_id, key, value, description)
ON CONFLICT (key) DO NOTHING;

-- Tắt từng phần: đặt is_active=false (hoặc xóa dòng). Máy nhận khi đăng nhập lại.
UPDATE public.auto_system_settings SET is_active = false, updated_at = now()
WHERE key = 'desktop.campaigns.progress_recount_seconds';
```

`key` có ràng buộc duy nhất `auto_system_settings_key_unique` (đã đọc trên akachat 12/11/2026). Có thể bật từng khóa
một; nên bật `hidden_pause_enabled` trước, đo, rồi tới giãn và đếm tiến độ.

Gỡ mã: revert commit của nhánh; không có gì trong DB phải gỡ ngoài các dòng cài đặt nếu đã thêm.

## Kiểm chứng

Chạy trong container Linux ngày 12/11/2026 (Electron 33.3.1, xvfb), không DB, không mạng, không chạy chiến dịch:

| Lệnh | Kết quả |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.node.json` và `-p tsconfig.web.json` | sạch |
| `NODE_OPTIONS=--max-old-space-size=10240 npm run build` | đạt (main 3,6 s, preload 0,2 s, renderer 49,8 s). Không đặt `NODE_OPTIONS` thì bước renderer hết heap mặc định của Node trong container này; chưa thử điều đó trên mã gốc |
| `node scripts/desktop-ui-idle-reads-logic-smoke.cjs` | 13 nhóm đạt: bộ phân tích khóa, chu kỳ theo trạng thái, bộ nhớ số tiến độ |
| `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-desktop-ui-idle-reads-smoke.cjs` | 7 dòng PASS: store/panel/bộ điều phối thật, IPC giả, đồng hồ giả |
| `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a sh -c 'openbox & sleep 2; node scripts/run-desktop-ui-attention-smoke.cjs'` | 5 dòng PASS: tiến trình chính thật, ẩn/hiện/thu nhỏ/khôi phục |
| `ELECTRON_DISABLE_SANDBOX=1 xvfb-run -a node scripts/run-desktop-ui-reads-smoke.cjs` | y hệt mã gốc `dev_3` (`bf3d617`): 12 dòng PASS rồi dừng ở bước "Lịch sử gần đây" |

Ghi chú:

- Bộ thử `run-desktop-ui-reads-smoke.cjs` **đã lỗi ở bước "Lịch sử gần đây" trên mã gốc** trước thay đổi này (không tìm
  thấy nút của tab nhật ký); chưa sửa trong phạm vi này. Phần chu kỳ/ẩn/hiện của nó nằm trước bước lỗi và đạt.
- Đã thử làm hỏng có chủ đích phần ngừng đọc: bộ thử giao diện bắt được (10 lượt đọc thay vì 0).
- Bộ thử giao diện phủ: mặc định không đổi (không hỏi trạng thái cửa sổ, lượt đọc trang vẫn một tham số); ẩn 5 phút
  không đọc kể cả có sự kiện; hiện lại đọc đúng một lượt; lỡ tín hiệu hiện lại; tiến trình chính báo sai "đang ẩn"
  trong khi có thao tác; lệnh hỏi lỗi và treo; giãn 120 giây; sự kiện khi đang giãn; cách đếm của lượt nền, lượt người
  dùng và lượt nối tiếp.

**Chưa kiểm chứng**:

- Chưa chạy app thật trên Windows và macOS: thu nhỏ, đóng cửa sổ trên macOS (ẩn), khóa màn hình, ngắt phiên Remote
  Desktop trên VPS, giá trị thật của `getSystemIdleTime()`. Cần thử trước khi bật khóa trên production.
- Chưa chạy với DB thật: đường `listCampaignSummariesForPage` có bộ nhớ số tiến độ chỉ được kiểm bằng luật thuần và
  typecheck.
- Chưa có số đo lợi ích thật. Ước tính trước khi phát hành: mục 1 tối thiểu bằng phần đọc ban đêm (9,4% lượt đọc của
  Desktop); mục 2 giảm khoảng 80% công đếm tiến độ, từ một mẫu 40 nhân viên tại một thời điểm.

### Đo sau khi bật

So với các số ở đầu tài liệu, trong `edge_logs` của akachat: số lượt `aka_agent_desktop_campaign_page` mỗi IP mỗi ngày
và trong khung 0–6 giờ VN (mục 1); tỷ lệ lượt `aka_agent_control_campaign_progress` trên lượt đọc trang và độ dài thân
request của nó (mục 2). Lợi ích đến dần theo tốc độ khách cập nhật app và đăng nhập lại.
