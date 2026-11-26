# Tự gửi tin khi một người được gắn tag Zalo — phương án

Viết 26/11/2026. Anh duyệt và bảo "Thực thi theo phương án" cùng ngày. **Đã code (mục 8). V660 đã apply 12:30 VN 26/11, công tắc
bật. Chiều 26/11 anh chốt "Cách A": gửi cho mọi người được gắn tag, kể cả người chưa là bạn bè (mục 10; V669 đã apply 21:46:19 VN 26/11). Chưa
deploy, chưa build, chưa merge.**

Tính năng: chiến dịch "Nhắn tin bạn bè" ở chế độ "Gửi cho bạn bè thuộc danh sách tag" có thêm ô chọn. Bật ô này thì mỗi khi
một người được gắn một trong các tag đã chọn trên Zalo, hệ thống tự thêm người đó vào chiến dịch và gửi tin. Chiến dịch đang
"hoàn thành" thì tự chuyển về "chờ xử lý" để gửi tiếp.

## 1. Anh đã chốt (26/11)

| Điểm | Chốt |
|---|---|
| Người nhận | ~~Đợt này chỉ gửi cho người đã là bạn bè.~~ Đổi chiều 26/11 ("Cách A", mục 10): gửi cho mọi người được gắn tag, kể cả người chưa là bạn bè. |
| Gỡ tag | Sổ tag ghi cả gắn lẫn gỡ. Tính năng gửi tin chỉ phản ứng với gắn tag. |
| Mất kết nối rồi nối lại | Bỏ: những người được gắn tag trong lúc mất kết nối không được gửi. |
| Zalo trình duyệt | Chưa làm. |
| Dừng tự thêm | Có công tắc Dừng / Tiếp tục ngay ở chi tiết chiến dịch (mục 4.6), không phải mở form sửa. |

Tôi đang hiểu câu trả lời "có" của anh là đồng ý các đề xuất còn lại. Nếu sai anh sửa giúp:

- Gỡ rồi gắn lại: không gửi lại. Mỗi người chỉ vào một chiến dịch một lần.
- Chiến dịch đang tạm dừng: vẫn nhận người mới, không tự chạy. Chiến dịch đã qua ngày kết thúc hoặc đã xoá: không nhận.
- Độ trễ 1–2 phút từ lúc gắn tag tới lúc vào chiến dịch: chấp nhận.
- Tag do chính akaAgent gắn (bước "gắn tag Zalo" của chiến dịch khác, hoặc gắn trong Chat) cũng kích hoạt.

## 2. Hiện trạng (đọc code và production, chỉ đọc)

**Zalo không báo khi gắn tag.** Thư viện kết nối (zca-js 2.1.2, `apis/listen.js`) chỉ phát các sự kiện: tin nhắn, thu hồi,
đã nhận, đã xem, cảm xúc, đang gõ, sự kiện nhóm, sự kiện bạn bè. Không có sự kiện tag. Cách duy nhất chắc chắn có là gọi
`getLabels`: một lượt gọi trả về mọi tag, danh sách người trong từng tag và một số phiên bản (`version`).

Chưa xác minh: Zalo có thể vẫn đẩy tín hiệu tag qua kết nối mà thư viện đang bỏ qua (nó bỏ mọi `act_type` lạ). ChatApi đã
có sẵn chỗ vá thư viện để bắt tín hiệu lạ (`scripts/patches/zca-js-2.1.2-message-sync.json`, dùng cho đồng bộ tin từ điện
thoại). Bước 0 của kế hoạch là thử việc này.

**Chế độ "theo tag" hiện tại chỉ lấy danh sách một lần.** Lượt đầu đọc tag rồi lọc trên danh sách bạn bè, thêm vào chiến
dịch và ghi dấu `zaloFriendDataMaterializedAt`; các lượt sau không đọc lại (`packages/campaign-engine/src/zalo/materialize.ts`,
bộ chạy cũ `campaignScheduler.ts`).

**Nhóm data → Điều kiện động → "Tag Zalo"** là tính năng gần nhất đang có:

1. Nguồn là bảng tag của akaChat `chat_zalo_account_conversation_tag`.
2. Trigger `trg_aka_agent_dynamic_filter_sync_chat_contact` trên bảng đó đưa liên hệ vào hàng chờ
   `auto_account_contact_dynamic_filter_queue`.
3. Job `aka-agent-data-group-dynamic-filter-worker` (30 giây) xét điều kiện, cho liên hệ vào / ra nhóm.
4. Job `aka-agent-data-group-route-worker` (10 giây) đẩy thành viên mới sang chiến dịch đang nhận data từ nhóm.

Ba giới hạn làm nó không dùng lại nguyên được:

- Bảng tag của Chat chỉ được ghi khi runtime gửi ảnh chụp tag (`account_tags_snapshot`): lúc tài khoản kết nối, lúc đồng bộ
  lại, và sau khi chính hệ thống gắn tag (Chat hoặc bước gắn tag của chiến dịch). Không có đọc định kỳ, nên gắn tag trên điện
  thoại phải chờ lần kết nối lại.
- Tổ chức không có akaChat: runtime Fly bỏ ảnh chụp tag (`CHAT_ONLY_ACCOUNT_EVENT_TYPES` trong `runtimeEventFilter.ts`).
- Tài khoản Desktop QR và App Server VPS không ghi bảng này.

Đang dùng thật: 3 điều kiện "Tag Zalo", 1 đang bật, ở 1 tổ chức.

**Ai đang dùng "gửi theo tag"** (60 ngày, chiến dịch chưa xoá): 234 chiến dịch, 225 thuộc tổ chức không có Chat.

| Nơi chạy | Chiến dịch | Tổ chức |
|---|---|---|
| Zalo Server trên VPS (chưa bật cờ runtime mới) | 90 | 13 |
| Zalo QR trên Desktop | 83 | 8 |
| Zalo Server trên Fly | 45 | 11 |
| Zalo trình duyệt | 16 | 6 |

**Đồng bộ trạng thái tin (đã nhận / đã xem, V525)** chạy trên Desktop và App Server: bộ nghe Zalo → bộ đệm trong RAM → mỗi 60
giây gửi một lô xuống DB → DB khớp và ghi. Fly chưa có phần này.

## 3. Đồng bộ tag có theo cơ chế đồng bộ trạng thái tin không

Cùng khung, khác một điểm.

Giống:

- Chương trình đang giữ kết nối Zalo thu dữ liệu rồi gửi xuống DB theo lô; DB quyết định mọi thứ, chương trình gửi không tự
  xét gì.
- Bật / tắt và chỉnh nhịp bằng các dòng cấu hình `zalo.tag_sync.*`, đọc cùng kiểu với `zalo.message_status_sync.*`.
- Desktop gọi qua hàm bọc theo phiên đăng nhập, có trần số lượt; DB trả danh sách tài khoản bị từ chối thì chương trình
  ngừng gửi cho tài khoản đó một lúc.
