// Real PostgreSQL and captured RPC bodies; fake Vault and a local pg_net sink.
// No production secret values, network calls or email delivery are involved.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createFixture } = require('./full-fixture.cjs')
const { snapshot, generateRollback } = require('./rollback.cjs')
const f = createFixture(), { sql, quote: q, root } = f
const read = name => fs.readFileSync(path.join(root, name), 'utf8')
const capture = JSON.parse(read('migrations/snapshots/desktop-session-rls/vault-helper-preflight.json'))
const signature = 'public.aka_agent_get_vault_secret(text)'
const stageA = f.localActivation(read('supabase/migrations/20261027095004_desktop_session_identity.sql'))
const stageB = f.localActivation(read('supabase/migrations/20261027100931_desktop_data_rls_activation.sql'))
const withoutTransaction = source => source.replace(/^BEGIN;\n/m, '').replace(/^COMMIT;\n/m, '')
const asRole = (role, query) => sql(`BEGIN; SET LOCAL ROLE ${role}; ${query}; ROLLBACK;`)
const readSecret = role => asRole(role, "SELECT public.aka_agent_get_vault_secret('INTERNAL_EDGE_FUNCTION_TOKEN')='local-only-worker-token'")
const functionState = () => JSON.parse(sql(`SELECT jsonb_agg(jsonb_build_object(
  'signature',p.oid::regprocedure::text,'checksum',md5(pg_get_functiondef(p.oid)),
  'owner',pg_get_userbyid(p.proowner),'security',p.prosecdef,'volatility',p.provolatile,'config',p.proconfig)
  ORDER BY p.oid::regprocedure::text) FROM pg_proc p WHERE p.oid IN (
  '${signature}'::regprocedure,'public.aka_agent_call_email_notification_worker(text,text)'::regprocedure,
  'public.aka_agent_sheet_dispatch()'::regprocedure);`))
