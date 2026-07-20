-- Canonical per-action content-template channels for akaAgent v2.
-- Legacy columns remain in place for older clients; this migration intentionally
-- does not derive channels or media from any legacy template value.

BEGIN;

ALTER TABLE public.auto_content_templates
  ADD COLUMN IF NOT EXISTS channel_image_urls jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO public.aka_crm_status AS existing_status (
  type,
  stt_by_type,
  name,
  description,
  is_active
)
VALUES
  ('content_type', 1, 'sms', 'SMS', true),
  ('content_type', 2, 'zalo_message', 'Tin nhắn Zalo', true),
  ('content_type', 3, 'facebook_post', 'Facebook Post', true),
  ('content_type', 4, 'facebook_message', 'Facebook Message', true),
  ('content_type', 5, 'facebook_comment', 'Facebook Comment', true),
  ('content_type', 6, 'email', 'Email', true)
ON CONFLICT (type, name) DO UPDATE
SET stt_by_type = EXCLUDED.stt_by_type,
    description = EXCLUDED.description,
    is_active = true,
    updated_at = now();

UPDATE public.aka_crm_status
SET is_active = false,
    updated_at = now()
WHERE type = 'content_type'
  AND name IN ('zalo', 'facebook', 'long')
  AND is_active IS DISTINCT FROM false;

COMMENT ON COLUMN public.auto_content_templates.channel_image_urls IS
  'Per-channel image URL arrays keyed by aka_crm_status content_type id. No legacy image_urls fallback.';

COMMIT;
