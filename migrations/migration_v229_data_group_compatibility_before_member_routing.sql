-- Data Group routing is a two-stage contract:
--   1. the group semantic type must support the campaign action;
--   2. only then is each member validated for that action.
--
-- v228 intentionally made valid-phone members portable, but also widened the
-- group-level gate. Restore the semantic group gate while retaining v228's
-- member-level valid-phone behavior inside a compatible group.

BEGIN;

CREATE OR REPLACE FUNCTION public.aka_agent_data_group_type_compatible(
  p_group_id bigint,
  p_campaign_action_id text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.id = p_group_id
      AND contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND (
        -- Untyped legacy groups remain the explicit wildcard group type.
        contact_group.data_type_category_item_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id =
              btrim(COALESCE(p_campaign_action_id, ''))
            AND mapping.data_type_category_item_id =
              contact_group.data_type_category_item_id
            AND mapping.can_target = true
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
      )
  );
$function$;

COMMENT ON FUNCTION public.aka_agent_data_group_type_compatible(bigint, text)
IS 'Requires a compatible Data Group semantic type before member-level target validation; NULL group type is the legacy wildcard.';

NOTIFY pgrst, 'reload schema';

COMMIT;
