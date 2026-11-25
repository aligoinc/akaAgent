#!/usr/bin/env python3
"""Sinh migrations/migration_v654_staff_email_prompt_fixes.sql từ thân hàm V652 p2 (= production, khoá md5 prosrc).

Sửa (tìm ra bằng scripts/staff-email-prompt/fuzz/fuzz.py, 25/11/2026):
1. Công tắc {"audience":"orgs"} thiếu organizationIds làm v_enabled = NULL, IF NOT NULL không chặn => bật cho mọi người.
2. Bộ gửi thư: 'limit' không phải số làm hàm lỗi cast.
3. "Không phải tôi": trả lại email_list[2] sai khi trước lần lưu email đang trống (danh sách còn email cũ đã xoá).
   Nay lưu email trước lần lưu (prev_*_email) và trả lại đúng giá trị đó; trước đó đã là chính email bị gỡ thì để trống.
4. Nhiều lượt lưu cùng lúc vượt hạn 5 lần / giờ: khoá dòng org_staff trước khi kiểm hạn.
"""
import hashlib, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
P2 = open(os.path.join(REPO, 'migrations', 'migration_v652_staff_email_prompt_p2.sql')).read()
OUT = os.path.join(REPO, 'migrations', 'migration_v654_staff_email_prompt_fixes.sql')

CORE_MD5 = '761ad6bcc42ea96628490e1ac8952f27'
WORKER_MD5 = '90bfb299e1aa8ef46f8d26f9dfb8da12'


def body(name):
    m = re.search(r'CREATE FUNCTION ' + re.escape(name) + r'\(.*?AS \$function\$(.*?)\$function\$;', P2, re.S)
    head = re.search(r'(CREATE FUNCTION ' + re.escape(name) + r'\(.*?AS \$function\$)', P2, re.S).group(1)
    return head, m.group(1)


def sub1(src, old, new):
    n = src.count(old)
    if n != 1:
        sys.exit(f'đoạn cần thay xuất hiện {n} lần: {old[:80]!r}')
    return src.replace(old, new)


core_head, core = body('private.aka_agent_email_prompt_core')
work_head, work = body('public.aka_agent_email_prompt_worker')
assert hashlib.md5(core.encode()).hexdigest() == CORE_MD5, hashlib.md5(core.encode()).hexdigest()
assert hashlib.md5(work.encode()).hexdigest() == WORKER_MD5, hashlib.md5(work.encode()).hexdigest()

# 1. công tắc
core = sub1(core, "  v_enabled := v_audience = 'all'", "  v_enabled := coalesce(v_audience = 'all'")
core = sub1(core, "        AND (v_cfg -> 'organizationIds') @> to_jsonb(v_staff.organization_id));",
            "        AND (v_cfg -> 'organizationIds') @> to_jsonb(v_staff.organization_id)), false);")

# 4. khoá + đọc lại trước khi kiểm hạn; 3. ghi email trước lần lưu
core = sub1(core, """    IF v_has_prompt AND v_prompt.save_window_start > now() - interval '1 hour' AND v_prompt.save_window_count >= 5 THEN""",
            """    -- Khoá dòng tài khoản để các lượt lưu cùng lúc xếp hàng (hạn 5 lần / giờ, email trước lần lưu).
    SELECT s.email INTO v_staff_email_now FROM public.org_staff s WHERE s.id = v_staff.id FOR NO KEY UPDATE;
    SELECT * INTO v_prompt FROM private.aka_staff_email_prompt WHERE staff_id = p_staff_id;
    v_has_prompt := FOUND;
    SELECT o.email INTO v_org_email_now FROM public.org_organization o WHERE o.id = v_org.id;
    IF v_org.customer_id IS NOT NULL THEN
      SELECT c.email INTO v_cust_email_now FROM public.aka_customer c WHERE c.id = v_org.customer_id;
    END IF;
    IF v_has_prompt AND v_prompt.save_window_start > now() - interval '1 hour' AND v_prompt.save_window_count >= 5 THEN""")
core = sub1(core, "  v_dismissed boolean;\n", "  v_dismissed boolean;\n  v_staff_email_now text; v_org_email_now text; v_cust_email_now text;\n")
core = sub1(core, """      staff_id, organization_id, saved_at, saved_email, saved_mode, saved_client, saved_as_admin, crm_customer_id,
      save_window_start, save_window_count)
    VALUES (v_staff.id, v_staff.organization_id, now(), v_email, v_mode, v_client, v_staff.is_admin,
            CASE WHEN v_staff.is_admin THEN v_org.customer_id END, now(), 1)""",
            """      staff_id, organization_id, saved_at, saved_email, saved_mode, saved_client, saved_as_admin, crm_customer_id,
      save_window_start, save_window_count, prev_staff_email, prev_org_email, prev_crm_email)
    VALUES (v_staff.id, v_staff.organization_id, now(), v_email, v_mode, v_client, v_staff.is_admin,
            CASE WHEN v_staff.is_admin THEN v_org.customer_id END, now(), 1,
            v_staff_email_now, CASE WHEN v_staff.is_admin THEN v_org_email_now END,
            CASE WHEN v_staff.is_admin THEN v_cust_email_now END)""")
