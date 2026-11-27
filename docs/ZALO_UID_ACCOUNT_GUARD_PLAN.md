# Chặn chiến dịch Zalo dùng danh sách quét bằng tài khoản khác (DAT04)

Tình trạng 27/11/2026: phần DB đã viết ([V679](../migrations/migration_v679_zalo_uid_account_guard.sql) chặn danh sách,
[V680](../migrations/migration_v680_notification_campaign_pause_default.sql) thông báo tạm dừng bật sẵn, kèm bản gỡ) và đã
kiểm thử lặp (mục 5), **chưa apply, chưa đổi gì trên production**. Điểm chặn khi lưu ở API Web và Desktop đã code (mục 5.1).
Các quyết định ở mục 3 anh đã chốt cùng ngày; câu lúc lưu anh chốt 27/11 là một câu chung, chỉ chặn (mục 4.3).

## 1. Chuyện đã xảy ra

Chiến dịch 61799 "LPP test group" (nhân viên 1226, tổ chức 1133, loại `zalo_message_group_member`) có 881 người
nhận do tài khoản "van khanh 1" (7349) quét từ group. Tối 26/11 khách đổi chiến dịch sang tài khoản "thế zus"
(9086) trên Web. Mã người dùng Zalo (UID) khác nhau theo từng tài khoản, nên "thế zus" không gửi được cho ai:

- 20:53–20:58 ngày 26/11 (bộ chạy cũ trên App Server): 4 người báo "Tham số không hợp lệ", chiến dịch dừng.
- 08:01 ngày 27/11 (engine v2): chạy đúng giờ, người đầu tiên báo DAT04, chuỗi lỗi lên 5 (ngưỡng 4), chiến dịch
  tạm dừng sau 4 giây. 11:21 bấm Tiếp tục thì lặp lại y hệt.
- Mỗi người gặp lỗi bị đánh "hoàn thành" và không được gửi lại (6 người).

Hệ thống có ghi lý do vào tiến trình, ghi chú data và ghi chú chiến dịch. Nhưng nút Tiếp tục / Tạm dừng của Zalo
Server (`aka_agent_set_zalo_server_campaign_status`) đặt ghi chú về trống, nên lúc khách chụp màn hình thì ghi chú
là "-". Nhân viên này chỉ có thông báo "Chào ngày mới", không có thông báo chiến dịch tạm dừng.

## 2. Số đo (production, chỉ đọc, 27/11)

- 25 chiến dịch đang chờ hoặc tạm dừng có danh sách gần như toàn bộ thuộc tài khoản khác: 13 do đổi tài khoản sau
  khi tạo, 12 sai từ lúc tạo (bản sao chọn tài khoản khác, hoặc nhiều tài khoản dùng chung một danh sách).
  Theo loại: thành viên group 18, bạn bè 3, khách hàng cũ 2, huỷ lời mời kết bạn 2.
- 7 ngày: 22 lượt DAT04 ở 7 chiến dịch / 6 tổ chức (mã có từ 20/11).
- Luật ở mục 4.1 không chặn nhầm: 3.818 lượt gửi thành công trong 24 giờ (thành viên group 1.085, bạn bè 2.703,
  khách hàng cũ 30) đều có UID thuộc chính tài khoản gửi, 0 lượt sẽ bị chặn.
- Thông báo: 2.306 nhân viên có cài đặt thông báo, chỉ 133 có dòng "Chiến dịch" (113 đã chọn Tạm dừng). 7 ngày ở
  nhóm này có 1.059 thông báo tạm dừng, 886 (84%) là do chính họ bấm Tạm dừng (không có ghi chú), 173 do hệ thống
  dừng (có ghi chú). Engine dừng chiến dịch 235 lần trong 7 ngày, lần nào cũng kèm ghi chú.

## 3. Quyết định anh đã chốt (27/11/2026)

