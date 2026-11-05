-- V465: Báo cáo dữ liệu (data reports) for the WebApp, iOS and Desktop.
--
-- A nightly job keeps a customer ledger per staff and writes one report snapshot per staff; opening the report
-- reads that snapshot by primary key, so no large table is scanned while a customer waits.
--
-- New objects only. No existing table, column, index, policy, function, role or timeout is changed.
--   * private tables (not exposed by PostgREST, no grants to API roles):
--       aka_agent_data_report_state, _staff, _customers (ledger), _phone_links, _contact_keys, _daily,
--       _group_daily, _groups, _snapshots, _runs and the UNLOGGED working table _stage.
--   * private functions run by postgres only (sweeps, merge, build, run).
--   * public.aka_agent_read_data_report: EXECUTE for service_role (WebApp backend singleton) and
--     aka_agent_desktop (Desktop token + automation credentials) through public.auto_assert_automation_identity,
--     like V462. Modes: snapshot (one row by primary key) and journey (one phone, indexed reads).
--   * pg_cron job aka-agent-data-report-nightly: every 2 minutes from 01:00 to 04:58 Vietnam time
--     (18:00-21:58 UTC), one backend, each run bounded to about 90 s (hard cap 100 s) by its own deadline and
--     serialized by an advisory lock. The platform statement_timeout of 120 s applies to cron jobs too: a run
--     over it would be cancelled with all of its work, so the budget stays well below it.
--     Each run first catches up four id-ordered sweeps (zalo_users, auto_account_contacts,
--     auto_campaign_input_data, auto_campaign_details; batches of 20.000 rows), then engagement marks, then
--     builds snapshots for active staff whose snapshot is older than yesterday. The first nights backfill
--     the history; until a staff has a snapshot the API answers "đang chuẩn bị".
--
-- Customer identity (same order everywhere): Zalo global id (zalo_users.global_id, shared by all accounts),
-- else normalized Vietnamese mobile (public.aka_agent_internal_normalize_phone), else (account, Zalo UID).
-- A target row that carries both a phone and a Zalo UID links the phone to the person, and any ledger row kept
-- under the phone alone is merged into the person.
-- Only Zalo people and phone numbers are counted (plan phase 1); Facebook and email stay out.
--
-- Optional companion: migration_v466_zalo_users_friend_index.sql (CREATE INDEX CONCURRENTLY, run alone).
-- Rollback: migrations/rollback_v465_data_reports.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $preflight$
BEGIN
  IF to_regclass('private.aka_agent_data_report_customers') IS NOT NULL
     OR to_regprocedure('public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb)') IS NOT NULL
     OR to_regprocedure('private.aka_agent_data_report_run(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'v465_target_already_exists_do_not_overwrite';
  END IF;
  IF to_regnamespace('private') IS NULL
     OR to_regclass('public.zalo_users') IS NULL
     OR to_regclass('public.auto_account_contacts') IS NULL
     OR to_regclass('public.auto_campaign_input_data') IS NULL
     OR to_regclass('public.auto_campaign_details') IS NULL
     OR to_regclass('public.auto_campaign_detail_zalo_engagement') IS NULL
     OR to_regclass('public.auto_account_contact_groups') IS NULL
     OR to_regclass('public.auto_account_contact_group_members') IS NULL
     OR to_regclass('public.auto_account_contacts_dataset') IS NULL
     OR to_regclass('public.auto_account_contacts_dataset_members') IS NULL
     OR to_regprocedure('public.auto_assert_automation_identity(bigint,bigint,text,text)') IS NULL
     OR to_regprocedure('public.aka_agent_internal_normalize_phone(text)') IS NULL
     OR to_regprocedure('public.normalize_phone(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aka_agent_desktop') THEN
    RAISE EXCEPTION 'v465_dependency_missing';
  END IF;
  IF to_regclass('cron.job') IS NULL OR to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'v465_pg_cron_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aka-agent-data-report-nightly') THEN
    RAISE EXCEPTION 'v465_cron_job_already_exists';
  END IF;
  IF coalesce(current_setting('cron.timezone', true), '') NOT IN ('GMT', 'UTC') THEN
    RAISE EXCEPTION 'v465_cron_timezone_not_utc';
  END IF;
  -- Sweeps and the journey read rely on these existing indexes; stop instead of planning full scans.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_zalo_users_account_uid')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_input_cooldown_phone')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_campaign_details_input_data_id')
     OR NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_auto_account_contact_group_members_contact') THEN
    RAISE EXCEPTION 'v465_expected_index_missing';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------
