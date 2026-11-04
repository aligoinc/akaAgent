# Kiểm chứng nhập nội dung — 03/11/2026

Nhánh `codex/campaign-content-typing`, nền `5df2678f` (dev_3 sau PR #579).
PR #578 đã có trong nền; ba file form/controller của phép đo baseline không
khác `9080a12d`. Bản sửa này chưa merge/sync repo chính hoặc phát hành.

## Nguyên nhân và thay đổi

Ô nội dung chính cập nhật state form lớn mỗi phím. React development còn dựng
JSX/debug và StrictMode chạy render thêm; form thường có thông báo idle lặp từ
popover nội dung. Bản tối ưu chat/data trước đó chưa cô lập trường này.

Store theo từng form cập nhật plain snapshot/nháp đồng bộ, vùng Nội dung đăng ký
riêng. Form cha chỉ cập nhật khi cấu hình khác hoặc trạng thái rỗng đổi. Callback
Lưu, Preview và chèn token đọc content mới nhất qua view getter; dữ liệu lưu
không chứa getter. Context AI và bộ đếm SMS dựng trong vùng subscriber. Agent
theo dõi revision trực tiếp, cập nhật highlight/Hoàn tác khi bị sửa tay; setter
formData vẫn tham gia rollback. Bảng data form thường cache các dòng không đổi
như form Agent để giảm chi phí khi trạng thái hoàn thành đổi. Không tắt StrictMode hoặc bật React production
trong dev. Xem [hợp đồng](../../CAMPAIGN_CONTENT_TYPING.md).

## Phép đo và hồi quy

Electron thật, cùng fixture IPC/stores của form Agent, HTTP bị chặn. Fixture
form thường chỉ thay import component. Dùng JSX dev + StrictMode ở development;
production dùng React production. Gõ 37 ký tự sau một chuỗi không rỗng để tách
chi phí đổi trạng thái hoàn thành khỏi chi phí của từng phím. Số đo có overhead
automation, không phải SLA hoặc bằng chứng AI/DB production.

- `run-campaign-content-typing-smoke.cjs`: cả hai form; không/có 5.000 dòng;
  không render form cha hoặc gọi IPC theo phím; lưu/mở nháp ngay đủ chữ và data, sửa dòng ở cả trang một/hai;
  chèn token theo text/vùng chọn mới nhất; Preview, context AI/patch, lưu campaign;
  bộ đếm SMS và lưu HTML. AI/DB chỉ dùng fixture.
- `run-campaign-agent-typing-smoke.cjs`: giữ kiểm tra chat không render form,
  không clone/serialize danh sách, sửa data ở hai trang, nháp, nội dung gửi ngay
  và Hoàn tác bị vô hiệu khi sửa tay rồi trả về giá trị cũ.
- `run-campaign-agent-ui-smoke.cjs`: bộ hồi quy Agent hiện có, gồm import/draft,
  đổi loại/nguồn, nhiều section, hủy/timeout/phiên cũ và các nhóm nền tảng.
- `campaign-agent-smoke.cjs`: schema/scope/catalog, patch atomic, metadata local,
  nháp/Hoàn tác và route đạt. Guard checksum nguyên file form thường được thay
  bằng guard cách ly controller/chat vì người dùng đã yêu cầu tối ưu cả hai form;
  route sửa/nhân bản và kiểm thử dữ liệu vẫn giữ.
- Hai typecheck và `npm run build` production đều PASS; build cuối 27,30 giây,
  output 40.475.016 byte. Không build bộ cài, apply migration,
  deploy hoặc chạy provider/chiến dịch thật. Chưa kiểm Windows hay bộ gõ IME thật.

Lệnh đo độc lập (artifact đặt ngoài checkout khi điều tra):

```bash
CAMPAIGN_CONTENT_ARTIFACTS_DIR=/tmp/campaign-content node scripts/run-campaign-content-typing-smoke.cjs --baseline --small
CAMPAIGN_CONTENT_ARTIFACTS_DIR=/tmp/campaign-content node scripts/run-campaign-content-typing-smoke.cjs
CAMPAIGN_CONTENT_ARTIFACTS_DIR=/tmp/campaign-content node scripts/run-campaign-content-typing-smoke.cjs --production
```

| 37 ký tự, không nhập data | Dev trước | Dev sau | Production sau |
| --- | ---: | ---: | ---: |
| Form thường | 9.608 ms | 271 ms | 101 ms |
| Form Agent | 3.497 ms | 296 ms | 100 ms |

Có 5.000 dòng: dev sau 313 ms (thường), 356 ms (Agent); production sau 266/275 ms.
Ở cả hai chế độ và hai mức data, gõ tiếp không render form cha hoặc phát IPC.
Trước sửa, form thường render 126 lần, Agent 74 lần trong phép đo dev không data.

[Dev trước](typing-before-development.json), [dev sau](typing-after-development.json),
[production sau](typing-after-production.json), [smoke chat/nháp/Hoàn tác](agent-typing-regression.json).
Baseline lớn 5.000 dòng ở form thường từng vượt timeout 30 giây của automation;
không đưa lần timeout vào bảng so sánh. Bảng dùng phép đo baseline `--small`
hoàn tất; source ba file form/controller ở `9080a12d` và `5df2678f` giống nhau.

Kết quả cuối cùng ở [receipt](verification.json).

Trước PR, đã sửa smoke `--small`: phép đo vẫn dùng 0 dòng, sau đó thêm một
người nhận giả lập trước phần kiểm tra lưu chiến dịch. Không bỏ validation
hoặc dừng sớm bộ kiểm tra nội dung. Cả hai form đã chạy lại `--small` và đạt;
hai typecheck, production build và kiểm tra tài liệu được ghi riêng trong
[receipt trước PR](pr-verification.json). Các số đo so sánh ở trên giữ nguyên
theo lần đo trước đó; không dùng lần chạy song song với typecheck làm benchmark.
