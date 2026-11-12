# Bảng duyệt mã và kịch bản Zalo (giai đoạn 1b)

> Engine kết quả v2 (V495) đã apply production 11/11/2026 16:53 VN với seed giữ hành vi cũ; mới bật cho tổ chức thử 526 (cờ `use_new_zalo_runtime`), Desktop chưa phát hành. Chưa áp đề xuất nào trong tài liệu này. Thiết kế: [CAMPAIGN_OUTCOME_ENGINE.md](CAMPAIGN_OUTCOME_ENGINE.md). Bản rà 453 nguồn lỗi: [CAMPAIGN_OUTCOME_ENGINE_ERROR_INVENTORY.md](CAMPAIGN_OUTCOME_ENGINE_ERROR_INVENTORY.md).

Seed của V495 **giữ đúng hành vi hiện tại** cho mọi mã lỗi đang có. Tài liệu này liệt kê:

- những chỗ engine khác hôm nay vì cấu trúc mới đã chốt (mục 2);
- bảng mã Zalo đúng như seed (mục 3);
- các đề xuất đổi chính sách, mỗi mục cần anh duyệt riêng (mục 4);
- kịch bản từng bước của `zalo_message_phone`, loại chạy thật đầu tiên (mục 5).

Chưa đề xuất dòng nào thì engine làm y như hôm nay. Bật chạy thật lần đầu chỉ sau khi anh duyệt xong bảng này: Fly, tổ chức chat-sync nội bộ, `zalo_message_phone`, chỉ gửi chữ.

## 1. Cách đọc

| Cột "Duyệt" | Nghĩa |
|---|---|
| Giữ | Engine làm y như hôm nay (đã kiểm bằng `scripts/campaign-outcome-engine-sql-smoke.cjs`: 66 cặp mã × thao tác khớp bộ giải quyết hiện tại, 385 cặp mã Zalo × thao tác phân loại khớp) |
| Đổi #n | Đề xuất ở mục 4, chỉ áp khi anh duyệt |
| Cấu trúc mới | Mã mới của engine, không có hành vi cũ tương ứng; nằm trong thiết kế đã chốt |

Áp một đề xuất đã duyệt là một câu SQL trên `auto_outcome_policies` hoặc `auto_outcome_signal_rules`:

- mỗi lần sửa tự tăng `revision` và ghi `auto_outcome_policy_history`;
- xem trước được bằng `aka_agent_engine_simulate_v1` hoặc `aka_agent_engine_report_v1(..., p_dry_run => true)`;
- không cần phát hành app.

## 2. Khác hôm nay vì cấu trúc mới (đã chốt)

| Tình huống | Hôm nay | Engine v2 |
|---|---|---|
| Data đã gửi được một bước, bước sau lỗi tạm thời (ví dụ đã nhắn tin, kết bạn lỗi mạng) | "Trả về hàng đợi" bị đổi thành **tạm dừng**; data kẹt vĩnh viễn (02/11: 3.131 data, 1.108 trong chiến dịch đã hoàn thành) | **Hoàn thành** kèm ghi chú và mã; không gửi lại |
| Tra số thành công rồi bước nhắn bị chặn trước khi gửi | Tra số tính là "đã thực hiện" nên data cũng bị tạm dừng | Tra số là thao tác chỉ đọc; data được trả về hàng đợi |
| App tắt, Fly reset, máy ngủ giữa chừng | Claim/lease cũ kẹt; phải gỡ tay; qua 00:00 đóng băng cả tenant | Lease 180 giây tự hết. pg_cron đóng data dở: có dấu "sắp gửi" → hoàn thành, SYS02, không gửi lại; chưa có dấu → hoàn thành, SYS01 (đặt `engine.stale_unsent_target_action=requeue` thì về hàng đợi) |
| Supabase sập / mạng của mình lỗi khi ghi kết quả | Có thể bị tính thành lỗi Zalo hoặc tạm dừng chiến dịch | Chờ, thử lại có backoff, hiện "Mất kết nối máy chủ, đang chờ để chạy tiếp (DB01)"; kết quả giữ trong nhật ký trên máy và gửi bù đúng một lần |
| Lệnh Fly không rõ kết quả: `command_result_unknown`, `command_dispatch_failed`, `campaign_media_timeout` | `waiting_socket` chặn lease tới khi gỡ tay; `command_dispatch_failed` tính là thất bại chắc chắn dù có thể đã gửi | UNK01: hoàn thành, không gửi lại, không chặn gì |
| Lệnh đọc quá giờ, runtime chưa sẵn sàng: `zalo_command_timeout`, `command_handler_unavailable`, `campaign_runtime_*` | Thất bại chắc chắn | NET03: data về hàng đợi, dừng lượt, không tính lượt |
| Ngoại lệ trong code của mình | Như hôm nay | SYS99, đúng như `handleCampaignBadTarget`: ghi "lỗi", 4 data liền thì tạm dừng chiến dịch |
| Cấu hình sai chỉ lộ ra lúc chạy (Zalo Web gửi PDF, quá số tệp, đuôi tệp bị chặn) | Lỗi lần lượt từng data | CFG10–CFG12: kiểm một lần đầu lượt, tạm dừng chiến dịch một lần với câu chỉ đúng tệp; không đốt data |
| Nội dung rỗng vì data thiếu cột dùng trong mẫu | Gửi rỗng hoặc lỗi tuỳ nơi | CFG13 theo data: hoàn thành, không tính lượt |
| Lượt chạy không ra kết quả nào | Data "hoàn thành" không lịch sử (thành công giả) | SYS07: ghi "lỗi" và đếm chuỗi lỗi |
| Dừng từ Web/Desktop, đăng xuất | Có nơi ghi thành "lỗi" | RUN01, không tính lỗi; data chưa gửi về hàng đợi |
| Dòng tiến trình | Câu không mã | Câu như cũ, thêm mã ngắn ở cuối: `❌ Người nhận chặn tin nhắn từ người lạ (Z122)` |

