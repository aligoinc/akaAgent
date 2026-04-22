import { chromium, BrowserContext, Page } from 'playwright'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync, unlinkSync } from 'fs'

export interface ProfileInfo {
  channelId: number
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

  async launchProfile(channelId: number, profileName: string): Promise<void> {
    if (this.launching.has(channelId)) return
    this.launching.add(channelId)

    try {
      // Close existing context if any
      await this.closeProfile(channelId)

      // Create persistent profile directory
      const profileDir = join(app.getPath('userData'), 'browser-profiles', `channel_${channelId}`)
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
        this.contexts.delete(channelId)
        this.pages.delete(channelId)
        this.profileNames.delete(channelId)
      })

      const page = context.pages()[0] || await context.newPage()

      this.contexts.set(channelId, context)
      this.pages.set(channelId, page)
      this.profileNames.set(channelId, profileName)
    } finally {
      this.launching.delete(channelId)
    }
  }

  async closeProfile(channelId: number): Promise<void> {
    const context = this.contexts.get(channelId)
    if (context) {
      try { await context.close() } catch {}
      this.contexts.delete(channelId)
      this.pages.delete(channelId)
      this.profileNames.delete(channelId)
    }
  }

  async closeAll(): Promise<void> {
    const channelIds = Array.from(this.contexts.keys())
    for (const id of channelIds) {
      await this.closeProfile(id)
    }
  }

  isProfileConnected(channelId: number): boolean {
    const page = this.pages.get(channelId)
    if (!page) return false
    try {
      return !page.isClosed()
    } catch {
      return false
    }
  }

  getProfilePage(channelId: number): Page | null {
    const page = this.pages.get(channelId)
    if (!page || page.isClosed()) return null
    return page
  }

  getProfileContext(channelId: number): BrowserContext | null {
    return this.contexts.get(channelId) || null
  }

  listProfiles(): ProfileInfo[] {
    const profiles: ProfileInfo[] = []
    for (const [channelId, _context] of this.contexts) {
      profiles.push({
        channelId,
        profileName: this.profileNames.get(channelId) || `channel_${channelId}`,
        connected: this.isProfileConnected(channelId)
      })
    }
    return profiles
  }

  async focusProfile(channelId: number): Promise<void> {
    const page = this.pages.get(channelId)
    if (page && !page.isClosed()) {
      try {
        await page.bringToFront()
      } catch {
        // Ignore
      }
    }
  }
}
