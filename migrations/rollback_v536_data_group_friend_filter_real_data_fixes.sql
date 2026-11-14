-- Gỡ migration_data_group_friend_filter_real_data_fixes.sql: trả thân hàm private.zalo_friend_filter_rows_v1 và
-- public.aka_agent_read_zalo_friend_catalog_v1 của migration_data_group_friend_filter.sql. Chỉ dùng khi bản sửa gây lỗi: với
-- bản cũ mỗi lượt lọc của tài khoản vài nghìn bạn bè mất 3,5–22 giây trên production (xem tệp sửa). Áp lại được.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE v_rows text; v_catalog text;
BEGIN
  SELECT md5(p.prosrc) INTO v_rows FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean)');
  SELECT md5(p.prosrc) INTO v_catalog FROM pg_proc AS p WHERE p.oid = to_regprocedure('public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)');
  IF v_rows IS NULL OR v_catalog IS NULL THEN RAISE EXCEPTION 'friend_filter_base_missing'; END IF;
  -- Chỉ thay đúng bản đã biết (bản gốc hoặc bản sửa, để áp lại được); bản lạ thì dừng, không ghi đè.
  IF v_rows NOT IN ('4849b9f0c2bf95581aef6c6824b519f0', '00963a2d3485f8c4dcf1906bf373346f') THEN
    RAISE EXCEPTION 'friend_filter_rows_function_unexpected: %', v_rows;
  END IF;
  IF v_catalog NOT IN ('352085b57a519e822a9962feaa970d06', 'c5eda5aca396f0c36652691ae6b345f1') THEN
    RAISE EXCEPTION 'friend_filter_catalog_function_unexpected: %', v_catalog;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION private.zalo_friend_filter_rows_v1(p_staff_id bigint, p_organization_id bigint, p_filter jsonb, p_now timestamptz, p_need_facts boolean)
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

CREATE OR REPLACE FUNCTION public.aka_agent_read_zalo_friend_catalog_v1(p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_account_id bigint)
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

DO $postflight$
DECLARE v_state text;
BEGIN
  -- Thân hàm, quyền, STABLE, SECURITY DEFINER và các cài đặt của hai hàm sau khi thay.
  SELECT string_agg(p.proname || ' ' || md5(p.prosrc) || ' ' || p.provolatile::text || ' ' || p.prosecdef::text || ' ' || array_to_string(p.proconfig, ';') || ' '
      || (SELECT string_agg(x.g, ',' ORDER BY x.g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM aclexplode(p.proacl) AS a) AS x), ' | ' ORDER BY p.proname)
  INTO v_state FROM pg_proc AS p WHERE p.oid IN (to_regprocedure('private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean)'), to_regprocedure('public.aka_agent_read_zalo_friend_catalog_v1(bigint,bigint,text,text,bigint)'));
  IF v_state IS DISTINCT FROM 'aka_agent_read_zalo_friend_catalog_v1 352085b57a519e822a9962feaa970d06 s true search_path=pg_catalog, pg_temp;statement_timeout=30s;jit=off postgres,service_role'
    || ' | zalo_friend_filter_rows_v1 4849b9f0c2bf95581aef6c6824b519f0 s false search_path=pg_catalog, pg_temp;jit=off postgres' THEN
    RAISE EXCEPTION 'friend_filter_functions_unexpected: %', v_state;
  END IF;
END
$postflight$;
COMMIT;
