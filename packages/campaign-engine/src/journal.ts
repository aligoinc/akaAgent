/**
 * Nhật ký kết quả trong bộ nhớ: dùng cho kiểm thử và làm lớp mặc định của Fly khi chưa có journal bền.
 * Desktop thay bằng bản SQLite (tắt app không mất); hợp đồng giữ nguyên.
 */
import type { JournalEntry, LocalJournal } from './contracts.js'

export class MemoryJournal implements LocalJournal {
  private readonly entries = new Map<string, JournalEntry>()

  async append(entry: JournalEntry): Promise<void> {
    if (!this.entries.has(entry.id)) this.entries.set(entry.id, structuredClone(entry))
  }

  async update(entry: JournalEntry): Promise<void> {
    if (this.entries.has(entry.id)) this.entries.set(entry.id, structuredClone(entry))
  }

  async remove(id: string): Promise<void> {
    this.entries.delete(id)
  }

  async pending(): Promise<JournalEntry[]> {
    return [...this.entries.values()].sort((a, b) => a.createdAt - b.createdAt).map(entry => structuredClone(entry))
  }

  get size(): number {
    return this.entries.size
  }
}

/** Khoá nhật ký ổn định theo kết quả: gửi lại cùng lô thì không sinh dòng mới. */
export function journalId(targetRunId: number, resultKeys: readonly string[], final: boolean): string {
  return `${targetRunId}:${final ? 'final' : 'step'}:${resultKeys.length ? resultKeys.join('|') : 'close'}`
}
