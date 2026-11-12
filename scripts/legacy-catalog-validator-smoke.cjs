// Bản cũ còn chạy được sau V495 không: chạy lại bộ kiểm danh mục lúc bắt đầu chạy chiến dịch của
// Desktop 8.2.0 / 9.3.0 / HEAD (actionResultRuntime.beginActionResultRun) và chat-sync trên Fly
// (CampaignActionResults.begin) trên danh mục SAU khi apply V495, cộng thêm một trạng thái mới chỉ thêm bằng dữ liệu.
// ActionStatusCatalog lấy đúng mã của từng bản (git show / repo akaAgentChatApi); vòng kiểm lỗi được chép lại và
// có kiểm "trôi" (nguồn đổi thì smoke báo để cập nhật bản chép).
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const { ROOT, MIGRATION, buildFixture, startCluster, requireFrom } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const ts = requireFrom('typescript')
const PORT = Number(process.env.V495_LEGACY_TEST_PORT || 55499)
const CHAT_REPO = process.env.CHAT_REPO || [path.resolve(ROOT, '../akaAgentChatApi'), path.resolve(ROOT, '../../../../akaAgentChatApi')]
  .find(dir => fs.existsSync(path.join(dir, 'packages/database/src/campaignActionResults.ts')))
const BUILDS = [{ label: 'Desktop 8.2.0', ref: '9be854d7503e1cdaa88636e28e6d1fd9b8048c2e' }, { label: 'Desktop 9.3.0', ref: '646ddd981f37f4aa6fce68f3253cd39fb9dc3225' },
  { label: 'Desktop HEAD', ref: null }]

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

