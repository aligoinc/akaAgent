# Engine v2 spec: Zalo campaign scheduling, target ordering and completion

Read-only behavior spec and gap analysis, written 12/11/2026 from the worktree `feat/campaign-engine-v2`
(uncommitted state at the time of reading). The Desktop/VPS runner is the standard.

- **Desktop**: `CampaignScheduler` with `runtimeTarget = 'desktop'` (QR and Zalo Web accounts).
- **VPS**: the same class with `runtimeTarget = 'server'` (App Server, Zalo Server accounts). Where VPS differs it is called out,
  because the Fly worker must reproduce the VPS behavior.
- **Engine**: `packages/campaign-engine` + `src/main/engineAdapters/*` + the V495 RPCs.
- **V495** = `migrations/migration_v495_campaign_outcome_engine.sql`. `aka_agent_engine_claim_target_v1` was replaced by V499
  (`migrations/migration_v499_target_memory_per_account.sql:50-314`) with an identical body except the target-memory gate
  (V499:243-245). V495 line N of the claim maps to V499 line N-642 up to V495:884 and N-641 after it. V500 is data only.
  `finish_campaign_v1`, `release_v1`, `heartbeat_v1` and `close_stale_v1` are as in V495.
- Legacy SQL is cited from the newest migration file in this repo that defines it (v186, v214, v219, v231, v234, v340, v397, v409,
  v484). No database was queried for this spec, so a live definition that drifted from the files would not show here.
- Every time is Asia/Ho_Chi_Minh (VN). Text in `code` is verbatim; `${...}` is the interpolation exactly as in the source.
- Desktop prints dates in completion lines with `formatVietnamDateTime` (`campaignScheduler.ts:2774-2784`,
  `toLocaleString('vi-VN', …)`), which renders e.g. `09:30 12/11/2026`. V495 notes use `HH24:MI DD/MM`
  (`aka_agent_engine_format_vn`, V495:397-400), e.g. `09:30 12/11`.

## 0. Summary of gaps

| # | Behavior | Engine today | Severity |
|---|---|---|---|
| G1 | Claim refuses a stale schedule until daily maintenance has run (`daily_maintenance_required`) | Not checked; the claim even rewrites `schedule` to now (V495:932-936) | High (wrong day / wrong time for weekly, monthly, daily + continueNextDay; resumed campaigns) |
| G2 | Waiting on quota / action lock never changes `schedule` | Claim moves `schedule` to the wait end, possibly into a later VN day (V495:914-924); that escapes maintenance | High (runs at 00:00 instead of configured time, on non-scheduled weekdays, past the end date) |
| G3 | A target that returns to the queue is retried in the next pass, after the rest of the list | `requeue_ends_unit` ends the unit and the next unit claims the same lowest-id row first (V495:1385-1389, V495:823-826) | High (one failing row can starve the campaign every tick) |
| G4 | Completion matrix (`handleCampaignCompletion`) | `finish_campaign_v1` only does "defer to future data" or "complete" (V495:1717-1748) | Blocks multi-slot, share repeat, data group, realtime; text gaps for others |
| G5 | Data-group campaigns wait for new data, hard-end finalizer, sweep | No data-group rule anywhere; `finish` would set `hoàn thành`, which stops the source permanently (trigger) | Critical once data_group is enabled (today excluded by `zaloMessagePhoneV2Support`) |
| G6 | Claim clears `note` when the campaign starts | Note kept; stale wait notes stay visible while running | Medium |
| G7 | Account must be `chờ xử lý` to start; stop at next target when the account is paused | Account status not checked by the claim; heartbeat only every 60 s | Medium (Fly: paused account keeps sending) |
| G8 | Pause requested during the rest between targets stops immediately | Pace sleep is not interrupted; one more target is claimed after the sleep (`runUnit.ts:390-400`) | Medium |
| G9 | Campaign-level progress lines (`⏹`, `⏸`, `⏳ Hẹn chạy tiếp…`, `⚠️ Dừng chiến dịch…`, completion suffixes) | Only `🚀`, the wait line `⚠️ Chưa thể chạy chiến dịch: …` and plain `✅ Hoàn thành chiến dịch` | Medium (customer-visible) |
| G10 | `provisioning_state = 'ready'` and Zalo Web concurrency limit enforced in the claim RPC | Not enforced by V495 | Medium (Fly / Zalo Web) |
| G11 | Find-data wait note written without a log line | Wrapper writes the note and logs `⚠️ Chưa thể chạy chiến dịch: …` every tick | Low (log spam) |
| G12 | Pause pending note `Đang chờ tạm dừng`; `⏸` line for a DB-first (Web/Server) pause | Not written for engine runs | Low |

## 1. Campaign dispatch (which campaign runs, and when)

### 1.1 Desktop / VPS

1. **Tick.** Every 30 s (`campaignScheduler.ts:1129`) or on wake. Body: `tick()` (`campaignScheduler.ts:1671-1815`).
   - The first call is `getReadyRuntimeClock()` (`:1681`, `:1665-1669`), which runs the once-per-VN-day schedule maintenance
     (section 3.3). No campaign is dispatched on a new VN day before that maintenance has completed.
   - `enable_due_auto_account_actions` at most once per 30 s per process (`:1685-1690`, `:713-725`).
   - Accounts come from `getEligibleAccounts` (`accountRepository.ts:1033-1052`): active, not deleted, entitlement filter, no order.
2. **Pending campaigns of an account.** `getPendingCampaigns` / the batched variant (`campaignRepository.ts:3462-3487`, `:3498-3535`):
   - staff's campaigns with `status = 'chờ xử lý'`, `is_delete = false`, `provisioning_state = 'ready'`, not `sms_send`/`voice_call`;
   - `schedule <= dbNow`;
   - `daily_stop_time IS NULL OR daily_stop_time > <now VN time>` (`:3480`);
   - nothing at all once VN time ≥ `23:59:00` (`:3469`);
   - order `schedule ASC, created_at ASC, id ASC` (`:3482-3484`).

   Hard-ended data-group campaigns are finalized here, before any account gate (`campaignScheduler.ts:1729-1735`).
3. **Account gates** (`:1739-1768`):
   - skip while the account is starting, has an account operation, already has a queue, or web enrichment runs;
   - `account.status === 'chờ xử lý'` and `loginStatus === 'đã đăng nhập'` (`:1745`);
   - a Zalo Web account needs a verified web session (`:1752-1753`);
   - a browser tab must be registered (`:1761-1766`).
4. **Account queue.** One queue per account; its campaigns run strictly one after another in the order above
   (`runAccountCampaignQueue`, `:2030-2090`). Before each campaign the queue:
   - runs the maintenance gate again (`:2045`);
   - skips campaigns remembered as preclaim-limited (`:2048`, `shouldSkipPreclaimLimitedCampaign` `:3528-3541`);
   - re-reads the campaign and requires `chờ xử lý`, not deleted, and inside the dispatch window (`:2049-2061`;
     `isWithinCampaignDispatchSchedule` `:1841-1845`).
5. **Engine branch.** `engineRunner.support(account, campaign).ok` → `engineRunner.run(...)`, then the next campaign
   (`:2063-2073`). Otherwise the legacy `executeCampaign`.
6. **Legacy start sequence** (`executeCampaignWithResultContext`, `:3555-3928`):
   1. Re-read; must still be `chờ xử lý` (`:3568-3572`).
   2. **Preclaim limit check, no writes** (`:3574-3592`). If an action is disabled or a quota is full:
      - note already equal → remember the skip until `retryAfterMs`, at most 5 min (`:3582-3586`, `:3503-3526`, `:712`);
      - otherwise CAS-write the note on the still-unclaimed `chờ xử lý` row (`updatePendingUnclaimedCampaignNote`,
        `campaignRepository.ts:2482-2518`) and log `⚠️ Chưa thể chạy chiến dịch: ${updated.note || note}` (`:9886`).
      - **`schedule` is never changed.** The note text is the rendered `auto_error.noti_campaign`/`noti_running_process`
        plus action context (`buildLimitPreflightNoteDetail`, `:9923-…`).
   3. **DB claim** `aka_agent_claim_campaign_runtime_v2` (`:3594-3645`; SQL `migration_v340_browser_run_limits.sql:262-…`,
      which calls `aka_agent_claim_campaign_runtime_checked`, `migration_v397_campaign_shared_schedule.sql:38-249`). It rejects:
      - **stale schedule**: `status = 'chờ xử lý' AND schedule < VN day start`, unless `schedule_type = 'daily'` and
        `continue_next_day` is not true → `daily_maintenance_required` (v340:400-416, rechecked at v340:543-560, 618-628).
        The host invalidates the maintenance coordinator, reruns maintenance and retries the claim (`:3620-3644`);
      - at or after `least(coalesce(daily_stop_time, '23:59'), '23:59')` → `daily_stop_due` / `daily_drain_due` (v340:420-441);
      - not due, data-group hard-ended, or a data-group campaign without a due `chờ xử lý` row (v397:185-206, helper v397:13-34);
      - campaign not `chờ xử lý` or `provisioning_state <> 'ready'`; account deleted, inactive, not `chờ xử lý` or not logged in
        (v397:194-212);
      - Zalo Web / Facebook concurrency (`org_staff.max_running_zalo_web_accounts`, v397:214-238) → `concurrency_limit_reached`,
        note `Đã đạt giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời. Chiến dịch sẽ tự chạy khi có chỗ.`
        (`browserRunLimits.ts:39-44`, host `:3647-3651`).

      Success: campaign `đang chạy` **and `note = NULL`**, account `đang chạy` (v397:240-245).
   4. Run boundary context: claimed VN date + cutoff (`:3685-3703`, `createCampaignRunBoundary` `:2956-2985`).
   5. Preflight after the claim:
      - find-data source wait: `releaseClaimedCampaignPreflight` → `chờ xử lý`, note `Đang chờ data từ chiến dịch tìm data`,
        **no progress line** (`:3740-3744`, `:3441-3458`, `:9896-9915`);
      - Zalo session check (`:3777-3780`, `ensureZaloSessionReadyForCampaign` `:9699-9735`): note
        `Tài khoản Zalo chưa đăng nhập hoặc phiên đăng nhập đã hết hạn` (or the Web verification reason) and `⚠️ ${message}`.
   6. `🚀 Bắt đầu chiến dịch "${campaign.name}" trên tài khoản "${account.name}"` (`:3825`), **always**, before it is known
      whether any target is due.

