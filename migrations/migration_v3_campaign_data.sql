-- ============================================================
-- Migration v3: Campaign Data refactor
-- Mục tiêu: tạo 3 bảng mới SONG SONG bảng cũ. KHÔNG drop, KHÔNG alter
--   auto_campaign_details / auto_campaign_detail_actions để client cũ
--   ngoài prod còn chạy được. Code mới chuyển hoàn toàn sang 3 bảng mới.
--
-- Status enum mới (data layer):
--   data_inputs:   chờ xử lý | tạm dừng | đang chạy | hoàn thành | lỗi
--   data_actions:  chờ xử lý | tạm dừng | đang chạy | hoàn thành
--   result_actions: thành công | thất bại | lỗi
-- ============================================================

BEGIN;

-- 1. data_inputs — pool nguyên liệu (sau này scrape group members ghi vào đây)
CREATE TABLE IF NOT EXISTS public.auto_campaign_data_inputs (
  id BIGSERIAL PRIMARY KEY,
  campaign_id bigint REFERENCES public.auto_campaigns(id),
  name text,
  phone text,
  uid text,
  email text,
  status text DEFAULT 'chờ xử lý',
  note text,
  schedule timestamptz,
  date_action timestamptz,
  is_delete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT auto_campaign_data_inputs_status_check CHECK (
    status IN ('chờ xử lý','tạm dừng','đang chạy','hoàn thành','lỗi')
  )
);
CREATE INDEX IF NOT EXISTS idx_data_inputs_campaign_id
  ON public.auto_campaign_data_inputs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_data_inputs_status
  ON public.auto_campaign_data_inputs(status) WHERE is_delete = false;

-- 2. data_actions — danh sách "việc-cần-làm" thực thi trong campaign loop
CREATE TABLE IF NOT EXISTS public.auto_campaign_data_actions (
  id BIGSERIAL PRIMARY KEY,
  campaign_id bigint REFERENCES public.auto_campaigns(id),
  data_input_id bigint NULL
    REFERENCES public.auto_campaign_data_inputs(id) ON DELETE SET NULL,
  name text,
  phone text,
  uid text,
  email text,
  status text DEFAULT 'chờ xử lý',
  note text,
  schedule timestamptz,
  date_action timestamptz,
  is_delete boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT auto_campaign_data_actions_status_check CHECK (
    status IN ('chờ xử lý','tạm dừng','đang chạy','hoàn thành')
  )
);
CREATE INDEX IF NOT EXISTS idx_data_actions_campaign_id
  ON public.auto_campaign_data_actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_data_actions_data_input_id
  ON public.auto_campaign_data_actions(data_input_id);
CREATE INDEX IF NOT EXISTS idx_data_actions_status
  ON public.auto_campaign_data_actions(status) WHERE is_delete = false;

-- 3. result_actions — log per-milestone (thay auto_campaign_detail_actions)
CREATE TABLE IF NOT EXISTS public.auto_campaign_result_actions (
  id BIGSERIAL PRIMARY KEY,
  data_action_id bigint
    REFERENCES public.auto_campaign_data_actions(id) ON DELETE SET NULL,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id),
  channel_id bigint REFERENCES public.org_channels(id),
  action_name text NOT NULL,
  status text NOT NULL DEFAULT 'thành công',
  log text,
  data jsonb,
  counts_toward_limit boolean,
  post_url text,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_campaign_result_actions_status_check CHECK (
    status IN ('thành công','thất bại','lỗi')
  )
);
CREATE INDEX IF NOT EXISTS idx_result_actions_channel_id
  ON public.auto_campaign_result_actions(channel_id);
CREATE INDEX IF NOT EXISTS idx_result_actions_campaign_id
  ON public.auto_campaign_result_actions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_result_actions_data_action_id
  ON public.auto_campaign_result_actions(data_action_id);
CREATE INDEX IF NOT EXISTS idx_result_actions_rate_limit
  ON public.auto_campaign_result_actions(channel_id, action_name, created_at);

-- 4. auto_v2_runs — thêm cột campaign_data_action_id (cột legacy campaign_detail_id giữ nguyên)
ALTER TABLE public.auto_v2_runs
  ADD COLUMN IF NOT EXISTS campaign_data_action_id BIGINT NULL
    REFERENCES public.auto_campaign_data_actions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_v2_runs_data_action
  ON public.auto_v2_runs(campaign_data_action_id);

COMMIT;