function gitShow(ref, file) {
  const r = spawnSync('git', ['show', `${ref}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return r.status === 0 ? r.stdout : null
}
function loadCatalogModule(source) {
  const mod = { exports: {} }
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: mod.exports, module: mod, require, Object, Map, Set, Error, Number, JSON, Array, String })
  return mod.exports
}

const toStatus = s => ({ id: Number(s.id), code: String(s.code), name: String(s.name), statusValue: s.status_value == null ? null : String(s.status_value),
  color: s.color == null ? null : String(s.color), componentType: String(s.component_type), platform: String(s.flatform_type),
  isActive: s.is_active === true, isDelete: s.is_delete === true })
const toPolicy = p => ({ id: Number(p.id), actionCode: p.action_code == null ? null : String(p.action_code), statusId: Number(p.status_id),
  reportGroup: p.report_group, countsTowardLimit: p.counts_toward_limit, badTargetEffect: p.bad_target_effect, resetErrorStreak: p.reset_error_streak,
  inputEffect: p.input_effect, isActive: p.is_active === true, isDelete: p.is_delete === true })

/** Chép từ src/main/services/actionResultRuntime.ts:29-55 (giống hệt ở 8.2.0 và 9.3.0). Trả số mã lỗi đã kiểm. */
function desktopBegin(M, rows, platform, actionCodes) {
  const statuses = rows.statuses.map(toStatus)
  const catalog = new M.ActionStatusCatalog(statuses, rows.policies.map(toPolicy))
  const actions = new Set(rows.actions.filter(a => a.is_active !== false && a.is_delete !== true).map(a => String(a.code)))
  for (const action of actionCodes) if (!actions.has(action)) throw new M.ResultContractError('output_invalid', action, 'action_unavailable')
  catalog.preflight(actionCodes.map(actionCode => ({ actionCode, statusCodes: ['campaign_detail_success', 'campaign_detail_failed', 'campaign_detail_error'] })))
  if (actionCodes.includes('zalo_tag_contact')) catalog.selectPolicy('zalo_tag_contact', 'campaign_detail_tag_not_found')
  if (actionCodes.includes('zalo_change_alias')) catalog.selectPolicy('zalo_change_alias', 'campaign_detail_invalid_parameter')
  let checked = 0
  for (const row of rows.errors.filter(e => e.is_active === true && e.is_delete === false)) {
    const error = { errorType: row.error_type, detailMode: row.detail_mode ?? null, detailStatus: row.detail_status ?? null,
      detailStatusId: row.detail_status_id ?? null, zaloActionCodes: Array.isArray(row.zalo_action_codes) ? row.zalo_action_codes : [] }
    if (!error.errorType.includes(platform) && error.errorType !== 'system') continue
    checked++
    for (const actionCode of actionCodes) {
      if (error.zaloActionCodes.length && platform === 'zalo' && !error.zaloActionCodes.includes(actionCode)) continue
      if (error.detailMode === 'suppress') continue
      const status = error.detailMode === 'override'
        ? statuses.find(s => s.id === Number(error.detailStatusId))
        : error.detailStatus ? catalog.statusForLegacyValue(error.detailStatus, actionCode, platform) : null
      if (status) catalog.selectPolicy(actionCode, status.code)
      else if (error.detailMode === 'override') throw new M.ResultContractError('error_override_invalid', actionCode, String(error.detailStatusId))
    }
  }
  return checked
}

/** Chép từ akaAgentChatApi packages/database/src/campaignActionResults.ts begin() (65b85ca). */
function chatBegin(M, rows, actionCodes) {
  const statuses = rows.statuses.map(toStatus)
  const catalog = new M.ActionStatusCatalog(statuses, rows.policies.map(toPolicy))
  for (const action of actionCodes) if (!rows.actions.some(a => a.code === action && a.is_active !== false && a.is_delete !== true)) {
    throw new M.ResultContractError('output_invalid', action, 'action_unavailable')
  }
  catalog.preflight(actionCodes.map(actionCode => ({ actionCode, statusCodes: ['campaign_detail_success', 'campaign_detail_failed', 'campaign_detail_error'] })))
  let checked = 0
  for (const error of rows.errors) {
    if (!String(error.error_type).includes('zalo') && error.error_type !== 'system') continue
    if (error.detail_mode === 'suppress') continue
    checked++
    for (const actionCode of actionCodes) {
      const actions = Array.isArray(error.zalo_action_codes) ? error.zalo_action_codes : []
      if (actions.length && !actions.includes(actionCode)) continue
      const status = error.detail_mode === 'override' ? statuses.find(s => s.id === Number(error.detail_status_id))
        : error.detail_status ? catalog.statusForLegacyValue(String(error.detail_status), actionCode, 'zalo') : null
      if (status) catalog.selectPolicy(actionCode, status.code)
      else if (error.detail_mode === 'override') throw new M.ResultContractError('error_override_invalid', actionCode, String(error.detail_status_id))
    }
  }
  if (actionCodes.includes('zalo_tag_contact')) catalog.selectPolicy('zalo_tag_contact', 'campaign_detail_tag_not_found')
  if (actionCodes.includes('zalo_change_alias')) catalog.selectPolicy('zalo_change_alias', 'campaign_detail_invalid_parameter')
  return checked
}

async function main() {
  // Kiểm "trôi": nguồn hiện tại vẫn đúng như bản chép.
  const desktopSrc = fs.readFileSync(path.join(ROOT, 'src/main/services/actionResultRuntime.ts'), 'utf8')
  for (const line of ["if (!error.errorType.includes(input.platform) && error.errorType !== 'system') continue",
    "if (error.zaloActionCodes.length && input.platform === 'zalo' && !error.zaloActionCodes.includes(actionCode)) continue",
    "if (error.detailMode === 'suppress') continue"]) assert.ok(desktopSrc.includes(line), 'actionResultRuntime.ts đổi, cập nhật bản chép: ' + line)
  const desktopMods = BUILDS.map(b => {
    const source = b.ref ? gitShow(b.ref, 'src/shared/actionStatusPolicy.ts') : fs.readFileSync(path.join(ROOT, 'src/shared/actionStatusPolicy.ts'), 'utf8')
    return source ? { ...b, M: loadCatalogModule(source) } : null
  }).filter(Boolean)
  assert.ok(desktopMods.length >= 1)
  let chat = null
  if (CHAT_REPO) {
    const chatSrc = fs.readFileSync(path.join(CHAT_REPO, 'packages/database/src/campaignActionResults.ts'), 'utf8')
    for (const line of ["if (!String(error.error_type).includes('zalo') && error.error_type !== 'system') continue;", "if (error.detail_mode==='suppress') continue;"]) {
      assert.ok(chatSrc.includes(line), 'campaignActionResults.ts đổi, cập nhật bản chép: ' + line)
    }
    chat = loadCatalogModule(fs.readFileSync(path.join(CHAT_REPO, 'packages/database/src/result-policy/actionStatusPolicy.ts'), 'utf8'))
  }
  pass(`nạp ActionStatusCatalog của ${desktopMods.map(m => m.label).join(', ')}${chat ? ' và chat-sync' : ''}; nguồn chưa trôi khỏi bản chép`)

  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v495-legacy-' })
  const db = await connect()
  try {
    await buildFixture(db, [])
    const readDesktop = async () => {
      const q = t => db.query(`SELECT * FROM public.${t} ORDER BY id`).then(r => r.rows)
      return { statuses: await q('auto_status'), policies: await q('auto_account_action_status_policies'), errors: await q('auto_error'), actions: await q('auto_account_actions') }
    }
    const readChat = async () => (await db.query(`SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) FROM public.auto_status s) statuses,
      (SELECT coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) FROM public.auto_account_action_status_policies p) policies,
      (SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.auto_error e WHERE e.is_active AND NOT e.is_delete) errors,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('code',a.code,'is_active',a.is_active,'is_delete',a.is_delete)),'[]'::jsonb) FROM public.auto_account_actions a) actions`)).rows[0]
    const campaigns = (await db.query(`SELECT id, flatform_type, limit_check_action_codes FROM public.auto_campaign_actions
      WHERE is_active AND NOT is_delete AND flatform_type IN ('zalo', 'facebook', 'email') AND cardinality(limit_check_action_codes) > 0 ORDER BY id`)).rows

    const sweep = (rows, chatRows) => {
      const counts = {}
      for (const b of desktopMods) for (const c of campaigns) {
        counts[`${b.label}/${c.flatform_type}`] = desktopBegin(b.M, rows, c.flatform_type, c.limit_check_action_codes)
      }
      if (chat) for (const c of campaigns.filter(c => c.flatform_type === 'zalo')) counts['chat/zalo'] = chatBegin(chat, chatRows, c.limit_check_action_codes)
      return counts
    }
    const before = sweep(await readDesktop(), await readChat())
    await db.query(MIGRATION)
    // V499 (nhớ theo tài khoản), V500 (chính sách lỗi Zalo, thêm 7 mã engine v2) và V501 (CFG16, luật action_waiting) cũng không được
    // làm bản cũ thấy mã mới.
    const later = ['migration_v499_target_memory_per_account.sql', 'migration_v500_zalo_error_policies.sql',
      'migration_v501_engine_schedule_completion.sql', 'migration_v503_engine_share_batch.sql', 'migration_v504_engine_send_exclusion.sql',
      'migration_v505_engine_materialize.sql', 'migration_v506_engine_realtime_sms.sql', 'migration_v507_engine_drop_target_memory.sql',
      'migration_v508_zalo_group_126_127_per_group.sql', 'migration_v509_zalo_personal_112_too_long.sql',
      'migration_v512_fly_command_signal_rules.sql']
      .map(f => path.join(ROOT, 'migrations', f)).filter(f => fs.existsSync(f))
    for (const file of later) await db.query(fs.readFileSync(file, 'utf8'))
    // Trạng thái mới chỉ thêm bằng dữ liệu (gốc "Không tồn tại") như kịch bản ở tài liệu thiết kế.
    await db.query(`INSERT INTO public.auto_status(code, name, status_key, component_type, status_value, parent_status_id, is_terminal)
      SELECT 'campaign_detail_invalid_phone', 'SĐT không hợp lệ', 'invalid_phone', 'campaign_detail', 'sđt không hợp lệ', id, true
        FROM public.auto_status WHERE code = 'campaign_detail_not_found'`)
    const after = sweep(await readDesktop(), await readChat())
    assert.deepEqual(after, before, 'số mã lỗi mà bản cũ kiểm phải giữ nguyên (mã engine v2 không lọt vào)')
    pass(`${campaigns.length} loại chiến dịch Zalo/Facebook/Email × ${desktopMods.length} bản Desktop${chat ? ' + chat-sync' : ''}: bộ kiểm lúc bắt đầu chạy đạt trên danh mục sau V495${later.length ? ' + V499/V500/V501' : ''} + trạng thái mới`)

    // Đối chứng âm: một dòng sai thật sự bị bộ kiểm chặn (để chứng minh lượt đạt ở trên có ý nghĩa).
    await db.query(`INSERT INTO public.auto_error(error_type, error_code, error_name, detail_status, zalo_action_codes)
      VALUES ('external zalo', 'err_fixture_bad_status', 'Fixture', 'trạng thái không có', '{}')`)
    const rows = await readDesktop()
    const zalo = campaigns.find(c => c.flatform_type === 'zalo')
    for (const b of desktopMods) assert.throws(() => desktopBegin(b.M, rows, 'zalo', zalo.limit_check_action_codes), err => err.reason === 'status_unknown')
    if (chat) { const chatRows = await readChat(); assert.throws(() => chatBegin(chat, chatRows, zalo.limit_check_action_codes), err => err.reason === 'status_unknown') }
    await db.query(`UPDATE public.auto_error SET error_type = 'engine v2' WHERE error_code = 'err_fixture_bad_status'`)
    const cleanRows = await readDesktop(), cleanChat = await readChat()
    for (const b of desktopMods) desktopBegin(b.M, cleanRows, 'zalo', zalo.limit_check_action_codes)
    if (chat) chatBegin(chat, cleanChat, zalo.limit_check_action_codes)
    pass('đối chứng: dòng error_type "external zalo" với trạng thái sai bị bản cũ chặn; cùng dòng đó với error_type "engine v2" thì bản cũ bỏ qua')
    console.log(`\n${checks} nhóm kiểm tra đạt`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