## 3. Bảng mã Zalo theo seed

Cột "Nghỉ" là có nghỉ giữa 2 lần gửi sau data đó không (hôm nay nghỉ sau mọi data). "Ảnh hưởng khác" áp ngay khi gặp lỗi; "dừng lượt sau data này" nghĩa là các bước còn lại của data đó vẫn chạy rồi mới dừng, như `stopAfterTarget` hôm nay.

<!-- BEGIN:ZALO_CODE_TABLE (sinh bởi scripts/campaign-outcome-engine-review-table.cjs) -->
| Mã | Lỗi | Mã Zalo · thao tác | Câu tiến trình hiện nay | Lịch sử | Tính lượt | Chuỗi lỗi | Data | Khoá | Ảnh hưởng khác | Nghỉ | Duyệt |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Z112 | Zalo từ chối gửi nội dung vào nhóm (mã 112) | 112 · nhắn nhóm | Zalo từ chối gửi nội dung vào nhóm này (mã 112) | thất bại | không | +1 | hoàn thành | — | — | có | Giữ |
| Z114 | Tham số không hợp lệ | 114 · mọi thao tác | Tham số không hợp lệ | thất bại | có | +1 | hoàn thành | — | — | có | Đổi #6 |
| Z118 | Nội dung quá dài | 118 · mọi thao tác | Nội dung quá dài | thất bại | có | +1 | hoàn thành | — | tạm dừng chiến dịch; dừng lượt sau data này | có | Giữ |
| Z119 | Người nhận chặn tin nhắn | 119 · mọi thao tác | Người nhận chặn tin nhắn từ bạn | thất bại | không | — | hoàn thành | — | — | có | Đổi #2 |
| Z120 | Zalo hạn chế thêm thành viên nhóm (mã 120) | 120 · thêm vào nhóm | Zalo hạn chế thêm thành viên nhóm (mã 120). Tạm khóa thêm thành viên nhóm đến 09:45 ngày mai. | không ghi | không | — | chờ xử lý | thêm vào nhóm tới 09:45 sau 1 ngày | dừng lượt sau data này | có | Đổi #3 |
| Z120 | Zalo hạn chế nhắn người lạ (mã 120) | 120 · nhắn người lạ | Zalo hạn chế nhắn người lạ (mã 120). Tạm khóa nhắn người lạ đến 09:45 ngày mai. | không ghi | không | — | chờ xử lý | nhắn người lạ tới 09:45 sau 1 ngày | dừng lượt sau data này | có | Đổi #3 |
| Z122 | Người nhận chặn tin nhắn người lạ | 122 · mọi thao tác | Người nhận chặn tin nhắn từ người lạ | thất bại | không | — | hoàn thành | — | — | có | Đổi #1, #2 |
| Z123 | Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 123) | 123 · nhắn bạn bè | Tin nhắn bị trùng lặp hoặc gửi quá nhanh | thất bại | có | — | hoàn thành | nhắn bạn bè 30 phút | dừng lượt sau data này | có | Giữ |
| Z123 | Zalo hạn chế nhắn nhóm do gửi nhanh hoặc trùng nội dung (mã 123) | 123 · nhắn nhóm | Tin nhắn bị trùng lặp hoặc gửi quá nhanh | thất bại | có | — | hoàn thành | nhắn nhóm 30 phút | dừng lượt sau data này | có | Giữ |
| Z123 | Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 123) | 123 · nhắn người lạ | Tin nhắn bị trùng lặp hoặc gửi quá nhanh | thất bại | có | — | hoàn thành | nhắn người lạ 30 phút | dừng lượt sau data này | có | Giữ |
| Z126 | Zalo hạn chế nhắn nhóm (mã 126/127) | 126/127 · nhắn nhóm | Tin nhắn bị trùng lặp hoặc gửi quá nhanh | thất bại | có | — | hoàn thành | nhắn nhóm 30 phút | dừng lượt sau data này | có | Giữ |
| Z126 | Zalo từ chối tin nhắn cá nhân (mã 126) | 126 · nhắn bạn bè, nhắn người lạ | Zalo từ chối tin nhắn cá nhân (mã 126) | thất bại | có | — | hoàn thành | — | — | có | Giữ |
| Z126 | Zalo từ chối lời mời vào nhóm (mã 126) | 126 · thêm vào nhóm | Zalo từ chối lời mời vào nhóm (mã 126) | thất bại | có | — | hoàn thành | — | — | có | Giữ |
| Z127 | Zalo hạn chế nhắn bạn bè do gửi nhanh hoặc trùng nội dung (mã 127) | 127 · nhắn bạn bè | Tin nhắn bị trùng lặp hoặc gửi quá nhanh | thất bại | có | — | hoàn thành | nhắn bạn bè 30 phút | dừng lượt sau data này | có | Giữ |
| Z127 | Zalo hạn chế nhắn người lạ do gửi nhanh hoặc trùng nội dung (mã 127) | 127 · nhắn người lạ | Tin nhắn bị trùng lặp hoặc gửi quá nhanh | thất bại | có | — | hoàn thành | nhắn người lạ 30 phút | dừng lượt sau data này | có | Giữ |
| Z161 | Nhóm Zalo không còn tồn tại (mã 161) | 161 · nhắn nhóm | Nhóm Zalo này không còn tồn tại (mã 161) | không tồn tại | không | — | tạm dừng | — | — | có | Giữ |
| Z178 | Đã là thành viên group | 178 · mọi thao tác | Đã là thành viên của group | đã là thành viên | không | — | hoàn thành | — | — | có | Giữ |
| Z210 | Người nhận bị Zalo chặn (mã 210) | 210 · tra số, kết bạn | Người nhận bị Zalo chặn (mã 210) | không tồn tại | không | — | hoàn thành | — | — | có | Đổi #1, #2 |
| Z215 | Người nhận không nhận lời mời kết bạn (mã 215/251) | 215/251 · kết bạn | Người nhận không nhận lời mời kết bạn (mã 215/251) | thất bại | có | — | hoàn thành | — | — | có | Giữ |
| Z216 | Zalo không tồn tại | 216/214/212 · mọi thao tác | Không tồn tại | không tồn tại | có | — | hoàn thành | — | — | có | Đổi #1, #2 |
| Z219 | Số điện thoại không hợp lệ (mã 219) | 219 · tra số | Số điện thoại không hợp lệ | không tồn tại | có | — | hoàn thành | — | — | có | Đổi #1, #2 |
| Z221 | Đạt giới hạn nhắn bạn bè (mã 221) | 221 · nhắn bạn bè | Đạt giới hạn nhắn bạn bè (mã 221) | thất bại | có | — | hoàn thành | nhắn bạn bè 60 phút | dừng lượt sau data này | có | Giữ |
| Z221 | Đạt giới hạn nhắn nhóm (mã 221) | 221 · nhắn nhóm | Đạt giới hạn nhắn nhóm (mã 221) | thất bại | có | — | hoàn thành | nhắn nhóm 60 phút | dừng lượt sau data này | có | Giữ |
| Z221 | Đạt giới hạn kết bạn trong giờ | 221 · kết bạn | Zalo hạn chế kết bạn trong giờ. Tạm nghỉ 60 phút | thất bại | có | — | hoàn thành | kết bạn 60 phút | dừng lượt sau data này | có | Giữ |
| Z221 | Đạt giới hạn tìm SĐT trong giờ | 312/221 · tra số | Đạt giới hạn tìm kiếm SĐT trong giờ | không ghi | không | — | chờ xử lý | tra số 60 phút | dừng lượt sau data này | có | Giữ |
| Z222 | Đã chấp nhận lời mời kết bạn | 222 · kết bạn | Đã chấp nhận lời mời kết bạn | thành công | có | — | hoàn thành | — | — | có | Giữ |
| Z223 | Danh sách yêu cầu kết bạn đã đầy | 223 · kết bạn | Danh sách yêu cầu kết bạn đã đầy (mã 223) | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng lượt sau data này | có | Giữ |
| Z224 | Danh bạ Zalo đã đầy (mã 224) | 224 · kết bạn | Danh bạ Zalo đã đầy (mã 224) | không ghi | không | — | chờ xử lý | kết bạn vô thời hạn | tạm dừng chiến dịch; dừng lượt sau data này | có | Giữ |
| Z225 | Đã là bạn bè | 225 · mọi thao tác | Đã là bạn bè | đã là bạn bè | không | — | hoàn thành | — | — | có | Giữ |
| Z227 | Link nhóm Zalo không hợp lệ (mã 227) | 227 · vào nhóm bằng link | Link nhóm Zalo không hợp lệ (mã 227) | thất bại | không | +1 | hoàn thành | — | — | có | Giữ |
| Z264 | Zalo không cho thêm trực tiếp thành viên (mã 264/269) | 264/269 · thêm vào nhóm | Zalo không cho thêm trực tiếp thành viên (mã 264/269) | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng lượt sau data này | có | Giữ |
| Z311 | Yêu cầu kết bạn không thành công | 311 · mọi thao tác | Yêu cầu kết bạn không thành công | thất bại | có | +1 | hoàn thành | — | — | có | Giữ |
| Z313 | Đạt giới hạn tìm SĐT trong ngày | 313/304 · mọi thao tác | Đạt giới hạn tìm kiếm SĐT trong ngày | không ghi | không | — | chờ xử lý | tra số tới hết ngày | dừng lượt sau data này | có | Giữ |
| Z314 | Đạt giới hạn mời người lạ vào group | 314 · mọi thao tác | Đạt giới hạn mời người lạ vào group | thất bại | có | — | hoàn thành | thêm vào nhóm 60 phút | dừng lượt sau data này | có | Giữ |
| Z600 | Phiên đăng nhập Zalo không hợp lệ | 600 · mọi thao tác | Zalo đã bị đăng xuất, vui lòng đăng nhập lại | không ghi | không | — | chờ xử lý | — | đánh dấu chưa đăng nhập; dừng lượt sau data này | có | Đổi #4 |
| Z802 | Zalo hạn chế thêm thành viên nhóm (mã 802) | 802 · thêm vào nhóm | Zalo hạn chế thêm thành viên nhóm (mã 802). Tạm khóa thêm thành viên nhóm đến 09:45 ngày mốt. | thất bại | có | — | hoàn thành | thêm vào nhóm tới 09:45 sau 2 ngày | dừng lượt sau data này | có | Đổi #3 |
| Z802 | Zalo hạn chế nhắn người lạ (mã 802) | 802 · nhắn người lạ | Zalo hạn chế nhắn người lạ (mã 802). Tạm khóa nhắn người lạ đến 09:45 ngày mốt. | không ghi | không | — | chờ xử lý | nhắn người lạ tới 09:45 sau 2 ngày | dừng lượt sau data này | có | Đổi #3 |
| Z999 | Thao tác Zalo thất bại | — · mọi thao tác | [a] thất bại: [x] | thất bại | có | +1 | hoàn thành | — | — | có | Đổi #5 |
| CFG01 | Không dùng được tệp media của chiến dịch | — · mọi thao tác | Không dùng được tệp media của chiến dịch | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng lượt sau data này | có | Giữ |
| CFG02 | Cấu hình chiến dịch chưa hợp lệ | — · mọi thao tác | Cấu hình chiến dịch chưa hợp lệ | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng lượt sau data này | có | Giữ |
| DAT01 | Dữ liệu đầu vào không hợp lệ | — · mọi thao tác | Dữ liệu đầu vào không hợp lệ | thất bại | không | — | hoàn thành | — | — | có | Giữ |
| DB01 | Chưa kết nối được máy chủ akaBiz | — · mọi thao tác | Chưa kết nối được máy chủ akaBiz | không ghi | không | — | chờ xử lý | — | chiến dịch về chờ; dừng lượt sau data này | có | Giữ |
| NET01 | Kết nối mạng tạm thời gián đoạn | — · mọi thao tác | Kết nối mạng tạm thời gián đoạn | không ghi | không | — | chờ xử lý | — | chiến dịch về chờ; dừng lượt sau data này | có | Giữ |
| NET02 | Proxy của tài khoản không kết nối được | — · mọi thao tác | Proxy của tài khoản không kết nối được | không ghi | không | — | chờ xử lý | — | chiến dịch về chờ; dừng lượt sau data này | có | Giữ |
| SYS05 | Thiết bị tạm ngừng kết nối khi ngủ | — · mọi thao tác | Thiết bị tạm ngừng kết nối khi ngủ | không ghi | không | — | chờ xử lý | — | chiến dịch về chờ; dừng lượt sau data này | có | Giữ |
| SYS99 | Lỗi không xác định | — · mọi thao tác | Có lỗi xảy ra | lỗi | không | +1 | hoàn thành | — | tạm dừng chiến dịch khi 4 data lỗi liền; bỏ bước còn lại | có | Giữ |
| CFG10 | Zalo Web chỉ gửi ảnh | — · mọi thao tác | — | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng chiến dịch; bỏ bước còn lại | không | Cấu trúc mới |
| CFG11 | Quá số tệp cho một tin | — · mọi thao tác | — | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng chiến dịch; bỏ bước còn lại | không | Cấu trúc mới |
| CFG12 | Đuôi tệp bị Zalo chặn | — · mọi thao tác | — | không ghi | không | — | chờ xử lý | — | tạm dừng chiến dịch; dừng chiến dịch; bỏ bước còn lại | không | Cấu trúc mới |
| CFG13 | Thiếu dữ liệu cho biến mẫu | — · mọi thao tác | — | thất bại | không | — | hoàn thành | — | bỏ bước còn lại | không | Cấu trúc mới |
| NET03 | Máy gửi chưa sẵn sàng | — · mọi thao tác | — | không ghi | không | — | chờ xử lý | — | dừng lượt sau data này; bỏ bước còn lại | không | Cấu trúc mới |
| RUN01 | Đã dừng | — · mọi thao tác | — | không ghi | không | — | chờ xử lý | — | dừng lượt sau data này; bỏ bước còn lại | không | Cấu trúc mới |
| SYS07 | Không có kết quả | — · mọi thao tác | — | lỗi | không | +1 | hoàn thành | — | bỏ bước còn lại | có | Cấu trúc mới |
| UNK01 | Không xác nhận được kết quả gửi | — · mọi thao tác | — | thất bại | nếu đã gửi | — | hoàn thành | — | bỏ bước còn lại | có | Cấu trúc mới |

