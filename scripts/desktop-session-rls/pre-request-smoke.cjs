// Reproduce the JWT-role PostgREST pre-request boundary in real PostgreSQL.
// Uses captured function source and synthetic headers; never contacts production.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createFixture } = require('./full-fixture.cjs')
const { generateRollback, snapshot } = require('./rollback.cjs')
const f = createFixture(), { sql, quote: q, root } = f
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const captured = JSON.parse(read('migrations/snapshots/desktop-session-rls/pre-request-preflight.json'))
const hook = 'public.aka_agent_block_denied_ip_request()'
const migration = read('supabase/migrations/20261027134745_desktop_session_pre_request_permission.sql')
const innerMigration = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const safeHeaders = { 'cf-connecting-ip': '203.0.113.9' }
let checks = 0
function pass(name) { checks++; console.log('PASS', name) }
function request(role, headers, query = '') {
  return sql(`BEGIN READ ONLY; SET LOCAL ROLE ${role};
    DO $$ BEGIN PERFORM set_config('request.headers', ${q(JSON.stringify(headers))}, true); END $$;
    SELECT ${hook}; ${query} ROLLBACK;`)
}
function state() {
  return JSON.parse(sql(`SELECT jsonb_build_object(
    'definition',pg_get_functiondef(p.oid),'checksum',md5(pg_get_functiondef(p.oid)),
    'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
    'volatility',p.provolatile,'config',p.proconfig,'acl',p.proacl::text)
    FROM pg_proc p WHERE oid=${q(hook)}::regprocedure;`))
}
try {
  // This gateway dependency is not a client RPC and references no business table.
  sql(`${captured.function.definition};
    REVOKE ALL ON FUNCTION ${hook} FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION ${hook} TO anon,authenticated,service_role;
    ALTER ROLE authenticator SET pgrst.db_pre_request='public.aka_agent_block_denied_ip_request';`)
  assert.equal(state().checksum, captured.function.checksum)
  assert.equal(state().acl, captured.function.acl)
  sql(f.localActivation(read('supabase/migrations/20261027095004_desktop_session_identity.sql')))
  const original = state()
  const orgRead = 'SELECT id,name FROM public.org_organization LIMIT 0;'
  assert.throws(() => request('aka_agent_desktop', safeHeaders, orgRead), /permission denied for function aka_agent_block_denied_ip_request/)
  pass('Stage A alone reproduces the reported permission error before the organization query')
  request('anon', safeHeaders, orgRead)
  pass('legacy anonymous request remains permitted')
  sql(migration)
  for (const headers of [safeHeaders, {}, { 'x-real-ip': 'invalid' }, { 'x-forwarded-for': '203.0.113.8, 203.0.113.9' }])
    request('aka_agent_desktop', headers, orgRead)
  pass('hotfix permits the token request and organization read with unchanged header parsing')
  const fixed = state()
  const { acl: oldAcl, ...oldDefinition } = original
  const { acl: newAcl, ...newDefinition } = fixed
  assert.deepEqual(newDefinition, oldDefinition)
  assert.equal(newAcl, oldAcl.slice(0,-1) + ',aka_agent_desktop=X/postgres}')
  pass('only Desktop EXECUTE is added; function source, properties and all legacy grants stay intact')
  for (const [name, headers] of [
    ['blocked IPv4', { 'cf-connecting-ip': '14.254.197.100' }],
    ['blocked mapped IPv6', { 'cf-connecting-ip': '::ffff:14.254.197.100' }],
    ['blocked real IP', { 'cf-connecting-ip': '203.0.113.9', 'x-real-ip': '14.254.197.100' }],
    ['blocked forwarded hop despite another header', { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.8, 14.254.197.100' }]
  ]) {
    for (const role of ['aka_agent_desktop','anon','authenticated','service_role'])
      assert.throws(() => request(role, headers), /Access denied/)
    pass(name + ' remains rejected for token and legacy roles')
  }
  sql(migration)
  assert.deepEqual(state(), fixed)
  pass('reapplying the additive grant is idempotent')
  for (const [name, drift] of [
    ['function property', `ALTER FUNCTION ${hook} IMMUTABLE;`],
    ['ACL', `GRANT EXECUTE ON FUNCTION ${hook} TO aka_agent_chat_api;`],
    ['gateway hook', 'ALTER ROLE authenticator RESET pgrst.db_pre_request;']
  ]) {
    assert.throws(() => sql(`BEGIN; ${drift}\n${innerMigration}\nROLLBACK;`), /drift/)
    assert.deepEqual(state(), fixed)
    pass(name + ' drift aborts the hotfix without persisting changes')
  }
  sql("SET aka_agent.desktop_rls_cutover='approved-after-client-update';\n" +
    f.localActivation(read('supabase/migrations/20261027100931_desktop_data_rls_activation.sql')))
  request('aka_agent_desktop', safeHeaders, orgRead)
  request('anon', safeHeaders)
  assert.throws(() => request('anon', safeHeaders, orgRead), /permission denied for table org_organization/)
  assert.deepEqual(state(), fixed)
  pass('local Stage B preserves the gateway hook for Desktop and public bootstrap while denying anonymous table reads')
  const rollback = generateRollback(snapshot(sql))
  sql("SET aka_agent.desktop_rls_rollback='approved-legacy-access-reopens';\n" + rollback)
  request('aka_agent_desktop', safeHeaders, orgRead)
  request('anon', safeHeaders, orgRead)
  assert.deepEqual(state(), fixed)
  pass('local Stage B rollback preserves the hotfix and legacy IP blocking')
  sql(`REVOKE EXECUTE ON FUNCTION ${hook} FROM aka_agent_desktop;`)
  assert.deepEqual(state(), original)
  assert.throws(() => request('aka_agent_desktop', safeHeaders, orgRead), /permission denied for function/)
  request('anon', safeHeaders, orgRead)
  pass('grant-only rollback restores the captured ACL and reproduces the original token failure')
  console.log(JSON.stringify({ checks, status: 'passed' }))
} finally { f.close() }
