# Đồng bộ trạng thái tin nhắn Zalo: phần của chương trình gửi tin (App Server, app Desktop)

Cập nhật 13/11/2026. Tính năng ghi nhận **đã nhận, đã xem, đã tương tác (thả cảm xúc), đã phản hồi** cho tin Zalo 1-1 của chiến
dịch, chỉ với tài khoản Zalo **không có akaChat**. Tài liệu này chỉ nói phần nằm trong repo akaAgent. Thiết kế, phần DB, API,
Web và iOS: akaAgentWebApp `docs/ZALO_MESSAGE_STATUS_SYNC.md` (phần đã làm) và `docs/ZALO_MESSAGE_STATUS_SYNC_PLAN.md` (lý do).

## 1. Trạng thái

| Phần | Trạng thái |
|---|---|
| Mã chương trình gửi (App Server, Desktop bộ chạy cũ, Desktop bộ chạy mới) | **Đã merge `dev_3` qua [#672](https://github.com/aligoinc/akaAgent/pull/672)** (13/11/2026; phần DB / API / Web / iOS: akaAgentWebApp `dev_1` qua #226), **chưa build, chưa phát hành, App Server chưa cài VPS** |
| SQL `migrations/migration_v525_zalo_message_status_sync.sql` (bảng, hàm, trigger, lịch job, 18 dòng cấu hình) | **CHƯA apply** |
| SQL `migrations/migration_v526_zalo_message_status_statuses.sql` (bật hai trạng thái 62, 63 và thêm quy tắc `zalo.*`) | **CHƯA apply**; chủ hệ thống đã duyệt nội dung ngày 13/11, chưa ra lệnh apply |
| Công tắc `zalo.message_status_sync.enabled` | Chưa có dòng (migration chưa apply); sau khi apply mặc định `false` |
| Runtime Chat trên Fly (akaAgentChatApi) | Chưa làm (dưới 1% lượt gửi thuộc phạm vi) |

Khi SQL chưa apply hoặc công tắc đang tắt, bản mã này **không đổi hành vi nào**: không ghi thêm gì vào kết quả gửi, không gọi
hàm DB nào của tính năng. Việc duy nhất nó làm thêm là một lượt đọc nhỏ bảng cấu hình, tối đa 15 phút một lần cho mỗi tiến trình
(tối đa 4 lượt mỗi giờ), và chỉ khi tiến trình đang gửi tin Zalo 1-1 hoặc đang có bộ nghe Zalo hoạt động.

Số **525** (migration chính) và **526** (bước trạng thái), đặt ngày 13/11/2026. **Trước khi apply phải kiểm lại sổ migration
của DB**: migration 525 tự dừng nếu sổ đã có một `migration_v525_*` khác.

Lịch sử số: nhánh này đẩy lên GitHub lúc 21:50:56 VN với số 522 / 523. Trong giờ sau đó hai nhánh khác cũng lấy 522; bản
`migration_v522_data_group_member_matches_desktop` vào sổ DB thật lúc 22:23:07 VN (#670) và bản danh mục tương tác Zalo đổi thành
V524, vào sổ lúc 22:23:57 VN (#671). Sổ production là chốt cuối, nên hai file của tính năng này đổi thành 525 / 526 trước khi
merge (kiểm chỉ đọc lúc 22:57 VN: số lớn nhất trong sổ và trên mọi nhánh của repo là 524).

## 2. Chương trình gửi làm gì

Web không kết nối tới Zalo. Chỉ chương trình đang giữ kết nối Zalo của tài khoản mới biết khách đã nhận, đã xem hay đã trả lời.
Vì vậy phần "nghe" nằm ở đây, gồm ba việc:

1. **Ghi dấu tham chiếu lúc gửi.** Gửi xong một tin 1-1 (hoặc lời mời kết bạn) của chiến dịch, chương trình ghi khoá
   `zaloStatusRef` vào `data` của kết quả gửi, ngay trong lệnh ghi kết quả:
   `{ v: 1, a: UID tài khoản, t: UID người nhận, s: giờ gửi, m: [mã tin Zalo trả về], k: 'message' | 'friend_request' }`.
   Trigger trong DB đọc khoá này để đăng ký lượt gửi. Chỉ ghi cho lượt gửi **thành công**.
2. **Thu sự kiện của bộ nghe Zalo.** Tin đến, thả cảm xúc, biên nhận "đã nhận", "đã xem", đồng ý kết bạn của hội thoại 1-1 được
   rút gọn thành `{tài khoản, người kia, loại, giờ, mã tin}` và nằm trong một bộ đệm trong RAM. Không mang nội dung tin. Tin
   nhóm, tin tự gửi, "đang gõ" bị bỏ.
3. **Gửi lô xuống DB.** Mỗi `flush_interval_seconds` (mặc định 60 giây) bộ đệm được gửi thành một lô, tối đa `flush_max_rows`
   dòng. DB khớp sự kiện với lượt gửi và ghi mốc thời gian; DB cũng tự ghi cột trạng thái của kết quả. Chương trình gửi không
   tham gia hai việc đó.

Chương trình gửi **không tự xét** tài khoản có akaChat hay không. Nó cứ gửi sự kiện; DB trả về danh sách tài khoản bị từ chối
(`rejectedAccountIds`) và chương trình ngừng thu cho các tài khoản đó 10 phút, mỗi lần bị từ chối tiếp thì gấp đôi, tối đa 2 giờ.

## 3. Hai hệ thống theo dõi, độc lập với nhau

Repo đã có cơ chế **theo dõi tương tác** (V339, `zaloCampaignEngagement.ts`, công tắc `zalo.campaign_engagement.*`). Tính năng
này là hệ thống thứ hai. Chủ hệ thống chốt ngày 13/11/2026: giữ cả hai, hai bên hoạt động độc lập, mỗi bên một công tắc bật tắt
bất cứ lúc nào.

| | Theo dõi tương tác (cũ) | Đồng bộ trạng thái tin nhắn (mới) |
|---|---|---|
| Công tắc | `zalo.campaign_engagement.enabled` | `zalo.message_status_sync.enabled` |
| Khoá trong kết quả gửi | `zaloEngagementSource`, `zaloEngagementPending` | `zaloStatusRef` |
| Bộ đệm | Hàng đợi có nhật ký trên đĩa | Bộ đệm trong RAM, tối đa 5.000 dòng |
| Hàm DB | `aka_agent_register/read/record_campaign_engagement` | `aka_agent_ingest_zalo_message_status`, `aka_agent_desktop_ingest_zalo_message_status` |
| Phạm vi | Mọi tài khoản Zalo không dùng trình duyệt | Chỉ tài khoản không có akaChat (DB quyết định) |

Điểm dùng chung duy nhất là **bộ nghe Zalo** của tài khoản (một kết nối tới Zalo). Bộ nghe được mở khi **một trong hai** tính năng
đang bật. Mã của bên này không import, không đọc và không ghi gì của bên kia; lỗi của bên này không chạm tới bên kia. Bài kiểm
`scripts/zalo-message-status-sync-smoke.cjs` có bước chặn việc vô tình nối hai bên.

Quy tắc "đã cập nhật rồi thì bỏ qua" (hai hệ thống cùng ghi cột trạng thái) nằm ở DB, không ở đây.

## 4. Các file

| File | Việc |
|---|---|
| `src/shared/zaloMessageStatusSync.ts` | Hợp đồng dùng chung. **Chép nguyên văn** từ akaAgentWebApp `packages/control-api/src/zaloMessageStatusSync.ts`: sửa ở WebApp trước, chép lại, rồi cập nhật mã băm trong bài kiểm |
| `src/main/services/zaloMessageStatusRuntime.ts` | Phần chạy: đọc cấu hình theo nhu cầu, dựng dấu tham chiếu, bộ đệm, gửi lô, thử lại, chặn tài khoản bị từ chối. Không import Electron hay Supabase |
| `src/main/services/zaloMessageStatusSync.ts` | Nối phần chạy với DB thật của tiến trình; ba hàm cho nơi khác gọi |
| `src/main/services/zaloRuntimeService.ts` | `notifyRealtimeSubscribers` chuyển sự kiện của bộ nghe; `warmCampaignEngagementListener` mở bộ nghe khi một trong hai tính năng bật |
| `src/main/services/campaignScheduler.ts` | Bốn điểm gửi của bộ chạy cũ: nhắn người lạ, nhắn bạn bè, kết bạn, chia sẻ cho bạn bè (tìm `statusSend`) |
| `packages/campaign-engine/src/zalo/engagement.ts` | Lõi bộ chạy mới: gọi hàm tuỳ chọn `messageStatusBegin` của cổng |
| `src/main/engineAdapters/desktopZaloPort.ts` | Cổng Desktop của bộ chạy mới cài `messageStatusBegin` |
| `migrations/migration_v525_…`, `rollback_v525_…`, `migration_v526_…`, `rollback_v526_…` | SQL, giống từng byte với akaAgentWebApp `scripts/sql/zalo-message-status-sync/` (bộ kiểm SQL chạy ở đó) |
| `scripts/zalo-message-status-sync-smoke.cjs` | Bài kiểm phần chạy (đồng hồ giả, DB giả) |

Ba hàm của `zaloMessageStatusSync.ts`:

```ts
// Ngay trước lệnh gửi. null = không theo dõi được (tài khoản trình duyệt, thiếu UID).
const statusSend = beginZaloMessageStatusSend(account, zaloRuntime.getCachedOwnUid?.(account.id), target.uid, 'message')
const response = await gửi(...)
// Chỉ ở nhánh gửi THÀNH CÔNG: trải vào data của kết quả. Tính năng tắt thì là {}.
data: { ..., ...(statusSend?.detailData(response) ?? {}) }

receiveZaloMessageStatus(type, payload, accountId, ownUid)   // mỗi sự kiện của bộ nghe; không ném lỗi, không chờ IO
zaloMessageStatusSyncEnabled()                               // có cần mở bộ nghe không
```

Lô chia sẻ tạo `statusSend` cho cả lô rồi gọi `statusSend.markSending()` ngay trước khi gửi cho từng người, để giờ gửi đúng.

## 5. App Server và app Desktop khác nhau ở đâu

| | App Server (VPS) | App Desktop |
|---|---|---|
| Quyền DB | Khoá máy chủ (`service_role`) | Phiên đăng nhập của nhân viên (`aka_agent_desktop`) |
| Hàm nhận lô | `aka_agent_ingest_zalo_message_status('server', lô)` | `aka_agent_desktop_ingest_zalo_message_status(lô)` |
| Ai được nhận | Mọi tài khoản, DB xét phạm vi akaChat | Chỉ tài khoản do chính nhân viên đang đăng nhập phụ trách; tài khoản khác bị trả về `rejectedAccountIds` |
| Trần trong ngày | Trần chung `max_events_per_day` | Thêm hai trần: mỗi nhân viên 1/20 trần chung (tối thiểu 1.000 sự kiện); mọi app Desktop cộng lại 1/2 trần chung, phần còn lại luôn dành cho App Server |
| Hạn giờ của hàm | Theo vai trò máy chủ | 15 giây, đặt ngay trên hàm (vai trò Desktop mặc định chỉ có 3 giây) |
| Đổi người đăng nhập | Không có | Bỏ phần đang đệm |

App Desktop chạy trên máy của khách nên không được gọi thẳng hàm nhận lô. Hàm bọc của Desktop lấy nhân viên từ phiên
(`private.aka_agent_desktop_data_context()`, V436), không nhận từ tham số. Chỗ của lô được giữ trước khi nhận, bằng một lệnh ghi
có điều kiện trên dòng của nhân viên, nên nhiều lần gọi đồng thời của cùng một nhân viên không thể cùng lọt dưới trần. Chạm một
trong hai trần thì hàm trả `enabled = false, paused = true`: app bỏ bộ đệm, ngừng thu 30 phút rồi thử lại.

Phạm vi thí điểm (`organization_ids`) được xét theo tổ chức của **nhân viên phụ trách** tài khoản, ở cả ba nơi: lúc ghi dấu tham
chiếu, lúc thu sự kiện và trong DB. Cột tổ chức của tài khoản chỉ dùng khi không biết nhân viên.

Tài khoản Zalo đăng nhập bằng trình duyệt (`is_zalo_show_web`) không có bộ nghe nên nằm ngoài phạm vi, như cơ chế cũ.

## 6. Bật, tắt và độ trễ

Mọi công tắc là dòng trong `auto_system_settings`, tiền tố `zalo.message_status_sync.` (danh sách đủ ở tài liệu WebApp, mục 3).
Chương trình gửi đọc: `enabled`, `capture_enabled`, `organization_ids`, `flush_interval_seconds`, `flush_max_rows`,
`track_friend_accept`, `reply_ignored_kinds`.

- **Bật** `enabled = true`: mỗi tiến trình nhận ra trong tối đa 15 phút (lần đọc cấu hình kế tiếp), không cần khởi động lại.
  Khởi động lại tiến trình thì nhận ra ngay.
- **Tắt** `enabled = false`: lô kế tiếp (tối đa `flush_interval_seconds`) được DB báo "đang tắt", chương trình bỏ bộ đệm và ngừng
  thu ngay; tiến trình không có sự kiện nào thì nhận ra trong tối đa 5 phút. Dấu tham chiếu ghi trong quãng đó vô hại: trigger
  của DB đọc công tắc trước tiên và bỏ qua.
- `capture_enabled = false`: vẫn ghi dấu tham chiếu, ngừng thu sự kiện.
- `organization_ids`: thí điểm theo tổ chức. Ngoài phạm vi thì không ghi dấu, không thu.
- Lời mời kết bạn chỉ có dấu tham chiếu khi `track_friend_accept = true`.

Lưu ý phiên bản: chỉ tiến trình chạy bản mã có tính năng mới ghi dấu và thu sự kiện. App Server là một tiến trình trên VPS
(khoảng 3/4 lượt gửi thuộc phạm vi) nên cài bản mới là có số liệu ngay; Desktop có số liệu dần theo việc khách cập nhật app.

## 7. Lượng yêu cầu tới DB

Không thêm kết nối, không thêm vòng hỏi định kỳ.

| Lúc | Thêm vào DB |
|---|---|
| SQL chưa apply, hoặc công tắc tắt | 1 lượt đọc `auto_system_settings` (18 khoá của tính năng, hạn 5 giây) mỗi 15 phút cho mỗi tiến trình đang gửi tin 1-1 hoặc đang có bộ nghe Zalo hoạt động. Không gọi hàm nào |
| Đang bật | Lượt đọc cấu hình mỗi 5 phút, cộng 1 lần gọi hàm nhận lô mỗi `flush_interval_seconds` cho mỗi tiến trình **khi bộ đệm có sự kiện** (hạn 20 giây) |
| Lỗi tạm thời khi gọi hàm (mạng, quá giờ, khoá) | Giữ lô, thử lại sau 1, 2 rồi 5 phút, kể cả khi sự kiện mới vẫn tới đều. Lỗi liên tiếp 6 lần thì bỏ lô và nghỉ 30 phút |
| DB từ chối kiểu gửi lại cũng không khác (chưa có hàm `PGRST202`, thiếu quyền `42xxx`, sai dữ liệu `22xxx`) | Bỏ lô, không gọi lại trong 30 phút |
| DB báo tạm ngừng nhận (chạm trần trong ngày, job phụ lỗi) | Bỏ bộ đệm, nghỉ 30 phút rồi thử lại: khoảng 2 lần gọi mỗi giờ |

Đọc cấu hình lỗi thì giữ trạng thái đang có và thử lại thưa dần (1 tới 5 phút). Chưa từng đọc được thì coi như tắt.
Bộ đệm đầy (5.000 dòng) thì sự kiện mới bị bỏ; số bị bỏ được đếm (`dropped`) và có cảnh báo trong log của tiến trình.

## 8. Quy tắc khi sửa tiếp

- Không bao giờ để phần này làm chậm, chặn hay làm hỏng việc gửi tin và việc nhận sự kiện: không `await` IO trong `beginSend`,
  `detailData`, `receive`; mọi lỗi bị nuốt và đếm.
- Không import hay dùng khoá của `zaloCampaignEngagement` trong ba file của tính năng, và ngược lại.
- Dấu tham chiếu phải nằm trong chính lệnh ghi kết quả gửi (trigger không chạy khi `data` được sửa về sau), và chỉ ở nhánh gửi
  thành công.
- Thêm một điểm gửi tin 1-1 mới thì gắn `beginZaloMessageStatusSend` cạnh `beginCampaignEngagementSend` của điểm đó.
- Lõi `packages/campaign-engine` đã có thêm một hàm cổng tuỳ chọn. ChatApi nhận thay đổi này ở lần chạy
  `scripts/sync-campaign-engine.cjs` kế tiếp; cổng Fly chưa cài hàm nên hành vi trên Fly không đổi.
- Sửa SQL: sửa ở akaAgentWebApp `scripts/sql/zalo-message-status-sync/`, chạy `scripts/test-zalo-message-status-sql.sh` ở đó,
  rồi chép lại bốn file sang `migrations/` (so md5).

## 9. Kiểm chứng

| Bài kiểm | Kết quả 13/11/2026 |
|---|---|
| `node scripts/zalo-message-status-sync-smoke.cjs` | 29 nhóm đạt. Chạy mã thật của phần chạy, của file nối DB (IO giả) và của hàm lõi `beginZaloEngagement`; khi máy có repo akaAgentWebApp bên cạnh thì so từng byte hợp đồng và bốn file SQL với bản gốc |
| `npx tsc --noEmit -p tsconfig.node.json`, `-p tsconfig.web.json`, `packages/campaign-engine` `tsc --noEmit` | 0 lỗi |
| `npm run build` (Desktop) và `npm run build:server` (App Server), chỉ dựng gói mã, không đóng bộ cài | Đạt; cả hai gói đều chứa mã của tính năng |
| `node scripts/campaign-engine-boundary-check.cjs` (ranh giới lõi bộ chạy mới) | Không có vi phạm |
| akaAgentWebApp `scripts/test-zalo-message-status-sql.sh` (PostgreSQL 16, bốn file SQL trên) | 239 bước đạt, gồm 27 bước cho hàm của Desktop (có bước hai lần gọi đồng thời) |
| Rà soát độc lập toàn bộ thay đổi (13/11) | Không có lỗi nặng; 7 điểm đã sửa: trần theo nhân viên giữ chỗ trước khi nhận, thêm trần chung cho Desktop, hạn giờ riêng của hàm Desktop, không thử lại mãi, giãn nhịp khi DB tạm ngừng, giờ gửi theo từng người ở bộ chạy mới, phạm vi thí điểm theo nhân viên |
| akaAgentWebApp `packages/control-api/src/zaloMessageStatusSync.test.ts` | 36 bài đạt |

Chưa làm: đóng bộ cài; chạy thử trên Electron thật và trên App Server thật với một tài khoản Zalo; chạy bộ kiểm SQL trên
PostgreSQL 17 (DB thật là 17.6); các bài kiểm của bộ chạy mới cần PostgreSQL 17 và module `pg` của repo ChatApi
(`scripts/campaign-outcome-engine-check-all.cjs`, `campaign-outcome-engine-engagement-smoke.cjs`…), máy làm việc này không có. Không có
tin Zalo thật nào được gửi trong quá trình làm.

## 10. Thứ tự đưa vào dùng

1. Merge nhánh này vào `dev_3`; build và cài App Server trên VPS (ngoài giờ cao điểm); phát hành Desktop ở lần phát hành kế tiếp.
   Làm trước bước 2 cũng không sao: chưa có dòng cấu hình thì bản mới không làm gì thêm.
2. Kiểm sổ migration, apply `migration_v525_zalo_message_status_sync.sql` ngoài giờ cao điểm. Công tắc vẫn tắt.
3. Khi muốn cột trạng thái của kết quả được cập nhật: apply `migration_v526_zalo_message_status_statuses.sql`.
4. Bật thí điểm: `organization_ids` = vài tổ chức, rồi `enabled = true`. Theo dõi bằng các câu truy vấn ở tài liệu WebApp, mục 10.
5. Mở rộng: `organization_ids = all`.

Gỡ: tắt công tắc là đủ để dừng. Gỡ hẳn phần DB bằng `rollback_v526_…` rồi `rollback_v525_…`; mã chương trình gửi không cần gỡ.
