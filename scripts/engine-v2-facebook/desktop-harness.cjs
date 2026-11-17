// Bộ lập lịch Desktop thật (campaignScheduler.ts) dựng bằng esbuild cho bài thử engine v2 Facebook trên PostgreSQL cục bộ: thay phần chạm
// Electron / Supabase / Facebook bằng bản giả đọc globalThis.__fbHarness. Dùng chung cho replay.cjs (block trả lại kết quả đã ghi) và
// scenarios.cjs (block giả chạy thật trên trang giả có tiêm lỗi).
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')

const ROOT = path.resolve(__dirname, '../..')
const RUNTIME_DIR = path.join(ROOT, 'src/main/v2/runtime')
const REPO_FILE = path.join(ROOT, 'src/main/data/repositories/facebookEngineRepository.ts')
const AI_FILE = path.join(ROOT, 'src/main/services/aiRuntimeService.ts')
const MEDIA_FILE = path.join(ROOT, 'src/main/services/campaignMediaSource.ts')
const STUBS = {
  electron: `
const handler = { get(target, key) { if (key === '__esModule') return false; return target[key] ?? (target[key] = new Proxy(function Stub() {}, handler)) },
  apply() { return new Proxy(function Stub() {}, handler) }, construct() { return new Proxy(function Stub() {}, handler) } }
const stub = () => new Proxy(function Stub() {}, handler)
const names = ['BrowserWindow', 'webContents', 'ipcMain', 'powerMonitor', 'session', 'net', 'dialog', 'shell', 'Notification', 'screen',
  'nativeImage', 'clipboard', 'Menu', 'Tray', 'systemPreferences', 'protocol', 'crashReporter', 'nativeTheme', 'safeStorage', 'contentTracing',
  'desktopCapturer', 'globalShortcut', 'inAppPurchase', 'MessageChannelMain', 'powerSaveBlocker', 'utilityProcess', 'WebContentsView', 'BaseWindow']
const electron = { app: { getPath: () => globalThis.__fbHarness.userData, getVersion: () => '0.0.0-replay', isPackaged: false, getName: () => 'aka-replay',
  on() {}, once() {}, whenReady: () => Promise.resolve(), getAppPath: () => globalThis.__fbHarness.userData } }
for (const name of names) electron[name] = stub()
module.exports = electron`,
  supabaseClient: `module.exports = { getSupabaseClient: () => globalThis.__fbHarness.client, desktopFetch: fetch }`,
  currentUser: `module.exports = { getCurrentUser: () => globalThis.__fbHarness.user, requireCurrentUser: () => globalThis.__fbHarness.user,
    requireCurrentUserCredentials: () => ({ username: 'fb', password: 'pw' }), getCurrentUserCredentials: () => ({ username: 'fb', password: 'pw' }),
    setCurrentUser() {}, setCurrentUserCredentials() {}, onCurrentUserSessionChanged: () => () => {}, runWithCurrentUser: (_u, op) => op(),
    isZaloServerUser: () => false, isZaloShowWebUser: () => false, isCurrentUserZaloShowWeb: () => false, isCurrentUserZaloServerEnabled: () => false }`,
  workflowV2Repository: `module.exports = { getWorkflow: async id => globalThis.__fbHarness.workflows.get(Number(id)) || null,
    getWorkflowByName: async name => [...globalThis.__fbHarness.workflows.values()].find(w => w.name === name) || null }`,
  blockRepository: `module.exports = { getBlock: async id => globalThis.__fbHarness.block(Number(id)) }`,
  runV2Repository: `module.exports = {
    createRun: async run => { const t = globalThis.__fbHarness; t.runs.push({ ...run }); return t.runs.length },
    updateRun: async (id, patch) => { Object.assign(globalThis.__fbHarness.runs[id - 1], patch) },
    createRunStep: async (runId, step) => { const t = globalThis.__fbHarness; t.runSteps.push({ runId, ...step }); return t.runSteps.length },
    updateRunStep: async (id, patch) => { Object.assign(globalThis.__fbHarness.runSteps[id - 1], patch) } }`,
  elementV2Repository: `module.exports = { resolveXpathByName: async name => '//replay-' + name }`,
  facebookPageIdentityRepository: `module.exports = { validateCampaignPageIdentity: async () => undefined }`,
  // Block không chạy code: trả lại kết quả bộ cũ đã ghi (globalThis.__fbHarness.executeBlock).
  blockExecutor: `import { isNotDispatchedError } from '../../engineAdapters/facebook/pageTrace'
export class BlockExecutor {
  async execute(opts, ctx) { return globalThis.__fbHarness.executeBlock(opts, ctx, { isNotDispatchedError }) }
}`,
  // Tệp media: không tải mạng, trả tệp tạm giả cùng đuôi.
  mediawrap: `export * from ${JSON.stringify(MEDIA_FILE)}
export async function downloadCampaignMediaUrl(url, mediaName, mediaTempPaths = []) { return globalThis.__fbHarness.fakeMedia(mediaName || url, mediaTempPaths) }
export async function resolveCampaignMediaSource(item, mediaTempPaths = []) {
  return globalThis.__fbHarness.fakeMedia(String(item?.name || item?.url || item?.path || item?.localPath || 'media.jpg'), mediaTempPaths)
}`,
  // AI (Q11: đọc ảnh lỗi khi dừng theo chuỗi SYS99): không gọi mạng khi phát lại / kịch bản; mặc định báo AI không trả câu (giữ câu của DB).
  aiwrap: `export * from ${JSON.stringify(AI_FILE)}
export async function callAiUsing(code, variables, context) {
  const h = globalThis.__fbHarness
  return h && h.ai ? h.ai(code, variables, context) : { ok: false, error: 'AI không bật khi giả lập' }
}`,
  // Thiết lập chạy của FB: ngưỡng block treo lớn (phát lại không có thao tác thật).
  fbwrap: `export * from ${JSON.stringify(REPO_FILE)}
import * as real from ${JSON.stringify(REPO_FILE)}
export async function loadFacebookRuntimeSettings() { const s = await real.loadFacebookRuntimeSettings(); return { ...s, blockHangMinutes: 600 } }`,
  entry: `export * from ${JSON.stringify(path.join(ROOT, 'src/main/services/campaignScheduler.ts'))}
export { mapAccountFromDB, mapCampaignFromDB, mapCampaignInputDataFromDB } from ${JSON.stringify(path.join(ROOT, 'src/main/data/mappers.ts'))}
export { clearFacebookIdentityMarker, readFacebookIdentityMarker } from ${JSON.stringify(path.join(ROOT, 'src/main/engineAdapters/facebook/identityMarker.ts'))}`
}

