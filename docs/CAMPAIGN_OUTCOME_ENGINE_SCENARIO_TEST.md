# Bộ kịch bản toàn diện cho engine v2 (13/11/2026)

Bộ thử chạy lõi `packages/campaign-engine` với DB thật của engine (V495–V512, V515, V517 trên PostgreSQL 17 cục bộ), dữ liệu dựng từ hồ sơ
production đã che, kết quả Zalo rút theo phân bố thật, cộng lỗi hạ tầng và các kịch bản sự cố. Không chạm DB thật, không gọi Zalo.
Đánh giá chính sách dựa trên kết quả này: [CAMPAIGN_OUTCOME_ENGINE_POLICY_REVIEW_20261113.md](CAMPAIGN_OUTCOME_ENGINE_POLICY_REVIEW_20261113.md).

## Chạy

```bash
CHAT_REPO=/Users/lequangnhut/Repos/akaAgentChatApi node scripts/engine-v2-scenarios/run.cjs --rounds 4 --targets 30 --chaos 3 --inject 0.01 --dbchaos 0.01 --out /tmp/scen.json
```

- `--skip-general` / `--skip-faults`: chỉ chạy kịch bản sự cố / chỉ chạy cấu hình mẫu. `--only 1,2`: chỉ các mẫu đó. `--seed`: đổi chuỗi ngẫu nhiên.
- Khoảng 2 phút trên máy này. Cùng seed thì cùng kết quả.
- Mã thoát 1 khi có vi phạm bất biến **mới** hoặc kịch bản sự cố lỗi. Vi phạm đã biết, chưa sửa (`KNOWN_INVARIANTS` trong `run.cjs`, hiện
  chỉ I1b, mục E1) vẫn in ra với chữ "đã biết" nhưng không làm mã thoát thành 1; sửa xong thì xoá khỏi danh sách.
- DB thử đi đúng thứ tự production: V495 → V512, V513 / V514 (không apply được trên fixture, ghi chú lý do), V515, V517.
  `SCENARIO_SKIP_MIGRATIONS=517` hoặc `=515,517` để chạy trên DB trước các bản đó (so trước / sau; V517 dựng trên V515 nên bỏ V515 thì bỏ
  cả 517). Thêm migration engine mới thì thêm vào `bootstrap()` của `run.cjs` rồi chạy lại.
- Module `pg` lấy từ akaAgentChatApi (`CHAT_REPO`), PostgreSQL 17 Homebrew (`PG17_BIN`), như các smoke engine khác. Chạy song song nhiều
  lần thì đặt `ENGINE_SCENARIO_PORT` khác nhau.

## Dữ liệu

`scripts/engine-v2-scenarios/fixtures/profile-20261113.json`, dựng bằng `mask-profile.cjs` từ các truy vấn chỉ đọc trên production lúc
01:39–01:46 VN 13/11. Không có SĐT, tên, UID hay nội dung thật: chữ tự do thay bằng chữ giả (giữ biến mẫu `#{…}` và xoay vòng `{a|b}`),
số dài thay bằng id giả bắt đầu `9999`, link và tên tệp thay bằng giả (giữ đuôi tệp). Bản thô chỉ nằm ở scratchpad của phiên.

| Phần | Nguồn | Dùng để |
|---|---|---|
| 150 cấu hình chiến dịch | mẫu theo loại của các chiến dịch chạy trong 7 ngày | dựng chiến dịch giả, đúng nơi chạy (Desktop QR / Web, Fly) |
| Phân bố kết quả | 543.856 dòng lịch sử 11–12/11, theo thao tác × trạng thái × mã × nơi chạy | tỉ lệ thành công / lỗi của từng thao tác |
| Câu lỗi Zalo | 400.001 dòng `auto_zalo_api_error_logs` 05–12/11 | mã Zalo / errno / câu cụ thể của từng mã lỗi |
| Danh mục | 102 luật, 274 chính sách, 136 mã lỗi, 5 cổng, 5 thiết lập engine | so lệch DB thử với production |

## Bộ thử làm gì

1. **Lệch danh mục**: so luật / chính sách / mã lỗi / cổng / thiết lập / luật trạng thái của DB thử với production. Kết quả 13/11: **khớp hoàn
   toàn** (0 dòng thiếu, 0 dòng khác), nên mọi kết quả dưới đây là của đúng chính sách đang chạy trên production.
