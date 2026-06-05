-- Central status catalog for app components.
-- V1 only adds one lookup table; existing status text columns stay unchanged.

BEGIN;

DROP TABLE IF EXISTS public.auto_status_usage;
DROP TABLE IF EXISTS public.auto_status;

CREATE TABLE public.auto_status (
  id BIGSERIAL PRIMARY KEY,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status_key text NOT NULL,
  flatform_type text NOT NULL DEFAULT 'all',
  component_type text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_terminal boolean NOT NULL DEFAULT false,
  can_set_manually boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT auto_status_code_format_check
    CHECK (code ~ '^[a-z0-9_]+$'),

  CONSTRAINT auto_status_status_key_format_check
    CHECK (status_key ~ '^[a-z0-9_]+$'),

  CONSTRAINT auto_status_flatform_type_check
    CHECK (flatform_type IN ('all', 'facebook', 'zalo')),

  CONSTRAINT auto_status_component_type_check
    CHECK (component_type IN (
      'account',
      'account_login',
      'campaign',
      'campaign_input',
      'campaign_input_data',
      'campaign_detail'
    ))
);

CREATE INDEX idx_auto_status_component_active
  ON public.auto_status(component_type, flatform_type, sort_order)
  WHERE is_delete = false AND is_active = true;

CREATE INDEX idx_auto_status_status_key
  ON public.auto_status(status_key);

INSERT INTO public.auto_status (
  code,
  name,
  description,
  status_key,
  flatform_type,
  component_type,
  is_default,
  is_terminal,
  can_set_manually,
  sort_order
)
VALUES
  ('account_pending', 'Chờ xử lý', 'Tài khoản sẵn sàng chờ automation sử dụng.', 'pending', 'all', 'account', true, false, true, 10),
  ('account_running', 'Đang chạy', 'Tài khoản đang chạy campaign hoặc tác vụ quét data.', 'running', 'all', 'account', false, false, false, 20),
  ('account_paused', 'Tạm dừng', 'Tài khoản đang tạm dừng, scheduler không chọn để chạy.', 'paused', 'all', 'account', false, false, true, 30),

  ('account_login_not_logged_in', 'Chưa đăng nhập', 'Tài khoản chưa có phiên đăng nhập hợp lệ.', 'not_logged_in', 'all', 'account_login', true, false, false, 10),
  ('account_login_logged_in', 'Đã đăng nhập', 'Tài khoản có phiên đăng nhập hợp lệ.', 'logged_in', 'all', 'account_login', false, false, false, 20),
  ('account_login_checkpoint', 'Checkpoint', 'Tài khoản Facebook đang gặp checkpoint.', 'checkpoint', 'facebook', 'account_login', false, false, false, 30),

  ('campaign_pending', 'Chờ xử lý', 'Chiến dịch đang chờ scheduler xử lý.', 'pending', 'all', 'campaign', true, false, true, 10),
  ('campaign_running', 'Đang chạy', 'Chiến dịch đang được scheduler thực thi.', 'running', 'all', 'campaign', false, false, false, 20),
  ('campaign_paused', 'Tạm dừng', 'Chiến dịch đang tạm dừng.', 'paused', 'all', 'campaign', false, false, true, 30),
  ('campaign_completed', 'Hoàn thành', 'Chiến dịch đã hoàn tất.', 'completed', 'all', 'campaign', false, true, false, 40),

  ('campaign_input_pending', 'Chờ xử lý', 'Input thô đang chờ xử lý.', 'pending', 'all', 'campaign_input', true, false, true, 10),
  ('campaign_input_paused', 'Tạm dừng', 'Input thô đang tạm dừng.', 'paused', 'all', 'campaign_input', false, false, true, 20),
  ('campaign_input_running', 'Đang chạy', 'Input thô đang được xử lý.', 'running', 'all', 'campaign_input', false, false, false, 30),
  ('campaign_input_completed', 'Hoàn thành', 'Input thô đã xử lý xong.', 'completed', 'all', 'campaign_input', false, true, true, 40),
  ('campaign_input_error', 'Lỗi', 'Input thô lỗi, cần kiểm tra hoặc re-trigger.', 'error', 'all', 'campaign_input', false, true, true, 50),

  ('campaign_input_data_pending', 'Chờ xử lý', 'Target thực thi đang chờ xử lý.', 'pending', 'all', 'campaign_input_data', true, false, true, 10),
  ('campaign_input_data_paused', 'Tạm dừng', 'Target thực thi đang tạm dừng.', 'paused', 'all', 'campaign_input_data', false, false, true, 20),
  ('campaign_input_data_running', 'Đang chạy', 'Target thực thi đang được scheduler chạy.', 'running', 'all', 'campaign_input_data', false, false, false, 30),
  ('campaign_input_data_completed', 'Hoàn thành', 'Target thực thi đã hoàn tất.', 'completed', 'all', 'campaign_input_data', false, true, true, 40),

  ('campaign_detail_success', 'Thành công', 'Milestone hành động thành công.', 'success', 'all', 'campaign_detail', true, true, false, 10),
  ('campaign_detail_failed', 'Thất bại', 'Milestone bị từ chối hoặc không đạt nghiệp vụ.', 'failed', 'all', 'campaign_detail', false, true, false, 20),
  ('campaign_detail_error', 'Lỗi', 'Milestone lỗi kỹ thuật hoặc exception.', 'error', 'all', 'campaign_detail', false, true, false, 30)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  status_key = EXCLUDED.status_key,
  flatform_type = EXCLUDED.flatform_type,
  component_type = EXCLUDED.component_type,
  is_default = EXCLUDED.is_default,
  is_terminal = EXCLUDED.is_terminal,
  can_set_manually = EXCLUDED.can_set_manually,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  is_delete = false,
  updated_at = now();

COMMENT ON TABLE public.auto_status IS
  'Single-table catalog of app statuses. code is the unique identifier; other columns are metadata for UI/options.';

COMMENT ON COLUMN public.auto_status.code IS
  'Unique status code suitable for future one-column foreign keys or constraints.';

COMMENT ON COLUMN public.auto_status.status_key IS
  'Metadata grouping key for statuses with the same meaning across components, such as pending or running.';

COMMENT ON COLUMN public.auto_status.flatform_type IS
  'Metadata using the existing app spelling: all, facebook, or zalo.';

COMMENT ON COLUMN public.auto_status.component_type IS
  'Metadata component scope such as account status, account login status, campaign, input data, or milestone detail.';

COMMIT;
