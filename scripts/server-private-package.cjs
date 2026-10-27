// Private Server installers contain an extractable backend credential. Never publish them.
const { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { spawnSync } = require('node:child_process')

const projectRef = 'cgjbsmqtfhqvttudyjzq'
const resourceName = 'supabase-server-secret.key'

function validBackendKey(value) {
  if (typeof value !== 'string') return false
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return true
  try {
    const parts = value.split('.')
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return parts.length === 3 && claims.role === 'service_role' && claims.ref === projectRef
  } catch { return false }
}

function selectBackendKey(keys) {
  if (!Array.isArray(keys)) throw new Error('Supabase CLI did not return an API key list.')
  // Modern keys may be masked by the Management API. Do not use a masked key,
  // nor borrow a key named for another backend service.
  const dedicated = keys.find(k => k.type === 'secret' && k.name === 'akaAgentServer' && validBackendKey(k.api_key))
  const legacy = keys.find(k => k.name === 'service_role' && validBackendKey(k.api_key))
  const chosen = dedicated || legacy
  if (!chosen) throw new Error('No usable App Server backend key. Log in to Supabase CLI or supply a private key file.')
  return chosen.api_key
}

function loadBackendKey() {
  const supplied = process.env.AKA_AGENT_SERVER_SUPABASE_SECRET_KEY?.trim()
  if (supplied) return supplied
  const file = process.env.AKA_AGENT_SERVER_SUPABASE_SECRET_FILE
  if (file) {
    try { return readFileSync(file, 'utf8').trim() }
    catch { throw new Error('Cannot read the private Server credential file.') }
  }
  // Keep both streams private: never inherit stdio or include response bodies in errors.
  const result = spawnSync('supabase', ['projects', 'api-keys', '--project-ref', projectRef, '--output', 'json'], {
    encoding: 'utf8', stdio: 'pipe', timeout: 30000, windowsHide: true
  })
  if (result.error || result.status !== 0) throw new Error('Cannot obtain the Server key. Run supabase login, then retry the private build.')
  let keys
  try { keys = JSON.parse(result.stdout) }
  catch { throw new Error('Supabase CLI returned an invalid response.') }
  return selectBackendKey(keys)
}

async function preparePrivateServerPackage(projectRoot, outputDirectory) {
  const secret = loadBackendKey()
  if (!validBackendKey(secret)) throw new Error('Invalid backend key for the akachat project.')
  // Read-only, empty result: verifies the credential is accepted by this project
  // without retrieving customer rows. The JWT role/ref is checked above.
  let response
  try {
    response = await fetch(`https://${projectRef}.supabase.co/rest/v1/org_staff?select=id&limit=0`, {
      headers: { apikey: secret, Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15000)
    })
  } catch { throw new Error('Cannot validate the private Server key against akachat.') }
  if (response.status !== 200) throw new Error(`Private Server key validation failed (HTTP ${response.status}).`)
  const body = await response.text()
  if (body.trim() !== '[]') throw new Error('Unexpected private Server key validation response.')

  const staging = mkdtempSync(join(tmpdir(), 'aka-server-private-'))
  const cleanup = () => rmSync(staging, { recursive: true, force: true })
  try {
    mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
    const keyFile = join(staging, resourceName)
    writeFileSync(keyFile, secret + '\n', { mode: 0o600, flag: 'wx' })
    const configPath = join(staging, 'electron-builder.private.json')
    writeFileSync(configPath, JSON.stringify({
      extends: join(projectRoot, 'electron-builder.server.yml'),
      directories: { output: outputDirectory },
      artifactName: 'akaAgent-Zalo-Server-Internal-Setup-${version}.${ext}',
      publish: null,
      extraResources: [
        { from: 'version.txt', to: 'version.txt' },
        { from: 'build/icon.png', to: 'icon.png' },
        { from: keyFile, to: `server-private/${resourceName}` }
      ]
    }, null, 2), { mode: 0o600, flag: 'wx' })
    writeFileSync(join(outputDirectory, 'INTERNAL-ONLY.txt'),
      'PRIVATE APP SERVER INSTALLER — contains a backend key for akachat.\n' +
      'Install only on centrally managed servers. Do not distribute to customers or upload publicly.\n' +
      'The credential is extractable. No key is included in Desktop packages.\n', { mode: 0o600 })
    return { configPath, keyFile, cleanup }
  } catch (error) { cleanup(); throw error }
}

module.exports = { preparePrivateServerPackage, validBackendKey, selectBackendKey, resourceName }