2. **Từng luật đang bật**: dựng tín hiệu khớp từng luật (cả hai nơi chạy), mô phỏng bằng `aka_agent_engine_simulate_v1`, phải ra đúng mã.
   **200/202 đạt**; 2 ca còn lại là luật bắt-tất-cả của hệ thống (id 50) bị luật bắt-tất-cả của Zalo (id 47) che khi thao tác là Zalo, đúng
   thiết kế. Không mã nào thiếu mã công khai, không chính sách nào trỏ trạng thái sai. Bộ thử còn in bảng chính sách hiệu lực theo
   (thao tác, mã Zalo thật) kèm số lượt 7 ngày, dùng cho phần đánh giá chính sách.
3. **Chạy 150 cấu hình thật** trên đúng nơi chạy, 31 data mỗi chiến dịch, 4 vòng. Giữa hai vòng: người dùng bấm "Tiếp tục" một nửa chiến
   dịch đang tạm dừng, đăng nhập lại một nửa tài khoản bị đăng xuất; thời gian trôi 70 phút (lịch sử ra khỏi khung hạn mức giờ, khoá theo
   phút hết hạn). Chạy song song 6 chiến dịch.
4. **18 kịch bản sự cố cố định** (bảng dưới).
5. **15 bất biến** (bảng dưới), kiểm sau khi pg_cron giả đóng hết data dở.

**Cổng Zalo giả** (`port.cjs`, `world.cjs`):
- Mỗi người nhận có "tính cách" cố định cho từng thao tác (không có Zalo, chặn người lạ, đã là bạn bè…), rút theo tỉ lệ thật của nơi chạy.
- Mã do tài khoản (127, 221, 120/802, 312, 223, 314, 600) rút lại ở mỗi lần gọi theo tỉ lệ thật.
- Lỗi hạ tầng của dữ liệu thật (errno, `campaign_media_timeout`, "Failed to get account…", `-69`) rút mỗi lần gọi, nhân `--chaos`.
- Tiêm thêm `--inject` lỗi riêng của nơi chạy: Fly (runtime chưa sẵn sàng, lệnh không rõ kết quả, hết giờ, phiên tag bị xoá…) và
  Desktop ("Chưa có session Zalo", ECONNREFUSED, HTTP 502/429…).
- Lỗi dựng lại đúng như hai cổng thật đọc: chép logic `sendFailure` của cổng Desktop và `flyCommandFailure` của cổng Fly, dùng
  `zaloPortErrorFrom` / `mediaFenceError` của lõi.
- Lỗi trong chính cổng: ngoại lệ code (0,3%), treo tới hạn bước (0,2%), Zalo trả thành công không có `msgId` (3%), DB của mình lỗi khi
  lưu danh bạ (1%).
- Đủ thao tác của mọi loại: tra số, hồ sơ theo UID, nhắn tin / tệp, kết bạn, tag, đổi tên, tag akaBiz, thêm thành viên, vào group bằng link,
  huỷ lời mời, chia sẻ cả lô, lấy data đầu lượt (bạn bè, sinh nhật, đề xuất, lời mời đã gửi), loại trừ gửi (danh mục điều kiện giả đủ năm
  nguồn), danh sách không gửi, theo dõi tương tác, link từ chối nhận tin, AI viết lại.

**Cổng DB**: RPC thật của DB thử, kèm lỗi tiêm `--dbchaos`: "trước" (DB chưa nhận) và "sau" (DB đã làm, câu trả lời mất) cho report,
mark_sending, release; "trước" cho claim (mất câu trả lời của claim chỉ thử trong kịch bản riêng S4).

## Kết quả bản cuối (13/11 ~02:30 VN)

- **699 lượt chạy, 4.723 lần gửi, 4.999 kết quả**, 155 tổ hợp (loại chiến dịch × thao tác × nơi chạy × pha × mã × hiệu ứng), 23 mã lỗi khác
  nhau; Fly 3.604 kết quả, Desktop 1.395. Lỗi DB tiêm: 87 report trước, 56 report sau, 36/38 mark trước/sau, 29 claim trước.
- Lý do kết thúc lượt: hết data 119, chờ khoá / hạn mức 140, kết thúc lượt theo chính sách 62, dừng chiến dịch 23, **mất quyền 28, busy 80**
  (hai số này là phát hiện B bên dưới), còn lại là trạng thái bình thường (chiến dịch đã xong, đang tạm dừng…).
