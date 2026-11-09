-- V484 phần 3/3: đẩy data nhóm vào chiến dịch chạy nền (hàng đợi + worker pg_cron), bật theo tổ chức.
-- Production akachat (cgjbsmqtfhqvttudyjzq) only. Sinh bằng scripts/build-v484-sql.py, đừng sửa tay.
-- Apply đúng thứ tự p1 -> p2 -> p3, mỗi phần một giao dịch (cả bộ ~135 KB vượt sức một lần gửi của công cụ apply).
-- Phần sau kiểm phần trước đã xong và từ chối chạy lại. Giữa các phần hệ thống vẫn chạy như cũ (công tắc 'sync').
-- Rollback: rollback_v484_data_group_async_routing_p1.sql rồi _p2.sql (chạy được cả khi mới apply một phần).
-- Hợp đồng, cách bật/tắt: docs/DATA_GROUP_ASYNC_ROUTING_V484.md. Kiểm thử: python3 scripts/data-group-routing/test_v484.py
--
-- p3: vá bật lại công tắc, chuyển data, đồng bộ nhóm tự động (2 hàm), sao chép nhóm chia sẻ, guard V483; lên lịch worker;
-- kiểm tra cuối cả bộ V484.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $v484_p3_preflight$
DECLARE
  v_item record;
  v_md5 text;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)": "0a0c9d1f870df7eac69ceaa20f6fb10a", "public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)": "ce799127008afc8f72edd31ef2042a39"}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v484 p3 preflight: % p2 not applied (md5 %, expected %)', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)": "9f4db1d1c78dfe0e1b00e37678e5852e", "public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)": "2a9b66655b905f56e44fe492096520bc", "public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)": "9215d6543aa1bb2627676f280465b8fa", "public.aka_agent_sync_scan_dataset_group_origins()": "5164ca868e763bfabd830e2114deeff9", "private.copy_shared_group(bigint,bigint,text,bigint,jsonb)": "9b310ca079d192f4e809b9cf09d28740"}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v484 p3 preflight: % already patched or drifted (md5 %, expected %)', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)');
  IF v_md5 IS DISTINCT FROM 'ff99a8564bb1ce517675419f03967eeb' THEN
    RAISE EXCEPTION 'v484 p3: V483 guard drifted or already patched (prosrc md5 %)', v_md5;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker') THEN
    RAISE EXCEPTION 'v484 p3: cron job already exists';
  END IF;
END
$v484_p3_preflight$;

CREATE TEMP TABLE v484_acl ON COMMIT DROP AS
SELECT p.oid::regprocedure::text AS sig, p.proacl::text AS acl, p.proconfig::text AS config,
       pg_get_userbyid(p.proowner) AS owner, p.prosecdef
FROM pg_proc AS p
WHERE p.oid IN (to_regprocedure('public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)'), to_regprocedure('public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)'), to_regprocedure('public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)'), to_regprocedure('public.aka_agent_sync_scan_dataset_group_origins()'), to_regprocedure('private.copy_shared_group(bigint,bigint,text,bigint,jsonb)'), to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)'));

