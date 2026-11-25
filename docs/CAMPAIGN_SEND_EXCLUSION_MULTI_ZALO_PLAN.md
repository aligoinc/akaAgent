# Loại trừ gửi theo nhiều Zalo, Nhóm data và chiến dịch đã gửi — phương án

**Tình trạng 25/11/2026:** anh bảo "Đồng ý hãy thực thi phương án này" (các đề xuất ở mục 9 coi như đã chốt). Đã code xong
DB + bộ chạy + Desktop + Web/API + iOS (chỉ xem) trên nhánh `claude/festive-rubin-5zi6qe` của akaAgent và akaAgentWebApp,
**chưa merge, V654 đã apply akachat 17:54–17:59 VN 25/11 ([biên nhận](../migrations/snapshots/send-exclusion-multi-zalo-v654/apply-receipt.json), không apply lại), chưa deploy / build / phát hành; công tắc `campaign.send_exclusion_multi_zalo` V654 đặt `off`**.
Chi tiết ở mục 10.
Thiết kế: https://claude.ai/artifact/UztLQqYHAPrd4zwJxiG5tB (anh duyệt 25/11, dạng 2 tầng xếp chồng).
Anh đồng ý các đề xuất ở vòng thiết kế 2 và yêu cầu thêm hai loại loại trừ: theo Nhóm data, theo chiến dịch đã gửi.

## 1. Hiện trạng (đọc code và production 25/11, chỉ đọc)

- Nhóm loại trừ (`auto_campaign_send_exclusion_groups`, [V330](../migrations/migration_v330_campaign_send_exclusions.sql))
  gắn đúng 1 tài khoản (`account_id NOT NULL`). Mọi điều kiện xét dữ liệu của tài khoản đang gửi:
  - **Trạng thái bạn bè:** hỏi Zalo bằng tài khoản đang gửi.
  - **Tag Zalo:** đọc tag của tài khoản đang gửi.
  - **Tag akaBiz:** gồm tag dùng chung của nhân viên và tag riêng của tài khoản; khách có tag hay không đọc theo liên hệ hoặc hội thoại của tài khoản đó.
  - **Số ngày từ lần gửi thành công:** `aka_agent_internal_send_delivery_history(account)`, chỉ đếm tin của tài khoản đó.
- Danh sách không gửi (`auto_account_contact_groups.purpose = 'zalo_friend_blocklist'`, 71 danh sách) cũng theo tài khoản.
- Cấu hình chiến dịch: `extra_settings.zaloSendExclusionsByAccountId[accountId] = {groupId, blocklistIds}`.
  Trigger `auto_validate_campaign_send_exclusion` kiểm khi lưu.
- **Ba nơi chạy:**
  - Bộ chạy cũ của Desktop và App Server: `gateSendExclusion` trong [campaignScheduler.ts](../src/main/services/campaignScheduler.ts), gọi RPC `aka_agent_campaign_send_exclusion_runtime` (`snapshot` / `facts` / `pause`).
  - Engine v2: lõi [sendExclusion.ts](../packages/campaign-engine/src/zalo/sendExclusion.ts), RPC `aka_agent_engine_send_exclusion_v1` ([V504](../migrations/migration_v504_engine_send_exclusion.sql)), chạy cả trên Desktop lẫn Fly.
  - Bộ chạy cũ của ChatApi.
- Luật đánh giá có 3 bản chép phải giống nhau từng byte: [campaignSendExclusion.ts](../src/shared/campaignSendExclusion.ts), `packages/campaign-engine/src/zalo/sendExclusionRules.ts` và bản ở `runtime-protocol` của ChatApi.
- **Form:**
  - Desktop: [CampaignSendExclusions.tsx](../src/renderer/src/components/CampaignPanels/CampaignSendExclusions.tsx) và form Agent `CampaignAgentSendExclusions.tsx`.
  - Web: `apps/web/src/features/CampaignSendExclusions.tsx`, API `apps/api/.../campaignSendExclusions.ts`. Cả Desktop lẫn Web đều gọi RPC `aka_agent_send_exclusion_groups`.
  - iOS: `apps/mobile/src/features/campaign/SendExclusions.tsx`.
  - AI tạo nhóm: `ai_form_configs` id 7.
  - Quy trình: `packages/journey-core/src/stepCampaign.ts`.
