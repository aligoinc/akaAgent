-- Gỡ V654: trả private.aka_agent_email_prompt_core và public.aka_agent_email_prompt_worker về thân V652, bỏ 3 cột prev_*.
-- Sinh bằng: python3 scripts/staff-email-prompt/build-v654-sql.py.
BEGIN;
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION private.aka_agent_email_prompt_core(p_staff_id bigint, p_action text, p_payload jsonb)
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

CREATE OR REPLACE FUNCTION public.aka_agent_email_prompt_worker(p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
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

ALTER TABLE private.aka_staff_email_prompt DROP COLUMN IF EXISTS prev_staff_email, DROP COLUMN IF EXISTS prev_org_email,
  DROP COLUMN IF EXISTS prev_crm_email;
DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_email_prompt_core(bigint,text,jsonb)'::regprocedure) IS DISTINCT FROM '761ad6bcc42ea96628490e1ac8952f27'
     OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_email_prompt_worker(text,jsonb)'::regprocedure) IS DISTINCT FROM '90bfb299e1aa8ef46f8d26f9dfb8da12' THEN
    RAISE EXCEPTION 'gỡ V654: thân hàm khác V652';
  END IF;
END $post$;
COMMIT;
