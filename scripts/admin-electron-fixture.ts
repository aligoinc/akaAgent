import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { setCurrentUser, setCurrentUserCredentials, getCurrentUser } from '../src/main/data/currentUser'
import { registerAdminHandlers } from '../src/main/ipc/handlers/adminHandlers'
import { IPC_EVENTS, type AuthUser } from '../src/shared/types'

const base = process.env.AKA_ADMIN_FIXTURE_URL!
const directory = process.env.AKA_ADMIN_FIXTURE_DIRECTORY!
app.setPath('userData', join(directory, 'profile'))
const calls: Array<{ resource: string; action: string; input: Record<string, unknown> }> = []
let docs = [1, 2].map(id => ({ id, name: `API fixture ${id}`, url: `${base}/admin-doc-${id}`, description: `Tài liệu ${id}`, sort_order: id, is_active: true, version: `doc-${id}`, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z' }))
let settings = [
  { id: 1, key: 'fixture.limit', value: '100', description: 'Giới hạn fixture', is_secret: false, is_active: true, version: 'setting-1' },
  { id: 2, key: 'fixture.secret', value: 'private-fixture-key', description: 'Secret fixture', is_secret: true, is_active: true, version: 'setting-2' }
]
const staff = { staff_id: 202, username: 'customer-fixture', organization_id: 9, organization_name: 'Khách hàng fixture', raw_value: '', version: 'staff-1', is_active: true }
const general = { staff_id: null, username: 'Toàn bộ khách hàng', organization_id: null, organization_name: 'Toàn hệ thống', raw_value: '{"message":"Thông báo fixture","endsAt":"2999-01-01"}', version: 'global-1', is_active: true }
let delayDoc = false
let delaySettings = false
let failResource = ''
let revision = 0
Object.assign(globalThis, {
  adminSmokeClient: {
    rpc(name: string, args: { p_action: string; p_data: Record<string, unknown>; p_staff_id: number; p_username: string; p_password: string }) {
      return { abortSignal: async () => {
        const resource = name.replace('aka_agent_admin_', '')
        const action = args.p_action
        const input = args.p_data
        calls.push({ resource, action, input })
        if (delayDoc && resource === 'docs' && action === 'get') await new Promise(resolve => setTimeout(resolve, 500))
        if (delaySettings && resource === 'settings' && action === 'reveal') await new Promise(resolve => setTimeout(resolve, 500))
        if (failResource === resource || failResource === `${resource}:${action}`) { failResource = ''; return { data: null, error: { message: 'fixture failure', code: '57014' } } }
        if (args.p_staff_id !== 101 || args.p_username !== 'fixture-admin' || args.p_password !== 'fixture-password' || !getCurrentUser()?.isAdmin) return { data: null, error: { message: 'admin_access_denied' } }
        let data: unknown
        if (resource === 'docs') {
          if (action === 'list') data = docs
          if (action === 'get') data = docs.find(row => row.id === input.id)
          if (action === 'save') {
            const found = docs.find(row => row.id === input.id)
            if (found && found.version !== input.expected_version) return { error: { message: 'admin_conflict' } }
            const doc = { ...input, id: input.id || Math.max(...docs.map(row => row.id)) + 1, version: `doc-r${++revision}`, created_at: '', updated_at: '' } as typeof docs[number]
            docs = [...docs.filter(row => row.id !== doc.id), doc].sort((a,b) => a.sort_order-b.sort_order)
            data = doc
          }
          if (action === 'delete') { docs = docs.filter(row => row.id !== input.id); data = {} }
        }
        if (resource === 'notifications') {
          if (action === 'global') data = general
          if (action === 'list') data = { items: staff.raw_value ? [staff] : [], next_cursor: null }
          if (action === 'search') data = [staff]
          if (action === 'save') {
            const target = input.staff_id === null ? general : staff
            if (target.version !== input.expected_version) return { error: { message: 'admin_conflict' } }
            Object.assign(target, { raw_value: input.raw_value, version: `notice-${++revision}` }); data = {}
          }
        }
        if (resource === 'settings') {
          if (action === 'list') data = settings.map(row => ({ ...row, value: row.is_secret ? null : row.value }))
          if (action === 'reveal') data = settings.find(row => row.id === input.id)
          if (action === 'save') {
            const target = settings.find(row => row.id === input.id)!
            if (input.expected_version !== target.version) return { error: { message: 'admin_conflict' } }
            Object.assign(target, { description: input.description, ...(input.value !== undefined ? { value: input.value } : {}), version: `setting-r${++revision}` }); data = {}
          }
        }
        if (resource === 'cron') {
          if (action === 'jobs') data = { items: [{ id: '1', name: 'Cron fixture', schedule: '*/5 * * * *', is_active: true }, { id: '8', name: 'Job đã tắt', schedule: '0 * * * *', is_active: false }], timezone: 'GMT' }
          const run = { id: input.cursor ? '99' : '100', job_id: '1', job_name: 'Cron fixture', status: input.status || 'succeeded', start_time: '2026-09-20T01:00:00Z', end_time: '2026-09-20T01:00:02Z' }
          if (action === 'runs') data = input.job_id === '8' ? { items: [], next_cursor: null } : { items: [run], next_cursor: input.cursor ? null : '100' }
          if (action === 'detail') data = { ...run, command: 'SELECT fixture();', return_message: 'SELECT 1' }
        }
        if (resource === 'triggers') {
          const trigger = { id: '1', name: 'fixture_trigger', table_name: 'public.fixture', timing: 'AFTER', events: 'UPDATE', condition: null, function_name: 'public.fixture()', is_active: true }
          data = action === 'list' ? [trigger] : { ...trigger, definition: 'CREATE TRIGGER fixture_trigger AFTER UPDATE ON public.fixture FOR EACH ROW EXECUTE FUNCTION public.fixture();', function_body: 'CREATE FUNCTION public.fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;' }
        }
        return { data: structuredClone(data), error: null }
      } }
    }
  }
})

app.whenReady().then(async () => {
  const user = { staffId: 101, organizationId: 1, username: 'fixture-admin', isAdmin: true, isAdminAkabiz: false } as AuthUser
  setCurrentUser(user); setCurrentUserCredentials({ username: 'fixture-admin', password: 'fixture-password' })
  const window = new BrowserWindow({ show: false, width: 1550, height: 1000, webPreferences: { preload: join(directory, 'preload.cjs'), webviewTag: true, contextIsolation: true, sandbox: true, nodeIntegration: false } })
  const handlers = registerAdminHandlers(window)
  handlers.startSession()
  Object.assign(globalThis, { adminSmoke: {
    calls, state: () => ({ docs, staff, general, settings }), delay: (kind: string, value: boolean) => { if (kind === 'doc') delayDoc=value; else delaySettings=value },
    fail: (resource: string) => { failResource=resource },
    revoke: async () => { setCurrentUser({ ...user, isAdmin: false }); await handlers.revokeIfNeeded(); window.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED, getCurrentUser()) },
    reset: () => handlers.reset(),
    restore: () => { setCurrentUser(user); handlers.startSession(); window.webContents.send(IPC_EVENTS.AUTH_USER_UPDATED, getCurrentUser()) }
  } })
  ipcMain.handle('admin-fixture:ready', () => true)
  await window.loadURL(`${base}/admin-fixture`)
})
app.on('window-all-closed', () => app.quit())
