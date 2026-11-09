#!/usr/bin/env python3
"""Sinh migration_v484 / rollback_v484 (đẩy data nhóm vào chiến dịch chạy nền) từ định nghĩa live đã chụp.

Nguồn định nghĩa live (kiểm md5 pg_get_functiondef với checksum đã chụp trước khi dùng):
- migrations/snapshots/desktop-session-rls/fixture-public-functions.json, trigger-function-dependencies.json,
  fixture-schema.json (private_functions) — chụp 27/10/2026; các hàm này không migration nào sửa sau đó
  (ngoại trừ V483 chỉ sửa 2 wrapper Desktop, không nằm trong danh sách vá).
- migrations/migration_v483_data_group_ingest_budget_guard.sql cho private.aka_agent_assert_data_group_ingest_budget.

Mỗi chỗ vá là thay chuỗi nguyên văn, kiểm đúng số lần xuất hiện; thân còn lại giữ từng byte. Ở chế độ 'sync'
(mặc định) mọi hàm chạy đúng như cũ: các vòng đẩy cũ nằm nguyên trong nhánh ELSE.

Dùng: python3 scripts/build-v484-sql.py   (ghi đè 2 file migration/rollback)
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAP = ROOT / 'migrations' / 'snapshots' / 'desktop-session-rls'
V483 = ROOT / 'migrations' / 'migration_v483_data_group_ingest_budget_guard.sql'
MIG = ROOT / 'migrations'
NAME = 'v484_data_group_async_routing'

API_ROLES = 'anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api'


def md5(s: str) -> str:
    return hashlib.md5(s.encode('utf-8')).hexdigest()


def load_live() -> dict[str, dict]:
    funcs = {}
    for name in ('fixture-public-functions.json', 'trigger-function-dependencies.json'):
        for f in json.loads((SNAP / name).read_text(encoding='utf-8')):
            sig = f['signature'] if f['signature'].startswith(('public.', 'private.')) else 'public.' + f['signature']
            funcs[sig] = f
    for f in json.loads((SNAP / 'fixture-schema.json').read_text(encoding='utf-8'))['private_functions']:
        funcs[f['signature']] = f
    return funcs


def functiondef(live: dict, sig: str) -> tuple[str, str]:
    """(định nghĩa có '\\n' cuối như pg_get_functiondef, checksum đã chụp)."""
    f = live[sig]
    text = f['definition']
    if not text.endswith('\n'):
        text += '\n'
    if md5(text) != f['checksum']:
        raise SystemExit(f'checksum mismatch for {sig}')
    return text, f['checksum']


def patch(text: str, old: str, new: str, count: int = 1) -> str:
    n = text.count(old)
    if n != count:
        raise SystemExit(f'expected {count} occurrence(s), found {n}: {old[:120]!r}')
    return text.replace(old, new)


def prosrc(defn: str) -> str:
    start = defn.index('AS $function$') + len('AS $function$')
    end = defn.rindex('$function$')
    return defn[start:end]


# ---------------------------------------------------------------------------------------------------------------
# Các chỗ vá hàm live
# ---------------------------------------------------------------------------------------------------------------
DEFER_MEMBER = 'private.aka_agent_defer_data_group_member_route'
DEFER_BASELINE = 'private.aka_agent_defer_data_group_baseline_route'


def patch_ingest(t: str) -> str:
    t = patch(t, "  v_outcome jsonb;\n  v_result jsonb;\nBEGIN\n",
              "  v_outcome jsonb;\n  v_result jsonb;\n  v_route_job_id bigint;\nBEGIN\n")
    t = patch(t,
              "    FOR v_source IN\n      SELECT source.id\n      FROM public.auto_campaign_data_group_sources AS source\n"
              "      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')\n",
              "    -- V484: chế độ 'async' của tổ chức ghi thành viên vào hàng đợi đẩy; 'sync' giữ nguyên vòng cũ.\n"
              f"    v_route_job_id := {DEFER_MEMBER}(\n      v_group.id, v_member.id, v_batch.id, v_revision\n    );\n"
              "    IF v_route_job_id IS NULL THEN\n"
              "    FOR v_source IN\n      SELECT source.id\n      FROM public.auto_campaign_data_group_sources AS source\n"
              "      WHERE source.group_id = v_group.id AND source.status IN ('baselining', 'active')\n")
    t = patch(t,
              "        ELSE NULL;\n      END CASE;\n    END LOOP;\n  END LOOP;\n",
              "        ELSE NULL;\n      END CASE;\n    END LOOP;\n    END IF;\n  END LOOP;\n")
    t = patch(t,
              "  UPDATE public.auto_data_ingest_batches\n  SET status = 'completed', result = v_result, updated_at = now()\n"
              "  WHERE id = v_batch.id;\n  RETURN v_result;\n",
              "  IF v_route_job_id IS NOT NULL THEN\n"
              "    v_result := v_result || jsonb_build_object('routing_status', 'queued', 'routing_job_id', v_route_job_id);\n"
              "  END IF;\n"
              "  UPDATE public.auto_data_ingest_batches\n  SET status = 'completed', result = v_result, updated_at = now()\n"
              "  WHERE id = v_batch.id;\n  RETURN v_result;\n")
    return t


def patch_bind(t: str) -> str:
    t = patch(t,
              "    v_snapshot := public.aka_agent_internal_route_group_snapshot(\n"
              "      v_source.id, v_batch.id, v_group.revision\n    );\n",
              f"    IF {DEFER_BASELINE}(v_source.id, v_batch.id, v_group.revision, true) IS NOT NULL THEN\n"
              "      v_snapshot := jsonb_build_object('routing_status', 'queued'); -- V484: đẩy cả nhóm chạy nền\n"
              "    ELSE\n"
              "    v_snapshot := public.aka_agent_internal_route_group_snapshot(\n"
              "      v_source.id, v_batch.id, v_group.revision\n    );\n"
              "    END IF;\n")
    t = patch(t,
              "    v_snapshot := public.aka_agent_internal_route_group_snapshot(\n"
              "      v_bundle_source.id, v_batch.id, v_group.revision\n    );\n\n"
              "    IF COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)\n",
              f"    IF {DEFER_BASELINE}(v_bundle_source.id, v_batch.id, v_group.revision, true) IS NOT NULL THEN\n"
              "      v_snapshot := jsonb_build_object('routing_status', 'queued'); -- V484: đẩy cả nhóm chạy nền\n"
              "    ELSE\n"
              "    v_snapshot := public.aka_agent_internal_route_group_snapshot(\n"
              "      v_bundle_source.id, v_batch.id, v_group.revision\n    );\n"
              "    END IF;\n\n"
              "    IF NOT (v_snapshot ? 'routing_status')\n"
              "       AND COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)\n")
    t = patch(t,
              "CASE\n          WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)\n"
              "             + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0\n"
              "            THEN 'Chờ data phù hợp'\n",
              "CASE\n          WHEN v_snapshot ? 'routing_status' THEN campaign.note\n"
              "          WHEN COALESCE((v_snapshot ->> 'inserted_input_count')::integer, 0)\n"
              "             + COALESCE((v_snapshot ->> 'already_seen_input_count')::integer, 0) = 0\n"
              "            THEN 'Chờ data phù hợp'\n", count=2)
    return t


def patch_reactivate(t: str) -> str:
    return patch(t,
                 "  PERFORM public.aka_agent_internal_route_group_snapshot(\n"
                 "    v_source.id, v_batch.id, v_group.revision\n  );\n",
                 f"  IF {DEFER_BASELINE}(v_source.id, v_batch.id, v_group.revision, false) IS NULL THEN\n"
                 "  PERFORM public.aka_agent_internal_route_group_snapshot(\n"
                 "    v_source.id, v_batch.id, v_group.revision\n  );\n"
                 "  END IF;\n")


def patch_move(t: str) -> str:
    old = ("      FOR v_bound_source IN\n"
           "        SELECT source.id FROM public.auto_campaign_data_group_sources AS source\n"
           "        WHERE source.group_id = v_target_group.id AND source.status IN ('baselining', 'active')\n"
           "        ORDER BY source.campaign_id\n      LOOP\n"
           "        PERFORM public.aka_agent_internal_route_data_group_member(\n"
           "          v_bound_source.id, v_target_member.id, v_batch.id, v_target_group.revision\n"
           "        );\n      END LOOP;\n")
    return patch(t, old,
                 f"      IF {DEFER_MEMBER}(\n"
                 "        v_target_group.id, v_target_member.id, v_batch.id, v_target_group.revision\n"
                 "      ) IS NULL THEN\n" + old + "      END IF;\n")


def patch_sync_dataset(t: str) -> str:
    old = ("      FOR v_source IN\n        SELECT source.id\n        FROM public.auto_campaign_data_group_sources AS source\n"
           "        WHERE source.group_id = v_group.id\n          AND source.status IN ('baselining', 'active')\n"
           "        ORDER BY source.campaign_id, source.id\n      LOOP\n"
           "        PERFORM public.aka_agent_internal_route_data_group_member(\n"
           "          v_source.id,\n          v_member.id,\n          NULL,\n          v_revision\n        );\n"
           "      END LOOP;\n")
    return patch(t, old,
                 f"      IF {DEFER_MEMBER}(v_group.id, v_member.id, NULL, v_revision) IS NULL THEN\n"
                 + old + "      END IF;\n")


def patch_sync_scan(t: str) -> str:
    old = ("          FOR v_source IN\n            SELECT source.id\n"
           "            FROM public.auto_campaign_data_group_sources AS source\n"
           "            WHERE source.group_id = v_member.group_id\n"
           "              AND source.status IN ('baselining', 'active')\n            ORDER BY source.campaign_id\n"
           "          LOOP\n            PERFORM public.aka_agent_internal_route_data_group_member(\n"
           "              v_source.id, v_member.id, NULL, v_revision\n            );\n          END LOOP;\n")
    return patch(t, old,
                 f"          IF {DEFER_MEMBER}(v_member.group_id, v_member.id, NULL, v_revision) IS NULL THEN\n"
                 + old + "          END IF;\n")


def patch_copy(t: str) -> str:
    old = ("      FOR v_result IN SELECT public.aka_agent_internal_route_data_group_member(s.id,v_member_id,NULL,v_revision)\n"
           "        FROM public.auto_campaign_data_group_sources s WHERE s.group_id=v_target_id AND s.status IN ('active','baselining') ORDER BY s.campaign_id\n"
           "      LOOP NULL; END LOOP;\n")
    return patch(t, old,
                 f"      IF {DEFER_MEMBER}(v_target_id,v_member_id,NULL,v_revision) IS NULL THEN\n"
                 + old + "      END IF;\n")


def guard_definitions() -> tuple[str, str]:
    """(định nghĩa V483 dạng CREATE OR REPLACE, bản vá V484)."""
    src = V483.read_text(encoding='utf-8')
    start = src.index('CREATE FUNCTION private.aka_agent_assert_data_group_ingest_budget(')
    end = src.index('$function$;', start) + len('$function$;')
    old = 'CREATE OR REPLACE' + src[start + len('CREATE'):end]
    new = patch(old,
                "     AND source.organization_id = p_organization_id;\n",
                "     AND source.organization_id = p_organization_id;\n"
                "  -- V484: tổ chức chạy chế độ 'async' chỉ ghi thành viên trong lượt nạp, việc đẩy vào chiến dịch chạy nền.\n"
                "  IF private.aka_agent_data_group_route_async(p_organization_id) THEN\n"
                "    v_campaigns := 0;\n  END IF;\n")
    return old, new


TARGETS = [
    ('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)', patch_ingest),
    ('public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)', patch_bind),
    ('public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)', patch_reactivate),
    ('public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)', patch_move),
    ('public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)', patch_sync_dataset),
    ('public.aka_agent_sync_scan_dataset_group_origins()', patch_sync_scan),
    ('private.copy_shared_group(bigint,bigint,text,bigint,jsonb)', patch_copy),
]
GUARD_SIG = 'private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)'

NEW_FUNCTIONS = [
    'private.aka_agent_data_group_routing_settings()',
    'private.aka_agent_data_group_route_async(bigint)',
    'private.aka_agent_defer_data_group_member_route(bigint,bigint,bigint,bigint)',
    'private.aka_agent_defer_data_group_baseline_route(bigint,bigint,bigint,boolean)',
    'private.aka_agent_finish_data_group_route_job(bigint)',
    'private.aka_agent_route_data_group_job_slice(bigint,timestamp with time zone)',
    'private.aka_agent_run_data_group_route_worker(integer)',
]

NEW_OBJECTS_SQL = (ROOT / 'scripts' / 'data-group-routing' / 'v484_objects.sql')



P2_SIGS = TARGETS[:2]          # nạp nhóm + gắn chiến dịch (hai hàm lớn nhất)
P3_SIGS = TARGETS[2:]          # còn lại + guard + cron


HEADER = """-- V484 phần {part}/3: đẩy data nhóm vào chiến dịch chạy nền (hàng đợi + worker pg_cron), bật theo tổ chức.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v484-sql.py, đừng sửa tay.
-- Apply đúng thứ tự p1 -> p2 -> p3, mỗi phần một giao dịch (cả bộ ~135 KB vượt sức một lần gửi của công cụ apply).
-- Phần sau kiểm phần trước đã xong và từ chối chạy lại. Giữa các phần hệ thống vẫn chạy như cũ (công tắc 'sync').
-- Rollback: rollback_v484_data_group_async_routing_p1.sql rồi _p2.sql (chạy được cả khi mới apply một phần).
-- Hợp đồng, cách bật/tắt: docs/DATA_GROUP_ASYNC_ROUTING_V484.md. Kiểm thử: python3 scripts/data-group-routing/test_v484.py
"""

P1_DOC = """--
-- Vì sao: lượt nạp nhóm data đẩy từng dòng vào từng chiến dịch đang bật "nhận data mới từ nhóm" trong giao dịch của
-- người dùng (trần 60 giây) và giữ khoá advisory + FOR UPDATE của mọi chiến dịch đó tới hết giao dịch.
--
-- Cả bộ V484:
--   p1 bảng private.auto_data_group_route_jobs (+ _job_members, RLS bật, không cấp role API), dòng
--      auto_system_settings 'data_groups.routing_mode' = {"mode":"sync","organizationIds":[],"workerBudgetMs":4000},
--      7 hàm private (đọc công tắc, ghi việc, worker). Chưa hàm cũ nào gọi tới.
--   p2 vá nạp nhóm (aka_agent_ingest_data_group_v186_internal) và gắn chiến dịch (bind, cả bundle).
--   p3 vá bật lại công tắc, chuyển data, 2 hàm đồng bộ nhóm tự động, sao chép nhóm chia sẻ, guard V483; lên lịch
--      pg_cron 'aka-agent-data-group-route-worker' 10 giây/lần; kiểm tra cuối toàn bộ.
-- Mỗi chỗ vá chỉ thêm nhánh: tổ chức ở 'async' thì ghi thành viên (hoặc cả nhóm cho bind/reactivate) vào hàng đợi thay
-- vì gọi aka_agent_internal_route_data_group_member ngay; vòng cũ giữ nguyên từng byte trong nhánh còn lại.
-- Worker: một runner, mỗi lượt <= workerBudgetMs (mặc định 4 s) và <= 32 đoạn; mỗi đoạn = 1 chiến dịch x <= 100
-- thành viên, gọi đúng hàm đẩy hiện có; chiến dịch đang chạy/chờ xử lý trước, tạm dừng sau; xoay vòng giữa các việc;
-- lock_timeout 2 s; khoá bận/deadlock thử lại sau 5 s, lỗi khác thu nhỏ đoạn rồi bỏ đúng một cặp sau 3 lần.
--
-- Preflight kiểm md5 pg_get_functiondef của 7 hàm (chụp live 27/10/2026, không migration nào sửa sau đó) và md5 thân
-- guard V483; lệch là dừng. Apply SAU V483, ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema).
-- Bật thử: UPDATE public.auto_system_settings SET value = '{"mode":"async","organizationIds":[<org>],"workerBudgetMs":4000}',
--   updated_at = now() WHERE key = 'data_groups.routing_mode';  Tắt nhanh (không DDL): đặt lại "mode":"sync".
"""


def guarded_restore(sig: str, new_md5: str, old_md5: str, old_def: str, n: int) -> str:
    """Khối DO trả hàm về nguyên văn cũ nếu đang ở bản V484; đã cũ thì bỏ qua; khác cả hai thì dừng."""
    tag = f'$v484_rb_{n}$'
    if tag in old_def:
        raise SystemExit('tag collision')
    return f"""DO $v484_rb_block_{n}$
