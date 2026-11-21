// Nạp nguyên lớp CampaignScheduler thật (src/main/services/campaignScheduler.ts) để chạy nhánh "Tìm data" trên DB cục bộ.
// Module dùng chung (src/shared, packages/campaign-engine/src) nạp mã thật; module chạm Electron / Supabase / trình duyệt thay bằng
// bản giả không làm gì (chỉ cần có mặt khi nạp file). Phần nào bài kiểm cần thì truyền ở `overrides` theo đường dẫn import.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '../..')
const REAL_PREFIXES = [path.join(root, 'src/shared'), path.join(root, 'packages/campaign-engine/src')]
const NODE_BUILTINS = new Set(['crypto', 'fs', 'path', 'os', 'url', 'util', 'events', 'node:crypto', 'node:fs', 'node:path', 'node:os'])

function stub(name) {
  const fn = function () { return proxy }
  const proxy = new Proxy(fn, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => `[stub ${name}]`
      if (key === 'then') return undefined
      if (key === 'prototype') return {}
      return proxy
    },
    apply() { return proxy },
    construct() { return proxy }
  })
  return proxy
}

function resolveTs(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

function createLoader(overrides = {}, internals = {}) {
  const cache = new Map()
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports
    let code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
    }).outputText
    // Lấy ra vài tên cấp module không export (ví dụ lớp lỗi nội bộ) để bài kiểm dùng đúng lớp đó.
    const names = internals[file] || []
    if (names.length) code += `\nmodule.exports.__internals = { ${names.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`
    const module = { exports: {} }
    cache.set(file, module)
    const localRequire = spec => {
      if (spec in overrides) return overrides[spec]
      if (NODE_BUILTINS.has(spec)) return require(spec)
      if (spec.startsWith('.')) {
        const target = resolveTs(file, spec)
        if (target && target in overrides) return overrides[target]
        if (target && REAL_PREFIXES.some(prefix => target.startsWith(prefix))) return load(target)
        return stub(spec)
      }
      try { return require(spec) } catch { return stub(spec) }
    }
    new Function('module', 'exports', 'require', '__filename', '__dirname', code)(module, module.exports, localRequire, file, path.dirname(file))
    return module.exports
  }
  return load
}

/** Trả { CampaignScheduler, load } với các import thay thế. */
function loadScheduler(overrides = {}, internalNames = ['FacebookEngineReportStop']) {
  const file = path.join(root, 'src/main/services/campaignScheduler.ts')
  const load = createLoader(overrides, { [file]: internalNames })
  const exports = load(file)
  return { CampaignScheduler: exports.CampaignScheduler, internals: exports.__internals || {}, load }
}

module.exports = { loadScheduler, createLoader, root }
