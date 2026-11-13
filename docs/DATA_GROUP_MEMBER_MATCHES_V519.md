# Đối chiếu khách đã có trong nhóm khi nhập vào Nhóm data — V519

**V519 đã apply akachat lúc 19:57:24 VN ngày 13/11/2026** (`20261113125724 / migration_v519_data_group_member_matches`;
md5 sổ = md5 tệp `2e561485…`; **không apply lại**). Chỉ thêm hàm đọc
`public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)`. Không bảng, cột, index, trigger, dòng
cài đặt hay hàm sẵn có nào đổi. Caller là API của akaAgentWebApp (nhánh `dev_1`, **chưa deploy** lúc apply); Desktop và
iOS chưa dùng. Số 518 đã có trong sổ (`migration_v518_renewal_reminder_state`, apply 19:45 VN cùng ngày) nên hàm này mang
số 519. [Receipt](../migrations/snapshots/data-group-member-matches-v519/apply-receipt.json).

## Vì sao

Hàm nạp `aka_agent_ingest_data_group` chỉ nhận ra khách đã có trong nhóm khi dòng quy về một liên hệ gắn tài khoản
(định danh = tài khoản + loại + uid). Nhóm không gắn tài khoản Zalo chỉ dùng lại liên hệ trong **cùng một danh sách
tải lên** ("Accountless identity is intentionally NOT global"), nên cùng một số nhập từ file khác hoặc dán tay lần nữa
thành dòng thành viên mới.

Đo trên production 13/11/2026 (chỉ đọc): 5.031 nhóm data không gắn tài khoản (2,54 triệu thành viên) so với 63 nhóm có
gắn; 90 ngày có 113 nhóm được nhập file hoặc dán tay từ hai lần trở lên, kiểm 20 nhóm trong đó thì 13 nhóm có dòng
trùng, 1.933 dòng thừa trên 25.487 (7,6%); ở 5 nhóm, 11% khách cũng nằm trong một nhóm khác của cùng nhân viên.

Web hỏi hàm này **trước khi gửi dòng** rồi bỏ các dòng đã có. Hàm nạp không đổi.

## Hàm

`public.aka_agent_read_data_group_member_matches(p_staff_id, p_organization_id, p_auth_username, p_auth_password,
p_query jsonb) → jsonb`: STABLE, SECURITY DEFINER, `search_path = pg_catalog, public`, `statement_timeout 15s`, EXECUTE
chỉ `service_role` (Web gọi qua backend singleton, thông tin đăng nhập NULL như V491). Không ghi.

`p_query`:

- `groupId`: nhóm data chưa xóa **của chính nhân viên** (nhóm được chia sẻ không phải nơi ghi); sai thì
  `data_group_matches_group_denied` (42501).
- `contactType`: `phone` | `person` | `group`.
- `platform`: `zalo` (mặc định) | `facebook`; chỉ xét với `person`/`group`.
- `values`: tối đa 2.000 chuỗi. SĐT chuẩn hóa bằng `aka_agent_internal_normalize_phone` (đúng cách hàm nạp dựng
  `contact.uid`); loại khác so `btrim(value)`. Giá trị không chuẩn hóa được, rỗng hoặc dài quá 512 ký tự không được tra.
- `otherGroups`: `none` (mặc định, chỉ nhóm đang nhập) | `all` (mọi nhóm data khác của nhân viên) | mảng tối đa 200 id.

Kết quả: `{ checkedAt, groupId, contactType, valueCount, items[] }`; mỗi phần tử của `items` là một giá trị có khớp:
`index` (vị trí trong `values`, từ 0), `inGroup`, `otherGroupCount`, `otherGroup { id, name, addedAt }` (nhóm khác mà
khách vào gần nhất, hoặc null).

Quy tắc đối chiếu:

- Liên hệ cùng loại và uid, **không phân biệt tài khoản**: liên hệ không gắn tài khoản và liên hệ của mọi tài khoản của
  nhân viên (với `person`/`group` chỉ tài khoản cùng nền tảng). Liên hệ phải thuộc đúng nhân viên và tổ chức.
- Thành viên chưa xóa mềm (`is_delete = false`), bất kể cờ vòng đời của liên hệ (như phép tìm thành viên của hàm nạp).
- Nhóm khác: chỉ nhóm `purpose = 'data_group'`, chưa xóa, của chính nhân viên trong tổ chức. Danh sách chặn, nhóm của
  nhân viên khác và nhóm đã xóa không tính.
- Mã lỗi: `data_group_matches_access_denied`, `…_group_denied` (42501); `…_invalid_query`, `…_invalid_group`,
  `…_invalid_contact_type`, `…_invalid_platform`, `…_invalid_other_groups`, `…_invalid_values`, `…_too_many_values`
  (22023).

Hiệu năng: mỗi định danh dò thẳng vào index duy nhất `uq_auto_account_contacts_account_type_uid (account_id,
contact_type, uid)` (một lượt cho `account_id IS NULL`, một lượt cho mỗi tài khoản của nhân viên) rồi sang
`idx_auto_account_contact_group_members_contact (contact_id)`. Câu truy vấn viết bằng `CROSS JOIN LATERAL (… OFFSET 0)`
có chủ đích: viết bằng phép nối thường thì trên production bộ lập kế hoạch chọn index theo phạm vi nhân viên và đọc
23.305 liên hệ cho 1.000 số (3,2 giây), còn nhánh theo tài khoản thành bitmap scan đọc mọi liên hệ của tài khoản.
**Sửa câu truy vấn thì chạy lại bước kiểm kế hoạch trong bài SQL và đo lại trên production.** Migration dừng nếu thiếu
một trong hai index. Chi phí theo số định danh (nhân số tài khoản của nhân viên: nhiều nhất 86, trung vị 3 ngày
13/11), không theo cỡ nhóm.

