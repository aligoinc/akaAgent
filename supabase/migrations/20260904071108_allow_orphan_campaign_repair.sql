-- Allow Web control users to clean up a campaign whose former account was
-- soft-deleted, or repair it by selecting a live account with the same
-- tenant/platform. The live RPC definitions are patched only from the exact
-- audited production checksums so later hotfixes cannot be overwritten.
DO $migration$
DECLARE
  v_update_signature constant text :=
    'public.update_control_campaign_atomic(bigint,bigint,bigint,timestamptz,jsonb,jsonb,boolean,text,integer,jsonb)';
  v_delete_signature constant text :=
    'public.delete_control_campaign_atomic(bigint,bigint,bigint)';
  v_update_source_md5 constant text := '0d03ac88faa1b01608129a33b64752f8';
  v_update_target_md5 constant text := '218ccf3eb631a84af633818939177db7';
  v_delete_source_md5 constant text := '480d9bf8cb826e68dd51dad4c9e8915f';
  v_delete_target_md5 constant text := '1955af1c590ec870cb098cde9dd0714b';
  v_update_oid oid;
  v_delete_oid oid;
  v_definition text;
  v_definition_md5 text;
  v_target_definition text;
  v_replacement_count integer;
  v_update_old text := rtrim(
$update_old$
    AND (
      account.flatform_type = 'sms'
      OR (
        account.flatform_type = 'zalo'
        AND COALESCE(account.is_zalo_show_web, false) = false
        AND COALESCE(account.is_zalo_server, false) = true
        AND COALESCE(account.is_active, true) = true
        AND account.status IN ('chờ xử lý', 'tạm dừng')
      )
    )
    AND COALESCE(account.is_delete, false) = false
$update_old$, E'\n');
  v_update_new text := rtrim(
$update_new$
    AND (
      (
        COALESCE(account.is_delete, false) = false
        AND (
          account.flatform_type = 'sms'
          OR (
            account.flatform_type = 'zalo'
            AND COALESCE(account.is_zalo_show_web, false) = false
            AND COALESCE(account.is_zalo_server, false) = true
            AND COALESCE(account.is_active, true) = true
            AND account.status IN ('chờ xử lý', 'tạm dừng')
          )
        )
      )
      OR (
        COALESCE(account.is_delete, false) = true
        AND p_campaign_patch ? 'account_id'
        AND EXISTS (
          SELECT 1
          FROM public.auto_accounts AS target_account
          WHERE target_account.id = NULLIF(p_campaign_patch->>'account_id', '')::bigint
            AND target_account.staff_id = p_staff_id
            AND target_account.organization_id = p_organization_id
            AND target_account.flatform_type = account.flatform_type
            AND (
              target_account.flatform_type = 'sms'
              OR (
                target_account.flatform_type = 'zalo'
                AND COALESCE(target_account.is_zalo_show_web, false) = false
                AND COALESCE(target_account.is_zalo_server, false) = true
                AND COALESCE(target_account.is_active, true) = true
                AND target_account.status IN ('chờ xử lý', 'tạm dừng')
              )
            )
            AND COALESCE(target_account.is_delete, false) = false
        )
      )
    )
$update_new$, E'\n');
  v_delete_old constant text := E'\n    AND COALESCE(account.is_delete, false) = false';
BEGIN
  v_update_oid := to_regprocedure(v_update_signature);
  v_delete_oid := to_regprocedure(v_delete_signature);
  IF v_update_oid IS NULL OR v_delete_oid IS NULL THEN
    RAISE EXCEPTION
      'orphan_campaign_repair_preflight_missing_rpc: update=%, delete=%',
      v_update_oid,
      v_delete_oid;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS fn
    WHERE fn.oid IN (v_update_oid, v_delete_oid)
      AND (
        pg_get_userbyid(fn.proowner) IS DISTINCT FROM 'postgres'
        OR fn.prosecdef IS DISTINCT FROM true
        OR fn.provolatile IS DISTINCT FROM 'v'::"char"
        OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
        OR fn.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      )
  ) THEN
    RAISE EXCEPTION 'orphan_campaign_repair_preflight_attribute_mismatch';
  END IF;

  v_definition := pg_get_functiondef(v_update_oid);
  v_definition_md5 := md5(v_definition);
  IF v_definition_md5 = v_update_source_md5 THEN
    v_replacement_count :=
      (length(v_definition) - length(replace(v_definition, v_update_old, '')))
      / length(v_update_old);
    IF v_replacement_count <> 2 THEN
      RAISE EXCEPTION
        'orphan_campaign_repair_update_pattern_mismatch: expected 2, got %',
        v_replacement_count;
    END IF;
    v_target_definition := replace(v_definition, v_update_old, v_update_new);
    IF md5(v_target_definition) IS DISTINCT FROM v_update_target_md5 THEN
      RAISE EXCEPTION
        'orphan_campaign_repair_update_target_checksum_mismatch: expected %, got %',
        v_update_target_md5,
        md5(v_target_definition);
    END IF;
    EXECUTE v_target_definition;
  ELSIF v_definition_md5 IS DISTINCT FROM v_update_target_md5 THEN
    RAISE EXCEPTION
      'orphan_campaign_repair_update_source_checksum_mismatch: expected % or %, got %',
      v_update_source_md5,
      v_update_target_md5,
      v_definition_md5;
  END IF;

  v_definition := pg_get_functiondef(v_delete_oid);
  v_definition_md5 := md5(v_definition);
  IF v_definition_md5 = v_delete_source_md5 THEN
    v_replacement_count :=
      (length(v_definition) - length(replace(v_definition, v_delete_old, '')))
      / length(v_delete_old);
    IF v_replacement_count <> 2 THEN
      RAISE EXCEPTION
        'orphan_campaign_repair_delete_pattern_mismatch: expected 2, got %',
        v_replacement_count;
    END IF;
    v_target_definition := replace(v_definition, v_delete_old, '');
    IF md5(v_target_definition) IS DISTINCT FROM v_delete_target_md5 THEN
      RAISE EXCEPTION
        'orphan_campaign_repair_delete_target_checksum_mismatch: expected %, got %',
        v_delete_target_md5,
        md5(v_target_definition);
    END IF;
    EXECUTE v_target_definition;
  ELSIF v_definition_md5 IS DISTINCT FROM v_delete_target_md5 THEN
    RAISE EXCEPTION
      'orphan_campaign_repair_delete_source_checksum_mismatch: expected % or %, got %',
      v_delete_source_md5,
      v_delete_target_md5,
      v_definition_md5;
  END IF;

  IF md5(pg_get_functiondef(v_update_oid)) IS DISTINCT FROM v_update_target_md5
    OR md5(pg_get_functiondef(v_delete_oid)) IS DISTINCT FROM v_delete_target_md5 THEN
    RAISE EXCEPTION 'orphan_campaign_repair_postflight_checksum_mismatch';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS fn
    WHERE fn.oid IN (v_update_oid, v_delete_oid)
      AND (
        pg_get_userbyid(fn.proowner) IS DISTINCT FROM 'postgres'
        OR fn.prosecdef IS DISTINCT FROM true
        OR fn.provolatile IS DISTINCT FROM 'v'::"char"
        OR fn.proconfig IS DISTINCT FROM ARRAY['search_path=public']::text[]
        OR fn.proacl::text IS DISTINCT FROM '{postgres=X/postgres,service_role=X/postgres}'
      )
  ) THEN
    RAISE EXCEPTION 'orphan_campaign_repair_postflight_attribute_mismatch';
  END IF;
END;
$migration$;
