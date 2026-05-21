import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { join, normalize } from 'path'
import {
  AkaBizCampaignListItem,
  AkaBizCampaignListKind,
  AkaBizIntegrationInfo
} from '../../shared/types'

const AKA_BIZ_DESKTOP_DB_RELATIVE_PATH = join('Resources2', 'akabiz_auto_local.db')
const PHONE_IMPORT_ACTIONS = ['zalo_addfriend', 'zalo_send_to_phone']
const GROUP_LINK_IMPORT_ACTIONS = ['zalo_join_group_link']

export interface AkaBizDesktopCampaignSummary {
  id: number
  name: string | null
  shopId: number
  shopName: string | null
  campaignActionId: string | null
  status: string | null
  contentMessage: string | null
  isDelete: boolean | null
}

export interface AkaBizDesktopInstallPathResult {
  installPath: string
  dbPath: string
}

export interface AkaBizDesktopCampaignDetailInput {
  campaignId: number
  status: number
  phone?: string | null
  uid?: string | null
  isAutomate: boolean
}

function normalizeInstallPath(installPath: string): string {
  return normalize(String(installPath || '').trim().replace(/^["']|["']$/g, ''))
}

export function resolveAkaBizDesktopDbPath(installPath: string): AkaBizDesktopInstallPathResult {
  const normalizedInstallPath = normalizeInstallPath(installPath)
  if (!normalizedInstallPath) {
    throw new Error('Vui lòng chọn thư mục cài đặt akaBiz Desktop.')
  }

  const dbPath = join(normalizedInstallPath, AKA_BIZ_DESKTOP_DB_RELATIVE_PATH)
  if (!existsSync(dbPath)) {
    throw new Error('Không tìm thấy file Resources2/akabiz_auto_local.db trong thư mục đã chọn.')
  }

  return {
    installPath: normalizedInstallPath,
    dbPath
  }
}

function getDbPath(integration: AkaBizIntegrationInfo): string {
  const dbPath = String(integration.dbPath || '').trim()
  if (!dbPath) {
    throw new Error('Chưa chọn thư mục cài đặt akaBiz Desktop.')
  }
  if (!existsSync(dbPath)) {
    throw new Error('Không tìm thấy file dữ liệu akaBiz Desktop.')
  }
  return dbPath
}

function openDb(dbPath: string, readonly = false): Database.Database {
  return new Database(dbPath, { readonly, fileMustExist: true })
}

function campaignActionsForKind(kind: AkaBizCampaignListKind): string[] {
  if (kind === 'desktopZaloPhone') return PHONE_IMPORT_ACTIONS
  if (kind === 'desktopZaloGroupLink') return GROUP_LINK_IMPORT_ACTIONS
  throw new Error('Loại campaign akaBiz Desktop không hợp lệ.')
}

function mapCampaignListRow(row: any): AkaBizCampaignListItem {
  return {
    id: Number(row.id),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    shopId: Number(row.shopId || 0),
    shopName: row.shopName === null || row.shopName === undefined ? null : String(row.shopName),
    campaignActionId: row.campaignActionId === null || row.campaignActionId === undefined ? null : String(row.campaignActionId),
    schedule: row.schedule === null || row.schedule === undefined ? null : String(row.schedule),
    status: row.status === null || row.status === undefined ? null : String(row.status)
  }
}

function mapCampaignSummaryRow(row: any): AkaBizDesktopCampaignSummary {
  return {
    id: Number(row.id),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    shopId: Number(row.shopId || 0),
    shopName: row.shopName === null || row.shopName === undefined ? null : String(row.shopName),
    campaignActionId: row.campaignActionId === null || row.campaignActionId === undefined ? null : String(row.campaignActionId),
    status: row.status === null || row.status === undefined ? null : String(row.status),
    contentMessage: row.contentMessage === null || row.contentMessage === undefined ? null : String(row.contentMessage),
    isDelete: row.isDelete === null || row.isDelete === undefined ? null : Boolean(row.isDelete)
  }
}

export function listAkaBizDesktopCampaigns(
  kind: AkaBizCampaignListKind,
  integration: AkaBizIntegrationInfo
): AkaBizCampaignListItem[] {
  const dbPath = getDbPath(integration)
  const actions = campaignActionsForKind(kind)
  const placeholders = actions.map(() => '?').join(', ')
  const db = openDb(dbPath, true)
  try {
    const rows = db.prepare(`
      SELECT
        [Id] AS id,
        [Name] AS name,
        [ShopId] AS shopId,
        [ShopName] AS shopName,
        [CampaignActionId] AS campaignActionId,
        [Schedule] AS schedule,
        [Status] AS status
      FROM [autoCampaign]
      WHERE [StaffId] = ?
        AND [CampaignActionId] IN (${placeholders})
        AND ([IsDelete] IS NULL OR [IsDelete] = 0)
      ORDER BY [Schedule] DESC, [Id] DESC
      LIMIT 100
    `).all(integration.staffId, ...actions)

    return rows.map(mapCampaignListRow)
  } finally {
    db.close()
  }
}

export function getAkaBizDesktopCampaign(
  integration: AkaBizIntegrationInfo,
  campaignId: number
): AkaBizDesktopCampaignSummary {
  const db = openDb(getDbPath(integration), true)
  try {
    const row = db.prepare(`
      SELECT
        [Id] AS id,
        [Name] AS name,
        [ShopId] AS shopId,
        [ShopName] AS shopName,
        [CampaignActionId] AS campaignActionId,
        [Status] AS status,
        [ContentMessage] AS contentMessage,
        [IsDelete] AS isDelete
      FROM [autoCampaign]
      WHERE [Id] = ?
      LIMIT 1
    `).get(campaignId)

    if (!row) throw new Error('Chiến dịch akaBiz Desktop không tồn tại.')
    return mapCampaignSummaryRow(row)
  } finally {
    db.close()
  }
}

export function updateAkaBizDesktopCampaignStatus(
  integration: AkaBizIntegrationInfo,
  campaignId: number,
  status: string
): void {
  const db = openDb(getDbPath(integration))
  try {
    db.prepare(`
      UPDATE [autoCampaign]
      SET [Status] = ?
      WHERE [Id] = ?
    `).run(status, campaignId)
  } finally {
    db.close()
  }
}

export function addAkaBizDesktopCampaignDetails(
  integration: AkaBizIntegrationInfo,
  details: AkaBizDesktopCampaignDetailInput[]
): void {
  if (details.length === 0) return

  const db = openDb(getDbPath(integration))
  try {
    const insert = db.prepare(`
      INSERT INTO [autoCampaignDetail] (
        [CampaignId],
        [Status],
        [Phone],
        [Uid],
        [IsAutomate]
      )
      VALUES (
        @campaignId,
        @status,
        @phone,
        @uid,
        @isAutomate
      )
    `)

    const insertAll = db.transaction((rows: AkaBizDesktopCampaignDetailInput[]) => {
      for (const row of rows) {
        insert.run({
          campaignId: row.campaignId,
          status: row.status,
          phone: row.phone ?? null,
          uid: row.uid ?? null,
          isAutomate: row.isAutomate ? 1 : 0
        })
      }
    })

    insertAll(details)
  } finally {
    db.close()
  }
}