1. Chặn hẳn khi lưu, câu báo rõ ràng, dễ hiểu. Không có nút "Vẫn lưu".
2. Lúc đang chạy mà gặp người nhận thuộc tài khoản khác: giữ người đó lại để gửi sau khi khách đổi về đúng tài
   khoản, không đánh "hoàn thành" như hiện nay.
3. Bật sẵn thông báo "chiến dịch tạm dừng" cho mọi nhân viên. Chỉ báo khi hệ thống tự dừng; khách tự bấm Tạm dừng
   thì không báo, áp dụng cả cho người đang tự bật thông báo chiến dịch.
4. Không làm: giữ ghi chú khi bấm Tiếp tục; xử lý 25 chiến dịch đang dính (khách tự gặp hộp chặn khi bấm Tiếp tục).

## 4. Thiết kế

### 4.1 Luật kiểm, viết một chỗ trong DB

Hai hàm mới cùng một lõi: `aka_agent_campaign_uid_account_check_v1(payload)` (Desktop theo phiên) và
`aka_agent_control_campaign_uid_account_check(staff, org, payload)` (API Web, chỉ `service_role`); quyền của mọi vai trò
khác bị thu (Supabase mặc định cấp hàm mới cho `anon` / `authenticated`). `payload.mode`:

- `uids`: tài khoản định dùng (tối đa 50) + danh sách UID (tối đa 2.000 mỗi lượt, bên gọi chia lượt). Dùng khi lưu.
- `campaign`: mã chiến dịch + tài khoản (bỏ trống = tài khoản hiện tại); hàm tự đọc tối đa 5.000 data đang chờ, kể cả
  data đang giữ vì DAT04, trả `truncated` khi còn nữa. Dùng khi bấm Tiếp tục / đổi tài khoản.
- `hold`: đặt các data đang chờ mà tài khoản hiện tại không gửi được sang "tạm dừng" với ghi chú DAT04 (đổi lại đúng
  tài khoản thì trigger ở mục 4.4 trả về). Từ chối khi chiến dịch đang chạy. Viết cho nút "Bỏ N người" đã bỏ (mục 4.3):
  app không gọi chế độ này.

UID được chuẩn hoá trước khi so (bỏ mọi khoảng trắng kể cả khoảng trắng Unicode, bỏ đuôi `_0`). Mỗi UID thuộc một
trong ba nhóm:

| Nhóm | Điều kiện | Xử lý |
|---|---|---|
| Gửi được | UID có trong `zalo_users` của tài khoản định dùng, hoặc của tài khoản cùng nick Zalo (`private.aka_agent_zalo_same_nick_accounts`, V657) | cho qua |
| Không gửi được | UID không thuộc nhóm trên và có trong `zalo_users` của tài khoản khác cùng tổ chức | chặn |
| Không rõ | UID không có ở tài khoản nào (nhập tay, file ngoài) | cho qua, không kiểm được |

Hàm trả số lượng từng nhóm cho từng tài khoản, kèm tên các tài khoản đã quét (để câu báo nói đúng tên); chỉ tra
"tài khoản khác" cho UID không thuộc tài khoản định dùng. Dùng chỉ mục đang có `idx_zalo_users_account_uid` và
`idx_kgt_zalo_users_uid_v3`. Không sửa bảng nào. Đo trên production (hàm tạm, chỉ đọc): chiến dịch 5.436 người nhận
6,3 giây lần đầu khi dữ liệu chưa vào bộ nhớ đệm, 138 ms các lần sau; trần hàm 15 giây.

Loại chiến dịch áp dụng: `zalo_message_group_member`, `zalo_message_friend`, `zalo_message_remarketing_customer`,
`zalo_cancel_sent_friend_request`. Chiến dịch chạy bằng Nhóm data không kiểm (đã gắn tài khoản theo nhóm).

Công tắc khẩn cấp `auto_system_settings` `campaign.uid_account_guard` = `block` / `off` (thiếu dòng = `block`).
Hàm lỗi, hết giờ hoặc DB chưa có hàm thì cho lưu như cũ; lưới ở mục 4.4 vẫn bắt lúc chạy.

