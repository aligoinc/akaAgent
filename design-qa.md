# Design QA — Tự động hóa chiến dịch A/B

final result: passed

## Evidence

- Visual source of truth: `/var/folders/60/7n_q1mt11sx4b_9xdpqts0gc0000gn/T/codex-clipboard-de66e490-9002-454e-8016-77cfdd5e8de5.png`
- Final implementation screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-v173-step2-daily-0830.png`
- Combined comparison: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-v173-comparison.png`
- Focused comparison: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-v173-focused-comparison.png`
- Source viewport: `1366 × 856`.
- Implementation viewport: `1195 × 768`, Electron light theme.
- Compared state: create automation, step 2 “Dữ liệu & chiến dịch B”, compatible Facebook UID campaigns selected, no target data group, `daily_time` selected with `08:30`.

## Normalization and product constraints

The source is a content-only concept crop. The implementation comparison keeps the existing akaAgent three-step modal, application shell, compact desktop density, and product tokens. Both images are normalized to equal comparison panels; the focused comparison isolates the Campaign B selection and newly requested schedule area.

The production Electron window has `minWidth: 1000`, so a viewport below 760 px is not reachable in the shipped desktop app. The form nevertheless has the requested `@media (max-width: 760px)` fallback, stacking schedule cards and two-column fields for embedded or future web surfaces.

## Fidelity review

- Layout and hierarchy: Campaign B and optional data group remain in the same order as the source; the schedule block is directly underneath and clearly belongs to Campaign B.
- Typography and spacing: compact sizes follow the existing akaAgent modal rather than enlarging the whole product to the concept crop; headings, labels, helper copy, and controls remain readable without collision or clipping.
- Color and surfaces: existing light-theme tokens, purple active state, neutral borders, and pale schedule configuration surface are consistent with the source intent and the application design system.
- Icons and controls: Lucide icons, semantic radio inputs, labeled number/unit controls, and native time input are aligned and visually consistent.
- Copy: all three mutually exclusive modes explain their behavior; the daily-time helper explicitly names `Asia/Ho_Chi_Minh` and next-day rollover.
- Accessibility: radio cards expose semantic radio controls, keyboard arrow navigation changes the selected mode, focus-visible treatment is present, validation moves focus to the error alert, and required inputs have labels.

## Interaction QA

- Verified `immediate`, `after_delay`, and `daily_time` mode switching in the running Electron app.
- Verified keyboard Right Arrow changes the selected radio mode.
- Verified native time input accepts and displays `08:30`.
- Verified the step labels “Dữ liệu & chiến dịch B” and “Thông tin & hoàn tất”.
- No automation was saved during visual QA.
- Renderer and main/preload typechecks plus the production build completed with zero errors; no runtime error dialog or failed state appeared during the preview flow.

## Iteration history

1. Initial implementation placed all three modes in step 2 and retained legacy `fixed_at` only for editing legacy rules.
2. Keyboard and validation review added focus-visible coverage and error-alert focus/scroll behavior.
3. Final preview set `daily_time` to `08:30`, compared the full state and focused Campaign B region, and found no remaining P0, P1, or P2 visual discrepancy.

---

## Searchable campaign selectors A/B

final result: passed

### Evidence

- Visual source of truth: `/var/folders/60/7n_q1mt11sx4b_9xdpqts0gc0000gn/T/codex-clipboard-2732dc2e-2ade-411d-b95d-7fcdcd2cd141.png`
- Final campaign A screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-campaign-a-search-final.png`
- Final campaign B screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-campaign-b-search-final.png`
- Dark-theme screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-campaign-a-search-dark-final.png`
- Focused source/implementation comparison: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/automation-campaign-a-focused-comparison.png`
- Source viewport: `1378 × 546`; implementation viewport: `1297 × 768`, Electron light and dark themes.

### Fidelity and behavior review

- Both selectors use one product-native combobox treatment and display `Tài khoản — Loại chiến dịch — Tên chiến dịch — Trạng thái`.
- Campaign A showed only the available non-completed campaign (`tạm dừng`) in the live data; completed campaigns were absent.
- Campaign B retained all existing compatibility filters and visibly included three compatible campaigns in status `hoàn thành`.
- Client search matched Vietnamese text with and without diacritics (`nuoi` → `nuôi`, `phan mem` → `phần mềm`) and kept RPC order.
- Empty selection, no-result, selected, active and completed-status states were checked. A/B can be cleared without bypassing required-field validation.
- Arrow keys, Home/End, Enter, Tab and Escape follow combobox behavior. The first Escape closes only the popup; IME composition is ignored by selection shortcuts.
- The listbox is portaled into the dialog accessibility subtree. Live macOS AX exposed the combobox, listbox and options with full labels, set position and set size.
- Large result sets are virtualized to the viewport plus overscan and at most one offscreen active option; internal scrolling is RAF-throttled and does not trigger popup reposition renders.
- Changing form steps focuses the step section, so a retained A/B value stays visible and the dropdown does not open automatically.
- The existing `@media (max-width: 760px)` fallback remains in place. The production Electron window cannot be resized below its `1000px` minimum width, so that breakpoint is not directly reachable in the shipped desktop shell.
- No automation was saved during visual QA. Both TypeScript projects and the final production build completed with zero errors.

### Iteration history

1. Replaced native A/B selects with a shared searchable combobox and preserved all source/target reset rules.
2. Moved the popup into the dialog accessibility tree, added clear and legacy-completed-A safeguards, IME handling and non-opening step focus.
3. Added fixed-row virtualization and ensured `aria-activedescendant` always references a mounted option for Home/End, wrap and distant selected values.
4. Re-tested A/B with live campaigns, light/dark themes and final production artifacts; no P0, P1 or P2 issue remains.

---

## Trạng thái theo phạm vi và giờ chạy chính xác v174

final result: passed

### Evidence

- Visual source for status scope: `/var/folders/60/7n_q1mt11sx4b_9xdpqts0gc0000gn/T/codex-clipboard-1233e450-3477-41bb-99be-df51cd459d1e.png`
- Visual source for exact-time delay: `/var/folders/60/7n_q1mt11sx4b_9xdpqts0gc0000gn/T/codex-clipboard-f1d72f87-84cd-4b1f-ad8a-6f3f5d7fd53c.png`
- Final status-scope screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/v174-status-scopes.png`
- Final exact-time screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/v174-exact-time.png`
- Final summary screenshot: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/v174-summary.png`
- Combined exact-time comparison: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/comparison-v174-exact-time.png`
- Combined status-scope comparison: `/Users/akabiz/.codex/visualizations/2026/07/15/019f64e3-d015-7b33-b114-3a8c68384014/comparison-v174-status-scopes.png`
- Implementation viewport: `1297 x 768`, Electron light theme. Reference crops were normalized to the same comparison panel dimensions before stacking above the implementation.

### Fidelity and behavior review

- Trigger status cards now render one unambiguous line in the form `Trạng thái — Phạm vi hành động`; the live Facebook group-post campaign showed catalog scopes for `Đăng bài group`, `Comment`, and `Tất cả hành động` without visually duplicate labels.
- The wildcard selection uses the same card, border, focus ring, and purple selected treatment as the existing form. Selecting `thành công — Tất cả hành động` cleared the previously selected `thành công — Đăng bài group` option in the running app.
- The new exact-time control is nested inside the existing `after_delay` configuration surface, so it reads as an optional refinement rather than a fourth scheduling mode.
- The checkbox, helper copy, required label, native `HH:mm` input, and `Asia/Ho_Chi_Minh` explanation fit the established compact density without overlap or clipped text.
- Step 3 showed the shared formatter output exactly as `Sau 2 giờ, chạy lúc 08:30 gần nhất` under `Lịch chạy dữ liệu B`.
- The target campaign remained selectable while in `hoàn thành`, matching the worker behavior that can reopen it safely.
- The shipped Electron window has `minWidth: 1000`; true `760px` and `480px` renderer viewports are not reachable through the desktop shell. The implementation includes and was statically reviewed at both breakpoints: schedule cards stack at `760px`, while delay controls and the exact-time input become single-column/full-width at `480px`.

### Interaction QA

- Verified selected-state mutual exclusion between a semantic wildcard and a matching action-specific status.
- Verified delay value `2`, unit `Giờ`, checkbox enablement, default `08:00`, native minute editing to `08:30`, and persistence into the final summary.
- Verified keyboard-accessible semantic radio, checkbox and time input exposure through macOS accessibility.
- No automation was saved during visual QA; all real database execution tests ran inside rollback transactions.
- Both TypeScript projects and the production build completed with zero errors after the final UI changes.

### Iteration history

1. Replaced ambiguous status text with scoped labels and canonical mapping identifiers while preserving wildcard/specific semantics.
2. Added the exact-time checkbox and time field inside `after_delay`, then aligned spacing and focus treatment with the existing schedule block.
3. Exercised the complete A -> B form with real campaigns and verified the final formatter at `08:30`; source and implementation were reviewed together with no remaining P0, P1, or P2 visual discrepancy.

---

## Unified akaBiz Excel template upload

final result: passed

### Evidence

- Visual source of truth: `/Users/akabiz/.codex/generated_images/019f68e5-ef3b-7cd3-add4-b067d555fd2c/exec-1e07f4a6-671b-4fa3-a428-d8869592d77f.png`
- Final implementation screenshot: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/excel-template-final-1487x1058.png`
- Same-viewport source/implementation comparison: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/excel-template-comparison.png`
- Minimum-window screenshot: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/excel-template-min-1000x700.png`
- Dark-theme screenshot: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/excel-template-dark-1000x700.png`
- Source and primary implementation viewport: `1487 × 1058`; responsive viewport: `1000 × 700`.
- The full modal remains legible at the exact comparison viewport, so a separate focused crop was not needed.

### Normalization and product constraints

- The implementation comparison uses a real 128-row XLSX fixture instead of the four illustrative mock rows. The preview therefore fills its bounded scroll region while preserving the source hierarchy.
- File name, size, phone column label and table contents come from the live SMS campaign fixture and dynamic campaign fields rather than copied mock values.
- The unified modal uses existing akaAgent tokens, buttons, tables, typography and theme variables. Its final maximum width was aligned with the selected reference without changing other product modals.

### Fidelity and behavior review

- Five tabs appear in the specified order; `Từ template Excel akaBiz` has the selected border treatment and the customer Excel/CSV mapping flow remains separate.
- Dataset name, full-width file card, file metadata, remove control, hint, success state, sticky preview header and footer CTA follow the selected visual hierarchy.
- At `1000 × 700`, the tab row retains its 44px height, the preview scrolls internally and the footer remains visible. The floating feedback launcher is below the nested modal stacking context and cannot intercept the CTA.
- Light and dark themes resolve through product tokens; no modal surface or text color is hard-coded for one theme.
- The toolbar no longer exposes a standalone `Upload Excel` action; `Thêm data` opens the unified modal on `Form txt`.

### Interaction QA

- Verified empty, reading, success, inline error, remove, same-file reselect, tab-away clear, tab-return restore and modal reopen behavior in the running Electron production build.
- Verified XLSX, XLS and CSV success; invalid extension, corrupt XLSX, empty/no-valid-row file, header aliases, blank rows, numeric/scientific cells, invalid-row filtering and deduplication.
- Verified the 128-row success count after validation/deduplication, dynamic SMS preview fields and CTA disabled/enabled conditions.
- Verified the legacy customer Excel/CSV tab still exposes header/mapping controls and `Format chuẩn dữ liệu`, while the akaBiz template tab exposes none of them.
- Verified the production UI at `1487 × 1058`, the minimum `1000 × 700` window and dark theme.
- No dataset was saved to Supabase during visual QA; this avoided creating test data while the existing save contract and enabled CTA were exercised up to the persistence boundary.
- Main/preload/shared and renderer TypeScript checks completed with zero errors. The final production build and `git diff --check` also passed.

### Iteration history

1. Added the fixed-template parser, campaign-specific normalization, async revision protection and unified save-source mapping.
2. Removed the campaign toolbar Excel button and implemented the product-native file card, status states, dynamic preview and responsive tabs.
3. Runtime QA fixed Vietnamese `đ` header normalization, corrupt-file signature detection, trailing-slash Facebook deduplication and preservation of column A for join-group imports.
4. Final visual QA raised the nested modal above the feedback launcher, prevented the tab strip from shrinking at minimum height and aligned modal width with the selected reference. No remaining P0, P1 or P2 discrepancy was found.

### Follow-up: Form txt tab clipping

final result: passed

#### Evidence

- User-reported clipped state: `/var/folders/60/7n_q1mt11sx4b_9xdpqts0gc0000gn/T/codex-clipboard-7eef239d-2f88-42b1-9e11-811eab760483.png`
- Fixed production state: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/form-txt-tab-fixed-1170x867.png`
- Full-view comparison: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/form-txt-tab-comparison.png`
- Focused tab-strip comparison: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/form-txt-tab-focused-comparison.png`
- Minimum-window state: `/Users/akabiz/.codex/visualizations/2026/07/16/019f68e5-ef3b-7cd3-add4-b067d555fd2c/form-txt-tab-fixed-min-1000x700.png`
- Exact comparison environment: `1170 × 867` CSS pixels at device-pixel ratio `2`, producing `2340 × 1734` evidence images.

#### Finding and resolution

- Earlier P1: the stale preview allowed the tab strip to flex-shrink while the long Form txt panel filled the modal; `overflow-y: hidden` then visibly cut the selected label.
- Resolution: the current production CSS keeps `.campaign-import-tabs` at `flex: 0 0 auto` with `min-height: 44px`. The stale preview process opened before that build was closed and replaced with the current production bundle.
- Post-fix measurement: strip top/bottom `185.5/229.5`, text top/bottom `199/214.5`; the complete label remains inside the strip with 15px clearance below.
- The focused comparison confirms all five labels and the selected Form txt border are fully visible. Font, spacing, colors, copy and product-native controls remain unchanged.

#### Interaction and viewport QA

- Clicked `Từ template Excel akaBiz`, then returned to `Form txt`; `aria-selected=true` followed the active tab and the label remained unclipped.
- Verified native zoom factors `100%`, `125%` and `150%`; no label clipping occurred.
- Verified the minimum `1000 × 700` window: tab strip remains 44px high, all tabs fit horizontally, and the footer CTA remains visible.
- Both TypeScript projects and `git diff --check` completed with zero errors.
