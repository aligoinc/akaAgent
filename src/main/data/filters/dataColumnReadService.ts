import type { DataColumnReadRequest, DataColumnReadResult, DataGroupMemberListQuery, PageInboxContactListQuery } from '../../../shared/types'
import { normalizeColumnFilters } from '../../../shared/dataColumnFilters'
import { requireCurrentUser, requireCurrentUserCredentials, getCurrentUserCredentials, onCurrentUserSessionChanged } from '../currentUser'
import { getSupabaseClient } from '../supabaseClient'
import { mapAccountContactFromDB } from '../mappers'
import { mapDataGroupMember } from '../repositories/dataGroupRepository'
import { listFilteredPageInboxContacts } from '../repositories/localAccountContactRepository'
import { FILTER_READ_POLICY, FilterReadCoordinator, FilterTransportTimeoutError } from './filterReadCoordinator'

const reads = new FilterReadCoordinator()
const unavailable = new Map<string, number>()
onCurrentUserSessionChanged(() => { reads.cancelAll(); unavailable.clear() })
export function cancelColumnRead(owner: string, formId?: string, requestId?: string): void {
  if (formId) reads.cancel(`${owner}:${formId}`, requestId)
  else reads.cancelOwner(owner)
}
const blank = (available = true): DataColumnReadResult => ({ available, contacts: [], members: [], ids: [], total: 0 })
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,100}$/.test(value)