- **Không bất biến quan trọng nào bị vi phạm**: không gửi trùng, không data kẹt "đang chạy", không lease sót, không vượt hạn mức, data đã
  gửi / không rõ không bao giờ quay lại hàng đợi, runUnit không ném lỗi, câu cho khách không lộ mã nội bộ.

### Bất biến

| Mã | Nội dung | Kết quả |
|---|---|---|
| I1 | Không gửi lại cho data đã có thể nhận (thao tác gửi; tag / đổi tên / vào group / huỷ lời mời là làm lại vô hại theo V495, không tính) | đạt |
| I1b | Cùng một người nhận / nhóm hai lần trong một lệnh chia sẻ | **4** (data trùng trong chiến dịch, xem E) |
| I2 | Không data "đang chạy" / lượt data mở sau khi dọn | đạt |
| I3 | Không lease sót | đạt |
| I4 | Dòng lịch sử: trạng thái hợp lệ, câu không rỗng, không lộ `err_`, `[x]`, `{name}`, `undefined`, `null` | đạt |
| I5 | Kết quả lỗi luôn có mã công khai | đạt |
| I6 | Tín hiệu chưa có luật (về luật bắt-tất-cả) | 27 mẫu, đều là lỗi tiêm hoặc phát hiện A |
| I7 | Data đã gửi / gửi một phần / không rõ không về hàng đợi | đạt |
| I8 | Chiến dịch / tài khoản không kẹt "đang chạy" | đạt |
| I9 | runUnit không ném lỗi, lý do kết thúc đã biết, không `error` / `report_rejected` | đạt |
| I10 | Không vượt hạn mức ngày; không vượt hạn mức khung giờ (trừ huỷ lời mời: bản cũ cũng không kiểm hạn mức) | đạt |
| I11 | Mã ở cuối câu tiến trình có trong danh mục; câu không lộ chữ kỹ thuật | đạt |
| I12 | Chỉ đăng ký theo dõi tương tác cho dòng gửi thành công | đạt |
| I13 | Lỗi ghi danh bạ không làm tra số thất bại (F1) | đạt (20 lần lỗi DB tiêm) |
| I14 | Không gửi tên gợi nhớ > 50 ký tự, chữ rỗng, mẫu chưa thay | đạt |
| I15 | Data gửi thành công không còn ghi chú lỗi của lần trước | **35** (phát hiện D) |

### Kịch bản sự cố

| | Kịch bản | Kết quả |
|---|---|---|
| S1 | DB sập 6 lời gọi liền giữa lượt rồi sống lại | đạt: chờ rồi chạy tiếp, câu "Mất kết nối máy chủ (DB01)" / "đã kết nối lại", không gửi trùng |
| S2 | Mất câu trả lời của report (DB đã ghi), mỗi lần thứ hai | không ghi trùng lịch sử, hạn mức đúng; **nhưng lượt dừng "mất quyền"** (phát hiện B) |
| S3 | Mất câu trả lời của mark_sending | đạt: gửi đúng một lần |
| S4 | Mất câu trả lời claim giữa lượt | **lỗi: data bị đóng SYS01 dù chưa gửi** (phát hiện C) |
| S4b | Mất câu trả lời claim đầu lượt | **lỗi: tài khoản busy tới khi lease hết hạn, rồi data bị đóng SYS01 dù chưa gửi** (C) |
| S5 | Chết sau khi gửi, nhật ký bền (Desktop SQLite) | đạt: lượt sau gửi bù đúng kết quả thật, không gửi lại |
| S6 | Chết sau khi gửi, mất nhật ký (Fly) | đạt: đóng SYS02 "không rõ kết quả", không gửi lại, data sau chạy tiếp |
| S6b | Chết sau dấu "sắp gửi", trước khi gọi Zalo | đạt: SYS02, không gửi lại (đúng thiết kế) |
| S7 | Chết khi đang tra số (chưa có dấu "sắp gửi") | theo thiết lập `complete`: đóng SYS01, không gửi |
| S8 | Lease hết hạn và máy khác nhận tài khoản giữa lượt | đạt: dừng ngay, không gửi gì sau khi mất quyền |
| S9 | Hai bộ chạy cùng lúc trên một tài khoản | đạt: một bên busy, không gửi trùng |
| S10 | Tạm dừng chiến dịch từ Web giữa lượt | đạt: dừng sau data đang xử lý, câu dừng như Desktop; Tiếp tục thì chạy hết |
| S11 | Đăng xuất tài khoản giữa lượt | đạt: dừng sau data đang xử lý, data chưa chạy vẫn chờ |
| S12 | Thoát app khi lệnh gửi đang treo | đạt: data đó không bị gửi lại |
| S13 | Hết lượt trong ngày (3 lượt) | đạt: gửi đúng 3 rồi chờ "Đạt giới hạn trong ngày (LIM01)" |
| S14 | Qua giờ dừng trong ngày | đạt: không nhận data |
| S15 | Chống gửi lặp 3 ngày giữa hai chiến dịch cùng nhân viên | đạt: chiến dịch sau tạm dừng cả 4 số đã gửi (hàm chống gửi lặp là bản thay theo hợp đồng V367) |
| S16 | S4b và S7 khi đặt `engine.stale_unsent_target_action = requeue` | đạt: data về hàng đợi rồi gửi đúng một lần |

