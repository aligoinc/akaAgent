# Ô nhập chung và kéo thả file Agent — 03/11/2026

Source trên nhánh `codex/campaign-agent-composer`, nền `dev_3` sau merge PR #576
(`7a9fb192`). Chưa đưa bản sửa này vào repo chính hoặc phát hành Desktop.

- Ô nhập mặc định 40px, tự giãn tối đa 120px; cả khung nhập và toolbar cao 90px khi rỗng. Dán danh sách/bảng trực tiếp vào ô yêu cầu, bỏ nút mở ô Dán data riêng. Với nguồn chưa nhận diện, dùng **Dùng nội dung ô nhập làm dữ liệu** để đính kèm local.
- Khi lỗi đính kèm, cùng ô nhập hiển thị dữ liệu chờ; giữ mô tả yêu cầu riêng, khóa lưu/gửi, cho sửa/gỡ file/thử lại/bỏ nguồn chờ. Thành công hoặc bỏ nguồn khôi phục mô tả. Không ghi dữ liệu chờ vào metadata nháp hoặc request AI.
- **Chọn file** thay biểu tượng ảnh khó nhận ra. Picker, paste file và kéo thả trong panel chat đi qua cùng `addDataFiles`; giữ giới hạn, khóa thao tác và kiểm tra phiên hiện có. Thả khi đang bận/chờ nguồn không nhận thêm file và ngăn điều hướng file của Electron. Drag qua phần tử con giữ dấu nhận thả.
- Giữ nguyên parser CSV/TSV, OCR, main/preload, prompt/model, metadata-only request và Upload cần người dùng kiểm tra/xác nhận. Không sửa form chiến dịch thường; không thêm dependency hoặc migration.

Hai typecheck, production build và smoke Electron composer + toàn bộ suite nhập dữ liệu local đạt. Suite mới kiểm chiều cao/tự giãn ở 1500px và 900px, theme sáng/tối, click nút chọn file, chuyển text thành nguồn local, kéo Excel qua phần tử con, giới hạn file, thả khi bận, request chỉ metadata và Upload → lưu nháp giữ số 0 đầu. Suite local tiếp tục kiểm CSV/TSV nhiều dòng, 120 dòng, nội dung có SĐT/email, nháp/mở lại, dữ liệu chờ/lỗi ghi file/thử lại, mô tả quá dài và hủy nhập.

Kiểm trực quan ảnh rộng/tối, hẹp/sáng và nguồn chờ trong Electron. IPC/store/provider là fixture; filechooser được Playwright bắt, drag/paste được phát bằng DataTransfer. Chưa kiểm thao tác kéo từ Finder/Explorer ngoài app, AI live hoặc bộ cài Windows. Không apply DB hoặc phát hành.

[Receipt và checksum](verification.json), [đo kích thước và smoke composer](composer-verification.json), [build](build.txt), [rộng/tối](composer-1500-dark.png), [hẹp/sáng](composer-900-light.png), [dữ liệu chờ](pending-data-retry-narrow.png).

## Sửa nhập dữ liệu dài chưa nhận diện — 03/11/2026

- Review tái hiện 180 dòng `Nguyễn Văn An - <SĐT>` (4.859 ký tự): parser Upload chấp nhận cả 180 dòng nhưng composer coi là mô tả quá dài, không có đường đính kèm raw sau khi bỏ ô Dán data riêng.
- Màn rút gọn nay có **Đính kèm nguyên phần vừa dán**. State tạm giữ clipboard nguyên văn và phần yêu cầu trước/sau vùng chọn. Lựa chọn này lưu nguyên nguồn local, gồm cả dòng đã được splitter nhận diện, không dùng mô tả rút gọn đã chỉnh, không gửi data tới AI hoặc vào metadata nháp. Giữ thao tác rút gọn/Áp dụng/Bỏ hiện có.
- Handoff từ khóa review sang controller đính kèm diễn ra đồng bộ. Giới hạn file/lỗi ghi vẫn giữ nguyên nguồn trong ô dữ liệu chờ, khóa lưu/gửi đến khi thử lại thành công hoặc bỏ nguồn. Không nới validator 4.000 ký tự của mô tả, giới hạn file, prompt/model hoặc schema nháp.
- Hai typecheck, production build và smoke Electron large-paste + composer + toàn bộ local import đạt trên source sửa cuối. Kiểm 180 số đủ sau lưu/mở nháp/Upload, vùng chọn và yêu cầu xung quanh, nguồn CRLF có các dòng được nhận diện một phần, giữ nguyên nguồn kể cả khi sửa ô mô tả, thu gọn/mở lại, lỗi ghi, đủ 5 file/thử lại và Bỏ. Đã xem ảnh cửa sổ hẹp/theme sáng.
- Source vẫn ở worktree, chưa merge/sync repo chính. Không sửa form thường/main/shared/parser, không gọi AI/DB live, apply migration, đóng gói Windows hoặc phát hành. Các giới hạn fixture của audit trước vẫn áp dụng.

[Receipt và checksum sau sửa](large-paste-fix-verification.json), [ca kiểm tra](large-paste-verification.json), [smoke](large-paste-ui.txt), [build](large-paste-build.txt), [nút đính kèm ở cửa sổ hẹp](large-paste-attach-narrow.png).

## Kiểm chứng trước PR — 03/11/2026

Hai typecheck và production build chạy lại trước push đạt; output 40.462.941 byte,
thời gian build 25,62 giây. Đối chiếu checksum xác nhận source/runner vẫn đúng bản
đã đạt smoke dữ liệu dài + composer + toàn bộ import local. Lượt review sau sửa còn
kiểm hủy trong lúc đọc file giữ nguồn/khóa lưu, thử lại và phản hồi đọc cũ sau mở
form mới; đều đạt với fixture Electron.

Diff chỉ gồm composer/CSS, smoke và tài liệu/audit. Form thường, main/preload/shared,
dependency, migrations và hướng dẫn bảo toàn giữ nguyên. Link tài liệu, diff và
quét mẫu credential đạt. CURRENT_STATE ghi đúng build local, chưa merge/sync hoặc
phát hành; không apply DB hay chạy AI live.

[Receipt trước PR](pr-verification.json), [build trước PR](pr-build.txt).