- **Số đo:**
  - 102 nhóm loại trừ của 50 nhân viên. 16 nhân viên đang tạo nhóm riêng cho nhiều Zalo (nhiều nhất 5). 9 chiến dịch chưa xong có cấu hình cho từ 2 tài khoản.
  - Một nhân viên có tối đa 50 Zalo, 90% nhân viên có từ 5 Zalo trở xuống.
  - Nhóm data: 5.667 nhóm, trong đó "Zalo · User theo UID" 3.663 nhóm và "Số điện thoại" 147 nhóm.
- **Nhận ra cùng một khách giữa các Zalo được:** Zalo ID riêng của khách khác nhau ở mỗi Zalo, nhưng Zalo ID chung (`global_id`) có ở:
  - 99,7% danh bạ (mẫu 30.365 liên hệ);
  - 99,5% thành viên Nhóm data UID (14.660 thành viên, tất cả đều gắn tài khoản);
  - 100% kết quả gửi thành công gần đây (`data.target.globalId`, 5.196 kết quả nhắn tin và kết bạn).
- **Thiếu một chỉ mục:** `zalo_users` (5,7 triệu dòng, 7,9 GB) chưa có chỉ mục theo `global_id`. Chỉ mục `(account_id, zalo_uid)` hiện có nặng 392 MB.

## 2. Đã chốt

1. Nhóm loại trừ có 2 tầng:
   - Tầng 1 chọn 1 hoặc nhiều Zalo của nhân viên.
   - Tầng 2: mỗi Zalo một khối điều kiện riêng, có VÀ/HOẶC riêng, xét dữ liệu của chính Zalo đó.
   - Giao diện dạng xếp chồng (2A).
2. Giữa các Zalo luôn là HOẶC: khách khớp khối của 1 Zalo bất kỳ là không gửi.
3. Danh sách bạn bè/Zalo ID: chọn được danh sách của mọi Zalo của nhân viên.
4. Zalo đang gửi tin đọc trực tiếp từ Zalo như hiện nay. Zalo khác dùng bạn bè và tag đã đồng bộ gần nhất; lịch sử gửi luôn mới nhất.
5. Zalo chưa đồng bộ lần nào thì bỏ qua khối của Zalo đó.
6. Bổ sung loại trừ khách trong Nhóm data.
7. Bổ sung loại trừ data đã nhận tin ở chiến dịch khác (khách tự chọn chiến dịch).
8. Nhóm tạo trước đây thành nhóm 1 khối và chạy y như cũ.

## 3. Cách xét

### 3.1 Khoá nhận ra khách

- Ưu tiên Zalo ID chung, sau đó tới SĐT chuẩn hoá (`normalize_phone`).
- **Với người nhận đang xét:** Zalo ID chung lấy ở kết quả tra số hoặc hồ sơ Zalo (lõi đã có `globalId`); bộ cũ không có thì tra `zalo_users (account_id, zalo_uid)` của tài khoản gửi. SĐT lấy từ data.
- **Với Zalo khác trong nhóm:** từ Zalo ID chung tra `zalo_users (account_id, global_id)` để ra Zalo ID riêng của khách ở Zalo đó (cần chỉ mục mới, mục 4), rồi đọc dữ liệu theo Zalo ID riêng ấy.

### 3.2 Khối của từng Zalo

Bốn điều kiện giữ nguyên như hiện nay. Khối của Zalo đang gửi chạy y như hôm nay. Khối của Zalo khác đọc dữ kiện trong DB:

