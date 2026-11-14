// Dùng chung cho post-bump-content-rotation-smoke.cjs và -replay.cjs: nạp mã TS thật, dựng hàm thật của bộ lập lịch,
// và PGlite chạy đúng thân RPC aka_agent_take_campaign_content_index đang chạy trên production (bản chụp V531).
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../../..')

function loadTs(relativePath, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relativePath), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  const localRequire = id => (id in modules ? modules[id] : require(id))
  new Function('module', 'exports', 'require', code)(module, module.exports, localRequire)
  return module.exports
}

const shared = loadTs('src/shared/postBumpContent.ts')
const contentSpin = loadTs('src/shared/contentSpin.ts')

/** Hàm thật enqueuePostBumpAfterGroupPost (và các hàm chuẩn hoá nó gọi) của CampaignScheduler. */
function loadEnqueueHarness() {
  const file = path.join(root, 'src/main/services/campaignScheduler.ts')
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CampaignScheduler')
  const methods = ['enqueuePostBumpAfterGroupPost', 'normalizePostBumpCount', 'normalizePostBumpMinutes', 'normalizePostBumpRotationIndex']
    .map(name => {
      const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === name)
      assert.ok(method, name)
      return method.getText(source)
    }).join('\n')
  const compiled = ts.transpileModule(`class Harness { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function('planPostBumpContentIndexes', 'POST_BUMP_COMMENT_ACTION_CODE', `${compiled}; return Harness`)(
    shared.planPostBumpContentIndexes, shared.POST_BUMP_COMMENT_ACTION_CODE)
}

/** Số câu mà prepareSelectedCampaignContent đếm cho comment (nội dung cơ bản). */
function commentVariants(raw) {
  return contentSpin.splitContentVariants(raw, { trim: false }).filter(text => text.trim())
}

function loadPglite() {
  const { PGlite } = require(require.resolve('@electric-sql/pglite', {
    paths: [root, process.env.AKA_CHAT_REPO || path.resolve(root, '../akaAgentChatApi')]
  }))
  return PGlite
}

const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'migrations/snapshots/post-bump-content-rotation-v531/source.json'), 'utf8'))

/** PGlite có bảng tối thiểu + thân RPC production; ownership/serialization là hàm rỗng (không phải điều đang kiểm). */
async function withPostBumpDb(fn) {
  const PGlite = loadPglite()
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_desktop;
      CREATE SCHEMA private;
      CREATE FUNCTION private.aka_agent_assert_request_ownership(bigint,bigint,bigint) RETURNS void LANGUAGE sql AS 'SELECT';
      CREATE FUNCTION public.aka_agent_lock_campaign_input_serialization(bigint) RETURNS void LANGUAGE sql AS 'SELECT';
      CREATE TABLE org_staff(id bigint PRIMARY KEY, organization_id bigint, is_active boolean);
      CREATE TABLE auto_accounts(id bigint PRIMARY KEY, staff_id bigint, organization_id bigint, status text,
        login_status text, is_active boolean, is_delete boolean);
      CREATE TABLE auto_campaigns(id bigint PRIMARY KEY, account_id bigint, staff_id bigint, organization_id bigint,
        status text, action_id text, extra_settings jsonb, is_delete boolean DEFAULT false, runtime_claim_token uuid,
        runtime_claim_target text, runtime_unit_token uuid, runtime_unit_claimed_at timestamptz,
        runtime_unit_input_data_ids bigint[] DEFAULT '{}', content_rotation_indexes jsonb NOT NULL DEFAULT '{}');
      CREATE TABLE auto_campaign_input_data(id bigserial PRIMARY KEY, campaign_id bigint, status text,
        is_delete boolean DEFAULT false, uid text, note text, content_rotation_indexes jsonb NOT NULL DEFAULT '{}',
        CONSTRAINT auto_campaign_input_data_content_rotation_indexes_object CHECK (jsonb_typeof(content_rotation_indexes) = 'object'));
      GRANT USAGE ON SCHEMA public TO aka_agent_desktop, anon;
      GRANT SELECT ON auto_campaign_input_data TO aka_agent_desktop;
      GRANT INSERT (campaign_id, status, uid, note) ON auto_campaign_input_data TO aka_agent_desktop;
      GRANT UPDATE (status, note) ON auto_campaign_input_data TO aka_agent_desktop;
      GRANT USAGE ON SEQUENCE auto_campaign_input_data_id_seq TO aka_agent_desktop;
      INSERT INTO org_staff VALUES (3, 1, true);`)
    await db.exec(snapshot.functiondef)
    const md5 = (await db.query('SELECT md5(prosrc) AS m FROM pg_proc WHERE oid = $1::regprocedure', [snapshot.signature])).rows[0].m
    assert.equal(md5, snapshot.prosrc_md5, 'PGlite giữ nguyên thân RPC production')
    return await fn(db)
  } finally {
    await db.close()
  }
}

/** Tạo chiến dịch up tin đang giữ lượt (claim + unit) để RPC nhận. */
async function addClaimedCampaigns(db, campaignIds) {
  if (campaignIds.length === 0) return
  await db.query(`INSERT INTO auto_accounts SELECT id, 3, 1, 'đang chạy', 'đã đăng nhập', true, false
    FROM unnest($1::bigint[]) id ON CONFLICT (id) DO NOTHING`, [campaignIds])
  await db.query(`INSERT INTO auto_campaigns(id,account_id,staff_id,organization_id,status,action_id,extra_settings,
      runtime_claim_token,runtime_claim_target,runtime_unit_token,runtime_unit_claimed_at)
    SELECT id, id, 3, 1, 'đang chạy', 'facebook_comment_seeding_post', '{}', gen_random_uuid(), 'desktop', gen_random_uuid(), now()
    FROM unnest($1::bigint[]) id ON CONFLICT (id) DO NOTHING`, [campaignIds])
}

async function takeContentIndex(db, campaignId, inputId, count) {
  return (await db.query(`SELECT public.aka_agent_take_campaign_content_index(c.id, c.account_id, 3, 'desktop',
      c.runtime_claim_token, c.runtime_unit_token, $2, 'fb_comment', $3) AS i FROM auto_campaigns c WHERE c.id = $1`,
    [campaignId, inputId, count])).rows[0].i
}

module.exports = {
  root, loadTs, shared, contentSpin, loadEnqueueHarness, commentVariants, snapshot,
  withPostBumpDb, addClaimedCampaigns, takeContentIndex
}