DECLARE
  v_md5 text := md5(pg_get_functiondef(to_regprocedure('{sig}')));
BEGIN
  IF v_md5 = '{new_md5}' THEN
    EXECUTE {tag}{old_def.rstrip()}{tag};
  ELSIF v_md5 IS DISTINCT FROM '{old_md5}' THEN
    RAISE EXCEPTION 'v484 rollback: % changed outside V484 (md5 %); re-read live definition', '{sig}', v_md5;
  END IF;
END
$v484_rb_block_{n}$;
"""


def build() -> None:
    live = load_live()
    rows = []
    for sig, fn in TARGETS:
        old, checksum = functiondef(live, sig)
        new = fn(old)
        rows.append({'signature': sig, 'old': old, 'new': new, 'old_md5': checksum, 'new_md5': md5(new)})
    by_sig = {r['signature']: r for r in rows}
    g_old, g_new = guard_definitions()
    guard_old_md5, guard_new_md5 = md5(prosrc(g_old)), md5(prosrc(g_new))
    objects = NEW_OBJECTS_SQL.read_text(encoding='utf-8')
    old_all = {r['signature']: r['old_md5'] for r in rows}
    new_all = {r['signature']: r['new_md5'] for r in rows}
    p2 = [by_sig[s] for s, _ in P2_SIGS]
    p3 = [by_sig[s] for s, _ in P3_SIGS]
    roles_check = """  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      FOREACH v_sig IN ARRAY ARRAY[%s] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
          RAISE EXCEPTION 'v484: %% executable by %%', v_sig, v_role;
        END IF;
      END LOOP;
      IF has_table_privilege(v_role, 'private.auto_data_group_route_jobs', 'SELECT')
         OR has_table_privilege(v_role, 'private.auto_data_group_route_job_members', 'SELECT') THEN
        RAISE EXCEPTION 'v484: route tables readable by %%', v_role;
      END IF;
    END IF;
  END LOOP;