| Điều kiện | Khi Zalo đó không phải Zalo đang gửi |
|---|---|
| Trạng thái bạn bè | Bạn bè / Người lạ: theo danh sách bạn bè đã đồng bộ của Zalo đó (`zalo_users.is_fr` hoặc `auto_account_contacts.is_friend`; khi code phải xác minh cột nào được ghi lúc đồng bộ bạn bè). Gửi lời mời kết bạn: có lời mời app đã gửi thành công từ Zalo đó mà chưa được đồng ý và chưa bị từ chối (`auto_campaign_detail_zalo_engagement`, cột `rejected_at` của V615). Nhận kết bạn: DB không có nên coi là không khớp; form ghi chú điều này dưới điều kiện. |
| Tag Zalo | Tag đã đồng bộ của Zalo đó: dòng `zalo_tag` trong `auto_account_contacts` (`extra_data.conversations`), hoặc `chat_zalo_account_conversation_tag` với tài khoản chạy trên Fly hay có Chat. Tag đã xoá xử lý như V573. |
| Tag akaBiz | Như `facts` hiện nay, nhưng tính với liên hệ hoặc hội thoại của Zalo đó. |
| Đã gửi tin trong N ngày | `aka_agent_internal_send_delivery_history(account_id = Zalo đó)`, khoá là Zalo ID riêng của khách ở Zalo đó cộng SĐT. |

Ngoài ra:

- **Zalo chưa đồng bộ lần nào:** bỏ qua cả khối, form cảnh báo.
  - Tài khoản có Chat đã có mốc `chat_zalo_account.last_user_sync_at` / `last_tag_sync_at`.
  - Tài khoản chỉ chạy Desktop chưa có mốc nào. Phải thêm mốc theo tài khoản và ghi ở chỗ đồng bộ hiện có; hoặc lấy mốc mới nhất của dòng liên hệ, việc này cần đo trước.
- **Zalo đã xoá hoặc không còn thuộc nhân viên:** bỏ qua khối đó, không dừng chiến dịch; thẻ cảnh báo.
- **Không đọc được dữ liệu của Zalo đang gửi, hoặc DB lỗi:** như hiện nay (bộ cũ tạm dừng data; engine v2 dùng mã EXC02, cổng ở chế độ closed).

### 3.3 Loại trừ theo danh sách (ở thẻ chiến dịch)

Khách có trong một danh sách bất kỳ thì không gửi.

- **Danh sách bạn bè/Zalo ID:** chọn được danh sách của mọi Zalo của nhân viên. Cùng Zalo đang gửi thì so Zalo ID riêng như cũ; danh sách của Zalo khác so theo Zalo ID chung của thành viên.
- **Nhóm data:**
  - Chỉ hai loại: Số điện thoại (so SĐT chuẩn hoá với `uid` của liên hệ, giống [V519](DATA_GROUP_MEMBER_MATCHES_V519.md)) và Zalo · User theo UID (so Zalo ID chung của thành viên).
  - Gồm nhóm của nhân viên và nhóm được chia sẻ cho nhân viên (`auto_data_group_recipients`, `sharing_scope`).
  - Thành viên đã xoá mềm không tính. Nhóm bị xoá thì không còn loại trừ theo nhóm đó, thẻ cảnh báo.
- **Chiến dịch đã gửi:**
  - Chọn trong các chiến dịch nhắn tin Zalo của nhân viên, trừ chính chiến dịch đang sửa.
  - Tính data đã được gửi tin thành công, dùng đúng bộ trạng thái của chống gửi lặp (`thành công`, `đã gửi`, `đã nhận`, `đã xem`, `đã click`); khớp theo Zalo ID chung hoặc SĐT.
  - Kiểm từng data lúc gửi, không chụp danh sách lúc đầu lượt, để chiến dịch đang chạy song song cũng được tính.
  - Chiến dịch bị xoá vẫn loại trừ theo lịch sử đã gửi của nó.
  - Đường tra chỉ dùng chỉ mục: Zalo ID chung ra Zalo ID riêng ở tài khoản của từng chiến dịch (`zalo_users`), sang data qua `idx_campaign_input_cooldown_uid`, rồi sang kết quả qua `idx_campaign_details_input_data_id`. Tra theo SĐT đi qua `idx_campaign_input_cooldown_phone`.

### 3.4 Thứ tự xét và câu ghi chú

- **Thứ tự** (giữ nguyên tắc "rẻ trước" của V330, dừng ngay khi đã có kết quả): danh sách (DB), rồi khối các Zalo khác (DB), cuối cùng khối Zalo đang gửi (gọi Zalo).
- **Câu ghi chú** của data và dòng tiến trình nêu đúng lý do:
  - `Thỏa điều kiện loại trừ của nhóm "<tên>" (<Zalo>: <điều kiện khớp>).`
  - `Có trong Nhóm data "<tên>".`
  - `Đã nhận tin ở chiến dịch "<tên>" ngày dd/mm.`