- Không bao giờ làm chậm hay làm hỏng việc gửi tin.

Khác:

- Trạng thái tin là **nghe**: Zalo tự đẩy "đã nhận", "đã xem". Tag là **hỏi**: chương trình phải gọi `getLabels` theo nhịp
  rồi để DB so với lần trước. (Nếu bước 0 tìm ra tín hiệu tag thì chuyển sang nghe, hỏi định kỳ chỉ còn là lưới đỡ.)
- Trạng thái tin áp dụng cho mọi tài khoản không có Chat. Tag chỉ hỏi cho tài khoản đang có chiến dịch bật ô này, để không
  thêm lượt gọi Zalo cho hơn một nghìn tài khoản khác.
- Trạng thái tin chưa có trên Fly. Tag phải có trên Fly ngay (45 chiến dịch), đi bằng sự kiện ảnh chụp tag sẵn có.

## 4. Thiết kế

### 4.1 Sổ tag trong DB

Bảng mới, RLS bật, chỉ hàm ghi:

- `auto_zalo_tag_sync_accounts` — mỗi tài khoản một dòng: phiên bản tag lần gần nhất, giờ nhận ảnh chụp gần nhất, giờ lấy
  mốc, nơi gửi (fly / server / desktop).
- `auto_zalo_tag_members` — khoá `(account_id, tag_zalo_id, member_uid)`: ai đang nằm trong tag nào.
- `auto_zalo_tag_member_events` — nhật ký gắn / gỡ: tài khoản, tag, người, loại (`add` / `remove`), giờ phát hiện. Giữ 30
  ngày, dọn theo job.
- `auto_campaign_zalo_tag_adds` — khoá `(campaign_id, member_uid)`: người nào đã được đưa vào chiến dịch nào, từ tag nào,
  dòng data nào. Bảng này giữ luật "mỗi người một lần mỗi chiến dịch".

Một hàm nhận ảnh chụp: `aka_agent_ingest_zalo_tag_snapshot(nguồn, tài khoản, phiên bản, danh sách tag kèm người)`.
Trong một giao dịch nó:

1. Kiểm tài khoản thuộc đúng nơi gửi và đang có chiến dịch cần theo dõi; không thì trả "từ chối".
2. Phiên bản trùng lần trước: chỉ ghi giờ, không làm gì thêm.
3. So với `auto_zalo_tag_members`: ghi người mới gắn, người mới gỡ vào nhật ký và cập nhật bảng thành viên.
4. Quyết định có đưa vào chiến dịch không (mục 4.2).

Hai trường hợp ảnh chụp chỉ làm mốc, không đưa ai vào chiến dịch:

- Ảnh chụp đầu tiên của tài khoản.
- Ảnh chụp trước cách quá `zalo.tag_sync.stale_minutes` (đề xuất 30 phút, giống ngưỡng chatbot của Chat đang dùng). Đây là
  cách thực hiện điểm "mất kết nối thì bỏ".

Hàm thứ hai trả danh sách tài khoản cần hỏi tag cho một nơi chạy: tài khoản có ít nhất một chiến dịch nhắn tin bạn bè, chế độ
theo tag, bật ô, chưa xoá, chưa qua ngày kết thúc.

### 4.2 Đưa người vào chiến dịch

Với mỗi người mới gắn tag T của tài khoản A, tìm chiến dịch của A thoả: nhắn tin bạn bè, chế độ theo tag, bật ô, T nằm trong
tag nguồn, chưa xoá, chưa qua ngày kết thúc, đã lấy danh sách lần đầu. Với từng chiến dịch:

1. Người này đã có dòng trong `auto_campaign_zalo_tag_adds` hoặc đã có trong data của chiến dịch (so theo UID): bỏ qua.
2. Thêm một dòng data "chờ xử lý", `control_append_idempotency_key = 'zalotag:<chiến dịch>:<uid>'` (cột này đã có, dùng để
   chống thêm trùng và để bộ chạy nhận ra dòng do tag thêm vào; không sửa cấu trúc bảng data 7,9 GB).
3. Chiến dịch đang "hoàn thành": chuyển về "chờ xử lý", lịch = bây giờ, như đường "Thêm data" đang làm
   (`reopenCompletedCampaignAfterInputInsert`). Chiến dịch "tạm dừng": giữ nguyên trạng thái.

Chiến dịch đang tắt tự thêm (`zaloFriendTagAutoAddEnabled` = false, mục 4.6) không khớp, nên không nhận ai.
4. Ghi một dòng tiến trình: `🏷️ Đã thêm "<tên>" vào chiến dịch vì vừa được gắn tag "<T>"`.

Chiến dịch chưa lấy danh sách lần đầu thì không cần thêm: lượt đầu sẽ đọc tag và thấy người này.

Nhóm (hội thoại nhóm cũng gắn tag được) bị bỏ ở bước này; sổ tag vẫn ghi.

### 4.3 Chỉ gửi cho bạn bè (đã bỏ chiều 26/11, xem mục 10)

Danh sách tag của Zalo không cho biết ai là bạn bè. Kiểm ngay trước khi gửi, chỉ với dòng có khoá `zalotag:`:

- Bộ chạy đọc trạng thái bạn bè của người đó (một lượt đọc; cả hai bộ chạy đã có lệnh này cho bước gắn tag / đổi tên:
  `zaloTagSkipIfFriend`).
- Chưa là bạn bè: không gửi, ghi dòng lịch sử "Bỏ qua" với câu `Chưa là bạn bè nên không gửi`, không tính lượt, không cộng
  chuỗi lỗi. Câu này cần anh duyệt.
- Không đọc được trạng thái bạn bè: data về hàng chờ, thử lại lượt sau.

Người lấy từ danh sách lần đầu không bị kiểm thêm (họ được lọc trên danh sách bạn bè sẵn rồi).

### 4.4 Chương trình hỏi tag

| Nơi chạy | Cách làm |
|---|---|
| Fly (ChatApi) | `api` gắn thêm cờ "cần theo dõi tag" vào danh sách tài khoản giao cho runtime (cùng chỗ với `realtimeGroupIds`). Runtime gọi `getLabels` theo nhịp cho các tài khoản có cờ; phiên bản đổi thì phát sự kiện ảnh chụp tag sẵn có, không bị lọc "không Chat" khi có cờ. Worker gọi hàm nhận ảnh chụp. Tổ chức có Chat thì bảng tag của Chat cũng được làm tươi theo, nên Nhóm data hưởng lợi. |
| Desktop QR | Dịch vụ mới cạnh `zaloMessageStatusRuntime`: đọc danh sách tài khoản cần theo dõi 5 phút một lần và ngay sau khi lưu chiến dịch trên máy đó; gọi `listLabels` theo nhịp; phiên bản đổi mới gọi hàm bọc theo phiên. |
| App Server VPS | Cùng code với Desktop, gọi hàm bằng quyền server, đọc danh sách tài khoản cho mọi nhân viên bằng một câu mỗi phút. |

