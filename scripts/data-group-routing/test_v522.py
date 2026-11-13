#!/usr/bin/env python3
"""V522: Desktop gọi hàm đọc "đã có trong nhóm / ở nhóm khác" (V519) bằng token Desktop.

Chạy trên PostgreSQL dựng tạm rồi xoá (fixture của thư mục này: bản chụp production + V483/V484/V485, hàm nạp thật);
không đọc thông tin kết nối của ứng dụng, không chạm DB thật.

    PGBIN=/usr/lib/postgresql/16/bin python3 scripts/data-group-routing/test_v522.py

Kiểm: preflight từ chối khi hàm V519 khác bản đã apply; trước V522 token Desktop bị từ chối; sau V522 token Desktop
trả đúng JSON như service_role; chặn token của nhân viên khác, sai mật khẩu, thiếu mật khẩu, sai tổ chức, nhóm của
người khác, token không gắn nhân viên; anon/authenticated vẫn bị chặn; không ghi gì; apply lại bị từ chối; rollback
chỉ thu quyền Desktop.
Hợp đồng: docs/DATA_GROUP_MEMBER_MATCHES_DESKTOP_V522.md.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed as S  # noqa: E402
import test_v485 as V  # noqa: E402

V519 = ROOT / 'migrations' / 'migration_v519_data_group_member_matches.sql'
V522 = ROOT / 'migrations' / 'migration_v522_data_group_member_matches_desktop.sql'
R522 = ROOT / 'migrations' / 'rollback_v522_data_group_member_matches_desktop.sql'
PASTE = ROOT / 'migrations' / 'tests' / 'migration_v522_data_group_member_matches_desktop_paste.sql'
LEDGER_NAME = 'migration_v522_data_group_member_matches_desktop'
SIGNATURE = 'public.aka_agent_read_data_group_member_matches(bigint,bigint,text,text,jsonb)'
PROSRC_MD5 = '0fffb42b865b8be45bf5a7f2f4e2db17'
OTHER_STAFF = 725
OTHER_ORG = 702
G_FREE, G_OTHER, G_FOREIGN = 3201, 3202, 3203
SUB_STAFF = '00000000-0000-4000-8000-000000000724'
SUB_OTHER = '00000000-0000-4000-8000-000000000725'
SUB_UNBOUND = '00000000-0000-4000-8000-000000000999'

# Chuỗi xác thực token Desktop của production (cùng bản với fixture của WebApp
# scripts/test-fixtures/campaign-input-duplicates-schema.sql, dùng cho V493). Bản chụp 27/10 của fixture này cũ hơn:
# chưa có bước gắn token Desktop với p_staff_id.
PRODUCTION_IDENTITY = r"""
CREATE OR REPLACE FUNCTION private.aka_agent_assert_request_ownership(p_staff_id bigint, p_account_id bigint, p_campaign_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request();
BEGIN
 IF v_staff IS NULL THEN RETURN true; END IF;
 IF v_staff <= 0 OR (p_staff_id IS NOT NULL AND p_staff_id IS DISTINCT FROM v_staff) THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='desktop_staff_scope_denied';
 END IF;
 RETURN true;
END;
$$;
CREATE OR REPLACE FUNCTION public.auto_assert_automation_identity(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_claim_role text;
  v_claims jsonb;
BEGIN
  PERFORM private.aka_agent_assert_request_ownership(p_staff_id, NULL, NULL);
  v_claim_role := NULLIF(current_setting('request.jwt.claim.role', true), '');
  IF v_claim_role IS NULL THEN
    BEGIN
      v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
      v_claim_role := NULLIF(v_claims ->> 'role', '');
    EXCEPTION WHEN OTHERS THEN v_claim_role := NULL;
    END;
  END IF;
  IF v_claim_role IS NULL THEN v_claim_role := NULLIF(auth.jwt() ->> 'role', ''); END IF;
  IF v_claim_role = 'service_role' THEN RETURN; END IF;
  IF p_auth_username IS NULL OR p_auth_password IS NULL THEN RAISE EXCEPTION 'automation_auth_required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_staff AS staff WHERE staff.id = p_staff_id AND staff.organization_id = p_organization_id
      AND staff.is_active = true AND staff.username = p_auth_username AND staff.password = p_auth_password) THEN
    RAISE EXCEPTION 'automation_auth_invalid';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) TO aka_agent_desktop, service_role;
