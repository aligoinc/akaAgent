"""Sinh câu SELECT chỉ đọc để chép dữ liệu thật của các nhóm data mẫu (chạy qua MCP, kết quả lưu file).

Mỗi câu trả {data: {"<bảng>": {"cols": [...], "rows": [[...], ...]}, ...}, pad: ~128k ký tự} để kết quả luôn được
lưu ra file thay vì vào ngữ cảnh. Cột nhạy cảm (mật khẩu, phiên, token, SĐT/email nhân viên) bị bỏ.
"""
from __future__ import annotations

import sys

GROUPS = (1770, 4682, 4221, 1198, 1634, 5608, 2130, 34, 376, 1482)
SIB_PER_GROUP = 300
PAD = "(SELECT string_agg(md5(i::text), '') FROM generate_series(1, 4000) AS i) AS pad"
DROP = {
    'auto_accounts': ('zalo_session', 'email_session', 'username', 'password', 'mobile_device_info',
                      'runtime_operation_claim_token'),
    'org_staff': ('password', 'phone', 'email', 'device_fingerprint_hash', 'aka_agent_device_fingerprint_hash',
                  'pancake', 'akabiz_integrations'),
    'org_organization': ('phone', 'email'),
    'org_organization_product': ('organization_phone', 'organization_email'),
    'auto_campaigns': ('log',),
}
G = f"g(id) AS (VALUES {', '.join(f'({x})' for x in GROUPS)})"
CAMP = "camp AS (SELECT DISTINCT campaign_id AS id FROM public.auto_campaign_data_group_sources WHERE group_id IN (SELECT id FROM g))"

FULL_PREFIX = f"""WITH {G},
gg AS (SELECT * FROM public.auto_account_contact_groups WHERE id IN (SELECT id FROM g)),
orgs AS (SELECT DISTINCT organization_id AS id FROM gg),
{CAMP},
campacc AS (SELECT account_id, secondary_account_id FROM public.auto_campaigns WHERE id IN (SELECT id FROM camp)),
mem AS (SELECT id, contact_id FROM public.auto_account_contact_group_members WHERE group_id IN (SELECT id FROM g)),
morig AS (SELECT * FROM public.auto_account_contact_group_member_origins WHERE membership_id IN (SELECT id FROM mem)),
ds AS (SELECT id FROM public.auto_account_contacts_dataset WHERE group_id IN (SELECT id FROM g)
       UNION SELECT dataset_id FROM morig WHERE dataset_id IS NOT NULL),
dsm AS (SELECT contact_id FROM public.auto_account_contacts_dataset_members WHERE dataset_id IN (SELECT id FROM ds)),
sib AS (
  SELECT contact_id FROM (
    SELECT x.id AS for_group, m2.contact_id, row_number() OVER (PARTITION BY x.id ORDER BY m2.contact_id DESC) AS rn
    FROM gg x
    JOIN public.auto_account_contact_groups g2
      ON g2.organization_id = x.organization_id AND g2.id <> x.id AND g2.purpose = 'data_group' AND g2.is_delete = false
     AND g2.data_type_category_item_id IS NOT DISTINCT FROM x.data_type_category_item_id
    JOIN public.auto_account_contact_group_members m2 ON m2.group_id = g2.id AND m2.is_delete = false
    WHERE NOT EXISTS (SELECT 1 FROM public.auto_account_contact_group_members m
                      WHERE m.group_id = x.id AND m.contact_id = m2.contact_id)
  ) s WHERE rn <= {SIB_PER_GROUP}),
cts AS (SELECT contact_id AS id FROM mem UNION SELECT contact_id FROM dsm UNION SELECT contact_id FROM sib),
accs AS (SELECT account_id AS id FROM campacc UNION SELECT secondary_account_id FROM campacc
         UNION SELECT bound_zalo_account_id FROM gg UNION SELECT source_account_id FROM morig
         UNION SELECT account_id FROM public.auto_account_contacts_dataset WHERE id IN (SELECT id FROM ds)
         UNION SELECT account_id FROM public.auto_account_contacts WHERE id IN (SELECT id FROM cts))
"""