### 4.2 Các điểm chặn

| Nơi | Điểm chặn | Ghi chú |
|---|---|---|
| API Web (Web + iOS mọi bản, có hiệu lực khi deploy) | Tạo chiến dịch, kể cả tạo cho nhiều tài khoản và nhân bản | `aka-agent-control.service.ts` |
| | Sửa chiến dịch có đổi tài khoản | đúng đường của ca 61799 |
| | Thêm data | |
| | Tiếp tục (tạm dừng → chờ xử lý) | chặn 25 chiến dịch đang dính đốt thêm data |
| Desktop, form thường và form Agent | Kiểm trước khi lưu: tạo, đổi tài khoản, thêm data; chọn nhiều tài khoản thì kiểm từng tài khoản | IPC mới `campaign:uid-account-check` |
| Desktop, tiến trình chính | Kiểm lại ở `DB_UPDATE_CAMPAIGN` (đổi tài khoản), chèn data, Tiếp tục | đặt ở handler như `contentSyntaxGuard`, không đặt trong repository vì bộ lập lịch gọi thẳng repository |

API trả 400 `campaign_uid_account_mismatch` với câu chung ở mục 4.3. Web và Desktop hiện hộp báo chỉ có nút Đóng; iOS bản đang phát hành hiện nguyên câu của API. Desktop bản cũ không có điểm chặn
khi lưu, dựa vào mục 4.4 và 4.5.

### 4.3 Câu cho khách

Lúc lưu, thêm data, bấm Tiếp tục (anh chốt 27/11 qua hộp chọn, "Câu chung, không tên, không số"): có người nhận nào
quét bằng tài khoản khác thì chặn cả lần lưu, kể cả khi chỉ vài người sai hay nhiều tài khoản chung một danh sách.
Không nêu tên tài khoản đã quét, không nêu số người; không có nút "Bỏ N người này" / "Dùng tài khoản X", chỉ nút Đóng.

> Danh sách người nhận được quét bằng tài khoản Zalo khác nên tài khoản đang chọn không gửi được. Hãy chọn đúng tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này.

Câu nằm ở `UID_GUARD_MESSAGE` (akaAgentWebApp `packages/control-api/src/campaignUidAccountGuard.ts`, Desktop chép nguyên văn).
Bản đề xuất trước (có tên, số và nút) đã bỏ.

Lúc chạy (dữ liệu V679, không đổi):

| Tình huống | Câu |
|---|---|
| Lúc chạy, từng người (thay câu DAT04 hiện nay "UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được") | Người này nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được |
| Lúc chạy, ghi chú khi chiến dịch dừng (cũng là nội dung thông báo) | Danh sách người nhận được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được. Hãy sửa chiến dịch: chọn lại tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này |

Hai câu lúc chạy là dữ liệu trong DB (`auto_error` id 172, `auto_outcome_policies` id 426), đổi là có hiệu lực ngay
ở Desktop, App Server, Fly, không cần build. Lúc chạy chưa nêu được tên tài khoản đã quét; muốn nêu phải sửa lõi
engine, để sau.

### 4.4 Lúc chạy: giữ người nhận lại

Chỉ đổi dữ liệu chính sách DAT04 (`err_engine_zalo_uid_other_account`), theo đúng mẫu EXC06 của V677:

- Người nhận gặp DAT04 được để riêng (data sang "tạm dừng", `target_effect` `complete` thành `hold` ở dòng chính sách
  426; ba dòng theo thao tác 427–429 thừa hưởng từ dòng này), không tính lượt, cộng chuỗi lỗi. Chiến dịch chạy tiếp người kế; 4 người liền thì tạm dừng chiến dịch như hiện nay.
