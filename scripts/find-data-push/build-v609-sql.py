#!/usr/bin/env python3
"""Sinh migrations/migration_v609_find_data_push_match_key.sql và bản gỡ từ thân hàm đẩy của V608 (sửa đúng 2 chỗ, có kiểm).

V609: hàm đẩy so "cùng một data" bằng khoá DB tự tính (private.aka_agent_find_data_match_key) cho cả data gửi lên lẫn data đang có
ở đích, thay vì so nguyên chuỗi (V608 bỏ sót data viết kiểu khác: dấu "/" cuối, m./web., tham số theo dõi, chữ hoa; lô kiểm
"cách viết khác" của scripts/find-data-push/replay-realdata.cjs --variants 21/11/2026).
    python3 scripts/find-data-push/build-v609-sql.py
"""
import hashlib
import pathlib

root = pathlib.Path(__file__).resolve().parents[2]
v608 = (root / 'migrations/migration_v608_find_data_push_links.sql').read_text(encoding='utf-8')
start = v608.index('CREATE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)')
end = v608.index('$function$;', v608.index('RETURN jsonb_build_object', start)) + len('$function$;')
old_fn = v608[start:end]


def replace_once(text, old, new):
    assert text.count(old) == 1, old[:80]
    return text.replace(old, new)


new_fn = replace_once(old_fn, 'CREATE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)',
                      'CREATE OR REPLACE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)')
new_fn = replace_once(new_fn, "                 left(btrim(i.item ->> 'key'), 2048) AS value_key,",
                      "                 left(private.aka_agent_find_data_match_key(v_kind, i.item ->> 'value'), 2048) AS value_key,")
new_fn = replace_once(new_fn, "  -- Data gửi lên: bỏ dòng thiếu giá trị / khoá, mỗi khoá giữ dòng đầu tiên (giữ thứ tự gửi).",
                      "  -- Data gửi lên: khoá do DB tính (V609, không dùng khoá app gửi), bỏ dòng thiếu giá trị / khoá, mỗi khoá giữ dòng đầu tiên.")
old_plan = """      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng giá trị.
      WITH plan AS (
        SELECT i.ord, i.value, i.value_key, i.name,
               EXISTS (
                 SELECT 1 FROM public.auto_campaign_data_link_deliveries AS d
                  WHERE d.target_campaign_id = v_target_id AND d.value_key = i.value_key AND d.result = 'inserted'
               )
               OR CASE v_rule.value_column
                 WHEN 'phone' THEN EXISTS (
                   SELECT 1 FROM public.auto_campaign_input_data AS x
                    WHERE md5(public.normalize_phone(x.phone)) = md5(public.normalize_phone(i.value))
                      AND x.phone IS NOT NULL AND btrim(x.phone) <> ''
                      AND x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
                 )
                 ELSE EXISTS (
                   SELECT 1 FROM public.auto_campaign_input_data AS x
                    WHERE md5(lower(btrim(x.uid))) = md5(lower(btrim(i.value)))
                      AND x.uid IS NOT NULL AND btrim(x.uid) <> ''
                      AND x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
                 )
               END AS already
          FROM jsonb_to_recordset(v_items) AS i(ord integer, value text, value_key text, name text)
      ), ins AS ("""
new_plan = """      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng khoá (V609: khoá DB tính, nên data khách
      -- nhập kiểu khác vẫn nhận ra). Khoá đầy đủ chỉ tính cho dòng có khoá thô trùng data gửi lên (khoá thô: SQL thuần, rẻ; cùng khoá
      -- đầy đủ thì chắc chắn cùng khoá thô), đích 60.000 dòng không phải tính khoá đầy đủ cho từng dòng.
      WITH item_coarse AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_coarse_key(v_kind, i.value) AS c
          FROM jsonb_to_recordset(v_items) AS i(value text)
      ), target_keys AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_match_key(v_kind, t.raw) AS k
          FROM (
            SELECT CASE WHEN v_rule.value_column = 'phone' THEN x.phone ELSE x.uid END AS raw
              FROM public.auto_campaign_input_data AS x
             WHERE x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
          ) AS t
         WHERE private.aka_agent_find_data_coarse_key(v_kind, t.raw) IN (SELECT c FROM item_coarse)
      ), plan AS (
        SELECT i.ord, i.value, i.value_key, i.name,
               EXISTS (
                 SELECT 1 FROM public.auto_campaign_data_link_deliveries AS d
                  WHERE d.target_campaign_id = v_target_id AND d.value_key = i.value_key AND d.result = 'inserted'
               )
               OR EXISTS (SELECT 1 FROM target_keys AS tk WHERE tk.k = i.value_key) AS already
          FROM jsonb_to_recordset(v_items) AS i(ord integer, value text, value_key text, name text)
      ), ins AS ("""
new_fn = replace_once(new_fn, old_plan, new_plan)

