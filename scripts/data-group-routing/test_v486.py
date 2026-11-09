#!/usr/bin/env python3
"""Kiểm thử V486 (kiểm quyền đọc nhóm chia sẻ chuyển sang plpgsql + plan chung) trên Postgres 17 cục bộ.

Dùng: python3 scripts/data-group-routing/test_v486.py
- Kết quả của 3 hàm giống hệt trước V486 trên mọi tổ hợp: nhóm data/nội dung riêng tư, cả tổ chức, chia sẻ chọn người;
  chủ nhóm, người được chia sẻ, nhân viên cùng tổ chức, nhân viên nghỉ việc/đã xoá, tổ chức khác, nhóm đã xoá.
- Bước tự đối chiếu trong migration chạy được (dữ liệu fixture) và từ chối chạy lại.
- Đo tốc độ đẩy data trước/sau; so sánh song song kịch bản V484 (sync và async) khi có V486 với trước V484.
- Rollback trả nguyên văn.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed as S  # noqa: E402
import test_v484 as T  # noqa: E402
from fixture import ROOT  # noqa: E402

V486 = ROOT / 'migrations' / 'migration_v486_group_access_plan_cache.sql'
RB486 = ROOT / 'migrations' / 'rollback_v486_group_access_plan_cache.sql'
ok = T.ok

SHARING_SQL = f"""
SET session_replication_role = replica;
INSERT INTO public.org_organization (id, name) VALUES (702, 'Tổ chức khác');
INSERT INTO public.org_staff (id, organization_id, name, username, is_active, deleted_at) VALUES
  (726, {S.ORG}, 'Nghỉ việc', 'staff726', false, NULL),
  (727, {S.ORG}, 'Đã xoá', 'staff727', true, now()),
  (800, 702, 'Tổ chức khác', 'staff800', true, NULL);
INSERT INTO public.auto_account_contact_groups (id, staff_id, organization_id, name, purpose, is_delete, sharing_scope, sharing_revision)
VALUES (2101, {S.STAFF}, {S.ORG}, 'Riêng', 'data_group', false, 'private', 1),
       (2102, {S.STAFF}, {S.ORG}, 'Cả tổ chức', 'data_group', false, 'organization', 2),
       (2103, {S.STAFF}, {S.ORG}, 'Chọn người', 'data_group', false, 'selected', 3),
       (2104, 725, {S.ORG}, 'Của 725', 'data_group', false, 'private', 1),
       (2105, {S.STAFF}, {S.ORG}, 'Đã xoá', 'data_group', true, 'organization', 1),
       (2106, 800, 702, 'Tổ chức khác', 'data_group', false, 'organization', 1),
       (2107, {S.STAFF}, {S.ORG}, 'Không phải nhóm data', 'blocklist', false, 'organization', 1);
INSERT INTO public.auto_data_group_recipients (group_id, staff_id) VALUES (2103, 725), (2103, 726);
INSERT INTO public.auto_content_groups (id, name, staff_id, organization_id, is_delete, sharing_scope, sharing_revision) VALUES
  (11, 'ND riêng', {S.STAFF}, {S.ORG}, false, 'private', 1),
  (12, 'ND cả tổ chức', {S.STAFF}, {S.ORG}, false, 'organization', 1),
  (13, 'ND chọn người', {S.STAFF}, {S.ORG}, false, 'selected', 4),
  (14, 'ND đã xoá', {S.STAFF}, {S.ORG}, true, 'organization', 1);
INSERT INTO public.auto_content_group_recipients (group_id, staff_id) VALUES (13, 725);
"""

COMBOS_SQL = """
SELECT k.kind, g.gid, v.viewer, o.org,
       private.group_access(k.kind, g.gid, v.viewer, o.org) AS access,
       CASE WHEN k.kind = 'data' THEN private.can_read_data_group(g.gid, v.viewer, o.org) END AS can_read,
       CASE WHEN k.kind = 'data' THEN private.shared_data_member_owner(g.gid, w.owner, v.viewer, o.org) END AS owner_ok