- Danh sách lẫn vài người sai: các người sai được để riêng, phần còn lại gửi bình thường.
- Trigger mới `trg_aka_agent_uid_account_release` trên `auto_campaigns`, chỉ chạy khi `account_id` đổi: người đang để riêng vì DAT04 mà UID thuộc tài
  khoản mới (theo luật 4.1) được trả về "chờ xử lý"; chiến dịch đã "hoàn thành" thì mở lại như khi Thêm data.
  Có hiệu lực với mọi bản app vì nằm ở DB.
- Không xử lý lại data đã bị đóng trước đây. Bộ chạy cũ không đổi (vẫn "Tham số không hợp lệ", đóng data).

### 4.5 Thông báo "chiến dịch tạm dừng" bật sẵn

Sửa hai hàm của trung tâm thông báo (có kiểm md5 thân production: `aka_agent_notification_capture_campaign`
`28c58b14…`, `aka_agent_notification_seed_defaults` `1af8d8da…`):

- Hàm ghi thông báo: chuyển sang "tạm dừng" do khách tự bấm thì không ghi thông báo. "Tự bấm" = ghi chú trống, chỉ có
  khoảng trắng, "Chờ data phù hợp", "Chờ data mới" (nút Tạm dừng của Nhóm data giữ ghi chú này) hoặc bắt đầu bằng
  "Đang chờ tạm dừng" (Desktop khi đang chạy) (`private.aka_agent_notification_user_pause_note`). Áp dụng cho mọi
  người, gồm 113 người đang tự bật.
- Hàm bật sẵn (chạy mỗi giờ, theo thiết lập mới `notifications.default_campaign_pause`
  `{"audience":"all","batch":1000}`, `off` để dừng): nhân viên đủ điều kiện chưa có dòng "Chiến dịch" được thêm dòng
  `campaign.status_changed` với `toStatuses` = `["tạm dừng"]`, bật đẩy iPhone, bật email khi đã có email nhận
  (cùng luật với Chào ngày mới). Khoảng 2.200 người, xong trong khoảng 3 giờ.
- Người đã có dòng "Chiến dịch" thì giữ nguyên lựa chọn (17 người đang bật mà chỉ chọn Hoàn thành, 2 người đã tắt).
- Nơi nhận: chuông trên Web và Desktop, hộp Trợ lý aka, iPhone, email nếu có. Nội dung: "Chiến dịch đã tạm dừng"
  kèm ghi chú lý do (bộ dựng nội dung của API Web đã làm sẵn). Khách tắt được ở Cài đặt, mục Nhận thông báo.
- Trần sẵn có giữ nguyên: gom 10 phút, 60 lượt đẩy và 20 email mỗi giờ mỗi người.
- Ước lượng: khoảng 3.000 thông báo mỗi tuần toàn hệ thống (0,2 thông báo mỗi người mỗi ngày).

Không đổi giao diện cài đặt, không đổi API, không cần build Desktop cho phần này.

## 5. Kiểm thử

Kiểm thử lặp theo yêu cầu 27/11 ("ít nhất 3 vòng không còn vấn đề"). Một vòng = 5 hạt giống tổng hợp + một cửa sổ dữ
liệu thật mới:

- Tổng hợp: `PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/zalo-uid-account-guard/fuzz-round.cjs --seed N
  [--checks 800] [--pool <mẫu UID / ghi chú thật đã che, ngoài repo>]`. Dựng PG16 cục bộ, nạp
  [fixture.sql](../scripts/zalo-uid-account-guard/fixture.sql) (bảng + hàm production chép nguyên văn 27/11) rồi V679,
  V680; sinh dữ liệu sai lệch có chủ ý (khoảng trắng Unicode, đuôi `_0`, UID trùng chuỗi giữa tài khoản, tài khoản cùng
  nick, tài khoản đã xoá / khác tổ chức, payload sai kiểu, chiến dịch xoá / đang chạy / Nhóm data) và so mọi kết quả với
  mô hình viết độc lập bằng JS. Phủ: mọi chế độ của hàm kiểm, quét từng chiến dịch, quyền theo phiên Desktop, "Bỏ N
  người" rồi đổi tài khoản (trigger trả data, mở lại chiến dịch "hoàn thành"), đổi tài khoản và "Bỏ N người" chạy cùng
  lúc, bật sẵn + ghi thông báo, gỡ rồi apply lại (md5 thân hàm về đúng bản production).
