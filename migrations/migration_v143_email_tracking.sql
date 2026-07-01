-- Email open/click tracking for browserless email_send campaigns.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.auto_email_message_trackings (
  id bigserial PRIMARY KEY,
  open_token uuid NOT NULL DEFAULT gen_random_uuid(),
  campaign_detail_id bigint NULL REFERENCES public.auto_campaign_details(id) ON DELETE SET NULL,
  campaign_id bigint NOT NULL REFERENCES public.auto_campaigns(id) ON DELETE CASCADE,
  account_id bigint NULL REFERENCES public.auto_accounts(id) ON DELETE SET NULL,
  input_data_id bigint NULL REFERENCES public.auto_campaign_input_data(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  subject text,
  message_id text,
  open_count integer NOT NULL DEFAULT 0,
  click_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  last_open_user_agent text,
  last_click_user_agent text,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_email_message_trackings_open_token
  ON public.auto_email_message_trackings(open_token);

CREATE INDEX IF NOT EXISTS idx_auto_email_message_trackings_detail
  ON public.auto_email_message_trackings(campaign_detail_id)
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_auto_email_message_trackings_campaign
  ON public.auto_email_message_trackings(campaign_id, created_at)
  WHERE is_delete = false;

CREATE TABLE IF NOT EXISTS public.auto_email_link_trackings (
  id bigserial PRIMARY KEY,
  click_token uuid NOT NULL DEFAULT gen_random_uuid(),
  message_tracking_id bigint NOT NULL REFERENCES public.auto_email_message_trackings(id) ON DELETE CASCADE,
  original_url text NOT NULL,
  link_index integer NOT NULL,
  click_count integer NOT NULL DEFAULT 0,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  last_click_user_agent text,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_email_link_trackings_click_token
  ON public.auto_email_link_trackings(click_token);

CREATE INDEX IF NOT EXISTS idx_auto_email_link_trackings_message
  ON public.auto_email_link_trackings(message_tracking_id, link_index)
  WHERE is_delete = false;

CREATE OR REPLACE FUNCTION public.aka_agent_mark_email_open(
  p_open_token text,
  p_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  ok boolean,
  message_tracking_id bigint,
  campaign_detail_id bigint,
  open_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message public.auto_email_message_trackings%ROWTYPE;
  v_now timestamptz := now();
  v_user_agent text := NULLIF(left(COALESCE(p_user_agent, ''), 1000), '');
  v_raw_token text := trim(COALESCE(p_open_token, ''));
  v_open_token uuid;
BEGIN
  IF v_raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, 0;
    RETURN;
  END IF;

  v_open_token := v_raw_token::uuid;

  SELECT *
  INTO v_message
  FROM public.auto_email_message_trackings
  WHERE open_token = v_open_token
    AND is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, 0;
    RETURN;
  END IF;

  UPDATE public.auto_email_message_trackings AS message_tracking
  SET open_count = message_tracking.open_count + 1,
      first_opened_at = COALESCE(message_tracking.first_opened_at, v_now),
      last_opened_at = v_now,
      last_open_user_agent = v_user_agent,
      updated_at = v_now
  WHERE message_tracking.id = v_message.id
  RETURNING message_tracking.* INTO v_message;

  IF v_message.campaign_detail_id IS NOT NULL THEN
    UPDATE public.auto_campaign_details
    SET status = 'đã xem'
    WHERE id = v_message.campaign_detail_id
      AND action_code = 'email_send'
      AND status = 'thành công'
      AND is_delete = false;
  END IF;

  RETURN QUERY SELECT true, v_message.id, v_message.campaign_detail_id, v_message.open_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.aka_agent_mark_email_click(
  p_click_token text,
  p_user_agent text DEFAULT NULL
)
RETURNS TABLE (
  ok boolean,
  message_tracking_id bigint,
  link_tracking_id bigint,
  original_url text,
  click_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.auto_email_link_trackings%ROWTYPE;
  v_message public.auto_email_message_trackings%ROWTYPE;
  v_now timestamptz := now();
  v_user_agent text := NULLIF(left(COALESCE(p_user_agent, ''), 1000), '');
  v_raw_token text := trim(COALESCE(p_click_token, ''));
  v_click_token uuid;
BEGIN
  IF v_raw_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, NULL::text, 0;
    RETURN;
  END IF;

  v_click_token := v_raw_token::uuid;

  SELECT *
  INTO v_link
  FROM public.auto_email_link_trackings
  WHERE click_token = v_click_token
    AND is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, NULL::bigint, NULL::text, 0;
    RETURN;
  END IF;

  SELECT *
  INTO v_message
  FROM public.auto_email_message_trackings
  WHERE id = v_link.message_tracking_id
    AND is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::bigint, v_link.id, NULL::text, 0;
    RETURN;
  END IF;

  UPDATE public.auto_email_link_trackings AS link_tracking
  SET click_count = link_tracking.click_count + 1,
      first_clicked_at = COALESCE(link_tracking.first_clicked_at, v_now),
      last_clicked_at = v_now,
      last_click_user_agent = v_user_agent,
      updated_at = v_now
  WHERE link_tracking.id = v_link.id
  RETURNING link_tracking.* INTO v_link;

  UPDATE public.auto_email_message_trackings AS message_tracking
  SET click_count = message_tracking.click_count + 1,
      first_clicked_at = COALESCE(message_tracking.first_clicked_at, v_now),
      last_clicked_at = v_now,
      first_opened_at = COALESCE(message_tracking.first_opened_at, v_now),
      last_opened_at = COALESCE(message_tracking.last_opened_at, v_now),
      open_count = GREATEST(message_tracking.open_count, 1),
      last_click_user_agent = v_user_agent,
      updated_at = v_now
  WHERE message_tracking.id = v_message.id
  RETURNING message_tracking.* INTO v_message;

  IF v_message.campaign_detail_id IS NOT NULL THEN
    UPDATE public.auto_campaign_details
    SET status = 'đã click'
    WHERE id = v_message.campaign_detail_id
      AND action_code = 'email_send'
      AND status IN ('thành công', 'đã xem')
      AND is_delete = false;
  END IF;

  RETURN QUERY SELECT true, v_message.id, v_link.id, v_link.original_url, v_link.click_count;
END;
$$;

COMMENT ON TABLE public.auto_email_message_trackings IS
  'Per-message email open/click tracking for akaAgent email_send campaigns.';

COMMENT ON TABLE public.auto_email_link_trackings IS
  'Per-link click tracking and original redirect URL for email_send campaigns.';

-- Promote the existing saved checkbox to a runtime variable used by the builtin email block.
UPDATE public.auto_blocks
SET code = $block$
return await helpers.emailSendMessage({
  to: vars.targetEmail,
  subject: vars.emailSubject,
  body: vars.campaignContent,
  isHtml: vars.emailBodyIsHtml,
  enableClickTracking: vars.emailCheckLinkClicks,
  attachments: vars.images,
  inputData: vars.inputData,
  targetName: vars.inputDataName
});
$block$,
    updated_at = now()
WHERE name = 'email_send_message';

UPDATE public.auto_workflows
SET variables_schema = '[
  {"name":"targetEmail","type":"string","label":"Recipient email"},
  {"name":"emailSubject","type":"string","label":"Email subject"},
  {"name":"campaignContent","type":"string","label":"Email body"},
  {"name":"emailBodyIsHtml","type":"boolean","label":"Body is HTML"},
  {"name":"emailCheckLinkClicks","type":"boolean","label":"Track link clicks"}
]'::jsonb,
    updated_at = now()
WHERE name IN ('email_send', 'email_send__test__email_send');

NOTIFY pgrst, 'reload schema';

COMMIT;
