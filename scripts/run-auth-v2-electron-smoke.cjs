const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { spawnSync } = require('node:child_process')
const { buildSync } = require('esbuild')
const root = resolve(__dirname, '..')
const directory = mkdtempSync(join(tmpdir(), 'aka-auth-v2-electron-'))
try {
  buildSync({ entryPoints: [join(root, 'src/main/services/localLoginService.ts')], outfile: join(directory, 'store.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node20', logLevel: 'warning' })
  buildSync({ entryPoints: [join(root, 'src/main/services/deviceIdentity.ts')], outfile: join(directory, 'identity.cjs'),
    bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node20', logLevel: 'warning' })
  writeFileSync(join(directory, 'test.cjs'), `
    const { app, safeStorage } = require('electron');
    const assert = require('node:assert/strict');
    const { join } = require('node:path');
    const { readFileSync, writeFileSync } = require('node:fs');
    const { getLocalLoginStore } = require('./store.cjs');
    const { getCurrentDeviceIdentity } = require('./identity.cjs');
    app.setPath('userData', process.env.AKA_AUTH_SMOKE_DIRECTORY);
    let encryptionCalls = 0;
    for (const method of ['isEncryptionAvailable', 'encryptString', 'decryptString']) {
      safeStorage[method] = () => { encryptionCalls++; throw new Error('Local login must not access OS encryption'); };
    }
    app.whenReady().then(async () => {
      const identity = await getCurrentDeviceIdentity();
      assert.match(identity.fingerprintHash, /^[a-f0-9]{64}$/);
      const identityFile = join(app.getPath('userData'), 'previous-hash');
      const loginFile = join(app.getPath('userData'), 'login-v2.json');
      const options = { rememberLogin: true, autoLogin: true, startupEnabled: true };
      const store = getLocalLoginStore();
      await store.initialize();
      const credential = { username:'dummy-smoke-user',password:'dummy-smoke-password' };
      if (process.env.AKA_AUTH_SMOKE_PHASE === 'write') {
        assert.equal(store.getCredentials(), null);
        assert.equal(store.snapshot().warningMessage, null);
        assert.equal(store.mayImportLegacy(), true, 'a missing local file allows guarded DB migration');
        writeFileSync(identityFile, identity.fingerprintHash);
        await store.updateOptions(options);
        await store.saveAuthenticated(credential);
        assert.equal(store.snapshot().warningMessage, null);
        assert.deepEqual(JSON.parse(readFileSync(loginFile, 'utf8')).credentials, credential);
      } else {
        assert.equal(identity.fingerprintHash, readFileSync(identityFile, 'utf8'), 'real hardware identity survives a process restart');
        assert.deepEqual(store.getCredentials(),credential, 'a new Electron process reads the remembered password without Keychain');
        assert.deepEqual(store.snapshot().loginOptions, options);
        assert(!JSON.stringify(store.snapshot()).includes(credential.password));
        await store.updateOptions({rememberLogin:false});
        assert.equal(store.snapshot().rememberedLogin,null);
        assert.equal(store.snapshot().warningMessage,null);
        assert.equal(JSON.parse(readFileSync(loginFile, 'utf8')).credentials, null);
      }
      assert.equal(encryptionCalls, 0, 'no encryption or Keychain calls');
      console.log('Electron local login without Keychain and '+identity.platform+' hardware identity '+process.env.AKA_AUTH_SMOKE_PHASE+' passed');
      app.exit(0);
    }).catch(error => { console.error(error); app.exit(1); });
  `)
  for (const phase of ['write', 'read']) {
    const env = { ...process.env, AKA_AUTH_SMOKE_DIRECTORY: directory, AKA_AUTH_SMOKE_PHASE: phase }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [join(directory, 'test.cjs')], { cwd: root, env, stdio: 'inherit', timeout: 60000 })
    if (result.error) throw result.error
    if (result.status !== 0) { process.exitCode = result.status ?? 1; break }
  }
} finally { rmSync(directory, { recursive: true, force: true }) }
