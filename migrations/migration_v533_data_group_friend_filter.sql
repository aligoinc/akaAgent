-- Lọc bạn bè Zalo theo bộ lọc JSON và tạo nhóm khách hàng từ kết quả ("Thêm nhóm khách hàng bằng Agent", Web).
-- Phương án: akaAgentWebApp docs/DATA_GROUP_FRIEND_AGENT_PLAN.md; hợp đồng: packages/control-api/src/zaloFriendFilter.ts;
-- hướng dẫn, kiểm thử, triển khai: docs/DATA_GROUP_FRIEND_AGENT.md.
--
-- Thêm: một bảng (public.auto_data_group_friend_filters, RLS bật, không policy, không ai được đọc/ghi trực tiếp), các hàm
-- private dùng chung và năm RPC chỉ cấp cho service_role (backend WebApp, singleton sẵn có, danh tính từ phiên):
--   aka_agent_list_zalo_friend_accounts_v1        tài khoản Zalo + số bạn bè + giờ cập nhật danh bạ (chỉ đọc)
--   aka_agent_read_zalo_friend_catalog_v1         danh mục cho Agent: tag Zalo (kèm số bạn bè), tag akaBiz, nhóm khách
--                                                 hàng đọc được, chiến dịch đã nhắn tin bằng tài khoản (chỉ đọc)
--   aka_agent_read_zalo_friend_filter_v1          đánh giá bộ lọc: count | page (≤ 100 dòng) | ids (≤ 5.000) (chỉ đọc)
--   aka_agent_create_data_group_from_friend_filter_v1  đánh giá lại bộ lọc, tạo nhóm "Zalo · User theo UID" gắn tài khoản,
--                                                 nạp thành viên bằng hàm nạp sẵn có, lưu bộ lọc; MỘT giao dịch
--   aka_agent_get_data_group_friend_filter_v1     bộ lọc đã lưu của một nhóm (chỉ đọc)
-- Không thêm cột, index, trigger, job, cài đặt, kết nối hay pool; không sửa hàm hay bảng có sẵn.
--
-- Luật đánh giá (một tài khoản, một câu lệnh, private.zalo_friend_filter_rows_v1):
--   * Bạn bè: liên hệ 'person' chưa xoá của tài khoản, đúng nhân viên/tổ chức, is_friend IS TRUE (cột "Bạn bè" của trang
--     Lấy danh bạ Zalo, V421), có uid. Hồ sơ zalo_users nối theo zalo_user_id như bộ lọc cột V441.
--   * Lượt nhắn: auto_campaign_details của tài khoản, action_code zalo_message_friend | zalo_message_stranger, chưa xoá,
--     thuộc chiến dịch của đúng nhân viên/tổ chức. Thành công = tập trạng thái của idx_campaign_details_delivery_cooldown;
--     lỗi = 'thất bại' | 'lỗi'; trạng thái khác không tính. Người nhận theo đúng thứ tự của V441 remarketing.
--   * Bậc của một lượt: lỗi; thành công + theo dõi V339: phản hồi > thả cảm xúc > xem > đã gửi; không theo dõi: unknown.
--   * Khoảng thời gian theo lịch Việt Nam, tối đa 365 ngày tính cả hôm nay.
-- Mỗi loại điều kiện là một nhánh CASE cố định trên dữ liệu đã có kiểu; không ghép chuỗi SQL từ dữ liệu người dùng.
-- Index dùng: idx_auto_account_contacts_account_type, idx_auto_campaign_details_action_rate, khoá chính của
-- auto_campaign_input_data / auto_campaign_detail_zalo_engagement / auto_campaigns, idx_auto_account_contact_group_members_active.
-- Rollback: rollback_data_group_friend_filter.sql (giữ bảng: nhóm đã tạo vẫn dùng được).
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regprocedure('public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)') IS NOT NULL
    OR to_regprocedure('public.aka_agent_get_data_group_friend_filter_v1(bigint,bigint,text,text,bigint)') IS NOT NULL
    OR to_regprocedure('private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'friend_filter_target_already_exists_do_not_overwrite';
  END IF;
  IF to_regclass('public.auto_account_contacts') IS NULL OR to_regclass('public.zalo_users') IS NULL
    OR to_regclass('public.auto_campaign_details') IS NULL OR to_regclass('public.auto_campaign_input_data') IS NULL
    OR to_regclass('public.auto_campaign_detail_zalo_engagement') IS NULL OR to_regclass('public.auto_campaigns') IS NULL
    OR to_regclass('public.auto_zalo_message_opt_outs') IS NULL OR to_regclass('public.auto_contact_tags') IS NULL
    OR to_regclass('public.auto_account_contact_groups') IS NULL OR to_regclass('public.auto_account_contact_group_members') IS NULL
    OR to_regclass('public.auto_accounts') IS NULL OR to_regclass('public.org_staff') IS NULL
    OR to_regclass('public.category_item') IS NULL OR to_regclass('public.category_type') IS NULL
    OR to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL
    OR to_regprocedure('public.aka_agent_internal_require_staff_tenant(bigint,bigint)') IS NULL
    OR to_regprocedure('public.aka_agent_data_group_account_available(bigint,bigint,bigint)') IS NULL
    OR to_regprocedure('public.aka_agent_create_data_group_v2(bigint,bigint,text,text,text,bigint,bigint,text,text)') IS NULL
    OR to_regprocedure('public.aka_agent_ingest_data_group(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text,bigint)') IS NULL
    OR to_regprocedure('private.column_filter_zalo_tags_v1(jsonb)') IS NULL
    OR to_regprocedure('private.column_filter_phone_v1(text)') IS NULL
    OR to_regprocedure('private.can_read_data_group(bigint,bigint,bigint)') IS NULL THEN
    RAISE EXCEPTION 'friend_filter_dependency_missing';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_campaign_detail_zalo_engagement'
      AND column_name IN ('campaign_detail_id', 'account_id', 'organization_id', 'staff_id', 'sent_at', 'seen_at', 'reacted_at', 'responded_at')) <> 8
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_account_contacts'
      AND column_name IN ('id', 'account_id', 'contact_type', 'uid', 'name', 'phone', 'extra_data', 'is_delete', 'is_friend', 'zalo_user_id', 'akabiz_tag_ids', 'staff_id', 'organization_id', 'updated_at')) <> 14
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'zalo_users'
      AND column_name IN ('id', 'account_id', 'staff_id', 'organization_id', 'zalo_name', 'gender', 'sdob', 'dob', 'phone_number', 'raw_payload', 'is_blocked', 'global_id', 'updated_at')) <> 13
    OR (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'auto_account_contact_groups'
      AND column_name IN ('id', 'note', 'sharing_scope', 'purpose', 'is_delete', 'data_type_category_item_id', 'bound_zalo_account_id', 'staff_id', 'organization_id')) <> 9 THEN
    RAISE EXCEPTION 'friend_filter_dependency_shape_changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.category_type t JOIN public.category_item i ON i.category_type_id = t.id
      WHERE t.namespace = 'common' AND t.code = 'data_type' AND i.code = 'zalo_person') THEN
    RAISE EXCEPTION 'friend_filter_zalo_person_type_missing';
  END IF;
END
$preflight$;

CREATE SCHEMA IF NOT EXISTS private;

-- ---------------------------------------------------------------------------------------------------------------
-- Bộ lọc của nhóm tạo bằng Agent. Rollback giữ bảng (nhóm vẫn dùng được); áp lại thì dùng tiếp bảng cũ.
CREATE TABLE IF NOT EXISTS public.auto_data_group_friend_filters (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.auto_account_contact_groups(id) ON DELETE CASCADE,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  account_id bigint NOT NULL,
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 80),
  request_hash text NOT NULL,
  filter jsonb NOT NULL CHECK (jsonb_typeof(filter) = 'object'),
  filter_version smallint NOT NULL DEFAULT 1 CHECK (filter_version = 1),
  summary text[] NOT NULL DEFAULT '{}' CHECK (cardinality(summary) <= 40),
  matched_count integer NOT NULL CHECK (matched_count >= 0),
  inserted_count integer NOT NULL CHECK (inserted_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz NOT NULL DEFAULT now(),
  run_count integer NOT NULL DEFAULT 1 CHECK (run_count >= 1),
  last_batch_id bigint,
  CONSTRAINT auto_data_group_friend_filters_group_key UNIQUE (group_id),
  CONSTRAINT auto_data_group_friend_filters_request_key UNIQUE (staff_id, organization_id, request_id)
);
ALTER TABLE public.auto_data_group_friend_filters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_data_group_friend_filters FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON TABLE public.auto_data_group_friend_filters IS
  'Bộ lọc bạn bè Zalo (ZaloFriendFilter v1) đã dùng để tạo nhóm khách hàng bằng Agent, kèm tóm tắt người dùng đã xác nhận. Chỉ ghi/đọc qua RPC aka_agent_*friend_filter*_v1.';

-- ---------------------------------------------------------------------------------------------------------------
-- Hàm nhỏ dùng chung

