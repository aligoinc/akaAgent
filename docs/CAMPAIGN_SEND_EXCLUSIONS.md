# Loại trừ gửi cho khách hàng

Implemented in akaAgent Desktop/legacy Zalo Server and akaAgentChatApi worker/runtime. **DB v330 applied to production akachat on 2026-09-29 (Vietnam time)** with history `20260928172551 / migration_v330_campaign_send_exclusions`; see [apply audit](CAMPAIGN_SEND_EXCLUSIONS_V330_AUDIT.md). **Chat Zalo runtime and worker were deployed on 2026-09-29 (Vietnam time); Desktop and legacy Zalo Server have not been released.** See [backend deployment audit](../../akaAgentChatApi/docs/DEPLOY_SEND_EXCLUSIONS_20260929.md), including account 2409 login failure observed after restart. No real Zalo messages were sent by the tests.

## Configuration and extension

Migration `migration_v330_campaign_send_exclusions.sql` creates six tables: fields, operators, valid field/operator pairs, static options, user groups, and group rules. Initial fields are friendship, native Zalo tags, akaBiz tags, and days since successful delivery. Groups belong to one staff/organization/account, save atomically with revision CAS and a scoped create-request UUID for safe retry after a lost response, and require at least one enabled rule. Each field occurs at most once; the catalog is not limited to four definitions.

Campaign JSON: `extra_settings.zaloSendExclusionsByAccountId[accountId] = {groupId, blocklistIds}`. Each primary/secondary account has a separate entry. The campaign trigger verifies account ownership, group scope, valid rules/options and blocklist ownership. Legacy single-list configuration is mapped when opening the form; no bulk backfill. Opt-out and existing cooldown remain independent. Disabling message sending prevents activation of the new filter.

Source adapters: `zalo_profile`, `zalo_friendship`, `zalo_labels`, `akabiz_contact`, `campaign_delivery`. `source_config.path` is an array of safe property names in the adapter's normalized object. Supported primitive types: text, number, boolean, enum, set, date. Evaluators: equality/inequality, any/none membership, text contains/prefix and their negations, numeric/date `<`, `<=`, `>`, `>=`. Dynamic options use existing friend-status, native-label or akaBiz-tag providers; static values use `auto_filter_field_options`.

To add gender, insert an active enum field with source `zalo_profile`, path `["gender"]`, options source `static`; add numeric options `0` (Nam), `1` (Nữ); link `equals`/`not_equals` using `value_type='enum'`, min/max 1. The isolated DB test does this and exports a fixture used by UI/runtime tests. **Gender is not in the production seed.** No field-code branch or admin-definition screen is needed. Sources/evaluators that the client does not support block enabled rules explicitly. Metadata cannot execute SQL/JavaScript or specify arbitrary endpoints/tables.

In-use field meaning, operator algorithm, pair validation and static option meaning cannot be edited silently: guards require a new/versioned definition or an explicit migration of rules. Rename/deactivation remain possible; deactivated enabled definitions fail closed. Adding catalog rows later is data-only and does not require schema reload.

## Desktop UI

Ngày 20/10/2026 thêm AI tạo nhóm bằng Sol 6.1: tự mở editor và điền điều kiện theo mô tả, chỉ ghi khi bấm Lưu nhóm. Config `ai_form_configs.id=7` đã apply; xem [hợp đồng AI, kiểm chứng và rollback](CAMPAIGN_SEND_EXCLUSION_AI.md).

The exclusion card and its 660px group editor follow `Loại trừ gửi - Chiến dịch.dc.html`: icon tiles, optional/default badges, two-line group picker, individual Khi/VÀ/HOẶC summary rows, and selected blocklist chips inside the picker. The editor uses one bordered condition stack, metadata-driven operator/value chips, a compact days input, and separate header/body/footer. Inactive conditions stay visible and selecting a value enables that condition. Narrow layouts wrap controls and scroll the body while retaining the footer; light and dark themes are supported.

The account and “Từ Zalo nào” values in the editor are read-only because the group belongs to the account being configured. Multiple campaign accounts switch independently on the card. Friendship/operator options still come from the existing catalog; prototype-only choices are not copied into production. Empty/invalid drafts show the validation reason and disable Save. Group picker keyboard navigation and modal focus trapping are covered by the offline UI smoke.

