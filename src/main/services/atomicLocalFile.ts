import { mkdir, open, rename, unlink, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function writeAtomicLocalFile(file: string, contents: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const handle = await open(temporary, 'wx', 0o600)
    try { await handle.writeFile(contents, 'utf8'); await handle.sync() } finally { await handle.close() }
    await rename(temporary, file)
    if (await readFile(file, 'utf8') !== contents) throw new Error('Local file verification failed')
  } finally { await unlink(temporary).catch(() => {}) }
}
