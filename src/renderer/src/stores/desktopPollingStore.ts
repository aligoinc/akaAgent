import { create } from 'zustand'
import { DEFAULT_DESKTOP_POLLING, parseDesktopPollSeconds, type DesktopPollingSettings } from '../../../shared/desktopUiReads'

let generation = 0
export const useDesktopPollingStore = create<{
  scope: string | null
  settings: DesktopPollingSettings
  enter(scope: string | null): void
}>((set, get) => ({
  scope: null, settings: { ...DEFAULT_DESKTOP_POLLING },
  enter(scope) {
    if (scope === get().scope) return
    const request = ++generation
    set({ scope, settings: { ...DEFAULT_DESKTOP_POLLING } })
    if (!scope) return
    void window.electronAPI.getDesktopPollingSettings().then(settings => {
      if (request !== generation) return
      set({ settings: {
        accounts: parseDesktopPollSeconds(settings.accounts),
        campaigns: parseDesktopPollSeconds(settings.campaigns)
      } })
    }).catch(() => { /* Defaults must not block the UI or trigger retries. */ })
  }
}))