### 1.2 Engine on Desktop

Host steps 1-5 are shared. `DesktopEngineRunner.run` (`desktopEngineRunner.ts:94-182`) then calls `runUnit`.
`support()` (`desktopEngineRunner.ts:77-83`) requires a Zalo account that is not Zalo Server, the campaign's own account, and
the type registry (`zaloCampaignV2Support`, `packages/campaign-engine/src/zalo/registry.ts:32-51`). Its only entry today
is `zalo_message_phone` with `zaloMessagePhoneV2Support` (`packages/campaign-engine/src/zalo/messagePhone.ts:114-131`), which
among other unported features refuses `data_group` and share mode. That list is changing while other specs are implemented
(aux actions and akaBiz tag were removed from it on 12/11 while this spec was written), so read the function, not this sentence.
No scheduling feature (multi-slot, share repeat, realtime, data group) is gated by the registry itself.

There is no preclaim check and no runtime claim. The first DB call is `aka_agent_engine_claim_target_v1` (V495:692-954).

| Legacy rule | V495 claim |
|---|---|
| Stale schedule → `daily_maintenance_required` | **Missing.** V495:932-936 even sets `schedule = now` when `schedule < VN day start` (G1) |
| Daily stop / 23:59 drain | Present (V495:807-821), plus `vietnam_day_changed` when the lease was acquired on an earlier day |
| `provisioning_state = 'ready'` | **Missing** (Desktop host filters it; Fly must) (G10) |
| Account `status = 'chờ xử lý'` to start | **Missing.** Only `is_active` + `login_status` (V495:770-772). The account becomes `đang chạy` only if it was `chờ xử lý` (V495:937) (G7) |
| Zalo Web concurrency limit | **Missing** (G10) |
| Data group: due row required, hard end | **Missing** (G5) |
| `note = NULL` on start | **Missing** (G6) |
| Legacy run active on the account | `legacy_busy` (V495:756-762) |
| Session check before the run | None (host checks only DB login status and the Zalo Web verified flag) |
| `🚀 Bắt đầu chiến dịch …` | Printed only when a target is actually claimed (`runUnit.ts:211-218`, `:401-403`). A campaign with nothing due prints only `✅ Hoàn thành chiến dịch …` |

## 2. Target selection, order and retries

### 2.1 Desktop per-target loop (`executeCampaignV2`, `campaignScheduler.ts:3929-5102`)

- **Snapshot.** All non-deleted rows of the campaign are read once at the start (`:3941`;
  `listCampaignInputData`, `campaignRepository.ts:4068-4091`), ordered `created_at ASC, id ASC`. Rows inserted later are not in
  this pass.
- Type-specific materialization runs before the loop (friends, birthday, recommendation, cancel-sent requests; `:3971-4061`,
  see `zalo-other-types.md`).
- Zero rows: the loop runs once with `detail = null` (`runOnce`, `:4172-4173`). The null-target path of each Zalo helper was not
  traced here.
- **Loop** (`:4186-5092`), per row:
  1. skip rows whose snapshot status is not `chờ xử lý` (`:4197`);
  2. run-boundary check (daily stop / 23:59 / day change) (`:4203`);
  3. Zalo runtime mode stop (`:4207-4218`);
  4. pause: VPS run-control state, local pause latch, or DB status `tạm dừng` (`:4221-4231`);
  5. data-group hard end (`:4233-4240`);
  6. account block: VPS hard stop or `getAccountRunBlockReason(account.id, 'đang chạy')` (`:4243-4252`, `:9688-9697`);
  7. **row `schedule` in the future → skip the row and remember the earliest such schedule** (`:4254-4263`);
  8. friend blocklist (`:4266-4270`), opt-out preflight (`:4273-4276`), recent-delivery cooldown (`:4278-4295`);
  9. action disabled / quota → `handleLimitStatus` and **stop the pass** (`:4356-4383`);
  10. unit claim `beginCampaignRunUnit` (`:4505-4510`, `:9348-…`), then the workflow;
  11. rest between targets if the row is not the last of the snapshot (`:5071-5091`, `sleepBetweenTargets` `:1599-1663`).
- **End of pass** (`:5094-5101`): if not stopped, either `deferCampaignUntilFutureInput` (earliest future row) or
  `handleCampaignCompletion`; then `releaseRunningAccount`.

### 2.2 Share mode (`executeZaloShareMessageBatchCampaign`, `campaignScheduler.ts:5790-6246`)

Used when `zaloMessageSendMode === 'share'` for `zalo_message_friend` / `zalo_message_group` (`:5766-5771`). Same snapshot.
Batches of `min(50, daily quota left, window quota left)` rows (`getZaloShareMessageBatchCapacity`, `:6252-6305`;
`ZALO_SHARE_MESSAGE_BATCH_SIZE = 50`, `:669`). Each row is visited once per pass. Future rows are skipped and remembered
(`:5951-5963`). End of pass is the same as 2.1 (`:6229-6236`).

### 2.3 Retries (Desktop)

- A row is only retried when its outcome returns it to `chờ xử lý` (policy without `detail_status`, or `input_effect = 'requeue'`;
  legacy settle `aka_agent_settle_action_results_v1`, `migration_v366_action_status_runtime_fixes.sql:12-…`). The settle never
  writes the row `schedule`, so there is no per-row delay.
- A requeue of a row whose operation was committed or unknown becomes `tạm dừng` in the legacy settle (v366:76). V495 turns it
  into `hoàn thành` instead (`no_requeue_after_delivery`, V495:1378-1381). Both stop retries, but `tạm dừng` rows are excluded from
  multi-slot / share-repeat resets and `hoàn thành` rows are not. The outcome itself belongs to the outcomes spec.
- Inside a pass a row is never tried twice: the loop walks the snapshot once.
- At the end of the pass the finalizer sees `chờ xử lý` rows. `aka_agent_finalize_campaign`
  (`migration_v214_campaign_finalize_pending_guard.sql:7-138`) counts **every** `chờ xử lý` row (future ones too). If any exist,
  the campaign goes back to `chờ xử lý` with `note = NULL`, `completed_at = NULL`, schedule unchanged (v214:87-108), and the
  host logs `⏳ Phát hiện ${finalized.pendingInputCount} data mới đang chờ xử lý; chiến dịch chưa hoàn thành.`
  (`campaignScheduler.ts:2236-2241`). The next tick starts a new pass, which reaches the row in its normal order.
- With multi-slot / share repeat the due rows keep the current slot: `Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.`
  (`:2494-2503`).

### 2.4 Engine (V495 claim, V495:823-837)

- One row per claim: `status = 'chờ xử lý'`, not deleted, `schedule IS NULL OR schedule <= now`, **`ORDER BY id`**, `LIMIT 1 FOR
  UPDATE SKIP LOCKED`. Rows inserted during the unit are picked in the same unit (Desktop waits for the next pass). Order is `id`
  instead of `created_at, id` (identical unless `created_at` is written explicitly).
- `no_target` returns `nextSchedule` (earliest future row), `runningTargets`, `hasTargets` (V495:827-837).
- **Retries (G3).** `report_v1` maps a suppress-mode error, or `input_effect = 'requeue'`, to `target_effect = 'requeue'`
  (V495:2032-2036). A requeue without delay sets `requeue_ends_unit` (V495:1385-1389), so the unit ends. In the next unit the claim
  orders by `id`, so the same row is claimed first again. A row that keeps requeueing is retried roughly every tick and the
  rows after it are never reached. Desktop retries it once per pass and still processes the rest of the list.
- No batch claim exists, so share mode (required by share repeat) cannot be expressed with `claim_target_v1`.

## 3. Daily boundaries and schedule maintenance

### 3.1 Dispatch cutoff

- `isAtOrAfterCampaignDispatchCutoff` (`campaignScheduler.ts:2942-2954`): a configured `dailyStopTime` (HH:mm or HH:mm:ss) stops
  at that second (`isAfterDailyStopTime`, `:2903-2911`). A stop later than 23:59, or no stop, uses `23:59`.
- The run boundary is pinned to the **claimed** VN day (`createCampaignRunBoundary`, `:2956-2985`). It is reached when the DB VN
  day differs from the claimed day or the DB time is ≥ the cutoff (`:2987-3001`).
