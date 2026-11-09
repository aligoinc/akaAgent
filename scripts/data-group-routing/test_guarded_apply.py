#!/usr/bin/env python3
"""Kiểm thử script dán SQL Editor (migrations/tests/*_guarded_apply.sql) cho V484 p1-p3, V485 p1-p2, V486 trên
Postgres 17 + pg_cron cục bộ (fixture hàm live thật, V483 đã apply, sổ migration giống production).

Dùng: python3 scripts/data-group-routing/test_guarded_apply.py
- Dán sai thứ tự bị chặn, không đổi gì; dán lại một phần đã apply bị chặn.
- Dán đúng thứ tự: mỗi phần ghi sổ migration với md5(statements[1]) = md5 file (như apply_migration); kết quả cuối
  'applied'; hàm nạp/worker/3 hàm kiểm quyền đúng md5 đích.
- Kết quả giống hệt khi apply thẳng file migration (cùng vân tay hàm/bảng/cron).
"""
from __future__ import annotations

import hashlib
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_v484 as T  # noqa: E402
from fixture import ROOT  # noqa: E402

ok = T.ok
MIG = ROOT / 'migrations'
NAMES = [
    'migration_v484_data_group_async_routing_p1', 'migration_v484_data_group_async_routing_p2',
    'migration_v484_data_group_async_routing_p3', 'migration_v485_data_group_upload_sessions_p1',
    'migration_v485_data_group_upload_sessions_p2', 'migration_v486_group_access_plan_cache',
]
LEDGER_SQL = """
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text, rollback text[]);
"""
FINGERPRINT_SQL = """
SELECT md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, ''),
                      ',' ORDER BY p.oid::regprocedure::text COLLATE "C"))
FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
UNION ALL
SELECT md5(string_agg(c.oid::regclass::text || ':' || c.relkind::text || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity,
                      ',' ORDER BY c.oid::regclass::text COLLATE "C"))
FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'private' AND c.relkind IN ('r', 'i')
UNION ALL
SELECT string_agg(jobname || ' ' || schedule || ' ' || command, ' | ' ORDER BY jobname) FROM cron.job
UNION ALL
SELECT value FROM public.auto_system_settings WHERE key = 'data_groups.routing_mode'
"""


def md5(s: str) -> str:
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def new_cluster():
    c = T.new_cluster(with_v484=False)
    c.q(LEDGER_SQL)
    v483 = (MIG / 'migration_v483_data_group_ingest_budget_guard.sql').read_text(encoding='utf-8')
    c.q("INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES "
        f"('20261109120408', 'migration_v483_data_group_ingest_budget_guard', ARRAY[$src${v483}$src$]);")
    return c


def guarded(name: str) -> str:
    return (MIG / 'tests' / f'{name}_guarded_apply.sql').read_text(encoding='utf-8')


def ledger_count(c) -> int:
    return int(c.q('SELECT count(*) FROM supabase_migrations.schema_migrations'))


def main() -> None:
    t0 = time.time()
    c = new_cluster()
    try:
        base = c.q(FINGERPRINT_SQL)
        _, err = c.psql(guarded(NAMES[1]), stop_on_error=False)
        ok('chưa thấy migration_v484_data_group_async_routing_p1' in err and ledger_count(c) == 1
           and c.q(FINGERPRINT_SQL) == base, 'dán V484 p2 trước p1: bị chặn, không đổi gì', err[-300:])
        _, err = c.psql(guarded(NAMES[3]), stop_on_error=False)
        ok('chưa thấy migration_v484_data_group_async_routing_p3' in err and c.q(FINGERPRINT_SQL) == base,
           'dán V485 p1 trước V484: bị chặn, không đổi gì', err[-300:])
        for i, name in enumerate(NAMES):
            time.sleep(1.1)  # version = giây UTC lúc ghi sổ (khóa chính); người dán tay không bao giờ nhanh hơn 1 giây
            out, err = c.psql(guarded(name))
            file_md5 = md5((MIG / f'{name}.sql').read_text(encoding='utf-8'))
            last = out.strip().splitlines()[-1].split('|')
            ok(last[0] == 'applied' and last[2] == name and last[3] == file_md5 and last[4] == 't',
               f'dán {name}: applied, sổ migration md5 = file ({file_md5[:8]}…)', out[-300:])
            ok(ledger_count(c) == i + 2, f'sổ migration có đúng {i + 2} dòng')
            _, err = c.psql(guarded(name), stop_on_error=False)
            ok('đã có trong sổ migration' in err and ledger_count(c) == i + 2, f'dán lại {name}: bị chặn', err[-200:])
        ok(c.q("SELECT md5(pg_get_functiondef('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,"
               "text,jsonb,bigint,text,text,bigint,text,text)'::regprocedure))") == 'dc8ccc8c8502ee0e463d911f71ee497e',
           'hàm nạp nhóm đúng md5 sau V485 (dc8ccc8c…)')
        ok(c.q("SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_run_data_group_route_worker(integer)'::regprocedure")
           == 'dda4a682e5028469a1542e5c10efebd6', 'worker đúng md5 sau V485 (dda4a682…)')
        ok(c.q("SELECT string_agg(md5(pg_get_functiondef(oid)), ',' ORDER BY oid::regprocedure::text COLLATE \"C\") FROM pg_proc "
               "WHERE oid IN ('private.group_access(text,bigint,bigint,bigint)'::regprocedure,"
               " 'private.can_read_data_group(bigint,bigint,bigint)'::regprocedure,"
               " 'private.shared_data_member_owner(bigint,bigint,bigint,bigint)'::regprocedure)")
           == '8d5f08ca86d4f5a90e24f7c45a02da15,4f7d34cd8bfa753d35a9ab9a0ec213b4,0cf5471fa64437cf4e99528e0c2e31c7',
           '3 hàm kiểm quyền đúng md5 V486')
        via_guarded = c.q(FINGERPRINT_SQL)
    finally:
        c.close()

    d = new_cluster()
    try:
        for name in NAMES:
            d.psql((MIG / f'{name}.sql').read_text(encoding='utf-8'))
        ok(d.q(FINGERPRINT_SQL) == via_guarded, 'vân tay hàm/bảng/cron/công tắc giống hệt khi apply thẳng file migration')
    finally:
        d.close()
    print(f'# {T.PASS} kiểm tra đạt, {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