CREATE TABLE private.aka_agent_data_report_state (
  name text PRIMARY KEY,
  watermark bigint NOT NULL DEFAULT 0,
  watermark_at timestamptz,
  rows_total bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO private.aka_agent_data_report_state (name)
VALUES ('people'), ('contacts'), ('inputs'), ('details'), ('engagement');

CREATE TABLE private.aka_agent_data_report_staff (
  staff_id bigint PRIMARY KEY,
  organization_id bigint,
  failed_on date,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (staff, customer). kind: 1 Zalo person, 2 phone only.
-- source (first way the customer entered the store): 1 Zalo member/person, 2 phone number, 3 Zalo friend.
CREATE TABLE private.aka_agent_data_report_customers (
  staff_id bigint NOT NULL,
  key_hash bigint NOT NULL,
  kind smallint NOT NULL,
  source smallint NOT NULL,
  first_seen_on date NOT NULL,
  first_cared_on date,
  last_cared_on date,
  care_count integer NOT NULL DEFAULT 0,
  last_touch bigint,
  verified_on date,
  seen_on date,
  interacted_on date,
  friended_on date,
  PRIMARY KEY (staff_id, key_hash)
);

CREATE TABLE private.aka_agent_data_report_phone_links (
  staff_id bigint NOT NULL,
  phone_hash bigint NOT NULL,
  person_hash bigint NOT NULL,
  PRIMARY KEY (staff_id, phone_hash)
);

-- Customer key of each contact row (phone contacts keep the phone hash; read through phone_links).
CREATE TABLE private.aka_agent_data_report_contact_keys (
  contact_id bigint PRIMARY KEY,
  staff_id bigint NOT NULL,
  key_hash bigint NOT NULL,
  kind smallint NOT NULL
);
CREATE INDEX idx_aka_agent_data_report_contact_keys_staff_key
  ON private.aka_agent_data_report_contact_keys (staff_id, key_hash);

-- Additive counters per (staff, Vietnam day, account); engagement columns are recomputed, not added.
CREATE TABLE private.aka_agent_data_report_daily (
  staff_id bigint NOT NULL,
  day date NOT NULL,
  account_id bigint NOT NULL,
  care_actions integer NOT NULL DEFAULT 0,
  messages integer NOT NULL DEFAULT 0,
  invites integer NOT NULL DEFAULT 0,
  sms integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  lookups integer NOT NULL DEFAULT 0,
  group_messages integer NOT NULL DEFAULT 0,
  seen integer NOT NULL DEFAULT 0,
  interacted integer NOT NULL DEFAULT 0,
  friended integer NOT NULL DEFAULT 0,
  PRIMARY KEY (staff_id, day, account_id)
);

CREATE TABLE private.aka_agent_data_report_group_daily (
  staff_id bigint NOT NULL,
  day date NOT NULL,
  group_hash bigint NOT NULL,
  messages integer NOT NULL DEFAULT 0,
  PRIMARY KEY (staff_id, day, group_hash)
);

CREATE TABLE private.aka_agent_data_report_groups (
  staff_id bigint NOT NULL,
  group_hash bigint NOT NULL,
  name text,
  PRIMARY KEY (staff_id, group_hash)
);

CREATE TABLE private.aka_agent_data_report_snapshots (
  staff_id bigint PRIMARY KEY,
  organization_id bigint NOT NULL,
  report_date date NOT NULL,
  built_at timestamptz NOT NULL,
  build_ms integer NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE private.aka_agent_data_report_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  result jsonb
);

-- Working rows of one sweep batch (single writer under the run's advisory lock).
CREATE UNLOGGED TABLE private.aka_agent_data_report_stage (
  staff_id bigint NOT NULL,
  organization_id bigint,
  account_id bigint,
  day date NOT NULL,
  campaign_id bigint,
  row_id bigint NOT NULL,
  -- 0 store only, 1 message, 2 friend invite, 3 SMS, 4 call, 5 phone lookup, 6 Zalo group message
  action_class smallint NOT NULL,
  phone_hash bigint,
  person_hash bigint,
  key_hash bigint,
  kind smallint,
  source smallint,
  touch bigint,
  group_hash bigint,
  group_name text
);

REVOKE ALL ON TABLE
  private.aka_agent_data_report_state, private.aka_agent_data_report_staff, private.aka_agent_data_report_customers,
  private.aka_agent_data_report_phone_links, private.aka_agent_data_report_contact_keys, private.aka_agent_data_report_daily,
  private.aka_agent_data_report_group_daily, private.aka_agent_data_report_groups, private.aka_agent_data_report_snapshots,
  private.aka_agent_data_report_runs, private.aka_agent_data_report_stage
  FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON SEQUENCE private.aka_agent_data_report_runs_id_seq FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;

-- ---------------------------------------------------------------------------------------------------------
-- Keys
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_data_report_person_hash(p_global_id text, p_account_id bigint, p_uid text)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT CASE
    WHEN nullif(pg_catalog.btrim(p_global_id), '') IS NOT NULL
      THEN pg_catalog.hashtextextended('g:' || pg_catalog.btrim(p_global_id), 0)
    WHEN nullif(pg_catalog.btrim(p_uid), '') IS NOT NULL
      THEN pg_catalog.hashtextextended('u:' || coalesce(p_account_id, 0)::text || ':' || pg_catalog.lower(pg_catalog.btrim(p_uid)), 0)
  END
$fn$;

CREATE FUNCTION private.aka_agent_data_report_phone_hash(p_normalized_phone text)
RETURNS bigint LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $fn$
  SELECT CASE WHEN p_normalized_phone <> '' THEN pg_catalog.hashtextextended('p:' || p_normalized_phone, 0) END
$fn$;

-- Links phones that the current stage batch resolved to a person, merges ledger rows kept under those phones
-- into the person and re-keys stage rows that only knew the phone. Returns merged ledger rows.
CREATE FUNCTION private.aka_agent_data_report_merge_links()
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE v_merged integer;
BEGIN
  WITH found AS (
    SELECT DISTINCT ON (s.staff_id, s.phone_hash) s.staff_id, s.phone_hash, s.person_hash
    FROM private.aka_agent_data_report_stage s
    WHERE s.phone_hash IS NOT NULL AND s.person_hash IS NOT NULL
    ORDER BY s.staff_id, s.phone_hash, s.row_id
  ), inserted AS (
    INSERT INTO private.aka_agent_data_report_phone_links (staff_id, phone_hash, person_hash)
    SELECT staff_id, phone_hash, person_hash FROM found
    ON CONFLICT (staff_id, phone_hash) DO NOTHING
    RETURNING staff_id, phone_hash, person_hash
  ), moved AS (
    DELETE FROM private.aka_agent_data_report_customers c
    USING inserted i
    WHERE c.staff_id = i.staff_id AND c.key_hash = i.phone_hash
    RETURNING c.staff_id, i.person_hash, c.source, c.first_seen_on, c.first_cared_on, c.last_cared_on, c.care_count,
      c.verified_on, c.seen_on, c.interacted_on, c.friended_on
  ), grouped AS (
    SELECT staff_id, person_hash, (array_agg(source ORDER BY first_seen_on))[1] AS source, min(first_seen_on) AS first_seen_on,
      min(first_cared_on) AS first_cared_on, max(last_cared_on) AS last_cared_on, sum(care_count)::integer AS care_count,
      min(verified_on) AS verified_on, min(seen_on) AS seen_on, min(interacted_on) AS interacted_on, min(friended_on) AS friended_on
    FROM moved GROUP BY staff_id, person_hash
  )
  INSERT INTO private.aka_agent_data_report_customers AS c
    (staff_id, key_hash, kind, source, first_seen_on, first_cared_on, last_cared_on, care_count, verified_on, seen_on,
     interacted_on, friended_on)
  SELECT staff_id, person_hash, 1, source, first_seen_on, first_cared_on, last_cared_on, care_count, verified_on, seen_on,
    interacted_on, friended_on
  FROM grouped
  ON CONFLICT (staff_id, key_hash) DO UPDATE SET
    kind = 1,
    source = CASE WHEN excluded.first_seen_on < c.first_seen_on THEN excluded.source ELSE c.source END,
    first_seen_on = least(c.first_seen_on, excluded.first_seen_on),
    first_cared_on = least(c.first_cared_on, excluded.first_cared_on),
    last_cared_on = greatest(c.last_cared_on, excluded.last_cared_on),
    care_count = c.care_count + excluded.care_count,
    verified_on = least(c.verified_on, excluded.verified_on),
    seen_on = least(c.seen_on, excluded.seen_on),
    interacted_on = least(c.interacted_on, excluded.interacted_on),
    friended_on = least(c.friended_on, excluded.friended_on);
  GET DIAGNOSTICS v_merged = ROW_COUNT;

  UPDATE private.aka_agent_data_report_stage s
  SET key_hash = l.person_hash, kind = 1
  FROM private.aka_agent_data_report_phone_links l
  WHERE s.person_hash IS NULL AND s.phone_hash IS NOT NULL
    AND l.staff_id = s.staff_id AND l.phone_hash = s.phone_hash
    AND s.key_hash IS DISTINCT FROM l.person_hash;
  RETURN v_merged;
END
$fn$;

-- Adds stage rows to the ledger as "known" customers (first_seen_on) and registers their staff.
CREATE FUNCTION private.aka_agent_data_report_store_known()
RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
BEGIN
  INSERT INTO private.aka_agent_data_report_customers AS c (staff_id, key_hash, kind, source, first_seen_on)
  SELECT staff_id, key_hash, min(kind)::smallint, (array_agg(source ORDER BY day, row_id))[1], min(day)
  FROM private.aka_agent_data_report_stage
  WHERE key_hash IS NOT NULL
  GROUP BY staff_id, key_hash
  ON CONFLICT (staff_id, key_hash) DO UPDATE SET
    kind = least(c.kind, excluded.kind),
    source = CASE WHEN excluded.first_seen_on < c.first_seen_on THEN excluded.source ELSE c.source END,
    first_seen_on = least(c.first_seen_on, excluded.first_seen_on);

  INSERT INTO private.aka_agent_data_report_staff (staff_id, organization_id)
  SELECT DISTINCT ON (staff_id) staff_id, organization_id
  FROM private.aka_agent_data_report_stage
  ORDER BY staff_id, row_id DESC
  ON CONFLICT (staff_id) DO NOTHING;
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------
-- Sweeps (id-ordered, resumable; each returns the number of source rows read)
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_data_report_sweep_people(p_limit integer)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE v_from bigint; v_to bigint; v_n integer;
BEGIN
  SELECT watermark INTO v_from FROM private.aka_agent_data_report_state WHERE name = 'people';
  SELECT max(id), count(*) INTO v_to, v_n
  FROM (SELECT zu.id FROM public.zalo_users zu WHERE zu.id > v_from ORDER BY zu.id LIMIT p_limit) s;
  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  TRUNCATE private.aka_agent_data_report_stage;
  INSERT INTO private.aka_agent_data_report_stage
    (staff_id, organization_id, account_id, day, row_id, action_class, phone_hash, person_hash, key_hash, kind, source)
  SELECT zu.staff_id, zu.organization_id, zu.account_id,
    timezone('Asia/Ho_Chi_Minh', coalesce(zu.created_at, now()))::date, zu.id, 0,
    private.aka_agent_data_report_phone_hash(public.aka_agent_internal_normalize_phone(zu.phone_number)),
    private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid),
    private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid),
    1, CASE WHEN zu.is_fr = 1 THEN 3 ELSE 1 END
  FROM public.zalo_users zu
  WHERE zu.id > v_from AND zu.id <= v_to AND zu.staff_id IS NOT NULL
    AND private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid) IS NOT NULL;

  PERFORM private.aka_agent_data_report_merge_links();
  PERFORM private.aka_agent_data_report_store_known();
  UPDATE private.aka_agent_data_report_state
  SET watermark = v_to, rows_total = rows_total + v_n, updated_at = now() WHERE name = 'people';
  RETURN v_n;
END
$fn$;

CREATE FUNCTION private.aka_agent_data_report_sweep_contacts(p_limit integer)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE v_from bigint; v_to bigint; v_n integer;
BEGIN
  SELECT watermark INTO v_from FROM private.aka_agent_data_report_state WHERE name = 'contacts';
  SELECT max(id), count(*) INTO v_to, v_n
  FROM (SELECT ct.id FROM public.auto_account_contacts ct WHERE ct.id > v_from ORDER BY ct.id LIMIT p_limit) s;
  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  TRUNCATE private.aka_agent_data_report_stage;
  INSERT INTO private.aka_agent_data_report_stage
    (staff_id, organization_id, account_id, day, row_id, action_class, phone_hash, person_hash, key_hash, kind, source)
  SELECT ct.staff_id, ct.organization_id, ct.account_id,
    timezone('Asia/Ho_Chi_Minh', coalesce(ct.created_at, now()))::date, ct.id, 0,
    k.phone_hash, k.person_hash, coalesce(k.person_hash, l.person_hash, k.phone_hash),
    CASE WHEN coalesce(k.person_hash, l.person_hash) IS NOT NULL THEN 1 ELSE 2 END,
    CASE WHEN k.phone_hash IS NOT NULL THEN 2 WHEN ct.is_friend THEN 3 ELSE 1 END
  FROM public.auto_account_contacts ct
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN ct.contact_type = 'phone' AND coalesce(ct.flatform_type, 'zalo') IN ('zalo', 'sms', 'mixed')
        THEN private.aka_agent_data_report_phone_hash(public.aka_agent_internal_normalize_phone(ct.phone)) END AS phone_hash,
      CASE WHEN ct.contact_type = 'person' AND ct.flatform_type = 'zalo' THEN coalesce(
        (SELECT private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid)
         FROM public.zalo_users zu WHERE zu.id = ct.zalo_user_id),
        private.aka_agent_data_report_person_hash(NULL, ct.account_id, ct.uid)) END AS person_hash
    OFFSET 0 -- evaluated once per row (the WHERE clause also reads k)
  ) k
  LEFT JOIN private.aka_agent_data_report_phone_links l ON l.staff_id = ct.staff_id AND l.phone_hash = k.phone_hash
  WHERE ct.id > v_from AND ct.id <= v_to AND ct.staff_id IS NOT NULL
    AND (k.phone_hash IS NOT NULL OR k.person_hash IS NOT NULL);

  INSERT INTO private.aka_agent_data_report_contact_keys AS t (contact_id, staff_id, key_hash, kind)
  SELECT row_id, staff_id, coalesce(person_hash, phone_hash), CASE WHEN person_hash IS NOT NULL THEN 1 ELSE 2 END
  FROM private.aka_agent_data_report_stage
  ON CONFLICT (contact_id) DO UPDATE SET staff_id = excluded.staff_id, key_hash = excluded.key_hash, kind = excluded.kind;

  PERFORM private.aka_agent_data_report_store_known();
  UPDATE private.aka_agent_data_report_state
  SET watermark = v_to, rows_total = rows_total + v_n, updated_at = now() WHERE name = 'contacts';
  RETURN v_n;
