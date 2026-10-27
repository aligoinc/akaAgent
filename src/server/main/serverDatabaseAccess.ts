import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { configureTrustedServerSupabase } from '../../main/data/supabaseClient'

function readSecretFile(file: string): string | undefined {
  try {
    const secret = readFileSync(file, 'utf8').trim()
    if (!secret) throw new Error('empty credential')
    return secret
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('Không đọc được khóa DB App Server. Kiểm tra file khóa và quyền truy cập trên máy chủ.')
  }
}

export function configureServerDatabaseAccess(directory: string, packagedResources?: string): void {
  // Only the private, centrally operated Server installer supplies this resource.
  // Explicit host overrides take precedence so a key can be rotated without rebuilding.
  let secret = process.env.AKA_AGENT_SERVER_SUPABASE_SECRET_KEY?.trim()
  if (!secret) secret = readSecretFile(join(directory, 'supabase-server-secret.key'))
  if (!secret && packagedResources) {
    secret = readSecretFile(join(packagedResources, 'server-private', 'supabase-server-secret.key'))
  }
  if (!secret) throw new Error('Chưa cấu hình khóa truy cập DB cho App Server. Vui lòng dùng bộ cài Server nội bộ hoặc cấu hình khóa backend trên máy chủ.')
  configureTrustedServerSupabase(secret)
}
