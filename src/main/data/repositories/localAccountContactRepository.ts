import Database from 'better-sqlite3'
import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  AutoAccountContact,
  ContactListResult,
  PageInboxContactListQuery,
  PageInboxMessageFilterMode,
  PageInboxPhoneFilter
} from '../../../shared/types'
import { requireCurrentUser } from '../currentUser'

const LOCAL_DATA_DIR = 'local-data'
const LOCAL_DB_FILE = 'aka_agent_local.db'
const PAGE_INBOX_CONTACT_TYPE = 'page_inbox_customer'

export interface PageInboxContactInput {
  accountId: number
  name: string
  uid: string
  extraData: Record<string, unknown>
}

let schemaReady = false

export function getLocalDataDbPath(): string {
  const dir = join(app.getPath('userData'), LOCAL_DATA_DIR)
  mkdirSync(dir, { recursive: true })
  return join(dir, LOCAL_DB_FILE)
}

function openDb(): Database.Database {
  const db = new Database(getLocalDataDbPath())
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  ensureSchema(db)
  return db
}

function ensureSchema(db: Database.Database): void {
  if (schemaReady) return

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS auto_account_contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      contact_type TEXT NOT NULL,
      name TEXT NOT NULL,
      uid TEXT NOT NULL,
      url TEXT,
      extra_data TEXT,
      is_friend INTEGER NOT NULL DEFAULT 0,
      requires_post_approval INTEGER,
      is_joined INTEGER NOT NULL DEFAULT 0,
      is_delete INTEGER NOT NULL DEFAULT 0,
      staff_id INTEGER,
      organization_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, contact_type, uid)
    );

    CREATE INDEX IF NOT EXISTS idx_local_contacts_lookup
      ON auto_account_contacts(account_id, staff_id, contact_type, is_delete);

    CREATE INDEX IF NOT EXISTS idx_local_contacts_page_inbox_page
      ON auto_account_contacts(account_id, staff_id, contact_type, json_extract(extra_data, '$.pageUid'));

    CREATE INDEX IF NOT EXISTS idx_local_contacts_page_inbox_updated
      ON auto_account_contacts(account_id, staff_id, contact_type, updated_at);
  `)

  db.prepare(`
    INSERT OR IGNORE INTO local_schema_migrations (version, name)
    VALUES (1, 'initial_local_account_contacts')
  `).run()

  schemaReady = true
}

function normalizeText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function stringifyExtraData(value: Record<string, unknown>): string {
  return JSON.stringify(value || {})
}

function parseExtraData(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function mapLocalContact(row: Record<string, unknown>): AutoAccountContact {
  return {
    id: Number(row.id),
    accountId: Number(row.account_id),
    contactType: PAGE_INBOX_CONTACT_TYPE,
    name: String(row.name || ''),
    uid: String(row.uid || ''),
    url: row.url ? String(row.url) : undefined,
    extraData: parseExtraData(row.extra_data),
    isFriend: Boolean(row.is_friend),
    requiresPostApproval: row.requires_post_approval === null || row.requires_post_approval === undefined
      ? null
      : Boolean(row.requires_post_approval),
    isJoined: Boolean(row.is_joined),
    isDelete: Boolean(row.is_delete),
    staffId: row.staff_id === null || row.staff_id === undefined ? undefined : Number(row.staff_id),
    organizationId: row.organization_id === null || row.organization_id === undefined ? undefined : Number(row.organization_id),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined
  }
}

export function upsertPageInboxContacts(contacts: PageInboxContactInput[]): number {
  if (contacts.length === 0) return 0

  const u = requireCurrentUser()
  const now = new Date().toISOString()
  const db = openDb()

  try {
    const validContacts = contacts
      .map(contact => ({
        accountId: contact.accountId,
        contactType: PAGE_INBOX_CONTACT_TYPE,
        name: normalizeText(contact.name),
        uid: normalizeText(contact.uid),
        url: null,
        extraData: stringifyExtraData(contact.extraData),
        isFriend: 0,
        requiresPostApproval: null,
        isJoined: 0,
        isDelete: 0,
        staffId: u.staffId,
        organizationId: u.organizationId,
        createdAt: now,
        updatedAt: now
      }))
      .filter(contact => contact.accountId > 0 && contact.uid && contact.name)

    if (validContacts.length === 0) return 0

    const insert = db.prepare(`
      INSERT INTO auto_account_contacts (
        account_id,
        contact_type,
        name,
        uid,
        url,
        extra_data,
        is_friend,
        requires_post_approval,
        is_joined,
        is_delete,
        staff_id,
        organization_id,
        created_at,
        updated_at
      )
      VALUES (
        @accountId,
        @contactType,
        @name,
        @uid,
        @url,
        @extraData,
        @isFriend,
        @requiresPostApproval,
        @isJoined,
        @isDelete,
        @staffId,
        @organizationId,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(account_id, contact_type, uid) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        extra_data = excluded.extra_data,
        is_delete = 0,
        staff_id = excluded.staff_id,
        organization_id = excluded.organization_id,
        updated_at = excluded.updated_at
    `)

    const saveAll = db.transaction((rows: typeof validContacts) => {
      for (const row of rows) insert.run(row)
    })
    saveAll(validContacts)

    return validContacts.length
  } finally {
    db.close()
  }
}

function clampLimit(value: unknown): number {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed) || parsed <= 0) return 100
  return Math.min(parsed, 500)
}

function normalizeOptionalLimit(value: unknown): number | null {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function clampOffset(value: unknown): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function normalizeKeywords(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map(item => item.trim().toLocaleLowerCase('vi-VN'))
    .filter(Boolean)
}

function normalizeIds(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values
    .map(value => Math.floor(Number(value)))
    .filter(value => Number.isFinite(value) && value > 0)))
}

function dateInputToLocalIso(value: unknown, endExclusive = false): string {
  const raw = String(value || '').trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''
  const date = new Date(year, month - 1, day)
  if (endExclusive) date.setDate(date.getDate() + 1)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function addMessageFilter(
  where: string[],
  params: unknown[],
  mode: PageInboxMessageFilterMode,
  keywords: string[]
): void {
  if (mode === 'all' || keywords.length === 0) return

  const expression = "json_extract(extra_data, '$.messageHistory')"
  const negate = mode === 'not_contain_all' || mode === 'not_contain_any'
  const joiner = mode === 'contain_any' || mode === 'not_contain_any' ? ' OR ' : ' AND '
  const parts: string[] = []
  for (const keyword of keywords) {
    parts.push(`LOWER(COALESCE(${expression}, '')) LIKE ?`)
    params.push(`%${keyword}%`)
  }

  where.push(`${negate ? 'NOT ' : ''}(${parts.join(joiner)})`)
}

function buildPageInboxWhere(accountId: number, staffId: number, query: PageInboxContactListQuery): { sql: string; params: unknown[] } {
  const where = [
    'account_id = ?',
    'staff_id = ?',
    'contact_type = ?',
    'is_delete = 0'
  ]
  const params: unknown[] = [accountId, staffId, PAGE_INBOX_CONTACT_TYPE]

  const pageUid = normalizeText(query.pageUid)
  if (pageUid) {
    where.push("json_extract(extra_data, '$.pageUid') = ?")
    params.push(pageUid)
  }

  const ids = normalizeIds(query.ids)
  if (ids.length > 0) {
    where.push(`id IN (${ids.map(() => '?').join(',')})`)
    params.push(...ids)
  }

  const excludeIds = normalizeIds(query.excludeIds)
  if (excludeIds.length > 0) {
    where.push(`id NOT IN (${excludeIds.map(() => '?').join(',')})`)
    params.push(...excludeIds)
  }

  const phoneFilter: PageInboxPhoneFilter = query.phoneFilter || 'all'
  if (phoneFilter === 'has_phone') {
    where.push("COALESCE(json_extract(extra_data, '$.phone'), '') <> ''")
  } else if (phoneFilter === 'no_phone') {
    where.push("COALESCE(json_extract(extra_data, '$.phone'), '') = ''")
  }

  const dateFrom = dateInputToLocalIso(query.dateFrom)
  const dateToExclusive = dateInputToLocalIso(query.dateTo, true)
  if (dateFrom) {
    where.push("datetime(json_extract(extra_data, '$.lastMessageAt')) >= datetime(?)")
    params.push(dateFrom)
  }
  if (dateToExclusive) {
    where.push("datetime(json_extract(extra_data, '$.lastMessageAt')) < datetime(?)")
    params.push(dateToExclusive)
  }

  const search = normalizeText(query.search).toLocaleLowerCase('vi-VN')
  if (search) {
    const searchParts: string[] = []
    const expressions = [
      'name',
      'uid',
      "json_extract(extra_data, '$.phone')",
      "json_extract(extra_data, '$.messageHistory')",
      "json_extract(extra_data, '$.lastMessageText')"
    ]
    for (const expression of expressions) {
      searchParts.push(`LOWER(COALESCE(${expression}, '')) LIKE ?`)
      params.push(`%${search}%`)
    }
    where.push(`(${searchParts.join(' OR ')})`)
  }

  addMessageFilter(
    where,
    params,
    query.messageFilterMode || 'all',
    normalizeKeywords(query.messageKeywords)
  )

  return { sql: `WHERE ${where.join(' AND ')}`, params }
}

export function listPageInboxContacts(accountId: number, query: PageInboxContactListQuery = {}): ContactListResult {
  const u = requireCurrentUser()
  const db = openDb()
  const limit = clampLimit(query.limit)
  const offset = clampOffset(query.offset)

  try {
    const { sql, params } = buildPageInboxWhere(accountId, u.staffId, query)
    const totalRow = db.prepare(`SELECT COUNT(*) AS total FROM auto_account_contacts ${sql}`).get(...params) as { total?: number } | undefined
    const rows = db.prepare(`
      SELECT *
      FROM auto_account_contacts
      ${sql}
      ORDER BY datetime(COALESCE(json_extract(extra_data, '$.lastMessageAt'), updated_at)) DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Record<string, unknown>[]

    return {
      contacts: rows.map(mapLocalContact),
      total: Number(totalRow?.total || 0)
    }
  } finally {
    db.close()
  }
}

