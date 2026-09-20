const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { build } = require('esbuild')

async function main() {
  const root = resolve(__dirname, '..')
  const directory = mkdtempSync(join(tmpdir(), 'aka-contact-tag-smoke-'))
  const state = {
    credentials: { username: 'fixture-user', password: 'fixture-password' },
    calls: [], errors: [], ids: [], queries: []
  }
  const client = {
    from(table) {
      const query = { table, filters: [] }
      state.queries.push(query)
      const chain = {
        select() { return chain },
        eq(key, value) { query.filters.push([key, value]); return chain },
        in(key, values) { query.filters.push([key, values]); return chain },
        contains() { return chain },
        order() { return chain },
        limit() { return chain },
        gt() { return chain },
        update() { assert.equal(table, 'auto_contact_tags', 'contact tags must use atomic RPC'); return chain },
        single() { return Promise.resolve({ data: { id: 7, name: 'Fixture', staff_id: 1, organization_id: 2 }, error: null }) },
        then(onResult, onError) {
          const selected = query.filters.find(([key]) => key === 'id')?.[1]
          const ids = Array.isArray(selected) ? state.ids.filter(id => selected.includes(id)) : state.ids
          return Promise.resolve({ data: ids.map(id => ({ id })), error: null }).then(onResult, onError)
        }
      }
      return chain
    },
    async rpc(name, args) {
      state.calls.push({ name, args })
      const error = state.errors.shift()
      return error ? { data: null, error } : { data: { count: args.p_contact_ids.length }, error: null }
    }
  }
  globalThis.contactTagSmoke = { client, state }
  try {
    const output = join(directory, 'repository.cjs')
    await build({
      entryPoints: [join(root, 'src/main/data/repositories/contactTagRepository.ts')],
      outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning',
      plugins: [{ name: 'tag-fixtures', setup(plugin) {
        plugin.onResolve({ filter: /\/(supabaseClient|currentUser|mappers)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'tag-fixture' }))
        plugin.onLoad({ filter: /.*/, namespace: 'tag-fixture' }, args => ({ loader: 'js', contents: {
          supabaseClient: 'export const getSupabaseClient = () => globalThis.contactTagSmoke.client',
          currentUser: 'export const requireCurrentUser = () => ({ staffId: 1, organizationId: 2 }); export const getCurrentUserCredentials = () => globalThis.contactTagSmoke.state.credentials',
          mappers: 'export const mapAkaBizContactTagFromDB = row => row'
        }[args.path] }))
      } }]
    })
    const repository = require(output)
    state.ids = Array.from({ length: 205 }, (_, index) => index + 1)
    assert.equal((await repository.applyAkaBizTagsToContactIds(state.ids, [7, 7])).count, 205)
    assert.deepEqual(state.calls.map(call => call.args.p_contact_ids.length), [100, 100, 5])
    for (const call of state.calls) {
      assert.equal(call.name, 'aka_agent_mutate_contact_tags')
      assert.equal(call.args.p_mode, 'add')
      assert.deepEqual(call.args.p_tag_ids, [7])
      assert.equal(call.args.p_organization_id, 2)
    }
    state.calls = []; state.ids = [1]; state.credentials = null
    state.errors = [{ code: '40P01', message: 'fixture deadlock rollback' }]
    assert.equal((await repository.applyAkaBizTagsToContactTargets([{ accountId: 11, contactType: 'person', uid: 'uid' }], [7])).count, 1)
    assert.equal(state.calls.length, 2)
    assert.equal(state.calls[0].args.p_auth_username, null)
    assert.equal(state.calls[0].args.p_auth_password, null)
    state.calls = []; state.errors = [{ code: 'P0001', message: 'contact_tag_scope_invalid' }]
    await assert.rejects(repository.applyAkaBizTagsToContactIds([1], [7]), /contact_tag_scope_invalid/)
    assert.equal(state.calls.length, 1)
    state.calls = []
    await repository.deleteAkaBizContactTag(7)
    assert.equal(state.calls.length, 1)
    assert.equal(state.calls[0].args.p_mode, 'remove')
    console.log('PASS: tag RPC batches, delta writes, credentials/service-role, rollback retry, scope errors and deletion cleanup')
  } finally {
    delete globalThis.contactTagSmoke
    rmSync(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