"""

passed = 0


def ok(condition: bool, message: str, detail=None) -> None:
    global passed
    if not condition:
        raise SystemExit(f'FAIL - {message}' + (f'\n  {json.dumps(detail, ensure_ascii=False, default=str)}' if detail is not None else ''))
    passed += 1
    print(f'ok {passed} - {message}')


def lit(value) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def ingest(c, request_id: str, group: int, rows: list[str], *, staff=S.STAFF) -> dict:
    """Đưa SĐT vào nhóm bằng đúng hàm nạp thật, như API Web gọi (service_role, một lần)."""
    payload = [{
        'contact_id': None, 'source_account_id': None, 'relationship_kind': None, 'contact_type': 'phone',
        'flatform_type': 'zalo', 'name': None, 'uid': None, 'url': None, 'phone': phone, 'email': None,
        'info1': None, 'info2': None, 'info3': None, 'info4': None, 'info5': None, 'extra_data': {},
    } for phone in rows]
    return c.json(
        f"SET ROLE service_role; SELECT public.aka_agent_ingest_data_group(p_staff_id => {staff}, "
        f"p_organization_id => {S.ORG}, p_request_id => {lit(request_id)}, p_group_id => {group}, "
        f"p_kind => 'manual', p_rows => {S.sql_json(payload)}, p_dataset_id => NULL, p_dataset_name => NULL, "
        f"p_import_source => 'textbox', p_source_account_id => NULL, p_source_name => NULL, p_payload_hash => NULL, "
        f"p_data_type_category_item_id => {S.TYPE_PHONE});")


QUERY = {'groupId': G_FREE, 'contactType': 'phone', 'otherGroups': 'all',
         'values': ['0912000001', '+84 912 000 002', '0912000003', '0912000099']}


def call(role: str, *, sub: str | None = None, staff=S.STAFF, org=S.ORG, username=None, password=None, query=None) -> str:
    """Một lượt gọi như PostgREST: vai trò của kết nối + claim của token."""
    claims = {'role': role, **({'sub': sub} if sub else {})}
    prefix = f"SET request.jwt.claims = '{json.dumps(claims)}'; SET ROLE {role}; " if role != 'none' else ''
    return (f"{prefix}SELECT public.aka_agent_read_data_group_member_matches({staff}, {org}, {lit(username)}, "
            f"{lit(password)}, {S.sql_json(query or QUERY)});")


def desktop(**kw) -> str:
    kw.setdefault('sub', SUB_STAFF)
    kw.setdefault('username', 'staff724')
    kw.setdefault('password', 'pw724')
    return call('aka_agent_desktop', **kw)


def acl(c) -> str:
    return c.q("SELECT array_to_string(array_agg(g ORDER BY g), ',') FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 "
               "THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g FROM pg_proc p, aclexplode(p.proacl) a "
               f"WHERE p.oid = to_regprocedure('{SIGNATURE}')) x")


def shape(c) -> str:
    return c.q("SELECT md5(prosrc) || '|' || array_to_string(proconfig, ';') || '|' || prosecdef::text || provolatile::text "
               f"FROM pg_proc WHERE oid = to_regprocedure('{SIGNATURE}')")


def counts(c) -> str:
    return c.q("SELECT (SELECT count(*) FROM public.auto_account_contacts) || '/' || "
               "(SELECT count(*) FROM public.auto_account_contact_group_members) || '/' || "
               "(SELECT count(*) FROM public.auto_account_contact_groups) || '/' || "
               "(SELECT count(*) FROM public.auto_data_ingest_batches)")


def without_time(value: dict) -> dict:
    return {key: item for key, item in value.items() if key != 'checkedAt'}


def main() -> None:
    for path in (V519, V522, R522):
        if not path.is_file():
            raise SystemExit(f'Not found: {path}')
    migration, rollback = V522.read_text(encoding='utf-8'), R522.read_text(encoding='utf-8')
    c = V.new_cluster()
    try:
        c.q("SET session_replication_role = replica;\n"
            f"INSERT INTO public.org_organization (id, name) VALUES ({OTHER_ORG}, 'Tổ chức khác');\n"
            f"UPDATE public.org_staff SET password = 'pw' || id WHERE id IN ({S.STAFF}, {OTHER_STAFF});\n"
            "INSERT INTO public.auto_account_contact_groups (id, staff_id, organization_id, name, purpose, is_delete, "
            "data_type_category_item_id, bound_zalo_account_id, revision) VALUES "
            f"({G_FREE}, {S.STAFF}, {S.ORG}, 'Khách tháng 11', 'data_group', false, {S.TYPE_PHONE}, NULL, 0), "
            f"({G_OTHER}, {S.STAFF}, {S.ORG}, 'Khách đã mua', 'data_group', false, {S.TYPE_PHONE}, NULL, 0), "
            f"({G_FOREIGN}, {OTHER_STAFF}, {S.ORG}, 'Nhóm của nhân viên khác', 'data_group', false, {S.TYPE_PHONE}, NULL, 0);\n"
            "INSERT INTO private.aka_agent_desktop_users (auth_user_id, staff_id) VALUES "
            f"('{SUB_STAFF}', {S.STAFF}), ('{SUB_OTHER}', {OTHER_STAFF});")
        c.q(PRODUCTION_IDENTITY)
        # Production có hai index này (đọc pg_indexes 13/11/2026); fixture chỉ dựng index mà đường nạp cần.
        c.q("CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_account_contacts_account_type_uid ON public.auto_account_contacts "
            "USING btree (account_id, contact_type, uid);"
            "CREATE INDEX IF NOT EXISTS idx_auto_account_contact_group_members_contact ON public.auto_account_contact_group_members "
            "USING btree (contact_id);")

        error = V.err_of(c, migration)
        ok('v522_v519_reader_missing' in error, 'chưa có hàm V519 thì V522 dừng', error)
        c.q(V519.read_text(encoding='utf-8'))
        ok(acl(c) == 'postgres,service_role', 'V519: chỉ postgres và service_role', acl(c))
        ok(shape(c) == f'{PROSRC_MD5}|search_path=pg_catalog, public;statement_timeout=15s|trues',
           'thân hàm cục bộ = bản production (md5 prosrc 0fffb42b…), SECURITY DEFINER, STABLE, 15 giây', shape(c))

        ingest(c, 'seed-free', G_FREE, ['0912000001', '0912000002'])
        ingest(c, 'seed-other', G_OTHER, ['0912000002', '0912000003'])
        ingest(c, 'seed-foreign', G_FOREIGN, ['0912000099'], staff=OTHER_STAFF)
        before = counts(c)

        # Preflight: hàm V519 bị đổi thuộc tính hoặc quyền thì dừng, không cấp quyền.
        c.q(f"ALTER FUNCTION {SIGNATURE} SET statement_timeout = '60s';")
        error = V.err_of(c, migration)
        ok('v522_reader_attributes_unexpected' in error, 'preflight dừng khi trần thời gian của hàm khác 15 giây', error)
        c.q(f"ALTER FUNCTION {SIGNATURE} SET statement_timeout = '15s';")
        c.q(f"GRANT EXECUTE ON FUNCTION {SIGNATURE} TO anon;")
        error = V.err_of(c, migration)
        ok('v522_reader_acl_unexpected' in error, 'preflight dừng khi quyền của hàm khác bản V519', error)
        c.q(f"REVOKE EXECUTE ON FUNCTION {SIGNATURE} FROM anon;")
        ok(acl(c) == 'postgres,service_role', 'preflight dừng thì quyền không đổi', acl(c))

        error = V.err_of(c, desktop())
        ok('permission denied for function' in error, 'trước V522: token Desktop bị từ chối (permission denied for function)', error)

        c.q(migration)
        ok(acl(c) == 'aka_agent_desktop,postgres,service_role', 'V522 apply: thêm đúng aka_agent_desktop', acl(c))
        ok(shape(c) == f'{PROSRC_MD5}|search_path=pg_catalog, public;statement_timeout=15s|trues',
           'thân hàm và thuộc tính giữ nguyên sau V522', shape(c))

        service = c.json(call('service_role'))
        by_desktop = c.json(desktop())
        ok(without_time(by_desktop) == without_time(service), 'token Desktop trả đúng JSON như service_role', by_desktop)
        items = {item['index']: item for item in by_desktop['items']}
        ok(sorted(items) == [0, 1, 2] and items[0]['inGroup'] and items[1]['inGroup'] and not items[2]['inGroup'],
           'đúng dòng đã có: 2 số trong nhóm này (kể cả viết +84), 1 số chỉ ở nhóm khác, số của nhân viên khác không tính', by_desktop)
        ok(items[1]['otherGroupCount'] == 1 and items[2]['otherGroup']['id'] == G_OTHER and by_desktop['valueCount'] == 4,
           'nhóm khác: đúng số nhóm, đúng nhóm gần nhất, đủ số giá trị đã hỏi', by_desktop)

        cases = [
            ('token Desktop của nhân viên khác', desktop(staff=OTHER_STAFF, username='staff725', password='pw725'), 'desktop_staff_scope_denied'),
            ('sai mật khẩu tự động hóa', desktop(password='sai'), 'automation_auth_invalid'),
            ('thiếu mật khẩu tự động hóa', desktop(username=None, password=None), 'automation_auth_required'),
            ('sai tổ chức', desktop(org=OTHER_ORG), 'automation_auth_invalid'),
            ('nhóm của nhân viên khác', desktop(query={**QUERY, 'groupId': G_FOREIGN}), 'data_group_matches_group_denied'),
            ('token Desktop không gắn nhân viên', desktop(sub=SUB_UNBOUND), 'desktop_staff_scope_denied'),
            ('anon', call('anon', username='staff724', password='pw724'), 'permission denied for function'),
            ('authenticated', call('authenticated', username='staff724', password='pw724'), 'permission denied for function'),
        ]
        for label, sql, marker in cases:
            error = V.err_of(c, sql)
            ok(marker in error, f'bị chặn: {label} ({marker})', error)
        other = c.json(call('aka_agent_desktop', sub=SUB_OTHER, staff=OTHER_STAFF, username='staff725', password='pw725',
                            query={**QUERY, 'groupId': G_FOREIGN}))
        ok([item['index'] for item in other['items']] == [3], 'nhân viên khác chỉ thấy khách của chính mình', other)
        ok(counts(c) == before, 'hàm không ghi gì (số liên hệ/thành viên/nhóm/lượt nạp không đổi)', counts(c))

        error = V.err_of(c, migration)
        ok('v522_already_applied_do_not_reapply' in error, 'apply lại V522 bị từ chối', error)

        c.q(rollback)
        ok(acl(c) == 'postgres,service_role', 'rollback: về đúng postgres, service_role', acl(c))
        error = V.err_of(c, desktop())
        ok('permission denied for function' in error, 'sau rollback: token Desktop bị từ chối', error)
        ok(without_time(c.json(call('service_role'))) == without_time(service), 'sau rollback: service_role (API Web) vẫn chạy như cũ')
        c.q(migration)
        ok(acl(c) == 'aka_agent_desktop,postgres,service_role' and without_time(c.json(desktop())) == without_time(service),
           'apply lại sau rollback: Desktop gọi được như trước')

        # Bản dán SQL Editor (scripts/build-v522-paste-sql.py): tự ghi sổ migration, chặn dán lại và dán thiếu.
        import hashlib
        import subprocess
        built = subprocess.run([sys.executable, str(ROOT / 'scripts' / 'build-v522-paste-sql.py')], capture_output=True, text=True)
        paste = PASTE.read_text(encoding='utf-8')
        file_md5 = hashlib.md5(migration.encode('utf-8')).hexdigest()
        ok(built.returncode == 0 and file_md5 in paste and paste.count(migration) == 1,
           'bản dán khớp file migration hiện tại (sinh lại không đổi, nội dung một lần)', built.stdout + built.stderr)
        c.q(rollback)
        c.q("CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n"
            "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], "
            "name text, created_by text, idempotency_key text, rollback text[]);\n"
            "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261113141849', 'migration_v521_renewal_link_tickets') "
            "ON CONFLICT DO NOTHING;")
        ledger = lambda: c.q(f"SELECT count(*) || '/' || coalesce(max(md5(statements[1])), '') || '/' || coalesce(max(version), '') "
                             f"FROM supabase_migrations.schema_migrations WHERE name = '{LEDGER_NAME}'")
        broken = paste.replace('v522_reader_body_unexpected', 'v522_reader_body_unexpecte', 1)
        error = V.err_of(c, broken)
        ok('Nội dung dán bị thiếu hoặc sai' in error and acl(c) == 'postgres,service_role' and ledger().startswith('0/'),
           'bản dán thiếu một ký tự: dừng, chưa đổi quyền, chưa ghi sổ', error)
        c.q(paste.replace('\n', '\r\n'))
        row = ledger().split('/')
        ok(acl(c) == 'aka_agent_desktop,postgres,service_role' and row[0] == '1' and row[1] == file_md5 and row[2] > '20261113141849',
           'bản dán (xuống dòng kiểu Windows): cấp quyền, ghi sổ một dòng, md5 sổ = file, version sau V521', row)
        ok(without_time(c.json(desktop())) == without_time(service), 'sau bản dán: token Desktop gọi được hàm')
        error = V.err_of(c, paste)
        ok('đã có trong sổ migration' in error and ledger().startswith('1/') and acl(c) == 'aka_agent_desktop,postgres,service_role',
           'dán lại lần hai: bị từ chối, không đổi gì', error)
        c.q(f"DELETE FROM supabase_migrations.schema_migrations WHERE name = '{LEDGER_NAME}'")
        error = V.err_of(c, paste)
        ok('v522_already_applied_do_not_reapply' in error and ledger().startswith('0/'),
           'đã cấp quyền mà sổ chưa có dòng: preflight của migration vẫn chặn, không ghi sổ', error)
        print(f'V522 data group member matches (Desktop) checks passed: {passed}')
    finally:
        c.close()


if __name__ == '__main__':
    main()