-- public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text): md5 9f4db1d1c78dfe0e1b00e37678e5852e -> b185fd226aa469ae488c39f7e5344ab6
CREATE OR REPLACE FUNCTION public.aka_agent_reactivate_campaign_data_group_source(p_staff_id bigint, p_organization_id bigint, p_campaign_id bigint, p_request_id text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE
  v_source public.auto_campaign_data_group_sources%ROWTYPE;
  v_campaign public.auto_campaigns%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_hash text;
  v_runtime_target text := CASE
    WHEN NULLIF(btrim(COALESCE(
      current_setting('aka_agent.zalo_runtime_target', true), ''
    )), '') = 'desktop' THEN 'desktop'
    ELSE 'server'
  END;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'invalid_data_group_source_request';
  END IF;

  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.campaign_id = p_campaign_id AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_not_found'; END IF;
  SELECT * INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_source.group_id AND private.can_read_data_group(contact_group.id,p_staff_id,p_organization_id)
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'data_group_not_found'; END IF;

  -- Reactivation routes the existing group snapshot after locking campaign and
  -- source rows. Join the common campaign/input barrier before either of those
  -- row locks so the nested legacy router can re-enter it without inversion.
  PERFORM public.aka_agent_lock_campaign_input_serialization(p_campaign_id);

  SELECT campaign.* INTO v_campaign
  FROM public.auto_campaigns AS campaign
  JOIN public.auto_accounts AS account ON account.id = campaign.account_id
  WHERE campaign.id = p_campaign_id AND campaign.staff_id = p_staff_id
    AND campaign.organization_id = p_organization_id
    AND account.staff_id = p_staff_id
    AND (account.organization_id IS NULL OR account.organization_id = p_organization_id)
    AND COALESCE(account.is_delete, false) = false
      AND (
        COALESCE(account.flatform_type, '') <> 'zalo'
        OR (
          account.organization_id = p_organization_id
          AND (
            (
              v_runtime_target = 'desktop'
              AND COALESCE(account.is_zalo_server, false) = false
            )
            OR (
              v_runtime_target = 'server'
              AND COALESCE(account.is_zalo_show_web, false) = false
              AND COALESCE(account.is_zalo_server, false) = true
              AND COALESCE(account.is_active, true) = true
            )
          )
        )
      )
  FOR UPDATE OF campaign, account;
  IF NOT FOUND OR COALESCE(v_campaign.is_delete, false)
    OR v_campaign.data_group_id IS DISTINCT FROM v_source.group_id
    OR v_campaign.data_target_source_mode <> 'data_group'
    OR (v_campaign.schedule_end_date IS NOT NULL AND v_campaign.schedule_end_date <= now()) THEN
    RAISE EXCEPTION 'data_group_campaign_terminal';
  END IF;
  -- Re-lock in the shared group -> campaign -> source order used by bind and
  -- intake, then verify the optimistic source read did not change underneath.
  SELECT * INTO v_source
  FROM public.auto_campaign_data_group_sources AS source
  WHERE source.id = v_source.id
    AND source.campaign_id = p_campaign_id
    AND source.group_id = v_group.id
    AND source.staff_id = p_staff_id
    AND source.organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_data_group_source_changed'; END IF;
  IF v_source.status <> 'stopped' THEN RETURN to_jsonb(v_source); END IF;

  v_hash := md5(jsonb_build_object(
    'operation', 'reactivate_source', 'campaignId', p_campaign_id,
    'groupId', v_source.group_id
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, request_hash, status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'reactivate_source', v_source.group_id, v_hash,
    'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'reactivate_source' OR v_batch.request_hash <> v_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  UPDATE public.auto_campaign_data_group_sources
  SET status = 'baselining', stopped_at = NULL, stop_reason = NULL, updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  IF private.aka_agent_defer_data_group_baseline_route(v_source.id, v_batch.id, v_group.revision, false) IS NULL THEN
  PERFORM public.aka_agent_internal_route_group_snapshot(
    v_source.id, v_batch.id, v_group.revision
  );
  END IF;
  UPDATE public.auto_campaign_data_group_sources
  SET status = 'active', baseline_revision = v_group.revision,
      started_at = COALESCE(started_at, now()), last_ingest_at = now(), updated_at = now()
  WHERE id = v_source.id RETURNING * INTO v_source;
  UPDATE public.auto_campaigns
  SET status = CASE WHEN status = 'hoàn thành' THEN 'chờ xử lý' ELSE status END,
      completed_at = CASE WHEN status = 'hoàn thành' THEN NULL ELSE completed_at END,
      note = CASE WHEN status = 'hoàn thành' THEN 'Chờ data mới' ELSE note END,
      updated_at = now()
  WHERE id = v_campaign.id;
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = to_jsonb(v_source), updated_at = now()
  WHERE id = v_batch.id;
  RETURN to_jsonb(v_source);
END;
$function$;

-- public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint): md5 2a9b66655b905f56e44fe492096520bc -> f408ef621e5a77f5c917288a5ee5c8ff
CREATE OR REPLACE FUNCTION public.aka_agent_move_data_group_members(p_staff_id bigint, p_organization_id bigint, p_request_id text, p_group_id bigint, p_membership_ids bigint[], p_target_group_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_source_group public.auto_account_contact_groups%ROWTYPE;
  v_target_group public.auto_account_contact_groups%ROWTYPE;
  v_batch public.auto_data_ingest_batches%ROWTYPE;
  v_request_hash text;
  v_requested integer;
  v_count integer := 0;
  v_source_member record;
  v_target_member public.auto_account_contact_group_members%ROWTYPE;
  v_target_primary_before bigint;
  v_bound_source record;
  v_result jsonb;
BEGIN
  PERFORM public.aka_agent_internal_require_staff_tenant(p_staff_id, p_organization_id);
  IF NULLIF(btrim(COALESCE(p_request_id, '')), '') IS NULL
    OR p_group_id IS NOT DISTINCT FROM p_target_group_id
    OR COALESCE(cardinality(p_membership_ids), 0) = 0
    OR EXISTS (SELECT 1 FROM unnest(p_membership_ids) AS value(id) WHERE id IS NULL OR id <= 0)
  THEN RAISE EXCEPTION 'invalid_data_group_member_move'; END IF;
  SELECT count(DISTINCT id)::integer INTO v_requested FROM unnest(p_membership_ids) AS value(id);

  -- Stable lock order avoids inverse source/destination move deadlocks.
  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id IN (p_group_id, p_target_group_id)
  ORDER BY contact_group.id
  FOR UPDATE;

  SELECT * INTO v_source_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false;
  SELECT * INTO v_target_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = p_target_group_id AND contact_group.staff_id = p_staff_id
    AND contact_group.organization_id = p_organization_id
    AND contact_group.purpose = 'data_group' AND contact_group.is_delete = false;
  IF v_source_group.id IS NULL OR v_target_group.id IS NULL THEN
    RAISE EXCEPTION 'data_group_not_found';
  END IF;

  IF v_target_group.data_type_category_item_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_source_group.id
        AND member.id = ANY(p_membership_ids)
        AND member.is_delete = false
        AND (
          NOT EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.is_current = true
          )
          OR EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.is_current = true
              AND origin.data_type_category_item_id IS DISTINCT FROM
                v_target_group.data_type_category_item_id
          )
        )
    )
  THEN
    RAISE EXCEPTION 'data_group_move_semantic_type_mismatch';
  END IF;

  v_request_hash := md5(jsonb_build_object(
    'operation', 'move_members', 'groupId', p_group_id,
    'targetGroupId', p_target_group_id,
    'membershipIds', (SELECT jsonb_agg(id ORDER BY id) FROM (
      SELECT DISTINCT id FROM unnest(p_membership_ids) AS value(id)
    ) AS sorted)
  )::text);
  INSERT INTO public.auto_data_ingest_batches (
    request_id, operation, group_id, target_group_id, kind, request_hash,
    status, staff_id, organization_id
  ) VALUES (
    btrim(p_request_id), 'move_members', p_group_id, p_target_group_id, 'manual',
    v_request_hash, 'processing', p_staff_id, p_organization_id
  ) ON CONFLICT (staff_id, organization_id, request_id) DO NOTHING
  RETURNING * INTO v_batch;
  IF NOT FOUND THEN
    SELECT * INTO v_batch FROM public.auto_data_ingest_batches
    WHERE staff_id = p_staff_id AND organization_id = p_organization_id
      AND request_id = btrim(p_request_id)
    FOR UPDATE;
    IF v_batch.operation <> 'move_members' OR v_batch.request_hash <> v_request_hash THEN
      RAISE EXCEPTION 'data_group_request_id_conflict';
    END IF;
    IF v_batch.result IS NOT NULL THEN RETURN v_batch.result; END IF;
    RAISE EXCEPTION 'data_group_request_incomplete';
  END IF;

  IF (
    SELECT count(DISTINCT member.id)
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_source_group.id AND member.id = ANY(p_membership_ids)
  ) <> v_requested THEN
    RAISE EXCEPTION 'data_group_membership_not_found';
  END IF;
  SELECT count(*)::integer INTO v_count
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_source_group.id AND member.id = ANY(p_membership_ids)
    AND member.is_delete = false;

  IF v_count > 0 THEN
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_target_group.id RETURNING * INTO v_target_group;
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1, updated_at = now()
    WHERE id = v_source_group.id RETURNING * INTO v_source_group;

    -- Activate destination memberships and provenance first.
    FOR v_source_member IN
      SELECT member.*
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_source_group.id
        AND member.id = ANY(p_membership_ids) AND member.is_delete = false
      ORDER BY member.id
    LOOP
      SELECT member.primary_origin_id
      INTO v_target_primary_before
      FROM public.auto_account_contact_group_members AS member
      WHERE member.group_id = v_target_group.id
        AND member.contact_id = v_source_member.contact_id
      FOR UPDATE;

      INSERT INTO public.auto_account_contact_group_members AS existing_member (
        group_id, contact_id, is_delete, change_revision, created_at, updated_at
      ) VALUES (
        v_target_group.id, v_source_member.contact_id, false,
        v_target_group.revision, now(), now()
      )
      ON CONFLICT (group_id, contact_id) DO UPDATE SET
        is_delete = false,
        change_revision = EXCLUDED.change_revision,
        updated_at = now()
      RETURNING * INTO v_target_member;

      INSERT INTO public.auto_account_contact_group_member_origins (
        membership_id, kind, dataset_id, batch_id, source_account_id, automation_detail_id,
        source_name_snapshot, relationship_kind, data_type_category_item_id, is_current, created_at, updated_at
      )
      SELECT
        v_target_member.id, origin.kind, origin.dataset_id, origin.batch_id,
        origin.source_account_id, origin.automation_detail_id,
        origin.source_name_snapshot, origin.relationship_kind, origin.data_type_category_item_id, true, now(), now()
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = v_source_member.id AND origin.is_current = true
      ON CONFLICT DO NOTHING;

      PERFORM public.aka_agent_sync_copied_data_group_origins(
        v_source_member.id,
        v_target_member.id,
        v_target_primary_before IS NULL
      );

      INSERT INTO public.auto_account_contact_group_member_origins (
        membership_id, kind, batch_id, source_name_snapshot, is_current,
        data_type_category_item_id
      ) VALUES (
        v_target_member.id, 'manual', v_batch.id,
        'move:' || v_source_group.name, true,
        (
          SELECT min(origin.data_type_category_item_id)
          FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = v_source_member.id
            AND origin.is_current = true
          HAVING count(*) > 0
            AND count(origin.data_type_category_item_id) = count(*)
            AND count(DISTINCT origin.data_type_category_item_id) = 1
        )
      ) ON CONFLICT DO NOTHING;

      IF private.aka_agent_defer_data_group_member_route(
        v_target_group.id, v_target_member.id, v_batch.id, v_target_group.revision
      ) IS NULL THEN
      FOR v_bound_source IN
        SELECT source.id FROM public.auto_campaign_data_group_sources AS source
        WHERE source.group_id = v_target_group.id AND source.status IN ('baselining', 'active')
        ORDER BY source.campaign_id
      LOOP
        PERFORM public.aka_agent_internal_route_data_group_member(
          v_bound_source.id, v_target_member.id, v_batch.id, v_target_group.revision
        );
      END LOOP;
      END IF;
    END LOOP;

    -- Source is soft-deleted only after all destination activations/fanout.
    UPDATE public.auto_account_contact_group_members
    SET is_delete = true, change_revision = v_source_group.revision, updated_at = now()
    WHERE group_id = v_source_group.id AND id = ANY(p_membership_ids) AND is_delete = false;
    UPDATE public.auto_account_contact_group_member_origins AS origin
    SET is_current = false, updated_at = now()
    FROM public.auto_account_contact_group_members AS member
    WHERE member.group_id = v_source_group.id AND member.id = ANY(p_membership_ids)
      AND origin.membership_id = member.id AND origin.is_current = true;
  END IF;

  v_result := jsonb_build_object(
    'success', true, 'count', v_count, 'group_revision', v_source_group.revision,
    'target_group_revision', v_target_group.revision
  );
  UPDATE public.auto_data_ingest_batches
  SET status = 'completed', result = v_result, updated_at = now()
  WHERE id = v_batch.id;
  RETURN v_result;