- The boundary is checked before every target and batch, and every 500 ms during the rest between targets (`:1606-1614`).

### 3.2 Yield at the boundary

`yieldCampaignAtRunBoundary` (`:3120-3288`):
- First settles the unit lease (`:3140`).
- A pending local pause completes as a pause.
- Then the CAS RPC `aka_agent_yield_campaign_daily_boundary` (`migration_v231_campaign_daily_runtime_boundary.sql:2352-…`;
  update at 2584-2623) sets campaign and account to `chờ xử lý`. It never changes `schedule`, `note` or rows.
- Logged once per run (`:3276-3284`):
  - `⏹ Đã đến giờ dừng ${check.context.cutoffLabel}; đã hoàn tất lượt hiện tại và không mở lượt mới.` (configured stop;
    label `HH:MM` or `HH:MM:SS`, `:2980`);
  - `⏹ Đã đến mốc dừng cuối ngày 23:59; đã hoàn tất lượt hiện tại và không mở lượt mới.`;
  - `⏹ Không xác minh được giờ DB; đã dừng an toàn trước lượt tiếp theo.`

Engine: the claim returns `daily_boundary` with `daily_stop_due` / `daily_drain_due` (nextAt = next 00:00 VN) or
`vietnam_day_changed` (nextAt = now) (V495:807-821). The unit ends and `release_v1` sets campaign and account `chờ xử lý`
(V495:1510-1528), matching the yield. **No `⏹` line is printed (G9).** The pace sleep is not interrupted at the cutoff: the
boundary is only seen at the next claim.

Edge case: Desktop finishes a pass that ends after 00:00 and immediately calls `handleCampaignCompletion`. The engine instead
gets `vietnam_day_changed` at the next claim and defers the completion decision to a unit after maintenance. For a daily
multi-slot campaign that is the difference between "complete" (Desktop: the slot check fails because the claimed schedule is on
the previous day, `:2435-2438`) and "start the slots again" (engine, after maintenance moved `schedule` to today).

### 3.3 Maintenance (once per VN day, before dispatch)

- Coordinator: `dailyMaintenanceCoordinator.ts:110-180`. Desktop wiring `src/main/ipc/handlers.ts:304-345`: wait for the DB
  barrier, run `maintainCampaignSchedules(dateKey)`, then `sweepExpiredDataGroupCampaignsForMaintenance()`.
- The barrier (`aka_agent_check_daily_maintenance_barrier`, v231:2649-…) counts campaigns holding an old-day unit lease, and
  `đang chạy` campaigns whose claim date is older than today (or, with no claim date, whose `schedule` is older than today).
  An engine unit crossing midnight holds it (`đang chạy` with an old `schedule`) until `release_v1`.
- `maintainCampaignSchedules` (`campaignRepository.ts:3595-3917`) only looks at campaigns with `status IN ('chờ xử lý',
  'hoàn thành')`, `schedule < today 00:00`, non-deleted primary account of the runtime (`:3616-3663`). For each:

| Case | Lines | Result |
|---|---|---|
| Daily birthday / newsfeed already `hoàn thành` | `:3691-3697` | untouched |
| `resolveNextSchedule` fails (bad weekdays/days) | `:3699-3713` | if `chờ xử lý`: `tạm dừng`, note `Lịch chạy không hợp lệ. Vui lòng kiểm tra lại ngày chạy trong tuần/tháng.` |
| Next run is after `schedule_end_date` | `:3715-3728` | finalize (expected status `chờ xử lý`) with note `Chiến dịch đã hết ngày kết thúc`; it completes only when no `chờ xử lý` row remains, otherwise the campaign stays `chờ xử lý` with `note = NULL` (v214:87-108). Then `schedule = next` |
| `chờ xử lý` and next run time is ≥ 23:59 | `:3730-3741` | `tạm dừng`, note `23:59 là thời gian hệ thống dừng nhận lượt mới để cập nhật lịch ngày mới. Vui lòng chọn giờ chạy sớm hơn.` |
| Daily birthday | `:3744-3771` | finalize, note `Chiến dịch chúc mừng sinh nhật không chạy bù qua ngày` |
| Daily newsfeed | `:3772-3794` | finalize, note `Chiến dịch lướt newsfeed không chạy tiếp qua ngày` |
| Daily, not `chờ xử lý` | `:3795` | untouched (a completed daily campaign stays completed) |
| Daily, `continueNextDay = true` | `:3801-3806` | `schedule = today at original time`, `note = NULL` |
| Daily, `continueNextDay = false` | `:3807-3810` | schedule kept (already due, continues right after midnight), `note = NULL` |
| Weekly/monthly friend recommendation / cancel-sent / birthday | `:3818-3867` | rows cleared/soft-deleted, materialization reset, `chờ xử lý`, `schedule = next` |
| Weekly/monthly with `refreshData` and all rows done (or none) | `:3869-3892` | rows (except `tạm dừng`) reset to `chờ xử lý`, `note=''`, `date_action=NULL`; campaign `chờ xử lý`, `schedule = next`, `note = NULL` |
| Other weekly/monthly | `:3894-3898` | `schedule = next`, `note = NULL`, status unchanged (a `hoàn thành` one stays completed; a `chờ xử lý` one continues its data on the next run day) |

- `resolveNextSchedule` (`campaignRepository.ts:1082-1123`): time from `original_schedule ?? schedule`; daily → today; weekly →
  first matching weekday in 14 days (`schedule_week_days`, 2=Mon … 8=Sun); monthly → first matching day-of-month in 370 days
  (`schedule_days`). `isPastScheduleEnd` (`:1125-1128`).

### 3.4 Schedule settings (as the form saves them)

- `scheduleType` is only `'daily' | 'weekly' | 'monthly'` (`src/shared/types.ts:788`); empty/NULL is treated as daily
  (`campaignRepository.ts:1085`, v340 `COALESCE(NULLIF(schedule_type, ''), 'daily')`). There is no "once" or custom type.
- `continueNextDay` (daily only; default true, forced false for newsfeed, birthday and realtime;
  `CampaignFormModal.tsx:1919-1921`, `:6456`), label `Nếu chưa chạy hết data, hôm sau chiến dịch sẽ tiếp tục chạy theo thời gian hẹn giờ.`
  (`:17318`).
- `refreshData` (weekly/monthly, not data group; default true; `:1922`, `:17322-17331`).
- `scheduleEndDate` only for weekly/monthly, saved as 23:59:59 VN of the chosen day; NULL for daily (`:6277-6280`).
- Multi-slot: `schedule` = first slot, `originalSchedule` keeps the recurrence anchor (`:6268-6276`).

### 3.5 Engine vs maintenance (G1, G2)

- **G1.** Desktop happens to run maintenance before the engine because the host gates every dispatch on it. Two holes remain
  even on Desktop:
  - **Resume after midnight.** Maintenance ignores `tạm dừng` rows. A weekly campaign paused before midnight and resumed later
    keeps yesterday's schedule. The legacy claim answers `daily_maintenance_required`, maintenance reruns and moves it to the
    next run day. The engine claim runs it immediately and moves `schedule` to now.
  - **Fly.** The RPC must not assume that the host ran maintenance first.
- **G2.** The wait update (V495:914-924) sets `schedule = greatest(schedule, until)`:
  - daily quota → until next 00:00 VN (V495:858-861);
  - window quota → oldest + window (V495:876-880);
  - action lock → `date_enable` (V495:845-848).
  When `until` falls on a later VN day, maintenance no longer selects the campaign (it needs `schedule < today 00:00`, `campaignRepository.ts:3624`),
  so the campaign runs at `until`:
  - at 00:00 instead of the configured time for daily + `continueNextDay`;
  - on a non-scheduled weekday or month day for weekly/monthly;
  - after `schedule_end_date` without being finalized;
  - without the `refreshData` reset.

  Data-group rows routed meanwhile also inherit the moved schedule (routing inserts `schedule = campaign.schedule`,
  `migration_v409_group_sharing.sql:2614`). Desktop never moves `schedule` for waits. It keeps the old due
  schedule and relies on the note plus the in-memory preclaim skip (section 1.1 step 6.2).
- The claim's `schedule = now` rewrite (V495:932-936) also changes the recurrence anchor of campaigns whose `original_schedule`
  is NULL. It feeds the "current slot" of multi-slot completion with a time that is not the slot (see 5.5).

## 4. Waiting on quota and action locks (scheduling side only)

Gate rules themselves are in `zalo-gates-content.md`. Effect on the campaign row:

| | Desktop before start | Desktop mid-pass | Engine (any time) |
|---|---|---|---|
| Status | stays `chờ xử lý` | `auto_error.update_status_campaign` or `chờ xử lý` (`applyRuntimeErrorPolicy`, `campaignScheduler.ts:10236-10318`, status at `:10292`) | `chờ xử lý` (V495:918) |
| `schedule` | unchanged | unchanged | `greatest(schedule, until)` (V495:919) |
| `note` | rendered `noti_campaign`/`noti_running_process` + action context, CAS on unclaimed row | same rendering (`:10276-10285`) | `⏳ ${customer_title or error_name or 'Tạm chờ'}, chạy tiếp lúc HH:MI DD/MM (CODE)` (V495:684-690) |
| Log | `⚠️ Chưa thể chạy chiến dịch: ${note}` (`:9886`), only when the note changes | `⚠️ Dừng chiến dịch "${campaign.name}": ${message}` (`:10314`) | `⚠️ Chưa thể chạy chiến dịch: ${note without ⏳}` when the note changed (`runUnit.ts:405-411`) |
| Re-check | skip memo up to `retryAfter` / 5 min (`:3503-3541`) | next tick | not due until `until` (host filter) |

