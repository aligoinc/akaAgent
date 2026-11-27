-- V679: chặn chiến dịch Zalo dùng danh sách quét bằng tài khoản khác (DAT04). Phương án: docs/ZALO_UID_ACCOUNT_GUARD_PLAN.md.
--
-- 1) Hàm kiểm chỉ đọc private.aka_agent_campaign_uid_account_check (+ bản theo phiên Desktop và bản service_role cho API Web):
--    UID có trong zalo_users của tài khoản định dùng (hoặc tài khoản cùng nick, V657) = gửi được; chỉ có ở tài khoản khác cùng tổ chức
--    = không gửi được; không có ở đâu = không rõ (không chặn).
-- 2) Lúc chạy: người nhận gặp DAT04 được giữ lại (data "tạm dừng") thay vì đóng; câu DAT04 mới.
-- 3) Trigger: đổi tài khoản của chiến dịch thì người đang giữ vì DAT04 mà tài khoản mới gửi được về lại "chờ xử lý";
--    chiến dịch đã "hoàn thành" thì mở lại như khi Thêm data.
-- 4) Công tắc auto_system_settings campaign.uid_account_guard = block | off (thiếu dòng = block). Chỉ chặn khi lưu; không ảnh hưởng bước 2–3.
-- Không sửa bảng, không sửa hàm có sẵn. Có tạo hàm nên PostgREST nạp lại schema: apply buổi tối.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $pre$
BEGIN
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v679_%') THEN
    RAISE EXCEPTION 'v679: đã có trong sổ migration, không chạy lại';
  END IF;
  IF to_regprocedure('private.aka_agent_zalo_same_nick_accounts(bigint)') IS NULL THEN
    RAISE EXCEPTION 'v679: thiếu private.aka_agent_zalo_same_nick_accounts (V657)';
  END IF;
  IF to_regprocedure('private.aka_agent_staff_scope_for_request()') IS NULL THEN
    RAISE EXCEPTION 'v679: thiếu private.aka_agent_staff_scope_for_request()';
  END IF;
  IF to_regprocedure('private.aka_agent_campaign_uid_account_check(bigint,bigint,bigint[],text[])') IS NOT NULL
     OR to_regprocedure('private.aka_agent_campaign_uid_account_classify(bigint,bigint,bigint,text[])') IS NOT NULL
     OR to_regprocedure('public.aka_agent_campaign_uid_account_check_v1(jsonb)') IS NOT NULL
     OR to_regprocedure('public.aka_agent_control_campaign_uid_account_check(bigint,bigint,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'v679: hàm kiểm đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aka_agent_uid_account_release' AND tgrelid = 'public.auto_campaigns'::regclass) THEN
    RAISE EXCEPTION 'v679: trigger đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'campaign.uid_account_guard') THEN
    RAISE EXCEPTION 'v679: đã có dòng campaign.uid_account_guard';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_error WHERE id = 172 AND error_code = 'err_engine_zalo_uid_other_account' AND public_code = 'DAT04'
                   AND customer_title = 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được') THEN
    RAISE EXCEPTION 'v679: auto_error 172 (DAT04) đã đổi so với bản đọc 27/11/2026';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.auto_outcome_policies WHERE id = 426 AND error_code = 'err_engine_zalo_uid_other_account'
                   AND action_code IS NULL AND target_effect = 'complete' AND is_active AND NOT is_delete
                   AND log_template = 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được') THEN
    RAISE EXCEPTION 'v679: chính sách 426 (DAT04) đã đổi so với bản đọc 27/11/2026';
  END IF;
  IF (SELECT count(*) FROM public.auto_outcome_policies WHERE error_code = 'err_engine_zalo_uid_other_account' AND is_active AND NOT is_delete) <> 4 THEN
    RAISE EXCEPTION 'v679: số dòng chính sách DAT04 khác 4';
  END IF;
END
$pre$;

-- Loại chiến dịch gửi theo UID mà UID gắn theo tài khoản gửi.
CREATE FUNCTION private.aka_agent_uid_guard_action(p_action text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT p_action IN ('zalo_message_group_member', 'zalo_message_friend', 'zalo_message_remarketing_customer',
                      'zalo_cancel_sent_friend_request')
$$;

CREATE FUNCTION private.aka_agent_uid_guard_norm(p_uid text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  -- Bỏ mọi khoảng trắng (bộ ký tự như \s của JavaScript, cộng zero-width space) và một đuôi "_0" (một số dòng zalo_users ghi UID kèm đuôi này).
  SELECT NULLIF(regexp_replace(regexp_replace(coalesce(p_uid, ''), E'[\\s\u00a0\u1680\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff]+', '', 'g'), '_0$', ''), '')
$$;

-- Phân loại danh sách UID (đã chuẩn hoá, không trùng) cho một tài khoản. Tài khoản phải thuộc đúng nhân viên + tổ chức, là Zalo, chưa xoá.
CREATE FUNCTION private.aka_agent_campaign_uid_account_classify(p_org bigint, p_staff bigint, p_account_id bigint, p_uids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_acc record; v_nick bigint[]; v_res jsonb;
BEGIN
  SELECT a.id, a.name, a.staff_id, a.organization_id, a.flatform_type, a.is_delete INTO v_acc FROM public.auto_accounts a WHERE a.id = p_account_id;
  IF NOT FOUND OR v_acc.organization_id IS DISTINCT FROM p_org OR v_acc.staff_id IS DISTINCT FROM p_staff
     OR lower(btrim(coalesce(v_acc.flatform_type, ''))) <> 'zalo' OR coalesce(v_acc.is_delete, false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_account_not_found';
  END IF;
  v_nick := private.aka_agent_zalo_same_nick_accounts(v_acc.id);
  WITH u AS (SELECT DISTINCT x AS uid FROM unnest(coalesce(p_uids, '{}')) x WHERE x IS NOT NULL),
  k0 AS (
    SELECT u.uid, EXISTS (SELECT 1 FROM public.zalo_users z WHERE z.account_id = ANY (v_nick) AND z.zalo_uid IN (u.uid, u.uid || '_0')) own
      FROM u
  ),
  -- Chỉ tìm tài khoản đã quét cho người tài khoản này không gửi được (đo production 27/11: 5.436 người, 212 → 138 ms).
  k AS (
    SELECT k0.uid, k0.own,
           CASE WHEN k0.own THEN '{}'::bigint[] ELSE
             (SELECT coalesce(array_agg(DISTINCT z.account_id), '{}') FROM public.zalo_users z
                JOIN public.auto_accounts oa ON oa.id = z.account_id AND oa.organization_id = p_org
               WHERE z.zalo_uid IN (k0.uid, k0.uid || '_0') AND NOT (z.account_id = ANY (v_nick))) END owners
      FROM k0
  ),
  o AS (
    SELECT ow.owner, count(*) cnt FROM k CROSS JOIN LATERAL unnest(k.owners) ow(owner)
     WHERE NOT k.own GROUP BY ow.owner
  )
  SELECT jsonb_build_object(
    'accountId', v_acc.id, 'accountName', coalesce(v_acc.name, ''),
    'total', (SELECT count(*) FROM k),
    'own', (SELECT count(*) FROM k WHERE own),
    'blocked', (SELECT count(*) FROM k WHERE NOT own AND cardinality(owners) > 0),
    'unknown', (SELECT count(*) FROM k WHERE NOT own AND cardinality(owners) = 0),
    'blockedUids', (SELECT coalesce(jsonb_agg(uid ORDER BY uid), '[]') FROM k WHERE NOT own AND cardinality(owners) > 0),
    'owners', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'accountId', o.owner, 'accountName', coalesce(a.name, ''), 'count', o.cnt,
                 'usable', (a.staff_id = p_staff AND coalesce(a.is_delete, false) = false AND lower(btrim(coalesce(a.flatform_type, ''))) = 'zalo'))
                 ORDER BY o.cnt DESC, o.owner), '[]')
               FROM o JOIN public.auto_accounts a ON a.id = o.owner))
    INTO v_res;
  RETURN v_res;
END
$$;

-- Kiểm danh sách UID khách vừa nhập (tối đa 2.000 mỗi lượt, bên gọi chia lượt) với từng tài khoản định dùng (tối đa 50).
CREATE FUNCTION private.aka_agent_campaign_uid_account_check(p_org bigint, p_staff bigint, p_account_ids bigint[], p_uids text[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_id bigint; v_out jsonb := '[]'::jsonb; v_uids text[];
BEGIN
  IF p_org IS NULL OR p_staff IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_scope'; END IF;
  IF p_account_ids IS NULL OR cardinality(p_account_ids) = 0 OR cardinality(p_account_ids) > 50 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_accounts';
  END IF;
  IF p_uids IS NOT NULL AND cardinality(p_uids) > 2000 THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_too_many'; END IF;
  SELECT coalesce(array_agg(DISTINCT n), '{}') INTO v_uids
    FROM (SELECT private.aka_agent_uid_guard_norm(u) n FROM unnest(coalesce(p_uids, '{}')) u) x WHERE n IS NOT NULL;
  FOR v_id IN SELECT DISTINCT x FROM unnest(p_account_ids) x ORDER BY x LOOP
    v_out := v_out || jsonb_build_array(private.aka_agent_campaign_uid_account_classify(p_org, p_staff, v_id, v_uids));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'checked', cardinality(v_uids), 'accounts', v_out);
END
$$;

-- Người nhận đang chờ (và đang giữ vì DAT04) của một chiến dịch: 5.000 người đầu hàng đợi (đủ để biết danh sách có sai không;
-- người phía sau nếu sai vẫn được lưới lúc chạy giữ lại). Đo production 27/11: dữ liệu nguội ~1,2 ms / người.
CREATE FUNCTION private.aka_agent_campaign_uid_account_check_campaign(p_org bigint, p_staff bigint, p_campaign_id bigint, p_account_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  c record; v_account bigint; v_uids text[]; v_rows integer; v_res jsonb; v_blocked text[]; v_ids jsonb;
BEGIN
  SELECT id, action_id, account_id, staff_id, organization_id, data_target_source_mode, is_delete INTO c
    FROM public.auto_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND OR c.staff_id IS DISTINCT FROM p_staff OR (c.organization_id IS NOT NULL AND c.organization_id <> p_org)
     OR coalesce(c.is_delete, false) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_campaign_not_found';
  END IF;
  IF NOT private.aka_agent_uid_guard_action(c.action_id) OR coalesce(c.data_target_source_mode, 'direct') <> 'direct' THEN
    RETURN jsonb_build_object('ok', true, 'applies', false);
  END IF;
  v_account := coalesce(p_account_id, c.account_id);
  SELECT coalesce(array_agg(DISTINCT n) FILTER (WHERE n IS NOT NULL), '{}'), count(*) INTO v_uids, v_rows FROM (
    SELECT private.aka_agent_uid_guard_norm(d.uid) n FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false
       AND (d.status = 'chờ xử lý' OR (d.status = 'tạm dừng' AND d.note LIKE '%(DAT04)'))
       AND private.aka_agent_uid_guard_norm(d.uid) IS NOT NULL
     ORDER BY d.id LIMIT 5000) x;
  v_res := private.aka_agent_campaign_uid_account_classify(p_org, p_staff, v_account, v_uids);
  -- Đếm theo người nhận (dòng data), không theo UID khác nhau: data trùng UID vẫn là hai lượt gửi.
  SELECT coalesce(array_agg(x #>> '{}'), '{}') INTO v_blocked FROM jsonb_array_elements(v_res->'blockedUids') x;
  SELECT coalesce(jsonb_agg(d.id ORDER BY d.id), '[]') INTO v_ids FROM (
    SELECT d.id FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
       AND private.aka_agent_uid_guard_norm(d.uid) = ANY (v_blocked)
     ORDER BY d.id LIMIT 5000) d;
  RETURN jsonb_build_object('ok', true, 'applies', true, 'campaignId', c.id, 'currentAccountId', c.account_id,
    'checkedRows', v_rows, 'truncated', v_rows >= 5000, 'account', v_res - 'blockedUids',
    'blockedRows', jsonb_array_length(v_ids), 'blockedInputIds', v_ids);
END
$$;

-- Giữ lại (không gửi) những người đang chờ mà tài khoản hiện tại của chiến dịch không gửi được. Khách chọn "Bỏ N người này".
CREATE FUNCTION private.aka_agent_campaign_uid_account_hold(p_org bigint, p_staff bigint, p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_check jsonb; v_ids bigint[]; v_n integer;
BEGIN
  PERFORM 1 FROM public.auto_campaigns WHERE id = p_campaign_id AND staff_id = p_staff FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_campaign_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaigns WHERE id = p_campaign_id AND status = 'đang chạy') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_campaign_running';
  END IF;
  v_check := private.aka_agent_campaign_uid_account_check_campaign(p_org, p_staff, p_campaign_id, NULL);
  IF NOT coalesce((v_check->>'applies')::boolean, false) THEN RETURN jsonb_build_object('ok', true, 'held', 0); END IF;
  SELECT coalesce(array_agg((x #>> '{}')::bigint), '{}') INTO v_ids FROM jsonb_array_elements(v_check->'blockedInputIds') x;
  UPDATE public.auto_campaign_input_data d
     SET status = 'tạm dừng',
         note = 'Người nhận nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được (DAT04)'
   WHERE d.id = ANY (v_ids) AND d.campaign_id = p_campaign_id AND d.status = 'chờ xử lý';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'held', v_n);
END
$$;

CREATE FUNCTION private.aka_agent_campaign_uid_account_guard_mode()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN lower(btrim(coalesce((SELECT s.value FROM public.auto_system_settings s
                                          WHERE s.key = 'campaign.uid_account_guard' AND s.is_active IS TRUE LIMIT 1), 'block'))) = 'off'
              THEN 'off' ELSE 'block' END
$$;

-- Điều phối theo payload: {"mode":"uids","accountIds":[..],"uids":[..]} | {"mode":"campaign","campaignId":..,"accountId":..?}
-- | {"mode":"hold","campaignId":..}. Công tắc off: kiểm vẫn chạy nhưng trả "enabled": false để bên gọi không chặn.
CREATE FUNCTION private.aka_agent_campaign_uid_account_dispatch(p_org bigint, p_staff bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_mode text; v_accounts bigint[]; v_uids text[]; v_res jsonb; v_campaign bigint; v_account bigint;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_payload'; END IF;
  v_mode := p_payload->>'mode';
  IF v_mode IN ('campaign', 'hold') THEN
    IF coalesce(jsonb_typeof(p_payload->'campaignId'), '') <> 'number' OR coalesce(p_payload->>'campaignId', '') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_payload';
    END IF;
    v_campaign := (p_payload->>'campaignId')::bigint;
  END IF;
  IF v_mode = 'uids' THEN
    IF coalesce(jsonb_typeof(p_payload->'accountIds'), '') <> 'array' OR coalesce(jsonb_typeof(p_payload->'uids'), '') <> 'array'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'accountIds') e WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}') !~ '^[0-9]{1,18}$')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'uids') e WHERE jsonb_typeof(e) NOT IN ('string', 'number')) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_payload';
    END IF;
    SELECT array_agg((e #>> '{}')::bigint) INTO v_accounts FROM jsonb_array_elements(p_payload->'accountIds') e;
    SELECT coalesce(array_agg(e #>> '{}'), '{}') INTO v_uids FROM jsonb_array_elements(p_payload->'uids') e;
    v_res := private.aka_agent_campaign_uid_account_check(p_org, p_staff, v_accounts, v_uids);
  ELSIF v_mode = 'campaign' THEN
    IF p_payload ? 'accountId' AND jsonb_typeof(p_payload->'accountId') <> 'null' THEN
      IF coalesce(jsonb_typeof(p_payload->'accountId'), '') <> 'number' OR coalesce(p_payload->>'accountId', '') !~ '^[0-9]{1,18}$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_payload';
      END IF;
      v_account := (p_payload->>'accountId')::bigint;
    END IF;
    v_res := private.aka_agent_campaign_uid_account_check_campaign(p_org, p_staff, v_campaign, v_account);
  ELSIF v_mode = 'hold' THEN
    RETURN private.aka_agent_campaign_uid_account_hold(p_org, p_staff, v_campaign);
  ELSE
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'uid_guard_invalid_payload';
  END IF;
  RETURN v_res || jsonb_build_object('enabled', private.aka_agent_campaign_uid_account_guard_mode() = 'block');
END
$$;

-- Desktop: nhân viên lấy từ phiên.
CREATE FUNCTION public.aka_agent_campaign_uid_account_check_v1(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '15s' AS $$
DECLARE v_staff bigint := private.aka_agent_staff_scope_for_request(); v_org bigint;
BEGIN
  IF coalesce(v_staff, 0) <= 0 THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'uid_guard_no_session'; END IF;
  SELECT organization_id INTO v_org FROM public.org_staff WHERE id = v_staff AND is_active IS TRUE AND deleted_at IS NULL;
  IF v_org IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'uid_guard_no_session'; END IF;
  RETURN private.aka_agent_campaign_uid_account_dispatch(v_org, v_staff, p_payload);
END
$$;

-- API Web (service_role): nhân viên / tổ chức do API đã xác thực.
CREATE FUNCTION public.aka_agent_control_campaign_uid_account_check(p_staff_id bigint, p_organization_id bigint, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public SET statement_timeout = '15s' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active IS TRUE AND deleted_at IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'uid_guard_no_session';
  END IF;
  RETURN private.aka_agent_campaign_uid_account_dispatch(p_organization_id, p_staff_id, p_payload);
END
$$;

-- Đổi tài khoản: người đang giữ vì DAT04 mà tài khoản mới gửi được về lại hàng đợi.
CREATE FUNCTION private.aka_agent_uid_account_release()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_nick bigint[]; v_n integer;
BEGIN
  IF NEW.account_id IS NULL OR coalesce(NEW.is_delete, false) OR NOT private.aka_agent_uid_guard_action(NEW.action_id) THEN RETURN NULL; END IF;
  v_nick := private.aka_agent_zalo_same_nick_accounts(NEW.account_id);
  UPDATE public.auto_campaign_input_data d
     SET status = 'chờ xử lý', note = NULL
   WHERE d.campaign_id = NEW.id AND coalesce(d.is_delete, false) = false
     AND d.status = 'tạm dừng' AND d.note LIKE '%(DAT04)'
     AND EXISTS (SELECT 1 FROM public.zalo_users z
                  WHERE z.account_id = ANY (v_nick)
                    AND z.zalo_uid IN (private.aka_agent_uid_guard_norm(d.uid), private.aka_agent_uid_guard_norm(d.uid) || '_0'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 AND NEW.status = 'hoàn thành' THEN
    -- Như reopenCompletedCampaignAfterInputInsert của Desktop.
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, completed_at = NULL, updated_at = clock_timestamp()
     WHERE id = NEW.id AND status = 'hoàn thành' AND coalesce(is_delete, false) = false;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER trg_aka_agent_uid_account_release
  AFTER UPDATE OF account_id ON public.auto_campaigns
  FOR EACH ROW WHEN (OLD.account_id IS DISTINCT FROM NEW.account_id)
  EXECUTE FUNCTION private.aka_agent_uid_account_release();

-- Quyền: schema private có USAGE cho nhiều vai trò, hàm mới mặc định cho PUBLIC chạy, và Supabase cấp sẵn hàm mới trong public
-- cho anon / authenticated / service_role (default privileges) nên phải thu từng vai trò.
REVOKE ALL ON FUNCTION private.aka_agent_uid_guard_action(text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_uid_guard_norm(text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_uid_account_classify(bigint, bigint, bigint, text[]) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_uid_account_check(bigint, bigint, bigint[], text[]) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_uid_account_check_campaign(bigint, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_uid_account_hold(bigint, bigint, bigint) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_uid_account_guard_mode() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_campaign_uid_account_dispatch(bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION private.aka_agent_uid_account_release() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION public.aka_agent_campaign_uid_account_check_v1(jsonb) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
REVOKE ALL ON FUNCTION public.aka_agent_control_campaign_uid_account_check(bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop, aka_agent_chat_api;
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_uid_account_check_v1(jsonb) TO aka_agent_desktop;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.aka_agent_control_campaign_uid_account_check(bigint, bigint, jsonb) TO service_role;
  END IF;
END
$grant$;

-- Lúc chạy: giữ người nhận lại (data "tạm dừng"), câu mới. Dòng theo thao tác (427–429) giữ nguyên: không tính lượt,
-- 4 người liền thì tạm dừng chiến dịch.
UPDATE public.auto_outcome_policies
   SET target_effect = 'hold',
       log_template = 'Người nhận nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được. Hãy chọn lại tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này',
       campaign_note_template = 'Người nhận nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được. Hãy chọn lại tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này',
       description = description || ' [V679] Giữ người nhận lại (hold) thay vì đóng; câu mới.',
       revision = revision + 1, updated_by = 'migration_v679', updated_at = now()
 WHERE id = 426;
UPDATE public.auto_error
   SET customer_title = 'Người nhận nằm trong danh sách quét bằng tài khoản Zalo khác nên tài khoản này không gửi được',
       customer_help = 'Chọn lại tài khoản đã quét danh sách, hoặc quét lại danh sách bằng tài khoản này.',
       updated_at = now()
 WHERE id = 172;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('campaign.uid_account_guard', 'block',
        'V679: chặn lưu chiến dịch Zalo theo UID khi danh sách được quét bằng tài khoản khác. block | off (thiếu dòng = block).', false, true);

DO $post$
BEGIN
  IF (SELECT target_effect FROM public.auto_outcome_policies WHERE id = 426) <> 'hold' THEN RAISE EXCEPTION 'v679: chính sách 426 chưa đổi'; END IF;
  IF has_function_privilege('anon', 'public.aka_agent_control_campaign_uid_account_check(bigint,bigint,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.aka_agent_campaign_uid_account_check_v1(jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.aka_agent_campaign_uid_account_check_v1(jsonb)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'public.aka_agent_control_campaign_uid_account_check(bigint,bigint,jsonb)', 'EXECUTE')
     OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_campaign_uid_account_hold(bigint,bigint,bigint)', 'EXECUTE')
     OR NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_uid_account_check_v1(jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.aka_agent_control_campaign_uid_account_check(bigint,bigint,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'v679: quyền chạy hàm sai';
  END IF;
END
$post$;

COMMIT;
