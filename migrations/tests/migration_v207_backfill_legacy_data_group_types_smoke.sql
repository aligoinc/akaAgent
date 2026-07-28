-- Read-only smoke test for migration v207.
-- Run against a database where v206 and v207 have been applied.

BEGIN;

DO $smoke_v207$
DECLARE
  v_remaining_safe_candidates bigint;
BEGIN
  IF to_regclass(
    'public.auto_account_contact_group_member_origins'
  ) IS NULL THEN
    RAISE EXCEPTION 'missing_data_group_origin_table';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.category_type AS category_type
    JOIN public.category_item AS category_item
      ON category_item.category_type_id = category_type.id
    WHERE category_type.namespace = 'common'
      AND category_type.code = 'data_type'
      AND category_item.is_active = true
    GROUP BY category_type.id
    HAVING count(*) = 10
  ) THEN
    RAISE EXCEPTION 'semantic_data_type_catalog_is_not_ready';
  END IF;

  -- No typed active group may contain an active membership without a current
  -- origin or with a current origin of another semantic type.
  IF EXISTS (
    SELECT 1
    FROM public.auto_account_contact_groups AS contact_group
    JOIN public.auto_account_contact_group_members AS member
      ON member.group_id = contact_group.id
     AND member.is_delete = false
    LEFT JOIN public.auto_account_contact_group_member_origins AS origin
      ON origin.membership_id = member.id
     AND origin.is_current = true
    WHERE contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND contact_group.data_type_category_item_id IS NOT NULL
    GROUP BY contact_group.id, member.id,
      contact_group.data_type_category_item_id
    HAVING count(origin.id) = 0
       OR bool_or(
         origin.data_type_category_item_id IS DISTINCT FROM
           contact_group.data_type_category_item_id
       )
  ) THEN
    RAISE EXCEPTION 'typed_group_has_incompatible_current_origin';
  END IF;

  -- Re-run the conservative candidate calculation. After v207 there must be
  -- no manual legacy group left that can be typed without guessing.
  WITH membership_types AS (
    SELECT
      contact_group.id AS group_id,
      member.id AS membership_id,
      public.aka_agent_derive_dataset_data_type(
        NULL,
        lower(btrim(COALESCE(
          NULLIF(contact.flatform_type, ''),
          NULLIF(account.flatform_type, ''),
          ''
        ))),
        lower(btrim(COALESCE(contact.contact_type, ''))),
        NULL,
        '{}'::jsonb
      ) AS data_type_category_item_id
    FROM public.auto_account_contact_groups AS contact_group
    JOIN public.auto_account_contact_group_members AS member
      ON member.group_id = contact_group.id
     AND member.is_delete = false
    JOIN public.auto_account_contacts AS contact
      ON contact.id = member.contact_id
    LEFT JOIN public.auto_accounts AS account
      ON account.id = contact.account_id
    WHERE contact_group.purpose = 'data_group'
      AND contact_group.is_delete = false
      AND contact_group.data_type_category_item_id IS NULL
      AND contact_group.dataset_sync_mode IS DISTINCT FROM 'dataset_auto'
  ),
  membership_origin_state AS (
    SELECT
      membership_type.group_id,
      membership_type.membership_id,
      membership_type.data_type_category_item_id,
      count(origin.id) > 0 AS has_current_origin,
      COALESCE(
        bool_or(
          origin.data_type_category_item_id IS NOT NULL
          AND origin.data_type_category_item_id IS DISTINCT FROM
            membership_type.data_type_category_item_id
        ),
        false
      ) AS has_incompatible_origin
    FROM membership_types AS membership_type
    LEFT JOIN public.auto_account_contact_group_member_origins AS origin
      ON origin.membership_id = membership_type.membership_id
     AND origin.is_current = true
    GROUP BY
      membership_type.group_id,
      membership_type.membership_id,
      membership_type.data_type_category_item_id
  ),
  uniform_groups AS (
    SELECT
      membership.group_id,
      min(membership.data_type_category_item_id) AS
        data_type_category_item_id
    FROM membership_origin_state AS membership
    GROUP BY membership.group_id
    HAVING count(*) > 0
       AND bool_and(membership.data_type_category_item_id IS NOT NULL)
       AND count(DISTINCT membership.data_type_category_item_id) = 1
       AND bool_and(membership.has_current_origin)
       AND NOT bool_or(membership.has_incompatible_origin)
  ),
  compatible_groups AS (
    SELECT uniform_group.*
    FROM uniform_groups AS uniform_group
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.auto_campaign_data_group_sources AS source
      JOIN public.auto_campaigns AS campaign
        ON campaign.id = source.campaign_id
      WHERE source.group_id = uniform_group.group_id
        AND source.status IN ('baselining', 'active')
        AND NOT EXISTS (
          SELECT 1
          FROM public.auto_campaign_action_data_types AS mapping
          WHERE mapping.campaign_action_id = campaign.action_id
            AND mapping.data_type_category_item_id =
              uniform_group.data_type_category_item_id
            AND mapping.can_target = true
            AND mapping.is_active = true
            AND mapping.is_delete = false
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.auto_automation AS automation
      WHERE automation.target_data_group_id = uniform_group.group_id
        AND automation.is_active = true
        AND automation.is_delete = false
        AND automation.data_type_category_item_id IS DISTINCT FROM
          uniform_group.data_type_category_item_id
    )
  )
  SELECT count(*)
  INTO v_remaining_safe_candidates
  FROM compatible_groups;

  IF v_remaining_safe_candidates <> 0 THEN
    RAISE EXCEPTION
      'v207_left_%_safe_legacy_data_group_candidates',
      v_remaining_safe_candidates;
  END IF;
END;
$smoke_v207$;

ROLLBACK;