Note: v15 seeded `error_limit_in_day` / `error_limit_in_hour` texts as `Đạt giới hạn trong ngày là [x]` and
`Đạt giới hạn trong giờ là [x] tạm nghỉ [t] phút` (`migration_v15_account_action_limits_errors.sql:177-191`). The live texts may
have been edited since. The engine note format is a new design (customer title + public code); confirm it is intended.

## 5. Campaign completion

### 5.1 Entry points

Completion is reached when a pass ends without a stop and the pass saw no future-scheduled row:
- per-target loop `:5094-5099` and share batch `:6229-6234`;
- data group with no due row at start, `:3962-3969`;
- cancel-sent with no targets, `:8716-8722`;
- realtime preparation, `:3394-3439`.

Future rows first: `deferCampaignUntilFutureInput` (`:3355-3363`) sets `chờ xử lý`, `schedule = earliest row schedule`,
**`note = NULL`**, and logs `⏳ Hẹn chạy tiếp chiến dịch lúc ${this.formatVietnamDateTime(scheduledAt)}`.

### 5.2 `handleCampaignCompletion` (`campaignScheduler.ts:2321-2368`), in this order

| Step | Condition | Result (status / note / log) | Lines |
|---|---|---|---|
| 1 | `dataTargetSourceMode === 'data_group'` | data-group finalizer (section 6). Completed: `✅ Hoàn thành chiến dịch "${campaign.name}"`. Otherwise `⏳ Chiến dịch "${campaign.name}" đang chờ data mới từ Nhóm data` | `:2325-2334` |
| 2 | `zalo_message_group_realtime` | due rows → `chờ xử lý`, `schedule = now`, `note = NULL`. Future rows → defer (above). Window still open → `chờ xử lý`, `schedule = next anchor time` (`:3381-3392`), `note = NULL`, `⏳ Chiến dịch "${campaign.name}" tiếp tục chờ data theo thời gian thực từ group Zalo`. Else complete, note `Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy`, `✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày nhận data theo thời gian thực)` | `:2370-2422` |
| 3 | `scheduleEndDate` and `now >= endDate` | complete (note unchanged), `✅ Hoàn thành chiến dịch "${campaign.name}" (hết ngày kết thúc)` | `:2341-2350` |
| 4 | multi-slot | section 5.5 | `:2352-2354` |
| 5 | share repeat | section 5.6 | `:2356-2358` |
| 6 | rerun after completion (Facebook find-data/comment/newsfeed only, not Zalo) | not applicable | `:2360-2362`, `:2659-2734` |
| 7 | otherwise | complete (note unchanged), `✅ Hoàn thành chiến dịch "${campaign.name}"` | `:2364-2367` |

### 5.3 `transitionCampaignToCompleted` (`campaignScheduler.ts:2204-2243`)

- **Data group**: `finalizeDataGroupCampaign` (Desktop RPC `aka_agent_finalize_data_group_campaign`, VPS
  `aka_agent_finalize_zalo_server_data_group_campaign`; `dataGroupRepository.ts:1092-1119`).
- **VPS-claimed Zalo Server**: `aka_agent_finalize_zalo_server_campaign`
  (`migration_v219_zalo_per_account_server_runtime.sql:3289-3379`). It takes the input serialization lock and locks all rows,
  then the campaign and account (3324-3351):
  - campaign no longer `đang chạy` → `campaign_control_won`;
  - account not `đang chạy` → campaign `chờ xử lý`, `note = NULL`, `account_control_won`;
  - any `chờ xử lý` row → `chờ xử lý`, `note = NULL`, `pending_input_remaining`;
  - else `hoàn thành` (note only if given).

  Host logs (`finishServerZaloFinalizationBoundary`, `:17470-17499`):
  - `⏸ Đã hoàn thành lượt hiện tại và tạm dừng tài khoản.`
  - `🔄 Đã hoàn thành lượt hiện tại và áp dụng trạng thái mới của tài khoản.`
  - `⏸ Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.`
  - `🔄 Đã hoàn thành lượt hiện tại và áp dụng trạng thái mới của chiến dịch.`
- **Desktop ordinary**: `aka_agent_finalize_campaign` (v214, expected status `đang chạy`). Note kept unless a note is passed
  (Desktop passes none in steps 3 and 7). A paused campaign → `campaign_control_won` (not completed, no log).
- `completed_at` is set by trigger `aka_agent_set_campaign_completed_at` (`migration_v69_email_notifications.sql:145-155`).
  The status change also fires the completion-email and data-group-source triggers (v361 snapshot list of `auto_campaigns`
  triggers).

### 5.4 `rescheduleCompletedCampaignPass` (`campaignScheduler.ts:2487-2603`), shared by multi-slot and share repeat

1. Any due `chờ xử lý` row (rows may have arrived after the snapshot) → CAS on `đang chạy`: `chờ xử lý`, note
   `Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.`, schedule unchanged, no log (`:2496-2503`).
2. Future rows → `chờ xử lý`, `schedule = earliest`, `note = NULL`; if the write took, `⏳ Hẹn chạy tiếp chiến dịch lúc ${…}` (`:2506-2526`).
3. Rows exist but all are `tạm dừng` → complete, `✅ Hoàn thành chiến dịch "${campaign.name}" (không có data cần chạy lại ${labels.emptyDataSuffix})` (`:2527-2534`).
4. Friend/group with zero rows → same line (`:2542-2551`). The Facebook page variant (`không có page cần chạy lại`, `:2535-2541`) is not Zalo.
5. Otherwise the slot advances:
   - **Desktop** (non-atomic):
     - `resetCampaignInputDataForRerun` (`campaignRepository.ts:6015-6032`): every row except `tạm dừng` becomes `chờ xử lý`,
       `note=''`, `date_action=NULL`; row `schedule` untouched. Refuses data-group campaigns.
     - then campaign `chờ xử lý`, `schedule = next`, `note = NULL` (`:2591-2600`).
   - **VPS**: atomic `aka_agent_advance_zalo_server_multi_daily_slot` (v219:2948-3042; RPC wrapper
     `campaignRepository.ts:1496-1537`).
     - Takes the serialization lock, then locks rows → campaign + account.
     - Only for `zalo_message_friend` / `zalo_message_group` Server accounts.
     - Needs campaign **and** account `đang chạy`, else `runtime_control_paused` → pause boundary (`:2570-2574`).
     - Same reset, campaign `chờ xử lý` + `schedule` + `note = NULL`.
     - The account is released afterwards by the host.
   - Log `labels.scheduledLog` (`:2601`).

### 5.5 Multi-slot ("nhiều khung giờ") — `handleMultiDailyTimeSlotAfterCompletion` (`campaignScheduler.ts:2424-2480`)

- **Applies when:**
  - action in `MULTI_DAILY_TIME_SLOT_ACTION_IDS`: `facebook_timeline_post`, `facebook_page_post`, `zalo_message_friend`,
    `zalo_message_group` (`:671-676`);
  - `extraSettings.multiDailyTimeSlotsEnabled === true`;
  - ≥ 2 valid slots after normalization;
  - the campaign's current `schedule` (as read at the start of the run) is on the same VN day as now (`:2435-2438`).

  Otherwise it falls through to share repeat, then plain completion.
- **Slot parsing** (`:2791-2829`, same rules as `src/shared/campaignTimeSlots.ts:1-56`):
  - split on commas and newlines; trim, lowercase, remove whitespace;
  - accept `H`, `H:M`, `HhM`, `Hh` with hour 0-23 and minute 0-59;
  - dedupe by minute; sort ascending.
- **Next slot**: the first slot with minute > current slot minute and today-at-slot > now (`:2440-2455`).
  - None → complete, `✅ Hoàn thành chiến dịch "${campaign.name}" (không còn khung giờ chạy trong hôm nay)` (`:2457-2463`).
  - Next slot at or after the cutoff → complete, `✅ Hoàn thành chiến dịch "${campaign.name}" (khung giờ ${nextSlot} vượt quá giờ dừng trong ngày)` (`:2465-2474`).
  - Else `rescheduleCompletedCampaignPass` with suffix `ở khung giờ tiếp theo` and log
    `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "${campaign.name}" ở khung giờ ${nextSlot} (${this.formatVietnamDateTime(nextSchedule)})` (`:2476-2479`).
- A completed **daily** multi-slot campaign is not reopened by maintenance (section 3.3). Weekly/monthly + `refreshData` are
  reset on the next run day.
- The form disables multi-slot for data-group sources (`CampaignFormModal.tsx:2645-2652`), and it excludes share repeat
  (`:13507`, `:13537`).

### 5.6 Share repeat ("gửi lặp lại sau mỗi x phút") — `handleZaloShareRepeatAfterCompletion` (`campaignScheduler.ts:2610-2657`)

