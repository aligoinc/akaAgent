# Chạy cùng lúc chiến dịch Zalo trên một tài khoản (V670)

Trạng thái (26/11/2026 tối): code đã commit và đẩy lên ba nhánh theo yêu cầu ("Commit và đẩy"), PR mở theo yêu cầu ("Mở PR"): [#810](https://github.com/aligoinc/akaAgent/pull/810), [aligoinc/akaAgentChatApi#199](https://github.com/aligoinc/akaAgentChatApi/pull/199), [aligoinc/akaAgentWebApp#327](https://github.com/aligoinc/akaAgentWebApp/pull/327). V667 rồi V670 đã apply akachat 20:57–20:59 VN 26/11 theo yêu cầu ("apply rồi chạy explain rồi merge đi"; [biên nhận V667](../migrations/snapshots/engine-server-runtime-v667/apply-receipt.json), [biên nhận V670](../migrations/snapshots/campaign-parallel-run-v670/apply-receipt.json)). **Chưa deploy ChatApi / Web, chưa build / phát hành Desktop / iOS**:

- akaAgent: worktree `.claude/worktrees/campaign-parallel-run`, nhánh `claude/campaign-parallel-run`, commit `f4d5e08a` trên `dev_3` `cab27ed3` (sau #807, #808, #809).
- ChatApi: worktree `../akaAgentChatApi-parallel-run`, nhánh `feat/campaign-parallel-run`, commit `cf34727` trên `dev` `ddc8c58` (sau #198). Lõi `packages/campaign-engine` chép từ akaAgent `f4d5e08a` (`SOURCE.json`, `sourceDirty: false`).
- WebApp: worktree `../akaAgentWebApp-parallel-run`, nhánh `claude/campaign-parallel-run`, commit `f1dc3334` trên `dev_1` `437ec742` (sau #326).

Thiết kế anh đã duyệt: https://claude.ai/artifact/6rFygSGCcMZAzUx5vfbFx9 (bản 3).

## Số migration và thứ tự apply

Số đã đổi ba lần vì mỗi lần đều có nhánh khác giữ số trước:

- V665 → V666 (16:43 VN 26/11): V665 là `migration_v665_proxy_shared_runtime_bound_device`.
- V666 → V669 (anh: "Làm tiếp"): V666 là loại trừ gửi, apply 17:43:55 VN 26/11.
- V669 → V670 (19:2x VN): nhánh `claude/loving-mendel-zig1jb` đẩy `migration_v669_zalo_friend_stranger_restricted.sql` lúc 19:11 VN, lúc bản này chưa đẩy.
- Lúc đổi sang V670, sổ production có tới V668 p1. Không nhánh nào trong bốn repo (akaAgent, akaAgentWebApp, akaAgentChatApi, SqlServerDashboard) có tệp V670 trở lên.
- Số chỉ là của mình khi đã đẩy nhánh. Kiểm lại sổ và `git log --all --name-only` ngay trước khi apply.

Thân hàm không ghi số migration, nên đổi số không đổi md5 của hàm.

V666 (loại trừ gửi, đã apply), V667 (engine trên VPS, trên `dev_3`, chưa apply) và V670 cùng thay `aka_agent_engine_claim_target_v1`:

- Thân claim của V670 dựng trên thân sau V667 (md5 `df4b8e42…`, lấy từ `scripts/build-v667-sql.cjs`). Thân đó còn bước kiểm loại trừ gửi `private.aka_agent_send_exclusion_claim_check` (V666) và nơi chạy `'server'` (V667).
- Phiên loại trừ gửi đồng ý thứ tự này.
- Thứ tự apply: V666 (đã có) → V667 p1 → p2 → p3 → V670 p1 → p2 → p3.
- V670 p3 từ chối khi:
  - sổ chưa có `migration_v667_engine_server_runtime_p2`;
  - thiếu hàm kiểm loại trừ gửi;
  - claim khác thân V667.
- Gỡ theo thứ tự ngược: gỡ V670 trước, rồi mới gỡ V667. Bản gỡ V667 tự từ chối khi claim không phải thân V667. Bản gỡ V670 trả claim về thân V667.

## Anh chốt (26/11/2026)

- akaBiz bật theo loại chiến dịch bằng cột DB, khách không sửa. Lúc đầu bật ba loại: huỷ lời mời kết bạn, thêm thành viên vào group, tham gia group bằng link.
- Khách tích ô ở chính chiến dịch phụ, không phải ở chiến dịch chính. Không tích thì chạy đúng như trước.
- Mỗi tài khoản, mỗi loại chỉ chạy một chiến dịch tại một lúc. Tạo 3 chiến dịch huỷ lời mời có tích thì chúng chạy lần lượt.
- Chiến dịch có tích và chiến dịch thường không phải chờ nhau, trừ khi cùng loại hoặc dùng chung thao tác (khi đó chờ như hiện nay).
- Chiến dịch thường giữ thứ tự lịch. Một loại hiếm khi có cả chiến dịch tích lẫn không tích; nếu chiến dịch không tích phải chờ thì hàng đợi chính dừng ở đó, lượt quét sau hỏi lại.
- Chỉ engine v2 (Desktop và Fly). App Server và bộ cũ chạy lần lượt. Ô chỉ hiện ở tổ chức đã bật engine v2.
- Ô có ở form Desktop, Web, iOS. Tên là "Chạy cùng lúc" (anh đổi từ "Chạy song song").
- "Thêm thành viên" có tích vẫn chờ "Nhắn tin theo SĐT" vì hai loại cùng Tìm SĐT. Anh chốt "Vẫn chờ, sửa lý do": nút "Lý do đang chờ" phải giải thích đúng lần chờ này.
- Câu anh duyệt ở `src/shared/campaignParallelRun.ts`, chép nguyên văn từ WebApp `packages/control-api/src/campaignParallelRun.ts` (hai tệp trùng từng byte):
  - Ô Desktop / Web: "Chạy cùng lúc với chiến dịch khác của tài khoản". Ô iOS: "Chạy cùng lúc".
  - Giải thích: "Không chờ chiến dịch khác chạy xong. Chiến dịch cùng loại vẫn chạy lần lượt."
  - Chờ cùng loại: `Tài khoản đang chạy chiến dịch "{tên}" cùng loại. Chiến dịch này sẽ chạy khi chiến dịch đó xong.`
  - Chung thao tác: `Đang chờ chiến dịch "{tên}" chạy xong, vì hai chiến dịch cùng {thao tác}.`
  - Chi tiết chiến dịch: "Chạy cùng lúc: Có / Không".

## DB (V670)

Sinh bằng `node scripts/build-v670-sql.cjs`, không sửa tay tệp migration. Có ba phần, mỗi phần một giao dịch, apply đúng thứ tự (ALTER bảng nóng tách khỏi phần thay hàm):

| Phần | Nội dung |
|---|---|
| p1 | `auto_campaign_actions.allow_parallel_run boolean NOT NULL DEFAULT false`; bật cho `zalo_cancel_sent_friend_request`, `zalo_add_group_member`, `zalo_join_group_link` |
| p2 | `auto_campaigns.parallel_run_enabled boolean NOT NULL DEFAULT false`; quyền INSERT / UPDATE cột này cho `aka_agent_desktop` (Desktop chỉ có quyền ghi theo cột) |
| p3 | `auto_engine_leases` thêm `lane` (mặc định `'main'`), `action_id`, `action_codes`; khoá chính `(account_id)` → `(account_id, lane)`; thay 6 hàm; thêm `aka_agent_engine_parallel_wait_v1(bigint, text[])` |

md5 hàm, cũ → mới:

| Hàm | Cũ | Mới |
|---|---|---|
| claim (thân sau V667) | `df4b8e42…` | `8d45e070…` |
| release | `98f1c7c6…` | `85ee6d85…` |
| close_stale | `8ed47752…` | `b4e2c166…` |
| health | `eca4b5f1…` | `57e92899…` |
| `create_control_campaign_v2` | `661579fa…` | `53295394…` |
| `update_control_campaign_atomic` | `a8627819…` | `5e2c0fda…` |
| `parallel_wait_v1` (prosrc, hàm mới) | | `b7ff277b…` |

**Làn.** Chiến dịch thường luôn ở làn `'main'`, như trước. Chiến dịch có tích, thuộc loại có `allow_parallel_run`, trên tài khoản Zalo thì có làn riêng, tên làn là mã loại.

**`aka_agent_engine_claim_target_v1`:**
- Chọn lease theo `(account_id, lane)`. Lượt đang giữ lease (có `leaseToken`) ở làn nào thì giữ làn đó.
- Chỉ khi lấy lease mới mới kiểm làn khác:
  - Chính chiến dịch này còn lease còn hạn ở làn khác thì trả `busy`, như lease còn hạn của lượt trước. Trường hợp này xảy ra khi làn đổi giữa hai lượt vì khách đổi ô tích hay akaBiz tắt loại, còn lượt trước dừng đột ngột chưa nhả chỗ. Một chiến dịch không chạy ở hai làn.
  - Làn khác đang chạy chiến dịch cùng loại (`action_id`) hoặc chung thao tác (`action_codes && mã của lượt này`) thì trả `parallel_wait {campaignId, campaignName, reason: same_type|same_action, actionCodes}`. Khi đó claim không giữ lease và không ghi gì. Lõi cũ coi đây là trạng thái không nhận lượt.
- Bước kiểm loại trừ gửi của V666 và nhánh nơi chạy `'server'` của V667 giữ nguyên.

**`release_v1` / `close_stale_v1`:**
- Không trả tài khoản về "chờ xử lý" khi làn khác còn lease.
- Trước câu trả tài khoản về "chờ xử lý", khoá dòng tài khoản bằng một câu riêng khi tài khoản còn "đang chạy" (`PERFORM … FOR UPDATE`, tra theo khoá chính). Câu cập nhật vốn đã khoá đúng dòng này, nên tài khoản không tích chỉ tốn thêm một lần tra khoá chính.
- `close_stale_v1`: lease ở làn riêng, hoặc tài khoản còn lease khác ở làn riêng (tra theo khoá chính của `auto_engine_leases`), thì khoá dòng chiến dịch rồi dòng tài khoản bằng `SKIP LOCKED`. Dòng đang bị giữ thì job để lease đó cho lần chạy sau. Tài khoản chỉ có làn chính giữ thứ tự khoá như trước.
- Không câu nào đọc thêm `auto_campaigns` theo tài khoản.
- Lý do sửa ở mục "Ba lỗi DB tìm ra khi giả lập / rà" bên dưới.

**`health_v1`** chịu được một tài khoản có nhiều lease.

**`create_control_campaign_v2`** (Web / iOS tạo chiến dịch): `parallelRunEnabled: true` thì ghi cột là true.

**`update_control_campaign_atomic`** (Web / iOS sửa chiến dịch Zalo):
- API WebApp gửi khoá `parallel_run_enabled` khi ô đang hiện. Có khoá thì ghi, không có thì giữ nguyên.
- Cột không thuộc `aka_agent_campaign_config_version`, nên form đang mở không báo xung đột. Hai người cùng sửa thì lần lưu sau ghi đè ô tích của lần trước.

**`aka_agent_engine_parallel_wait_v1(campaign_id, action_codes DEFAULT NULL)`** (chỉ đọc, cho `service_role` và `aka_agent_desktop`):
- Trả chiến dịch đang chặn, cho nút "Lý do đang chờ". Chiến dịch ở làn riêng tính cả chiến dịch đang chạy cùng làn.
- Nơi gọi có lõi (Desktop) gửi `action_codes` là mã lõi khai khi nhận lượt. Không gửi thì hàm dùng `limit_check_action_codes` + mã loại, cộng Tìm SĐT cho "Thêm thành viên" theo `zaloAddGroupMemberClaimPlan` (lõi đổi thì sửa cùng lúc).

**Hàm khác đọc `auto_engine_leases`** đều lọc theo `lease_token` (đã rà 26/11, chỉ đọc), nên không cần sửa. Gồm cả `finish_campaign_v2` của V667 và các hàm đóng lượt `'server'`.

**Kiểm trước / sau khi apply:**
- Preflight: sổ chưa có tên migration này, có V667 p2, có hàm kiểm loại trừ gửi, md5 6 hàm đúng bản dựng trên. Lưu lại quyền và chủ sở hữu của từng hàm.
- Postflight: md5 6 hàm mới, quyền không đổi, anon / authenticated không gọi được hàm mới, khoá chính mới, mọi lease cũ ở làn `'main'`.

**Bản gỡ** `migrations/rollback_v670_campaign_parallel_run.sql`, chạy p3 → p2 → p1:
- Kiểm 6 hàm đang đúng bản V670, rồi xoá lease làn riêng, trả khoá chính.
- Trả claim về thân V667 và 5 hàm còn lại về bản production.
- Xoá hàm mới và 5 cột. Nếu đã phát hành Desktop thì form sửa tự đọc lại khi không có cột (42703).

**DDL:** apply buổi tối ngoài giờ cao điểm (PostgREST nạp lại schema).

### Ba lỗi DB tìm ra khi giả lập / rà, đã sửa (26/11 tối)

1. **Tài khoản về "chờ xử lý" trong khi làn khác đang chạy** (giả lập A seed 6, bất biến P3).
   - Cách xảy ra: claim của làn M giữ khoá dòng tài khoản tới hết giao dịch, lease mới chưa commit. Đúng lúc đó release của làn L chạy câu trả tài khoản về "chờ xử lý". Câu này chụp dữ liệu lúc bắt đầu, nên không thấy lease của M. Nó chờ khoá xong rồi ghi đè.
   - Cùng gốc với việc hai làn nhả cùng lúc: mỗi bên thấy lease chưa commit của bên kia, nên tài khoản kẹt "đang chạy" khi không còn làn nào.
   - Bản sửa: khoá dòng tài khoản bằng một câu riêng trước, câu cập nhật chụp lại sau khi giao dịch kia xong.
   - Bài kiểm V670 dựng lại được bằng hai kết nối (ca a–e). Ca (a) hỏng trên bản trước khi sửa.
2. **Job dọn lease có thể khoá chéo với claim.**
   - Cách xảy ra: job giữ khoá các lease của cả lô, mà một tài khoản giờ có nhiều lease. Claim khoá theo thứ tự chiến dịch → tài khoản → lease.
   - Bản sửa: job không chờ khoá với tài khoản có làn riêng (`SKIP LOCKED`), để lại cho lần chạy sau.
   - Khoá chéo giữa job và claim lấy lại lease cùng làn đã có từ trước V670. Production 24 giờ tới 26/11 tối có 0 lần khoá chéo ở hàm engine (3 lần đều ở bảng nhận tin của gateway chat cũ).

3. **Bản sửa lỗi 1 làm chậm release / close_stale của mọi tài khoản** (rà 26/11 tối).
   - Cách xảy ra: bản sửa đầu chỉ khoá dòng tài khoản khi "tài khoản có chiến dịch có tích", viết bằng `EXISTS (SELECT 1 FROM auto_campaigns x WHERE x.account_id = … AND x.parallel_run_enabled)`. Production không có chỉ mục `account_id` dùng được cho câu này (chỉ có chỉ mục một phần theo trạng thái `idx_auto_campaigns_app_access_held_account` và một chỉ mục riêng cho `sms_send`). EXPLAIN câu tương tự ra Seq Scan cả bảng 78 MB, ở mỗi lần nhả chỗ, kể cả tài khoản không tích. Desktop gọi `release_v1` khoảng 1.850 lần/giờ, chưa tính Fly.
   - Bản sửa: bỏ câu đó. Khoá dòng tài khoản khi nó còn "đang chạy" (xem mục release / close_stale ở trên), không cần chỉ mục mới.
   - Bài kiểm V670 nay đo số khối đọc của luồng không tích trước / sau V670 trên bảng `auto_campaigns` 20 nghìn dòng (2.859 trang) với đúng bộ chỉ mục production: claim 114 → 116, release 46 → 35, close_stale 56 → 40 khối. Câu điều kiện của bản sửa đầu, chạy riêng làm đối chứng, đọc 2.859 khối, quá xa ngưỡng 40 khối của bài kiểm. Ca (c2) mới: job gặp lease làn chính hết hạn đúng lúc chiến dịch có tích nhận lượt làn riêng đầu tiên của tài khoản thì chờ, tài khoản vẫn "đang chạy".

Ngoài ra, giả lập A seed 9 tìm ra trường hợp chiến dịch đổi làn khi lease làn cũ của chính nó còn hạn. Claim từng trả `parallel_wait` với chiến dịch chặn là chính nó, còn "Lý do đang chờ" trả trống. Nay claim trả `busy` (xem mục claim ở trên).

## Desktop

**Bộ chạy engine** (`src/main/engineAdapters/desktopEngineRunner.ts`):
- Lượt giữ khoá theo `${tài khoản}:${làn}`.
- Làn chính giữ khoá và nhật ký khôi phục cũ (`${nhân viên}:${tài khoản}`). Làn riêng có nhật ký riêng.
- Facebook / Website luôn ở làn chính.
- Bộ chạy nhận `runtimeTarget` của #805 (`'desktop'` / `'server'`).

**Bộ lập lịch** (`src/main/services/campaignScheduler.ts`):
- `takeParallelRunLanes` chỉ tách làn khi `runtimeTarget === 'desktop'`, nên App Server (V667) vẫn chạy lần lượt. Nó tách chiến dịch có tích, thuộc loại được bật (`listParallelRunActionIds`, nhớ 5 phút, chỉ đọc khi có chiến dịch đến hạn đã tích) và chạy được bằng engine.
- `dispatchParallelRunLanes` / `runParallelLaneQueue` chạy từng làn song song với hàng đợi chính.
- Không ai tích thì không đọc thêm gì, hàng đợi chính y như trước.
- Tài khoản "đang chạy" vì làn riêng của chính máy này vẫn nhận hàng đợi chính.
- Hàng đợi chính gặp `parallel_wait` thì dừng, để giữ thứ tự lịch.
- Bộ cũ và làn riêng chờ nhau. Làn riêng giữ tài khoản ở "đang chạy", mà claim bộ cũ đòi "chờ xử lý". Bộ cũ đang chạy thì làn riêng không mở (DB cũng trả `legacy_busy`). Fly làm giống vậy.
- Các chỗ chờ dừng (`waitForIdle`, `waitForZaloIdle`), giữ tài khoản cho việc ngoài (`tryReserveExternalAccount`) và ảnh chụp heartbeat đều tính cả làn riêng.

**Đọc / ghi:**
- Chiến dịch đọc bằng `*`, nên có `parallel_run_enabled` ngay khi DB có cột.
- Form sửa đọc thêm cột. DB chưa có cột (42703) thì đọc như cũ và 10 phút không thử lại.
- Tạo / sửa / nhân bản chỉ gửi cột khi ô đang hiện hoặc chiến dịch gốc đã tích.

**Form thường và form Agent:**
- Ô ở phần Lịch chạy, hiện khi `canShowCampaignParallelRun`: loại có `allowParallelRun` và `AuthUser.campaignEngineV2`.
- Chi tiết chiến dịch có dòng "Chạy cùng lúc".

**"Lý do đang chờ":**
- Chiến dịch ở làn riêng không bị coi là bận vì hàng đợi chính.
- Câu cùng loại / chung thao tác lấy qua `aka_agent_engine_parallel_wait_v1`. Chỉ hỏi khi tài khoản có làn riêng đang chạy trên máy này, hoặc chính chiến dịch ở làn riêng. Gửi kèm mã thao tác lõi khai khi nhận lượt (`zaloClaimActionCodes` của `packages/campaign-engine/src/zalo/registry.ts`).
- Ngoài ra lấy từ kết quả nhận lượt gần nhất (`engineWaitMessage`).

**App cũ gặp chiến dịch có tích** (khách tích trên Web / iOS khi máy Desktop chưa cập nhật; mọi bản có engine v2, 9.6.0 → 10.7.0):
- DB vẫn cấp lease làn riêng cho chiến dịch có tích, nhưng bộ chạy cũ chỉ chạy một lượt mỗi tài khoản, nên chiến dịch có tích chạy lần lượt như không tích. Tiến trình, lịch sử hành động, trạng thái data, lời gọi Zalo giống hệt khi không tích.
- App cũ dừng đột ngột giữa chiến dịch có tích rồi mở lại: nhật ký của app cũ (một phạm vi cho cả tài khoản) gửi bù bằng lease làn riêng, DB nhận. Chiến dịch không tích cùng loại nhận `parallel_wait` cho tới khi lease đó hết hạn. Trước V670 chúng nhận `busy` trong cùng khoảng đó. Lõi và bộ lập lịch cũ coi `parallel_wait` là "chưa nhận được lượt": không ghi chú, không in gì, lượt quét sau thử lại.
- Nâng cấp lên bản mới sau khi app cũ dừng giữa chiến dịch có tích: nhật ký của app cũ nằm ở phạm vi làn chính (`${nhân viên}:${tài khoản}`), nên lượt làn chính đầu tiên của tài khoản gửi bù, DB nhận.
- Giới hạn: tài khoản chỉ có chiến dịch có tích thì không lượt làn chính nào gửi bù trước khi job đóng lượt treo. Data đang chạy dở lúc app cũ bị ngắt khi đó được đóng bằng SYS02 ("Bị ngắt khi đang gửi…, không gửi lại") thay vì về hàng đợi rồi làm lại. Đây là kết quả như khi mất nhật ký (app bị tắt ngang), không gửi trùng. Mục nhật ký đó được gửi bù ở lượt làn chính sau này, DB từ chối, không đổi lịch sử hay trạng thái data. Chỉ xảy ra khi app cũ dừng lúc DB không nhận báo cáo (mất mạng), vì khi thoát app bình thường báo cáo đi được nên nhật ký trống.

## Fly (ChatApi)

- `packages/database/src/campaignParallelRun.ts` dò V670 mỗi phút: đủ 2 cột, role worker đọc được, có `auto_engine_leases.lane`.
  - Chưa có V670 thì câu tìm chiến dịch đến hạn giữ nguyên từng ký tự.
  - Câu tìm gặp lỗi cột / quyền thì chạy lại câu cũ ngay trong lượt.
- Câu tìm chiến dịch cho qua tài khoản "đang chạy" trong hai trường hợp:
  - (A) chiến dịch có tích và loại được bật;
  - (B) chiến dịch làn chính, và mọi chiến dịch đang giữ tài khoản đều là lượt engine có tích. Đoán theo trạng thái chiến dịch, vì role worker không đọc `auto_engine_leases`.
- `apps/system-worker/src/campaignRunLanes.ts` và `zaloCampaignScheduler.ts` chọn chiến dịch theo (tài khoản, làn). Bộ cũ chỉ chạy khi tài khoản không có làn riêng nào. `flyEngineRunner.ts` xử lý `parallel_wait` như `busy`.
- `apps/chat-api/src/campaignActionDispatcher.ts` (nhóm `api`):
  - Runtime chạy lệnh của một tài khoản lần lượt.
  - Nên khi cùng tài khoản còn lệnh khác đang chạy, hạn chờ = hạn gốc + hạn gốc dài nhất của lệnh đang chạy.
  - Không có lệnh nào khác thì 100 / 190 giây như cũ.
- Còn hở: worker chờ tối đa 210 giây từ lúc tạo lệnh (`ZALO_CAMPAIGN_COMMAND_TIMEOUT_MS`) và dọn lệnh treo sau 240 giây. Một lệnh làn riêng xếp sau một lệnh media treo (runtime bỏ ở 180 giây), nếu tự nó chạy quá khoảng 25 giây, vẫn ra UNK01. Nâng hai trần đó là đổi cho mọi khách, chưa làm.
- Runtime giữ một phiên tag Zalo mỗi tài khoản. Chỉ bật `allow_parallel_run` cho loại không dùng tag (3 loại đang bật không dùng).
- Đo tải câu tìm chiến dịch (26/11 tối, `DISCOVERY_SCALE_V670=1 node load-tests/campaign-discovery-scale.mjs`, PG17 cục bộ, dữ liệu cùng hình dạng bộ kiểm thử tải 13/11: 681 chủ sở hữu, 1.614 tài khoản Server, ~1.600 chiến dịch đến hạn). Mỗi kịch bản so câu cũ với câu có V670 của cùng bản build, trên cùng dữ liệu, rồi đi hết mọi trang như worker:
  - Chưa ai tích (tài khoản rảnh, hoặc 70% "đang chạy"): câu mới trả đúng từng dòng như câu cũ ở mọi trang (1.585 và 564 dòng). Mỗi trang ~33 ms ở cả hai; khối đọc +0% (rảnh) / +5–6% (70% đang chạy); lập kế hoạch +0–0,3 ms.
  - Có tích, 70% đang chạy, 40% giữ lượt làn riêng: không bớt dòng nào; thêm 490 dòng, đều là chiến dịch V670 cho chạy. Khối đọc mỗi trang −2…+5%. Chỉ có tài khoản giữ lượt làn riêng, không chiến dịch đến hạn nào tích: thêm 396 dòng, +1–8%.
  - 98% đang chạy, 60–100% giữ lượt làn riêng: thêm 1.008–1.557 dòng; mỗi trang rẻ hơn câu cũ (~5.300 so với ~12.500 khối), vì câu cũ phải quét xa hơn mới đủ trang.
  - Worker đọc tối đa 4 trang mỗi nhịp và đi tiếp bằng con trỏ, nên dòng thêm chỉ làm một vòng quét hết danh sách dài hơn, không làm mỗi nhịp đọc nhiều hơn 4 trang.
- Sau khi apply V670 p1 + p2 (hai cột), trước khi deploy worker: sinh câu EXPLAIN chỉ đọc cho production bằng `DISCOVERY_EXPLAIN_V670=1 node load-tests/campaign-discovery-scale/production-explain.mjs <owners.json> <thư mục> current` (ra cả `new-current.sql` và `new-v670-current.sql`), chạy cả hai rồi so.
- Lõi `packages/campaign-engine` chép bằng `node scripts/sync-campaign-engine.cjs --to <ChatApi>` (khớp 67 tệp, `sourceDirty: true` tới khi akaAgent commit rồi đồng bộ lại).
  - Bản chép lần này mang cả phần lõi của #805 (`RuntimeTarget` thêm `'server'`; câu tạm dừng của nơi chạy khác Desktop như Fly). Fly chạy y như cũ.

## Web / iOS (WebApp)

- `packages/control-api/src/campaignParallelRun.ts` là bản gốc của hợp đồng dùng chung. Desktop chép nguyên văn.
- API:
  - `/me` và đăng nhập trả `campaignEngineV2` (đọc `org_organization.use_new_zalo_runtime` song song với các lượt đọc sẵn có; lỗi thì false).
  - Danh mục / danh sách / chi tiết / cấu hình đọc thêm 2 cột. DB chưa có cột (42703 / PGRST204) thì đọc lại không có cột và nhớ 5 phút.
  - Tạo / sửa chỉ ghi khi body có boolean. Nhân bản chép `true`.
- Form Web (bản cũ và form 2) và iOS: ô nằm dưới dòng giờ dừng, chỉ hiện khi `canShowCampaignParallelRun` (bước Quy trình không có). Ô ẩn thì không gửi khoá. Chi tiết chiến dịch có dòng "Chạy cùng lúc".
- Chưa làm:
  - Bước xem lại của iOS.
  - Nút "Lý do đang chờ" trên Web / iOS chưa gọi `aka_agent_engine_parallel_wait_v1`.
  - API không chặn `true` cho loại / tổ chức chưa bật (claim bỏ qua).

## Kiểm thử (26/11 tối, sau khi lên `dev_3` / `dev` / `dev_1` mới)

| Lệnh | Kết quả |
|---|---|
| `LC_ALL=C CHAT_REPO=<ChatApi> node scripts/campaign-parallel-run-v670-smoke.cjs` | 22 nhóm đạt (PG17). Chi tiết ở danh sách ngay dưới bảng. |
| `LC_ALL=C CHAT_REPO=<ChatApi> node scripts/campaign-parallel-run-v670-apply-smoke.cjs` (mới) | 7 nhóm đạt trên DB đã chạy thật migration V666 và V667 p1–p3 (`scripts/fixtures/engine-v2-server/db.cjs`). Chi tiết ở danh sách dưới bảng. |
| Giả lập A `LC_ALL=C CHAT_REPO=<ChatApi> node scripts/engine-v2-scenarios/parallel-run.cjs [--seed N] [--accounts 24] [--rounds 4] [--kills 3] [--steals 6] [--parity \| --parity-only]` (đặt `ENGINE_PARALLEL_PORT` khi chạy song song) | Seed 1–12 sau khi sửa: 0 vi phạm mới. Mỗi seed có sự cố 395–908 lượt, 773–1.323 cặp lần gọi Zalo của hai làn chồng nhau mà không xung đột. `--parity` seed 4, 6, 7, 9: 29–38 chiến dịch không tích giống hệt (data, lịch sử, chuỗi lần gửi, trạng thái). Chạy lại trên bản cuối (sau bản sửa release / close_stale): seed 1, 6, 9, 11, 13 với `--accounts 24 --rounds 4 --kills 3 --steals 6` 0 vi phạm mới; `--parity` seed 4, 6: 32/32 chiến dịch giống hệt. |
| `LC_ALL=C CHAT_REPO=<ChatApi> node scripts/campaign-parallel-run-desktop-runner-smoke.cjs` (giả lập B, tự chạy lại dưới Electron) | 27/27 ca: 7 ca bản mới, cộng 4 ca app cũ (6a, 6c, 6d, 6e) cho mỗi bản 9.6.0, 10.1.0, 10.6.0, 10.7.0 và `dev_3` ngay trước tính năng (`cab27ed3`, `PARALLEL_RUN_BASELINE_REF`). Bản cũ dựng từ nguyên cây mã của commit phát hành (`PARALLEL_RUN_OLD_REFS`). Chi tiết ở mục "App cũ gặp chiến dịch có tích" phần Desktop. |
| `node scripts/campaign-parallel-run-desktop-smoke.cjs` | 7 nhóm (bộ lập lịch thật) |
| `node scripts/run-campaign-parallel-run-ui-smoke.cjs` | 9 ca (form thật) |
| `scripts/campaign-engine-desktop-smoke.cjs` | 11 nhóm |
| `engine-v2-server-runtime-runner-smoke.cjs` / `-scheduler-smoke.cjs` / `-v667-smoke.cjs` (bộ chạy, bộ lập lịch mới trên nơi chạy `'server'`) | 5 / 8 / 21 |
| Bộ kịch bản engine v2: `SCENARIO_FACEBOOK_MIGRATIONS=1 SCENARIO_TARGET_CHECK=1 SCENARIO_ORPHAN_RUNS=1 SCENARIO_PARALLEL_RUN=live`, rồi `=1`, `--seed 7 --rounds 3`, mỗi bên 3 lần | Giống nhau. Chạy lại trên bản cuối, mỗi bên 1 lần: cùng 537 lượt, 2.837 lần gửi, 851 mẫu dòng tiến trình, kết quả từng lượt và trạng thái chiến dịch (so theo tập, bỏ thứ tự, giờ và mã nội bộ); cả hai bên có I1 (1), I1b (2) có từ trước, nên mã thoát là 1 ở cả hai. Chi tiết ở danh sách dưới bảng. |
| Hai typecheck, typecheck lõi, `electron-vite build` | Sạch |
| ChatApi `npm run verify` | typecheck sạch, 3.303 bài đạt |
| ChatApi `LC_ALL=C PHASE1_PG_BIN=<PG17 bin> DISCOVERY_SCALE_V670=1 node load-tests/campaign-discovery-scale.mjs` (đo câu tìm chiến dịch của Fly) | 8 kịch bản đạt. Số đo ở mục Fly. |
| WebApp `npm run typecheck` (8 workspace) và test | Sạch. control-api 950, campaign-core 579, control-client 81, API control 1.790, form Web 177, iOS 19 bài đạt. |

Bài V670 (21 nhóm) gồm:
- Không tích: chuỗi nhận lượt giống hệt trước / sau V670.
- 4 làn cùng lúc trên một tài khoản; mỗi loại một chiến dịch.
- `parallel_wait`, close_stale, nhả làn.
- 5 ca cuộc đua dựng bằng hai kết nối:
  - (a) làn riêng nhả khi làn chính đang nhận lượt;
  - (b) làn chính nhả khi chiến dịch có tích nhận lượt đầu;
  - (c) job dọn lease khi làn khác nhận lượt;
  - (c2) job gặp lease làn chính hết hạn đúng lúc chiến dịch có tích nhận lượt làn riêng đầu tiên;
  - (d) tài khoản không có làn riêng không khoá thêm;
  - (e) hai làn nhả cùng lúc.
- Số khối đọc của luồng không tích trước / sau V670 trên bảng `auto_campaigns` lớn với đúng bộ chỉ mục production (claim, release, close_stale; mỗi hàm lệch quá 40 khối là hỏng).
- Đổi làn giữa hai lượt (`busy`).
- "Thêm thành viên" và "Nhắn tin theo SĐT" chờ nhau; "Lý do đang chờ" đúng cả khi có và không gửi mã.
- Web / iOS tạo và sửa chiến dịch; bản gỡ.

Bài apply mới (7 nhóm) gồm:
- p3 từ chối khi sổ chưa có V667 p2.
- Làn riêng trên Desktop.
- Bước kiểm loại trừ gửi vẫn tạm dừng chiến dịch có cấu hình mới khi lõi không báo bản.
- Nơi chạy `'server'`: tắt → `not_enabled`, tổ chức đi Fly → `runtime_not_owner`, bật → làn `main`.
- Bản gỡ V667 từ chối khi V670 còn; gỡ V670 rồi gỡ V667 đều được.

Bộ kịch bản, so bản trước / sau V670:
- Cùng 537 lượt, 2.837 lần gửi.
- Mọi mục giống hệt khi bỏ thứ tự khoá JSON, giờ và mã nội bộ.
- Cả hai bên đều có I1 (1) và I1b (2), có từ trước, không do V670.
- 1 trong 3 lần chạy bản V670 có mẫu I1b rơi vào người nhận khác. Hai lần còn lại trùng bản trước, nên đó là do thứ tự chạy song song.

Giả lập A (`scripts/engine-v2-scenarios/parallel-run.cjs`):
- Dùng chung `bootstrap.cjs`, `world.cjs`, `port.cjs` với bộ kịch bản; tự đặt các biến `SCENARIO_*`. DB thử có claim sau V667.
- Mỗi tài khoản có 1–2 chiến dịch thường và 1–3 chiến dịch có tích. Mỗi làn một hàng đợi như bộ lập lịch. Mỗi lời gọi Zalo giả mất 3–33 ms để các làn chồng nhau thật.
- Sự cố tiêm vào:
  - lỗi Zalo / DB;
  - app Desktop / worker Fly chết giữa lượt rồi mở lại;
  - bộ chạy khác chiếm lease của một làn;
  - akaBiz tắt "Tham gia group" giữa vòng 2.
- Bất biến:
  - P1 hai lease cùng loại; P2 hai làn chung thao tác; P3 tài khoản "chờ xử lý" khi làn còn data đang chạy. Ba mục này theo dõi bảng lease mỗi ~25 ms.
  - P4 lần gọi chồng nhau của hai chiến dịch cùng loại / chung thao tác.
  - P8 chờ mãi; khi gặp, giả lập in ảnh chụp lease lúc bỏ cuộc.
  - P9 chờ mà "Lý do đang chờ" không giải thích được.
  - P10 lượt bị chiếm lease vẫn nhận data mới.
  - I1–I15 như bộ kịch bản.
- Lỗi của chính bộ giả lập, đã sửa:
  - lease bị chiếm từng bị coi là mồ côi;
  - P10 từng tính theo giờ gửi;
  - lần chiếm lease trùng lúc lượt bị chiếm vừa xong thì không ai dọn lease giả (P8 giả, seed 2);
  - job đóng lượt bị PostgreSQL huỷ vì khoá chéo thì nay thử lại như pg_cron, có đếm.
- Mục "đã biết":
  - I1b: data trùng trong cùng lô chia sẻ.
  - I11c: `share.ts` của lõi (có từ 12/11, không do làn) ghép nguyên câu lỗi vào dòng ⚠️ khi không lấy được global ID để kiểm từ chối nhận tin. Khách thấy được câu đó, chưa sửa.

Bài kiểm có sẵn hỏng trên bản gốc (không do thay đổi này): `scripts/server-rest-request-reduction-smoke.cjs` (`isWebAccountPlatform is not defined`) và phần `verifyIpcBoundary` của `scripts/campaign-pending-reason-smoke.cjs`.

## Thứ tự đưa lên

1. ~~Đẩy ba nhánh để giữ số V670~~ (đã đẩy tối 26/11). Kiểm lại sổ ngay trước khi apply.
2. ~~Apply V667 p1 → p2 → p3~~ (đã apply 20:57:21–20:58:13 VN 26/11).
3. ~~Apply V670 p1 → p2 → p3~~ (đã apply 20:58:44–20:59:04 VN 26/11).
   - Từ lúc này ba loại đã bật nhưng chưa nơi nào hiện ô.
   - Client cũ nhận `parallel_wait` như trạng thái không nhận lượt, vẫn chạy lần lượt.
   - ~~Chạy câu EXPLAIN chỉ đọc của câu tìm chiến dịch Fly (cũ và có V670) trên production~~ (21:0x VN 26/11): câu V670 như câu cũ. Hiện tại 248 chủ: 89,6–89,9 ms → 90,2–91,6 ms, khối đọc +0,1%. Mọi tổ chức trên Fly, 679 chủ: 119,6 → 118,9–119,5 ms, khối đọc +1%. Lập kế hoạch +1,2–1,5 ms. Chạy thật hai câu: cùng 30 dòng.
4. Deploy ChatApi `api` (hạn chờ lệnh khi cùng tài khoản có nhiều lệnh), rồi `worker` (làn trên Fly). Sau đó deploy API / Web WebApp (ô ở Web; từ đây khách tích được).
5. Phát hành Desktop, iOS.

Tắt nhanh theo loại: `UPDATE auto_campaign_actions SET allow_parallel_run = false WHERE id = …`. Chiến dịch đã tích về làn chính ở lần nhận lượt kế tiếp; lease làn cũ còn hạn thì `busy` tới khi lượt đó nhả.