core = sub1(core, """      crm_customer_id = excluded.crm_customer_id, organization_id = excluded.organization_id,""",
            """      crm_customer_id = excluded.crm_customer_id, organization_id = excluded.organization_id,
      prev_staff_email = excluded.prev_staff_email, prev_org_email = excluded.prev_org_email,
      prev_crm_email = excluded.prev_crm_email,""")

# 2. limit
work = sub1(work, "    v_limit := least(greatest(coalesce(nullif(v_payload ->> 'limit', '')::int, 20), 1), 50);",
            "    v_limit := least(greatest(coalesce(CASE WHEN (v_payload ->> 'limit') ~ '^-?[0-9]{1,9}$'\n"
            "                                            THEN (v_payload ->> 'limit')::int END, 20), 1), 50);")
# 3. unlink
work = sub1(work, """    UPDATE public.org_staff s
       SET email = CASE WHEN s.email_list[1] = v_email THEN s.email_list[2] END
     WHERE s.id = v_staff_id AND lower(btrim(coalesce(s.email, ''))) = v_email;""",
            """    UPDATE public.org_staff s
       SET email = CASE WHEN lower(btrim(coalesce(v_prompt.prev_staff_email, ''))) IN ('', v_email) THEN NULL
                        ELSE v_prompt.prev_staff_email END
     WHERE s.id = v_staff_id AND lower(btrim(coalesce(s.email, ''))) = v_email;""")
work = sub1(work, """      UPDATE public.org_organization o
         SET email = CASE WHEN o.email_list[1] = v_email THEN o.email_list[2] END""",
            """      UPDATE public.org_organization o
         SET email = CASE WHEN lower(btrim(coalesce(v_prompt.prev_org_email, ''))) IN ('', v_email) THEN NULL
                          ELSE v_prompt.prev_org_email END""")
work = sub1(work, """        UPDATE public.aka_customer c
           SET email = CASE WHEN c.email_list[1] = v_email THEN c.email_list[2] END""",
            """        UPDATE public.aka_customer c
           SET email = CASE WHEN lower(btrim(coalesce(v_prompt.prev_crm_email, ''))) IN ('', v_email) THEN NULL
                            ELSE v_prompt.prev_crm_email END""")
work = sub1(work, """    -- "Không phải tôi": gỡ email khỏi tài khoản (và tổ chức / CRM nếu lúc lưu là admin), trả lại email trước đó
    -- (email_list[2]) nếu có. Email bị gỡ vẫn nằm trong email_list.""",
            """    -- "Không phải tôi": gỡ email khỏi tài khoản (và tổ chức / CRM nếu lúc lưu là admin), trả lại email ngay trước
    -- lần lưu (prev_*_email); trước đó trống hoặc đã là chính email bị gỡ thì để trống. Email bị gỡ vẫn nằm trong
    -- email_list.""")
work = sub1(work, """           verify_next_at = NULL, verify_last_error = NULL, unlinked_at = now(), unlinked_email = v_email,""",
            """           verify_next_at = NULL, verify_last_error = NULL, unlinked_at = now(), unlinked_email = v_email,
           prev_staff_email = NULL, prev_org_email = NULL, prev_crm_email = NULL,""")

core_head = core_head.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
work_head = work_head.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION')
new_core_md5 = hashlib.md5(core.encode()).hexdigest()
new_work_md5 = hashlib.md5(work.encode()).hexdigest()