match_key = r"""CREATE FUNCTION private.aka_agent_find_data_match_key(p_kind text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v text := lower(btrim(COALESCE(p_value, '')));
  v_group text;
  v_base text;
  v_query text;
  v_kept text;
BEGIN
  IF v = '' THEN RETURN NULL; END IF;
  IF p_kind = 'phone' THEN
    RETURN NULLIF(public.normalize_phone(v), '');
  END IF;
  IF p_kind = 'facebook_group' THEN
    v_group := substring(v FROM 'groups/([^/?#&[:space:]]+)');
    IF v_group IS NOT NULL THEN RETURN 'facebook.com/groups/' || v_group; END IF;
    RETURN NULLIF(rtrim(v, '/'), '');
  END IF;
  IF p_kind = 'zalo_group_link' THEN
    v := regexp_replace(split_part(v, '#', 1), '^https?://', '');
    v := regexp_replace(v, '^www\.', '');
    RETURN NULLIF(rtrim(v, '/'), '');
  END IF;
  IF p_kind = 'post_link' THEN
    v := regexp_replace(split_part(v, '#', 1), '^https?://', '');
    v := regexp_replace(v, '^((m|mbasic|mobile|web|www)\.)?facebook\.com', 'www.facebook.com');
    v_base := rtrim(split_part(v, '?', 1), '/');
    v_query := CASE WHEN position('?' IN v) > 0 THEN substr(v, position('?' IN v) + 1) ELSE '' END;
    SELECT string_agg(p.part, '&' ORDER BY p.ord) INTO v_kept
      FROM unnest(string_to_array(v_query, '&')) WITH ORDINALITY AS p(part, ord)
     WHERE p.part <> ''
       AND split_part(p.part, '=', 1) NOT IN ('mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id')
       AND left(split_part(p.part, '=', 1), 2) <> '__';
    RETURN NULLIF(v_base || CASE WHEN COALESCE(v_kept, '') <> '' THEN '?' || v_kept ELSE '' END, '');
  END IF;
  -- facebook_uid và mặc định: bỏ "/" cuối, không phân biệt hoa thường.
  RETURN NULLIF(rtrim(v, '/'), '');
END;
$function$;"""

coarse_key = r"""-- Khoá thô (lọc nhanh trước khi tính khoá đầy đủ): SQL thuần không SET để được nhúng vào câu gọi. Bất biến: hai giá trị cùng khoá
-- đầy đủ (aka_agent_find_data_match_key) luôn cùng khoá thô; khoá thô trùng mà khoá đầy đủ khác thì chỉ tốn thêm một lần tính.
CREATE FUNCTION private.aka_agent_find_data_coarse_key(p_kind text, p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN NULLIF(public.normalize_phone(p_value), '')
    WHEN p_kind = 'facebook_group' THEN COALESCE(
      'facebook.com/groups/' || substring(lower(p_value) FROM 'groups/([^/?#&[:space:]]+)'),
      NULLIF(rtrim(lower(btrim(p_value)), '/'), ''))
    ELSE NULLIF(
      rtrim(split_part(split_part(regexp_replace(lower(btrim(p_value)), '^https?://((m|mbasic|mobile|web|www)[.])?', ''), '#', 1), '?', 1), '/')
      || COALESCE('|' || substring(lower(p_value) FROM '[?&]story_fbid=([^&#]+)'), '')
      || COALESCE('|' || substring(lower(p_value) FROM '[?&](?:id|v|fbid)=([^&#]+)'), ''), '')
  END
$function$;"""

new_fn_md5_note = hashlib.md5(new_fn.encode()).hexdigest()

