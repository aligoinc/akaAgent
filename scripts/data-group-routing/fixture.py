"""Dựng Postgres cục bộ (PG17 + pg_cron) có schema + hàm live của nhóm data để kiểm thử V484+.

Không chạm production. Nguồn:
- migrations/snapshots/desktop-session-rls/: bảng, ràng buộc, hàm (public/private/trigger), trigger, quyền hàm chụp
  live 27/10/2026. Bản chụp không có default cột nên bù default chung cho cột NOT NULL và default nghiệp vụ cho các
  bảng nhóm data (lấy theo migration v186+).
- Index unique mà ON CONFLICT trong đường nạp/đẩy cần (lấy nguyên văn từ migration).
- migrations/snapshots/group-access-v486/live-functions.json: định nghĩa live 09/11/2026 của private.group_access (che tên
  chủ nhóm cho phiên Desktop) và private.aka_agent_staff_scope_for_request, đè lên bản chụp 27/10.
- Sau đó apply nguyên văn migration_v483 (đã kiểm md5 thân wrapper như production).

Dùng làm module: `from fixture import Cluster`. PGBIN mặc định /usr/lib/postgresql/17/bin.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAP = ROOT / 'migrations' / 'snapshots' / 'desktop-session-rls'
PGBIN = Path(os.environ.get('PGBIN', '/usr/lib/postgresql/17/bin'))

# Default nghiệp vụ (theo CREATE TABLE trong migration) cho các bảng của đường nạp/đẩy nhóm data.
COLUMN_DEFAULTS = {
    ('auto_campaign_data_group_sources', 'status'): "'baselining'",
    ('auto_campaign_data_group_sources', 'baseline_revision'): '0',
    ('auto_data_ingest_batches', 'status'): "'processing'",
    ('auto_account_contact_group_member_origins', 'is_current'): 'true',
    ('auto_account_contacts_dataset_members', 'is_current'): 'true',
    ('auto_account_contacts_dataset', 'contact_count'): '0',
    ('auto_account_contact_groups', 'revision'): '0',
    ('auto_account_contact_groups', 'purpose'): "'data_group'",
    ('auto_account_contact_groups', 'sharing_scope'): "'private'",
    ('auto_account_contact_groups', 'sharing_revision'): '0',
    ('auto_account_contact_group_members', 'change_revision'): '0',
    ('auto_campaign_input_target_aliases', 'conflict_count'): '0',
}

UNIQUE_INDEXES = [
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_account_contact_group_members_unique ON public.auto_account_contact_group_members (group_id, contact_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_account_contact_datasets_active_legacy_identity ON public.auto_account_contacts_dataset (staff_id, account_id, scan_type, contact_type, source_key) WHERE is_delete = false AND group_id IS NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_account_contact_datasets_active_group_upload ON public.auto_account_contacts_dataset (staff_id, organization_id, group_id, COALESCE(account_id, 0::bigint), flatform_type, contact_type, scan_type, lower(btrim(source_key))) WHERE is_delete = false AND source = 'upload' AND group_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_data_canonical_target ON public.auto_campaign_input_data (campaign_id, canonical_target_key) WHERE canonical_target_key IS NOT NULL AND COALESCE(is_delete, false) = false",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_data_automation_detail ON public.auto_campaign_input_data (auto_automation_detail_id) WHERE auto_automation_detail_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_data_control_append ON public.auto_campaign_input_data (campaign_id, control_append_idempotency_key, control_append_row_index) WHERE control_append_idempotency_key IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_account_contact_group_member_origins_identity ON public.auto_account_contact_group_member_origins (membership_id, kind, COALESCE(dataset_id, 0::bigint), COALESCE(batch_id, 0::bigint), COALESCE(source_account_id, 0::bigint), COALESCE(automation_detail_id, 0::bigint), COALESCE(source_name_snapshot, ''), COALESCE(relationship_kind, ''))",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_data_group_member_origin_dynamic_filter ON public.auto_account_contact_group_member_origins (membership_id, dynamic_filter_id) WHERE dynamic_filter_id IS NOT NULL",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_campaign_input_origins_identity ON public.auto_campaign_input_origins (input_data_id, origin_kind, COALESCE(source_id, 0::bigint), COALESCE(membership_id, 0::bigint), COALESCE(batch_id, 0::bigint), COALESCE(automation_detail_id, 0::bigint))",
    "CREATE INDEX IF NOT EXISTS idx_auto_campaign_data_group_sources_group_intake ON public.auto_campaign_data_group_sources (group_id, status, campaign_id) WHERE status IN ('baselining', 'active')",
]

ROLES = [
    'anon', 'authenticated', 'authenticator NOINHERIT', 'service_role BYPASSRLS', 'aka_agent_desktop',
    'aka_agent_chat_api BYPASSRLS', 'crm_interest_worker BYPASSRLS', 'aka_message_ingest_owner',
    'supabase_auth_admin', 'supabase_admin', 'dashboard_user', 'pgbouncer',
]


def _generic_default(col_type: str) -> str | None:
    t = col_type.lower()
    if t.endswith('[]'):
        return "'{}'"
    if t.startswith('timestamp'):
        return 'now()'
    if t == 'date':
        return 'CURRENT_DATE'
    if t == 'boolean':
        return 'false'
    if t in ('integer', 'bigint', 'smallint', 'real', 'double precision') or t.startswith('numeric'):
        return '0'
    if t in ('text',) or t.startswith('character'):
        return "''"
    if t == 'jsonb':
        return "'{}'::jsonb"
    if t == 'json':
        return "'{}'::json"
    if t == 'uuid':
        return 'gen_random_uuid()'
    return None


class Cluster:
    def __init__(self, keep: bool = False):
        self.keep = keep
        self.dir = Path(tempfile.mkdtemp(prefix='dg-routing-'))
        self.port = 55000 + (os.getpid() % 900)
        self.root = os.geteuid() == 0
        if self.root:
            shutil.chown(self.dir, 'postgres')
            os.chmod(self.dir, 0o755)
        self._as_pg([str(PGBIN / 'initdb'), '-D', str(self.dir / 'data'), '-A', 'trust', '-U', 'postgres',
                     '-E', 'UTF8', '--locale=C'], quiet=True)
        conf = self.dir / 'data' / 'postgresql.conf'
        with open(conf, 'a') as fh:
            fh.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{self.dir}'\nport = {self.port}\n"
                     "shared_preload_libraries = 'pg_cron'\ncron.database_name = 'postgres'\n"
                     "cron.use_background_workers = on\nmax_worker_processes = 16\nfsync = off\n"
                     "full_page_writes = off\nsynchronous_commit = off\n")
        self._as_pg([str(PGBIN / 'pg_ctl'), '-D', str(self.dir / 'data'), '-l', str(self.dir / 'log'), '-w', 'start'],
                    quiet=True)

    # --- process helpers -------------------------------------------------
    def _as_pg(self, args, quiet=False, input_text=None):
        cmd = (['runuser', '-u', 'postgres', '--'] + args) if self.root else args
        res = subprocess.run(cmd, input=input_text, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"{' '.join(args[:2])} failed: {res.stderr[-4000:]}")
        return res.stdout

    def psql(self, sql: str, stop_on_error: bool = True, user: str = 'postgres') -> tuple[str, str]:
        args = [str(PGBIN / 'psql'), '-X', '-h', str(self.dir), '-p', str(self.port), '-U', user, '-d', 'postgres',
                '-v', f"ON_ERROR_STOP={'1' if stop_on_error else '0'}", '-Atq']
        res = subprocess.run(args, input=sql, capture_output=True, text=True)
        if stop_on_error and res.returncode != 0:
            raise RuntimeError(res.stderr[-6000:])
        return res.stdout, res.stderr

    def q(self, sql: str) -> str:
        return self.psql(sql)[0].strip()

    def json(self, sql: str):
        """Chạy câu trả về đúng một giá trị jsonb/json (ví dụ SELECT f(...)) và parse."""
        out = self.q(sql)
        return json.loads(out) if out else None

    def rows(self, sql: str) -> list:
        out = self.q(f"SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb) FROM ({sql}) AS r;")
        return json.loads(out)

    def close(self):
        try:
            self._as_pg([str(PGBIN / 'pg_ctl'), '-D', str(self.dir / 'data'), '-m', 'immediate', '-w', 'stop'], quiet=True)
        finally:
            if not self.keep:
                shutil.rmtree(self.dir, ignore_errors=True)

    # --- schema ---------------------------------------------------------
    def build_schema(self) -> dict:
        read = lambda name: json.loads((SNAP / name).read_text(encoding='utf-8'))
        schema = read('fixture-schema.json')
        constraints = read('fixture-constraints.json')
        functions = read('fixture-public-functions.json') + read('trigger-function-dependencies.json')
        private_functions = schema['private_functions']
        report = {'function_errors': [], 'trigger_errors': [], 'constraint_errors': []}

        pre = ["CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA extensions;",
               "CREATE EXTENSION pgcrypto WITH SCHEMA extensions; CREATE EXTENSION pg_cron;"]
        pre += [f"CREATE ROLE {r};" for r in ROLES]
        pre += ["GRANT USAGE ON SCHEMA public, private, auth, extensions TO anon, authenticated, service_role,"
                " aka_agent_chat_api, aka_agent_desktop, crm_interest_worker;",
                "CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, role text, raw_app_meta_data jsonb);",
                "CREATE TABLE auth.sessions(id uuid PRIMARY KEY, user_id uuid);",
                "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS "
                "$$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;"]
        self.q('\n'.join(pre))

        seq_by_col = {}
        for rel in schema['relations']:
            for c in rel['columns']:
                if c.get('sequence'):
                    seq_by_col[(rel['name'], c['name'])] = c['sequence']
        stmts = []
        for seq in sorted(set(seq_by_col.values())):
            stmts.append(f"CREATE SEQUENCE IF NOT EXISTS {seq};")
        for t in schema['public_tables']:
            cols = []
            for c in t['columns']:
                ctype = c['type']
                if re.match(r'^(?:extensions\.)?vector\(', ctype):
                    ctype = 'text'
                parts = [f'"{c["name"]}"', ctype]
                key = (t['name'], c['name'])
                if key in seq_by_col:
                    parts.append(f"DEFAULT nextval('{seq_by_col[key]}')")
                elif key in COLUMN_DEFAULTS:
                    parts.append('DEFAULT ' + COLUMN_DEFAULTS[key])
                elif c.get('nullable') is False:
                    d = _generic_default(ctype)
                    if d:
                        parts.append('DEFAULT ' + d)
                if c.get('nullable') is False:
                    parts.append('NOT NULL')
                cols.append(' '.join(parts))
            stmts.append(f'CREATE TABLE public."{t["name"]}" ({", ".join(cols)});')
        for t in schema['private_tables']:
            cols = []
            for c in t['columns']:
                parts = [f'"{c["name"]}"', c['type']]
                d = c.get('default')
                simple = d and re.fullmatch(
                    r"(?:now\(\)|clock_timestamp\(\)|gen_random_uuid\(\)|CURRENT_DATE|true|false|-?\d+(?:\.\d+)?"
                    r"|'[^']*'(?:::[\w\s\[\]\"]+)?|\(?'[^']*'::[\w\s\[\]\"]+\)?)", d.strip())
                if simple:
                    parts.append('DEFAULT ' + d)
                elif c.get('nullable') is False and (not d or 'nextval(' not in d):
                    g = _generic_default(c['type'])
                    if g:
                        parts.append('DEFAULT ' + g)
                if d and 'nextval(' in d:
                    parts.append('GENERATED BY DEFAULT AS IDENTITY')
                if c.get('nullable') is False:
                    parts.append('NOT NULL')
                cols.append(' '.join(parts))
            stmts.append(f'CREATE TABLE private."{t["name"]}" ({", ".join(cols)});')
        self.q('\n'.join(stmts))

        # Hàm trước ràng buộc: CHECK có thể gọi hàm.
        fn_sql = 'SET check_function_bodies = off;\n' + '\n'.join(f['definition'] + ';' for f in functions + private_functions)
        _, err = self.psql(fn_sql, stop_on_error=False)
        report['function_errors'] = [l for l in err.splitlines() if 'ERROR' in l]
        # Định nghĩa live 09/11/2026 (đổi sau bản chụp 27/10); bảng phiên Desktop tối thiểu cho hàm phạm vi staff.
        live = json.loads((ROOT / 'migrations/snapshots/group-access-v486/live-functions.json').read_text(encoding='utf-8'))
        self.q("CREATE TABLE IF NOT EXISTS private.aka_agent_desktop_users (auth_user_id uuid PRIMARY KEY, staff_id bigint NOT NULL);")
        self.psql('SET check_function_bodies = off;\n' + '\n'.join(f['definition'] + ';' for f in live['functions']))
        private_functions = [f for f in private_functions if f['signature'] not in {g['signature'] for g in live['functions']}]
        private_functions += live['functions']

        con_sql = '\n'.join(f'ALTER TABLE public."{c["relation"]}" ADD CONSTRAINT "{c["conname"]}" {c["definition"]};'
                            for c in constraints if not c['definition'].startswith('FOREIGN KEY'))
        _, err = self.psql(con_sql, stop_on_error=False)
        report['constraint_errors'] = [l for l in err.splitlines() if 'ERROR' in l]
        self.q('\n'.join(s + ';' for s in UNIQUE_INDEXES))

        trig_sql = '\n'.join(t['definition'] + ';' for t in read('triggers.json'))
        _, err = self.psql(trig_sql, stop_on_error=False)
        report['trigger_errors'] = [l for l in err.splitlines() if 'ERROR' in l]

        # Quyền EXECUTE đúng như production (V483+ kiểm proacl).
        acl = []
        for f in functions + private_functions:
            sig = f['signature'] if f['signature'].startswith(('public.', 'private.')) else 'public.' + f['signature']
            if f.get('acl') is None:
                continue
            acl.append(f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC;")
            for entry in f['acl'].strip('{}').split(','):
                if not entry:
                    continue
                who = entry.split('=')[0]
                if who and who != 'postgres':
                    acl.append(f'GRANT EXECUTE ON FUNCTION {sig} TO "{who}";')
        self.psql('\n'.join(acl), stop_on_error=False)
        # Quyền sau đợt thu hồi V435 (27/10 23:53) và V436: ghi đè quyền chụp trước đó.
        later = json.loads((SNAP / 'post-cutover-state.json').read_text(encoding='utf-8'))['functions']
        later += json.loads((ROOT / 'migrations/snapshots/desktop-data-privacy-v436/plan.json')
                            .read_text(encoding='utf-8'))['dependencyFunctions']
        acl = []
        for f in later:
            sig = f['signature'] if f['signature'].startswith(('public.', 'private.')) else 'public.' + f['signature']
            if f.get('acl') is None:
                continue
            acl.append(f"REVOKE ALL ON FUNCTION {sig} FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop,"
                       " aka_agent_chat_api, crm_interest_worker;")
            if isinstance(f['acl'], list):  # post-cutover: [[grantee, privilege, grantable], ...]
                grantees = [g[0] for g in f['acl'] if g[1] == 'EXECUTE']
            else:
                grantees = [e.split('=')[0] for e in f['acl'].strip('{}').split(',') if e]
            # Production cấp service_role trước (V483 so nguyên văn proacl::text).
            grantees = sorted(grantees, key=lambda g: 0 if g == 'service_role' else 1)
            for who in grantees:
                if who and who != 'postgres':
                    acl.append(f'GRANT EXECUTE ON FUNCTION {sig} TO "{who}";' if who != 'PUBLIC'
                               else f'GRANT EXECUTE ON FUNCTION {sig} TO PUBLIC;')
        _, err = self.psql('\n'.join(acl), stop_on_error=False)
        report['acl_errors'] = [l for l in err.splitlines() if 'ERROR' in l]
        self.q("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;")
        return report

    def apply_file(self, path: Path, prelude: str = ''):
        sql = Path(path).read_text(encoding='utf-8')
        return self.psql(prelude + sql)