export async function executeColumnRead(
  owner: string, request: DataColumnReadRequest, authorize: (signal: AbortSignal) => Promise<void>, mode: 'page' | 'export' | 'ids' = 'page'
): Promise<DataColumnReadResult> {
  if (!request || !validToken(request.formId) || !validToken(request.requestId)) throw new Error('Mã lượt lọc không hợp lệ.')
  const source = request.source
  if (!['contacts','upload','group_members','page_inbox','remarketing','data_group'].includes(source) || !request.query || typeof request.query !== 'object') throw new Error('Nguồn dữ liệu không hợp lệ.')
  const user = requireCurrentUser(), session = requireCurrentUserCredentials()
  const filters = normalizeColumnFilters(source, request.query.columnFilters)
  if (source !== 'data_group' && (!Number.isSafeInteger(request.accountId) || Number(request.accountId) <= 0)) throw new Error('Tài khoản không hợp lệ.')
  if (source === 'data_group' && (!Number.isSafeInteger((request.query as DataGroupMemberListQuery).groupId) || (request.query as DataGroupMemberListQuery).groupId <= 0)) throw new Error('Nhóm data không hợp lệ.')
  const query: Record<string, unknown> = Object.fromEntries(Object.entries(request.query).filter(([,value]) => value != null))
  for (const key of ['dateFrom', 'dateTo', 'campaignActionId']) {
    if (typeof query[key] === 'string' && !(query[key] as string).trim()) delete query[key]
  }
  query.columnFilters = filters
  if (request.accountId) query.accountId = request.accountId
  const limit = query.limit == null ? (mode === 'page' ? 100 : 100000) : Number(query.limit)
  const offset = Number(query.offset ?? 0)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > (mode === 'page' ? 500 : 100000) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) throw new Error('Giới hạn đọc dữ liệu không hợp lệ. Hãy thu hẹp điều kiện.')
  if (Buffer.byteLength(JSON.stringify(query)) > 2 * 1024 * 1024) throw new Error('Có quá nhiều điều kiện hoặc dòng được chọn. Hãy thu hẹp lựa chọn.')
  const rpc = source === 'data_group' ? 'aka_agent_read_filtered_group_v1' : source === 'remarketing' ? 'aka_agent_read_filtered_remarketing_v1' : 'aka_agent_read_filtered_contacts_v1'
  const checkSession = (signal: AbortSignal): void => {
    if (signal.aborted || getCurrentUserCredentials() !== session) throw new Error('Lượt lọc hoặc phiên đăng nhập đã thay đổi.')
  }
  return reads.read(`${owner}:${request.formId}`, request.requestId, async signal => {
    // The coordinator's deadline includes queue time and authorization. Forward
    // cancellation to its account read, and await the transport before releasing
    // the slot. An aborted HTTP read still needs the unconfirmed-server budget.
    checkSession(signal)
    try { await authorize(signal) }
    catch (error) {
      if (signal.aborted) throw new FilterTransportTimeoutError('Đã dừng kiểm tra quyền truy cập dữ liệu.')
      throw error
    }
    checkSession(signal)
    if (source !== 'page_inbox' && (unavailable.get(rpc) ?? 0) > Date.now()) {
      if (filters.filters.length) throw new Error('Backend bộ lọc chưa được cập nhật. Vui lòng liên hệ quản trị viên.')
      return blank(false)
    }
    const result = blank()
    let after: unknown, fetched = 0, more = true, lastCursor = '', bytesRead = 0
    const seenIds = new Set<number>()
    const acceptRows = (rows: Array<{id?:unknown}>): void => {
      bytesRead += Buffer.byteLength(JSON.stringify(rows))
      if (bytesRead > 32 * 1024 * 1024) throw new Error('Kết quả quá lớn để tải an toàn. Hãy thu hẹp điều kiện rồi xuất lại.')
      for (const row of rows) {
        const id = Number(row.id)
        if (!Number.isSafeInteger(id) || id <= 0 || seenIds.has(id)) throw new Error('Dữ liệu hoặc thứ tự đã thay đổi trong lúc đọc. Vui lòng tải lại.')
        seenIds.add(id)
      }
    }
    while (more && fetched < limit) {
      checkSession(signal)
      const pageLimit = Math.min(mode === 'page' ? limit : 500, limit - fetched)
      const pageQuery = { ...query, idsOnly: mode === 'ids', limit: pageLimit, offset: after ? 0 : offset + fetched, ...(after ? { after } : {}), ...(fetched ? { countMode: 'none' } : {}) }
      if (source === 'page_inbox') {
        const page = await listFilteredPageInboxContacts(request.accountId!, pageQuery as PageInboxContactListQuery, signal)
        checkSession(signal)
        acceptRows(page.contacts)
        if (!fetched) result.total = page.total
        if (mode === 'ids') result.ids.push(...page.contacts.map(row => row.id))
        else result.contacts.push(...page.contacts)
        fetched += page.contacts.length; more = page.contacts.length === pageLimit && offset + fetched < page.total
      } else {
        const deadline = new AbortController()
        // A form cancellation rejects/fences the UI immediately, but keep this
        // slot until the server response confirms completion. Aborting HTTP
        // would leave the database running with an unknown completion time.
        const timer = setTimeout(() => deadline.abort(), FILTER_READ_POLICY.deadlineMs)
        let response: Awaited<ReturnType<typeof fetchPage>>
        try { response = await fetchPage(rpc, { ...pageQuery }, source, user.staffId, user.organizationId, session, deadline.signal) }
        catch {
          throw new FilterTransportTimeoutError(deadline.signal.aborted
            ? 'Truy vấn lọc quá thời gian cho phép. Hãy thu hẹp điều kiện rồi thử lại.'
            : 'Mất kết nối khi đọc dữ liệu. Vui lòng thử lại sau.')
        }
        finally { clearTimeout(timer) }
        // Supabase also represents fetch failures as an error without a DB code.
        // Classify it before the logical-cancellation check so its slot is held.
        if (response.error && (deadline.signal.aborted || !response.error.code)) {
          throw new FilterTransportTimeoutError(deadline.signal.aborted
            ? 'Truy vấn lọc quá thời gian cho phép. Hãy thu hẹp điều kiện rồi thử lại.'
            : 'Mất kết nối khi đọc dữ liệu. Vui lòng thử lại sau.')
        }
        checkSession(signal)
        if (response.error) {
          if (response.error.code === 'PGRST202' || response.error.code === '42883') {
            unavailable.set(rpc, Date.now() + 60000)
            if (!filters.filters.length) return blank(false)
            throw new Error('Backend bộ lọc chưa được cập nhật. Vui lòng liên hệ quản trị viên.')
          }
          if (response.error.code === '57014') throw new Error('Truy vấn lọc quá thời gian cho phép. Hãy thu hẹp điều kiện rồi thử lại.')
          if (response.error.code === '42501') throw new Error('Bạn không còn quyền xem dữ liệu này.')
          throw new Error('Không thể đọc dữ liệu đã lọc. Vui lòng thử lại.')
        }
        const page = response.data
        if (!page || page.version !== 1 || !Array.isArray(page.rows) || page.rows.length > pageLimit
          || typeof page.hasMore !== 'boolean' || (!fetched && (!Number.isSafeInteger(page.total) || page.total < 0))) throw new Error('Phản hồi bộ lọc không hợp lệ.')
        acceptRows(page.rows)
        if (!fetched) result.total = page.total
        if (mode === 'ids') result.ids.push(...page.rows.map((row: Record<string,unknown>) => Number(row.id)))
        else if (source === 'data_group') result.members.push(...page.rows.map(mapDataGroupMember))
        else result.contacts.push(...page.rows.map(mapAccountContactFromDB))
        fetched += page.rows.length; more = page.hasMore
        const nextCursor = JSON.stringify(page.after)
        if (more && (!page.rows.length || !page.after || nextCursor === lastCursor)) throw new Error('Phân trang bộ lọc không tiến lên. Vui lòng tải lại.')
        after = page.after; lastCursor = nextCursor
      }
      if (mode === 'page') break
    }
    if (mode !== 'page' && limit === 100000 && more && result.total > offset + fetched) throw new Error('Kết quả vượt 100.000 dòng. Hãy thu hẹp điều kiện trước khi xuất.')
    if (mode !== 'page' && fetched !== Math.min(limit, Math.max(0, result.total - offset))) throw new Error('Dữ liệu đã thay đổi trong lúc đọc. Vui lòng tải lại và xuất lại.')
    checkSession(signal)
    return result
  }, FILTER_READ_POLICY.deadlineMs)
}

function fetchPage(rpc: string, query: Record<string,unknown>, source: string, staffId: number, organizationId: number, credentials: {username:string;password:string}, signal: AbortSignal) {
  return getSupabaseClient().rpc(rpc, {
    p_staff_id: staffId, p_organization_id: organizationId,
    p_auth_username: credentials.username, p_auth_password: credentials.password,
    ...(rpc === 'aka_agent_read_filtered_contacts_v1' ? { p_source: source } : {}), p_query: query
  }).abortSignal(signal).then(result => result)
}
