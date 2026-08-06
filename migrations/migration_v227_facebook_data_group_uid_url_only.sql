-- Facebook Data Group routing is driven by semantic compatibility plus the
-- action target value (UID/URL/link). Imported/scanned contact metadata such
-- as flatform_type and contact_type must not reject an otherwise valid target.
-- Zalo metadata, account and relationship guards remain unchanged.

BEGIN;

DO $patch_live_facebook_metadata_guards$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_route_data_group_member_v186_internal(bigint,bigint,bigint,bigint)'
  );
  v_definition text;
  v_group_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'group' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_group_required');
    END IF;$guard$;
  v_person_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_person_required');
    END IF;$guard$;
  v_search_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'campaign_input' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_search_input_required');
    END IF;$guard$;
  v_comment_guard text := $guard$
    IF v_platform <> 'facebook'
      OR (
        v_action = 'facebook_comment_seeding'
        AND v_contact_type NOT IN ('group', 'page', 'person', 'campaign_input')
      )
      OR (
        v_action = 'facebook_comment_seeding_post'
        AND v_contact_type <> 'campaign_input'
      )
    THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason',
        CASE WHEN v_action = 'facebook_comment_seeding_post'
          THEN 'facebook_post_target_required'
          ELSE 'facebook_comment_target_required'
        END
      );
    END IF;$guard$;
  v_page_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'page' THEN
      RETURN jsonb_build_object('status', 'incompatible', 'reason', 'facebook_page_required');
    END IF;$guard$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v186_data_group_router_for_v227';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'v227: Facebook routes use semantic type plus UID/URL only'
  ) = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_group_guard, ''))
    ) <> length(v_group_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_person_guard, ''))
      ) <> length(v_person_guard) * 2
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_search_guard, ''))
      ) <> length(v_search_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_comment_guard, ''))
      ) <> length(v_comment_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_page_guard, ''))
      ) <> length(v_page_guard)
    THEN
      RAISE EXCEPTION 'unexpected_live_facebook_metadata_guard_shape_for_v227';
    END IF;

    v_definition := pg_catalog.replace(
      v_definition,
      v_group_guard,
      E'\n    -- v227: Facebook routes use semantic type plus UID/URL only.'
    );
    v_definition := pg_catalog.replace(v_definition, v_person_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_search_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_comment_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_page_guard, '');
    EXECUTE v_definition;
  END IF;
END;
$patch_live_facebook_metadata_guards$;

DO $patch_snapshot_facebook_metadata_guards$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_snapshot_data_group_to_direct_campaign_v205_internal(bigint,bigint,text,bigint,bigint,timestamp with time zone,text,text,text)'
  );
  v_definition text;
  v_group_guard text := $guard$
      IF v_platform <> 'facebook' OR v_contact_type <> 'group' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;$guard$;
  v_person_guard text := $guard$
      IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;$guard$;
  v_search_guard text := $guard$
      IF v_platform <> 'facebook' OR v_contact_type <> 'campaign_input' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;$guard$;
  v_comment_guard text := $guard$
      IF v_platform <> 'facebook'
        OR (v_action = 'facebook_comment_seeding'
          AND v_contact_type NOT IN ('group', 'page', 'person', 'campaign_input'))
        OR (v_action = 'facebook_comment_seeding_post'
          AND v_contact_type <> 'campaign_input')
      THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;$guard$;
  v_page_guard text := $guard$
      IF v_platform <> 'facebook' OR v_contact_type <> 'page' THEN
        v_incompatible := v_incompatible + 1; CONTINUE;
      END IF;$guard$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v205_direct_snapshot_for_v227';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'v227: snapshot Facebook routes use semantic type plus UID/URL only'
  ) = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_group_guard, ''))
    ) <> length(v_group_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_person_guard, ''))
      ) <> length(v_person_guard) * 2
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_search_guard, ''))
      ) <> length(v_search_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_comment_guard, ''))
      ) <> length(v_comment_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_page_guard, ''))
      ) <> length(v_page_guard)
    THEN
      RAISE EXCEPTION 'unexpected_snapshot_facebook_metadata_guard_shape_for_v227';
    END IF;

    v_definition := pg_catalog.replace(
      v_definition,
      v_group_guard,
      E'\n      -- v227: snapshot Facebook routes use semantic type plus UID/URL only.'
    );
    v_definition := pg_catalog.replace(v_definition, v_person_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_search_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_comment_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_page_guard, '');
    EXECUTE v_definition;
  END IF;
END;
$patch_snapshot_facebook_metadata_guards$;

DO $patch_preview_facebook_metadata_guards$
DECLARE
  v_signature regprocedure := pg_catalog.to_regprocedure(
    'public.aka_agent_internal_preview_data_group_target_key(bigint,bigint,bigint,bigint,text,bigint)'
  );
  v_definition text;
  v_group_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'group' THEN
      RETURN NULL;
    END IF;$guard$;
  v_person_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'person' THEN
      RETURN NULL;
    END IF;$guard$;
  v_search_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'campaign_input' THEN
      RETURN NULL;
    END IF;$guard$;
  v_comment_guard text := $guard$
    IF v_platform <> 'facebook'
      OR (
        v_action = 'facebook_comment_seeding'
        AND v_contact_type NOT IN ('group', 'page', 'person', 'campaign_input')
      )
      OR (
        v_action = 'facebook_comment_seeding_post'
        AND v_contact_type <> 'campaign_input'
      )
    THEN
      RETURN NULL;
    END IF;$guard$;
  v_page_guard text := $guard$
    IF v_platform <> 'facebook' OR v_contact_type <> 'page' THEN
      RETURN NULL;
    END IF;$guard$;
BEGIN
  IF v_signature IS NULL THEN
    RAISE EXCEPTION 'missing_v225_data_group_preview_for_v227';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_signature) INTO v_definition;
  IF pg_catalog.strpos(
    v_definition,
    'v227: preview Facebook routes use semantic type plus UID/URL only'
  ) = 0 THEN
    IF (
      length(v_definition) - length(pg_catalog.replace(v_definition, v_group_guard, ''))
    ) <> length(v_group_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_person_guard, ''))
      ) <> length(v_person_guard) * 2
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_search_guard, ''))
      ) <> length(v_search_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_comment_guard, ''))
      ) <> length(v_comment_guard)
      OR (
        length(v_definition) - length(pg_catalog.replace(v_definition, v_page_guard, ''))
      ) <> length(v_page_guard)
    THEN
      RAISE EXCEPTION 'unexpected_preview_facebook_metadata_guard_shape_for_v227';
    END IF;

    v_definition := pg_catalog.replace(
      v_definition,
      v_group_guard,
      E'\n    -- v227: preview Facebook routes use semantic type plus UID/URL only.'
    );
    v_definition := pg_catalog.replace(v_definition, v_person_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_search_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_comment_guard, '');
    v_definition := pg_catalog.replace(v_definition, v_page_guard, '');
    EXECUTE v_definition;
  END IF;
END;
$patch_preview_facebook_metadata_guards$;

NOTIFY pgrst, 'reload schema';

COMMIT;
