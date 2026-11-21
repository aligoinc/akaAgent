# Kết bạn Zalo: trạng thái "Đã từ chối kết bạn" (V615)

21/11/2026. Anh yêu cầu ("Làm luôn") sau ca khách tổ chức 446 báo "kết quả gửi thành công mà Zalo check thì không kết bạn".

## Vì sao

- Lời mời kết bạn của chiến dịch đã gửi được thật: Zalo tự báo về sự kiện "đã gửi lời mời" cho từng lượt (tài khoản 10580, 19–21/11: 100/100 lượt "Kết bạn thành công" có sự kiện xác nhận).
- Người nhận từ chối thì Zalo bỏ lời mời đang chờ và hiện lại nút "Gửi kết bạn". Zalo có báo về sự kiện "reject" (zca-js `FriendEventType.REJECT_REQUEST` = 4), nhưng bộ theo dõi tương tác chỉ nhận "đã kết bạn" (ADD), nên lượt đó vẫn hiện "Đã gửi lời mời" mãi. Ca này: 8/100 lượt bị từ chối, có lượt 9 giây sau khi gửi.
- Phản hồi của lệnh gửi lời mời (`sendFriendRequest`) luôn là chuỗi rỗng kể cả khi gửi được, nên không dùng để phân biệt được.

## Sự kiện "reject" của Zalo

Đọc ở `chat_zalo_runtime_event` (tổ chức có Chat, runtime Fly ghi mọi sự kiện, giữ 7 ngày):

```
{"type": 4, "isSelf": true, "threadId": "<người nhận>", "data": {"fromUid": "<tài khoản gửi>", "toUid": "<người nhận>"}}
```

- `fromUid` / `toUid` là chiều của lời mời (người gửi → người nhận), không phải người bấm từ chối. Người gửi tự thu hồi là sự kiện khác (`undo_req`, type 3). Vì `fromUid` là tài khoản của mình nên zca-js gắn `isSelf: true` dù người nhận mới là người bấm.
- Tổ chức 446, 5 ngày tới 21/11: 307 sự kiện "đã gửi" và 28 sự kiện "từ chối", tất cả `fromUid` là chính tài khoản; không có lời mời nào gửi tới tài khoản.

## Thay đổi

| Nơi | Thay đổi |
|---|---|
| DB ([V615](../migrations/migration_v615_zalo_engagement_friend_rejected.sql)) | Cột `auto_campaign_detail_zalo_engagement.rejected_at` (để trống, không ghi lại bảng). `aka_agent_campaign_engagement_batch` nhận loại sự kiện `friend_rejected` ở nhánh đăng ký (đối chiếu sự kiện Chat đã lưu) và nhánh ghi sự kiện; chỉ khớp lượt gửi lời mời, trong hạn theo dõi, giữ mốc sớm nhất. Các nhánh khác giữ nguyên từng byte. |
| Bộ đọc sự kiện `zaloCampaignEngagement.ts` (giống hệt nhau ở WebApp `packages/control-api`, akaAgent `src/shared`, ChatApi `packages/runtime-protocol`) | Sự kiện bạn bè type 4 có `fromUid` = tài khoản → `friend_rejected`, người nhận = `toUid`; được miễn bộ lọc `isSelf`. `isFriendEngagementKind` cho việc khớp lượt. |
| ChatApi `campaignEngagementWatchStore.ts` | Khớp `friend_rejected` với lượt gửi lời mời như `friend`. |
| Hiển thị | `finalEngagementStage` (WebApp, chép sang akaAgent): lượt kết bạn có `rejected_at` mà chưa `friended_at` → `rejected`, nhãn "Đã từ chối kết bạn" (anh chọn qua hộp chọn 21/11/2026); xếp hạng gộp theo người nhận đặt sau "Đã đồng ý kết bạn". Web / Desktop: nhãn màu đỏ; iOS: mốc "Đã từ chối kết bạn" màu đỏ. Danh sách kết quả trả `to_jsonb(engagement)` nên không phải sửa hàm đọc. |

Trạng thái chính của dòng vẫn là "Thành công" (gửi lời mời đúng là đã thành công); chỉ cột tương tác đổi.

Chưa làm ở bản này (anh chốt bản đầu): bộ lọc "Đã từ chối kết bạn", đếm trong báo cáo hiệu quả (bộ lọc "Chưa có tương tác" vẫn tính cả lượt bị từ chối), ghi bù các lần từ chối trước lúc đưa lên. Tài khoản Zalo trình duyệt nghe sự kiện với `selfListen: false` nên không nhận được sự kiện từ chối.

## Trạng thái

- **V615 đã apply akachat 17:31:33 VN 21/11/2026** theo yêu cầu ("apply luôn đi"; sổ `20261121103128`, không apply lại, md5 sổ = file `b46c13bd…`; chạy thử trong giao dịch rồi huỷ ngay trước đó; PostgREST nạp lại schema 5,5 giây, 0 lỗi 5xx / 503; [biên nhận](../migrations/snapshots/zalo-friend-rejected-v615/apply-receipt.json)). Lúc viết là V613 rồi V614, cả hai số bị phiên khác apply trước.
- Code ba repo chưa merge, ChatApi / Web chưa deploy, Desktop / iOS chưa phát hành: chưa có lượt nào được ghi "Đã từ chối kết bạn".