""" % ', '.join("'" + s + "'" for s in NEW_FUNCTIONS)

    def md5_check(expected: dict, label: str, what: str) -> str:
        return f"""  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{json.dumps(expected)}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v484 {label}: % {what} (md5 %, expected %)', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
"""

    def acl_capture(items: list[dict], extra: str = '') -> str:
        oids = ', '.join(f"to_regprocedure('{r['signature']}')" for r in items) + extra
        return f"""CREATE TEMP TABLE v484_acl ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, p.proconfig::text AS config,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p
WHERE p.oid IN ({oids});
"""

    acl_post = """  IF EXISTS (
    SELECT 1 FROM v484_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure(before.sig)
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v484: privileges/config of a patched function changed';
  END IF;
"""

    # ------------------------------------------------------------------ p1
    p1 = HEADER.format(part=1) + P1_DOC + f"""
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v484_p1_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_route_jobs') IS NOT NULL
     OR to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'v484: already applied (p1 objects exist)';
  END IF;
  IF to_regprocedure('{GUARD_SIG}') IS NULL THEN
    RAISE EXCEPTION 'v484: apply V483 first (private.aka_agent_assert_data_group_ingest_budget missing)';
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('{GUARD_SIG}');
  IF v_md5 IS DISTINCT FROM '{guard_old_md5}' THEN
    RAISE EXCEPTION 'v484: V483 guard drifted (prosrc md5 %); re-read live definition', v_md5;
  END IF;
{md5_check(old_all, 'preflight', 'drifted; re-read live definition')}  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'data_groups.routing_mode') THEN
    RAISE EXCEPTION 'v484: auto_system_settings data_groups.routing_mode already exists';
  END IF;
  IF to_regnamespace('cron') IS NULL THEN
    RAISE EXCEPTION 'v484: pg_cron missing';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v484: cron job aka-agent-data-group-route-worker already exists';
  END IF;
