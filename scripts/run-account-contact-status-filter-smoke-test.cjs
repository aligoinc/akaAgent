const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

const projectRoot = resolve(__dirname, '..')
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'akaagent-contact-status-'))
const outputFile = join(temporaryDirectory, 'repository.cjs')

async function main() {
  // Run the real repository and mappers; never load live DB credentials.
  await build({
    entryPoints: [join(projectRoot, 'src/main/data/repositories/accountContactRepository.ts')],
    outfile: outputFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning',
    plugins: [{
      name: 'mock-contact-database',
      setup(builder) {
        builder.onResolve({ filter: /\/(supabaseClient|currentUser)$/ }, args => ({
          path: args.path.endsWith('/supabaseClient') ? 'db' : 'auth', namespace: 'contact-test'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'contact-test' }, args => ({
          contents: args.path === 'db'
            ? 'export const getSupabaseClient = () => globalThis.__contactStatusTestDb;'
            : `export const requireCurrentUser = () => ({ staffId: 7, organizationId: 9 });
               export const getCurrentUser = requireCurrentUser;
               export const requireCurrentUserCredentials = () => { throw new Error('Live credentials are blocked'); };`,
          loader: 'js'
        }))
      }
    }]
  })

  const people = Array.from({ length: 2050 }, (_, index) => ({
    id: index + 1, account_id: 11, staff_id: 7, organization_id: 9, contact_type: 'person',
    name: `Person ${String(index + 1).padStart(4, '0')}`, uid: `uid-${index + 1}`,
    is_friend: index < 50 ? true : index < 1050 ? false : null,
    is_delete: false,
    extra_data: { zaloTagIds: index % 2 === 0 ? ['vip'] : [], phone: `090${String(index).padStart(7, '0')}` },
    akabiz_tag_ids: index % 5 === 0 ? [3] : []
  }))
  // These rows must never be returned even when a query falls back to JS filtering.
  let rows = [...people,
    { ...people[0], id: 9001, account_id: 22 },
    { ...people[0], id: 9002, staff_id: 8 },
    { ...people[0], id: 9003, is_delete: true }
  ]
  const calls = []
  globalThis.__contactStatusTestDb = {
    from(table) {
      assert.equal(table, 'auto_account_contacts')
      const predicates = []
      let range
      let counted = false
      const query = {
        select(_fields, options) { counted = options?.count === 'exact'; return query },
        eq(key, value) { predicates.push(row => row[key] === value); return query },
        in(key, values) { predicates.push(row => values.includes(row[key])); return query },
        or(expression) {
          const match = /^(is_friend|is_joined)\.is\.null,\1\.eq\.false$/.exec(expression)
          assert.ok(match, `Unexpected OR expression: ${expression}`)
          predicates.push(row => row[match[1]] === null || row[match[1]] === false)
          return query
        },
        order() { return query },
        range(from, to) { range = [from, to]; return query },
        then(onFulfilled, onRejected) {
          const matching = rows.filter(row => predicates.every(predicate => predicate(row)))
          const data = range ? matching.slice(range[0], range[1] + 1) : matching
          calls.push({ range, rowCount: data.length })
          return Promise.resolve({ data, error: null, count: counted ? matching.length : null }).then(onFulfilled, onRejected)
        }
      }
      return query
    },
    rpc() { throw new Error('Unexpected RPC in contact status smoke test') }
  }
  const { listContactsPage, exportContactsPage } = require(outputFile)
  let passed = 0
  async function check(name, query, expectedIds, expectedRowsRead, exported = false) {
    calls.length = 0
    const input = { contactType: 'person', statusFilter: 'active', limit: 100, offset: 0, ...query }
    const result = exported ? await exportContactsPage(11, input) : await listContactsPage(11, input)
    assert.deepEqual((exported ? result : result.contacts).map(row => row.id), expectedIds, `${name}: selected contacts`)
    assert.equal(calls.reduce((total, call) => total + call.rowCount, 0), expectedRowsRead, `${name}: DB rows fetched`)
    passed += 1
    console.log(`PASS ${name}: ${calls.length} DB request(s), ${expectedRowsRead} rows fetched`)
    return { result, calls: [...calls] }
  }
  const ids = (predicate, source = people) => source.filter(predicate).map(row => row.id)
  const friends = row => row.is_friend === true
  const defaultResult = await check('default friends', {}, ids(friends), 50)
  assert.equal(defaultResult.calls.length, 1)
  assert.equal(defaultResult.result.total, 50)

  const searched = await check('search friends', { search: 'Person' }, ids(friends), 50)
  assert.equal(searched.calls.length, 1)
  assert.equal(searched.result.total, 50)
  await check('search by phone', { search: people[4].extra_data.phone }, [5], 50)
  await check('Zalo tag', { zaloTagIds: ['vip'] }, ids(row => friends(row) && row.id % 2 === 1), 50)
  await check('akaBiz tag', { akaBizTagIds: [3] }, ids(row => friends(row) && (row.id - 1) % 5 === 0), 50)
  await check('both tag filters', { zaloTagIds: ['vip'], akaBizTagIds: [3] }, [1, 11, 21, 31, 41], 50)
  await check('no Zalo tag', { zaloNoTag: true }, ids(row => friends(row) && row.id % 2 === 0), 50)
  await check('tag OR untagged', { zaloTagIds: ['vip'], zaloNoTag: true }, ids(friends), 50)
  await check('unknown tag', { zaloTagIds: ['missing'] }, [], 50)
  await check('selected IDs', { ids: [1, 2, 51, 1501], search: 'Person' }, [1, 2], 2)
  const paged = await check('filtered pagination', { search: 'Person', offset: 10, limit: 10 }, ids(friends).slice(10, 20), 50)
  assert.equal(paged.result.total, 50)
  await check('export matching friends', { search: 'Person', limit: undefined, excludeIds: [1] }, ids(friends).slice(1), 50, true)

  const strangers = await check('strangers including NULL', { statusFilter: 'inactive', search: 'Person', offset: 990, limit: 20 }, ids(row => !friends(row)).slice(990, 1010), 2000)
  assert.equal(strangers.result.total, 2000)
  assert.ok(strangers.result.contacts.some(row => row.isFriend === null))
  const all = await check('all people', { statusFilter: 'all', search: 'Person' }, people.slice(0, 100).map(row => row.id), 2050)
  assert.equal(all.result.total, 2050)

  const groups = [true, false, null].map((joined, index) => ({
    ...people[0], id: 3001 + index, contact_type: 'group', name: `Group ${index + 1}`, is_joined: joined
  }))
  rows = groups
  await check('joined groups with search', { contactType: 'group', search: 'Group' }, [3001], 1)
  await check('non-joined groups including NULL', { contactType: 'group', statusFilter: 'inactive', search: 'Group' }, [3002, 3003], 2)
  rows = [people[0], people[50], ...groups]
  await check('mixed types keep per-type status semantics', { contactType: undefined }, [1, 3001], 5)

  // More than one fetch chunk of friends must still be complete and correctly paged.
  rows = Array.from({ length: 1250 }, (_, index) => ({ ...people[index], is_friend: true }))
  const boundary = await check('friends across DB chunks', { search: 'Person', offset: 990, limit: 100 }, rows.slice(990, 1090).map(row => row.id), 1250)
  assert.equal(boundary.result.total, 1250)
  assert.deepEqual(boundary.calls.map(call => call.range), [[0, 999], [1000, 1999]])
  rows = people.map(row => ({ ...row, is_friend: false }))
  const empty = await check('zero friends', { search: 'Person' }, [], 0)
  assert.equal(empty.result.total, 0)
  assert.equal(empty.calls.length, 1)
  console.log(`Contact status filtering: ${passed} cases passed.`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  delete globalThis.__contactStatusTestDb
  rmSync(temporaryDirectory, { recursive: true, force: true })
})
