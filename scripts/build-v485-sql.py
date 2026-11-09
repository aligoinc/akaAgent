#!/usr/bin/env python3
"""Sinh migration_v485 / rollback_v485 (nhập file vào nhóm data theo nhiều phần) từ định nghĩa V484.

Nguồn:
- Hàm nạp lõi bản V484 = định nghĩa live đã chụp (kiểm checksum) + đúng các chỗ vá của scripts/build-v484-sql.py.
- private.aka_agent_run_data_group_route_worker bản V484 = nguyên văn trong scripts/data-group-routing/v484_objects.sql
  (prosrc của hàm tạo bằng CREATE FUNCTION giữ nguyên từng byte của thân).
- Đối tượng mới: scripts/data-group-routing/v485_objects.sql.

Mỗi chỗ vá là thay chuỗi nguyên văn, kiểm đúng số lần xuất hiện. Khi không có phiên nhập nhiều phần (GUC
aka_agent.upload_session_id rỗng) hàm nạp chạy đúng như V484, trừ một UPDATE đánh dấu phiên mở cùng dataset là bị thay.

Dùng: python3 scripts/build-v485-sql.py   (ghi đè migration p1/p2 và rollback)
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / 'migrations'
NAME = 'v485_data_group_upload_sessions'
OBJECTS = ROOT / 'scripts' / 'data-group-routing' / 'v485_objects.sql'
V484_OBJECTS = ROOT / 'scripts' / 'data-group-routing' / 'v484_objects.sql'

_spec = importlib.util.spec_from_file_location('build_v484', ROOT / 'scripts' / 'build-v484-sql.py')
B4 = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(B4)
md5, patch, prosrc = B4.md5, B4.patch, B4.prosrc

INGEST_SIG = 'public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)'
WORKER_SIG = 'private.aka_agent_run_data_group_route_worker(integer)'
GUARD_SIG = B4.GUARD_SIG

NEW_FUNCTIONS = [
    'private.aka_agent_data_group_upload_session_json(uuid)',
    'private.aka_agent_data_group_upload_part_totals(uuid)',
    'public.aka_agent_begin_data_group_upload(bigint,bigint,text,bigint,text,text,bigint,text,bigint,jsonb,integer)',
    'public.aka_agent_append_data_group_upload(bigint,bigint,uuid,integer,jsonb,text)',
    'public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)',
    'public.aka_agent_begin_data_group_upload(bigint,bigint,text,bigint,text,text,bigint,text,bigint,jsonb,integer,text,text)',
    'public.aka_agent_append_data_group_upload(bigint,bigint,uuid,integer,jsonb,text,text,text)',
    'public.aka_agent_finish_data_group_upload(bigint,bigint,uuid,text,text)',
]
CORE = NEW_FUNCTIONS[2:5]
DESKTOP = NEW_FUNCTIONS[5:]
PRIVATE = NEW_FUNCTIONS[:2]


# ---------------------------------------------------------------------------------------------------------------
# Vá hàm nạp lõi (bản V484)
# ---------------------------------------------------------------------------------------------------------------
def patch_ingest_v485(t: str) -> str:
    t = patch(t, "  v_route_job_id bigint;\nBEGIN\n",
              "  v_route_job_id bigint;\n"
              "  -- V485: phần của một phiên nhập file nhiều phần (aka_agent_append_data_group_upload đặt 2 GUC này).\n"
              "  v_upload_session_id uuid := NULLIF(current_setting('aka_agent.upload_session_id', true), '')::uuid;\n"
              "  v_upload_row_offset integer := COALESCE(\n"
              "    NULLIF(current_setting('aka_agent.upload_row_offset', true), '')::integer, 0\n  );\n"
              "  v_upload_part_batches bigint[] := '{}'::bigint[];\nBEGIN\n")
    t = patch(t, "  p_source_account_id := COALESCE(p_source_account_id,v_group.bound_zalo_account_id);\n",
              "  IF v_upload_session_id IS NOT NULL THEN\n"
              "    IF p_kind <> 'upload' OR p_dataset_id IS NULL THEN\n"
              "      RAISE EXCEPTION 'invalid_data_group_ingest_payload';\n    END IF;\n"
              "    SELECT COALESCE(array_agg(part.batch_id), '{}'::bigint[]) INTO v_upload_part_batches\n"
              "    FROM private.auto_data_group_upload_session_parts AS part\n"
              "    WHERE part.session_id = v_upload_session_id;\n  END IF;\n\n"
              "  p_source_account_id := COALESCE(p_source_account_id,v_group.bound_zalo_account_id);\n")
    # Phần của phiên không đặt lại dataset: việc đó dồn vào finish.
    t = patch(t, "    IF p_kind = 'upload' THEN\n      UPDATE public.auto_account_contacts_dataset_members\n",
              "    IF p_kind = 'upload' AND v_upload_session_id IS NULL THEN\n"
              "      UPDATE public.auto_account_contacts_dataset_members\n")
    t = patch(t, "  FOR v_row IN\n    SELECT item.value AS payload, item.ordinality::integer AS row_index\n",
              "  -- V485: lượt nhập file một lần thay phiên nhập nhiều phần đang mở của cùng dataset.\n"
              "  IF p_kind = 'upload' AND v_upload_session_id IS NULL AND v_dataset.id IS NOT NULL THEN\n"
              "    UPDATE private.auto_data_group_upload_sessions\n"
              "    SET status = 'superseded', updated_at = now()\n"
              "    WHERE dataset_id = v_dataset.id AND status = 'open';\n  END IF;\n\n"
              "  FOR v_row IN\n    SELECT item.value AS payload, item.ordinality::integer AS row_index\n")
    # Vị trí dòng theo cả file (phần bắt đầu ở v_upload_row_offset).
    t = patch(t, "'rowIndex', v_row.row_index - 1,\n", "'rowIndex', v_row.row_index - 1 + v_upload_row_offset,\n",
              count=2)
    t = patch(t, "v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0), true,\n",
              "v_dataset.id, v_contact.id, GREATEST(v_row.row_index - 1, 0) + v_upload_row_offset, true,\n")
    # Dòng trùng với một phần trước của cùng phiên: như trùng trong một lượt, không thêm origin thứ hai.
    t = patch(t,
              "    INSERT INTO public.auto_account_contact_group_member_origins (\n"
              "      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,\n",
              "    IF v_upload_session_id IS NULL OR NOT v_member_found OR NOT EXISTS (\n"
              "      SELECT 1 FROM public.auto_account_contact_group_member_origins AS session_origin\n"
              "      WHERE session_origin.membership_id = v_member.id\n"
              "        AND session_origin.dataset_id = v_dataset.id\n"
              "        AND session_origin.is_current = true\n"
              "        AND session_origin.batch_id = ANY(v_upload_part_batches)\n"
              "    ) THEN\n"
              "    INSERT INTO public.auto_account_contact_group_member_origins (\n"
              "      membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,\n")
    t = patch(t, "    ON CONFLICT DO NOTHING;\n", "    ON CONFLICT DO NOTHING;\n    END IF;\n")
    # Phần của phiên không gỡ thành viên, không đếm lại dataset: finish làm một lần cho cả file.
    t = patch(t,
              "  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id THEN\n"
              "    SELECT count(*)::integer INTO v_removed_members\n",
              "  IF v_dataset.id IS NOT NULL AND v_dataset.source = 'upload' AND v_dataset.group_id = v_group.id\n"
              "     AND v_upload_session_id IS NULL THEN\n"
              "    SELECT count(*)::integer INTO v_removed_members\n")
    return t


# ---------------------------------------------------------------------------------------------------------------
# Vá worker V484: cộng lại lượt tổng của phiên đã chốt còn phần chờ đẩy (SKIP LOCKED, không chờ khoá phiên)
# ---------------------------------------------------------------------------------------------------------------
def worker_definitions() -> tuple[str, str]:
    src = V484_OBJECTS.read_text(encoding='utf-8')
    start = src.index('CREATE FUNCTION private.aka_agent_run_data_group_route_worker(')
    end = src.index('$function$;', src.index('AS $function$', start)) + len('$function$;')
    old = 'CREATE OR REPLACE' + src[start + len('CREATE'):end]
    new = patch(old,
                "  v_cleaned integer := 0;\nBEGIN\n",
                "  v_cleaned integer := 0;\n  v_session record;\n  v_totals jsonb;\n  v_summary jsonb;\n"
                "  v_summaries integer := 0;\nBEGIN\n")
    new = patch(new,
                "  WITH old AS (\n    SELECT job.id\n",
                "  -- V485: phiên nhập file đã chốt mà còn phần chờ đẩy: cộng lại lượt tổng của phiên (lượt nạp '<mã>:finish').\n"
                "  -- SKIP LOCKED: phiên đang được ghi thì để lượt sau, không chờ khoá.\n"
                "  FOR v_session IN\n"
                "    SELECT session.id, session.summary_batch_id\n"
                "    FROM private.auto_data_group_upload_sessions AS session\n"
                "    WHERE session.routing_pending\n"
                "    ORDER BY session.finished_at, session.id\n"
                "    LIMIT 20\n"
                "    FOR UPDATE SKIP LOCKED\n"
                "  LOOP\n"
                "    v_totals := private.aka_agent_data_group_upload_part_totals(v_session.id);\n"
                "    UPDATE private.auto_data_group_upload_sessions AS session\n"
                "    SET result = session.result || v_totals,\n"
                "        routing_pending = (v_totals ->> 'routing_status') IS NOT DISTINCT FROM 'queued',\n"
                "        updated_at = clock_timestamp()\n"
                "    WHERE session.id = v_session.id\n"
                "    RETURNING session.result INTO v_summary;\n"
                "    UPDATE public.auto_data_ingest_batches\n"
                "    SET result = v_summary, updated_at = now()\n"
                "    WHERE id = v_session.summary_batch_id;\n"
                "    v_summaries := v_summaries + 1;\n"
                "  END LOOP;\n\n"
                "  WITH old AS (\n    SELECT job.id\n")
    new = patch(new,
                "'status', 'ok', 'slices', v_slices, 'pairs', v_pairs, 'errors', v_errors, 'cleaned', v_cleaned,\n",
                "'status', 'ok', 'slices', v_slices, 'pairs', v_pairs, 'errors', v_errors, 'cleaned', v_cleaned,\n"
                "    'upload_summaries', v_summaries,\n")
    return old, new


HEADER = """-- V485 phần {part}/2: nhập file vào nhóm data theo nhiều phần (begin -> append x N -> finish), bỏ trần 10.000 dòng.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v485-sql.py, đừng sửa tay.
-- Apply SAU V483 và đủ 3 phần V484; đúng thứ tự p1 -> p2, mỗi phần một giao dịch. Phần sau kiểm phần trước và từ chối
-- chạy lại. Giữa hai phần app cũ chạy như cũ (hàm nạp chưa đổi; RPC phiên chưa dùng được vì hàm nạp chưa hiểu phiên).
-- Rollback: rollback_v485_data_group_upload_sessions.sql (chạy được cả khi mới apply p1).
-- Hợp đồng: docs/DATA_GROUP_ASYNC_ROUTING_V484.md mục V485. Kiểm thử: python3 scripts/data-group-routing/test_v485.py
"""

P1_DOC = """--
-- Vì sao: kiểu 'upload' là ảnh chụp cả file (đầu lượt đặt lại dataset, cuối lượt gỡ thành viên không còn trong file),
-- nên không chia lô được, và mỗi lần gọi tối đa 10.000 dòng trong trần 60 giây (~8 ms/dòng => ~7.000 dòng là hết giờ).
--
-- Cả bộ V485:
--   p1 bảng private.auto_data_group_upload_sessions (+ _parts), RLS bật, không cấp role API; 2 hàm private; RPC lõi
--      begin/append/finish (service_role) và 3 lối vào Desktop có xác thực (service_role, aka_agent_desktop; append
--      gọi guard V483 với kiểu 'manual'); vá worker V484: cuối mỗi lượt cộng lại lượt tổng của phiên đã chốt còn phần
--      chờ đẩy (SKIP LOCKED, không chờ khoá phiên).
--   p2 vá hàm nạp lõi: khi GUC aka_agent.upload_session_id có giá trị (chỉ append đặt) thì không đặt lại dataset, không
--      gỡ thành viên, cộng vị trí phần vào thứ tự dòng/rowIndex, dòng trùng với phần trước không thêm origin thứ hai;
--      lượt nhập file một lần đánh dấu phiên đang mở cùng dataset là bị thay.
-- finish: kiểm đủ phần liên tục [0, total), đặt lại dòng/origin của dataset không thuộc phiên, gỡ thành viên như cuối
-- lượt một lần, đếm lại dataset, ghi một lượt nạp tổng '<request>:finish' (lượt "gần nhất" của nhóm).
-- Preflight kiểm md5 hàm nạp bản V484 và thân worker V484. Apply ngoài giờ cao điểm (DDL làm PostgREST nạp lại schema).
"""


def build() -> None:
    live = B4.load_live()
    live_def, live_md5 = B4.functiondef(live, INGEST_SIG)
    v484_ingest = B4.patch_ingest(live_def)
    v485_ingest = patch_ingest_v485(v484_ingest)
    ingest_v484_md5, ingest_v485_md5 = md5(v484_ingest), md5(v485_ingest)
    if ingest_v484_md5 != '0a0c9d1f870df7eac69ceaa20f6fb10a':
        raise SystemExit(f'V484 ingest md5 changed: {ingest_v484_md5}')
    worker_old, worker_new = worker_definitions()
    worker_old_md5, worker_new_md5 = md5(prosrc(worker_old)), md5(prosrc(worker_new))
    objects = OBJECTS.read_text(encoding='utf-8')
    quoted = lambda sigs: ', '.join("'" + s + "'" for s in sigs)  # noqa: E731

    acl_post_checks = f"""  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      FOREACH v_sig IN ARRAY ARRAY[{quoted(PRIVATE)}] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
          RAISE EXCEPTION 'v485: % executable by %', v_sig, v_role;
        END IF;
      END LOOP;
      FOREACH v_sig IN ARRAY ARRAY[{quoted(CORE)}] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') IS DISTINCT FROM (v_role = 'service_role') THEN
          RAISE EXCEPTION 'v485: % EXECUTE for % not as expected', v_sig, v_role;
        END IF;
      END LOOP;
      FOREACH v_sig IN ARRAY ARRAY[{quoted(DESKTOP)}] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE')
           IS DISTINCT FROM (v_role IN ('service_role', 'aka_agent_desktop')) THEN
          RAISE EXCEPTION 'v485: % EXECUTE for % not as expected', v_sig, v_role;
        END IF;
      END LOOP;
      IF has_table_privilege(v_role, 'private.auto_data_group_upload_sessions', 'SELECT')
         OR has_table_privilege(v_role, 'private.auto_data_group_upload_session_parts', 'SELECT') THEN
        RAISE EXCEPTION 'v485: upload session tables readable by %', v_role;
      END IF;
    END IF;
  END LOOP;
  IF has_function_privilege('public', '{WORKER_SIG}', 'EXECUTE') THEN
    RAISE EXCEPTION 'v485: route worker executable by PUBLIC';
  END IF;
