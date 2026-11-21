-- Fixture tối thiểu cho kiểm thử V608 (PG16 cục bộ): chỉ các cột / hàm / quyền mà V608 đọc, theo định nghĩa production 21/11/2026.
CREATE ROLE aka_agent_desktop NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE aka_agent_chat_api NOLOGIN;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO aka_agent_desktop, anon, authenticated, service_role, aka_agent_chat_api;
CREATE SCHEMA supabase_migrations;
CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[], created_by text);

CREATE TABLE public.category_type (id bigint PRIMARY KEY, namespace text, code text NOT NULL, name text, managed_by text,
  description text, is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.category_item (id bigint PRIMARY KEY, category_type_id bigint NOT NULL, code text NOT NULL, name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true, UNIQUE (category_type_id, code));
INSERT INTO public.category_type (id, code, name) VALUES (5, 'data_type', 'Loại dữ liệu');
INSERT INTO public.category_item (id, category_type_id, code, name) VALUES
  (34, 5, 'phone', 'SĐT'), (35, 5, 'email', 'Email'), (36, 5, 'facebook_search_keyword', 'Từ khoá'),
  (37, 5, 'facebook_post_url', 'Link bài'), (38, 5, 'facebook_person', 'User FB'), (39, 5, 'facebook_group', 'Group FB'),
  (40, 5, 'facebook_page', 'Page'), (42, 5, 'zalo_person', 'User Zalo'), (43, 5, 'zalo_group', 'Group Zalo');

CREATE TABLE public.auto_campaign_actions (id text PRIMARY KEY, name text, flatform_type text, is_active boolean DEFAULT true);
INSERT INTO public.auto_campaign_actions (id, name, flatform_type) VALUES
  ('facebook_find_data_group', 'Tìm data trong group', 'facebook'), ('facebook_find_data_search', 'Tìm data bằng search', 'facebook'),
  ('facebook_message_uid', 'Nhắn tin UID', 'facebook'), ('facebook_comment_seeding_post', 'Comment bài', 'facebook'),
  ('zalo_message_phone', 'Nhắn tin SĐT', 'zalo'), ('zalo_join_group_link', 'Tham gia group Zalo', 'zalo'),
  ('facebook_group_post', 'Đăng nhóm', 'facebook'), ('facebook_comment_seeding', 'Comment seeding', 'facebook'),
  ('facebook_join_group', 'Tham gia group', 'facebook'), ('facebook_message_friend', 'Nhắn bạn bè', 'facebook');

CREATE TABLE public.auto_campaign_action_data_types (
  campaign_action_id text NOT NULL, data_type_code text NOT NULL, can_source boolean NOT NULL, can_target boolean NOT NULL,
  target_contact_type text NOT NULL, is_active boolean NOT NULL DEFAULT true, is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  data_type_category_item_id bigint,
  CONSTRAINT uq_auto_campaign_action_semantic_data_type UNIQUE NULLS NOT DISTINCT (campaign_action_id, data_type_category_item_id)
);
-- Đúng các dòng production 21/11/2026 của những loại chiến dịch liên quan.
INSERT INTO public.auto_campaign_action_data_types (campaign_action_id, data_type_code, can_source, can_target, target_contact_type, data_type_category_item_id) VALUES
  ('facebook_comment_seeding', 'facebook_uid', true, true, 'campaign_input', 40),
  ('facebook_comment_seeding', 'facebook_uid', true, true, 'campaign_input', 38),
  ('facebook_comment_seeding', 'facebook_uid', true, true, 'campaign_input', 39),
  ('facebook_comment_seeding_post', 'facebook_uid', true, true, 'campaign_input', 37),
  ('facebook_find_data_group', 'facebook_uid', true, true, 'group', 39),
  ('facebook_find_data_search', 'facebook_uid', true, true, 'campaign_input', 36),
  ('facebook_group_post', 'facebook_uid', true, true, 'group', 39),
  ('facebook_join_group', 'facebook_uid', true, true, 'group', 39),
  ('facebook_message_friend', 'facebook_uid', true, true, 'person', 38),
  ('facebook_message_uid', 'facebook_uid', true, true, 'person', 38),
  ('zalo_join_group_link', 'zalo_uid', true, true, 'group', 43),
  ('zalo_message_phone', 'phone', true, true, 'phone', 34);

CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint NOT NULL, is_admin_akabiz boolean DEFAULT false,
  is_active boolean DEFAULT true, deleted_at timestamptz);
INSERT INTO public.org_staff (id, organization_id) VALUES (1, 100), (2, 200);

CREATE TABLE public.auto_campaigns (
  id bigint PRIMARY KEY, name text NOT NULL, action_id text, account_id bigint, status text NOT NULL DEFAULT 'chờ xử lý',
  is_delete boolean DEFAULT false, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  extra_settings jsonb DEFAULT '{}'::jsonb, staff_id bigint, organization_id bigint, note text, completed_at timestamptz,
  data_target_source_mode text NOT NULL DEFAULT 'direct'
);

CREATE TABLE public.auto_campaign_input_data (
  id bigserial PRIMARY KEY, campaign_id bigint, input_id bigint, name text, phone text, uid text, email text,
  status text DEFAULT 'chờ xử lý', note text, schedule timestamptz, date_action timestamptz, is_delete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), data_type_category_item_id bigint, content_rotation_indexes jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_campaign_input_data_campaign_id ON public.auto_campaign_input_data (campaign_id);
CREATE INDEX idx_campaign_input_cooldown_uid ON public.auto_campaign_input_data USING btree (md5(lower(btrim(uid))))
  WHERE ((uid IS NOT NULL) AND (btrim(uid) <> ''::text));

CREATE FUNCTION public.normalize_phone(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path TO 'pg_catalog' AS $function$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '[^0-9]', '', 'g');
  if d = '' then return ''; end if;
  if d like '0084%' and length(d) >= 13 then d := '0' || substr(d, 5);
  elsif d like '84%' and length(d) >= 11 then d := '0' || substr(d, 3);
  end if;
  if length(d) = 9 and left(d, 1) in ('3','5','7','8','9') then d := '0' || d; end if;
  return d;
end;
$function$;
CREATE INDEX idx_campaign_input_cooldown_phone ON public.auto_campaign_input_data USING btree (md5(normalize_phone(phone)))
  WHERE ((phone IS NOT NULL) AND (btrim(phone) <> ''::text));

-- Phiên Desktop giả: nhân viên lấy từ GUC test.staff_id khi đang SET ROLE aka_agent_desktop (production đọc JWT).
CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog' AS $function$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'aka_agent_desktop' THEN RETURN NULL; END IF;
  RETURN COALESCE(NULLIF(current_setting('test.staff_id', true), '')::bigint, 0);
END;
$function$;
CREATE FUNCTION private.aka_agent_desktop_data_context()
RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public' AS $function$
 SELECT s.id, s.organization_id, COALESCE(s.is_admin_akabiz AND s.is_active AND s.deleted_at IS NULL, false)
 FROM public.org_staff s
 WHERE current_setting('role', true) = 'aka_agent_desktop'
   AND s.id = (SELECT private.aka_agent_staff_scope_for_request());
$function$;
