#!/usr/bin/env python3
"""Sinh migrations/migration_v614_find_data_push_match_key_v2.sql và bản gỡ từ V610 (khoá so sánh của hàm đẩy data tìm được).

V614 vá khoá so sánh của V610 (đo trên dữ liệu thật 21/11/2026, chỉ đọc):
  - UID: V610 chỉ bỏ "/" cuối nên 100072…, facebook.com/profile.php?id=100072…, groups/<nhóm>/user/100072…/?__cft__…,
    marketplace/profile/100072…/ là các khoá khác nhau; tên riêng trần (huan.khanh.1840) khác facebook.com/huan.khanh.1840.
    Data đẩy sang chiến dịch UID 99% là UID số, data khách nhập ở chiến dịch "Nhắn tin & Kết bạn UID" 57% profile.php?id=.
  - Group: mã group số trần (khoảng 850 dòng mỗi loại chiến dịch group) khác facebook.com/groups/<mã>.
  - Link bài: groups/<nhóm>/permalink/<id>, /pending_posts/<id>, ?multi_permalinks=<id> là cùng bài với /posts/<id>;
    story_fbid / id đổi thứ tự là khoá khác; story.php khác permalink.php.
  - Link Zalo: tham số sau "?" làm khoá khác.
  - Mã phân biệt hoa thường (link chia sẻ share/<x>/<mã>, pfbid…) bị V610 hạ chữ thường: giữ nguyên.
Bước lọc nhanh dòng của đích đổi từ "khoá thô" (V610: một hàm SQL riêng, phải tự giữ bất biến với khoá đầy đủ) sang "mảnh":
các đoạn chữ / số của giá trị (tách ở ký tự không phải chữ / số). Khoá đầy đủ ghép từ chính các đoạn của giá trị nên hai giá trị
cùng khoá luôn có chung ít nhất một mảnh: không bỏ sót trùng.
    python3 scripts/find-data-push/build-v614-sql.py
"""
import hashlib
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[2]
v610 = (root / 'migrations/migration_v610_find_data_push_match_key.sql').read_text(encoding='utf-8')


def extract(text, head):
    start = text.index(head)
    end = text.index('$function$;', text.index('AS $function$', start) + 13) + len('$function$;')
    return text[start:end]


v610_match = extract(v610, 'CREATE FUNCTION private.aka_agent_find_data_match_key(p_kind text, p_value text)')
v610_coarse = extract(v610, 'CREATE FUNCTION private.aka_agent_find_data_coarse_key(p_kind text, p_value text)')
v610_push = extract(v610, 'CREATE OR REPLACE FUNCTION public.aka_agent_find_data_push_v1(p_payload jsonb)')


def body_md5(fn_text):
    m = re.search(r'AS \$function\$(.*)\$function\$;', fn_text, re.S)
    return hashlib.md5(m.group(1).encode()).hexdigest()


V610_MATCH_MD5 = '3360f6e7130f9857866564c497ba26d4'
V610_COARSE_MD5 = 'f8b51af4beded560216ce3c937810be1'
V610_PUSH_MD5 = 'd9fbaed069124f9fdc85f8be2036bd45'
assert body_md5(v610_match) == V610_MATCH_MD5
assert body_md5(v610_coarse) == V610_COARSE_MD5
assert body_md5(v610_push) == V610_PUSH_MD5

# Mảnh không mang danh tính (tên miền, từ khoá đường dẫn, tham số theo dõi): bỏ khỏi mảnh của data gửi lên để lọc nhanh hơn.
# Danh tính (mã số, mã group, tên riêng, mã link) không bao giờ chỉ gồm các mảnh này.
STOP_TOKENS = ['', 'http', 'https', 'www', 'm', 'mbasic', 'mobile', 'web', 'touch', 'facebook', 'fb', 'com', 'zalo', 'me',
               'groups', 'posts', 'permalink', 'pending', 'profile', 'php', 'id', 'user', 'story', 'fbid', 'share', 'multi',
               'permalinks', 'marketplace', 'people', 'photo', 'photos', 'videos', 'watch', 'reel', 'g', 'p', 'v', 'r',
               'cft', 'tn', 'mibextid', 'ref', 'comment']
