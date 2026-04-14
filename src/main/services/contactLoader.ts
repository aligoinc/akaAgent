import { BrowserWindow } from 'electron'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_CHANNELS, ContactType, FlatformContact } from '../../shared/types'

type ProgressCallback = (message: string) => void

/**
 * ContactLoader: scrapes Facebook friends list and groups list
 * from an account's embedded webview, then saves results to auto_flatform_contacts.
 */
export class ContactLoader {
  private supabase: SupabaseService
  private webviewRegistry: WebviewRegistry
  private mainWindow: BrowserWindow

  constructor(supabase: SupabaseService, webviewRegistry: WebviewRegistry, mainWindow: BrowserWindow) {
    this.supabase = supabase
    this.webviewRegistry = webviewRegistry
    this.mainWindow = mainWindow
  }

  private sendProgress(message: string): void {
    try {
      this.mainWindow.webContents.send(IPC_CHANNELS.CONTACTS_PROGRESS, { message })
    } catch {}
  }

  /**
   * Load friends list for a Facebook account.
   */
  async loadFriends(flatformAccountId: number): Promise<{ success: boolean; count: number; error?: string }> {
    return this.loadContacts(flatformAccountId, 'friend', 'https://www.facebook.com/friends/list', this.scrapeFriends.bind(this))
  }

  /**
   * Load groups list for a Facebook account.
   */
  async loadGroups(flatformAccountId: number): Promise<{ success: boolean; count: number; error?: string }> {
    return this.loadContacts(flatformAccountId, 'group', 'https://www.facebook.com/groups/joins/', this.scrapeGroups.bind(this))
  }

  private async loadContacts(
    flatformAccountId: number,
    contactType: ContactType,
    targetUrl: string,
    scrapeFn: (wc: Electron.WebContents) => Promise<Partial<FlatformContact>[]>
  ): Promise<{ success: boolean; count: number; error?: string }> {
    // Validate webview is available
    const controller = this.webviewRegistry.getController(flatformAccountId)
    if (!controller || !controller.isConnected()) {
      return { success: false, count: 0, error: 'Tab trình duyệt chưa được mở hoặc không khả dụng' }
    }

    const wcId = this.webviewRegistry.getWebContentsId(flatformAccountId)
    if (!wcId) {
      return { success: false, count: 0, error: 'Không tìm thấy webContents cho tài khoản này' }
    }

    const { webContents } = require('electron')
    const wc = webContents.fromId(wcId)
    if (!wc || wc.isDestroyed()) {
      return { success: false, count: 0, error: 'WebContents đã bị huỷ' }
    }

    const typeName = contactType === 'friend' ? 'bạn bè' : 'group'
    this.sendProgress(`🔄 Đang load danh sách ${typeName}...`)

    try {
      // Navigate to the target page
      await wc.loadURL(targetUrl)
      // Wait for page to load
      await new Promise(resolve => setTimeout(resolve, 3000))

      // Scroll and scrape
      const contacts = await scrapeFn(wc)

      if (contacts.length === 0) {
        this.sendProgress(`⚠️ Không tìm thấy ${typeName} nào. Kiểm tra tài khoản đã đăng nhập chưa.`)
        return { success: false, count: 0, error: `Không tìm thấy ${typeName} nào` }
      }

      // Add flatformAccountId and contactType to each contact
      const contactsWithMeta = contacts.map(c => ({
        ...c,
        flatformAccountId,
        contactType
      }))

      // Save to DB
      this.sendProgress(`💾 Đang lưu ${contactsWithMeta.length} ${typeName}...`)
      const saved = await this.supabase.upsertContacts(contactsWithMeta)

      this.sendProgress(`✅ Đã load ${saved} ${typeName} thành công!`)
      return { success: true, count: saved }
    } catch (err: any) {
      const errMsg = err.message || String(err)
      this.sendProgress(`❌ Lỗi load ${typeName}: ${errMsg}`)
      return { success: false, count: 0, error: errMsg }
    }
  }

  /**
   * Scroll the page multiple times to load lazy-loaded content.
   * Facebook renders the friends list inside a scrollable sidebar container,
   * NOT the main window. We must find the correct scrollable ancestor
   * of the friend cards and scroll that element.
   */
  private async scrollAndWait(wc: Electron.WebContents, maxScrolls: number = 30, delayMs: number = 1500): Promise<void> {
    let prevCount = 0
    let noChangeCount = 0

    for (let i = 0; i < maxScrolls; i++) {
      const currentCount = await wc.executeJavaScript(`
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

          // Count loaded profile/group links as progress indicator
          return document.querySelectorAll('a[href]').length;
        })()
      `)

      this.sendProgress(`📜 Đang cuộn trang... (${i + 1}/${maxScrolls}) - ${currentCount} phần tử`)
      await new Promise(resolve => setTimeout(resolve, delayMs))

      // Check if new content was loaded
      if (currentCount === prevCount) {
        noChangeCount++
        if (noChangeCount >= 3) {
          // No new content after 3 consecutive scrolls, done
          break
        }
      } else {
        noChangeCount = 0
      }
      prevCount = currentCount
    }
  }