## Runtime and request behavior

After a successful claim, the scheduler reads one configuration snapshot per run. Resume/account changes create a new context. Group/rules/catalog are returned together; the UID set is aggregated inside the RPC, avoiding PostgREST's 1,000-row cap and maintaining a single database read snapshot. This uses a complete JSON snapshot rather than separate HTTP pages, which could observe membership changes between requests. The isolated test includes 1,005 memberships. No SQL connection is held for the lifetime of a run.

Runtime snapshot validation checks only the account currently executing. A deleted group/list selected by another account does not stop this account; missing or invalid current-account configuration still fails closed. Saving campaign configuration continues to validate every account entry.

Only the next input/share batch is evaluated. Cheap DB facts run before optional Zalo sources; three-valued AND/OR short-circuits when the result is conclusive. Missing/failed data stays unknown. Native Zalo tags confirmed deleted by a successful, complete label read are removed from the effective condition as described below. Unknown or matching targets pause via CAS and receive a reason; they do not send, run auxiliary actions, create send results, or consume send quota. Successful phone lookup is recorded first and retains its quota. Existing session/rate-limit side effects remain applicable without creating a filter-result detail.

### Deleted native Zalo tags — source change 04/11/2026

The user replaced the old "removed tag means unknown" behavior. For native Zalo
tag membership (`zalo_labels`, `contains_any` / `contains_none`), intersect the
selected IDs with the complete `availableValues` returned by the current label
context. A deleted ID no longer participates in the filter. Retained IDs still
use the selected operator. If none remain, skip that condition entirely for
both AND and OR; keep other rules, and allow when no effective rules remain.
In particular, an emptied "does not contain" condition must not exclude everyone.

Require readable recipient membership and a valid complete label catalogue
before interpreting any absence as deletion. Network/API errors, malformed or
missing catalogue/membership, and session invalidation keep the existing
unknown/pause and lifecycle behavior. An authoritative empty label list is
valid; a missing list is not. Missing akaBiz tags and other sources retain their
existing behavior. Blocklists, opt-out, cooldown, quota and cleanup are unchanged.

This pruning is per evaluation and does not mutate the saved group/revision or
the run snapshot, add a DB write/request, or resume previously paused inputs.
The Desktop/legacy Server shared source and Chat runtime-protocol must remain
identical. The group editor may still display saved deleted IDs for manual
cleanup; they no longer block execution after a valid label read.
See the [local verification record](audits/zalo-deleted-tag-filters-20261104/README.md)
for build/test status. Chat runtime and worker were deployed on 04/11/2026 at
22:50–22:51 Vietnam time; Desktop/legacy Server installers remain unreleased.
Deployment health, account readiness and backlog observations are separate in
the receipt; attaching accounts does not establish successful Zalo login.

### Tag Zalo đã xoá ở lớp kiểm của DB — V573 (đã apply akachat 14:17:54 VN 18/11/2026)

Bản sửa 04/11 ở trên chỉ phủ bước so tag lúc gửi. Trước bước đó, DB còn kiểm nhóm loại trừ bằng
`aka_agent_internal_validate_send_exclusion_rules`: mỗi giá trị phải có trong
`aka_agent_internal_send_exclusion_options`, mà danh sách này chỉ lấy tag Zalo chưa xoá
(`auto_account_contacts` loại `zalo_tag`). App đọc lại danh sách tag (`upsertContacts` với `markMissingDeleted`)
là tag khách đã xoá trong Zalo bị đánh `is_delete`, rồi hàm kiểm báo `send_exclusion_option_unavailable` ở bốn chỗ:
đầu lượt chạy của bộ cũ (`aka_agent_campaign_send_exclusion_runtime` `snapshot`, chiến dịch tạm dừng
"Không thể tải cấu hình loại trừ…"), đầu lượt của engine v2 (`aka_agent_engine_send_exclusion_v1`, CFG18), lưu chiến dịch
(trigger `auto_validate_campaign_send_exclusion`, Web báo mã tham chiếu ngẫu nhiên) và lưu nhóm loại trừ. Ca 04/11 (nhóm 47)
và ca 18/11 (nhóm 46, chiến dịch 48267) đều bị chặn ở lớp này.