## Thứ tự đưa lên

Hai phía độc lập: hàm DB cũ bỏ qua loại sự kiện lạ (không lỗi), runtime cũ không gửi loại mới.

1. Apply V615: đã làm 17:31 VN 21/11/2026 (xem Trạng thái).
2. Deploy ChatApi nhóm `worker` (bộ đọc và ghi tương tác chỉ chạy ở `apps/system-worker`; `zalo_runtime` đã chuyển nguyên sự kiện "reject" lên, không cần deploy): tổ chức có Chat / chạy trên Fly có trạng thái từ lúc này.
3. Deploy Web (nhãn trên Web). iOS cần bản phát hành mới. Desktop + App Server: bản phát hành sau (vừa ghi sự kiện cho tài khoản QR / Server trên VPS, vừa hiện nhãn trên Desktop).

## Gỡ

[rollback_v615](../migrations/rollback_v615_zalo_engagement_friend_rejected.sql): trả hàm về đúng thân V524 và bỏ cột (mất các mốc đã ghi). Runtime mới vẫn chạy được với hàm cũ (sự kiện từ chối bị bỏ qua).

## Kiểm thử

- `node scripts/run-zalo-engagement-v615-smoke.cjs` (PostgreSQL 17 cục bộ): V339 → V341 → V510 → V524 (khớp production `167571de…` / `e5b44316…`), thân V524 bỏ qua `friend_rejected` không lỗi, V615 áp / từ chối áp lại / gỡ về đúng V524 / từ chối gỡ lại / áp lại, chỉ các dòng mốc từ chối khác V524, bài kiểm cũ `assertions.sql` vẫn đạt, các ca V615 ([friend_rejected_v615.sql](../scripts/fixtures/zalo-engagement/friend_rejected_v615.sql)).
- `node scripts/zalo-campaign-engagement-smoke-test.cjs`: thêm ca bộ đọc sự kiện và khớp lượt (bài này hỏng sẵn từ 09/10/2026 ở bước giả lập `createCampaignDetail`, sau các ca mới).
- ChatApi: `packages/runtime-protocol/src/zaloCampaignEngagement.test.ts` (sự kiện thật của tổ chức 446), `campaignEngagementWatchStore.test.ts`.
- WebApp: `campaignEffectiveness.test.ts`, `zaloMessageStatusSync.test.ts`.
- Bộ sinh: `node scripts/build-v615-sql.cjs` (không sửa tay migration).
- ChatApi `campaignEngagement.integration.test.ts` nhóm "friend request rejected by the recipient (V615)" (PGlite, dựng V339 → V341 → V510 → V524 → V615 từ checkout akaAgent qua `AKA_AGENT_REPO`): sự kiện "reject" thật đi trọn đường inbox → worker → hàm ghi, cả khi lượt đã đăng ký trước lẫn khi sự kiện tới trước lúc đăng ký. Thay bộ đọc sự kiện bằng bản cũ thì hai ca này hỏng. Checkout chưa có V615 thì bỏ qua, có báo lý do.

## Phát lại dữ liệu thật (21/11/2026, chỉ đọc production)

Sự kiện kết bạn 7 ngày ở `chat_zalo_runtime_event` của 81 tài khoản chạy trên Fly (80 tài khoản gửi lời mời nhiều nhất, khoảng 74% lượng lời mời trên Fly, cộng tài khoản 10580 của ca khách báo), khớp với lượt theo dõi thật của các tài khoản đó; chạy cả bộ đọc sự kiện cũ (`dev_3`) và mới.

- 30.730 sự kiện kết bạn. Mọi sự kiện không phải "từ chối" cho ra đúng như bản cũ (0 khác).
- 1.687 sự kiện "reject": 1.682 là lời mời của chính tài khoản bị từ chối (`fromUid` = tài khoản), 5 ca còn lại đều có `toUid` = tài khoản (tài khoản từ chối lời mời người khác gửi tới) và bị bỏ đúng. Không có dữ liệu dạng lạ.
- 17.617 lượt gửi lời mời đang theo dõi → 1.234 lượt (7,0%) thành "Đã từ chối kết bạn"; đối chiếu độc lập từ sự kiện thô cho đúng cùng tập. Khớp lượt trong bộ nhớ và theo DB cho cùng kết quả.
- Không ghi được: 396 lần từ chối không có lượt theo dõi nào (lời mời gửi tay hoặc lượt không có `zaloEngagementSource`), 8 lần chỉ có lượt nhắn tin, 26 lần tới sau hạn theo dõi. Hạn theo dõi trên production hiện là 168 giờ cho hầu hết lượt (`zalo.campaign_engagement.tracking_window_hours`).
- Thời gian từ lúc gửi tới lúc bị từ chối: trung vị 90 phút, 90% trong 42 giờ, lâu nhất 7 ngày.
- Tài khoản 10580: 7/8 lượt bị từ chối được ghi; lượt còn lại (Le Thi Ngoc Kim, 19/11) không có `zaloEngagementSource` nên không được theo dõi tương tác (lỗ hổng có sẵn của bộ theo dõi trên Fly, không do bản này).
