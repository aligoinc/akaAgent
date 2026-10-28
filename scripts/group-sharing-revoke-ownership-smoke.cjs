// Synthetic local PG17 only. No production connection, customer data or tokens.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const createFixture = require('./desktop-account-ownership-fixture.cjs')
const f = createFixture()
const { sql, quote: q, root, m, tmp, claims, desktop } = f
const dir = path.join(root, 'migrations/snapshots/group-sharing-revoke-ownership')
const capture = JSON.parse(fs.readFileSync(path.join(dir, 'before.json')))
const target = JSON.parse(fs.readFileSync(path.join(dir, 'target.json')))
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20261028042624_group_sharing_revoke_ownership_compat.sql')
const rollback = read('migrations/rollback_group_sharing_revoke_ownership_compat.sql')
const canonical = f => f.signature.startsWith('private.') ? f.signature : 'public.' + f.signature
const source = capture.functions.find(f => f.name === 'aka_agent_group_sharing')
const checks = []
const pass = name => { checks.push(name); console.log('PASS', name) }
const sharing = (scope = 'private', recipients = [], revision = '0', staff = 1, group = 1101, kind = 'data') =>
  `public.aka_agent_group_sharing(${staff},10,${q(staff === 1 ? 'alice' : 'bob')},'fixture-only','save',` +
  `${q(JSON.stringify({ kind, groupId: group, scope, recipientIds: recipients, expectedRevision: revision }))}::jsonb)`
const perform = call => `DO $call$ BEGIN PERFORM ${call}; END $call$;`
const snapshot = `SELECT jsonb_build_object(
 'groups',(SELECT jsonb_agg(jsonb_build_object('id',id,'scope',sharing_scope,'revision',sharing_revision) ORDER BY id) FROM auto_account_contact_groups),
 'recipients',(SELECT jsonb_agg(to_jsonb(r) ORDER BY group_id,staff_id) FROM auto_data_group_recipients r),
 'sources',(SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'reason',stop_reason,'stopped',stopped_at IS NOT NULL) ORDER BY id) FROM auto_campaign_data_group_sources),
 'campaigns',(SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY id)::text) FROM auto_campaigns c),
 'inputs',(SELECT md5(jsonb_agg(to_jsonb(i) ORDER BY id)::text) FROM auto_campaign_input_data i))`
const inspect = statements => JSON.parse(desktop(statements + ' RESET ROLE; ' + snapshot))
const state = () => JSON.parse(sql(snapshot))
const metadata = (skipBody = false) => sql(`SELECT md5(jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,${skipBody ? `CASE WHEN p.oid=${q(canonical(source))}::regprocedure THEN NULL ELSE md5(pg_get_functiondef(p.oid)) END` : 'md5(pg_get_functiondef(p.oid))'},p.proacl,p.proowner,p.proconfig,p.prosecdef,p.provolatile) ORDER BY p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','aka_agent_desktop_internal') AND p.prokind='f'),
 'relations',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relacl,c.relrowsecurity,c.relforcerowsecurity,c.reloptions) ORDER BY c.oid) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private')),
 'columns',(SELECT jsonb_agg(jsonb_build_array(attrelid,attnum,attacl) ORDER BY attrelid,attnum) FROM pg_attribute WHERE attnum>0 AND NOT attisdropped),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_policy p),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(oid,pg_get_triggerdef(oid),tgenabled) ORDER BY oid) FROM pg_trigger WHERE NOT tgisinternal)
 )::text)`)