Nhịp hỏi `zalo.tag_sync.poll_seconds`, đề xuất 60 giây, thấp nhất 30. Tài khoản đang có lệnh gửi dở không bị chen ngang: lượt
hỏi bị bỏ nếu tài khoản bận, chờ nhịp sau.

Tải thêm: mỗi tài khoản đang theo dõi một lượt gọi Zalo mỗi phút; DB chỉ nhận dữ liệu khi tag đổi. Ảnh chụp của tài khoản
nhiều tag nhất khoảng 64 KB.

### 4.5 Cài đặt chiến dịch và giao diện

`extra_settings` thêm:

- `zaloFriendTagAutoAddEnabled: boolean` — ô trong form ghi giá trị này; công tắc nhanh ở mục 4.6 cũng chỉ đổi đúng giá trị này.
- `zaloFriendTagAutoAddAudience: 'friends'` (đợt này chỉ một giá trị; để sẵn cho đợt sau)

Ô chọn nằm ngay dưới danh sách "Tag nguồn", chỉ hiện ở chế độ theo tag và khi tài khoản không phải Zalo trình duyệt. Chữ đề
xuất, cần anh duyệt:

> ☐ Tự động gửi cho người được gắn tag này về sau (chỉ gửi khi người đó đã là bạn bè)

Ba lựa chọn "Chỉ bạn bè / Chỉ người lạ / Tất cả" chưa hiện ở đợt này, vì hai lựa chọn sau chưa làm (quy ước của repo: tính
năng chưa có thì ẩn, không hiện ô bị khoá).

Nơi sửa: Desktop `CampaignFormModal.tsx` và `CampaignAgentFormModal.tsx` (sửa cả hai), `CampaignInfoView.tsx`; Web
`CampaignFormPage.tsx`, `CampaignRuntimeOptions.tsx`, `packages/campaign-core`; iOS `apps/mobile/src/features/campaign`.

### 4.6 Công tắc dừng tự thêm (anh chốt 26/11)

Chiến dịch bật ô có thêm công tắc **Dừng tự thêm / Tiếp tục tự thêm** ở đầu chi tiết chiến dịch (Desktop, Web, iOS), bấm là có
hiệu lực, không cần mở form sửa và không cần tạm dừng chiến dịch.

- Bấm Dừng: DB không đưa ai mới vào chiến dịch nữa. Người đã vào hàng chờ trước đó vẫn được gửi như thường. Muốn ngừng gửi cả họ
  thì tạm dừng chiến dịch như hiện nay.
- Bấm Tiếp tục: từ lúc đó người mới gắn tag lại được thêm. Người được gắn tag trong khoảng đang dừng không được thêm bù.
- Đổi được cả khi chiến dịch đang chạy, vì không đụng data đang gửi.
- Ghi một dòng tiến trình mỗi lần đổi: `Đã dừng tự thêm người được gắn tag` / `Đã tiếp tục tự thêm người được gắn tag`.

Cách làm: hàm DB riêng `aka_agent_set_campaign_zalo_tag_auto_add(chiến dịch, bật/tắt)` (Desktop theo phiên đăng nhập, API Web
bằng `service_role`) chỉ đổi đúng khoá `zaloFriendTagAutoAddEnabled` trong `extra_settings` bằng `jsonb_set`, khoá dòng chiến
dịch kiểu `FOR NO KEY UPDATE`, không đi qua đường lưu cả form (đường đó dựng lại cả `extra_settings` và có thể đè thay đổi của
người khác). Không có chiến dịch nào bật ô của tài khoản thì tài khoản ra khỏi danh sách cần hỏi tag ở lượt đọc kế tiếp; bật
lại thì lần đọc tag đầu tiên chỉ lấy mốc (mục 4.1), đúng với ý "không thêm bù".

Các cài đặt khác của chiến dịch giữ nguyên ý nghĩa:

- Gửi dạng chia sẻ: người thêm sau đi vào lô kế tiếp. Bước kiểm bạn bè chạy trước khi xếp lô.
- Chống gửi lặp N ngày, loại trừ gửi: áp dụng như mọi data khác.
- Lặp lại sau khi chạy xong, nhiều khung giờ, "làm mới data": người thêm bằng tag là data thường nên đi theo các luật đó. Cần
  kiểm trong bài kiểm rằng "làm mới data" không làm người này bị gửi lần hai ngoài ý muốn.

## 5. Thứ tự làm

| Bước | Việc | Cần phát hành |
|---|---|---|
| 0 | Thử trên tài khoản test: bật ghi tín hiệu lạ của kết nối Zalo, gắn tag trên điện thoại, xem có tín hiệu không. | Không |
| 1 | Migration: 4 bảng, 2 hàm, hàm bọc Desktop, cấu hình `zalo.tag_sync.*` (mặc định tắt), job dọn nhật ký. Bài kiểm trên Postgres cục bộ. | Apply buổi tối |
| 2 | ChatApi: cờ theo dõi, runtime hỏi tag, worker gọi hàm. | Deploy `api` → `zalo_runtime` → `worker` |
| 3 | Lõi engine: kiểm bạn bè cho dòng `zalotag:`; chép lõi sang ChatApi. Bộ chạy cũ: cùng bước kiểm. | Deploy `worker`; build Desktop và App Server |
| 4 | Desktop và App Server: dịch vụ hỏi tag. | Build Desktop và App Server |
| 5 | Form Web → Desktop → iOS. | Deploy Web; build Desktop; bản iOS |
| 6 | Bật cho tổ chức 1, chạy thật, rồi mở cho mọi khách. | Đổi cấu hình |

Sau bước 2 và 3 phần Fly chạy được mà không cần phát hành app; khách dùng Web tạo chiến dịch là dùng được với tài khoản
Server trên Fly.

## 6. Kiểm thử

- SQL trên Postgres cục bộ: ảnh chụp đầu chỉ làm mốc; gắn → vào chiến dịch đúng một lần; gỡ rồi gắn lại không vào lần hai;
  ảnh chụp cách quá ngưỡng chỉ làm mốc; chiến dịch hoàn thành được mở lại, tạm dừng giữ nguyên, đã xoá / quá hạn không nhận;
  hai chiến dịch cùng tag đều nhận; tài khoản sai nơi gửi bị từ chối; gửi lại cùng ảnh chụp không đổi gì; bản gỡ.