  /**
   * Scrape friends from facebook.com/friends/list page.
   */
  private async scrapeFriends(wc: Electron.WebContents): Promise<Partial<FlatformContact>[]> {
    // Scroll to load all friends
    await this.scrollAndWait(wc, 50, 1500)

    const results = await wc.executeJavaScript(`
      (function() {
        var friends = [];
        var seen = new Set();

        // Facebook friends list: look for links that contain profile URLs
        // The friends page typically renders cards with <a> links to user profiles
        var links = document.querySelectorAll('a[href*="facebook.com/"]');

        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          var href = a.href || '';

          // Skip non-profile links
          if (href.includes('/friends') || href.includes('/groups') || href.includes('/pages') ||
              href.includes('/photo') || href.includes('/story') || href.includes('/watch') ||
              href.includes('/reel') || href.includes('/hashtag') || href.includes('/events') ||
              href.includes('/marketplace') || href.includes('/gaming') ||
              href.includes('/settings') || href.includes('/notifications') ||
              href.includes('/messages') || href.includes('/bookmarks') ||
              href.includes('?') || href.includes('#')) {
            continue;
          }

          // Must match a profile pattern: facebook.com/username or facebook.com/profile.php?id=xxx
          var profileMatch = href.match(/facebook\\.com\\/(profile\\.php\\?id=(\\d+)|([a-zA-Z0-9._]+))\\/?$/);
          if (!profileMatch) continue;

          var uid = profileMatch[2] || profileMatch[3] || '';
          if (!uid || uid === 'friends' || uid === 'groups' || uid === 'pages') continue;

          // Get the name text from the link — must extract ONLY the name,
          // not subtitles like "5 bạn chung" or "Có 7,6K người theo dõi".
          // Facebook renders each friend card with nested spans:
          //   <span>Name</span><span>subtitle</span>
          // Strategy: find the first meaningful <span> with short, clean text.
          var name = '';
          var spans = a.querySelectorAll('span');
          for (var s = 0; s < spans.length; s++) {
            var span = spans[s];
            // Skip spans that contain other spans (parent containers)
            if (span.querySelector('span')) continue;
            var txt = (span.textContent || '').trim();
            // The name span is typically 2-50 chars and does NOT contain subtitle keywords
            if (txt.length >= 2 && txt.length <= 50 &&
                !txt.match(/bạn chung/i) &&
                !txt.match(/người theo dõi/i) &&
                !txt.match(/follower/i) &&
                !txt.match(/mutual friend/i)) {
              name = txt;
              break;
            }
          }
          // Fallback: use textContent but strip known subtitle patterns
          if (!name) {
            name = (a.textContent || '').trim();
            // Remove Vietnamese subtitle patterns
            name = name.replace(/\d+\s*bạn chung.*$/i, '').trim();
            name = name.replace(/Có\s*[\d,.]+[KkMm]?\s*người theo dõi.*$/i, '').trim();
            name = name.replace(/\d+\s*mutual friend.*$/i, '').trim();
            name = name.replace(/\d+\s*follower.*$/i, '').trim();
          }
          if (!name || name.length < 2 || name.length > 100) continue;

          // Deduplicate
          if (seen.has(uid)) continue;
          seen.add(uid);

          friends.push({
            name: name,
            uid: uid,
            url: href.split('?')[0]
          });
        }

        return friends;
      })()
    `)

    return (results || []) as Partial<FlatformContact>[]
  }

  /**
   * Scrape groups from facebook.com/groups/joins/ page.
   */
  private async scrapeGroups(wc: Electron.WebContents): Promise<Partial<FlatformContact>[]> {
    // Scroll to load all groups
    await this.scrollAndWait(wc, 30, 1500)

    const results = await wc.executeJavaScript(`
      (function() {
        var groups = [];
        var seen = new Set();

        // Facebook groups page: look for links to group pages
        var links = document.querySelectorAll('a[href*="/groups/"]');

        for (var i = 0; i < links.length; i++) {
          var a = links[i];
          var href = a.href || '';

          // Must match pattern: facebook.com/groups/{groupId}/
          var groupMatch = href.match(/facebook\\.com\\/groups\\/([0-9]+)/);
          if (!groupMatch) continue;

          var groupId = groupMatch[1];
          if (!groupId) continue;

          // Get the name text
          var name = (a.textContent || '').trim();
          if (!name || name.length < 2 || name.length > 200) continue;

          // Skip navigation links like "Create group", "Discover", etc.
          if (name.includes('Tạo') || name.includes('Create') || name.includes('Khám phá') ||
              name.includes('Discover') || name.includes('Bảng tin') || name.includes('Feed')) continue;

          // Deduplicate
          if (seen.has(groupId)) continue;
          seen.add(groupId);

          groups.push({
            name: name,
            uid: groupId,
            url: 'https://www.facebook.com/groups/' + groupId
          });
        }

        return groups;
      })()
    `)

    return (results || []) as Partial<FlatformContact>[]
  }
}
