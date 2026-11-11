// Smoke for getDesktopCampaignSources (campaign Info tab → find-data "source" campaigns).
// Runs the real repository file (esbuild + session/entitlement stubs) and the real
// supabase-js client. Requests are answered by a disposable local Postgres using
// PostgREST's filter → SQL rules: values stay untyped literals, `a->b` is a JSON path
// and or=(...) follows PostgREST's value grammar. Type errors therefore come from
// Postgres itself, not from this fixture. No credentials or network.
//
//   node scripts/desktop-campaign-sources-smoke.cjs
//   PG_TEST_BINDIR=/path/to/postgresql/bin node scripts/desktop-campaign-sources-smoke.cjs
//   DESKTOP_UI_REPOSITORY_SOURCE=/tmp/old.ts node scripts/desktop-campaign-sources-smoke.cjs
//     (bundles another version of desktopUiRepository.ts, e.g. the pre-fix one)
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')

const repositoryDir = resolve(__dirname, '../src/main/data/repositories')
const repositorySource = resolve(process.env.DESKTOP_UI_REPOSITORY_SOURCE || join(repositoryDir, 'desktopUiRepository.ts'))
const pgBin = process.env.PG_TEST_BINDIR || '/opt/homebrew/opt/postgresql@16/bin'
const port = '25443'
const FIND_DATA = ['facebook_find_data_group', 'facebook_find_data_search']
const FIELDS = {
  facebook_message_uid: 'findUidTargetCampaignIds', zalo_message_phone: 'findPhoneZaloMessagePhoneTargetCampaignIds',
  facebook_join_group: 'findFacebookGroupJoinTargetCampaignIds'
}

const FIXTURE_SQL = `
CREATE TABLE auto_campaigns (
  id bigint PRIMARY KEY, staff_id bigint, organization_id bigint,
  is_delete boolean DEFAULT false, action_id text, extra_settings jsonb DEFAULT '{}'::jsonb
);
INSERT INTO auto_campaigns (id, staff_id, organization_id, is_delete, action_id, extra_settings) VALUES
  (42, 7, 9, false, 'facebook_message_uid', '{}'),
  (43, 7, 9, false, 'zalo_message_phone', '{}'),
  (44, 7, 9, false, 'sms_send', '{}'),
  (45, 7, 9, true, 'facebook_message_uid', '{}'),
  (46, 8, 9, false, 'facebook_message_uid', '{}'),
  (47, 7, 9, false, 'facebook_join_group', '{}'),
  (101, 7, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [42]}'),
  (102, 7, 9, false, 'facebook_find_data_search', '{"findUidTargetCampaignIds": ["42"]}'),
  (103, 7, 9, false, 'facebook_find_data_search', '{"findUidTargetCampaignIds": [7, "42", 99]}'),
  (104, 7, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [420, "042", 4, 2, "4", "2"]}'),
  (105, 7, 9, false, 'facebook_find_data_group', '{"findPostLinkTargetCampaignIds": [42]}'),
  (106, 7, 9, true, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [42]}'),
  (107, 8, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [42]}'),
  (108, 7, 10, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [42]}'),
  (109, 7, 9, false, 'facebook_message_uid', '{"findUidTargetCampaignIds": [42]}'),
  (110, 7, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": []}'),
  (111, 7, 9, false, 'facebook_find_data_group', '{}'),
  (112, 7, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": "42"}'),
  (113, 7, 9, false, 'facebook_find_data_group', NULL),
  (114, 7, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [[42], {"id": 42}]}'),
  (120, 7, 9, false, 'facebook_find_data_search', '{"findPhoneZaloMessagePhoneTargetCampaignIds": ["43"], "findUidTargetCampaignIds": [42]}'),
  (121, 7, 9, false, 'facebook_find_data_group', '{"findUidTargetCampaignIds": [43]}');
-- 2,345 sources for 47 cross the 1,000-row page twice; IDs alternate number/string.
INSERT INTO auto_campaigns (id, staff_id, organization_id, is_delete, action_id, extra_settings)
SELECT 10000 + g, 7, 9, false, CASE WHEN g % 3 = 0 THEN 'facebook_find_data_search' ELSE 'facebook_find_data_group' END,
  jsonb_build_object('findFacebookGroupJoinTargetCampaignIds', CASE WHEN g % 2 = 0 THEN jsonb_build_array(g, 47) ELSE jsonb_build_array('47') END)
FROM generate_series(1, 2345) AS g;
`