/** replayExecutor: block không chạy code, gọi globalThis.__fbHarness.executeBlock (replay); false = BlockExecutor thật. */
async function loadScheduler({ replayExecutor = true } = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-fb-replay-'))
  const outfile = path.join(out, 'scheduler.cjs')
  await build({
    entryPoints: ['entry'], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error', packages: 'external',
    banner: { js: `require = require('node:module').createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});` },
    plugins: [{ name: 'fb-replay', setup(plugin) {
      plugin.onResolve({ filter: /^entry$/ }, () => ({ path: 'entry', namespace: 'stub' }))
      plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'stub' }))
      plugin.onResolve({ filter: /(\/supabaseClient|\/currentUser|repositories\/(workflowV2Repository|blockRepository|runV2Repository|elementV2Repository|facebookPageIdentityRepository))$/ },
        args => ({ path: args.path.split('/').pop(), namespace: 'stub' }))
      if (replayExecutor) plugin.onResolve({ filter: /\/blockExecutor$/ }, () => ({ path: 'blockExecutor', namespace: 'stub' }))
      plugin.onResolve({ filter: /\/campaignMediaSource$/ }, args => args.namespace === 'stub' ? undefined : ({ path: 'mediawrap', namespace: 'stub' }))
      plugin.onResolve({ filter: /repositories\/facebookEngineRepository$/ }, args => args.namespace === 'stub' ? undefined : ({ path: 'fbwrap', namespace: 'stub' }))
      plugin.onResolve({ filter: /\/aiRuntimeService$/ }, args => args.namespace === 'stub' ? undefined : ({ path: 'aiwrap', namespace: 'stub' }))
      plugin.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({
        contents: STUBS[args.path], loader: ['fbwrap', 'aiwrap', 'mediawrap', 'entry', 'blockExecutor'].includes(args.path) ? 'ts' : 'js',
        resolveDir: args.path === 'blockExecutor' ? RUNTIME_DIR : args.path === 'mediawrap' ? path.dirname(MEDIA_FILE) : path.dirname(REPO_FILE) }))
    } }]
  })
  return { mod: require(outfile), out }
}