END;
$function$;

-- public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean): md5 9215d6543aa1bb2627676f280465b8fa -> 4bf8a8bd00054e90e9d4bde54343c003
CREATE OR REPLACE FUNCTION public.aka_agent_internal_sync_dataset_auto_group_member(p_dataset_id bigint, p_contact_id bigint, p_is_current boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_dataset public.auto_account_contacts_dataset%ROWTYPE;
  v_group public.auto_account_contact_groups%ROWTYPE;
  v_member public.auto_account_contact_group_members%ROWTYPE;
  v_revision bigint;
  v_relationship_kind text;
  v_had_exact_current_origin boolean := false;
  v_became_active boolean := false;
  v_source record;
BEGIN
  SELECT dataset.*
  INTO v_dataset
  FROM public.auto_account_contacts_dataset AS dataset
  WHERE dataset.id = p_dataset_id
    AND dataset.auto_data_group_id IS NOT NULL
    AND dataset.group_id IS NULL
    AND (
      dataset.is_delete = false
      OR NOT COALESCE(p_is_current, false)
    );

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Dataset-member triggers can also touch user-managed groups which copied
  -- this dataset previously. Lock every affected group, including the owned
  -- auto group, in one deterministic order before touching a membership.
  PERFORM contact_group.id
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.purpose = 'data_group'
    AND contact_group.is_delete = false
    AND (
      contact_group.id = v_dataset.auto_data_group_id
      OR EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_members AS affected_member
        JOIN public.auto_account_contact_group_member_origins AS affected_origin
          ON affected_origin.membership_id = affected_member.id
        WHERE affected_member.group_id = contact_group.id
          AND affected_member.contact_id = p_contact_id
          AND affected_origin.dataset_id = v_dataset.id
      )
    )
  ORDER BY contact_group.id
  FOR UPDATE OF contact_group;

  SELECT contact_group.*
  INTO v_group
  FROM public.auto_account_contact_groups AS contact_group
  WHERE contact_group.id = v_dataset.auto_data_group_id
    AND contact_group.staff_id = v_dataset.staff_id
    AND contact_group.organization_id = v_dataset.organization_id
    AND contact_group.purpose = 'data_group'
    AND contact_group.dataset_sync_mode = 'dataset_auto'
    AND contact_group.is_delete = false
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF COALESCE(p_is_current, false) AND NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contacts AS contact
    WHERE contact.id = p_contact_id
      AND contact.staff_id = v_dataset.staff_id
      AND contact.organization_id = v_dataset.organization_id
      AND COALESCE(contact.is_delete, false) = false
  ) THEN
    p_is_current := false;
  END IF;

  SELECT member.*
  INTO v_member
  FROM public.auto_account_contact_group_members AS member
  WHERE member.group_id = v_group.id
    AND member.contact_id = p_contact_id
  FOR UPDATE;

  IF COALESCE(p_is_current, false) THEN
    IF NOT FOUND THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1,
          updated_at = clock_timestamp()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;

      INSERT INTO public.auto_account_contact_group_members (
        group_id,
        contact_id,
        is_delete,
        change_revision,
        created_at,
        updated_at
      ) VALUES (
        v_group.id,
        p_contact_id,
        false,
        v_revision,
        clock_timestamp(),
        clock_timestamp()
      )
      RETURNING * INTO v_member;
      v_became_active := true;
    ELSIF v_member.is_delete THEN
      UPDATE public.auto_account_contact_groups
      SET revision = revision + 1,
          updated_at = clock_timestamp()
      WHERE id = v_group.id
      RETURNING revision INTO v_revision;

      UPDATE public.auto_account_contact_group_members
      SET is_delete = false,
          change_revision = v_revision,
          updated_at = clock_timestamp()
      WHERE id = v_member.id
      RETURNING * INTO v_member;
      v_became_active := true;
    ELSE
      v_revision := v_group.revision;
    END IF;

    v_relationship_kind := public.aka_agent_derive_data_group_relationship_kind(
      v_member.id,
      v_dataset.account_id,
      v_dataset.id
    );

    SELECT EXISTS (
      SELECT 1
      FROM public.auto_account_contact_group_member_origins AS origin
      WHERE origin.membership_id = v_member.id
        AND origin.kind = v_dataset.source
        AND origin.dataset_id = v_dataset.id
        AND origin.batch_id IS NULL
        AND origin.source_account_id IS NOT DISTINCT FROM v_dataset.account_id
        AND origin.automation_detail_id IS NULL
        AND origin.source_name_snapshot IS NOT DISTINCT FROM v_dataset.name
        AND origin.relationship_kind IS NOT DISTINCT FROM v_relationship_kind
        AND origin.is_current = true
    )
    INTO v_had_exact_current_origin;

    -- Dataset name and relationship are snapshots in the provenance identity.
    -- Retire an older identity before activating the current one.
    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = false,
        updated_at = clock_timestamp()
    WHERE membership_id = v_member.id
      AND dataset_id = v_dataset.id
      AND is_current = true;

    INSERT INTO public.auto_account_contact_group_member_origins (
      membership_id,
      kind,
      dataset_id,
      batch_id,
      source_account_id,
      automation_detail_id,
      source_name_snapshot,
      relationship_kind,
      is_current,
      created_at,
      updated_at
    ) VALUES (
      v_member.id,
      v_dataset.source,
      v_dataset.id,
      NULL,
      v_dataset.account_id,
      NULL,
      v_dataset.name,
      v_relationship_kind,
      true,
      clock_timestamp(),
      clock_timestamp()
    )
    ON CONFLICT DO NOTHING;

    UPDATE public.auto_account_contact_group_member_origins
    SET is_current = true,
        updated_at = clock_timestamp()
    WHERE membership_id = v_member.id
      AND kind = v_dataset.source
      AND dataset_id = v_dataset.id
      AND batch_id IS NULL
      AND source_account_id IS NOT DISTINCT FROM v_dataset.account_id
      AND automation_detail_id IS NULL
      AND source_name_snapshot IS NOT DISTINCT FROM v_dataset.name
      AND relationship_kind IS NOT DISTINCT FROM v_relationship_kind;

    IF v_became_active OR NOT v_had_exact_current_origin THEN
      IF private.aka_agent_defer_data_group_member_route(v_group.id, v_member.id, NULL, v_revision) IS NULL THEN
      FOR v_source IN
        SELECT source.id
        FROM public.auto_campaign_data_group_sources AS source
        WHERE source.group_id = v_group.id
          AND source.status IN ('baselining', 'active')
        ORDER BY source.campaign_id, source.id
      LOOP
        PERFORM public.aka_agent_internal_route_data_group_member(
          v_source.id,
          v_member.id,
          NULL,
          v_revision
        );
      END LOOP;
      END IF;
    END IF;
    RETURN;
  END IF;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.auto_account_contact_group_member_origins
  SET is_current = false,
      updated_at = clock_timestamp()
  WHERE membership_id = v_member.id
    AND dataset_id = v_dataset.id
    AND is_current = true;

  IF NOT v_member.is_delete AND NOT EXISTS (
    SELECT 1
    FROM public.auto_account_contact_group_member_origins AS current_origin
    WHERE current_origin.membership_id = v_member.id
      AND current_origin.is_current = true
  ) THEN
    UPDATE public.auto_account_contact_groups
    SET revision = revision + 1,
        updated_at = clock_timestamp()
    WHERE id = v_group.id
    RETURNING revision INTO v_revision;

    UPDATE public.auto_account_contact_group_members
    SET is_delete = true,
        change_revision = v_revision,
        updated_at = clock_timestamp()
    WHERE id = v_member.id;
  END IF;