- **Applies when:**
  - `zaloShareRepeatEnabled === true`;
  - `supportsZaloShareRepeat` (`src/shared/zaloShareRepeat.ts:36-43`): `zalo_message_friend` / `zalo_message_group`,
    `zaloMessageSendMode === 'share'`, not data group;
  - multi-slot is off;
  - recent-delivery cooldown is off (`isRecentDeliveryCooldownEnabled`, `src/shared/campaignDeliveryCooldown.ts:43-49`);
  - `parseZaloShareRepeatMinutes` (`zaloShareRepeat.ts:46-51`) returns an integer 5-1439 (a number, or a string of 1-4 digits).
- `nextSchedule = now + minutes`, counted from the completion time (`:2623`).
- **Leaves the claimed VN day, or not the same VN day as now** → complete,
  `✅ Hoàn thành chiến dịch "${campaign.name}" (lượt gửi lặp kế tiếp đã sang ngày mới)` (`:2626-2640`).
- **At or after the cutoff** → complete, `✅ Hoàn thành chiến dịch "${campaign.name}" (lượt gửi lặp kế tiếp vượt quá giờ dừng trong ngày)` (`:2642-2651`).
- **Else** `rescheduleCompletedCampaignPass` with suffix `ở lượt gửi lặp kế tiếp` and log
  `⏳ Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch "${campaign.name}" lúc ${this.formatVietnamDateTime(nextSchedule)}` (`:2653-2656`).
- The visibility switch `web.zalo_share_repeat.enabled` is for forms only; the runner does not read it (CLAUDE.md).
  Chat-sync (akaAgentChatApi system-worker) does not implement it today.

### 5.7 Type-specific completions (details in `zalo-other-types.md`)

| Case | Status / note | Log | Lines |
|---|---|---|---|
| Friend auto data: nothing loaded | `chờ xử lý`, note `Không lấy được bạn bè Zalo nào để gửi tin` | `⚠️ ${message}` | `:3979-3985` |
| Friend auto data already loaded once, zero rows | `chờ xử lý`, note `Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy` | `⚠️ ${message}` | `:4037-4043` |
| Birthday: no target | complete, note `Không có bạn bè sinh nhật hôm nay` | `🎂 Không có bạn bè sinh nhật hôm nay`, then `✅ Hoàn thành chiến dịch "${campaign.name}"` | `:2749-2756`, `:4045-4049` |
| Friend recommendation: no target | complete, note `Zalo không có danh sách đề xuất để chạy` | `⚠️ ${note}`, then `✅ …` | `:2758-2765`, `:4051-4055` |
| Cancel sent requests: no target | note `Zalo không có lời mời kết bạn đã gửi để huỷ`, then the full `handleCampaignCompletion` | `⚠️ ${note}` | `:8716-8722`, `:4057-4061` |

### 5.8 V495 `finish_campaign_v1` (V495:1717-1748) against 5.1-5.7

`finish` is called by the core only when the claim returns `no_target` while a lease is held (`runUnit.ts:415-425`). Through the
Desktop wrapper (`desktopEngineRunner.ts:155-165`) it runs only when the campaign has data or no find-data source.

| Desktop behavior | V495 | Gap |
|---|---|---|
| Lease / ownership | Valid lease required (V495:1725-1727) | none |
| Deleted campaign | `campaign_deleted`, no change (V495:1729) | none (Desktop never completes a deleted campaign) |
| Paused / other status | `campaign_control_won` (V495:1730-1732) | none |
| VPS: account not `đang chạy` → campaign `chờ xử lý`, `account_control_won`, `⏸ …tạm dừng tài khoản.` | Not checked; completes | Fly parity |
| Serialization lock against concurrent row inserts | None | Fly parity (VPS finalizer takes it, v219:3324-3331) |
| Running rows / open runs | `targets_remaining`, no change (V495:1733-1738) | OK |
| Due `chờ xử lý` rows | `targets_remaining`, no change, no log | Desktop sets `chờ xử lý`, `note = NULL` and logs `⏳ Phát hiện … data mới…` (rare in the engine because new rows are claimed in the same unit) |
| Future rows → defer, `note = NULL`, `⏳ Hẹn chạy tiếp chiến dịch lúc …` | `schedule = min(future)`, note `Hẹn chạy tiếp khi data đến lịch.` (V495:1739-1745); no log | Note text and missing log |
| Data group | Not handled; would set `hoàn thành` | **G5** |
| Realtime group | Not handled | blocks realtime |
| End date reached → `(hết ngày kết thúc)` | Plain completion | Log suffix only |
| Multi-slot | Not handled (completes after the first pass) | **G4** |
| Share repeat | Not handled | **G4** |
| Completion note | `note = p_note` (Desktop wrapper passes NULL → note cleared) (V495:1746) | Desktop keeps the note. Equivalent today only because the legacy claim cleared it at start (G6) |
| Log | `✅ Hoàn thành chiến dịch "${campaignName}"` when `reason = 'completed'` (`runUnit.ts:421`, `progress.ts:45-47`) | Suffixes and other lines missing (G9) |

Earlier docs note that `zalo_message_phone` has no slots, repeat or realtime, so v1 was enough for it
(`docs/CAMPAIGN_OUTCOME_ENGINE.md:289`). For `zalo_message_phone` the remaining differences are: the deferral note and line,
the end-date suffix, the missing `🚀` line when nothing is due, and the cross-midnight edge case in 3.2.

## 6. Data-group campaigns (`data_target_source_mode = 'data_group'`)

### 6.1 How targets arrive

- **Bind / baseline.** The source is snapshotted into rows. If no compatible member exists, campaign note
  `Chờ data phù hợp`; otherwise the waiting notes are cleared (`migration_v186_data_groups_direct_campaign_inputs.sql:3636-3653`).
- **Creation bundles.** Campaigns are created with `provisioning_state = 'staged'` (`campaignRepository.ts:2128`, clone `:2731`),
  shown as `Đang nạp dữ liệu ban đầu` (`CampaignInfoView.tsx:799-803`) and in the pending reason as
  `Chiến dịch đang chuẩn bị data, chưa sẵn sàng chạy.` (`campaignPendingReasonService.ts:124`). The router accepts rows for a
  staged campaign only during its final baseline batch (`migration_v193_data_group_bundle_security_relationship.sql`, route
  wrapper, `campaign_creation_bundle_staged`/`_not_ready`). Dispatch requires `ready` (section 1.1).
- **Live intake.** Each new group member is routed by `aka_agent_internal_route_data_group_member` (wrapper
  `migration_v409_group_sharing.sql:2669-…`). The current routing core is `aka_agent_internal_route_data_group_member_v186_internal`
  as redefined in v409 (`migration_v409_group_sharing.sql:2261-…`; same logic as the original v186 core at
  `migration_v186_data_groups_direct_campaign_inputs.sql:1708-2146`):
  - no intake when the source is stopped, the campaign is hard-ended, or the campaign status is not
    `chờ xử lý`/`tạm dừng`/`đang chạy` (v409:2309-2337);
  - else insert a row with `status = 'chờ xử lý'`, **`schedule = COALESCE(campaign.schedule, now())`** and a canonical key (dedupe),
    plus alias and origin rows (v409:2606-2616, v186:2089-2131);
  - clears the campaign note when it is `Chờ data phù hợp` or `Chờ data mới` (v409:2655-2658, v186:2138-2141);
  - never changes the campaign status or schedule.
- Paused campaigns still receive rows while the source switch is on. V484 can route through a pg_cron job queue every 10 s for
  configured organizations (CLAUDE.md; `docs/DATA_GROUP_ASYNC_ROUTING_V484.md`).
- Reactivating a stopped source reopens a completed campaign as `chờ xử lý` with note `Chờ data mới` (v186:3870-3875; the same
  expression is kept in the latest redefinition, `migration_v484_data_group_async_routing_p3.sql:181`).

### 6.2 Runner differences

- **Claim**: refused when the campaign has no due `chờ xử lý` row, or `schedule_end_date <= now` (v397:185-206). A waiting
  campaign therefore stays `chờ xử lý` and is never marked running.
- **Hard end**:
  - checked in the tick before account gates (`campaignScheduler.ts:1729-1735`), before every target / batch / delay
    (`:4233-4240`, `:5867-5870`, `:5939-5942`, `:6045-6047`, `:6200-6202`), and swept after maintenance (`:2268-2286`);
  - the finalizer sets the remaining `chờ xử lý` rows to `hoàn thành` with note `Chiến dịch đã hết hạn` (unless already noted),
    stops the source, and completes once nothing is running (`aka_agent_internal_finalize_data_group_campaign_v219`,
    v219:1858-2026, hard-terminal branch 1919-1969);
  - campaign note: the passed note `Chiến dịch đã hết thời hạn nhận và chạy data mới` (`DATA_GROUP_HARD_END_NOTE`,
    `campaignScheduler.ts:729`), or `Chiến dịch đã hết hạn` from the sweep (v219:2213);
  - log `⏹ Chiến dịch đã hết thời hạn nhận và chạy data mới` (`:2316`, `:2281`).
- **Start with no `chờ xử lý` row at all**: completion goes straight to the finalizer (`:3962-3969`).
- **Normal end of pass** (`handleCampaignCompletion` step 1) — the finalizer returns:
  - `paused`;
  - `input_inflight`;
  - due/raced rows → `chờ xử lý`, note = passed note or NULL, `pending_input_raced`;
  - source `baselining`/`active` and before hard end → `chờ xử lý`, **note `Chờ data mới`**, `active_source_waiting`;
  - else `hoàn thành` (`source_stopped_and_drained`, `source_missing`, `hard_end_reached`) (v219:1971-2016).

  Log: `⏳ Chiến dịch "${campaign.name}" đang chờ data mới từ Nhóm data` or `✅ Hoàn thành chiến dịch "${campaign.name}"`.
