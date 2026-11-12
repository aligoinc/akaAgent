// V512: luật phân loại cho tín hiệu lệnh Fly mà Desktop không có. PostgreSQL 17 cục bộ có đủ chuỗi V495 → … → V509, rồi V512; kiểm
// phân loại trước / sau / sau khi gỡ và chính sách mà từng tín hiệu dẫn tới (kết quả thật cho data). Không mạng, không dữ liệu khách.
// Chạy: node scripts/campaign-outcome-engine-v512-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ROOT, MIGRATION, buildFixture, startCluster } = require('./fixtures/campaign-outcome-engine/pg-fixture.cjs')
const v499 = require('./build-v499-sql.cjs')
const v501 = require('./build-v501-sql.cjs')
const v503 = require('./build-v503-sql.cjs')
const v504 = require('./build-v504-sql.cjs')
const v505 = require('./build-v505-sql.cjs')
const v506 = require('./build-v506-sql.cjs')
const v507 = require('./build-v507-sql.cjs')
const v508 = require('./build-v508-sql.cjs')
const v509 = require('./build-v509-sql.cjs')
const v512 = require('./build-v512-sql.cjs')
const V500 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v500_zalo_error_policies.sql'), 'utf8')
const PORT = Number(process.env.V512_TEST_PORT || 55512)

let checks = 0
const pass = label => { checks++; console.log('PASS', label) }

