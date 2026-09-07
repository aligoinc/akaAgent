import assert from 'node:assert/strict'
import { normalizePublicLinkUrl, parseAppNotification } from '../src/shared/appNotification'
import { getLoginScreenContent } from '../src/main/data/repositories/loginScreenRepository'
import { getActiveAppNotification } from '../src/main/data/repositories/appNotificationRepository'
import { setCurrentUser } from '../src/main/data/currentUser'
import { registerAppNotificationHandlers } from '../src/main/ipc/handlers/appNotificationHandlers'
import { IPC_EVENTS, type AuthUser } from '../src/shared/types'

type Row = Record<string, unknown>
const fixtures: Record<string, Row[]> = { auto_system_settings: [], org_staff: [] }
const calls: { table: string; columns: string; filters: [string, unknown][] }[] = []
let databaseError = false
const handlers = new Map<string, (...args: unknown[]) => unknown>()
Object.assign(globalThis, { loginSmokeHandlers: handlers })

class Query {
  columns = ''
  filters: [string, unknown][] = []
  constructor(public table: string) { calls.push(this) }
  select(columns: string) { this.columns = columns; return this }
  in(key: string, values: unknown[]) { this.filters.push([key, values]); return this }
  eq(key: string, value: unknown) { this.filters.push([key, value]); return this }
  abortSignal(signal: AbortSignal) { assert.equal(signal.aborted, false); return this }
  result(single = false) {
    const rows = fixtures[this.table].filter(row => this.filters.every(([key, value]) =>
      Array.isArray(value) ? value.includes(row[key]) : row[key] === value
    )).map(row => this.columns === '*' ? row : Object.fromEntries(this.columns.split(',').map(key => [key.trim(), row[key.trim()]])))
    return { data: single ? rows[0] ?? null : rows, error: databaseError ? { code: 'TEST', message: 'private internal detail' } : null }
  }
  maybeSingle() { return Promise.resolve(this.result(true)) }
  then(resolve: (value: ReturnType<Query['result']>) => unknown, reject: (error: unknown) => unknown) {
    return Promise.resolve(this.result()).then(resolve, reject)
  }
}
Object.assign(globalThis, { loginSmokeClient: { from: (table: string) => new Query(table) } })

function setting(key: string, value: string | null, extra: Row = {}): Row {
  return { id: 1, key, value, is_active: true, is_secret: false, updated_at: '2026-09-07T00:00:00Z', ...extra }
}

