CREATE TABLE IF NOT EXISTS public.auto_content_templates (
  id bigint GENERATED ALWAYS AS IDENTITY,
  name text NOT NULL,
  content text NOT NULL DEFAULT ''::text,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id),
  organization_id bigint REFERENCES public.org_organization(id),
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_content_templates_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_auto_content_templates_staff_name_active
  ON public.auto_content_templates (staff_id, lower(btrim(name)))
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS auto_content_templates_staff_id_idx
  ON public.auto_content_templates USING btree (staff_id);

COMMENT ON TABLE public.auto_content_templates IS
  'Reusable staff-scoped text content templates for campaign forms.';

COMMENT ON COLUMN public.auto_content_templates.content IS
  'Template text only. Media remains configured on the campaign.';
