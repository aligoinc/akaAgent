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
import { performance } from 'perf_hooks'
import type { JournalEntry, LocalJournal } from '../../../packages/campaign-engine/src/index'

const JOURNAL_DIR = 'local-data'
const JOURNAL_FILE = 'campaign_engine_journal.db'

let handle: BetterSqlite3.Database | null = null

// better-sqlite3 chạy đồng bộ trên luồng chính (synchronous = FULL chờ ghi xong xuống đĩa): App Server báo lại thời gian này
// trong dòng [ServerHealth] mỗi phút (src/server/main/serverHealthMonitor.ts). Desktop không đọc.
const opStats = { count: 0, totalMs: 0, maxMs: 0 }

function timed<T>(run: () => T): T {
  const startedAt = performance.now()
  try {
    return run()
  } finally {
    const elapsedMs = performance.now() - startedAt
    opStats.count += 1
    opStats.totalMs += elapsedMs
    if (elapsedMs > opStats.maxMs) opStats.maxMs = elapsedMs
  }
}

/** Số lệnh nhật ký, tổng / lâu nhất (ms) từ lần đọc trước; đọc xong là đặt lại. */
export function takeEngineJournalStats(): { count: number; totalMs: number; maxMs: number } {
  const stats = { ...opStats }
  opStats.count = 0
  opStats.totalMs = 0
  opStats.maxMs = 0
  return stats
}

function db(): BetterSqlite3.Database {
  if (handle) return handle
  // Nạp lười: chỉ khi engine v2 chạy lượt đầu. App Server chỉ cần khi có tổ chức bật engine.zalo_server_vps (V667); bộ cài App Server
  // đã đóng gói better-sqlite3 (electron-builder.server.yml asarUnpack).
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
    timed(() => db().prepare('INSERT OR IGNORE INTO engine_journal (scope, id, entry, created_at) VALUES (?, ?, ?, ?)')
      .run(this.scope, entry.id, JSON.stringify(entry), entry.createdAt))
  }

  async update(entry: JournalEntry): Promise<void> {
    timed(() => db().prepare('UPDATE engine_journal SET entry = ? WHERE scope = ? AND id = ?').run(JSON.stringify(entry), this.scope, entry.id))
  }

  async remove(id: string): Promise<void> {
    timed(() => db().prepare('DELETE FROM engine_journal WHERE scope = ? AND id = ?').run(this.scope, id))
  }

  async pending(): Promise<JournalEntry[]> {
    const rows = timed(() => db().prepare('SELECT entry FROM engine_journal WHERE scope = ? ORDER BY created_at, id').all(this.scope)) as Array<{ entry: string }>
    return rows.map(row => JSON.parse(row.entry) as JournalEntry)
  }
}

/** Đóng CSDL nhật ký khi thoát app (dòng chưa gửi vẫn nằm trong file). */
export function closeEngineJournal(): void {
  const current = handle
  handle = null
  current?.close()
}
