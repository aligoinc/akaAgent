import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, ListChecks, MessageCircle, RefreshCw } from 'lucide-react'
import type { AutoAccount } from '../../../shared/types'
import {
  FACEBOOK_MESSAGES_URL,
  FACEBOOK_UNREAD_COUNT_SCRIPT,
  facebookMessagesSelectionKey,
  formatFacebookUnreadBadge,
  normalizeFacebookUnreadCount,
  parseFacebookMessagesSelection,
  summarizeFacebookUnread
} from '../../../shared/facebookMessages'
import { useAuthStore } from '../stores/authStore'
import { useCampaignStore } from '../stores/campaignStore'
import { useFacebookMessagesUnreadStore } from '../stores/facebookMessagesUnreadStore'
import FacebookMessagesAccountPicker from '../components/FacebookMessages/FacebookMessagesAccountPicker'
import {
  accountInitials,
  isFacebookMessagesAccount,
  isLoggedIn,
  loginStatusLabel
} from '../components/FacebookMessages/facebookMessagesView'

// Cùng UA với tab Trình duyệt để Facebook thấy cùng một trình duyệt trên cùng phiên.
const FACEBOOK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
// Chỉ hỏi tiến trình chính (không gọi DB) cho tài khoản chưa có phiên sẵn sàng.
const SESSION_READY_POLL_MS = 3000
// Đếm đoạn chat chưa đọc bằng cách đọc DOM của chính webview Messenger (không gọi DB,
// không đụng webview của tab Trình duyệt). Đang mở trang này thì 5 giây một lần; ở trang
// khác vẫn đếm 30 giây một lần để mục "Tin nhắn Facebook" trên menu hiện tổng.
const UNREAD_POLL_MS = 5000
const UNREAD_BACKGROUND_POLL_MS = 30000

interface Props {
  isActive: boolean
  onOpenInBrowser: (accountId: number) => void
}

function readSelection(key: string | null): number[] {
  if (!key) return []
  try {
    return parseFacebookMessagesSelection(window.localStorage.getItem(key))
  } catch {
    return []
  }
}

function writeSelection(key: string | null, ids: number[]): void {
  if (!key) return
  try {
    window.localStorage.setItem(key, JSON.stringify(ids))
  } catch {
    // Không lưu được (bộ nhớ trình duyệt bị chặn): lựa chọn chỉ còn trong phiên này.
  }
}