"""

    # ------------------------------------------------------------------ p1
    p1 = HEADER.format(part=1) + P1_DOC + f"""
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v485_p1_preflight$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_upload_sessions') IS NOT NULL
     OR to_regprocedure('public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'v485: already applied (p1 objects exist)';
  END IF;
  IF to_regprocedure('{GUARD_SIG}') IS NULL THEN
    RAISE EXCEPTION 'v485: apply V483 first (guard missing)';
  END IF;
  IF to_regclass('private.auto_data_group_route_jobs') IS NULL
     OR NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v485: apply V484 p1-p3 first';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('{INGEST_SIG}')));
  IF v_md5 IS DISTINCT FROM '{ingest_v484_md5}' THEN
    RAISE EXCEPTION 'v485: ingest function is not the V484 version (md5 %); re-read live definition', v_md5;
  END IF;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('{WORKER_SIG}');
  IF v_md5 IS DISTINCT FROM '{worker_old_md5}' THEN
    RAISE EXCEPTION 'v485: V484 route worker drifted (prosrc md5 %)', v_md5;
  END IF;
END
$v485_p1_preflight$;

CREATE TEMP TABLE v485_worker_acl ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS config, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p WHERE p.oid = to_regprocedure('{WORKER_SIG}');

{objects.rstrip()}

-- {WORKER_SIG}: prosrc md5 {worker_old_md5} -> {worker_new_md5}
{worker_new}

DO $v485_p1_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[{quoted(NEW_FUNCTIONS)}] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'v485: % missing after p1', v_sig;
    END IF;
  END LOOP;
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('{WORKER_SIG}'))
     IS DISTINCT FROM '{worker_new_md5}' THEN
    RAISE EXCEPTION 'v485: route worker not as expected after p1';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v485_worker_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure('{WORKER_SIG}')
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v485: privileges/config of the route worker changed';
  END IF;
{acl_post_checks}END
$v485_p1_postflight$;

