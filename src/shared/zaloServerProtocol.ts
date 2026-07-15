export const ZALO_SERVER_DEFAULT_ORIGIN = 'https://akazalo.akabiz.net'
export const ZALO_SERVER_INTERNAL_HOST = '127.0.0.1'
export const ZALO_SERVER_INTERNAL_PORT = 8787
/** Live control state only; never render this channel as an activity log. */
export const ZALO_SERVER_OPERATION_UPDATED_CHANNEL = 'zalo-server:operation-updated'

export const ZALO_SERVER_IPC = {
  GET_SNAPSHOT: 'zalo-server:get-snapshot',
  CLEAR_LOGS: 'zalo-server:clear-logs',
  RUNTIME_EVENT: 'zalo-server:runtime-event',
  SNAPSHOT_UPDATED: 'zalo-server:snapshot-updated'
} as const

export type ZaloServerRuntimeState = 'waiting' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'

export interface ZaloServerRuntimeEvent {
  sequence: number
  timestamp: string
  staffId: number
  organizationId: number
  channel: string
  payload: unknown
}

export type ZaloServerOperationStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface ZaloServerOperationSnapshot {
  operationId: string
  staffId: number
  organizationId: number
  command: ZaloServerCommandName
  accountId: number | null
  status: ZaloServerOperationStatus
  startedAt: string
  updatedAt: string
  completedAt: string | null
  result?: unknown
  error?: string
}

export interface ZaloServerStaffSnapshot {
  staffId: number
  organizationId: number
  staffName: string
  organizationName: string
  state: ZaloServerRuntimeState
  startedAt: string | null
  lastError: string | null
}

export interface ZaloServerSnapshot {
  state: ZaloServerRuntimeState
  startedAt: string
  vietnamTime: string
  timeZoneOk: boolean
  listeningAt: string
  connectedClients: number
  runtimeCount: number
  staffs: ZaloServerStaffSnapshot[]
  recentEvents: ZaloServerRuntimeEvent[]
}

export interface ZaloServerClearLogsResult {
  clearedThroughSequence: number
}

export interface ZaloServerSessionRequest {
  username: string
  password: string
}

export interface ZaloServerSessionResponse {
  token: string
  expiresAt: string
  staffId: number
  organizationId: number
}

export interface ZaloServerHandoffRunningState {
  staffId: number
  hasRunningState: boolean
  accountsRunning: number
  campaignsRunning: number
  campaignInputsRunning: number
  campaignInputDataRunning: number
}

export type ZaloServerHandoffOwnership = 'none' | 'server' | 'desktop-or-unknown'

export interface ZaloServerRuntimeHandoffResponse {
  /**
   * True once this request has passed the per-staff lifecycle barrier and the
   * live server no longer owns or can start work for the staff.
   */
  success: boolean
  serverOwned: boolean
  settled: boolean
  serverStopped: boolean
  ownership: ZaloServerHandoffOwnership
  requiresDesktopRecovery: boolean
  runningState?: ZaloServerHandoffRunningState
}

export interface ZaloServerDesktopHandoffReadyResponse {
  success: boolean
  serverReady: boolean
  serverStarted: boolean
  alreadyRunning: boolean
}

export type ZaloServerCommandName =
  | 'zalo.loginQr.start'
  | 'zalo.loginQr.cancel'
  | 'zalo.session.check'
  | 'zalo.logout'
  | 'zalo.labels.sync'
  | 'zalo.runtime.invalidate'
  | 'contacts.loadFriends'
  | 'contacts.loadGroups'
  | 'contacts.loadZaloGroupMembers'
  | 'contacts.cancel'
  | 'campaign.pause'

export interface ZaloServerCommandRequest {
  type: 'command'
  requestId: string
  command: ZaloServerCommandName
  args: unknown[]
}

export interface ZaloServerAuthenticateMessage {
  type: 'authenticate'
  token: string
}

export interface ZaloServerCommandResponse {
  type: 'command-result'
  requestId: string
  ok: boolean
  result?: unknown
  error?: string
}

export interface ZaloServerHelloMessage {
  type: 'hello'
  snapshot: ZaloServerSnapshot
  events: ZaloServerRuntimeEvent[]
  /** Control-web clients always start at the connection boundary. */
  liveOnly?: boolean
  operations?: ZaloServerOperationSnapshot[]
}

export interface ZaloServerEventMessage {
  type: 'runtime-event'
  event: ZaloServerRuntimeEvent
}

export interface ZaloServerSnapshotMessage {
  type: 'snapshot'
  snapshot: ZaloServerSnapshot
}

export type ZaloServerClientMessage = ZaloServerAuthenticateMessage | ZaloServerCommandRequest
export type ZaloServerMessage =
  | ZaloServerHelloMessage
  | ZaloServerEventMessage
  | ZaloServerSnapshotMessage
  | ZaloServerCommandResponse
