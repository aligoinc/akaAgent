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

/**
 * V563 (sửa riêng phần engine sau khi rà lỗi FB 30 ngày): cần V559 (dấu hiệu, chính sách FB) và ba cặp block cũ / bản "[engine]"
 * (fb_collect_search_groups, fb_comment_at_position kèm dòng danh mục bước, fb_adjust_group_post_comments_after_pending) như production (V560
 * chép; DB thử không chép đủ 84 block nên chỉ dựng đúng ba cặp này, code thật đọc 17/11).
 */
const V563_MIGRATION = 'migration_v563_engine_facebook_signs_search.sql'
const V563_ROLLBACK = 'rollback_v563_engine_facebook_signs_search.sql'
async function seedV563Blocks(db) {
  const live = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/engine-v2-facebook/v563-live-20261117.json'), 'utf8'))
  for (const block of [live.block, live.commentBlock, live.adjustBlock]) {
    await db.query(`INSERT INTO public.auto_blocks (id, name, code, category) VALUES ($1, $2, $3, 'facebook'), ($4, $5, $3, 'facebook')`,
      [block.sourceId, block.sourceName, block.code, block.id, block.name])
    await db.query(`INSERT INTO public.auto_engine_block_copies (engine_block_id, source_block_id, source_md5_at_copy, engine_md5_at_copy)
      VALUES ($1, $2, $3, $3)`, [block.id, block.sourceId, block.md5])
    for (const step of block.steps || []) {
      await db.query(`INSERT INTO public.auto_engine_block_steps (id, block_id, step_kind, action_code, commit_level, send_ops, reviewed_code_md5)
        VALUES ($1, $2, 'delivery', 'fb_comment', $3, $4::jsonb, $5)`, [step.id, block.id, step.commitLevel, JSON.stringify(step.sendOps), step.reviewedMd5])
    }
  }
  return live
}
/** Cả V563 (DB thử không có block giả trùng số với block bộ cũ). */
async function applyV563(db) {
  const live = await seedV563Blocks(db)
  await db.query(readMigration(V563_MIGRATION))
  return live
}
/** Riêng phần dấu hiệu + chính sách FB11 của V563 (đúng câu trong migration), cho DB thử có block giả số 34 như bộ kiểm engine Desktop. */
async function applyV563SignsOnly(db) {
  const { SIGN_POLICY_SQL } = require('../build-v563-sql.cjs')
  await db.query(`BEGIN;\n${SIGN_POLICY_SQL}\nCOMMIT;`)
}

/** Dựng DB engine như production rồi thêm phần tối thiểu cho Facebook. notes: ghi chú bootstrap. */
async function buildFacebookFixture(db, notes = []) {
  await bootstrap(db, notes)
  await applyFacebookStubs(db)
  return notes
}

module.exports = { ROOT, MIGRATIONS, FACEBOOK_MIGRATIONS, FACEBOOK_POLICY_MIGRATIONS, V563_MIGRATION, V563_ROLLBACK, readMigration, applyFacebookStubs,
  applyFacebookMigrations, buildFacebookFixture, seedV563Blocks, applyV563, applyV563SignsOnly }
