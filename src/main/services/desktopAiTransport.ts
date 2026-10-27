import type { AiUsingConfig } from '../../shared/aiTypes'
import { desktopSession } from '../data/supabaseClient'

const AI_API_URL = process.env.AKA_AGENT_AI_API_URL || 'https://agent.akabiz.net/api/aka-agent/desktop/v1/ai'

/** One request, no retry and no direct-provider fallback after an uncertain result. */
export async function fetchDesktopAi(config: AiUsingConfig, body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
  const token = await desktopSession.token(signal)
  signal.throwIfAborted()
  const response = await fetch(AI_API_URL, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      usingCode: config.using.code,
      ...(config.formConfigId ? { formConfigId: config.formConfigId } : { usingId: config.using.id }),
      modelId: config.model.id, body
    })
  })
  if (response.headers.get('x-aka-ai-provider-response') !== '1') {
    await response.body?.cancel()
    throw new TypeError('fetch failed')
  }
  return response
}
