# Giới hạn tài khoản và chiến dịch theo token Desktop — 28/10/2026

**Sửa review đã apply lúc 13:41:38 VN ngày 28/10/2026:** [migration thu hồi chia sẻ nhóm data](GROUP_SHARING_REVOKE_OWNERSHIP.md) (`20261028064138`) khắc phục việc guard campaign chặn thao tác nội bộ dừng nguồn của người nhận. Giữ nguyên các guard ownership hiện tại; không apply lại migration dưới đây hoặc bản sửa.

Bản chụp đầy đủ `migrations/snapshots/desktop-account-ownership/before.json` đã chuyển khỏi repo ngày 28/10/2026, sang kho `AKA_AGENT_PRIVATE_SECURITY_DIR` (mặc định `$HOME/.codex/incident-recovery/akaAgent-ip-block`). Generator và fixture đã dùng đường dẫn ngoài repo; migration, rollback, plan và các bằng chứng kiểm thử còn lại giữ nguyên.

Đã apply **akachat** (`cgjbsmqtfhqvttudyjzq`) lúc **01:50:59 VN ngày 28/10/2026**:

- Production: `20261027185059 / desktop_account_campaign_ownership`.
- Canonical: `supabase/migrations/20261027183537_desktop_account_campaign_ownership.sql`.
- 19 policy restrictive dành riêng cho `aka_agent_desktop`, hai trigger và hai helper private mới; 47 function body hiện có chỉ thêm ràng buộc token. Không sửa dữ liệu nghiệp vụ, build/deploy client hoặc đổi hợp đồng RPC.

## Hành vi

Token Desktop chỉ đọc, tạo và sửa tài khoản/chiến dịch của staff được ánh xạ từ Auth `sub`. Biết ID tài khoản/chiến dịch hoặc truyền staff ID, username/password của người khác không vượt qua ràng buộc này. Quy tắc áp dụng cả admin trong tổ chức. Không cần update thêm app để nhận thay đổi DB này; không mở lại quyền anon đã thu hồi ở V435.

Các bảng tài khoản, chiến dịch, nhóm tài khoản và proxy kiểm tra `staff_id`. Các bảng input, detail, trạng thái/quota, email tracking, run/step/event/log liên quan kiểm tra các tham chiếu cha qua RLS. INSERT/UPDATE phải giữ tham chiếu tài khoản chính/phụ, nhóm và proxy thuộc staff hiện tại. Trigger trên hai bảng cha cũng kiểm tra khi ghi từ SECURITY DEFINER. Cột staff/org đã bị cấm UPDATE trực tiếp từ lần thu hẹp ACL trước đó và vẫn bị cấm.

RPC đặc quyền được ràng buộc trước phần xử lý nghiệp vụ. `auto_assert_automation_identity` giữ kiểm tra credentials cũ và bổ sung binding với token; các RPC nhận account/campaign ID còn kiểm tra chủ sở hữu tài nguyên. Các wrapper SQL và nhánh không cần credentials của Server cũng được rà soát. Helper phân biệt bằng role DB thực tế; claim JSON tự ghi `service_role` không biến role Desktop thành backend.

Service role và `aka_agent_chat_api` giữ hành vi cũ. Cơ chế claim/token/CAS, lịch, quota, timeout/config, thứ tự khóa trong body cũ không bị viết lại. Việc chặn DeepSeek, staff privacy, IP hook, AI proxy và bootstrap/update cũ giữ nguyên.

## Chia sẻ và tương thích dữ liệu cũ

Danh sách người nhận vẫn chỉ trả **ID + tên**, cùng org, còn hoạt động/chưa xóa. Giữ đọc nội dung và thành viên nhóm data đã được chia sẻ, kiểm tra chọn nhóm và lưu người nhận. Chia sẻ nhóm không cấp quyền đọc tài khoản/session/chiến dịch của chủ nhóm.

