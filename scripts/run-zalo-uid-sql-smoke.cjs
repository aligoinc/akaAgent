// Isolated PostgreSQL engine; never connects to production.
const assert = require('node:assert/strict')
const { readFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { PGlite } = require(require.resolve('@electric-sql/pglite', {
  paths: [process.env.CHAT_REPO || resolve(__dirname, '../../akaAgentChatApi')]
}))
const root = resolve(__dirname, '..')
const directory = resolve(root, 'migrations/snapshots/zalo-uid-v432')
const source = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'))
const migration = readFileSync(resolve(root, 'migrations/migration_v432_zalo_uid_lookup.sql'), 'utf8')
const signature = 'public.aka_agent_lookup_zalo_users(bigint,bigint,text[])'
const body = migration.replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '')
const metadataSql = `SELECT p.oid::regprocedure::text AS signature,
  pg_get_functiondef(p.oid) AS definition, md5(pg_get_functiondef(p.oid)) AS checksum,
  pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.provolatile,
  p.proconfig, p.proacl::text AS acl
  FROM pg_proc p WHERE p.oid = to_regprocedure('${signature}')`

async function main() {
  const db = new PGlite()
  let checks = 0
  const pass = label => { checks++; console.log('PASS', label) }
  const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0]
  const inRole = async (role, fn) => {
    await db.exec(`BEGIN; SET LOCAL ROLE ${role};`)
    try { return await fn() } finally { await db.exec('ROLLBACK;') }
  }
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE untrusted;')
    const columns = source.columns.map(c => '"' + c.name + '" ' + c.type +
      (c.notnull ? ' NOT NULL' : '') +
      (c.type === 'timestamp with time zone' && c.notnull ? ' DEFAULT now()' : '') +
      (c.name === 'raw_payload' ? " DEFAULT '{}'::jsonb" : '')).join(',')
    await db.exec(`CREATE TABLE public.zalo_users(${columns});
      CREATE UNIQUE INDEX idx_zalo_users_account_uid ON public.zalo_users(account_id,zalo_uid);
      CREATE INDEX idx_zalo_users_staff_account ON public.zalo_users(staff_id,account_id);
      CREATE INDEX idx_kgt_zalo_users_uid_v3 ON public.zalo_users(zalo_uid);
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role,untrusted;
      GRANT SELECT ON public.zalo_users TO anon,authenticated,service_role,untrusted;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;`)
    await db.exec(migration.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.equal(await scalar(`SELECT to_regprocedure('${signature}')::text`), null)
    pass('migration rollback leaves no function')
    await db.exec(migration)
    const target = (await db.query(metadataSql)).rows[0]
    assert.equal(target.owner, 'postgres')
    assert.equal(target.prosecdef, false)
    assert.equal(target.provolatile, 's')
    assert.deepEqual(target.proconfig, ['search_path=pg_catalog, public', 'plan_cache_mode=force_custom_plan', 'statement_timeout=60s'])
    pass('invoker, stable, scoped custom plan and bulk timeout')
    assert.equal(await scalar(`SELECT has_function_privilege('untrusted','${signature}','EXECUTE')`), false)
    pass('PUBLIC cannot call even when table SELECT is granted')
    await db.exec('BEGIN;')
    await assert.rejects(db.exec(body), /already exists/)
    await db.exec('ROLLBACK;')
    assert.deepEqual((await db.query(metadataSql)).rows[0], target)
    pass('preflight fails closed on an existing function without metadata drift')
    await db.exec(`INSERT INTO public.zalo_users(id,account_id,staff_id,organization_id,zalo_uid,display_name,raw_payload,is_fr)
      SELECT n,11,7,9,'uid-'||n,'Person '||n,jsonb_build_object('nested',jsonb_build_object('value',n)),n%2
      FROM generate_series(1,3000) n;
      INSERT INTO public.zalo_users(id,account_id,staff_id,organization_id,zalo_uid,display_name)
      VALUES (4001,22,7,9,'uid-1','Other account'),(4002,11,8,10,'other-staff','Other staff'),
      (4003,11,7,9,'1234567890123456789','Long UID'),(4004,11,7,9,' spaced ','Exact whitespace'),
      (4005,11,7,9,'quote''slash\\,()','Punctuation');
      ANALYZE public.zalo_users;`)
    const samples = [
      ['one existing', ['uid-1']], ['one missing', ['missing']], ['empty', []], ['null array', null],
      ['null and duplicate elements', ['uid-1','uid-1',null,'missing']],
      ['100 mixed', Array.from({length:100},(_,i)=>i%2 ? 'uid-'+(i+1) : 'missing-'+i)],
      ['cross staff', ['other-staff']], ['exact strings', ['1234567890123456789',' spaced ',"quote'slash\\,()"]]
    ]
    for (const role of ['anon','authenticated','service_role']) {
      for (const [label,uids] of samples) {
        await inRole(role, async () => {
          const args = [11,7,uids]
          const original = (await db.query('SELECT * FROM public.zalo_users WHERE account_id=$1 AND staff_id=$2 AND zalo_uid=ANY($3::text[]) ORDER BY id',args)).rows
          const candidate = (await db.query('SELECT * FROM public.aka_agent_lookup_zalo_users($1,$2,$3::text[]) ORDER BY id',args)).rows
          assert.deepEqual(candidate, original)
        })
        pass(role + ': parity ' + label)
      }
    }
    for (const [account,staff,uids] of [[0,7,[]],[11,null,[]],[11,0,[]],[null,7,[]],[11,7,Array(101).fill('uid-1')]]) {
      await inRole('anon', async () => {
        await assert.rejects(db.query('SELECT * FROM public.aka_agent_lookup_zalo_users($1,$2,$3::text[])',[account,staff,uids]), /Invalid|at most 100/)
      })
    }
    pass('invalid scope and oversized array rejected')
    await inRole('anon', async () => {
      await db.exec("SET LOCAL plan_cache_mode=force_generic_plan;")
      for (let i=1;i<=10;i++) {
        const rows = (await db.query('SELECT zalo_uid FROM public.aka_agent_lookup_zalo_users($1,$2,$3::text[])',[11,7,['uid-'+i]])).rows
        assert.deepEqual(rows,[{zalo_uid:'uid-'+i}])
      }
      assert.equal(await scalar("SELECT current_setting('plan_cache_mode')"),'force_generic_plan')
    })
    pass('repeated prepared calls use current parameters and restore outer plan setting')
    await inRole('anon', async () => {
      await db.exec('SET TRANSACTION READ ONLY;')
      assert.equal(await scalar("SELECT count(*)::int FROM public.aka_agent_lookup_zalo_users(11,7,ARRAY['uid-1'])"),1)
    })
    pass('lookup runs in read-only transaction')
    await db.exec(`ALTER TABLE public.zalo_users ENABLE ROW LEVEL SECURITY;
      CREATE POLICY fixture_policy ON public.zalo_users FOR SELECT USING (zalo_uid='uid-1');`)
    await inRole('anon', async () => {
      const rows = (await db.query("SELECT zalo_uid FROM public.aka_agent_lookup_zalo_users(11,7,ARRAY['uid-1','uid-2'])")).rows
      assert.deepEqual(rows,[{zalo_uid:'uid-1'}])
    })
    pass('invoker respects future table RLS')
    await db.exec('ALTER TABLE public.zalo_users DISABLE ROW LEVEL SECURITY; REVOKE SELECT ON public.zalo_users FROM anon;')
    await inRole('anon', async () => {
      await assert.rejects(db.query("SELECT * FROM public.aka_agent_lookup_zalo_users(11,7,ARRAY['uid-1'])"), /permission denied/)
    })
    pass('invoker cannot bypass revoked table SELECT')
    const rollback = readFileSync(resolve(root,'migrations/tests/migration_v432_zalo_uid_lookup_rollback.sql'),'utf8')
    await db.exec(rollback.replace(/COMMIT;\s*$/, 'ROLLBACK;'))
    assert.deepEqual((await db.query(metadataSql)).rows[0], target)
    pass('guarded removal can be rehearsed without losing the target')
    await db.exec(rollback)
    assert.equal(await scalar(`SELECT to_regprocedure('${signature}')::text`), null)
    pass('guarded rollback removes only the new function')
    await db.exec('DROP INDEX public.idx_zalo_users_account_uid; BEGIN;')
    await assert.rejects(db.exec(body), /expected unique account\/UID index/)
    await db.exec('ROLLBACK;')
    pass('migration rejects missing unique lookup index')
    writeFileSync(resolve(directory,'target.json'), JSON.stringify(target,null,2)+'\n')
    console.log(`PASS ${checks} SQL checks; target ${target.checksum}`)
  } finally { await db.close() }
}
main().catch(error => { console.error(error); process.exitCode=1 })