let checks = 0
const pass = message => { checks++; console.log('PASS', message) }
try {
  sql(`CREATE SCHEMA vault;
    CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text);
    INSERT INTO vault.decrypted_secrets VALUES
      ('INTERNAL_EDGE_FUNCTION_TOKEN','local-only-worker-token'),
      ('AKA_AGENT_EMAIL_NOTIFICATION_WORKER_URL','https://example.invalid/local-only-worker');
    CREATE ROLE vault_public_probe;
    CREATE SCHEMA net;
    CREATE TABLE net.local_requests(id bigserial PRIMARY KEY,url text,headers jsonb,body jsonb,timeout_ms integer);
    CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer DEFAULT 1000)
      RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO net.local_requests(url,headers,body,timeout_ms)
        VALUES($1,$2,$3,$4) RETURNING id;
      $$;
    REVOKE ALL ON FUNCTION net.http_post(text,jsonb,jsonb,integer) FROM PUBLIC;`)
  const originalFunctions = functionState()
  assert.equal(originalFunctions.find(row => row.signature === 'aka_agent_get_vault_secret(text)').checksum, capture.source_checksum)
  assert.equal(capture.source_checksum, capture.target_checksum)
  pass('local helper exactly matches the live metadata capture')

  for (const role of ['anon', 'authenticated', 'vault_public_probe']) assert.equal(readSecret(role), 't')
  sql(stageA)
  for (const role of ['anon', 'authenticated', 'vault_public_probe', 'aka_agent_desktop']) assert.equal(readSecret(role), 't')
  const prepared = snapshot(sql)
  pass('A preserves legacy access; the new token role keeps existing permissions')

  assert.throws(() => sql(stageB), /explicit approval AFTER client updates/)
  assert.deepEqual(snapshot(sql), prepared)
  pass('B cannot revoke access without the separate activation flag')

  const drift = change => sql(`BEGIN; ${change};
    SET LOCAL aka_agent.desktop_rls_cutover='approved-after-client-update';
    ${withoutTransaction(stageB)} ROLLBACK;`)
  assert.throws(() => drift(`REVOKE EXECUTE ON FUNCTION ${signature} FROM anon`), /Desktop RLS RPC drift: public.aka_agent_get_vault_secret/)
  assert.deepEqual(snapshot(sql), prepared)
  pass('B rejects a changed Vault ACL before changing any permissions')
  assert.throws(() => drift(`ALTER FUNCTION ${signature} SET statement_timeout='1s'`), /Desktop RLS RPC drift: public.aka_agent_get_vault_secret/)
  assert.deepEqual(snapshot(sql), prepared)
  pass('B rejects changed helper behavior/configuration without overwriting it')

  sql("SET aka_agent.desktop_rls_cutover='approved-after-client-update';\n" + stageB)
  for (const role of ['anon', 'authenticated', 'vault_public_probe']) {
    assert.equal(sql(`SELECT has_function_privilege(${q(role)},${q(signature)},'EXECUTE');`), 'f')
    assert.throws(() => readSecret(role), /permission denied for function aka_agent_get_vault_secret/)
  }
  pass('B blocks anon, authenticated and PUBLIC-only callers from the Vault helper')
  for (const role of ['service_role', 'aka_agent_chat_api', 'crm_interest_worker', 'aka_agent_desktop']) {
    assert.equal(readSecret(role), 't')
  }
  pass('trusted callers and the logged-in token role retain their previous effective rights')

  assert.equal(sql(`BEGIN;
    INSERT INTO public.auto_data_group_sheet_worker_state(id,enabled,next_dispatch_at)
      VALUES(true,true,now()-interval '1 minute');
    INSERT INTO public.auto_data_group_external_sync_sources(id,is_enabled,is_delete,status,next_run_at)
      VALUES(1,true,false,'pending',now()-interval '1 minute');
    DO $$ BEGIN
      IF public.aka_agent_sheet_dispatch() IS NULL THEN RAISE EXCEPTION 'local dispatch did not run'; END IF;
    END $$;
    SELECT count(*)=1 AND bool_and(
      r.headers->>'x-internal-token'='local-only-worker-token'
      AND r.body->>'token'=s.token::text AND r.timeout_ms=120000)
    FROM net.local_requests r CROSS JOIN public.auto_data_group_sheet_worker_state s;
    ROLLBACK;`), 't')
  pass('unchanged Sheet dispatcher reads Vault and queues the same authenticated request into the local sink')

  // The real email caller resolves both Vault entries before its pg_net guard.
  // No extension is installed, so this deliberately does not test email delivery.
  assert.equal(sql("SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_net');"), 'f')
  assert.equal(asRole('service_role', "SELECT public.aka_agent_call_email_notification_worker('process','fixture') IS NULL"), 't')
  pass('unchanged email caller still resolves Vault and reaches its local extension guard')
  assert.deepEqual(functionState(), originalFunctions)
  pass('Vault, Sheet and email RPC definitions, owners, security modes and settings stay unchanged')

  const activated = snapshot(sql), rollback = generateRollback(activated)
  assert.throws(() => sql(`BEGIN; GRANT EXECUTE ON FUNCTION ${signature} TO anon;
    SET LOCAL aka_agent.desktop_rls_rollback='approved-legacy-access-reopens';
    ${withoutTransaction(rollback)} ROLLBACK;`), /Desktop rollback drift/)
  assert.deepEqual(snapshot(sql), activated)
  sql("SET aka_agent.desktop_rls_rollback='approved-legacy-access-reopens';\n" + rollback)
  assert.deepEqual(snapshot(sql), prepared)
  for (const role of ['anon', 'authenticated', 'vault_public_probe', 'aka_agent_desktop']) assert.equal(readSecret(role), 't')
  pass('guarded rollback detects helper drift and explicitly restores the exact prepared access')
  console.log(JSON.stringify({ checks, status: 'passed', sourceChecksum: capture.source_checksum, targetChecksum: capture.target_checksum }))
} finally { f.close() }