END;
$function$;

-- public.aka_agent_sync_scan_dataset_group_origins(): md5 5164ca868e763bfabd830e2114deeff9 -> 7ad7de9336833e9803344620594e4e5d
CREATE OR REPLACE FUNCTION public.aka_agent_sync_scan_dataset_group_origins()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.dataset_id ELSE NEW.dataset_id END;
  v_contact_id bigint := CASE WHEN TG_OP = 'DELETE' THEN OLD.contact_id ELSE NEW.contact_id END;
  v_is_current boolean := CASE WHEN TG_OP = 'DELETE' THEN false ELSE NEW.is_current END;
  v_member record;
  v_revision bigint;
  v_source record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.auto_account_contacts_dataset AS dataset
    WHERE dataset.id = v_dataset_id AND dataset.source = 'scan'
  ) THEN
    PERFORM contact_group.id
    FROM public.auto_account_contact_groups AS contact_group
    WHERE contact_group.purpose = 'data_group'
      AND contact_group.dataset_sync_mode <> 'dataset_auto'
      AND contact_group.is_delete = false
      AND EXISTS (
        SELECT 1
        FROM public.auto_account_contact_group_members AS member
        WHERE member.group_id = contact_group.id
          AND member.contact_id = v_contact_id
          AND EXISTS (
            SELECT 1
            FROM public.auto_account_contact_group_member_origins AS origin
            WHERE origin.membership_id = member.id
              AND origin.dataset_id = v_dataset_id
          )
      )
    ORDER BY contact_group.id
    FOR UPDATE OF contact_group;

    FOR v_member IN
      SELECT member.id, member.group_id, member.is_delete
      FROM public.auto_account_contact_group_members AS member
      JOIN public.auto_account_contact_groups AS contact_group
        ON contact_group.id = member.group_id
       AND contact_group.purpose = 'data_group'
       AND contact_group.dataset_sync_mode <> 'dataset_auto'
       AND contact_group.is_delete = false
      WHERE member.contact_id = v_contact_id
        AND EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS origin
          WHERE origin.membership_id = member.id AND origin.dataset_id = v_dataset_id
        )
      ORDER BY member.group_id, member.id
      FOR UPDATE OF member
    LOOP
      IF v_is_current THEN
        IF v_member.is_delete THEN
          UPDATE public.auto_account_contact_groups
          SET revision = revision + 1, updated_at = now()
          WHERE id = v_member.group_id
          RETURNING revision INTO v_revision;
          UPDATE public.auto_account_contact_group_members
          SET is_delete = false, change_revision = v_revision, updated_at = now()
          WHERE id = v_member.id;
        ELSE
          SELECT revision INTO v_revision
          FROM public.auto_account_contact_groups WHERE id = v_member.group_id;
        END IF;
        UPDATE public.auto_account_contact_group_member_origins
        SET is_current = true, updated_at = now()
        WHERE membership_id = v_member.id AND dataset_id = v_dataset_id
          AND is_current = false;

        IF v_member.is_delete THEN
          IF private.aka_agent_defer_data_group_member_route(v_member.group_id, v_member.id, NULL, v_revision) IS NULL THEN
          FOR v_source IN
            SELECT source.id
            FROM public.auto_campaign_data_group_sources AS source
            WHERE source.group_id = v_member.group_id
              AND source.status IN ('baselining', 'active')
            ORDER BY source.campaign_id
          LOOP
            PERFORM public.aka_agent_internal_route_data_group_member(
              v_source.id, v_member.id, NULL, v_revision
            );
          END LOOP;
          END IF;
        END IF;
      ELSE
        UPDATE public.auto_account_contact_group_member_origins
        SET is_current = false, updated_at = now()
        WHERE membership_id = v_member.id AND dataset_id = v_dataset_id
          AND is_current = true;
        IF NOT v_member.is_delete AND NOT EXISTS (
          SELECT 1 FROM public.auto_account_contact_group_member_origins AS current_origin
          WHERE current_origin.membership_id = v_member.id
            AND current_origin.is_current = true
        ) THEN
          UPDATE public.auto_account_contact_groups
          SET revision = revision + 1, updated_at = now()
          WHERE id = v_member.group_id
          RETURNING revision INTO v_revision;
          UPDATE public.auto_account_contact_group_members
          SET is_delete = true, change_revision = v_revision, updated_at = now()
          WHERE id = v_member.id;
        END IF;
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$function$;