stop_sql = 'ARRAY[' + ', '.join("'" + t + "'" for t in STOP_TOKENS) + ']::text[]'

TRACKING_PARAMS = ['mibextid', 'ref', 'locale', 'comment_id', 'reply_comment_id', 'rdid', 'share_url', 'sfnsn', 'extid',
                   'paipv', 'eav', '_rdr', '_rdc', 'refsrc', 'hc_ref', 'fref', 'notif_id', 'notif_t', 'acontext', 'aref', 's', 'app']
tracking_sql = ', '.join("'" + t + "'" for t in TRACKING_PARAMS)
RESERVED_FIRST_SEGMENTS = ['groups', 'marketplace', 'people', 'share', 'watch', 'reel', 'pages', 'events', 'hashtag', 'photo',
                           'photo.php', 'story.php', 'permalink.php', 'profile.php', 'search', 'messages', 'friends', 'videos']
reserved_sql = ', '.join("'" + t + "'" for t in RESERVED_FIRST_SEGMENTS)
PROFILE_SUBPAGES = ['about', 'about_contact_and_basic_info', 'directory_contact_info', 'photos', 'friends', 'videos', 'followers', 'following', 'reels']
subpages = '|'.join(PROFILE_SUBPAGES)

new_match = f"""CREATE OR REPLACE FUNCTION private.aka_agent_find_data_match_key(p_kind text, p_value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_raw text := btrim(COALESCE(p_value, ''));
  v text;
  v_host text;
  v_rest text;
  v_path text;
  v_lpath text;
  v_q text;
  v_fb boolean;
  v_zalo boolean;
  m text[];
  v_id text;
  v_kept text;
  v_first text;
  v_generic text;
BEGIN
  IF v_raw = '' THEN RETURN NULL; END IF;
  IF p_kind = 'phone' THEN
    RETURN NULLIF(public.normalize_phone(v_raw), '');
  END IF;
  -- Tách máy chủ / đường dẫn / tham số. Chỉ nhận máy chủ Facebook / Zalo; giá trị không có máy chủ (mã, tên riêng trần) là đường dẫn.
  v_raw := rtrim(split_part(v_raw, '#', 1), '/');
  IF v_raw = '' THEN RETURN NULL; END IF;
  v := regexp_replace(v_raw, '^[A-Za-z][A-Za-z0-9+.-]*://', '');
  v_host := lower(COALESCE(substring(v FROM '^([^/?]*)'), ''));
  v_fb := v_host ~ '^([a-z0-9-]+\\.)*(facebook|fb)\\.com$';
  v_zalo := v_host ~ '^([a-z0-9-]+\\.)*zalo\\.me$';
  IF v_fb OR v_zalo THEN
    v_rest := substr(v, length(v_host) + 1);
  ELSIF v <> v_raw THEN
    -- Có giao thức nhưng không phải Facebook / Zalo: so cả địa chỉ (bỏ giao thức, "/" cuối), không phân biệt hoa thường.
    RETURN NULLIF(rtrim(lower(v), '/'), '');
  ELSE
    v_rest := v;
  END IF;
  v_path := regexp_replace(regexp_replace(split_part(v_rest, '?', 1), '/{{2,}}', '/', 'g'), '^/+|/+$', '', 'g');
  v_q := CASE WHEN position('?' IN v_rest) > 0 THEN substr(v_rest, position('?' IN v_rest) + 1) ELSE '' END;
  v_lpath := lower(v_path);
  -- Dạng chung (khi không nhận ra dạng riêng): đường dẫn + tham số không phải theo dõi, xếp theo tên. Không bỏ tham số mang danh tính.
  SELECT string_agg(p.part, '&' ORDER BY p.part) INTO v_kept
    FROM (SELECT regexp_replace(regexp_replace(x, '/+$', ''), '=$', '') AS part FROM unnest(string_to_array(lower(v_q), '&')) AS x) AS p
   WHERE p.part <> ''
     AND split_part(p.part, '=', 1) NOT IN ({tracking_sql})
     AND left(split_part(p.part, '=', 1), 2) <> '__';
  v_generic := NULLIF(CASE WHEN v_fb THEN 'www.facebook.com/' ELSE '' END || v_lpath
    || CASE WHEN COALESCE(v_kept, '') <> '' THEN '?' || v_kept ELSE '' END, '');

  IF p_kind = 'zalo_group_link' THEN
    IF NOT v_zalo AND v_lpath ~ '^[0-9]+$' THEN RETURN v_lpath; END IF;
    IF v_zalo OR v_lpath ~ '^g/' THEN RETURN NULLIF('zalo.me/' || v_lpath, 'zalo.me/'); END IF;
    RETURN v_generic;
  END IF;

  IF p_kind = 'facebook_group' THEN
    IF NOT v_fb AND v_lpath ~ '^[0-9]{{5,}}$' THEN RETURN 'facebook.com/groups/' || v_lpath; END IF;
    m := regexp_match(v_lpath, '^groups/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/groups/' || m[1]; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/share/' || lower(m[1]) || '/' || m[2]; END IF;
    -- Không phải group (chiến dịch comment seeding nhận cả trang cá nhân / trang): so như UID, tiền tố riêng.
    RETURN 'profile:' || private.aka_agent_find_data_match_key('facebook_uid', p_value);
  END IF;

  IF p_kind IN ('facebook_uid', 'facebook_group_admin') THEN
    -- Cùng một người với cách bộ chạy mở (helpers.normalizeFbUrl / extractUidFromInput): UID số ở bất kỳ dạng nào.
    IF v_lpath ~ '^[0-9]{{5,20}}$' THEN RETURN v_lpath; END IF;
    v_id := substring(v_q FROM '(?:^|&)id=([0-9]{{5,20}})(?:&|$)');
    IF v_id IS NULL THEN
      v_id := (regexp_match(v_lpath, '(?:^|/)(?:user|marketplace/profile|people/[^/]+)/([0-9]{{5,20}})(?:/|$)'))[1];
    END IF;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'share/' || lower(m[1]) || '/' || m[2]; END IF;
    -- Tên riêng: trang cá nhân (một đoạn, hoặc thêm một trang con như /about), không phân biệt hoa thường. Đường dẫn khác (bài
    -- viết, ảnh…) so nguyên: không gộp các link bài của cùng một người.
    v_first := split_part(v_lpath, '/', 1);
    IF v_first ~ '^[a-z0-9.]{{5,50}}$' AND v_first NOT IN ({reserved_sql})
      AND (v_lpath = v_first OR v_lpath ~ ('^[^/]+/(?:' || '{subpages}' || ')$')) THEN
      RETURN v_first;
    END IF;
    RETURN v_generic;
  END IF;

  IF p_kind = 'post_link' THEN
    m := regexp_match(v_path, '^groups/([^/]+)/(?:posts|permalink|pending_posts)/([^/]+)', 'i');
    IF m IS NOT NULL THEN
      RETURN 'facebook.com/groups/' || lower(m[1]) || '/posts/' || CASE WHEN m[2] ~* '^pfbid' THEN m[2] ELSE lower(m[2]) END;
    END IF;
    v_id := substring(v_q FROM '(?:^|&)multi_permalinks=([^&%,]+)');
    m := regexp_match(v_lpath, '^groups/([^/]+)$');
    IF v_id IS NOT NULL AND m IS NOT NULL THEN
      RETURN 'facebook.com/groups/' || m[1] || '/posts/' || CASE WHEN v_id ~* '^pfbid' THEN v_id ELSE lower(v_id) END;
    END IF;
    IF v_lpath ~ '^(permalink|story)\\.php$' THEN
      v_id := substring(v_q FROM '(?:^|&)story_fbid=([^&]+)');
      IF v_id IS NOT NULL THEN
        RETURN 'facebook.com/story/' || CASE WHEN v_id ~* '^pfbid' THEN v_id ELSE lower(v_id) END
          || '/' || COALESCE(substring(v_q FROM '(?:^|&)id=([0-9]+)'), '');
      END IF;
    END IF;
    m := regexp_match(v_path, '^([^/]+)/posts/([^/]+)');
    IF m IS NOT NULL AND lower(m[1]) <> 'groups' THEN
      RETURN 'facebook.com/' || lower(m[1]) || '/posts/' || CASE WHEN m[2] ~* '^pfbid' THEN m[2] ELSE lower(m[2]) END;
    END IF;
    IF v_lpath ~ '^photo(\\.php)?$' AND substring(v_q FROM '(?:^|&)fbid=([0-9]+)') IS NOT NULL THEN
      RETURN 'facebook.com/photo/' || substring(v_q FROM '(?:^|&)fbid=([0-9]+)');
    END IF;
    m := regexp_match(v_lpath, '^[^/]+/photos/(?:[^/]+/)?([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/photo/' || m[1]; END IF;
    IF v_lpath = 'watch' AND substring(v_q FROM '(?:^|&)v=([0-9]+)') IS NOT NULL THEN
      RETURN 'facebook.com/video/' || substring(v_q FROM '(?:^|&)v=([0-9]+)');
    END IF;
    m := regexp_match(v_lpath, '^(?:[^/]+/)?videos/(?:[^/]+/)*([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/video/' || m[1]; END IF;
    m := regexp_match(v_lpath, '^reel/([0-9]+)$');
    IF m IS NOT NULL THEN RETURN 'facebook.com/reel/' || m[1]; END IF;
    m := regexp_match(v_path, '^share/([A-Za-z])/([^/]+)');
    IF m IS NOT NULL THEN RETURN 'facebook.com/share/' || lower(m[1]) || '/' || m[2]; END IF;
    RETURN v_generic;
  END IF;

  RETURN v_generic;
END;
$function$;"""