54 mã; 46 luật mã Zalo → mã nội bộ (dựng 1:1 từ auto_error.zalo_error_codes × zalo_action_codes).
<!-- END:ZALO_CODE_TABLE -->

Mã chưa có luật riêng rơi vào Z999, đúng fallback `err_zalo_api_business_failed` hôm nay. Mỗi lần như vậy, engine ghi tín hiệu thô vào `auto_outcome_unmatched` để bổ sung luật; mục tiêu dưới 1% kết quả.

## 4. Đề xuất đổi (duyệt từng mục)

Mỗi mục kèm SQL áp sau khi duyệt. Chạy mô phỏng trước, ví dụ:

```sql
SELECT public.aka_agent_engine_simulate_v1('zalo_message_phone', 'fly',
  '{"actionCode":"zalo_find_phone_user","ok":false,"phase":"after_send","signal":{"kind":"zalo_code","code":"216"}}');
```

### #1 Không nghỉ sau data mà mục tiêu không nhận được (216, 219, 210, 122)

- **Hôm nay:** nghỉ đủ "Nghỉ giữa 2 lần" sau cả số không có Zalo, số sai, người nhận chặn người lạ. Chiến dịch đặt khoảng 300 giây mất khoảng 41% thời gian chạy để nghỉ sau 122 và số không tồn tại.
- **Đề xuất:** không nghỉ sau các mã này. Đo 02/11, mã 127 chỉ xảy ra khi tin người lạ trước đó gửi được trong vòng 5 phút (1.084/1.086 ca); 122 và số không tồn tại không tính vào nhịp đó.

