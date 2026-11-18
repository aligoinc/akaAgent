# V564: engine v2 Facebook xáo trộn danh sách group như bộ cũ (18/11/2026)

**Tình trạng:**
- Code và migration ở nhánh `claude/fb-engine-shuffle-groups`, [PR #696](https://github.com/aligoinc/akaAgent/pull/696). Anh chốt 18/11: "Giữ, sửa luôn" (giữ 11 tổ chức trong `engine.facebook`, sửa ngay), rồi "Đẩy PR, apply ngay".
- **V564 đã apply akachat lúc 10:35:37 VN 18/11/2026**: sổ `20261118033526`, không apply lại, md5 sổ = md5 file = `0bd5c955…` ([biên nhận](../migrations/snapshots/engine-facebook-v564/apply-receipt.json)).
- PostgREST nạp lại schema xong trong khoảng 6 giây, 0 lỗi 503. Trong lúc nạp có 1 lần `report_v1` của Desktop hết giờ; lõi tự gửi lại kết quả.
- Lượt đăng nhóm đầu tiên sau apply (chiến dịch 49556) nhận đúng data đứng đầu thứ tự xáo.
- Chưa build Desktop, nên dòng 🔀 chỉ có từ bản sau.

## Lỗi

- **Bộ cũ** (`campaignScheduler.ts`, `executeCampaignV2`): chiến dịch "Đăng bài vào group" bật "Xáo trộn danh sách group" (`extra_settings.shuffleGroupList`) thì đầu mỗi lượt xáo các data chờ (Fisher–Yates), rồi đăng theo thứ tự đó. Khi có hơn một data, bộ cũ in "🔀 Đã xáo trộn danh sách N group".
- **Engine tới V563:** `aka_agent_engine_claim_target_v1` chọn data theo `d.id + 0` (V532), nên bỏ qua cài đặt này. Lượt nào cũng đăng cùng một thứ tự (data thêm trước thì đăng trước), và không có dòng 🔀.
- **Kiểm 18/11 sáng (chỉ đọc):** chiến dịch 49535 ở bộ cũ đăng theo thứ tự 12559491, 12559504, 12559490…; ở engine thì 12559466, 12559467… tăng dần.
- **Không mất, không trùng, không kẹt data:** lượt chưa xong thì hôm sau chạy tiếp phần còn lại, mỗi lượt vẫn đăng đủ mọi nhóm.
- **Rủi ro thật nằm ở khách chạy nhiều tài khoản trên cùng danh sách nhóm.** Các tài khoản đi cùng một thứ tự, nên một nhóm nhận bài của nhiều tài khoản cách nhau vài phút; admin nhóm hay Facebook dễ coi đó là spam.
  - Đo 18/11: 4.060/6.208 chiến dịch đăng nhóm bật cài đặt này (lưu kiểu boolean).
  - Trong 11 tổ chức bật engine:

    | Tổ chức | Tài khoản | Nhóm dùng chung |
    | --- | ---: | --- |
    | 701 | 7 | 318/318; hai chiến dịch hẹn 20:29 và 20:31 có 5 nhóm đầu giống hệt |
    | 1419 | 5 | 4/5 chiến dịch bắt đầu bằng cùng một nhóm |
    | 124 | 4 | 208/208 |
    | 382 | 2 | 442/592 |

## Sửa

- **DB (V564, chỉ thân `aka_agent_engine_claim_target_v1`):**
  - Áp dụng cho chiến dịch `facebook_group_post` có `extra_settings.shuffleGroupList = true`, trừ lần nhận theo `inputDataIds` (nhóm chia sẻ kèm) và lượt theo lịch.
  - Data được chọn theo `md5(id::text || lease_token::text)`. Mỗi lượt (lease) có một thứ tự ngẫu nhiên riêng, giữ nguyên trong lượt; lượt sau có lease mới nên thứ tự khác, đúng như bộ cũ xáo lại ở đầu mỗi lượt.
  - Lần nhận đầu của lượt trả thêm `shuffle.count`: số data chờ đến hạn lúc bắt đầu lượt, tính cả data vừa nhận. "Lần nhận đầu" là khi lease mới (lõi gửi `leaseToken` rỗng), hoặc khi lõi gửi `unitStarted: false` (lượt chưa nhận data nào, ví dụ lần gọi trước trả `cooldown_scan` và đã cấp lease).
  - Mọi chiến dịch khác giữ câu chọn `d.id + 0` (chỉ thụt lề vì nằm trong nhánh ELSE) và câu trả lời không đổi, không có khoá `shuffle`.
- **Lõi (`packages/campaign-engine`):** in "🔀 Đã xáo trộn danh sách N group" một lần mỗi lượt, ngay sau "🚀", khi N > 1 (`shuffleProgress` trong `progress.ts`, `markShuffled` trong `runUnit.ts`). Ở chế độ workflow, lõi gửi `unitStarted: false` khi lượt chưa nhận data nào. Kiểu dữ liệu: `ClaimResponse` (claimed) thêm `shuffle?: { count: number }`, `ClaimContext` thêm `unitStarted?: boolean`.
- **Desktop 9.9.0** bỏ qua khoá `shuffle` nên chưa in dòng 🔀, nhưng sẽ đăng theo thứ tự đã xáo ngay khi apply V564. Dòng 🔀 chỉ có từ bản Desktop sau.
- **Fly** không chạy Facebook. Chiến dịch Zalo không có `action_id = facebook_group_post`, nên không đổi gì.
- **Chi phí, đo trên dữ liệu thật (chỉ đọc, EXPLAIN ANALYZE):** chiến dịch đăng nhóm bật xáo trộn lớn nhất có 1.935 data chờ. Câu chọn mới mất 8,6 ms, câu cũ 4,3 ms, cùng 5,88 nghìn buffer. Phần lớn chi phí là bước loại data đã thử trong lượt, có sẵn ở cả hai câu.

## Kiểm

- `node scripts/engine-v2-facebook/v564-smoke.cjs` chạy trên PG17 cục bộ, lõi thật và RPC thật, nơi chạy workflow giả. Đạt 12/12:
  - DB thử có thân claim trùng production (`7ddfa216…`).
  - Bản gỡ từ chối khi chưa apply; apply giữ quyền; không apply lại được.
  - Lượt đi đúng thứ tự `md5(id || lease)`, khác thứ tự id, đủ mỗi data một lần, không lấy data hẹn sau.
  - Dòng 🔀 in một lần, ngay sau 🚀, với N = 10. `shuffle` chỉ có ở lần nhận đầu.
  - Lượt sau xáo thứ tự khác và in lại 🔀.
  - Không bật xáo trộn: đi theo id, không có 🔀, câu trả lời không có `shuffle`.
  - Comment seeding có cờ xáo trộn vẫn đi theo id.
  - Lease đã cấp mà lượt chưa nhận data: `unitStarted: false` vẫn có `shuffle`; lần nhận sau trong lượt thì không.
  - Chỉ một data thì không in 🔀.
  - Gỡ trả đúng thân V558, rồi apply lại được.
- Các bộ kiểm engine Facebook và Zalo dùng `FACEBOOK_MIGRATIONS` (`scripts/engine-v2-facebook/fixture.cjs`), nay có V564 đứng ngay sau V558 như production. Kết quả chạy lại ghi ở PR.

## Apply và gỡ

- `node scripts/build-v564-sql.cjs` sinh `migrations/migration_v564_engine_facebook_shuffle_groups.sql` và `migrations/rollback_v564_engine_facebook_shuffle_groups.sql`. Không sửa tay hai file này.
- **Preflight:** sổ chưa có `migration_v564_%`, và md5 `pg_get_functiondef` của claim phải là `7ddfa216286849296e6b537c120e291d` (bản V558).
- **Postflight:** md5 `03d72830d664682c1f51dc3dd9944eda`, quyền và chủ sở hữu giữ nguyên.
- `CREATE OR REPLACE FUNCTION` làm PostgREST nạp lại schema, nên apply ngoài giờ cao điểm.
- **Gỡ:** chạy file rollback để trả thân V558. Chiến dịch xáo trộn lại đi theo id; lõi không nhận `shuffle` thì không in 🔀.
