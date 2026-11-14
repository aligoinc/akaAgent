-- Gỡ migration_data_group_friend_filter_hash_joins.sql: trả thân và cài đặt của private.zalo_friend_filter_rows_v1 như
-- sau V536 (migration_data_group_friend_filter_real_data_fixes.sql). Chỉ dùng khi bản sửa gây lỗi: với bản V536, lượt lọc
-- theo tin của tài khoản gửi rất nhiều mất 18–37 giây trên production (xem tệp sửa). Áp lại được.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean)');
  IF v_md5 IS NULL THEN RAISE EXCEPTION 'friend_filter_base_missing'; END IF;
  -- Chỉ thay đúng bản đã biết (bản đang thay hoặc chính bản này khi áp lại); bản lạ thì dừng, không ghi đè.
  IF v_md5 NOT IN ('786dcb223d70ec87f0780e977d086811', '00963a2d3485f8c4dcf1906bf373346f') THEN
    RAISE EXCEPTION 'friend_filter_rows_function_unexpected: %', v_md5;
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
    -- Hồ sơ Zalo tra theo khoá chính cho từng bạn bè (LATERAL ... OFFSET 0); đừng đổi lại thành phép nối thường: khi đó
    -- production chọn idx_zalo_users_staff_account và quét lại mọi hồ sơ của tài khoản cho từng bạn bè (14/11/2026:
    -- 3.877 bạn bè loại 9.975.254 dòng, 8,5 giây; tài khoản gửi nhiều nhất 22 giây; viết thế này còn 31–50 ms).
    LEFT JOIN LATERAL (
      SELECT z.id, z.account_id, z.staff_id, z.organization_id, z.zalo_name, z.phone_number, z.raw_payload, z.gender,
        z.sdob, z.dob, z.global_id, z.is_blocked, z.updated_at
      FROM public.zalo_users AS z WHERE z.id = ct.zalo_user_id OFFSET 0
    ) AS zu ON zu.account_id = ct.account_id AND zu.staff_id = ct.staff_id AND zu.organization_id = ct.organization_id
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

DO $postflight$
DECLARE v_state text;
BEGIN
  SELECT md5(p.prosrc) || ' ' || p.provolatile::text || ' ' || p.prosecdef::text || ' ' || array_to_string(p.proconfig, ';') || ' '
      || (SELECT string_agg(x.g, ',' ORDER BY x.g) FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM aclexplode(p.proacl) AS a) AS x)
  INTO v_state FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.zalo_friend_filter_rows_v1(bigint,bigint,jsonb,timestamp with time zone,boolean)');
  IF v_state IS DISTINCT FROM '00963a2d3485f8c4dcf1906bf373346f s false search_path=pg_catalog, pg_temp;jit=off postgres' THEN
    RAISE EXCEPTION 'friend_filter_rows_function_state_unexpected: %', v_state;
  END IF;
END
$postflight$;
COMMIT;