export default function FacebookMessagesPage({ isActive, onOpenInBrowser }: Props) {
  const user = useAuthStore(state => state.user)
  const accounts = useCampaignStore(state => state.accounts)
  const storageKey = user ? facebookMessagesSelectionKey(user.organizationId, user.staffId) : null

  const [selectedIds, setSelectedIds] = useState<number[]>(() => readSelection(storageKey))
  const [activeId, setActiveId] = useState<number | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [readyIds, setReadyIds] = useState<Set<number>>(() => new Set())
  const [unreadById, setUnreadById] = useState<Map<number, number>>(() => new Map())
  const [canGoBackById, setCanGoBackById] = useState<Map<number, boolean>>(() => new Map())

  const webviews = useRef(new Map<number, Electron.WebviewTag>())
  const listenerCleanups = useRef(new Map<number, () => void>())
  const refCallbacks = useRef(new Map<number, (element: Electron.WebviewTag | null) => void>())

  const facebookAccounts = useMemo(() => accounts.filter(isFacebookMessagesAccount), [accounts])
  const selectedAccounts = useMemo(
    () => facebookAccounts.filter(account => selectedIds.includes(account.id)),
    [facebookAccounts, selectedIds]
  )
  const liveAccounts = useMemo(() => selectedAccounts.filter(isLoggedIn), [selectedAccounts])
  const mountedAccounts = useMemo(
    () => liveAccounts.filter(account => readyIds.has(account.id)),
    [liveAccounts, readyIds]
  )
  const activeAccount = selectedAccounts.find(account => account.id === activeId) ?? null

  useEffect(() => {
    if (activeId !== null && selectedAccounts.some(account => account.id === activeId)) return
    setActiveId(selectedAccounts[0]?.id ?? null)
  }, [activeId, selectedAccounts])

  // Webview chỉ được gắn khi tiến trình chính đã áp proxy của tài khoản vào phân vùng
  // (tab Trình duyệt làm việc này lúc mở app). Không tự áp lại proxy ở đây: áp lại sẽ
  // đóng mọi kết nối của phân vùng, cắt ngang request chiến dịch đang chạy.
  const pendingAccounts = useMemo(
    () => liveAccounts.filter(account => !readyIds.has(account.id)),
    [liveAccounts, readyIds]
  )
  const pendingKey = pendingAccounts.map(account => `${account.id}:${account.proxyId ?? 'none'}`).join(',')
  useEffect(() => {
    const api = window.electronAPI
    if (!pendingKey || !api?.isAccountBrowserSessionReady) return
    let cancelled = false
    const targets = pendingAccounts.map(account => ({ id: account.id, proxyId: account.proxyId ?? null }))
    const check = async () => {
      const ready = await Promise.all(targets.map(async target => {
        try {
          return await api.isAccountBrowserSessionReady(target.id, target.proxyId) ? target.id : null
        } catch {
          return null
        }
      }))
      if (cancelled) return
      const ids = ready.filter((id): id is number => id !== null)
      if (ids.length === 0) return
      setReadyIds(previous => {
        const next = new Set(previous)
        ids.forEach(id => next.add(id))
        return next
      })
    }
    void check()
    const timer = window.setInterval(() => { void check() }, SESSION_READY_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
    // pendingKey đã gồm id + proxy của mọi tài khoản đang chờ.
  }, [pendingKey])

  const updateCanGoBack = useCallback((accountId: number, element: Electron.WebviewTag) => {
    let canGoBack = false
    try {
      canGoBack = element.canGoBack()
    } catch {
      canGoBack = false
    }
    setCanGoBackById(previous => (
      previous.get(accountId) === canGoBack ? previous : new Map(previous).set(accountId, canGoBack)
    ))
  }, [])

  // Một callback cố định cho mỗi tài khoản: callback ref viết thẳng trong JSX sẽ bị React
  // gọi lại (null rồi element) ở mỗi lần render.
  const getWebviewRef = useCallback((accountId: number) => {
    const existing = refCallbacks.current.get(accountId)
    if (existing) return existing
    const callback = (element: Electron.WebviewTag | null) => {
      if (webviews.current.get(accountId) === element) return
      listenerCleanups.current.get(accountId)?.()
      listenerCleanups.current.delete(accountId)
      if (!element) {
        webviews.current.delete(accountId)
        setUnreadById(previous => {
          if (!previous.has(accountId)) return previous
          const next = new Map(previous)
          next.delete(accountId)
          return next
        })
        return
      }
      webviews.current.set(accountId, element)
      const onNavigate = () => updateCanGoBack(accountId, element)
      // Danh sách đoạn chat vẽ sau khi tải xong vài giây; đếm lần đầu khi trang dừng tải.
      const onStopLoading = () => { void countUnreadRef.current(accountId) }
      element.addEventListener('did-navigate', onNavigate)
      element.addEventListener('did-navigate-in-page', onNavigate)
      element.addEventListener('did-stop-loading', onStopLoading)
      listenerCleanups.current.set(accountId, () => {
        element.removeEventListener('did-navigate', onNavigate)
        element.removeEventListener('did-navigate-in-page', onNavigate)
        element.removeEventListener('did-stop-loading', onStopLoading)
      })
    }
    refCallbacks.current.set(accountId, callback)
    return callback
  }, [updateCanGoBack])

  const countingIds = useRef(new Set<number>())
  const countUnread = useCallback(async (accountId: number) => {
    const element = webviews.current.get(accountId)
    if (!element || countingIds.current.has(accountId)) return
    countingIds.current.add(accountId)
    try {
      const count = normalizeFacebookUnreadCount(await element.executeJavaScript(FACEBOOK_UNREAD_COUNT_SCRIPT))
      // Đang ở trang khác / đang tải: giữ số cũ.
      if (count === null || webviews.current.get(accountId) !== element) return
      setUnreadById(previous => (
        previous.get(accountId) === count ? previous : new Map(previous).set(accountId, count)
      ))
    } catch {
      // Webview chưa dom-ready hoặc đang gỡ.
    } finally {
      countingIds.current.delete(accountId)
    }
  }, [])
  const countUnreadRef = useRef(countUnread)
  countUnreadRef.current = countUnread

  useEffect(() => {
    const countAll = () => { webviews.current.forEach((_element, accountId) => { void countUnread(accountId) }) }
    countAll()
    const timer = window.setInterval(countAll, isActive ? UNREAD_POLL_MS : UNREAD_BACKGROUND_POLL_MS)
    return () => window.clearInterval(timer)
  }, [countUnread, isActive, mountedAccounts.length])

  // Gửi tổng lên menu bên trái. Chỉ tính tài khoản đã chọn; chưa đăng nhập / chưa đếm xong
  // thì không cộng vào tổng.
  const setUnreadSummary = useFacebookMessagesUnreadStore(state => state.setSummary)
  const unreadSummary = useMemo(() => summarizeFacebookUnread(
    selectedAccounts.map(account => ({ id: account.id, name: account.name, loggedIn: isLoggedIn(account) })),
    unreadById
  ), [selectedAccounts, unreadById])
  useEffect(() => { setUnreadSummary(unreadSummary) }, [setUnreadSummary, unreadSummary])
  useEffect(() => () => setUnreadSummary(null), [setUnreadSummary])

  useEffect(() => () => {
    listenerCleanups.current.forEach(cleanup => cleanup())
    listenerCleanups.current.clear()
    webviews.current.clear()
  }, [])

  // Messenger của tài khoản không xem phải mất focus: Facebook chỉ báo "Đã xem" khi
  // trang đang có focus.
  useEffect(() => {
    webviews.current.forEach((element, accountId) => {
      if (!isActive || accountId !== activeId) {
        try { element.blur() } catch { /* webview đang gỡ */ }
      }
    })
  }, [activeId, isActive])

  const handleSaveSelection = (ids: number[]) => {
    setSelectedIds(ids)
    writeSelection(storageKey, ids)
    setPickerOpen(false)
  }

  const getActiveWebview = () => (activeId !== null ? webviews.current.get(activeId) : undefined)
  const handleGoBack = () => {
    const element = getActiveWebview()
    try {
      if (element?.canGoBack()) element.goBack()
    } catch { /* chưa sẵn sàng */ }
  }
  const handleReload = () => {
    try { getActiveWebview()?.reload() } catch { /* chưa sẵn sàng */ }
  }
  const handleGoHome = () => {
    getActiveWebview()?.loadURL(FACEBOOK_MESSAGES_URL).catch(() => {})
  }

  const totalUnread = unreadSummary.total
  const activeMounted = Boolean(activeAccount && mountedAccounts.some(account => account.id === activeAccount.id))

  const rowStatus = (account: AutoAccount): { text: string; warning: boolean } => {
    if (!isLoggedIn(account)) return { text: loginStatusLabel(account.loginStatus), warning: true }
    if (!readyIds.has(account.id)) return { text: 'Đang chuẩn bị...', warning: false }
    const unread = unreadById.get(account.id)
    if (unread === undefined) return { text: 'Đang tải tin nhắn...', warning: false }
    return { text: unread > 0 ? `${unread} đoạn chat chưa đọc` : 'Không có tin mới', warning: false }
  }

  return (
    <div className="fb-messages-page">
      <aside className="fb-messages-accounts">
        <div className="fb-messages-accounts-header">
          <div className="fb-messages-accounts-title">
            <span>Tài khoản</span>
            <span className="fb-messages-accounts-meta">
              {totalUnread > 0
                ? `${formatFacebookUnreadBadge(totalUnread)} chưa đọc`
                : `${selectedAccounts.length} / ${facebookAccounts.length}`}
            </span>
          </div>
          <button className="btn btn-secondary fb-messages-pick-button" onClick={() => setPickerOpen(true)}>
            <ListChecks size={14} />
            <span>Chọn tài khoản</span>
          </button>
        </div>
        <div className="fb-messages-account-list">
          {selectedAccounts.length === 0 ? (
            <div className="fb-messages-account-empty">
              {facebookAccounts.length === 0 ? 'Chưa có tài khoản Facebook nào.' : 'Chưa chọn tài khoản nào.'}
            </div>
          ) : selectedAccounts.map(account => {
            const status = rowStatus(account)
            const unread = isLoggedIn(account) ? (unreadById.get(account.id) ?? 0) : 0
            return (
              <button
                key={account.id}
                type="button"
                className={`fb-messages-account-row ${account.id === activeId ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}`}
                onClick={() => setActiveId(account.id)}
                title={account.name}
              >
                <span className="fb-messages-avatar">{accountInitials(account.name)}</span>
                <span className="fb-messages-account-text">
                  <span className="fb-messages-account-name">{account.name}</span>
                  <span className={`fb-messages-account-status ${status.warning ? 'is-warning' : ''}`}>{status.text}</span>
                </span>
                {unread > 0 && <span className="fb-messages-unread-badge">{formatFacebookUnreadBadge(unread)}</span>}
              </button>
            )
          })}
        </div>
      </aside>

      <section className="fb-messages-main">
        <div className="fb-messages-toolbar">
          <span className="fb-messages-toolbar-name">{activeAccount?.name ?? ''}</span>
          <button
            className="btn-icon"
            onClick={handleGoBack}
            title="Quay lại"
            aria-label="Quay lại trang trước đó"
            disabled={!activeMounted || !(activeId !== null && canGoBackById.get(activeId))}
          >
            <ArrowLeft size={14} />
          </button>
          <button className="btn-icon" onClick={handleReload} title="Tải lại" aria-label="Tải lại" disabled={!activeMounted}>
            <RefreshCw size={14} />
          </button>
          <button className="btn btn-secondary fb-messages-home-button" onClick={handleGoHome} disabled={!activeMounted}>
            <MessageCircle size={14} />
            <span>Về trang tin nhắn</span>
          </button>
        </div>

        <div className="fb-messages-webview-container">
          {mountedAccounts.map(account => (
            <webview
              key={account.id}
              ref={getWebviewRef(account.id) as any}
              src={FACEBOOK_MESSAGES_URL}
              partition={`persist:account_${account.id}`}
              className="fb-messages-webview"
              style={{ zIndex: account.id === activeId ? 2 : 1 }}
              /* @ts-ignore */
              allowpopups="true"
              /* @ts-ignore */
              useragent={FACEBOOK_USER_AGENT}
            />
          ))}

          {!activeMounted && (
            <div className="fb-messages-overlay">
              {facebookAccounts.length === 0 ? (
                <div className="fb-messages-overlay-text">Chưa có tài khoản Facebook nào. Hãy thêm tài khoản ở trang Chiến dịch.</div>
              ) : !activeAccount ? (
                <>
                  <div className="fb-messages-overlay-text">Chọn tài khoản để xem tin nhắn</div>
                  <button className="btn btn-secondary" onClick={() => setPickerOpen(true)}>Chọn tài khoản</button>
                </>
              ) : !isLoggedIn(activeAccount) ? (
                <>
                  <AlertTriangle size={22} className="fb-messages-overlay-icon" />
                  <div className="fb-messages-overlay-text">
                    Tài khoản này đang ở trạng thái {String(activeAccount.loginStatus || 'chưa đăng nhập').toLocaleLowerCase('vi-VN')}. Mở tab Trình duyệt để đăng nhập lại.
                  </div>
                  <button className="btn btn-secondary" onClick={() => onOpenInBrowser(activeAccount.id)}>Mở ở Trình duyệt</button>
                </>
              ) : (
                <div className="fb-messages-overlay-text">
                  Đang chuẩn bị phiên trình duyệt... Nếu chờ lâu, hãy mở tab Trình duyệt của tài khoản này để kiểm tra proxy.
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {pickerOpen && (
        <FacebookMessagesAccountPicker
          accounts={facebookAccounts}
          selectedIds={selectedIds}
          onSave={handleSaveSelection}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
