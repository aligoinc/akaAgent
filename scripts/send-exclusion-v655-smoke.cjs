#!/usr/bin/env node
// Kiểm V655 (chặn tham số sai kiểu) trên PostgreSQL cục bộ: apply, chạy lại bị từ chối, gỡ trả đúng thân V654/V573, apply lại.
// Chạy: PG_MODULE_DIR=<thư mục có node_modules/pg> node scripts/send-exclusion-v655-smoke.cjs
'use strict'
const assert = require('node:assert/strict')
const { buildDb, read } = require('./send-exclusion-v654-fixture.cjs')
const SIGS = ['public.aka_agent_send_exclusion_v2(bigint,bigint,text,jsonb,text,text)', 'public.aka_agent_internal_validate_send_exclusion_selection(jsonb,bigint,bigint,bigint)',
  'public.aka_agent_internal_validate_send_exclusion_rules(jsonb,bigint,bigint,bigint)']
async function main() {
  const { db, one, stop, applyV654 } = await buildDb()
  const bodies = async () => Object.fromEntries(await Promise.all(SIGS.map(async s => [s, (await one('SELECT md5(prosrc) m FROM pg_proc WHERE oid=to_regprocedure($1)', [s])).m])))
  try {
    await applyV654()
    const before = await bodies()
    const mig = read('migrations/migration_v655_send_exclusion_input_guards.sql'), rb = read('migrations/rollback_v655_send_exclusion_input_guards.sql')
    await db.query(mig)
    const after = await bodies()
    for (const s of SIGS) assert.notEqual(after[s], before[s], s)
    console.log('  ✓ apply V655')
    await assert.rejects(db.query(mig), /V655: thân/); await db.query('ROLLBACK').catch(() => {})
    console.log('  ✓ chạy lại bị từ chối')
    await db.query(`SET request.jwt.claims='{"role":"service_role"}'`)
    await db.query(`INSERT INTO org_organization VALUES(10); INSERT INTO org_staff(id,organization_id,name,username,password,is_active) VALUES(1,10,'a','a','p',true);
      INSERT INTO auto_accounts(id,name,staff_id,organization_id,flatform_type,is_delete) VALUES(100,'Z',1,10,'zalo',false);
      INSERT INTO category_type(id,namespace,code) VALUES(1,'common','zalo_friend_status');
      INSERT INTO category_item(id,category_type_id,code,name,is_active) VALUES(1,1,'friend','Bạn bè',true)`)
    const fid = (await one(`SELECT id FROM auto_filter_fields WHERE code='zalo_friend_status'`)).id, oid = (await one(`SELECT id FROM auto_filter_operators WHERE code='equals'`)).id
    for (const [opName, payload, code] of [['options', { accountId: 1.5 }, 'account_not_found'], ['options', { accountId: 1e30 }, 'account_not_found'],
      ['save', { requestId: 'abc', name: 'x', revision: 0, blocks: [{ accountId: 100, matchMode: 'or', rules: [{ fieldId: Number(fid), operatorId: Number(oid), value: 'friend', isEnabled: true, sortOrder: 0 }] }] }, 'request_id_required'],
      ['save', { name: 'x', revision: 0, blocks: [{ accountId: 100.5, matchMode: 'or', rules: [] }] }, 'blocks_invalid'],
      ['save', { id: 1.5, name: 'x', revision: 0, blocks: [{ accountId: 100, matchMode: 'or', rules: [{ fieldId: Number(fid), operatorId: Number(oid), value: 'friend', isEnabled: true, sortOrder: 0 }] }] }, 'group_not_found'],
      ['save', { requestId: '0b3a6f3e-1c1f-4b6e-9a3e-3c2b1a0f9e8d', name: 'x', revision: 0, blocks: [{ accountId: 100, matchMode: 'or', rules: [{ fieldId: 'a', operatorId: Number(oid), value: 'friend', isEnabled: true, sortOrder: 1.5 }] }] }, 'rules_invalid']]) {
      const err = await db.query(`SELECT aka_agent_send_exclusion_v2(1,10,$1,$2,NULL,NULL)`, [opName, JSON.stringify(payload)]).then(() => null, e => e.message)
      assert.match(String(err), new RegExp('send_exclusion_' + code), `${opName} ${JSON.stringify(payload).slice(0, 80)}: ${err}`)
    }
    console.log('  ✓ tham số sai kiểu trả mã send_exclusion_*')
    await db.query(rb)
    assert.deepEqual(await bodies(), before)
    console.log('  ✓ gỡ trả đúng thân hàm trước V655')
    await db.query(mig)
    assert.deepEqual(await bodies(), after)
    console.log('  ✓ apply lại sau khi gỡ')
  } finally { await stop() }
}
main().catch(e => { console.error(e); process.exit(1) })