new_tokens = """CREATE FUNCTION private.aka_agent_find_data_match_tokens(p_kind text, p_value text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT CASE
    WHEN p_kind = 'phone' THEN ARRAY[COALESCE(NULLIF(public.normalize_phone(btrim(COALESCE(p_value, ''))), ''), '')]
    WHEN COALESCE(p_value, '') ~ '[A-Za-z0-9]' THEN regexp_split_to_array(lower(p_value), '[^a-z0-9]+')
    -- Không có chữ / số nào: lấy khoá làm mảnh (hiếm, chỉ data rác).
    ELSE ARRAY[COALESCE(private.aka_agent_find_data_match_key(p_kind, p_value), '')]
  END
$function$;"""

old_cte = """      WITH item_coarse AS MATERIALIZED (
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
      ), plan AS ("""
new_cte = f"""      WITH item_tokens AS MATERIALIZED (
        SELECT DISTINCT t.tok
          FROM jsonb_to_recordset(v_items) AS i(value text)
          CROSS JOIN LATERAL unnest(private.aka_agent_find_data_match_tokens(v_kind, i.value)) AS t(tok)
         WHERE t.tok <> ALL ({stop_sql})
      ), target_keys AS MATERIALIZED (
        SELECT DISTINCT private.aka_agent_find_data_match_key(v_kind, t.raw) AS k
          FROM (
            SELECT CASE WHEN v_rule.value_column = 'phone' THEN x.phone ELSE x.uid END AS raw
              FROM public.auto_campaign_input_data AS x
             WHERE x.campaign_id = v_target_id AND COALESCE(x.is_delete, false) = false
          ) AS t
         WHERE EXISTS (
           SELECT 1 FROM unnest(private.aka_agent_find_data_match_tokens(v_kind, t.raw)) AS r(tok)
            WHERE r.tok IN (SELECT tok FROM item_tokens)
         )
      ), plan AS ("""
