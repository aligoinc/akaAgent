# Làm giàu lịch sử Web — yêu cầu và mặc định V401

Đã apply trên **akachat / cgjbsmqtfhqvttudyjzq** ngày 15/10/2026 giờ Việt Nam. History: `20261014171635 / migration_v401_web_enrichment_defaults`. Desktop đã typecheck/build local; chưa đóng gói/phát hành. Không apply lại V398 hoặc V401.

## Hành vi

- Khi bật và lưu: tối thiểu **3 từ khóa khác nhau**, đúng **3 website HTTP(S) khác nhau**. Giữ chuẩn hóa URL, chống trùng và các kiểm tra còn lại.
- Ô nhập giờ điền sẵn **12:00**; cấu hình mới có danh sách giờ trống, chỉ bấm **Thêm giờ** mới tạo mốc. Ngày dừng là **ngày hiện tại theo Việt Nam + 7 ngày**. Ví dụ mở lần đầu ngày 15/10/2026 thì ngày dừng là 22/10/2026. Người dùng vẫn sửa hoặc xóa ngày dừng được.
- Mặc định chỉ tạo khi chưa có cấu hình. Ngày/giờ đã lưu, kể cả ngày dừng `null` hoặc danh sách giờ rỗng của draft tắt, không bị tự điền lại.
- Cấu hình năm website đã lưu tiếp tục được runtime đọc/chạy. UI hiển thị đủ dữ liệu cũ và yêu cầu giữ lại ba website nếu lưu bật; tắt vẫn cho lưu nguyên năm website. Không cắt hoặc backfill dữ liệu khách hàng.
- Thời lượng mặc định 30 phút và cơ chế scheduler/browser giữ nguyên.

`emptyWebEnrichmentConfig` tính ngày theo UTC+7, độc lập múi giờ máy. `validateWebEnrichment` mặc định kiểm tra hợp đồng lưu mới; chỉ loader runtime truyền `allowLegacyFiveWebsites` để nhận cấu hình cũ có revision đã lưu. RPC giữ trần JSON năm website cho draft tắt, nhưng bật/lưu chỉ nhận ba.

## RPC và audit

Signature: `public.aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)`.

| Thuộc tính | Kết quả |
|---|---|
| Source MD5 | `4505f7334baa90908454c354dd091db5` |
| Target MD5 | `df426447a1fd533e052437699bb8dd5d` |
| Đối chiếu live | Body trùng V398; không có patch DB-only cần ghép |
| Thay đổi body | Ngưỡng từ khóa `<5` → `<3`; số website `<>5` → `<>3` trong kiểm tra bật/lưu |
| Owner/security | `postgres`, SECURITY DEFINER, VOLATILE, giữ nguyên |
| Config | `search_path=pg_catalog, public`, timeout `15s`, giữ nguyên |
| ACL | EXECUTE cho postgres/anon/authenticated/service_role; PUBLIC không có quyền, giữ nguyên |

Giữ credential/staff/tenant/quyền Facebook, lock hàng cấu hình và revision/CAS. Không đổi signature/return/API metadata, RPC V393–V397, workflow, bảng/cột, connection/polling hay cấu hình tài khoản đã lưu. Không gửi reload schema thủ công. Apply qua Management API đã liên kết, INSERT history vào bảng có sẵn; không tạo/alter bảng history khi chuẩn bị.

Snapshot và receipt: [manifest](../migrations/snapshots/web-enrichment-defaults-v401/manifest.json), [live trước](../migrations/snapshots/web-enrichment-defaults-v401/before.json), [smoke rollback](../migrations/snapshots/web-enrichment-defaults-v401/smoke.json), [apply](../migrations/snapshots/web-enrichment-defaults-v401/apply.json), [live sau](../migrations/snapshots/web-enrichment-defaults-v401/after.json), [post-smoke](../migrations/snapshots/web-enrichment-defaults-v401/post-smoke.json), [API](../migrations/snapshots/web-enrichment-defaults-v401/api.json).

## Kiểm chứng