CREATE FUNCTION private.zalo_friend_json_keys_v1(p_value jsonb, p_keys text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'object'
    THEN (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM jsonb_object_keys(p_value) AS k)
       = (SELECT coalesce(array_agg(k ORDER BY k), '{}') FROM unnest(p_keys) AS k)
    ELSE false END
$fn$;

CREATE FUNCTION private.zalo_friend_json_int_v1(p_value jsonb, p_min bigint, p_max bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE WHEN jsonb_typeof(p_value) = 'number' AND p_value::text ~ '^-?[0-9]{1,16}$'
    THEN (p_value::text)::bigint BETWEEN p_min AND p_max ELSE false END
$fn$;

/** Ngày 'YYYY-MM-DD' hợp lệ (không ném lỗi với ngày không tồn tại), null nếu không hợp lệ. */
CREATE FUNCTION private.zalo_friend_json_date_v1(p_value jsonb) RETURNS date
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_text text; v_year int; v_month int; v_day int;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RETURN NULL; END IF;
  v_text := p_value #>> '{}';
  IF v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  v_year := substr(v_text, 1, 4)::int; v_month := substr(v_text, 6, 2)::int; v_day := substr(v_text, 9, 2)::int;
  IF v_year NOT BETWEEN 2000 AND 2200 OR v_month NOT BETWEEN 1 AND 12 OR v_day < 1
    OR v_day > extract(day FROM (make_date(v_year, v_month, 1) + interval '1 month' - interval '1 day'))::int THEN
    RETURN NULL;
  END IF;
  RETURN make_date(v_year, v_month, v_day);
END
$fn$;

/** [đầu, cuối) theo lịch Việt Nam của một khoảng FriendPeriod; null = 365 ngày gần nhất. */
CREATE FUNCTION private.zalo_friend_period_v1(p_period jsonb, p_today date) RETURNS tstzrange
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT tstzrange(
    (CASE p_period->>'type'
       WHEN 'last_days' THEN p_today - ((p_period->>'days')::int - 1)
       WHEN 'range' THEN (p_period->>'from')::date
       ELSE p_today - 364 END)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',
    (CASE p_period->>'type'
       WHEN 'range' THEN (p_period->>'to')::date + 1
       ELSE p_today + 1 END)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',
    '[)')
$fn$;

/** Lượt tin đầu tiên có theo dõi xem/cảm xúc/phản hồi (V339) của tài khoản: một mục index auto_campaign_engagement_deadline. */
CREATE FUNCTION private.zalo_friend_tracking_since_v1(p_staff_id bigint, p_organization_id bigint, p_account bigint) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT e.sent_at FROM public.auto_campaign_detail_zalo_engagement AS e
  WHERE e.organization_id = p_organization_id AND e.staff_id = p_staff_id AND e.account_id = p_account
  ORDER BY e.account_zalo_uid, e.tracking_until LIMIT 1
$fn$;

/** Ngày sinh dạng tháng*100+ngày: sdob 'dd/mm' hoặc 'dd/mm/yyyy'; không có thì dob (giây, nửa đêm giờ Việt Nam). */
CREATE FUNCTION private.zalo_friend_birthday_v1(p_sdob text, p_dob bigint) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT CASE
    WHEN btrim(coalesce(p_sdob, '')) ~ '^[0-9]{1,2}/[0-9]{1,2}(/[0-9]{4})?$' THEN (
      SELECT CASE WHEN m BETWEEN 1 AND 12 AND d BETWEEN 1 AND 31 THEN m * 100 + d END
      FROM (SELECT split_part(btrim(p_sdob), '/', 1)::int AS d, split_part(btrim(p_sdob), '/', 2)::int AS m) AS parts)
    WHEN p_dob IS NOT NULL AND p_dob <> 0 AND p_dob BETWEEN -5000000000 AND 5000000000 THEN
      to_char(timestamp '1970-01-01 00:00:00' + (p_dob + 25200) * interval '1 second', 'MMDD')::int
  END
$fn$;

/** Sinh nhật (tháng*100+ngày) rơi vào [hôm nay, hôm nay + N ngày]; 29/2 năm thường tính ngày 28/2, ngày quá cuối tháng tính ngày cuối. */
CREATE FUNCTION private.zalo_friend_birthday_soon_v1(p_mmdd integer, p_today date, p_days integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $fn$
  WITH parts AS (SELECT p_mmdd / 100 AS m, p_mmdd % 100 AS d, extract(year FROM p_today)::int AS y),
  candidates AS (
    SELECT make_date(y + k, m, least(d, extract(day FROM (make_date(y + k, m, 1) + interval '1 month' - interval '1 day'))::int)) AS day
    FROM parts, generate_series(0, 1) AS k
    WHERE m BETWEEN 1 AND 12 AND d BETWEEN 1 AND 31
  )
  SELECT coalesce((SELECT min(day) FROM candidates WHERE day >= p_today) - p_today <= p_days, false)
$fn$;

/**
 * Khối lượng tin của tài khoản: thời điểm của lượt nhắn thứ (p_max + 1) mới nhất trong khoảng, null nếu khoảng có tối đa
 * p_max lượt. Hai nhánh đọc lùi theo idx_auto_campaign_details_action_rate (mỗi loại hành động tối đa p_max + 1 mục index),
 * nên chi phí không vượt p_max dù tài khoản gửi hàng chục nghìn tin mỗi ngày (production 14/11/2026: tài khoản nặng nhất
 * gửi ~10.600 tin bạn bè/ngày; đọc nguội ~0,4 ms mỗi lượt).
 */
CREATE FUNCTION private.zalo_friend_send_cutoff_v1(p_account bigint, p_since timestamptz, p_until timestamptz, p_max integer) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
  SELECT u.created_at FROM (
    (SELECT d.created_at FROM public.auto_campaign_details AS d
      WHERE d.account_id = p_account AND d.action_code = 'zalo_message_friend' AND d.is_delete = false
        AND d.created_at >= p_since AND d.created_at < p_until
      ORDER BY d.created_at DESC LIMIT p_max + 1)
    UNION ALL
    (SELECT d.created_at FROM public.auto_campaign_details AS d
      WHERE d.account_id = p_account AND d.action_code = 'zalo_message_stranger' AND d.is_delete = false
        AND d.created_at >= p_since AND d.created_at < p_until
      ORDER BY d.created_at DESC LIMIT p_max + 1)
  ) AS u
  ORDER BY u.created_at DESC OFFSET p_max LIMIT 1
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- Kiểm hợp lệ (lớp thứ ba, sau Structured Outputs và packages/control-api): kiểu, khóa, danh sách, giới hạn.
-- Lỗi: 'invalid_friend_filter' (22023), DETAIL = đường dẫn khóa, HINT = lý do.

CREATE FUNCTION private.zalo_friend_filter_check_v1(p_filter jsonb, p_today date) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  v_group jsonb; v_cond jsonb; v_item jsonb; v_period jsonb;
  v_gi integer := -1; v_ci integer; v_total integer := 0; v_path text; v_field text; v_op text;
  v_from date; v_to date; v_count integer; v_ok boolean;
  c_set_ops constant text[] := ARRAY['has_any', 'has_all', 'has_none', 'tagged', 'untagged'];
  c_stages constant text[] := ARRAY['never_sent', 'failed', 'unknown', 'sent', 'delivered', 'seen', 'reacted', 'replied'];
  c_fields constant text[] := ARRAY['zalo_tag', 'akabiz_tag', 'gender', 'birthday', 'phone', 'name', 'sent_count', 'latest_message',
    'messages_in_period', 'interaction', 'campaign', 'data_group'];
BEGIN
  IF NOT private.zalo_friend_json_keys_v1(p_filter, ARRAY['version', 'source', 'accountId', 'match', 'groups', 'excludeOptedOut', 'excludeBlocked', 'sort', 'limit']) THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter', HINT = 'keys';
  END IF;
  IF p_filter->'version' IS DISTINCT FROM '1'::jsonb THEN RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.version', HINT = 'version'; END IF;
  IF p_filter->'source' IS DISTINCT FROM '"zalo_friends"'::jsonb THEN RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.source', HINT = 'source'; END IF;
  IF NOT private.zalo_friend_json_int_v1(p_filter->'accountId', 1, 9007199254740991) THEN RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.accountId', HINT = 'id'; END IF;
  IF coalesce(p_filter->>'match', '') NOT IN ('all', 'any') OR jsonb_typeof(p_filter->'match') <> 'string' THEN RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.match', HINT = 'enum'; END IF;
  -- Bản đầu luôn loại khách đã từ chối nhận tin.
  IF p_filter->'excludeOptedOut' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.excludeOptedOut', HINT = 'must be true'; END IF;
  IF jsonb_typeof(p_filter->'excludeBlocked') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.excludeBlocked', HINT = 'boolean'; END IF;
  IF p_filter->'limit' <> 'null'::jsonb AND NOT private.zalo_friend_json_int_v1(p_filter->'limit', 1, 5000) THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.limit', HINT = '1-5000';
  END IF;
  IF p_filter->'sort' <> 'null'::jsonb THEN
    IF NOT private.zalo_friend_json_keys_v1(p_filter->'sort', ARRAY['by', 'direction', 'seed'])
      OR jsonb_typeof(p_filter#>'{sort,by}') IS DISTINCT FROM 'string' OR p_filter#>>'{sort,by}' NOT IN ('last_sent_at', 'last_interaction_at', 'name', 'random')
      OR jsonb_typeof(p_filter#>'{sort,direction}') IS DISTINCT FROM 'string' OR p_filter#>>'{sort,direction}' NOT IN ('asc', 'desc') THEN
      RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.sort', HINT = 'sort';
    END IF;
    IF p_filter#>>'{sort,by}' = 'random' THEN
      IF jsonb_typeof(p_filter#>'{sort,seed}') IS DISTINCT FROM 'string' OR p_filter#>>'{sort,seed}' !~ '^[A-Za-z0-9_-]{1,64}$' THEN
        RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.sort.seed', HINT = 'seed';
      END IF;
    ELSIF p_filter#>'{sort,seed}' <> 'null'::jsonb THEN
      RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.sort.seed', HINT = 'null';
    END IF;
  END IF;
  IF jsonb_typeof(p_filter->'groups') IS DISTINCT FROM 'array' OR jsonb_array_length(p_filter->'groups') > 5 THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.groups', HINT = '0-5 groups';
  END IF;

  FOR v_group IN SELECT value FROM jsonb_array_elements(p_filter->'groups') LOOP
    v_gi := v_gi + 1;
    v_path := format('filter.groups[%s]', v_gi);
    IF NOT private.zalo_friend_json_keys_v1(v_group, ARRAY['match', 'conditions'])
      OR jsonb_typeof(v_group->'match') IS DISTINCT FROM 'string' OR v_group->>'match' NOT IN ('all', 'any') THEN
      RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = v_path, HINT = 'group';
    END IF;
    IF jsonb_typeof(v_group->'conditions') IS DISTINCT FROM 'array' OR jsonb_array_length(v_group->'conditions') NOT BETWEEN 1 AND 10 THEN
      RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = v_path || '.conditions', HINT = '1-10 conditions';
    END IF;
    v_total := v_total + jsonb_array_length(v_group->'conditions');
    v_ci := -1;
    FOR v_cond IN SELECT value FROM jsonb_array_elements(v_group->'conditions') LOOP
      v_ci := v_ci + 1;
      v_path := format('filter.groups[%s].conditions[%s]', v_gi, v_ci);
      v_field := CASE WHEN jsonb_typeof(v_cond) = 'object' AND jsonb_typeof(v_cond->'field') = 'string' THEN v_cond->>'field' END;
      IF v_field IS NULL OR NOT v_field = ANY (c_fields) THEN
        RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = v_path || '.field', HINT = 'field';
      END IF;
      v_op := CASE WHEN jsonb_typeof(v_cond->'op') = 'string' THEN v_cond->>'op' END;
      v_ok := CASE v_field
        WHEN 'zalo_tag' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'tagIds']) AND v_op = ANY (c_set_ops)
          AND jsonb_typeof(v_cond->'tagIds') = 'array' AND jsonb_array_length(v_cond->'tagIds') <= 50
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'tagIds') AS t
            WHERE jsonb_typeof(t) <> 'string' OR btrim(t #>> '{}') = '' OR char_length(t #>> '{}') > 100 OR t #>> '{}' ~ '[[:cntrl:]]')
          AND (CASE WHEN v_op IN ('tagged', 'untagged') THEN jsonb_array_length(v_cond->'tagIds') = 0 ELSE jsonb_array_length(v_cond->'tagIds') > 0 END)
        WHEN 'akabiz_tag' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'tagIds']) AND v_op = ANY (c_set_ops)
          AND jsonb_typeof(v_cond->'tagIds') = 'array' AND jsonb_array_length(v_cond->'tagIds') <= 50
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'tagIds') AS t WHERE NOT private.zalo_friend_json_int_v1(t, 1, 9007199254740991))
          AND (CASE WHEN v_op IN ('tagged', 'untagged') THEN jsonb_array_length(v_cond->'tagIds') = 0 ELSE jsonb_array_length(v_cond->'tagIds') > 0 END)
        WHEN 'gender' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'values'])
          AND jsonb_typeof(v_cond->'values') = 'array' AND jsonb_array_length(v_cond->'values') BETWEEN 1 AND 3
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'values') AS t WHERE jsonb_typeof(t) <> 'string' OR t #>> '{}' NOT IN ('male', 'female', 'unknown'))
        WHEN 'birthday' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'months', 'days'])
          AND jsonb_typeof(v_cond->'months') = 'array' AND jsonb_array_length(v_cond->'months') <= 12
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'months') AS t WHERE NOT private.zalo_friend_json_int_v1(t, 1, 12))
          AND CASE v_op
            WHEN 'in_months' THEN jsonb_array_length(v_cond->'months') > 0 AND v_cond->'days' = 'null'::jsonb
            WHEN 'in_next_days' THEN jsonb_array_length(v_cond->'months') = 0 AND private.zalo_friend_json_int_v1(v_cond->'days', 0, 31)
            WHEN 'unknown' THEN jsonb_array_length(v_cond->'months') = 0 AND v_cond->'days' = 'null'::jsonb
            ELSE false END
        WHEN 'phone' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op']) AND v_op IN ('has', 'missing')
        WHEN 'name' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'text']) AND v_op IN ('contains', 'not_contains', 'starts_with')
          AND jsonb_typeof(v_cond->'text') = 'string' AND char_length(btrim(v_cond->>'text')) BETWEEN 1 AND 100 AND v_cond->>'text' !~ '[[:cntrl:]]'
        WHEN 'sent_count' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'period', 'op', 'value', 'valueTo']) AND v_op IN ('eq', 'gte', 'lte', 'between')
          AND private.zalo_friend_json_int_v1(v_cond->'value', 0, 1000)
          AND CASE WHEN v_op = 'between' THEN private.zalo_friend_json_int_v1(v_cond->'valueTo', 0, 1000) AND (v_cond->>'valueTo')::int >= (v_cond->>'value')::int
            ELSE v_cond->'valueTo' = 'null'::jsonb END
        WHEN 'latest_message' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'stages', 'period']) AND v_op IN ('in', 'not_in')
          AND jsonb_typeof(v_cond->'stages') = 'array' AND jsonb_array_length(v_cond->'stages') BETWEEN 1 AND 8
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'stages') AS t WHERE jsonb_typeof(t) <> 'string' OR NOT (t #>> '{}') = ANY (c_stages))
        WHEN 'messages_in_period' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'period', 'quantifier', 'status', 'amongSent'])
          AND jsonb_typeof(v_cond->'quantifier') = 'string' AND v_cond->>'quantifier' IN ('any', 'none')
          AND jsonb_typeof(v_cond->'status') = 'string' AND v_cond->>'status' IN ('sent', 'failed', 'seen', 'reacted', 'replied')
          AND jsonb_typeof(v_cond->'amongSent') = 'boolean'
        WHEN 'interaction' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'kinds', 'op', 'period']) AND v_op IN ('within', 'not_within')
          AND jsonb_typeof(v_cond->'kinds') = 'array' AND jsonb_array_length(v_cond->'kinds') BETWEEN 1 AND 3
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'kinds') AS t WHERE jsonb_typeof(t) <> 'string' OR t #>> '{}' NOT IN ('seen', 'reacted', 'replied'))
        WHEN 'campaign' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'campaignIds', 'period']) AND v_op IN ('received', 'not_received')
          AND jsonb_typeof(v_cond->'campaignIds') = 'array' AND jsonb_array_length(v_cond->'campaignIds') BETWEEN 1 AND 20
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'campaignIds') AS t WHERE NOT private.zalo_friend_json_int_v1(t, 1, 9007199254740991))
        WHEN 'data_group' THEN private.zalo_friend_json_keys_v1(v_cond, ARRAY['field', 'op', 'groupIds']) AND v_op IN ('in', 'not_in')
          AND jsonb_typeof(v_cond->'groupIds') = 'array' AND jsonb_array_length(v_cond->'groupIds') BETWEEN 1 AND 20
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_cond->'groupIds') AS t WHERE NOT private.zalo_friend_json_int_v1(t, 1, 9007199254740991))
      END;
      IF NOT coalesce(v_ok, false) THEN
        RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = v_path, HINT = v_field;
      END IF;
      -- Khoảng thời gian (bắt buộc hoặc null tùy loại điều kiện), tối đa 365 ngày tính cả hôm nay.
      IF v_field IN ('sent_count', 'latest_message', 'messages_in_period', 'interaction', 'campaign') THEN
        v_period := v_cond->'period';
        IF v_period = 'null'::jsonb AND v_field IN ('latest_message', 'campaign') THEN CONTINUE; END IF;
        v_ok := private.zalo_friend_json_keys_v1(v_period, ARRAY['type', 'days', 'from', 'to'])
          AND jsonb_typeof(v_period->'type') = 'string'
          AND CASE v_period->>'type'
            WHEN 'last_days' THEN private.zalo_friend_json_int_v1(v_period->'days', 1, 365) AND v_period->'from' = 'null'::jsonb AND v_period->'to' = 'null'::jsonb
            WHEN 'all' THEN v_period->'days' = 'null'::jsonb AND v_period->'from' = 'null'::jsonb AND v_period->'to' = 'null'::jsonb
            WHEN 'range' THEN v_period->'days' = 'null'::jsonb
            ELSE false END;
        IF NOT coalesce(v_ok, false) THEN
          RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = v_path || '.period', HINT = 'period';
        END IF;
        IF v_period->>'type' = 'range' THEN
          v_from := private.zalo_friend_json_date_v1(v_period->'from');
          v_to := private.zalo_friend_json_date_v1(v_period->'to');
          IF v_from IS NULL OR v_to IS NULL OR v_from > v_to OR v_to > p_today OR v_from < p_today - 364 THEN
            RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = v_path || '.period', HINT = 'range within the last 365 days';
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;
  IF v_total > 20 THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'filter.groups', HINT = 'at most 20 conditions';
  END IF;