COMMIT;
"""

    # ------------------------------------------------------------------ p2
    p2 = HEADER.format(part=2) + f"""--
-- p2: vá hàm nạp lõi để hiểu phiên nhập nhiều phần; kiểm tra cuối cả bộ V485.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v485_p2_preflight$
DECLARE
  v_md5 text;
BEGIN
  IF to_regclass('private.auto_data_group_upload_session_parts') IS NULL
     OR to_regprocedure('public.aka_agent_finish_data_group_upload(bigint,bigint,uuid)') IS NULL THEN
    RAISE EXCEPTION 'v485 p2: apply p1 first';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('{INGEST_SIG}')));
  IF v_md5 IS DISTINCT FROM '{ingest_v484_md5}' THEN
    RAISE EXCEPTION 'v485 p2: ingest function already patched or drifted (md5 %)', v_md5;
  END IF;
END
$v485_p2_preflight$;

CREATE TEMP TABLE v485_ingest_acl ON COMMIT DROP AS
SELECT p.proacl::text AS acl, p.proconfig::text AS config, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p WHERE p.oid = to_regprocedure('{INGEST_SIG}');

-- {INGEST_SIG}: md5 {ingest_v484_md5} -> {ingest_v485_md5}
{v485_ingest.rstrip()};

DO $v485_p2_postflight$
DECLARE
  v_role text;
  v_sig text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('{INGEST_SIG}'))) IS DISTINCT FROM '{ingest_v485_md5}' THEN
    RAISE EXCEPTION 'v485: ingest function not as expected after p2';
  END IF;
  IF EXISTS (
    SELECT 1 FROM v485_ingest_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure('{INGEST_SIG}')
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v485: privileges/config of the ingest function changed';
  END IF;
  IF (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('{WORKER_SIG}'))
     IS DISTINCT FROM '{worker_new_md5}' THEN
    RAISE EXCEPTION 'v485: route worker not as expected';
  END IF;
{acl_post_checks}END
$v485_p2_postflight$;

COMMIT;
"""

    # ------------------------------------------------------------------ rollback
    rb = f"""-- Rollback V485 (nhập file nhiều phần). Sinh bằng scripts/build-v485-sql.py. Chạy được cả khi mới apply p1.
-- Trả hàm nạp lõi và worker V484 về đúng bản V484 (khác cả bản V484 lẫn V485 thì dừng), rồi gỡ bảng/hàm V485.
-- Lượt tổng của phiên đã chốt mà worker chưa kịp cộng lại giữ số lúc chốt (routing_status 'queued').
-- Điều kiện: không còn phiên đang mở chưa hết hạn (chờ app nhập xong, hoặc đặt status = 'expired' cho phiên bỏ dở:
-- dòng các phần đã nhận vẫn còn trong nhóm, chỉ không gỡ thành viên cũ). Dữ liệu đã chốt không đổi.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v485_rb_open$
DECLARE
  v_open bigint;
BEGIN
  IF to_regclass('private.auto_data_group_upload_sessions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private.auto_data_group_upload_sessions WHERE status = ''open'' AND expires_at > now()'
      INTO v_open;
    IF v_open > 0 THEN
      RAISE EXCEPTION 'v485 rollback: % upload session(s) still open; wait or mark them expired first', v_open;
    END IF;
  END IF;
END
$v485_rb_open$;

DO $v485_rb_ingest$
DECLARE
  v_md5 text := md5(pg_get_functiondef(to_regprocedure('{INGEST_SIG}')));
BEGIN
  IF v_md5 = '{ingest_v485_md5}' THEN
    EXECUTE $v485_rb_1${v484_ingest.rstrip()}$v485_rb_1$;
  ELSIF v_md5 IS DISTINCT FROM '{ingest_v484_md5}' THEN
    RAISE EXCEPTION 'v485 rollback: ingest function changed outside V485 (md5 %)', v_md5;
  END IF;
END
$v485_rb_ingest$;

DO $v485_rb_worker$
DECLARE
  v_md5 text := (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('{WORKER_SIG}'));
BEGIN
  IF v_md5 = '{worker_new_md5}' THEN
    EXECUTE $v485_rb_2${worker_old.rstrip().rstrip(';')}$v485_rb_2$;
  ELSIF v_md5 IS DISTINCT FROM '{worker_old_md5}' THEN
    RAISE EXCEPTION 'v485 rollback: route worker changed outside V485 (prosrc md5 %)', v_md5;
  END IF;
END
$v485_rb_worker$;

DROP FUNCTION IF EXISTS public.aka_agent_finish_data_group_upload(bigint, bigint, uuid, text, text);
DROP FUNCTION IF EXISTS public.aka_agent_append_data_group_upload(bigint, bigint, uuid, integer, jsonb, text, text, text);
DROP FUNCTION IF EXISTS public.aka_agent_begin_data_group_upload(bigint, bigint, text, bigint, text, text, bigint, text, bigint, jsonb, integer, text, text);
DROP FUNCTION IF EXISTS public.aka_agent_finish_data_group_upload(bigint, bigint, uuid);
DROP FUNCTION IF EXISTS public.aka_agent_append_data_group_upload(bigint, bigint, uuid, integer, jsonb, text);
DROP FUNCTION IF EXISTS public.aka_agent_begin_data_group_upload(bigint, bigint, text, bigint, text, text, bigint, text, bigint, jsonb, integer);
DROP FUNCTION IF EXISTS private.aka_agent_data_group_upload_part_totals(uuid);
DROP FUNCTION IF EXISTS private.aka_agent_data_group_upload_session_json(uuid);
DROP TABLE IF EXISTS private.auto_data_group_upload_session_parts;
DROP TABLE IF EXISTS private.auto_data_group_upload_sessions;

DO $v485_rb_done$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('{INGEST_SIG}'))) IS DISTINCT FROM '{ingest_v484_md5}'
     OR (SELECT md5(p.prosrc) FROM pg_proc AS p WHERE p.oid = to_regprocedure('{WORKER_SIG}'))
        IS DISTINCT FROM '{worker_old_md5}' THEN
    RAISE EXCEPTION 'v485 rollback: functions not restored';
  END IF;
END
$v485_rb_done$;

COMMIT;
"""
    for tag in ('$v485_rb_1$', '$v485_rb_2$'):
        if tag in v484_ingest or tag in worker_old:
            raise SystemExit('tag collision')
    files = {f'migration_{NAME}_p1.sql': p1, f'migration_{NAME}_p2.sql': p2, f'rollback_{NAME}.sql': rb}
    for old in MIG.glob(f'*{NAME}*.sql'):
        if old.name not in files:
            old.unlink()
    for name, text in files.items():
        (MIG / name).write_text(text, encoding='utf-8')
        print(f'{name}: {len(text.encode("utf-8"))} bytes, md5 {md5(text)}')
    print(json.dumps({
        INGEST_SIG: {'live': live_md5, 'v484': ingest_v484_md5, 'v485': ingest_v485_md5},
        WORKER_SIG: {'v484_prosrc': worker_old_md5, 'v485_prosrc': worker_new_md5},
    }, indent=2))


if __name__ == '__main__':
    build()