- Data bị loại vẫn sang Tạm dừng và không tính lượt gửi như hiện nay.

### 3.5 Giới hạn đề xuất

Mỗi nhóm tối đa 20 Zalo; mỗi chiến dịch tối đa 20 Nhóm data và 20 chiến dịch đã gửi cho mỗi Zalo gửi.
Phải đo thời gian bước `facts` với 20 Zalo trước khi chốt các con số này.

## 4. Dữ liệu (migration)

- **Bảng mới** `auto_campaign_send_exclusion_group_accounts`: `id`, `group_id` (FK tới nhóm), `account_id` (FK tới `auto_accounts`), `match_mode`, `sort_order`, `created_at`, `UNIQUE (group_id, account_id)`. Bật RLS, quyền như các bảng V330.
- **`auto_campaign_send_exclusion_rules`:** thêm `group_account_id` (FK tới bảng mới). Ràng buộc "mỗi trường một lần" đổi từ theo nhóm sang theo khối.
- **`auto_campaign_send_exclusion_groups`:**
  - Giữ `account_id` (= Zalo của khối đầu) để app cũ đọc không lỗi.
  - Thêm `version smallint NOT NULL DEFAULT 1`; nhóm từ 2 khối mang `version = 2`.
- **Điền sẵn:** mỗi nhóm cũ có 1 khối, lấy `account_id` và `match_mode` của nhóm; các điều kiện gắn vào khối đó. Hiện có 102 nhóm, chỉ là chép dữ liệu.
- **Cấu hình chiến dịch:** `zaloSendExclusionsByAccountId[acc]` thêm `dataGroupIds: number[]` và `sentCampaignIds: number[]`; `blocklistIds` nhận danh sách của mọi Zalo của nhân viên.
  - Trigger kiểm: Nhóm data là của nhân viên hoặc được chia sẻ, đúng loại; chiến dịch là của nhân viên, đúng loại, không phải chính nó; trong giới hạn.
  - Ô "dùng chung cho các Zalo gửi" chỉ là form ghi cùng lựa chọn vào mọi khoá tài khoản, không cần đổi lúc chạy.
- **Chỉ mục mới:** `zalo_users (account_id, global_id) WHERE global_id IS NOT NULL AND global_id <> ''`.
  - Dựng `CONCURRENTLY` trong một lệnh riêng, ngoài giờ cao điểm, ước khoảng 400 MB.
  - `CREATE INDEX` không làm PostgREST nạp lại schema.
- **Mốc đồng bộ bạn bè/tag** cho tài khoản Desktop (mục 3.2).
- **Công tắc** `auto_system_settings` `campaign.send_exclusion_multi_zalo` = `{"audience":"off"|"admin_akabiz"|"all"}`. Chỉ quyết định form có hiện phần mới hay không; thiếu dòng thì tắt.

## 5. Hàm DB

Thêm hàm `_v2` thay vì đổi chữ ký cũ, để app cũ vẫn gọi được hàm cũ.

- **`aka_agent_send_exclusion_groups_v2`** (Desktop) và bản cho API Web (`service_role`):
  - `page`: mọi nhóm của nhân viên kèm các khối; danh sách Zalo của nhân viên với lựa chọn của từng Zalo (tag Zalo, tag akaBiz, mốc đồng bộ).
  - `save`: lưu nhóm nhiều khối, giữ cách kiểm `revision` và `create_request_id` hiện có.
  - `lists`: Nhóm data dùng được (cả nhóm được chia sẻ, kèm số thành viên) và chiến dịch nhắn tin Zalo kèm số data đã nhận tin.
- **Hàm cũ `aka_agent_send_exclusion_groups`:**
  - `page` chỉ trả nhóm 1 khối của đúng tài khoản, như hôm nay.
  - `save` từ chối nhóm `version = 2` (`send_exclusion_group_requires_update`), để form cũ không xoá mất các khối.
