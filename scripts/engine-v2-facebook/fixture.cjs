// DB thử cho engine v2 Facebook: DB engine như production (bootstrap của bộ kịch bản Zalo, tới V532) + bảng / hàm tối thiểu mà phần
// Facebook đọc (workflow, nhân viên, phiên Desktop giả). Không chạm DB thật.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { ROOT } = require('../fixtures/campaign-outcome-engine/pg-fixture.cjs')
const { bootstrap } = require('../engine-v2-scenarios/bootstrap.cjs')

const MIGRATIONS = path.join(ROOT, 'migrations')
const readMigration = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')

/** Bảng / hàm của production mà fixture V495 không có; kiểu cột như production (đọc chỉ đọc 16/11/2026). */
const FACEBOOK_STUBS = `
CREATE TABLE public.org_staff (id bigint PRIMARY KEY, organization_id bigint, username text, password text, is_active boolean NOT NULL DEFAULT true,
  max_running_zalo_web_accounts integer, max_running_facebook_accounts integer);
CREATE TABLE public.auto_blocks (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, description text, icon text, category text NOT NULL DEFAULT 'facebook',
  kind text NOT NULL DEFAULT 'js', system_type text, code text NOT NULL DEFAULT '', config_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_schema jsonb NOT NULL DEFAULT '[]'::jsonb, default_config jsonb DEFAULT '{}'::jsonb, is_builtin boolean NOT NULL DEFAULT false,
  staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_workflows (id bigserial PRIMARY KEY, name text NOT NULL UNIQUE, description text, nodes jsonb NOT NULL DEFAULT '[]'::jsonb,
  edges jsonb NOT NULL DEFAULT '[]'::jsonb, variables_schema jsonb DEFAULT '[]'::jsonb, default_variables jsonb DEFAULT '{}'::jsonb,
  is_builtin boolean NOT NULL DEFAULT false, staff_id bigint, organization_id bigint, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE public.auto_runs (id bigserial PRIMARY KEY, workflow_id bigint, campaign_id bigint, campaign_detail_id bigint, account_id bigint,
  status text NOT NULL DEFAULT 'pending', variables jsonb DEFAULT '{}'::jsonb, output jsonb DEFAULT '{}'::jsonb, error text, started_at timestamptz,
  completed_at timestamptz, created_at timestamptz DEFAULT now(), campaign_input_data_id bigint);
CREATE TABLE public.auto_run_steps (id bigserial PRIMARY KEY, run_id bigint NOT NULL REFERENCES public.auto_runs(id) ON DELETE CASCADE, node_id text NOT NULL,
  block_id bigint, block_name text, status text NOT NULL, input jsonb DEFAULT '{}'::jsonb, output jsonb DEFAULT '{}'::jsonb, error text, duration_ms integer,
  started_at timestamptz, completed_at timestamptz);
CREATE INDEX idx_run_steps_run ON public.auto_run_steps (run_id);
-- Phiên Desktop giả: nhân viên lấy từ GUC test.desktop_staff (production lấy từ JWT).
CREATE FUNCTION private.aka_agent_staff_scope_for_request() RETURNS bigint LANGUAGE sql STABLE
  AS $f$ SELECT nullif(current_setting('test.desktop_staff', true), '')::bigint $f$;
CREATE FUNCTION private.aka_agent_desktop_data_context() RETURNS TABLE(staff_id bigint, organization_id bigint, system_admin boolean) LANGUAGE sql STABLE
  AS $f$ SELECT s.id, s.organization_id, false FROM public.org_staff s WHERE s.id = nullif(current_setting('test.desktop_staff', true), '')::bigint $f$;
-- Presence v1 rút gọn: đúng tài khoản thì true (bản thật ghi auto_staff_device_presence).
CREATE FUNCTION public.aka_agent_device_presence(p_username text, p_password text, p_instance_id uuid, p_device jsonb, p_ended boolean) RETURNS boolean
  LANGUAGE sql AS $f$ SELECT EXISTS (SELECT 1 FROM public.org_staff s WHERE s.username = btrim(p_username) AND s.password = p_password AND s.is_active) $f$;
`

/** Migration Facebook theo đúng thứ tự apply (V557 phần 2 là hai lệnh CONCURRENTLY, mỗi lệnh một lần gọi, ngoài giao dịch). */
const FACEBOOK_MIGRATIONS = [
  'migration_v556_engine_facebook_p1.sql', 'migration_v556_engine_facebook_p2.sql',
  'migration_v557_engine_slot_runs_p1.sql', 'migration_v557_engine_slot_runs_p2a_index.sql', 'migration_v557_engine_slot_runs_p2b_index.sql',
  'migration_v557_engine_slot_runs_p3.sql', 'migration_v558_engine_facebook_functions.sql'
]
/** V559 (chính sách FB bản nháp, chưa duyệt): DB thử có thêm để bài kiểm Desktop chạy với luật / chính sách FB như khi bật. */
const FACEBOOK_POLICY_MIGRATIONS = ['migration_v559_engine_facebook_policies.sql']

/** Bảng / hàm tối thiểu mà phần Facebook đọc (bỏ qua nếu đã có). */
async function applyFacebookStubs(db) {
  const { rows } = await db.query(`SELECT to_regclass('public.auto_blocks') IS NOT NULL AS has`)
  if (!rows[0].has) await db.query(FACEBOOK_STUBS)
}

/** Apply các migration Facebook (mặc định tất cả) lên DB engine đã dựng. */
async function applyFacebookMigrations(db, names = FACEBOOK_MIGRATIONS) {
  await applyFacebookStubs(db)
  for (const name of names) await db.query(readMigration(name))
}

/** Dựng DB engine như production rồi thêm phần tối thiểu cho Facebook. notes: ghi chú bootstrap. */
async function buildFacebookFixture(db, notes = []) {
  await bootstrap(db, notes)
  await applyFacebookStubs(db)
  return notes
}

module.exports = { ROOT, MIGRATIONS, FACEBOOK_MIGRATIONS, FACEBOOK_POLICY_MIGRATIONS, readMigration, applyFacebookStubs, applyFacebookMigrations, buildFacebookFixture }