- Dữ liệu thật, chỉ đọc: [realdata-check.sql](../scripts/zalo-uid-account-guard/realdata-check.sql) trên cửa sổ 40.000
  dòng `auto_campaign_details` chọn ngẫu nhiên: lượt gửi thành công phải là "gửi được" hoặc "không rõ", không bao giờ
  "chặn"; DAT04 thật phải bị luật bắt.

Lỗi tìm ra và đã sửa ở vòng 1–2: hàm mới có quyền `anon` / `authenticated` theo quyền mặc định của Supabase; chuẩn hoá
UID bỏ sót khoảng trắng Unicode (`[[:space:]]` ở locale C); payload thiếu khoá / sai kiểu lọt qua kiểm tra NULL; chia
lượt UID bị đếm trùng tài khoản khác; quét chiến dịch lớn chậm (nay một lượt phân loại, trần 5.000 data, chỉ tra tài khoản
khác khi cần); khoảng trắng-only chưa được coi là khách tự bấm Tạm dừng.

| Vòng | Tổng hợp (hạt giống, phép kiểm) | Dữ liệu thật | Kết quả |
|---|---|---|---|
| 3 | 101–105, 5.908 | cửa sổ 17.965.958: 2.336 lượt thành công đều "gửi được" | sạch |
| 4 | 201–205, 6.514 | cửa sổ 18.152.578: 1.556 thành công, 0 "chặn" (40 "không rõ": UID không có ở tài khoản nào); 10 Z114 không bị xếp DAT04 (SĐT nhập vào cột UID) | sạch |
| 5 | 301–305, 5.962 | cửa sổ 14.897.927: 5.033 thành công đều "gửi được"; DAT04 thật 3 ngày 14/14 bị luật bắt | sạch |

Sau khi đổi số V678/V679 thành V679/V680 chạy lại hạt giống 401–403 (3.934 phép kiểm): sạch. Đo trước đó cùng ngày:
3.818 lượt thành công 24 giờ 0 chặn nhầm, DAT04 8 ngày 29/29, ghi chú tạm dừng của engine 30 ngày 390/390 được coi là
hệ thống dừng.

Chưa kiểm: bộ kịch bản engine với chính sách DAT04 mới (data giữ lại, đổi tài khoản thì gửi, không trùng); chạy thật trên
Electron và trên DB thật (V679 chưa apply).

### 5.1 Điểm chặn khi lưu ở API Web và Desktop (code 27/11)

Anh đồng ý 27/11 ("Cho làm tiếp phần chặn khi lưu ở Web và Desktop"), rồi chốt chỉ chặn, một câu chung (mục 4.3). Câu ở một
chỗ: akaAgentWebApp `packages/control-api/src/campaignUidAccountGuard.ts`, Desktop chép nguyên văn
`src/shared/campaignUidAccountGuard.ts` (sửa ở WebApp rồi chép lại). Hộp báo chỉ có nút Đóng.

- API Web (`apps/api/.../campaignUidAccountGuard.ts`, gọi `aka_agent_control_campaign_uid_account_check`):
  - `POST /campaigns/uid-account-check` (chỉ đọc): Web hỏi trước khi lưu, vì Web tạo chiến dịch rỗng rồi mới gửi người nhận theo
    từng lượt 5.000 dòng; chặn ở đường thêm data thì chiến dịch rỗng đã tạo.
  - Kiểm lại ở đường ghi: tạo chiến dịch có người nhận, sửa có đổi tài khoản hoặc thêm người, Thêm data, Tiếp tục (một chiến dịch
    thì trả 400 `campaign_uid_account_mismatch`, câu chung, `details` chỉ có tài khoản / số người để chẩn đoán; nhiều chiến dịch thì
    bỏ qua chiến dịch sai, lý do ở `skippedReasons`). Nhân bản ở máy chủ không kiểm (bản sao tạm dừng, chặn ở lần Tiếp tục).