END
$fn$;

CREATE FUNCTION private.aka_agent_data_report_sweep_inputs(p_limit integer)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE v_from bigint; v_to bigint; v_n integer;
BEGIN
  SELECT watermark INTO v_from FROM private.aka_agent_data_report_state WHERE name = 'inputs';
  SELECT max(id), count(*) INTO v_to, v_n
  FROM (SELECT i.id FROM public.auto_campaign_input_data i WHERE i.id > v_from ORDER BY i.id LIMIT p_limit) s;
  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  TRUNCATE private.aka_agent_data_report_stage;
  INSERT INTO private.aka_agent_data_report_stage
    (staff_id, organization_id, account_id, day, campaign_id, row_id, action_class, phone_hash, person_hash, key_hash, kind, source)
  SELECT c.staff_id, c.organization_id, c.account_id,
    timezone('Asia/Ho_Chi_Minh', coalesce(i.created_at, c.created_at, now()))::date, i.campaign_id, i.id, 0,
    k.phone_hash, k.person_hash, coalesce(k.person_hash, l.person_hash, k.phone_hash),
    CASE WHEN coalesce(k.person_hash, l.person_hash) IS NOT NULL THEN 1 ELSE 2 END,
    CASE WHEN k.phone_hash IS NOT NULL THEN 2
      WHEN c.action_id IN ('zalo_message_friend', 'zalo_message_birthday') THEN 3 ELSE 1 END
  FROM public.auto_campaign_input_data i
  JOIN public.auto_campaigns c ON c.id = i.campaign_id
  CROSS JOIN LATERAL (
    SELECT private.aka_agent_data_report_phone_hash(public.aka_agent_internal_normalize_phone(i.phone)) AS phone_hash,
      CASE WHEN nullif(btrim(i.uid), '') IS NOT NULL AND c.action_id NOT IN ('sms_send', 'voice_call') THEN coalesce(
        (SELECT private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid)
         FROM public.zalo_users zu WHERE zu.account_id = c.account_id AND zu.zalo_uid = btrim(i.uid) LIMIT 1),
        private.aka_agent_data_report_person_hash(NULL, c.account_id, i.uid)) END AS person_hash
    OFFSET 0 -- evaluated once per row (the WHERE clause also reads k)
  ) k
  LEFT JOIN private.aka_agent_data_report_phone_links l ON l.staff_id = c.staff_id AND l.phone_hash = k.phone_hash
  WHERE i.id > v_from AND i.id <= v_to AND coalesce(i.is_delete, false) = false AND c.staff_id IS NOT NULL
    AND c.action_id IN ('zalo_message_phone', 'zalo_message_friend', 'zalo_message_birthday', 'zalo_message_friend_recommendation',
      'zalo_message_group_member', 'zalo_message_group_realtime', 'zalo_message_remarketing_customer', 'zalo_add_group_member',
      'sms_send', 'voice_call')
    AND (k.phone_hash IS NOT NULL OR k.person_hash IS NOT NULL);

  PERFORM private.aka_agent_data_report_merge_links();
  PERFORM private.aka_agent_data_report_store_known();
  UPDATE private.aka_agent_data_report_state
  SET watermark = v_to, rows_total = rows_total + v_n, updated_at = now() WHERE name = 'inputs';
  RETURN v_n;
END
$fn$;

CREATE FUNCTION private.aka_agent_data_report_sweep_details(p_limit integer)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE v_from bigint; v_to bigint; v_n integer;
BEGIN
  SELECT watermark INTO v_from FROM private.aka_agent_data_report_state WHERE name = 'details';
  SELECT max(id), count(*) INTO v_to, v_n
  FROM (SELECT d.id FROM public.auto_campaign_details d WHERE d.id > v_from ORDER BY d.id LIMIT p_limit) s;
  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  TRUNCATE private.aka_agent_data_report_stage;
  INSERT INTO private.aka_agent_data_report_stage
    (staff_id, organization_id, account_id, day, campaign_id, row_id, action_class, phone_hash, person_hash, key_hash, kind, source,
     touch, group_hash, group_name)
  SELECT c.staff_id, c.organization_id, d.account_id, x.day, d.campaign_id, d.id, x.action_class,
    k.phone_hash, k.person_hash, coalesce(k.person_hash, l.person_hash, k.phone_hash),
    CASE WHEN coalesce(k.person_hash, l.person_hash) IS NOT NULL THEN 1 WHEN k.phone_hash IS NOT NULL THEN 2 END,
    CASE WHEN k.phone_hash IS NOT NULL THEN 2 WHEN d.action_code = 'zalo_message_friend' THEN 3 ELSE 1 END,
    hashtextextended(d.campaign_id::text || ':' || x.day::text, 0),
    CASE WHEN x.action_class = 6 AND nullif(btrim(i.uid), '') IS NOT NULL
      THEN hashtextextended('zg:' || lower(btrim(i.uid)), 0) END,
    CASE WHEN x.action_class = 6 THEN left(nullif(btrim(i.name), ''), 200) END
  FROM public.auto_campaign_details d
  JOIN public.auto_campaigns c ON c.id = d.campaign_id
  LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
  CROSS JOIN LATERAL (
    SELECT timezone('Asia/Ho_Chi_Minh', d.created_at)::date AS day,
      (CASE d.action_code
        WHEN 'zalo_message_stranger' THEN 1 WHEN 'zalo_message_friend' THEN 1 WHEN 'zalo_add_friend' THEN 2
        WHEN 'sms_send' THEN 3 WHEN 'voice_call' THEN 4 WHEN 'zalo_find_phone_user' THEN 5 WHEN 'zalo_message_group' THEN 6
      END)::smallint AS action_class
  ) x
  CROSS JOIN LATERAL (
    SELECT CASE WHEN x.action_class <> 6
        THEN private.aka_agent_data_report_phone_hash(public.aka_agent_internal_normalize_phone(i.phone)) END AS phone_hash,
      CASE WHEN x.action_class NOT IN (3, 4, 6) AND nullif(btrim(i.uid), '') IS NOT NULL THEN coalesce(
        (SELECT private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid)
         FROM public.zalo_users zu WHERE zu.account_id = d.account_id AND zu.zalo_uid = btrim(i.uid) LIMIT 1),
        private.aka_agent_data_report_person_hash(NULL, d.account_id, i.uid)) END AS person_hash
  ) k
  LEFT JOIN private.aka_agent_data_report_phone_links l ON l.staff_id = c.staff_id AND l.phone_hash = k.phone_hash
  WHERE d.id > v_from AND d.id <= v_to AND d.is_delete = false AND c.staff_id IS NOT NULL
    AND d.action_code IN ('zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'sms_send', 'voice_call',
      'zalo_find_phone_user', 'zalo_message_group')
    AND (d.report_group = 'success'
      OR (d.report_group IS NULL AND d.status IN ('thành công', 'đã xem', 'đã click', 'đã gửi', 'đã nhận')));

  PERFORM private.aka_agent_data_report_merge_links();

  -- Ledger: care (classes 1-4) and Zalo lookups (5). A care touch is one (campaign, Vietnam day);
  -- the touch already counted at the end of the previous batch is not counted twice.
  WITH agg AS (
    SELECT staff_id, key_hash, min(kind)::smallint AS kind, (array_agg(source ORDER BY row_id))[1] AS source,
      min(day) AS first_day,
      min(day) FILTER (WHERE action_class BETWEEN 1 AND 4) AS first_care,
      max(day) FILTER (WHERE action_class BETWEEN 1 AND 4) AS last_care,
      count(DISTINCT touch) FILTER (WHERE action_class BETWEEN 1 AND 4)::integer AS touches,
      (array_agg(touch ORDER BY row_id) FILTER (WHERE action_class BETWEEN 1 AND 4))[1] AS first_touch,
      (array_agg(touch ORDER BY row_id DESC) FILTER (WHERE action_class BETWEEN 1 AND 4))[1] AS last_touch,
      min(day) FILTER (WHERE action_class = 5) AS verified
    FROM private.aka_agent_data_report_stage
    WHERE key_hash IS NOT NULL AND action_class BETWEEN 1 AND 5
    GROUP BY staff_id, key_hash
  ), upd AS (
    UPDATE private.aka_agent_data_report_customers c SET
      kind = least(c.kind, a.kind),
      source = CASE WHEN a.first_day < c.first_seen_on THEN a.source ELSE c.source END,
      first_seen_on = least(c.first_seen_on, a.first_day),
      first_cared_on = least(c.first_cared_on, a.first_care),
      last_cared_on = greatest(c.last_cared_on, a.last_care),
      care_count = c.care_count + a.touches
        - CASE WHEN a.touches > 0 AND c.last_touch IS NOT DISTINCT FROM a.first_touch THEN 1 ELSE 0 END,
      last_touch = coalesce(a.last_touch, c.last_touch),
      verified_on = least(c.verified_on, a.verified)
    FROM agg a
    WHERE c.staff_id = a.staff_id AND c.key_hash = a.key_hash
    RETURNING c.staff_id, c.key_hash
  )
  INSERT INTO private.aka_agent_data_report_customers
    (staff_id, key_hash, kind, source, first_seen_on, first_cared_on, last_cared_on, care_count, last_touch, verified_on)
  SELECT a.staff_id, a.key_hash, a.kind, a.source, a.first_day, a.first_care, a.last_care, a.touches, a.last_touch, a.verified
  FROM agg a
  WHERE NOT EXISTS (SELECT 1 FROM upd u WHERE u.staff_id = a.staff_id AND u.key_hash = a.key_hash);

  INSERT INTO private.aka_agent_data_report_daily AS t
    (staff_id, day, account_id, care_actions, messages, invites, sms, calls, lookups, group_messages)
  SELECT staff_id, day, coalesce(account_id, 0),
    count(*) FILTER (WHERE action_class BETWEEN 1 AND 4), count(*) FILTER (WHERE action_class = 1),
    count(*) FILTER (WHERE action_class = 2), count(*) FILTER (WHERE action_class = 3),
    count(*) FILTER (WHERE action_class = 4), count(*) FILTER (WHERE action_class = 5),
    count(*) FILTER (WHERE action_class = 6)
  FROM private.aka_agent_data_report_stage
  GROUP BY staff_id, day, coalesce(account_id, 0)
  ON CONFLICT (staff_id, day, account_id) DO UPDATE SET
    care_actions = t.care_actions + excluded.care_actions, messages = t.messages + excluded.messages,
    invites = t.invites + excluded.invites, sms = t.sms + excluded.sms, calls = t.calls + excluded.calls,
    lookups = t.lookups + excluded.lookups, group_messages = t.group_messages + excluded.group_messages;

  INSERT INTO private.aka_agent_data_report_group_daily AS t (staff_id, day, group_hash, messages)
  SELECT staff_id, day, group_hash, count(*)
  FROM private.aka_agent_data_report_stage
  WHERE action_class = 6 AND group_hash IS NOT NULL
  GROUP BY staff_id, day, group_hash
  ON CONFLICT (staff_id, day, group_hash) DO UPDATE SET messages = t.messages + excluded.messages;

  INSERT INTO private.aka_agent_data_report_groups AS g (staff_id, group_hash, name)
  SELECT DISTINCT ON (staff_id, group_hash) staff_id, group_hash, group_name
  FROM private.aka_agent_data_report_stage
  WHERE action_class = 6 AND group_hash IS NOT NULL AND group_name IS NOT NULL
  ORDER BY staff_id, group_hash, row_id DESC
  ON CONFLICT (staff_id, group_hash) DO UPDATE SET name = excluded.name;

  INSERT INTO private.aka_agent_data_report_staff (staff_id, organization_id)
  SELECT DISTINCT ON (staff_id) staff_id, organization_id
  FROM private.aka_agent_data_report_stage
  ORDER BY staff_id, row_id DESC
  ON CONFLICT (staff_id) DO NOTHING;

  UPDATE private.aka_agent_data_report_state
  SET watermark = v_to, rows_total = rows_total + v_n, updated_at = now() WHERE name = 'details';
  RETURN v_n;