END
$v484_p1_preflight$;

{objects.rstrip()}

DO $v484_p1_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[{', '.join("'" + s + "'" for s in NEW_FUNCTIONS)}] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing after p1', v_sig;
    END IF;
  END LOOP;
{roles_check}  IF private.aka_agent_data_group_route_async(-1) THEN
    RAISE EXCEPTION 'v484: async must be off after apply';
  END IF;
END
$v484_p1_postflight$;

COMMIT;
"""

    # ------------------------------------------------------------------ p2
    p2_old = {r['signature']: r['old_md5'] for r in p2}
    p2_new = {r['signature']: r['new_md5'] for r in p2}
    p2_sql = HEADER.format(part=2) + f"""--
-- p2: vá nạp nhóm và gắn chiến dịch (cả bundle) để gọi hàng đợi khi tổ chức ở 'async'.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v484_p2_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  IF to_regprocedure('private.aka_agent_run_data_group_route_worker(integer)') IS NULL
     OR to_regclass('private.auto_data_group_route_jobs') IS NULL THEN
    RAISE EXCEPTION 'v484 p2: apply p1 first';
  END IF;
{md5_check(p2_old, 'p2 preflight', 'already patched or drifted')}END
$v484_p2_preflight$;

{acl_capture(p2)}
""" + '\n'.join(f"-- {r['signature']}: md5 {r['old_md5']} -> {r['new_md5']}\n{r['new'].rstrip()};\n" for r in p2) + f"""
DO $v484_p2_postflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
{md5_check(p2_new, 'p2 postflight', 'not as expected after apply')}{acl_post}END
$v484_p2_postflight$;