BUNDLES = {
    'ref': [(t, 'true') for t in ('category_type', 'category_item', 'auto_campaign_actions', 'auto_campaign_action_data_types',
                                  'auto_status', 'auto_error', 'auto_campaign_action_detail_statuses',
                                  'auto_campaign_type_visibility', 'org_product', 'auto_system_settings')],
    'core': [
        ('org_organization', 't.id IN (SELECT id FROM orgs)'),
        ('org_staff', 't.organization_id IN (SELECT id FROM orgs)'),
        ('org_organization_product', 't.organization_id IN (SELECT id FROM orgs)'),
        ('auto_accounts', 't.id IN (SELECT id FROM accs)'),
        ('auto_account_contact_groups', 't.id IN (SELECT id FROM g)'),
        ('auto_data_group_recipients', 't.group_id IN (SELECT id FROM g)'),
        ('auto_account_contact_group_members', 't.group_id IN (SELECT id FROM g)'),
        ('auto_account_contact_group_member_origins', 't.membership_id IN (SELECT id FROM mem)'),
        ('auto_account_contacts', 't.id IN (SELECT id FROM cts)'),
        ('auto_account_contacts_dataset', 't.id IN (SELECT id FROM ds)'),
        ('auto_account_contacts_dataset_members', 't.dataset_id IN (SELECT id FROM ds)'),
        ('auto_campaign_data_group_sources', 't.group_id IN (SELECT id FROM g)'),
        ('auto_data_ingest_batches', 't.group_id IN (SELECT id FROM g)'),
    ],
}
CHUNKED = [  # (bảng, điều kiện, số phần theo id)
    ('auto_campaigns', 't.id IN (SELECT id FROM camp)', 2),
    ('auto_campaign_input_target_aliases', 't.campaign_id IN (SELECT id FROM camp)', 3),
    ('auto_campaign_input_data', 't.campaign_id IN (SELECT id FROM camp)', 6),
    ('auto_campaign_input_origins',
     't.input_data_id IN (SELECT i.id FROM public.auto_campaign_input_data i WHERE i.campaign_id IN (SELECT id FROM camp))', 7),
]


def table_expr(table: str, where: str) -> str:
    drop = ''.join(f" - '{c}'" for c in DROP.get(table, ()))
    obj = f'(to_jsonb(t){drop})'
    return (f"'{table}', (SELECT json_build_object("
            f"'cols', (SELECT coalesce(json_agg(k), '[]') FROM (SELECT jsonb_object_keys({obj}) AS k FROM public.{table} t LIMIT 1) z), "
            f"'rows', coalesce(json_agg((SELECT json_agg(e.value) FROM jsonb_each({obj}) e)), '[]')) "
            f"FROM public.{table} AS t WHERE {where})")


def bundle_query(name: str) -> str:
    parts = ', '.join(table_expr(t, w) for t, w in BUNDLES[name])
    return FULL_PREFIX + f"SELECT json_build_object({parts})::text AS data, {PAD}"


def chunk_query(table: str, where: str, parts: int, part: int) -> str:
    cond = f'({where}) AND t.id % {parts} = {part}'
    return f"WITH {G}, {CAMP} SELECT json_build_object({table_expr(table, cond)})::text AS data, {PAD}"


def all_queries() -> list[tuple[str, str]]:
    out = [(f'bundle.{b}', bundle_query(b)) for b in BUNDLES]
    for table, where, parts in CHUNKED:
        out += [(f'{table}.{p}', chunk_query(table, where, parts, p)) for p in range(parts)]
    return out


if __name__ == '__main__':
    qs = all_queries()
    if len(sys.argv) > 1:
        print(qs[int(sys.argv[1])][1])
    else:
        for i, (name, q) in enumerate(qs):
            print(i, name, len(q))