export function exportPageInboxContacts(accountId: number, query: PageInboxContactListQuery = {}): AutoAccountContact[] {
  const u = requireCurrentUser()
  const db = openDb()
  const limit = normalizeOptionalLimit(query.limit)
  const offset = clampOffset(query.offset)

  try {
    const { sql, params } = buildPageInboxWhere(accountId, u.staffId, query)
    const paginationSql = limit === null ? '' : 'LIMIT ? OFFSET ?'
    const paginationParams = limit === null ? [] : [limit, offset]
    const rows = db.prepare(`
      SELECT *
      FROM auto_account_contacts
      ${sql}
      ORDER BY datetime(COALESCE(json_extract(extra_data, '$.lastMessageAt'), updated_at)) DESC, id DESC
      ${paginationSql}
    `).all(...params, ...paginationParams) as Record<string, unknown>[]

    return rows.map(mapLocalContact)
  } finally {
    db.close()
  }
}

export function deletePageInboxContacts(accountId: number, pageUid?: string): void {
  const u = requireCurrentUser()
  const db = openDb()
  try {
    const now = new Date().toISOString()
    if (pageUid) {
      db.prepare(`
        UPDATE auto_account_contacts
        SET is_delete = 1, updated_at = ?
        WHERE account_id = ?
          AND staff_id = ?
          AND contact_type = ?
          AND json_extract(extra_data, '$.pageUid') = ?
      `).run(now, accountId, u.staffId, PAGE_INBOX_CONTACT_TYPE, pageUid)
      return
    }

    db.prepare(`
      UPDATE auto_account_contacts
      SET is_delete = 1, updated_at = ?
      WHERE account_id = ?
        AND staff_id = ?
        AND contact_type = ?
    `).run(now, accountId, u.staffId, PAGE_INBOX_CONTACT_TYPE)
  } finally {
    db.close()
  }
}
