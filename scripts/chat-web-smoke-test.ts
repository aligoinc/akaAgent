// Runs Electron against local HTTPS fixtures only; never loads the real app or database.
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import type { ServerResponse } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, powerMonitor, session, type WebContents } from 'electron'
import { getCurrentUser, setCurrentUser, setCurrentUserCredentials } from '../src/main/data/currentUser'
import type { AuthUser, ChatWebState, CrmWebDescriptor } from '../src/shared/types'

const directory = process.env.AKA_AGENT_CHAT_SMOKE_DIRECTORY!
app.setPath('userData', join(directory, 'profile'))
let mode: 'ok' | 'denied' | 'mismatch' | 'pending' | 'unavailable' = 'ok'
let loginRequests = 0
let pageRequests = 0
let pending: ServerResponse | null = null
let pendingPage: ServerResponse | null = null
let expectedStaffId = '101'
const realNow = Date.now
const cookieHeaders: string[] = []
const slowExpiredResponses: ServerResponse[] = []

const loginFixtureHtml = `<!doctype html><html><body><h1>LoginPanel fixture</h1>
  <form id="crm-login"><input name="username" aria-label="Tên đăng nhập"><input name="password" type="password" aria-label="Mật khẩu"><button>Đăng nhập</button></form>
  <script>document.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.target));
    await fetch('/api/auth/login', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
    location.reload();
  };</script>
</body></html>`

const chatFixtureHtml = `<!doctype html><html><body style="background:#fff;color:#222">
  <h1>Chat fixture</h1><textarea id="draft"></textarea>
  <script>
    // Match akaAgentChatWeb/staff-session-client.js: navigate after headers,
    // without waiting for the response body, and only once per document.
    let navigatingToLogin = false;
    window.fixtureSessionFetch = async path => {
      const response = await fetch(path);
      if (response.status === 401 && !navigatingToLogin) {
        navigatingToLogin = true;
        location.replace('/?reason=session-expired');
      }
      return response.status;
    };
  </script>
</body></html>`

function loginResponse(response: ServerResponse): void {
  const expiresAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  response.writeHead(200, {
    'content-type': 'application/json',
    'set-cookie': `aka_chat_staff=fixture-${loginRequests}; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt * 1000).toUTCString()}`
  })
  response.end(JSON.stringify({ staffId: mode === 'mismatch' ? '999' : expectedStaffId, organizationId: '202', expiresAt }))
}

const server = createServer({ key: readFileSync(join(directory, 'key.pem')), cert: readFileSync(join(directory, 'cert.pem')) }, (request, response) => {
  const requestUrl = new URL(request.url!, 'https://localhost')
  const path = requestUrl.pathname.replace(/\/+$/, '')
  if (path === '/api/auth/login') {
    loginRequests++
    request.resume()
    if (mode === 'denied') { response.writeHead(401); response.end('{}'); return }
    if (mode === 'unavailable') { response.writeHead(503); response.end('{}'); return }
    if (mode === 'pending') { pending = response; return }
    loginResponse(response)
  } else if (path === '/api/auth/logout') {
    response.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'aka_chat_staff=; Path=/; Secure; HttpOnly; Max-Age=0' })
    if (requestUrl.searchParams.has('slow')) response.flushHeaders()
    else response.end('{}')
  } else if (path === '/api/auth/session') {
    response.writeHead(request.headers.cookie?.includes('aka_chat_staff=') ? 200 : 401, { 'content-type': 'application/json' })
    response.end('{}')
  } else if (path === '/download') {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="chat-fixture.txt"' })
    response.end('chat fixture download')
  } else if (path === '/api/chat/expired-slow') {
    response.writeHead(401, { 'content-type': 'application/json', 'set-cookie': 'aka_chat_staff=; Path=/; Secure; HttpOnly; Max-Age=0' })
    response.flushHeaders()
    // Deliberately leave the body pending until recovery reloads the document.
    slowExpiredResponses.push(response)
  } else {
    pageRequests++
    cookieHeaders.push(request.headers.cookie || '')
    if (requestUrl.searchParams.has('holdPage')) { pendingPage = response; return }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(request.headers.cookie?.includes('aka_chat_staff=')
      ? chatFixtureHtml
      : loginFixtureHtml)
  }
})