- Web: form tạo / sửa (`CampaignFormPage`), nút Tiếp tục (`CampaignsPage`), cửa sổ Thêm data; hộp báo ở
  `features/uidAccountGuardPrompt.ts`. iOS bản đang phát hành hiện nguyên câu của API.
- Desktop: IPC `campaign:uid-account-guard` (`check` / `check-resume`, trả `{ blocked, message }`,
  [campaignUidAccountGuardService.ts](../src/main/services/campaignUidAccountGuardService.ts)); hai form (thường + Agent) hỏi trước
  khi lưu, chia người nhận cho từng tài khoản đúng như lúc lưu (`assignments`); nút Tiếp tục và cửa sổ Thêm data hỏi trước.
  Tiến trình chính kiểm lại ở `DB_UPDATE_CAMPAIGN` (đổi tài khoản, Tiếp tục kể cả Tiếp tục hàng loạt) và
  `DB_ADD_CAMPAIGN_INPUT_DATA_ROWS`.
  Dòng data của chiến dịch mới (`createCampaignInputDataBatch`) chỉ được kiểm ở form, không kiểm lại ở tiến trình chính.
- Không kiểm được (DB chưa có V679, lỗi, hết giờ, công tắc `off`): cho lưu như cũ, lúc chạy lưới DAT04 vẫn giữ người sai lại.

Kiểm: WebApp `packages/control-api` `campaignUidAccountGuard.test.ts` (8), API `aka-agent-control.service.test.ts` mục DAT04
(10), Desktop `WEBAPP_REPO=<akaAgentWebApp> node scripts/zalo-uid-account-guard/desktop-guard-smoke.cjs` (11, có so md5 hợp đồng).
Chưa có bài kiểm giao diện cho hộp báo.

## 6. Thứ tự đưa lên và cách gỡ

1. V679 (hàm kiểm, trigger trả data, chính sách và câu DAT04). Có tạo hàm và trigger nên apply buổi tối. Chính sách
   và câu lúc chạy có hiệu lực ngay ở Desktop, App Server, Fly.
2. V680 (hai hàm thông báo), apply buổi tối. Từ lượt chạy hằng giờ kế tiếp hệ thống tự bật sẵn.
3. Deploy API + Web (điểm chặn và hộp thoại).
4. Build Desktop (hai form + tiến trình chính). iOS có hộp thoại đủ nút ở bản phát hành sau.

Số migration: viết là V678 / V679, đổi thành V679 / V680 vì 15:25 VN 27/11 sổ đã có
`migration_v678_notification_email_pacing` (không đụng hai hàm V680 sửa, đã kiểm md5). Kiểm sổ production ngay trước
khi apply; preflight của mỗi bản còn kiểm md5 thân hàm / dòng chính sách nó thay.

Gỡ: chặn khi lưu tắt bằng `campaign.uid_account_guard` = `off`; gỡ hẳn bằng
[rollback_v679](../migrations/rollback_v679_zalo_uid_account_guard.sql) (chính sách DAT04 về `complete`, gỡ trigger và
hàm; người đang giữ vì DAT04 không tự trả về hàng đợi) và
[rollback_v680](../migrations/rollback_v680_notification_campaign_pause_default.sql) (hai hàm về thân cũ, xoá các dòng
do lượt bật sẵn tạo). Sinh lại V680: `python3 scripts/zalo-uid-account-guard/build-v680-sql.py`.

## 7. Còn mở

- Chạy bộ kịch bản engine với chính sách DAT04 mới; thử trên Electron và Web thật sau khi apply V679.
- Apply V679, V680 (chờ anh bảo), rồi deploy API/Web, build Desktop.