END
$fn$;

-- Engagement marks (best effort, written by the runtimes). Recomputes the daily marks of affected
-- (staff, day, account) groups and moves the first mark dates into the ledger. Only rows updated before
-- p_until are read; the caller passes its own start time after the details sweep has caught up.
CREATE FUNCTION private.aka_agent_data_report_sweep_engagement(p_until timestamptz)
RETURNS integer LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE v_from timestamptz; v_to timestamptz; v_n integer;
BEGIN
  SELECT watermark_at INTO v_from FROM private.aka_agent_data_report_state WHERE name = 'engagement';
  SELECT max(e.updated_at), count(*) INTO v_to, v_n
  FROM public.auto_campaign_detail_zalo_engagement e
  WHERE e.updated_at > coalesce(v_from, '-infinity'::timestamptz) AND e.updated_at <= p_until;
  IF coalesce(v_n, 0) = 0 THEN RETURN 0; END IF;

  WITH changed AS MATERIALIZED (
    SELECT e.campaign_detail_id, e.seen_at, e.responded_at, e.reacted_at, e.friended_at
    FROM public.auto_campaign_detail_zalo_engagement e
    WHERE e.updated_at > coalesce(v_from, '-infinity'::timestamptz) AND e.updated_at <= v_to
  ), keyed AS (
    SELECT c.staff_id,
      coalesce(k.person_hash, l.person_hash, k.phone_hash) AS key_hash,
      timezone('Asia/Ho_Chi_Minh', least(r.seen_at, r.reacted_at, r.responded_at))::date AS seen_day,
      timezone('Asia/Ho_Chi_Minh', least(r.reacted_at, r.responded_at))::date AS interacted_day,
      timezone('Asia/Ho_Chi_Minh', r.friended_at)::date AS friended_day
    FROM changed r
    JOIN public.auto_campaign_details d ON d.id = r.campaign_detail_id
    JOIN public.auto_campaigns c ON c.id = d.campaign_id
    LEFT JOIN public.auto_campaign_input_data i ON i.id = d.input_data_id
    CROSS JOIN LATERAL (
      SELECT private.aka_agent_data_report_phone_hash(public.aka_agent_internal_normalize_phone(i.phone)) AS phone_hash,
        CASE WHEN nullif(btrim(i.uid), '') IS NOT NULL THEN coalesce(
          (SELECT private.aka_agent_data_report_person_hash(zu.global_id, zu.account_id, zu.zalo_uid)
           FROM public.zalo_users zu WHERE zu.account_id = d.account_id AND zu.zalo_uid = btrim(i.uid) LIMIT 1),
          private.aka_agent_data_report_person_hash(NULL, d.account_id, i.uid)) END AS person_hash
    ) k
    LEFT JOIN private.aka_agent_data_report_phone_links l ON l.staff_id = c.staff_id AND l.phone_hash = k.phone_hash
    WHERE c.staff_id IS NOT NULL
  )
  UPDATE private.aka_agent_data_report_customers c SET
    seen_on = least(c.seen_on, m.seen_day),
    interacted_on = least(c.interacted_on, m.interacted_day),
    friended_on = least(c.friended_on, m.friended_day)
  FROM (
    SELECT staff_id, key_hash, min(seen_day) AS seen_day, min(interacted_day) AS interacted_day, min(friended_day) AS friended_day
    FROM keyed WHERE key_hash IS NOT NULL GROUP BY staff_id, key_hash
  ) m
  WHERE c.staff_id = m.staff_id AND c.key_hash = m.key_hash;

  WITH affected AS (
    SELECT DISTINCT c.staff_id, timezone('Asia/Ho_Chi_Minh', d.created_at)::date AS day, d.account_id
    FROM public.auto_campaign_detail_zalo_engagement e
    JOIN public.auto_campaign_details d ON d.id = e.campaign_detail_id
    JOIN public.auto_campaigns c ON c.id = d.campaign_id
    WHERE e.updated_at > coalesce(v_from, '-infinity'::timestamptz) AND e.updated_at <= v_to AND c.staff_id IS NOT NULL
  ), counts AS (
    SELECT a.staff_id, a.day, a.account_id,
      count(e.campaign_detail_id) FILTER (WHERE e.seen_at IS NOT NULL OR e.reacted_at IS NOT NULL OR e.responded_at IS NOT NULL) AS seen,
      count(e.campaign_detail_id) FILTER (WHERE e.reacted_at IS NOT NULL OR e.responded_at IS NOT NULL) AS interacted,
      count(e.campaign_detail_id) FILTER (WHERE e.friended_at IS NOT NULL) AS friended
    FROM affected a
    JOIN public.auto_campaign_details d ON d.account_id = a.account_id AND d.is_delete = false AND d.action_code IS NOT NULL
      AND d.action_code IN ('zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend')
      AND d.created_at >= (a.day::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND d.created_at < ((a.day + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    JOIN public.auto_campaigns c ON c.id = d.campaign_id AND c.staff_id = a.staff_id
    JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id
    GROUP BY a.staff_id, a.day, a.account_id
  )
  UPDATE private.aka_agent_data_report_daily t
  SET seen = x.seen, interacted = x.interacted, friended = x.friended
  FROM counts x
  WHERE t.staff_id = x.staff_id AND t.day = x.day AND t.account_id = x.account_id;

  UPDATE private.aka_agent_data_report_state
  SET watermark_at = v_to, rows_total = rows_total + v_n, updated_at = now() WHERE name = 'engagement';
  RETURN v_n;
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------
-- Snapshot of one staff for one report date (data through the end of that Vietnam day).
-- Raw positive counts only; the shared contract decides what is shown.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_data_report_build(p_staff_id bigint, p_report_date date)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_org bigint;
  v_rd date := p_report_date;
  v_end timestamptz := ((p_report_date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
  v_week0 date := p_report_date - (extract(isodow FROM p_report_date)::integer - 1) - 84;
  v_zalo_accounts bigint[];
  v_base jsonb; v_periods jsonb := '{}'::jsonb; v_weekly jsonb; v_milestones jsonb; v_activity jsonb;
  v_accounts jsonb; v_data_groups jsonb; v_group_stats jsonb; v_scans jsonb; v_uploads jsonb; v_cadence jsonb;
  v_cooldown bigint; v_first_campaign timestamptz; v_first_group timestamptz; v_friends jsonb; v_groups_joined jsonb;
  v_label text; v_start date; v_top_groups bigint[]; v_top_scans bigint[]; v_top_uploads bigint[];
BEGIN
  SELECT organization_id INTO v_org FROM public.org_staff WHERE id = p_staff_id;
  SELECT coalesce(array_agg(a.id ORDER BY a.id), '{}') INTO v_zalo_accounts
  FROM public.auto_accounts a
  WHERE a.staff_id = p_staff_id AND a.organization_id = v_org AND coalesce(a.is_delete, false) = false AND a.flatform_type = 'zalo';

  -- Store totals (ledger, all time up to the report date).
  SELECT jsonb_build_object(
    'store', count(*),
    'bySource', jsonb_build_object('member', count(*) FILTER (WHERE source = 1), 'phone', count(*) FILTER (WHERE source = 2),
      'friend', count(*) FILTER (WHERE source = 3)),
    'zaloPeople', count(*) FILTER (WHERE kind = 1),
    'phoneOnly', count(*) FILTER (WHERE kind = 2),
    'verified', count(*) FILTER (WHERE verified_on <= v_rd),
    'caredEver', count(*) FILTER (WHERE first_cared_on <= v_rd),
    'seenEver', count(*) FILTER (WHERE seen_on <= v_rd),
    'interactedEver', count(*) FILTER (WHERE interacted_on <= v_rd),
    'friendedEver', count(*) FILTER (WHERE friended_on <= v_rd),
    'firstSeenOn', min(first_seen_on),
    'firstCaredOn', min(first_cared_on) FILTER (WHERE first_cared_on <= v_rd))
  INTO v_base
  FROM private.aka_agent_data_report_customers
  WHERE staff_id = p_staff_id AND first_seen_on <= v_rd;

  FOR v_label, v_start IN SELECT * FROM (VALUES ('7', v_rd - 6), ('30', v_rd - 29), ('90', v_rd - 89)) p(label, start) LOOP
    v_periods := v_periods || jsonb_build_object(v_label, (
      SELECT jsonb_build_object(
        'storeGrowth', count(*) FILTER (WHERE first_seen_on >= v_start),
        'verifiedGrowth', count(*) FILTER (WHERE verified_on BETWEEN v_start AND v_rd),
        'cared', count(*) FILTER (WHERE last_cared_on >= v_start AND first_cared_on <= v_rd),
        'firstCared', count(*) FILTER (WHERE first_cared_on BETWEEN v_start AND v_rd),
        'careHistogram', jsonb_build_array(
          count(*) FILTER (WHERE last_cared_on >= v_start AND first_cared_on <= v_rd AND care_count <= 1),
          count(*) FILTER (WHERE last_cared_on >= v_start AND first_cared_on <= v_rd AND care_count = 2),
          count(*) FILTER (WHERE last_cared_on >= v_start AND first_cared_on <= v_rd AND care_count BETWEEN 3 AND 5),
          count(*) FILTER (WHERE last_cared_on >= v_start AND first_cared_on <= v_rd AND care_count >= 6)),
        'medianGapDays', round((percentile_cont(0.5) WITHIN GROUP (
            ORDER BY (last_cared_on - first_cared_on)::numeric / (care_count - 1))
          FILTER (WHERE care_count >= 2 AND last_cared_on >= v_start AND first_cared_on <= v_rd))::numeric, 1),
        'seen', count(*) FILTER (WHERE seen_on BETWEEN v_start AND v_rd),
        'interacted', count(*) FILTER (WHERE interacted_on BETWEEN v_start AND v_rd),
        'friended', count(*) FILTER (WHERE friended_on BETWEEN v_start AND v_rd),
        'caredBySource', jsonb_build_object(
          'member', count(*) FILTER (WHERE source = 1 AND last_cared_on >= v_start AND first_cared_on <= v_rd),
          'phone', count(*) FILTER (WHERE source = 2 AND last_cared_on >= v_start AND first_cared_on <= v_rd),
          'friend', count(*) FILTER (WHERE source = 3 AND last_cared_on >= v_start AND first_cared_on <= v_rd)),
        'interactedBySource', jsonb_build_object(
          'member', count(*) FILTER (WHERE source = 1 AND interacted_on BETWEEN v_start AND v_rd),
          'phone', count(*) FILTER (WHERE source = 2 AND interacted_on BETWEEN v_start AND v_rd),
          'friend', count(*) FILTER (WHERE source = 3 AND interacted_on BETWEEN v_start AND v_rd)))
      FROM private.aka_agent_data_report_customers
      WHERE staff_id = p_staff_id AND first_seen_on <= v_rd));
  END LOOP;

  -- Store growth by week (13 Mondays, cumulative, by first source).
  WITH b AS (
    SELECT greatest(date_trunc('week', first_seen_on)::date, v_week0) AS wk, source, count(*) AS n
    FROM private.aka_agent_data_report_customers
    WHERE staff_id = p_staff_id AND first_seen_on <= v_rd
    GROUP BY 1, 2
  )
  SELECT jsonb_agg(jsonb_build_object('week', w.wk,
      'member', (SELECT coalesce(sum(n), 0) FROM b WHERE b.wk <= w.wk AND b.source = 1),
      'phone', (SELECT coalesce(sum(n), 0) FROM b WHERE b.wk <= w.wk AND b.source = 2),
      'friend', (SELECT coalesce(sum(n), 0) FROM b WHERE b.wk <= w.wk AND b.source = 3)) ORDER BY w.wk)
  INTO v_weekly
  FROM (SELECT (v_week0 + 7 * g)::date AS wk FROM generate_series(0, 12) g) w;

  -- Store milestones: the day the store first reached each size.
  WITH d AS (
    SELECT first_seen_on AS day, count(*) AS n FROM private.aka_agent_data_report_customers
    WHERE staff_id = p_staff_id AND first_seen_on <= v_rd GROUP BY 1
  ), c AS (SELECT day, sum(n) OVER (ORDER BY day) AS cum FROM d)
  SELECT jsonb_agg(jsonb_build_object('value', t, 'reachedOn', (SELECT min(c.day) FROM c WHERE c.cum >= t)) ORDER BY t)
  INTO v_milestones
  FROM unnest(ARRAY[1000, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]::bigint[]) t;

  -- Activity counters (all time and per period) from the daily table.
  SELECT jsonb_build_object(
    'allTime', jsonb_build_object('careActions', coalesce(sum(care_actions), 0), 'messages', coalesce(sum(messages), 0),
      'invites', coalesce(sum(invites), 0), 'sms', coalesce(sum(sms), 0), 'calls', coalesce(sum(calls), 0),
      'lookups', coalesce(sum(lookups), 0), 'groupMessages', coalesce(sum(group_messages), 0), 'firstDay', min(day)),
    '7', jsonb_build_object('careActions', coalesce(sum(care_actions) FILTER (WHERE day >= v_rd - 6), 0),
      'messages', coalesce(sum(messages) FILTER (WHERE day >= v_rd - 6), 0), 'invites', coalesce(sum(invites) FILTER (WHERE day >= v_rd - 6), 0),
      'lookups', coalesce(sum(lookups) FILTER (WHERE day >= v_rd - 6), 0), 'groupMessages', coalesce(sum(group_messages) FILTER (WHERE day >= v_rd - 6), 0),
      'seen', coalesce(sum(seen) FILTER (WHERE day >= v_rd - 6), 0), 'interacted', coalesce(sum(interacted) FILTER (WHERE day >= v_rd - 6), 0),
      'friended', coalesce(sum(friended) FILTER (WHERE day >= v_rd - 6), 0)),
    '30', jsonb_build_object('careActions', coalesce(sum(care_actions) FILTER (WHERE day >= v_rd - 29), 0),
      'messages', coalesce(sum(messages) FILTER (WHERE day >= v_rd - 29), 0), 'invites', coalesce(sum(invites) FILTER (WHERE day >= v_rd - 29), 0),
      'lookups', coalesce(sum(lookups) FILTER (WHERE day >= v_rd - 29), 0), 'groupMessages', coalesce(sum(group_messages) FILTER (WHERE day >= v_rd - 29), 0),
      'seen', coalesce(sum(seen) FILTER (WHERE day >= v_rd - 29), 0), 'interacted', coalesce(sum(interacted) FILTER (WHERE day >= v_rd - 29), 0),
      'friended', coalesce(sum(friended) FILTER (WHERE day >= v_rd - 29), 0)),
    '90', jsonb_build_object('careActions', coalesce(sum(care_actions) FILTER (WHERE day >= v_rd - 89), 0),
      'messages', coalesce(sum(messages) FILTER (WHERE day >= v_rd - 89), 0), 'invites', coalesce(sum(invites) FILTER (WHERE day >= v_rd - 89), 0),
      'lookups', coalesce(sum(lookups) FILTER (WHERE day >= v_rd - 89), 0), 'groupMessages', coalesce(sum(group_messages) FILTER (WHERE day >= v_rd - 89), 0),
      'seen', coalesce(sum(seen) FILTER (WHERE day >= v_rd - 89), 0), 'interacted', coalesce(sum(interacted) FILTER (WHERE day >= v_rd - 89), 0),
      'friended', coalesce(sum(friended) FILTER (WHERE day >= v_rd - 89), 0)))
  INTO v_activity
  FROM private.aka_agent_data_report_daily
  WHERE staff_id = p_staff_id AND day <= v_rd;

  -- Friends and joined Zalo groups per account (current rows; growth by the day the row appeared).
  WITH f AS (
    SELECT zu.account_id, zu.created_at FROM public.zalo_users zu
    WHERE zu.account_id = ANY(v_zalo_accounts) AND zu.is_fr = 1 AND zu.created_at < v_end
  ), per AS (
    SELECT account_id, count(*) AS total,
      count(*) FILTER (WHERE created_at >= ((v_rd - 6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS g7,
      count(*) FILTER (WHERE created_at >= ((v_rd - 29)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS g30,
      count(*) FILTER (WHERE created_at >= ((v_rd - 89)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS g90
    FROM f GROUP BY account_id
  ), weekly AS (
    SELECT f.account_id, greatest(date_trunc('week', timezone('Asia/Ho_Chi_Minh', f.created_at))::date, v_week0) AS wk, count(*) AS n
    FROM f GROUP BY 1, 2
  )
  SELECT jsonb_object_agg(per.account_id::text, jsonb_build_object('total', per.total, 'growth',
      jsonb_build_object('7', per.g7, '30', per.g30, '90', per.g90),
      'weekly', (SELECT jsonb_agg((SELECT coalesce(sum(n), 0) FROM weekly x WHERE x.account_id = per.account_id AND x.wk <= w.wk) ORDER BY w.wk)
        FROM (SELECT (v_week0 + 7 * g)::date AS wk FROM generate_series(0, 12) g) w)))
  INTO v_friends
  FROM per;

  SELECT jsonb_object_agg(x.account_id::text, jsonb_build_object('total', x.total,
      'growth', jsonb_build_object('7', x.g7, '30', x.g30, '90', x.g90)))
  INTO v_groups_joined
  FROM (
    SELECT ct.account_id, count(*) AS total,
      count(*) FILTER (WHERE ct.created_at >= ((v_rd - 6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS g7,
      count(*) FILTER (WHERE ct.created_at >= ((v_rd - 29)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS g30,
      count(*) FILTER (WHERE ct.created_at >= ((v_rd - 89)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')) AS g90
    FROM public.auto_account_contacts ct
    WHERE ct.account_id = ANY(v_zalo_accounts) AND ct.contact_type = 'group' AND ct.flatform_type = 'zalo'
      AND ct.is_joined = true AND coalesce(ct.is_delete, false) = false AND ct.created_at < v_end
    GROUP BY ct.account_id
  ) x;

  SELECT coalesce(jsonb_agg(jsonb_build_object('accountId', a.id, 'name', a.name,
      'kind', CASE WHEN a.is_zalo_server THEN 'server' WHEN a.is_zalo_show_web THEN 'web' ELSE 'app' END,
      'friends', coalesce(v_friends->a.id::text, jsonb_build_object('total', 0, 'growth', jsonb_build_object('7', 0, '30', 0, '90', 0), 'weekly', '[]'::jsonb)),
      'groupsJoined', coalesce(v_groups_joined->a.id::text, jsonb_build_object('total', 0, 'growth', jsonb_build_object('7', 0, '30', 0, '90', 0))),
      'activity', coalesce(act.periods, '{}'::jsonb)) ORDER BY a.id), '[]'::jsonb)
  INTO v_accounts
  FROM public.auto_accounts a
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      '7', jsonb_build_object('careActions', coalesce(sum(dl.care_actions) FILTER (WHERE dl.day >= v_rd - 6), 0),
        'lookups', coalesce(sum(dl.lookups) FILTER (WHERE dl.day >= v_rd - 6), 0),
        'interacted', coalesce(sum(dl.interacted) FILTER (WHERE dl.day >= v_rd - 6), 0)),
      '30', jsonb_build_object('careActions', coalesce(sum(dl.care_actions) FILTER (WHERE dl.day >= v_rd - 29), 0),
        'lookups', coalesce(sum(dl.lookups) FILTER (WHERE dl.day >= v_rd - 29), 0),
        'interacted', coalesce(sum(dl.interacted) FILTER (WHERE dl.day >= v_rd - 29), 0)),
      '90', jsonb_build_object('careActions', coalesce(sum(dl.care_actions) FILTER (WHERE dl.day >= v_rd - 89), 0),
        'lookups', coalesce(sum(dl.lookups) FILTER (WHERE dl.day >= v_rd - 89), 0),
        'interacted', coalesce(sum(dl.interacted) FILTER (WHERE dl.day >= v_rd - 89), 0))) AS periods
    FROM private.aka_agent_data_report_daily dl
    WHERE dl.staff_id = p_staff_id AND dl.account_id = a.id AND dl.day BETWEEN v_rd - 89 AND v_rd
  ) act ON true
  WHERE a.id = ANY(v_zalo_accounts);

  -- Data groups: totals, then the eight largest with customers matched against the ledger.
  WITH g AS (
    SELECT g.id, g.name, g.created_at,
      (SELECT count(*) FROM public.auto_account_contact_group_members m WHERE m.group_id = g.id AND m.is_delete = false) AS members
    FROM public.auto_account_contact_groups g
    WHERE g.staff_id = p_staff_id AND g.organization_id = v_org AND g.purpose = 'data_group' AND g.is_delete = false
      AND g.created_at < v_end
  )
  SELECT jsonb_build_object('count', count(*), 'members', coalesce(sum(members), 0),
      'growth', jsonb_build_object(
        '7', count(*) FILTER (WHERE created_at >= ((v_rd - 6)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')),
        '30', count(*) FILTER (WHERE created_at >= ((v_rd - 29)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')),
        '90', count(*) FILTER (WHERE created_at >= ((v_rd - 89)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'))),
      'firstCreatedAt', min(created_at)),
    (SELECT array_agg(id ORDER BY members DESC, id) FROM (SELECT id, members FROM g WHERE members > 0 ORDER BY members DESC, id LIMIT 8) t)
  INTO v_data_groups, v_top_groups
  FROM g;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.group_id, 'name', gr.name, 'size', x.members, 'zalo', x.zalo,
      'caredEver', x.cared_ever,
      'cared', jsonb_build_object('7', x.c7, '30', x.c30, '90', x.c90),
      'interacted', jsonb_build_object('7', x.i7, '30', x.i30, '90', x.i90)) ORDER BY x.members DESC, x.group_id), '[]'::jsonb)
  INTO v_group_stats
  FROM (
    SELECT m.group_id, count(*) AS members,
      count(*) FILTER (WHERE c.kind = 1 OR c.verified_on IS NOT NULL OR ck.kind = 1) AS zalo,
      count(*) FILTER (WHERE c.first_cared_on <= v_rd) AS cared_ever,
      count(*) FILTER (WHERE c.last_cared_on >= v_rd - 6 AND c.first_cared_on <= v_rd) AS c7,
      count(*) FILTER (WHERE c.last_cared_on >= v_rd - 29 AND c.first_cared_on <= v_rd) AS c30,
      count(*) FILTER (WHERE c.last_cared_on >= v_rd - 89 AND c.first_cared_on <= v_rd) AS c90,
      count(*) FILTER (WHERE c.interacted_on BETWEEN v_rd - 6 AND v_rd) AS i7,
      count(*) FILTER (WHERE c.interacted_on BETWEEN v_rd - 29 AND v_rd) AS i30,
      count(*) FILTER (WHERE c.interacted_on BETWEEN v_rd - 89 AND v_rd) AS i90
    FROM public.auto_account_contact_group_members m
    LEFT JOIN private.aka_agent_data_report_contact_keys ck ON ck.contact_id = m.contact_id
    LEFT JOIN private.aka_agent_data_report_phone_links l ON ck.kind = 2 AND l.staff_id = p_staff_id AND l.phone_hash = ck.key_hash
    LEFT JOIN private.aka_agent_data_report_customers c ON c.staff_id = p_staff_id AND c.key_hash = coalesce(l.person_hash, ck.key_hash)
    WHERE m.group_id = ANY(coalesce(v_top_groups, '{}')) AND m.is_delete = false
    GROUP BY m.group_id
  ) x
  JOIN public.auto_account_contact_groups gr ON gr.id = x.group_id;

  -- Scanned Zalo group member lists and uploaded phone lists (eight largest of each).
  SELECT array_agg(id ORDER BY contact_count DESC NULLS LAST, id) INTO v_top_scans FROM (
    SELECT ds.id, ds.contact_count FROM public.auto_account_contacts_dataset ds
    WHERE ds.staff_id = p_staff_id AND ds.organization_id = v_org AND coalesce(ds.is_delete, false) = false
      AND ds.source = 'scan' AND ds.scan_type = 'zalo_group_members' AND ds.created_at < v_end
    ORDER BY ds.contact_count DESC NULLS LAST, ds.id LIMIT 8) t;
  SELECT array_agg(id ORDER BY contact_count DESC NULLS LAST, id) INTO v_top_uploads FROM (
    SELECT ds.id, ds.contact_count FROM public.auto_account_contacts_dataset ds
    WHERE ds.staff_id = p_staff_id AND ds.organization_id = v_org AND coalesce(ds.is_delete, false) = false
      AND ds.source = 'upload' AND ds.contact_type IN ('phone', 'person') AND coalesce(ds.flatform_type, '') IN ('zalo', 'mixed', 'sms')
      AND ds.created_at < v_end
    ORDER BY ds.contact_count DESC NULLS LAST, ds.id LIMIT 8) t;

  WITH x AS (
    SELECT dm.dataset_id, count(*) AS members,
      count(*) FILTER (WHERE c.kind = 1 OR c.verified_on IS NOT NULL OR ck.kind = 1) AS zalo,
      count(*) FILTER (WHERE c.first_cared_on <= v_rd) AS cared_ever,
      count(*) FILTER (WHERE c.last_cared_on >= v_rd - 6 AND c.first_cared_on <= v_rd) AS c7,
      count(*) FILTER (WHERE c.last_cared_on >= v_rd - 29 AND c.first_cared_on <= v_rd) AS c30,
      count(*) FILTER (WHERE c.last_cared_on >= v_rd - 89 AND c.first_cared_on <= v_rd) AS c90,
      count(*) FILTER (WHERE c.interacted_on BETWEEN v_rd - 6 AND v_rd) AS i7,
      count(*) FILTER (WHERE c.interacted_on BETWEEN v_rd - 29 AND v_rd) AS i30,
      count(*) FILTER (WHERE c.interacted_on BETWEEN v_rd - 89 AND v_rd) AS i90
    FROM public.auto_account_contacts_dataset_members dm
    LEFT JOIN private.aka_agent_data_report_contact_keys ck ON ck.contact_id = dm.contact_id
    LEFT JOIN private.aka_agent_data_report_phone_links l ON ck.kind = 2 AND l.staff_id = p_staff_id AND l.phone_hash = ck.key_hash
    LEFT JOIN private.aka_agent_data_report_customers c ON c.staff_id = p_staff_id AND c.key_hash = coalesce(l.person_hash, ck.key_hash)
    WHERE dm.dataset_id = ANY(coalesce(v_top_scans, '{}') || coalesce(v_top_uploads, '{}')) AND dm.is_current = true
    GROUP BY dm.dataset_id
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object('id', x.dataset_id, 'name', ds.name, 'size', x.members, 'zalo', x.zalo, 'caredEver', x.cared_ever,
      'cared', jsonb_build_object('7', x.c7, '30', x.c30, '90', x.c90),
      'interacted', jsonb_build_object('7', x.i7, '30', x.i30, '90', x.i90)) ORDER BY x.members DESC, x.dataset_id)
      FILTER (WHERE x.dataset_id = ANY(coalesce(v_top_scans, '{}'))), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', x.dataset_id, 'name', ds.name, 'size', x.members, 'zalo', x.zalo, 'caredEver', x.cared_ever,
      'cared', jsonb_build_object('7', x.c7, '30', x.c30, '90', x.c90),
      'interacted', jsonb_build_object('7', x.i7, '30', x.i30, '90', x.i90)) ORDER BY x.members DESC, x.dataset_id)
      FILTER (WHERE x.dataset_id = ANY(coalesce(v_top_uploads, '{}'))), '[]'::jsonb)
  INTO v_scans, v_uploads
  FROM x JOIN public.auto_account_contacts_dataset ds ON ds.id = x.dataset_id;

  -- Zalo group messages: groups reached and messages per period, top groups of the last 30 days.
  SELECT jsonb_build_object(
    '7', jsonb_build_object('groups', count(DISTINCT group_hash) FILTER (WHERE day >= v_rd - 6),
      'messages', coalesce(sum(messages) FILTER (WHERE day >= v_rd - 6), 0)),
    '30', jsonb_build_object('groups', count(DISTINCT group_hash) FILTER (WHERE day >= v_rd - 29),
      'messages', coalesce(sum(messages) FILTER (WHERE day >= v_rd - 29), 0)),
    '90', jsonb_build_object('groups', count(DISTINCT group_hash) FILTER (WHERE day >= v_rd - 89),
      'messages', coalesce(sum(messages) FILTER (WHERE day >= v_rd - 89), 0)),
    'top30', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', coalesce(gr.name, ''), 'messages', t.messages) ORDER BY t.messages DESC, t.group_hash), '[]'::jsonb)
      FROM (SELECT gd.group_hash, sum(gd.messages) AS messages FROM private.aka_agent_data_report_group_daily gd
            WHERE gd.staff_id = p_staff_id AND gd.day BETWEEN v_rd - 29 AND v_rd
            GROUP BY gd.group_hash ORDER BY 2 DESC, 1 LIMIT 5) t
      LEFT JOIN private.aka_agent_data_report_groups gr ON gr.staff_id = p_staff_id AND gr.group_hash = t.group_hash))
  INTO v_cadence
  FROM private.aka_agent_data_report_group_daily
  WHERE staff_id = p_staff_id AND day BETWEEN v_rd - 89 AND v_rd;

  -- Repeat sends the cooldown option paused instead of sending again (all campaigns of the staff).
  SELECT count(*) INTO v_cooldown
  FROM public.auto_campaigns c
  JOIN public.auto_campaign_input_data i ON i.campaign_id = c.id
  WHERE c.staff_id = p_staff_id AND c.organization_id = v_org
    AND i.is_delete = false AND i.status = 'tạm dừng' AND i.note LIKE 'Tạm dừng: đã gửi%trước đó ngày%';

  SELECT min(created_at) INTO v_first_campaign FROM public.auto_campaigns WHERE staff_id = p_staff_id AND organization_id = v_org;

  RETURN jsonb_build_object(
    'version', 1,
    'reportDate', v_rd,
    'store', v_base,
    'periods', v_periods,
    'weekly', coalesce(v_weekly, '[]'::jsonb),
    'milestones', coalesce(v_milestones, '[]'::jsonb),
    'activity', v_activity,
    'accounts', v_accounts,
    'dataGroups', coalesce(v_data_groups, '{}'::jsonb) || jsonb_build_object('top', v_group_stats),
    'scans', v_scans,
    'uploads', v_uploads,
    'groupMessages', v_cadence,
    'cooldownAvoided', coalesce(v_cooldown, 0),
    'firstCampaignAt', v_first_campaign);
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------
-- Nightly driver (pg_cron). Bounded by its own deadline; one run at a time.
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION private.aka_agent_data_report_run(p_budget_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_started timestamptz := clock_timestamp();
  -- Hard cap 100 s: the platform statement_timeout (120 s, platform-defaults.conf) also applies to pg_cron jobs and
  -- would cancel the whole run, losing all of its work. 90 s plus one batch stays well below it.
  v_deadline timestamptz := clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_budget_seconds, 90), 10), 100));
  v_batch constant integer := 20000;
  v_report_date date := timezone('Asia/Ho_Chi_Minh', now())::date - 1;
  v_sweep text;
  v_n integer;
  v_done boolean;
  v_caught_up boolean := true;
  v_counts jsonb := '{}'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_built integer := 0;
  v_staff record;
  v_t timestamptz;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('aka_agent_data_report_run')) THEN
    RETURN jsonb_build_object('skipped', 'busy');
  END IF;

  FOREACH v_sweep IN ARRAY ARRAY['people', 'contacts', 'inputs', 'details'] LOOP
    v_done := false;
    WHILE NOT v_done AND clock_timestamp() < v_deadline LOOP
      BEGIN
        v_n := CASE v_sweep
          WHEN 'people' THEN private.aka_agent_data_report_sweep_people(v_batch)
          WHEN 'contacts' THEN private.aka_agent_data_report_sweep_contacts(v_batch)
          WHEN 'inputs' THEN private.aka_agent_data_report_sweep_inputs(v_batch)
          ELSE private.aka_agent_data_report_sweep_details(v_batch) END;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('sweep', v_sweep, 'error', left(SQLERRM, 300)));
        v_n := -1;
      END;
      v_counts := v_counts || jsonb_build_object(v_sweep, coalesce((v_counts->>v_sweep)::bigint, 0) + greatest(v_n, 0));
      IF v_n < 0 THEN EXIT; END IF;
      v_done := v_n < v_batch;
    END LOOP;
    IF NOT v_done THEN
      v_caught_up := false;
      EXIT;
    END IF;
  END LOOP;

  IF v_caught_up THEN
    BEGIN
      v_counts := v_counts || jsonb_build_object('engagement',
        private.aka_agent_data_report_sweep_engagement(v_started - interval '5 seconds'));
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('sweep', 'engagement', 'error', left(SQLERRM, 300)));
    END;

    FOR v_staff IN
      SELECT s.staff_id, st.organization_id
      FROM private.aka_agent_data_report_staff s
      JOIN public.org_staff st ON st.id = s.staff_id AND st.is_active = true
      LEFT JOIN private.aka_agent_data_report_snapshots sn ON sn.staff_id = s.staff_id
      WHERE (sn.staff_id IS NULL OR sn.report_date < v_report_date OR sn.organization_id IS DISTINCT FROM st.organization_id)
        AND (s.failed_on IS NULL OR s.failed_on < v_report_date)
      ORDER BY s.staff_id
    LOOP
      EXIT WHEN clock_timestamp() >= v_deadline;
      v_t := clock_timestamp();
      BEGIN
        v_payload := private.aka_agent_data_report_build(v_staff.staff_id, v_report_date);
        INSERT INTO private.aka_agent_data_report_snapshots AS sn (staff_id, organization_id, report_date, built_at, build_ms, payload)
        VALUES (v_staff.staff_id, v_staff.organization_id, v_report_date, clock_timestamp(),
          (extract(epoch FROM clock_timestamp() - v_t) * 1000)::integer, v_payload)
        ON CONFLICT (staff_id) DO UPDATE SET organization_id = excluded.organization_id, report_date = excluded.report_date,
          built_at = excluded.built_at, build_ms = excluded.build_ms, payload = excluded.payload;
        v_built := v_built + 1;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object('staff', v_staff.staff_id, 'error', left(SQLERRM, 300)));
        UPDATE private.aka_agent_data_report_staff SET failed_on = v_report_date, last_error = left(SQLERRM, 300)
        WHERE staff_id = v_staff.staff_id;
      END;
    END LOOP;
  END IF;

  v_result := jsonb_build_object('reportDate', v_report_date, 'caughtUp', v_caught_up, 'rows', v_counts,
    'snapshots', v_built, 'errors', v_errors, 'ms', (extract(epoch FROM clock_timestamp() - v_started) * 1000)::integer);
  INSERT INTO private.aka_agent_data_report_runs (started_at, finished_at, result) VALUES (v_started, clock_timestamp(), v_result);
  DELETE FROM private.aka_agent_data_report_runs WHERE started_at < now() - interval '30 days';
  RETURN v_result;
END
$fn$;

-- ---------------------------------------------------------------------------------------------------------
-- Reader (WebApp backend singleton and Desktop token)
-- ---------------------------------------------------------------------------------------------------------
CREATE FUNCTION public.aka_agent_read_data_report(
  p_staff_id bigint, p_organization_id bigint, p_auth_username text, p_auth_password text, p_query jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_mode text := p_query->>'mode';
  v_phone text;
  v_phone_hash bigint;
  v_key bigint;
  v_customer jsonb;
  v_events jsonb;
  v_groups jsonb;
  v_name text;
  v_result jsonb;
BEGIN
  -- Desktop token must belong to p_staff_id and carry the automation credentials; service_role passes.
  PERFORM public.auto_assert_automation_identity(p_staff_id, p_organization_id, p_auth_username, p_auth_password);
  IF p_staff_id IS NULL OR p_organization_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_staff WHERE id = p_staff_id AND organization_id = p_organization_id AND is_active = true
  ) THEN RAISE EXCEPTION 'report_access_denied' USING ERRCODE = '42501'; END IF;
  IF p_query IS NULL OR jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR v_mode IS NULL
     OR v_mode NOT IN ('snapshot', 'journey') THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END IF;

  IF v_mode = 'snapshot' THEN
    SELECT jsonb_build_object('reportDate', s.report_date, 'builtAt', s.built_at, 'payload', s.payload) INTO v_result
    FROM private.aka_agent_data_report_snapshots s
    WHERE s.staff_id = p_staff_id AND s.organization_id = p_organization_id;
    RETURN coalesce(v_result, jsonb_build_object('reportDate', NULL, 'builtAt', NULL, 'payload', NULL));
  END IF;

  -- journey: one phone number of this staff.
  IF jsonb_typeof(p_query->'phone') IS DISTINCT FROM 'string' OR length(p_query->>'phone') > 40 THEN
    RAISE EXCEPTION 'invalid_report_query' USING ERRCODE = '22023';
  END IF;
  v_phone := public.aka_agent_internal_normalize_phone(p_query->>'phone');
  IF coalesce(v_phone, '') = '' THEN
    RETURN jsonb_build_object('found', false, 'phone', NULL);
  END IF;
  v_phone_hash := pg_catalog.hashtextextended('p:' || v_phone, 0);
  v_key := coalesce((SELECT l.person_hash FROM private.aka_agent_data_report_phone_links l
    WHERE l.staff_id = p_staff_id AND l.phone_hash = v_phone_hash), v_phone_hash);

  SELECT jsonb_build_object('firstSeenOn', c.first_seen_on, 'firstCaredOn', c.first_cared_on, 'lastCaredOn', c.last_cared_on,
      'careCount', c.care_count, 'verifiedOn', c.verified_on, 'seenOn', c.seen_on, 'interactedOn', c.interacted_on,
      'friendedOn', c.friended_on, 'source', c.source)
  INTO v_customer
  FROM private.aka_agent_data_report_customers c
  WHERE c.staff_id = p_staff_id AND c.key_hash = v_key;

  WITH inputs AS MATERIALIZED (
    SELECT i.id, i.name, i.campaign_id, c.name AS campaign_name
    FROM public.auto_campaign_input_data i
    JOIN public.auto_campaigns c ON c.id = i.campaign_id
    WHERE md5(public.normalize_phone(i.phone)) = md5(v_phone) AND i.phone IS NOT NULL AND btrim(i.phone) <> ''
      AND c.staff_id = p_staff_id AND c.organization_id = p_organization_id
    LIMIT 500
  ), ev AS (
    SELECT d.id, d.action_code, d.created_at, d.account_id, i.campaign_id, i.campaign_name, i.name,
      e.seen_at, e.responded_at, e.reacted_at, e.friended_at
    FROM inputs i
    JOIN public.auto_campaign_details d ON d.input_data_id = i.id
    LEFT JOIN public.auto_campaign_detail_zalo_engagement e ON e.campaign_detail_id = d.id
    WHERE d.is_delete = false
      AND d.action_code IN ('zalo_message_stranger', 'zalo_message_friend', 'zalo_add_friend', 'sms_send', 'voice_call', 'zalo_find_phone_user')
      AND (d.report_group = 'success'
        OR (d.report_group IS NULL AND d.status IN ('thành công', 'đã xem', 'đã click', 'đã gửi', 'đã nhận')))
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 60
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', ev.id, 'actionCode', ev.action_code, 'at', ev.created_at,
      'accountId', ev.account_id, 'accountName', a.name, 'campaignId', ev.campaign_id, 'campaignName', ev.campaign_name,
      'seenAt', ev.seen_at, 'respondedAt', ev.responded_at, 'reactedAt', ev.reacted_at, 'friendedAt', ev.friended_at)
      ORDER BY ev.created_at DESC, ev.id DESC), '[]'::jsonb),
    (array_agg(ev.name ORDER BY ev.created_at DESC) FILTER (WHERE nullif(btrim(ev.name), '') IS NOT NULL))[1]
  INTO v_events, v_name
  FROM ev LEFT JOIN public.auto_accounts a ON a.id = ev.account_id;

  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('id', g.id, 'name', g.name)), '[]'::jsonb)
  INTO v_groups
  FROM private.aka_agent_data_report_contact_keys ck
  JOIN public.auto_account_contact_group_members m ON m.contact_id = ck.contact_id AND m.is_delete = false
  JOIN public.auto_account_contact_groups g ON g.id = m.group_id AND g.purpose = 'data_group' AND g.is_delete = false
    AND g.staff_id = p_staff_id AND g.organization_id = p_organization_id
  WHERE ck.staff_id = p_staff_id AND ck.key_hash IN (v_key, v_phone_hash);

  RETURN jsonb_build_object('found', v_customer IS NOT NULL OR jsonb_array_length(v_events) > 0,
    'phone', v_phone, 'name', v_name, 'customer', v_customer, 'events', v_events, 'dataGroups', v_groups);
END
$function$;

ALTER FUNCTION public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb) TO aka_agent_desktop;
COMMENT ON FUNCTION public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb) IS
  'V465 Báo cáo dữ liệu reader: snapshot (nightly per-staff report, primary key read) and journey (one phone). service_role, or aka_agent_desktop bound to the same staff with automation credentials; 30s per call; read-only.';

REVOKE ALL ON FUNCTION private.aka_agent_data_report_person_hash(text,bigint,text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_phone_hash(text) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_merge_links() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_store_known() FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_sweep_people(integer) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_sweep_contacts(integer) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_sweep_inputs(integer) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_sweep_details(integer) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_sweep_engagement(timestamptz) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_build(bigint,date) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;
REVOKE ALL ON FUNCTION private.aka_agent_data_report_run(integer) FROM PUBLIC, anon, authenticated, service_role, aka_agent_desktop;

-- Every 2 minutes from 01:00 to 04:59 Vietnam time (cron.timezone is GMT); each run stops after about 90 s and one
-- run at a time holds the advisory lock, so the first catch-up keeps going without overlapping runs.
SELECT cron.schedule('aka-agent-data-report-nightly', '*/2 18-21 * * *', 'SELECT private.aka_agent_data_report_run(90);');

DO $postflight$
BEGIN
  IF (SELECT array_agg(g ORDER BY g) FROM (
        SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS g
        FROM pg_proc pr, aclexplode(pr.proacl) a
        WHERE pr.oid = to_regprocedure('public.aka_agent_read_data_report(bigint,bigint,text,text,jsonb)')) x)
     IS DISTINCT FROM ARRAY['aka_agent_desktop', 'postgres', 'service_role'] THEN
    RAISE EXCEPTION 'v465_reader_acl_unexpected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) a
    WHERE n.nspname = 'private' AND c.relname LIKE 'aka\_agent\_data\_report\_%' AND a.grantee <> c.relowner
  ) THEN
    RAISE EXCEPTION 'v465_private_table_acl_unexpected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'aka-agent-data-report-nightly' AND schedule = '*/2 18-21 * * *'
      AND command = 'SELECT private.aka_agent_data_report_run(90);' AND active = true
  ) THEN
    RAISE EXCEPTION 'v465_cron_contract_mismatch';
  END IF;
END
$postflight$;
NOTIFY pgrst, 'reload schema';
COMMIT;
