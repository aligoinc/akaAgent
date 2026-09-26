// Real repository/store with isolated HTTP and auth fixtures; no live credentials.
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const { build } = require('esbuild')

const root = resolve(__dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'akaagent-template-loading-'))
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

async function main() {
  const compile = (entry, name, mockFilter, contents) => build({
    entryPoints: [join(root, entry)], outfile: join(directory, name), bundle: true,
    platform: 'node', format: 'cjs', logLevel: 'warning',
    plugins: [{ name: 'isolated-fixtures', setup(builder) {
      builder.onResolve({ filter: mockFilter }, args => ({ path: args.path, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: contents(args.path), loader: 'js' }))
    } }]
  })
  await compile('src/main/data/repositories/contentTemplateRepository.ts', 'repository.cjs',
    /\/(supabaseClient|currentUser)$/, path => path.endsWith('/supabaseClient')
      ? 'export const getSupabaseClient = () => globalThis.templateTestDb'
      : 'export const requireCurrentUser = () => ({ staffId: 7, organizationId: 9 }); export const getCurrentUser = requireCurrentUser')

  const types = [{ id: 1, type: 'content_type', name: 'sms', description: 'SMS', is_active: true }]
  const makeRow = id => ({ id, name: `Mẫu ${id}`, staff_id: 7, organization_id: 9,
    group_id: 1, is_delete: false, created_at: '2026-01-01T00:00:00Z', channels: {}, channel_image_urls: {} })
  const tables = {
    auto_content_templates: Array.from({ length: 1250 }, (_, i) => makeRow(i + 1)),
    auto_content_groups: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: `Nhóm ${i + 1}`,
      staff_id: 7, organization_id: 9, is_delete: false, is_active: true, stt: i + 1 })),
    aka_crm_status: types
  }
  tables.auto_content_templates.push({ ...makeRow(1301), staff_id: 8 }, { ...makeRow(1302), is_delete: true })
  const calls = []
  let fail = () => false
  globalThis.templateTestDb = {
    from(table) {
      const call = { table, filters: [], limit: Infinity, update: null }
      const query = {
        select(fields, options) { assert(!options?.count && !options?.head, 'must not run count queries'); return query },
        eq(key, value) { call.filters.push([key, value]); return query },
        gt(key, value) { assert.equal(key, 'id'); call.cursor = value; return query },
        in() { return query }, order() { return query },
        limit(value) { call.limit = value; return query },
        update(value) { call.update = value; return query },
        maybeSingle() { call.single = true; return query },
        then(success, failure) {
          calls.push(call)
          if (fail(call)) return Promise.resolve({ data: null, error: { message: 'fetch failed' } }).then(success, failure)
          const matches = tables[table].filter(row => call.filters.every(([key, value]) => row[key] === value) &&
            (call.cursor === undefined || row.id > call.cursor)).sort((a, b) => a.id - b.id)
          if (call.update) matches.forEach(row => Object.assign(row, call.update))
          // Deliberately below the requested 500 to exercise an unknown API row cap.
          const data = matches.slice(0, Math.min(137, call.limit)).map(row => ({ ...row }))
          return Promise.resolve({ data: call.single ? data[0] || null : data, error: null }).then(success, failure)
        }
      }
      return query
    }
  }
  const repository = require(join(directory, 'repository.cjs'))
  const groups = await repository.listContentTemplateGroups()
  assert.equal(groups.length, 30)
  assert(groups.every(group => group.templateCount === null))
  assert(calls.every(call => call.table === 'auto_content_groups'), 'listing groups must not read templates')
  calls.length = 0
  const [templates] = await Promise.all([repository.listContentTemplates(), repository.listContentTemplateContentTypes()])
  assert.equal(templates.length, 1250)
  assert.deepEqual(templates.map(item => item.id), Array.from({ length: 1250 }, (_, i) => 1250 - i))
  assert.equal(calls.filter(call => call.table === 'aka_crm_status').length, 1, 'share pending metadata read')
  assert(calls.filter(call => call.table === 'auto_content_templates').every(call => call.filters.some(([key, value]) => key === 'staff_id' && value === 7)))
  fail = call => call.table === 'auto_content_templates' && call.cursor >= 137
  await assert.rejects(repository.listContentTemplates(), /fetch failed/, 'partial pages must not be returned as a full list')
  fail = () => false
  calls.length = 0
  await assert.rejects(repository.deleteContentTemplateGroup(1), /vẫn còn mẫu/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].limit, 1)
  assert(!calls.some(call => call.update))
  calls.length = 0
  await repository.deleteContentTemplateGroup(2)
  assert.equal(calls[0].limit, 1)
  assert(calls.some(call => call.table === 'auto_content_groups' && call.update?.is_delete))
  calls.length = 0
  fail = call => call.table === 'auto_content_templates'
  await assert.rejects(repository.deleteContentTemplateGroup(3), /fetch failed/)
  assert(!calls.some(call => call.update), 'failed existence check must block delete')
  fail = () => false
  calls.length = 0
  await repository.updateContentTemplateGroup(3, { name: 'Đổi tên' })
  assert(calls.every(call => call.table === 'auto_content_groups'), 'rename must not run a count afterwards')
  console.log('PASS repository: no per-group counts, capped pagination, complete results, shared metadata, deletion checks')

  let auth = { user: { staffId: 7, organizationId: 9 } }
  const listeners = []
  globalThis.templateTestAuth = { getState: () => auth, subscribe: fn => listeners.push(fn) }
  const setUser = user => { const previous = auth; auth = { user }; listeners.forEach(fn => fn(auth, previous)) }
  await compile('src/renderer/src/stores/contentTemplateStore.ts', 'store.cjs', /\/authStore$/,
    () => 'export const useAuthStore = globalThis.templateTestAuth')
  let readCalls = 0
  let failTemplates = false
  let hold = null
  let version = 1
  const makeTemplates = () => [{ id: version, groupId: 1, name: `Mẫu ${version}`, isDelete: false, channels: {} }]
  globalThis.window = { electronAPI: {
    listContentTemplates: async () => {
      readCalls++
      const snapshot = makeTemplates()
      if (hold) await hold.promise
      if (failTemplates) throw new Error('fetch failed')
      return snapshot
    },
    listContentTemplateGroups: async () => groups,
    listContentTemplateContentTypes: async () => types
  } }
  const { refreshContentTemplateLibrary: refresh, useContentTemplateStore: store } = require(join(directory, 'store.cjs'))
  assert.equal(readCalls, 0, 'importing the store must not preload data')
  failTemplates = true
  assert.equal(await refresh(), null)
  assert.equal(store.getState().groups.length, 30)
  assert.equal(store.getState().groups[0].templateCount, null, 'unknown count is not zero')
  failTemplates = false
  hold = deferred()
  const first = refresh()
  assert.equal(refresh(), first, 'simultaneous consumers share one promise')
  hold.resolve(); hold = null
  await first
  assert.equal(store.getState().groups[0].templateCount, 1)
  assert.equal(store.getState().groups[1].templateCount, 0)
  assert.equal(store.getState().error, null)
  failTemplates = true
  groups.push({ ...groups[0], id: 40, name: 'Nhóm mới trên server', templateCount: null })
  await refresh()
  assert.equal(store.getState().templates[0].id, 1, 'network failures preserve earlier results')
  assert.equal(store.getState().groups.find(group => group.id === 40).templateCount, null,
    'a group discovered during a failed template refresh must not show a fabricated zero')
  assert.equal(store.getState().groups[0].templateCount, 1)
  assert(store.getState().error)
  failTemplates = false
  hold = deferred()
  const beforeMutation = refresh()
  const callsBeforeMutation = readCalls
  version = 2
  assert.equal(refresh(true), beforeMutation)
  assert.equal(readCalls, callsBeforeMutation, 'mutation waits for old reads to drain')
  hold.resolve(); hold = null
  await beforeMutation
  assert.equal(readCalls, callsBeforeMutation + 1, 'exactly one follow-up after mutation')
  assert.equal(store.getState().templates[0].id, 2)
  hold = deferred()
  const oldSession = refresh()
  setUser(null)
  setUser({ staffId: 7, organizationId: 9 })
  const releaseOld = hold; hold = null; version = 3
  await refresh()
  releaseOld.resolve()
  assert.equal(await oldSession, null)
  assert.equal(store.getState().templates[0].id, 3, 'old login cannot overwrite new login with same staff')
  setUser({ staffId: 8, organizationId: 9 })
  assert.equal(store.getState().templates.length, 0)
  assert.equal(store.getState().templatesLoaded, false)
  console.log('PASS store: lazy reads, shared requests, unknown counts, network recovery, mutation and login races')
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => {
  rmSync(directory, { recursive: true, force: true })
})
