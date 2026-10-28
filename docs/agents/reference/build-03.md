# Updater

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 754–757. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### Auto-update

[src/main/services/updater.ts](../../../src/main/services/updater.ts) đọc local version từ `resources/version.txt` (dev fallback `version.txt`/`app.getVersion()`) và chọn remote theo platform/arch: Windows `version_win.txt`/`akaAgent.exe`, macOS Apple Silicon `version_mac.txt`/`akaAgent.dmg`, macOS Intel `version_mac_intel.txt`/`akaAgentIntel.dmg`. Version phải dùng format `x.x.x`; compare numeric theo major/minor/patch.


<!-- END PRESERVED SOURCE -->