old_cte_comment = """      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng khoá (V610: khoá DB tính, nên data khách
      -- nhập kiểu khác vẫn nhận ra). Khoá đầy đủ chỉ tính cho dòng có khoá thô trùng data gửi lên (khoá thô: SQL thuần, rẻ; cùng khoá
      -- đầy đủ thì chắc chắn cùng khoá thô), đích 60.000 dòng không phải tính khoá đầy đủ cho từng dòng."""
new_cte_comment = """      -- Data đích đã có (already): sổ đẩy của đích (mọi nguồn) hoặc dòng data đang có cùng khoá (khoá DB tính, nên data khách
      -- nhập kiểu khác vẫn nhận ra). Khoá đầy đủ chỉ tính cho dòng có chung ít nhất một mảnh chữ / số (trừ tên miền, từ khoá đường
      -- dẫn) với data gửi lên; khoá ghép từ chính các đoạn của giá trị nên cùng khoá thì luôn chung mảnh."""


def replace_once(text, old, new):
    assert text.count(old) == 1, old[:80]
    return text.replace(old, new)


new_push = replace_once(v610_push, old_cte, new_cte)
new_push = replace_once(new_push, old_cte_comment, new_cte_comment)
new_push = replace_once(new_push, '-- Data gửi lên: khoá do DB tính (V610, không dùng khoá app gửi)', '-- Data gửi lên: khoá do DB tính (không dùng khoá app gửi)')

