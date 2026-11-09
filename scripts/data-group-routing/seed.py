"""Dữ liệu mẫu cho kiểm thử đường nạp/đẩy nhóm data (không phải dữ liệu khách).

Mô phỏng ca 09/11/2026: tổ chức 701 / nhân viên 724, nhóm data Facebook group 1770 cấp data cho nhiều chiến dịch
"Đăng bài vào nhóm" (phần lớn tạm dừng), cộng một nhóm SĐT cấp cho chiến dịch Zalo nhắn SĐT và một chiến dịch
khác kiểu để có kết quả "incompatible".
"""
from __future__ import annotations

import json

ORG = 701
STAFF = 724
FB_ACCOUNT = 5001
ZALO_ACCOUNT = 5002
FB_GROUP = 1770
PHONE_GROUP = 1880
UNTYPED_GROUP = 1990
TYPE_FB_GROUP = 101
TYPE_PHONE = 102
TYPE_ZALO_PERSON = 103

BASE_SQL = f"""
SET session_replication_role = replica; -- dữ liệu mẫu: bỏ qua trigger quota/entitlement
INSERT INTO public.category_type (id, namespace, code, managed_by, is_active)
  VALUES (1, 'common', 'data_type', 'system', true);
INSERT INTO public.category_item (id, category_type_id, code, name, managed_by, is_active) VALUES
  ({TYPE_FB_GROUP}, 1, 'facebook_group', 'Nhóm Facebook', 'system', true),
  ({TYPE_PHONE}, 1, 'phone', 'Số điện thoại', 'system', true),
  ({TYPE_ZALO_PERSON}, 1, 'zalo_person', 'Người Zalo', 'system', true);
INSERT INTO public.auto_campaign_action_data_types (campaign_action_id, data_type_category_item_id, can_target, is_active, is_delete)
VALUES ('facebook_group_post', {TYPE_FB_GROUP}, true, true, false),
       ('facebook_join_group', {TYPE_FB_GROUP}, true, true, false),
       ('zalo_message_phone', {TYPE_PHONE}, true, true, false),
       ('zalo_add_group_member', {TYPE_PHONE}, true, true, false);
INSERT INTO public.org_organization (id, name) VALUES ({ORG}, 'Tổ chức thử');
INSERT INTO public.org_staff (id, organization_id, name, username, is_active) VALUES
  ({STAFF}, {ORG}, 'Nhân viên thử', 'staff724', true), (725, {ORG}, 'Nhân viên khác', 'staff725', true);
INSERT INTO public.auto_accounts (id, staff_id, organization_id, name, flatform_type, is_delete, is_active)
VALUES ({FB_ACCOUNT}, {STAFF}, {ORG}, 'FB A', 'facebook', false, true),
       ({ZALO_ACCOUNT}, {STAFF}, {ORG}, 'Zalo A', 'zalo', false, true);
INSERT INTO public.auto_account_contact_groups (id, staff_id, organization_id, name, purpose, is_delete, data_type_category_item_id, revision)
VALUES ({FB_GROUP}, {STAFF}, {ORG}, 'Nhóm FB', 'data_group', false, {TYPE_FB_GROUP}, 0),
       ({PHONE_GROUP}, {STAFF}, {ORG}, 'Nhóm SĐT', 'data_group', false, {TYPE_PHONE}, 0),
       ({UNTYPED_GROUP}, {STAFF}, {ORG}, 'Nhóm tự do', 'data_group', false, NULL, 0);
"""


def campaign_sql(first_id: int, count: int, *, group: int, action: str, account: int, statuses: list[str],
                 source_status: str = 'active') -> str:
    """`count` chiến dịch id first_id.., trạng thái lặp theo `statuses`, mỗi chiến dịch một nguồn nhóm data."""
    vals = []
    for i in range(count):
        cid = first_id + i
        st = statuses[i % len(statuses)]
        vals.append(f"({cid}, {STAFF}, {ORG}, 'CD {cid}', '{action}', {account}, 'data_group', {group}, '{st}', false,"
                    f" now(), 'ready')")
    src = ',\n'.join(f"({first_id + i}, {group}, '{source_status}', {STAFF}, {ORG})" for i in range(count))
    return (
        "SET session_replication_role = replica;\n"
        "INSERT INTO public.auto_campaigns (id, staff_id, organization_id, name, action_id, account_id,"
        " data_target_source_mode, data_group_id, status, is_delete, schedule, provisioning_state) VALUES\n"
        + ',\n'.join(vals) + ";\n"
        "INSERT INTO public.auto_campaign_data_group_sources (campaign_id, group_id, status, staff_id, organization_id)"
        " VALUES\n" + src + ";\n"
    )


def fb_group_rows(start: int, count: int, *, dup_every: int = 0) -> list[dict]:
    rows = []
    for i in range(start, start + count):
        rows.append({'contact_type': 'group', 'flatform_type': 'facebook', 'uid': str(900000000 + i),
                     'url': f'https://www.facebook.com/groups/{900000000 + i}', 'name': f'Group {i}'})
        if dup_every and (i - start + 1) % dup_every == 0:
            rows.append(dict(rows[-1]))
    return rows


def phone_rows(start: int, count: int) -> list[dict]:
    return [{'contact_type': 'phone', 'phone': f'09{start + i:08d}', 'name': f'Khách {start + i}',
             'info1': f'i{start + i}'} for i in range(count)]


def sql_json(value) -> str:
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def ingest_sql(request_id: str, group: int, kind: str, rows: list[dict], *, account: int | None = FB_ACCOUNT,
               data_type: int | None = TYPE_FB_GROUP, dataset_name: str | None = None) -> str:
    acc = 'NULL' if account is None else str(account)
    dt = 'NULL' if data_type is None else str(data_type)
    dn = 'NULL' if dataset_name is None else "'" + dataset_name.replace("'", "''") + "'"
    return (f"SELECT public.aka_agent_ingest_data_group({STAFF}, {ORG}, '{request_id}', {group}, '{kind}', "
            f"{sql_json(rows)}, NULL, {dn}, NULL, {acc}, 'Thử', NULL, {dt})")