function pg(name) { return join(pgBin, name) }
// macOS postmaster refuses to start without a valid locale ("became multithreaded
// during startup"); the cluster is C-locale anyway.
const pgEnv = { ...process.env, LC_ALL: 'C' }

function sql(dir, statement) {
  try {
    const output = execFileSync(pg('psql'), ['-X', '-q', '-At', '-h', dir, '-p', port, '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-c', statement], { encoding: 'utf8', env: pgEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    return { output }
  } catch (error) {
    const stderr = String(error.stderr || '')
    const match = /ERROR:\s+([0-9A-Z]{5}):\s+(.*)/.exec(stderr)
    if (!match) throw error
    return { error: { code: match[1], message: match[2].trim(), details: /DETAIL:\s+(.*)/.exec(stderr)?.[1] ?? null } }
  }
}

const ident = name => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) throw new Error(`Unsupported identifier ${name}`)
  return `"${name}"`
}
const literal = value => `'${String(value).replace(/'/g, "''")}'`

// PostgREST field: a column with an optional JSON path (a->b, a->>b).
function field(text) {
  const [column, ...path] = text.split(/(->>?)/)
  let output = ident(column)
  for (let index = 0; index < path.length; index += 2) {
    if (!/^[A-Za-z_]\w*$/.test(path[index + 1])) throw new Error(`Unsupported JSON path ${text}`)
    output += `${path[index]}${literal(path[index + 1])}`
  }
  return output
}

// PostgREST passes values as untyped literals; Postgres coerces them to the operand
// type (jsonb for `@>` on extra_settings->key).
function condition(fieldText, op, value) {
  const target = field(fieldText)
  if (op === 'eq') return `${target} = ${literal(value)}`
  if (op === 'gt') return `${target} > ${literal(value)}`
  if (op === 'cs') return `${target} @> ${literal(value)}`
  if (op === 'in') {
    assert.ok(value.startsWith('(') && value.endsWith(')') && !value.includes('"'), `Unsupported list ${value}`)
    return `${target} IN (${value.slice(1, -1).split(',').map(literal).join(', ')})`
  }
  throw new Error(`Unsupported operator ${op}`)
}

// or=(field.op.value,...): a value is a {pg,array} or runs to the next "," or ")",
// as in PostgREST's pLogicSingleVal. Quoted values and nested trees are not needed.
function logic(text) {
  assert.ok(text.startsWith('(') && text.endsWith(')'), `Unsupported logic tree ${text}`)
  const parts = []
  let rest = text.slice(1, -1)
  while (rest.length) {
    const head = /^([A-Za-z_]\w*(?:->>?[A-Za-z_]\w*)*)\.(eq|gt|cs)\./.exec(rest)
    if (!head || rest[head[0].length] === '"') throw new Error(`Unsupported or= item ${rest}`)
    rest = rest.slice(head[0].length)
    let end = rest.startsWith('{') ? rest.indexOf('}') + 1 : rest.search(/[,)]/)
    if (end < 0) end = rest.length
    parts.push(condition(head[1], head[2], rest.slice(0, end)))
    rest = rest.slice(end)
    if (rest.startsWith(',')) rest = rest.slice(1)
    else if (rest.length) throw new Error(`Unexpected or= text ${rest}`)
  }
  return `(${parts.join(' OR ')})`
}

function translate(url) {
  const table = url.pathname.split('/').pop()
  assert.equal(table, 'auto_campaigns', 'only auto_campaigns is read')
  const columns = [], where = []
  let order = '', limit = ''
  for (const [key, value] of url.searchParams) {
    if (key === 'select') columns.push(...value.split(',').map(ident))
    else if (key === 'order') {
      const [column, direction] = value.split('.')
      order = ` ORDER BY ${ident(column)} ${direction === 'desc' ? 'DESC' : 'ASC'}`
    } else if (key === 'limit') limit = ` LIMIT ${Number.parseInt(value, 10)}`
    else if (key === 'or') where.push(logic(value))
    else {
      const dot = value.indexOf('.')
      where.push(condition(key, value.slice(0, dot), value.slice(dot + 1)))
    }
  }
  return `SELECT coalesce(json_agg(q), '[]'::json) FROM (SELECT ${columns.join(', ')} FROM ${ident(table)}`
    + `${where.length ? ` WHERE ${where.join(' AND ')}` : ''}${order}${limit}) q`
}

