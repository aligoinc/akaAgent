# Engine v2: phủ đủ chiến dịch Zalo

> Bắt đầu 12/11/2026 01:30 VN, theo yêu cầu: "code cho đầy đủ hoàn thiện, phủ Zalo thôi, chưa cần Facebook/Email; hoàn thiện
> là làm xong có thể cho khách dùng luôn". Sau khi code: dựng môi trường thử trên máy bằng dữ liệu thật trong DB, giả lập đủ
> trường hợp, đạt rồi mới deploy production và thử thật.
>
> Production: V501 đã apply 12/11 07:56:08 VN (bước 1, mục 6); V503–V509, V512–V514 apply 12/11 chiều tối (biên nhận trong
> `migrations/snapshots/`). **ChatApi `dev` `6a0db8b` (#137, #138, #139) đã deploy 12/11 23:35–23:45 VN** lên máy CPU riêng
> (api, worker performance-2x 4 GB; zalo_runtime performance-4x 8 GB); biên nhận ở ChatApi `docs/DEPLOY_FLY_IO.md` mục
> 12/11 và `docs/audits/fly-performance-vms-20261112/`. Web v109 (deploy 23:06 VN từ tài khoản khác) đã có WebApp #216.
> Chưa tổ chức nào bật cờ, Desktop chưa phát hành; bật cờ chờ anh bảo.

## Tóm tắt (12/11 ~04:10 VN)

- **Bộ mới chạy được khoảng 96% chiến dịch Zalo của 30 ngày qua** (~7.230/7.531; bảng ở mục 5). Phần còn lại vẫn chạy bộ cũ như hôm nay,
  khách vẫn dùng được: gửi dạng chia sẻ (198), loại trừ gửi (52), huỷ lời mời kết bạn (41), sinh nhật / đề xuất / group thời gian thực (7),
  bạn bè chưa lấy data lần nào (2), danh sách không gửi kiểu cũ (1).
- **Thử bằng dữ liệu thật ở máy** (`replay-all-4`): 87/95 chiến dịch mẫu chạy bộ mới, 5.928 dòng lịch sử khớp bộ cũ; mọi dòng khác đều đã
  giải thích (mục 5).
- **Kiểm:** 15/15 bước của `campaign-outcome-engine-check-all.cjs`; hai typecheck akaAgent; ChatApi `npm run verify` (184 file, 2.611 test).
- **Đọc độc lập V501** (một agent không xem kết luận của em): không có lỗi lớn; 6 điểm nhỏ, quan trọng nhất là vòng chống gửi lặp có thể vượt
  trần 3 giây của Desktop. Đã sửa hết và thêm ca kiểm (mục 8); V501 nay md5 `94e309b5…`.
- **Production:** V501 đã apply 07:56:08 VN. Hàm chỉ được thêm, chưa có gì gọi tới, vì ChatApi chưa có bản phủ và không tổ chức nào
  bật cờ. Các bước còn lại ở mục 6, các điểm cần anh quyết ở mục 7.
- **Cập nhật 12/11 ~09:50 VN:** đã phủ thêm gửi dạng chia sẻ (V503), loại trừ gửi và danh sách không gửi kiểu cũ (V504), cả Desktop và Fly;
  V503 / V504 chưa apply. Còn lại: huỷ lời mời kết bạn (41), sinh nhật / đề xuất / group thời gian thực (7), bạn bè chưa lấy data lần nào
  (2): đều cần lấy data đầu lượt / theo sự kiện. Chi tiết ở mục 4 (08:30–09:50).
- **Cập nhật 12/11 ~10:50 VN:** đã phủ thêm lấy data đầu lượt (V505): huỷ lời mời kết bạn, sinh nhật, đề xuất Zalo, bạn bè "toàn bộ /
  theo tag" (cả gửi thường lẫn gửi dạng chia sẻ), Desktop và Fly; V505 chưa apply. Còn chạy bộ cũ: group thời gian thực (1 chiến dịch 30
  ngày) và chiến dịch theo SĐT bật kiêm SMS (1). Chi tiết ở mục 4 (10:00–10:50). Danh sách chính sách hiện tại xếp theo hành vi:
  [CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md](CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md).
- **Cập nhật 12/11 ~11:10 VN:** đã phủ nốt group thời gian thực và kiêm gửi SMS (V506), Desktop và Fly; V506 chưa apply. Cả 11 loại chiến
  dịch Zalo và mọi tính năng khách dùng 30 ngày qua nay chạy bộ mới. Còn chạy bộ cũ: trên Fly, chiến dịch chỉ bật kiêm **akaBiz** Sms
  (Fly không có tích hợp akaBiz; bộ cũ của Fly cũng không kiêm; 0 chiến dịch Server 30 ngày); khi bật lại theo dõi tương tác Zalo (đang
  tắt từ 06/10); cấu hình sai mà bộ cũ báo lỗi riêng. Chi tiết ở mục 4 (10:55–11:10).
- **Cập nhật 12/11 ~11:30 VN: thử bằng dữ liệu thật cho phần phủ sau (V503–V506) đạt.** Hai mẫu, 145 chiến dịch chạy bộ mới: 7.923 dòng
  khớp bộ cũ. Mọi dòng khác đều đã giải thích: theo quyết định anh đã duyệt, do phát lại dồn thời gian, hoặc bộ mới đúng chuẩn Desktop hơn
  bộ cũ. Kiêm SMS không có dữ liệu thật (không chiến dịch nào đang bật); loại trừ gửi không phát lại được. Chi tiết ở mục 4 (11:10–11:30).
- **Cập nhật 12/11 ~13:55 VN** (đã thay lúc 15:20): câu lịch sử khi bỏ qua vì nhớ mục tiêu nói rõ lý do, hạn và mã. Chi tiết ở mục 4
  (13:20–13:55).
- **Cập nhật 12/11 ~14:05 VN: đổi số chuỗi engine** từ V502–V506 thành **V503–V507**, nhường V502 cho nhánh `claude/fervent-gates-c8ldgw`
  (`migration_v502_campaign_limit_progress.sql`, mục 7): V502 → V503 gửi dạng chia sẻ, V503 → V504 loại trừ gửi, V504 → V505 lấy data đầu
  lượt, V505 → V506 group thời gian thực + kiêm SMS, V506 → V507 câu bỏ qua. Chưa apply bản nào. Cả tài liệu này đã dùng số mới, kể cả phần
  ghi trước lúc đổi. Kiểm sau khi đổi: `campaign-outcome-engine-check-all.cjs` 21/21, Fly 16/16, ChatApi `npm run verify` 184 file / 2.619
  test đạt (2 bỏ qua), bản chép sang ChatApi khớp nguồn 56 file, mẫu dữ liệu thật 30 ngày ra giống hệt lần trước (chỉ khác giờ hạn nhớ).
- **Cập nhật 12/11 ~15:20 VN: bỏ hẳn nhớ mục tiêu theo tài khoản** (anh chốt). V507 nay là bản xoá: bỏ đoạn tra / ghi nhớ trong
  `claim_target_v1`, `report_v1`, trường trong `resolve_policy`, xoá bảng `auto_target_memory`, cột `remember_target_days`, dòng cổng
  `target_memory`. Chưa apply (apply cùng chuỗi, sau V506). Bộ mới khi đó gửi lại mục tiêu đã hỏng như bộ cũ. **Kiểm "số không tồn tại" trên
  toàn hệ thống: tạm hoãn**; số đo và phương án giữ ở mục 4 (14:20–15:20).
- **Cập nhật 12/11 ~16:40 VN: V508, 126/127 khi nhắn group** (anh chốt "Chỉ 126/127"): coi là group chặn riêng tài khoản, không phải
  tài khoản bị hãm tốc. Chỉ sửa dữ liệu một dòng chính sách: data hoàn thành ("thất bại"), không tính lượt, không đếm chuỗi, không khoá, không
  tạm dừng, chạy tiếp group sau. 112 giữ nguyên. Không phụ thuộc V503–V507. Chi tiết, số đo và câu Zalo trả ở mục 4 (15:30–16:40).
- **Cập nhật 12/11 16:48–16:50 VN: đã apply V503 → V508 lên akachat** (anh: "Apply ngay"), từng bản theo thứ tự, mỗi bản kiểm sổ và thân hàm
  trước bản kế tiếp: `20261112094818` V503, `094850` V504, `094917` V505, `094927` V506, `095000` V507, `095022` V508; md5 sổ = file; 0 lỗi
  5xx/503; không apply lại. Không tổ chức nào bật cờ, ChatApi vẫn chạy dev không có v2 ⇒ production chưa đổi hành vi. Biên nhận:
  `migrations/snapshots/engine-coverage-v503-v508/apply-receipt.json`. Chi tiết ở mục 6.

## 1. Hiện trạng lúc bắt đầu (đo 12/11/2026 01:30 VN)

11 loại chiến dịch Zalo. Bảng dưới là số chiến dịch có chạy trong 30 ngày.

| Loại | Chiến dịch | Tổ chức | Server | Zalo Web | QR |
|---|---|---|---|---|---|
| `zalo_message_phone` | 6.073 | 710 | 3.328 | 762 | 1.983 |
| `zalo_message_group_member` | 843 | 192 | 485 | 190 | 168 |
| `zalo_message_friend` | 289 | 72 | 149 | 76 | 64 |
| `zalo_message_group` | 226 | 27 | 203 | 11 | 12 |
| `zalo_cancel_sent_friend_request` | 41 | 13 | | | |
| `zalo_add_group_member` | 37 | 17 | | | |
| `zalo_message_remarketing_customer` | 9 | 5 | | | |
| `zalo_join_group_link` | 7 | 4 | | | |
| đề xuất Zalo | 3 | 2 | | | |
| `zalo_message_birthday` | 3 | 3 | | | |
| `zalo_message_group_realtime` | 1 | 1 | | | |

**Lõi hiện chỉ chạy được "Nhắn tin theo SĐT" chỉ chữ: 5/6.073 chiến dịch.** Số chiến dịch dùng từng tính năng chặn bộ mới
(trên 6.073 chiến dịch "Nhắn tin theo SĐT"):

| Tính năng | Chiến dịch |
|---|---|
| gắn tag / đổi tên | 4.423 |
| ảnh / tệp | 4.073 |
| chống gửi lặp | 3.388 |
| nội dung định dạng | 1.172 |
| nội dung nâng cao | 410 |
| AI viết lại | 297 |
| tag akaBiz | 218 |
| nhóm data | 88 |
| link từ chối | 49 |

## 2. Cách làm

- **Chuẩn hành vi vẫn là bộ chạy Desktop/VPS** (`campaignScheduler.ts`; 24 commit mới của `dev_3` ngày 11/11 không đổi bộ chạy).
- **Đặc tả trước, code sau.** Mỗi mảng có một bản đặc tả đọc từ code hiện tại, có số dòng và câu cho khách nguyên văn, ở
  [docs/engine-v2-specs/](engine-v2-specs/):
  - `zalo-media.md`;
  - `zalo-aux-actions.md`;
  - `zalo-gates-content.md`;
  - `zalo-scheduling-completion.md`;
  - `zalo-other-types.md`.
- **Thứ tự theo mức dùng.**
  1. `zalo_message_phone` đủ tính năng: thao tác phụ, media, chống gửi lặp, loại trừ gửi, nội dung định dạng/nâng cao, link từ chối, tag akaBiz, AI, nhóm data, lịch/khung giờ.
  2. `zalo_message_group_member`, `zalo_message_remarketing_customer` (cùng mô hình người lạ, khác nguồn data).
  3. `zalo_message_friend`, `zalo_message_group`, `zalo_message_birthday` (gửi bạn bè/group, có gửi dạng chia sẻ).
  4. Các loại nhỏ: huỷ lời mời, thêm thành viên group, vào group bằng link, đề xuất Zalo, group theo thời gian thực.
- **Mỗi tính năng đi đủ ba chỗ cùng lúc:**
  - bước trong lõi;
  - hàm cổng Desktop (`zaloRuntimeService` + RPC hiện có);
  - hàm cổng Fly (lệnh runtime + repository hiện có).

  Không có hành vi riêng của một nơi.
- **DB:** chính sách cho thao tác mới theo bảng anh đã duyệt (V500); trạng thái mới của V494 vẫn để tắt.
- **Cổng chưa tách vẫn chạy bộ cũ.** `zaloMessagePhoneV2Support` (và hàm tương ứng của từng loại) trả lý do; một tính năng chỉ được bỏ khỏi danh sách chặn khi đã đạt môi trường thử.

## 3. Môi trường thử bằng dữ liệu thật

1. **Chép mẫu, chỉ đọc:** `scripts/engine-v2-realdata/export-snapshot.cjs <thư mục> [ngày]`.
   - Lấy chiến dịch Zalo chạy trong N ngày. Chọn cố định theo băm id; mỗi loại tối đa 40/20/12/12/8 chiến dịch, mỗi chiến dịch tối đa 60 data có lịch sử.
   - Kèm lịch sử, tài khoản (bỏ cột phiên, mật khẩu, thiết bị), khoá thao tác, nhóm tài khoản, gói, cờ tổ chức.
   - File nằm ở thư mục tạm của phiên, không đưa vào repo.
   - Lần đầu 12/11 01:4x VN: 104 chiến dịch, 4.691 data, 19.513 dòng lịch sử, 96 tài khoản, 79 tổ chức.
   - `--focus` (12/11): chỉ các tính năng phủ sau (chia sẻ, huỷ lời mời, sinh nhật, đề xuất, thời gian thực, bạn bè "toàn bộ / theo tag",
     kiêm SMS), cửa sổ tới 30 ngày; mỗi chiến dịch chỉ đọc 400 dòng lịch sử mới nhất, giữ dòng mới nhất mỗi thao tác của mỗi data.
2. **Dựng DB:**
   - Postgres 17 cục bộ từ ảnh chụp schema/danh mục (`scripts/fixtures/campaign-outcome-engine/`);
   - apply V495, V499, V500 đúng file đã apply production;
   - đối chiếu md5 bảng chính sách với production;
   - nạp dữ liệu thật vào các bảng cùng tên.
3. **Phát lại:**
   - Mỗi data chạy lại bằng lõi mới, cổng Zalo giả trả đúng kết quả Zalo đã trả trong lịch sử (tra số ra gì, nhắn tin mã gì…).
   - So lịch sử, trạng thái data và chiến dịch mà bộ mới ghi với lịch sử bộ cũ đã ghi.
   - Khác nhau chỉ được phép ở các điểm anh đã duyệt (Q1–Q8); còn lại là lỗi.
4. **Ca tiêm thêm:** lỗi mạng, hết giờ, tắt app giữa lúc gửi, DB sập, qua 0 giờ, chạm hạn mức, khoá thao tác, media một phần, nhiều khung giờ, gửi lặp lại.

## 4. Tiến độ

Cập nhật ở cuối file trong lúc làm.

### 12/11 02:10 VN: môi trường thử bằng dữ liệu thật chạy được

- `scripts/engine-v2-realdata/replay.cjs <snapshot> [--types …] [--out …]` (loại chiến dịch đăng ký ở `replay-types.cjs`):
  - PG17 cục bộ: ảnh chụp schema 06/11 + V495/V499/V500 + dữ liệu thật;
  - lịch sử bộ cũ nạp vào bảng riêng `replay_history`, không vào `auto_campaign_details`;
  - hạn mức: giữ theo ngày, bỏ theo khung giờ (chỉ ở DB thử).
- Lần chạy đầu, "Nhắn tin theo SĐT", 9/40 chiến dịch chỉ dùng tính năng lõi đã có, 493 data:
  - 759 dòng kết quả khớp (thao tác, trạng thái, mã lỗi, tính hạn mức).
  - Khác nhưng đúng bảng đã duyệt:
    - 72 dòng người nhận chặn (122/119) nay tính lượt (Q2);
    - 3 dòng tra số ra 210 nay tính lượt tra số.
  - Khác do cách phát lại: 22 dòng kết bạn/nhắn tin có ở một bên.
    - Phát lại dồn 3 ngày vào một lượt nên hạn mức ngày bị cộng dồn.
    - Thứ tự data khác nhau. Ví dụ chiến dịch 53445 giới hạn 15 lời mời/ngày: hai bên mỗi bên gửi đúng 15 nhưng cho hai nhóm data khác nhau.
  - Câu lịch sử: bộ mới thêm mã ngắn ở cuối ("Không tồn tại (Z216)"), đúng thiết kế (mục tiêu ban đầu: ghi tiến trình kèm mã lỗi).

### 12/11 01:50 VN: mô phỏng chính sách trên toàn bộ lịch sử thật của 11 loại

- `scripts/engine-v2-realdata/simulate-policies.cjs <snapshot>`: mỗi dòng lịch sử thật được đổi thành kết quả thô đúng như cổng Zalo trả, rồi hỏi DB (`aka_agent_engine_simulate_v1`, V495+V499+V500) sẽ quyết định gì, và so với quyết định bộ cũ đã ghi.
  - Không cần lõi đã phủ loại đó.
  - Mã thô: Desktop/VPS ghi ở `data.zalo.code`, bộ cũ của Fly ghi ở `data.rawCode`.
- Kết quả trên 19.513 dòng (104 chiến dịch, 9 loại có chạy trong 3 ngày): khớp, hoặc khác đúng bảng đã duyệt (tính lượt khi người nhận chặn, kết bạn hỏng không tính, 127/126 do tài khoản thì chờ + khoá + tạm dừng sau 3 lần, lỗi mạng giữa lúc gửi thành UNK01), trừ:
  - **Lỗ hổng: vào group bằng link, Zalo trả 240 (chờ duyệt).**
    - Desktop coi là thành công ("Đã gửi yêu cầu tham gia group …, đang chờ duyệt").
    - V500 chỉ có luật 240 cho thêm thành viên vào group, nên bộ mới sẽ ghi Z999 và tăng chuỗi lỗi.
    - Sửa ở V501: luật 240 cho `zalo_join_group_link`.
  - **Cần anh lưu ý:** nhắn group, 126/127 có 510 dòng trong 3 ngày của 12 chiến dịch mẫu.
    - Bảng đã duyệt xếp là do tài khoản: chờ, khoá 30 phút, 3 lần liền thì tạm dừng.
    - Bộ cũ ghi thất bại rồi đi tiếp.
    - Đo lại 12/11 04:2x VN: cả 510 dòng thuộc chiến dịch gửi dạng chia sẻ (chưa phủ); group gửi thường 30 ngày chỉ 31 lượt 127 (mục 7).

### 12/11 ~02:20 VN: thao tác phụ xong (gắn tag Zalo, đổi tên gợi nhớ, tag akaBiz)

Theo đặc tả `docs/engine-v2-specs/zalo-aux-actions.md`.