END
$fn$;

/**
 * Phạm vi: nhân viên còn hoạt động, tài khoản Zalo của đúng nhân viên/tổ chức, chưa xoá, gói cho dùng với nhóm khách
 * hàng; mọi mã tag/nhóm/chiến dịch thuộc đúng phạm vi. Sai thì ném mã lỗi cố định.
 */
CREATE FUNCTION private.zalo_friend_filter_scope_v1(p_staff_id bigint, p_organization_id bigint, p_filter jsonb) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE v_account bigint := (p_filter->>'accountId')::bigint; v_missing text;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NOT EXISTS (SELECT 1 FROM public.auto_accounts a WHERE a.id = v_account AND a.staff_id = p_staff_id
      AND a.organization_id = p_organization_id AND a.flatform_type = 'zalo' AND a.is_delete IS NOT TRUE)
    OR NOT public.aka_agent_data_group_account_available(v_account, p_staff_id, p_organization_id) THEN
    RAISE EXCEPTION 'friend_filter_account_unavailable';
  END IF;
  SELECT string_agg(DISTINCT c->>'field', ',') INTO v_missing
  FROM jsonb_array_elements(p_filter->'groups') AS g, jsonb_array_elements(g->'conditions') AS c
  WHERE (c->>'field' = 'zalo_tag' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c->'tagIds') AS t(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.auto_account_contacts tag WHERE tag.account_id = v_account AND tag.contact_type = 'zalo_tag'
            AND tag.uid = btrim(t.id) AND tag.is_delete IS NOT TRUE AND tag.staff_id = p_staff_id AND tag.organization_id = p_organization_id)))
     OR (c->>'field' = 'akabiz_tag' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c->'tagIds') AS t(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.auto_contact_tags tag WHERE tag.id = t.id::bigint AND tag.staff_id = p_staff_id
            AND tag.organization_id = p_organization_id AND tag.is_delete IS NOT TRUE)))
     OR (c->>'field' = 'campaign' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c->'campaignIds') AS t(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.auto_campaigns cp WHERE cp.id = t.id::bigint AND cp.staff_id = p_staff_id
            AND cp.organization_id = p_organization_id AND cp.is_delete IS NOT TRUE)))
     OR (c->>'field' = 'data_group' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c->'groupIds') AS t(id)
          WHERE NOT coalesce(private.can_read_data_group(t.id::bigint, p_staff_id, p_organization_id), false)));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'friend_filter_catalog_changed' USING DETAIL = v_missing;
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- Đánh giá: mỗi bạn bè một dòng kèm cờ khớp/loại trừ, thứ hạng sau sắp xếp và các mốc tin nhắn để hiển thị.
-- p_need_facts: luôn đọc lịch sử tin 365 ngày (xem trước có cột "Lần nhắn gần nhất"), kể cả khi bộ lọc không cần.