Preflight dữ liệu: không có tài khoản chưa xóa dùng nhóm/proxy khác staff hoặc tham chiếu nhóm/proxy không còn tồn tại; không có chiến dịch chưa xóa trỏ tới tài khoản đã mất. Inventory trước thay đổi không có campaign dùng account chính/phụ khác staff. Một campaign cũ có org không khớp staff: vẫn đọc/sửa bình thường theo staff; chỉ INSERT hoặc thay đổi owner/org thực tế mới phải khớp tổ chức. Không tự sửa dòng này.

Run của workflow editor không gắn account/campaign vẫn giữ hành vi cũ. Các catalog dùng chung, nội dung/data được chia sẻ và cache hồ sơ Zalo chung không được biến thành dữ liệu riêng của staff trong migration này. Phạm vi bảo vệ là tài khoản/chiến dịch và các tài nguyên chạy có tham chiếu đã liệt kê trong `plan.json`, không phải tuyên bố mọi bảng trong toàn hệ thống đều riêng tư.

## Kiểm chứng

13 nhóm local PostgreSQL 17 dùng định nghĩa/ACL/policy/trigger live và dữ liệu giả:

1. Preflight từ chối khi function config/body đã bị sửa sau capture.
2. Own rows, legacy org row, shared content/data và backend/Chat giữ kết quả trước–sau.
3. SELECT/list/UPDATE theo ID không thấy tài khoản/chiến dịch/input/run/group/proxy khác staff hoặc org.
4. JWT thiếu, malformed, chưa map fail closed; staff thứ hai chỉ thấy tài khoản của họ.
5. Tạo/sửa của mình thành công; owner/org/account chính-phụ/proxy/group/child reference khác staff bị chặn.
6. RPC đặc quyền không chấp nhận staff khác kể cả credentials đúng; append log/email summaries/cooldown có guard.
7. Picker ID+tên và lưu chia sẻ hoạt động; đọc được thành viên nhóm data của staff khác đã chia sẻ.
8. Tất cả entry PL/pgSQL được patch và có quyền Desktop từ chối input foreign staff/account/campaign trước xử lý nghiệp vụ.
9. Facebook/Zalo QR/Web claim, campaign claim, quota, Facebook preview, phone-check và cập nhật session của mình hoạt động; session/claim/quota người khác bị chặn; Chat backend ghi được.
10. Checksum toàn bộ 47 function sau patch khớp target; các thuộc tính cũ được giữ.
11. Rollback khôi phục đúng định nghĩa source và từ chối drift của function/policy.
12. 100.000 input giả với index production: bốn workload đọc/page/count/ID giữ kết quả; sau patch khoảng 1–14 ms trên máy local.
13. Chính script transaction/role-emulation/rollback production chạy đạt trong fixture.

Production trial áp dụng candidate rồi chạy kiểm tra và rollback toàn bộ trong một transaction. Fingerprint own account/campaign/input mẫu của **ba mapping Auth thật** khớp; không thấy account/campaign staff khác; backend không bị scope; metadata function/policy/trigger sau hoàn nguyên khớp trước trial. Không dùng password, trích xuất hoặc mint token Desktop thật, không ghi dữ liệu khách hàng.

Sau apply, lặp kiểm tra read-only bằng role DB thật và xác nhận:

- 47 function đúng target, **1.206 function cũ khác không đổi**; tổng 1.253 function cũ giữ owner/security/volatility/config/ACL. Hai helper mới khớp metadata local.
- Toàn bộ relation/column ACL, RLS/force-RLS, role/membership/default ACL, constraints, view/dependency và policy/trigger cũ giữ nguyên. Chỉ thêm 19 policy và hai trigger dự kiến.
- 12 HTTP read-only đạt: DeepSeek không lộ qua anon/publishable, updater cũ, startup/login content, feed ba nền tảng 9.1.0 và backend health.
- Workload production đọc 100 input: planning 1,553 ms, execution 27,507 ms. Đây là mẫu kiểm chứng, không phải cam kết độ trễ cho mọi dữ liệu.
- Security advisors giữ nguyên chín nhóm cảnh báo có sẵn, không phát sinh nhóm/finding mới. Không xử lý ngoài phạm vi các cảnh báo này; [Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter) mô tả các mã.