- **Bộ chạy cũ `aka_agent_campaign_send_exclusion_runtime`:**
  - `snapshot` trả nhóm theo khối và danh sách đã chọn.
  - `facts` nhận thêm `globalId`, `phone`, các khối cần đọc trong DB, danh sách cần kiểm; trả dữ kiện của từng khối và lý do khớp danh sách.
- **Engine `aka_agent_engine_send_exclusion_v1`:** đổi tương tự, xác thực theo lease như V504.
- **App cũ gặp cấu hình mới:** chiến dịch dùng nhóm `version = 2`, hoặc có `dataGroupIds` / `sentCampaignIds`, hoặc chọn danh sách của Zalo khác, mà app không gửi khoá báo đã hỗ trợ.
  - `snapshot` từ chối (`send_exclusion_client_outdated`), app cũ tạm dừng chiến dịch như khi cấu hình loại trừ lỗi: không gửi, không gửi sai.
  - Câu cho khách: "Cập nhật akaAgent để chạy loại trừ theo nhiều Zalo."
- **Thời gian:** giữ `statement_timeout` 15 giây của RPC hiện có. Đo bước `facts` trên bản chép dữ liệu thật trước khi apply.

## 6. Code app và giao diện

- **Luật đánh giá** (3 bản chép):
  - Đánh giá từng khối bằng hàm hiện có, rồi lấy HOẶC giữa các khối.
  - Khối của Zalo khác dùng dữ kiện từ DB.
  - Kiểm danh sách trước. Thêm lý do khớp để dựng câu ghi chú.
  - Script kiểm 3 bản giống nhau từng byte giữ nguyên.
