import { app } from 'electron'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

interface Entry { staffId: number; requestId: string; accountId?: number; profilePath?: string }
/** No cookies, password or seed on disk here. Dirty identities fence stale cloud restoration. */
export class FacebookLoginJournal {
  private data: { dirty: Record<string, true>; pending: Entry[] } = { dirty: {}, pending: [] }
  private readonly path: string
  constructor() {
    const directory = app.getPath('userData')
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, 'facebook-login-journal.json')
    try { this.data = JSON.parse(readFileSync(this.path, 'utf8')) } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Không đọc được trạng thái khôi phục Facebook. Giữ nguyên file để kiểm tra.')
    }
    if (!this.data.dirty || !Array.isArray(this.data.pending)) throw new Error('Trạng thái khôi phục Facebook không hợp lệ.')
  }
  private flush(): void {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.data), { mode: 0o600 })
    renameSync(`${this.path}.tmp`, this.path)
  }
  dirty(staffId: number, accountId: number): boolean { return !!this.data.dirty[`${staffId}:${accountId}`] }
  mark(staffId: number, accountId: number, dirty: boolean): void {
    const key = `${staffId}:${accountId}`
    if (!!this.data.dirty[key] === dirty) return
    if (dirty) this.data.dirty[key] = true
    else delete this.data.dirty[key]
    this.flush()
  }
  pending(staffId: number): Entry[] { return this.data.pending.filter(entry => entry.staffId === staffId) }
  put(entry: Entry): void {
    const previous = this.data.pending.find(item => item.requestId === entry.requestId)
    this.data.pending = this.data.pending.filter(item => item.requestId !== entry.requestId)
    this.data.pending.push({ ...previous, ...entry }); this.flush()
  }
  remove(requestId: string): void {
    this.data.pending = this.data.pending.filter(entry => entry.requestId !== requestId); this.flush()
  }
}
