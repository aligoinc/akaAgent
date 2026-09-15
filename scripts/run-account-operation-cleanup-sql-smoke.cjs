// Isolated PostgreSQL only. Never uses Supabase, .env or a production connection.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const pgBin = process.env.AKA_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
if (!fs.existsSync(path.join(pgBin, 'initdb'))) throw new Error('Set AKA_TEST_PG_BIN to a local PostgreSQL bin directory')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-op-pg-'))
const data = path.join(dir, 'data')
const socket = path.join(dir, 'sock')
fs.mkdirSync(socket)
const run = (name, args, options = {}) => execFileSync(path.join(pgBin, name), args, { encoding: 'utf8', ...options })
const connection = ['-h', socket, '-p', '55483', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']
let started = false
try {
  run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale'])
  run('pg_ctl', ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-p 55483 -k ${socket} -c listen_addresses=`, 'start'])
  started = true
  run('psql', [...connection, '-f', path.join(root, 'scripts/fixtures/account-operation-cleanup-postgres.sql')])
  const migration = fs.readFileSync(path.join(root, 'migrations/migration_v283_account_operation_cleanup.sql'), 'utf8')
  const smoke = fs.readFileSync(path.join(root, 'migrations/tests/migration_v283_account_operation_cleanup_smoke.sql'), 'utf8')
  const body = migration.replace('BEGIN;', '').replace('COMMIT;', '')
  // First install, idempotent reapply and behavior all run inside one rollback.
  const result = run('psql', connection, { input: `BEGIN;\n${body}\n${body}\n${smoke.replace('BEGIN;', '')}` })
  assert.match(result, /v283 account operation SQL smoke PASS/)
  const remaining = run('psql', [...connection, '-At', '-c', "SELECT count(*) FROM public.auto_accounts;"])
  assert.equal(remaining.trim(), '0')
  const absent = run('psql', [...connection, '-At', '-c', "SELECT to_regprocedure('public.aka_agent_cleanup_account_operation(bigint,bigint,text,text,text,uuid)') IS NULL;"])
  assert.equal(absent.trim(), 't', 'migration DDL must also roll back')
  let rejected = false
  try {
    run('psql', connection, { input: migration.replace('78d5cdd05a02bdf3b78349e598e9d512', '00000000000000000000000000000000').replace('COMMIT;', 'ROLLBACK;'), stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    rejected = /v283_dependency_changed/.test(String(error.stderr))
  }
  assert.ok(rejected, 'unexpected live definition must fail before DDL')
  console.log('PASS SQL: first install + reapply + ownership/pause/retry/legacy guards; rollback leaves zero fixtures; checksum mismatch rejected')
} finally {
  if (started) run('pg_ctl', ['-D', data, '-m', 'fast', 'stop'])
  fs.rmSync(dir, { recursive: true, force: true })
}