migration = f"""-- V609: hàm đẩy data của chiến dịch tìm data (V608) nhận ra "cùng một data" dù viết khác.
--
-- Vì sao (lô kiểm "cách viết khác" 21/11/2026, scripts/find-data-push/replay-realdata.cjs --variants, data thật của đích):
--   V608 so data gửi lên với data đang có ở đích bằng nguyên chuỗi (chỉ bỏ khoảng trắng, chữ hoa). Đích có data viết khác thì
--   thêm trùng: group Facebook khách nhập m.facebook.com / thiếu "/" cuối (30/30 trùng), UID có "/" cuối (13/13), link bài kèm
--   tham số theo dõi (20/20), link group Zalo có "/" cuối (3/3); trong một lượt, cùng link Zalo viết hai kiểu thêm 2 dòng.
--   SĐT đã đúng (normalize_phone). Phát lại 1.128 lượt thật không gặp vì data đích lúc đó cùng kiểu viết.
--
-- Nội dung (chỉ thay thân hàm, không đổi bảng / quyền / khuôn trả về):
--   1. private.aka_agent_find_data_match_key(kind, value): khoá so sánh theo loại đầu ra (group = mã sau /groups/; link bài = bỏ
--      giao thức, m./web. → www., bỏ "/" cuối, bỏ tham số theo dõi; link Zalo = bỏ giao thức / www. / "/" cuối; UID = bỏ "/" cuối;
--      SĐT = normalize_phone). Không phân biệt hoa thường.
--   2. aka_agent_find_data_push_v1: khoá của data gửi lên và sổ đẩy dùng khoá này (không dùng khoá app gửi); data đang có ở đích
--      so theo khoá này; trước đó lọc dòng của đích bằng khoá thô (private.aka_agent_find_data_coarse_key, SQL thuần) nên chỉ tính khoá
--      đầy đủ cho dòng có thể trùng (đích 60.000 dòng: xem đo ở docs/FIND_DATA_PUSH_LINKS_V608.md).
-- Sổ đẩy production lúc viết: 0 dòng (Desktop chưa gọi hàm), nên đổi nghĩa khoá không cần chuyển dữ liệu.
-- Sinh bằng: python3 scripts/find-data-push/build-v609-sql.py. Gỡ: migrations/rollback_v609_find_data_push_match_key.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v609_%') THEN
      RAISE EXCEPTION 'V609 đã có trong sổ migration, không chạy lại';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v608_find_data_push_links') THEN
      RAISE EXCEPTION 'V609: cần V608 trước';
    END IF;
  END IF;
  IF to_regprocedure('public.aka_agent_find_data_push_v1(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'V609: thiếu aka_agent_find_data_push_v1 của V608';
  END IF;
  IF to_regprocedure('private.aka_agent_find_data_match_key(text, text)') IS NOT NULL
    OR to_regprocedure('private.aka_agent_find_data_coarse_key(text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V609: hàm khoá của V609 đã có';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'd04c4711cbdadeffca7238cff5f5f5cd' THEN
    RAISE EXCEPTION 'V609: thân aka_agent_find_data_push_v1 khác bản V608 đã kiểm';
  END IF;
END $pre$;

{match_key}

{coarse_key}

REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_key(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.aka_agent_find_data_coarse_key(text, text) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_key(text, text) FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_coarse_key(text, text) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

{new_fn}

DO $post$
DECLARE
  v_bad text;
BEGIN
  -- Khoá so sánh: các cách viết của cùng một data ra cùng khoá.
  SELECT string_agg(format('%s:%s→%s≠%s', c.kind, c.a, private.aka_agent_find_data_match_key(c.kind, c.a),
                           private.aka_agent_find_data_match_key(c.kind, c.b)), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
      ('facebook_group', 'https://www.facebook.com/groups/AbcShop/', 'facebook.com/groups/abcshop'),
      ('facebook_uid', '100071016740646', ' 100071016740646/ '),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157&mibextid=abc'),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
      ('phone', '0985794636', '+84 985 794 636')
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) IS DISTINCT FROM private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V609 postflight: khoá khác nhau: %', v_bad; END IF;
  SELECT string_agg(format('%s:%s', c.kind, c.a), '; ') INTO v_bad
    FROM (VALUES
      ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
      ('facebook_uid', '100071016740646', ' 100071016740646/ '),
      ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
      ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157&mibextid=abc'),
      ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
      ('phone', '0985794636', '+84 985 794 636')
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_coarse_key(c.kind, c.a) IS DISTINCT FROM private.aka_agent_find_data_coarse_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V609 postflight: khoá thô khác nhau: %', v_bad; END IF;
  -- Khác data thì khác khoá.
  IF private.aka_agent_find_data_match_key('facebook_group', 'https://www.facebook.com/groups/1/')
     = private.aka_agent_find_data_match_key('facebook_group', 'https://www.facebook.com/groups/12/')
    OR private.aka_agent_find_data_match_key('post_link', 'https://www.facebook.com/permalink.php?story_fbid=a&id=1')
     = private.aka_agent_find_data_match_key('post_link', 'https://www.facebook.com/permalink.php?story_fbid=b&id=1')
  THEN
    RAISE EXCEPTION 'V609 postflight: hai data khác nhau ra cùng khoá';
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V609 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V609 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_key(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V609 postflight: aka_agent_desktop không được gọi thẳng hàm khoá';
  END IF;
END $post$;

COMMIT;
"""

rollback = f"""-- Gỡ V609: trả aka_agent_find_data_push_v1 về đúng thân V608, xoá hàm khoá. Dòng sổ migration giữ lại.
-- Sổ đẩy ghi sau V609 mang khoá V609; V608 so khoá app gửi nên có thể không nhận ra vài data đã đẩy (đích vẫn kiểm theo dòng đang có).
BEGIN;
SET LOCAL lock_timeout = '3s';

{old_fn.replace('CREATE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)', 'CREATE OR REPLACE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)', 1)}

DROP FUNCTION IF EXISTS private.aka_agent_find_data_match_key(text, text);
DROP FUNCTION IF EXISTS private.aka_agent_find_data_coarse_key(text, text);

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> 'd04c4711cbdadeffca7238cff5f5f5cd' THEN
    RAISE EXCEPTION 'gỡ V609: thân hàm không về đúng bản V608';
  END IF;
END $post$;

COMMIT;
"""

(root / 'migrations/migration_v609_find_data_push_match_key.sql').write_text(migration, encoding='utf-8')
(root / 'migrations/rollback_v609_find_data_push_match_key.sql').write_text(rollback, encoding='utf-8')
print('migration md5', hashlib.md5(migration.encode()).hexdigest(), 'fn text md5', new_fn_md5_note)