# Các cách viết của cùng một data phải ra cùng khoá (kiểm sau khi apply và trong bài kiểm).
SAME = [
    ('facebook_uid', '100072022092879', 'https://www.facebook.com/profile.php?id=100072022092879'),
    ('facebook_uid', '100072022092879', 'https://m.facebook.com/profile.php?id=100072022092879&comment_id=Y29tbWVudA%3D%3D'),
    ('facebook_uid', '100072022092879', 'https://www.facebook.com/groups/975457975877822/user/100072022092879/?__cft__[0]=AZj&__tn__=R'),
    ('facebook_uid', '100072022092879', 'https://www.facebook.com/marketplace/profile/100072022092879/?product_id=1&__cft__[0]=AZ'),
    ('facebook_uid', '100072022092879', 'facebook.com/100072022092879/'),
    ('facebook_uid', 'huan.khanh.1840', 'https://www.facebook.com/huan.khanh.1840/'),
    ('facebook_uid', 'https://www.facebook.com/photo/?fbid=164&set=a.107/', 'https://www.facebook.com/photo/?fbid=164&set=a.107'),
    ('facebook_uid', 'https://web.facebook.com/Huan.Khanh.1840?mibextid=abc', 'https://www.facebook.com/huan.khanh.1840/about'),
    ('facebook_group', '1856052657967796', 'https://www.facebook.com/groups/1856052657967796/'),
    ('facebook_group', 'https://www.facebook.com/groups/12345/', 'https://m.facebook.com/groups/12345?ref=share'),
    ('facebook_group', 'https://www.facebook.com/groups/AbcShop/', 'facebook.com/groups/abcshop'),
    ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://m.facebook.com/profile.php?id=61573525756908&mibextid=x'),
    ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://m.facebook.com/groups/1/posts/2?__cft__[0]=AZ&__tn__=R'),
    ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/permalink/2/'),
    ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/pending_posts/2'),
    ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/?multi_permalinks=2&ref=share'),
    ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://web.facebook.com/permalink.php?id=6157&story_fbid=pfbid0X&mibextid=abc'),
    ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=pfbid0X&id=6157', 'https://www.facebook.com/story.php?story_fbid=pfbid0X&id=6157'),
    ('post_link', 'https://www.facebook.com/inkien/posts/pfbid0itURo', 'https://m.facebook.com/inkien/posts/pfbid0itURo/?__cft__[0]=x'),
    ('post_link', 'https://www.facebook.com/watch/?v=123456', 'https://www.facebook.com/abc/videos/123456/'),
    ('zalo_group_link', 'https://zalo.me/g/abcdef123', ' HTTPS://ZALO.ME/G/ABCDEF123/ '),
    ('zalo_group_link', 'https://zalo.me/g/abcdef123', 'zalo.me/g/abcdef123?src=share'),
    ('phone', '0985794636', '+84 985 794 636'),
]
# Data khác nhau phải ra khoá khác nhau.
DIFFERENT = [
    ('facebook_uid', '100072022092879', '1000720220928790'),
    ('facebook_uid', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid022tp6iCho', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid02bJD7Puwm'),
    ('facebook_uid', 'https://www.facebook.com/phuonguyen.vu.3766/posts/pfbid022tp6iCho', 'https://www.facebook.com/phuonguyen.vu.3766'),
    ('facebook_uid', 'https://www.facebook.com/profile.php?id=10007202', 'https://www.facebook.com/profile.php?id=100072022'),
    ('facebook_group', 'https://www.facebook.com/groups/1/', 'https://www.facebook.com/groups/12/'),
    ('post_link', 'https://www.facebook.com/permalink.php?story_fbid=a&id=1', 'https://www.facebook.com/permalink.php?story_fbid=b&id=1'),
    ('post_link', 'https://www.facebook.com/groups/1/posts/2/', 'https://www.facebook.com/groups/1/posts/3/'),
    ('post_link', 'https://www.facebook.com/share/p/1AbCdEfGhI/', 'https://www.facebook.com/share/p/1abcdefghi/'),
    ('facebook_group', 'https://www.facebook.com/share/g/1AbCdEfGhI/', 'https://www.facebook.com/share/g/1abcdefghi/'),
    ('facebook_group', 'https://www.facebook.com/profile.php?id=61573525756908', 'https://www.facebook.com/profile.php?id=61573768148044'),
    ('facebook_uid', 'https://www.facebook.com/photo/?fbid=111', 'https://www.facebook.com/photo/?fbid=222'),
    ('zalo_group_link', 'https://zalo.me/g/abc123', 'https://zalo.me/g/abc124'),
    ('phone', '0985794636', '0985794637'),
]


