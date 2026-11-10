#!/usr/bin/env python3
"""Sinh migration_v486 / rollback_v486: 3 hàm kiểm quyền đọc nhóm chia sẻ chuyển LANGUAGE sql -> plpgsql.

Vì sao (đo trên Postgres 17 cục bộ, hàm live thật, scripts/data-group-routing/test_v486.py):
mỗi cặp (thành viên, chiến dịch) khi đẩy data nhóm gọi private.group_access 2 lần (lock_read_data_group và
shared_data_member_owner). Hàm SQL có SET search_path + SECURITY DEFINER không được inline nên lập kế hoạch lại
mỗi lần gọi: ~0,48 ms/lần, 52% thời gian đẩy. plpgsql giữ plan trong phiên; group_access thêm
SET plan_cache_mode = force_generic_plan (không thì plpgsql chọn custom plan vì p_kind làm gọn được nhánh UNION,
lại lập kế hoạch mỗi lần). Câu truy vấn giữ nguyên từng chữ; SELECT INTO lấy dòng đầu như hàm SQL trả dòng đầu.

Nguồn định nghĩa cũ: migrations/snapshots/group-access-v486/live-functions.json (chụp live 09/11/2026 bằng
pg_get_functiondef, kiểm checksum). group_access đã khác bản chụp desktop-session-rls 27/10: ownerName che tên chủ nhóm
khi người gọi là phiên Desktop không phải chủ (private.aka_agent_staff_scope_for_request, khớp checksum trong plan V436).
Định nghĩa mới: scripts/data-group-routing/v486_sharing_plpgsql.sql; build kiểm câu truy vấn giữ nguyên từng chữ.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / 'migrations' / 'snapshots' / 'group-access-v486' / 'live-functions.json'
NEW_SQL = ROOT / 'scripts' / 'data-group-routing' / 'v486_sharing_plpgsql.sql'
OUT = ROOT / 'migrations' / 'migration_v486_group_access_plan_cache.sql'
ROLLBACK = ROOT / 'migrations' / 'rollback_v486_group_access_plan_cache.sql'
SIGS = [
    'private.group_access(text,bigint,bigint,bigint)',
    'private.can_read_data_group(bigint,bigint,bigint)',
    'private.shared_data_member_owner(bigint,bigint,bigint,bigint)',
]


def md5(s: str) -> str:
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def main() -> None:
    live = {f['signature']: f for f in json.loads(SNAP.read_text(encoding='utf-8'))['functions']}
    old = {}
    for sig in SIGS:
        text = live[sig]['definition']
        text = text if text.endswith('\n') else text + '\n'
        if md5(text) != live[sig]['checksum']:
            raise SystemExit(f'checksum mismatch {sig}')
        old[sig] = text
    blocks = re.findall(r'(CREATE OR REPLACE FUNCTION .*?\$function\$);', NEW_SQL.read_text(encoding='utf-8'), re.S)
    if len(blocks) != 3:
        raise SystemExit('expected 3 CREATE OR REPLACE blocks')
    new = {}
    for sig, block in zip(SIGS, blocks):
        name = sig.split('(')[0]
        if not block.startswith(f'CREATE OR REPLACE FUNCTION {name}('):
            raise SystemExit(f'order mismatch for {sig}')
        new[sig] = block + '\n'
    # Câu truy vấn giữ nguyên từng chữ: hàm SQL "SELECT ...;" <-> plpgsql "... INTO v_access ...;" / "RETURN ...;".
    def body(text: str) -> str:
        return text.split('AS $function$\n', 1)[1].rsplit('$function$', 1)[0]
    ga = SIGS[0]
    old_q = body(old[ga]).strip()
    new_q = body(new[ga]).split('BEGIN\n', 1)[1].split('  RETURN v_access;', 1)[0].replace('  INTO v_access\n', '', 1).strip()
    if old_q != new_q:
        raise SystemExit('group_access: query text differs from live definition')
    for sig in SIGS[1:]:
        old_e = body(old[sig]).strip()
        new_e = body(new[sig]).split('BEGIN\n', 1)[1].split('\nEND;', 1)[0].strip()
        if not (old_e.startswith('SELECT ') and new_e.startswith('RETURN ') and old_e[7:] == new_e[7:]):
            raise SystemExit(f'{sig}: expression differs from live definition')
    old_md5 = {s: md5(t) for s, t in old.items()}
    new_md5 = {s: md5(t) for s, t in new.items()}

    probe = """CREATE TEMP TABLE v486_probe ON COMMIT DROP AS