## Sau khi sửa (13/11 ~10:15 VN)

- **A** đã sửa ở code Desktop (chưa phát hành): `zaloRuntimeService` gắn dấu "trước khi gọi Zalo" cho lỗi của bước chuẩn bị, cổng v2 xếp
  `before_send` → NET01. Bộ thử này chưa mô phỏng bản sửa (cổng Desktop giả chép từ code cũ), nên phần "tín hiệu chưa có luật" vẫn thấy
  "Failed to get account Zalo session" → UNK01; kiểm bản sửa ở `campaign-engine-desktop-smoke.cjs` D2b/D2c.
- **B, C, D** đã sửa ở [V515](../migrations/migration_v515_engine_report_replay_note_requeue.sql) (merge `dev_3` qua #659, chưa apply
  production). Lúc đó bộ thử chỉ nạp V515 khi đặt `SCENARIO_V515=1`; nay luôn nạp (xem mục "Sau V517"). Cùng dữ liệu và cùng seed, chạy
  trước và sau:

  | | Trước V515 | Sau V515 |
  |---|---|---|
  | Lượt dừng "mất quyền" | 14 | 0 |
  | Lượt "busy" | 28 | 2 |
  | S2 mất câu trả lời report chốt data | lỗi | đạt |
  | S4 / S4b mất câu trả lời claim | lỗi (SYS01 dù chưa gửi) | đạt |
  | I15 ghi chú cũ sau khi gửi thành công | 20 | 0 |
  | Kịch bản sự cố lỗi | 3 | 0 |

  Còn lại I1b (data trùng trong lô chia sẻ, mục E1, bộ cũ cũng vậy). C chỉ trả về hàng đợi lượt chưa có kết quả nào
  (`requeue_unstarted`), không phải `requeue` như đề xuất ban đầu: kiêm SMS đẩy SĐT ngay sau mỗi lần báo kết quả mà không lọc trùng, nên
  chạy lại lượt đã có kết quả có thể đẩy SMS lần hai. Claim đầu lượt mất câu trả lời vẫn "busy" tới khi lease hết hạn (chưa sửa gốc).
- **E2** (đăng ký theo dõi tương tác khi report trả `replay`) chưa sửa: `registerZaloEngagement`
  ([engagement.ts:135](../packages/campaign-engine/src/zalo/engagement.ts:135)) vẫn bỏ qua quyết định `replay`.

## Sau V517 (13/11 ~16:30 VN)

Bộ thử nay luôn nạp V515 và [V517](../migrations/migration_v517_engine_retention.sql) (dọn bảng 30 ngày; `decision` chỉ còn `result` +
`contrib`, nên bảng phủ đọc hiệu ứng từ `contrib`). Cùng lệnh ở mục "Chạy", seed 1:

| | V515 + V517 | Chỉ V515 (`SCENARIO_SKIP_MIGRATIONS=517`) | Trước V515 (`=515,517`, chỉ kịch bản sự cố) |
|---|---|---|---|
| Lượt / lần gửi | 702 / 5.194 | 702 / 5.194 | 37 / 175 |
| Kịch bản sự cố lỗi | 0 / 18 | 0 / 18 | 3 (S2, S4, S4b) |
| Vi phạm bất biến mới | 0 | 0 | 1 |
| Vi phạm đã biết | I1b (4 ca, E1) | I1b (4 ca, E1) | — |
| Mã thoát | 0 | 0 | 1 |

