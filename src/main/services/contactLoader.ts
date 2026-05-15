import { BrowserWindow, webContents } from 'electron'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_EVENTS, ContactType, AutoAccountContact, ContactLoadResult } from '../../shared/types'

type ProgressCallback = (message: string) => void

interface FacebookGraphPage {
  id?: unknown
  name?: unknown
  category?: unknown
}

interface FacebookGraphPageResponse {
  data?: FacebookGraphPage[]
  paging?: { next?: unknown }
  error?: { message?: unknown }
}

/**
 * ContactLoader: scrapes Facebook friends, groups and pages
 * from an account's embedded webview, then saves results to auto_account_contacts.
 */
export class ContactLoader {
  private supabase: SupabaseService
  private webviewRegistry: WebviewRegistry
  private mainWindow: BrowserWindow
  private cancelledLoads = new Set<number>()
  private activeLoadControllers = new Map<number, AbortController>()

  constructor(supabase: SupabaseService, webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
  }

  private sendProgress(message: string): void {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CONTACTS_PROGRESS, { message })
    } catch {}
  }

  private completeLoad(accountId: number, contactType: ContactType, result: ContactLoadResult): ContactLoadResult {
    try {
      this.mainWindow.webContents.send(IPC_EVENTS.CONTACTS_COMPLETED, {
        accountId,
        contactType,
        result
      })
    } catch {}
    return result
  }

  cancelLoad(accountId: number): void {
    this.cancelledLoads.add(accountId)
    this.activeLoadControllers.get(accountId)?.abort()
    this.sendProgress('Đã dừng quét data.')
    const wcId = this.webviewRegistry.getWebContentsId(accountId)
    const wc = wcId ? webContents.fromId(wcId) : null
    if (wc && !wc.isDestroyed() && wc.isLoading()) {
      wc.stop()
    }
  }

  private isLoadCancelled(accountId: number): boolean {
    return this.cancelledLoads.has(accountId)
  }

  private startLoad(accountId: number): AbortController {
    this.cancelledLoads.delete(accountId)
    this.activeLoadControllers.get(accountId)?.abort()
    const controller = new AbortController()
    this.activeLoadControllers.set(accountId, controller)
    return controller
  }

  private async raceWithCancel<T>(
    accountId: number,
    promise: Promise<T>,
    signal: AbortSignal
  ): Promise<T | undefined> {
    if (signal.aborted || this.isLoadCancelled(accountId)) return undefined

    let removeAbortListener = () => {}
    const cancelPromise = new Promise<undefined>(resolve => {
      const onAbort = () => resolve(undefined)
      signal.addEventListener('abort', onAbort, { once: true })
      removeAbortListener = () => signal.removeEventListener('abort', onAbort)
    })
    const guardedPromise = promise.catch(err => {
      if (signal.aborted || this.isLoadCancelled(accountId)) return undefined
      throw err
    })

    try {
      return await Promise.race([guardedPromise, cancelPromise])
    } finally {
      removeAbortListener()
    }
  }

  private async waitForDelay(accountId: number, ms: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted || this.isLoadCancelled(accountId)) return false

    return new Promise(resolve => {
      let settled = false
      let timer: ReturnType<typeof setTimeout>
      const cleanup = (completed: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        resolve(completed)
      }
      const onAbort = () => cleanup(false)
      timer = setTimeout(() => cleanup(true), ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  /**
   * Load friends list for a Facebook account.
   */
  async loadFriends(accountId: number): Promise<ContactLoadResult> {
    return this.loadContacts(accountId, 'friend', 'https://www.facebook.com/friends/list', this.scrapeFriends.bind(this))
  }

  /**
   * Load groups list for a Facebook account.
   */
  async loadGroups(accountId: number): Promise<ContactLoadResult> {
    return this.loadContacts(accountId, 'group', 'https://www.facebook.com/groups/joins/', this.scrapeGroups.bind(this))
  }

  /**
   * Load managed Facebook pages for a Facebook account.
   */
  async loadPages(accountId: number): Promise<ContactLoadResult> {
    return this.loadContacts(accountId, 'page', 'https://business.facebook.com/content_management', this.scrapePages.bind(this))
  }

  private getContactTypeName(contactType: ContactType): string {
    switch (contactType) {
      case 'friend': return 'bạn bè'
      case 'group': return 'group'
      case 'page': return 'page'
    }
  }

  private async loadContacts(
    accountId: number,
    contactType: ContactType,
    targetUrl: string,
    scrapeFn: (wc: Electron.WebContents, accountId: number) => Promise<Partial<AutoAccountContact>[]>
  ): Promise<ContactLoadResult> {
    let account: Awaited<ReturnType<SupabaseService['getAccount']>>
    try {
      account = await this.supabase.getAccount(accountId)
    } catch (err: any) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: `Không thể kiểm tra trạng thái tài khoản: ${err.message || String(err)}`
      })
    }

    if (!account) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Không tìm thấy tài khoản'
      })
    }

    if (!account.isActive) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Tài khoản đang bị tắt, không thể quét data'
      })
    }

    if (account.loginStatus !== 'đã đăng nhập') {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Tài khoản chưa đăng nhập Facebook'
      })
    }

    if (account.status !== 'chờ xử lý' && account.status !== 'tạm dừng') {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: `tài khoản ${account.status || 'không xác định'} không thể quét data`
      })
    }

    // Validate webview is available
    const controller = this.webviewRegistry.getController(accountId)
    if (!controller || !controller.isConnected()) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Tab trình duyệt chưa được mở hoặc không khả dụng'
      })
    }

    const wcId = this.webviewRegistry.getWebContentsId(accountId)
    if (!wcId) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'Không tìm thấy webContents cho tài khoản này'
      })
    }

    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      return this.completeLoad(accountId, contactType, {
        success: false,
        count: 0,
        error: 'WebContents đã bị huỷ'
      })
    }

    const loadController = this.startLoad(accountId)
    const signal = loadController.signal
    const typeName = this.getContactTypeName(contactType)
    this.sendProgress(`🔄 Đang load danh sách ${typeName}...`)

    try {
      let navigationCompleted = false
      // Navigate to the target page
      if (!this.isLoadCancelled(accountId)) {
        const navigated = await this.raceWithCancel(accountId, wc.loadURL(targetUrl).then(() => true), signal)
        navigationCompleted = navigated === true
      }
      // Wait for page to load
      if (!this.isLoadCancelled(accountId)) {
        await this.waitForDelay(accountId, 3000, signal)
      }

      // Scroll and scrape
      const canScrape = navigationCompleted || !this.isLoadCancelled(accountId) || wc.getURL().startsWith('https://www.facebook.com/')
      const contacts = canScrape ? await scrapeFn(wc, accountId) : []
      const stoppedBeforeSave = this.isLoadCancelled(accountId)

      if (contacts.length === 0) {
        if (stoppedBeforeSave) {
          await this.supabase.deleteContacts(accountId, contactType)
          this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu 0 data cho lần quét này.`)
          return this.completeLoad(accountId, contactType, { success: true, count: 0, stopped: true })
        }
        this.sendProgress(`⚠️ Không tìm thấy ${typeName} nào. Kiểm tra tài khoản đã đăng nhập chưa.`)
        return this.completeLoad(accountId, contactType, {
          success: false,
          count: 0,
          error: `Không tìm thấy ${typeName} nào`
        })
      }

      // Add accountId and contactType to each contact
      const contactsWithMeta = contacts.map(c => ({
        ...c,
        accountId,
        contactType
      }))

      // Save to DB
      this.sendProgress(`💾 Đang lưu ${contactsWithMeta.length} ${typeName}...`)
      const saved = await this.supabase.upsertContacts(contactsWithMeta)
      const stoppedAfterSave = this.isLoadCancelled(accountId) || stoppedBeforeSave

      if (stoppedAfterSave) {
        this.sendProgress(`Đã dừng quét ${typeName}. Đã lưu ${saved} data cho lần quét này.`)
        return this.completeLoad(accountId, contactType, { success: true, count: saved, stopped: true })
      }

      this.sendProgress(`✅ Đã load ${saved} ${typeName} thành công!`)
      return this.completeLoad(accountId, contactType, { success: true, count: saved })
    } catch (err: any) {
      const errMsg = err.message || String(err)
      this.sendProgress(`❌ Lỗi load ${typeName}: ${errMsg}`)
      return this.completeLoad(accountId, contactType, { success: false, count: 0, error: errMsg })
    } finally {
      if (this.activeLoadControllers.get(accountId) === loadController) {
        this.activeLoadControllers.delete(accountId)
        this.cancelledLoads.delete(accountId)
      }
    }
  }

  /**
   * Scroll the page multiple times to load lazy-loaded content.
   * Facebook renders the friends list inside a scrollable sidebar container,
   * NOT the main window. We must find the correct scrollable ancestor
   * of the friend cards and scroll that element.
   */
  private async scrollAndWait(
    wc: Electron.WebContents,
    accountId: number,
    contactType: 'friend' | 'group',
    delayMs: number = 1500
  ): Promise<void> {
    let prevCount = 0
    let noChangeCount = 0
    let scrollCount = 0
    const signal = this.activeLoadControllers.get(accountId)?.signal
    const typeName = this.getContactTypeName(contactType)

    while (true) {
      if (this.isLoadCancelled(accountId)) {
        this.sendProgress('Đã nhận lệnh dừng, ngưng cuộn trang.')
        break
      }
      scrollCount++

      try {
        const scrollPromise = wc.executeJavaScript(`
        (function() {
          // Strategy: find the scrollable container that holds the friend/group cards.
          // Facebook's friends list is inside a sidebar with overflow-y: auto/scroll.
          // We locate the card elements, then walk up the DOM to find the scrollable parent.

          function findScrollableParent(el) {
            var node = el;
            while (node && node !== document.body && node !== document.documentElement) {
              var style = window.getComputedStyle(node);
              var overflowY = style.overflowY;
              // A valid scrollable container has overflow auto/scroll and is actually scrollable
              if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 50) {
                return node;
              }
              node = node.parentElement;
            }
            return null;
          }

          // Try to find a friend/group card as anchor point
          // On Facebook's friends page, cards are typically links inside the sidebar
          var anchorEl = null;

          // Look for the typical friends list heading or the card container
          // The friends list page has a visible list of <a> tags pointing to profiles
          var profileLinks = document.querySelectorAll('a[href*="facebook.com/"]');
          for (var i = 0; i < profileLinks.length; i++) {
            var href = profileLinks[i].href || '';
            if (href.match(/facebook\\.com\\/(profile\\.php|[a-zA-Z0-9._]+)\\/?$/) && 
                !href.includes('/friends') && !href.includes('/groups') && 
                !href.includes('/pages') && !href.includes('/watch')) {
              anchorEl = profileLinks[i];
              break;
            }
          }

          // If no profile links found yet, try group links
          if (!anchorEl) {
            var groupLinks = document.querySelectorAll('a[href*="/groups/"]');
            for (var i = 0; i < groupLinks.length; i++) {
              var href = groupLinks[i].href || '';
              if (href.match(/\\/groups\\/[0-9]+/)) {
                anchorEl = groupLinks[i];
                break;
              }
            }
          }

          if (!anchorEl) {
            var pageLinks = document.querySelectorAll('a[href*="facebook.com/"]');
            for (var p = 0; p < pageLinks.length; p++) {
              var pageHref = pageLinks[p].href || '';
              if (pageHref.includes('/pages/') || pageHref.match(/facebook\\.com\\/[a-zA-Z0-9._-]+\\/?(\\?|$)/)) {
                anchorEl = pageLinks[p];
                break;
              }
            }
          }

          var scrolled = false;

          if (anchorEl) {
            var scrollContainer = findScrollableParent(anchorEl);
            if (scrollContainer) {
              // Scroll the actual container
              scrollContainer.scrollTop = scrollContainer.scrollHeight;
              scrolled = true;
            }
          }

          // Fallback: try common Facebook scrollable selectors
          if (!scrolled) {
            // Facebook often wraps sidebar content in [role="navigation"] or specific divs
            var candidates = [
              document.querySelector('[role="main"]'),
              document.querySelector('[role="navigation"]'),
              document.querySelector('[data-pagelet="ProfileAppSection_0"]'),
            ];
            for (var j = 0; j < candidates.length; j++) {
              var c = candidates[j];
              if (c) {
                var sc = findScrollableParent(c);
                if (sc) {
                  sc.scrollTop = sc.scrollHeight;
                  scrolled = true;
                  break;
                }
              }
            }
          }

          // Ultimate fallback: scroll window + documentElement + body
          if (!scrolled) {
            window.scrollTo(0, document.body.scrollHeight);
            document.documentElement.scrollTop = document.documentElement.scrollHeight;
          }

          // Also always try scrolling all elements with significant scroll potential
          // This catches edge cases with different Facebook layouts
          var allDivs = document.querySelectorAll('div');
          for (var k = 0; k < allDivs.length; k++) {
            var div = allDivs[k];
            var st = window.getComputedStyle(div);
            if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && 
                div.scrollHeight > div.clientHeight + 200 &&
                div.clientHeight > 300) {
              div.scrollTop = div.scrollHeight;
            }
          }

          return true;
        })()
      `)
        const scrollResult = signal
          ? await this.raceWithCancel(accountId, scrollPromise, signal)
          : await scrollPromise
        if (scrollResult !== true) break
      } catch (err) {
        if (this.isLoadCancelled(accountId)) {
          this.sendProgress('Đã nhận lệnh dừng, dùng dữ liệu hiện có trên trang.')
          break
        }
        throw err
      }

      const delayCompleted = signal
        ? await this.waitForDelay(accountId, delayMs, signal)
        : await new Promise<boolean>(resolve => setTimeout(() => resolve(true), delayMs))
      if (!delayCompleted) {
        this.sendProgress('Đã nhận lệnh dừng, dùng dữ liệu hiện có trên trang.')
        break
      }
      if (this.isLoadCancelled(accountId)) {
        this.sendProgress('Đã nhận lệnh dừng, dùng dữ liệu hiện có trên trang.')
        break
      }

      const currentCount = await this.countLoadedContacts(wc, accountId, contactType)
      if (typeof currentCount !== 'number') break

      this.sendProgress(`📜 Đang cuộn trang... lần ${scrollCount}, đã thấy ${currentCount} ${typeName}`)

      // Stop only after 3 scroll cycles without any newly parsed valid contacts.
      if (currentCount > prevCount) {
        noChangeCount = 0
        prevCount = currentCount
      } else {
        noChangeCount++
        if (noChangeCount >= 3) {
          break
        }
      }
    }
  }

  private async countLoadedContacts(
    wc: Electron.WebContents,
    accountId: number,
    contactType: 'friend' | 'group'
  ): Promise<number | undefined> {
    if (this.isLoadCancelled(accountId)) return undefined

    const script = contactType === 'friend'
      ? `
        (function() {
          var seen = new Set();
          var reservedPaths = new Set([
            'friends', 'groups', 'pages', 'photo', 'photos', 'story', 'watch', 'reel', 'reels',
            'hashtag', 'events', 'marketplace', 'gaming', 'settings', 'notifications',
            'messages', 'bookmarks', 'help', 'privacy', 'policies', 'ads', 'search'
          ]);

          function toFacebookUrl(href) {
            try {
              var url = new URL(href, window.location.origin);
              var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '');
              if (host !== 'facebook.com' && host !== 'fb.com') return null;
              return url;
            } catch (e) {
              return null;
            }
          }

          function extractProfileTarget(href) {
            var url = toFacebookUrl(href);
            if (!url) return null;

            if (url.pathname === '/profile.php') {
              var id = url.searchParams.get('id');
              if (!id) return null;
              return { uid: id };
            }

            var parts = url.pathname.split('/').filter(Boolean);
            if (parts.length !== 1) return null;
            var slug = parts[0];
            if (!slug || reservedPaths.has(slug.toLowerCase())) return null;
            if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;
            return { uid: slug };
          }

          function cleanFriendName(a) {
            function clean(txt) {
              return String(txt || '')
                .replace(/\\s+/g, ' ')
                .replace(/\\d+\\s*bạn chung.*$/i, '')
                .replace(/Có\\s*[\\d,.]+[KkMm]?\\s*người theo dõi.*$/i, '')
                .replace(/\\d+\\s*mutual friends?.*$/i, '')
                .replace(/\\d+\\s*followers?.*$/i, '')
                .trim();
            }

            function bad(txt) {
              return !txt ||
                /bạn chung|mutual friends?|người theo dõi|followers?/i.test(txt) ||
                /^(Bạn bè|Friends|Thêm bạn bè|Add friend|Nhắn tin|Message|Theo dõi|Follow)$/i.test(txt);
            }

            var spans = a.querySelectorAll('span, strong, h2, h3');
            for (var s = 0; s < spans.length; s++) {
              var span = spans[s];
              if (span.querySelector('span, strong, h2, h3')) continue;
              var candidate = clean(span.textContent);
              if (candidate.length >= 2 && candidate.length <= 80 && !bad(candidate)) return candidate;
            }

            var text = clean(a.innerText || a.textContent);
            if (text.length >= 2 && text.length <= 100 && !bad(text)) return text;
            return '';
          }

          var links = document.querySelectorAll('a[href*="facebook.com/"]');
          for (var i = 0; i < links.length; i++) {
            var target = extractProfileTarget(links[i].href || '');
            if (!target) continue;
            var name = cleanFriendName(links[i]);
            if (!name || name.length < 2 || name.length > 100) continue;
            seen.add(target.uid);
          }

          return seen.size;
        })()
      `
      : `
        (function() {
          var seen = new Set();
          var reservedGroupPaths = new Set([
            'feed', 'joins', 'discover', 'create', 'category', 'notifications',
            'your_groups', 'membership', 'browse'
          ]);

          function toFacebookUrl(href) {
            try {
              var url = new URL(href, window.location.origin);
              var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '');
              if (host !== 'facebook.com' && host !== 'fb.com') return null;
              return url;
            } catch (e) {
              return null;
            }
          }

          function extractGroupTarget(href) {
            var url = toFacebookUrl(href);
            if (!url) return null;
            var parts = url.pathname.split('/').filter(Boolean);
            var idx = parts.findIndex(function(part) { return part.toLowerCase() === 'groups'; });
            if (idx === -1 || idx + 1 >= parts.length) return null;
            var groupKey = parts[idx + 1];
            if (!groupKey || reservedGroupPaths.has(groupKey.toLowerCase())) return null;
            if (!/^[a-zA-Z0-9._-]+$/.test(groupKey)) return null;
            return { uid: groupKey };
          }

          function normalizeText(txt) {
            return String(txt || '').replace(/\\s+/g, ' ').trim();
          }

          function isActivityText(txt) {
            return /Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity/i.test(txt);
          }

          function cleanGroupName(a) {
            function stripActivity(txt) {
              return normalizeText(txt)
                .replace(/\\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i, '')
                .trim();
            }

            var lines = String(a.innerText || '')
              .split(/\\n+/)
              .map(stripActivity)
              .filter(Boolean);
            for (var l = 0; l < lines.length; l++) {
              if (!isActivityText(lines[l]) && lines[l].length >= 2 && lines[l].length <= 180) return lines[l];
            }

            var spans = a.querySelectorAll('span, strong, h2, h3');
            for (var s = 0; s < spans.length; s++) {
              var span = spans[s];
              if (span.querySelector('span, strong, h2, h3')) continue;
              var candidate = stripActivity(span.textContent);
              if (!isActivityText(candidate) && candidate.length >= 2 && candidate.length <= 180) return candidate;
            }

            return stripActivity(a.textContent);
          }

          var links = document.querySelectorAll('a[href*="/groups/"]');
          for (var i = 0; i < links.length; i++) {
            var target = extractGroupTarget(links[i].href || '');
            if (!target) continue;
            var name = cleanGroupName(links[i]);
            if (!name || name.length < 2 || name.length > 200) continue;
            seen.add(target.uid);
          }

          return seen.size;
        })()
      `

    try {
      const countPromise = wc.executeJavaScript(script)
      const signal = this.activeLoadControllers.get(accountId)?.signal
      const result = signal
        ? await this.raceWithCancel(accountId, countPromise, signal)
        : await countPromise
      return typeof result === 'number' ? result : undefined
    } catch (err) {
      if (this.isLoadCancelled(accountId)) return undefined
      throw err
    }
  }

  /**
   * Scrape friends from facebook.com/friends/list page.
   */
  private async scrapeFriends(wc: Electron.WebContents, accountId: number): Promise<Partial<AutoAccountContact>[]> {
    // Scroll to load all friends
    await this.scrollAndWait(wc, accountId, 'friend', 1500)

    const results = await wc.executeJavaScript(`
      (function() {
        var friends = [];
        var seen = new Set();
        var reservedPaths = new Set([
          'friends', 'groups', 'pages', 'photo', 'photos', 'story', 'watch', 'reel', 'reels',
          'hashtag', 'events', 'marketplace', 'gaming', 'settings', 'notifications',
          'messages', 'bookmarks', 'help', 'privacy', 'policies', 'ads', 'search'
        ]);

        function toFacebookUrl(href) {
          try {
            var url = new URL(href, window.location.origin);
            var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '');
            if (host !== 'facebook.com' && host !== 'fb.com') return null;
            return url;
          } catch (e) {
            return null;
          }
        }

        function extractProfileTarget(href) {
          var url = toFacebookUrl(href);
          if (!url) return null;

          if (url.pathname === '/profile.php') {
            var id = url.searchParams.get('id');
            if (!id) return null;
            return {
              uid: id,
              url: 'https://www.facebook.com/profile.php?id=' + id
            };
          }

          var parts = url.pathname.split('/').filter(Boolean);
          if (parts.length !== 1) return null;
          var slug = parts[0];
          if (!slug || reservedPaths.has(slug.toLowerCase())) return null;
          if (!/^[a-zA-Z0-9._-]+$/.test(slug)) return null;

          return {
            uid: slug,
            url: 'https://www.facebook.com/' + slug
          };
        }

        function cleanFriendName(a) {
          function clean(txt) {
            return String(txt || '')
              .replace(/\\s+/g, ' ')
              .replace(/\\d+\\s*bạn chung.*$/i, '')
              .replace(/Có\\s*[\\d,.]+[KkMm]?\\s*người theo dõi.*$/i, '')
              .replace(/\\d+\\s*mutual friends?.*$/i, '')
              .replace(/\\d+\\s*followers?.*$/i, '')
              .trim();
          }

          function bad(txt) {
            return !txt ||
              /bạn chung|mutual friends?|người theo dõi|followers?/i.test(txt) ||
              /^(Bạn bè|Friends|Thêm bạn bè|Add friend|Nhắn tin|Message|Theo dõi|Follow)$/i.test(txt);
          }

          var spans = a.querySelectorAll('span, strong, h2, h3');
          for (var s = 0; s < spans.length; s++) {
            var span = spans[s];
            if (span.querySelector('span, strong, h2, h3')) continue;
            var candidate = clean(span.textContent);
            if (candidate.length >= 2 && candidate.length <= 80 && !bad(candidate)) {
              return candidate;
            }
          }

          var text = clean(a.innerText || a.textContent);
          if (text.length >= 2 && text.length <= 100 && !bad(text)) return text;
          return '';
        }

        // Facebook friends list: look for links that contain profile URLs
        // The friends page typically renders cards with <a> links to user profiles
        var links = document.querySelectorAll('a[href*="facebook.com/"]');

        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          var href = a.href || '';
          var target = extractProfileTarget(href);
          if (!target) continue;

          var uid = target.uid;
          var name = cleanFriendName(a);
          if (!name || name.length < 2 || name.length > 100) continue;
          if (seen.has(uid)) continue;
          seen.add(uid);

          friends.push({
            name: name,
            uid: uid,
            url: target.url,
            extraData: { source: 'facebook_friends_list' }
          });
          continue;
        }

        return friends;
      })()
    `)

    return (results || []) as Partial<AutoAccountContact>[]
  }

  /**
   * Scrape groups from facebook.com/groups/joins/ page.
   */
  private async scrapeGroups(wc: Electron.WebContents, accountId: number): Promise<Partial<AutoAccountContact>[]> {
    // Scroll to load all groups
    await this.scrollAndWait(wc, accountId, 'group', 1500)

    const results = await wc.executeJavaScript(`
      (function() {
        var groups = [];
        var seen = new Set();
        var reservedGroupPaths = new Set([
          'feed', 'joins', 'discover', 'create', 'category', 'notifications',
          'your_groups', 'membership', 'browse'
        ]);

        function toFacebookUrl(href) {
          try {
            var url = new URL(href, window.location.origin);
            var host = url.hostname.replace(/^www\\./i, '').replace(/^web\\./i, '').replace(/^m\\./i, '');
            if (host !== 'facebook.com' && host !== 'fb.com') return null;
            return url;
          } catch (e) {
            return null;
          }
        }

        function extractGroupTarget(href) {
          var url = toFacebookUrl(href);
          if (!url) return null;
          var parts = url.pathname.split('/').filter(Boolean);
          var idx = parts.findIndex(function(part) { return part.toLowerCase() === 'groups'; });
          if (idx === -1 || idx + 1 >= parts.length) return null;
          var groupKey = parts[idx + 1];
          if (!groupKey || reservedGroupPaths.has(groupKey.toLowerCase())) return null;
          if (!/^[a-zA-Z0-9._-]+$/.test(groupKey)) return null;
          return {
            uid: groupKey,
            url: 'https://www.facebook.com/groups/' + groupKey
          };
        }

        function normalizeText(txt) {
          return String(txt || '').replace(/\\s+/g, ' ').trim();
        }

        function isActivityText(txt) {
          return /Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity/i.test(txt);
        }

        function extractActivityText(a) {
          var lines = String(a.innerText || a.textContent || '')
            .split(/\\n+/)
            .map(normalizeText)
            .filter(Boolean);
          for (var i = 0; i < lines.length; i++) {
            if (isActivityText(lines[i])) return lines[i];
          }
          var full = normalizeText(a.textContent);
          var match = full.match(/(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i);
          return match ? normalizeText(match[0]) : '';
        }

        function cleanGroupName(a) {
          function stripActivity(txt) {
            return normalizeText(txt)
              .replace(/\\s*(Lần hoạt động gần nhất|Hoạt động gần nhất|Last active|Last activity)[:：]?.*$/i, '')
              .trim();
          }

          var lines = String(a.innerText || '')
            .split(/\\n+/)
            .map(stripActivity)
            .filter(Boolean);
          for (var l = 0; l < lines.length; l++) {
            if (!isActivityText(lines[l]) && lines[l].length >= 2 && lines[l].length <= 180) {
              return lines[l];
            }
          }

          var spans = a.querySelectorAll('span, strong, h2, h3');
          for (var s = 0; s < spans.length; s++) {
            var span = spans[s];
            if (span.querySelector('span, strong, h2, h3')) continue;
            var candidate = stripActivity(span.textContent);
            if (!isActivityText(candidate) && candidate.length >= 2 && candidate.length <= 180) {
              return candidate;
            }
          }

          return stripActivity(a.textContent);
        }

        // Facebook groups page: look for links to group pages
        var links = document.querySelectorAll('a[href*="/groups/"]');

        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          var href = a.href || '';
          var target = extractGroupTarget(href);
          if (!target) continue;

          var groupId = target.uid;
          var name = cleanGroupName(a);
          var activityText = extractActivityText(a);
          if (!name || name.length < 2 || name.length > 200) continue;
          if (seen.has(groupId)) continue;
          seen.add(groupId);

          groups.push({
            name: name,
            uid: groupId,
            url: target.url,
            extraData: {
              source: 'facebook_groups_joined',
              lastActivityText: activityText || null
            }
          });
          continue;
        }

        return groups;
      })()
    `)

    return (results || []) as Partial<AutoAccountContact>[]
  }

  /**
   * Load managed pages through the same Graph API path used by akaBizAuto.
   */
  private async scrapePages(wc: Electron.WebContents, accountId: number): Promise<Partial<AutoAccountContact>[]> {
    this.sendProgress('Đang lấy quyền truy cập page...')
    if (this.isLoadCancelled(accountId)) return []
    let token = ''
    try {
      const tokenPromise = this.extractFacebookAccessToken(wc)
      const signal = this.activeLoadControllers.get(accountId)?.signal
      token = signal
        ? await this.raceWithCancel(accountId, tokenPromise, signal) || ''
        : await tokenPromise
    } catch (err) {
      if (this.isLoadCancelled(accountId)) return []
      throw err
    }
    if (this.isLoadCancelled(accountId)) return []
    this.sendProgress('Đang tải danh sách page qua Facebook API...')
    return this.loadPagesFromGraph(token, accountId)
  }

  private async extractFacebookAccessToken(wc: Electron.WebContents): Promise<string> {
    const token = await wc.executeJavaScript(`
      (function() {
        var body = document.body ? document.body.innerHTML : '';
        var match = body.match(/EAAG[A-Za-z0-9_-]{20,}/);
        return match ? match[0] : '';
      })()
    `)
    const value = String(token || '').trim()
    if (!value) throw new Error('Không tìm thấy user access token')
    return value
  }

  private async loadPagesFromGraph(token: string, accountId: number): Promise<Partial<AutoAccountContact>[]> {
    const pages: Partial<AutoAccountContact>[] = []
    const seen = new Set<string>()
    let nextPage = `https://graph.facebook.com/me/accounts?access_token=${encodeURIComponent(token)}`
    let pageIndex = 0
    const signal = this.activeLoadControllers.get(accountId)?.signal

    while (nextPage && pageIndex < 25) {
      if (this.isLoadCancelled(accountId)) break
      pageIndex++
      let response: Awaited<ReturnType<typeof fetch>>
      try {
        response = await fetch(nextPage, signal ? { signal } : undefined)
      } catch (err) {
        if (signal?.aborted || this.isLoadCancelled(accountId)) break
        throw err
      }
      if (!response.ok) {
        if (signal?.aborted || this.isLoadCancelled(accountId)) break
        throw new Error(`Facebook API HTTP ${response.status}`)
      }

      let json: FacebookGraphPageResponse
      try {
        json = await response.json() as FacebookGraphPageResponse
      } catch (err) {
        if (signal?.aborted || this.isLoadCancelled(accountId)) break
        throw err
      }
      if (json.error) {
        if (signal?.aborted || this.isLoadCancelled(accountId)) break
        throw new Error(String(json.error.message || 'Facebook API trả lỗi'))
      }

      for (const page of json.data || []) {
        const uid = String(page.id || '').trim()
        const name = String(page.name || '').replace(/\s+/g, ' ').trim()
        if (!uid || !name || seen.has(uid)) continue
        seen.add(uid)
        pages.push({
          name,
          uid,
          url: `https://www.facebook.com/${uid}`,
          extraData: {
            source: 'facebook_graph_me_accounts',
            category: String(page.category || '').trim() || null
          }
        })
      }

      nextPage = typeof json.paging?.next === 'string' ? json.paging.next : ''
    }

    return pages
  }

}