```sql
UPDATE public.auto_outcome_policies SET pace_mode = 'none'
 WHERE source = 'seed_v495_error'
   AND error_code IN ('err_zalo_user_not_found', 'err_zalo_219_find_phone_invalid', 'err_zalo_210_target_unavailable',
                      'err_zalo_receiver_blocks_stranger_message');
```

### #2 Nhớ mục tiêu hỏng 30 ngày trong tổ chức (216, 219, 210, 122, 119)

- **Hôm nay:** chống gửi lặp chỉ xét lần gửi thành công, nên số không tồn tại và người chặn người lạ bị tra/gửi lại; hơn 99% hỏng lại.
- **Đề xuất:** nhớ 30 ngày trong tổ chức. Lần sau gặp đúng số đó và đúng thao tác đó, engine ghi "bỏ qua" (không tính lượt, không đổi chuỗi lỗi) và bỏ các bước phụ thuộc.
- **Giới hạn:** khoảng 80% lần lặp đến từ tổ chức khác, nên phạm vi tổ chức (đã chốt) chỉ chặn được phần còn lại.

```sql
UPDATE public.auto_outcome_policies SET remember_target_days = 30
 WHERE source = 'seed_v495_error'
   AND error_code IN ('err_zalo_user_not_found', 'err_zalo_219_find_phone_invalid', 'err_zalo_210_target_unavailable',
                      'err_zalo_receiver_blocks_stranger_message', 'err_zalo_receiver_blocks_message');
```