let holder
async function holdLock(campaignId) {
  const bin = process.env.DESKTOP_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin'
  holder = spawn(path.join(bin, 'psql'), ['-X', '-h', tmp, '-p', '55494', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'])
  let output = '', errors = ''
  holder.stderr.on('data', chunk => { errors += chunk })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('local lock holder did not start: ' + errors)), 5000)
    holder.stdout.on('data', chunk => {
      output += chunk
      if (output.includes('LOCK_READY')) { clearTimeout(timer); resolve() }
    })
    holder.once('error', error => { clearTimeout(timer); reject(error) })
    holder.once('exit', code => { if (!output.includes('LOCK_READY')) { clearTimeout(timer); reject(Error('lock holder exited: ' + code + errors)) } })
  })
  // Use the unchanged public helper from a trusted backend session, proving the
  // new internal lock conflicts with the existing namespace, not a test-only key.
  holder.stdin.write(`BEGIN; SET LOCAL statement_timeout='10s'; SELECT public.aka_agent_lock_campaign_input_serialization(${campaignId}); SELECT 'LOCK_READY';\n`)
  await ready
}
async function releaseLock() {
  if (!holder) return
  const child = holder
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.stdin.end('ROLLBACK;\n\\q\n')
  await exited
  holder = undefined
}