sql = f"""-- V654: sửa form xin email (V652) theo kết quả kiểm thử ngẫu nhiên 25/11/2026.
-- Sinh bằng: python3 scripts/staff-email-prompt/build-v654-sql.py (không sửa tay).
-- 1. Công tắc {{"audience":"orgs"}} thiếu organizationIds bật nhầm cho mọi người -> coi là tắt.
-- 2. Bộ gửi thư: 'limit' không phải số -> mặc định 20, không lỗi.
-- 3. "Không phải tôi" trả lại đúng email ngay trước lần lưu (cột mới prev_*_email ở bảng riêng của form).
-- 4. Lưu nhiều lượt cùng lúc không vượt hạn 5 lần / giờ (khoá dòng org_staff khi lưu).
-- Chỉ đổi bảng private.aka_staff_email_prompt (thêm 3 cột) và thân 2 hàm; quyền, công tắc giữ nguyên.
-- Thân hàm trước: core {CORE_MD5}, worker {WORKER_MD5}. Sau: core {new_core_md5}, worker {new_work_md5}.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v654_staff_email_prompt_fixes') THEN
    RAISE EXCEPTION 'V654 đã có trong sổ migration, không chạy lại';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_email_prompt_core(bigint,text,jsonb)'::regprocedure)
     IS DISTINCT FROM '{CORE_MD5}' THEN
    RAISE EXCEPTION 'V654: thân private.aka_agent_email_prompt_core khác bản V652';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_email_prompt_worker(text,jsonb)'::regprocedure)
     IS DISTINCT FROM '{WORKER_MD5}' THEN
    RAISE EXCEPTION 'V654: thân public.aka_agent_email_prompt_worker khác bản V652';
  END IF;
END $pre$;

ALTER TABLE private.aka_staff_email_prompt
  ADD COLUMN prev_staff_email text,
  ADD COLUMN prev_org_email text,
  ADD COLUMN prev_crm_email text;
COMMENT ON COLUMN private.aka_staff_email_prompt.prev_staff_email IS
  'V654: email org_staff ngay trước lần lưu gần nhất (để "Không phải tôi" trả lại). prev_org_email / prev_crm_email: tương tự, chỉ khi lưu là admin.';

{core_head}{core}$function$;

{work_head}{work}$function$;

DO $post$
DECLARE v_bad text;
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_email_prompt_core(bigint,text,jsonb)'::regprocedure)
     IS DISTINCT FROM '{new_core_md5}'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_email_prompt_worker(text,jsonb)'::regprocedure)
     IS DISTINCT FROM '{new_work_md5}' THEN
    RAISE EXCEPTION 'V654 postflight: thân hàm khác bản sinh';
  END IF;
  SELECT string_agg(rolname || ':' || fn, ', ' ORDER BY rolname, fn) INTO v_bad
    FROM pg_roles
    CROSS JOIN (VALUES
      ('private.aka_agent_email_prompt_core(bigint, text, jsonb)', ARRAY[]::text[]),
      ('public.aka_agent_email_prompt_worker(text, jsonb)', ARRAY['service_role'])
    ) AS f(fn, allowed)
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, fn, 'EXECUTE') IS DISTINCT FROM (rolname = ANY (allowed));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V654 postflight: quyền gọi hàm sai: %', v_bad; END IF;
  IF (public.aka_agent_email_prompt_worker('claim', '{{"limit":"x"}}') ->> 'ok') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'V654 postflight: claim với limit sai kiểu phải chạy được';
  END IF;
END $post$;

COMMIT;
"""
# claim trong postflight sẽ giữ chỗ việc đến hạn: chỉ an toàn khi chưa có dòng nào (production 0 dòng lúc viết).
sql = sql.replace("""  IF (public.aka_agent_email_prompt_worker('claim', '{"limit":"x"}') ->> 'ok') IS DISTINCT FROM 'true' THEN""",
                  """  IF NOT EXISTS (SELECT 1 FROM private.aka_staff_email_prompt)
     AND (public.aka_agent_email_prompt_worker('claim', '{"limit":"x"}') ->> 'ok') IS DISTINCT FROM 'true' THEN""")
open(OUT, 'w').write(sql)

# Gỡ V654: trả 2 hàm về thân V652, bỏ 3 cột.
_, core0 = body('private.aka_agent_email_prompt_core')
_, work0 = body('public.aka_agent_email_prompt_worker')
rb = f"""-- Gỡ V654: trả private.aka_agent_email_prompt_core và public.aka_agent_email_prompt_worker về thân V652, bỏ 3 cột prev_*.
-- Sinh bằng: python3 scripts/staff-email-prompt/build-v654-sql.py.
BEGIN;
SET LOCAL lock_timeout = '3s';
{core_head}{core0}$function$;

{work_head}{work0}$function$;

ALTER TABLE private.aka_staff_email_prompt DROP COLUMN IF EXISTS prev_staff_email, DROP COLUMN IF EXISTS prev_org_email,
  DROP COLUMN IF EXISTS prev_crm_email;
DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_email_prompt_core(bigint,text,jsonb)'::regprocedure) IS DISTINCT FROM '{CORE_MD5}'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_email_prompt_worker(text,jsonb)'::regprocedure) IS DISTINCT FROM '{WORKER_MD5}' THEN
    RAISE EXCEPTION 'gỡ V654: thân hàm khác V652';
  END IF;
END $post$;
COMMIT;
"""
open(os.path.join(REPO, 'migrations', 'rollback_v654_staff_email_prompt_fixes.sql'), 'w').write(rb)
print(OUT, 'core', new_core_md5, 'worker', new_work_md5, 'file', hashlib.md5(sql.encode()).hexdigest())
