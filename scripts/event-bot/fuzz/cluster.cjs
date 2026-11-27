'use strict'
/*
 * Postgres cục bộ cho bộ thử Bot sự kiện: fixture → V660 thật → V672, lưu thành DB mẫu `tpl`; mỗi hạt giống dựng DB mới từ mẫu.
 * pg: đặt PG_MODULE_DIR=<thư mục có node_modules/pg> (ví dụ checkout akaAgentChatApi) hoặc cài pg ở thư mục cha.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const REPO = path.resolve(__dirname, '../../..')

function loadPg() {
  const dirs = [process.env.PG_MODULE_DIR, REPO].filter(Boolean)
  for (const d of dirs) {
    try { return require(require.resolve('pg', { paths: [d, path.join(d, 'node_modules')] })) } catch { /* thử tiếp */ }
  }
  throw new Error('Không tìm thấy module pg: đặt PG_MODULE_DIR=<thư mục có node_modules/pg>')
}

function pgBin() {
  if (process.env.PGBIN) return process.env.PGBIN
  const base = '/usr/lib/postgresql'
  const v = fs.readdirSync(base).sort((a, b) => Number(a) - Number(b)).pop()
  return path.join(base, v, 'bin')
}

function run(cmd, args, opts = {}) {
  const asRoot = process.getuid && process.getuid() === 0
  const [c, a] = asRoot ? ['runuser', ['-u', 'postgres', '--', cmd, ...args]] : [cmd, args]
  return execFileSync(c, a, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' }, ...opts }).toString()
}

/** Khởi động cụm, dựng DB `tpl`. Trả { host, port, stop(), connect(db) }. */
async function startCluster({ port = 50000 + (process.pid % 9000), patches = [] } = {}) {
  const pg = loadPg()
  const bin = pgBin()
  const tmp = fs.mkdtempSync(path.join(process.env.FUZZ_TMP || os.tmpdir(), 'evfuzz-'))
  fs.chmodSync(tmp, 0o777)
  run(path.join(bin, 'initdb'), ['-D', path.join(tmp, 'data'), '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'])
  run(path.join(bin, 'pg_ctl'), ['-D', path.join(tmp, 'data'), '-o', `-k ${tmp} -p ${port} -c listen_addresses='' -c timezone=UTC -c max_connections=60 -c fsync=off -c synchronous_commit=off`, '-l', path.join(tmp, 'log'), '-w', 'start'])
  const stop = () => { try { run(path.join(bin, 'pg_ctl'), ['-D', path.join(tmp, 'data'), 'stop', '-m', 'immediate']) } catch { /* bỏ qua */ } }
  process.on('exit', stop)
  const connect = async (database, user = 'postgres') => {
    const c = new pg.Client({ host: tmp, port, user, database })
    await c.connect()
    c.on('error', () => {})
    return c
  }
  const admin = await connect('postgres')
  await admin.query('CREATE DATABASE tpl')
  const t = await connect('tpl')
  const files = [
    path.join(REPO, 'scripts/event-bot/db/v672-fixture.sql'),
    path.join(REPO, 'migrations/migration_v660_zalo_tag_sync.sql'),
    path.resolve(REPO, process.env.V672_FILE || 'migrations/migration_v672_event_bot.sql'),
    ...patches
  ]
  for (const f of files) {
    try { await t.query(fs.readFileSync(f, 'utf8')) } catch (e) { throw new Error(`Nạp ${path.basename(f)} lỗi: ${e.message}`) }
  }
  await t.end()
  let n = 0
  return {
    tmp, port, stop, connect,
    /** DB mới từ mẫu. */
    async fresh() {
      const name = `s${process.pid}_${++n}`
      await admin.query(`CREATE DATABASE ${name} TEMPLATE tpl`)
      return { name, connect: user => connect(name, user) }
    },
    async drop(name) { try { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`) } catch { /* bỏ qua */ } },
    async end() { await admin.end(); stop() }
  }
}

/** Sinh ngẫu nhiên có hạt giống (mulberry32). */
function rng(seed) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    shuffle: arr => { const a2 = [...arr]; for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]] } return a2 },
    sample: (arr, k) => r.shuffle(arr).slice(0, k)
  }
  return r
}

function loadPool() {
  const p = process.env.EVENT_BOT_POOL
  if (!p) return null
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function buildTs(entry) {
  const esbuild = require('esbuild')
  const o = esbuild.buildSync({ entryPoints: [path.join(REPO, entry)], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' })
  const m = { exports: {} }
  new Function('module', 'exports', 'require', o.outputFiles[0].text)(m, m.exports, require)
  return m.exports
}

module.exports = { startCluster, rng, loadPool, buildTs, REPO }
