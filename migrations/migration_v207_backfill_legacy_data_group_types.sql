-- Backfill semantic data types for legacy/manual Data Groups.
--
-- This migration is deliberately conservative:
--   * a group must be non-empty;
--   * every active membership must resolve to the same semantic type;
--   * every active membership must already have a current provenance row;
--   * an existing non-null provenance type must match the resolved type;
--   * dataset-managed groups are left to their authoritative dataset;
--   * active campaign sources and automations must accept the resolved type.
--
-- Contacts remain untyped. The inferred value is written only to current
-- membership origins and to the group using the semantic catalog introduced
-- by migration v206.

BEGIN;

SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';

-- Prevent a concurrent ingest/bind/retype from passing a stale compatibility
-- check while the one-time backfill is running.
LOCK TABLE
  public.auto_account_contact_groups,
  public.auto_account_contact_group_members,
  public.auto_account_contact_group_member_origins,
  public.auto_campaign_data_group_sources,
  public.auto_campaigns,
  public.auto_campaign_action_data_types,
  public.auto_automation
IN SHARE ROW EXCLUSIVE MODE;

LOCK TABLE public.category_type, public.category_item IN SHARE MODE;

CREATE TEMP TABLE _v207_legacy_data_group_type_candidates (
  group_id bigint PRIMARY KEY,
  data_type_category_item_id bigint NOT NULL
) ON COMMIT DROP;

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
INSERT INTO _v207_legacy_data_group_type_candidates (
  group_id,
  data_type_category_item_id
)
SELECT
  compatible_group.group_id,
  compatible_group.data_type_category_item_id
FROM compatible_groups AS compatible_group;

-- A typed group requires every current origin to carry that same type. Fill
-- only legacy NULL values; v206 already makes a non-null origin immutable.
UPDATE public.auto_account_contact_group_member_origins AS origin
SET data_type_category_item_id =
      candidate.data_type_category_item_id,
    updated_at = clock_timestamp()
FROM public.auto_account_contact_group_members AS member
JOIN _v207_legacy_data_group_type_candidates AS candidate
  ON candidate.group_id = member.group_id
WHERE origin.membership_id = member.id
  AND member.is_delete = false
  AND origin.is_current = true
  AND origin.data_type_category_item_id IS NULL;

UPDATE public.auto_account_contact_groups AS contact_group
SET data_type_category_item_id =
      candidate.data_type_category_item_id,
    revision = contact_group.revision + 1,
    updated_at = clock_timestamp()
FROM _v207_legacy_data_group_type_candidates AS candidate
WHERE contact_group.id = candidate.group_id
  AND contact_group.purpose = 'data_group'
  AND contact_group.is_delete = false
  AND contact_group.data_type_category_item_id IS NULL;

DO $verify_v207_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM _v207_legacy_data_group_type_candidates AS candidate
    JOIN public.auto_account_contact_groups AS contact_group
      ON contact_group.id = candidate.group_id
    WHERE contact_group.data_type_category_item_id IS DISTINCT FROM
      candidate.data_type_category_item_id
  ) THEN
    RAISE EXCEPTION 'v207_data_group_type_backfill_incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _v207_legacy_data_group_type_candidates AS candidate
    JOIN public.auto_account_contact_group_members AS member
      ON member.group_id = candidate.group_id
     AND member.is_delete = false
    LEFT JOIN public.auto_account_contact_group_member_origins AS origin
      ON origin.membership_id = member.id
     AND origin.is_current = true
    GROUP BY candidate.group_id, member.id,
      candidate.data_type_category_item_id
    HAVING count(origin.id) = 0
       OR bool_or(
         origin.data_type_category_item_id IS DISTINCT FROM
           candidate.data_type_category_item_id
       )
  ) THEN
    RAISE EXCEPTION 'v207_data_group_origin_type_backfill_incomplete';
  END IF;
END;
$verify_v207_backfill$;

COMMIT;