async function main() {
  const { connect, stop } = startCluster({ port: PORT, label: 'aka-v512-' })
  const db = await connect()
  try {
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/migration_v512_fly_command_signal_rules.sql'), 'utf8'), v512.migration, 'file migration = bản sinh')
    assert.equal(fs.readFileSync(path.join(ROOT, 'migrations/rollback_v512_fly_command_signal_rules.sql'), 'utf8'), v512.rollback, 'file rollback = bản sinh')
    await buildFixture(db, [])
    await db.query(MIGRATION)
    await db.query(v499.migration)
    await db.query(V500)
    await db.query(`CREATE TABLE public.org_staff (id bigint PRIMARY KEY, max_running_zalo_web_accounts integer)`)
    for (const m of [v501, v503, v504, v505, v506, v507, v508, v509]) await db.query(m.migration)
    const val = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0] || {})[0]
    const classify = (code, action, phase, kind = 'fly_command') => val(`SELECT cs.error_code FROM public.aka_agent_engine_classify_signal('zalo', $1, $2,
      jsonb_build_object('kind', $4::text, 'code', $3::text)) cs`, [action, phase, code, kind])
    const policy = (code, action, rt, phase) => val(`SELECT public.aka_agent_engine_resolve_policy($1, NULL, $2, NULL, $3, $4)`, [code, action, rt, phase])
    const { NET01, NET03, UNK01 } = v512

    // Ô kiểm: [mã lệnh, thao tác, pha, trước V512, sau V512]
    const cells = [
      // Lệnh đọc không có kết quả: trước là "không rõ đã tới" (data bị đóng dưới thao tác nhắn tin), sau là chưa gửi.
      ['command_result_unknown', 'zalo_find_phone_user', 'before_send', UNK01, NET03],
      ['command_result_unknown', 'zalo_message_stranger', 'before_send', UNK01, NET03],
      ['command_dispatch_failed', 'zalo_message_friend', 'before_send', UNK01, NET03],
      // Thao tác gửi giữ nguyên (không rõ đã tới).
      ['command_result_unknown', 'zalo_message_stranger', 'in_flight', UNK01, UNK01],
      ['command_dispatch_failed', 'zalo_message_group', 'in_flight', UNK01, UNK01],
      ['campaign_media_timeout', 'zalo_message_stranger', 'in_flight', UNK01, UNK01],
      // Gắn tag / đổi tên không rõ kết quả: như Desktop treo tới hạn bước (NET01).
      ['command_result_unknown', 'zalo_tag_contact', 'in_flight', UNK01, NET01],
      ['command_result_unknown', 'zalo_change_alias', 'in_flight', UNK01, NET01],
      ['command_dispatch_failed', 'zalo_tag_contact', 'in_flight', UNK01, NET01],
      // Hai tín hiệu chỉ Fly có.
      ['runtime_payload_invalid', 'zalo_message_stranger', 'before_send', NET01, NET03],
      ['runtime_label_session_reset', 'zalo_message_stranger', 'before_send', NET01, NET03],
      ['runtime_label_session_reset', 'zalo_tag_contact', 'in_flight', UNK01, UNK01],
      // Mã cũ không đổi.
      ['campaign_runtime_unavailable', 'zalo_message_stranger', 'before_send', NET03, NET03],
      ['zalo_command_timeout', 'zalo_find_phone_user', 'before_send', NET03, NET03],
      ['campaign_media_download_failed', 'zalo_message_stranger', 'before_send', 'err_media_file_missing', 'err_media_file_missing']
    ]
    const check = async (label, index) => {
      for (const cell of cells) assert.equal(await classify(cell[0], cell[1], cell[2]), cell[index], `${label}: ${cell.slice(0, 3).join(' × ')}`)
    }

    // ---- 1. Trước V512 ---------------------------------------------------------------------------------------------------
    await check('trước V512', 3)
    // Tín hiệu Desktop phát (mã Zalo, câu lỗi, errno, quá giờ) không được đổi theo V512.
    const desktopSignals = [['122', 'zalo_message_stranger', 'after_send', 'zalo_code'], ['fetch failed', 'zalo_message_stranger', 'in_flight', 'message_like'],
      ['ECONNREFUSED', 'zalo_find_phone_user', 'before_send', 'errno'], ['resolve', 'zalo_tag_contact', 'before_send', 'timeout']]
    const desktopBefore = []
    for (const [code, action, phase, kind] of desktopSignals) desktopBefore.push(await classify(code, action, phase, kind))
    pass('trước V512: lệnh đọc không có kết quả là UNK01 (data bị đóng mà chưa gửi), tag / đổi tên không rõ là UNK01')

    // ---- 2. Kết quả thật mà phân loại dẫn tới (chính sách) ---------------------------------------------------------------
    // Lệnh đọc dưới thao tác nhắn tin: UNK01 đóng data (không gửi lại) dù chưa gửi gì; NET03 trả data về hàng đợi.
    const unk = await policy(UNK01, 'zalo_message_stranger', 'fly', 'before_send')
    const net03 = await policy(NET03, 'zalo_message_stranger', 'fly', 'before_send')
    assert.equal(unk.target_effect, 'complete')
    assert.equal(net03.target_effect, 'requeue')
    assert.equal(net03.quota_effect, 'no_count')
    // Tag / đổi tên: Fly (in_flight, NET01) ra cùng kết quả với Desktop treo tới hạn bước (quá giờ trước khi gửi → NET01).
    for (const action of v512.AUX) {
      const fly = await policy(NET01, action, 'fly', 'in_flight'), desktop = await policy(NET01, action, 'desktop', 'before_send')
      const pick = p => [p.run_effect, p.campaign_effect, p.quota_effect, p.target_streak_effect, p.lock_action_codes, p.lock_mode, p.lock_minutes]
      assert.deepEqual(pick(fly), pick(desktop), `${action}: Fly như Desktop`)
      assert.equal(fly.run_effect, 'end_unit')
      assert.equal(fly.quota_effect, 'no_count')
      assert.equal(fly.target_streak_effect, 'ignore')
    }
    pass('chính sách: lệnh đọc NET03 trả data về hàng đợi (UNK01 đóng data); tag / đổi tên trên Fly ra cùng NET01 với Desktop (kết thúc lượt, khoá thao tác, không tính lượt, không đếm chuỗi)')

    // ---- 3. Apply / chặn chạy lại / gỡ / apply lại ------------------------------------------------------------------------
    await db.query(v512.migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    await check('apply rồi ROLLBACK', 3)
    const t0 = Date.now()
    await db.query(v512.migration)
    const applyMs = Date.now() - t0
    await check('sau V512', 4)
    assert.equal(Number(await val(`SELECT count(*) FROM public.auto_outcome_signal_rules WHERE source = 'v512'`)), v512.RULES.length)
    for (const [i, [code, action, phase, kind]] of desktopSignals.entries()) {
      assert.equal(await classify(code, action, phase, kind), desktopBefore[i], `tín hiệu Desktop ${kind} ${code} không đổi`)
    }
    assert.equal(desktopBefore[3], NET01, 'Desktop: tag treo tới hạn bước là NET01')
    await assert.rejects(db.query(v512.migration), /đã có luật source v512/)
    await db.query('ROLLBACK')
    await db.query(v512.rollback)
    await check('sau khi gỡ', 3)
    await assert.rejects(db.query(v512.rollback), /chưa có V512/)
    await db.query('ROLLBACK')
    await db.query(v512.migration)
    await check('apply lại', 4)
    pass(`apply trong transaction rồi ROLLBACK không đổi gì; apply thật (${applyMs} ms) chỉ đổi đúng ${cells.filter(c => c[3] !== c[4]).length}/${cells.length} ô kiểm (postflight: mọi ô khác, chính sách và lint giữ nguyên); chạy lại bị chặn; gỡ trả đúng; apply lại được`)
  } finally {
    await db.end().catch(() => {})
    stop()
  }
  console.log(`OK V512: ${checks} nhóm kiểm`)
}

main().catch(error => { console.error(error); process.exit(1) })
