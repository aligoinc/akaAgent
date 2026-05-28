import type { CampaignAssistantContextSnapshot, CampaignAssistantMessage } from '../../../../shared/types'

const STORAGE_PREFIX = 'aka_agent.assistant.facebook.v1.'

export interface StoredCampaignAssistantConversation {
  messages: CampaignAssistantMessage[]
  contextSnapshot: CampaignAssistantContextSnapshot
  contextLoadedAt: string
}

const getStorageKey = (campaignId: number) => `${STORAGE_PREFIX}${campaignId}`

export function readCampaignAssistantConversation(campaignId: number): StoredCampaignAssistantConversation | null {
  try {
    const raw = window.localStorage.getItem(getStorageKey(campaignId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCampaignAssistantConversation
    if (!parsed || !Array.isArray(parsed.messages) || !parsed.contextSnapshot) return null
    return parsed
  } catch {
    return null
  }
}

export function writeCampaignAssistantConversation(campaignId: number, data: StoredCampaignAssistantConversation): void {
  try {
    window.localStorage.setItem(getStorageKey(campaignId), JSON.stringify(data))
  } catch {
    // localStorage can be full or unavailable; chat still works for the current session.
  }
}

export function clearCampaignAssistantConversation(campaignId: number): void {
  try {
    window.localStorage.removeItem(getStorageKey(campaignId))
  } catch {
    // Ignore storage cleanup failures.
  }
}