def sql_values(rows):
    return ',\n      '.join("('{}', '{}', '{}')".format(k, a.replace("'", "''"), b.replace("'", "''")) for k, a, b in rows)


checks = f"""  -- Các cách viết của cùng một data ra cùng khoá.
  SELECT string_agg(format('%s:%s→%s≠%s', c.kind, c.a, private.aka_agent_find_data_match_key(c.kind, c.a),
                           private.aka_agent_find_data_match_key(c.kind, c.b)), '; ') INTO v_bad
    FROM (VALUES
      {sql_values(SAME)}
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) IS DISTINCT FROM private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: khoá khác nhau: %', v_bad; END IF;
  -- Cùng khoá thì chung ít nhất một mảnh (bước lọc nhanh không bỏ sót).
  SELECT string_agg(format('%s:%s', c.kind, c.a), '; ') INTO v_bad
    FROM (VALUES
      {sql_values(SAME)}
    ) AS c(kind, a, b)
   WHERE NOT EXISTS (
     SELECT 1 FROM unnest(private.aka_agent_find_data_match_tokens(c.kind, c.a)) AS x(tok)
      WHERE x.tok <> ALL ({stop_sql})
        AND x.tok = ANY (private.aka_agent_find_data_match_tokens(c.kind, c.b)));
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: cùng khoá mà không chung mảnh: %', v_bad; END IF;
  -- Data khác nhau ra khoá khác nhau.
  SELECT string_agg(format('%s:%s=%s', c.kind, c.a, c.b), '; ') INTO v_bad
    FROM (VALUES
      {sql_values(DIFFERENT)}
    ) AS c(kind, a, b)
   WHERE private.aka_agent_find_data_match_key(c.kind, c.a) = private.aka_agent_find_data_match_key(c.kind, c.b);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: hai data khác nhau ra cùng khoá: %', v_bad; END IF;"""

grants = """REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_tokens(text, text) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_match_tokens(text, text) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;"""

