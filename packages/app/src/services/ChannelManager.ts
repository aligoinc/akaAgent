import path from 'node:path'
import os from 'node:os'
import type { IChannelProvider, ChannelHandle, ChannelHealth } from '@akabiz/engine'
import { PlaywrightController, type PlaywrightControllerOptions } from '../browser/PlaywrightController.js'

/**
 * ChannelManager — implement IChannelProvider dùng Playwright.
 *
 * Phase 6: maintain Map<channelId → PlaywrightController> (warm pool).
 * Acquire returns existing controller (singleton per channel) — concurrency
 * control delegated to RunOrchestrator (per-channel mutex).
 *
 * Phase 6.5+: integrate Channel record từ DB (profile_path, user_agent,
 * proxy, ...) — hiện tại nhận options trực tiếp.
 */

export interface ChannelConfig {
  id: string
  name: string
  channelType: 'browser_persistent' | 'browser_ephemeral' | 'headless_node'
  profileBaseDir?: string
  userAgent?: string
  locale?: string
  timezoneId?: string
  proxyUrl?: string
  headless?: boolean
}

export class ChannelManager implements IChannelProvider {
  private controllers = new Map<string, PlaywrightController>()
  private configs = new Map<string, ChannelConfig>()
  private acquireQueues = new Map<string, Array<() => void>>()
  private busyChannels = new Set<string>()

  registerChannel(config: ChannelConfig): void {
    this.configs.set(config.id, config)
  }

  async acquire(channelId: string): Promise<ChannelHandle> {
    const config = this.configs.get(channelId)
    if (!config) throw new Error(`ChannelManager: channel '${channelId}' not registered`)

    // headless_node = no controller, just placeholder
    if (config.channelType === 'headless_node') {
      throw new Error(`ChannelManager: channel type 'headless_node' should not be acquired (workflow has no browser block)`)
    }

    // Per-channel concurrency=1: wait if busy
    await this.waitForChannel(channelId)
    this.busyChannels.add(channelId)

    let controller = this.controllers.get(channelId)
    if (!controller) {
      const ctrlOpts: PlaywrightControllerOptions = {
        headless: config.headless ?? false
      }
      if (config.channelType === 'browser_persistent') {
        const baseDir = config.profileBaseDir ?? path.join(os.homedir(), '.akabiz', 'profiles')
        ctrlOpts.profilePath = path.join(baseDir, channelId)
      }
      if (config.userAgent) ctrlOpts.userAgent = config.userAgent
      if (config.locale) ctrlOpts.locale = config.locale
      if (config.timezoneId) ctrlOpts.timezoneId = config.timezoneId
      if (config.proxyUrl) ctrlOpts.proxyUrl = config.proxyUrl

      controller = new PlaywrightController(ctrlOpts)
      this.controllers.set(channelId, controller)
    }
    await controller.connect()

    return {
      controller,
      channelId,
      release: async () => {
        this.busyChannels.delete(channelId)
        // Notify next waiter
        const queue = this.acquireQueues.get(channelId)
        const next = queue?.shift()
        if (next) next()
      }
    }
  }

  async health(channelId: string): Promise<ChannelHealth> {
    const config = this.configs.get(channelId)
    if (!config) return { status: 'maintenance' as const, lastCheckedAt: new Date().toISOString() }
    const ctrl = this.controllers.get(channelId)
    if (!ctrl || !ctrl.isConnected()) return { status: 'idle', lastCheckedAt: new Date().toISOString() }
    return {
      status: this.busyChannels.has(channelId) ? 'busy' : 'idle',
      lastCheckedAt: new Date().toISOString()
    }
  }

  async closeAll(): Promise<void> {
    const closes: Promise<void>[] = []
    for (const ctrl of this.controllers.values()) closes.push(ctrl.close())
    await Promise.all(closes)
    this.controllers.clear()
    this.busyChannels.clear()
    this.acquireQueues.clear()
  }

  private waitForChannel(channelId: string): Promise<void> {
    if (!this.busyChannels.has(channelId)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let queue = this.acquireQueues.get(channelId)
      if (!queue) {
        queue = []
        this.acquireQueues.set(channelId, queue)
      }
      queue.push(resolve)
    })
  }
}
