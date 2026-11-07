-- V475 fixture: hai bảng Quy trình mà V475 đọc, nguyên văn DDL của V473 p1 và cùng cách khóa quyền
-- (RLS bật, không policy, API role không có quyền; service_role giữ quyền bảng). Không có dữ liệu.
\set ON_ERROR_STOP 1
CREATE TABLE public.auto_journeys (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id bigint NOT NULL,
  organization_id bigint NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'stopped')),
  origin text NOT NULL DEFAULT 'blank' CHECK (origin IN ('blank', 'template', 'ai', 'legacy')),
  template_code text CHECK (template_code IS NULL OR char_length(template_code) <= 100),
  draft_graph jsonb NOT NULL CHECK (jsonb_typeof(draft_graph) = 'object'),
  draft_settings jsonb NOT NULL CHECK (jsonb_typeof(draft_settings) = 'object'),
  draft_revision integer NOT NULL DEFAULT 1,
  draft_updated_at timestamptz NOT NULL DEFAULT now(),
  active_version_id bigint,
  -- Khách mới nhận hôm nay (giờ VN, không tính chạy thử) cho maxNewPerDay; chỉ bộ máy ghi.
  entry_day date,
  entry_day_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  paused_at timestamptz,
  stopped_at timestamptz,
  deleted_at timestamptz,
  is_delete boolean NOT NULL DEFAULT false
);
CREATE TABLE public.auto_journey_step_campaigns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  journey_id bigint NOT NULL REFERENCES public.auto_journeys(id) ON DELETE CASCADE,
  step_id text NOT NULL CHECK (char_length(step_id) BETWEEN 1 AND 100),
  account_id bigint NOT NULL,
  action_code text NOT NULL,
  config_hash text NOT NULL DEFAULT '' CHECK (char_length(config_hash) <= 200),
  campaign_id bigint NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (journey_id, step_id, account_id, action_code, config_hash)
);
DO $acl$
DECLARE v_table text; v_role text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['auto_journeys', 'auto_journey_step_campaigns'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', v_table, v_role);
    END LOOP;
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END
$acl$;