// Independent oracle: unpack the array and compare element text, so `42` and `"42"` match.
function oracle(dir, targetId, fieldName) {
  const result = sql(dir, `SELECT coalesce(json_agg(s.id ORDER BY s.id), '[]'::json) FROM auto_campaigns s
    WHERE s.staff_id = 7 AND s.organization_id = 9 AND s.is_delete = false
      AND s.action_id IN (${FIND_DATA.map(literal).join(', ')})
      AND jsonb_typeof(s.extra_settings->${literal(fieldName)}) = 'array'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(s.extra_settings->${literal(fieldName)}) e(v) WHERE e.v = ${literal(targetId)})`)
  assert.ok(!result.error, result.error?.message)
  return JSON.parse(result.output)
}

async function loadRepository(dir) {
  const stubs = {
    '../supabaseClient': 'export const getSupabaseClient = () => globalThis.campaignSourcesFixture.client',
    '../currentUser': `export const requireCurrentUser = () => globalThis.campaignSourcesFixture.user
      export const requireCurrentUserCredentials = () => { throw new Error('credentials are not used') }`,
    './entitlementRepository': `export const loadCurrentUserEffectiveEntitlements = async () => globalThis.campaignSourcesFixture.entitlements
      export const loadCurrentUserZaloAccountCapabilities = () => ({})`,
    '../mappers': 'export const mapAccountFromDB = row => row; export const mapCampaignConfigFromDB = row => row',
    './campaignRepository': `export const listCampaignSummariesForPage = async () => []
      export const attachCampaignSecondaryAccountNames = async rows => rows
      export const attachCampaignDataGroupSourceSummaries = async rows => rows`
  }
  const outfile = join(dir, 'repository.cjs')
  await build({
    stdin: { contents: readFileSync(repositorySource, 'utf8'), resolveDir: repositoryDir, sourcefile: 'desktopUiRepository.ts', loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
    plugins: [{ name: 'campaign-sources-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\/(?:supabaseClient|currentUser|entitlementRepository|mappers|campaignRepository)$/ },
        args => ({ path: args.path, namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: stubs[args.path], loader: 'js' }))
    } }]
  })
  return require(outfile)
}