CREATE FUNCTION private.zalo_friend_filter_rows_v1(p_staff_id bigint, p_organization_id bigint, p_filter jsonb, p_now timestamptz, p_need_facts boolean)
RETURNS TABLE (
  contact_id bigint, uid text, name text, zalo_name text, phone text, gender text, zalo_tags text[], akabiz_tag_ids bigint[],
  updated_at timestamptz, matched boolean, opted_out boolean, blocked boolean, eligible boolean, selected boolean, sel_rank bigint,
  sent_count integer, last_sent_at timestamptz, latest_stage text, last_interaction_at timestamptz, first_sent_at timestamptz,
  facts_from timestamptz
)
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp SET jit = off AS $fn$
DECLARE
  v_account bigint := (p_filter->>'accountId')::bigint;
  v_today date := (p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_until timestamptz := ((p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_all_start timestamptz := ((p_now AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 364)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_since timestamptz;
  v_cutoff timestamptz;
  -- Mỗi lượt lọc đọc tối đa 30.000 lượt nhắn (nguội ~25 giây, ấm ~1,5 giây trên production).
  c_max_sends constant integer := 30000;
  v_match text := p_filter->>'match';
  v_no_groups boolean := jsonb_array_length(p_filter->'groups') = 0;
  v_sort_by text := coalesce(p_filter#>>'{sort,by}', 'default');
  v_sort_dir text := coalesce(p_filter#>>'{sort,direction}', 'asc');
  v_seed text := coalesce(p_filter#>>'{sort,seed}', '');
  v_limit integer := CASE WHEN p_filter->'limit' = 'null'::jsonb THEN NULL ELSE (p_filter->>'limit')::int END;
  v_exclude_opted_out boolean := (p_filter->>'excludeOptedOut')::boolean;
  v_exclude_blocked boolean := (p_filter->>'excludeBlocked')::boolean;
BEGIN
  -- Mốc đọc lịch sử tin: sớm nhất trong các khoảng mà điều kiện dùng; tương tác lùi thêm 30 ngày vì khách xem/phản hồi
  -- sau lúc gửi (hạn theo dõi V339 ngắn hơn nhiều).
  SELECT min(CASE WHEN c->>'field' = 'interaction' THEN lower(private.zalo_friend_period_v1(c->'period', v_today)) - interval '30 days'
                  ELSE lower(private.zalo_friend_period_v1(nullif(c->'period', 'null'::jsonb), v_today)) END)
  INTO v_since
  FROM jsonb_array_elements(p_filter->'groups') AS g, jsonb_array_elements(g->'conditions') AS c
  WHERE c->>'field' IN ('sent_count', 'latest_message', 'messages_in_period', 'interaction', 'campaign');
  IF v_sort_by IN ('last_sent_at', 'last_interaction_at') THEN
    v_since := least(coalesce(v_since, v_all_start), v_all_start);
  END IF;
  -- Điều kiện về tin cần đủ dữ liệu trong khoảng: quá khối lượng thì báo số ngày tối đa xét được, không trả kết quả thiếu.
  IF v_since IS NOT NULL THEN
    v_cutoff := private.zalo_friend_send_cutoff_v1(v_account, v_since, v_until, c_max_sends);
    IF v_cutoff IS NOT NULL THEN
      RAISE EXCEPTION 'friend_filter_too_many_messages'
        USING DETAIL = greatest(0, v_today - (v_cutoff AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)::text, HINT = c_max_sends::text;
    END IF;
  END IF;
  -- Cột hiển thị (số lần nhắn, lần nhắn gần nhất…) xét 365 ngày; tài khoản gửi quá nhiều thì chỉ xét các lượt mới nhất.
  IF p_need_facts AND (v_since IS NULL OR v_since > v_all_start) THEN
    v_cutoff := private.zalo_friend_send_cutoff_v1(v_account, v_all_start, v_until, c_max_sends);
    v_since := CASE WHEN v_cutoff IS NULL THEN v_all_start ELSE least(coalesce(v_since, v_cutoff + interval '1 microsecond'), v_cutoff + interval '1 microsecond') END;
  END IF;

  RETURN QUERY
  WITH friends AS MATERIALIZED (
    SELECT ct.id AS contact_id, btrim(ct.uid) AS uid, lower(btrim(ct.uid)) AS uid_key,
      nullif(btrim(ct.name), '') AS name, nullif(btrim(zu.zalo_name), '') AS zalo_name,
      coalesce(
        private.column_filter_phone_v1(coalesce(nullif(btrim(zu.phone_number), ''), nullif(btrim(zu.raw_payload->>'phoneNumber'), ''),
          nullif(btrim(zu.raw_payload->>'phone_number'), ''), nullif(btrim(zu.raw_payload->>'phone'), ''))),
        private.column_filter_phone_v1(coalesce(nullif(btrim(ct.phone), ''), nullif(btrim(ct.extra_data->>'phone'), ''),
          nullif(btrim(ct.extra_data->>'phoneNumber'), ''), nullif(btrim(ct.extra_data->>'phone_number'), ''),
          nullif(btrim(ct.extra_data->>'mobilePhone'), ''), nullif(btrim(ct.extra_data->>'mobile_phone'), '')))
      ) AS phone,
      CASE (CASE WHEN zu.id IS NOT NULL THEN zu.gender::text ELSE ct.extra_data->>'gender' END)
        WHEN '0' THEN 'male' WHEN '1' THEN 'female' ELSE 'unknown' END AS gender,
      private.zalo_friend_birthday_v1(zu.sdob, zu.dob) AS birthday,
      coalesce(private.column_filter_zalo_tags_v1(ct.extra_data), '{}'::text[]) AS zalo_tags,
      coalesce(ct.akabiz_tag_ids, '{}'::bigint[]) AS akabiz_tag_ids,
      lower(normalize(coalesce(ct.name, ''), NFC)) AS name_key,
      lower(normalize(coalesce(zu.zalo_name, ''), NFC)) AS zalo_name_key,
      nullif(btrim(zu.global_id), '') AS global_id,
      coalesce(zu.is_blocked, 0) = 1 AS blocked,
      greatest(ct.updated_at, zu.updated_at) AS updated_at
    FROM public.auto_account_contacts ct
    LEFT JOIN public.zalo_users zu ON zu.id = ct.zalo_user_id AND zu.account_id = ct.account_id
      AND zu.staff_id = ct.staff_id AND zu.organization_id = ct.organization_id
    WHERE ct.account_id = v_account AND ct.contact_type = 'person' AND ct.is_delete IS NOT TRUE
      AND ct.staff_id = p_staff_id AND ct.organization_id = p_organization_id
      AND ct.is_friend IS TRUE AND nullif(btrim(ct.uid), '') IS NOT NULL
  ),
  sends AS MATERIALIZED (
    SELECT x.uid_key, x.id, x.created_at, x.ok, x.tracked, x.seen_at, x.reacted_at, x.responded_at, x.campaign_id
    FROM (
      SELECT lower(coalesce(nullif(btrim(i.uid), ''), nullif(btrim(d.data#>>'{target,uid}'), ''), nullif(btrim(d.data#>>'{targetUid}'), ''),
          nullif(btrim(d.data#>>'{uid}'), ''), nullif(btrim(d.data#>>'{target,raw,inputData,uid}'), ''),
          nullif(btrim(d.data#>>'{target,raw,profile,uid}'), ''))) AS uid_key,
        d.id, d.created_at, d.campaign_id,
        d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click') AS ok,
        e.campaign_detail_id IS NOT NULL AS tracked, e.seen_at, e.reacted_at, e.responded_at
      FROM public.auto_campaign_details d
      JOIN public.auto_campaigns cp ON cp.id = d.campaign_id AND cp.staff_id = p_staff_id
        AND cp.organization_id = p_organization_id AND cp.is_delete IS NOT TRUE
      LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
      LEFT JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id AND e.account_id = d.account_id
      WHERE v_since IS NOT NULL AND d.account_id = v_account
        AND d.action_code IN ('zalo_message_friend', 'zalo_message_stranger') AND d.is_delete = false
        AND d.created_at >= v_since AND d.created_at < v_until
        AND d.status IN ('thành công', 'đã gửi', 'đã nhận', 'đã xem', 'đã click', 'thất bại', 'lỗi')
    ) AS x
    WHERE x.uid_key IN (SELECT f.uid_key FROM friends AS f)
  ),
  conds AS MATERIALIZED (
    SELECT g.ordinality::integer AS gi, g.value->>'match' AS gmatch, (g.ordinality * 100 + c.ordinality)::integer AS ck,
      c.value->>'field' AS field, c.value->>'op' AS op,
      CASE WHEN c.value->>'field' = 'zalo_tag' THEN ARRAY(SELECT btrim(t) FROM jsonb_array_elements_text(c.value->'tagIds') AS t) END AS tag_texts,
      CASE WHEN c.value->>'field' = 'akabiz_tag' THEN ARRAY(SELECT t::bigint FROM jsonb_array_elements_text(c.value->'tagIds') AS t) END AS tag_ids,
      CASE WHEN c.value->>'field' = 'gender' THEN ARRAY(SELECT t FROM jsonb_array_elements_text(c.value->'values') AS t) END AS genders,
      CASE WHEN c.value->>'field' = 'birthday' THEN ARRAY(SELECT t::integer FROM jsonb_array_elements_text(c.value->'months') AS t) END AS months,
      CASE WHEN c.value->>'field' = 'birthday' THEN (c.value->>'days')::integer END AS days,
      CASE WHEN c.value->>'field' = 'name' THEN lower(normalize(btrim(c.value->>'text'), NFC)) END AS text_key,
      CASE WHEN c.value->>'field' = 'sent_count' THEN (c.value->>'value')::integer END AS num,
      CASE WHEN c.value->>'field' = 'sent_count' THEN (c.value->>'valueTo')::integer END AS num_to,
      CASE WHEN c.value->>'field' = 'latest_message' THEN ARRAY(SELECT t FROM jsonb_array_elements_text(c.value->'stages') AS t) END AS stages,
      CASE WHEN c.value->>'field' = 'interaction' THEN ARRAY(SELECT t FROM jsonb_array_elements_text(c.value->'kinds') AS t) END AS kinds,
      c.value->>'quantifier' AS quantifier, c.value->>'status' AS mstatus, coalesce((c.value->>'amongSent')::boolean, false) AS among_sent,
      CASE WHEN c.value->>'field' = 'campaign' THEN ARRAY(SELECT t::bigint FROM jsonb_array_elements_text(c.value->'campaignIds') AS t) END AS campaign_ids,
      CASE WHEN c.value->>'field' = 'data_group' THEN ARRAY(SELECT t::bigint FROM jsonb_array_elements_text(c.value->'groupIds') AS t) END AS group_ids,
      CASE WHEN c.value->>'field' IN ('sent_count', 'latest_message', 'messages_in_period', 'interaction', 'campaign')
        THEN private.zalo_friend_period_v1(nullif(c.value->'period', 'null'::jsonb), v_today) END AS period
    FROM jsonb_array_elements(p_filter->'groups') WITH ORDINALITY AS g(value, ordinality)
    CROSS JOIN LATERAL jsonb_array_elements(g.value->'conditions') WITH ORDINALITY AS c(value, ordinality)
  ),
  -- Thành viên đang hoạt động của các nhóm đã chọn, khớp theo Zalo ID như luật V519 (liên hệ 'person', mọi tài khoản).
  group_hits AS MATERIALIZED (
    SELECT btrim(member_contact.uid) AS uid, array_agg(DISTINCT k.ck) AS cks
    FROM conds AS k
    CROSS JOIN LATERAL unnest(k.group_ids) AS gid(id)
    JOIN public.auto_account_contact_groups AS grp ON grp.id = gid.id AND grp.purpose = 'data_group' AND grp.is_delete = false
      AND grp.organization_id = p_organization_id AND private.can_read_data_group(grp.id, p_staff_id, p_organization_id)
    JOIN public.auto_account_contact_group_members AS member ON member.group_id = grp.id AND member.is_delete = false
    JOIN public.auto_account_contacts AS member_contact ON member_contact.id = member.contact_id AND member_contact.contact_type = 'person'
    WHERE k.field = 'data_group' AND nullif(btrim(member_contact.uid), '') IS NOT NULL
    GROUP BY btrim(member_contact.uid)
  ),
  facts AS MATERIALIZED (
    SELECT f.*, s.s_at, s.s_id, s.s_ok, s.s_tracked, s.s_seen, s.s_react, s.s_reply, s.s_campaign, coalesce(h.cks, '{}'::integer[]) AS group_hits
    FROM friends AS f
    LEFT JOIN (
      SELECT sd.uid_key,
        array_agg(sd.created_at ORDER BY sd.created_at, sd.id) AS s_at, array_agg(sd.id ORDER BY sd.created_at, sd.id) AS s_id,
        array_agg(sd.ok ORDER BY sd.created_at, sd.id) AS s_ok, array_agg(sd.tracked ORDER BY sd.created_at, sd.id) AS s_tracked,
        array_agg(sd.seen_at ORDER BY sd.created_at, sd.id) AS s_seen, array_agg(sd.reacted_at ORDER BY sd.created_at, sd.id) AS s_react,
        array_agg(sd.responded_at ORDER BY sd.created_at, sd.id) AS s_reply, array_agg(sd.campaign_id ORDER BY sd.created_at, sd.id) AS s_campaign
      FROM sends AS sd GROUP BY sd.uid_key
    ) AS s ON s.uid_key = f.uid_key
    LEFT JOIN group_hits AS h ON h.uid = f.uid
  ),
  pairs AS (
    SELECT f.contact_id, k.gi, k.gmatch,
      coalesce(CASE k.field
        WHEN 'zalo_tag' THEN CASE k.op
          WHEN 'has_any' THEN f.zalo_tags && k.tag_texts WHEN 'has_all' THEN f.zalo_tags @> k.tag_texts
          WHEN 'has_none' THEN NOT (f.zalo_tags && k.tag_texts) WHEN 'tagged' THEN cardinality(f.zalo_tags) > 0
          ELSE cardinality(f.zalo_tags) = 0 END
        WHEN 'akabiz_tag' THEN CASE k.op
          WHEN 'has_any' THEN f.akabiz_tag_ids && k.tag_ids WHEN 'has_all' THEN f.akabiz_tag_ids @> k.tag_ids
          WHEN 'has_none' THEN NOT (f.akabiz_tag_ids && k.tag_ids) WHEN 'tagged' THEN cardinality(f.akabiz_tag_ids) > 0
          ELSE cardinality(f.akabiz_tag_ids) = 0 END
        WHEN 'gender' THEN f.gender = ANY (k.genders)
        WHEN 'birthday' THEN CASE k.op
          WHEN 'in_months' THEN f.birthday IS NOT NULL AND (f.birthday / 100) = ANY (k.months)
          WHEN 'in_next_days' THEN f.birthday IS NOT NULL AND private.zalo_friend_birthday_soon_v1(f.birthday, v_today, k.days)
          ELSE f.birthday IS NULL END
        WHEN 'phone' THEN CASE k.op WHEN 'has' THEN f.phone IS NOT NULL ELSE f.phone IS NULL END
        WHEN 'name' THEN CASE k.op
          WHEN 'contains' THEN strpos(f.name_key, k.text_key) > 0 OR strpos(f.zalo_name_key, k.text_key) > 0
          WHEN 'not_contains' THEN strpos(f.name_key, k.text_key) = 0 AND strpos(f.zalo_name_key, k.text_key) = 0
          ELSE strpos(f.name_key, k.text_key) = 1 OR strpos(f.zalo_name_key, k.text_key) = 1 END
        WHEN 'sent_count' THEN (
          SELECT CASE k.op WHEN 'eq' THEN q.n = k.num WHEN 'gte' THEN q.n >= k.num WHEN 'lte' THEN q.n <= k.num ELSE q.n BETWEEN k.num AND k.num_to END
          FROM (SELECT count(*) AS n FROM unnest(f.s_at, f.s_ok) AS u(at, ok) WHERE u.ok AND u.at <@ k.period) AS q)
        WHEN 'latest_message' THEN (coalesce((
          SELECT CASE WHEN NOT u.ok THEN 'failed' WHEN u.reply IS NOT NULL THEN 'replied' WHEN u.react IS NOT NULL THEN 'reacted'
            WHEN u.seen IS NOT NULL THEN 'seen' WHEN u.tracked THEN 'sent' ELSE 'unknown' END
          FROM unnest(f.s_at, f.s_id, f.s_ok, f.s_tracked, f.s_seen, f.s_react, f.s_reply) AS u(at, id, ok, tracked, seen, react, reply)
          WHERE u.at <@ k.period ORDER BY u.at DESC, u.id DESC LIMIT 1), 'never_sent') = ANY (k.stages)) = (k.op = 'in')
        WHEN 'messages_in_period' THEN
          (NOT k.among_sent OR EXISTS (SELECT 1 FROM unnest(f.s_at, f.s_ok, f.s_tracked) AS u(at, ok, tracked)
            WHERE u.ok AND u.tracked AND u.at <@ k.period))
          AND EXISTS (SELECT 1 FROM unnest(f.s_at, f.s_ok, f.s_tracked, f.s_seen, f.s_react, f.s_reply) AS u(at, ok, tracked, seen, react, reply)
            WHERE u.at <@ k.period AND CASE k.mstatus
              WHEN 'sent' THEN u.ok
              WHEN 'failed' THEN NOT u.ok
              WHEN 'seen' THEN u.ok AND u.tracked AND (u.seen IS NOT NULL OR u.react IS NOT NULL OR u.reply IS NOT NULL)
              WHEN 'reacted' THEN u.ok AND u.tracked AND (u.react IS NOT NULL OR u.reply IS NOT NULL)
              ELSE u.ok AND u.tracked AND u.reply IS NOT NULL END) = (k.quantifier = 'any')
        WHEN 'interaction' THEN EXISTS (SELECT 1 FROM unnest(f.s_seen, f.s_react, f.s_reply) AS u(seen, react, reply)
            WHERE ('seen' = ANY (k.kinds) AND u.seen <@ k.period) OR ('reacted' = ANY (k.kinds) AND u.react <@ k.period)
              OR ('replied' = ANY (k.kinds) AND u.reply <@ k.period)) = (k.op = 'within')
        WHEN 'campaign' THEN EXISTS (SELECT 1 FROM unnest(f.s_at, f.s_ok, f.s_campaign) AS u(at, ok, campaign_id)
            WHERE u.ok AND u.campaign_id = ANY (k.campaign_ids) AND u.at <@ k.period) = (k.op = 'received')
        WHEN 'data_group' THEN (k.ck = ANY (f.group_hits)) = (k.op = 'in')
      END, false) AS ok
    FROM facts AS f CROSS JOIN conds AS k
  ),
  group_eval AS (
    SELECT p.contact_id, p.gi, CASE WHEN min(p.gmatch) = 'any' THEN bool_or(p.ok) ELSE bool_and(p.ok) END AS ok
    FROM pairs AS p GROUP BY p.contact_id, p.gi
  ),
  friend_eval AS (
    SELECT ge.contact_id, CASE WHEN v_match = 'any' THEN bool_or(ge.ok) ELSE bool_and(ge.ok) END AS ok
    FROM group_eval AS ge GROUP BY ge.contact_id
  ),
  -- Khách đã xác nhận từ chối nhận tin của nhân viên (theo Zalo global id hoặc số điện thoại).
  opt_outs AS MATERIALIZED (
    SELECT o.zalo_global_id, o.phone FROM public.auto_zalo_message_opt_outs AS o
    WHERE o.staff_id = p_staff_id AND o.organization_id = p_organization_id AND o.confirmed_at IS NOT NULL
  ),
  evaluated AS (
    SELECT f.contact_id, f.uid, f.name, f.zalo_name, f.phone, f.gender, f.zalo_tags, f.akabiz_tag_ids, f.updated_at, f.blocked,
      coalesce(fe.ok, v_no_groups) AS matched,
      (f.global_id IS NOT NULL AND f.global_id IN (SELECT o.zalo_global_id FROM opt_outs AS o))
        OR (f.phone IS NOT NULL AND f.phone IN (SELECT o.phone FROM opt_outs AS o WHERE o.phone IS NOT NULL)) AS opted_out,
      (SELECT count(*) FROM unnest(f.s_at, f.s_ok) AS u(at, ok) WHERE u.ok AND u.at >= v_all_start)::integer AS sent_count,
      (SELECT max(u.at) FROM unnest(f.s_at, f.s_ok) AS u(at, ok) WHERE u.ok AND u.at >= v_all_start) AS last_sent_at,
      coalesce((SELECT CASE WHEN NOT u.ok THEN 'failed' WHEN u.reply IS NOT NULL THEN 'replied' WHEN u.react IS NOT NULL THEN 'reacted'
          WHEN u.seen IS NOT NULL THEN 'seen' WHEN u.tracked THEN 'sent' ELSE 'unknown' END
        FROM unnest(f.s_at, f.s_id, f.s_ok, f.s_tracked, f.s_seen, f.s_react, f.s_reply) AS u(at, id, ok, tracked, seen, react, reply)
        WHERE u.at >= v_all_start ORDER BY u.at DESC, u.id DESC LIMIT 1), 'never_sent') AS latest_stage,
      (SELECT max(t) FROM unnest(f.s_seen || f.s_react || f.s_reply) AS t) AS last_interaction_at,
      (SELECT min(u.at) FROM unnest(f.s_at, f.s_ok) AS u(at, ok) WHERE u.ok AND u.at >= v_all_start) AS first_sent_at
    FROM facts AS f LEFT JOIN friend_eval AS fe ON fe.contact_id = f.contact_id
  ),
  final AS (
    SELECT ev.*, ev.matched AND NOT (v_exclude_opted_out AND ev.opted_out) AND NOT (v_exclude_blocked AND ev.blocked) AS eligible
    FROM evaluated AS ev
  ),
  ranked AS (
    SELECT fi.*, CASE WHEN fi.eligible THEN row_number() OVER (PARTITION BY fi.eligible ORDER BY
        CASE WHEN v_sort_by = 'last_sent_at' AND v_sort_dir = 'asc' THEN fi.last_sent_at END ASC NULLS FIRST,
        CASE WHEN v_sort_by = 'last_sent_at' AND v_sort_dir = 'desc' THEN fi.last_sent_at END DESC NULLS LAST,
        CASE WHEN v_sort_by = 'last_interaction_at' AND v_sort_dir = 'asc' THEN fi.last_interaction_at END ASC NULLS FIRST,
        CASE WHEN v_sort_by = 'last_interaction_at' AND v_sort_dir = 'desc' THEN fi.last_interaction_at END DESC NULLS LAST,
        CASE WHEN v_sort_by = 'random' THEN md5(v_seed || ':' || fi.uid) END ASC,
        CASE WHEN v_sort_by = 'name' AND v_sort_dir = 'desc' THEN lower(coalesce(fi.name, fi.zalo_name, fi.uid)) END DESC,
        CASE WHEN v_sort_by <> 'name' OR v_sort_dir = 'asc' THEN lower(coalesce(fi.name, fi.zalo_name, fi.uid)) END ASC,
        fi.contact_id ASC) END AS rnk
    FROM final AS fi
  )
  SELECT r.contact_id, r.uid, r.name, r.zalo_name, r.phone, r.gender, r.zalo_tags, r.akabiz_tag_ids, r.updated_at,
    r.matched, r.opted_out, r.blocked, r.eligible, r.eligible AND (v_limit IS NULL OR r.rnk <= v_limit), r.rnk,
    r.sent_count, r.last_sent_at, r.latest_stage, r.last_interaction_at, r.first_sent_at, greatest(v_since, v_all_start)
  FROM ranked AS r;
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- RPC

CREATE FUNCTION public.aka_agent_list_zalo_friend_accounts_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET statement_timeout = '15s' AS $fn$
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  RETURN jsonb_build_object('version', 1, 'accounts', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', coalesce(nullif(btrim(a.name), ''), 'Tài khoản #' || a.id),
        'kind', CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'desktop' END,
        'available', coalesce(public.aka_agent_data_group_account_available(a.id, p_staff_id, p_organization_id), false),
        'friendCount', stats.friend_count, 'friendsUpdatedAt', stats.updated_at)
      ORDER BY coalesce(public.aka_agent_data_group_account_available(a.id, p_staff_id, p_organization_id), false) DESC,
        stats.friend_count DESC, a.name, a.id)
    FROM public.auto_accounts AS a
    CROSS JOIN LATERAL (
      SELECT count(*)::integer AS friend_count, max(ct.updated_at) AS updated_at
      FROM public.auto_account_contacts AS ct
      WHERE ct.account_id = a.id AND ct.contact_type = 'person' AND ct.is_delete IS NOT TRUE AND ct.is_friend IS TRUE
        AND ct.staff_id = p_staff_id AND ct.organization_id = p_organization_id AND nullif(btrim(ct.uid), '') IS NOT NULL
    ) AS stats
    WHERE a.staff_id = p_staff_id AND a.organization_id = p_organization_id AND a.flatform_type = 'zalo' AND a.is_delete IS NOT TRUE
  ), '[]'::jsonb));
END
$fn$;

CREATE FUNCTION public.aka_agent_read_zalo_friend_catalog_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_account_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET statement_timeout = '30s' SET jit = off AS $fn$
DECLARE
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_all_start timestamptz := ((now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - 364)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_type bigint;
  v_account jsonb; v_tags jsonb; v_akabiz jsonb; v_groups jsonb; v_group_count integer; v_campaigns jsonb; v_campaign_count integer;
  v_messages_since timestamptz; v_tracking_since timestamptz; v_per_day double precision; v_max_days integer;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  PERFORM private.zalo_friend_filter_scope_v1(p_staff_id, p_organization_id, jsonb_build_object('accountId', p_account_id, 'groups', '[]'::jsonb));
  SELECT i.id INTO v_type FROM public.category_type AS t JOIN public.category_item AS i ON i.category_type_id = t.id
  WHERE t.namespace = 'common' AND t.code = 'data_type' AND i.code = 'zalo_person' ORDER BY i.is_active DESC, i.id LIMIT 1;

  SELECT jsonb_build_object('id', a.id, 'name', coalesce(nullif(btrim(a.name), ''), 'Tài khoản #' || a.id),
      'kind', CASE WHEN a.is_zalo_show_web IS TRUE THEN 'web' WHEN a.is_zalo_server IS TRUE THEN 'server' ELSE 'desktop' END,
      'available', true, 'friendCount', stats.friend_count, 'friendsUpdatedAt', stats.updated_at)
  INTO v_account
  FROM public.auto_accounts AS a
  CROSS JOIN LATERAL (
    SELECT count(*)::integer AS friend_count, max(ct.updated_at) AS updated_at FROM public.auto_account_contacts AS ct
    WHERE ct.account_id = a.id AND ct.contact_type = 'person' AND ct.is_delete IS NOT TRUE AND ct.is_friend IS TRUE
      AND ct.staff_id = p_staff_id AND ct.organization_id = p_organization_id AND nullif(btrim(ct.uid), '') IS NOT NULL
  ) AS stats
  WHERE a.id = p_account_id;

  -- Tag Zalo của tài khoản, kèm số bạn bè đang gắn (tag nhiều người trước).
  WITH tag_counts AS (
    SELECT t.id, count(*)::integer AS n
    FROM public.auto_account_contacts AS ct
    CROSS JOIN LATERAL unnest(private.column_filter_zalo_tags_v1(ct.extra_data)) AS t(id)
    WHERE ct.account_id = p_account_id AND ct.contact_type = 'person' AND ct.is_delete IS NOT TRUE AND ct.is_friend IS TRUE
      AND ct.staff_id = p_staff_id AND ct.organization_id = p_organization_id
    GROUP BY t.id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.uid, 'name', x.name, 'count', x.n) ORDER BY x.n DESC, x.name), '[]'::jsonb)
  INTO v_tags
  FROM (
    SELECT btrim(tag.uid) AS uid, coalesce(nullif(btrim(tag.name), ''), btrim(tag.uid)) AS name, coalesce(tc.n, 0) AS n
    FROM public.auto_account_contacts AS tag
    LEFT JOIN tag_counts AS tc ON tc.id = btrim(tag.uid)
    WHERE tag.account_id = p_account_id AND tag.contact_type = 'zalo_tag' AND tag.is_delete IS NOT TRUE
      AND tag.staff_id = p_staff_id AND tag.organization_id = p_organization_id AND nullif(btrim(tag.uid), '') IS NOT NULL
    ORDER BY coalesce(tc.n, 0) DESC, tag.name LIMIT 300
  ) AS x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) ORDER BY x.name), '[]'::jsonb) INTO v_akabiz
  FROM (SELECT tag.id, tag.name FROM public.auto_contact_tags AS tag
    WHERE tag.staff_id = p_staff_id AND tag.organization_id = p_organization_id AND tag.is_delete IS NOT TRUE
    ORDER BY tag.name LIMIT 300) AS x;

  -- Nhóm khách hàng đọc được (của mình hoặc được chia sẻ), loại "Zalo · User theo UID" hoặc không giới hạn loại.
  WITH readable AS (
    SELECT g.id, g.name, g.updated_at FROM public.auto_account_contact_groups AS g
    WHERE g.organization_id = p_organization_id AND g.purpose = 'data_group' AND g.is_delete = false
      AND (g.data_type_category_item_id IS NULL OR g.data_type_category_item_id = v_type)
      AND (g.staff_id = p_staff_id OR (g.sharing_scope IN ('organization', 'selected')
        AND coalesce(private.can_read_data_group(g.id, p_staff_id, p_organization_id), false)))
  )
  SELECT (SELECT count(*)::integer FROM readable),
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.updated_at DESC, r.id DESC)
      FROM (SELECT * FROM readable ORDER BY updated_at DESC, id DESC LIMIT 200) AS r), '[]'::jsonb)
  INTO v_group_count, v_groups;

  -- Chiến dịch nhắn tin 1-1 của tài khoản chạy trong 180 ngày (mới nhất trước). Đọc bảng chiến dịch, không quét lịch sử gửi.
  WITH named AS (
    SELECT cp.id, cp.name, coalesce(cp.last_run_at, cp.created_at) AS last_at
    FROM public.auto_campaigns AS cp
    WHERE cp.staff_id = p_staff_id AND cp.organization_id = p_organization_id AND cp.is_delete IS NOT TRUE
      AND (cp.account_id = p_account_id OR cp.secondary_account_id = p_account_id)
      AND cp.action_id IN ('zalo_message_friend', 'zalo_message_phone', 'zalo_message_group_member', 'zalo_message_group_realtime',
        'zalo_message_friend_recommendation', 'zalo_message_remarketing_customer', 'zalo_message_birthday')
      AND coalesce(cp.last_run_at, cp.created_at) >= v_now - interval '180 days'
  )
  SELECT (SELECT count(*)::integer FROM named),
    coalesce((SELECT jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'lastSentAt', n.last_at) ORDER BY n.last_at DESC, n.id DESC)
      FROM (SELECT * FROM named ORDER BY last_at DESC, id DESC LIMIT 100) AS n), '[]'::jsonb)
  INTO v_campaign_count, v_campaigns;

  v_messages_since := least(
    (SELECT min(d.created_at) FROM public.auto_campaign_details AS d WHERE d.account_id = p_account_id
      AND d.action_code = 'zalo_message_friend' AND d.is_delete = false AND d.created_at >= v_all_start),
    (SELECT min(d.created_at) FROM public.auto_campaign_details AS d WHERE d.account_id = p_account_id
      AND d.action_code = 'zalo_message_stranger' AND d.is_delete = false AND d.created_at >= v_all_start));
  v_tracking_since := private.zalo_friend_tracking_since_v1(p_staff_id, p_organization_id, p_account_id);
  -- Số ngày tối đa mà điều kiện về tin xét được (≤ 30.000 lượt): ước từ 3.000 lượt mới nhất mỗi loại hành động, để Agent
  -- không đề xuất khoảng dài hơn. Hàm đánh giá vẫn kiểm chính xác ở mỗi lượt lọc.
  SELECT coalesce(sum(CASE WHEN p.n < 3000 THEN p.n / 365.0
      ELSE 3000 / greatest(extract(epoch FROM v_now - p.oldest) / 86400.0, 1.0 / 24) END), 0)
  INTO v_per_day
  FROM unnest(ARRAY['zalo_message_friend', 'zalo_message_stranger']) AS code(action_code)
  CROSS JOIN LATERAL (
    SELECT count(*) AS n, min(x.created_at) AS oldest FROM (
      SELECT d.created_at FROM public.auto_campaign_details AS d
      WHERE d.account_id = p_account_id AND d.action_code = code.action_code AND d.is_delete = false AND d.created_at >= v_all_start
      ORDER BY d.created_at DESC LIMIT 3000) AS x) AS p;
  v_max_days := CASE WHEN v_per_day * 365 <= 30000 THEN 365 ELSE greatest(0, floor(30000 / v_per_day))::integer END;

  RETURN jsonb_build_object('version', 1, 'today', v_today, 'account', v_account, 'zaloTags', v_tags, 'akaBizTags', v_akabiz,
    'dataGroups', v_groups, 'dataGroupsIncomplete', v_group_count > 200, 'campaigns', v_campaigns,
    'campaignsIncomplete', v_campaign_count > 100,
    'coverage', jsonb_build_object('messagesSince', v_messages_since, 'trackingSince', v_tracking_since, 'deliveredAvailable', false,
      'maxMessageDays', v_max_days));
END
$fn$;

CREATE FUNCTION public.aka_agent_read_zalo_friend_filter_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET statement_timeout = '55s' SET jit = off AS $fn$
DECLARE
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_mode text; v_filter jsonb; v_offset integer; v_limit integer; v_account bigint;
  v_uses_latest boolean; v_uses_tracking boolean; v_period_start timestamptz; v_tracking_since timestamptz;
  v_result jsonb;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF NOT private.zalo_friend_json_keys_v1(p_request, ARRAY['mode', 'filter', 'offset', 'limit'])
    OR jsonb_typeof(p_request->'mode') IS DISTINCT FROM 'string' OR p_request->>'mode' NOT IN ('count', 'page', 'ids') THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'request', HINT = 'request';
  END IF;
  v_mode := p_request->>'mode';
  IF v_mode = 'page' THEN
    IF NOT private.zalo_friend_json_int_v1(p_request->'offset', 0, 5000) OR NOT private.zalo_friend_json_int_v1(p_request->'limit', 1, 100) THEN
      RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'request.limit', HINT = 'page';
    END IF;
    v_offset := (p_request->>'offset')::integer; v_limit := (p_request->>'limit')::integer;
  ELSIF p_request->'offset' <> 'null'::jsonb OR p_request->'limit' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'request.limit', HINT = 'null';
  END IF;
  v_filter := p_request->'filter';
  PERFORM private.zalo_friend_filter_check_v1(v_filter, v_today);
  PERFORM private.zalo_friend_filter_scope_v1(p_staff_id, p_organization_id, v_filter);
  v_account := (v_filter->>'accountId')::bigint;

  SELECT bool_or(c->>'field' = 'latest_message'),
    bool_or(c->>'field' = 'interaction' OR (c->>'field' = 'messages_in_period' AND c->>'status' IN ('seen', 'reacted', 'replied'))
      OR (c->>'field' = 'latest_message' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c->'stages') AS s WHERE s NOT IN ('never_sent', 'failed')))),
    min(CASE WHEN c->>'field' IN ('interaction', 'messages_in_period', 'latest_message')
      THEN lower(private.zalo_friend_period_v1(nullif(c->'period', 'null'::jsonb), v_today)) END)
  INTO v_uses_latest, v_uses_tracking, v_period_start
  FROM jsonb_array_elements(v_filter->'groups') AS g, jsonb_array_elements(g->'conditions') AS c;
  IF coalesce(v_uses_tracking, false) THEN
    v_tracking_since := private.zalo_friend_tracking_since_v1(p_staff_id, p_organization_id, v_account);
  END IF;

  WITH r AS MATERIALIZED (
    SELECT * FROM private.zalo_friend_filter_rows_v1(p_staff_id, p_organization_id, v_filter, v_now, v_mode = 'page')
  ), totals AS (
    SELECT count(*)::integer AS total, count(*) FILTER (WHERE r.selected)::integer AS matched,
      count(*) FILTER (WHERE r.matched AND r.opted_out)::integer AS opted_out_removed,
      count(*) FILTER (WHERE r.matched AND NOT r.opted_out AND r.blocked AND (v_filter->>'excludeBlocked')::boolean)::integer AS blocked_removed,
      count(*) FILTER (WHERE r.eligible AND NOT r.selected)::integer AS limit_removed,
      count(*) FILTER (WHERE r.latest_stage = 'unknown')::integer AS untracked_latest,
      max(r.updated_at) AS friends_updated_at, min(r.first_sent_at) AS messages_since, max(r.facts_from) AS facts_from
    FROM r
  )
  SELECT jsonb_build_object(
    'version', 1, 'accountId', v_account, 'totalFriends', t.total, 'matched', t.matched, 'evaluatedAt', v_now,
    'coverage', jsonb_build_object('friendsUpdatedAt', t.friends_updated_at, 'messagesSince', t.messages_since,
      'trackingSince', v_tracking_since, 'deliveredAvailable', false, 'chatHistory', false,
      'factsFrom', CASE WHEN v_mode = 'page' THEN t.facts_from END),
    'notes', (SELECT coalesce(jsonb_agg(n.note), '[]'::jsonb) FROM (
      SELECT jsonb_build_object('code', 'untracked_latest', 'count', t.untracked_latest) AS note WHERE coalesce(v_uses_latest, false) AND t.untracked_latest > 0
      UNION ALL SELECT jsonb_build_object('code', 'tracking_partial', 'count', 1)
        WHERE coalesce(v_uses_tracking, false) AND (v_tracking_since IS NULL OR v_period_start < v_tracking_since)
      UNION ALL SELECT jsonb_build_object('code', 'friends_stale', 'count', (v_today - (t.friends_updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date))
        WHERE t.friends_updated_at IS NOT NULL AND t.friends_updated_at < v_now - interval '7 days'
      UNION ALL SELECT jsonb_build_object('code', 'limit_applied', 'count', t.limit_removed) WHERE t.limit_removed > 0
      UNION ALL SELECT jsonb_build_object('code', 'opted_out_removed', 'count', t.opted_out_removed) WHERE t.opted_out_removed > 0
      UNION ALL SELECT jsonb_build_object('code', 'blocked_removed', 'count', t.blocked_removed) WHERE t.blocked_removed > 0
    ) AS n),
    'rows', CASE WHEN v_mode = 'page' THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
          'contactId', p.contact_id, 'name', p.name, 'zaloOriginalName', p.zalo_name, 'uid', p.uid, 'phone', p.phone, 'gender', p.gender,
          'zaloTags', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', tag_id, 'name', coalesce(tag.name, tag_id)) ORDER BY tag.name NULLS LAST, tag_id), '[]'::jsonb)
            FROM unnest(p.zalo_tags) AS tag_id
            LEFT JOIN LATERAL (SELECT nullif(btrim(z.name), '') AS name FROM public.auto_account_contacts AS z
              WHERE z.account_id = v_account AND z.contact_type = 'zalo_tag' AND z.uid = tag_id AND z.is_delete IS NOT TRUE
                AND z.staff_id = p_staff_id AND z.organization_id = p_organization_id LIMIT 1) AS tag ON true),
          'akaBizTagIds', to_jsonb(p.akabiz_tag_ids), 'sentCount', p.sent_count, 'lastSentAt', p.last_sent_at,
          'latestStage', p.latest_stage, 'lastInteractionAt', p.last_interaction_at) ORDER BY p.sel_rank)
      FROM (SELECT * FROM r WHERE r.selected ORDER BY r.sel_rank OFFSET v_offset LIMIT v_limit) AS p), '[]'::jsonb) END,
    'contactIds', CASE WHEN v_mode = 'ids' THEN coalesce((SELECT jsonb_agg(r.contact_id ORDER BY r.sel_rank) FROM r WHERE r.selected), '[]'::jsonb) END)
  INTO v_result
  FROM totals AS t;
  RETURN v_result;