Số đo trên production: trước apply (`EXPLAIN ANALYZE` câu tương đương) 1.000 số đều khớp, dữ liệu nguội 0,6 giây; không
số nào khớp 9 ms. Sau apply, gọi thật bằng `service_role` trên nhóm 9.878 thành viên: 1.000 giá trị (500 có, 500
không) 139 ms; cùng danh sách với `otherGroups: 'all'` 78 ms.

## Caller và công tắc

- akaAgentWebApp: `POST /data/v2/groups/:groupId/members/matches` (service `dataGroupMemberMatches.ts`): Web gửi lượt
  1.000 giá trị tuần tự, API nhận tới 2.000; tối đa 2 lượt cùng lúc mỗi tiến trình API (quá thì 429, không xếp hàng),
  hạn 20 giây, không cache, không thử lại, không polling, không pool hay kết nối mới. Chỉ gọi khi người dùng bấm "Kiểm
  tra dữ liệu" hoặc "Thêm vào nhóm" trong cửa sổ nhập của trang Nhóm khách hàng.
- Công tắc tắt nhanh không DDL: trường tùy chọn `groupMatches` trong giá trị của `auto_system_settings`
  `web.campaign_input_duplicates` (thiếu = bật, chỉ `false` mới tắt). V519 không thêm hay sửa dòng nào; API đọc lại mỗi
  lượt. `audience` của lọc trùng chiến dịch (V491) không ảnh hưởng tới phần này.
- Thiếu hàm (trước apply hoặc sau rollback): API trả 503 `data_group_matches_not_ready` và cửa sổ nhập chạy như trước,
  không báo lỗi.
- Hợp đồng, giao diện và kiểm thử phía Web: akaAgentWebApp `docs/DATA_GROUP_IMPORT_DUPLICATES.md` (mục Đợt 2).

## Kiểm thử

- SQL cục bộ PostgreSQL 16 có pg_cron (bài nằm ở akaAgentWebApp, dùng fixture `scripts/data-group-routing` của kho này
  và **hàm nạp thật** V485): `AKA_AGENT_REPO=<akaAgent> PGBIN=<pg16>/bin sh scripts/test-data-group-member-matches-sql.sh`,
  52 khẳng định: nạp bằng hàm nạp thật rồi hỏi hàm đọc (nhóm không gắn tài khoản để lọt khách từ file thứ hai và từ dán
  tay trong khi hàm đọc nhận ra họ, kể cả SĐT viết `+84…`, `0084…`, thiếu số 0); nhóm khác theo `all`/mảng/`none`; không
  tính nhóm của nhân viên khác, nhóm đã xóa, danh sách chặn, thành viên đã xóa mềm; nhóm gắn tài khoản; UID, link group,
  nền tảng; 15 kiểu yêu cầu sai; 2.000 giá trị; kế hoạch truy vấn dùng đúng index; quyền (anon, authenticated bị từ
  chối); áp lại bị từ chối; thiếu index thì migration dừng; rollback rồi áp lại. Đạt 52/52 ngày 13/11/2026 với
  `dev_3` `377e448`.
- Trên production trước apply: cả file chạy trong một khối DO rồi tự hủy (không để lại hàm, sổ không đổi); số thật đã
  có trong nhóm được báo ở cả dạng lưu và dạng `+84…`; nhân viên tổ chức khác → 42501; loại `email` → 22023.
- Sau apply: md5 sổ = md5 tệp; md5 định nghĩa hàm `8770c4dd…`, owner `postgres`, SECURITY DEFINER, STABLE, ACL chỉ
  `postgres` và `service_role` (anon, authenticated, `aka_agent_desktop`, `aka_agent_chat_api` không có EXECUTE); hai hàm
  phụ thuộc giữ nguyên md5; 500/500 số thật được báo, 0/500 số bịa; anon gọi → 42501; `edge_logs` 19:52–19:59 VN không
  có phản hồi 5xx/503.
- Chưa kiểm: lượt gọi qua PostgREST bằng khóa `service_role` thật (API Web chưa deploy); nhân viên có 86 tài khoản.

## Triển khai và gỡ

Thứ tự: DB (xong) → merge vào `dev_3` qua [#667](https://github.com/aligoinc/akaAgent/pull/667) → deploy API/Web của akaAgentWebApp (thứ tự nào so với DB cũng an
toàn) → theo dõi `edge_logs` của `rpc/aka_agent_read_data_group_member_matches` ở các lượt gọi đầu.
Gỡ nhanh không DDL: thêm `"groupMatches": false` vào giá trị của `web.campaign_input_duplicates`. Gỡ hẳn:
[rollback](../migrations/rollback_v519_data_group_member_matches.sql) (chỉ xóa hàm, không đụng dữ liệu).

## Desktop

Code Desktop và migration cấp quyền V522 (chỉ `GRANT EXECUTE … TO aka_agent_desktop`, như V493 làm cho V491; thân hàm
không đổi) nằm ở [DATA_GROUP_MEMBER_MATCHES_DESKTOP_V522.md](DATA_GROUP_MEMBER_MATCHES_DESKTOP_V522.md). 13/11/2026:
trên nhánh, chưa merge, V522 chưa apply, Desktop chưa phát hành.