COMMIT;
"""

    # ------------------------------------------------------------------ p3
    p3_old = {r['signature']: r['old_md5'] for r in p3}
    p3_sql = HEADER.format(part=3) + f"""--
-- p3: vá bật lại công tắc, chuyển data, đồng bộ nhóm tự động (2 hàm), sao chép nhóm chia sẻ, guard V483; lên lịch worker;
-- kiểm tra cuối cả bộ V484.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v484_p3_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
{md5_check(p2_new, 'p3 preflight', 'p2 not applied')}{md5_check(p3_old, 'p3 preflight', 'already patched or drifted')}  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('{GUARD_SIG}');
  IF v_md5 IS DISTINCT FROM '{guard_old_md5}' THEN
    RAISE EXCEPTION 'v484 p3: V483 guard drifted or already patched (prosrc md5 %)', v_md5;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v484 p3: cron job already exists';
  END IF;
END
$v484_p3_preflight$;

{acl_capture(p3, f", to_regprocedure('{GUARD_SIG}')")}
""" + '\n'.join(f"-- {r['signature']}: md5 {r['old_md5']} -> {r['new_md5']}\n{r['new'].rstrip()};\n" for r in p3) + f"""
-- {GUARD_SIG}: prosrc md5 {guard_old_md5} -> {guard_new_md5}
{g_new}