END
$fn$;

CREATE FUNCTION public.aka_agent_create_data_group_from_friend_filter_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET statement_timeout = '60s' SET jit = off AS $fn$
DECLARE
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_request_id text; v_name text; v_color text; v_filter jsonb; v_summary text[]; v_hash text; v_account bigint; v_type bigint;
  v_existing public.auto_data_group_friend_filters%ROWTYPE;
  v_ids bigint[]; v_group jsonb; v_group_id bigint; v_ingest jsonb; v_inserted integer; v_filter_id bigint; v_note text;
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF NOT private.zalo_friend_json_keys_v1(p_request, ARRAY['requestId', 'name', 'color', 'filter', 'summary'])
    OR jsonb_typeof(p_request->'requestId') IS DISTINCT FROM 'string' OR p_request->>'requestId' !~ '^[A-Za-z0-9:_-]{8,80}$'
    OR jsonb_typeof(p_request->'name') IS DISTINCT FROM 'string' OR char_length(btrim(p_request->>'name')) NOT BETWEEN 1 AND 255
    OR NOT (p_request->'color' = 'null'::jsonb OR (jsonb_typeof(p_request->'color') = 'string' AND p_request->>'color' ~ '^#[0-9A-Fa-f]{6}$'))
    OR jsonb_typeof(p_request->'summary') IS DISTINCT FROM 'array' OR jsonb_array_length(p_request->'summary') > 40
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_request->'summary') AS s WHERE jsonb_typeof(s) <> 'string' OR char_length(s #>> '{}') > 300) THEN
    RAISE EXCEPTION 'invalid_friend_filter' USING ERRCODE = '22023', DETAIL = 'request', HINT = 'request';
  END IF;
  v_request_id := p_request->>'requestId';
  v_name := btrim(p_request->>'name');
  v_color := coalesce(upper(p_request->>'color'), '#2563EB');
  v_filter := p_request->'filter';
  v_summary := ARRAY(SELECT s FROM jsonb_array_elements_text(p_request->'summary') AS s);
  v_hash := md5(jsonb_build_object('name', v_name, 'color', v_color, 'filter', v_filter)::text);

  -- Cùng requestId: trả lại kết quả cũ (bấm lại sau lỗi mạng không tạo nhóm thứ hai).
  PERFORM pg_advisory_xact_lock(hashtextextended('aka_friend_filter:' || p_organization_id || ':' || p_staff_id || ':' || v_request_id, 0));
  SELECT * INTO v_existing FROM public.auto_data_group_friend_filters AS f
  WHERE f.staff_id = p_staff_id AND f.organization_id = p_organization_id AND f.request_id = v_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN RAISE EXCEPTION 'friend_filter_request_conflict'; END IF;
    RETURN jsonb_build_object('groupId', v_existing.group_id, 'filterId', v_existing.id, 'matched', v_existing.matched_count,
      'inserted', v_existing.inserted_count, 'replayed', true);
  END IF;

  PERFORM private.zalo_friend_filter_check_v1(v_filter, v_today);
  PERFORM private.zalo_friend_filter_scope_v1(p_staff_id, p_organization_id, v_filter);
  v_account := (v_filter->>'accountId')::bigint;
  SELECT i.id INTO v_type FROM public.category_type AS t JOIN public.category_item AS i ON i.category_type_id = t.id
  WHERE t.namespace = 'common' AND t.code = 'data_type' AND i.code = 'zalo_person' AND t.is_active AND i.is_active ORDER BY i.id LIMIT 1;
  IF v_type IS NULL THEN RAISE EXCEPTION 'friend_filter_zalo_person_type_missing'; END IF;

  -- Cùng hàm đánh giá với lượt đếm thử.
  SELECT array_agg(r.contact_id ORDER BY r.sel_rank) INTO v_ids
  FROM private.zalo_friend_filter_rows_v1(p_staff_id, p_organization_id, v_filter, v_now, false) AS r WHERE r.selected;
  IF coalesce(cardinality(v_ids), 0) = 0 THEN RAISE EXCEPTION 'friend_filter_empty'; END IF;

  v_group := public.aka_agent_create_data_group_v2(p_staff_id, p_organization_id, v_name, v_color, v_request_id || ':group',
    v_type, v_account, NULL::text, NULL::text);
  v_group_id := (v_group->>'id')::bigint;
  IF v_group_id IS NULL THEN RAISE EXCEPTION 'friend_filter_group_create_failed'; END IF;

  v_ingest := public.aka_agent_ingest_data_group(p_staff_id, p_organization_id, v_request_id || ':ingest', v_group_id, 'scan',
    (SELECT jsonb_agg(jsonb_build_object('contact_id', id, 'source_account_id', v_account, 'contact_type', 'person', 'flatform_type', 'zalo') ORDER BY ord)
      FROM unnest(v_ids) WITH ORDINALITY AS u(id, ord)),
    NULL::bigint, NULL::text, NULL::text, v_account, 'Agent lọc bạn bè'::text, NULL::text, v_type);
  v_inserted := coalesce((v_ingest->>'inserted_membership_count')::integer, 0) + coalesce((v_ingest->>'reactivated_membership_count')::integer, 0)
    + coalesce((v_ingest->>'already_member_count')::integer, 0);

  INSERT INTO public.auto_data_group_friend_filters (group_id, staff_id, organization_id, account_id, request_id, request_hash, filter,
    summary, matched_count, inserted_count, created_at, last_run_at, run_count, last_batch_id)
  VALUES (v_group_id, p_staff_id, p_organization_id, v_account, v_request_id, v_hash, v_filter, v_summary, cardinality(v_ids), v_inserted,
    v_now, v_now, 1, nullif(v_ingest->>'batch_id', '')::bigint)
  RETURNING id INTO v_filter_id;

  -- Ghi chú nhóm tối đa 2.000 ký tự (data_group_note_too_long).
  v_note := left('Tạo bằng Agent ngày ' || to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY') || ':'
    || coalesce(E'\n' || (SELECT string_agg(CASE WHEN s LIKE '  - %' THEN s ELSE '- ' || s END, E'\n') FROM unnest(v_summary) AS s), ''), 2000);
  UPDATE public.auto_account_contact_groups SET note = v_note WHERE id = v_group_id;

  RETURN jsonb_build_object('groupId', v_group_id, 'filterId', v_filter_id, 'matched', cardinality(v_ids), 'inserted', v_inserted, 'replayed', false);
END
$fn$;

CREATE FUNCTION public.aka_agent_get_data_group_friend_filter_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_group_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET statement_timeout = '10s' AS $fn$
BEGIN
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NOT coalesce(private.can_read_data_group(p_group_id, p_staff_id, p_organization_id), false) THEN RETURN NULL; END IF;
  RETURN (SELECT jsonb_build_object('groupId', f.group_id, 'filterId', f.id, 'accountId', f.account_id, 'filter', f.filter,
      'summary', to_jsonb(f.summary), 'matchedCount', f.matched_count, 'insertedCount', f.inserted_count,
      'createdAt', f.created_at, 'lastRunAt', f.last_run_at, 'runCount', f.run_count)
    FROM public.auto_data_group_friend_filters AS f WHERE f.group_id = p_group_id AND f.organization_id = p_organization_id);
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- Quyền: hàm private không ai gọi trực tiếp; năm RPC chỉ service_role (default ACL của public cấp riêng từng vai trò).
DO $grants$
DECLARE v_fn text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'private.zalo_friend_json_keys_v1(jsonb,text[])', 'private.zalo_friend_json_int_v1(jsonb,bigint,bigint)',
    'private.zalo_friend_json_date_v1(jsonb)', 'private.zalo_friend_period_v1(jsonb,date)',
    'private.zalo_friend_birthday_v1(text,bigint)', 'private.zalo_friend_birthday_soon_v1(integer,date,integer)',
    'private.zalo_friend_send_cutoff_v1(bigint,timestamp with time zone,timestamp with time zone,integer)',
    'private.zalo_friend_tracking_since_v1(bigint,bigint,bigint)',
    'private.zalo_friend_filter_check_v1(jsonb,date)', 'private.zalo_friend_filter_scope_v1(bigint,bigint,jsonb)',
    'private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_fn);
  END LOOP;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text)',
    'public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)',
    'public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb)',
    'public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)',
    'public.aka_agent_get_data_group_friend_filter_v1(bigint,bigint,text,text,bigint)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', v_fn);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_fn);
  END LOOP;
