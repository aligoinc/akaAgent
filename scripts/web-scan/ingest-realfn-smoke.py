#!/usr/bin/env python3
"""Hàm nạp Nhóm data THẬT của production với SĐT quét từ website (V618), trên PostgreSQL 17 cục bộ (không ghi gì vào production).

DB: fixture nhóm data (scripts/data-group-routing/fixture.py: bản chụp 27/10 + V483 → V486), rồi nạp đè định nghĩa production của mọi hàm
public / private lệch bản chụp, thêm cột production còn thiếu (đọc chỉ đọc bằng --fetch, lưu ở thư mục dữ liệu, không commit). Kiểm:
  - thân production hiện tại (md5 = bộ sinh V618) bỏ mọi dòng SĐT của tài khoản "Website" là "không hợp lệ";
  - sau khi chạy nguyên văn hàm vá của V618 p2: SĐT web vào nhóm, gộp liên hệ qua các lần nạp, đi tiếp vào chiến dịch "Nhắn tin theo SĐT" nhận
    data từ nhóm; dòng loại khác của tài khoản web vẫn bị bỏ; dòng Zalo / Facebook như cũ.

Chạy (macOS, PG17 Homebrew không có pg_cron: script thay bằng lịch giả):
  python3 scripts/web-scan/ingest-realfn-smoke.py --fetch <thư mục dữ liệu>   # đọc chỉ đọc production qua supabase CLI (checkout chính)
  LC_ALL=C PGBIN=/opt/homebrew/opt/postgresql@17/bin python3 scripts/web-scan/ingest-realfn-smoke.py <thư mục dữ liệu>
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'data-group-routing'))
import fixture  # noqa: E402
import seed  # noqa: E402

MAIN_CHECKOUT = Path(os.environ.get('AKA_MAIN_CHECKOUT', '/Users/lequangnhut/Repos/akaAgent'))
SIG = 'public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
PROD_MD5 = 'dc8ccc8c8502ee0e463d911f71ee497e'   # pg_get_functiondef production 21/11/2026 (= LIVE.ingest của bộ sinh V618)
V483_TO_V486 = ['migration_v483_data_group_ingest_budget_guard'] + [f'migration_{n}' for n in (
    'v484_data_group_async_routing_p1', 'v484_data_group_async_routing_p2', 'v484_data_group_async_routing_p3',
    'v485_data_group_upload_sessions_p1', 'v485_data_group_upload_sessions_p2', 'v486_group_access_plan_cache')]
FN_MD5_SQL = """SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)))
  ORDER BY p.oid::regprocedure::text COLLATE "C") AS r
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'"""
COLUMNS_SQL = """SELECT jsonb_agg(jsonb_build_array(n.nspname, c.relname, a.attname, format_type(a.atttypid, a.atttypmod),
  pg_get_expr(d.adbin, d.adrelid))) AS r
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname IN ('public', 'private') AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped"""
# Lịch giả thay pg_cron (V484 p3 tạo job bằng cron.schedule, kiểm cron.job).
CRON_STUB = """CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, active boolean NOT NULL DEFAULT true,
  database text DEFAULT current_database(), username text DEFAULT current_user, nodename text, nodeport integer);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
  $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;"""


class Cluster(fixture.Cluster):
    """Như fixture.Cluster nhưng không nạp pg_cron (thay bằng lịch giả)."""

    def __init__(self):
        import tempfile
        self.keep = False
        self.dir = Path(tempfile.mkdtemp(prefix='web-ingest-'))
        self.port = 56000 + (os.getpid() % 900)
        self.root = False
        self._as_pg([str(fixture.PGBIN / 'initdb'), '-D', str(self.dir / 'data'), '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--locale=C'],
                    quiet=True)
        with open(self.dir / 'data' / 'postgresql.conf', 'a') as fh:
            fh.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{self.dir}'\nport = {self.port}\nfsync = off\n"
                     "full_page_writes = off\nsynchronous_commit = off\n")
        self._as_pg([str(fixture.PGBIN / 'pg_ctl'), '-D', str(self.dir / 'data'), '-l', str(self.dir / 'log'), '-w', 'start'], quiet=True)

    def q(self, sql: str) -> str:
        return super().q(sql.replace('CREATE EXTENSION pg_cron;', CRON_STUB))


