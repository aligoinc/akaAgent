import type { AuthUser } from './types'

/** Missing fields on legacy/server identities never grant desktop administration. */
export function canAccessAdmin(user: Pick<AuthUser, 'organizationId' | 'isAdmin'> | null | undefined): boolean {
  return user?.organizationId === 1 && user.isAdmin === true
}

export const ADMIN_IPC = {
  docs: 'admin:docs', notifications: 'admin:notifications', settings: 'admin:settings',
  cron: 'admin:cron', triggers: 'admin:triggers',
  prepareDoc: 'admin:prepare-doc', closeDoc: 'admin:close-doc', openDocExternal: 'admin:open-doc-external'
} as const

export interface AdminPage<T> { items: T[]; nextCursor: string | null }
export interface AdminApiDoc {
  id: number; name: string; url: string; description: string | null
  sortOrder: number; isActive: boolean; createdAt: string; updatedAt: string; version: string
}
export interface AdminDocInput {
  id?: number; name: string; url: string; description: string; sortOrder: number; isActive: boolean
  expectedVersion?: string
}
export interface AdminNotification {
  staffId: number | null; username: string; organizationId: number | null
  organizationName: string; rawValue: string; version: string; isActive: boolean
}
export interface AdminNotificationSave { staffId: number | null; rawValue: string; expectedVersion: string }
export interface AdminSetting {
  id: number; key: string; value: string | null; description: string | null
  isSecret: boolean; isActive: boolean; version: string
}
export interface AdminSettingSave { id: number; description: string; value?: string; expectedVersion: string }
export interface AdminCronJob { id: string; name: string; schedule: string; isActive: boolean }
export interface AdminCronRun {
  id: string; jobId: string; jobName: string; status: string; startTime: string | null; endTime: string | null
}
export interface AdminCronDetail extends AdminCronRun { command: string; returnMessage: string | null }
export interface AdminCronQuery { cursor?: string | null; jobId?: string; status?: string }
export interface AdminTrigger {
  id: string; name: string; tableName: string; timing: string; events: string; condition: string | null
  functionName: string; isActive: boolean
}
export interface AdminTriggerDetail extends AdminTrigger { definition: string; functionBody: string }
export interface AdminDocDescriptor { id: number; url: string; partition: string; token: string }

export interface AdminApi {
  listDocs(): Promise<AdminApiDoc[]>
  saveDoc(input: AdminDocInput): Promise<AdminApiDoc>
  deleteDoc(id: number, expectedVersion: string): Promise<void>
  prepareDoc(id: number, requestId: string): Promise<AdminDocDescriptor>
  closeDoc(requestId: string): Promise<void>
  openDocExternal(id: number): Promise<void>
  getGlobalNotification(): Promise<AdminNotification>
  listNotifications(cursor?: string | null): Promise<AdminPage<AdminNotification>>
  searchStaff(search: string): Promise<AdminNotification[]>
  saveNotification(input: AdminNotificationSave): Promise<void>
  listSettings(): Promise<AdminSetting[]>
  revealSetting(id: number): Promise<AdminSetting>
  saveSetting(input: AdminSettingSave): Promise<void>
  listCronJobs(): Promise<{ items: AdminCronJob[]; timezone: string }>
  listCronRuns(query: AdminCronQuery): Promise<AdminPage<AdminCronRun>>
  getCronRun(id: string): Promise<AdminCronDetail>
  listTriggers(): Promise<AdminTrigger[]>
  getTrigger(id: string): Promise<AdminTriggerDetail>
}