### #3 Bị hạn chế nhắn người lạ (802, 120): bỏ bước còn lại và hẹn lại data tới lúc hết khoá

- **Hôm nay:** không ghi lịch sử, khoá "nhắn người lạ", nhưng bước kết bạn của data đó vẫn chạy. Kết bạn được thì data hoàn thành dù chưa nhắn tin; không thì data về hàng đợi và chạy lại ngay khi còn khoá.
- **Đề xuất:** bỏ các bước còn lại của data đó và hẹn data tới đúng lúc hết khoá; tin nhắn sẽ được gửi sau, không bị mất.

```sql
UPDATE public.auto_outcome_policies SET remaining_steps = 'skip', target_effect = 'requeue_after'
 WHERE source = 'seed_v495_error'
   AND error_code IN ('err_zalo_802_message_stranger', 'err_zalo_120_message_stranger', 'err_zalo_120_add_group_member');
```

### #4 Phiên Zalo hỏng (600): bỏ các bước còn lại

- **Hôm nay:** đánh dấu chưa đăng nhập, nhưng các bước còn lại của data vẫn gọi Zalo và đều lỗi 600.
- **Đề xuất:** dừng các bước còn lại ngay; data về hàng đợi như hôm nay.

```sql
UPDATE public.auto_outcome_policies SET remaining_steps = 'skip'
 WHERE source = 'seed_v495_error' AND error_code = 'err_zalo_session_invalid';
```