-- private.copy_shared_group(bigint,bigint,text,bigint,jsonb): md5 9b310ca079d192f4e809b9cf09d28740 -> a84ce82f3c830f23ffb6cb6c3ef288be
CREATE OR REPLACE FUNCTION private.copy_shared_group(p_staff_id bigint, p_organization_id bigint, p_kind text, p_group_id bigint, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_request text:=p_data->>'requestId';
  v_hash text:=md5(p_data::text);
  v_prior private.group_copy_requests%ROWTYPE;
  v_access jsonb;
  v_source public.auto_account_contact_groups%ROWTYPE;
  v_target public.auto_account_contact_groups%ROWTYPE;
  v_content_group public.auto_content_groups%ROWTYPE;
  v_target_id bigint:=NULLIF(p_data->>'targetGroupId','')::bigint;
  v_template_id bigint:=NULLIF(p_data->>'templateId','')::bigint;
  v_member_ids bigint[];
  v_contact_id bigint;
  v_member_id bigint;
  v_count integer:=0;
  v_row record;
  v_revision bigint;
  v_result jsonb;
  v_base_name text;
  v_copy_name text;
  v_name_attempt integer;
  v_inserted_template_id bigint;
BEGIN
  IF v_request IS NULL OR length(v_request) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'invalid_group_copy_request'; END IF;
  IF p_kind='data' THEN
    PERFORM id FROM public.auto_account_contact_groups WHERE id IN (p_group_id,v_target_id) ORDER BY id FOR UPDATE;
  ELSE
    -- Copies into the same staff library allocate names in one transaction.
    -- Take this before group locks so overlapping multi-template copies cannot
    -- wait on each other's unique names in opposite source-template orders.
    PERFORM pg_advisory_xact_lock(hashtextextended('group-sharing-content-copy:'||p_staff_id::text,0));
    PERFORM id FROM public.auto_content_groups WHERE id IN (p_group_id,v_target_id) ORDER BY id FOR UPDATE;
  END IF;
  v_access:=private.group_access(p_kind,p_group_id,p_staff_id,p_organization_id);
  IF v_access IS NULL THEN RAISE EXCEPTION 'group_sharing_access_denied'; END IF;
  IF v_target_id IS NOT NULL AND NOT COALESCE((private.group_access(p_kind,v_target_id,p_staff_id,p_organization_id)->>'canManage')::boolean,false)
    THEN RAISE EXCEPTION 'group_sharing_owner_required'; END IF;
  IF v_target_id=p_group_id THEN RAISE EXCEPTION 'invalid_group_copy_target'; END IF;
  INSERT INTO private.group_copy_requests(staff_id,organization_id,request_id,request_hash)
    VALUES(p_staff_id,p_organization_id,v_request,v_hash) ON CONFLICT DO NOTHING;
  SELECT * INTO v_prior FROM private.group_copy_requests WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND request_id=v_request FOR UPDATE;
  IF v_prior.request_hash<>v_hash THEN RAISE EXCEPTION 'data_group_request_id_conflict'; END IF;
  IF v_prior.result IS NOT NULL THEN RETURN v_prior.result; END IF;
  IF p_kind='data' THEN
    SELECT * INTO v_source FROM public.auto_account_contact_groups WHERE id=p_group_id;
    IF v_target_id IS NULL THEN
      INSERT INTO public.auto_account_contact_groups(name,color,sort_order,purpose,staff_id,organization_id,data_type_category_item_id,dataset_sync_mode,is_delete)
        VALUES(COALESCE(NULLIF(btrim(p_data->>'name'),''),v_source.name||' - Bản sao'),v_source.color,0,'data_group',p_staff_id,p_organization_id,v_source.data_type_category_item_id,'manual',false)
        RETURNING id INTO v_target_id;
    END IF;
    SELECT * INTO v_target FROM public.auto_account_contact_groups WHERE id=v_target_id;
    IF v_target.bound_zalo_account_id IS NOT NULL THEN RAISE EXCEPTION 'data_group_bound_source_unknown'; END IF;
    IF v_target.data_type_category_item_id IS NOT NULL AND v_target.data_type_category_item_id IS DISTINCT FROM v_source.data_type_category_item_id
      THEN RAISE EXCEPTION 'data_group_ingest_semantic_type_mismatch'; END IF;
    IF jsonb_typeof(p_data->'membershipIds')='array' THEN
      SELECT COALESCE(array_agg(DISTINCT x::bigint),'{}'::bigint[]) INTO v_member_ids FROM jsonb_array_elements_text(p_data->'membershipIds') x;
      IF EXISTS(SELECT 1 FROM unnest(v_member_ids) requested(id) WHERE NOT EXISTS(
        SELECT 1 FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id
        WHERE m.id=requested.id AND m.group_id=p_group_id AND NOT m.is_delete AND NOT COALESCE(c.is_delete,false)
          AND c.staff_id=v_source.staff_id AND c.organization_id=p_organization_id))
        THEN RAISE EXCEPTION 'invalid_group_copy_members'; END IF;
    END IF;
    UPDATE public.auto_account_contact_groups SET revision=revision+1 WHERE id=v_target_id RETURNING revision INTO v_revision;
    FOR v_row IN SELECT c.*,COALESCE(o.data_type_category_item_id,v_source.data_type_category_item_id) copied_type
      FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts c ON c.id=m.contact_id
      LEFT JOIN public.auto_account_contact_group_member_origins o ON o.id=m.primary_origin_id AND o.is_current
      WHERE m.group_id=p_group_id AND NOT m.is_delete AND NOT COALESCE(c.is_delete,false)
        AND c.staff_id=v_source.staff_id AND c.organization_id=p_organization_id
        AND (v_member_ids IS NULL OR m.id=ANY(v_member_ids)) ORDER BY m.id
    LOOP
      -- Independent accountless records: never copy account permissions, tags, relationship flags or raw extra_data.
      INSERT INTO public.auto_account_contacts(staff_id,organization_id,account_id,contact_type,flatform_type,name,uid,url,phone,email,extra_data,is_delete)
        VALUES(p_staff_id,p_organization_id,NULL,v_row.contact_type,v_row.flatform_type,v_row.name,v_row.uid,v_row.url,v_row.phone,v_row.email,
          jsonb_strip_nulls(jsonb_build_object('info1',v_row.extra_data->'info1','info2',v_row.extra_data->'info2',
            'info3',v_row.extra_data->'info3','info4',v_row.extra_data->'info4','info5',v_row.extra_data->'info5')),false)
        RETURNING id INTO v_contact_id;
      INSERT INTO public.auto_account_contact_group_members(group_id,contact_id,change_revision,is_delete)
        VALUES(v_target_id,v_contact_id,v_revision,false) RETURNING id INTO v_member_id;
      INSERT INTO public.auto_account_contact_group_member_origins(membership_id,kind,source_name_snapshot,data_type_category_item_id,is_current)
        VALUES(v_member_id,'manual','Bản sao: '||v_source.name,v_row.copied_type,true);
      -- Preserve normal intake for the recipient's existing target group.
      IF private.aka_agent_defer_data_group_member_route(v_target_id,v_member_id,NULL,v_revision) IS NULL THEN
      FOR v_result IN SELECT public.aka_agent_internal_route_data_group_member(s.id,v_member_id,NULL,v_revision)
        FROM public.auto_campaign_data_group_sources s WHERE s.group_id=v_target_id AND s.status IN ('active','baselining') ORDER BY s.campaign_id
      LOOP NULL; END LOOP;
      END IF;
      v_count:=v_count+1;
    END LOOP;
  ELSE
    SELECT * INTO v_content_group FROM public.auto_content_groups WHERE id=p_group_id;
    IF NOT v_content_group.is_active AND (v_access->>'role')='shared' THEN RAISE EXCEPTION 'group_sharing_access_denied'; END IF;
    IF v_template_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.auto_content_templates
      WHERE id=v_template_id AND group_id=p_group_id AND staff_id=v_content_group.staff_id AND organization_id=p_organization_id AND NOT is_delete)
      THEN RAISE EXCEPTION 'invalid_group_copy_template'; END IF;
    IF v_target_id IS NULL THEN
      v_base_name:=COALESCE(NULLIF(btrim(p_data->>'name'),''),v_content_group.name||' - Bản sao');
      v_copy_name:=v_base_name;
      v_name_attempt:=1;
      LOOP
        -- Let the existing unique index arbitrate concurrent copies/ordinary
        -- creates as well as case-insensitive, trimmed-name collisions.
        INSERT INTO public.auto_content_groups(name,description,stt,is_active,staff_id,organization_id,is_delete)
          VALUES(v_copy_name,v_content_group.description,100,true,p_staff_id,p_organization_id,false)
          ON CONFLICT (staff_id, (lower(btrim(name)))) WHERE staff_id IS NOT NULL AND is_delete=false
          DO NOTHING RETURNING id INTO v_target_id;
        EXIT WHEN v_target_id IS NOT NULL;
        v_name_attempt:=v_name_attempt+1;
        v_copy_name:=v_base_name||' ('||v_name_attempt||')';
      END LOOP;
    END IF;
    IF NOT EXISTS(SELECT 1 FROM public.auto_content_groups WHERE id=v_target_id AND is_active) THEN RAISE EXCEPTION 'invalid_group_copy_target'; END IF;
    FOR v_row IN SELECT * FROM public.auto_content_templates
      WHERE group_id=p_group_id AND staff_id=v_content_group.staff_id AND organization_id=p_organization_id
        AND NOT is_delete AND (v_template_id IS NULL OR id=v_template_id) ORDER BY id
    LOOP
      v_copy_name:=v_row.name;
      v_base_name:=v_row.name||' - Bản sao';
      v_name_attempt:=0;
      LOOP
        INSERT INTO public.auto_content_templates(name,content,group_id,content_type_id,image_urls,channels,channel_image_urls,base_content_html,staff_id,organization_id,is_delete)
          VALUES(v_copy_name,v_row.content,v_target_id,v_row.content_type_id,v_row.image_urls,v_row.channels,v_row.channel_image_urls,v_row.base_content_html,p_staff_id,p_organization_id,false)
          ON CONFLICT (staff_id, (lower(btrim(name)))) WHERE is_delete=false
          DO NOTHING RETURNING id INTO v_inserted_template_id;
        EXIT WHEN v_inserted_template_id IS NOT NULL;
        v_name_attempt:=v_name_attempt+1;
        v_copy_name:=v_base_name||CASE WHEN v_name_attempt=1 THEN '' ELSE ' ('||v_name_attempt||')' END;
      END LOOP;
      v_count:=v_count+1;
    END LOOP;
  END IF;
  v_result:=jsonb_build_object('groupId',v_target_id,'count',v_count);
  UPDATE private.group_copy_requests SET result=v_result WHERE staff_id=p_staff_id AND organization_id=p_organization_id AND request_id=v_request;
  RETURN v_result;