- **Runtime ownership**: the Desktop finalizer RPC refuses Zalo Server accounts (`runtime_not_owner`, v219:2084-2091). The VPS
  uses `aka_agent_finalize_zalo_server_data_group_campaign` (v219:3811-…) and the server sweep variant.
- **Triggers**: `trg_aka_agent_close_terminal_campaign_data_group_source` (v186:4249-4291) stops the source when the campaign
  becomes `hoàn thành`, is deleted, or its end date is moved into the past. On delete or end date it also completes pending rows
  with `Hết hạn nguồn Nhóm data`.
- **Excluded features**: no multi-slot (form), no share repeat (`supportsZaloShareRepeat`), no full reset
  (`resetCampaignInputDataForRerun` throws, `campaignRepository.ts:6017-6019`), no `refreshData` option.
- **Maintenance**: `finalizeForMaintenance` routes data-group campaigns to the data-group finalizer (`campaignRepository.ts:3669-3672`).

### 6.3 Engine

- `zaloMessagePhoneV2Support` returns `data_group` (`messagePhone.ts:119`), so these campaigns run on the legacy runner today.
- Nothing in V495 knows data groups. Specifically:
  - the claim does not refuse a campaign without a due row or past its hard end;
  - `no_target` → `finish_campaign_v1` → `hoàn thành`, and the trigger then permanently stops the live source;
  - routed rows inherit the engine's moved `schedule` (G2).

## 7. Pause, resume, delete and account logout during a run

### 7.1 Desktop pause (`requestPauseCampaign`, `campaignScheduler.ts:1383-1492`)

- The local latch `pauseRequests` is set synchronously first (`:1403`).
- `chờ xử lý` campaign: `aka_agent_set_desktop_campaign_status_v2(…, 'tạm dừng')`
  (`migration_v234_queue_desktop_campaign_while_account_running.sql:36-…`). This is a CAS from `chờ xử lý` without
  claim/unit tokens; it sets `note = NULL`, except data-group waiting notes are kept.
- Running campaign: `markCampaignPausePending` (`:1529-1546`) writes note `Đang chờ tạm dừng` only when it holds the run's claim
  token (`updateRunningDesktopCampaignPauseNote`, `campaignRepository.ts:2559-2584`).
- The pass stops at a target boundary, or **immediately during the rest between targets** (`sleepBetweenTargets` polls every
  500 ms, `:1606-1614`).
- `completePauseAtBoundary` (`:9645-9686`): settle the unit, `completeCampaignPause` (`tạm dừng`, `note = stopNote ?? null`, log
  `⏸ Chiến dịch "${campaign.name}" đã được tạm dừng.`, `:1548-1552`), release the account.
- After a release, `completeReleasedDesktopCampaignPause` (`:1559-1597`) uses the CAS RPC and logs the same line.

### 7.2 DB-first pause (Web, or VPS)

- Web writes `tạm dừng` in the DB. Desktop notices it before the next target (`cur.status === 'tạm dừng'`, `:4223-4231`) and
  completes the pause (note reset to the stop note or NULL, same `⏸` line).
- VPS: `aka_agent_set_zalo_server_campaign_status` (v219:3391-…) is DB-first. The runner polls the run-control state per target,
  every 15 s while resting (`:708`, `:1615-1632`) and every 5 s during a batch (`:6081-6100`). `completePauseAtBoundary` then:
  - campaign paused → keep it, log `⏸ Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.`;
  - account paused → campaign `chờ xử lý`, `note = stopNote ?? null`, log `⏸ Đã hoàn thành lượt hiện tại và tạm dừng tài khoản.`
    (`:9656-9679`).

### 7.3 Resume

- Desktop: `requestResumeCampaign` (`:1494-1523`) → CAS `tạm dừng` → `chờ xử lý`, `note = NULL`, schedule unchanged (v234 resume
  branch). Errors:
  - `Lượt hiện tại chưa ghi xong; vui lòng chờ chiến dịch tạm dừng hoàn tất rồi tiếp tục.`
  - `Chiến dịch đang được runtime khác xử lý. Vui lòng thử lại sau.`
- A stale schedule after resume is caught by the claim's `daily_maintenance_required` (section 1.1).

### 7.4 Delete

- Desktop refuses to delete a running campaign: `Không thể xoá chiến dịch đang chạy.` (`campaignRepository.ts:2663-2665`).
- If it is deleted anyway (another client), the next unit claim / boundary RPC rejects it and the account is released
  (`:3075-3076`, `:3251-3252`). There is no extra campaign write and no log.
- Data group: the trigger in 6.2 stops the source and completes pending rows.

### 7.5 Account logout, pause or delete during a run

- **In-run guard every 5 s** (`:4535-4570`). Desktop reads `getAccountRunBlockReason(account.id, 'đang chạy')`:
  - `Không tìm thấy tài khoản`;
  - `Tài khoản bị đăng xuất` (any login status other than `đã đăng nhập`, checkpoint included);
  - `Tài khoản đang ở trạng thái ${account.status}` (`:9688-9697`).

  VPS reads run control and maps hard stops (`:9309-9322`):
  - `Quyền chạy chiến dịch của tài khoản đã bị thu hồi`
  - `Tài khoản bị đăng xuất`
  - `Tài khoản đã bị tắt`
  - `Tài khoản đã bị xoá`
  - `Chiến dịch đã bị xoá`
  - `Trạng thái Zalo Server không còn hợp lệ`
- **Effect on the running target.** The guard **aborts the running workflow**. The row returns to `chờ xử lý` with the reason as
  note, unless delivery was committed: then `hoàn thành` with `${accountStopReason}. Tin nhắn đã được gửi; không tự chạy lại data để tránh gửi trùng.`
  (`:4711-4740`).
- **Effect on the campaign.** `stopCampaignForAccountCondition` (`:9737-9750`):
  - a reason containing `đăng xuất` → `auto_error` policy `err_logout` (`applyRuntimeErrorPolicy`): the status comes from its
    `update_status_campaign` (default `chờ xử lý`), the note is the rendered policy text (v15 seed `Tài khoản bị đăng xuất`),
    log `⚠️ Dừng chiến dịch "${campaign.name}": ${message}` (`:10314`);
  - otherwise `chờ xử lý` with the reason as note and log `⚠️ Dừng chiến dịch "${campaign.name}": ${reason}` (`:9748`).

  Then the account is released.
- The same checks run before every target (`:4243-4252`) and at the boundary RPCs (reasons `account_logged_out`,
  `account_inactive`, `account_deleted`, `app_access_denied` → `:3060-3076`).

### 7.6 App logout, quit or crash

- Recovery `runScopedRecovery` (`src/main/ipc/handlers.ts:702-766`) waits up to 30 s for producers, then calls
  `reset_desktop_running_statuses_no_retry` (`accountRepository.ts:1403-1447`) with `p_zalo_uncertain_no_retry = true` by default
  (`handlers.ts:739`), so Zalo rows left running are not retried (the RPC body was not re-read for this spec). Unit leases are
  recovered too. Engine leases are not touched by this recovery.
- Engine: `stop()` → `engineRunner.abortAll()` (`campaignScheduler.ts:1088`, `desktopEngineRunner.ts:90-92`). The core reports
  `cancelled` for the next step, closes the target and releases (`runUnit.ts:326-334`, `:183-198`).
- After a crash:
  - the lease (180 s) makes the next process get `busy`, because each process has a new `runnerId` (`desktopEngineRunner.ts:72`);
  - `close_stale_v1` (pg_cron every minute, V495:1531-1593, V495:2224-2230) closes open target runs 10 min after lease expiry and
    releases the campaign;
  - login recovery may already have reset the rows (`close_stale` then only closes its own run, V495:1566-1570).

### 7.7 Engine comparison

| Behavior | Engine | Gap |
|---|---|---|
| Local pause latch | `shouldStopAfterTarget` reads `pauseRequests` (`desktopEngineRunner.ts:167`); checked at the top of the loop (`runUnit.ts:388`) | **G8**: the pace sleep (`runUnit.ts:390-395`) is not interrupted, and after it the loop goes straight to `claim` (`:397`). A pause during the rest runs one more target |
| `Đang chờ tạm dừng` note | Not written. `requestPauseCampaign` sees `đang chạy` without a boundary context, the CAS returns `runtime_busy`, and `markCampaignPausePending` has no token (`:1440-1468`) | G12 |
| Pause completion | After release: `completeReleasedDesktopCampaignPause` (`desktopEngineRunner.ts:173-177`) → `tạm dừng`, `⏸ Chiến dịch … đã được tạm dừng.` | Equivalent on Desktop (the account queue is held). On Fly the campaign is claimable between release and pause |
| DB-first pause (Web/VPS) | Claim → `campaign_paused` (V495:800); heartbeat (60 s) → `stopAfterTarget` (`runUnit.ts:171`); release keeps `tạm dừng` (V495:1522) | No `⏸` line; note not reset (G12). Fly: no `⏸ Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.` |
| User pause during a target with a `hold` outcome | `report_v1` writes `chờ xử lý` over `tạm dừng` without a guard (V495:1455-1460) | Desktop is equally unguarded (`updateErrorPolicyCampaign` → `updateCampaignAndBroadcast`, `:10193-10213`). VPS is guarded (CAS `status = 'đang chạy'`, `campaignRepository.ts:2525-2557`) → Fly parity gap |
| Account logout/pause mid-target | Not aborted; the heartbeat (60 s) sets `stop_account` after the target (`runUnit.ts:172-174`); claim → `account_logged_out` (V495:770-772) | No 5 s abort; account status not checked by the claim (G7); no campaign note, no `⚠️ Dừng chiến dịch …` line (G9) |
| Delete | Claim → `not_found` (V495:739-741), heartbeat → `campaign_paused` (`runUnit.ts:171`); release sets the deleted row to `chờ xử lý` (harmless) | none material |
| Resume | Uses the existing control RPCs | Stale schedule not caught (G1) |