- Lõi engine: dòng `zalotag:` là bạn bè thì gửi, chưa là bạn bè thì "Bỏ qua" không tính lượt, không đọc được thì về hàng chờ.
- Bộ kịch bản sự cố của engine chạy lại với bước mới.
- Dịch vụ hỏi tag: không gọi DB khi phiên bản không đổi; bỏ lượt khi tài khoản bận; ngừng khi bị từ chối.
- Chạy thật trên tổ chức 1 ở cả ba nơi: gắn tag trên điện thoại, đo thời gian tới lúc tin được gửi.

## 7. Rủi ro và điểm chưa rõ

- **Hỏi tag mỗi phút có bị Zalo hạn chế không**: chưa đo. Bắt đầu với ít tài khoản, nhịp chỉnh được bằng cấu hình, tắt được
  ngay.
- **Khoảng hở lúc mới tạo chiến dịch**: nếu chiến dịch chạy lượt đầu trước khi sổ tag kịp lấy mốc, người được gắn tag trong
  khoảng đó (tối đa một nhịp) có thể bị sót. Cách đóng: cho bước lấy danh sách lần đầu gửi luôn ảnh chụp tag của nó làm mốc.
- **Tag bị xoá trên Zalo**: sổ ghi "gỡ" cho mọi người trong tag; chiến dịch không phản ứng. Form đã có sẵn bước bỏ tag không
  còn tồn tại khi mở sửa.
- **Tag đầy** (khoảng 5.800 hội thoại mỗi tài khoản): không liên quan trực tiếp, nhưng ảnh chụp lớn; đã tính trong mục 4.4.
- **Gắn tag hàng loạt** (khách gắn 500 người một lúc): cả 500 vào chiến dịch và gửi theo hạn mức, nghỉ giữa hai lần gửi như
  bình thường.
- **Số migration**: lấy số ngay trước khi apply, kiểm sổ production (số lớn nhất trong repo lúc viết là V657).

## 8. Tình trạng làm (26/11/2026)

Nhánh `claude/loving-mendel-zig1jb` ở akaAgent, akaAgentChatApi, akaAgentWebApp; chưa merge, chưa mở PR.

Khác bản thiết kế ở mục 4:
- Thêm bảng `auto_zalo_tag_sync_campaigns` (danh sách chiến dịch đang bật, trigger trên `auto_campaigns` chỉ khi
  `action_id = 'zalo_message_friend'`) để khỏi đọc `extra_settings` (TOAST) mỗi nhịp, và `auto_zalo_tag_sync_resets`
  (tài khoản vừa đổi trạng thái theo dõi thì lần báo sau chỉ lấy mốc; tránh khoá chéo giữa trigger và hàm nhận lô).
- Fly không báo mỗi phút: runtime chỉ gửi sự kiện `account_tag_sync` khi phiên bản tag đổi, kèm `previousVersion` (`p`) và
  cờ đọc liền mạch `continuous` (`c`, cửa sổ 3 nhịp). DB chỉ tính người mới khi `c = true` và `p` trùng phiên bản đã lưu,
  không thì chỉ lấy mốc. Desktop / App Server vẫn báo mỗi nhịp và quá `stale_minutes` (30) thì chỉ lấy mốc.
- Mã EXC04 `err_engine_zalo_tag_not_friend` "Chưa là bạn bè nên không gửi" (Bỏ qua, không tính lượt, không cộng chuỗi).
  Bộ chạy cũ không ghi dòng lịch sử, chỉ đóng data kèm ghi chú và dòng tiến trình "🚫 Bỏ qua".

Đã làm:
- DB: [V660](../migrations/migration_v660_zalo_tag_sync.sql) + [gỡ](../migrations/rollback_v660_zalo_tag_sync.sql).
  Cấu hình `zalo.tag_sync.enabled` mặc định `false`, `organization_ids` = `all`, `poll_seconds` 60, `stale_minutes` 30,
  `event_retention_days` 30. Job dọn `aka-agent-zalo-tag-sync-retention` (`17 20 * * *`).
- Lõi engine `packages/campaign-engine/src/zalo/tagAutoAdd.ts` (gửi thường và gửi chia sẻ), bộ chạy cũ
  `campaignScheduler.ts` `checkZaloTagAutoAddFriend`.
- Desktop / App Server: `src/main/services/zaloTagSyncRuntime.ts` + `zaloTagSync.ts`, chạy theo vòng đời của
  `zaloRealtimeGroupCampaignManager` (chỉ dùng phiên đã có, không đăng nhập thêm, Zalo trình duyệt không làm).
- Desktop UI: ô chọn ở hai form, dải Dừng / Tiếp tục `ZaloTagAutoAddBanner` trong chi tiết chiến dịch, IPC
  `campaign:zalo-tag-auto-add:set`.
- ChatApi (commit `2beac84`): capability `tag_sync`, `packages/zalo-zca-adapter/src/tagSync.ts`, `accountSupervisor` hỏi tag,
  worker gọi `aka_agent_sync_zalo_tags('fly', …)`, `api` gắn `tagSync` cho tài khoản có chiến dịch bật; lõi engine đã chép.
- Web: ô chọn trong `CampaignRuntimeOptions.tsx`, `campaignFormLogic.ts` (chỉ ghi khoá khi gửi theo tag và đang bật), route
  `POST /campaigns/:id/zalo-tag-auto-add`, dải Dừng / Tiếp tục trong tab Thông tin. iOS (`apps/mobile/src/features/campaign`): ô chọn dưới "Tag nguồn Zalo"
  ở bước Tùy chọn (`Options.tsx`), công tắc Dừng / Tiếp tục ở mục Thông tin của chi tiết chiến dịch (`ZaloTagAutoAdd.tsx`, gọi
  cùng API Web), dòng ở bước Xem lại. Bản iOS hiện có trên App Store chưa có các phần này (cần phát hành bản mới).

Kiểm (đều đạt): `bash scripts/zalo-tag-sync/v660-smoke.sh` (PG16, gồm gỡ và apply lại), `node
scripts/zalo-tag-sync/engine-friend-check-smoke.cjs`, `node scripts/zalo-tag-sync/runtime-smoke.cjs`, hai typecheck Desktop;
ChatApi typecheck + vitest (3.250); WebApp typecheck 8 gói, vitest campaign-core 570, web 1.711, route API 98. Mobile có 1 bài
`Results.test.tsx` hỏng sẵn trước thay đổi này.

Chưa làm / chưa thử: bước 0 (Zalo có tín hiệu gắn tag không) cần tài khoản thật; chưa chạy Electron, App Server, runtime Fly
thật; chưa thử với Zalo thật.

Thứ tự đưa lên: apply V660 (buổi tối, kiểm sổ trước: lúc viết sổ production tới V658, V659 đã có nhánh khác giữ) → ChatApi
deploy `api` rồi `zalo_runtime` rồi `worker` → deploy Web → build Desktop / App Server → đặt `zalo.tag_sync.enabled` = `true`
(có thể giới hạn `organization_ids` cho tổ chức 1 trước).

