-- V652 p2: form xin email sau khi đăng nhập: bảng trạng thái, công tắc, RPC Desktop / API Web / bộ gửi thư.
--
-- Phương án: docs/STAFF_EMAIL_PROMPT_PLAN.md (anh duyệt 25/11/2026). Chạy sau p1.
-- Luật:
-- - "Có email" = 1 trong 3 chỗ có email dùng được: org_staff.email (chính tài khoản), org_organization.email (tổ chức
--   của tài khoản), aka_customer.email (khách org_organization.customer_id). Áp cho mọi tài khoản. Có thì không hỏi.
-- - Admin (org_staff.is_admin) có email ở 1 chỗ mà chỗ khác trống: lệnh state tự chép vào chỗ trống, không hỏi.
-- - Lưu: mọi tài khoản ghi đè org_staff.email; admin ghi đè thêm org_organization.email và aka_customer.email.
--   Trigger trg_email_list_track (p1) giữ email cũ trong email_list.
-- - Tắt form (dismiss) thì hôm sau (theo ngày VN) mới hỏi lại.
-- - Công tắc auto_system_settings 'account.email_prompt' {"audience":"off|admin_akabiz|orgs|all","organizationIds":[]},
--   mặc định off. Tắt thì mọi lệnh của form trả disabled.
-- Mọi kết quả là jsonb có "ok"; lỗi nghiệp vụ trả {"ok":false,"code":...}, không RAISE.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v652_staff_email_prompt_p2') THEN
    RAISE EXCEPTION 'V652 p2 đã có trong sổ migration, không chạy lại';
  END IF;
  IF to_regprocedure('private.track_email_list()') IS NULL THEN
    RAISE EXCEPTION 'V652 p2: chạy p1 trước (thiếu private.track_email_list())';
  END IF;
  IF to_regclass('private.aka_staff_email_prompt') IS NOT NULL THEN
    RAISE EXCEPTION 'V652 p2: bảng private.aka_staff_email_prompt đã có';
  END IF;
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN
    RAISE EXCEPTION 'V652 p2: thiếu private.aka_agent_staff_scope_for_request()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    RAISE EXCEPTION 'V652 p2: thiếu role aka_agent_desktop hoặc service_role';
  END IF;
END $pre$;

