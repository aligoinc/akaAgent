# V585: engine v2 đọc danh sách "Chạy nhiều khung giờ" dạng mảng

Trạng thái: **đã apply akachat 15:56:22 VN 19/11/2026** theo yêu cầu ("Apply ngay"; sổ `20261119085621`, không apply lại; md5 sổ = file
`560b3ff9…`; md5 thân hàm `92c119f2…`; [biên nhận](../migrations/snapshots/engine-multi-slot-array-v585/apply-receipt.json)). Code ở nhánh
`claude/engine-multi-slot-array`, PR [#725](https://github.com/aligoinc/akaAgent/pull/725) vào `dev_3` (chưa merge).

Lúc apply (giờ cao điểm chiều) PostgREST nạp lại schema mất 10,2 giây: trong 30 giây đó 726/19.549 request REST chậm hơn 1 giây, 2 lượt
`aka_agent_engine_report_v1` của Desktop quá trần 3 giây (lỗi 500), 0 lỗi 503; cửa sổ 30 giây kế tiếp đã bình thường.

## Lỗi

Chiến dịch bật "Chạy trong nhiều khung giờ trong 1 ngày", tạo hoặc sửa trên Web, chạy bằng engine v2: chạy xong lượt đầu là
"✅ Hoàn thành chiến dịch", không hẹn khung kế.

Ca phát hiện (tổ chức 2214, tài khoản Zalo Server 12142, engine v2 trên Fly, 19/11):

| Chiến dịch | Chạy (giờ VN) | Kết quả |
|---|---|---|
| 58847 "Blokees Blindbox" | 11:12:48 → 11:13:01 | 7/8 group, hoàn thành |
| 58849 "HGX" | 11:14:20 → 11:14:36 | 7/8 group, hoàn thành |
| 59089 "HGX (Copy)" | 15:27:25 → 15:27:46 | 7/8 group, hoàn thành |

Cài đặt: lịch tuần đủ 7 ngày, 16 khung 08:00–23:00, giờ dừng 23:30, gửi dạng chia sẻ.

## Nguyên nhân

- Web lưu `extra_settings.multiDailyTimeSlots` là mảng JSON `["08:00", "09:00"]`
  (akaAgentWebApp `packages/campaign-core/src/submission.ts`). Desktop lưu chuỗi `08:00,09:00`.
- `aka_agent_engine_finish_campaign_v2` (thân V561, md5 `d8c9a144…`) chỉ đọc kiểu `string` / `number`; kiểu khác thành chuỗi rỗng,
  tức không có khung nào, nên đi thẳng xuống nhánh hoàn thành.
- Bộ cũ không dính: `String(mảng)` nối phần tử bằng dấu phẩy ([campaignScheduler.ts](../src/main/services/campaignScheduler.ts)
  `normalizeMultiDailyTimeSlots`). Tổ chức 1735 (chưa bật engine v2) lưu dạng mảng vẫn nhảy khung bình thường ngày 19/11.
- Trên production chỉ hàm này đọc danh sách khung giờ (`private.aka_agent_campaign_repeat_config` chỉ đọc cờ bật).

Phạm vi đo 19/11 (chỉ đọc, chiến dịch đổi trong 14 ngày): 76 chiến dịch Zalo Server lưu dạng mảng ở 5 tổ chức đã bật engine v2,
7 chiến dịch đang chờ hoặc đang chạy.

## Sửa

[migration_v585_engine_multi_slot_array.sql](../migrations/migration_v585_engine_multi_slot_array.sql) thay thân
`aka_agent_engine_finish_campaign_v2`, đổi đúng một chỗ: kiểu `array` thì nối các phần tử bằng dấu phẩy rồi đi qua đúng bộ tách và
chuẩn hoá đang có. Kiểu `string` / `number` và mọi kiểu khác xử lý như cũ. Giữ chữ ký, chủ sở hữu, quyền.

- md5 `pg_get_functiondef`: `d8c9a144ae30718e7a5aed5d58914fb1` → `92c119f20d47ea5eee0770b5e6498d41`.
- Kiểm trước: sổ chưa có `migration_v585_%`, thân hàm đúng bản V561. Kiểm sau: md5 thân mới, quyền / chủ sở hữu không đổi.
- Sinh bằng `node scripts/build-v585-sql.cjs`; không sửa tay file migration. Thân hàm không ghi số migration, nên đổi số (sửa `VERSION`
  trong bộ sinh rồi sinh lại) không làm đổi md5 thân hàm.
- Chỉ sửa DB. Không cần build Desktop, deploy Fly hay deploy Web; có hiệu lực cho cả chiến dịch đã tạo.

## Kiểm

```bash
CHAT_REPO=<akaAgentChatApi> LC_ALL=C node scripts/engine-v2-multi-slot-array-v585-smoke.cjs
```

7 nhóm (PG17 cục bộ, cần còn ít nhất 75 phút trong ngày giờ VN): tái hiện lỗi trên thân V561; apply / ROLLBACK / apply lần hai bị chặn /
quyền giữ nguyên; mảng hẹn khung kế và đặt lại data; mảng lộn xộn, phần tử lạ; khung kế vượt giờ dừng, hết khung, dưới 2 khung hợp lệ;
dạng chuỗi trả lời y như trước; cài đặt của khách; bản gỡ.

Chạy lại trên thân V585:

- `WITH_V585=1 node scripts/campaign-repeat-v561-smoke.cjs`: 9 nhóm đạt.
- Bộ kịch bản `SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_CAMPAIGN_REPEAT=1 SCENARIO_MULTI_SLOT_ARRAY=1 node scripts/engine-v2-scenarios/run.cjs
  --rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01`: 0 vi phạm mới (708 lượt, 5.250 lần gửi), bằng lượt nền không có V585.

Bộ cấu hình thật của bộ kịch bản có 6 chiến dịch lưu khung giờ dạng mảng. Có V585 thì các chiến dịch này hẹn khung kế và đặt lại data,
nên bất biến I7 (data đã gửi mà còn chờ) từng báo 155 dòng. I7 nay chỉ xét kết quả ghi sau lần đặt lại data gần nhất của chiến dịch
(`PASS_RESET_REASONS` trong `run.cjs`), vì gửi lại ở khung kế là đúng cài đặt.

Chưa kiểm: chạy thật trên production; chiến dịch Facebook (đăng trang cá nhân, Page) dạng mảng (Desktop lưu chuỗi nên không gặp).

## Apply (đã làm 19/11, không chạy lại)

DDL (`CREATE OR REPLACE FUNCTION`) làm PostgREST nạp lại schema. Cách đã dùng:

```bash
node scripts/make-migration-ledger-apply.cjs migrations/migration_v585_engine_multi_slot_array.sql migration_v585_engine_multi_slot_array <file ra>
```

rồi `supabase db query --linked -f <file ra>` từ checkout chính.

Việc còn lại sau khi apply:

- Ba chiến dịch 58847 / 58849 / 59089 đang "hoàn thành"; muốn chạy tiếp trong ngày thì phải cho chạy lại. 58849 và 59089 là bản sao của
  nhau, hỏi khách giữ cái nào trước khi mở lại.
- Theo dõi: chiến dịch dạng mảng ở tổ chức bật engine v2 có lịch nhảy sang khung kế sau mỗi lượt.

## Gỡ

[rollback_v585_engine_multi_slot_array.sql](../migrations/rollback_v585_engine_multi_slot_array.sql) trả thân V561. Sau khi gỡ, chiến dịch
dạng mảng lại hoàn thành sau lượt đầu.