- V517 không đổi hành vi: hai cột đầu trùng nhau tới từng lý do kết thúc lượt (`busy` 16, `ownership_lost` 1 là của kịch bản S8 mất lease).
- Bỏ V515 thì bộ thử vẫn bắt lại đúng ba lỗi cũ, nên nó còn phát hiện được lỗi loại này.
- Lệch danh mục: `settings` thử có thêm 1 dòng (`engine.retention_days` của V517) và khác 1 dòng (V515) so với hồ sơ production 13/11, vì
  production chưa apply hai bản đó. Apply xong thì dựng lại hồ sơ bằng `mask-profile.cjs` để lệch về 0.
- Rà hồ sơ đã che (13/11): 12.266 chuỗi, 0 SĐT, 0 email; số dài đều là `0000…` hoặc id giả `9999…`; link đều `cdn.example.test`; tên
  miền chỉ có máy chủ API của Zalo trong câu lỗi.

## Phát hiện

### A. Desktop: lỗi đọc DB của chính app trước khi gọi Zalo bị xếp "không rõ đã gửi" (nên sửa trước khi phát hành 9.6.0)

- `zaloRuntimeService.ensureApi` đọc tài khoản và phiên từ Supabase **trước** khi gọi Zalo
  ([accountRepository.ts:151](../src/main/data/repositories/accountRepository.ts:151) "Failed to get account: …",
  [:215](../src/main/data/repositories/accountRepository.ts:215) "Failed to get account Zalo session: …", cùng kiểm gói / loại tài khoản).
- Cổng v2 của Desktop chỉ coi 3 câu là lỗi trước khi gọi ([desktopZaloPort.ts:65](../src/main/engineAdapters/desktopZaloPort.ts:65));
  các câu trên rơi vào `classifyZaloError(send, answered=false)` → pha `in_flight` → **UNK01**: data đóng "không gửi lại", trừ lượt
  (`count_if_committed`, dấu "sắp gửi" đã ghi), cộng chuỗi lỗi (4 lần liền → tạm dừng chiến dịch). Thực tế chưa gửi gì.
- Production 05–12/11 (bộ cũ, Desktop): 912 lượt nhắn người lạ, 55 nhắn nhóm, 16 nhắn bạn bè, 4 huỷ lời mời có đúng câu này (≈ 990/tuần).
  Với bộ mới, các data này bị đóng UNK01 thay vì chạy lại. Đợt DB chỉ đọc 12/11 là đúng kiểu lỗi này.
- Bộ thử thấy: `zalo_message_stranger/in_flight "Failed to get account Zalo session: TypeError: fetch failed" → err_engine_unknown_delivery`.
- Sửa: `ensureApi` gắn cờ "lỗi trước khi gọi Zalo" cho mọi lỗi của nó (đọc tài khoản, phiên, gói, đăng nhập lại bằng phiên), cổng v2 đọc
  cờ đó → `before_send` → NET01 (data về hàng đợi, khoá 5 phút theo Q5). Chỉ sửa code Desktop, không đổi DB.

### B. Mất câu trả lời của lần báo chốt data: lượt dừng như mất quyền, tài khoản đứng ~3 phút

- `aka_agent_engine_report_v1` tính `v_lease_ok := v_run_open AND <lease còn>`. Lần báo đầu đã đóng lượt data; câu trả lời mất (mạng, hết
  giờ 20 giây); lõi gửi lại cùng `result_key` → DB thấy lượt đã đóng → `next = 'ownership_lost'`
  ([migration_v507:984](../migrations/migration_v507_engine_drop_target_memory.sql:984)).
- Lõi coi là mất quyền: dừng lượt, **không nhả lease**; tài khoản "busy" với mọi lượt sau tới khi lease hết hạn (180 giây), chiến dịch hiện
  "đang chạy" trong lúc đó. Không mất data, không gửi trùng.
- Bộ thử: với 1% câu trả lời report bị mất, 4 vòng chạy cấu hình mẫu có 26 lượt dừng kiểu này, kéo theo 74 lượt "busy" ở các vòng sau. Kèm
  theo (E2 bên dưới): đăng ký theo dõi tương tác của tin đó bị bỏ.
- Sửa (SQL): khi gọi lại trên lượt data đã đóng bởi chính lease này mà lease còn hạn, trả lại chỉ thị đã trả lần đầu (lưu `next` khi chốt)
  thay vì `ownership_lost`, không áp lại hiệu ứng.

### C. Mất câu trả lời của claim: data bị đóng "Bị ngắt trước khi gửi (SYS01)" dù chưa gửi