[V573](../migrations/migration_v573_send_exclusion_deleted_zalo_tags.sql) chỉ đổi một điều kiện trong hàm kiểm: giá trị
nguồn `zalo_labels` không còn trong danh sách nhưng là chuỗi khớp `uid` của một dòng `zalo_tag` (kể cả đã xoá) của chính
tài khoản / nhân viên / tổ chức thì hợp lệ; lúc chạy, bộ lọc của Desktop / App Server / Fly đã bỏ qua tag đó. Tag chưa từng
có, sai kiểu, tag akaBiz và các nguồn khác giữ như cũ. Không đổi dữ liệu, bảng, quyền; không phát hành app.
Giới hạn: tag chỉ có ở `chat_zalo_account_tag` (bảng này xoá hẳn dòng) mà chưa từng có dòng `zalo_tag` thì vẫn bị chặn
(18/11: không nhóm nào rơi vào ca này). Form vẫn hiện tag đã xoá thành chip đỏ để khách tự dọn.

Sinh bằng `scripts/build-v573-sql.cjs` từ thân production đọc 18/11 (`scripts/fixtures/send-exclusion-v573/live-20261118.json`,
md5 `6a3fdb6d…` → `481ee1d1…`); kiểm `node scripts/send-exclusion-v573-smoke.cjs` (PG17 cục bộ, 13 nhóm). Đối chiếu chỉ đọc
trên production 18/11: 80 nhóm loại trừ, 2 nhóm bị chặn trước V573, 0 nhóm sau. `CREATE OR REPLACE FUNCTION` làm PostgREST
nạp lại schema (lần apply: 6,6 s, 0 lỗi 503, 1 lỗi 500). Không apply lại; [biên nhận](../migrations/snapshots/send-exclusion-deleted-zalo-tags-v573/apply-receipt.json). Gỡ: [rollback](../migrations/rollback_v573_send_exclusion_deleted_zalo_tags.sql).

Desktop/legacy Server defer a phone exclusion-gate failure until the successful lookup milestone/quota has been recorded. The workflow receives no target, so sending and auxiliary actions stop. The scheduler bypasses generic input/error-policy writes and pauses the campaign through existing token-checked failure cleanup. A pause committed before a lost response stays paused; an input still running follows existing cleanup's terminal uncertainty handling and is not automatically requeued. Lifecycle shutdown/handoff guards retain precedence.

Group matches now use “Thỏa điều kiện loại trừ của nhóm ‘gđ bb’.” in the input note and skip log. For phone campaigns, the confirmed reason is carried in the per-input context because the workflow receives a separate input object; the deferred log runs after the lookup detail/quota and never infers opt-out from a stale or missing note. A pause CAS that changes no row emits no skip log. The Chat worker wording update was deployed on 2026-09-29 (Vietnam time), without restarting the API or Zalo runtime; see the [deployment audit](../../akaAgentChatApi/docs/DEPLOY_SEND_EXCLUSIONS_20260929.md). The Desktop/legacy Zalo Server logging correction still needs release. Historical logs are unchanged.

One lazy `CampaignLabelContext` keeps the complete original label snapshot and a working copy/version. Evaluation and skip conditions use the original; actual writes use the working version and commit the response from `updateLabels`. No-op/excluded targets do not write. Chat metadata synchronization receives the snapshot/update response directly, without another `getLabels`.

Desktop/legacy Server label contexts are bound to the account, API instance and session generation (including the existing Web session guard). Invalidation rejects cached reads, writes and late responses; the guards only inspect RAM and do not issue extra Zalo requests. The group editor removes an unsupported/retired rule when it is switched off, including when no active operator remains; DB validation stays strict.

For Chat, `campaign_label_membership` and `apply_label.labelContextId` use the same unit token. Complete tag data remains only in the Zalo connection's RAM, not command payloads/results. Unit cleanup releases it; a new unit replaces it and a new connection has no old context. Context guards compare object identity, so disconnect/closed/stop/release/replacement also invalidate objects held by pending operations, even if a unit ID is reused. Standalone tagging without `labelContextId` creates an operation-local context bound to the connection's label-session generation; disconnect/closed/stop advances that generation even when there is no cached unit. Checks before writes and after responses reject stale work; tag metadata publication checks again after its user-info wait. These checks use only RAM and add no Zalo requests. Existing tag-only commands stay compatible. Unknown new commands on an old runtime fail closed.