Lượt này kiểm thử hợp đồng SQL/runtime và HTTP bootstrap; chưa mở mọi installer hoặc thao tác toàn bộ UI của khách. Không thay source app, không cần typecheck/build mới cho thay đổi DB này.

## Nguồn live và rollback

Đã capture live trong task, tìm migration có định nghĩa cho đủ 47 signature rồi dựng patch từ live. 46 body có bản tương ứng trong repository; `aka_agent_list_campaign_automation_details` live còn có projection `aka_agent_semantic_row_json` và timeout 60s so với V202. Cả hai được giữ. Audit tự kiểm tra body cũ được bảo toàn ngoài đoạn guard thêm vào.

Exact signatures, source/target checksum, owner/config/ACL và định nghĩa nằm trong `migrations/snapshots/desktop-account-ownership/plan.json`, `target-meta.json`, `migration-inventory.json`; bằng chứng local/trial/post-apply/HTTP/performance/advisors cùng thư mục. Scripts có prefix `scripts/desktop-account-ownership-`.

`migrations/rollback_desktop_account_campaign_ownership.sql` kiểm tra target checksum/ACL/owner, đủ policy của 19 bảng và hai trigger trước khi hoàn nguyên. Không CASCADE, không ghi dữ liệu khách. **Rollback mở lại quyền chéo staff, chỉ chạy khi người dùng có chỉ thị riêng. Không apply lại migration hoặc rollback cũ B/C.**

Hai helper mới:

| Signature | Target MD5 |
| --- | --- |
| `private.aka_agent_assert_request_ownership(bigint,bigint,bigint)` | `31494192d0a18efeafa4fb0296008230` |
| `private.aka_agent_guard_parent_ownership()` | `1e72bdc906b4d905f555c3f6d4114dda` |

## Checksum 47 function hiện có