END;
$function$;

-- private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb): prosrc md5 ff99a8564bb1ce517675419f03967eeb -> 4aa52e79124baf2cf94f7953f310c825
CREATE OR REPLACE FUNCTION private.aka_agent_assert_data_group_ingest_budget(
  p_organization_id bigint,
  p_group_id bigint,
  p_kind text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  -- Đo trên production: ~7–11 ms mỗi dòng khi nhóm cấp data cho 0–1 chiến dịch (08/11, file 3.757–4.911 dòng),
  -- ~4,3 ms cho mỗi (dòng × chiến dịch đang bật nhận data) (02/11, nhóm ~575 chiến dịch).
  c_row_ms constant numeric := 8;
  c_campaign_ms constant numeric := 5;
  c_reject_ms constant numeric := 75000;  -- chỉ chặn lần gửi chắc chắn vượt trần 60 giây của hàm nạp
  c_suggest_ms constant numeric := 45000; -- số dòng gợi ý cho một lần gửi
  v_rows integer;
  v_campaigns integer;
  v_row_ms numeric;
  v_max_rows integer;
  v_reason text;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RETURN; -- hàm nạp tự báo invalid_data_group_ingest_payload
  END IF;
  v_rows := jsonb_array_length(p_rows);
  IF v_rows = 0 THEN
    RETURN;
  END IF;

  -- Chỉ đếm nguồn cùng tổ chức người gọi: không lộ số liệu nhóm của tổ chức khác.
  SELECT count(*)::integer
    INTO v_campaigns
    FROM public.auto_campaign_data_group_sources AS source
   WHERE source.group_id = p_group_id
     AND source.status IN ('baselining', 'active')
     AND source.organization_id = p_organization_id;
  -- V484: tổ chức chạy chế độ 'async' chỉ ghi thành viên trong lượt nạp, việc đẩy vào chiến dịch chạy nền.
  IF private.aka_agent_data_group_route_async(p_organization_id) THEN
    v_campaigns := 0;
  END IF;

  v_row_ms := c_row_ms + v_campaigns * c_campaign_ms;
  IF v_rows * v_row_ms <= c_reject_ms THEN
    RETURN;
  END IF;
  v_max_rows := greatest(1, floor(c_suggest_ms / v_row_ms)::integer);
  v_reason := CASE
    WHEN v_campaigns > 0 THEN format('nhóm data này đang cấp data cho %s chiến dịch bật "nhận data mới từ nhóm"', v_campaigns)
    ELSE 'danh sách quá lớn'
  END;

  RAISE EXCEPTION USING
    ERRCODE = 'PT413',
    MESSAGE = CASE
      WHEN p_kind = 'upload' THEN format(
        'File có %s dòng, quá nhiều để nhập một lần vì %s (mỗi lần khoảng %s dòng). Vui lòng tách thành nhiều file, mỗi file đặt tên khác nhau, rồi nhập lần lượt.',
        v_rows, v_reason, v_max_rows)
      ELSE format(
        'Không thể thêm %s dòng trong một lần vì %s (mỗi lần khoảng %s dòng). Vui lòng chọn ít data hơn rồi thêm nhiều lần, hoặc cập nhật phần mềm bản mới để tự chia nhỏ.',
        v_rows, v_reason, v_max_rows)
    END,
    DETAIL = jsonb_build_object(
      'code', 'data_group_ingest_too_large',
      'maxRows', v_max_rows,
      'rowMs', v_row_ms,
      'receivingCampaigns', v_campaigns,
      'rows', v_rows
    )::text;
END;
$function$;

SELECT cron.schedule(
  'aka-agent-data-group-route-worker',
  '10 seconds',
  'SELECT private.aka_agent_run_data_group_route_worker();'
);

DO $v484_p3_postflight$
DECLARE
  v_item record;
  v_md5 text;
  v_role text;
  v_sig text;
BEGIN
  FOR v_item IN SELECT key AS sig, value AS expected FROM jsonb_each_text('{"public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,bigint,text,text)": "0a0c9d1f870df7eac69ceaa20f6fb10a", "public.aka_agent_bind_campaign_data_group_source(bigint,bigint,text,bigint,bigint,bigint)": "ce799127008afc8f72edd31ef2042a39", "public.aka_agent_reactivate_campaign_data_group_source(bigint,bigint,bigint,text,text)": "b185fd226aa469ae488c39f7e5344ab6", "public.aka_agent_move_data_group_members(bigint,bigint,text,bigint,bigint[],bigint)": "f408ef621e5a77f5c917288a5ee5c8ff", "public.aka_agent_internal_sync_dataset_auto_group_member(bigint,bigint,boolean)": "4bf8a8bd00054e90e9d4bde54343c003", "public.aka_agent_sync_scan_dataset_group_origins()": "7ad7de9336833e9803344620594e4e5d", "private.copy_shared_group(bigint,bigint,text,bigint,jsonb)": "a84ce82f3c830f23ffb6cb6c3ef288be"}'::jsonb) LOOP
    IF to_regprocedure(v_item.sig) IS NULL THEN
      RAISE EXCEPTION 'v484: % missing', v_item.sig;
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(v_item.sig)));
    IF v_md5 IS DISTINCT FROM v_item.expected THEN
      RAISE EXCEPTION 'v484 final postflight: % not as expected after apply (md5 %, expected %)', v_item.sig, v_md5, v_item.expected;
    END IF;
  END LOOP;
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_proc AS p WHERE p.oid = to_regprocedure('private.aka_agent_assert_data_group_ingest_budget(bigint,bigint,text,jsonb)');
  IF v_md5 IS DISTINCT FROM '4aa52e79124baf2cf94f7953f310c825' THEN
    RAISE EXCEPTION 'v484: guard not as expected after apply (prosrc md5 %)', v_md5;
  END IF;
  IF EXISTS (
    SELECT 1 FROM v484_acl AS before
    JOIN pg_proc AS p ON p.oid = to_regprocedure(before.sig)
    WHERE p.proacl::text IS DISTINCT FROM before.acl OR p.proconfig::text IS DISTINCT FROM before.config
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM before.owner OR p.prosecdef IS DISTINCT FROM before.prosecdef
  ) THEN
    RAISE EXCEPTION 'v484: privileges/config of a patched function changed';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      FOREACH v_sig IN ARRAY ARRAY['private.aka_agent_data_group_routing_settings()', 'private.aka_agent_data_group_route_async(bigint)', 'private.aka_agent_defer_data_group_member_route(bigint,bigint,bigint,bigint)', 'private.aka_agent_defer_data_group_baseline_route(bigint,bigint,bigint,boolean)', 'private.aka_agent_finish_data_group_route_job(bigint)', 'private.aka_agent_route_data_group_job_slice(bigint,timestamp with time zone)', 'private.aka_agent_run_data_group_route_worker(integer)'] LOOP
        IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
          RAISE EXCEPTION 'v484: % executable by %', v_sig, v_role;
        END IF;
      END LOOP;
      IF has_table_privilege(v_role, 'private.auto_data_group_route_jobs', 'SELECT')
         OR has_table_privilege(v_role, 'private.auto_data_group_route_job_members', 'SELECT') THEN
        RAISE EXCEPTION 'v484: route tables readable by %', v_role;
      END IF;
    END IF;
  END LOOP;
  IF (SELECT value FROM public.auto_system_settings WHERE key = 'data_groups.routing_mode')::jsonb ->> 'mode'
     IS DISTINCT FROM 'sync' THEN
    RAISE EXCEPTION 'v484: routing mode must start as sync';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker'
                   AND schedule = '10 seconds' AND command = 'SELECT private.aka_agent_run_data_group_route_worker();'
                   AND active) THEN
    RAISE EXCEPTION 'v484: cron job missing';
  END IF;
END
$v484_p3_postflight$;

COMMIT;