DB facts use canonical Chat akaBiz membership when a conversation exists, including authoritative empty sets; otherwise they use the existing scoped contact fallback. Delivery facts share the extracted existing cooldown history query, same successful statuses, same account, existing UID/phone key normalization and Vietnam calendar dates. No history table, pool, connection source, cron or polling was added.

## Verification

- `node scripts/run-send-exclusion-db-smoke.cjs`: isolated PGlite transaction/rollback, source checksums, actual-role permissions, wrong staff/account, revision conflicts, pair/options/cardinality, 1,005 UIDs, account-isolated snapshots after backup group/list deletion, full-map save validation, missing/current-account invalid configuration, runtime claim token and pause CAS, extension by DB rows, in-use definition guards, deactivation, unchanged helpers, cooldown comparison against captured live function at Vietnam day boundaries.
- `node scripts/send-exclusion-smoke-test.cjs`: shared contract parity, extension, AND/OR/unknown/negation, short-circuit requests, removed tags, date comparisons, single-flight/versioned labels, 7-action scope.
- `node scripts/send-exclusion-runtime-smoke.cjs`: actual Desktop/Server preflight/phone-gate and label methods with isolated adapters; QR/Web API replacement, session invalidation and late read/write responses.
- `node scripts/run-send-exclusion-ui-smoke.cjs`: real React component, fifth field from DB fixture, multiple lists, account isolation, save deduplication, errors/retry, wide/narrow/light/dark, keyboard close and removal of retired/unsupported rules. Screenshots go to a unique `akaagent-exclusions-ui-artifacts-*` directory under the OS temporary directory; the command prints its path. The original verification images are archived outside the repository at `/Users/lequangnhut/.codex/artifacts/akaAgent/send-exclusions-20260929/`.
- `node scripts/run-send-exclusion-form-smoke.cjs`: actual full campaign form with the four production definitions, legacy selection, save/edit/clone/draft, and wide/narrow screenshots under `akaagent-exclusions-form-artifacts-*` in the OS temporary directory.
- Regressions: `zalo-auxiliary-skip-smoke-test.cjs`, `zalo-message-opt-out-smoke-test.cjs`, `run-zalo-auxiliary-skip-ui-smoke.cjs`.
- `node scripts/campaign-failure-cleanup-smoke-test.cjs`: full scheduler/phone helper/milestone flow on Desktop and Server; exclusion pause failure before commit or after a lost response preserves one successful lookup detail/quota, blocks downstream work, avoids generic input overwrites and Zalo error policy, and hands off to token-checked cleanup.
- Chat suites: campaign executor/scheduler, account supervisor, label adapter, auxiliary protocol. New executor tests cover all 7 actions, no auxiliaries, lookup quota, frozen run/resume, account isolation and shared label context.
- Chat `campaignLabelLifecycle.test.ts`: real connection adapter with mocked Zalo transport; 26 regressions cover both shared and standalone contexts, invalidation before a read starts, cached writes, late reads/updates, disconnect/closed/stop/release/new-unit invalidation, reused unit IDs, metadata sync interrupted while awaiting user info, one label read, working versions, skip/no-op writes and fresh standalone calls after reconnect.
- Both akaAgent typechecks and production build; akaAgentChatApi typecheck and build.

## Deployment order (application release needs separate authorization)

1. **DB complete:** v330 is applied to linked `akachat / cgjbsmqtfhqvttudyjzq`; live checksums/ACL, rollback smoke and PostgREST schema probes passed. Do not reapply it or create a duplicate history row.
2. **Chat backend deployed:** Zalo runtime/protocol and worker are updated; API gateway kept its existing compatible code. Legacy Zalo Server still needs release. See the backend audit for health/queue and account-login observations.
3. Publish Desktop after DB and runtime compatibility are confirmed.

No WebApp UI or other platform was changed. Existing campaigns without the JSON map retain their old behavior. Old clients/runtimes must be upgraded before selecting the new configuration.