## 9. Kiểm thử lặp và sửa (26/11/2026)

Anh yêu cầu: "Kiểm thử và cải tiến … lặp cho đến khi ít nhất 3 vòng không còn vấn đề". Vẫn chưa apply / deploy / build gì.

**Bộ kiểm** (`scripts/zalo-tag-sync/`, một vòng: `CHAT_REPO=<akaAgentChatApi> bash scripts/zalo-tag-sync/fuzz-round.sh <seed> [<pool.json>]`):

| Bộ | Kiểm gì |
| --- | --- |
| `fuzz-loop.cjs` | V660 trên Postgres cục bộ, so từng câu trả lời và trạng thái DB với một mô hình JS viết lại theo đặc tả. 80 kịch bản × 140 bước mỗi vòng. Thao tác ngẫu nhiên: gắn / gỡ / tạo / xoá tag, Desktop / App Server / Fly báo, công tắc, sửa / xoá / đổi loại chiến dịch, tua thời gian, cài đặt, tài khoản đổi. Dữ liệu sai lệch cố ý: mã sai kiểu, trùng, rỗng, quá dài, lô quá 200 mục, hai danh sách một lần, chiến dịch của nhân viên khác, nhân viên hết quyền. Có trigger chép từ production (`fuzz-fixture.sql`: quyền truy cập, chủ sở hữu Desktop, `completed_at`). Đếm độ phủ 21 nhánh, thiếu nhánh nào thì tính là lỗi. Thêm một lượt chạy đồng thời: 2 tiến trình cùng báo một tài khoản 6.000 cặp tag-người, sửa chiến dịch, giữ khoá như bộ chạy. |
| `fly-tag-sync-fuzz.cjs` | Phần đọc tag trên Fly (ChatApi `tagSync.ts`) ghép với luật nhận của DB. So với "sự thật": được so khi và chỉ khi mọi lần tag đổi đều được thấy ở lần đọc cách lần trước không quá cửa sổ. 3.000 kết nối mỗi vòng. |
| `runtime-fuzz.cjs` | Bộ hỏi tag của Desktop / App Server (`zaloTagSyncRuntime.ts`) với Zalo và DB giả lỗi ngẫu nhiên. 7 tính chất: không ném lỗi, ≤ 200 mục mỗi lần, danh sách khớp lần đọc, chỉ gửi khi DB xin, ngừng khi DB tắt hoặc từ chối, không lỗi thì không chỉ lấy mốc. |
| `engine-friend-check-smoke.cjs` | Bước kiểm bạn bè của lõi engine. Thêm 3.000 tổ hợp ngẫu nhiên (khoá dòng, UID, Zalo trả đúng / sai / rỗng / lỗi / treo, lượt bị huỷ). |
| WebApp `campaign-core/src/zaloTagAutoAdd.test.ts` | Form Web: 2.000 tổ hợp cài đặt. |

**Dữ liệu:** tag thật trên production lấy chỉ đọc. Mã người được băm thành số, giữ tiền tố "g" của nhóm, tên tag bỏ.
- Lượt đầu: 85 tài khoản đang có chiến dịch theo tag (832 tag, 98.406 người trong tag, lớn nhất 3.264 người một tag).
- Mỗi vòng thêm 60 tài khoản có tag, chọn ngẫu nhiên khác nhau (vòng 2: 30.343 người; vòng 3: 23.248; vòng 4: 52.020).
- Tệp nằm ngoài repo, không commit.

**Tìm ra và đã sửa:**

1. DB coi ô bật là bật cả khi giá trị là chữ `"true"` / `"TRUE"`, còn Desktop / Web / iOS chỉ nhận `true`. Khi đó DB vẫn tự thêm người nhưng giao diện hiện ô tắt và không có công tắc Dừng. Nay DB chỉ nhận giá trị JSON `true`, ở cả trigger lẫn công tắc.
2. Một chiến dịch lỗi làm hỏng cả lượt báo của tài khoản. Trigger quyền production chặn mở lại chiến dịch "hoàn thành" khi nhân viên hết gói, nên cả lượt rollback. Sổ tag của tài khoản đứng yên mãi, và mọi chiến dịch khác của tài khoản không nhận ai. Nay mỗi chiến dịch chạy trong một khối riêng: lỗi cố định chỉ bỏ qua chiến dịch đó. Lỗi tạm thời (chờ khoá, khoá chéo, bị huỷ) vẫn dừng cả lượt, để lượt sau so lại và thêm đủ.
3. Chiến dịch của nhân viên / tổ chức khác trỏ vào tài khoản (dữ liệu sai lệch, tài khoản đã chuyển người) vẫn được thêm người từ tag của tài khoản. Trên Desktop, trường hợp này còn làm cả lượt lỗi vì trigger chủ sở hữu chặn. Nay chỉ thêm vào chiến dịch của đúng nhân viên và tổ chức đang sở hữu tài khoản.
4. Đổi loại chiến dịch khỏi "Nhắn tin bạn bè", hoặc xoá hẳn dòng chiến dịch, thì trigger không chạy. Dòng "đang tự thêm" còn treo và tài khoản vẫn bị hỏi tag mãi. Nay có 3 trigger: thêm mới, sửa (kể cả trước đó là nhắn tin bạn bè), xoá hẳn. Bản gỡ xoá cả 3.
5. Fly bỏ sót người được gắn tag. Một lần đọc tag bị trễ quá cửa sổ (3 nhịp) trong lúc tag không đổi gì cũng làm mất cờ liền mạch, nên lần đổi tag kế tiếp (đọc đúng nhịp) bị DB chỉ lấy mốc. Mô phỏng: 2.357 / 23.992 sự kiện bị bỏ sót, không lần nào thêm nhầm. Nay cờ chỉ mất khi tag đổi trong khoảng đọc trễ, và nối lại khi đọc thấy đúng phiên bản đã báo. ChatApi `tagSync.ts` và bài kiểm của nó đã sửa theo luật mới. Desktop / App Server không bị, vì nhịp báo phiên bản tự nối lại.
6. Không kiểm được trạng thái bạn bè thì luật `gate_unavailable` cũ kết thúc lượt và trả data về hàng đợi. Bộ chạy mới nhận data theo id, nên một người mà Zalo luôn lỗi sẽ chặn cả chiến dịch. Nay có mã mới **EXC05** `err_engine_zalo_tag_friend_unavailable` "Chưa kiểm tra được trạng thái bạn bè, sẽ thử lại sau": hẹn data chạy lại sau 30 phút, lượt chạy tiếp data khác, không tính lượt, không cộng chuỗi. Lõi đã chép sang ChatApi. Bộ chạy cũ vẫn bỏ qua data đó ở lượt này rồi thử lại lượt sau.
7. Bộ hỏi tag Desktop / App Server không ngừng khi DB báo tắt ở lượt gửi danh sách (chỉ ngừng khi báo ở lượt gửi phiên bản). Nay ngừng ở cả hai lượt.

