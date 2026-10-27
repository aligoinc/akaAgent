const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const asar = require('@electron/asar')
const ts = require('typescript')
const { validBackendKey, resourceName } = require('../server-private-package.cjs')
const root = path.resolve(__dirname, '../..')
const directory = path.resolve(process.argv[2] || '')
const prefix = path.join(root, 'dist-server', 'private') + path.sep
if (!directory.startsWith(prefix)) throw new Error('Pass the private build output directory.')
const requireCheck = (condition, message) => { if (!condition) throw new Error(message) }
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? files(file) : entry.isFile() ? [file] : []
  })
}
function command(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  requireCheck(!result.error && result.status === 0, 'Verification subprocess failed; output withheld.')
  return result.stdout
}

const version = require(path.join(root, 'package.json')).version
const installer = path.join(directory, `akaAgent-Zalo-Server-Internal-Setup-${version}.exe`)
const unpacked = path.join(directory, 'win-unpacked')
const resourceRelative = `resources/server-private/${resourceName}`
const secret = fs.readFileSync(path.join(unpacked, resourceRelative), 'utf8').trim()
requireCheck(validBackendKey(secret), 'Invalid packaged backend credential.')
const archive = path.join(unpacked, 'resources/app.asar')
const packageInfo = JSON.parse(asar.extractFile(archive, 'package.json').toString())
requireCheck(packageInfo.version === version && packageInfo.main === 'out-server/main/index.js', 'Wrong Server package/version.')
const main = asar.extractFile(archive, 'out-server/main/index.js')
requireCheck(main.equals(fs.readFileSync(path.join(root, 'out-server/main/index.js'))), 'Packaged Server main differs from build output.')
requireCheck(main.includes(Buffer.from('process.resourcesPath')) && main.includes(Buffer.from('server-private')), 'Missing packaged resource loader.')
requireCheck(!fs.readFileSync(archive).includes(Buffer.from(secret)), 'Backend key must be outside the JavaScript archive.')
const tracked = command('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z']).split('\0').filter(Boolean)
const checked = [...new Set(tracked)].map(file => path.join(root, file)).filter(file => fs.existsSync(file) && fs.statSync(file).isFile())
checked.push(...files(path.join(root, 'out')), ...files(path.join(root, 'out-server')))
for (const file of checked) requireCheck(!fs.readFileSync(file).includes(Buffer.from(secret)), 'Backend credential leaked outside private resources: ' + path.relative(root, file))
const desktopPackage = require(path.join(root, 'package.json')).build
requireCheck(!JSON.stringify(desktopPackage).includes('server-private'), 'Desktop packaging references private resources.')
requireCheck(command('git', ['check-ignore', directory]).trim() === directory, 'Private output is not ignored by Git.')

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-private-installer-check-'))
try {
  const payload = ['akaAgent Zalo Server.exe', 'resources/app.asar', 'resources/version.txt', resourceRelative,
    'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node']
  command(require('7zip-bin').path7za, ['x', '-y', '-o' + temp, installer, ...payload])
  for (const relative of payload) requireCheck(sha(path.join(temp, relative)) === sha(path.join(unpacked, relative)), 'Installer payload mismatch: ' + relative)
  const exe = fs.readFileSync(path.join(temp, 'akaAgent Zalo Server.exe'))
  requireCheck(exe.subarray(0, 2).toString() === 'MZ' && exe.readUInt16LE(exe.readUInt32LE(0x3c) + 4) === 0x8664, 'Server executable is not Windows x64.')
  // Load the extracted resource on a clean host with no env/file setup.
  const exports = {}
  let configured = false
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/server/main/serverDatabaseAccess.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, { exports, process: { env: {} }, require: name => name === '../../main/data/supabaseClient'
    ? { configureTrustedServerSupabase: value => { configured = value === secret } } : require(name) })
  exports.configureServerDatabaseAccess(path.join(temp, 'new-host-user-data'), path.join(temp, 'resources'))
  requireCheck(configured, 'Clean host did not load the installer credential.')
} finally { fs.rmSync(temp, { recursive: true, force: true }) }

const before = JSON.parse(fs.readFileSync(path.join(root, 'dist-server/private/verification-before.json'), 'utf8'))
for (const [file, digest] of Object.entries(before.sha256)) requireCheck(sha(path.join(root, file)) === digest, 'Existing installer/native file changed: ' + file)
const receipt = {
  verified_at: new Date().toISOString(), version, installer: path.relative(root, installer),
  installer_bytes: fs.statSync(installer).size, installer_sha256: sha(installer),
  checks: { windows_x64: true, installer_payload_parity: true, clean_host_credential_loading: true,
    server_main_parity: true, credential_absent_from_source_desktop_and_js: true,
    source_and_output_files_scanned: checked.length, git_ignored: true,
    existing_server_installers_unchanged: true, host_native_restored: true },
  windows_runtime_tested: false, published: false, rls_activation_applied: false
}
fs.writeFileSync(path.join(directory, 'verification.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 })
console.log(JSON.stringify(receipt, null, 2))