- **Bộ chạy cũ Desktop/App Server:** `gateSendExclusion` gửi khoá mới, dựng câu ghi chú mới.
- **Lõi engine v2:** cập nhật `sendExclusion.ts`, cổng Desktop `desktopZaloPort.ts` / `desktopEngineData.ts`. Chép lõi sang ChatApi (`scripts/sync-campaign-engine.cjs`) rồi deploy `worker`.
- **Bộ cũ ChatApi:** cập nhật bản chép luật và lời gọi RPC.
- **Form Desktop** (cả form thường lẫn form Agent; bản gọn 25/11 theo yêu cầu "tối ưu UI/UX", [thiết kế](https://claude.ai/artifact/UztLQqYHAPrd4zwJxiG5tB)):
  - Thẻ đổi tên thành "Không gửi cho", một danh sách dòng: "Khách đã từ chối nhận tin" (luôn áp dụng), rồi mỗi loại đã thêm là một dòng đọc như câu, có Sửa / bỏ. Khách thuộc 1 dòng bất kỳ là không gửi.
  - Nút "Thêm loại trừ" mở menu 4 loại, mỗi loại có ví dụ: đã được gửi tin ở chiến dịch (chọn 1 hoặc nhiều chiến dịch), có trong Nhóm data, theo điều kiện ở Zalo (nhóm điều kiện), trong danh sách bạn bè/Zalo ID. Mỗi loại một dòng.
  - Bỏ thanh chọn Zalo gửi và ô dùng chung: mặc định dùng chung cho mọi Zalo của chiến dịch; "Đặt riêng cho từng Zalo gửi" là liên kết nhỏ dưới thẻ (chiến dịch cũ có cấu hình riêng từng Zalo thì mở sẵn chế độ này).
  - Hộp chọn chiến dịch / Nhóm data: tìm theo tên, lọc trạng thái (chiến dịch), mỗi dòng có số khách đã gửi / số data, chân hộp "Đã chọn N · M khách".
  - Nhóm điều kiện: bước 1 tích các Zalo cần xét (lưới ô tích, có giờ đồng bộ); bước 2 mỗi Zalo một thẻ chỉ có điều kiện đã thêm, viết thành câu ("Khách là bạn bè", "Khách có tag Zalo …", "Khách đã được Zalo này gửi tin trong N ngày"), "Thêm điều kiện" mở menu loại còn lại; "Khách thỏa tất cả / 1 điều kiện bất kỳ" chỉ hiện khi Zalo có từ 2 điều kiện; giữa các Zalo ghi "hoặc"; cuối form là câu tóm tắt "Sẽ không gửi cho khách: …". Trạng thái bạn bè chỉ còn 3 lựa chọn: là bạn bè, không phải bạn bè, đã được gửi lời mời kết bạn (bỏ "Nhận kết bạn").
  - Ghi chú data / tiến trình dùng đúng câu của dòng trên thẻ.
- **Web:** cùng giao diện. **iOS:** đề xuất đợt đầu chỉ hiện tóm tắt nhóm nhiều Zalo và chọn được nhóm có sẵn; sửa nhóm nhiều khối làm sau.
- **AI tạo nhóm (config 7):** giữ tạo 1 khối cho Zalo đang cấu hình; AI tạo nhiều khối để đợt sau.
- **Quy trình (journey):** chép cấu hình như cũ, kiểm lại phần mô tả bước.

## 7. Kiểm thử

- **SQL (PG17 cục bộ, nạp đè thân hàm production):**
  - Chuyển 102 nhóm sang 1 khối: quyết định của mọi nhóm phải giống hệt trước khi đổi.
  - `save`/CAS; quyền Nhóm data và chiến dịch; giới hạn.
  - App cũ bị chặn đúng chỗ.
  - Hiệu năng `facts` với 20 Zalo, Nhóm data 100 nghìn thành viên, chiến dịch 60 nghìn kết quả.
- **Luật:** `send-exclusion-smoke-test.cjs` thêm các ca nhiều khối, HOẶC giữa khối, Zalo chưa đồng bộ, Zalo đã xoá, danh sách mới, lý do khớp.
- **Chạy thật code app:** `send-exclusion-runtime-smoke.cjs`, `campaign-failure-cleanup-smoke-test.cjs`, `core-smoke` của engine, bộ kịch bản engine v2 với cấu hình mới.
- **Giao diện:** `run-send-exclusion-ui-smoke.cjs`, `run-send-exclusion-form-smoke.cjs`, Web `campaign-send-exclusions.spec.ts`.
- **Phát lại dữ liệu thật (chỉ đọc):** chiến dịch đang dùng loại trừ chạy qua luật mới với nhóm 1 khối phải ra cùng quyết định; nhóm nhiều khối dựng từ nhóm của 16 nhân viên đang tạo nhóm riêng cho từng Zalo.

## 8. Thứ tự đưa lên

1. DB p1: bảng, cột, điền sẵn khối cho nhóm cũ. Chỉ mục `zalo_users` dựng riêng bằng `CONCURRENTLY`.
2. DB p2: hàm `_v2`, sửa hàm cũ và trigger. Có `CREATE OR REPLACE FUNCTION` nên apply buổi tối, ngoài giờ cao điểm. Công tắc để `off`.
3. Deploy ChatApi `worker`, gồm lõi mới và bộ cũ.
4. Phát hành Desktop và App Server.
5. Deploy API/Web; phát hành iOS.
6. Bật công tắc cho admin akaBiz, thử thật, rồi bật cho mọi khách.

Trước bước 6: Desktop bản cũ mở chiến dịch có cấu hình mới thì bị tạm dừng với câu báo cập nhật (mục 5), không gửi sai.

## 9. Đã chốt (25/11, theo đề xuất khi anh bảo thực thi)

1. Nhóm data và chiến dịch đã gửi đặt ở thẻ chiến dịch, cạnh danh sách bạn bè (đề xuất, như thiết kế), hay đặt trong nhóm loại trừ để dùng lại ở nhiều chiến dịch?
2. "Đã nhận tin ở chiến dịch": chỉ data đã gửi tin thành công (đề xuất), hay cả data chiến dịch đó chưa gửi hoặc gửi lỗi?
3. Lời mời kết bạn có tính là "đã gửi" không? Đề xuất: chỉ tính tin nhắn.
4. iOS đợt đầu chỉ xem và chọn nhóm có sẵn (đề xuất), hay làm đủ editor 2 tầng như Desktop và Web?

Chốt: (1) thẻ chiến dịch; (2) chỉ data đã gửi tin thành công; (3) chỉ tin nhắn (`zalo_message_friend`, `zalo_message_stranger`), không tính lời mời kết bạn; (4) iOS đợt đầu chỉ xem, giữ nguyên cấu hình mới, kiểm lúc lưu bằng trang v2.

## 10. Đã làm (25/11/2026, nhánh `claude/festive-rubin-5zi6qe`)

**DB (akaAgent, đã apply 25/11 17:54–17:59 VN, không apply lại):** [p1](../migrations/migration_v654_send_exclusion_multi_zalo_p1.sql) (bảng khối
`auto_campaign_send_exclusion_group_accounts`, cột `groups.version`, `rules.group_account_id` điền 1 khối cho mọi nhóm cũ,
trigger điền khối chính khi bản app cũ ghi luật, công tắc `off`) → [chỉ mục](../migrations/migration_v654_send_exclusion_multi_zalo_index.sql)
`idx_zalo_users_account_global_id` (CONCURRENTLY, chạy riêng) → [p2](../migrations/migration_v654_send_exclusion_multi_zalo_p2.sql)
(khoá md5 6 thân hàm production đọc 25/11; hàm cũ giữ hình dạng cũ, hàm mới `aka_agent_send_exclusion_v2` page / options / lists / save,
bộ chạy lấy phần `remote` khi gửi `clientVersion: 2`, op `remote` tra danh sách / Nhóm data / chiến dịch đã gửi / dữ kiện khối Zalo khác
trong một lượt) và [gỡ](../migrations/rollback_v654_send_exclusion_multi_zalo.sql) (thân production nguyên văn, kiểm md5).
Kiểm `PG_MODULE_DIR=<thư mục có module pg> node scripts/send-exclusion-v654-smoke.cjs` (PG16, 18 nhóm, có gỡ).

**Bộ chạy:** luật dùng chung `evaluateSendExclusionWithRemote` (`src/shared/campaignSendExclusion.ts`, lõi engine chép nguyên văn;
`node scripts/send-exclusion-multi-zalo-smoke.cjs`). Bộ cũ Desktop / App Server và engine v2 Desktop đã đọc phần mới. Bản app cũ
và ChatApi (bộ cũ + cổng engine trên Fly, **chưa sửa**, repo không gắn vào phiên này) gặp cấu hình mới thì DB trả
`send_exclusion_client_outdated`: bộ cũ tạm dừng chiến dịch, engine báo cấu hình lỗi; không gửi sai. Bản chép luật ở ChatApi
`packages/runtime-protocol` đang cũ: phải chép lại trước khi deploy `worker`.

**Desktop:** thẻ [CampaignSendExclusionsCard](../src/renderer/src/components/CampaignPanels/CampaignSendExclusionsCard.tsx) (form thường
và form Agent, chỉ khi công tắc bật; tắt thì thẻ cũ), IPC `send-exclusions-v2:*`, hợp đồng `src/shared/campaignSendExclusionMulti.ts`
(chép nguyên văn sang WebApp `packages/control-api`). Kiểm `node scripts/run-send-exclusion-card-ui-smoke.cjs` (9 nhóm, Chromium,
IPC giả; `SX_UI_SHOTS=<thư mục>` để chụp). Chưa chạy trong Electron thật, chưa gọi RPC thật.

**WebApp:** API `/data/send-exclusions-v2` (page, `/options`, `/lists`, POST lưu), thẻ Web `apps/web/src/features/CampaignSendExclusionsCard.tsx`
(chép từ Desktop), công tắc trong `web-polling-settings`; `projectSendExclusions` giữ `dataGroupIds` / `sentCampaignIds`
(trước đó Web bỏ hai khoá này khi lưu); iOS hiện câu và giữ nguyên, kiểm lúc lưu bằng `verifySendExclusionsV2`.

**Thứ tự đưa lên (mục 8):** apply p1 → chỉ mục → p2 (tối) → chép luật + sửa ChatApi rồi deploy `worker` → phát hành Desktop / App Server
→ deploy API/Web, phát hành iOS → bật công tắc cho admin akaBiz, thử thật → mọi khách. Bật công tắc trước khi ChatApi có bản mới thì
chiến dịch Fly dùng cấu hình mới bị dừng ngay ở bước loại trừ.