WITH data_groups AS (
  SELECT g.id, g.staff_id, g.organization_id
  FROM public.auto_account_contact_groups AS g
  WHERE g.purpose = 'data_group'
  ORDER BY g.updated_at DESC NULLS LAST, g.id DESC
  LIMIT 400
), content_groups AS (
  SELECT g.id, g.staff_id, g.organization_id
  FROM public.auto_content_groups AS g
  ORDER BY g.id DESC
  LIMIT 100
), groups AS (
  SELECT 'data'::text AS kind, * FROM data_groups
  UNION ALL
  SELECT 'content'::text AS kind, * FROM content_groups
), viewers AS (
  -- Chủ nhóm, 2 nhân viên khác cùng tổ chức, tối đa 2 người được chia sẻ riêng, 1 nhân viên tổ chức khác.
  SELECT g.kind, g.id AS group_id, g.staff_id AS owner_id, g.organization_id, g.staff_id AS viewer_id FROM groups AS g
  UNION
  SELECT g.kind, g.id, g.staff_id, g.organization_id, other.id
  FROM groups AS g
  CROSS JOIN LATERAL (
    SELECT staff.id FROM public.org_staff AS staff
    WHERE staff.organization_id = g.organization_id AND staff.id <> g.staff_id
    ORDER BY staff.id LIMIT 2
  ) AS other
  UNION
  SELECT g.kind, g.id, g.staff_id, g.organization_id, recipient.staff_id
  FROM groups AS g
  CROSS JOIN LATERAL (
    SELECT r.staff_id FROM public.auto_data_group_recipients AS r WHERE g.kind = 'data' AND r.group_id = g.id
    UNION ALL
    SELECT r.staff_id FROM public.auto_content_group_recipients AS r WHERE g.kind = 'content' AND r.group_id = g.id
    LIMIT 2
  ) AS recipient
  UNION
  SELECT g.kind, g.id, g.staff_id, g.organization_id, stranger.id
  FROM groups AS g
  CROSS JOIN LATERAL (
    SELECT staff.id FROM public.org_staff AS staff
    WHERE staff.organization_id IS DISTINCT FROM g.organization_id
    ORDER BY staff.id LIMIT 1
  ) AS stranger
)
SELECT v.*,
       private.group_access(v.kind, v.group_id, v.viewer_id, v.organization_id) AS access_before,
       CASE WHEN v.kind = 'data' THEN private.can_read_data_group(v.group_id, v.viewer_id, v.organization_id) END AS read_before,
       CASE WHEN v.kind = 'data'
         THEN private.shared_data_member_owner(v.group_id, v.owner_id, v.viewer_id, v.organization_id) END AS owner_before
FROM viewers AS v;
"""

    sql = f"""-- V486: tăng tốc kiểm quyền đọc nhóm chia sẻ (đường đẩy data nhóm vào chiến dịch và mọi RPC đọc nhóm).
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v486-sql.py, đừng sửa tay. Độc lập V484.
--
-- private.group_access / private.can_read_data_group / private.shared_data_member_owner: LANGUAGE sql -> plpgsql, câu
-- truy vấn giữ nguyên từng chữ, giữ STABLE + SECURITY DEFINER + search_path + quyền. group_access thêm
-- SET plan_cache_mode = force_generic_plan. Hàm SQL có SET không được inline nên lập kế hoạch lại mỗi lần gọi
-- (~0,48 ms); mỗi cặp (thành viên, chiến dịch) khi đẩy data gọi 2 lần = 52% thời gian đẩy (đo cục bộ, hàm live thật).
-- Sau V486: 0,05 ms/lần, đẩy nhanh ~2,4 lần (1,86 -> 0,77 ms/cặp cục bộ).
--
-- Tự đối chiếu trên dữ liệu thật trong cùng giao dịch: trước khi thay, tính kết quả của 3 hàm cho tối đa 500 nhóm
-- (400 nhóm data mới nhất + 100 nhóm nội dung) x (chủ nhóm, 2 nhân viên khác cùng tổ chức, tối đa 2 người được chia sẻ,
-- 1 nhân viên tổ chức khác); sau khi thay tính lại, lệch một dòng là huỷ cả giao dịch.
-- Preflight kiểm md5 pg_get_functiondef chụp live 09/11/2026 (group_access đã che tên chủ nhóm cho phiên Desktop).
-- Rollback: migrations/rollback_v486_group_access_plan_cache.sql. Kiểm thử: python3 scripts/data-group-routing/test_v486.py
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v486_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{json.dumps(old_md5)}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v486: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 = ('{json.dumps(new_md5)}'::jsonb ->> v_item.sig) THEN
      RAISE EXCEPTION 'v486: already applied (%)', v_item.sig;
    END IF;
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v486: % drifted (md5 %, expected %); re-read live definition', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
END
$v486_preflight$;