### #5 Lỗi mạng tới Zalo không còn là lỗi nghiệp vụ (NET01 / UNK01)

- **Hôm nay:** `ECONNRESET`, `socket hang up`, quá giờ khi tải tệp rơi vào Z999: tính lượt, cộng chuỗi lỗi, đủ 4 data liền là tạm dừng chiến dịch. Pool proxy lỗi gây khoảng 8–10% hang up.
- **Đề xuất:**
  - trước khi gửi: NET01, data về hàng đợi, không tính lượt, không cộng chuỗi, không đổi trạng thái chiến dịch;
  - đang gửi: UNK01, hoàn thành, không gửi lại.

```sql
INSERT INTO public.auto_outcome_signal_rules (platform, action_code, phase, signal_kind, pattern, priority, error_code, source, note) VALUES
  ('zalo', NULL, 'before_send', 'errno', '*', 300, 'err_network_offline', 'review_1b', 'Lỗi mạng trước khi gửi'),
  ('zalo', NULL, 'before_send', 'timeout', '*', 300, 'err_network_offline', 'review_1b', 'Quá giờ trước khi gửi'),
  ('zalo', NULL, 'before_send', 'message_like', '%socket hang up%', 300, 'err_network_offline', 'review_1b', NULL),
  ('zalo', NULL, 'in_flight', 'errno', '*', 300, 'err_engine_unknown_delivery', 'review_1b', 'Đứt mạng khi đang gửi'),
  ('zalo', NULL, 'in_flight', 'timeout', '*', 300, 'err_engine_unknown_delivery', 'review_1b', 'Quá giờ khi đang gửi');
UPDATE public.auto_outcome_policies SET campaign_effect = 'none', pace_mode = 'none'
 WHERE source = 'seed_v495_error' AND error_code = 'err_network_offline';
```

### #6 Thiếu SĐT/UID do app tự đặt mã 114 → DAT01

- **Hôm nay:** app tự đặt mã 114 khi data thiếu SĐT/UID/ID nhóm/link hoặc khi chia sẻ tới chính tài khoản gửi; mã 114 tính lượt và cộng chuỗi lỗi, nên dữ liệu xấu đẩy chiến dịch tới tạm dừng.
- **Đề xuất:** DAT01: hoàn thành "thất bại", không tính lượt, không cộng chuỗi. Mã 114 do Zalo trả vẫn giữ như cũ.
- Áp dụng cho cả Fly v2: adapter báo SĐT thiếu hoặc sai định dạng bằng tín hiệu `target_missing_identity` (hôm nay luật vẫn ra mã của 114).

```sql
UPDATE public.auto_outcome_signal_rules SET error_code = 'err_input_invalid', source = 'review_1b'
 WHERE platform = 'zalo' AND signal_kind = 'engine' AND pattern IN ('target_missing_identity', 'forward_to_self');
```

### Để bàn sau (chưa đề xuất số)

- Nghỉ ít nhất 300 giây chỉ sau tin người lạ gửi **thành công** (đo 02/11: đặt "Nghỉ giữa 2 lần" ≥300 giây thì 0 lỗi 127).
- Bỏ "(mã 120)" trong câu cho khách vì đã có mã ngắn ở cuối.

## 4b. Fly bộ mới chạy theo Desktop (khác Fly bản cũ, cần duyệt)

Desktop/VPS là chuẩn (11/11): Fly bộ mới chạy đúng các bước, câu cho khách và chính sách của Desktop; không còn chính sách riêng cho Fly. Khách của tổ chức bật cờ sẽ thấy các khác biệt so với bộ chạy cũ của ChatApi:

