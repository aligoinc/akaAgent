-- Central status catalog for app components.
-- V1 only adds lookup tables and seed data; existing status text columns stay unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_status (
  id BIGSERIAL PRIMARY KEY,
  flatform_type text NOT NULL DEFAULT 'all',
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auto_status_flatform_type_check
    CHECK (flatform_type IN ('all', 'facebook', 'zalo')),

  CONSTRAINT auto_status_code_format_check
    CHECK (code ~ '^[a-z0-9_]+$'),

  CONSTRAINT auto_status_unique_code
    UNIQUE (flatform_type, code)
);

CREATE TABLE IF NOT EXISTS public.auto_status_usage (
  id BIGSERIAL PRIMARY KEY,
  status_id bigint NOT NULL REFERENCES public.auto_status(id) ON DELETE CASCADE,
  component_type text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  can_set_manually boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auto_status_usage_component_type_check
    CHECK (component_type IN (
      'account',
      'account_login',
      'campaign',
      'campaign_input',
      'campaign_input_data',
      'campaign_detail'
    )),

  CONSTRAINT auto_status_usage_unique
    UNIQUE (status_id, component_type)
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_status_usage_one_default_per_component
  ON public.auto_status_usage(component_type)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_auto_status_active_component
  ON public.auto_status_usage(component_type, sort_order, status_id);

INSERT INTO public.auto_status (
  flatform_type,
  code,
  name,
  description,
  sort_order
)
VALUES
  ('all', 'pending', 'Chờ xử lý', 'Trạng thái chờ hệ thống hoặc người dùng xử lý.', 10),
  ('all', 'running', 'Đang chạy', 'Trạng thái đang được hệ thống thực thi.', 20),
  ('all', 'paused', 'Tạm dừng', 'Trạng thái tạm dừng, có thể tiếp tục khi đủ điều kiện.', 30),
  ('all', 'completed', 'Hoàn thành', 'Trạng thái đã hoàn tất xử lý.', 40),
  ('all', 'success', 'Thành công', 'Kết quả hành động thành công.', 50),
  ('all', 'failed', 'Thất bại', 'Kết quả hành động bị từ chối hoặc không đạt nghiệp vụ.', 60),
  ('all', 'error', 'Lỗi', 'Kết quả lỗi kỹ thuật hoặc lỗi cần xử lý.', 70),
  ('all', 'not_logged_in', 'Chưa đăng nhập', 'Tài khoản chưa có phiên đăng nhập hợp lệ.', 80),
  ('all', 'logged_in', 'Đã đăng nhập', 'Tài khoản có phiên đăng nhập hợp lệ.', 90),
  ('facebook', 'checkpoint', 'Checkpoint', 'Tài khoản Facebook đang gặp checkpoint.', 100)
ON CONFLICT (flatform_type, code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_delete = false,
  updated_at = now();

WITH usage_seed AS (
  SELECT *
  FROM (
    VALUES
      ('all', 'pending', 'account', true, false, true, 10),
      ('all', 'running', 'account', false, false, false, 20),
      ('all', 'paused', 'account', false, false, true, 30),

      ('all', 'not_logged_in', 'account_login', true, false, false, 10),
      ('all', 'logged_in', 'account_login', false, false, false, 20),
      ('facebook', 'checkpoint', 'account_login', false, false, false, 30),

      ('all', 'pending', 'campaign', true, false, true, 10),
      ('all', 'running', 'campaign', false, false, false, 20),
      ('all', 'paused', 'campaign', false, false, true, 30),
      ('all', 'completed', 'campaign', false, true, false, 40),

      ('all', 'pending', 'campaign_input', true, false, true, 10),
      ('all', 'paused', 'campaign_input', false, false, true, 20),
      ('all', 'running', 'campaign_input', false, false, false, 30),
      ('all', 'completed', 'campaign_input', false, true, true, 40),
      ('all', 'error', 'campaign_input', false, true, true, 50),

      ('all', 'pending', 'campaign_input_data', true, false, true, 10),
      ('all', 'paused', 'campaign_input_data', false, false, true, 20),
      ('all', 'running', 'campaign_input_data', false, false, false, 30),
      ('all', 'completed', 'campaign_input_data', false, true, true, 40),

      ('all', 'success', 'campaign_detail', true, true, false, 10),
      ('all', 'failed', 'campaign_detail', false, true, false, 20),
      ('all', 'error', 'campaign_detail', false, true, false, 30)
  ) AS seed(
    flatform_type,
    code,
    component_type,
    is_default,
    is_terminal,
    can_set_manually,
    sort_order
  )
)
INSERT INTO public.auto_status_usage (
  status_id,
  component_type,
  is_default,
  is_terminal,
  can_set_manually,
  sort_order
)
SELECT
  s.id,
  u.component_type,
  u.is_default,
  u.is_terminal,
  u.can_set_manually,
  u.sort_order
FROM usage_seed u
JOIN public.auto_status s
  ON s.flatform_type = u.flatform_type
 AND s.code = u.code
ON CONFLICT (status_id, component_type) DO UPDATE SET
  is_default = EXCLUDED.is_default,
  is_terminal = EXCLUDED.is_terminal,
  can_set_manually = EXCLUDED.can_set_manually,
  sort_order = EXCLUDED.sort_order;

COMMENT ON TABLE public.auto_status IS
  'Catalog of reusable app statuses by platform. Existing runtime tables keep text status columns in this migration.';

COMMENT ON TABLE public.auto_status_usage IS
  'Mapping of which status codes are valid for each app component scope.';

COMMENT ON COLUMN public.auto_status.flatform_type IS
  'Uses the existing app spelling: all, facebook, or zalo.';

COMMENT ON COLUMN public.auto_status_usage.component_type IS
  'Component scope such as account status, account login status, campaign, input data, or milestone detail.';

COMMIT;