CREATE TEMP TABLE v486_acl ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner, p.prosecdef,
       p.provolatile
FROM pg_proc AS p
WHERE p.oid IN ({', '.join(f"to_regprocedure('{s}')" for s in SIGS)});

{probe}
""" + '\n'.join(new[s].rstrip() + ';\n' for s in SIGS) + f"""
DO $v486_postflight$
DECLARE
  v_item record;
  v_md5 text;
  v_bad bigint;
  v_total bigint;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{json.dumps(new_md5)}'::jsonb) LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v486: % not as expected after apply (md5 %)', v_item.sig, v_md5;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM v486_acl AS before JOIN pg_proc AS p ON p.oid = to_regprocedure(before.sig)
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner
       OR p.prosecdef IS DISTINCT FROM before.prosecdef OR p.provolatile IS DISTINCT FROM before.provolatile
  ) THEN
    RAISE EXCEPTION 'v486: privileges/owner/volatility changed';
  END IF;
  SELECT count(*) FILTER (WHERE
           private.group_access(probe.kind, probe.group_id, probe.viewer_id, probe.organization_id)
             IS DISTINCT FROM probe.access_before
           OR (probe.kind = 'data' AND (
             private.can_read_data_group(probe.group_id, probe.viewer_id, probe.organization_id)
               IS DISTINCT FROM probe.read_before
             OR private.shared_data_member_owner(probe.group_id, probe.owner_id, probe.viewer_id, probe.organization_id)
               IS DISTINCT FROM probe.owner_before))),
         count(*)
  INTO v_bad, v_total
  FROM v486_probe AS probe;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'v486: % of % probe(s) changed result; rolled back', v_bad, v_total;
  END IF;
  RAISE NOTICE 'v486: % probe(s) identical before/after', v_total;
END
$v486_postflight$;

COMMIT;
"""
    OUT.write_text(sql, encoding='utf-8')

    restore = []
    for n, sig in enumerate(SIGS, 1):
        tag = f'$v486_rb_{n}$'
        restore.append(f"""DO $v486_rb_block_{n}$
DECLARE
  v_md5 text := md5(pg_get_functiondef(to_regprocedure('{sig}')));
BEGIN
  IF v_md5 = '{new_md5[sig]}' THEN
    EXECUTE {tag}{old[sig].rstrip()}{tag};
  ELSIF v_md5 IS DISTINCT FROM '{old_md5[sig]}' THEN
    RAISE EXCEPTION 'v486 rollback: % changed outside V486 (md5 %)', '{sig}', v_md5;
  END IF;
END
$v486_rb_block_{n}$;
""")
    rb = """-- Rollback V486: trả 3 hàm kiểm quyền nhóm chia sẻ về nguyên văn LANGUAGE sql trước V486 (quyền giữ nguyên vì
-- CREATE OR REPLACE). Hàm đã cũ thì bỏ qua; khác cả bản cũ lẫn bản V486 thì dừng. Sinh bằng scripts/build-v486-sql.py.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

""" + '\n'.join(restore) + f"""
DO $v486_rb_postflight$
DECLARE
  v_item record;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{json.dumps(old_md5)}'::jsonb) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(v_item.sig))) IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v486 rollback: % not restored', v_item.sig;
    END IF;
  END LOOP;
END
$v486_rb_postflight$;

COMMIT;
"""
    ROLLBACK.write_text(rb, encoding='utf-8')
    for path in (OUT, ROLLBACK):
        text = path.read_text(encoding='utf-8')
        print(f'{path.name}: {len(text.encode())} bytes, md5 {md5(text)}')
    print(json.dumps({s: {'old': old_md5[s], 'new': new_md5[s]} for s in SIGS}, indent=2))


if __name__ == '__main__':
    main()