**Lõi**
- `zalo/auxiliary.ts`: tag và đổi tên chạy sau gửi, kể cả khi gửi lỗi.
  - Không tính lượt, không vào kế hoạch claim, đúng như Desktop.
  - Trạng thái bạn bè dùng chung một lần cho mỗi data.
  - Tag akaBiz là cổng luôn cho qua, chạy trước khi nhắn, chỉ in dòng tiến trình.
- `content/zaloAuxiliaryActions.ts` chép nguyên văn `src/shared`, có trong kiểm ranh giới.
- `runUnit`:
  - kết quả `noOutcome` (bỏ qua im lặng, không báo DB);
  - móc `onTargetEnd` (dọn tài nguyên theo data).

**Cổng**
- Desktop: `getFriendRequestStatus`, `applyLabelToUser` với một ngữ cảnh tag mỗi data, `appendZaloTagsToExistingContacts`, `changeUserAlias`, `applyAkaBizTagsToContactTargets`.
- Fly: lệnh `get_friend_request_status`, `apply_label`, `change_friend_display_name`; `appendZaloTagToExistingContact`, `applyAkaBizTags`.

**Thay đổi đã duyệt**
- Cắt tên gợi nhớ còn tối đa 50 ký tự. Trước đây quá 50 ký tự thì Zalo trả 112, khoảng 3,9 nghìn lượt lỗi mỗi 14 ngày.

**Kiểm**
- Smoke lõi 28/28 (thêm 4 nhóm thao tác phụ).
- Phát lại dữ liệu thật "Nhắn tin theo SĐT": 573 data, 968 dòng khớp, mọi dòng tag và đổi tên khớp.
- Typecheck Desktop và ChatApi đạt.

### 12/11 ~02:30 VN: V501 lịch chạy, thử lại data, kết thúc lượt (chưa apply)

Theo đặc tả `docs/engine-v2-specs/zalo-scheduling-completion.md` mục 8. Đây là lỗi phải sửa trước khi cho khách dùng, nên làm trước phần phủ tính năng.

**SQL** (`scripts/build-v501-sql.cjs` → `migrations/migration_v501_engine_schedule_completion.sql`, kèm rollback)
- Sửa tại chỗ `claim_target_v1`, `report_v1` (preflight khoá md5 thân V499 đã đọc production 12/11), thêm `finish_campaign_v2`.
- Claim:
  - tài khoản tạm dừng → `account_paused`;
  - quyền gói Zalo như claim của bản cũ → `entitlement_denied`;
  - giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời → `concurrency_limit`;
  - chiến dịch đang nạp data ban đầu → `campaign_not_ready`;
  - lịch ngày cũ chưa qua bảo trì → `maintenance_required` (trừ hằng ngày không chạy tiếp hôm sau, như bản cũ);
  - Nhóm data hết hạn → `data_group_hard_end`;
  - mỗi data chỉ thử một lần trong một lượt (data về hàng đợi không chặn cả danh sách);
  - chờ khoá/hạn mức **không dời lịch chiến dịch** (dời sang ngày sau làm thoát bảo trì lịch, chạy 00:00, đổi giờ gốc khi `original_schedule` rỗng);
  - xoá ghi chú khi bắt đầu chạy; lease nhớ lịch lúc bắt đầu lượt (khung giờ hiện tại).
- Report: bỏ "về hàng đợi thì kết thúc lượt"; không ghi đè tạm dừng của người dùng; hoãn theo phút không vượt giờ dừng.
- `finish_campaign_v2`: đúng thứ tự Desktop (hẹn theo data tương lai, Nhóm data/thời gian thực không tự hoàn thành, hết ngày kết thúc,
  nhiều khung giờ, gửi lặp lại, còn data chờ → chưa hoàn thành).

**Lõi và nơi chạy**
- Lõi: trạng thái claim mới; câu kết thúc lượt đúng câu Desktop (`finishProgress`), câu ⏹ giờ dừng, ⏸ tạm dừng, ⚠️ tài khoản bị dừng;
  tạm dừng trong lúc nghỉ giữa 2 data có hiệu lực ngay (kiểm mỗi 500 ms).
- Bảng loại chiến dịch chặn chung: Nhóm data, nhóm theo thời gian thực, gửi dạng chia sẻ.
- Desktop: `maintenance_required` → chạy lại bảo trì lịch rồi thử lại một lần; `wait` → nhớ tới `until` (tối đa 5 phút);
  `concurrency_limit` → câu chờ như bản cũ rồi nhường hàng đợi; `finish_campaign_v2`.
- Fly: `maintenance_required` → làm lại bảo trì của chủ chiến dịch; `wait` hoãn tới `until` (tối đa 5 phút); còn data chờ thì lượt sau
  cách 30 giây; `finish_campaign_v2`.

**Kiểm**
- `node scripts/campaign-outcome-engine-v501-smoke.cjs`: 12/12 nhóm (apply/rollback/apply lại, mọi nhánh claim và kết thúc lượt,
  nhiều khung giờ, gửi lặp lại).
- Phát lại dữ liệu thật với V501: 573 data, 968 dòng khớp, 104 dòng khác đều thuộc quyết định đã duyệt (như trước V501).
- ChatApi: fixture test apply đủ V495 → V499 → V500 → V501; test engine + scheduler 179/179; typecheck đạt.
- Desktop: hai typecheck đạt; smoke lõi 28/28.

### 12/11 ~02:45 VN: gửi tệp/album và chống gửi lặp N ngày cho "Nhắn tin theo SĐT"

**Gửi tệp** (đặc tả `zalo-media.md`, nội dung cơ bản; nội dung định dạng/nâng cao vẫn chạy bộ cũ)
- Lõi `zalo/media.ts`: chọn tệp như Desktop (`imageOption` all/none/random, bốc lại mỗi lần gửi), thứ tự gửi như `dispatchZaloMessage`
  (≥ 2 tệp: album rồi chữ; 1 tệp: một lần, chữ làm chú thích; không chữ: chỉ tệp), mã hàng rào media chung hai nơi.