FROM (VALUES ('data'), ('content'), ('other')) AS k(kind)
CROSS JOIN (VALUES (2101), (2102), (2103), (2104), (2105), (2106), (2107), (11), (12), (13), (14), (999)) AS g(gid)
CROSS JOIN (VALUES (724), (725), (726), (727), (800), (NULL::bigint)) AS v(viewer)
CROSS JOIN (VALUES (701), (702)) AS o(org)
CROSS JOIN (VALUES (724), (725), (800)) AS w(owner)
ORDER BY 1, 2, 3, 4, w.owner
"""


def worker_ms_per_pair(c) -> float:
    c.q(S.campaign_sql(1, 20, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                       statuses=['tạm dừng', 'đang chạy']))
    T.set_mode(c, 'async', orgs='null')
    c.json(S.ingest_sql('speed-1', S.FB_GROUP, 'scan', S.fb_group_rows(1, 300)))
    t = time.time()
    T.drain(c, budget=20000)
    n = int(c.q('SELECT count(*) FROM public.auto_campaign_input_data'))
    return (time.time() - t) * 1000 / n


def main() -> None:
    t0 = time.time()
    # Tốc độ trước V486.
    c = T.new_cluster(with_v484=True)
    try:
        before_ms = worker_ms_per_pair(c)
    finally:
        c.close()

    c = T.new_cluster(with_v484=True)
    try:
        c.q(SHARING_SQL)
        before = c.rows(COMBOS_SQL)
        ok(any(r['access'] and r['access']['role'] == 'shared' for r in before)
           and any(r['access'] and r['access']['role'] == 'owner' for r in before)
           and any(r['access'] is None for r in before), 'tổ hợp kiểm quyền có đủ chủ nhóm / được chia sẻ / không có quyền')
        out, err = c.psql(V486.read_text(encoding='utf-8'))
        ok('identical before/after' in err, 'V486: bước tự đối chiếu trong migration chạy và đạt', err[-300:])
        after = c.rows(COMBOS_SQL)
        ok(after == before, f'V486: {len(before)} tổ hợp kiểm quyền giống hệt trước')
        ok(c.q("SELECT string_agg(l.lanname, ',' ORDER BY p.proname) FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang "
               "WHERE p.oid IN ('private.group_access(text,bigint,bigint,bigint)'::regprocedure,"
               " 'private.can_read_data_group(bigint,bigint,bigint)'::regprocedure,"
               " 'private.shared_data_member_owner(bigint,bigint,bigint,bigint)'::regprocedure)") == 'plpgsql,plpgsql,plpgsql',
           'V486: 3 hàm đã là plpgsql')
        ok(c.q("SELECT proconfig::text FROM pg_proc WHERE oid = 'private.group_access(text,bigint,bigint,bigint)'::regprocedure")
           == '{"search_path=pg_catalog, public",plan_cache_mode=force_generic_plan}', 'group_access dùng plan chung')
        for role in ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'):
            ok(c.q(f"SELECT has_function_privilege('{role}', 'private.group_access(text,bigint,bigint,bigint)', 'EXECUTE')") == 'f',
               f'quyền giữ nguyên: {role} không gọi được group_access')
        _, err = c.psql(V486.read_text(encoding='utf-8'), stop_on_error=False)
        ok('already applied' in err, 'chạy lại V486 bị chặn')
        c.psql(RB486.read_text(encoding='utf-8'))
        ok(c.rows(COMBOS_SQL) == before and c.q(
            "SELECT l.lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang "
            "WHERE p.oid = 'private.group_access(text,bigint,bigint,bigint)'::regprocedure") == 'sql',
           'rollback V486 trả về hàm SQL cũ, kết quả vẫn giống')
        c.psql(V486.read_text(encoding='utf-8'))
        ok(c.rows(COMBOS_SQL) == before, 'apply lại V486 sau rollback được')
    finally:
        c.close()

    c = T.new_cluster(with_v484=True)
    try:
        c.psql(V486.read_text(encoding='utf-8'))
        after_ms = worker_ms_per_pair(c)
    finally:
        c.close()
    ok(after_ms < before_ms * 0.7, f'đẩy data nhanh hơn: {before_ms:.2f} -> {after_ms:.2f} ms/cặp')

    # So sánh song song kịch bản V484 khi có V486.
    a = T.new_cluster(with_v484=False)
    try:
        T.scenario(a)
        snap_a = T.snapshot(a)
    finally:
        a.close()
    for mode in ('sync', 'async'):
        c = T.new_cluster(with_v484=True)
        try:
            c.psql(V486.read_text(encoding='utf-8'))
            if mode == 'async':
                T.set_mode(c, 'async')
                T.scenario(c, after_step=lambda name: T.drain(c))
            else:
                T.scenario(c)
            snap = T.snapshot(c)
        finally:
            c.close()
        for key in snap_a:
            ok(snap[key] == snap_a[key], f'V486 + V484 {mode}: bảng {key} giống hệt trước V484')
    print(f'# {T.PASS} kiểm tra đạt, {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
