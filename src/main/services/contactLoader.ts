import { BrowserWindow } from 'electron'
import { SupabaseService } from './supabase'
import { WebviewRegistry } from '../playwright/webviewController'
import { IPC_EVENTS, ContactType, AutoAccountContact } from '../../shared/types'

type ProgressCallback = (message: string) => void

/**
 * ContactLoader: scrapes Facebook friends list and groups list
 * from an account's embedded webview, then saves results to auto_account_contacts.
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
      this.mainWindow.webContents.send(IPC_EVENTS.CONTACTS_PROGRESS, { message })
    } catch {}
  }

  /**
   * Load friends list for a Facebook account.
   */
  async loadFriends(accountId: number): Promise<{ success: boolean; count: number; error?: string }> {
    return this.loadContacts(accountId, 'friend', 'https://www.facebook.com/friends/list', this.scrapeFriends.bind(this))
  }

  /**
   * Load groups list for a Facebook account.
   */
  async loadGroups(accountId: number): Promise<{ success: boolean; count: number; error?: string }> {
    return this.loadContacts(accountId, 'group', 'https://www.facebook.com/groups/joins/', this.scrapeGroups.bind(this))
  }

  private async loadContacts(
    accountId: number,
    contactType: ContactType,
    targetUrl: string,
    scrapeFn: (wc: Electron.WebContents) => Promise<Partial<AutoAccountContact>[]>
  ): Promise<{ success: boolean; count: number; error?: string }> {
    // Validate webview is available
    const controller = this.webviewRegistry.getController(accountId)
    if (!controller || !controller.isConnected()) {
      return { success: false, count: 0, error: 'Tab trình duyệt chưa được mở hoặc không khả dụng' }
    }

    const wcId = this.webviewRegistry.getWebContentsId(accountId)
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

      // Add accountId and contactType to each contact
      const contactsWithMeta = contacts.map(c => ({
        ...c,
        accountId,
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
  private async scrapeFriends(wc: Electron.WebContents): Promise<Partial<AutoAccountContact>[]> {
    // Scroll to load all friends
    await this.scrollAndWait(wc, 50, 1500)

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
  private async scrapeGroups(wc: Electron.WebContents): Promise<Partial<AutoAccountContact>[]> {
    // Scroll to load all groups
    await this.scrollAndWait(wc, 30, 1500)

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
}
