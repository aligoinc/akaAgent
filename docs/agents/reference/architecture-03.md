# Renderer và Workflow Editor

> Chuyển từ AGENTS.md ngày 28/10/2026, dòng 758–780. Nội dung và ràng buộc được giữ; chỉ sửa đường dẫn Markdown.
> Trạng thái “đã/chưa apply/deploy/phát hành” bên dưới là lịch sử. Đối chiếu [CURRENT_STATE](../CURRENT_STATE.md), audit mới nhất và live trước mọi thao tác. Không coi ghi chú quyền cũ là cho phép mở lại quyền.

<!-- BEGIN PRESERVED SOURCE -->
### Renderer state (Zustand stores)

[src/renderer/src/stores/](../../../src/renderer/src/stores/):
- `authStore` — current user, login/logout
- `campaignStore` — accounts (runtime `accounts` alias), campaigns, action templates, log realtime broadcast
- `blockLibraryStore` / `elementLibraryStore` / `workflowV2Store` — engine v2 editor state
- `themeStore` / `uiStore` — UI prefs

### Workflow Editor v2 UI

[src/renderer/src/components/v2/](../../../src/renderer/src/components/v2/) — akaBiz admin staff only (button "Cài đặt Workflow" trong TopBar khi `user.isAdminAkabiz === true`):
- Campaign action manager ("Quản lý Hành động") cũng chỉ render khi `user.isAdminAkabiz === true`; modal này quản lý `workflow_id`/`test_workflow_id` và toggle staff-scoped `use_test_workflow`.
- `WorkflowEditorV2.tsx` — container layout 4 vùng (BlockLibrary | Canvas+Test | ConfigPanel)
- `BlockLibraryPanel.tsx` — sidebar trái, drag block vào canvas, tabs Built-in/Custom/System
- `WorkflowCanvasV2.tsx` — `useNodesState`/`useEdgesState` (LOCAL state, sync ngược store chỉ ở user actions để tránh infinite render từ dimension changes)
- `BlockInstanceNode.tsx` — custom xyflow node, ifElse có 2 outputs (true/false), loop có `body`/`done`
- `ConfigPanelV2.tsx` — form theo `block.configSchema` + nút "Sửa code (Monaco)"
- `CodeEditorDrawer.tsx` — Monaco với TS extra-lib từ [lib/blockApiTypes.ts](../../../src/renderer/src/lib/blockApiTypes.ts) cho intellisense `page.*`/`helpers.*`/`vars`
- `TestPanelV2.tsx` — chọn account webview → Test workflow / Test block → realtime log + per-step status
- `BlockCrudModal.tsx` + `ElementCrudModal.tsx` — quản lý block library / XPath elements

App.tsx **conditional render** workflow editor (KHÔNG `display: none`) để ReactFlow đo container đúng — nếu hidden khi mount, ReactFlow render 0×0 và nodes invisible.


<!-- END PRESERVED SOURCE -->