**Kiểm chéo bộ kiểm:** cố ý làm hỏng 3 điều kiện trong V660 (bỏ kiểm "đã lấy danh sách lần đầu", bỏ lọc nhóm, bỏ luật quá hạn 30 phút) và 1 điều kiện ở Fly (luôn báo liền mạch). Bộ kiểm bắt cả 4: 148, 55, 56 và 503 sai lệch.

**Kết quả các vòng** (mỗi vòng một hạt giống và một mẫu production mới):

| Vòng | Hạt giống | DB (lần so / dòng tự thêm) | Fly (sự kiện) | Desktop (lần so) | Kết quả |
| --- | --- | --- | --- | --- | --- |
| trước vòng | 1–6 | | | | tìm ra và sửa 1–7 ở trên |
| 1 | 101 | 50.153 / 698 | 36.376 | 173.936 | sạch |
| 2 | 202 | 48.174 / 423 | 36.252 | 213.048 | sạch, có thêm phép so danh sách tài khoản giao đi hỏi tag |
| 3 | 303 | 53.506 / 564 | 36.328 | 131.525 | sạch |
| 4 | 404 | 47.266 / 343 | 36.284 | 154.502 | sạch |

Chạy đồng thời ở mọi vòng: 0 trùng, 0 khoá chéo, 0 lần chờ khoá quá hạn. Mỗi lần báo 6.000 cặp tag-người mất trung vị 111–126 ms, chậm nhất 181 ms; lần lấy mốc khoảng 50 ms.

**Còn chưa kiểm được:**
- Zalo thật (bước 0 ở mục 5): phiên bản tag có đổi mỗi lần gắn / gỡ không. zca-js `updateLabels` gửi kèm phiên bản nên nhiều khả năng có, nhưng chưa thử trên Zalo thật.
- Electron thật, runtime Fly thật.
- Hàm chọn chính sách của engine trên DB thật với EXC05. Dòng chính sách viết giống EXC04 / lớp `target_temporary` sẵn có.

## 10. Gửi cả người chưa là bạn bè ("Cách A", chiều 26/11/2026)

Anh yêu cầu: "không phân biệt bạn bè hay không, chỉ cần gắn tag là gửi", chọn Cách A (bỏ hẳn bước kiểm, mọi người gửi như bạn bè).

Số đo trước khi đổi (chỉ đọc, 54 tài khoản đang chạy chiến dịch gửi theo tag trong 60 ngày): trong các tag của họ có 86.185 người
(không tính 2.251 nhóm): 51% đã là bạn bè, 6% có trong danh bạ đã đồng bộ nhưng chưa là bạn bè, 43% không có trong danh bạ đã đồng
bộ (nhiều khả năng cũng chưa là bạn bè). Với luật cũ khoảng một nửa số người được gắn tag sẽ bị "Bỏ qua".

Đã làm:

- Lõi engine (`packages/campaign-engine`, gửi thường lẫn dạng chia sẻ) và bộ chạy cũ (`campaignScheduler.ts`) bỏ bước kiểm bạn bè
  cho dòng `zalotag:`. Mã EXC04 / EXC05 của V660 còn trong DB nhưng không còn chỗ phát. Lõi đã chép sang ChatApi.
- Tên người nhận: data chỉ có UID (người không có trong danh bạ) vẫn được gửi bằng tên hồ sơ Zalo, vì cả hai bộ chạy đọc hồ sơ theo
  UID trước khi gửi (`getUserProfile`). Bài kiểm Desktop có ca này.
- Zalo hạn chế nhắn người lạ (120 / 802) khi nhắn tin bạn bè, [V669](../migrations/migration_v669_zalo_friend_stranger_restricted.sql)
  (chỉ dữ liệu; chạy thử trên DB thật trong giao dịch tự huỷ 26/11 đạt):
  - engine v2: hẹn riêng data đó chạy lại lúc mở khoá "Nhắn tin người lạ" của tài khoản (120: 09:45 hôm sau, 802: 09:45 sau 2
    ngày; hàm báo kết quả lấy giờ mở khoá trước `requeue_after_minutes`), câu cho khách "Zalo đang hạn chế nhắn người lạ, sẽ gửi lại
    người này lúc {giờ} (Z120)", không tính lượt, không cộng chuỗi, không dừng chiến dịch, lượt chạy tiếp người khác; vẫn khoá
    "Nhắn tin người lạ" như cũ. Trước V669: data về hàng đợi ngay (gửi lại ngay lượt sau), 3 data liền thì tạm dừng chiến dịch.
  - bộ chạy cũ (không có hẹn giờ theo data): hai dòng `auto_error` mới `err_zalo_message_friend_stranger_restricted` (120, Z120) và
    `..._802` (802, Z802), data "thất bại", không tính lượt, không cộng chuỗi, không khoá thao tác (bộ cũ gặp dòng có khoá thì in
    "⏸ Dừng chiến dịch" và nghỉ một lượt kể cả khi khoá thao tác khác). Trước V669 rơi vào lỗi chung (tính lượt, cộng chuỗi, 4 data
    liền thì tạm dừng). Bản gỡ tắt hai dòng và bỏ `error_class` (engine đọc nhóm lỗi cả ở dòng đã tắt); apply lại sau khi gỡ được.
  - Bạn bè thật không gặp 120 / 802 (3 ngày tới 26/11: 0 lần trên ~22.000 lượt nhắn bạn bè của engine v2).
- Câu trên form (Desktop, Web, iOS): "Tự động gửi cho người được gắn tag này về sau (kể cả người chưa là bạn bè)", bỏ câu "người chưa
  là bạn bè sẽ bị bỏ qua", thêm câu nhắc nhắn nhiều người chưa là bạn bè dễ bị Zalo hạn chế. Câu cho khách chưa được anh duyệt.

Giữ nguyên:

- Danh sách lần đầu (lấy người đang có trong tag lúc bật chiến dịch) vẫn chỉ lấy bạn bè: chỉ người được gắn tag sau mới được gửi
  dù chưa là bạn bè.
- Tin gửi người chưa là bạn bè tính vào hạn mức "Nhắn tin bạn bè" của chiến dịch, không theo hạn mức "Nhắn tin người lạ".
- Gửi nhanh cho nhiều người chưa là bạn bè liền nhau có thể gặp Z127 (Zalo chặn vì gửi nhanh): chính sách hiện tại của nhắn tin bạn
  bè khoá nhắn bạn bè 30 phút và 3 data liền thì tạm dừng chiến dịch. Chưa đổi.