SELECT cron.schedule(
  'aka-agent-data-group-route-worker',
  '10 seconds',
  'SELECT private.aka_agent_run_data_group_route_worker();'
);

DO $v484_p3_postflight$
DECLARE
  v_item record;
  v_md5 text;
  v_role text;
  v_sig text;
BEGIN
{md5_check(new_all, 'final postflight', 'not as expected after apply')}  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('{GUARD_SIG}');
  IF v_md5 IS DISTINCT FROM '{guard_new_md5}' THEN
    RAISE EXCEPTION 'v484: guard not as expected after apply (prosrc md5 %)', v_md5;
  END IF;
{acl_post}{roles_check}  IF (SELECT value FROM public.auto_system_settings WHERE key = 'data_groups.routing_mode')::jsonb ->> 'mode'
     IS DISTINCT FROM 'sync' THEN
    RAISE EXCEPTION 'v484: routing mode must start as sync';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker'
                   AND schedule = '10 seconds' AND command = 'SELECT private.aka_agent_run_data_group_route_worker();'
                   AND active) THEN
    RAISE EXCEPTION 'v484: cron job missing';
  END IF;
END
$v484_p3_postflight$;

COMMIT;
"""

    # ------------------------------------------------------------------ rollback
    rb_head = """-- Rollback V484 phần {part}/2. Chạy p1 rồi p2; chạy được cả khi V484 mới apply một phần (hàm nào đang ở bản V484 thì trả
-- về nguyên văn cũ, đã cũ thì bỏ qua, khác cả hai thì dừng). Sinh bằng scripts/build-v484-sql.py.
-- Điều kiện: hàng đợi rỗng. Trước đó đặt data_groups.routing_mode về {{"mode":"sync"}} rồi chờ worker chạy nốt (hoặc gọi
-- SELECT private.aka_agent_run_data_group_route_worker(20000); đến khi hết việc pending/running).
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';
"""
    pending_check = """DO $v484_rb_pending$