/** Client Supabase giả: rpc → hàm SQL thật; from() → SELECT / UPDATE / INSERT tối thiểu trên PG cục bộ. */
function fakeClient(db, unknownCalls) {
  const ident = s => '"' + String(s).replaceAll('"', '""') + '"'
  return {
    rpc(name, args) {
      const run = (async () => {
        const params = [], parts = []
        for (const [key, value] of Object.entries(args || {})) {
          const json = value !== null && typeof value === 'object'
          params.push(json ? JSON.stringify(value) : value)
          parts.push(`${key} => $${params.length}${json ? '::jsonb' : ''}`)
        }
        try {
          const r = await db.query(`SELECT public.${name}(${parts.join(', ')}) AS r`, params)
          return { data: r.rows[0].r, error: null, status: 200 }
        } catch (e) {
          unknownCalls.push(['rpc_error', name, e.message.slice(0, 200)])
          return { data: null, error: { message: e.message, code: e.code }, status: 400 }
        }
      })()
      return { abortSignal: () => run, then: (a, b) => run.then(a, b) }
    },
    from(table) {
      const filters = [], params = []
      let cols = '*', mode = 'select', payload = null, single = false
      const add = (sql, value) => { params.push(value); filters.push(sql.replace('?', `$${params.length}`)) }
      const builder = {
        select(c) { if (mode === 'select') cols = c && c !== '*' ? c.split(',').map(x => x.trim()).filter(Boolean).filter(x => /^[a-z_0-9]+$/.test(x)).map(ident).join(', ') || '*' : '*'; return builder },
        eq(col, value) { add(`${ident(col)} = ?`, value); return builder },
        neq(col, value) { add(`${ident(col)} IS DISTINCT FROM ?`, value); return builder },
        gt(col, value) { add(`${ident(col)} > ?`, value); return builder },
        gte(col, value) { add(`${ident(col)} >= ?`, value); return builder },
        lt(col, value) { add(`${ident(col)} < ?`, value); return builder },
        lte(col, value) { add(`${ident(col)} <= ?`, value); return builder },
        in(col, values) { add(`${ident(col)} = ANY(?)`, values); return builder },
        is(col, value) { filters.push(`${ident(col)} IS ${value === null ? 'NULL' : value ? 'TRUE' : 'FALSE'}`); return builder },
        not() { return builder }, or() { return builder }, filter() { return builder }, like() { return builder }, ilike() { return builder },
        contains() { return builder }, match() { return builder },
        order() { return builder }, limit() { return builder }, range() { return builder }, abortSignal() { return builder },
        single() { single = true; return builder }, maybeSingle() { single = true; return builder },
        update(value) { mode = 'update'; payload = value; return builder },
        insert(value) { mode = 'insert'; payload = value; return builder },
        upsert(value) { mode = 'insert'; payload = value; return builder },
        delete() { mode = 'delete'; return builder },
        then(resolve, reject) {
          let run
          if (mode === 'select') {
            run = db.query(`SELECT ${cols} FROM public.${ident(table)}${filters.length ? ' WHERE ' + filters.join(' AND ') : ''}`, params)
              .then(r => ({ data: single ? (r.rows[0] ?? null) : r.rows, error: null }), e => ({ data: null, error: { message: e.message, code: e.code } }))
          } else {
            unknownCalls.push([`client_${mode}`, table, JSON.stringify(payload ?? null).slice(0, 160)])
            run = Promise.resolve({ data: null, error: null })
          }
          return run.then(resolve, reject)
        }
      }
      return builder
    }
  }
}


module.exports = { ROOT, loadScheduler, fakeClient }
