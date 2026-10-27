// Compare the old SELECT projections with the three new pre-login paths.
// Disposable PostgreSQL + real old/new TypeScript readers; no production writes.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const assert = require('node:assert/strict'), ts = require('typescript')
const { createFixture } = require('./full-fixture.cjs')
const root = path.resolve(__dirname, '../..')
const old = file => execFileSync('git', ['show', 'HEAD:' + file], { cwd: root, encoding: 'utf8' })
const current = file => fs.readFileSync(path.join(root, file), 'utf8')
const plain = value => JSON.parse(JSON.stringify(value))
const sid = '22222222-2222-4222-8222-222222222222', hash = 'a'.repeat(64)
let checks = 0
const pass = label => { checks++; console.log('PASS', label) }
function load(source, mocks = {}) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  } }).outputText, { exports, require: name => mocks[name] || {}, Date, URL, Map, Set,
    AbortSignal, Error, console, Number, JSON, Buffer, fetch, Request, Headers, Response,
    setTimeout, clearTimeout, process: { env: {}, cwd: () => root } })
  return exports
}
function sourceCalls(source) {
  const file = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true)
  const methods = new Set(['from', 'select', 'insert', 'update', 'delete', 'upsert', 'eq', 'neq',
    'in', 'or', 'is', 'order', 'rpc', 'maybeSingle', 'single', 'range', 'limit', 'abortSignal'])
  const result = []
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && methods.has(node.expression.name.text)) {
      result.push(node.expression.name.text + '(' + node.arguments.map(arg => arg.getText(file)).join(',') + ')')
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result.sort()
}
function responseClient(data) {
  const query = new Proxy({}, { get: (_, key) => key === 'then'
    ? resolve => resolve({ data, error: null }) : () => query })
  return { from: () => query, rpc: () => query }
}