| # | Tình huống | Fly bản cũ | Desktop = Fly bộ mới |
|---|---|---|---|
| D1 | SĐT không đúng dạng 9–15 chữ số nhưng không rỗng | Tự đặt 114, không gọi Zalo | Chỉ chặn SĐT rỗng (114); SĐT khác gửi Zalo tra |
| D2 | Bước lỗi không ghi lịch sử hoặc có khoá / đổi trạng thái (802/120, 221…) | Bỏ các bước còn lại (vd không kết bạn) | Chạy tiếp các bước còn lại, dừng lượt sau data đó |
| D3 | Tin rỗng sau khi dựng mẫu | 114 | Lỗi Zalo không mã (Z999), như Desktop |
| D4 | Câu lịch sử / tiến trình | "Đã tìm thấy SĐT …: Tên." (có dấu chấm) | Như Desktop: không dấu chấm, "Tìm SĐT: …", "Nhắn tin người lạ: …", "Kết bạn: …", mã ngắn ở cuối dòng lỗi |
| D5 | Không kiểm được danh sách từ chối nhận tin | Cảnh báo vào log và ghi chú data | Cảnh báo vào log |
| D6 | Người nhận từ chối nhận tin | Ghi chú không mã | Ghi chú và "🚫 Bỏ qua …" thêm "(OPT01)" |

Khác cả hai bản cũ vì cấu trúc mới (đã chốt, mục 4 của kế hoạch): lỗi ghi danh bạ / tên-UID không đổi kết quả tra số (F1); DB lỗi khi lấy nội dung xoay vòng thì data về hàng đợi (NET03); lượt dừng vì runtime chưa sẵn sàng nhả lease và tìm lại sau 1 phút; app tắt, Fly khởi động lại thì data dở đóng SYS01/SYS02, không gửi lại.

Chiến dịch dùng tính năng chưa tách sang lõi (media, nội dung nâng cao/định dạng, AI viết lại, link từ chối nhận tin, loại trừ gửi, gắn tag/đổi tên Zalo, tag akaBiz, chống gửi lặp, kiêm gửi SMS, nhóm data, chia sẻ) và mọi chiến dịch khi đang bật theo dõi tương tác Zalo vẫn chạy bộ cũ, ở cả Desktop lẫn Fly.

## 5. Kịch bản `zalo_message_phone` (tra số → nhắn người lạ → kết bạn)

Câu tiến trình theo đúng Desktop: dòng thao tác "<thao tác>: <câu>", không emoji khi có dòng lịch sử, "⚠️" khi chính sách không ghi lịch sử; mã ngắn ở cuối dòng lỗi. Desktop và Fly như nhau.

