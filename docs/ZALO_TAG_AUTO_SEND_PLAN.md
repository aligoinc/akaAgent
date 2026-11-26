# Tự gửi tin khi một người được gắn tag Zalo — phương án

Viết 26/11/2026. Anh duyệt và bảo "Thực thi theo phương án" cùng ngày. **Đã code (mục 8), chưa apply V660, chưa deploy, chưa build,
chưa merge, chưa đổi gì trên production.**

Tính năng: chiến dịch "Nhắn tin bạn bè" ở chế độ "Gửi cho bạn bè thuộc danh sách tag" có thêm ô chọn. Bật ô này thì mỗi khi
một người được gắn một trong các tag đã chọn trên Zalo, hệ thống tự thêm người đó vào chiến dịch và gửi tin. Chiến dịch đang
"hoàn thành" thì tự chuyển về "chờ xử lý" để gửi tiếp.

## 1. Anh đã chốt (26/11)

| Điểm | Chốt |
|---|---|
| Người nhận | Đợt này chỉ gửi cho người đã là bạn bè. "Chỉ người lạ" / "Tất cả" để đợt sau. |
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

### 4.3 Chỉ gửi cho bạn bè

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
  `POST /campaigns/:id/zalo-tag-auto-add`, dải Dừng / Tiếp tục trong tab Thông tin. iOS chỉ hiện một dòng ở bước Xem lại
  (lưu từ iOS vẫn giữ khoá).

Kiểm (đều đạt): `bash scripts/zalo-tag-sync/v660-smoke.sh` (PG16, gồm gỡ và apply lại), `node
scripts/zalo-tag-sync/engine-friend-check-smoke.cjs`, `node scripts/zalo-tag-sync/runtime-smoke.cjs`, hai typecheck Desktop;
ChatApi typecheck + vitest (3.250); WebApp typecheck 8 gói, vitest campaign-core 570, web 1.711, route API 98. Mobile có 1 bài
`Results.test.tsx` hỏng sẵn trước thay đổi này.

Chưa làm / chưa thử: bước 0 (Zalo có tín hiệu gắn tag không) cần tài khoản thật; chưa chạy Electron, App Server, runtime Fly
thật; chưa thử với Zalo thật.

Thứ tự đưa lên: apply V660 (buổi tối, kiểm sổ trước: lúc viết sổ production tới V658, V659 đã có nhánh khác giữ) → ChatApi
deploy `api` rồi `zalo_runtime` rồi `worker` → deploy Web → build Desktop / App Server → đặt `zalo.tag_sync.enabled` = `true`
(có thể giới hạn `organization_ids` cho tổ chức 1 trước).
