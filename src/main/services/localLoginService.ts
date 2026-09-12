import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { LocalLoginStore } from './localLoginStore'

let store: LocalLoginStore | null = null
export function getLocalLoginStore(): LocalLoginStore {
  return store ??= new LocalLoginStore({
    file: join(app.getPath('userData'), 'login-v2.json'),
    encrypt: value => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable')
      return safeStorage.encryptString(value)
    },
    decrypt: value => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption unavailable')
      return safeStorage.decryptString(value)
    }
  })
}