-- Trạng thái form của từng tài khoản. Không thêm cột trạng thái vào org_staff (bảng nóng).
CREATE TABLE private.aka_staff_email_prompt (
  staff_id          bigint PRIMARY KEY REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id   bigint NOT NULL,
  shown_count       integer NOT NULL DEFAULT 0,
  last_shown_at     timestamptz,
  dismiss_count     integer NOT NULL DEFAULT 0,
  last_dismissed_at timestamptz,
  saved_at          timestamptz,
  saved_email       text,
  saved_mode        text CHECK (saved_mode IN ('typed', 'confirmed')),
  saved_client      text CHECK (saved_client IN ('desktop', 'web', 'ios')),
  saved_as_admin    boolean,
  crm_customer_id   bigint,
  synced_at         timestamptz,
  synced_email      text,
  save_window_start timestamptz,
  save_window_count integer NOT NULL DEFAULT 0,
  verify_attempts   integer NOT NULL DEFAULT 0,
  verify_next_at    timestamptz,
  verify_sent_at    timestamptz,
  verify_last_error text,
  verified_at       timestamptz,
  unlinked_at       timestamptz,
  unlinked_email    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aka_staff_email_prompt_verify_due
  ON private.aka_staff_email_prompt (saved_at)
  WHERE saved_at IS NOT NULL AND verify_sent_at IS NULL AND verified_at IS NULL;
COMMENT ON TABLE private.aka_staff_email_prompt IS
  'V652: trạng thái form xin email sau đăng nhập (đã hiện, đã tắt, đã lưu, thư xác nhận) của từng org_staff. Chỉ hàm aka_agent_*email_prompt* ghi.';
ALTER TABLE private.aka_staff_email_prompt ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.aka_staff_email_prompt FROM PUBLIC;
DO $t$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON private.aka_staff_email_prompt FROM %I', r);
    END IF;
  END LOOP;
END $t$;

-- Tên miền gõ nhầm -> tên miền đúng ('' = tên miền mẫu, không có gợi ý). Cùng danh sách với
-- private.aka_agent_notification_email_candidates().
CREATE FUNCTION private.aka_staff_email_typo_fix(p_domain text) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE lower(coalesce(p_domain, ''))
    WHEN 'gmail.con' THEN 'gmail.com' WHEN 'gmail.co' THEN 'gmail.com' WHEN 'gmail.cm' THEN 'gmail.com'
    WHEN 'gmail.om' THEN 'gmail.com' WHEN 'gmail.vn' THEN 'gmail.com' WHEN 'gmail.com.vn' THEN 'gmail.com'
    WHEN 'gmai.com' THEN 'gmail.com' WHEN 'gamil.com' THEN 'gmail.com' WHEN 'gmal.com' THEN 'gmail.com'
    WHEN 'gmali.com' THEN 'gmail.com' WHEN 'gmsil.com' THEN 'gmail.com' WHEN 'gmial.com' THEN 'gmail.com'
    WHEN 'gmaill.com' THEN 'gmail.com' WHEN 'gnail.com' THEN 'gmail.com' WHEN 'gmail.comm' THEN 'gmail.com'
    WHEN 'yahoo.con' THEN 'yahoo.com' WHEN 'yahoo.co' THEN 'yahoo.com'
    WHEN 'hotmail.con' THEN 'hotmail.com' WHEN 'hotmail.co' THEN 'hotmail.com'
    WHEN 'outlook.con' THEN 'outlook.com' WHEN 'icloud.con' THEN 'icloud.com'
    WHEN 'example.com' THEN '' WHEN 'test.com' THEN ''
    ELSE NULL END
$function$;

-- Email viết thường nếu đúng định dạng; NULL nếu trống / sai / thuộc tên miền gõ nhầm (trừ khi bằng p_allow:
-- email khách đã chủ động giữ nguyên ở form).
CREATE FUNCTION private.aka_staff_email_usable(p_email text, p_allow text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog', 'private'
AS $function$
DECLARE
  v text := lower(btrim(coalesce(p_email, '')));
BEGIN
  IF char_length(v) NOT BETWEEN 6 AND 254
     OR v !~ '^[a-z0-9_%+''-]+(\.[a-z0-9_%+''-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' THEN
    RETURN NULL;
  END IF;
  IF private.aka_staff_email_typo_fix(split_part(v, '@', 2)) IS NOT NULL
     AND v IS DISTINCT FROM lower(btrim(coalesce(p_allow, ''))) THEN
    RETURN NULL;
  END IF;
  RETURN v;
END
$function$;

CREATE FUNCTION private.aka_agent_email_prompt_core(p_staff_id bigint, p_action text, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '8s'
SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_payload jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  v_staff record;
  v_org record;
  v_cust_email text;
  v_prompt private.aka_staff_email_prompt%ROWTYPE;
  v_has_prompt boolean;
  v_cfg jsonb;
  v_audience text;
  v_enabled boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  e_staff text; e_org text; e_crm text; v_pick text;
  v_email text; v_domain text; v_fix text; v_mode text; v_client text;
  n1 int := 0; n2 int := 0; n3 int := 0;
  v_dismissed boolean;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'no_session');
  END IF;
  SELECT s.id, s.organization_id, s.username, s.email, s.email_list,
         coalesce(s.is_admin, false) AS is_admin, coalesce(s.is_admin_akabiz, false) AS is_admin_akabiz
    INTO v_staff
    FROM public.org_staff s
   WHERE s.id = p_staff_id AND s.is_active IS TRUE AND s.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'staff_inactive');
  END IF;
  SELECT o.id, o.email, o.customer_id INTO v_org FROM public.org_organization o WHERE o.id = v_staff.organization_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'staff_inactive');
  END IF;
  IF v_org.customer_id IS NOT NULL THEN
    SELECT c.email INTO v_cust_email FROM public.aka_customer c WHERE c.id = v_org.customer_id;
  END IF;

  BEGIN
    SELECT value::jsonb INTO v_cfg FROM public.auto_system_settings
     WHERE key = 'account.email_prompt' AND is_active IS TRUE ORDER BY id LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_cfg := NULL;
  END;
  v_audience := CASE WHEN jsonb_typeof(v_cfg) = 'object' THEN coalesce(v_cfg ->> 'audience', 'off') ELSE 'off' END;
  v_enabled := v_audience = 'all'
    OR (v_audience = 'admin_akabiz' AND v_staff.is_admin_akabiz)
    OR (v_audience = 'orgs' AND jsonb_typeof(v_cfg -> 'organizationIds') = 'array'
        AND (v_cfg -> 'organizationIds') @> to_jsonb(v_staff.organization_id));
  IF NOT v_enabled THEN
    RETURN jsonb_build_object('ok', true, 'enabled', false, 'show', 'none', 'reason', 'disabled');
  END IF;

  SELECT * INTO v_prompt FROM private.aka_staff_email_prompt WHERE staff_id = p_staff_id;
  v_has_prompt := FOUND;
  e_staff := private.aka_staff_email_usable(v_staff.email, v_prompt.saved_email);
  e_org := private.aka_staff_email_usable(v_org.email);
  e_crm := private.aka_staff_email_usable(v_cust_email);

  -- ---------------------------------------------------------------- state
  IF p_action = 'state' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.org_organization_product p
       WHERE p.organization_id = v_staff.organization_id AND p.is_deleted IS NOT TRUE
         AND (p.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_today
    ) THEN
      RETURN jsonb_build_object('ok', true, 'enabled', true, 'show', 'none', 'reason', 'no_package');
    END IF;

    IF coalesce(e_staff, e_org, e_crm) IS NOT NULL THEN
      IF v_staff.is_admin THEN
        -- Admin: chép email đang có vào những chỗ còn trống (không ghi đè), không hỏi.
        v_pick := coalesce(e_staff, e_org, e_crm);
        UPDATE public.org_staff SET email = v_pick
         WHERE id = v_staff.id AND nullif(btrim(coalesce(email, '')), '') IS NULL;
        GET DIAGNOSTICS n1 = ROW_COUNT;
        UPDATE public.org_organization SET email = v_pick
         WHERE id = v_org.id AND nullif(btrim(coalesce(email, '')), '') IS NULL;
        GET DIAGNOSTICS n2 = ROW_COUNT;
        IF v_org.customer_id IS NOT NULL THEN
          UPDATE public.aka_customer SET email = v_pick
           WHERE id = v_org.customer_id AND nullif(btrim(coalesce(email, '')), '') IS NULL;
          GET DIAGNOSTICS n3 = ROW_COUNT;
        END IF;
        IF n1 + n2 + n3 > 0 THEN
          INSERT INTO private.aka_staff_email_prompt AS p (staff_id, organization_id, synced_at, synced_email)
          VALUES (v_staff.id, v_staff.organization_id, now(), v_pick)
          ON CONFLICT (staff_id) DO UPDATE
            SET synced_at = now(), synced_email = v_pick, organization_id = excluded.organization_id, updated_at = now();
        END IF;
      END IF;
      RETURN jsonb_build_object('ok', true, 'enabled', true, 'show', 'none', 'reason', 'has_email',
                                'synced', (n1 + n2 + n3) > 0);
    END IF;

    v_dismissed := v_has_prompt AND v_prompt.last_dismissed_at IS NOT NULL
      AND (v_prompt.last_dismissed_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date >= v_today;
    IF NOT v_dismissed THEN
      INSERT INTO private.aka_staff_email_prompt AS p (staff_id, organization_id, shown_count, last_shown_at)
      VALUES (v_staff.id, v_staff.organization_id, 1, now())
      ON CONFLICT (staff_id) DO UPDATE
        SET shown_count = p.shown_count + 1, last_shown_at = now(),
            organization_id = excluded.organization_id, updated_at = now();
    END IF;
    RETURN jsonb_build_object('ok', true, 'enabled', true,
      'show', CASE WHEN v_dismissed THEN 'none' ELSE 'enter' END,
      'reason', CASE WHEN v_dismissed THEN 'dismissed' ELSE 'no_email' END,
      'chip', true, 'username', v_staff.username, 'isAdmin', v_staff.is_admin);

  -- ---------------------------------------------------------------- dismiss
  ELSIF p_action = 'dismiss' THEN
    INSERT INTO private.aka_staff_email_prompt AS p (staff_id, organization_id, dismiss_count, last_dismissed_at)
    VALUES (v_staff.id, v_staff.organization_id, 1, now())
    ON CONFLICT (staff_id) DO UPDATE
      SET dismiss_count = p.dismiss_count + 1, last_dismissed_at = now(),
          organization_id = excluded.organization_id, updated_at = now();
    RETURN jsonb_build_object('ok', true, 'dismissed', true);

  -- ---------------------------------------------------------------- profile (Thông tin tài khoản)
  ELSIF p_action = 'profile' THEN
    RETURN jsonb_build_object('ok', true, 'enabled', true,
      'email', nullif(lower(btrim(coalesce(v_staff.email, ''))), ''),
      'emailList', to_jsonb(coalesce(v_staff.email_list, '{}'::text[])),
      'isAdmin', v_staff.is_admin,
      'verified', v_has_prompt AND v_prompt.verified_at IS NOT NULL
                  AND v_prompt.saved_email = lower(btrim(coalesce(v_staff.email, ''))));

  -- ---------------------------------------------------------------- save
  ELSIF p_action = 'save' THEN
    v_client := v_payload ->> 'client';
    IF v_client IS NULL OR v_client NOT IN ('desktop', 'web', 'ios') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_client');
    END IF;
    IF v_has_prompt AND v_prompt.save_window_start > now() - interval '1 hour' AND v_prompt.save_window_count >= 5 THEN
      RETURN jsonb_build_object('ok', false, 'code', 'rate_limited');
    END IF;

    IF (v_payload ->> 'confirm') = 'true' THEN
      v_email := coalesce(e_staff, e_org, e_crm);
      IF v_email IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'nothing_to_confirm');
      END IF;
      v_mode := 'confirmed';
    ELSE
      v_email := lower(btrim(coalesce(v_payload ->> 'email', '')));
      IF char_length(v_email) NOT BETWEEN 6 AND 254
         OR v_email !~ '^[a-z0-9_%+''-]+(\.[a-z0-9_%+''-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'email_invalid');
      END IF;
      v_domain := split_part(v_email, '@', 2);
      v_fix := private.aka_staff_email_typo_fix(v_domain);
      IF v_fix = '' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'email_invalid');
      END IF;
      IF v_fix IS NOT NULL AND (v_payload ->> 'allowTypo') IS DISTINCT FROM 'true' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'email_typo',
                                  'suggestion', split_part(v_email, '@', 1) || '@' || v_fix);
      END IF;
      v_mode := 'typed';
    END IF;

    -- Ghi đè; trigger trg_email_list_track giữ email cũ. Bỏ qua dòng đã đúng email để khỏi chạy trigger thừa.
    UPDATE public.org_staff SET email = v_email
     WHERE id = v_staff.id AND lower(btrim(coalesce(email, ''))) IS DISTINCT FROM v_email;
    IF v_staff.is_admin THEN
      UPDATE public.org_organization SET email = v_email
       WHERE id = v_org.id AND lower(btrim(coalesce(email, ''))) IS DISTINCT FROM v_email;
      IF v_org.customer_id IS NOT NULL THEN
        UPDATE public.aka_customer SET email = v_email
         WHERE id = v_org.customer_id AND lower(btrim(coalesce(email, ''))) IS DISTINCT FROM v_email;
      END IF;
    END IF;

    INSERT INTO private.aka_staff_email_prompt AS p (
      staff_id, organization_id, saved_at, saved_email, saved_mode, saved_client, saved_as_admin, crm_customer_id,
      save_window_start, save_window_count)
    VALUES (v_staff.id, v_staff.organization_id, now(), v_email, v_mode, v_client, v_staff.is_admin,
            CASE WHEN v_staff.is_admin THEN v_org.customer_id END, now(), 1)
    ON CONFLICT (staff_id) DO UPDATE SET
      saved_at = now(), saved_email = excluded.saved_email, saved_mode = excluded.saved_mode,
      saved_client = excluded.saved_client, saved_as_admin = excluded.saved_as_admin,
      crm_customer_id = excluded.crm_customer_id, organization_id = excluded.organization_id,
      save_window_start = CASE WHEN p.save_window_start > now() - interval '1 hour' THEN p.save_window_start ELSE now() END,
      save_window_count = CASE WHEN p.save_window_start > now() - interval '1 hour' THEN p.save_window_count + 1 ELSE 1 END,
      -- Lưu lại đúng email đã xác nhận thì giữ trạng thái xác nhận, không gửi thư lại.
      verified_at = CASE WHEN p.saved_email = excluded.saved_email THEN p.verified_at END,
      verify_sent_at = CASE WHEN p.saved_email = excluded.saved_email AND p.verified_at IS NOT NULL THEN p.verify_sent_at END,
      verify_attempts = 0, verify_next_at = NULL, verify_last_error = NULL,
      updated_at = now();

    RETURN jsonb_build_object('ok', true, 'saved', true, 'email', v_email, 'isAdmin', v_staff.is_admin,
      'verified', EXISTS (SELECT 1 FROM private.aka_staff_email_prompt p
                           WHERE p.staff_id = v_staff.id AND p.verified_at IS NOT NULL));
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
END
$function$;

