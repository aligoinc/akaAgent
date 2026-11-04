# Kiến trúc và production

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 345–366. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
## Architecture

V346 đã apply `20261006033730 / migration_v346_fb_email_error_policies` trên akachat: thêm 58 policy FB/Email/chung đang bật, giữ nguyên 46 policy cũ; không sửa app/RPC/block/workflow/schema. Không apply lại. Theo yêu cầu người dùng đã bỏ quét tham chiếu dữ liệu riêng khi rollback, vẫn giữ FK và guard ID/mã/checksum; INSERT/ROLLBACK đạt nhưng hard DELETE thử nghiệm timeout 30 giây tại FK bảng detail. Snapshot/receipt và giới hạn rollback: [audit](../../../docs/FB_EMAIL_ERROR_POLICIES_V346.md).

V347 đã apply `20261006012006 / migration_v347_campaign_status_agent_descriptions` trên akachat: thêm 55 mapping trạng thái và `auto_campaign_action_detail_statuses.description` cho agent; NULL action là wildcard, NULL status_id là chưa có nhóm ngữ nghĩa. Không apply lại; snapshot/rollback có guard runtime và tham chiếu: [audit](../../../docs/CAMPAIGN_STATUS_CATALOG_V347.md).

V349 đã apply `20261006032336 / migration_v349_campaign_detail_status_ids`: thêm 16 trạng thái chuẩn và gán ID cho 120 mapping NULL, giữ nguyên nhóm lựa chọn/điều kiện Automation; không sửa RPC/code hay reload schema. Không apply lại; revert v349 trước khi xét revert v347: [audit và rollback](../../../docs/CAMPAIGN_STATUS_IDS_V349.md).

**Electron 33 + React 19 desktop app** cho automation Facebook/Zalo/Email. Build qua `electron-vite`. State Zustand. Canvas `@xyflow/react`. DB Supabase. Code editor Monaco.

**Supabase production của repo này** là project `akachat`, project ref `cgjbsmqtfhqvttudyjzq`, cũng là ref trong `supabase/.temp/project-ref` và fallback URL trong `src/main/data/supabaseClient.ts`. Project ref `yfkvwgapqmywaoftwuzc` (tên `aka_agent`) là project legacy/khác và tuyệt đối không query hoặc mutate khi làm việc trong repo này. Không chọn project theo tên từ `supabase projects list`; trước mọi thao tác DB phải verify ref và ưu tiên `supabase db query --linked`.
Code/config đang chạy trong `auto_blocks`/`auto_workflows` cũng phải lấy trực tiếp từ linked production làm source of truth: trước khi sửa block/workflow, query đúng row live và capture checksum hiện tại; không dựng body/config từ migration lịch sử. Migration mới phải fail-closed nếu row live đã đổi ngoài dự kiến.

### 3-layer Electron split (`src/`)

| Layer | Path | Trách nhiệm |
|---|---|---|
| Main process (Node) | [src/main](../../../src/main) | IPC, DB (Supabase), webview controller, scheduler, updater |
| Preload bridge | [src/preload/index.ts](../../../src/preload/index.ts) | Expose `electronAPI.*` qua `contextBridge` |
| Renderer (React) | [src/renderer/src](../../../src/renderer/src) | UI, Zustand stores, xyflow canvas, Monaco editor |
| Shared | [src/shared](../../../src/shared) | Types + IPC event constants (cả 2 phía import) |


<!-- END PRESERVED SOURCE -->