- Gửi lần hai lỗi sau khi lần đầu đã tới: giao một phần, dòng "thất bại" kèm tiền tố của Desktop ("Đã gửi file nhưng gửi nội dung
  thất bại. …"), tính lượt, không đổi chuỗi data lỗi (trừ media quá giờ), không gửi lại, không in "✅ Hoàn thành" (V501 report).
- Media quá giờ / phiên dừng giữa chừng: không rõ đã tới (UNK01), không gửi lại.
- Không dùng được tệp: CFG01 trên cả hai nơi chạy (đã duyệt; Desktop cũ ghi lỗi từng data). Zalo Web gửi tệp không phải ảnh: CFG10
  kiểm một lần đầu lượt.
- Desktop: hàm tải tệp tách ra `src/main/services/campaignMediaSource.ts`, bộ lập lịch cũ gọi lại cùng module (một bản); tệp tải tạm
  xoá khi data xong; hạn giờ bước gửi = 60 giây/tệp + 330 giây.
- Fly: `send_campaign_media` (chỉ URL http(s), tối đa 10 tệp như bộ chạy cũ), khoá lệnh theo thứ tự gửi.

**Chống gửi lặp N ngày** (đặc tả `zalo-gates-content.md` §2)
- Trong claim (V501): gọi đúng RPC của bộ cũ `aka_agent_apply_campaign_delivery_cooldown` cho data sắp nhận, khi data còn "chờ xử lý"
  (như Desktop gọi trước bước tra số). Data đã gửi gần đây bị RPC tạm dừng; lõi in `⏸️ Bỏ qua "<SĐT - tên>": <câu>`; không lịch sử,
  không lượt, không nghỉ. Không kiểm được: chiến dịch chờ kèm ghi chú như Desktop, tự thử lại (cổng mở/đóng khi lỗi chỉnh trong DB).

**Kiểm**
- `node scripts/campaign-outcome-engine-media-smoke.cjs` 9/9; `campaign-outcome-engine-v501-smoke.cjs` 13/13; smoke lõi 28/28.
- Phát lại dữ liệu thật: 28/40 chiến dịch mẫu chạy bằng bộ mới (trước 11), 2.741 dòng khớp. Dòng khác: hạn mức theo bảng đã duyệt (Q2),
  UNK01 (Q3), và do phát lại dồn thời gian (khoá 30 phút sau 127 theo Q4, hạn mức đã bị chiến dịch khác dùng).
- ChatApi: typecheck; test engine + scheduler 180/180 (thêm test tệp của cổng Fly).
- Còn chạy bộ cũ trong mẫu: nội dung định dạng (6), nội dung nâng cao (4), AI viết lại (2).

### 12/11 ~03:00 VN: nội dung định dạng, nội dung nâng cao, AI viết lại ("Nhắn tin theo SĐT")

- **Nội dung định dạng**: `src/shared/formattedContent.ts` và bộ đổi HTML → `{ msg, styles }` (`src/shared/zaloFormattedContent.ts`, tách khỏi
  zca-js) chép nguyên văn vào lõi (script ranh giới kiểm bản chép). `src/main/services/zaloFormattedContent.ts` gọi lại bản dùng chung;
  đối chiếu 26 nội dung định dạng thật + 5 mẫu tổng hợp: kết quả giống hệt bản cũ. Dựng mẫu theo từng đoạn chữ của HTML, xoay biến thể
  theo dấu `|` cấp ngoài; 1 tệp + chữ có định dạng: chữ trước rồi tệp (như Desktop).
- **Nội dung nâng cao**: mỗi mục là một biến thể kèm tệp riêng, xoay cùng vị trí; mục rỗng / không có mục: CFG16 (tạm dừng chiến dịch một
  lần, data về hàng đợi) thay cho lỗi từng data của bản cũ.
- **AI viết lại** (`rewriteContentEachRun`, chữ thường): Desktop gọi cùng mã AI qua proxy AI; Fly dùng `CampaignAiRewriter` của bộ chạy cũ.
  Lỗi / quá 300 giây: dòng `⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: <lý do>` rồi gửi nội dung gốc; hạn giờ bước cộng thêm 300 giây.
- Kiểm: `campaign-outcome-engine-media-smoke.cjs` 13/13 (thêm M9–M16), phát lại "theo SĐT" 40/40 chiến dịch mẫu chạy bộ mới.
- Lỗi tìm được khi phát lại (chiến dịch 48186): sau album, chữ bị 127 (giao một phần) làm chiến dịch tạm dừng ngay. Sửa trong V501 report:
  giao một phần không áp hiệu ứng chiến dịch của chính sách có ngưỡng chuỗi lỗi; thêm ca M16.

### 12/11 ~03:45 VN: thành viên nhóm, khách cũ, bạn bè, group (gửi thường)

**Lõi** (`packages/campaign-engine/src/zalo/messagePhone.ts`, bảng loại `registry.ts`): cùng bộ bước với "Nhắn tin theo SĐT", khác phần
xác định người nhận và thao tác nhắn tin.

| Loại | Các bước (như workflow Desktop) | Thao tác nhắn tin |
|---|---|---|
| `zalo_message_group_member` (272), `zalo_message_remarketing_customer` (274) | đọc hồ sơ theo UID → từ chối nhận tin → lưu danh bạ → tag akaBiz → nhắn tin → kết bạn → tag Zalo → đổi tên | `zalo_message_stranger` |
| `zalo_message_friend` (266) | đọc hồ sơ theo UID → từ chối nhận tin → lưu danh bạ → tag akaBiz → nhắn tin → tag Zalo → đổi tên | `zalo_message_friend` |
| `zalo_message_group` (268) | ID group của data → nhắn tin vào nhóm → tag akaBiz loại group khi gửi được | `zalo_message_group` |

- Đọc hồ sơ theo UID như `preflightZaloMessageOptOut` + `resolveZaloFriendMessageTarget`: lỗi đọc thì giữ mục tiêu từ data, cổng in
  `Không lấy được Zalo global ID…`. Lưu danh bạ chỉ khi có hồ sơ, sau cổng từ chối nhận tin (bị chặn thì không lưu, như Desktop chặn
  trước khi nhận data). Lỗi ghi danh bạ không đổi kết quả (F1).
- Thiếu UID / ID group: DAT01 của đúng thao tác, câu riêng từng loại (`UID thành viên group Zalo không hợp lệ`, `UID khách hàng cũ Zalo
  không hợp lệ`, `UID bạn bè Zalo không hợp lệ`, `ID group Zalo không hợp lệ`).
- Nhãn data: tên → UID → SĐT. Group: không đọc hồ sơ, không từ chối nhận tin / loại trừ / link từ chối / theo dõi tương tác / SMS, không
  tag Zalo / đổi tên dù cờ còn trong cấu hình (workflow 268 không có hai bước này; bộ cũ của Fly có chạy).
- Vẫn chạy bộ cũ: gửi dạng chia sẻ (bạn bè, group), Nhóm data, link từ chối, loại trừ gửi có cấu hình, kiêm SMS (thành viên nhóm),
  bạn bè "toàn bộ / theo tag" chưa lấy data lần nào, danh sách không gửi tin kiểu cũ của bạn bè.
- Bạn bè "toàn bộ / theo tag" đã lấy data mà không có dòng nào: `finish_campaign_v2` giữ "chờ xử lý" kèm ghi chú
  `Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy` như Desktop (V501, lý do `friend_auto_no_data`); không in lại
  dòng ⚠️ khi ghi chú không đổi.

**Cổng**
- Desktop: `getUserProfile` (`zaloRuntimeService.getUserProfile`), `saveResolvedProfile` (`upsertZaloResolvedProfileTarget`), gửi chữ / tệp
  vào nhóm (`sendMessageToGroup`, ID giữ nguyên như Desktop gửi thường).
- Fly: lệnh `get_user_profile` (bước `resolve_user`, như bộ chạy cũ), lưu danh bạ như `persistResolvedUserTarget`, `send_text` /
  `send_campaign_media` với `threadType: 'group'` (bỏ tiền tố `g` như bộ chạy cũ của Fly; dữ liệu mẫu không có ID dạng `g…`: 0/253).

**Lỗi tìm được và đã sửa**
- `runUnit` không gửi `requireAny` xuống claim: khi "tiếp tục khi chạm giới hạn" và mọi thao tác gửi đã hết lượt, DB vẫn nhận data. Với loại
  theo UID (không có thao tác bắt buộc) data bị đóng SYS07 và chiến dịch bị tạm dừng sau 4 data; với "theo SĐT" lõi tra số thừa. Đã sửa;
  ca hồi quy U8. Phát lại "theo SĐT" sau sửa: data hết lượt nằm lại "chờ xử lý" như Desktop.

**Kiểm**
- `node scripts/campaign-outcome-engine-uid-smoke.cjs` 14/14 (PG17 + V495→V501, lõi thật, cổng giả).
- Smoke lõi 28/28, media 13/13, V501 13/13; ChatApi typecheck, test 708/708 (thêm test lệnh `get_user_profile`).
- Phát lại dữ liệu thật đủ 5 loại (`replay-all-2`): 76/86 chiến dịch mẫu chạy bộ mới (thành viên nhóm 17/20, khách cũ 2/2, bạn bè 9/12,
  group 8/12, SĐT 40/40); 5.427 dòng khớp. 1.753 dòng khác: 972 là data chưa chạy tới vì phát lại dồn thời gian (khoá 127, hết lượt ngày);
  còn lại thuộc Q2 (122/119/210 tính lượt, kết bạn lỗi không tính), Q3 (UNK01), cắt tên gợi nhớ, hoặc do DB thử tắt hạn mức theo giờ
  (bộ cũ bỏ kết bạn/nhắn tin khi chạm 9 lượt/65 phút; đối chiếu lịch sử: đúng 9 lời mời mỗi 65 phút). Câu lịch sử chỉ khác ở mã ngắn cuối
  câu và dấu chấm cuối câu của bộ cũ Fly.

### 12/11 ~03:50 VN: thêm thành viên vào group, vào group bằng link, Nhóm data

**Thêm thành viên vào group** (`zalo/addGroupMember.ts`, workflow từ migration_v160)
- Data có UID: đọc hồ sơ + lưu danh bạ (không tag akaBiz). Data chỉ có SĐT: bước "Tìm SĐT" dùng chung với loại SĐT rồi tag akaBiz.
  Không UID không SĐT: DAT01 `Data cần có SĐT hoặc UID Zalo`.
- "Tìm SĐT" là thao tác không bắt buộc trong claim (35/37 chiến dịch 30 ngày chỉ có UID, không bị chặn oan khi tra số đang khoá). Data chỉ có SĐT
  gặp khoá / hết lượt tra số: không ghi lịch sử, data về hàng đợi, dừng lượt, như Desktop kiểm lúc chạy. Lõi: `EngineStep.onGateWait 'requeue'`
  → tín hiệu engine `action_waiting`; V501 thêm luật đưa tín hiệu này về chính sách sẵn có `err_engine_gate_unavailable`.
- Kết quả như `zaloAddGroupMember`: đã là thành viên (`đã là thành viên`, không tính lượt), gửi link group, thêm / mời; group đích bỏ tiền tố `g`.
  Chưa chọn group (0/37 chiến dịch): vẫn chạy bộ cũ.
- Fly: lệnh `add_group_member`; runtime trả danh sách theo nhóm, cổng đổi ra kết quả một người như Desktop. **Khác Desktop:** nhóm cộng đồng lỗi và
  gửi link lỗi mất mã Zalo (runtime gom vào `errorMembers`), ghi thành lỗi không mã; muốn giữ mã phải sửa runtime (deploy `zalo_runtime`).
  **Đã sửa ở ChatApi 12/11 ~18:00, chưa deploy** (mục 4, 17:50–18:10).

**Vào group bằng link** (`zalo/joinGroupLink.ts`, workflow từ migration_v133): link ở cột uid, chuẩn hoá như Desktop (`zalo.me/g/…`,
`zaloapp.com/qr/g/…`); link sai → DAT01 không gọi Zalo; đã tham gia (178) → `đã tham gia`, không tính lượt; chờ duyệt (240); lưu danh bạ group.
Fly: lệnh `join_group_link`, tên group lấy `group.name`. Lỗi ghi danh bạ không đổi kết quả tham gia (bản cũ ghi thành lỗi).

**Nhóm data** (151 chiến dịch 30 ngày; trước chạy bộ cũ ở mọi loại)
- Claim (V501): bắt đầu lượt mà không có data đến hạn / đang chạy → `data_group_waiting`, không giữ chỗ tài khoản, không ghi gì (như claim
  bản cũ v397). Hết hạn → gọi hàm kết thúc Nhóm data của bản cũ với câu `Chiến dịch đã hết thời hạn nhận và chạy data mới` (dừng nguồn, đóng
  data chờ, hoàn thành); lõi in `⏹ …` khi đã hoàn thành.
- `finish_campaign_v2`: hết data giữa lượt → `aka_agent_internal_finalize_data_group_campaign_v219` (cùng lõi với bản Desktop và bản Zalo
  Server; lease của lượt là bằng chứng sở hữu): nguồn đang nhận → "Chờ data mới" + `⏳ Chiến dịch "…" đang chờ data mới từ Nhóm data`; nguồn
  dừng / hết hạn → hoàn thành. Hàm chưa có (DB thử) thì không tự hoàn thành như trước.
- Kiểm bằng **nguyên văn hàm của production** (đọc chỉ đọc 12/11, md5 thân `7786668c…`, lưu ở
  `scripts/fixtures/campaign-outcome-engine/data-group-finalizer-v219.sql`).

**Lỗi tìm được và đã sửa trong đợt này**
- Smoke bộ chạy Desktop dựng DB chưa có V501 nên `finish_campaign_v2` không tồn tại; và còn kỳ vọng kết quả trước V500 (lỗi mạng khi gửi nay là
  UNK01 theo Q3). Đã sửa; thêm ca D6 chạy 5 loại mới qua cổng Desktop thật.
- Loại group: hàm hỗ trợ trả "được" trước khi xét gửi dạng chia sẻ (đường chạy thật vẫn chặn nhờ bộ kiểm chung, đã sửa cả hai).

**Kiểm**
- `node scripts/campaign-outcome-engine-check-all.cjs`: 15/15 bước (V501 15 nhóm, lõi 28, media 13, loại theo UID / bạn bè / group / thêm thành viên /
  vào group 19, bộ chạy Desktop 7, …).
- ChatApi: typecheck; test 711/711 (thêm test lệnh thêm thành viên, vào group, chạy bộ chạy Fly cho 4 loại mới).
- Phát lại dữ liệu thật 7 loại (`replay-all-3`): **86/95 chiến dịch mẫu chạy bộ mới** (còn 7 gửi dạng chia sẻ, 1 loại trừ gửi, 1 link từ
  chối); 5.873 dòng khớp; 1.834 dòng khác: 993 data chưa chạy tới (dồn thời gian), còn lại đều thuộc các nhóm đã giải thích ở trên. Hai chiến
  dịch Nhóm data: một chờ khoá Z314, một chạy hết 60 data rồi về "Chờ data mới".

**Phủ ước tính trên chiến dịch chạy 30 ngày** (đếm production 12/11, chỉ đọc `auto_campaigns`; có chồng lấn nên là ước tính):

| Loại | Chiến dịch | Chạy bộ mới | Còn bộ cũ vì |
|---|---|---|---|
| `zalo_message_phone` | 6.072 | ~5.990 | link từ chối 49, loại trừ gửi 30 |
| `zalo_message_group_member` | 843 | ~813 | link từ chối 13, loại trừ gửi 17 |
| `zalo_message_friend` | 289 | ~178 | gửi dạng chia sẻ 102, loại trừ gửi 5, chưa lấy data 2, link 1, danh sách cũ 1 |
| `zalo_message_group` | 226 | ~130 | gửi dạng chia sẻ 96 |
| `zalo_add_group_member` | 37 | 37 | |
| `zalo_message_remarketing_customer` | 9 | 9 | |
| `zalo_join_group_link` | 7 | 7 | |
| `zalo_cancel_sent_friend_request` | 41 | 0 | cần lấy data đầu lượt (chưa làm) |
| sinh nhật, đề xuất, group thời gian thực | 7 | 0 | cần lấy data đầu lượt / sự kiện (chưa làm) |
| **Tổng** | **7.531** | **~7.160 (~95%)** | |

### 12/11 ~03:57 VN: link từ chối nhận tin (63 chiến dịch 30 ngày)

- Như `prepareZaloMessageOptOutLink` + `buildZaloOutgoingMessage`: sau cổng từ chối nhận tin (đã có global ID) gọi RPC sẵn có
  `aka_agent_prepare_zalo_message_opt_out` (Desktop: `prepareZaloMessageOptOut`; Fly: `CampaignRuntimeRepository.prepareZaloMessageOptOut`);
  người nhận đã từ chối → chặn (OPT01); tạo link lỗi → `⚠️ "<data>": Không thể tạo link từ chối nhận tin Zalo; vẫn tiếp tục gửi, …` và nội dung
  dùng trang thông báo lỗi. Token `#{STOP_MESSAGES_LINK}` thay bằng link riêng, không có token thì thêm chân trang; AI viết lại sau khi chèn link
  (như Desktop). Gửi thành công ghi `data.messageOptOutSource` để trigger `trg_capture_message_opt_out_source` ghi nguồn (bản chép nguyên văn
  `src/shared/messageOptOutSource.ts` trong lõi).
- Áp cho SĐT, thành viên nhóm, khách cũ, bạn bè (gửi thường). Kiểm: smoke loại theo UID 20/20 (thêm L1–L4).
- ChatApi: ca test "chỉ cờ tổ chức…" đổi ví dụ đi bộ cũ từ link từ chối sang loại trừ gửi (`reason: send_exclusion`), và khẳng định link
  từ chối, Nhóm data nay đi bộ mới.
- Phát lại dữ liệu thật 7 loại (`replay-all-4`): **87/95 chiến dịch mẫu chạy bộ mới** (còn 7 gửi dạng chia sẻ, 1 loại trừ gửi); 5.928 dòng
  khớp, 1.839 dòng khác (giải thích ở mục 5).

### 12/11 ~08:30–09:50 VN: thứ tự gửi chữ / tệp, gửi dạng chia sẻ (V503), loại trừ gửi và danh sách không gửi kiểu cũ (V504)

**Nghiên cứu "gửi chữ trước, tệp sau"** (600 chiến dịch, 355.602 lượt gửi 30 ngày, chỉ đọc):
- 127 rơi vào phần chữ chứ không phải album: album dính 127 chỉ 31/167 nghìn lượt, chữ gửi sau album dính 127 3.521 lượt. Album rồi chữ bị
  giao một phần 2,63% ở chiến dịch theo SĐT.
- Chữ trước (định dạng + 1 tệp): 601/38.137 lượt giao một phần, trong đó 367 là "giả": Zalo trả thành công không có msgId cho chữ rồi tệp
  122. Giao một phần thật ~0,5% (fetch failed, 120, quá giờ).
- Gửi dạng chia sẻ: 11,36% giao một phần, toàn bộ là 112 (chữ bị từ chối sau khi tệp đã vào nhóm).
- Đề xuất (chưa làm, chờ anh): chỉ đổi sang chữ trước cho tin người lạ có từ 2 tệp; coi chữ "thành công" không có msgId là chưa tới; không
  đổi nhóm, bạn bè, chia sẻ.

**Gửi dạng chia sẻ (198 chiến dịch, V503 chưa apply):** lõi chạy theo lô (`UnitConfig.batch`, nhận / báo cả lô trong một lease);
`zalo/share.ts` theo đúng `executeZaloShareMessageBatchCampaign` + `processZaloShareMessageBatch` của Desktop; cổng Desktop
`forwardMessageToUsers/Groups`, cổng Fly lệnh `forward_message`. Khác Desktop: lỗi của từng người trong lô có người nhận được vẫn giữ data
đi đâu theo chính sách đã duyệt (lỗi tài khoản / mạng thì về hàng đợi), Desktop đánh "thất bại" rồi hoàn thành. Kiểm: smoke V503 16 nhóm,
smoke chia sẻ 16 nhóm, 2 ca Fly.

**Loại trừ gửi (52 chiến dịch) và danh sách không gửi kiểu cũ (1), V504 chưa apply** (`scripts/build-v504-sql.cjs`):
- RPC mới `aka_agent_engine_send_exclusion_v1(target_run, lease, op, payload)` xác thực bằng lease của bộ mới: `snapshot` / `facts` chép từ
  hàm cũ đang chạy (preflight kiểm md5 `ca4ba08f…` trên production), `friend_blocklist` (Zalo ID của danh sách kiểu cũ); không có `pause`,
  data bị loại trừ đi qua `report_v1`. Mã mới: EXC01 thuộc điều kiện loại trừ, EXC02 chưa đủ dữ liệu (data tạm dừng kèm câu, như Desktop),
  EXC03 trong danh sách không gửi (data hoàn thành kèm câu, như Desktop), CFG18 / CFG19 cấu hình hỏng (tạm dừng chiến dịch một lần). Cổng
  `send_exclusion` đổi `on_error` open → closed.
- Lõi: `zalo/sendExclusionRules.ts` là bản chép nguyên văn `src/shared/campaignSendExclusion.ts` (smoke kiểm hai bản giống nhau),
  `zalo/sendExclusion.ts` (cổng kiểm, đọc cấu hình một lần mỗi lượt, tag Zalo một lần mỗi data / mỗi lô chia sẻ), `zalo/friendBlocklist.ts`.
  Vị trí như Desktop: theo SĐT sau tra số; theo UID sau từ chối nhận tin; danh sách kiểu cũ trước mọi lần đọc Zalo; chia sẻ: người bị loại
  báo riêng, không vào lệnh chia sẻ.
- Khác Desktop: đọc tag / bạn bè / hồ sơ từ Zalo lỗi thì báo đúng lỗi đó cho DB (thường về hàng đợi) thay vì tạm dừng data; DB của mình lỗi
  khi kiểm thì chưa gửi, data về hàng đợi (SYS08); danh sách kiểu cũ hỏng thì tạm dừng chiến dịch (Desktop để "chờ xử lý" và thử lại mỗi
  vòng); câu ghi chú "Nằm trong danh sách không gửi tin: …" (Desktop "Bỏ qua vì nằm trong …").
- Kiểm: smoke V504 11 nhóm (RPC, nhắn bạn bè, SĐT, chia sẻ, danh sách kiểu cũ); ca Fly đọc tag qua `campaign_label_membership` trên ngữ cảnh
  của data và nhả khi data xong; `campaign-outcome-engine-check-all.cjs` 18/18; ChatApi `npm run verify` đạt.

**Sự cố production 12/11 09:06–09:31 VN (không do engine v2):** DB akachat chuyển chỉ đọc (ổ sắp đầy, DB 379 GB); ghi qua API REST vẫn
chạy, ChatApi và làm mới đăng nhập hỏng. Anh tăng ổ, DB ghi được lại 09:26:48. Máy `worker` và `zalo_runtime` của ChatApi đã sập 10 lần rồi
dừng hẳn (09:09 / 09:10), bật lại 09:31 theo lệnh anh; hàng sự kiện tồn ~40 nghìn (chủ yếu chụp danh sách nhóm khi nối lại) giảm dần.
Làm mới đăng nhập lỗi 100% 09:05–09:25 (609 lượt) nên 18 chiến dịch Desktop (14 Facebook, 4 Zalo) và 3 tài khoản Facebook bị tạm dừng vì
"fetch failed"; 09:51:50 cho chạy lại theo lệnh anh (data dở đã đóng "hoàn thành", không gửi lại), 15/18 nhận lượt ngay trong 20 giây.
Biên nhận: `migrations/snapshots/db-readonly-incident-20261112/receipt.json`.

### 12/11 ~10:00–10:50 VN: lấy data đầu lượt (V505): huỷ lời mời, sinh nhật, đề xuất, bạn bè "toàn bộ / theo tag"

- **Lõi** `zalo/materialize.ts`: bước `prepareTargets` của runUnit, gọi khi lượt chưa chạy data nào mà claim không còn data đến hạn; giữ
  lease bằng heartbeat trong lúc đọc Zalo; in "🚀 Bắt đầu chiến dịch" trước câu lấy data như Desktop. Theo đúng `materializeZalo*InputData`:
  câu tiến trình, nghỉ 2–5 giây trước mỗi lần đọc, Zalo 429 thì thử lại 15/30/60 giây kèm câu, cách chọn data (N lời mời cũ nhất theo
  thời điểm gửi; N đề xuất đầu bỏ trùng; bạn bè có sdob là hôm nay theo ngày VN của DB; bạn bè trong các tag đã chọn), dấu "đã lấy"
  (`zalo*DataMaterialized*`, bảo trì lịch của bộ cũ vẫn xoá khi đặt lịch mới), câu hoàn thành ("🎂 Không có bạn bè sinh nhật hôm nay",
  "⚠️ Zalo không có lời mời kết bạn đã gửi để huỷ", các lý do đề xuất rỗng).
- **Loại mới:** `zalo/cancelSentFriendRequest.ts` (huỷ từng lời mời bằng `undoFriendRequest`, câu "Đã huỷ lời mời kết bạn đã gửi đến …", data
  lưu thời điểm gửi / lời nhắn / global ID ở info1–3); sinh nhật dùng các bước nhắn bạn bè (không tag akaBiz / tag Zalo / đổi tên, bỏ qua
  chế độ chia sẻ đã lưu); đề xuất dùng các bước thành viên nhóm (không kiêm SMS). Bạn bè "toàn bộ / theo tag" ở chế độ chia sẻ lấy data
  trước rồi chia sẻ cả lô, như Desktop.
- **V505** (`scripts/build-v505-sql.cjs`, chưa apply): RPC `aka_agent_engine_materialize_v1(account, lease, op, payload)` với `state` /
  `clear` / `insert` / `hold`, xác thực bằng lease; chỉ thêm data vào chiến dịch chưa có dòng nào nên gọi lại không thêm trùng; dấu "đã lấy"
  dùng giờ DB. `claim_target_v1` nhận `"quota": false` cho thao tác chỉ kiểm khoá (huỷ lời mời: `limit_check_action_codes` rỗng ở bản cũ).
  Không thêm bảng, cột, mã lỗi hay dữ liệu.
- **Cổng:** Desktop đọc qua `zaloRuntimeService` (`getAllFriendsPage`, `listLabels`, `getFriendRecommendations`, `getSentFriendRequests`,
  `undoFriendRequest`), lưu danh bạ bạn bè như bộ lập lịch; Fly dùng lệnh có sẵn của runtime (`get_all_friends_page`,
  `get_label_conversation_uids`, `get_friend_recommendations`, `get_sent_friend_requests`, `undo_friend_request`), lệnh đọc không gắn data,
  khoá lệnh `v2m-<lease>`.
- **Khác Desktop** (ghi ở đầu `materialize.ts`):
  - lỗi đường truyền, runtime chưa sẵn sàng, hoặc 429 sau 3 lần thử khi đọc danh sách: chiến dịch về chờ kèm ghi chú, tự thử lại sau 10 phút
    (Desktop: lượt chạy lỗi; đề xuất / huỷ lời mời còn hoàn thành chiến dịch với mọi lỗi không phải 429). Zalo trả lỗi khi đọc đề xuất / lời
    mời thì vẫn hoàn thành kèm câu như Desktop;
  - tag nguồn không tồn tại / không hợp lệ: tạm dừng chiến dịch kèm "Lượt chạy gặp lỗi: Tag Zalo không tồn tại" (Desktop: lượt chạy lỗi, thử
    lại mỗi nhịp);
  - câu chờ không đổi (chưa chọn tag, không lấy được bạn bè nào) không in lại mỗi lần quét;
  - đọc Zalo trước khi kiểm khoá / hạn mức (claim chỉ kiểm khi đã có data): data lấy được chờ tới lúc mở;
  - Fly đọc từng tag bằng `get_label_conversation_uids` (Desktop đọc một lần `listLabels`); câu và kết quả như Desktop.
- **Kiểm:** smoke V505 9 nhóm (apply / gỡ, RPC, claim bỏ hạn mức nhưng vẫn chờ khoá, bốn loại, đọc lỗi / 429, chia sẻ); 3 ca Fly (huỷ lời
  mời, sinh nhật, tag hỏng); `campaign-outcome-engine-check-all.cjs` 19/19; hai typecheck akaAgent; ChatApi `npm run verify` 184 file /
  2.617 test đạt (sau lần sửa cuối cho chế độ chia sẻ: typecheck ChatApi + test lõi và bộ chạy Fly 26/26).
- **Câu hỏi của anh (10:40):** "data về hàng đợi" trong bảng chính sách chỉ áp khi data chưa gửi được gì. Đã nhắn tin rồi kết bạn lỗi, hoặc đã
  gửi ảnh rồi phần chữ lỗi, thì DB đổi thành "hoàn thành, không gửi lại" (luật `no_requeue_after_delivery` của `report_v1`; giao một phần
  luôn ghi "thất bại" kèm "Đã gửi file nhưng gửi nội dung thất bại."). Đã ghi rõ trong từng dòng của tài liệu chính sách.
- **Còn chạy bộ cũ:** group thời gian thực (1 chiến dịch 30 ngày; nhận sự kiện vẫn ở bộ cũ, bộ mới cần chạy data đã đổ vào và kết thúc theo
  cửa sổ chờ) và chiến dịch theo SĐT bật kiêm SMS (1 chiến dịch 30 ngày, đếm theo `last_run_at`). Đã phủ ở mục kế tiếp (V506).

### 12/11 ~10:55–11:10 VN: group thời gian thực và kiêm gửi SMS (V506)

- **Group thời gian thực** (`zalo_message_group_realtime`, 1 chiến dịch 30 ngày):
  - data vẫn do bộ nghe sự kiện group của bản cũ đổ vào (Desktop `ZaloRealtimeGroupCampaignManager` chạy riêng với bộ lập lịch; Fly hàng
    `chat_zalo_campaign_realtime_queue`), không đổi;
  - bộ mới chạy data đã đổ vào bằng các bước thành viên nhóm (đọc hồ sơ rồi nhắn; không kiêm SMS, như Desktop);
  - `finish_campaign_v2` (V506) làm đúng thứ tự `prepareZaloRealtimeGroupCampaignRun` / `handleZaloRealtimeGroupCompletion`: còn data đến
    hạn → chạy lại ngay; data tương lai → hẹn tới data sớm nhất; còn trong ngày nhận data (`zaloRealtimeEndDate`, so theo ngày VN) → chờ
    tới giờ gốc của chiến dịch (hôm nay nếu chưa qua, không thì ngày mai) kèm "⏳ … đang chờ" (lượt chưa chạy data) hoặc "tiếp tục chờ"
    (đã chạy data); hết ngày nhận, hoặc không đặt ngày → hoàn thành kèm "(hết ngày nhận data theo thời gian thực)";
  - tài khoản Zalo chạy bằng trình duyệt vẫn chạy bộ cũ (bộ cũ báo không hỗ trợ).
- **Kiêm gửi SMS** (chỉ "Nhắn tin theo SĐT" và "Nhắn tin thành viên nhóm", như Desktop): lõi `zalo/smsPush.ts`, gọi sau mỗi dòng lịch sử
  vừa ghi (`afterReport` mới của runUnit).
  - Đẩy khi dòng thuộc tra số ra "không tồn tại", hoặc nhắn người lạ / kết bạn, và trạng thái nằm trong danh sách khách chọn; mỗi data một
    lần.
  - Nội dung chọn biến thể theo mã dòng lịch sử, dựng biến mẫu như tin Zalo rồi thẻ cũ `[fullname]` / `[phone]` / `[info1]`…; tên, SĐT,
    UID, info lấy như `getZaloDetailSmsInputSnapshot`.
  - Câu tiến trình và cảnh báo như Desktop; lỗi chỉ cảnh báo, không đổi kết quả của data.
  - **Nội bộ** (Desktop và Fly): RPC V506 `aka_agent_engine_sms_push_v1(lượt data, lease, payload)`. Với từng tài khoản SMS đã chọn (loại
    `sms`, cùng nhân viên và tổ chức): dùng lại chiến dịch SMS con theo `internalSmsCreatedCampaignIdsByAccount` (mở lại nếu đã hoàn thành)
    hoặc tạo mới như `createCampaign`; thêm một data; mở lại chiến dịch con nếu đã hoàn thành. Mỗi tài khoản một giao dịch con; khoá chiến
    dịch nguồn nên hai nơi chạy không tạo trùng chiến dịch con.
  - **akaBiz Sms** (bên ngoài): qua tích hợp akaBiz như bộ cũ (`getAkaBizIntegrationsForStaff` + `addSmsCampaignDetail`). Lúc làm V506 chỉ
    Desktop có; trên Fly, chiến dịch chỉ bật akaBiz Sms chạy bộ cũ của Fly (`sms_push_external`), mà bộ cũ của Fly không đọc cấu hình kiêm
    SMS nào. Fly làm sau, mục 13/11 bên dưới (chưa deploy).
- **Khác Desktop:** khoá chống đẩy trùng theo lượt chạy (Desktop giữ trong RAM của tiến trình). **Khác bộ cũ của Fly:** Fly nay kiêm SMS
  nội bộ như Desktop/VPS, nên tổ chức chuyển từ VPS sang Fly giữ được tính năng này.
- **V506** (`scripts/build-v506-sql.cjs`, chưa apply): sửa thân `finish_campaign_v2` của V501 (preflight md5 `534ca511…`, thân mới
  `48625d95…`), thêm RPC kiêm SMS (thân `13bd2b9a…`, quyền như các RPC engine). Không thêm bảng, cột, mã lỗi. Gỡ trả `finish_campaign_v2`
  về thân V501. File migration md5 `e179268f…`, rollback `e2f6da86…`.
- **Kiểm:**
  - smoke V506 6 nhóm: hỗ trợ; apply / gỡ / quyền; kiêm SMS nội bộ tạo, dùng lại, mở lại chiến dịch con; RPC từ chối tài khoản sai và lease
    sai; thiếu SĐT; akaBiz Sms; group thời gian thực bốn nhánh;
  - 2 ca Fly: kiêm SMS nội bộ; group thời gian thực chờ rồi hết ngày nhận;
  - `campaign-outcome-engine-check-all.cjs` 20/20; ba typecheck akaAgent (node, web, lõi); ChatApi `npm run verify` 184 file, 2.619 test
    đạt (2 bỏ qua), bản chép lõi khớp nguồn 54 file.

### 12/11 ~11:10–11:30 VN: thử bằng dữ liệu thật cho phần phủ sau (V503–V506)

- **Mẫu** (dữ liệu khách chỉ ở thư mục tạm của phiên, không vào repo):
  - mẫu 3 ngày cũ (104 chiến dịch, chép 12/11 01:33 VN) chạy lại với V503–V506: 103 chiến dịch chạy bộ mới, gồm cả gửi dạng chia sẻ (7),
    huỷ lời mời (8), sinh nhật (1) mà lần trước còn bỏ qua;
  - mẫu tập trung 30 ngày (`export-snapshot.cjs --focus`, chỉ đọc production 12/11 ~11:20 VN): 43 chiến dịch, 1.866 data, 2.012 dòng lịch
    sử (dòng mới nhất mỗi thao tác của mỗi data). Gồm: gửi dạng chia sẻ 10 group + 18 bạn bè (kèm "toàn bộ / theo tag"), huỷ lời mời 8,
    sinh nhật 3, đề xuất 3, group thời gian thực 1;
  - **kiêm SMS không có dữ liệu thật:** 60 ngày qua chỉ 1 chiến dịch bật (34013, đã xoá, chưa từng tạo chiến dịch SMS con). Dựa vào smoke
    V506 và 1 ca Fly;
  - **loại trừ gửi không phát lại được** (cần nhóm liên hệ, tag của khách): mỗi mẫu bỏ qua 1 chiến dịch. Dựa vào smoke V504, luật chép
    nguyên văn `src/shared/campaignSendExclusion.ts`.
- **Bộ phát lại mở rộng** (`replay.cjs`, `replay-types.cjs`):
  - lô chia sẻ: tệp gửi từng người, chữ chia sẻ cả lô, kết quả từng người theo dòng lịch sử (`forwardTargetResult`, `sendMode`);
  - lấy data đầu lượt: chiến dịch nạp không kèm data, bỏ dấu "đã lấy"; danh sách Zalo giả dựng bằng data bộ cũ; so theo UID.
- **Kết quả:**

  | Mẫu | Chiến dịch chạy | Khớp | Khác (trừ data chưa tới lượt) | Data chưa tới lượt |
  |---|---|---|---|---|
  | 3 ngày | 103 | 6.448 | 846 | 996 |
  | Tập trung 30 ngày | 42 | 1.475 | 91 | 280 |

  - Loại vừa phủ khớp hoàn toàn trong mẫu 3 ngày: group chia sẻ 248, huỷ lời mời 191, sinh nhật 3. Phần khác của mẫu này giữ đúng như lần
    trước V503 (mục 5), không có nhóm khác mới.
  - Mẫu tập trung khớp: bạn bè 828, group 216, huỷ lời mời 354, sinh nhật 8, đề xuất 41, thời gian thực 28.
  - 0 data bộ cũ bị bỏ sót khi lấy data đầu lượt.
- **Các nhóm khác của mẫu tập trung, đều đã giải thích:**
  - **Gửi tệp vào group rồi phần chữ bị 112** (29 dòng): bộ cũ ghi mã chung `err_zalo_api_business_failed`, nên cộng chuỗi lỗi (4 lần
    liền thì tạm dừng chiến dịch). Bộ mới ghi đúng 112 như khi không có tệp, vẫn tính lượt, không cộng chuỗi (luật giao một phần đã duyệt).
    Đúng với ghi chú CLAUDE.md: 112 ở bước chữ thường xảy ra sau khi tệp đã vào nhóm, đừng tạm dừng vì 112.
  - **Tệp vào group lỗi 161 "Nhóm không tồn tại"** (2 dòng): bộ cũ ghi mã chung (tính lượt); bộ mới theo chính sách V471: "không tồn tại",
    không tính lượt.
  - **Bỏ qua vì nhớ mục tiêu theo tài khoản** (V499, 4 dòng): tài khoản 4011 chạy 6 chiến dịch chia sẻ vào cùng các group báo 161; bộ mới
    không gửi lại group đó trên cùng tài khoản trong thời gian nhớ. Từ 15:20 bỏ hẳn nhớ (V507): chạy lại với V507, 3 group được gửi lại, ra
    161 "không tồn tại", data tạm dừng như 2 group 161 khác (V471); group còn lại gặp 221 như lịch sử, về hàng đợi.
  - **Theo bảng đã duyệt:** người nhận chặn tin nhắn tính lượt (Q2, 22 dòng); kết bạn lỗi không tính lượt (Q2, 1); thiếu UID ra DAT01,
    không tính lượt (Q1, 12); lỗi mạng lúc gửi tệp thành UNK01 (Q3, 1).
  - **Chiến dịch đề xuất 34833 đổi loại giữa chừng** (20 dòng): trước 07:30 ngày 21/10 nó chạy như "Nhắn tin theo SĐT" (có "Tìm SĐT"). Code
    Desktop hiện tại của loại đề xuất không tra SĐT (`zaloResolveFriendRecommendationTarget`: thiếu UID thì 114), khớp bộ mới.
  - **Data chưa tới lượt** (280): phát lại dồn thời gian, chạm khoá 221 của group hoặc hạn mức ngày.
  - **Câu lịch sử:** thêm mã ngắn ở cuối câu. Bộ cũ trên Fly có dấu chấm cuối câu ("Đã huỷ lời mời…", "Đã chia sẻ…"); bộ mới theo
    Desktop, không có dấu chấm.
- **Chạy đúng như Desktop:**
  - lô chia sẻ mà cả lô lỗi 221 thì tạm dừng chiến dịch kèm "Toàn bộ N target trong batch đều thất bại…" (luật của Desktop, V503);
  - group thời gian thực 32901 (hết ngày nhận 24/10) chạy 29 data rồi hoàn thành kèm câu hết ngày nhận;
  - lấy data đầu lượt: huỷ lời mời 16 chiến dịch, sinh nhật 4, đề xuất 2, bạn bè "toàn bộ / theo tag" chạy lại đúng các UID bộ cũ đã chạy.
- **Sửa ở bộ phát lại, không phải lõi:**
  - đọc kết quả CLI theo khối JSON: bộ lọc dòng cũ xoá mọi dòng có chữ "recommend", làm mất `action_id` của chiến dịch đề xuất. Mẫu 3 ngày
    cũ không có chiến dịch đề xuất nên không bị ảnh hưởng;
  - chỉ coi là lấy data đầu lượt khi data bộ cũ do bước lấy data tạo ra (có dấu "đã lấy", hoặc mọi data đã xoá mềm như bảo trì đầu ngày của
    sinh nhật).

### 12/11 ~13:20–13:55 VN: câu lịch sử khi bỏ qua vì nhớ mục tiêu (đã thay lúc 15:20)

> **Đã bỏ cả tính năng nhớ** (mục kế tiếp); số V507 nay là bản xoá. Phần dưới là lịch sử.

- **Trước:** data bị bỏ qua vì tài khoản đã gặp lỗi cố định với data đó (nhớ mục tiêu theo tài khoản, V499) chỉ ghi "<thao tác>: bỏ qua",
  ví dụ "Nhắn tin group: bỏ qua", ở cả lịch sử lẫn tiến trình. Đây là câu mặc định của `report_v1` cho kết quả thành công không có mẫu riêng.
- **Sau:** "Nhắn tin group: bỏ qua vì lần trước tài khoản này đã gặp lỗi "Nhóm Zalo không còn tồn tại" với data này, không thử lại tới
  10:30 12/12 (Z161)".
  - Lỗi đã gặp: tên cho khách của mã (`customer_title`, rồi `noti_running_process`, `error_name`), bỏ đuôi "(mã 161)" vì mã ngắn đã ở cuối.
  - Hạn: `expires_at` của dòng nhớ, định dạng như các câu khác (`aka_agent_engine_format_vn`: giờ:phút ngày/tháng).
  - Mã ngắn cũng trả về runtime (`publicCode` của kết quả), nên dòng tiến trình mang mã như câu lỗi. Mã lỗi của dòng lịch sử vẫn NULL như
    trước (đây là kết quả "bỏ qua", không phải lỗi).
- **Sửa bằng DB:** mẫu câu ở cột mới `auto_engine_gates.skip_log_template` (dòng `target_memory`; cổng khác chưa dùng). Biến `{action}`,
  `{name}`, `{message}`, `{until}`, `{code}`; mẫu không có mã thì tự thêm " (<mã>)" ở cuối. Đặt NULL thì về câu cũ. Mất dòng nhớ giữa lúc
  nhận và lúc báo (không có việc nào xoá dòng nhớ) hoặc mã không có tên thì cũng giữ câu cũ.
- **Không đổi hành vi:** data, hạn mức, chuỗi lỗi, nghỉ, trạng thái chiến dịch, lệnh Zalo giữ nguyên. Lõi không đổi: từ V499 lõi đã gửi sẵn
  tên cổng và mã lỗi đã nhớ (`data.gate`, `data.rememberedErrorCode`), nên Desktop và Fly không cần bản mới cho việc này.
- **V507** (`scripts/build-v507-sql.cjs`, chưa apply): thêm cột (NULL được, CHECK 1–500 ký tự), đặt mẫu cho `target_memory`, sửa thân
  `report_v1` của V503 (preflight md5 `299d0fe3…`, thân mới `6153dbc0…`, quyền giữ nguyên). Gỡ trả `report_v1` về thân V503 và xoá cột.
  File migration md5 `b942379a…`, rollback `d048ee8a…`. Apply sau V506.
- **Kiểm:**
  - smoke V507 5 nhóm (lõi thật, cổng Zalo giả): cùng kịch bản chạy trước và sau V507 giống hệt nhau, trừ câu bỏ qua và mã ngắn (lịch sử,
    data, chiến dịch, hạn mức, chuỗi lỗi, lệnh Zalo, các dòng tiến trình khác); apply / gỡ / quyền; gửi dạng chia sẻ (data đã nhớ báo riêng
    ngoài lô); sửa mẫu bằng SQL, mẫu NULL, mất dòng nhớ, mã không có mã ngắn;
  - `campaign-outcome-engine-check-all.cjs` 21/21; ChatApi: fixture test apply thêm V507 (`campaignEngineTestFixture.ts`), Fly 16/16,
    `npm run verify` 184 file, 2.619 test đạt (2 bỏ qua), bản chép lõi + SQL khớp nguồn 56 file;
  - chạy lại hai mẫu dữ liệu thật có V507: mẫu 3 ngày giống hệt lần trước (không có data bỏ qua vì nhớ); mẫu tập trung chỉ khác câu của 4
    dòng bỏ qua (tài khoản 4011, group báo 161), thành "Nhắn tin group: bỏ qua vì lần trước tài khoản này đã gặp lỗi "Nhóm Zalo không còn
    tồn tại" với data này, không thử lại tới 13:54 12/12 (Z161)"; số dòng khớp / khác / chưa tới lượt và trạng thái data cuối không đổi.

### 12/11 ~14:20–15:20 VN: kiểm "số không tồn tại" trên toàn hệ thống (tạm hoãn) và bỏ nhớ theo tài khoản (V507)

- **Ý anh** (tạm hoãn): bỏ nhớ theo tài khoản; thay bằng kiểm theo lô trên toàn hệ thống. Khi lấy một lô data, đối chiếu một lần với lịch sử
  trong x ngày (x đặt theo từng cặp mã × thao tác trong DB, trống là toàn bộ lịch sử); data trùng thì chốt luôn với đúng trạng thái của mã
  ("không tồn tại"), không ghi "bỏ qua". Bản đầu chỉ ở bước Tìm SĐT, sau mở rộng bằng cấu hình.
- **Số đo trên production** (chỉ đọc; 3 dải id ~40 nghìn dòng lịch sử, ngày 03–04/09, 05/10, 28/10):
  - Z216 "Zalo không tồn tại": ~50% số bị tra lại về sau, trung bình 4–8 lần mỗi số, phần lớn ở tổ chức khác. Lượt tra lại thấy có Zalo:
    dưới 2 tuần 1,4%, 2–4 tuần 3,6%, 1–2 tháng 6,1%, trên 2 tháng 8%.
  - Z219, Z210: 4–12 số mỗi dải; 11 số bị tra lại, chưa số nào ra có Zalo.
  - Tỉ lệ "không tồn tại" theo tài khoản 8–66% (225 tài khoản có ≥30 lượt tra), không tài khoản nào gần 100% ⇒ là tính chất của số.
  - Lịch sử Tìm SĐT có từ 07/04/2026, dày từ 03/09.
- **Đề xuất x khi làm lại:** Z216 30 ngày (nâng 60 khi ổn), Z219 không đặt x, Z210 30 ngày. Mở rộng sau: Z161, Z227 không đặt x; Z122 cần x;
  Z119, Z126/127, Z225, Z178, Z112 không dùng chung toàn hệ thống (do tài khoản gửi hoặc quan hệ tài khoản–người nhận).
- **Thử truy vấn lô** (chiến dịch 52670, chỉ đọc): tra thẳng bảng lịch sử, lô 500 số mất 43,9 giây lần đầu / 0,8 giây lần sau; lô 2.000 số
  quá 90 giây lần đầu / 34 giây lần sau; 97% số đã có 17–19 lần tra rải khắp bảng 19 GB ⇒ không dùng được. Cần bảng tóm tắt mỗi số một dòng:
  đo tạm bằng chỉ mục SĐT, 2.000 số 6,1 giây lần đầu / 0,16 giây lần sau; nạp lịch sử ~2,8 giây mỗi 50 nghìn id (toàn bộ ~12–15 phút, ngoài
  giờ), giữ cập nhật bằng pg_cron mỗi phút. 16,6–17,6% số trong lô thật đã từng "không tồn tại".
- **Bỏ nhớ theo tài khoản (V507, `scripts/build-v507-sql.cjs`, chưa apply):** tính năng chưa từng chạy trên production (bảng nhớ 0 dòng;
  lần chạy bộ mới cuối 11/11 21:16 VN, trước khi apply V499).
  - Viết lại `claim_target_v1` (thân V505, md5 `3b99fe55…` → `e09100fd…`): bỏ đoạn tra bảng nhớ, không còn quyết định "bỏ qua".
  - Viết lại `report_v1` (thân V503, `299d0fe3…` → `4016395d…`): bỏ đoạn ghi bảng nhớ.
  - Viết lại `resolve_policy` (thân V495 đang chạy, `d4091353…` → `5bf0fd99…`): bỏ trường `remember_target_days`.
  - Xoá cột `auto_outcome_policies.remember_target_days`; giá trị cũ (production 143 dòng: 12 dòng 30 ngày, 131 dòng 0) ghi vào
    `auto_outcome_policy_history` (`changed_by = 'migration_v507'`) để gỡ trả đúng, không tăng revision.
  - Xoá bảng `auto_target_memory` và dòng cổng `target_memory`.
  - Preflight: đúng 3 thân trên, không hàm / view nào khác dùng bảng hay cột. File migration md5 `bdd2dc87…`, rollback `4b01c3ef…`.
  - Gỡ: tạo lại bảng (rỗng, RLS, quyền như cũ), cột với đúng giá trị và revision cũ, dòng cổng, thân cũ của 3 hàm.
  - Lõi không đổi: nhánh xử lý quyết định "bỏ qua" không còn được dùng tới. Desktop và ChatApi không cần bản mới cho V507.
  - Sau khi apply: sinh lại [CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md](CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md) bằng
    `scripts/campaign-outcome-engine-policy-groups.cjs` (bản hiện tại đọc production trước V507 nên còn ghi "nhớ người nhận 30 ngày").
- **Kiểm:** smoke V507 4 nhóm (trước V507 còn nhớ; apply / chặn chạy lại / quyền / revision / các trường khác của `resolve_policy` giữ
  nguyên; sau V507 group 161 được gửi lại như bộ cũ, cả gửi thường lẫn chia sẻ; gỡ trả đúng rồi nhớ chạy lại); check-all 21/21; Fly 16/16;
  ChatApi `npm run verify` 184 file / 2.619 test đạt (2 bỏ qua), bản chép sang ChatApi khớp nguồn 56 file;
  hai mẫu dữ liệu thật: mẫu 3 ngày giống hệt, mẫu tập trung chỉ đổi 4 dòng từng bị bỏ qua (xem mục 11:10–11:30).

### 12/11 ~15:30–16:40 VN: 126/127 khi nhắn group (V508)

- **Trước V508 (Q4 của V500):** 126/127 khi nhắn group được coi là tài khoản bị hãm tốc: data về hàng đợi, khoá thao tác nhắn group 30 phút
  (kế thừa dòng theo mã), kết thúc lượt, đếm chuỗi ngưỡng 3 rồi tạm dừng chiến dịch, không tính lượt. Bộ cũ: ghi "thất bại", không đếm chuỗi
  (`auto_error` id 50 `counts_toward_bad_target = false`), nhưng cũng khoá cả thao tác nhắn group 30 phút.
- **Số đo trên production (12/11, chỉ đọc):**
  - 7 ngày gửi dạng chia sẻ: 753 lô có 127, không lô nhiều group nào bị 127 cả lô.
  - Luôn đúng cặp tài khoản–group: chiến dịch 15007 có 2 group bị 127 ở 12/12 lô; chiến dịch 50789 có 1 group bị ở 486/486 lô.
  - Đã bị thì kéo dài: một group của tài khoản 10105 nhận đều 2 phút/lần suốt 05–08/11 rồi bị 127 liền 1.164 lần trong 4 ngày, cùng nhịp gửi.
  - Gửi thường 30 ngày: 34.811 lượt nhắn group, 98,2% thành công, 112 = 0, 127 = 31 lượt ở 1 chiến dịch, không lần nào 3 lượt liền.
  - Ngược lại, 127 ở tin cá nhân (người lạ / bạn bè) đúng là hãm tốc theo tài khoản (02/11: 1.084/1.086 lần khi tin người lạ thành công
    trước đó dưới 5 phút), nên V508 không đụng 126/127 ở các thao tác khác.
- **Câu Zalo trả** (`auto_zalo_api_error_logs`, bảng chẩn đoán của bộ cũ):
  - Gửi thường (`sendMessage`): cả 126 lẫn 127 đều là "Không thể nhận tin nhắn từ bạn." (lỗi `ZcaApiError` của zca-js, chữ do server Zalo
    trả); hai mã chỉ khác số.
  - Gửi dạng chia sẻ: Zalo chỉ trả mã cho từng group bị từ chối, không kèm câu; "Chia sẻ tin nhắn Zalo thất bại" là câu dự phòng của app
    ([campaignScheduler.ts:7042](../src/main/services/campaignScheduler.ts:7042), lõi `zalo/share.ts`).
  - 10/11 10:05 → 12/11 16:28 VN: 127 nhắn người lạ 3.417, 127 nhắn group dạng chia sẻ 848, 126 nhắn bạn bè 255 (thêm 166 khi chia sẻ),
    126 nhắn người lạ 213, 126 thêm thành viên vào group 4. Nhắn group từ 22/10 chỉ gặp 127 (2.607 lượt, đều dạng chia sẻ), không có 126.
- **Anh chốt "Chỉ 126/127":** coi là group chặn riêng tài khoản. 112 giữ nguyên (vẫn đếm chuỗi như Q4): 112 có thể do nội dung, ví dụ nhắn
  group thường kèm đúng 1 ảnh thì chữ thành chú thích ảnh (`planZaloSend` 'combined') và chữ dài ra 112 ở mọi group, khi đó dừng chiến dịch
  là đúng. Số đo 112: chia sẻ 30 ngày 193.570 lượt, 3.316 lượt 112, không lô nhiều group nào bị 112 cả lô, 30 cặp tài khoản–group có 112.
- **V508** (`scripts/build-v508-sql.cjs`, **đã apply 12/11 16:50:22 VN**, xem mục 6): chỉ sửa dữ liệu đúng một dòng `auto_outcome_policies`
  (`err_zalo_126_127_message_group` × `zalo_message_group`, dòng Q4 của V500): `target_streak_effect = ignore`, `campaign_effect = none`,
  `target_effect = complete`, `lock_action_codes = '{}'` (ghi đè khoá kế thừa), `run_effect = continue`; `quota_effect` giữ `no_count`.
  Kết quả: data hoàn thành, lịch sử "thất bại" kèm mã, không tính lượt, không đếm chuỗi, không khoá, không tạm dừng, chạy tiếp group sau.
  - Preflight: sổ migration, đúng 1 dòng, đúng giá trị Q4. Postflight: chính sách đã gộp của cặp này đúng giá trị mới ở cả Desktop lẫn Fly;
    mọi cặp (mã, thao tác) Zalo khác giữ nguyên (so ảnh chụp trước / sau trong cùng giao dịch, bảng tạm `pg_temp` không làm PostgREST nạp
    lại schema). Lịch sử chính sách ghi lần sửa (revision 2).
  - Không DDL, không đổi hàm; bộ cũ đọc `auto_error` nên không đổi. Không phụ thuộc V503–V507: apply riêng được trên chuỗi production hiện
    tại (V495–V501).
  - Lô chia sẻ mà cả lô thất bại vẫn tạm dừng theo luật lô của Desktop (V503), kể cả lô chỉ có 1 group bị 127; 7 ngày qua không lô nhiều group
    nào như vậy. Anh chốt 12/11 ~17:10: giữ luật này (cả lô thất bại thì tạm dừng), không bỏ 126/127 ra.
  - md5 migration `dea7e6ebffa19b844a1afa7774f87063`, rollback `b6a201be71b613c34b8d9caa45cfa09a` (trả đúng giá trị Q4).
  - Sau khi apply: sinh lại [CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md](CAMPAIGN_OUTCOME_ENGINE_POLICY_GROUPS.md) (bản hiện tại còn ghi
    126/127 nhắn group là khoá 30 phút, về hàng đợi).
- **Kiểm:**
  - smoke V508 5 nhóm (lõi thật, cổng Zalo giả, PG17): trước V508 group đầu bị 127 làm khoá nhắn group, về hàng đợi, kết thúc lượt; apply
    trong giao dịch rồi ROLLBACK không đổi gì, apply thật chỉ đổi đúng một cặp (mã, thao tác), chặn chạy lại, gỡ trả đúng Q4; sau V508 gửi thường
    chạy hết các group, 4 group liền bị 127 vẫn không tạm dừng; gửi dạng chia sẻ group bị 127 hoàn thành, lô cả lô thất bại vẫn tạm dừng;
    apply / gỡ riêng trên chuỗi V495–V501;
  - `campaign-outcome-engine-check-all.cjs` 22/22; Fly 16/16; ChatApi `npm run verify` 184 file / 2.619 test đạt (2 bỏ qua); bản chép sang
    ChatApi khớp nguồn 58 file;
  - production (chỉ đọc, 12/11 ~16:35 VN): dòng 220 đúng giá trị Q4, revision 1; sổ migration chưa có V503–V508, không nhánh nào dùng.
- **Dữ liệu thật:** mẫu tập trung 30 ngày giống hệt lần trước (mẫu này không có 126/127 khi nhắn group). Mẫu 3 ngày chỉ đổi 3 dòng 127 của hai
  chiến dịch gửi dạng chia sẻ:
  - 15007 (Fly): hai group trước về hàng đợi, nay "thất bại" và hoàn thành; chiến dịch hoàn thành;
  - 50789 (Desktop, nhiều khung giờ): lượt nay xong trọn rồi hẹn khung giờ kế tiếp, đặt lại 19 data về "chờ xử lý" như bộ cũ. Bộ phát lại
    tính các data này vào cột "chưa chạy tới" vì nó đọc trạng thái cuối của data.

### 12/11 ~17:00–17:15 VN: 112 khi nhắn tin cá nhân là do chữ quá dài (đo, chưa sửa)

Anh hỏi có cách nào biết 112 là do nội dung dài để xử lý như lỗi nội dung dài (tạm dừng chiến dịch). Đo trên production, chỉ đọc:
- **Zalo có mã riêng 118 "Nội dung quá dài"** (`err_zalo_message_too_long`, Z118, nhóm `content_config`). Engine hiện nay với 118: tạm dừng chiến
  dịch ngay, dừng lượt, data chưa gửi được gì về hàng đợi, không tính lượt, không đếm chuỗi.
- **112 khi nhắn tin cá nhân gần như luôn là chữ quá dài.** Toàn bộ `auto_zalo_api_error_logs` (từ 06/2026), 112 và 118 khi nhắn người lạ /
  bạn bè gửi thường: 741/743 lượt có chữ dài hơn 2.000 ký tự (ngắn nhất 2.341); 2 lượt còn lại chữ rỗng. Nhắn group gửi thường: 1 lượt (chữ
  rỗng). Group gửi dạng chia sẻ: 43.139 lượt chữ ≤ 2.000, là group từ chối, không liên quan độ dài.
- **Không có ngưỡng gọn:**
  - Kèm đúng 1 ảnh (chữ thành chú thích ảnh): gửi được tới 2.157 ký tự, từ 2.341 ký tự thì 112.
  - Trong khoảng 2.663–2.782 ký tự: ảnh jpg lúc được lúc 112, ảnh png luôn 112.
  - Khoảng 2.756–2.822 ký tự: có thêm 118.
  - Album rồi chữ thành tin riêng: 3.214 ký tự luôn 112 sau khi tệp đã tới (chiến dịch 53967: 58 lượt hôm nay, khách nhận ảnh không có chữ);
    2.757 ký tự gửi được.
- **Hiện nay:** engine xếp 112 tin cá nhân vào `err_zalo_api_business_failed` (hoàn thành, tính lượt, đếm chuỗi, 4 data liền mới tạm dừng);
  bộ cũ cũng vậy (policy 18).
- **Đề xuất (chờ anh):** bộ mới gặp 112 khi nhắn tin cá nhân, hoặc nhắn group gửi thường, mà phần chữ của đúng lần gửi đó dài hơn 2.000 ký tự
  (ngưỡng để trong DB) thì xử lý như 118: tạm dừng chiến dịch ngay kèm câu "Nội dung quá dài so với giới hạn của Zalo (mã 112), rút ngắn rồi
  chạy lại". Không áp cho gửi dạng chia sẻ (112 ở đó là group từ chối). Không chặn trước khi gửi, vì cùng độ dài có lần Zalo vẫn nhận.
- **Anh chốt (~17:15): không kiểm độ dài, cứ 112 khi nhắn người lạ / bạn bè là xử lý như 118; nhắn group giữ nguyên.** Đã làm thành V509
  (mục kế tiếp).

### 12/11 ~17:15–17:45 VN: V509, 112 khi nhắn người lạ / bạn bè xử lý như 118 (đã apply 17:44:42)

- **V509** (`scripts/build-v509-sql.cjs`): chỉ dữ liệu của engine v2.
  - Mã mới `err_engine_zalo_112_message_too_long`: `error_type` 'engine v2', mã công khai Z112, nhóm `content_config`, câu cho khách
    "Nội dung quá dài". Không ghi mã Zalo vào `auto_error.zalo_error_codes` nên bộ chạy cũ (Desktop/VPS/chat-sync) không khớp tới.
  - Chép 3 dòng chính sách của `err_zalo_message_too_long` (dòng theo mã id 74, nhắn người lạ id 199, nhắn bạn bè id 200), source 'v509';
    chỉ đổi câu: lịch sử "Nội dung quá dài (Z112)", ghi chú chiến dịch "Nội dung quá dài, vui lòng rút ngắn nội dung chiến dịch (gửi kèm 1
    ảnh thì chữ dưới 2.000 ký tự) (Z112)".
  - 2 luật: `zalo_code` 112 × `zalo_message_stranger` / `zalo_message_friend` → mã mới (ưu tiên hơn luật bắt-tất-cả).
  - Kết quả: tạm dừng chiến dịch ngay, dừng lượt; data chưa gửi được gì về hàng đợi, không ghi lịch sử (như 118); tệp đã tới rồi chữ bị 112
    thì data hoàn thành, ghi "Đã gửi file nhưng gửi nội dung thất bại. Nội dung quá dài (Z112)", tính lượt.
  - Nhắn group giữ `err_zalo_112_message_group` (group từ chối). Gửi dạng chia sẻ bạn bè: như 118 hôm nay (lô có người nhận được thì chỉ
    data đó về hàng đợi, không tạm dừng; cả lô thất bại thì tạm dừng).
  - Preflight: sổ migration; mã mới chưa có hoặc là 'engine v2'; chưa có luật / chính sách 112 cho nhắn người lạ / bạn bè; 3 dòng của 118
    đúng giá trị đã duyệt. Postflight: phân loại 112 × hai thao tác ra mã mới ở cả 3 pha; chính sách đã gộp y như 118 (trừ câu) ở Desktop lẫn
    Fly; mọi cặp (mã, thao tác) có sẵn giữ nguyên chính sách; mọi cặp (mã Zalo, thao tác, pha) khác giữ nguyên phân loại; không dòng lint mới.
    Bảng tạm `pg_temp` nên không làm PostgREST nạp lại schema.
  - Không phụ thuộc V503–V508 (chỉ cần V495, V500). Gỡ: xoá chính sách / luật 'v509', tắt mã mới (không xoá dòng `auto_error`).
