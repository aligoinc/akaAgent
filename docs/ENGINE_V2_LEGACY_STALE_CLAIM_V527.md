# Engine v2: claim token bộ cũ treo trên chiến dịch tạm dừng / đã xoá (V527)

> 14/11/2026. **V527 là migration ứng viên, CHƯA apply production.** Không đổi bảng, dữ liệu, thiết lập; không đổi bộ chạy cũ.
> Production chỉ được đọc (akachat `cgjbsmqtfhqvttudyjzq`): định nghĩa hàm, sổ migration, số đo bên dưới.

## Sự cố

Bật cờ `org_organization.use_new_zalo_runtime` đêm 13–14/11 (81 tổ chức) thì 49 chiến dịch tạm dừng (30 đã xoá) giữ
`runtime_claim_token` target `server` từ 29/09–13/11 trên 38 tài khoản Server, chặn 28 chiến dịch chờ chạy trên 18 tài khoản.
01:28 VN 14/11 đã gỡ tay bằng cách đặt NULL 4 cột `runtime_claim_*` (anh duyệt).

- `aka_agent_engine_claim_target_v1` (thân V507) trả `{"status":"legacy_busy","scope":"campaign"}` khi **bất kỳ** chiến dịch nào của tài
  khoản còn `runtime_claim_token` / `runtime_unit_token`, không lọc trạng thái, `is_delete`, tuổi claim. Worker Fly
  (ChatApi `flyEngineRunner.ts`, `deferUntil`) gặp `legacy_busy` chỉ thử lại sau 60 giây, không về bộ cũ; Desktop gọi cùng hàm.
- Trigger `aka_agent_clear_campaign_runtime_claim_metadata` cố ý giữ 4 cột claim khi chiến dịch target `server` chuyển
  "đang chạy" → "tạm dừng" (để nơi chạy khôi phục câu trả lời bị mất rồi tự nhả).
- App Server không nhả claim đó: lệnh ghi cuối lượt (`updateClaimedZaloServerCampaign`, CAS `status = 'đang chạy'`) không khớp sau khi
  người dùng tạm dừng, rồi chỉ nhả token thao tác tài khoản (`release_zalo_account_runtime_operation`). Bộ cũ trên Fly
  (ChatApi `releaseClaimInTransaction`) có xoá claim của chính nó khi bị tạm dừng.
- Xoá chiến dịch (`delete_control_campaign_atomic`) không kiểm token với tài khoản Server, chỉ đặt `is_delete`, nên claim ở lại mãi.

Đo 14/11 01:54 VN (`node scripts/engine-v2-legacy-busy-scan.cjs`, chỉ đọc), tổ chức **chưa** bật cờ, tài khoản Zalo Server:
**437 tài khoản sẽ bị chặn ngay khi bật cờ** (195 chiến dịch chờ / đang chạy); 626 chiến dịch giữ claim treo (328 đã xoá, 298 tạm
dừng), tất cả target `server`, không unit lease, không data "đang chạy", tài khoản không còn token thao tác. Theo luật V527: 0 tài khoản bị
chặn. Tổ chức đã bật cờ: 0 (sau lần gỡ tay 01:28). Kể cả tài khoản QR/Web (`--all-zalo`): 520 → 83; cả 83 đều do bộ cũ đang giữ tài khoản
(token thao tác: Desktop bản cũ đang chạy), đúng là phải chờ.

## Luật V527

Chỉ đổi đoạn kiểm token theo chiến dịch trong `aka_agent_engine_claim_target_v1(jsonb)`. Một chiến dịch giữ token **không còn chặn** khi đủ cả:

1. chiến dịch đã xoá (`is_delete`) hoặc `status = 'tạm dừng'`;
2. không giữ unit lease (`runtime_unit_token` rỗng);
3. không còn data "đang chạy" (`auto_campaign_input_data` chưa xoá, như `runningTargets` của engine);
4. `runtime_claimed_at` **và** `updated_at` của chiến dịch (lần ghi cuối: lúc tạm dừng / xoá) đều cũ hơn ngưỡng.

