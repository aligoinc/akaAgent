// V514: giữ khớp trạng thái hệ thống (V494) với nhóm báo cáo / trạng thái gốc của engine v2 (V495), và báo khi trạng thái lịch sử
// theo mã lỗi lệch giữa auto_error (bộ chạy cũ) và auto_outcome_policies (engine). PostgreSQL 17 cục bộ: fixture engine (ảnh chụp
// danh mục thật) → V495 → V499 → V500 → V501 → V503…V509 → V512 → V494 → V514. Không mạng, không dữ liệu khách.
// Chạy: node scripts/test-v514-status-system-group-guard.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const builds = ['499', '501', '503', '504', '505', '506', '507', '508', '509', '512'].map(n => [n, require(`./build-v${n}-sql.cjs`)])
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const V500 = read('migrations/migration_v500_zalo_error_policies.sql')
const V494 = read('migrations/migration_v494_action_system_statuses.sql')
const APPLY = read('migrations/migration_v514_status_system_group_guard.sql')
const ROLLBACK = read('migrations/rollback_v514_status_system_group_guard.sql')
const PORT = Number(process.env.V514_TEST_PORT || 55514)
const LINT_MD5_V495 = 'a5731bb6a4059bd38983d6240682e1be'

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v514-' })
  const db = await connect()
  const q = (sql, args = []) => db.query(sql, args)
  const val = async (sql, args = []) => Object.values((await q(sql, args)).rows[0] || {})[0]
  const lint = async () => (await q(`SELECT issue, subject FROM public.aka_agent_engine_policy_lint ORDER BY 1, 2`)).rows
  // Mỗi ca chạy trong một giao dịch rồi ROLLBACK, không để lại gì cho ca sau.
  const inTx = async fn => { await q('BEGIN'); try { return await fn() } finally { await q('ROLLBACK') } }
  const rejects = (sql, pattern) => inTx(async () => { await assert.rejects(q(sql), pattern) })
  const status = (code, { system, group = null, parent = null, component = 'campaign_detail' }) => `INSERT INTO public.auto_status
    (code, name, description, status_key, status_value, flatform_type, component_type, is_default, is_terminal, can_set_manually,
     is_active, is_delete, sort_order, system_status_code, report_group, parent_status_id)
    VALUES ('${code}', '${code}', 'v514 test', '${code}', '${code}', 'zalo', '${component}', false, false, false, false, false, 990,
            ${system ? `'${system}'` : 'NULL'}, ${group ? `'${group}'` : 'NULL'}, ${parent ?? 'NULL'})`
  try {
    await buildFixture(db, [])
    await q(MIGRATION)
    await q(builds[0][1].migration)
    await q(V500)
    await q(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const [, m] of builds.slice(1)) await q(m.migration)
    assert.equal(await val(`SELECT md5(pg_get_viewdef('public.aka_agent_engine_policy_lint'::regclass, true))`), LINT_MD5_V495,
      'view rà soát của fixture phải đúng bản đang chạy trên akachat')
    // V494 kiểm quyền SELECT của Desktop / Chat trên auto_status như production.
    await q(`GRANT SELECT ON public.auto_status TO aka_agent_desktop, aka_agent_chat_api`)
    await assert.rejects(q(APPLY), /V514 cần V494/)
    await q('ROLLBACK').catch(() => {})
    let v494Note = 'V494 apply nguyên văn'
    try { await q(V494) } catch (error) {
      await q('ROLLBACK').catch(() => {})
      // Ảnh chụp danh mục (06/11) có thể khác vân tay V494 đọc ngày 11/11: chỉ bỏ khối preflight, phần thay đổi giữ nguyên văn.
      if (!/v494:/.test(String(error.message))) throw error
      v494Note = `V494 bỏ preflight (${String(error.message).slice(0, 80)}…)`
      await q(V494.replace(/DO \$v494_preflight\$[\s\S]*?\$v494_preflight\$;/, ''))
    }
    assert.equal(await val(`SELECT count(*) FROM public.auto_status WHERE system_status_code IS NOT NULL`) > 0, true)
    pass(`chuỗi migration như production (V495 … V512, rồi ${v494Note}); view rà soát đúng md5 bản akachat; V514 từ chối khi chưa có V494`)

    // ---- Apply ------------------------------------------------------------------------------------------------------------
    const before = await lint()
    await q(APPLY.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await val(`SELECT to_regprocedure('public.aka_agent_guard_status_system_group_v514()') IS NULL`), true)
    assert.equal(await val(`SELECT md5(pg_get_viewdef('public.aka_agent_engine_policy_lint'::regclass, true))`), LINT_MD5_V495)
    await q(APPLY)
    assert.deepEqual(await lint(), before, 'dữ liệu fixture khớp: 4 loại cũ ra y như trước, 2 loại mới không có dòng')
    assert.equal(Number(await val(`SELECT count(*) FROM pg_trigger WHERE tgname = 'auto_status_system_group_guard_v514'`)), 1)
    assert.equal(await val(`SELECT has_table_privilege('anon', 'public.aka_agent_engine_policy_lint', 'SELECT')`), false)
    pass('apply trong giao dịch rồi ROLLBACK không để lại gì; apply thật: rà soát cũ giữ nguyên, hai loại mới 0 dòng, quyền view giữ nguyên')

    // ---- Trigger ----------------------------------------------------------------------------------------------------------
    const id = code => val(`SELECT id FROM public.auto_status WHERE code = $1`, [code])
    const failed = await id('campaign_detail_failed'), success = await id('campaign_detail_success'), error = await id('campaign_detail_error')
    await rejects(status('campaign_detail_v514_a', { system: 'failure', group: 'success' }), /status_report_group_system_mismatch/)
    await rejects(status('campaign_detail_v514_b', { system: 'failure' }), /status_report_group_missing/)
    await rejects(status('campaign_detail_v514_c', { system: 'failure', group: 'failure', parent: success }), /status_parent_system_group_mismatch/)
    await inTx(async () => {
      await q(status('campaign_detail_v514_d', { system: 'failure', parent: failed }))
      const sem = (await q(`SELECT s.report_group FROM public.aka_agent_status_semantics((SELECT id FROM public.auto_status WHERE code = 'campaign_detail_v514_d')) s`)).rows[0]
      assert.equal(sem.report_group, 'failure', 'không tự có report_group thì nhận của trạng thái gốc')
      await assert.rejects(q(`UPDATE public.auto_status SET system_status_code = 'success', report_group = 'success' WHERE id = ${failed}`),
        /status_children_system_group_mismatch/)
    })
    await rejects(`UPDATE public.auto_status SET system_status_code = 'success' WHERE id = ${failed}`, /status_report_group_system_mismatch/)
    pass('trigger chặn: nhóm báo cáo khác trạng thái hệ thống, thiếu nhóm, trạng thái gốc khác nhóm, sửa trạng thái gốc làm lệch dòng con; trạng thái con không tự có nhóm thì nhận nhóm của gốc')

    await inTx(async () => {
      await q(`UPDATE public.auto_status SET parent_status_id = ${failed} WHERE code = 'campaign_detail_receiver_blocked'`)
      await q(`UPDATE public.auto_status SET parent_status_id = ${error} WHERE code IN ('campaign_detail_connection_error', 'campaign_detail_result_unknown')`)
      await assert.rejects(q(`UPDATE public.auto_status SET parent_status_id = ${failed} WHERE code = 'campaign_detail_account_restricted'`),
        /status_parent_system_group_mismatch/)
    })
    await inTx(async () => {
      await q(`UPDATE public.auto_status SET name = name || ' (sửa)', sort_order = sort_order + 1, is_active = is_active WHERE id = ${failed}`)
      const other = await val(`SELECT component_type FROM public.auto_status WHERE component_type <> 'campaign_detail' LIMIT 1`)
      await q(status('v514_other_component', { system: null, component: other }))
    })
    pass('trạng thái mới của V494 gắn được trạng thái gốc cùng nhóm (người nhận chặn tin → thất bại, lỗi kết nối / chưa rõ kết quả → lỗi), khác nhóm thì chặn (bị hạn chế → thất bại); sửa tên / thứ tự / bật tắt và trạng thái ngoài kết quả không bị chặn')

    // ---- Rà soát: trạng thái lịch sử lệch giữa auto_error và engine --------------------------------------------------------
    // Một mã lỗi mà cả bộ cũ (auto_error) lẫn chính sách chung của engine đều ghi "thất bại" cho một hành động.
    const pair = (await q(`SELECT e.error_code, a.action_code
      FROM public.auto_error e CROSS JOIN LATERAL unnest(coalesce(e.zalo_action_codes, ARRAY[NULL::text])) a(action_code)
     WHERE e.is_active AND NOT e.is_delete AND lower(btrim(e.detail_status)) = 'thất bại' AND e.detail_mode IS DISTINCT FROM 'override'
       AND EXISTS (SELECT 1 FROM public.auto_outcome_policies op WHERE op.is_active AND NOT op.is_delete AND op.error_code = e.error_code
             AND op.detail_status_id = ${failed} AND op.status_id IS NULL AND op.campaign_action_id IS NULL AND op.runtime_target IS NULL
             AND (op.action_code = a.action_code OR op.action_code IS NULL))
     ORDER BY e.error_code, a.action_code NULLS FIRST LIMIT 1`)).rows[0]
    assert.ok(pair, 'cần một mã lỗi ghi "thất bại" ở cả hai bên')
    const subject = `${pair.error_code} × ${pair.action_code ?? '*'}: auto_error=không tồn tại / engine=thất bại`
    const drift = async () => (await lint()).filter(r => r.issue === 'detail_status_differs_from_auto_error').map(r => r.subject)
    const notFound = await id('campaign_detail_not_found')
    await inTx(async () => {
      await q(`UPDATE public.auto_error SET detail_status = 'không tồn tại' WHERE error_code = $1`, [pair.error_code])
      assert.ok((await drift()).includes(subject), 'chỉ sửa auto_error: báo lệch')
      await q(`UPDATE public.auto_outcome_policies SET detail_status_id = ${notFound}
                WHERE error_code = $1 AND detail_status_id = ${failed} AND status_id IS NULL AND campaign_action_id IS NULL AND runtime_target IS NULL`,
        [pair.error_code])
      assert.deepEqual(await drift(), [], 'sửa cả chính sách của engine thì hết lệch')
    })
    await inTx(async () => {
      await q(`UPDATE public.auto_error SET detail_mode = 'override', detail_status_id = ${notFound} WHERE error_code = $1`, [pair.error_code])
      assert.ok((await drift()).includes(subject), 'kiểu override + detail_status_id')
    })
    await inTx(async () => {
      // Bỏ qua trigger (như khi chép dữ liệu bằng replica): view rà soát vẫn báo.
      await q(`SET LOCAL session_replication_role = replica`)
      await q(`UPDATE public.auto_status SET report_group = 'success' WHERE id = ${failed}`)
      assert.deepEqual((await lint()).filter(r => r.issue === 'status_group_mismatch').map(r => r.subject), [`${failed}:campaign_detail_failed`])
    })
    pass(`view rà soát báo khi chỉ sửa auto_error (chữ hay override) mà không sửa chính sách engine (${pair.error_code}), hết khi sửa cả hai; báo lệch nhóm kể cả khi trigger bị bỏ qua`)

    // ---- Chặn chạy lại / gỡ / apply lại -------------------------------------------------------------------------------------
    await assert.rejects(q(APPLY), /đã có/)
    await q('ROLLBACK').catch(() => {})
    await q(ROLLBACK)
    assert.equal(await val(`SELECT md5(pg_get_viewdef('public.aka_agent_engine_policy_lint'::regclass, true))`), LINT_MD5_V495)
    assert.equal(Number(await val(`SELECT count(*) FROM pg_trigger WHERE tgname = 'auto_status_system_group_guard_v514'`)), 0)
    assert.deepEqual(await lint(), before)
    await assert.rejects(q(ROLLBACK), /chưa có V514/)
    await q('ROLLBACK').catch(() => {})
    await q(APPLY)
    assert.deepEqual(await lint(), before)
    pass('chạy lại bị chặn; gỡ trả view đúng md5 bản V495 và bỏ trigger; apply lại được')
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`OK V514: ${checks} nhóm kiểm`)
}

main().catch(error => { console.error(error); process.exit(1) })