rekey = """-- Sổ đẩy ghi trước bản này mang khoá cũ: tính lại theo khoá mới. Hai dòng cùng liên kết ra cùng khoá thì giữ một
-- (ưu tiên dòng "inserted", rồi dòng cũ nhất). Đổi qua khoá tạm trước để không vướng ràng buộc duy nhất (link_id, value_key).
CREATE TEMP TABLE {tmp} ON COMMIT DROP AS
  SELECT d.id, d.link_id, d.result, d.created_at,
         COALESCE(left(private.aka_agent_find_data_match_key(r.output_kind, d.value), 2048), d.value_key) AS nk
    FROM public.auto_campaign_data_link_deliveries AS d
    JOIN public.auto_campaign_data_links AS l ON l.id = d.link_id
    JOIN public.auto_campaign_data_link_rules AS r ON r.id = l.rule_id;
DELETE FROM public.auto_campaign_data_link_deliveries AS d
 USING (SELECT id, row_number() OVER (PARTITION BY link_id, nk ORDER BY (result = 'inserted') DESC, created_at, id) AS rn FROM {tmp}) AS x
 WHERE d.id = x.id AND x.rn > 1;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = '~' || d.id
  FROM {tmp} AS x WHERE d.id = x.id AND d.value_key IS DISTINCT FROM x.nk;
UPDATE public.auto_campaign_data_link_deliveries AS d SET value_key = x.nk
  FROM {tmp} AS x WHERE d.id = x.id AND d.value_key = '~' || d.id;"""

NEW_MATCH_MD5 = body_md5(new_match)
NEW_TOKENS_MD5 = body_md5(new_tokens)
NEW_PUSH_MD5 = body_md5(new_push)

migration = f"""-- V614: vá khoá so sánh của hàm đẩy data tìm được (V610) để nhận ra cùng một data ở mọi cách viết đã gặp trên dữ liệu thật.
--
-- Đo trên dữ liệu thật 21/11/2026 (chỉ đọc):
--   - UID: V610 chỉ bỏ "/" cuối, nên UID số, profile.php?id=<số>, groups/<nhóm>/user/<số>/, marketplace/profile/<số>/ của cùng một
--     người là các khoá khác nhau; tên riêng trần khác facebook.com/<tên riêng>. Chiến dịch "Nhắn tin & Kết bạn UID": data đẩy sang
--     99% là UID số, data khách nhập 57% profile.php?id=.
--   - Group: mã group số trần (~850 dòng mỗi loại chiến dịch group) khác facebook.com/groups/<mã>.
--   - Link bài: /permalink/<id>, /pending_posts/<id>, ?multi_permalinks=<id> cùng bài với /posts/<id>; story_fbid / id đổi thứ tự;
--     story.php và permalink.php.
--   - Link Zalo: tham số sau "?". Mã phân biệt hoa thường (share/<x>/<mã>, pfbid…) không còn bị hạ chữ thường.
-- Bước lọc nhanh dòng của đích: "mảnh" chữ / số của giá trị (private.aka_agent_find_data_match_tokens) thay khoá thô của V610;
-- khoá ghép từ chính các đoạn của giá trị nên hai giá trị cùng khoá luôn chung mảnh. Hàm khoá thô V610 bị xoá.
-- Thay thân hàm đẩy (chỉ phần lọc nhanh), khoá so sánh; tính lại khoá của sổ đẩy (production lúc viết: 0 dòng).
-- Sinh bằng: python3 scripts/find-data-push/build-v614-sql.py. Gỡ: migrations/rollback_v614_find_data_push_match_key_v2.sql.

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v614_%') THEN
      RAISE EXCEPTION 'V614 đã có trong sổ migration, không chạy lại';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v610_find_data_push_match_key') THEN
      RAISE EXCEPTION 'V614: cần V610 trước';
    END IF;
  END IF;
  IF to_regprocedure('private.aka_agent_find_data_match_tokens(text, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'V614: hàm mảnh đã có';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> '{V610_PUSH_MD5}'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> '{V610_MATCH_MD5}'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_coarse_key(text, text)'::regprocedure) <> '{V610_COARSE_MD5}'
  THEN
    RAISE EXCEPTION 'V614: thân hàm khác bản V610 đã kiểm';
  END IF;
END $pre$;

{new_match}

{new_tokens}

{grants}

{new_push}

DROP FUNCTION private.aka_agent_find_data_coarse_key(text, text);

{rekey.format(tmp='v614_rekey')}

DO $post$
DECLARE
  v_bad text;
BEGIN
{checks}
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> '{NEW_PUSH_MD5}'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> '{NEW_MATCH_MD5}'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_tokens(text, text)'::regprocedure) <> '{NEW_TOKENS_MD5}'
  THEN
    RAISE EXCEPTION 'V614 postflight: thân hàm khác bản sinh';
  END IF;
  SELECT string_agg(rolname, ', ' ORDER BY rolname) INTO v_bad
    FROM pg_roles
   WHERE rolname IN ('anon', 'authenticated', 'service_role', 'aka_agent_chat_api')
     AND has_function_privilege(rolname, 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V614 postflight: role không được gọi hàm: %', v_bad; END IF;
  IF NOT has_function_privilege('aka_agent_desktop', 'public.aka_agent_find_data_push_v1(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V614 postflight: aka_agent_desktop chưa gọi được hàm';
  END IF;
  IF has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_tokens(text, text)', 'EXECUTE')
    OR has_function_privilege('aka_agent_desktop', 'private.aka_agent_find_data_match_key(text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'V614 postflight: aka_agent_desktop không được gọi thẳng hàm khoá';
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_campaign_data_link_deliveries WHERE value_key LIKE '~%') THEN
    RAISE EXCEPTION 'V614 postflight: sổ đẩy còn khoá tạm';
  END IF;
END $post$;

COMMIT;
"""