Vẫn chặn như cũ: token thao tác tài khoản (`auto_accounts.runtime_operation_claim_token`, kiểm trước), unit lease, claim trên chiến dịch chưa
xoá mà không tạm dừng (chờ / đang chạy / hoàn thành), chiến dịch vừa tạm dừng / vừa xoá, chiến dịch còn data "đang chạy". Hàm không xoá token
nào (bộ mới không dùng / xoá token bộ cũ). Tài khoản không có chiến dịch giữ token: một câu `EXISTS` như trước, không đọc thiết lập.

Vì sao an toàn: lượt bộ cũ đang chạy luôn giữ token thao tác tài khoản (`aka_agent_claim_campaign_runtime_v2` gán cùng giao dịch với claim
chiến dịch, nhả ở ranh giới an toàn sau khi thấy tạm dừng), giữ unit lease khi đang gửi một lô data, và data đang gửi ở "đang chạy". Ngưỡng
thời gian là chốt thêm cho lượt vừa bị tạm dừng giữa chừng và lần gọi lại sau khi mất câu trả lời.

Không đổi: đếm giới hạn tài khoản Zalo Web chạy đồng thời (Desktop) vẫn đếm chiến dịch giữ token như `aka_agent_claim_campaign_runtime_checked`
(hai bộ dùng chung giới hạn); `finish_campaign_v2` / `materialize_v1` chỉ kiểm chính chiến dịch đang chạy (phải "chờ xử lý" / "đang chạy").

### Ngưỡng đề xuất: 30 phút

Thiết lập `engine.legacy_stale_claim_minutes` trong `auto_system_settings` (chưa có dòng nào; đổi không cần migration): mặc định **30**,
sàn **10**, giá trị sai định dạng / tắt dùng 30, bỏ khoảng trắng. 30 phút = 3 lần `engine.stale_target_minutes` (10, mốc engine coi một
lượt data là treo); bộ cũ dừng sau data đang xử lý khi bị tạm dừng (hạn media ảnh 90 giây, tệp 180 giây). Production 14/11: mọi chiến dịch
tạm dừng giữ claim server có `updated_at` sau `runtime_claimed_at` (2 giây – 38 ngày), tức lệnh tạm dừng / xoá có ghi `updated_at`.
Đánh đổi: tạm dừng một chiến dịch Server ngay trước khi bật cờ thì tài khoản đứng tối đa 30 phút sau lần ghi đó.

## Hiệu năng

Production 14/11 (EXPLAIN ANALYZE chỉ đọc, tài khoản có 7 chiến dịch giữ claim treo): câu kiểm mới 0,5 ms, 40 buffer, quét
`idx_auto_campaigns_app_access_held_account` và index-only `idx_sms_input_data_campaign_status_schedule` (đúng điều kiện
`coalesce(is_delete, false) = false`). Trần 3 giây của `aka_agent_desktop` không bị ảnh hưởng.

## Tệp và kiểm thử

- [migrations/migration_v527_engine_claim_skip_stale_legacy_token.sql](../migrations/migration_v527_engine_claim_skip_stale_legacy_token.sql)
  (md5 tệp `40f62f5f…`), [rollback](../migrations/rollback_v527_engine_claim_skip_stale_legacy_token.sql) (md5 `cbc7e5dc…`), sinh từ
  [scripts/build-v527-sql.cjs](../scripts/build-v527-sql.cjs) (không sửa tay).
- Thân nguồn = V507 đang chạy: md5 `prosrc` `e09100fd…`, md5 `pg_get_functiondef` `f33e534e…` (dựng lại khớp từng byte), chủ `postgres`,
  SECURITY DEFINER, VOLATILE, `search_path=""`, EXECUTE `postgres` / `service_role` / `aka_agent_chat_api` / `aka_agent_desktop`. V508–V526
  không đụng hàm. Đích: `prosrc` `f8935a5a…`, định nghĩa `43e14ce4…`.