| Signature | Source MD5 | Target MD5 |
| --- | --- | --- |
| `auto_assert_automation_identity(bigint,bigint,text,text)` | `5a9a503db72b965eb644739f5f60905d` | `f50796438b0e90ef184fa25cc4043e98` |
| `private.facebook_random_claim_allowed(bigint,bigint,text)` | `e204dc76d6ca7fe8806d135b53201902` | `4fa056905d4fb0c264053748546f5461` |
| `private.facebook_random_finalize_turn(bigint,bigint,uuid,uuid,boolean)` | `687fc3efe8378dd175f88f852bc47a51` | `a2a5e8b256010056498af554b2ad0bb8` |
| `private.facebook_random_orphan_turns(bigint,bigint)` | `ea0c365929e5731b4e6436bfc1c58883` | `2f00a8a9d3465e535332f1e97f0946b2` |
| `private.facebook_random_pause_requested(bigint,bigint,uuid)` | `172635824af6f7a3a0cae242c0d1d978` | `50295fe0c805a2f215613182cec5b576` |
| `private.facebook_random_unit_gate(bigint,bigint,uuid,integer)` | `39c1403afa099c706b38f2850adf52ec` | `379ec95f37086654c316847ce7e16ee6` |
| `private.facebook_random_unit_recover(bigint,bigint,uuid)` | `0aea61ae267927a82b4f3e921ba468cf` | `582c96e29079dc70bb706da1f4a08849` |
| `private.facebook_random_unit_settled(bigint,bigint,uuid,boolean)` | `865b74966309d70fbb81f9e76dd491a0` | `c867e990c73a78b5ce5fbdb72634a78c` |
| `private.facebook_random_unit_started(bigint,bigint,uuid)` | `62ffac318d74ac671a5a1b9e51630c4a` | `462463fb5676836150ff146a5f070d84` |
| `aka_agent_apply_campaign_delivery_cooldown(bigint,bigint,bigint,bigint[])` | `07630b82e68cba560a8c7538b24702d5` | `c125235098f1d766e97ecc06c64db17b` |
| `aka_agent_apply_zalo_server_campaign_tags(bigint,bigint,bigint,bigint,uuid,uuid,bigint,text,text,bigint[])` | `65cd07b8ae16017794e56977c2f76aff` | `119e338eb2cb3b14ce7b3f5fada89bfb` |
| `aka_agent_campaign_send_exclusion_runtime(bigint,bigint,bigint,uuid,text,jsonb)` | `841a8fc8da0bca527508e71dcdc6b8fa` | `ca4ba08f2a0fc853c3cee79ac1190001` |
| `aka_agent_check_zalo_message_opt_out(bigint,bigint,bigint,text,text)` | `92b00c0827a801e9ffece28d14805f84` | `b67d767dab4cb40df36061fbbbff2bb4` |
| `aka_agent_facebook_login(bigint,text,text,text,jsonb)` | `4ab7e726d3bc9c9e17c35b61f186ed55` | `ea41c2afd849c007d1db16c6e12e0da0` |
| `aka_agent_finalize_expired_zalo_server_data_group_campaigns(bigint,bigint,text,integer)` | `01a16672ec57fac76a9afe140a242f11` | `ad964b8130cc621c91777f3770ff5f4e` |
| `aka_agent_finalize_zalo_server_data_group_campaign(bigint,bigint,text,bigint,text)` | `d6ea4c72508274a8c3fc8c827e52276d` | `2e8974fb896f4595582d44aa5547b9e8` |
| `aka_agent_finalize_zalo_server_maintenance_campaign(bigint,bigint,text,bigint,text,boolean)` | `0cf1c121dc19713c46305bbf41dec680` | `fb5eed8776a1a6f65dc9c4776a1ececd` |
| `aka_agent_list_contact_dataset_member_ids(bigint,bigint,bigint,bigint,text)` | `a726cda368e948073c609d963912e637` | `e1f0d03b1609d62685dc4e5fafff2e91` |
| `aka_agent_list_contact_datasets(bigint,bigint,bigint,text,text,text,text)` | `e0a575612eb1ce7a72dbe47e65daf62a` | `0b53df90ce71e617987faceb6484811d` |
| `aka_agent_list_email_campaign_link_tracking_summaries(bigint)` | `be12f4fe693b615e984d660116d5267d` | `1697cd911602d53ce773bf8360ceb683` |
| `aka_agent_lock_campaign_input_serialization(bigint)` | `74c082aacb1de27a8cedff2e824f219f` | `ca07284b7f0f0a3ab5a6ee7c8e745ab6` |
| `aka_agent_prepare_zalo_message_opt_out(bigint,bigint,bigint,text,text)` | `0217c031e0d6aaef63c2589cbe1f7b94` | `dbb83b82d882feaeed7b6b9db0e8cdce` |
| `aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)` | `a46368117d2815b67442383cd753089b` | `23dbd56e263e062b7d2819b8ce8062e7` |
| `aka_agent_take_campaign_content_index(bigint,bigint,bigint,text,uuid,uuid,bigint,text,integer)` | `006a6da075ede4e9c6b07194422f65c9` | `a52b46d96fe0791ef1e2f68c02b99e4a` |
| `aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)` | `b4be76b63cd90ef5f4d7bdd93a22b288` | `e5ef8b12614447aeef9357db98f8ea2d` |
| `append_auto_campaign_log(bigint,bigint,text)` | `230e219f5b854a2d2154ee0dc6c867a2` | `d8adb4829fbe382f45065f9b5ba58f27` |
| `aka_agent_zalo_phone_check_usage(bigint,bigint,bigint,text,uuid,boolean,text,text)` | `91fb0001b629cb058a41454068b439d2` | `62e0316082d120d600ab3a95b4792257` |
| `aka_agent_finalize_zalo_server_contact_dataset(bigint,bigint,bigint,text,text,text,text,text,text,text,text[],jsonb,bigint,uuid)` | `c97300fa762faa37e7b931761a9b2abb` | `690666a4fe0bd27a0c0b82a7064a8d6f` |
| `reconcile_auto_automation_enqueue_failures(bigint,bigint,text,integer,text,text)` | `8cb7ed969e34334dc874f2ffea08a93d` | `d45ebf943a37c41f5f1ec8e96111232c` |
| `aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint,text,text)` | `869d902d319748ea1ce3376b3526df3d` | `6cb8024f35b85ffe3354b43c6ec8f107` |
| `aka_agent_campaign_diagnostics_evidence(bigint,bigint,bigint,text,text)` | `9391f47e1be976e0d7e595325d3c2f31` | `d6a98a3ebd67c363066dd1e5baea2a42` |
| `aka_agent_desktop_campaign_detail(bigint,bigint,text,text,jsonb,bigint,text,jsonb)` | `8cd5def0920f178d5efed9fb73ddefab` | `0f591afd90b59c1d4298647713367331` |
| `aka_agent_desktop_campaign_logs(bigint,bigint,text,text,jsonb,bigint,jsonb)` | `61f1ce6860cfc474d998cc70005717a1` | `ed9701b430944bd57be5140a98d5ed47` |
| `aka_agent_facebook_random_run(bigint,bigint,text,text,bigint,text,jsonb)` | `2c7b2243ebe72dbd544a270dd56310fc` | `3c2caab8b949a640b4bdc3a61642ef31` |
| `aka_agent_facebook_web_enrichment_settings(bigint,bigint,text,text,bigint,text,jsonb)` | `df426447a1fd533e052437699bb8dd5d` | `7c71f5cb2733d276ad9bd10cddcf5cac` |
| `aka_agent_finalize_campaign(bigint,bigint,bigint,text,boolean,text,text,text)` | `475e69ab388df822777e035d1dd03cb4` | `8a1898523d8c45a9a9209f3695de9d6f` |
| `aka_agent_get_campaign_data_group_source(bigint,bigint,bigint,text,text)` | `d225647b4faec110607f9bfb1d574511` | `869f135a1c97185bb6e2e992897d3bcd` |
| `aka_agent_list_campaign_automation_details(bigint,bigint,bigint,text,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text)` | `ecad3867d725b6fbb27148366f90b6ce` | `ae098d96f96eaffe8379b34498e0dff0` |
| `aka_agent_list_campaign_detail_automation_triggers(bigint,bigint,bigint,bigint[],text,text)` | `56822434723347452c8944484764daea` | `3458739aa8d25f42d2e7ce3cf676b558` |
| `aka_agent_list_campaign_details_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,integer,integer,text,text,text,text)` | `10fc44b5eb273974bb44aa3aaf757630` | `da6cd0d362196536d99805382af28d1b` |
| `aka_agent_list_campaign_input_data_page_by_ids(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text,bigint[])` | `6faf48dceae54faacb69b6c3aa3b5ca6` | `136d1d76209b9b86c8d2f2fb13725665` |
| `aka_agent_list_campaign_input_data_page_v2(bigint,bigint,bigint,text,text,timestamp with time zone,timestamp with time zone,text,integer,integer,text,text,text)` | `440e2c6163518d4c0563c275d33e8474` | `dbba6b5b77cd6fa3a924fae8e54c5073` |
| `aka_agent_preflight_campaign_data_group_change(bigint,bigint,bigint,bigint,text,text)` | `967d28f6e9df5472bfefeffa6746ffb7` | `d88ecc2b15e3459e72239a0ab76dea25` |
| `aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)` | `56c07dc3ce73ba9bb5e0660bf15ab34e` | `9e8f3da3084e112a1c683723e9dbed49` |
| `aka_agent_send_exclusion_groups(bigint,bigint,bigint,text,jsonb,text,text)` | `7f163f902b82a72f8f850e432050a7e6` | `f8baf5aae05bf68e0f6af0032e1a5c39` |
| `aka_agent_snapshot_data_group_to_direct_campaign(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)` | `aa9006241ecdb9a8bb4fccd4a868dc67` | `ae8bc2191337b013232590523a05fb10` |
| `aka_agent_stop_campaign_data_group_source(bigint,bigint,bigint,text,text,text,text)` | `9cc36d9836b829660a9d5f29f2db281d` | `579cf37e8442efe8ce7db23a3673132d` |