def prod_query(sql: str):
    """Câu chỉ đọc trên production (project link ở checkout chính)."""
    res = subprocess.run(['supabase', 'db', 'query', '--linked', '-o', 'json', sql], cwd=MAIN_CHECKOUT, capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit(f'supabase db query lỗi: {res.stderr[-2000:]}')
    out = res.stdout
    return json.loads(out[out.index('{'):out.rindex('}') + 1])['rows'][0]['r']


def build_local() -> Cluster:
    c = Cluster()
    c.build_schema()
    for name in V483_TO_V486:
        c.psql((ROOT / 'migrations' / f'{name}.sql').read_text(encoding='utf-8'))
    c.q("UPDATE cron.job SET active = false")
    return c


def fetch(data: Path) -> None:
    data.mkdir(parents=True, exist_ok=True)
    prod = {s: m for s, m in prod_query(FN_MD5_SQL)}
    c = build_local()
    try:
        local = {s: m for s, m in c.json(FN_MD5_SQL.replace(' AS r', ''))}
    finally:
        c.close()
    need = sorted(s for s in prod if local.get(s) != prod[s])
    print(f'production {len(prod)} hàm, cục bộ {len(local)}, cần nạp đè {len(need)}')
    defs = []
    for i in range(0, len(need), 150):
        part = need[i:i + 150]
        arr = 'ARRAY[' + ','.join("'" + s.replace("'", "''") + "'" for s in part) + ']'
        defs += prod_query(f"""SELECT jsonb_agg(jsonb_build_array(p.oid::regprocedure::text, pg_get_functiondef(p.oid))) AS r FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
          AND p.oid::regprocedure::text = ANY({arr})""") or []
    (data / 'prod_function_defs.json').write_text(json.dumps(defs, ensure_ascii=False), encoding='utf-8')
    (data / 'prod_columns.json').write_text(json.dumps(prod_query(COLUMNS_SQL), ensure_ascii=False), encoding='utf-8')
    print('đã lưu', len(defs), 'định nghĩa hàm và cột production vào', data)


PASS = 0
FAIL: list[str] = []


def ok(cond, msg, detail=None):
    global PASS
    if cond:
        PASS += 1
        print(f'PASS {msg}')
    else:
        FAIL.append(msg)
        print(f'FAIL {msg}' + (f'\n     {str(detail)[:2000]}' if detail is not None else ''))


def run(data: Path) -> int:
    defs = json.loads((data / 'prod_function_defs.json').read_text(encoding='utf-8'))
    columns = json.loads((data / 'prod_columns.json').read_text(encoding='utf-8'))
    c = build_local()
    try:
        have = {(r['table_schema'], r['table_name'], r['column_name']) for r in c.rows(
            "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema IN ('public', 'private')")}
        tables = {(s, t) for s, t, _ in have}
        adds = [f'ALTER TABLE {s}."{t}" ADD COLUMN IF NOT EXISTS "{col}" {typ}'
                + (f' DEFAULT {d}' if d and 'nextval(' not in d else '') + ';'
                for s, t, col, typ, d in columns if (s, t) in tables and (s, t, col) not in have]
        if adds:
            c.psql('\n'.join(adds), stop_on_error=False)
        _, err = c.psql('SET check_function_bodies = off;\n' + '\n'.join(d + ';' for _, d in defs), stop_on_error=False)
        errors = [line for line in err.splitlines() if 'ERROR' in line]
        print(f'nạp đè {len(defs)} hàm production ({len(errors)} lỗi tạo, bỏ qua), thêm {len(adds)} cột')
        md5_now = lambda: c.q(f"SELECT md5(pg_get_functiondef('{SIG}'::regprocedure))")
        ok(md5_now() == PROD_MD5, 'DB thử chạy đúng thân hàm nạp production 21/11 (md5 = bộ sinh V618)', md5_now())
        # Hàm trên đường nạp / đẩy nhóm data (nạp, đẩy vào chiến dịch, quyền nhóm, khoá chuẩn hoá) phải đúng bản production.
        local = {s: m for s, m in c.json(FN_MD5_SQL.replace(' AS r', ''))}
        path_fns = [(s, d) for s, d in defs if re.search(r'data_group|ingest|route|group_access|campaign_input|canonical|normalize_phone', s)]
        drift = [s for s, d in path_fns if local.get(s) != hashlib.md5(d.encode('utf-8')).hexdigest()]
        ok(not drift, f'{len(path_fns)} hàm trên đường nạp / đẩy nhóm data đúng bản production', drift)

        WEB_ACCOUNT, CAMPAIGN = 5003, 4001
        c.psql(seed.BASE_SQL + f"""
SET session_replication_role = replica;
INSERT INTO public.auto_accounts (id, staff_id, organization_id, name, flatform_type, is_delete, is_active)
  VALUES ({WEB_ACCOUNT}, {seed.STAFF}, {seed.ORG}, 'Website 1', 'web', false, true);
""" + seed.campaign_sql(CAMPAIGN, 1, group=seed.PHONE_GROUP, action='zalo_message_phone', account=seed.ZALO_ACCOUNT, statuses=['chờ xử lý']))

        def web_rows(phones, contact_type='phone'):
            # Đúng khuôn dataGroupRepository.ingestDataGroup gửi cho dòng của pushWebScanRecords (Desktop).
            return [{'contact_id': None, 'source_account_id': WEB_ACCOUNT, 'relationship_kind': None, 'contact_type': contact_type,
                     'flatform_type': None, 'name': f'Anh {p[-3:]}', 'uid': None, 'url': None, 'phone': p, 'email': None,
                     'info1': 'Quận 7, TP.HCM', 'info2': '5 tỷ', 'info3': None, 'info4': None, 'info5': f'https://www.nhatot.com/x/{p}',
                     'extra_data': {'sourceCampaignId': 211, 'sourceCampaignActionId': 'web_find_data_nhatot', 'site': 'nhatot',
                                    'listingKey': f'nhatot:{p}', 'link': f'https://www.nhatot.com/x/{p}', 'reused': False,
                                    'fields': {'address': 'Quận 7, TP.HCM', 'price': '5 tỷ'}}} for p in phones]

        def ingest(request_id, rows, account=WEB_ACCOUNT, group=seed.PHONE_GROUP, data_type=seed.TYPE_PHONE):
            raw = c.json(f"SELECT to_jsonb(r) FROM public.aka_agent_ingest_data_group({seed.STAFF}, {seed.ORG}, '{request_id}', {group}, 'scan', "
                         f"{seed.sql_json(rows)}, NULL, NULL, NULL, {account}, 'Chiến dịch tìm data: Thử', NULL, {data_type}) r")
            return raw[0] if isinstance(raw, list) else raw

        members = lambda: int(c.q(f"SELECT count(*) FROM public.auto_account_contact_group_members WHERE group_id = {seed.PHONE_GROUP} AND NOT is_delete"))
        inputs = lambda: c.rows(f"SELECT phone, status FROM public.auto_campaign_input_data WHERE campaign_id = {CAMPAIGN} AND NOT COALESCE(is_delete, false) ORDER BY id")
        phones = ['0901234561', '0901234562', '0901234563']

        r = ingest('web-scan:211:9211:1:1880:a:v1', web_rows(phones))
        ok(int(r['invalid_count']) == 3 and int(r['inserted_membership_count']) == 0 and members() == 0 and inputs() == [],
           'thân production: 3 SĐT của tài khoản Website đều bị đếm "không hợp lệ", nhóm và chiến dịch không nhận', r)

        # Hàm vá nguyên văn từ migration V618 p2.
        p2 = (ROOT / 'migrations' / 'migration_v618_web_data_scan_p2.sql').read_text(encoding='utf-8')
        m = re.findall(r'CREATE OR REPLACE FUNCTION public\.aka_agent_ingest_data_group_v186_internal\([\s\S]*?\n\$function\$\n?;', p2)
        ok(len(m) == 1, 'V618 p2 có đúng một định nghĩa hàm nạp vá', len(m))
        c.psql(m[0])
        nxt = subprocess.run(['node', '-e', "process.stdout.write(require('./scripts/build-v618-sql.cjs').NEXT_MD5.ingest)"], cwd=ROOT,
                             capture_output=True, text=True).stdout
        ok(md5_now() == nxt and nxt, 'sau vá: md5 hàm = bộ sinh V618 (NEXT_MD5.ingest)', (md5_now(), nxt))

        r = ingest('web-scan:211:9211:2:1880:b:v1', web_rows(phones))
        contacts = c.rows(f"""SELECT ct.account_id, ct.flatform_type, ct.contact_type, ct.uid, ct.phone, ct.name, ct.extra_data->>'info1' AS info1,
            ct.extra_data->>'info5' AS info5, ct.extra_data->>'site' AS site FROM public.auto_account_contacts ct
            JOIN public.auto_account_contact_group_members m ON m.contact_id = ct.id WHERE m.group_id = {seed.PHONE_GROUP} ORDER BY ct.id""")
        ok(int(r['inserted_membership_count']) == 3 and int(r['invalid_count']) == 0 and members() == 3,
           'sau vá: 3 SĐT của tài khoản Website vào nhóm', r)
        ok([(x['account_id'], x['flatform_type'], x['contact_type'], x['phone']) for x in contacts]
           == [(WEB_ACCOUNT, 'web', 'phone', p) for p in phones]
           and all(x['info1'] == 'Quận 7, TP.HCM' and x['site'] == 'nhatot' and x['info5'].endswith(x['phone']) for x in contacts),
           'liên hệ gắn tài khoản Website, nền tảng web, giữ Info1–5 và thông tin của tin', contacts)
        ok([x['phone'] for x in inputs()] == phones and all(x['status'] == 'chờ xử lý' for x in inputs()),
           'SĐT đi tiếp vào chiến dịch "Nhắn tin theo SĐT" nhận data từ nhóm', inputs())

        r2 = ingest('web-scan:211:9211:3:1880:c:v1', web_rows(phones[1:] + ['0901234564']))
        ok(int(r2['already_member_count']) == 2 and int(r2['inserted_membership_count']) == 1 and members() == 4
           and int(c.q(f"SELECT count(*) FROM public.auto_account_contacts WHERE account_id = {WEB_ACCOUNT}")) == 4
           and len(inputs()) == 4, 'lần nạp sau: số đã có gộp về liên hệ cũ (không lặp trong nhóm / chiến dịch), số mới thêm', r2)
        r3 = ingest('web-scan:211:9211:3:1880:c:v1', web_rows(phones[1:] + ['0901234564']))
        ok(r3.get('request_id') == r2.get('request_id') and members() == 4 and len(inputs()) == 4,
           'gửi lại cùng mã yêu cầu: không thêm gì', r3)

        r4 = ingest('web-scan:211:9211:4:1880:d:v1', web_rows(['0901234565'], contact_type='person'))
        ok(int(r4['invalid_count']) == 1 and members() == 4, 'dòng loại khác SĐT của tài khoản Website vẫn bị bỏ', r4)

        zalo = [{'contact_type': 'phone', 'phone': '0912000001', 'name': 'Khách Zalo', 'source_account_id': seed.ZALO_ACCOUNT}]
        r5 = ingest('zalo:1', zalo, account=seed.ZALO_ACCOUNT)
        ok(int(r5['inserted_membership_count']) == 1 and int(r5['invalid_count']) == 0, 'dòng SĐT của tài khoản Zalo như cũ', r5)
        fb = seed.fb_group_rows(1, 2)
        r6 = ingest('fb:1', fb, account=seed.FB_ACCOUNT, group=seed.FB_GROUP, data_type=seed.TYPE_FB_GROUP)
        ok(int(r6['inserted_membership_count']) == 2 and int(r6['invalid_count']) == 0, 'dòng group của tài khoản Facebook như cũ', r6)
        bad = [{'contact_type': 'phone', 'phone': '0912000002', 'flatform_type': 'tiktok', 'source_account_id': seed.ZALO_ACCOUNT}]
        r7 = ingest('bad:1', bad, account=seed.ZALO_ACCOUNT)
        ok(int(r7['invalid_count']) == 1, 'nền tảng lạ khác web vẫn bị bỏ', r7)
    finally:
        c.close()
    print(f'\n{PASS} PASS, {len(FAIL)} FAIL')
    return 1 if FAIL else 0


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--fetch':
        fetch(Path(sys.argv[2]))
        sys.exit(0)
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    sys.exit(run(Path(sys.argv[1])))