## 8. What needs to change

### 8.1 SQL

**A. `aka_agent_engine_claim_target_v1` → new version (`_v2`, or `CREATE OR REPLACE` with an md5 guard as V499 did).**

1. **Maintenance guard (G1).** Before upserting the lease, return `{status:'maintenance_required'}` with no writes when
   `c.status = 'chờ xử lý' AND c.schedule < (VN today 00:00) AND NOT (coalesce(nullif(c.schedule_type,''),'daily') = 'daily' AND c.continue_next_day IS NOT TRUE)`
   (copy of v340:400-416). Alternatively port the per-campaign part of `maintainCampaignSchedules` to SQL and run it here.
   It must reproduce the table in 3.3 exactly: invalid recurrence, end date, 23:59, daily continue/no-continue, weekly/monthly
   refresh, birthday/recommendation/cancel branches.
2. **Stop rewriting `schedule` (V495:932-936).** Keep `schedule` as is. Two ways to keep an engine run from holding the barrier:
   - write `runtime_claim_vietnam_date` (VN date) without any token, so barrier branch (b) only counts runs that really cross
     midnight; the `aka_agent_clear_campaign_runtime_claim_metadata` trigger clears it on status change. All readers of
     `runtime_claim_*` must be audited first, e.g. pending-reason diagnostics;
   - or keep the rewrite only for `daily` + `continue_next_day = false` (the only stale case the claim accepts after point 1),
     and store the pre-claim `schedule` in the lease.
3. **Clear the note on start (G6).** In the `chờ xử lý` → `đang chạy` UPDATE, set `note = NULL` (legacy v397:240-242). Only on
   that transition, so notes written by `report_v1` effects are not erased.
4. **Wait without crossing the day (G2).**
   - Write `schedule = until` only when `until` is before today's dispatch cutoff,
     `(VN today + least(coalesce(daily_stop_time,'23:59'),'23:59'))`.
   - Otherwise leave `schedule` unchanged, still write the note, and return `wait.until` so the host can skip re-claims (Desktop:
     reuse the preclaim skip map, `campaignScheduler.ts:3503-3541`; Fly: its own timer).
   - Decide whether the new `⏳ … chạy tiếp lúc … (CODE)` note replaces the legacy `noti_campaign` text (section 4).
5. **Account status (G7).** At unit start (`leaseToken` NULL) require `a.status = 'chờ xử lý'`. During a unit allow
   `đang chạy`. Always refuse `tạm dừng` and other statuses with a status such as `account_paused`, so the host writes
   `Tài khoản đang ở trạng thái ${status}` (Desktop) or `chờ xử lý` with a NULL note (VPS/Fly), as in 7.2 and 7.5.
6. **Readiness (G10).**
   - Refuse `coalesce(c.provisioning_state,'ready') <> 'ready'`.
   - For `runtime_target = 'desktop'` and Zalo Web accounts, enforce `org_staff.max_running_zalo_web_accounts` with the same
     count as v397:214-238 (engine runs are `đang chạy`, so legacy counting already sees them). Return `concurrency_limit`, and
     let the host write `Đã đạt giới hạn tài khoản Zalo (trình duyệt) chạy đồng thời. Chiến dịch sẽ tự chạy khi có chỗ.`
     when it differs.
7. **One try per row per pass (G3).**
   - Exclude rows that already have an `auto_engine_target_runs` row with the current `lease_token`:
     `AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs r WHERE r.input_data_id = d.id AND r.lease_token = v_token)`.
     The index `auto_engine_target_runs_input_v495` covers it.
   - Drop `requeue_ends_unit` (V495:1385-1389) in `report_v1`.
   - When only already-tried due rows remain, return `no_target` with `dueTried > 0`. `finish` then ends the pass the Desktop way
     (finalize semantics in B, or `due_pending` inside the reschedule pass).
   - Optionally order by `created_at, id` to match `listCampaignInputData`.
8. **Data group (G5).** When `c.data_target_source_mode = 'data_group'`:
   - if `schedule_end_date <= now`, do not claim. Call the data-group core finalizer
     (`aka_agent_internal_finalize_data_group_campaign_v219(staff, org, campaign, 'Chiến dịch đã hết thời hạn nhận và chạy data mới')`;
     `SECURITY DEFINER` lets the engine call the revoked core) and return `data_group_hard_end`;
   - when no due row exists, return `no_target` with `dataGroup: true`. The waiting campaign must not be marked running
     (legacy refuses the claim, v397:197-206).
9. **Share mode.** Add a batch claim (N rows, N = min(50, daily left, window left), computed with `aka_agent_engine_action_limit`
   as in `getZaloShareMessageBatchCapacity`) before share repeat can be enabled. Each row is tried at most once per pass.
10. **Efficiency (optional).** Check `campaign_paused` / `campaign_not_runnable` / `not_due` before upserting the lease
    (V495:783-806), so a host that polls non-runnable campaigns does not churn leases.

**B. `aka_agent_engine_finish_campaign_v2(p_account_id, p_lease_token, p_note)`.** It reproduces the Desktop end of pass
(`campaignScheduler.ts:5094-5099`) + `handleCampaignCompletion` + `rescheduleCompletedCampaignPass`, in the Desktop order,
and returns a reason code. The core prints the line.

"Finalize semantics" below means exactly v214 (`migration_v214_campaign_finalize_pending_guard.sql:87-125`):
- any `chờ xử lý` row (due or future) → `chờ xử lý`, `note = NULL`, `completed_at = NULL`, reason `pending_input_remaining`
  with the count (core line `⏳ Phát hiện ${n} data mới đang chờ xử lý; chiến dịch chưa hoàn thành.`);
- otherwise `hoàn thành`, note = `p_note` if given, else unchanged.

Steps:
1. Validate the lease (as V495:1725-1727).
2. `aka_agent_lock_campaign_input_serialization(campaign)`, then the campaign and account `FOR UPDATE`, then the live rows
   (VPS order, v219:3324-3351).
   - Deleted → `campaign_deleted`. Status not `chờ xử lý`/`đang chạy` → `campaign_control_won`.
   - For `runtime_target = 'fly'`: account not `đang chạy` → campaign `chờ xử lý`, `note = NULL`, `account_control_won`.
3. Open target runs or `đang chạy` rows → `targets_remaining` (as today).
4. Future `chờ xử lý` rows → `chờ xử lý`, `schedule = min(schedule)`, **`note = NULL`**, reason `rescheduled_future_input`
   (core line `⏳ Hẹn chạy tiếp chiến dịch lúc ${formatVietnamDateTime(schedule)}`). This replaces the text
   `Hẹn chạy tiếp khi data đến lịch.` (V495:1742). Desktop defers before anything else, data group included, even when rows
   returned to the queue during the pass are due (`:5094-5097`, `:6229-6232`).
5. Data group → delegate to the core data-group finalizer (`aka_agent_internal_finalize_data_group_campaign_v219`; server
   variant for Zalo Server accounts) and map its result: `data_group_completed` or `data_group_waiting` (note `Chờ data mới`
   comes from the finalizer). Stop here.
6. (Realtime group: port `handleZaloRealtimeGroupCompletion` when that type is ported; until then the type stays on the legacy
   runner.)
7. `schedule_end_date IS NOT NULL AND now >= schedule_end_date` → finalize semantics; reason `completed_end_date` when completed.
8. **Multi-slot** (action in friend/group, `multiDailyTimeSlotsEnabled = true`, ≥ 2 slots):
   - Parse and normalize exactly as `parseMultiDailyTimeSlot` / `normalizeMultiDailyTimeSlots` (`campaignScheduler.ts:2791-2829`).
   - "Current slot" = the campaign `schedule` as it was at the first claim of the unit. Store it in the lease (see A.2); do not
     use a schedule rewritten by the claim or a wait.
   - Require the same VN day as now (else fall through to 9 and 10).
   - Next slot > current minute and > now:
     - none → finalize semantics; reason `completed_no_slot` when completed;
     - at/after the cutoff → finalize semantics; reason `completed_slot_after_cutoff` (+ slot) when completed;
     - else → reschedule pass (step 11) with suffix `ở khung giờ tiếp theo`; success reason `slot_advanced` (+ slot, schedule).