- **Production (chỉ đọc, 17:24 VN):** 3 dòng 118 đúng như preflight cần; chưa có mã mới / luật 112 cho hai thao tác; lint 0 dòng; 112 × nhắn
  người lạ hiện ra `err_zalo_api_business_failed`.
- **Kiểm:**
  - smoke V509 5 nhóm (lõi thật, cổng Zalo giả, PG17): trước V509 112 nhắn người lạ là lỗi chung (tính lượt, chạy tiếp); apply trong giao
    dịch rồi ROLLBACK không đổi gì, apply thật 0,4 giây, chính sách y như 118 trừ câu, nhắn group và 118 giữ nguyên, chặn chạy lại, gỡ trả
    đúng, apply lại được; sau V509 chỉ chữ / 1 ảnh kèm chữ: tạm dừng ngay, data về hàng đợi, không lịch sử, không tính lượt; album rồi chữ
    bị 112: "Đã gửi file nhưng gửi nội dung thất bại. Nội dung quá dài (Z112)", tính lượt, data hoàn thành, chiến dịch tạm dừng;
  - `campaign-outcome-engine-check-all.cjs` 23/23; ChatApi dựng được, Fly runner 16/16, `npm run verify` 184 file / 2.619 test đạt (2 bỏ
    qua); bản chép sang ChatApi khớp nguồn 60 file;
  - hai mẫu dữ liệu thật cũ: không có 112 tin cá nhân nên V509 không đổi gì (mẫu 3 ngày chỉ khác 50789 vì giờ chạy thử đã qua khung cuối
    16:58 của chiến dịch nhiều khung giờ);
  - mẫu riêng 11 chiến dịch đã gặp 112 (`export-snapshot.cjs --ids`, mới thêm, chỉ đọc), phát lại không có / có V509
    (`ENGINE_REPLAY_UNTIL=508`, mới thêm): 46331 (1 ảnh, 2.586 ký tự) từ 4 data thất bại tính lượt rồi mới dừng thành dừng ngay ở data đầu,
    data giữ chờ xử lý; 53581 (1 ảnh, 2.743 ký tự) từ 5 data thành 1; 53967 (5 ảnh, 3.214 ký tự) từ 12 người nhận ảnh không có chữ thành 1
    người rồi dừng. 8 chiến dịch còn lại không chạy được trong môi trường thử ở cả hai lần (bộ cũ đã dừng hoặc tài khoản không còn lúc chép).