async function main() {
  for (const name of ['initdb', 'pg_ctl', 'psql']) {
    if (!existsSync(pg(name))) throw new Error(`Missing ${pg(name)}; set PG_TEST_BINDIR to a PostgreSQL bin directory`)
  }
  // Short path: the Unix socket lives here too.
  const dir = mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), 'aka-sources-'))
  let started = false
  try {
    execFileSync(pg('initdb'), ['-D', join(dir, 'db'), '-A', 'trust', '--encoding=UTF8', '--locale=C'], { env: pgEnv, stdio: 'ignore' })
    execFileSync(pg('pg_ctl'), ['-D', join(dir, 'db'), '-l', join(dir, 'server.log'),
      '-o', `-h '' -k ${dir} -p ${port} -c max_connections=5`, '-w', 'start'], { env: pgEnv, stdio: 'ignore' })
    started = true
    const seeded = sql(dir, FIXTURE_SQL)
    assert.ok(!seeded.error, seeded.error?.message)

    const requests = []
    const client = createClient('http://127.0.0.1:54321', 'offline-fixture', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, options = {}) => {
        const url = new URL(String(input))
        assert.equal(options.method || 'GET', 'GET', 'read-only: no writes')
        const statement = translate(url)
        const result = sql(dir, statement)
        requests.push({ url, statement, error: result.error })
        // PostgREST answers SQLSTATE 22P02 (and other unmapped errors) with HTTP 400.
        if (result.error) return new Response(JSON.stringify({ ...result.error, hint: null }), { status: 400, headers: { 'content-type': 'application/json' } })
        return new Response(result.output.trim(), { status: 200, headers: { 'content-type': 'application/json' } })
      } }
    })
    globalThis.campaignSourcesFixture = { client, user: { staffId: 7, organizationId: 9 }, entitlements: { facebookCore: true } }

    // 1. Pre-fix query, copied from the old repository line:
    //    .contains(`extra_settings->${field}`, [id])
    const legacy = await client.from('auto_campaigns').select('id')
      .eq('staff_id', 7).eq('organization_id', 9).eq('is_delete', false)
      .in('action_id', FIND_DATA)
      .contains('extra_settings->findUidTargetCampaignIds', [42])
      .gt('id', 0).order('id').limit(1000)
    assert.equal(requests.at(-1).url.searchParams.get('extra_settings->findUidTargetCampaignIds'), 'cs.{42}', 'supabase-js sends a Postgres array literal')
    assert.equal(legacy.status, 400)
    assert.equal(legacy.data, null)
    assert.equal(legacy.error.code, '22P02')
    assert.match(legacy.error.message, /invalid input syntax for type json/)
    console.log(`PASS pre-fix query: cs.{42} on jsonb → HTTP 400 ${legacy.error.code} "${legacy.error.message}" (rows with 42 exist)`)

    const { getDesktopCampaignSources: read } = await loadRepository(dir)
    const run = async id => { requests.length = 0; return read(id) }

    // 2. Numbers, strings and mixed arrays match; scope, field and look-alike IDs do not.
    assert.deepEqual(await run(42), [101, 102, 103, 120])
    assert.equal(requests.length, 3, 'target lookup + one source page + the empty page that ends the loop')
    assert.equal(requests[2].url.searchParams.get('id'), 'gt.120')
    assert.equal(requests[0].url.searchParams.get('select'), 'action_id')
    assert.equal(requests[0].url.searchParams.get('id'), 'eq.42')
    const params = requests[1].url.searchParams
    assert.equal(params.get('select'), 'id')
    assert.equal(params.get('staff_id'), 'eq.7')
    assert.equal(params.get('organization_id'), 'eq.9')
    assert.equal(params.get('is_delete'), 'eq.false')
    assert.equal(params.get('action_id'), `in.(${FIND_DATA.join(',')})`)
    assert.equal(params.get('or'), '(extra_settings->findUidTargetCampaignIds.cs.[42],extra_settings->findUidTargetCampaignIds.cs.["42"])')
    assert.ok(![...params.keys()].some(key => key.startsWith('extra_settings')), 'no direct cs filter on the jsonb path')
    assert.equal(params.get('id'), 'gt.0')
    assert.equal(params.get('order'), 'id.asc')
    assert.equal(params.get('limit'), '1000')
    assert.ok(requests.every(request => !request.error))
    console.log('PASS 42: number [42], string ["42"], mixed [7,"42",99] match; other field/staff/org/deleted/action, 420/"042", nested, scalar, NULL do not')

    assert.deepEqual(await run(43), [120])
    assert.equal(requests[1].url.searchParams.get('or'),
      '(extra_settings->findPhoneZaloMessagePhoneTargetCampaignIds.cs.[43],extra_settings->findPhoneZaloMessagePhoneTargetCampaignIds.cs.["43"])')
    console.log('PASS 43: field follows the target action (zalo_message_phone), string ID ["43"] matches')

    // 3. Paging keeps the 1,000-row cursor across number and string IDs.
    const expected47 = Array.from({ length: 2345 }, (_, index) => 10001 + index)
    assert.deepEqual(await run(47), expected47)
    assert.deepEqual(requests.slice(1).map(request => request.url.searchParams.get('id')), ['gt.0', 'gt.11000', 'gt.12000', 'gt.12345'])
    console.log('PASS 47: 2,345 sources over 3 pages + empty page, IDs ascending')

    // 4. Matches the independent oracle for every fixture target.
    for (const [id, action] of [[42, 'facebook_message_uid'], [43, 'zalo_message_phone'], [47, 'facebook_join_group']]) {
      assert.deepEqual(await run(id), oracle(dir, id, FIELDS[action]))
    }
    console.log('PASS repository result equals the jsonb_array_elements_text oracle for 42, 43, 47')

    // 5. Unchanged guards: no source query without a known target, no request without access.
    for (const id of [44, 45, 46, 999]) {
      assert.deepEqual(await run(id), [])
      assert.equal(requests.length, 1, `only the target lookup for ${id}`)
    }
    for (const id of [0, -1, 1.5, Number.NaN, 2 ** 53]) {
      requests.length = 0
      await assert.rejects(read(id), /ID chiến dịch không hợp lệ/)
      assert.equal(requests.length, 0)
    }
    globalThis.campaignSourcesFixture.entitlements = { facebookCore: false }
    assert.deepEqual(await run(42), [])
    assert.equal(requests.length, 0)
    console.log('PASS unknown/deleted/foreign/missing target, invalid ID and no facebookCore keep their early returns')
    console.log('PASS desktop campaign sources smoke')
  } finally {
    if (started) {
      try { execFileSync(pg('pg_ctl'), ['-D', join(dir, 'db'), '-m', 'immediate', 'stop'], { env: pgEnv, stdio: 'ignore' }) } catch { /* already stopped */ }
    }
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
