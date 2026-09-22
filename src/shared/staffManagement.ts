import type { AuthUser } from './types'

export const STAFF_MANAGEMENT_IPC = 'staff-management:invoke'
export function canManageStaff(user: Pick<AuthUser, 'isAdmin'> | null | undefined): boolean {
  return user?.isAdmin === true
}
export type StaffStatus = 'active' | 'locked' | 'expired'
export interface StaffGroup {
  id: number; name: string; parentId: number | null; staffCount: number; version: string
}
export interface ManagedStaff {
  id: number; name: string; phone: string; username: string; isAdmin: boolean; isActive: boolean
  createdAt: string; expirationDate: string | null; effectiveExpirationDate: string | null
  expirySource: 'staff' | 'organization'; status: StaffStatus; daysRemaining: number | null
  groupIds: number[]; groupNames: string[]; version: string
}
export interface StaffOrganization {
  id: number; name: string; maxStaff: number; staffCount: number; staffDurationDays: number
  useOrganizationExpiration: boolean; expirationDate: string | null; today: string
}
export interface StaffQuery { search?: string; groupId?: number | null; status?: StaffStatus | 'all'; page?: number }
export interface StaffPage { items: ManagedStaff[]; groups: StaffGroup[]; organization: StaffOrganization; total: number; page: number }
export interface StaffVersion { id: number; expectedVersion: string }
export interface StaffSave {
  id?: number; name: string; phone: string; groupId: number; expectedVersion?: string; requestId: string
}
export interface StaffGroupSave {
  id?: number; name: string; parentId: number | null; expectedVersion?: string; requestId: string
}
export interface StaffDevice {
  id: number; name: string; username: string; version: string; isBound: boolean
  label: string | null; platform: string | null; lastSeenAt: string | null
}
export interface StaffManagementApi {
  list(query: StaffQuery): Promise<StaffPage>
  saveGroup(input: StaffGroupSave): Promise<{ id: number }>
  saveStaff(input: StaffSave): Promise<ManagedStaff>
  setStatus(input: { targets: StaffVersion[]; isActive: boolean; requestId: string }): Promise<{ count: number }>
  revealPassword(id: number): Promise<{ password: string }>
  prepareDevices(ids: number[]): Promise<{ items: StaffDevice[] }>
  resetDevices(input: { targets: StaffVersion[]; requestId: string }): Promise<{ count: number }>
}
export type StaffManagementAction = keyof StaffManagementApi
export interface StaffAccess {
  isAdmin: boolean; isActive: boolean; timeAllowed: boolean
  expirationDate: string | null; useOrganizationExpiration: boolean
}

export function staffErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error || 'Không thể hoàn tất thao tác.'))
    .replace(/^Error invoking remote method '[^']+':\s*/i, '').replace(/^Error:\s*/i, '')
}