- **md5:** migration `c470185ccd169ca0c8af84b73014f092`, rollback `a9f4105c1393b023dfd71d8f2c340cd6`.
- **Đã apply akachat 12/11 17:44:42 VN** (anh: "Apply ngay"; `20261112104442`; md5 sổ = file; không apply lại; biên nhận
  `migrations/snapshots/zalo-personal-112-too-long-v509/apply-receipt.json`). Hậu kiểm: mã mới id 158 (Z112, không mã Zalo), chính sách
  272–274, luật 92–93; 112 × nhắn người lạ / bạn bè ra mã mới, 112 × nhắn group / thêm thành viên / đổi tên và 118 giữ nguyên; chính sách
  y như 118 trừ câu ở Desktop lẫn Fly; lint 0; PostgREST không nạp lại schema; 0 lỗi 5xx / 503, p99 117–189 ms không nhích.

### 12/11 ~17:50–18:10 VN: sửa hai khác biệt nhỏ của Fly (anh: "fix luôn cái này đi"; chưa deploy)

Sửa cho **bộ mới khi chạy trên Fly** (bộ mới trên Desktop không bị): trên Fly bộ mới đi qua `zalo_runtime` và bộ viết lại AI dùng chung với bộ
cũ, hai chỗ này vốn bỏ mất thông tin nên bộ mới trên Fly khác Desktop (bộ cũ trên Fly cũng vậy). Sửa ở worktree ChatApi
`akaAgentChatApi-deploy-dbb38b7`, chỉ thêm thông tin, chỉ cổng Fly của bộ mới đọc; bộ cũ trên Fly không đổi:
- **Thêm thành viên vào group giữ mã Zalo:**
  - Bộ chạy Zalo trên Fly (`packages/zalo-zca-adapter` `addMemberToGroup`, chạy trong `zalo_runtime`) gửi kèm `memberErrors`
    (`memberId`, `code`, `message`, `answered`) cho từng người lỗi khi gửi link group và khi mời vào nhóm cộng đồng. Bộ cũ chỉ đọc
    `errorMembers` nên không đổi.
  - Nhóm cộng đồng phân loại đúng như `zaloRuntimeService.addMemberToGroup` của Desktop (`zcaCommunityInviteOutcome`): hàng rỗng là "đã
    mời" (trước: "đã thêm"); hàng có mà không có `error_code` là lỗi kèm câu của hàng (trước: "đã thêm").
  - Cổng Fly (`flyAddGroupMemberResult`): có `memberErrors` của người đó thì đổi ra lỗi như Desktop (`zaloPortErrorFrom` thao tác gửi; Zalo
    trả mã thì "thất bại" theo mã, lỗi mạng chưa có trả lời thì không rõ đã tới). Runtime bản cũ (không có `memberErrors`) vẫn lỗi không mã
    như trước, nên deploy `worker` trước hay sau `zalo_runtime` đều được; mã chỉ có sau khi deploy `zalo_runtime`.