COMMENT ON FUNCTION private.aka_agent_email_prompt_core(bigint, text, jsonb) IS
  'V652: lõi form xin email (state / dismiss / profile / save) của một org_staff. Không cấp cho role ứng dụng.';

-- Desktop: nhân viên lấy từ phiên.
CREATE FUNCTION public.aka_agent_email_prompt(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '8s'
AS $function$
BEGIN
  RETURN private.aka_agent_email_prompt_core(NULLIF(private.aka_agent_staff_scope_for_request(), 0), p_action, p_payload);
END
$function$;
COMMENT ON FUNCTION public.aka_agent_email_prompt(text, jsonb) IS
  'V652: Desktop: form xin email của nhân viên trong phiên (state / dismiss / profile / save).';

-- API Web / iOS: nhân viên + tổ chức của phiên đã xác thực.
CREATE FUNCTION public.aka_agent_control_email_prompt(p_staff_id bigint, p_organization_id bigint, p_action text,
                                                       p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '8s'
AS $function$
BEGIN
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.org_staff s WHERE s.id = p_staff_id AND s.organization_id = p_organization_id
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'staff_inactive');
  END IF;
  RETURN private.aka_agent_email_prompt_core(p_staff_id, p_action, p_payload);
END
$function$;
COMMENT ON FUNCTION public.aka_agent_control_email_prompt(bigint, bigint, text, jsonb) IS
  'V652: API Web/iOS: form xin email của nhân viên đang đăng nhập (service_role).';

-- Bộ gửi thư xác nhận (API Web) + link xác nhận / "Không phải tôi".
CREATE FUNCTION public.aka_agent_email_prompt_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
SET statement_timeout TO '8s'
SET lock_timeout TO '3s'
AS $function$
DECLARE
  v_payload jsonb := CASE WHEN jsonb_typeof(p_payload) = 'object' THEN p_payload ELSE '{}'::jsonb END;
  v_limit int;
  v_items jsonb;
  v_staff_id bigint;
  v_email text;
  v_prompt private.aka_staff_email_prompt%ROWTYPE;
  v_staff record;
  v_org record;
  v_retry boolean;
BEGIN
  IF p_action = 'claim' THEN
    v_limit := least(greatest(coalesce(nullif(v_payload ->> 'limit', '')::int, 20), 1), 50);
    WITH due AS (
      SELECT p.staff_id
        FROM private.aka_staff_email_prompt p
       WHERE p.saved_at IS NOT NULL AND p.saved_email IS NOT NULL
         AND p.verify_sent_at IS NULL AND p.verified_at IS NULL
         AND p.verify_attempts < 5 AND (p.verify_next_at IS NULL OR p.verify_next_at <= now())
       ORDER BY p.saved_at
       LIMIT v_limit
       FOR UPDATE SKIP LOCKED
    ), claimed AS (
      -- Giữ chỗ 10 phút; gửi xong thì 'sent', lỗi thì 'failed'.
      UPDATE private.aka_staff_email_prompt p
         SET verify_attempts = p.verify_attempts + 1, verify_next_at = now() + interval '10 minutes', updated_at = now()
        FROM due WHERE p.staff_id = due.staff_id
      RETURNING p.*
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'staffId', c.staff_id,
             'organizationId', s.organization_id,
             'email', c.saved_email,
             'username', s.username,
             'staffName', s.name,
             'organizationName', o.name,
             'isAdmin', coalesce(c.saved_as_admin, false),
             'savedAt', (extract(epoch FROM c.saved_at) * 1000)::bigint,
             'products', coalesce((
               SELECT jsonb_agg(jsonb_build_object(
                        'name', pp.product_name, 'packageName', pp.package_name,
                        'expirationDate', to_char(pp.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD'),
                        'isPaid', coalesce(pp.is_paid, false))
                        ORDER BY pp.expiration_date DESC)
                 FROM public.org_organization_product pp
                WHERE pp.organization_id = s.organization_id AND pp.is_deleted IS NOT TRUE
                  AND (pp.expiration_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
                      >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date), '[]'::jsonb)
           ) ORDER BY c.saved_at), '[]'::jsonb)
      INTO v_items
      FROM claimed c
      JOIN public.org_staff s ON s.id = c.staff_id AND s.is_active IS TRUE AND s.deleted_at IS NULL
                             AND lower(btrim(coalesce(s.email, ''))) = c.saved_email
      JOIN public.org_organization o ON o.id = s.organization_id;
    RETURN jsonb_build_object('ok', true, 'items', v_items);
  END IF;

  v_staff_id := CASE WHEN (v_payload ->> 'staffId') ~ '^[0-9]{1,18}$' THEN (v_payload ->> 'staffId')::bigint END;
  v_email := lower(btrim(coalesce(v_payload ->> 'email', '')));
  IF v_staff_id IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_payload');
  END IF;
  SELECT * INTO v_prompt FROM private.aka_staff_email_prompt WHERE staff_id = v_staff_id FOR UPDATE;
  IF NOT FOUND OR v_prompt.saved_email IS DISTINCT FROM v_email THEN
    RETURN jsonb_build_object('ok', false, 'code', 'email_changed');
  END IF;

  IF p_action = 'sent' THEN
    UPDATE private.aka_staff_email_prompt
       SET verify_sent_at = now(), verify_next_at = NULL, verify_last_error = NULL, updated_at = now()
     WHERE staff_id = v_staff_id;
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action = 'failed' THEN
    v_retry := coalesce((v_payload ->> 'retryable') = 'true', false);
    UPDATE private.aka_staff_email_prompt
       SET verify_last_error = left(coalesce(v_payload ->> 'error', 'send_failed'), 300),
           verify_attempts = CASE WHEN v_retry THEN verify_attempts ELSE 5 END,
           verify_next_at = now() + make_interval(mins => 15 * greatest(verify_attempts, 1)),
           updated_at = now()
     WHERE staff_id = v_staff_id;
    RETURN jsonb_build_object('ok', true);

  ELSIF p_action IN ('verify', 'unlink') THEN
    SELECT s.id, s.email, s.organization_id, s.email_list INTO v_staff
      FROM public.org_staff s WHERE s.id = v_staff_id;
    IF NOT FOUND OR lower(btrim(coalesce(v_staff.email, ''))) IS DISTINCT FROM v_email THEN
      RETURN jsonb_build_object('ok', false, 'code', 'email_changed');
    END IF;
    IF p_action = 'verify' THEN
      UPDATE private.aka_staff_email_prompt
         SET verified_at = coalesce(verified_at, now()), updated_at = now()
       WHERE staff_id = v_staff_id;
      RETURN jsonb_build_object('ok', true, 'verified', true, 'already', v_prompt.verified_at IS NOT NULL);
    END IF;

    -- "Không phải tôi": gỡ email khỏi tài khoản (và tổ chức / CRM nếu lúc lưu là admin), trả lại email trước đó
    -- (email_list[2]) nếu có. Email bị gỡ vẫn nằm trong email_list.
    UPDATE public.org_staff s
       SET email = CASE WHEN s.email_list[1] = v_email THEN s.email_list[2] END
     WHERE s.id = v_staff_id AND lower(btrim(coalesce(s.email, ''))) = v_email;
    IF coalesce(v_prompt.saved_as_admin, false) THEN
      SELECT o.id, o.customer_id INTO v_org FROM public.org_organization o WHERE o.id = v_staff.organization_id;
      UPDATE public.org_organization o
         SET email = CASE WHEN o.email_list[1] = v_email THEN o.email_list[2] END
       WHERE o.id = v_org.id AND lower(btrim(coalesce(o.email, ''))) = v_email;
      IF v_prompt.crm_customer_id IS NOT NULL THEN
        UPDATE public.aka_customer c
           SET email = CASE WHEN c.email_list[1] = v_email THEN c.email_list[2] END
         WHERE c.id = v_prompt.crm_customer_id AND lower(btrim(coalesce(c.email, ''))) = v_email;
      END IF;
    END IF;
    UPDATE private.aka_staff_email_prompt
       SET saved_at = NULL, saved_email = NULL, saved_mode = NULL, verified_at = NULL, verify_sent_at = NULL,
           verify_next_at = NULL, verify_last_error = NULL, unlinked_at = now(), unlinked_email = v_email,
           updated_at = now()
     WHERE staff_id = v_staff_id;
    RETURN jsonb_build_object('ok', true, 'unlinked', true);
  END IF;

  RETURN jsonb_build_object('ok', false, 'code', 'invalid_action');
END
$function$;
COMMENT ON FUNCTION public.aka_agent_email_prompt_worker(text, jsonb) IS
  'V652: API Web: nhận việc gửi thư xác nhận email (claim / sent / failed) và xử lý link xác nhận / "Không phải tôi" (verify / unlink). service_role.';

-- Công tắc, mặc định tắt.
INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'account.email_prompt', '{"audience":"off"}',
       'V652: form xin email sau đăng nhập. audience: off | admin_akabiz | orgs (kèm organizationIds) | all.', false, true
 WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'account.email_prompt');