| Bước | Kết quả | Đã gửi trước đó | Data | Ảnh hưởng khác | Nghỉ | Tiến trình cho khách | Duyệt |
|---|---|---|---|---|---|---|---|
| Tra số | Có Zalo | — | sang bước nhắn | tính lượt tra | — | Tìm SĐT: Đã tìm thấy SĐT 0912…: Nguyễn Văn A | Giữ |
| Tra số | Không có Zalo (216/214/212) | — | hoàn thành "không tồn tại"; bỏ nhắn, kết bạn | tính lượt tra | có | Tìm SĐT: Không tồn tại (Z216) | Đổi #1, #2 |
| Tra số | SĐT không hợp lệ (219) | — | hoàn thành "không tồn tại" | tính lượt tra | có | Tìm SĐT: Số điện thoại không hợp lệ (Z219) | Đổi #1, #2 |
| Tra số | Hết lượt tra trong giờ (221/312) | — | chờ xử lý | khoá tra số 60 phút; dừng lượt | — | ⚠️ Tìm SĐT: Đạt giới hạn tìm kiếm SĐT trong giờ (Z221) | Giữ |
| Tra số | Hết lượt tra trong ngày (313/304) | — | chờ xử lý | khoá tra số tới hết ngày; dừng lượt | — | ⚠️ Tìm SĐT: Đạt giới hạn tìm kiếm SĐT trong ngày (Z313) | Giữ |
| Tra số | Phiên Zalo hỏng (600) | — | chờ xử lý | đánh dấu chưa đăng nhập; dừng lượt | — | ⚠️ Tìm SĐT: Zalo đã bị đăng xuất, vui lòng đăng nhập lại (Z600) | Đổi #4 |
| Tra số | Lỗi mạng | — | hoàn thành "thất bại" | tính lượt, +1 chuỗi | có | Tìm SĐT thất bại: … (Z999) | Đổi #5 |
| Nhắn tin | Thành công | — | sang bước kết bạn | tính lượt | — | Nhắn tin người lạ: Đã gửi tin nhắn đến Nguyễn Văn A | Giữ |
| Nhắn tin | Chặn người lạ (122) | — | kết bạn vẫn chạy; data hoàn thành sau đó | — | có | Nhắn tin người lạ: Người nhận chặn tin nhắn từ người lạ (Z122) | Đổi #1, #2 |
| Nhắn tin | Hạn chế nhắn người lạ (802/120) | — | không ghi lịch sử; kết bạn vẫn chạy | khoá nhắn người lạ tới 09:45 sau 1–2 ngày; dừng lượt | có | ⚠️ Nhắn tin người lạ: Zalo hạn chế nhắn người lạ (mã 802)… (Z802) | Đổi #3 |
| Nhắn tin | Gửi nhanh / trùng (123, 127) | — | hoàn thành "thất bại" | khoá nhắn người lạ 30 phút; dừng lượt | có | Nhắn tin người lạ: Tin nhắn bị trùng lặp hoặc gửi quá nhanh (Z127) | Giữ |
| Nhắn tin | Đứt kết nối khi đang gửi | — | hoàn thành; không gửi lại | Z999: tính lượt, +1 chuỗi; duyệt #5 thì UNK01, không cộng chuỗi | có | Nhắn tin người lạ thất bại: … (Z999) | Giữ; #5 đổi mã |
| Kết bạn | Thành công | đã nhắn | hoàn thành | tính lượt | có | Kết bạn: Đã gửi lời mời kết bạn đến Nguyễn Văn A | Giữ |
| Kết bạn | Lỗi mạng | **đã nhắn** | **hoàn thành**, không gửi lại tin (luật cố định, kể cả khi chính sách nói trả về hàng đợi) | Z999: tính lượt, +1 chuỗi; duyệt #5 thì NET01, không tính | có | Kết bạn thất bại: … (Z999) | Giữ; #5 đổi mã |
| Kết bạn | Lỗi mạng | chưa gửi gì (tắt nhắn tin) | Z999: hoàn thành "thất bại"; duyệt #5 thì chờ xử lý | duyệt #5: dừng lượt, không tính | có | Kết bạn thất bại: … (Z999); duyệt #5: ⚠️ Kết bạn: Kết nối mạng tạm thời gián đoạn (NET01) | Đổi #5 |
| Kết bạn | Đã là bạn (225) | — | hoàn thành "đã là bạn bè" | không tính lượt | có | Kết bạn: Đã là bạn bè (Z225) | Giữ |
| Kết bạn | Danh sách lời mời đầy (223) | — | chờ xử lý | tạm dừng chiến dịch | — | ⚠️ Kết bạn: Danh sách yêu cầu kết bạn đã đầy (mã 223) (Z223) | Giữ |
| Kết bạn | Danh bạ đầy (224) | — | chờ xử lý | khoá kết bạn vô thời hạn; tạm dừng chiến dịch | — | ⚠️ Kết bạn: Danh bạ Zalo đã đầy (mã 224) (Z224) | Giữ |
| Bất kỳ | App tắt trước bước gửi | — | hoàn thành (SYS01) hoặc về hàng đợi theo thiết lập | lease tự hết sau 180 giây | — | Bị ngắt trước khi gửi (SYS01) | Cấu trúc mới |
| Bất kỳ | App tắt sau dấu "sắp gửi" | — | hoàn thành (SYS02), không gửi lại | — | — | Bị ngắt khi đang gửi, không rõ kết quả… (SYS02) | Cấu trúc mới |
| Bất kỳ | Supabase sập | — | giữ nguyên, chạy tiếp khi DB sống lại | — | — | ⚠️ Mất kết nối máy chủ, đang chờ để chạy tiếp (DB01) | Cấu trúc mới |
| Bất kỳ | 4 data liền lỗi có tính chuỗi (114, 311, Z999…) | — | — | tạm dừng chiến dịch: "Dừng sau 4 data lỗi/thất bại liên tiếp (ngưỡng 4): …" | — | ⚠️ Dừng sau 4 data… (Z114) | Giữ |

Các loại chiến dịch Zalo khác dùng chung bảng mã ở mục 3, chỉ khác bước:

- **Nhắn bạn bè, chúc sinh nhật:** chỉ bước nhắn bạn bè. 221/123/127 khoá "nhắn bạn bè".
- **Nhắn nhóm:** 112 ghi thất bại và cộng chuỗi; 161 đưa data sang "tạm dừng" (V471).
- **Thành viên nhóm, theo thời gian thực, đề xuất, khách cũ:** nhắn người lạ + kết bạn, không tra số.
- **Thêm vào nhóm:** 120/802/314 khoá "thêm vào nhóm"; 264/269 tạm dừng chiến dịch; 178 "đã là thành viên".
- **Vào nhóm bằng link:** 227 link hỏng, cộng chuỗi.

Album nhiều tệp, giao một phần, chia sẻ vào nhóm (`mforward`) để giai đoạn 5.

## 6. Cần anh quyết

1. Duyệt hay không từng đề xuất #1–#6 (có thể duyệt một phần).
2. Có muốn đổi gì ở các dòng "Giữ" của mục 3 trước khi bật chạy thật không.
3. Duyệt mục 4b (D1–D6: Fly bộ mới chạy theo Desktop, khác Fly bản cũ).
