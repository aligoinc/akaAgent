-- Smoke test for migration_v215_secondary_campaign_account_settings.sql.

BEGIN;

DO $v215_secondary_campaign_account_settings$
DECLARE
  v_column record;
  v_constraint_definition text;
  v_index_predicate text;
BEGIN
  SELECT column_name, is_nullable, column_default
  INTO v_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'auto_campaign_actions'
    AND column_name = 'allow_secondary_account';

  IF NOT FOUND
    OR v_column.is_nullable IS DISTINCT FROM 'NO'
    OR lower(COALESCE(v_column.column_default, '')) NOT LIKE '%false%'
  THEN
    RAISE EXCEPTION 'v215_smoke: allow_secondary_account contract is missing or invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('facebook_group_post'::text),
        ('facebook_message_uid'::text),
        ('zalo_message_phone'::text)
    ) AS expected(action_id)
    LEFT JOIN public.auto_campaign_actions AS action
      ON action.id = expected.action_id
    WHERE action.id IS NULL
      OR action.allow_secondary_account IS DISTINCT FROM true
  ) THEN
    RAISE EXCEPTION 'v215_smoke: supported campaign actions were not seeded';
  END IF;

  SELECT column_name, is_nullable
  INTO v_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'auto_campaigns'
    AND column_name = 'secondary_account_id';

  IF NOT FOUND OR v_column.is_nullable IS DISTINCT FROM 'YES' THEN
    RAISE EXCEPTION 'v215_smoke: secondary_account_id must be nullable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.auto_campaigns'::regclass
      AND constraint_row.contype = 'f'
      AND (
        SELECT attribute_row.attnum
        FROM pg_catalog.pg_attribute AS attribute_row
        WHERE attribute_row.attrelid = 'public.auto_campaigns'::regclass
          AND attribute_row.attname = 'secondary_account_id'
          AND NOT attribute_row.attisdropped
      ) = ANY (constraint_row.conkey)
  ) THEN
    RAISE EXCEPTION 'v215_smoke: secondary account must not add an ambiguous auto_accounts FK';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid)
  INTO v_constraint_definition
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'public.auto_campaigns'::regclass
    AND constraint_row.conname = 'auto_campaigns_secondary_account_diff_check'
    AND constraint_row.convalidated;

  IF lower(COALESCE(v_constraint_definition, '')) NOT LIKE '%secondary_account_id%'
    OR lower(COALESCE(v_constraint_definition, '')) NOT LIKE '%account_id%'
  THEN
    RAISE EXCEPTION 'v215_smoke: primary/secondary difference check is missing';
  END IF;

  CREATE TEMP TABLE v215_secondary_account_check_probe (
    account_id bigint,
    secondary_account_id bigint
  ) ON COMMIT DROP;

  EXECUTE format(
    'ALTER TABLE pg_temp.v215_secondary_account_check_probe ADD CONSTRAINT v215_secondary_account_check_probe_constraint %s',
    v_constraint_definition
  );

  BEGIN
    INSERT INTO pg_temp.v215_secondary_account_check_probe (account_id, secondary_account_id)
    VALUES (101, 101);
    RAISE EXCEPTION 'v215_smoke: primary/secondary difference check allowed equal ids';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  INSERT INTO pg_temp.v215_secondary_account_check_probe (account_id, secondary_account_id)
  VALUES
    (101, NULL),
    (101, 202);

  SELECT pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid)
  INTO v_index_predicate
  FROM pg_catalog.pg_index AS index_row
  JOIN pg_catalog.pg_class AS index_class
    ON index_class.oid = index_row.indexrelid
  WHERE index_row.indrelid = 'public.auto_campaigns'::regclass
    AND index_class.relname = 'idx_auto_campaigns_secondary_account_id';

  IF lower(COALESCE(v_index_predicate, '')) NOT LIKE '%secondary_account_id is not null%' THEN
    RAISE EXCEPTION 'v215_smoke: secondary account partial index is missing or invalid';
  END IF;
END;
$v215_secondary_campaign_account_settings$;

ROLLBACK;