-- Quyền.
DO $grants$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.aka_staff_email_typo_fix(text)',
    'private.aka_staff_email_usable(text, text)',
    'private.aka_agent_email_prompt_core(bigint, text, jsonb)',
    'public.aka_agent_email_prompt(text, jsonb)',
    'public.aka_agent_control_email_prompt(bigint, bigint, text, jsonb)',
    'public.aka_agent_email_prompt_worker(text, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
  END LOOP;
END $grants$;
GRANT EXECUTE ON FUNCTION public.aka_agent_email_prompt(text, jsonb) TO aka_agent_desktop;
GRANT EXECUTE ON FUNCTION public.aka_agent_control_email_prompt(bigint, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_email_prompt_worker(text, jsonb) TO service_role;

DO $post$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(rolname || ':' || fn, ', ' ORDER BY rolname, fn) INTO v_bad
    FROM pg_roles
    CROSS JOIN (VALUES
      ('private.aka_agent_email_prompt_core(bigint, text, jsonb)', ARRAY[]::text[]),
      ('public.aka_agent_email_prompt(text, jsonb)', ARRAY['aka_agent_desktop']),
      ('public.aka_agent_control_email_prompt(bigint, bigint, text, jsonb)', ARRAY['service_role']),
      ('public.aka_agent_email_prompt_worker(text, jsonb)', ARRAY['service_role'])
    ) AS f(fn, allowed)
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, fn, 'EXECUTE') IS DISTINCT FROM (rolname = ANY (allowed));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V652 p2 postflight: quyền gọi hàm sai: %', v_bad; END IF;
  IF (public.aka_agent_email_prompt('state', '{}') ->> 'code') IS DISTINCT FROM 'no_session' THEN
    RAISE EXCEPTION 'V652 p2 postflight: ngoài phiên Desktop phải trả no_session';
  END IF;
  IF (public.aka_agent_control_email_prompt(NULL, NULL, 'state', '{}') ->> 'code') IS DISTINCT FROM 'staff_inactive' THEN
    RAISE EXCEPTION 'V652 p2 postflight: thiếu nhân viên phải trả staff_inactive';
  END IF;
  IF (SELECT value FROM public.auto_system_settings WHERE key = 'account.email_prompt' ORDER BY id LIMIT 1) IS NULL THEN
    RAISE EXCEPTION 'V652 p2 postflight: thiếu dòng công tắc account.email_prompt';
  END IF;
END $post$;

COMMIT;