async function run() {
  const now = Date.parse('2026-09-07T01:00:00Z')
  const parse = (value: string | null) => parseAppNotification(1, undefined, value, now)
  assert.equal(parse('  Xin chào\nkhách hàng  ')?.message, 'Xin chào\nkhách hàng')
  assert.equal(parse('"Văn bản JSON"')?.message, 'Văn bản JSON')
  for (const value of [null, '', '  ', 'null', 'false', '12', '[]', '{}', '{"title":"Thiếu nội dung"}', '{"message":"  "}']) assert.equal(parse(value), null)
  assert.equal(parse('{broken JSON')?.message, '{broken JSON')
  assert.equal(parse('{"message":"x","startsAt":"2026-09-07T01:00:01Z"}'), null)
  assert.equal(parse('{"message":"x","endsAt":"2026-09-07T01:00:00Z"}'), null)
  assert.equal(parse('{"message":"x","startsAt":"2026-09-07T01:00:00Z"}')?.message, 'x')
  const json = parse(JSON.stringify({ title: ' Tiêu đề ', message: ' Nội dung ', level: 'warning', link_label: 'Chi tiết', link_url: 'https://akabiz.net', starts_at: '2026-09-07T08:00:00+07:00' }))!
  assert.equal(json.title, 'Tiêu đề')
  assert.equal(json.level, 'warning')
  assert.equal(json.linkUrl, 'https://akabiz.net/')
  assert.equal(json.linkLabel, 'Chi tiết')
  assert.equal(json.startsAt, '2026-09-07T01:00:00.000Z')
  assert.equal(parse('{"message":"x","level":"other","endsAt":"invalid"}')?.level, 'info')
  for (const link of ['', 'javascript:alert(1)', 'file:///tmp/a', 'data:text/html,test', 'mailto:test@example.com', '/relative', 'not a link']) assert.equal(normalizePublicLinkUrl(link), null)
  assert.equal(normalizePublicLinkUrl(' http://akabiz.net '), 'http://akabiz.net/')
  console.log('PASS: text/JSON parser, time boundaries and safe links')

  setCurrentUser(null)
  fixtures.auto_system_settings = [
    setting('app.notification', 'Thông báo hệ thống'),
    setting('akabiz.links.website', 'https://akabiz.net/'),
    setting('akabiz.links.user_guide', 'https://www.youtube.com/@akabizai'),
    setting('akabiz.links.upgrade_payment', null),
    setting('akabiz.links.contact_us', 'javascript:alert(1)'),
    setting('private.key', 'MUST NOT LEAK', { is_secret: true }),
    setting('other.public.config', 'MUST NOT LEAK')
  ]
  const result = await (getLoginScreenContent as (...args: unknown[]) => ReturnType<typeof getLoginScreenContent>)(['private.key'])
  assert.equal(result.notification?.message, 'Thông báo hệ thống')
  assert.deepEqual(result.links, { website: 'https://akabiz.net/', userGuide: 'https://www.youtube.com/@akabizai', upgradePayment: null, contactUs: null })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].table, 'auto_system_settings')
  assert.equal(calls[0].columns, 'id,key,value,updated_at')
  assert.deepEqual(calls[0].filters, [
    ['key', ['app.notification', 'akabiz.links.website', 'akabiz.links.user_guide', 'akabiz.links.upgrade_payment', 'akabiz.links.contact_us']],
    ['is_active', true], ['is_secret', false]
  ])
  assert.equal(JSON.stringify(result).includes('MUST NOT LEAK'), false)
  fixtures.auto_system_settings = [
    setting('app.notification', 'Secret notice', { is_secret: true }),
    setting('akabiz.links.website', 'https://akabiz.net', { is_active: false }),
    setting('akabiz.links.user_guide', 'https://akabiz.net', { is_secret: true })
  ]
  assert.deepEqual(await getLoginScreenContent(), { notification: null, links: { website: null, userGuide: null, upgradePayment: null, contactUs: null } })
  databaseError = true
  await assert.rejects(getLoginScreenContent, error => error instanceof Error && error.message === 'Không thể tải thông tin từ akaBiz.')
  databaseError = false
  console.log('PASS: pre-login allowlist, inactive/secret/missing settings and safe errors')

  await assert.rejects(getActiveAppNotification, /Chưa đăng nhập/)
  fixtures.auto_system_settings = [setting('app.notification', 'System')]
  fixtures.org_staff = [
    { id: 7, organization_id: 10, is_active: true, app_notification: 'Staff' },
    { id: 8, organization_id: 20, is_active: true, app_notification: 'Other tenant' }
  ]
  setCurrentUser({ staffId: 7, organizationId: 10 } as AuthUser)
  const beforeStaff = calls.length
  assert.equal((await getActiveAppNotification())?.message, 'Staff')
  assert.equal(calls.length, beforeStaff + 1)
  assert.deepEqual(calls.at(-1)?.filters, [['id', 7], ['organization_id', 10], ['is_active', true]])
  for (const value of [null, ' ', '{"message":"Expired","endsAt":"2000-01-01"}', '{"message":"Future","startsAt":"2999-01-01"}']) {
    fixtures.org_staff[0].app_notification = value
    assert.equal((await getActiveAppNotification())?.message, 'System')
  }
  fixtures.auto_system_settings = []
  assert.equal(await getActiveAppNotification(), null)
  setCurrentUser(null)
  console.log('PASS: existing authenticated staff priority, tenant scope and fallback')

  let forwarded: unknown[] | undefined
  registerAppNotificationHandlers({
    getLoginScreenContent: (...args: unknown[]) => { forwarded = args; return result },
    getActiveAppNotification
  } as Parameters<typeof registerAppNotificationHandlers>[0])
  assert.deepEqual(await handlers.get(IPC_EVENTS.LOGIN_SCREEN_GET_CONTENT)!({}, ['private.key']), result)
  assert.deepEqual(forwarded, [])
  await assert.rejects(async () => handlers.get(IPC_EVENTS.APP_NOTIFICATION_GET_ACTIVE)!({}), /Chưa đăng nhập/)
  console.log('PASS: public IPC accepts no caller keys; authenticated IPC stays protected')
}

run().catch(error => { console.error(error); process.exitCode = 1 })
