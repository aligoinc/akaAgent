**Comparison Target**

- User reference: `/var/folders/60/7n_q1mt11sx4b_9xdpqts0gc0000gn/T/codex-clipboard-3c6a75e8-a88e-4c7d-afd1-025b5241f0c6.png`
- Normalized source visual truth: `/Users/akabiz/.codex/visualizations/2026/07/14/019f60fa-4921-7ea2-9452-6ecd81a9fe04/media-main-full-parity.png`
- Implementation screenshot: `/Users/akabiz/.codex/visualizations/2026/07/14/019f60fa-4921-7ea2-9452-6ecd81a9fe04/media-campaign-full-parity-post-review-2.jpeg`
- Viewport: Electron development window at 1297 × 768 pixels.
- State: five JPEG files, no existing media groups; source is Media opened from the main menu and implementation is the image picker opened from a Facebook campaign.
- Full-view comparison evidence: the two normalized screenshots were opened together in one comparison input at the same viewport and application state.
- Focused-region comparison: not required because the sidebar controls, toolbar, table actions, checkboxes, and footer labels remain readable in the full-view evidence; the accessibility tree was also inspected for exact control presence.

**Findings**

- No actionable P0, P1, or P2 differences.
- Fonts and typography: both modes render from the same component and preserve the existing app font stack, weights, table hierarchy, truncation, and compact control labels.
- Spacing and layout rhythm: modal frame, group sidebar, toolbar, table, horizontal scroll area, borders, radii, and footer alignment match. The picker adds only the intentional checkbox column and `Chọn` action.
- Colors and visual tokens: both modes use the same background, border, text, primary-button, danger-action, hover, and selected-row tokens.
- Image quality and asset fidelity: no new raster asset was needed. Existing Lucide icons are reused consistently with the source component.
- Copy and content: the campaign picker now exposes `Tên thư mục media`, `Thêm`, row delete actions, Upload, paste, quota, active folder, search, and refresh exactly like the main Media modal while retaining `Chọn media` and selection controls.

**Open Questions / Residual Test Gaps**

- Live group creation, rename, deletion, media deletion, cloud-settings save, and upload/paste were not submitted during visual QA to avoid mutating shared production-like data. Their existing IPC/repository paths are unchanged and both TypeScript configurations plus the production build pass.
- Quick Edit could not be opened in the current live dataset because the campaign list returned no rows. Static inspection confirms it invokes the same `MediaLibraryModal` picker path as the full Campaign Form, so the shared change applies without a second implementation.

**Implementation Checklist**

- [x] Show group create/edit/delete controls in campaign picker mode.
- [x] Enable the two-column group membership manager in picker mode.
- [x] Show global media deletion in `Tất cả media` and admin cloud settings in picker mode.
- [x] Keep picker title, checkboxes, image/file filtering, selection limit, `Chọn`, and `Chọn thư mục` behavior.
- [x] Keep uploaded/pasted media in the active group and auto-select valid files for the campaign.
- [x] Preserve selected media while changing or managing groups; remove a globally deleted file from selection.
- [x] Select an existing image and confirm it back into the Campaign Form without saving the campaign.
- [x] Pass Node/shared and renderer typechecks and the Electron production build.

**Comparison History**

- Pass 1: no visual P0/P1/P2 mismatch found. The picker visibly matched the main Media form; its checkbox column and confirmation footer are intentional product differences required for campaign selection.
- Functional review after pass 1 found three selection edge cases: single-select upload retained the previous selection, `Chọn thư mục` could exceed a finite `maxSelect`, and a failed post-upload group membership did not return the main modal to `Tất cả media`.
- Fix pass: single-select upload/paste now replaces the previous selection, folder confirmation enforces the picker limit, and partial membership failure preserves the uploaded file/selection while returning to `Tất cả media` in both modes.
- Pass 2: a fresh Electron screenshot was captured after the fixes and compared with the main Media reference in one input. No visual regression or actionable P0/P1/P2 difference remains.

**Follow-up Polish**

- P3: none required for the requested scope.

final result: passed
