-- Sinh bởi scripts/event-bot/fuzz/build-dynfilter-fixture.py: phần đầu viết tay (bảng / cột production còn thiếu trong v672-fixture.sql,
-- danh mục, hàm quyền gói Zalo giả), phần sau là định nghĩa hàm + trigger production chép nguyên văn (đọc chỉ đọc 27/11/2026).
-- Không phải bản chụp production: chỉ đủ cột cho các hàm của chuỗi Bộ lọc động chạy.
SET check_function_bodies = off;
CREATE TABLE public.category_type (id bigint PRIMARY KEY, namespace text NOT NULL, code text NOT NULL);
ALTER TABLE public.category_item ADD COLUMN category_type_id bigint, ADD COLUMN is_active boolean NOT NULL DEFAULT true;
INSERT INTO public.category_type VALUES (901, 'common', 'data_filter_scope'), (902, 'common', 'data_filter_join'), (903, 'common', 'data_filter_operator'),
  (904, 'common', 'data_filter_queue_reason'), (905, 'common', 'data_filter_field'), (906, 'common', 'zalo_friendship_status');
INSERT INTO public.category_item (id, code, category_type_id) VALUES (202, 'enter', 901), (203, 'leave', 901), (204, 'and', 902), (205, 'or', 902),
  (206, 'contains', 903), (207, 'not_contains', 903), (208, 'equals', 903), (210, 'in', 903),
  (220, 'contact_changed', 904), (221, 'zalo_tag_changed', 904), (222, 'group_membership_changed', 904), (223, 'filter_saved', 904),
  (212, 'zalo_tag', 905), (213, 'akabiz_tag', 905), (214, 'zalo_group_membership', 905), (215, 'zalo_friend_status', 905),
  (301, 'friend', 906), (302, 'request_sent', 906), (303, 'request_received', 906), (304, 'stranger', 906);

ALTER TABLE public.auto_account_contacts ADD COLUMN is_friend boolean, ADD COLUMN akabiz_tag_ids bigint[] NOT NULL DEFAULT '{}'::bigint[],
  ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN url text, ADD COLUMN email text;
ALTER TABLE public.auto_account_contacts ALTER COLUMN extra_data SET DEFAULT '{}'::jsonb;
ALTER TABLE public.zalo_users ADD COLUMN staff_id bigint, ADD COLUMN organization_id bigint;
ALTER TABLE public.auto_account_contact_group_dynamic_filters ADD COLUMN evaluation_interval_minutes integer NOT NULL DEFAULT 15,
  ADD COLUMN last_evaluated_at timestamptz, ADD COLUMN next_evaluation_at timestamptz, ADD COLUMN matched_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN last_entered_count integer NOT NULL DEFAULT 0, ADD COLUMN last_exited_count integer NOT NULL DEFAULT 0,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN effective_from_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE TABLE public.auto_account_contact_dynamic_filter_queue (contact_id bigint PRIMARY KEY, staff_id bigint NOT NULL, organization_id bigint NOT NULL,
  reason_category_item_id bigint NOT NULL, queued_at timestamptz NOT NULL DEFAULT now(), attempt_count integer NOT NULL DEFAULT 0, last_error text,
  last_event_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.auto_account_contact_group_dynamic_filter_rules (id bigserial PRIMARY KEY, dynamic_filter_id bigint NOT NULL,
  scope_category_item_id bigint NOT NULL, join_category_item_id bigint NOT NULL, field_category_item_id bigint NOT NULL,
  operator_category_item_id bigint NOT NULL, account_id bigint, sort_order integer NOT NULL DEFAULT 0, value_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  value_labels jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.zalo_group_members (id bigserial PRIMARY KEY, account_id bigint NOT NULL, user_id bigint, group_id bigint, zalo_uid text NOT NULL,
  zalo_group_id text NOT NULL, role text NOT NULL DEFAULT 'member', role_rank integer NOT NULL DEFAULT 3, is_creator boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false, is_current boolean NOT NULL DEFAULT true, raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  staff_id bigint, organization_id bigint, UNIQUE (account_id, zalo_group_id, zalo_uid));
CREATE TABLE public.chat_zalo_account_user (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL, zalo_id text NOT NULL,
  display_name text, zalo_name text, friendship_status_category_item_id bigint, UNIQUE (chat_zalo_account_id, zalo_id));
CREATE TABLE public.chat_zalo_account_conversation (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL, zalo_id text NOT NULL,
  conversation_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_zalo_account_id, conversation_type, zalo_id));
CREATE TABLE public.chat_zalo_account_tag (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL, zalo_id text NOT NULL, name text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chat_zalo_account_conversation_tag (id bigserial PRIMARY KEY, chat_zalo_account_id bigint NOT NULL,
  chat_zalo_account_conversation_id bigint NOT NULL, chat_zalo_account_tag_id bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.chat_zalo_conversation (id bigserial PRIMARY KEY, chat_zalo_account_organization_id bigint, chat_zalo_account_conversation_id bigint,
  organization_id bigint);
CREATE TABLE public.chat_zalo_conversation_system_tag (chat_zalo_conversation_id bigint, organization_id bigint, auto_contact_tag_id bigint);
CREATE TABLE public.auto_contact_tags (id bigserial PRIMARY KEY, staff_id bigint, organization_id bigint, is_delete boolean NOT NULL DEFAULT false,
  auto_account_id bigint, name text);

-- Quyền gói Zalo theo loại tài khoản (production đọc gói của tổ chức): bản giả đọc bảng test, mặc định có đủ ba loại.
CREATE TABLE public.test_org_no_entitlement (organization_id bigint, account_subtype text);
CREATE FUNCTION private.resolve_organization_zalo_entitlement_pools(p_organization_id bigint)
RETURNS TABLE(account_subtype text, entitlement_id bigint) LANGUAGE sql STABLE AS $$
  SELECT s, 1::bigint FROM unnest(ARRAY['qr', 'server', 'web']) s
  WHERE NOT EXISTS (SELECT 1 FROM public.test_org_no_entitlement x WHERE x.organization_id = p_organization_id AND x.account_subtype = s) $$;
INSERT INTO public.auto_system_settings (key, value) VALUES ('notifications.enabled', 'true'), ('notifications.member_events.enabled', 'false')
  ON CONFLICT (key) DO NOTHING;