- 70 checks shared/planner/browser/service/scheduler: yêu cầu ba mục, chuẩn hóa/trùng URL, cho phép runtime đọc năm website cũ, mặc định qua nửa đêm Việt Nam, tháng/năm và năm nhuận.
- 58 ca bàn giao scheduler, dùng cấu hình năm website cũ để kiểm tra tương thích runtime.
- Electron UI smoke: hai từ khóa/website bị từ chối, ba mục lưu được; mặc định 12:00/+7, lịch/ngày tự sửa được giữ khi mở lại, lỗi lưu/CAS giữ draft, chip/IME, cảnh báo, tắt/bật, màn hình 390px. Fixture UI cũ xác nhận giữ năm website, ngày dừng trống/giờ 18:30, tắt được và lưu bật sau khi giảm xuống ba.
- SQL trước/sau apply đều chạy trong transaction rollback: save/sort/revision, stale revision, số lượng/URL trùng/sai, credential, tenant/account/ACL và giữ trường nghiệp vụ. Hash toàn bộ cấu hình Facebook và các RPC được bảo vệ không đổi sau apply.
- API xác nhận RPC/cột truy cập được và thiếu/sai credential bị từ chối; không đọc hoặc ghi dữ liệu tài khoản thật qua API smoke.
- Hai typecheck, production build và `git diff --check` đạt. Đã xem ảnh mặc định và 390px: [mặc định mới](audits/web-enrichment-v398/defaults-v401/modal-new-defaults.png), [form mới](audits/web-enrichment-v398/defaults-v401/modal-new-top.png), [390px](audits/web-enrichment-v398/defaults-v401/modal-mobile.png).

Chạy lại kiểm tra:

```bash
node scripts/web-enrichment-runtime-smoke.cjs
node scripts/web-enrichment-handoff-smoke.cjs
WEB_ENRICHMENT_UI_OUTPUT_DIR=/tmp/web-enrichment-v401 node scripts/run-web-enrichment-ui-smoke.cjs
node scripts/web-enrichment-defaults-v401.cjs verify
npx tsc --noEmit -p tsconfig.node.json
npx tsc --noEmit -p tsconfig.web.json
npm run build
```

## Rollback và giới hạn

[Rollback SQL](../migrations/tests/migration_v401_web_enrichment_defaults_rollback.sql) chỉ nhận checksum target rồi khôi phục chính xác live source. Đã diễn tập bằng ROLLBACK; production vẫn giữ V401 ([receipt](../migrations/snapshots/web-enrichment-defaults-v401/rollback-smoke.json)). Không xóa history hoặc đổi dữ liệu đã lưu.

Rollback RPC sẽ khôi phục yêu cầu năm website/từ khóa, vì vậy phải phối hợp với client; cấu hình ba website đã lưu sau V401 không tự chuyển thành năm. Không rollback riêng RPC trong lúc client vẫn dùng hợp đồng ba website.

Finding P2 về implicit submit khi Enter đã được sửa tiếp ở Desktop: ô từ khóa/sở thích/website chặn submit mặc định khi Enter thuộc IME; RPC và mặc định V401 giữ nguyên. Xem [kiểm chứng bản sửa](FACEBOOK_WEB_ENRICHMENT_V398.md#sửa-finding-enter-tự-lưu-modal).

## Bổ sung ô chọn giờ mặc định

Theo xác nhận của người dùng ngày 15/10/2026, **chỉ ô nhập giờ** điền sẵn `12:00` khi mở/tải lại form; cấu hình mới có `slots: []`. Bấm **Thêm giờ** mới tạo mốc. Theo phản hồi tiếp theo, sau khi thêm mốc (kể cả mốc khác `12:00`), ô trở về `12:00` để luôn có giá trị mặc định, không xóa trống. Đây là điều chỉnh cách hiểu ban đầu đã tự tạo mốc `12:00` trong cấu hình mới.

Giữ nguyên danh sách đã lưu, kể cả danh sách rỗng; giá trị trong ô nhập chỉ được thêm khi bấm **Thêm giờ** và không tạo mốc trùng. Không sửa DB, RPC hoặc scheduler. Electron UI smoke đạt các ca mở/tải lại form, thêm giờ trùng, giữ `12:00` sau khi thêm mốc mặc định/mốc tùy chỉnh, giữ lịch tùy chỉnh và lưu draft rỗng; hai typecheck sạch. Đã xem ảnh form tối, ô chọn giờ hiển thị `12:00`.

Kiểm tra phản hồi chưa chạy (trước điều chỉnh cửa sổ): đọc trạng thái tài khoản và catalog workflow/block/selector trên DB; không cập nhật dữ liệu. Tái hiện bằng planner thật với lịch `00:25, 23:55`: khi cấu hình được lưu lại lúc `00:30`, `invalidate → preempt → discardThrough` bỏ mốc `00:25`, mốc tiếp theo là `23:55`. Mở app mới lúc `00:31` vẫn có thể nhận mốc `00:25` trong cửa sổ đến trước `00:55`, theo giới hạn RAM đã thống nhất. Terminal phiên dev tại thời điểm kiểm tra đã dừng bằng Ctrl+C, không xác nhận được trạng thái RAM hoặc lượt lướt thực tế; không suy ra chắc chắn chưa chạy chỉ từ việc thiếu log best effort. Người dùng sau đó yêu cầu bật/lưu cấu hình cũng được nhận mốc còn cửa sổ; xem [hành vi hiện tại và kiểm chứng](FACEBOOK_WEB_ENRICHMENT_V398.md#bật-hoặc-lưu-trong-cửa-sổ-30-phút--15102026).
