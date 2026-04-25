import type { IBrowserController } from './IBrowserController.js'

export interface ChannelHandle {
  controller: IBrowserController
  channelId: string
  release: () => Promise<void>
}

export interface ChannelHealth {
  status: 'idle' | 'busy' | 'logged_out' | 'banned' | 'maintenance'
  loginState?: string
  lastCheckedAt?: string
}

/**
 * App layer (ChannelManager) implement interface này để engine acquire/release channel.
 * Engine không quan tâm channel là Playwright hay Electron webview.
 */
export interface IChannelProvider {
  acquire(channelId: string): Promise<ChannelHandle>
  health(channelId: string): Promise<ChannelHealth>
}
