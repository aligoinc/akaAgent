-- Email SMTP campaign: "Email - Gửi email tới danh sách".
-- Adds per-account SMTP config columns (email_session, mirror zalo_session),
-- an account action code, and a browserless workflow that delegates email
-- sending to the main-process emailSendMessage helper (nodemailer).

BEGIN;

-- Per-account SMTP config (jsonb: brandName/host/fromEmail/replyTo/cc/user/pass/port/secure)
ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS email_session jsonb,
  ADD COLUMN IF NOT EXISTS email_session_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_session_last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_session_last_error text;

COMMENT ON COLUMN public.auto_accounts.email_session IS
  'SMTP config cho tài khoản email: {brandName,host,port,secure,user,pass,fromEmail,replyTo,cc}.';

-- Account action code for limit tracking + detail logging
INSERT INTO public.auto_account_actions (flatform_type, name, code)
VALUES
  ('email', 'Email - Gửi email', 'email_send')
ON CONFLICT (code) DO UPDATE SET
  flatform_type = EXCLUDED.flatform_type,
  name = EXCLUDED.name,
  is_active = true,
  is_delete = false,
  updated_at = now();

-- Builtin block: gọi helper emailSendMessage trong main process (nodemailer)
INSERT INTO public.auto_blocks (
  name,
  description,
  icon,
  category,
  kind,
  code,
  config_schema,
  output_schema,
  default_config,
  is_builtin,
  staff_id,
  organization_id,
  updated_at
)
VALUES
  (
    'email_send_message',
    'Gửi email qua SMTP tới địa chỉ trong campaign browserless.',
    'Mail',
    'data',
    'js',
    $block$
return await helpers.emailSendMessage({
  to: vars.targetEmail,
  subject: vars.emailSubject,
  body: vars.campaignContent,
  isHtml: vars.emailBodyIsHtml,
  attachments: vars.images,
  inputData: vars.inputData,
  targetName: vars.inputDataName
});
$block$,
    '[]'::jsonb,
    '[{"name":"emailResult","type":"json","label":"Email result"}]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  category = EXCLUDED.category,
  kind = EXCLUDED.kind,
  code = EXCLUDED.code,
  config_schema = EXCLUDED.config_schema,
  output_schema = EXCLUDED.output_schema,
  default_config = EXCLUDED.default_config,
  is_builtin = true,
  updated_at = now();

DO $$
DECLARE
  send_block_id bigint;
  workflow_id bigint;
  test_workflow_id bigint;
BEGIN
  SELECT id INTO send_block_id FROM public.auto_blocks WHERE name = 'email_send_message';

  IF send_block_id IS NULL THEN
    RAISE EXCEPTION 'Cannot seed email_send workflow: missing email_send_message block id';
  END IF;

  INSERT INTO public.auto_workflows (
    name,
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    is_builtin,
    staff_id,
    organization_id,
    updated_at
  )
  VALUES (
    'email_send',
    'Workflow browserless cho chiến dịch Email - Gửi email tới danh sách.',
    jsonb_build_array(
      jsonb_build_object('id','send_email','blockId',send_block_id,'blockName','email_send_message','position',jsonb_build_object('x',0,'y',0),'config',jsonb_build_object())
    ),
    '[]'::jsonb,
    '[
      {"name":"targetEmail","type":"string","label":"Recipient email"},
      {"name":"emailSubject","type":"string","label":"Email subject"},
      {"name":"campaignContent","type":"string","label":"Email body"},
      {"name":"emailBodyIsHtml","type":"boolean","label":"Body is HTML"}
    ]'::jsonb,
    '{}'::jsonb,
    true,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    nodes = EXCLUDED.nodes,
    edges = EXCLUDED.edges,
    variables_schema = EXCLUDED.variables_schema,
    default_variables = EXCLUDED.default_variables,
    is_builtin = true,
    updated_at = now()
  RETURNING id INTO workflow_id;

  INSERT INTO public.auto_workflows (
    name,
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    is_builtin,
    staff_id,
    organization_id,
    updated_at
  )
  SELECT
    'email_send__test__email_send',
    description,
    nodes,
    edges,
    variables_schema,
    default_variables,
    false,
    staff_id,
    organization_id,
    now()
  FROM public.auto_workflows
  WHERE id = workflow_id
  ON CONFLICT (name) DO NOTHING;

  SELECT id INTO test_workflow_id
  FROM public.auto_workflows
  WHERE name = 'email_send__test__email_send';

  INSERT INTO public.auto_campaign_actions (
    id,
    name,
    flatform_type,
    is_active,
    workflow_id,
    test_workflow_id,
    limit_check_action_codes,
    is_delete,
    created_at
  )
  VALUES (
    'email_send',
    'Email - Gửi email tới danh sách',
    'email',
    true,
    workflow_id,
    test_workflow_id,
    ARRAY['email_send']::text[],
    false,
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    flatform_type = EXCLUDED.flatform_type,
    is_active = true,
    workflow_id = EXCLUDED.workflow_id,
    test_workflow_id = COALESCE(auto_campaign_actions.test_workflow_id, EXCLUDED.test_workflow_id),
    limit_check_action_codes = EXCLUDED.limit_check_action_codes,
    is_delete = false;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