function user(sessionId: string, enabled = true): AuthUser {
  return {
    staffId: Number(expectedStaffId), organizationId: 202, username: 'fixture', name: 'Fixture', organizationName: 'Fixture',
    isChatSync: enabled, chatWebEnabledAtLogin: enabled, chatWebSessionId: enabled ? sessionId : undefined
  } as AuthUser
}

async function until(predicate: () => boolean | Promise<boolean>, description: string): Promise<void> {
  const start = performance.now()
  while (!await predicate()) {
    if (performance.now() - start > 15_000) throw new Error(`Timeout: ${description}`)
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

async function run(): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address !== 'string')
  const url = `https://localhost:${address.port}/`
  process.env.AKA_AGENT_CHAT_SMOKE_URL = url
  // Dynamic import lets the isolated test URL be set before the service module initializes.
  const { registerChatWebHandlers } = await import('../src/main/ipc/handlers/chatWebHandlers')
  const { registerCrmWebHandlers } = await import('../src/main/ipc/handlers/crmWebHandlers')
  await app.whenReady()
  app.on('session-created', browserSession => {
    browserSession.setCertificateVerifyProc((request, callback) => callback(request.hostname === 'localhost' ? 0 : -3))
  })
  const host = new BrowserWindow({ width: 1400, height: 900, show: false, webPreferences: {
    preload: join(directory, 'preload.cjs'), webviewTag: true, nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false
  } })
  const controller = registerChatWebHandlers(host)
  const crmController = registerCrmWebHandlers(host)
  const htmlPath = join(directory, 'host.html')
  writeFileSync(htmlPath, '<!doctype html><html><head><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script type="module" src="renderer.js"></script></body></html>')
  await host.loadFile(htmlPath)
  await until(async () => await host.webContents.executeJavaScript('typeof window.setFixtureUser === "function"'), 'React fixture mounts')
  const invoke = (method: 'prepare' | 'reload'): Promise<ChatWebState> => host.webContents.executeJavaScript(`window.smoke.${method}()`)
  const readState = (): Promise<ChatWebState> => host.webContents.executeJavaScript('window.smoke.state()')
  const prepareCrm = (): Promise<CrmWebDescriptor> => host.webContents.executeJavaScript('window.smoke.prepareCrm()')
  const recoverCrashedGuest = async (
    current: WebContents,
    label: 'akaChat' | 'CRM',
    retry: () => Promise<unknown>
  ): Promise<WebContents> => {
    const previousId = current.id
    const previousSession = current.session
    let replacement: WebContents | null = null
    let replacements = 0
    let loaded = false
    const onAttach = (_event: Electron.Event, contents: WebContents): void => {
      if (contents.session !== previousSession) return
      replacements++
      replacement = contents
      contents.once('did-finish-load', () => { loaded = true })
    }
    host.webContents.on('did-attach-webview', onAttach)
    try {
      // Kill only the isolated fixture guest, never the main process or a real app.
      const pid = current.getOSProcessId()
      assert(pid > 0 && pid !== process.pid)
      process.kill(pid, 'SIGKILL')
      const section = `section[aria-label="${label}"]`
      await until(async () => await host.webContents.executeJavaScript(
        `document.querySelector('${section} [role="alert"]')?.textContent.includes('đã dừng')`
      ), `${label} crash is visible`)
      await until(() => current.isDestroyed(), `${label} retires its crashed guest`)
      assert.equal(replacement, null, 'wait for retry/authentication before creating another guest')
      await retry()
      // Never execute JavaScript in a dead or not-yet-loaded guest.
      await until(() => !!replacement && loaded && !replacement.isLoading(), `${label} replacement document loads`)
      const recovered = replacement!
      assert.notEqual(recovered.id, previousId)
      assert.equal(recovered.session, previousSession)
      assert.equal(recovered.getLastWebPreferences()!.sandbox, true)
      assert.equal(await recovered.executeJavaScript('typeof require + ":" + typeof window.electronAPI'), 'undefined:undefined')
      assert((await recovered.executeJavaScript('document.body.textContent')).includes('Chat fixture'))
      await until(async () => await host.webContents.executeJavaScript(
        `!document.querySelector('${section} [role="alert"], ${section} [role="status"]')`
      ), `${label} recovery clears the overlay`)
      assert.equal(replacements, 1, 'each recovery attaches exactly one new guest')
      return recovered
    } finally {
      host.webContents.removeListener('did-attach-webview', onAttach)
    }
  }
  const baselineListeners = powerMonitor.listenerCount('resume')
  let createdSessions = 0
  app.on('session-created', () => { createdSessions++ })

  setCurrentUser(user('disabled', false))
  crmController.startSession()
  await host.webContents.executeJavaScript(`window.setFixtureUser(${JSON.stringify(getCurrentUser())})`)
  await assert.rejects(invoke('prepare'))
  await assert.rejects(prepareCrm())
  assert.equal(await host.webContents.executeJavaScript('document.querySelector(\'button[title="CRM"]\') === null'), true)
  assert.equal(await host.webContents.executeJavaScript('document.querySelector(\'button[title="akaChat"]\') === null && document.querySelector("webview") === null'), true)
  assert.equal(createdSessions, 0)
  assert.equal(loginRequests, 0)
  assert.equal(powerMonitor.listenerCount('resume'), baselineListeners)
  console.log('PASS: ineligible accounts allocate no Chat session, timer listener or network request')

  setCurrentUser(user('first'))
  setCurrentUserCredentials({ username: 'fixture', password: 'fixture-only' })
  await host.webContents.executeJavaScript(`window.setFixtureUser(${JSON.stringify(getCurrentUser())})`)
  await until(async () => await host.webContents.executeJavaScript('!!document.querySelector(\'button[title="akaChat"]\')'), 'eligible menu appears')
  assert.equal(await host.webContents.executeJavaScript('document.querySelector("webview") === null'), true)
  assert.equal(loginRequests, 0)
  const states = await Promise.all([invoke('prepare'), invoke('prepare'), invoke('prepare')])
  assert(states.every(state => state.status === 'ready'), JSON.stringify(states))
  assert.equal(loginRequests, 1)
  const browserSession = session.fromPartition(states[0].partition)
  assert((await browserSession.cookies.get({ url })).some(cookie => cookie.name === 'aka_chat_staff' && cookie.httpOnly && cookie.secure))

  let guest: WebContents | null = null
  host.webContents.once('will-attach-webview', (_event, preferences, params) => {
    assert.equal(preferences.partition, states[0].partition)
    assert.equal(params.src, url)
    assert.equal(preferences.backgroundThrottling, false)
  })
  host.webContents.once('did-attach-webview', (_event, contents) => { guest = contents })
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="akaChat"]\').click()')
  await until(() => !!guest && !guest.isLoading(), 'guest attaches')
  let chat = guest!
  await until(async () => (await chat.executeJavaScript('document.body?.textContent || ""')).includes('Chat fixture'), 'Chat renders')
  assert(cookieHeaders.some(header => header.includes('aka_chat_staff=fixture-1')))
  const preferences = chat.getLastWebPreferences()!
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(preferences.contextIsolation, true)
  assert.equal(chat.getBackgroundThrottling(), false)
  assert.equal(await chat.executeJavaScript('typeof require + ":" + typeof window.electronAPI'), 'undefined:undefined')
  await until(async () => await host.webContents.executeJavaScript('!document.querySelector(\'section[aria-label="akaChat"] [role="status"]\')'), 'React loading overlay clears')
  const wide = await host.webContents.executeJavaScript('document.querySelector("webview").getBoundingClientRect().width')
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="Mở rộng menu"]\').click()')
  await until(async () => await host.webContents.executeJavaScript('document.querySelector("webview").getBoundingClientRect().width') < wide, 'sidebar changes guest bounds')
  host.setSize(1000, 700)
  await until(async () => await host.webContents.executeJavaScript('document.querySelector("webview").getBoundingClientRect().width') < 1000, 'resize')
  if (process.env.AKA_AGENT_CHAT_SMOKE_SCREENSHOT) {
    writeFileSync(process.env.AKA_AGENT_CHAT_SMOKE_SCREENSHOT, (await host.webContents.capturePage()).toPNG())
  }
  await host.webContents.executeJavaScript('document.querySelector("#fixture-overlay").style.display = "block"')
  assert.equal(await host.webContents.executeJavaScript('document.elementFromPoint(500, 300).id'), 'fixture-overlay')
  await host.webContents.executeJavaScript('document.querySelector("#fixture-overlay").style.display = "none"')
  console.log('PASS: one login for concurrent opens; secure cookie reaches the sandboxed webview')

  // ChatWeb changes /c/:id with history.pushState when selecting a conversation.
  // Observe the actual host DOM so even a briefly mounted opaque overlay fails.
  await host.webContents.executeJavaScript(`
    window.chatOverlayCount = 0;
    window.chatNavigationObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof Element && (node.matches('[role="status"], [role="alert"]') || node.querySelector('[role="status"], [role="alert"]'))) window.chatOverlayCount++;
      }
    });
    window.chatNavigationObserver.observe(document.querySelector('section[aria-label="akaChat"]'), { childList: true, subtree: true });
    void 0;
  `)
  const settleHostPaint = (): Promise<void> => host.webContents.executeJavaScript('new Promise(resolve => { requestAnimationFrame(() => { requestAnimationFrame(() => resolve()); }); })')
  const pagesBeforeConversationSwitch = pageRequests
  const loginsBeforeConversationSwitch = loginRequests
  await chat.executeJavaScript('window.fixtureDocumentId = "original-document"; document.querySelector("#draft").value = "conversation draft"')
  for (const conversation of ['a', 'b', 'c']) {
    const path = `/c/${conversation.repeat(22)}`
    await chat.executeJavaScript(`history.pushState(history.state, "", ${JSON.stringify(path)}); void 0`)
    await until(() => new URL(chat.getURL()).pathname === path, 'conversation URL changes')
    await settleHostPaint()
  }
  await chat.executeJavaScript('history.replaceState(history.state, "", location.pathname + "?view=chat"); location.hash = "message"; void 0')
  await until(() => new URL(chat.getURL()).hash === '#message', 'in-page anchor changes')
  await settleHostPaint()
  await chat.executeJavaScript('history.back(); void 0')
  await until(() => new URL(chat.getURL()).hash === '', 'in-page back navigation')
  await settleHostPaint()
  assert.equal(await host.webContents.executeJavaScript('window.chatOverlayCount'), 0, 'conversation navigation must never flash an opaque host loading overlay')
  assert.equal(pageRequests, pagesBeforeConversationSwitch)
  assert.equal(loginRequests, loginsBeforeConversationSwitch)
  assert.equal(await chat.executeJavaScript('window.fixtureDocumentId'), 'original-document')
  assert.equal(await chat.executeJavaScript('document.querySelector("#draft").value'), 'conversation draft')
  await host.webContents.executeJavaScript('window.chatNavigationObserver.disconnect(); void 0')

  // A real document navigation must still show loading until the page arrives.
  await chat.executeJavaScript('location.assign("/?holdPage=1"); void 0')
  await until(async () => pendingPage !== null && await host.webContents.executeJavaScript('!!document.querySelector(\'section[aria-label="akaChat"] [role="status"]\')'), 'full page navigation displays loading')
  pendingPage!.writeHead(200, { 'content-type': 'text/html' })
  pendingPage!.end(chatFixtureHtml)
  pendingPage = null
  await until(async () => !chat.isLoading() && await host.webContents.executeJavaScript('!document.querySelector(\'section[aria-label="akaChat"] [role="status"]\')'), 'full page loading clears')
  await chat.executeJavaScript('history.replaceState(history.state, "", "/"); void 0')
  await settleHostPaint()
  console.log('PASS: conversation/history navigation keeps Chat visible and drafts intact; real document loads still show loading')

  const attemptsBeforeGuestLogin = loginRequests
  const cookieBeforeGuestLogin = (await browserSession.cookies.get({ url, name: 'aka_chat_staff' }))[0].value
  mode = 'mismatch'
  for (const path of ['/api/auth/login', '/api/auth/login?review=1', '/api/auth/login/?returnTo=%2Fsettings']) {
    assert.equal(await chat.executeJavaScript(`fetch(${JSON.stringify(path)}, {method:"POST"}).then(() => "allowed", () => "blocked")`), 'blocked', path)
  }
  mode = 'ok'
  assert.equal(loginRequests, attemptsBeforeGuestLogin)
  assert.equal((await browserSession.cookies.get({ url, name: 'aka_chat_staff' }))[0].value, cookieBeforeGuestLogin)
  assert.equal(await chat.executeJavaScript('fetch("/api/auth/session?review=1").then(r => r.status)'), 200)
  console.log('PASS: guest login, including query strings/trailing slashes, cannot switch staff or change the cookie')

  await chat.executeJavaScript('document.querySelector("#draft").value = "unsent draft"')
  const pagesBeforeRenew = pageRequests
  const revisionBeforeRenew = (await readState()).revision
  Date.now = () => realNow() + 6.5 * 24 * 60 * 60 * 1000
  powerMonitor.emit('resume')
  await until(async () => {
    const state = await readState()
    return loginRequests === 2 && state.status === 'ready' && state.revision > revisionBeforeRenew
  }, 'proactive renewal')
  assert.equal(pageRequests, pagesBeforeRenew)
  assert.equal(await chat.executeJavaScript('document.querySelector("#draft").value'), 'unsent draft')
  Date.now = realNow
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="Chiến dịch"]\').click()')
  await until(async () => await host.webContents.executeJavaScript('document.querySelector("webview").getBoundingClientRect().width === 0'), 'hide Chat')
  assert.equal((await invoke('prepare')).status, 'ready')
  assert.equal(loginRequests, 2)
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="akaChat"]\').click()')
  console.log('PASS: resume renews before expiry without reloading or losing drafts; hidden Chat stays mounted')

  const refreshedUser = { ...user('ignored'), isChatSync: false, chatWebEnabledAtLogin: undefined, chatWebSessionId: undefined }
  setCurrentUser(refreshedUser)
  assert.equal(refreshedUser.chatWebEnabledAtLogin, true)
  assert.equal(getCurrentUser()?.chatWebSessionId, 'first')
  await host.webContents.executeJavaScript(`window.setFixtureUser(${JSON.stringify(getCurrentUser())})`)
  assert.equal(await host.webContents.executeJavaScript('!!document.querySelector(\'button[title="akaChat"]\')'), true)
  assert.equal((await invoke('prepare')).status, 'ready')
  console.log('PASS: live Chat Sync updates preserve the login snapshot')

  await chat.executeJavaScript('fetch("/api/auth/logout?slow=1", { method: "POST" }).then(r => { location.reload(); return r.status })')
  await until(async () => (await readState()).status === 'signed-out', 'explicit Chat logout')
  await until(async () => !chat.isLoading() && (await chat.executeJavaScript('document.body.textContent')).includes('LoginPanel fixture'), 'web logout navigation')
  const loginsBeforeReopen = loginRequests
  assert.equal((await invoke('prepare')).status, 'signed-out')
  assert.equal(loginRequests, loginsBeforeReopen)
  assert.equal((await invoke('reload')).status, 'ready')
  await until(() => !chat.isLoading(), 'reconnect')
  console.log('PASS: logout is detected before its slow body finishes and waits for explicit reconnect')

  let popup: BrowserWindow | null = null
  chat.once('did-create-window', window => { popup = window })
  await chat.executeJavaScript('window.open("/file"); void 0')
  await until(() => !!popup && !popup.webContents.isLoading(), 'authenticated popup')
  assert.equal(popup!.webContents.session, browserSession)
  assert.equal(popup!.webContents.getLastWebPreferences()!.sandbox, true)
  assert.equal(await popup!.webContents.executeJavaScript('typeof require'), 'undefined')
  const attemptsBeforePopupLogin = loginRequests
  assert.equal(await popup!.webContents.executeJavaScript('fetch("/api/auth/login?popup=1", {method:"POST"}).then(() => "allowed", () => "blocked")'), 'blocked')
  assert.equal(loginRequests, attemptsBeforePopupLogin)
  popup!.destroy()
  let downloadDone = false
  browserSession.once('will-download', (_event, item) => {
    item.setSavePath(join(directory, 'download.txt'))
    item.once('done', (_done, state) => { downloadDone = state === 'completed' })
  })
  await chat.executeJavaScript('location.href = "/download"; void 0')
  await until(() => downloadDone, 'authenticated download')
  assert.equal(readFileSync(join(directory, 'download.txt'), 'utf8'), 'chat fixture download')
  console.log('PASS: same-origin previews and file downloads preserve authentication')

  const passwordChangeRequests = loginRequests
  const revisionBeforePasswordChange = (await readState()).revision
  setCurrentUserCredentials({ username: 'fixture', password: 'changed-fixture-only' })
  controller.credentialsChanged()
  await until(async () => {
    const state = await readState()
    return loginRequests > passwordChangeRequests && state.status === 'ready' && state.revision > revisionBeforePasswordChange
  }, 'password change refresh')
  const pagesBeforeFailure = pageRequests
  mode = 'unavailable'
  assert.equal((await invoke('reload')).status, 'ready')
  assert.equal(pageRequests, pagesBeforeFailure)
  assert((await browserSession.cookies.get({ url, name: 'aka_chat_staff' })).length > 0)
  console.log('PASS: password changes renew and temporary failures preserve valid sessions')

  // Hold login pending to prove headers trigger recovery before either 401 body
  // finishes, and the web's immediate login navigation cannot steal the page.
  mode = 'pending'
  const requestsBeforeExpiry = loginRequests
  const pagesBeforeExpiry = pageRequests
  const expiredNavigations: boolean[] = []
  const trackExpiredNavigation = (event: Electron.Event, destination: string): void => {
    if (new URL(destination).searchParams.get('reason') === 'session-expired') expiredNavigations.push(event.defaultPrevented)
  }
  chat.on('will-navigate', trackExpiredNavigation)
  assert.deepEqual(await chat.executeJavaScript('Promise.all([window.fixtureSessionFetch("/api/chat/expired-slow?first=1"), window.fixtureSessionFetch("/api/chat/expired-slow?second=1")])'), [401, 401])
  await until(async () => pending !== null && expiredNavigations.length === 1 && (await readState()).status === 'connecting', '401 headers start recovery and block login redirect')
  assert.equal(slowExpiredResponses.length, 2)
  assert(slowExpiredResponses.every(response => !response.writableEnded))
  assert.deepEqual(expiredNavigations, [true])
  assert.equal(chat.getURL(), url)
  assert.equal(pageRequests, pagesBeforeExpiry)
  assert.equal(loginRequests, requestsBeforeExpiry + 1)
  mode = 'ok'
  loginResponse(pending!)
  pending = null
  await until(async () => (await readState()).status === 'ready' && pageRequests > pagesBeforeExpiry && !chat.isLoading(), 'expired session recovery loads authenticated Chat')
  assert((await chat.executeJavaScript('document.body.textContent')).includes('Chat fixture'))
  assert.equal(loginRequests, requestsBeforeExpiry + 1)
  assert(cookieHeaders[cookieHeaders.length - 1].includes(`aka_chat_staff=fixture-${loginRequests}`))
  for (const response of slowExpiredResponses) if (!response.destroyed) response.end('{}')
  chat.removeListener('will-navigate', trackExpiredNavigation)
  console.log('PASS: concurrent slow 401 responses recover once; web login navigation cannot race the authenticated reload')

  mode = 'mismatch'
  assert.equal((await invoke('reload')).status, 'error')
  assert.equal((await browserSession.cookies.get({ url, name: 'aka_chat_staff' })).length, 0)
  mode = 'denied'
  assert.equal((await invoke('reload')).status, 'error')
  mode = 'ok'
  assert.equal((await invoke('reload')).status, 'ready')
  console.log('PASS: wrong staff and rejected authentication fail closed; manual retry recovers')

  await until(() => !chat.isLoading(), 'Chat is ready before crash')
  const loginsBeforeCrash = loginRequests
  chat = await recoverCrashedGuest(chat, 'akaChat', () => host.webContents.executeJavaScript(
    'document.querySelector(\'section[aria-label="akaChat"] [role="alert"] button\').click()'
  ))
  assert.equal(loginRequests, loginsBeforeCrash + 1)

  // Authentication can finish while React is handling a crash. It must never
  // navigate the old guest, and must still attach exactly one replacement.
  mode = 'pending'
  const reloadDuringCrash = invoke('reload')
  await until(() => pending !== null, 'authentication is pending before Chat crash')
  chat = await recoverCrashedGuest(chat, 'akaChat', async () => {
    mode = 'ok'
    loginResponse(pending!)
    pending = null
    assert.equal((await reloadDuringCrash).status, 'ready')
  })
  console.log('PASS: akaChat replaces crashed guests on retry and during inflight authentication without terminating Electron')

  mode = 'pending'
  const pendingReload = invoke('reload').catch(() => null)
  await until(() => pending !== null, 'delayed login')
  const cleanup = controller.reset()
  await assert.rejects(invoke('prepare'))
  await cleanup
  await pendingReload
  assert.equal(chat.isDestroyed(), true)
  assert.equal(powerMonitor.listenerCount('resume'), baselineListeners)
  assert.equal((await browserSession.cookies.get({ url, name: 'aka_chat_staff' })).length, 0)
  mode = 'ok'
  if (pending && !pending.destroyed) loginResponse(pending)
  pending = null
  setCurrentUser(null)
  expectedStaffId = '303'
  setCurrentUser(user('second'))
  setCurrentUserCredentials({ username: 'fixture-2', password: 'fixture-only' })
  const next = await invoke('prepare')
  assert.equal(next.status, 'ready')
  assert.notEqual(next.partition, states[0].partition)
  assert.equal(next.sessionId, 'second')
  await controller.reset()
  setCurrentUser(null)
  console.log('PASS: logout aborts inflight login, blocks reopen during cleanup and isolates the next staff session')

  await host.webContents.executeJavaScript('window.setFixtureUser(null)')
  const crmUser = { ...user('crm-no-chat', false), organizationId: 1, isAdminAkabiz: false }
  setCurrentUser(crmUser)
  // CRM must not require or reuse akaAgent's process credentials.
  setCurrentUserCredentials(null)
  crmController.startSession()
  const sessionsBeforeCrm = createdSessions
  const requestsBeforeCrm = pageRequests
  const loginsBeforeCrm = loginRequests
  await host.webContents.executeJavaScript(`window.setFixtureUser(${JSON.stringify(crmUser)})`)
  await until(async () => await host.webContents.executeJavaScript('!!document.querySelector(\'button[title="CRM"]\')'), 'CRM menu for organization 1')
  assert.equal(await host.webContents.executeJavaScript('document.querySelector("webview") === null'), true)
  assert.equal(createdSessions, sessionsBeforeCrm)
  assert.equal(pageRequests, requestsBeforeCrm)
  assert.deepEqual(await host.webContents.executeJavaScript('Array.from(document.querySelectorAll(".app-sidebar-nav-item")).slice(0, 3).map(button => button.title)'), ['Chiến dịch', 'Trình duyệt', 'CRM'])
  const bothMenus = { ...crmUser, chatWebEnabledAtLogin: true, chatWebSessionId: 'menu-order-only' }
  await host.webContents.executeJavaScript(`window.setFixtureUser(${JSON.stringify(bothMenus)})`)
  await until(async () => await host.webContents.executeJavaScript('!!document.querySelector(\'button[title="akaChat"]\')'), 'akaChat menu label')
  assert.deepEqual(await host.webContents.executeJavaScript('Array.from(document.querySelectorAll(".app-sidebar-nav-item")).slice(0, 4).map(button => button.title)'), ['Chiến dịch', 'Trình duyệt', 'akaChat', 'CRM'])
  await host.webContents.executeJavaScript(`window.setFixtureUser(${JSON.stringify(crmUser)})`)

  let crmGuest: WebContents | null = null
  host.webContents.once('did-attach-webview', (_event, contents) => { crmGuest = contents })
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="CRM"]\').click()')
  await until(async () => !!crmGuest && !crmGuest.isLoading() && (await crmGuest.executeJavaScript('document.body.textContent')).includes('LoginPanel fixture'), 'CRM opens its login page')
  let crm = crmGuest!
  assert.equal(createdSessions, sessionsBeforeCrm + 1)
  assert.equal(loginRequests, loginsBeforeCrm)
  assert.equal(await crm.executeJavaScript('document.querySelector("input[name=username]").value + document.querySelector("input[name=password]").value'), '')
  assert.equal(crm.getLastWebPreferences()!.sandbox, true)
  assert.equal(crm.getLastWebPreferences()!.nodeIntegration, false)
  assert.equal(await crm.executeJavaScript('typeof require + ":" + typeof window.electronAPI'), 'undefined:undefined')
  const crmDescriptor = await prepareCrm()
  assert.notEqual(crmDescriptor.partition, next.partition)
  await crm.executeJavaScript('document.querySelector("input[name=username]").value = "manual-crm"; document.querySelector("input[name=password]").value = "fixture-only"; document.querySelector("form").requestSubmit(); void 0')
  await until(async () => loginRequests === loginsBeforeCrm + 1 && !crm.isLoading() && (await crm.executeJavaScript('document.body.textContent')).includes('Chat fixture'), 'manual CRM login succeeds')
  const crmSession = session.fromPartition(crmDescriptor.partition)
  assert.equal((await crmSession.cookies.get({ url, name: 'aka_chat_staff' })).length, 1)
  await crm.executeJavaScript('document.querySelector("#draft").value = "CRM draft"; history.pushState(null, "", "/customers"); void 0')
  await settleHostPaint()
  assert.equal(await host.webContents.executeJavaScript('!!document.querySelector(\'section[aria-label="CRM"] [role="status"]\')'), false)
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="Chiến dịch"]\').click()')
  await until(async () => await host.webContents.executeJavaScript('document.querySelector("webview").getBoundingClientRect().width === 0'), 'hide CRM')
  await host.webContents.executeJavaScript('document.querySelector(\'button[title="CRM"]\').click()')
  assert.equal(await crm.executeJavaScript('document.querySelector("#draft").value'), 'CRM draft')
  assert.equal(loginRequests, loginsBeforeCrm + 1)
  const crmCookieBeforeCrash = (await crmSession.cookies.get({ url, name: 'aka_chat_staff' }))[0].value
  for (const selector of ['button[title="Tải lại CRM"]', 'section[aria-label="CRM"] [role="alert"] button']) {
    crm = await recoverCrashedGuest(crm, 'CRM', () => host.webContents.executeJavaScript(
      `document.querySelector(${JSON.stringify(selector)}).click()`
    ))
    assert.equal(loginRequests, loginsBeforeCrm + 1, 'CRM recovery must not log in automatically')
    assert.equal((await crmSession.cookies.get({ url, name: 'aka_chat_staff' }))[0].value, crmCookieBeforeCrash)
  }
  console.log('PASS: both CRM retry buttons replace crashed guests and preserve the manual login')
  let crmPopup: BrowserWindow | null = null
  crm.once('did-create-window', window => { crmPopup = window })
  await crm.executeJavaScript('window.open("/file"); void 0')
  await until(() => !!crmPopup && !crmPopup.webContents.isLoading(), 'CRM file popup')
  assert.equal(crmPopup!.webContents.session, crmSession)
  assert.equal(crmPopup!.webContents.getLastWebPreferences()!.sandbox, true)
  assert.equal(await crmPopup!.webContents.executeJavaScript('typeof require + ":" + typeof window.electronAPI'), 'undefined:undefined')
  const crmCleanup = crmController.reset()
  await assert.rejects(prepareCrm())
  await crmCleanup
  assert.equal(crm.isDestroyed(), true)
  assert.equal(crmPopup!.isDestroyed(), true)
  assert.equal((await crmSession.cookies.get({ url, name: 'aka_chat_staff' })).length, 1)
  setCurrentUser(null)
  setCurrentUser({ ...crmUser, staffId: 404 })
  crmController.startSession()
  const otherCrm = await prepareCrm()
  assert.notEqual(otherCrm.partition, crmDescriptor.partition)
  assert.equal((await session.fromPartition(otherCrm.partition).cookies.get({ url, name: 'aka_chat_staff' })).length, 0)
  await crmController.reset()
  setCurrentUser(crmUser)
  crmController.startSession()
  assert.equal((await prepareCrm()).partition, crmDescriptor.partition)
  assert.equal((await crmSession.cookies.get({ url, name: 'aka_chat_staff' })).length, 1)
  await crmController.reset()
  setCurrentUser(null)
  host.destroy()
  console.log('PASS: organization-1 CRM is lazy, uses manual login, preserves its own staff profile, stays mounted and closes on logout')
}

run().then(() => {
  console.log('Chat Web Electron smoke tests passed.')
  server.closeAllConnections()
  server.close()
  app.exit(0)
}).catch(error => {
  Date.now = realNow
  console.error(error)
  server.closeAllConnections()
  server.close()
  app.exit(1)
})