END
$grants$;

COMMENT ON FUNCTION public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb) IS
  'Đánh giá bộ lọc bạn bè Zalo (ZaloFriendFilter v1) trên một tài khoản: count | page (≤100) | ids (≤5.000). Chỉ đọc, service_role, 55s.';
COMMENT ON FUNCTION public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb) IS
  'Tạo nhóm khách hàng "Zalo · User theo UID" từ bộ lọc bạn bè trong một giao dịch: đánh giá lại, tạo nhóm, nạp thành viên (scan), lưu bộ lọc. Chống trùng bằng requestId. service_role, 60s.';

DO $postflight$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
  FROM pg_proc AS p
  WHERE p.oid IN (
      to_regprocedure('public.aka_agent_list_zalo_friend_accounts_v1(bigint,bigint,text,text)'),
      to_regprocedure('public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)'),
      to_regprocedure('public.aka_agent_read_zalo_friend_filter_v1(bigint,bigint,text,text,jsonb)'),
      to_regprocedure('public.aka_agent_create_data_group_from_friend_filter_v1(bigint,bigint,text,text,jsonb)'),
      to_regprocedure('public.aka_agent_get_data_group_friend_filter_v1(bigint,bigint,text,text,bigint)'))
    AND (SELECT array_agg(x.g ORDER BY x.g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
         FROM aclexplode(p.proacl) AS a) AS x) IS DISTINCT FROM ARRAY['postgres', 'service_role'];
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'friend_filter_rpc_acl_unexpected: %', v_bad; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE table_schema = 'public'
      AND table_name = 'auto_data_group_friend_filters' AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')) THEN
    RAISE EXCEPTION 'friend_filter_table_acl_unexpected';
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