9. **Share repeat** (predicate of 5.6, the same as `supportsZaloShareRepeat` + `parseZaloShareRepeatMinutes` +
   `isRecentDeliveryCooldownEnabled` + not multi-slot):
   - next = now + minutes;
   - VN date of next ≠ VN date of `lease.acquired_at`, or ≠ today → finalize semantics; reason `completed_repeat_next_day`;
   - at/after the cutoff → finalize semantics; reason `completed_repeat_after_cutoff`;
   - else → reschedule pass (step 11) with suffix `ở lượt gửi lặp kế tiếp`; success reason `repeat_scheduled` (+ schedule).
10. Otherwise → finalize semantics; reason `completed`.
11. **Reschedule pass** (5.4):
    - any due `chờ xử lý` row → CAS on `đang chạy`: `chờ xử lý`, note `Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.`,
      schedule unchanged, reason `due_pending`, no line;
    - rows exist but all are `tạm dừng`, or friend/group with zero rows → finalize semantics; reason `completed_no_rerun_data`
      (+ suffix);
    - else `UPDATE … SET status='chờ xử lý', note='', date_action=NULL WHERE status <> 'tạm dừng'`, then campaign
      `chờ xử lý`, `schedule = next`, `note = NULL`.

Cutoff everywhere: `least(coalesce(daily_stop_time, '23:59'), '23:59')` with seconds, compared with `>=` (section 3.1). Keep v1 for
the deployed Fly worker until it calls v2.

**C. `aka_agent_engine_report_v1`.** Guard the campaign-effect UPDATE (V495:1455-1460) with
`AND status IN ('đang chạy','chờ xử lý')`, so a user pause that committed during the target is not overwritten. This is VPS
parity; Desktop legacy is unguarded today.

**D. `release_v1` / `close_stale_v1`.** No change needed for completion.

### 8.2 Core (`packages/campaign-engine/src/runUnit.ts`, `progress.ts`, `contracts.ts`)

1. **Pause or stop during the rest (G8).** After the pace sleep, `continue` back to the top-of-loop checks
   (`runUnit.ts:385-389`) instead of falling through to `claim`. Better: make the sleep poll `shouldStopAfterTarget` (and
   `stopAfterTarget`) every ≤ 500 ms, as `sleepBetweenTargets` does.
2. **New claim statuses:** `maintenance_required`, `account_paused`, `concurrency_limit`, `data_group_hard_end`, and the
   `dueTried` / `dataGroup` fields of `no_target`. Add them to `ClaimResponse` (`contracts.ts:149-173`) and `UnitEndReason`
   (`runUnit.ts:107-111`), with a host hook for `maintenance_required` (Desktop: `coordinator.invalidate()` + `ensureReady()`,
   then retry once, like `campaignScheduler.ts:3620-3644`).
3. **Progress lines from `finish_v2` reasons**, verbatim from section 5 (with `"${campaignName}"`):

   | Reason | Line |
   |---|---|
   | `completed` | `✅ Hoàn thành chiến dịch "${campaignName}"` |
   | `completed_end_date` | `✅ Hoàn thành chiến dịch "${campaignName}" (hết ngày kết thúc)` |
   | `completed_no_slot` | `✅ Hoàn thành chiến dịch "${campaignName}" (không còn khung giờ chạy trong hôm nay)` |
   | `completed_slot_after_cutoff` | `✅ Hoàn thành chiến dịch "${campaignName}" (khung giờ ${slot} vượt quá giờ dừng trong ngày)` |
   | `completed_repeat_next_day` | `✅ Hoàn thành chiến dịch "${campaignName}" (lượt gửi lặp kế tiếp đã sang ngày mới)` |
   | `completed_repeat_after_cutoff` | `✅ Hoàn thành chiến dịch "${campaignName}" (lượt gửi lặp kế tiếp vượt quá giờ dừng trong ngày)` |
   | `completed_no_rerun_data` | `✅ Hoàn thành chiến dịch "${campaignName}" (không có data cần chạy lại ${suffix})` |
   | `slot_advanced` | `⏳ Đã hoàn thành lượt chạy và hẹn chạy lại chiến dịch "${campaignName}" ở khung giờ ${slot} (${dateTime})` |
   | `repeat_scheduled` | `⏳ Đã gửi xong lượt này, hẹn gửi lặp lại chiến dịch "${campaignName}" lúc ${dateTime}` |
   | `rescheduled_future_input` | `⏳ Hẹn chạy tiếp chiến dịch lúc ${dateTime}` |
   | `pending_input_remaining` | `⏳ Phát hiện ${n} data mới đang chờ xử lý; chiến dịch chưa hoàn thành.` |
   | `data_group_waiting` | `⏳ Chiến dịch "${campaignName}" đang chờ data mới từ Nhóm data` |
   | `data_group_hard_end` | `⏹ Chiến dịch đã hết thời hạn nhận và chạy data mới` |

   Add a `formatDateTime` to `UnitConfig` with the Desktop format (`HH:mm dd/MM/yyyy`, vi-VN; the current `formatTime` is
   `HH:MM DD/MM`).
4. **Stop lines (G9):**
   - `daily_boundary` → once per unit:
     - `⏹ Đã đến giờ dừng ${HH:MM[:SS]}; đã hoàn tất lượt hiện tại và không mở lượt mới.` (configured stop);
     - `⏹ Đã đến mốc dừng cuối ngày 23:59; đã hoàn tất lượt hiện tại và không mở lượt mới.`
   - `campaign_paused`:
     - Desktop: `⏸ Chiến dịch "${campaignName}" đã được tạm dừng.`
     - Fly: `⏸ Đã hoàn thành lượt hiện tại và tạm dừng chiến dịch.`
   - account pause on Fly: `⏸ Đã hoàn thành lượt hiện tại và tạm dừng tài khoản.`
   - account stop: `⚠️ Dừng chiến dịch "${campaignName}": ${reason}`, plus the campaign note through an RPC (e.g. extend
     `release_v1` with an optional note guarded by the lease).
5. **Midnight edge (3.2).** When the claim returns `vietnam_day_changed` and the unit has claimed every due row, call
   `finish_v2` with the old-day context before ending the unit, as Desktop completes a pass that ends after 00:00.
6. **Optional:** print `🚀 Bắt đầu chiến dịch …` at unit start as Desktop does (`campaignScheduler.ts:3825`), or keep the current
   choice; decide explicitly.

### 8.3 Desktop adapter (`desktopEngineRunner.ts`, wiring in `campaignScheduler.ts:903-922`, `:2063-2073`)

1. **Gate scheduling features in one place.** Until `finish_v2` and the batch claim exist, `zaloCampaignV2Support`
   (`packages/campaign-engine/src/zalo/registry.ts:48-51`) should refuse, for every registered type,
   `multiDailyTimeSlotsEnabled === true`, `zaloShareRepeatEnabled === true`, `data_target_source_mode = 'data_group'` and
   `zalo_message_group_realtime`, before calling the type's own `support`. Fly uses the same function, so this protects both
   hosts. Today only `zaloMessagePhoneV2Support` refuses `data_group` and share mode.
2. **Find-data wait (G11).** `noteCampaignWait` → write only when the note differs, and do not log, matching
   `releaseClaimedCampaignPreflight` (`campaignScheduler.ts:9896-9915`). Use the equality check of `updateCampaignPreflightNote`
   (`:9868-9875`).
3. **Pause pending note (G12).** For a campaign held by the engine, write `Đang chờ tạm dừng` with a CAS on `status = 'đang chạy'`
   (and the lease, via a small RPC) when `requestPauseCampaign` gets `runtime_busy`.
4. **Host hooks:** `maintenance_required` → coordinator; `concurrency_limit` → note + break the account queue (like
   `'concurrency_wait'`, `:2081`); `wait.until` → skip memo.

### 8.4 Fly adapter (akaAgentChatApi, not verified here)

- Must not rely on host-side gates that the Desktop host performs: provisioning, account status, Zalo session. Point A.5-A.6
  moves them into the RPC.
- Must run the VPS-equivalent daily maintenance (`maintainZaloServerCampaignSchedules` semantics, runtime `server`) and the
  data-group expiry sweep, unless A.1 ports maintenance into SQL.
- Pause/account lines must use the VPS texts (7.2).

### 8.5 Tests to add (replay + injected cases in `docs/CAMPAIGN_OUTCOME_ENGINE_ZALO_COVERAGE.md` section 3)

- Weekly campaign that hits the daily quota on its last run day before the end date: no run the next day, finalized by
  maintenance.
- Daily + `continueNextDay` campaign that hits the daily quota: continues at the configured time, not at 00:00.
- Paused weekly campaign resumed after midnight: the claim answers `maintenance_required`.
- Row that requeues every time: the rest of the list is still processed in the same pass; the row is retried once per pass.
- Multi-slot `08:00, 10:00, 14:00`:
  - slot advance, reset excludes `tạm dừng`;
  - due-row-raced note;
  - last slot completes with the right suffix;
  - a slot after `daily_stop_time` completes.
- Share repeat 60 min:
  - normal reschedule;
  - next run after 23:59 → complete;
  - run claimed 23:30 finishing 00:05 → complete (claimed-day rule).
- Data group:
  - waiting (`Chờ data mới`), hard end mid-pass, sweep;
  - source never stopped by an engine completion.
- Pause during the 300 s rest: no further target. Web pause mid-target: `⏸` line, status stays `tạm dừng` even with a `hold`
  outcome.
