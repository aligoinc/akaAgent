// Reuse Chat API's disposable PostgreSQL harness; never accept a production URL.
// AKA_CHAT_API_REPO=/path/to/akaAgentChatApi node scripts/app-access-guard-performance-test.mjs
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = resolve(agentRoot, 'migrations/snapshots/app-access-guard-performance');
const quote = value => '"' + value.replaceAll('"', '""') + '"';

export async function verifyGuardPerformance({ db }) {
  const { functions } = JSON.parse(await readFile(resolve(snapshot, 'baseline.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(snapshot, 'manifest.json'), 'utf8'));
  const migration = await readFile(resolve(agentRoot, 'migrations/migration_v454_app_access_guard_performance.sql'), 'utf8');
  const rollback = await readFile(resolve(snapshot, 'rollback.sql'), 'utf8');
  const changed = manifest.changedFunctions.map(f => functions.find(b => b.signature === f.signature));
  let passed = 0;
  // Install the exact current entrypoints in the existing synthetic fixture.
  // All grants below are local fixture setup, never migration statements.
  await db.query('ALTER TABLE auto_campaigns ADD COLUMN IF NOT EXISTS action_id text');
  for (const f of functions) {
    await db.query(f.definition);
    const existingGrantees = (await db.query(`SELECT DISTINCT pg_get_userbyid(a.grantee) role
      FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid=$1::regprocedure AND a.grantee<>0 AND a.grantee<>p.proowner`, [f.signature])).rows;
    for (const {role} of existingGrantees) await db.query(`REVOKE ALL ON FUNCTION ${f.signature} FROM ${quote(role)}`);
    await db.query(`REVOKE ALL ON FUNCTION ${f.signature} FROM PUBLIC`);
    for (const entry of f.acl.slice(1, -1).split(',')) {
      const role = entry.split('=')[0];
      if (!(await db.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) await db.query(`CREATE ROLE ${quote(role)}`);
      await db.query(`GRANT EXECUTE ON FUNCTION ${f.signature} TO ${quote(role)}`);
    }
  }
  // SQL function definitions are copied only from the current capture.
  for (let i = 0; i < changed.length; i++) {
    let definition = changed[i].definition.replace(/FUNCTION (?:public|private)\.\w+\(/, `FUNCTION private.v454_baseline_${i}(`);
    if (i === 2) definition = definition.replaceAll('public.aka_agent_app_access_account_allowed(', 'private.v454_baseline_1(');
    await db.query(definition);
    const signature = changed[i].signature.replace(/^(?:private\.)?\w+/, `private.v454_baseline_${i}`);
    await db.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${signature} TO service_role,aka_agent_chat_api,aka_agent_desktop`);
  }
  await db.query(`GRANT USAGE ON SCHEMA private TO service_role,aka_agent_chat_api;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT EXECUTE ON FUNCTION private.v454_baseline_2(bigint,bigint,bigint) TO pg_read_all_data;
    CREATE INDEX IF NOT EXISTS auto_accounts_staff_id_idx ON auto_accounts(staff_id);`);
  const metadata = async () => (await db.query(`SELECT oid::regprocedure::text signature,md5(pg_get_functiondef(oid)) md5,
    proowner,proacl::text,prosecdef,provolatile,proparallel,proleakproof,proisstrict,procost,prorows,proconfig
    FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY 1`, [functions.map(f => f.signature)])).rows;
  const before = await metadata();
  for (const f of functions) assert.equal(before.find(b => b.signature === f.signature).md5, f.md5, f.signature);
  await db.query(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'));
  assert.deepEqual(await metadata(), before); passed++;
  for (const drift of [
    'ALTER FUNCTION private.app_access_held(text,bigint) COST 1',
    'GRANT EXECUTE ON FUNCTION aka_agent_app_access_account_allowed(bigint,text) TO anon',
    'ALTER FUNCTION aka_agent_get_zalo_server_run_control_state(bigint,bigint,bigint) SECURITY DEFINER',
    'ALTER FUNCTION private.app_access_packages(bigint,text,text) SET search_path=public'
  ]) {
    await db.query('BEGIN'); await db.query(drift);
    await assert.rejects(db.query(migration), /app_access_perf_preflight_drift/);
    await db.query('ROLLBACK'); assert.deepEqual(await metadata(), before); passed++;
  }
  await db.query(migration);
  const after = await metadata();
  for (const f of after) {
    const expected = manifest.changedFunctions.find(m => m.signature === f.signature);
    assert.equal(f.md5, expected?.targetMd5 ?? before.find(b => b.signature === f.signature).md5);
    assert.deepEqual({ ...f, md5: before.find(b => b.signature === f.signature).md5 }, before.find(b => b.signature === f.signature));
  }
  passed++;
  await assert.rejects(db.query(migration), /app_access_perf_preflight_drift/); await db.query('ROLLBACK'); passed++;
  await db.query(rollback); assert.deepEqual(await metadata(), before); passed++;
  await db.query(migration); assert.deepEqual(await metadata(), after); passed++;

  // Isolated fixture; changing claim/status fields below never reaches a runtime.
  await db.query(`INSERT INTO org_organization(id,staff_admin_id,max_staff,use_staff_expiration) VALUES(880,8801,50,true),(881,8811,50,false);
    INSERT INTO org_staff(id,organization_id,username,password,is_admin,expiration_date) VALUES
      (8801,880,'v454-owner','fixture',true,now()+interval '1 year'),(8802,880,'v454-peer','fixture',false,now()+interval '1 year'),
      (8811,881,'v454-legacy','fixture',true,NULL);
    INSERT INTO org_organization_product(organization_id,product_id,max_staff,max_accounts,expiration_date) VALUES
      (880,16,50,50,now()+interval '1 year'),(880,3,50,50,now()+interval '1 year'),
      (880,5,50,50,now()+interval '1 year'),(881,16,50,50,now()+interval '1 year');
    UPDATE org_staff SET is_aka_agent_enabled=true,is_akachat_enabled=true WHERE organization_id IN (880,881);
    INSERT INTO auto_accounts(id,organization_id,staff_id,is_aka_agent_enabled,is_akachat_enabled,login_status,status) VALUES
      (88001,880,8801,true,true,'đã đăng nhập','chờ xử lý'),(88002,880,8802,true,true,'đã đăng nhập','chờ xử lý'),
      (88101,881,8811,false,false,'đã đăng nhập','chờ xử lý');
    INSERT INTO auto_campaigns(id,organization_id,staff_id,account_id,action_id,status) VALUES
      (880001,880,8801,88001,'zalo_send_message','chờ xử lý'),(880002,880,8802,88002,'zalo_send_message','chờ xử lý'),
      (881001,881,8811,88101,'zalo_send_message','chờ xử lý');`);
  const accountParity = async () => {
    const r = await db.query(`SELECT count(*)::int n FROM auto_accounts a
      CROSS JOIN (VALUES ('akaAgent'),('akaChat'),('unknown'),(NULL)) app(name)
      WHERE public.aka_agent_app_access_account_allowed(a.id,app.name) IS DISTINCT FROM private.v454_baseline_1(a.id,app.name)`);
    assert.equal(r.rows[0].n, 0); passed++;
  };
  const heldParity = async () => {
    const r = await db.query(`SELECT count(*)::int n FROM (
      SELECT 'account'::text kind,id FROM auto_accounts UNION ALL SELECT 'staff',id FROM org_staff
      UNION ALL SELECT 'unknown',88001 UNION ALL SELECT NULL,8801 UNION ALL SELECT 'account',NULL
      UNION ALL SELECT 'staff',-1) x
      WHERE private.app_access_held(kind,id) IS DISTINCT FROM private.v454_baseline_0(kind,id)`);
    assert.equal(r.rows[0].n, 0); passed++;
  };
  const controlParity = async () => {
    for (const ids of [[880001,88001,8801],[880002,88002,8802],[881001,88101,8811],
      [880001,88001,8802],[880001,88002,8801],[880001,88101,8811],[999999,88001,8801]]) {
      const current = (await db.query('SELECT * FROM aka_agent_get_zalo_server_run_control_state($1,$2,$3)', ids)).rows;
      const old = (await db.query('SELECT * FROM private.v454_baseline_2($1,$2,$3)', ids)).rows;
      assert.deepEqual(current, old, JSON.stringify(ids)); passed++;
    }
  };
  const variants = [
    '',
    'UPDATE org_staff SET is_active=false WHERE id=8801',
    "UPDATE org_staff SET expiration_date=now()-interval '2 days' WHERE id=8801",
    'UPDATE org_staff SET deleted_at=now() WHERE id=8801',
    'UPDATE org_staff SET is_aka_agent_enabled=false WHERE id=8801',
    'UPDATE org_staff SET is_akachat_enabled=false WHERE id=8801',
    'UPDATE auto_accounts SET is_aka_agent_enabled=false WHERE id=88001',
    'UPDATE auto_accounts SET is_akachat_enabled=false WHERE id=88001',
    'UPDATE auto_accounts SET organization_id=NULL WHERE id=88001',
    'UPDATE auto_accounts SET organization_id=881 WHERE id=88001',
    'UPDATE auto_campaigns SET organization_id=881 WHERE id=880001',
    'UPDATE auto_accounts SET is_delete=true WHERE id=88001',
    'UPDATE auto_campaigns SET is_delete=true WHERE id=880001',
    'UPDATE auto_accounts SET is_active=false WHERE id=88001',
    "UPDATE auto_accounts SET login_status='chưa đăng nhập' WHERE id=88001",
    "UPDATE auto_campaigns SET status='đang chạy' WHERE id=880001",
    "UPDATE auto_accounts SET status='đang chạy' WHERE id=88001",
    "UPDATE auto_accounts SET runtime_operation_claim_token='00000000-0000-4000-8000-000000000454' WHERE id=88001",
    "UPDATE auto_campaigns SET runtime_claim_token='00000000-0000-4000-8000-000000000454',is_delete=true WHERE id=880001",
    "UPDATE auto_campaigns SET runtime_unit_token='00000000-0000-4000-8000-000000000454' WHERE id=880001; UPDATE org_staff SET expiration_date=now()-interval '2 days' WHERE id=8801",
    "UPDATE auto_campaigns SET secondary_account_id=88002,runtime_unit_token='00000000-0000-4000-8000-000000000454' WHERE id=880001",
    'UPDATE auto_accounts SET is_zalo_server=false WHERE id=88001',
    'UPDATE auto_accounts SET is_zalo_show_web=true,is_akachat_enabled=false WHERE id=88001',
    "UPDATE auto_accounts SET flatform_type='facebook',is_akachat_enabled=false WHERE id=88001",
    "UPDATE auto_accounts SET flatform_type=NULL,is_akachat_enabled=false WHERE id=88001",
    "UPDATE org_organization_product SET expiration_date=now()-interval '2 days' WHERE organization_id=880 AND product_id=16",
    "UPDATE org_organization_product SET is_deleted=true WHERE organization_id=880 AND product_id=5",
    'UPDATE org_organization SET use_staff_expiration=false WHERE id=880; UPDATE org_staff SET expiration_date=NULL WHERE id=8801',
    'UPDATE org_staff SET is_active=false,is_aka_agent_enabled=false WHERE id=8811'
  ];
  for (const sql of variants) {
    await db.query('BEGIN');
    if (sql) {
      try { await db.query(sql); } catch (error) { throw new Error(`Fixture variant failed: ${sql}`, {cause:error}); }
    }
    await accountParity(); await heldParity(); await controlParity();
    await db.query('ROLLBACK');
  }
  for (const role of ['service_role','aka_agent_chat_api','aka_agent_desktop']) {
    await db.query(`BEGIN; SET LOCAL ROLE ${role}; SET LOCAL fixture.staff='8801'`);
    await controlParity(); await accountParity(); await db.query('ROLLBACK');
  }
  for (const role of ['anon','authenticated']) {
    await db.query(`BEGIN; SET LOCAL ROLE ${role}`);
    await assert.rejects(db.query("SELECT aka_agent_app_access_account_allowed(88001,'akaAgent')"), /permission denied/);
    await db.query('ROLLBACK'); passed++;
  }
  // The legacy fast path must not bypass the old helper's EXECUTE boundary.
  for (const signature of ['aka_agent_get_zalo_server_run_control_state','private.v454_baseline_2']) {
    await db.query('BEGIN; SET LOCAL ROLE pg_read_all_data');
    await assert.rejects(db.query(`SELECT * FROM ${signature}(881001,88101,8811)`), /permission denied for function (aka_agent_app_access_account_allowed|v454_baseline_1)/);
    await db.query('ROLLBACK'); passed++;
  }
  for (const id of [0,-1,null]) {
    await assert.rejects(db.query('SELECT * FROM aka_agent_get_zalo_server_run_control_state($1,88001,8801)',[id]), /positive integers/); passed++;
  }
  // A generic plan must use existing account/owner indexes, including empty staff.
  await db.query(`INSERT INTO auto_accounts(id,organization_id,staff_id) SELECT 1000000+g,881,8811 FROM generate_series(1,6000) g;
    ANALYZE auto_accounts; SET plan_cache_mode=force_generic_plan`);
  const definition = await readFile(resolve(snapshot,'target-definitions.sql'),'utf8');
  const body = definition.split('AS $function$')[1].split('$function$')[0].replaceAll('p_type','$1').replaceAll('p_id','$2');
  await db.query(`PREPARE v454_plan(text,bigint) AS ${body}`);
  for (const [kind,id,index] of [['staff',8801,'auto_accounts_staff_id_idx'],['account',88001,'auto_accounts_pkey']]) {
    const r = await db.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON,TIMING OFF) EXECUTE v454_plan('${kind}',${id})`);
    const nodes=[]; const walk=n=>{nodes.push(n);for(const child of n.Plans??[])walk(child);};walk(r.rows[0]['QUERY PLAN'][0].Plan);
    assert(nodes.some(n=>n['Index Name']===index && n['Actual Loops']>0)); passed++;
  }
  await db.query('DEALLOCATE v454_plan; RESET plan_cache_mode');
  assert.deepEqual(await metadata(), after); passed++;
  return passed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.env.NODE_ENV !== 'production', 'Local test only');
  const apiRoot = process.env.AKA_CHAT_API_REPO;
  assert(apiRoot, 'Set AKA_CHAT_API_REPO to an existing Chat API checkout');
  const source = await readFile(resolve(apiRoot,'load-tests/app-access.mjs'),'utf8');
  const marker = '  console.log(JSON.stringify({postgres:postgres.backend,passed,';
  assert.equal(source.split(marker).length,2,'Fixture hook changed; inspect before running');
  const wrapper = resolve(apiRoot,`load-tests/.v454-${process.pid}.mjs`);
  const injected = `  const {verifyGuardPerformance} = await import(${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)});\n  const guardPerformancePassed=await verifyGuardPerformance({db});\n  passed+=guardPerformancePassed;\n  console.log(JSON.stringify({guardPerformancePassed}));\n`;
  try {
    await writeFile(wrapper,source.replace(marker,injected+marker),{flag:'wx'});
    const status=await new Promise((done,reject)=>{
      const child=spawn(process.execPath,[wrapper],{cwd:apiRoot,stdio:'inherit',env:{...process.env,AKA_AGENT_REPO:agentRoot}});
      child.once('error',reject);child.once('exit',done);
    });
    process.exitCode=status??1;
  } finally { await unlink(wrapper); }
}