DECLARE
  v_pending bigint;
BEGIN
  IF to_regclass('private.auto_data_group_route_jobs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private.auto_data_group_route_jobs WHERE status IN (''pending'', ''running'')'
      INTO v_pending;
    IF v_pending > 0 THEN
      RAISE EXCEPTION 'v484 rollback: % route job(s) still pending; set routing mode to sync and drain first', v_pending;
    END IF;
  END IF;
END
$v484_rb_pending$;
"""
    n = 0
    blocks1 = []
    for r in p3:
        n += 1
        blocks1.append(guarded_restore(r['signature'], r['new_md5'], r['old_md5'], r['old'], n))
    n += 1
    guard_block = f"""DO $v484_rb_block_{n}$
DECLARE
  v_md5 text := (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('{GUARD_SIG}'));
BEGIN
  IF v_md5 = '{guard_new_md5}' THEN
    EXECUTE $v484_rb_{n}${g_old.rstrip().rstrip(';')}$v484_rb_{n}$;
  ELSIF v_md5 IS DISTINCT FROM '{guard_old_md5}' THEN
    RAISE EXCEPTION 'v484 rollback: guard changed outside V484 (prosrc md5 %)', v_md5;
  END IF;
END
$v484_rb_block_{n}$;
"""
    rb1 = rb_head.format(part=1) + '\n' + pending_check + """
DO $v484_rb_cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    PERFORM cron.unschedule('aka-agent-data-group-route-worker');
  END IF;
END
$v484_rb_cron$;

""" + '\n'.join(blocks1) + '\n' + guard_block + '\nCOMMIT;\n'
    blocks2 = []
    for r in p2:
        n += 1
        blocks2.append(guarded_restore(r['signature'], r['new_md5'], r['old_md5'], r['old'], n))
    rb2 = rb_head.format(part=2) + '\n' + pending_check + '\n' + '\n'.join(blocks2) + f"""
DO $v484_rb_p1_done$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  -- Mọi hàm đã về bản cũ (rollback p1 phải chạy trước) thì mới gỡ hàm/bảng mà chúng từng gọi.
{md5_check(old_all, 'rollback', 'not restored; run rollback p1 first')}  IF (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('{GUARD_SIG}')) IS DISTINCT FROM '{guard_old_md5}' THEN
    RAISE EXCEPTION 'v484 rollback: guard not restored; run rollback p1 first';
  END IF;
  IF to_regnamespace('cron') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v484 rollback: cron job still scheduled; run rollback p1 first';
  END IF;
END
$v484_rb_p1_done$;

DROP FUNCTION IF EXISTS private.aka_agent_run_data_group_route_worker(integer);
DROP FUNCTION IF EXISTS private.aka_agent_route_data_group_job_slice(bigint, timestamp with time zone);
DROP FUNCTION IF EXISTS private.aka_agent_finish_data_group_route_job(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_defer_data_group_baseline_route(bigint, bigint, bigint, boolean);
DROP FUNCTION IF EXISTS private.aka_agent_defer_data_group_member_route(bigint, bigint, bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_data_group_route_async(bigint);
DROP FUNCTION IF EXISTS private.aka_agent_data_group_routing_settings();
DROP TABLE IF EXISTS private.auto_data_group_route_job_members;
DROP TABLE IF EXISTS private.auto_data_group_route_jobs;
DELETE FROM public.auto_system_settings WHERE key = 'data_groups.routing_mode';

COMMIT;
"""
    files = {
        f'migration_{NAME}_p1.sql': p1, f'migration_{NAME}_p2.sql': p2_sql, f'migration_{NAME}_p3.sql': p3_sql,
        f'rollback_{NAME}_p1.sql': rb1, f'rollback_{NAME}_p2.sql': rb2,
    }
    for old in MIG.glob(f'*{NAME}*.sql'):
        if old.name not in files:
            old.unlink()
    for name, text in files.items():
        (MIG / name).write_text(text, encoding='utf-8')
        print(f'{name}: {len(text.encode("utf-8"))} bytes, md5 {md5(text)}')
    summary = {r['signature']: {'old': r['old_md5'], 'new': r['new_md5']} for r in rows}
    summary[GUARD_SIG] = {'old_prosrc': guard_old_md5, 'new_prosrc': guard_new_md5}
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    build()