Kiểm: `CHAT_REPO=<akaAgentChatApi> node scripts/campaign-engine-desktop-smoke.cjs` (12 nhóm; ca "người được gắn tag chưa là bạn bè
vẫn được gửi" hỏng trên code trước khi sửa), typecheck ba tsconfig, ChatApi `npm run verify`, WebApp bài kiểm iOS `Options.test.tsx`.
`fuzz-round.sh` thay bước "Lõi engine: kiểm bạn bè" bằng bài kiểm Desktop. Thứ tự đưa lên: apply V669 trước hoặc cùng lúc bản chạy
mới (V669 chỉ đổi cách xử lý 120 / 802 của nhắn tin bạn bè, chạy được với bản cũ).

### 10.1 Kiểm thử lặp Cách A (26/11/2026, anh yêu cầu "Kiểm thử và cải tiến … ít nhất 3 vòng không còn vấn đề")

Một vòng = `CHAT_REPO=<akaAgentChatApi> CACH_A_POOL=<pool> CACH_A_SIGNALS=<tín hiệu> CACH_A_SCENARIOS=150 bash
scripts/zalo-tag-sync/fuzz-round.sh <seed> <pool tag V660>`, mỗi vòng lấy mẫu thật mới (chỉ đọc, ngoài repo):

- data của chiến dịch nhắn tin bạn bè thật (~1.600 dòng / vòng, 220 chiến dịch chọn theo `md5(id || salt)`; UID băm giữ độ dài, tên
  che giữ dấu / khoảng trắng / ký tự đặc biệt);
- tín hiệu engine v2 thật đã gom (`auto_engine_outcomes`, 2–3 ngày khác nhau mỗi vòng, 100–420 nghìn kết quả; engine Zalo chỉ có
  dữ liệu từ 13/11).

Bài kiểm mới:

- `scripts/zalo-tag-sync/cach-a-engine-fuzz.cjs`: bộ chạy engine v2 thật của Desktop trên PG cục bộ (V495–V501 + V669, chính sách /
  luật / mã lỗi chép từ bản sao danh mục production 26/11), Zalo giả trả kết quả ngẫu nhiên (câu 120 / 802 thật), data sai cố ý (UID
  là SĐT, rỗng, có chữ, hậu tố `_0`, khoảng trắng, 26 chữ số, trùng; tên rỗng / bằng UID / dài / emoji / xuống dòng / chứa
  `#{FULL_NAME}`; khoá `zalotag:` sai dạng). Mỗi kịch bản chạy hai lần (có / không khoá `zalotag:`) và so từng data. Bất biến A1–A7
  ở đầu tệp; `--no-v669` là đối chứng (data 120 bị gửi lại ngay).
- `scripts/zalo-tag-sync/cach-a-policy-fuzz.cjs`: bản sao danh mục production; ~16.000 tổ hợp (mã, status, thao tác, nơi chạy, pha)
  trước / sau V669, cách chọn dòng `auto_error` của bộ cũ Desktop (logic `getZaloErrorPolicyByCode`) và ChatApi (câu SQL nguyên văn)
  trên ~1.300 cặp (mã Zalo kể cả chuỗi sai, thao tác), phát lại tín hiệu thật (và cùng tín hiệu nếu xảy ra trong chiến dịch bạn bè),
  gỡ rồi apply lại, 17 kiểu danh mục bị làm sai cố ý (V669 phải từ chối và không đổi gì, hoặc vẫn chạy khi sai ở chỗ không liên quan).

Tìm ra và sửa:

1. Câu V669 ghi "sẽ gửi lại người này sau 24 / 48 giờ" nhưng data hẹn theo giờ mở khoá người lạ (09:45 hôm sau / sau 2 ngày) → câu
   dùng `{until}`.
2. Bản gỡ chỉ tắt dòng `auto_error` mà engine vẫn đọc `error_class` của dòng đã tắt → gỡ chưa trả đủ; bản gỡ bỏ cả `error_class`.
3. Apply lại sau khi gỡ bị chặn vì dòng `auto_error` cũ (tắt) còn đó → V669 bật lại dòng tắt (`ON CONFLICT`), chỉ từ chối dòng đang bật.
4. Bộ cũ: một dòng cho cả 120 và 802, không mã công khai → hai dòng (Z120 / Z802). Thử khoá "Nhắn tin người lạ" như dòng nhắn người
   lạ rồi bỏ: bộ cũ gặp dòng có khoá thì in "⏸ Dừng chiến dịch" và nghỉ một lượt (`applyZaloPolicySideEffects`).
5. (V660, Desktop / App Server) `zaloTagSyncRuntime.ts`: nhịp có trên 200 tài khoản, lô đầu bị DB từ chối vài tài khoản rồi lô sau lỗi
   mạng thì thoát sớm, quên danh sách bị từ chối, nhịp sau vẫn đọc Zalo của các tài khoản đó tới lần đọc lại danh sách → áp dụng
   danh sách từ chối trong `finally` (`runtime-fuzz.cjs` seed 204 tái hiện).
6. Bài kiểm: `fuzz-loop.cjs` chọn chiến dịch từ danh sách rỗng khi mọi chiến dịch đã xoá hẳn; nhánh "chiến dịch hết hạn" hiếm nên có
   seed không phủ (tăng tỉ lệ); các bất biến A4 / A5 so nhầm khi kịch bản có mã dừng khác (Z112) hoặc UID trùng.

Vòng: seed 1–3 và 201–204 ra lỗi (đã sửa ở trên); 205, 206, 207 sạch liền (mỗi vòng: ~850 data × 2 lần chạy bộ chạy mới, ~1.400 lần
gửi Zalo giả, 16.362 tổ hợp chính sách, ~1.350 cặp bộ cũ, 16 kiểu danh mục sai, 200–420 nhóm tín hiệu thật; cùng các bài V660:
50.000 lần so DB, 3.000 kết nối Fly, 400 lượt bộ hỏi tag). V669 đã sửa chạy thử lại trên DB thật trong giao dịch tự huỷ: đạt,
`aka_agent_engine_policy_lint` không thêm cảnh báo.

Phát hiện (có từ trước, không do V669): khoá thao tác của tài khoản bị ghi đè bởi lỗi đến sau, kể cả khoá ngắn hơn
(`ON CONFLICT … date_enable = EXCLUDED.date_enable` trong `aka_agent_engine_report_v1`). Ví dụ khoá "Nhắn tin người lạ" tới 09:45 hôm
sau vì 120 bị NET01 (rớt mạng, khoá mọi thao tác Zalo 5 phút) đè thành 5 phút. Đo 4 ngày tới 26/11: 219 lần khoá vì 120 / 802, 6 lần
(2,7%) bị lỗi sau đè, 1 lần tài khoản nhắn người lạ lại trong thời gian lẽ ra còn khoá và gặp 120 / 802 lần nữa. Cách A làm tăng khả năng
gặp (chiến dịch bạn bè chạy tiếp sau 120).

### 10.2 V671: giữ khoá dài hơn (26/11/2026, anh đồng ý "Ok"; đã apply akachat 21:46:45 VN 26/11, sổ `20261126144645`)

[V671](../migrations/migration_v671_engine_action_lock_keep_longer.sql) (sinh bằng `node scripts/build-v671-sql.cjs` từ thân production
đọc 26/11, md5 `b39e1e9d…` = bản sau V659 → `014a3d03…`; có bản gỡ) chỉ thêm một mệnh đề `WHERE` vào câu ghi khoá: khoá đang có còn
hiệu lực (`is_disable`, `date_enable` không thời hạn hoặc sau giờ hiện tại) và dài hơn khoá mới thì giữ nguyên cả dòng (giờ mở, mã,
câu, lúc khoá). Khoá mới không thời hạn luôn ghi; khoá cũ đã hết hạn luôn bị thay; khoá dài hơn vẫn thay khoá ngắn. Không đổi giờ hẹn
lại data và câu "tới {until}" của chính lượt đó (lượt nhận sau vẫn chờ theo khoá dài hơn vì claim đọc `auto_account_action_status`);
bộ chạy cũ không đổi. CREATE OR REPLACE nên PostgREST nạp lại schema: apply ngoài giờ cao điểm.

Kiểm: `CHAT_REPO=… node scripts/engine-v2-lock-keep/v671-smoke.cjs` (migration / gỡ / chặn chạy lại / số 671 trong sổ trên thân
production; câu ghi khoá chép nguyên văn trước / sau vá so với mô hình độc lập, 20.000–30.000 ca mỗi seed gồm khoá không thời hạn, đã
hết, bằng giờ, khoá mới không thời hạn); bộ kiểm engine Cách A có bất biến A8 (bộ chạy Desktop thật, khoá do `report_v1` ghi, đếm bằng
trigger; mặc định có V671, `--no-v671` để đối chứng). Cùng seed 301: không V671 rút ngắn 14 khoá đang còn hiệu lực, có V671 0 lần,
mọi kết quả khác y hệt. Vòng seed 311, 312, 313 (data thật ẩn danh, 80 kịch bản + 30.000 ca mỗi vòng) sạch liền.

### 10.3 Kiểm thử lặp lần 2 (26/11/2026, anh yêu cầu lại "Kiểm thử và cải tiến … ít nhất 3 vòng không còn vấn đề")

Thêm hai bài kiểm cho V671, mỗi vòng lấy mẫu thật mới (data nhắn bạn bè, tín hiệu engine của 2 ngày khác, tag của 60 tài khoản khác,
chuỗi khoá thật; đều chỉ đọc, ngoài repo):

- `scripts/engine-v2-lock-keep/v671-replay.cjs <seq.json> [--inject N --seed S]`: phát lại mọi lần khoá thật của engine v2 (cùng khoá
  không thời hạn đang có) theo thứ tự thời gian qua đúng câu ghi khoá trước / sau V671, khoá nào bị ghi lấy theo chính sách production;
  trước mỗi lượt thật đọc khoá như claim. Đếm khoá bị rút ngắn và lượt thật lẽ ra bị chặn, so DB với mô hình JS. `--inject` cố ý chèn
  lỗi mạng (NET01, khoá mọi thao tác Zalo 5 phút) vào lúc ngẫu nhiên trên tài khoản thật. Có trong `fuzz-round.sh` khi đặt `V671_SEQ`.
- `v671-smoke.cjs` thêm ca ghi đồng thời: 8 phiên ghi khoá cho 400 tài khoản, thứ tự ngẫu nhiên, có khoá cũ còn / hết / không thời hạn.
  Có V671 thì kết quả cuối luôn là khoá dài nhất (không thời hạn thắng) và mã lỗi đi đúng giờ mở khoá; câu trước vá trượt ca này.

Kết quả: vòng seed 411, 412, 413 sạch liền (không phải sửa gì). Phát lại thật:

| Khoảng | Lần khoá thật | Bản cũ rút ngắn | V671 rút ngắn | Lượt thật V671 chặn thêm |
| --- | --- | --- | --- | --- |
| 7 ngày tới 26/11 | 6.541 (609 tài khoản) | 0 | 0 | 0 |
| 30 ngày tới 26/11 | 10.313 (764 tài khoản) | 2 | 0 | 1 (thực tế gặp lại 127) |
| 7 ngày + 3.000 lỗi mạng chèn | 9.541 | 511 | 0 | 12 (đều là lượt lỗi mạng chèn thêm) |

Ghi nhận khi rà (không sửa):

- 7 lượt thật đã gửi trong lúc khoá 120 / 802 / 127 còn hiệu lực đều do nhân viên bấm "Chạy lại ngay" (Web / Desktop gỡ khoá bằng
  REST, ví dụ tài khoản 12591 lúc 16:55:50 VN 26/11), lượt sau gặp lại đúng lỗi đó. Không phải lỗi của engine hay V671.
- Khoá không thời hạn đang có: 13 dòng, đều `err_zalo_224_add_friend_full` (danh sách bạn bè đầy) của "Kết bạn". Trước V671 một lỗi mạng
  sau đó sẽ đổi khoá này thành 5 phút (vô tình mở lại kết bạn); sau V671 khoá giữ tới khi nhân viên bấm "Chạy lại ngay". 14 ngày qua
  chỉ 2 lần 224, không lần nào bị lỗi mạng đè.


### 10.4 Apply V669 + V671 (26/11/2026 21:46 VN, anh: "apply")

Kiểm trước: `report_v1` vẫn md5 `b39e1e9d…` (V667 / V670 apply chiều cùng ngày không đụng), hai dòng chính sách 120 / 802 × nhắn tin bạn bè đúng bản V500 Q4, số 669 / 671 còn trống. V669 sổ `20261126144619`, V671 sổ `20261126144645`; md5 sổ = file (kiểm ngay trong giao dịch). Sau apply: `report_v1` md5 `014a3d03…`; chính sách 802 × nhắn bạn bè (Fly) = hẹn data 2880 phút, không cộng chuỗi, không dừng chiến dịch, khoá `zalo_message_stranger`; hai dòng `auto_error` Z120 / Z802 bật. PostgREST nạp lại schema 3,6 s, 0 lỗi 5xx; 10 lượt `report_v1` đầu tiên sau apply HTTP 200. Biên nhận: `migrations/snapshots/zalo-friend-stranger-v669/`, `migrations/snapshots/engine-action-lock-keep-v671/`. Gỡ: `rollback_v669_…`, `rollback_v671_…`.
