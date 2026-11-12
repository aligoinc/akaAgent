/**
 * Nhật ký kết quả của engine v2 trên Desktop: SQLite trong userData, tách khỏi CSDL danh bạ cục bộ.
 * Kết quả nằm ở đây từ trước khi gọi DB tới khi DB xác nhận, nên tắt app, mất mạng hay Supabase sập đều không mất
 * kết quả của thao tác đã xảy ra; lần chạy sau gửi bù (idempotent theo result_key).
 * Mỗi nhật ký thuộc một phạm vi (nhân viên + tài khoản): phiên của người khác trên cùng máy không gửi bù hộ.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { JournalEntry, LocalJournal } from '../../../packages/campaign-engine/src/index'

const JOURNAL_DIR = 'local-data'
const JOURNAL_FILE = 'campaign_engine_journal.db'

let handle: BetterSqlite3.Database | null = null

function db(): BetterSqlite3.Database {
  if (handle) return handle
  // Nạp lười: App Server dùng chung bộ lập lịch nhưng không chạy engine v2, không cần thư viện native này.
  const Database = require('better-sqlite3') as typeof BetterSqlite3
  const dir = join(app.getPath('userData'), JOURNAL_DIR)
  mkdirSync(dir, { recursive: true })
  const opened = new Database(join(dir, JOURNAL_FILE))
  opened.pragma('journal_mode = WAL')
  // Ghi xong mới gửi DB: FULL để mất điện không mất dòng vừa ghi.
  opened.pragma('synchronous = FULL')
  opened.exec(`
    CREATE TABLE IF NOT EXISTS engine_journal (
      scope TEXT NOT NULL,
      id TEXT NOT NULL,
      entry TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (scope, id)
    );
  `)
  handle = opened
  return opened
}

export class SqliteEngineJournal implements LocalJournal {
  constructor(private readonly scope: string) {}

  async append(entry: JournalEntry): Promise<void> {
    db().prepare('INSERT OR IGNORE INTO engine_journal (scope, id, entry, created_at) VALUES (?, ?, ?, ?)')
      .run(this.scope, entry.id, JSON.stringify(entry), entry.createdAt)
  }

  async update(entry: JournalEntry): Promise<void> {
    db().prepare('UPDATE engine_journal SET entry = ? WHERE scope = ? AND id = ?').run(JSON.stringify(entry), this.scope, entry.id)
  }

  async remove(id: string): Promise<void> {
    db().prepare('DELETE FROM engine_journal WHERE scope = ? AND id = ?').run(this.scope, id)
  }

  async pending(): Promise<JournalEntry[]> {
    const rows = db().prepare('SELECT entry FROM engine_journal WHERE scope = ? ORDER BY created_at, id').all(this.scope) as Array<{ entry: string }>
    return rows.map(row => JSON.parse(row.entry) as JournalEntry)
  }
}

/** Đóng CSDL nhật ký khi thoát app (dòng chưa gửi vẫn nằm trong file). */
export function closeEngineJournal(): void {
  const current = handle
  handle = null
  current?.close()
}
