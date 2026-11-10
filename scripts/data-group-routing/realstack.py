"""Cụm Postgres cục bộ cho kiểm thử bằng dữ liệu thật: 'old' = production trước V484 (V483), 'new' = sau V486."""
from __future__ import annotations

from fixture import Cluster, ROOT

MIG = ROOT / 'migrations'
V483 = MIG / 'migration_v483_data_group_ingest_budget_guard.sql'
NEW_PARTS = [MIG / f'{n}.sql' for n in (
    'migration_v484_data_group_async_routing_p1', 'migration_v484_data_group_async_routing_p2',
    'migration_v484_data_group_async_routing_p3', 'migration_v485_data_group_upload_sessions_p1',
    'migration_v485_data_group_upload_sessions_p2', 'migration_v486_group_access_plan_cache')]

FN_MD5_SQL = """
SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), coalesce(p.proacl::text, ''),
                                   l.lanname) ORDER BY p.oid::regprocedure::text COLLATE "C")
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace JOIN pg_language l ON l.oid = p.prolang
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
"""


def build(kind: str, keep: bool = False) -> Cluster:
    assert kind in ('old', 'new')
    c = Cluster(keep=keep)
    c.build_schema()
    c.psql(V483.read_text(encoding='utf-8'))
    if kind == 'new':
        for part in NEW_PARTS:
            c.psql(part.read_text(encoding='utf-8'))
        c.q("UPDATE cron.job SET active = false WHERE jobname = 'aka-agent-data-group-route-worker'")
    return c