- Claim không idempotent. Giữa lượt: claim đã chuyển data X sang "đang chạy" và mở lượt data; câu trả lời mất; lõi claim lại (cùng lease)
  và nhận data Y. Lượt data của X bị bỏ; sau ≥ 10 phút pg_cron đóng X thành **"hoàn thành" SYS01** vì `engine.stale_unsent_target_action =
  complete`. Đầu lượt: chưa có lease token nên lần claim lại gặp `busy` của chính mình
  ([migration_v507:232](../migrations/migration_v507_engine_drop_target_memory.sql:232)), tài khoản đứng tới khi lease hết hạn.
- Xảy ra khi mạng chập chờn (Desktop) hoặc claim chậm quá hạn 20 giây của lõi (DB quá tải: claim còn quét chống gửi lặp).
- Sửa nhanh, chỉ dữ liệu: đặt `engine.stale_unsent_target_action = requeue`. An toàn vì mọi bước gửi đều ghi dấu "sắp gửi" trước khi gọi
  Zalo, nên lượt data chưa có dấu chắc chắn chưa gửi gì (S16 đạt). Sửa gốc: claim cùng lease trả lại lượt data còn mở chưa có dấu / kết quả;
  claim đầu lượt cùng `runner_id` trả lại lease đang giữ.

### D. Data gửi thành công vẫn giữ ghi chú lỗi của lần trước

- Data về hàng đợi kèm ghi chú (NET01, NET03, CFG01, Z127, SYS01…), lần sau gửi thành công: report chỉ ghi `note` khi có câu mới
  (`note = CASE WHEN v_note IS NOT NULL THEN v_note ELSE note END`), claim cũng không xoá. Khách thấy data "hoàn thành" với ghi chú
  "Mất kết nối tới Zalo, tạm ngưng tài khoản tới 02:28 13/11 (NET01)".
- Bộ thử: 35 data. Sửa (SQL): data chốt thành công thì xoá ghi chú cũ (hoặc claim xoá ghi chú khi nhận lại data).

### E. Nhỏ

1. **Data trùng trong cùng chiến dịch gửi dạng chia sẻ**: hai dòng cùng nhóm / người nằm chung một lô thì một lệnh chia sẻ có cùng thread hai
   lần (I1b, 4 ca). Gửi thường cũng gửi hai lần (mỗi dòng một lượt) trừ khi bật chống gửi lặp. Bộ cũ cũng vậy. Có thể bỏ thread trùng trong
   lô ở `claim_batch_v1`.
2. **Đăng ký theo dõi tương tác bị bỏ khi câu trả lời report bị mất**: `registerZaloEngagement` bỏ qua quyết định `replay`, nhưng lần đầu
   chưa từng đăng ký (runner không thấy câu trả lời). Bộ thử: 11 tin. Sửa: đăng ký cả khi replay nếu đăng ký theo `detail_id` là idempotent.
3. **Tag nguồn hỏng** (bạn bè theo tag): chiến dịch tạm dừng với ghi chú "Lượt chạy gặp lỗi: Tag Zalo không tồn tại", không có mã công khai
   như các câu khác.
4. **Câu cho khách** lặp mã: "Zalo từ chối gửi nội dung vào nhóm này (mã 112) (Z112)", "… (mã 127), chạy tiếp lúc … (Z127)". Câu cảnh báo
   của cổng từ chối nhận tin gắn nguyên câu lỗi kỹ thuật ("…: fetch failed").

## Giới hạn

- Không có Zalo / runtime Fly / Electron thật: cổng giả dựng lỗi theo logic chép từ hai cổng. Chỗ nào cổng thật khác bản chép thì bộ thử
  không thấy (ví dụ thứ tự lệnh của runtime).
- Fixture DB thiếu hàm của production: kiểm gói Zalo, khung giờ nhân viên, giới hạn tài khoản Web chạy cùng lúc không có (claim bỏ qua);
  chống gửi lặp là bản thay theo hợp đồng V367; V513 / V514 không apply được trên fixture (không ảnh hưởng claim / report).
- Thời gian trôi giữa vòng là xấp xỉ (lùi giờ lịch sử, mở khoá theo phút); khoá theo ngày giữ nguyên.
- Kiêm SMS, akaBiz Sms, nhóm theo thời gian thực, nhiều khung giờ có trong cấu hình mẫu nhưng ít; không có kịch bản riêng.
- Tỉ lệ của thao tác ít dữ liệu (vào group bằng link, sinh nhật) dựa trên rất ít dòng nên không đại diện.