;(async () => {
  try {
    // Restore all real source defaults, constraints and watched-column triggers.
    const relation = m.relations.find(r => r.name === 'auto_campaign_data_group_sources')
    for (const c of relation.columns) {
      if (c.default) sql(`ALTER TABLE auto_campaign_data_group_sources ALTER COLUMN ${c.name} SET DEFAULT ${c.default};`)
      if (c.notnull) sql(`ALTER TABLE auto_campaign_data_group_sources ALTER COLUMN ${c.name} SET NOT NULL;`)
    }
    for (const c of capture.source_constraints) {
      if (sql(`SELECT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='auto_campaign_data_group_sources'::regclass AND conname=${q(c.name)})`) === 'f')
        sql(`ALTER TABLE auto_campaign_data_group_sources ADD CONSTRAINT ${c.name} ${c.definition};`)
    }
    for (const t of capture.source_triggers) sql(`DROP TRIGGER IF EXISTS ${t.name} ON auto_campaign_data_group_sources; ${t.definition};`)
    sql(`INSERT INTO org_organization(id,name,use_staff_expiration) VALUES(10,'Fixture',false),(20,'Other',false);
      INSERT INTO org_staff(id,organization_id,name,username,password,is_active,is_policy_accepted)
      VALUES(1,10,'Alice','alice','fixture-only',true,true),(2,10,'Bob','bob','fixture-only',true,true),(3,10,'Carol','carol','fixture-only',true,true),(4,20,'Outside','outside','fixture-only',true,true);
      INSERT INTO auth.users(id) VALUES('${claims.sub}');
      INSERT INTO private.aka_agent_desktop_users(staff_id,auth_user_id) VALUES(1,'${claims.sub}');
      INSERT INTO auto_accounts(id,staff_id,organization_id,name,flatform_type,is_zalo_server,is_zalo_show_web,is_active,is_delete)
      VALUES(101,1,10,'Own','facebook',false,false,true,false),(102,2,10,'Bob','facebook',false,false,true,false),(103,3,10,'Carol','facebook',false,false,true,false);
      INSERT INTO auto_campaigns(id,staff_id,organization_id,account_id,name,status,is_delete,action_id,data_target_source_mode)
      VALUES(201,1,10,101,'Own','chờ xử lý',false,'facebook_message','data_group'),(202,2,10,102,'Bob active','đang chạy',false,'facebook_message','data_group'),(203,3,10,103,'Carol baselining','chờ xử lý',false,'facebook_message','data_group'),(204,2,10,102,'Bob stopped','tạm dừng',false,'facebook_message','data_group'),(205,2,10,102,'Other group','chờ xử lý',false,'facebook_message','data_group');
      INSERT INTO auto_campaign_inputs(id,campaign_id,name) VALUES(301,202,'Existing input');
      INSERT INTO auto_campaign_input_data(id,campaign_id,input_id,name) VALUES(401,202,301,'Keep this row');
      INSERT INTO auto_account_contact_groups(id,name,staff_id,organization_id,is_delete,purpose,sharing_scope,sharing_revision,revision)
      VALUES(1101,'Owned shared',1,10,false,'data_group','selected',0,0),(1102,'Unrelated',1,10,false,'data_group','selected',0,0),(1103,'Bob owned',2,10,false,'data_group','selected',0,0);
      INSERT INTO auto_data_group_recipients(group_id,staff_id) VALUES(1101,2),(1101,3),(1102,2),(1103,1);
      INSERT INTO auto_campaign_data_group_sources(id,group_id,campaign_id,staff_id,organization_id,status,stop_reason,stopped_at)
      VALUES(1901,1101,202,2,10,'active',NULL,NULL),(1902,1101,203,3,10,'baselining',NULL,NULL),(1903,1101,204,2,10,'stopped','manual',now()),(1904,1102,205,2,10,'active',NULL,NULL),(1905,1101,201,1,10,'active',NULL,NULL);
      INSERT INTO auto_content_groups(id,name,staff_id,organization_id,is_active,is_delete,sharing_scope,sharing_revision)
      VALUES(1201,'Content',1,10,true,false,'selected',0);
      INSERT INTO auto_content_group_recipients(group_id,staff_id) VALUES(1201,2);`)
    sql('BEGIN;' + read('supabase/migrations/20261027183537_desktop_account_campaign_ownership.sql') + 'COMMIT;')
    sql('BEGIN;' + read('supabase/migrations/20261027190936_desktop_block_workflow_readonly.sql') + 'COMMIT;')
    for (const fn of capture.functions) assert.equal(sql(`SELECT md5(pg_get_functiondef(${q(canonical(fn))}::regprocedure))`), fn.checksum)
    const original = state()
    const fullBefore = metadata()
    const unchangedBefore = metadata(true)
    const backendBefore = sql(`BEGIN; SET LOCAL ROLE service_role; SELECT ${sharing()}; ROLLBACK;`)
    const contentBefore = desktop(`SELECT ${sharing('private', [], '0', 1, 1201, 'content')}`)
    for (const call of [sharing(), sharing('selected', [3])]) assert.throws(() => desktop(`SELECT ${call}`), /desktop_campaign_scope_denied/)
    assert.deepEqual(state(), original)
    pass('reproduces private and selected-recipient revocation failure with unchanged live definitions')

    for (const edit of [
      "ALTER FUNCTION public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb) SET statement_timeout='59s';",
      "GRANT EXECUTE ON FUNCTION public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb) TO anon;",
      "ALTER FUNCTION public.aka_agent_lock_campaign_input_serialization(bigint) SET lock_timeout='9s';"
    ]) assert.throws(() => sql('BEGIN;' + edit + migration + 'ROLLBACK;'), /sharing revoke source drift/)
    assert.equal(metadata(), fullBefore)
    sql('BEGIN;' + migration + 'ROLLBACK;')
    assert.equal(metadata(), fullBefore)
    pass('source/dependency/ACL drift fails closed; migration rollback leaves exact original metadata')
    sql('BEGIN;' + migration + 'COMMIT;')
    assert.equal(sql(`SELECT md5(pg_get_functiondef(${q(canonical(target))}::regprocedure))`), target.checksum)
    assert.equal(metadata(true), unchangedBefore)
    assert.throws(() => sql('BEGIN;' + migration + 'ROLLBACK;'), /sharing revoke source drift/)
    pass('only sharing body changes; all helpers, ACLs, timeouts, policies and triggers remain exact')

    const after = inspect(perform(sharing()))
    for (const id of [1901, 1902]) assert.deepEqual(after.sources.find(s => s.id === id), { id, status: 'stopped', reason: 'sharing_revoked', stopped: true })
    for (const id of [1903, 1904, 1905]) assert.deepEqual(after.sources.find(s => s.id === id), original.sources.find(s => s.id === id))
    assert.equal(after.campaigns, original.campaigns); assert.equal(after.inputs, original.inputs)
    assert.deepEqual(after.groups.find(g => g.id === 1101), { id: 1101, scope: 'private', revision: 1 })
    assert.deepEqual(after.recipients.filter(r => r.group_id === 1101), [])
    pass('private scope stops active/baselining recipients only; own source, other groups, terminal sources, campaigns and inputs remain unchanged')

    const selected = inspect(perform(sharing('selected', [3])))
    assert.equal(selected.sources.find(s => s.id === 1901).status, 'stopped')
    assert.equal(selected.sources.find(s => s.id === 1902).status, 'baselining')
    const expanded = inspect(perform(sharing('organization')))
    assert.deepEqual(expanded.sources, original.sources)
    const narrowed = inspect(perform(sharing('organization')) + perform(sharing('selected', [3], '1')))
    assert.equal(narrowed.sources.find(s => s.id === 1901).status, 'stopped')
    assert.equal(narrowed.sources.find(s => s.id === 1902).status, 'baselining')
    const regranted = inspect(perform(sharing()) + perform(sharing('selected', [2, 3], '1')))
    for (const id of [1901, 1902]) assert.equal(regranted.sources.find(s => s.id === id).status, 'stopped')
    pass('selected/organization transitions keep retained recipients; regrant never reactivates stopped sources')

    for (const call of [sharing('private', [], '99'), sharing('selected', [4]), sharing('private', [], '0', 1, 1103), sharing('private', [], '0', 2)])
      assert.throws(() => desktop(`SELECT ${call}`), /conflict|invalid_group_sharing_recipients|group_sharing_owner_required|group_sharing_access_denied/)
    assert.throws(() => desktop(`SELECT ${sharing()}`, {}), /group_sharing_access_denied/)
    assert.deepEqual(state(), original)
    pass('nonowners, foreign credentials, invalid recipients/revisions and unmapped claims cannot revoke sharing')

    assert.throws(() => desktop('SELECT public.aka_agent_lock_campaign_input_serialization(202)'), /desktop_campaign_scope_denied/)
    assert.equal(desktop('SELECT count(*) FROM auto_campaigns WHERE id=202'), '0')
    assert.equal(desktop("WITH changed AS (UPDATE auto_campaigns SET name='attack' WHERE id=202 RETURNING id) SELECT count(*) FROM changed"), '0')
    assert.throws(() => desktop("SELECT append_auto_campaign_log(202,1,'attack')"), /desktop_campaign_scope_denied/)
    assert.equal(sql(`BEGIN; SET LOCAL ROLE service_role; SELECT ${sharing()}; ROLLBACK;`), backendBefore)
    assert.equal(desktop(`SELECT ${sharing('private', [], '0', 1, 1201, 'content')}`), contentBefore)
    assert.equal(sql(`SELECT has_function_privilege('anon',${q(canonical(source))},'EXECUTE')`), 'f')
    pass('direct cross-staff locks/reads/writes/logs and anon stay denied; backend and content-sharing contracts unchanged')

    await holdLock(203)
    assert.throws(() => desktop("SET LOCAL lock_timeout='150ms'; " + perform(sharing())), /lock timeout/)
    assert.deepEqual(state(), original) // Includes first recipient processed before the second lock blocked.
    await releaseLock()
    assert.equal(inspect(perform(sharing())).sources.find(s => s.id === 1902).status, 'stopped')
    pass('same public campaign lock serializes revocation; lock failure atomically rolls back earlier source and sharing writes')

    assert.throws(() => sql('BEGIN;' + rollback + 'ROLLBACK;'), /requires approval/)
    assert.throws(() => sql("BEGIN; SET LOCAL aka_agent.group_sharing_revoke_rollback='approved'; ALTER FUNCTION public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb) SET statement_timeout='59s';" + rollback + 'ROLLBACK;'), /rollback drift/)
    sql("BEGIN; SET LOCAL aka_agent.group_sharing_revoke_rollback='approved';" + rollback + 'COMMIT;')
    assert.equal(metadata(), fullBefore)
    assert.throws(() => desktop(`SELECT ${sharing()}`), /desktop_campaign_scope_denied/)
    pass('explicit guarded rollback restores original body and reproduced bug without metadata drift')
    fs.writeFileSync(path.join(dir, 'local-test.json'), JSON.stringify({ at: new Date().toISOString(), status: 'passed', checks, sourceChecksum: source.checksum, targetChecksum: target.checksum, productionWrites: 0 }, null, 2) + '\n')
    console.log(JSON.stringify({ status: 'passed', checks: checks.length }))
  } finally {
    await releaseLock()
    f.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