v610_match_replace = v610_match.replace('CREATE FUNCTION private.aka_agent_find_data_match_key', 'CREATE OR REPLACE FUNCTION private.aka_agent_find_data_match_key', 1)

rollback = f"""-- Gỡ V614: trả khoá so sánh, khoá thô và hàm đẩy về đúng bản V610, xoá hàm mảnh, tính lại khoá sổ đẩy theo khoá V610.
-- Dòng sổ migration giữ lại.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

{v610_match_replace}

{v610_coarse}

REVOKE ALL ON FUNCTION private.aka_agent_find_data_coarse_key(text, text) FROM PUBLIC;
DO $grants$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION private.aka_agent_find_data_coarse_key(text, text) FROM %I', r);
    END IF;
  END LOOP;
END $grants$;

{v610_push}

DROP FUNCTION IF EXISTS private.aka_agent_find_data_match_tokens(text, text);

{rekey.format(tmp='v614_unkey')}

DO $post$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'public.aka_agent_find_data_push_v1(jsonb)'::regprocedure) <> '{V610_PUSH_MD5}'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_match_key(text, text)'::regprocedure) <> '{V610_MATCH_MD5}'
    OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'private.aka_agent_find_data_coarse_key(text, text)'::regprocedure) <> '{V610_COARSE_MD5}'
  THEN
    RAISE EXCEPTION 'gỡ V614: thân hàm không về đúng bản V610';
  END IF;
END $post$;

COMMIT;
"""

(root / 'migrations/migration_v614_find_data_push_match_key_v2.sql').write_text(migration, encoding='utf-8')
(root / 'migrations/rollback_v614_find_data_push_match_key_v2.sql').write_text(rollback, encoding='utf-8')
(root / 'scripts/find-data-push/v614-stop-tokens.json').write_text(
    '{"stopTokens": ' + str(STOP_TOKENS).replace("'", '"') + '}\n', encoding='utf-8')
print('migration md5', hashlib.md5(migration.encode()).hexdigest())
print('match', NEW_MATCH_MD5, 'tokens', NEW_TOKENS_MD5, 'push', NEW_PUSH_MD5)