- Preflight fail-closed: sổ đã có `migration_v527_%`, thiếu hàm, thân / định nghĩa / chủ sở hữu / thuộc tính khác bản đã đọc thì dừng; hậu
  kiểm so lại md5, chủ sở hữu, thuộc tính, ACL nguyên văn trước apply, `anon` / `authenticated` không có EXECUTE. Rollback kiểm ngược lại.
- [Smoke V527](../scripts/campaign-outcome-engine-v527-smoke.cjs) trên PostgreSQL 17.11 cục bộ, chuỗi V495 → … → V507 → V515 → V517: 8 nhóm
  (tái hiện lỗi trước V527, 4 ca từ chối của preflight / hậu kiểm, apply thử rồi ROLLBACK, apply qua `make-migration-ledger-apply.cjs`,
  9 ca nhận được cộng chính chiến dịch treo → `campaign_paused`, 15 ca vẫn chặn, 10 ca thiết lập, gỡ / apply lại). 7 đột biến (bỏ kiểm unit
  lease / data "đang chạy" / `runtime_claimed_at` / `updated_at`, bỏ sàn, nới điều kiện tạm dừng / xoá, đếm cả data đã xoá) đều bị bắt đúng ca.
  `node scripts/campaign-outcome-engine-check-all.cjs`: 31/31.

## Quét trước khi bật cờ

```bash
node scripts/engine-v2-legacy-busy-scan.cjs
```

Một câu SELECT qua `supabase db query --linked` (kiểm `project-ref` = akachat), so luật V507 với V527, in tài khoản / chiến dịch còn chặn
và lý do. Tham số: `--org 526,557`, `--enabled`, `--all-orgs`, `--all-zalo`, `--minutes N`, `--details`, `--json`, `--print-sql`, `--workdir`.
Chạy được từ worktree (tự tìm checkout chính đã link). Trước V527, mọi tài khoản trong danh sách "Bị chặn theo V507" sẽ đứng sau khi bật cờ;
sau V527, tài khoản còn trong danh sách là đang bị bộ cũ giữ thật (chờ bộ cũ nhả, không gỡ tay).

## Kế hoạch apply (chờ anh bảo)

Thời điểm đề xuất: ngoài giờ cao điểm (trước 09:30, 12:00–13:30 hoặc sau 17:00 VN), **trước đợt bật cờ hàng loạt**; DDL làm PostgREST
nạp lại schema một lần (các lần trước 2–8 giây, không lỗi 5xx). Nếu bật cờ trước khi apply: quét rồi gỡ tay từng đợt như 01:28.

1. Chỉ đọc ngay trước: sổ chưa có `migration_v527_%`; md5 thân / định nghĩa hàm claim `e09100fd…` / `f33e534e…`; chạy script quét, giữ kết quả.
   Nếu anh muốn, chạy thử tệp với `COMMIT;` cuối thay bằng `ROLLBACK;` (như V502) trong cùng lần được duyệt apply.
2. `node scripts/make-migration-ledger-apply.cjs migrations/migration_v527_engine_claim_skip_stale_legacy_token.sql migration_v527_engine_claim_skip_stale_legacy_token <tệp ra>`
   rồi `supabase db query --linked --workdir /Users/lequangnhut/Repos/akaAgent -f <tệp ra>`; lỗi bất kỳ thì cả giao dịch huỷ, sổ không ghi.
3. Hậu kiểm: `md5(statements[1])` của sổ = md5 tệp; hàm `f8935a5a…` / `43e14ce4…`, ACL như trước; script quét in "Hàm claim đang chạy:
   V527"; log worker Fly bớt `legacy_busy`; `edge_logs` không 5xx / 503 quanh phút apply.
4. Gỡ: `migrations/rollback_v527_engine_claim_skip_stale_legacy_token.sql` (trả thân V507).

## Chưa làm

- Gốc ở App Server (không xoá claim của chiến dịch đã tạm dừng) và đường xoá chiến dịch Server: giữ nguyên, bộ cũ không đổi.
- Token treo vẫn nằm trong DB (V527 chỉ bỏ qua); Desktop bản cũ vẫn đếm chúng vào giới hạn tài khoản Web chạy đồng thời như trước.