- **AI viết lại khi tổ chức không có cấu hình AI:** `CampaignAiRewriter.rewriteWithResult` trả thêm `notConfiguredReason` với đúng câu của
  `callAiUsing` trên Desktop/VPS ("Không tìm thấy cấu hình AI: fb_send_message_rewrite"; có cấu hình mà thiếu API key: "Chưa cấu hình API
  key cho AI model: <tên model>", Desktop ghi mã model). Cổng Fly ném câu này nên lõi in "⚠️ AI viết lại nội dung lỗi, dùng nội dung gốc: …"
  như Desktop. Bộ cũ chỉ đọc `fallbackReason` nên vẫn im lặng. Chỉ cần deploy `worker`.
- **Thấy thêm, không sửa (bộ cũ):** bộ cũ trên Fly ghi "thành công" cho mọi lượt thêm thành viên vì đọc `outcome` mà runtime không trả;
  người bị Zalo từ chối cũng thành "thành công". Bộ mới đọc đúng danh sách. Anh chốt (~18:20): không sửa bộ cũ.
- **Kiểm:** test mới của adapter (phân loại nhóm cộng đồng, lỗi từng người), cổng Fly (giữ mã, lỗi mạng, runtime cũ, AI thiếu cấu hình),
  `CampaignAiRewriter` (thiếu cấu hình / API key); 3 file 48/48; ChatApi `npm run verify` 184 file / 2.624 test đạt (2 bỏ qua).

### 12/11 ~18:05–18:40 VN: rà mọi lệnh `zalo_runtime` của bộ mới trên Fly so với Desktop (anh: "Rà lại hết"; chưa sửa)

Bộ mới trên Fly gửi 18 loại lệnh tới `zalo_runtime`. 3 agent đọc song song từng đường đi, cổng Fly → runtime → adapter → zca-js, so với cổng
Desktop → `zaloRuntimeService` → zca-js; em tự đọc lại code các điểm nghiêm trọng. Lõi `packages/campaign-engine` giống hệt ở hai repo,
zca-js cùng bản 2.1.2. Mã số Zalo (cả số âm như -69) đi qua runtime đủ; các khác biệt dưới đây là chỗ runtime / cổng Fly bỏ mất thông tin
hoặc xử lý khác Desktop.

**Đổi kết quả (gửi lại hay không, tính lượt, chuỗi lỗi):**
1. **Lỗi mạng trước khi tới Zalo** (ECONNREFUSED, ENOTFOUND, EAI_AGAIN, UND_ERR_CONNECT_TIMEOUT nằm trong `cause` của "fetch failed"):
   runtime chỉ gửi mã ở tầng ngoài và câu lỗi (`runtimeBridge.ts` `commandErrorCode`, kết quả chỉ có `errorMessage`), mất `cause`. Desktop: chưa
   gửi → NET01, về hàng đợi. Fly: "fetch failed" → không rõ đã tới → UNK01, data đóng, không gửi lại, cộng chuỗi lỗi. Mọi lệnh gửi, kể cả
   `memberErrors` mới. Sửa: runtime chuyển kèm mã / syscall của `cause` (thêm trường giao thức), cổng dựng lại lỗi có `cause`.
2. **Mọi lỗi không mã của runtime bị coi là "Zalo đã trả lời"** (`flyCommandFailure` gọi `classifyZaloError(…, true)` cho mọi
   `zalo_command_failed`) → "thất bại" Z999, tính lượt, cộng chuỗi. Gồm lỗi nội bộ: kiểm tham số (zod), "Runtime chưa hỗ trợ …", dữ liệu
   Zalo trả lạ (`changed_profiles` rỗng làm `Object.entries` lỗi), và **phiên tag bị xoá khi socket rớt** (`disconnected` gọi
   `clearCampaignLabels`, lệnh tag sau đó báo "Phiên tag Zalo đã thay đổi"): ở bước kiểm loại trừ gửi, người chưa được nhắn bị ghi thất bại;
   gửi dạng chia sẻ thì cả phần lô sau khi kết nối lại. Desktop chỉ coi `ZaloApiError` là đã trả lời; phiên tag không mất khi listener kết nối
   lại. Sửa: runtime báo `answered` (như `memberErrors`) / mã riêng cho lỗi nội bộ, cổng dùng thay cho `true`.
3. **Lệnh đọc gặp "không rõ kết quả" / hết giờ bị xếp "có thể đã gửi"** (`flyCommandFailure` không xét thao tác): kiểm loại trừ gửi (tag,
   bạn bè, hồ sơ) → UNK01 dưới thao tác nhắn tin, data đóng mà chưa gửi. Desktop: lệnh đọc không bao giờ "đang gửi" → NET01. Sửa ở cổng
   (chỉ deploy `worker`).
4. **SĐT không đúng dạng `^\+?[0-9]{9,15}$`** (khoảng trắng, dấu chấm, gạch, quá ngắn / dài): runtime từ chối ở bước kiểm tham số → Fly ghi
   "Tìm SĐT thất bại: [json lỗi] (Z999)", tính lượt, cộng chuỗi; Desktop gửi Zalo và nhận mã của Zalo (216/219…). Tương tự tin trên 20.000 ký
   tự, tên tệp toàn khoảng trắng. Chưa đo tần suất. Sửa: nới kiểm tra ở `runtime-protocol` (deploy `zalo_runtime`) và cho lỗi kiểm tham số mã
   riêng.
5. **Lỗi DB của chính ChatApi khi tạo / đọc lệnh** (`campaignCommandClient` `create` / `get` / `cancelPending` không gói lỗi, `toPortError`
   cho đi qua) → lõi coi là lỗi code → SYS99, đóng data dù chưa gửi gì. Sửa ở command client: tạo lệnh lỗi → `campaign_failed_before_dispatch`,
   đọc kết quả lỗi → `command_result_unknown` (chỉ deploy `worker`).
6. **Thêm thành viên: Zalo không trả thông tin group** → adapter báo "Không lấy được thông tin group Zalo." trước khi thử (Z999); Desktop vẫn
   thử thêm và nhận mã Zalo (vd 164 → tạm dừng "cho tài khoản vào nhóm"). Sửa adapter.

**Đổi kết quả trong vài tình huống:**
7. Tra số, đọc hồ sơ, đọc danh sách bạn bè / đề xuất / lời mời đã gửi trên Fly **chờ Chat ghi sự kiện xong** (`publishFoundUser`,
   `publishUserProfile`, `publishUsers`…): chậm theo độ dài danh sách, có thể hết giờ hoặc báo lỗi sau khi Zalo đã trả lời; đọc hồ sơ lỗi thì
   lõi bỏ qua kiểm từ chối nhận tin theo global ID và link từ chối cá nhân hoá → có thể nhắn người đã từ chối. Sửa adapter: không chờ ghi sự
   kiện trong lệnh chiến dịch.
8. Đọc hồ sơ bị treo: Fly hết giờ ở 90 giây rồi vẫn gửi; Desktop hết hạn bước 150 giây → data về hàng đợi. Sửa ở cổng.
9. Gửi dạng chia sẻ có tệp: Fly tải tệp riêng cho từng người → nguồn chập chờn thì một phần lô nhận tệp, một phần CFG01; Desktop tải một lần
   trước khi đánh dấu, hỏng thì cả lô chờ.
10. Tải tệp: lỗi khi đọc nội dung (`arrayBuffer()` nằm ngoài khối bắt lỗi) → hết 60 giây ra mã 23 (Z999) hoặc "terminated" (UNK01); Desktop
    CFG01 (tạm dừng một lần, data giữ). Sửa adapter.
11. Kết quả lệnh có ký tự NUL không lưu được vào jsonb → `command_dispatch_failed` → UNK01 dù đã gửi. Sửa: bỏ NUL trước khi lưu.
12. UID có đuôi `_0`: Desktop bỏ đuôi (thêm thành viên, đọc hồ sơ, so `errorMembers`), Fly không. Sửa adapter.
13. Gửi kèm chú thích hay tách chữ do zca-js so đuôi tệp phân biệt hoa thường: Fly lấy tên trong cấu hình, Desktop lấy đuôi của tệp tạm / URL
    → cùng chiến dịch (vd tên `IMG.JPG`, URL `…/x.jpg`) Desktop gửi 1 ảnh kèm chú thích, Fly gửi chữ rồi ảnh.
14. Nội dung định dạng + 1 tệp tải hỏng: Fly gửi chữ trước rồi mới tải tệp → giao một phần; Desktop tải trước, hỏng thì chưa gửi (CFG01).
15. Thêm thành viên: câu lỗi link group khác Desktop; kết quả thiếu tên / loại group / link nên dòng lịch sử dùng tên cũ trong form.

**Khác do thiết kế, cần anh quyết:**
16. Fly từ chối mọi lệnh khi socket Zalo của tài khoản đang kết nối lại (NET03: về hàng đợi, khoá 5 phút, 4 lần liền thì tạm dừng); Desktop
    vẫn gọi HTTP được, chỉ gửi tệp mới chờ listener.
17. Thời gian chờ: ảnh 90 giây (Desktop) / 180 giây (Fly); tag, đổi tên: Desktop theo hạn bước 150 giây (NET01), Fly 90 giây (UNK01); đọc:
    Desktop NET01, Fly NET03.
18. Desktop khởi động lại listener trước khi gửi video / tệp nếu đã mở hơn 30 phút; Fly không (có thể liên quan việc video trên Fly hay
    "không rõ kết quả", chưa chứng minh).

**Nhỏ / câu chữ:** câu dự phòng khi chia sẻ thất bại khác (Fly dùng mã lỗi làm câu), dấu chấm cuối câu, `response` lưu cả vỏ lệnh; mã tag dạng
lạ (`012`) Desktop nhận Fly từ chối; `applyLabel` Fly ghi thêm khi danh sách trùng; vào group thiếu link mặc định; câu khi Zalo trả mã mà câu
rỗng ("ZcaApiError" / "Lỗi Zalo chưa xác định"). Ngoài so sánh: người nhận không khớp trong chia sẻ thành Z999 ở cả hai (nhánh "không rõ" của
lõi không bao giờ tới).

**Anh chốt (~18:50):** SĐT sai dạng theo Desktop (Fly cũng gửi Zalo tra, mã Zalo quyết định); điểm 16 giữ như hiện nay (Fly từ chối lệnh khi
socket kết nối lại); điểm 18 đo trước, chưa làm. Anh nhấn mạnh điểm 9 (tải tệp một lần cho cả lô chia sẻ) là cần thiết; phạm vi đang chốt.

### 12/11 ~19:00–20:45 VN: "Sửa toàn bộ" (anh chốt sau danh sách trên; chưa commit, chưa deploy; V512 apply 21:48 VN)

**Đánh giá lại theo câu anh hỏi ("theo Desktop có hợp lý, hay do Fly nên phải khác"):** phần lớn theo Desktop (điểm 1, 3, 4, 6, 8, 10, 12, 13,
15, phần lớn điểm 2, câu chữ nhỏ) vì khác biệt do runtime làm rơi thông tin hoặc adapter viết khác, không do Fly cần. Làm riêng cho Fly (có lý do
kiến trúc): điểm 5 (hàng lệnh trong DB), điểm 7 (vẫn gửi sự kiện cho Chat nhưng không chờ), điểm 9 / 14 (tải trước vào RAM của runtime, RAM dùng
chung nên giữ ngắn), điểm 11 (jsonb), 2 tín hiệu riêng (tham số lệnh sai, phiên tag bị huỷ giữa lượt), thời gian chờ và hạn bước của Fly giữ
như cũ (hạn chờ của Fly tính cả tải tệp và đường hàng lệnh; hạ ảnh xuống 90 giây sẽ tăng ca "không rõ kết quả"). Một chỗ Desktop theo Fly: câu
khi Zalo trả mã mà câu rỗng (Desktop in "ZcaApiError" cho khách). Đo DB: tag / đổi tên treo trên Desktop ra NET01 (khoá thao tác, kết thúc lượt),
Fly ra UNK01 (chạy tiếp) ⇒ thêm luật để Fly ra NET01.

**Đã sửa (ChatApi worktree `akaAgentChatApi-deploy-dbb38b7`, lõi akaAgent đã đồng bộ sang):**
- Chi tiết lỗi lệnh (`ZaloCommandErrorDetail`: Zalo đã trả lời hay chưa, errno / syscall / câu của cause, tham số sai, hết giờ, phiên tag) đi
  trong `result` của `zalo.command.result` khi lỗi, KHÔNG là trường riêng: Chat Core bản cũ kiểm khuôn tin chặt và ngắt cả phiên runtime khi gặp
  trường lạ, còn `result` của lệnh lỗi bị bỏ qua ⇒ deploy theo thứ tự nào, quay về bản cũ cũng không ngắt phiên. chat-api lưu chi tiết vào
  `result_payload.campaignCommandError` khi lệnh lỗi hẳn (không lưu cho lệnh không rõ kết quả vì có thể được khớp socket thành completed), bỏ
  NUL trước khi lưu kết quả thành công (cả runtime cũ).
- Cổng Fly đọc lỗi như cổng Desktop (`flyCommandFailure`): lệnh đọc không rõ kết quả là chưa gửi; mã errno / chi tiết mạng dựng lại lỗi có
  `cause`; chỉ lỗi Zalo trả (ZaloApiError) là "đã trả lời"; lỗi nội bộ khác như Desktop (đọc: chưa gửi, gửi: không rõ). Đọc hồ sơ / trạng thái kết
  bạn không có kết quả ném `DeadlineError` như hạn bước của Desktop (lõi ném tiếp ở 3 chỗ đang bỏ qua lỗi đọc hồ sơ: bước resolve nhắn theo UID,
  thêm thành viên, kiểm từ chối nhận tin trong lô chia sẻ).
- Hàng lệnh (`CampaignCommandClient`, tuỳ chọn `trackQueue` chỉ bộ mới bật, bộ cũ y như trước): ghi lệnh lỗi thì đọc lại theo khoá chống trùng
  (thấy lệnh thì chờ kết quả như thường; không thấy là chưa vào hàng; đọc lại cũng lỗi là không xác minh được), lỗi đọc kết quả tạm thời thì đọc
  lại tới hết hạn. Cổng đổi lỗi DB / mạng tạm thời thành `campaign_failed_before_dispatch` / `command_result_unknown`; lỗi code ném nguyên.
- Runtime / adapter theo Desktop: không chờ Chat ghi sự kiện (tra số, hồ sơ, bạn bè, đề xuất, lời mời, đồng bộ group, danh sách tag; lỗi ghi Chat
  không làm lệnh lỗi); hồ sơ thiếu `changed_profiles`, danh sách bạn bè / tag không phải mảng thì rỗng; bỏ đuôi `_0`; thêm thành viên vẫn thử khi
  Zalo không trả thông tin group, câu link group như Desktop, kết quả có tên / loại / link group và phản hồi gốc từng người, lỗi từng người kèm
  errno; vào group: gắn link khi group thiếu, câu 178 / 240 kèm "(mã)"; chia sẻ: câu từng người như Desktop (không lấy mã làm câu, câu bỏ qua chính
  tài khoản gửi, câu "không xác định kết quả"); số đề xuất / lời mời nhận dạng chuỗi, đề xuất không có tên thì tên rỗng; gắn tag chỉ ghi khi đổi
  thành viên tag đích; phiên tag bị huỷ là `CampaignLabelSessionResetError` có `beforeCall`; tải tệp: đọc nội dung trong khối bắt lỗi, đuôi tệp
  như Desktop (URL → tên → loại nội dung), giữ tên hiển thị của cấu hình; mã tag như Desktop (`Number()`); SĐT / chữ dài để Zalo quyết định.
- Tải tệp một lần trước khi đánh dấu gửi (điểm 9, 14): lệnh mới `prepare_campaign_media` tải vào bộ nhớ đệm của runtime theo khoá
  `share-<lượt data>` (trùng khoá lõi dùng cho lô chia sẻ); lệnh gửi dùng lại và nhả (một data: ngay sau khi gửi; lô: người cuối); bộ nhớ đệm giữ 5
  phút kể từ lần dùng cuối, tối đa 4 khoá mỗi tài khoản; runtime bản cũ chưa có lệnh thì như trước (tải trong lệnh gửi).
- Lõi: câu lỗi khi Zalo trả mã mà câu rỗng là "Lỗi Zalo chưa xác định" (cả Desktop).
- **V512** (`scripts/build-v512-sql.cjs`, migration md5 `afaf9540…` sau khi đổi câu ghi chú lúc 21:40; **đã apply akachat 12/11 21:48:24 VN** theo yêu cầu "Apply V512", `20261112144814`, md5 sổ = file, không apply lại, luật id 94–102, hậu kiểm 16/16 ô đúng, 0 lỗi 5xx/503, không nạp lại schema; [biên nhận](../migrations/snapshots/fly-command-signal-rules-v512/apply-receipt.json)): 9 luật `fly_command` (source `v512`): `command_result_unknown`
  / `command_dispatch_failed` ở pha before_send → NET03; `runtime_payload_invalid` → NET03; `runtime_label_session_reset` before_send → NET03,
  in_flight → UNK01; `command_result_unknown` / `command_dispatch_failed` × gắn tag / đổi tên → NET01 (như Desktop). V511 đã có nhánh proxy
  giữ số. Smoke PG17: đúng 8/15 ô kiểm đổi, postflight chứng minh mọi ô khác, chính sách và lint giữ nguyên; tín hiệu Desktop không đổi.

**Kiểm:** check-all 25 bước (thêm smoke V512 và smoke lõi "Fly như Desktop"); ChatApi `npm run verify` 184 file / 2.644 test (thêm test cho chi
tiết lỗi, hàng lệnh, adapter theo Desktop, tải trước, PGlite lưu chi tiết lỗi). Chưa chạy bằng dữ liệu thật trên runtime Zalo thật.

**Phát hiện 20:30:** công tắc theo dõi tương tác Zalo bật lại 18:02 VN 12/11 (phiên khác, sau V510; đọc DB `true`), mà lõi đang trả chiến dịch
nhắn tin (theo SĐT, theo UID, chia sẻ cho bạn bè) về bộ cũ khi công tắc bật (`no('engagement_tracking')`) ⇒ deploy lúc này thì bộ mới chỉ còn chạy
loại không nhắn tin. Anh đồng ý làm phần ghi tương tác trong lõi trước khi deploy.

### 12/11 ~20:45–21:10 VN: ghi nguồn theo dõi tương tác trong lõi (chưa commit, chưa deploy)

Như bộ chạy cũ của từng nơi, không đổi DB:
- Lõi `zalo/engagement.ts`: nhắn người lạ / bạn bè (gửi thường và chia sẻ cho bạn bè) và kết bạn; nhắn group không theo dõi (như
  `engagementApplicable` của Desktop). Giữ chỗ ngay trước khi gửi (`engagementBegin`), gửi được thì dựng nguồn như `makeEngagementSource`
  (UID tài khoản / người nhận, mã tin lấy từ phản hồi của mọi lần gửi, giờ gửi, phiên bản cấu hình), ghi vào dữ liệu dòng lịch sử cùng
  `zaloEngagementPending: true` (+ trường của nơi chạy), giữ nguồn để khôi phục trước khi báo (`engagementStage`), đăng ký đúng mã dòng sau
  khi DB ghi (`engagementRegister`, qua `afterReport` của 7 loại nhắn tin; lô chia sẻ đăng ký sau `reportBatch`); gửi lỗi / chỉ tới một phần /
  bị dừng thì bỏ giữ chỗ. Lô chia sẻ cho bạn bè lấy mã tin của tệp và dòng chia sẻ khớp đúng người (`engagementMapped`).
- Desktop: đúng 4 hàm của `zaloCampaignEngagement` (`beginCampaignEngagementSend` với giờ gửi theo đồng hồ DB, Zalo Web không theo dõi;
  `stageCampaignEngagementSource(…, true)`; `recordCampaignEngagementDetail`; `abandonCampaignEngagementSend`).
- Fly: như `ZaloCampaignExecutor` (phiên bản từ `CampaignEngagementRepository.revision()`, `campaign.accountZaloUid`, giờ gửi lúc gửi) và
  dòng lịch sử mang `zaloEngagementRuntime: 'chat'` để bộ ghi tương tác của worker tự quét (`aka_agent_register_campaign_engagement`); đăng ký
  chỉ đánh thức bộ ghi. Kết quả chia sẻ của hai cổng thống nhất theo Desktop (`raw` là dòng của Zalo, có `engagementMapped`).
- Điều kiện chạy bộ mới: công tắc bật mà nơi chạy ghi được nguồn (`engagementSupported`) thì chạy bộ mới; Desktop và worker Fly đều báo có.

**Kiểm:** smoke mới `campaign-outcome-engine-engagement-smoke.cjs` (PG17, report_v1 thật: nguồn, cờ, đăng ký đúng dòng, gửi lỗi bỏ giữ chỗ,
kết bạn, group không theo dõi, điều kiện chạy); smoke bộ chạy Desktop thêm lượt chạy với công tắc bật (4 hàm của bộ cũ gọi đúng thứ tự, đúng
dòng); ChatApi chạy thật lô chia sẻ bạn bè có tệp (nguồn có mã tin của tệp và dòng chia sẻ, người chỉ nhận tệp không có nguồn, đánh thức bộ
ghi). check-all 26 bước; ChatApi `npm run verify` 184 file / 2.644 test; typecheck Desktop hai cấu hình sạch. Chưa thử với bộ ghi tương tác thật
(Desktop: hàng đăng ký trên máy; Fly: quét và RPC đăng ký) và sự kiện đã xem / phản hồi thật.

### 12/11 ~21:15–21:45 VN: phiên tag theo Desktop (anh chốt "Theo Desktop"; chưa commit, chưa deploy)

- **Trước:** runtime Fly huỷ phiên tag mỗi khi socket Zalo rớt (`disconnected` gọi `clearCampaignLabels`, có từ ChatApi `4729f79` 29/09), kể cả
  khi zca-js tự nối lại trên cùng phiên sau vài giây; lệnh tag sau đó báo "Phiên tag Zalo đã thay đổi". Desktop chỉ huỷ khi đổi phiên đăng nhập
  (`createCampaignLabelContext`: đổi đối tượng API, `invalidateAccount`, `clearQrRuntime`, phiên Zalo Web); listener `disconnected` / `closed` của
  Desktop chỉ đổi trạng thái hiển thị.
- **Đo 30 ngày trên Fly (chỉ đọc):** 49.237 lệnh gắn tag (16 tổ chức), 0 lỗi "Phiên tag"; lệnh đọc thành viên tag (dùng phiên tag của lượt, cho
  loại trừ gửi theo tag) chỉ 2 lần. Chiến dịch đang cấu hình loại trừ theo tag: 14 tài khoản Server / 8 tổ chức (đang chạy trên VPS), 5 tài khoản
  QR / 5 tổ chức. Fly cũ chưa gặp lỗi vì gần như chưa ai dùng phiên tag của lượt trên Fly; chuyển khách VPS sang Fly thì sẽ gặp.
- **Sửa** (ChatApi `packages/zalo-zca-adapter/src/index.ts`): `disconnected` chỉ báo trạng thái, không huỷ phiên tag. Vẫn huỷ khi kết nối đóng
  hẳn (`closed`: zca-js phát ngay sau `disconnected` khi không nối lại, vd bị đá 3003 / trùng phiên 3000, rồi runtime đăng nhập lại bằng phiên mới,
  tương đương Desktop đổi API), khi runtime dừng, nhả ngữ cảnh hay sang lượt khác. Đọc / ghi tag đi bằng HTTP của chính phiên đó nên vẫn chạy trong
  lúc socket chờ nối lại. Lệnh gắn tag không theo lượt theo cùng luật.
- **Ảnh hưởng:** adapter dùng chung cho bộ cũ của Fly ⇒ bộ cũ cũng không còn lỗi "Phiên tag" sau khi socket nối lại (chỉ có lợi). Có hiệu lực khi
  deploy `zalo_runtime` (đợt sửa này vốn đã cần). Luật V512 cho `runtime_label_session_reset` vẫn cần (đóng hẳn / dừng giữa lượt), chỉ đổi câu ghi
  chú (md5 mới `afaf9540…`).
- **Kiểm:** test vòng đời phiên tag 29 ca (thêm: bị đá vẫn huỷ; socket rớt khi đang ghi tag, đang đồng bộ danh sách tag hay giữa lượt thì không
  huỷ, lượt vẫn chỉ đọc danh sách tag một lần; đóng hẳn sau đó vẫn huỷ); đối chứng âm: 3 ca mới hỏng với adapter cũ, đạt với adapter mới; smoke
  V512 đạt; check-all 26 bước; ChatApi `npm run verify` 184 file / 2.647 test, chạy lại 2 file dùng V512 mới (19 test) đạt.

### 12/11 ~22:05–22:35 VN: công tắc Desktop theo cờ tổ chức (PR #651; V513 apply 22:30:48 VN)

- #650 merge vào `dev_3` lúc 22:08 VN khi Desktop còn chọn bộ mới chỉ theo bản cài ⇒ bản build kế tiếp từ `dev_3` sẽ chạy bộ mới cho tài
  khoản QR/Web của mọi khách. Anh chốt dùng chung cờ `org_organization.use_new_zalo_runtime` (cờ đang chọn bộ mới cho tài khoản Server trên Fly).
- Desktop chạy bộ mới khi **bản cài có bộ mới và tổ chức bật cờ**; thiếu một trong hai thì bộ cũ. Với tổ chức không Chat, bật cờ còn chuyển tài
  khoản Server của họ từ VPS sang Fly (V497).
- [V513](../migrations/migration_v513_engine_desktop_flag.sql): `aka_agent_engine_desktop_enabled_v1()` đọc cờ của tổ chức trong phiên Desktop
  (như V498), EXECUTE chỉ `aka_agent_desktop`. Desktop gọi một lần lúc đăng nhập, song song với V498, chỉ khi tổ chức có quyền Zalo
  (`AuthUser.campaignEngineV2`); `DesktopEngineRunner.support()` trả `org_flag_off` khi cờ tắt. Lỗi đọc, hết giờ hay DB chưa có V513 đều là cờ
  tắt, nên merge #651 trước khi apply V513 vẫn an toàn. Đổi cờ có hiệu lực khi đăng nhập lại (bước dọn data dở lúc đăng nhập đã có), không đổi bộ
  chạy giữa lúc chiến dịch đang chạy dở.
- Giới hạn: DB mất kết nối đúng lúc báo kết quả, rồi cờ bị tắt trước khi đăng nhập lại ⇒ kết quả còn trong nhật ký trên máy chỉ gửi bù khi bật lại
  cờ (data dở vẫn được đóng SYS01/SYS02, không gửi trùng).
- **Kiểm:** `node scripts/test-v513-engine-desktop-flag.cjs` 8 nhóm (PG17, hàm phiên Desktop nguyên văn bản live); smoke bộ chạy Desktop thêm ca
  công tắc (9 nhóm); check-all 27 bước; typecheck hai cấu hình sạch; `npm run build` đạt.
- **V513 đã apply akachat 12/11 22:30:48 VN** theo yêu cầu "Apply V513" (`20261112153048`, md5 sổ = file `15d206f3…`, không apply lại): chỉ
  `aka_agent_desktop` gọi được; gọi bằng phiên Desktop thật ra đúng cờ (false) và ngữ cảnh nhận đúng tổ chức; PostgREST nạp lại schema 1,6 giây,
  0 lỗi 5xx/503 (20 request chậm 1–1,3 giây đúng giây nạp lại); [biên nhận](../migrations/snapshots/engine-desktop-flag-v513/apply-receipt.json).

### 13/11 ~10:30–11:30 VN: kiêm akaBiz Sms trên Fly (anh: "làm đi nhưng chưa cần deploy"; ChatApi [#143](https://github.com/aligoinc/akaAgentChatApi/pull/143), chưa merge, chưa deploy)

- Trước đó, chiến dịch Server bật akaBiz Sms (không bật SMS nội bộ) chạy bộ cũ của Fly (`sms_push_external`), mà bộ cũ của Fly không đẩy SMS
  nào: tổ chức bật cờ mất tính năng này. Đếm production 13/11 (chỉ đọc): 8 nhân viên có tích hợp akaBiz Sms, 0 chiến dịch Server từng bật nó.
- ChatApi làm theo đường máy chủ của Desktop/VPS (`getAkaBizIntegrationsForStaff` + `normalizeIntegration`, `addSmsCampaignDetail`):
  - `CampaignEngineRepository.akaBizSmsIntegration`: đọc `org_staff.akabiz_integrations->'sms'` theo nhân viên, tổ chức, đang hoạt động; không
    thấy nhân viên thì lỗi "Không thể tải tích hợp akaBiz."; hợp lệ khi `staffId` (hoặc `id`) > 0 và có `username`. `aka_agent_chat_api` đã
    có quyền đọc cột này (kiểm production chỉ đọc), không cần migration.
  - `apps/system-worker/src/campaignEngine/akaBizSmsClient.ts`: POST `https://app.akabiz.net/api/Campaign/addDetailToSendSms`
    `{shopId, campaignId, phone, content}`, không xác thực, hạn 30 giây, không huỷ theo lượt chạy (như Desktop: đã gửi thì chờ xong để SMS
    không rơi vào trạng thái không rõ); thành công khi HTTP ok và `status = 1`, câu lỗi như `requestJson` của Desktop.
  - Cổng Fly có `pushExternalSms` khi worker có client (`main.ts` luôn truyền); `FlyEngineRunner.accepts` báo `externalSmsPush` cho lõi nên
    chiến dịch đó chạy bộ mới. Lõi không đổi hành vi (chỉ sửa chú thích): đẩy sau dòng lịch sử đủ điều kiện, mỗi data một lần trong lượt, lỗi
    chỉ cảnh báo, không đổi kết quả của data.
- Worker Fly thêm một đích gọi ra ngoài: `app.akabiz.net` (Desktop đã gọi đích này).
- **Kiểm:** ca mới ở ChatApi: client (đường dẫn, thân, câu lỗi, hạn giờ); cổng (đẩy từng shop, shop lỗi, chưa tích hợp, không đọc được tích
  hợp, worker không có client); repository (8 dạng dữ liệu tích hợp; sai tổ chức, đã nghỉ, không có nhân viên); bộ chạy trên RPC thật (data
  nhắn thành công đẩy một lần sang 2 shop, shop lỗi chỉ cảnh báo, kết quả data không đổi; data "không tồn tại" không được chọn thì không đẩy).
  ChatApi `npm run verify` 187 file, 2.687 test đạt (2 bỏ qua vì phải bật tay); bản chép lõi khớp nguồn 63 file; ranh giới lõi akaAgent sạch.

## 5. Phủ hiện tại và phần còn lại (12/11 ~04:10 VN)

**Phủ ước tính trên chiến dịch chạy 30 ngày** (đếm production 12/11, chỉ đọc; có chồng lấn nên là ước tính):

| Loại | Chiến dịch | Chạy bộ mới | Còn bộ cũ vì |
|---|---|---|---|
| `zalo_message_phone` | 6.072 | ~6.040 | loại trừ gửi 30 |
| `zalo_message_group_member` | 843 | ~826 | loại trừ gửi 17 |
| `zalo_message_friend` | 289 | ~179 | gửi dạng chia sẻ 102, loại trừ gửi 5, chưa lấy data lần nào 2, danh sách không gửi kiểu cũ 1 |
| `zalo_message_group` | 226 | ~130 | gửi dạng chia sẻ 96 |
| `zalo_add_group_member` | 37 | 37 | |
| `zalo_message_remarketing_customer` | 9 | 9 | |
| `zalo_join_group_link` | 7 | 7 | |
| `zalo_cancel_sent_friend_request` | 41 | 0 | lấy danh sách lời mời đã gửi đầu lượt (chưa làm) |
| sinh nhật, đề xuất, group thời gian thực | 7 | 0 | lấy data đầu lượt / theo sự kiện (chưa làm) |
| **Tổng** | **7.531** | **~7.230 (~96%)** | |

**Chiến dịch chưa phủ vẫn chạy bộ cũ như hôm nay, khách vẫn dùng được:** Desktop bản mới chạy bộ cũ có sẵn trong cùng bản cài; trên Fly, tổ
chức bật cờ chạy bộ cũ của ChatApi (khác Desktop ở D1–D6, doc §14.4).

**Phần còn lại, theo cỡ việc:**

| Phần | Chiến dịch 30 ngày | Cần làm | Ước lượng |
|---|---|---|---|
| Gửi dạng chia sẻ (bạn bè, group; kèm gửi lặp lại sau x phút) | 198 | Một lệnh Zalo gửi cho nhiều người (`forwardMessageToUsers/Groups`), trong khi lõi chạy từng data: cần nhận nhiều data một lượt, một dấu "sắp gửi" cho cả lô, báo kết quả từng người từ một phản hồi. Đổi thiết kế lõi + RPC mới | 1–2 ngày |
| Loại trừ gửi | 52 | RPC loại trừ (`aka_agent_campaign_send_exclusion_runtime`) đang xác minh bằng claim token của bộ cũ: cần bản nhận lease của bộ mới (migration mới); chép `src/shared/campaignSendExclusion.ts` vào lõi; đọc tag, bạn bè, hồ sơ, dữ liệu akaBiz; kết quả "bị loại trừ" → data tạm dừng kèm ghi chú (luật + chính sách mới) | 0,5–1 ngày |
| Huỷ lời mời kết bạn | 41 | Lấy danh sách lời mời đã gửi từ Zalo đầu lượt rồi huỷ từng người | 0,5 ngày |
| Sinh nhật, đề xuất, group thời gian thực, bạn bè lần đầu lấy data, danh sách kiểu cũ | 10 | Lấy data đầu lượt / theo sự kiện | 1 ngày |

**1.839 dòng khác của `replay-all-4`, đều đã giải thích:**
- 993 dòng: data chưa chạy tới ở bộ mới vì phát lại dồn 3 ngày vào một lượt (khoá 30 phút sau 127 theo Q4, hết lượt ngày).
- Theo bảng anh đã duyệt: người nhận chặn / không nhận tin (122, 119, 210) tính lượt (Q2, ~410 dòng); kết bạn lỗi không tính lượt (Q2, 16
  dòng); lỗi mạng giữa lúc gửi thành UNK01 (Q3, 16 dòng).
- DB thử tắt hạn mức theo giờ: bộ cũ bỏ kết bạn / nhắn tin khi chạm 9 lượt / 65 phút, bộ mới thì không (~320 dòng). Đối chiếu lịch sử: đúng 9
  lời mời mỗi 65 phút.
- Dữ liệu đã bị bộ cũ ghi đè sau lần chạy: data "Thêm thành viên vào group" đã được ghi UID sau lần tra số nên bộ mới không tra lại (44 dòng);
  tên trong data đã đổi thành tên Zalo nên tên gợi nhớ `#{INPUT_FULLNAME}` ra tên Zalo thay vì tên khách nhập (26 dòng; bộ mới cũng ghi đè
  như Desktop, `saveFoundUser`).
- Cắt tên gợi nhớ ≤ 50 ký tự (đã duyệt): 2 lượt 112 thành công.
- Câu lịch sử: mã ngắn ở cuối câu ("… (Z122)"), bộ cũ Fly có dấu chấm cuối câu.

## 6. Kế hoạch deploy (bước 1 đã làm 12/11 07:56 VN; V503–V508 apply 12/11 16:48–16:50 VN; V509 17:44 VN; các bước sau chờ anh bảo)

Thứ tự bắt buộc: V501 trước, ChatApi sau (bộ chạy mới gọi `finish_campaign_v2`, chỉ có sau V501). Mỗi bước có biên nhận trong
`migrations/snapshots/` như các bước trước.

**Bước 0 – kiểm chỉ đọc, ngay trước khi làm** (đã kiểm 04:07 VN 12/11, kết quả trong ngoặc; kiểm lại 07:55 VN ngay trước bước 1: không
đổi, DB không có truy vấn nào đang chạy):
- Sổ migration chưa có V501 (sổ dừng ở V500); thân `claim_target_v1` / `report_v1` đúng V499 `c1d965ca…` / `03e17d13…` (preflight của V501
  tự kiểm lại); chưa có `finish_campaign_v2`, CFG16, luật `action_waiting`; có chính sách `err_engine_gate_unavailable`.
- Không tổ chức nào bật cờ `use_new_zalo_runtime`; không lease nào của bộ mới (0 / 0).
- Hàm kết thúc Nhóm data `aka_agent_internal_finalize_data_group_campaign_v219` có md5 thân `7786668c…` (đúng bản dùng trong kiểm thử).
- ChatApi đang chạy: `api` + `worker` image `api-worker-dbb38b7-dev-20261112` (bản gỡ v2 lúc 01:18), `zalo_runtime`
  `runtime-binnet-jxl-2ec75c3-20261107`; `origin/dev` vẫn là `dbb38b7` nên worktree `akaAgentChatApi-deploy-dbb38b7` không phải dựng lại.
  `dev` có commit mới thì dựng lại phần v2 trên đầu `dev` rồi chạy lại `npm run verify`.

**Bước 1 – apply V501: ĐÃ LÀM 12/11 07:56:08 VN** (anh: "db đang nhẹ, apply luôn đi").
- Sổ migration `20261112005556`, md5 sổ = md5 file `94e309b5…`; md5 thân 4 hàm khớp postflight; quyền đúng (`finalize_v501` chỉ `postgres`).
- PostgREST nạp lại schema mất 4,3 s; p99 lên 658 ms trong 15 giây rồi về ~100 ms; 0 lỗi 5xx/503.
- Chưa có gì gọi các hàm này: ChatApi vẫn chạy image gỡ v2 (`api-worker-dbb38b7-dev-20261112`, release v175); 0 lời gọi
  `rpc/aka_agent_engine_*` qua PostgREST trong 12 giờ trước đó.
- [Biên nhận](../migrations/snapshots/engine-schedule-completion-v501/apply-receipt.json).

Cách làm (giữ để tra), ngoài giờ cao điểm (trước 09:30, 12:00–13:30 hoặc sau 17:00 VN):
- File `migrations/migration_v501_engine_schedule_completion.sql` (md5 `94e309b5…`, bản đã sửa theo review mục 8), cùng cách đã apply V495–V500: sinh file bọc có dòng sổ
  migration trong cùng giao dịch rồi chạy bằng CLI (không qua hộp xác nhận MCP):
  `node scripts/make-migration-ledger-apply.cjs migrations/migration_v501_engine_schedule_completion.sql migration_v501_engine_schedule_completion <file ra>`
  → `supabase db query --linked --workdir /Users/lequangnhut/Repos/akaAgent -f <file ra>`. Lỗi bất kỳ (preflight, postflight) thì cả giao dịch
  huỷ, sổ không ghi.
- Đổi: thân `claim_target_v1`, `report_v1`; thêm `finish_campaign_v2`, `finalize_v501`, cột `auto_engine_leases.campaign_schedule`, mã CFG16
  (`error_type = 'engine v2'`), luật `action_waiting`. Chỉ bộ mới gọi các hàm này; không tổ chức nào bật cờ, Desktop có bộ mới chưa phát
  hành ⇒ code cũ không đổi. Bộ kiểm danh mục của bản cũ (Desktop 8.2.0, 9.3.0, chat-sync) đạt với V501.
- Sau apply: `md5(statements[1])` của sổ = md5 file; postflight trong file tự kiểm md5 thân 4 hàm; theo dõi 5xx/503 trong `edge_logs` vài
  phút (PostgREST nạp lại schema).
- Gỡ: `migrations/rollback_v501_engine_schedule_completion.sql` (md5 `2bb5d0fa…`), trả thân V499.
- Bản thử Desktop 9.5.1-test-engine-v2 trên máy anh dựng trước V501: sau khi apply đừng mở lại bản đó, dựng bản thử mới.

**Thứ tự sau khi phủ thêm (12/11 ~09:50 VN, thêm V505 lúc 10:50, V506 lúc 11:10, V507 lúc 15:20):** apply V503 rồi V504 rồi V505 rồi V506
rồi V507 (ngoài giờ cao điểm; mỗi bản chỉ thêm hàm / mã / luật, V504 đổi cổng `send_exclusion` mà chỉ bộ mới đọc; V505 sửa thân
`claim_target_v1` nên preflight đòi đúng thân của V503; V506 sửa thân `finish_campaign_v2` nên preflight đòi đúng thân của V501, chỉ bộ mới
gọi hàm này; V507 bỏ nhớ theo tài khoản: viết lại `claim_target_v1` / `report_v1` / `resolve_policy` nên preflight đòi đúng thân của V505 /
V503 / V495, rồi xoá bảng, cột, dòng cổng) trước bước 2, vì ChatApi có bản phủ gọi `claim_batch_v1` / `report_batch_v1` / `send_exclusion_v1` /
`materialize_v1` / `sms_push_v1`. V507 không cần ChatApi hay Desktop bản mới (lõi không đổi). Số V502 thuộc nhánh khác (mục 7).
**V509** (112 khi nhắn người lạ / bạn bè như 118) đã apply 12/11 17:44:42 VN, chỉ dữ liệu, không nạp lại schema.
**V508** (126/127 khi nhắn group, 12/11 ~16:40) chỉ sửa dữ liệu một dòng chính sách, không DDL, không đổi hàm, không phụ thuộc V503–V507:
apply được trước, giữa hay sau chuỗi trên, không cần chờ ngoài giờ cao điểm. Chưa tổ chức nào bật cờ và chưa có Desktop bản mới thì không gì
đổi (bộ cũ đọc `auto_error`). Không cần ChatApi hay Desktop bản mới.

**Đã apply V503 → V508 lên akachat 12/11 16:48–16:50 VN** (anh: "Apply ngay"; biên nhận
`migrations/snapshots/engine-coverage-v503-v508/apply-receipt.json`):
- Kiểm trước (16:46, chỉ đọc): sổ tới V501 cho chuỗi engine, chưa có V503–V508 (bản mới nhất trong sổ là của nhóm chat lúc 14:21); thân hàm
  đúng như preflight từng bản đòi (`claim_target_v1` / `report_v1` / `finish_campaign_v2` = V501, `resolve_policy` = V495, hàm loại trừ cũ
  `ca4ba08f…`); bảng nhớ 0 dòng; 0 tổ chức bật cờ, 0 lease, lượt engine cuối 11/11 21:16 VN; 0 lời gọi engine qua PostgREST trong 24 giờ;
  không nhánh đang chạy nào (WebApp, ChatApi, ChatWeb, akaBizApi, Desktop `dev_3`) đọc `auto_target_memory` / `remember_target_days`.
- Apply từng bản, kiểm sổ và thân hàm ngay sau mỗi bản: V503 16:48:18, V504 16:48:50, V505 16:49:17, V506 16:49:27, V507 16:50:00, V508
  16:50:22. md5 sổ = file cả sáu.
- Hậu kiểm: 9 hàm engine `SECURITY DEFINER` (trừ `resolve_policy`), `search_path=""`, EXECUTE chỉ `postgres` / `service_role` /
  `aka_agent_chat_api` / `aka_agent_desktop` (`resolve_policy` chỉ `postgres` / `service_role`); bảng / cột / dòng cổng nhớ đã xoá, giá trị cũ
  lưu 150 dòng `auto_outcome_policy_history`; `auto_error` 137 dòng (7 mã mới đều `engine v2`); dòng 220 đúng V508 (revision 2), chính sách
  đã gộp đúng ở Desktop lẫn Fly; PostgREST nạp lại schema 5 lần (truy vấn 7,9 / 3,9 / 2,9 / 1,9 / 3,5 s, không lỗi; V508 không nạp lại);
  `edge_logs` 16:44–16:51: 0 lỗi 5xx / 503, p99 lên 0,8–1,9 s ở các khoảng 30 giây có nạp lại schema; job `close_stale` mỗi phút vẫn đạt.
- Gỡ: đúng thứ tự ngược V508 → V503; các file gỡ không tự kiểm thứ tự.

**Bước 2 – deploy ChatApi `api` + `worker`** từ `/Users/lequangnhut/Repos/akaAgentChatApi-deploy-dbb38b7` (như lần 11/11 17:05; **không dùng**
worktree cũ `akaAgentChatApi-campaign-engine-v2`, bản đó chưa có `finish_campaign_v2`, `maintenance_required`, nhớ giờ hẹn của `wait`):
`flyctl deploy --app aka-agent-chat-api --process-groups api,worker --image-label api-worker-dbb38b7-v2-cover-20261112`.
- Không tổ chức nào bật cờ ⇒ bộ mới không chạy; Chat và bộ chạy cũ như trước (phần định tuyến theo cờ, chép phiên, chặn ghi Chat đã chạy
  thật 11/11 17:05–12/11 01:00).
- Sau deploy: `flyctl status`, health, log; khoá leader của `worker` không kẹt (`pg_locks` advisory); chiến dịch của tổ chức có Chat vẫn
  phát lệnh.
- Gỡ: `flyctl deploy --app aka-agent-chat-api --process-groups api,worker --image registry.fly.io/aka-agent-chat-api:api-worker-dbb38b7-dev-20261112`.

**Bước 3 – bật cờ cho tổ chức thử 526** (tài khoản Server 2445): App Server thả trong ~1–1,5 phút, ChatApi chép phiên, không quét QR (đã chạy
thật cả hai chiều: App Server → Fly 11/11 17:05, Fly → App Server 12/11 01:00).
- Chạy thử mỗi loại 2–5 data: SĐT có ảnh/album + tag + đổi tên; thành viên nhóm; bạn bè; group; thêm thành viên vào group; vào group bằng
  link; Nhóm data; link từ chối. Ca lỗi: số không tồn tại, người nhận chặn người lạ, tắt app / khởi động lại worker giữa lúc chạy (không gửi
  trùng).
- Theo dõi: `auto_engine_target_runs` đóng hết, `auto_outcome_unmatched` < 1%, lịch sử và tiến trình trên Web/Desktop, không data kẹt
  "đang chạy".
- Gỡ: tắt cờ 526, App Server nhận lại, không quét QR.

**Bước 4 – Desktop:** dựng bản thử theo AGENTS.md + build-01..03, cài máy nội bộ, chạy tài khoản QR/Web; phát hành lên kênh cập nhật là
quyết định riêng (Desktop không có công tắc quay về bộ cũ).

## 7. Cần anh quyết

- **(12/11 11:30, đã bỏ cả tính năng 15:20) Câu lịch sử khi bỏ qua vì nhớ mục tiêu:** V507 nay bỏ hẳn nhớ theo tài khoản (mục 4,
  14:20–15:20), chưa apply.
- **(12/11 15:20) Kiểm "số không tồn tại" trên toàn hệ thống: tạm hoãn.** Số đo, x đề xuất theo mã và cách làm (bảng tóm tắt mỗi số một dòng)
  ở mục 4 (14:20–15:20).
- **(12/11 13:55, đã đổi số 14:05) Số V502 bị trùng.** Nhánh `claude/fervent-gates-c8ldgw` (cột "Giới hạn lượt" trên danh sách chiến
  dịch, đẩy lên origin 12/11 11:21 VN) có `migrations/migration_v502_campaign_limit_progress.sql`, chưa apply. Chuỗi engine lúc đó cũng giữ
  V502–V506 nhưng chỉ ở worktree này (chưa commit) nên phiên kia không thấy khi chọn số. Anh chọn đổi số engine: nay là V503–V507 (đọc lại
  sổ migration và `git log --all` ngay trước khi đổi: sổ mới tới V501, V503–V507 chưa nhánh nào dùng). Số chỉ thật sự được giữ khi commit /
  đẩy nhánh; trước khi apply vẫn kiểm lại sổ và `git log --all`.

1. **(Đã quyết 12/11 ~16:00: V508) Nhắn group gặp 126/127.** Anh chốt "Chỉ 126/127": group chặn riêng tài khoản, data hoàn thành, không
   khoá, không dừng; 112 giữ nguyên (mục 4, 15:30–16:40). Ghi chú cũ: bảng đã duyệt (Q4) coi là do tài khoản: data về hàng đợi, khoá 30 phút, 3 lần
   liền thì tạm dừng chiến dịch; bộ cũ ghi "thất bại" rồi đi tiếp. 510 dòng 127 trong mẫu 3 ngày đều thuộc 2 chiến dịch **gửi dạng chia sẻ**
   (15007, 50789), vẫn chạy bộ cũ. Production 30 ngày (đo 04:2x VN 12/11, chỉ đọc), group **gửi thường**: 182 chiến dịch, 42.422 lượt nhắn,
   126/127 chỉ 31 lượt (mã 127) ở 1 chiến dịch, chưa lần nào 2 lượt liền ⇒ Q4 không làm tạm dừng chiến dịch group nào. Cần quyết khi phủ gửi
   dạng chia sẻ.
2. **Giao một phần rồi 127** (album tới, chữ bị 127): V501 không tạm dừng chiến dịch theo chuỗi lỗi ở lượt đó, chỉ khoá như Q4. Không làm vậy
   thì chiến dịch dừng ngay sau lượt album đầu tiên (chiến dịch 48186). Đề xuất: giữ.
3. **Dòng "🚀 Bắt đầu chiến dịch …"**: bộ mới chỉ in khi thật sự nhận được data; Desktop in mỗi lượt kể cả khi không có gì chạy. Đề xuất: giữ
   cách mới (đỡ dòng thừa).
4. **Cấu hình sai** (CFG01 tệp không dùng được – đã duyệt; CFG10 Zalo Web gửi tệp không phải ảnh; CFG16 nội dung nâng cao rỗng): tạm dừng
   chiến dịch một lần kèm câu cụ thể, data giữ nguyên hàng đợi (bản cũ ghi lỗi từng data rồi dừng sau 4 data). Đề xuất: CFG10, CFG16 theo
   cùng cách CFG01.
5. **Bảng chẩn đoán `auto_zalo_api_error_logs`**: bộ mới không ghi (mã và câu lỗi Zalo nằm trong `auto_campaign_details.data`); không giao
   diện nào đọc bảng này. Đề xuất: không ghi.
6. **Commit**: mọi thay đổi đang chưa commit ở worktree akaAgent `.claude/worktrees/campaign-engine-v2` (nhánh `feat/campaign-engine-v2`)
   và ChatApi `akaAgentChatApi-deploy-dbb38b7` (nhánh `feat/campaign-engine-v2-zalo`, nền `dbb38b7`). Commit vào hai nhánh đó (không merge)?

**Khác biệt nhỏ đã biết, không cần quyết:**
- ~~Fly, thêm thành viên vào group mất mã Zalo~~ và ~~Fly, AI viết lại thiếu cấu hình không in dòng ⚠️~~: đã sửa ở ChatApi 12/11 ~18:00,
  chưa deploy (mục 4, 17:50–18:10).
- AI viết lại chạy sau dấu "sắp gửi": tắt app đúng lúc AI đang viết thì data đóng SYS02 thay vì SYS01; cả hai đều không gửi lại.

## 8. Đọc độc lập V501 trước khi lên production (12/11 ~04:15–05:00 VN)

Một agent đọc riêng SQL V501 (không xem kết luận của em), đối chiếu với bộ chạy Desktop và các hàm bản cũ. Không có lỗi lớn ở logic
chính (hoàn thành, nhiều khung giờ, Nhóm data, giữ tạm dừng của người dùng đều đúng). Các điểm tìm được, em kiểm lại bằng code rồi sửa
hết trong `scripts/build-v501-sql.cjs` (V501 sinh lại: migration md5 `94e309b5…`, file gỡ không đổi `2bb5d0fa…`):

| # | Điểm | Mức | Sửa |
|---|---|---|---|
| 1 | Vòng chống gửi lặp trong claim gọi RPC bản cũ tới 50 lần liền (~77–97 ms/lần) ⇒ một lần gọi từ Desktop có thể vượt trần 3 giây của vai trò `aka_agent_desktop`; quá trần thì cả lần gọi bị huỷ (kể cả data đã tạm dừng), lõi coi là lỗi tạm thời và gọi lại từ đầu mãi, chiến dịch đứng ở "Mất kết nối máy chủ (DB01)" | trung bình–cao | Ngân sách thời gian `engine.cooldown_scan_ms` (mặc định 1.500 ms, sửa được trong `auto_system_settings`): hết ngân sách thì trả `cooldown_scan`, data đã tạm dừng được giữ, lõi gọi lại ngay và đi tiếp |
| 2 | Giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời đếm mà không lấy khoá theo nhân viên như claim bản cũ (v397) ⇒ hai lượt bắt đầu cùng lúc cùng thấy N-1 và cùng vượt giới hạn | trung bình | Lấy đúng khoá `aka-agent-browser-run-limits:<nhân viên>` trước khoá dòng chiến dịch (chỉ khi bắt đầu lượt của tài khoản trình duyệt và nhân viên có giới hạn) |
| 3 | Nhánh Nhóm data hết hạn khoá dòng chiến dịch rồi mới gọi hàm kết thúc v219 (hàm này lấy khoá nạp data) — ngược thứ tự với luồng nạp Nhóm data ⇒ có thể deadlock, nạp data của khách lỗi 40P01 | thấp | Chiến dịch Nhóm data: lấy khoá nạp data `aka-agent-campaign-input-serialization:<id>` trước khoá dòng, như luồng nạp, v219 và `finish_campaign_v2` |
| 4 | Báo cáo kết quả trả "đã áp hiệu ứng chiến dịch" kể cả khi người dùng vừa tạm dừng (câu UPDATE không đổi dòng nào) ⇒ lõi in "⚠️ <ghi chú>" của ghi chú chưa hề ghi | thấp | Chỉ báo đã áp khi câu UPDATE đổi được dòng |
| 5 | Lượt không nhận data nào (ví dụ mọi data còn lại bị chống gửi lặp tạm dừng) hoàn thành mà giữ ghi chú chờ của lượt trước; bản cũ xoá ghi chú khi bắt đầu mỗi lượt | thấp | `finish_campaign_v2`: chiến dịch còn "chờ xử lý" (lượt không nhận data) thì xoá ghi chú trước khi hoàn thành / hẹn lại; lượt đã nhận data giữ ghi chú ghi trong lượt như bản cũ |
| 6 | `finish_campaign_v2` không kiểm token của bộ cũ (máy chưa cập nhật nhận chiến dịch giữa lúc lõi hết data và lúc kết thúc lượt) | thấp | Còn `runtime_claim_token` / `runtime_unit_token` thì trả `legacy_busy`, không đổi gì (như `release_v1`, `close_stale_v1`) |

- Điểm "ChatApi chưa xử lý `maintenance_required`, `finish_campaign_v2`, giờ hẹn của `wait`": agent đọc worktree cũ
  `akaAgentChatApi-campaign-engine-v2`; worktree deploy `akaAgentChatApi-deploy-dbb38b7` đã có đủ (`zaloCampaignScheduler.ts` xử lý
  `maintenance_required`, `campaignEngineRepository.ts` gọi `finish_campaign_v2`, `flyEngineRunner.ts` nhớ `wait.until` tối đa 5 phút).
- **Kiểm:** smoke V501 18/18 nhóm (thêm 3 nhóm: phiên thứ hai giữ từng khoá và claim phải đứng chờ đúng khoá đó, tài khoản QR / lượt đã
  giữ lease không lấy khoá; ngân sách thời gian với RPC chống gửi lặp chậm 5 ms; `legacy_busy` và ghi chú cũ), chạy 4 lần đều đạt;
  `campaign-outcome-engine-check-all.cjs` 15/15; bộ kiểm danh mục bản cũ đạt với V501 mới.
- ChatApi sau khi đồng bộ V501 mới (`sync-campaign-engine.cjs`, khớp nguồn 39 file): `npm run verify` 184 file, 2.611 test đạt.
- Phát lại dữ liệu thật với V501 mới (`replay-all-5`): y hệt `replay-all-4` (87/95 chiến dịch mẫu chạy bộ mới, 5.928 dòng khớp, 1.839 dòng
  khác đã giải thích); chỉ giờ "chạy tiếp lúc …" của các chiến dịch đang chờ khoá đổi theo giờ chạy phát lại.