async function main() {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src'], {
    cwd: root, encoding: 'utf8'
  }).trim().split('\n').filter(Boolean)
  const exceptions = new Set(['src/main/data/repositories/loginScreenRepository.ts',
    'src/main/data/repositories/systemSettingsRepository.ts'])
  for (const file of changed.filter(file => file.startsWith('src/main/data/repositories/') && !exceptions.has(file))) {
    assert.deepEqual(sourceCalls(current(file)), sourceCalls(old(file)), file)
  }
  for (const file of ['src/main/data/mappers.ts', 'src/shared/appNotification.ts',
    'src/shared/vietnamTime.ts', 'src/main/data/repositories/runtimeClockRepository.ts']) {
    assert.equal(current(file), old(file), file)
  }
  pass('existing repository query expressions and data/date mappers are unchanged outside the two public readers')

  const fixture = createFixture(), { sql, quote: q } = fixture
  try {
    sql(fixture.localActivation(current('supabase/migrations/20261027095004_desktop_session_identity.sql')))
    sql(`INSERT INTO org_organization(id,use_staff_expiration) VALUES(10,false);
      INSERT INTO org_staff(id,organization_id,username,password,is_active,deleted_at,is_policy_accepted,
        aka_agent_device_identity_version,aka_agent_device_fingerprint_hash)
      VALUES(1,10,'fixture','fixture',true,NULL,true,3,'${hash}');`)
    const roleQuery = (role, query, zone = 'UTC') => JSON.parse(sql(`BEGIN;
      SET LOCAL TIME ZONE ${q(zone)}; SET LOCAL ROLE ${role}; SELECT coalesce((${query})::jsonb,'null'::jsonb); ROLLBACK;`))
    const productProjection = 'id,product_id,expiration_date,package_type,max_sends_per_day,max_accounts,is_zalo_show_web,is_zalo_server,is_chat_sync,created_at'
    const productsQuery = `(SELECT coalesce(json_agg(row_to_json(p)),'[]') FROM
      (SELECT ${productProjection} FROM org_organization_product WHERE organization_id=10
        AND is_deleted=false ORDER BY created_at DESC NULLS LAST,id DESC) p)`
    const credentials = q(JSON.stringify({ username: 'fixture', password: 'fixture', fingerprintHash: hash }))
    const productRpc = `public.aka_agent_desktop_session_admin('check',${credentials}::jsonb)->'products'`
    const commonMocks = {
      '../../../shared/authProductCatalog': load(current('src/shared/authProductCatalog.ts')),
      '../../../shared/vietnamTime': load(current('src/shared/vietnamTime.ts'))
    }
    const newEntitlement = load(current('src/main/data/repositories/entitlementRepository.ts'), commonMocks)
    const notification = load(current('src/shared/appNotification.ts'))
    const dates = [null, '2026-10-26T23:59:59.999999+07:00', '2026-10-27T00:00:00+07:00',
      '2026-10-27T17:00:00.123456Z', '2099-01-01T00:00:00+07:00']
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh']) {
      for (const [index, date] of dates.entries()) {
        sql(`DELETE FROM org_organization_product; INSERT INTO org_organization_product
          (id,organization_id,product_id,is_deleted,expiration_date,created_at,package_type,
           max_accounts,max_sends_per_day,is_zalo_show_web,is_zalo_server,is_chat_sync) VALUES
          (9007199254740991,10,18,false,${date ? q(date) : 'NULL'},'2026-10-27T00:00:00.123456+07:00','unlimited',NULL,0,true,false,NULL),
          (2,10,13,false,${date ? q(date) : 'NULL'},NULL,'demo',3,600,false,true,true),
          (3,10,17,true,'2099-01-01',now(),'demo',3,600,false,false,false),
          (4,20,17,false,'2099-01-01',now(),'demo',3,600,false,false,false);`)
        const before = roleQuery('anon', productsQuery, zone)
        const after = roleQuery('service_role', productRpc, zone)
        assert.deepEqual(after, before, `products ${zone}/${index}`)
        assert.equal(after[0].id, 9007199254740991)
        assert.equal(after[0].max_accounts, null)
        assert.equal(after[0].max_sends_per_day, 0)
        assert.equal(after[0].is_zalo_show_web, true)
        const legacy = load(old('src/main/data/repositories/entitlementRepository.ts'), {
          ...commonMocks, '../supabaseClient': { getSupabaseClient: () => responseClient(before) }
        })
        assert.deepEqual(plain(newEntitlement.resolveOrganizationEntitlementAccess(after)),
          plain(await legacy.loadOrganizationEntitlementAccess(10)))
      }
    }
    pass('10 product cases preserve timestamp strings, NULL/number/boolean types, row order and entitlement results')

    const keys = ['app.notification', 'akabiz.links.website', 'akabiz.links.user_guide',
      'akabiz.links.upgrade_payment', 'akabiz.links.contact_us']
    const loginQuery = `(SELECT coalesce(json_agg(row_to_json(s)),'[]') FROM
      (SELECT id,key,value,updated_at FROM auto_system_settings WHERE key IN (${keys.map(q).join(',')})
        AND is_active=true AND is_secret=false ORDER BY key) s)`
    const noticeValues = ['Thông báo\nTiếng Việt', null, JSON.stringify({ message: 'Fixture',
      startsAt: '2000-01-01T00:00:00+07:00', endsAt: '2099-01-01T00:00:00Z' }),
      JSON.stringify({ message: 'Future', startsAt: '2099-01-01T00:00:00+07:00' })]
    for (const zone of ['UTC', 'Asia/Ho_Chi_Minh']) {
      for (const [index, value] of noticeValues.entries()) {
        sql(`DELETE FROM auto_system_settings; INSERT INTO auto_system_settings(id,key,value,updated_at,is_active,is_secret) VALUES
          (1,'app.notification',${value === null ? 'NULL' : q(value)},'2026-10-27T00:00:00.123456+07:00',true,false),
          (2,'akabiz.links.website','https://example.test/',NULL,true,false),
          (3,'akabiz.links.user_guide','secret',now(),true,true),
          (4,'akabiz.links.contact_us','inactive',now(),false,false);`)
        const before = roleQuery('anon', loginQuery, zone)
        const after = roleQuery('anon', 'public.aka_agent_desktop_login_content()', zone)
        assert.deepEqual(after, before, `login ${zone}/${index}`)
        const reader = (source, rows) => load(source, { '../supabaseClient': {
          getSupabaseClient: () => responseClient(rows)
        }, '../../../shared/appNotification': notification }).getLoginScreenContent()
        assert.deepEqual(plain(await reader(current('src/main/data/repositories/loginScreenRepository.ts'), after)),
          plain(await reader(old('src/main/data/repositories/loginScreenRepository.ts'), before)))
      }
    }
    pass('8 login-content cases preserve updated_at precision/time zone, strings, NULLs, links and scheduled notices')

    for (const [value, active, secret] of [[null,true,false], ['',true,false], ['9.0.0',true,false],
      ['9.0.0',false,false], ['9.0.0',true,true], ['9.0.0',true,null]]) {
      sql(`DELETE FROM auto_system_settings; INSERT INTO auto_system_settings(id,key,value,is_active,is_secret)
        VALUES(1,'desktop.updates.startup_prompt_max_version',${value === null ? 'NULL' : q(value)},${active},${secret === null ? 'NULL' : secret});`)
      const before = roleQuery('anon', `(SELECT row_to_json(s) FROM (SELECT value FROM auto_system_settings
        WHERE key='desktop.updates.startup_prompt_max_version' AND is_active=true AND is_secret=false) s)`)
      const after = roleQuery('anon', 'public.aka_agent_desktop_startup_policy()')
      assert.deepEqual(after, before)
      const read = (source, rows) => load(source, { '../supabaseClient': {
        getSupabaseClient: () => responseClient(rows)
      } }).getStartupUpdatePromptMaxVersion()
      assert.equal(await read(current('src/main/data/repositories/systemSettingsRepository.ts'), after),
        await read(old('src/main/data/repositories/systemSettingsRepository.ts'), before))
    }
    pass('6 startup cases preserve explicit NULL, empty string, version and disabled/secret row absence')

    // Existing business responses pass through the same SDK and unmodified body.
    const session = load(current('src/main/data/desktopSession.ts'))
    const headersSeen = [], requests = []
    const payload = [{ id: 9007199254740991, schedule: '2026-10-27T17:00:00.123456+00:00',
      date_action: null, runtime_claim_vietnam_date: '2026-10-28', timestamp_local: '2026-10-28T00:00:00.123456',
      value: 1.25, enabled: false, extra_settings: { x: [null, 0, false, 'Tiếng Việt'] } }]
    const wire = JSON.stringify(payload)
    const send = async (input, init) => {
      const req = new Request(input, init); headersSeen.push(req.headers.get('authorization'))
      requests.push({ method: req.method, path: new URL(req.url).pathname + new URL(req.url).search,
        body: await req.text(), accept: req.headers.get('accept'), prefer: req.headers.get('prefer') })
      return new Response(wire, { headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/1' } })
    }
    const { createClient } = require('@supabase/supabase-js')
    const legacyClient = createClient('https://fixture.example.test', 'legacy-fixture', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: send }
    })
    const exports = {}
    vm.runInNewContext(ts.transpileModule(current('src/main/data/supabaseClient.ts'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText, { exports, require: name => ({ './desktopSession': session,
      './desktopSessionTransport': { createDesktopSessionTransport: () => ({ refresh: async () => { throw Error('unexpected refresh') } }) },
      dotenv: { config() {} }, ws: class {}, '@supabase/supabase-js': { createClient } })[name] || require(name),
      process: { env: { SUPABASE_URL: 'https://fixture.example.test', SUPABASE_PUBLISHABLE_KEY: 'project-fixture' }, cwd: () => root },
      fetch: send, Request, Headers, Response, URL, Date, AbortSignal, console })
    const exp = Math.floor(Date.now()/1000) + 3600
    exports.desktopSession.install({ accessToken: 'fixture.' + Buffer.from(JSON.stringify({ role: 'aka_agent_desktop',
      sub: '11111111-1111-4111-8111-111111111111', session_id: sid, exp })).toString('base64url') + '.fixture',
      refreshToken: 'fixture', staffId: 1, organizationId: 10, sessionId: sid, expiresAt: exp }, 0)
    try {
      for (const query of [client => client.from('auto_campaigns').select('*', { count: 'exact' }).eq('staff_id',1).order('schedule').range(0,99),
        client => client.from('auto_campaigns').update({ schedule: payload[0].schedule, extra_settings: payload[0].extra_settings }).eq('id',1).select(),
        client => client.rpc('fixture_business_rpc', { p_at: payload[0].schedule, p_input: payload[0].extra_settings })]) {
        const before = await query(legacyClient), after = await query(exports.getSupabaseClient())
        assert.deepEqual(after, before)
        assert.deepEqual(after.data, payload)
        assert.deepEqual(requests.at(-1), requests.at(-2))
        assert.notEqual(headersSeen.at(-1), headersSeen.at(-2))
      }
    } finally { exports.desktopSession.clear() }
    pass('SELECT/UPDATE/RPC keep URL, filters, range, payload, response types and count; only authorization changes')
    console.log(JSON.stringify({ checks, dataCases: 27, status: 'passed', scope: 'local SQL JSON parity + SDK fetch boundary; not a deployed endpoint canary' }))
  } finally { fixture.close() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
