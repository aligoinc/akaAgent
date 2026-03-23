import { chromium, BrowserContext, Page } from 'playwright'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, unlinkSync } from 'fs'

export interface ProfileInfo {
  accountId: number
  profileName: string
  connected: boolean
}

export class BrowserProfileManager {
  private contexts: Map<number, BrowserContext> = new Map()
  private pages: Map<number, Page> = new Map()
  private profileNames: Map<number, string> = new Map()
  private launching: Set<number> = new Set()

  private cleanProfileLocks(profileDir: string): void {
    const lockFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie']
    for (const lockFile of lockFiles) {
      const lockPath = join(profileDir, lockFile)
      try {
        if (existsSync(lockPath)) unlinkSync(lockPath)
      } catch {
        // Ignore errors
      }
    }
  }

  async launchProfile(accountId: number, profileName: string): Promise<void> {
    if (this.launching.has(accountId)) return
    this.launching.add(accountId)

    try {
      // Close existing context if any
      await this.closeProfile(accountId)

      // Create persistent profile directory
      const profileDir = join(app.getPath('userData'), 'browser-profiles', `account_${accountId}`)
      mkdirSync(profileDir, { recursive: true })
      this.cleanProfileLocks(profileDir)

      // Launch persistent context
      const context = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        args: ['--start-maximized', '--no-sandbox'],
        viewport: null
      })

      // Listen for context close
      context.on('close', () => {
        this.contexts.delete(accountId)
        this.pages.delete(accountId)
        this.profileNames.delete(accountId)
      })

      const page = context.pages()[0] || await context.newPage()

      this.contexts.set(accountId, context)
      this.pages.set(accountId, page)
      this.profileNames.set(accountId, profileName)
    } finally {
      this.launching.delete(accountId)
    }
  }

  async closeProfile(accountId: number): Promise<void> {
    const context = this.contexts.get(accountId)
    if (context) {
      try { await context.close() } catch {}
      this.contexts.delete(accountId)
      this.pages.delete(accountId)
      this.profileNames.delete(accountId)
    }
  }

  async closeAll(): Promise<void> {
    const accountIds = Array.from(this.contexts.keys())
    for (const id of accountIds) {
      await this.closeProfile(id)
    }
  }

  isProfileConnected(accountId: number): boolean {
    const page = this.pages.get(accountId)
    if (!page) return false
    try {
      return !page.isClosed()
    } catch {
      return false
    }
  }

  getProfilePage(accountId: number): Page | null {
    const page = this.pages.get(accountId)
    if (!page || page.isClosed()) return null
    return page
  }

  getProfileContext(accountId: number): BrowserContext | null {
    return this.contexts.get(accountId) || null
  }

  listProfiles(): ProfileInfo[] {
    const profiles: ProfileInfo[] = []
    for (const [accountId, _context] of this.contexts) {
      profiles.push({
        accountId,
        profileName: this.profileNames.get(accountId) || `account_${accountId}`,
        connected: this.isProfileConnected(accountId)
      })
    }
    return profiles
  }

  async focusProfile(accountId: number): Promise<void> {
    const page = this.pages.get(accountId)
    if (page && !page.isClosed()) {
      try {
        await page.bringToFront()
      } catch {
        // Ignore
      }
    }
  }
}
