import type { EffectivenessSuggestion } from '../../../../shared/campaignEffectiveness'
import type { EffectivenessNavigation } from './effectivenessApi'

/** Where a positive suggestion's action button leads on Desktop (campaign creation lives on the campaign page). */
export function suggestionNavigation(target: EffectivenessSuggestion['target']): EffectivenessNavigation {
  if (target === 'phone_check') return { kind: 'dataScan' }
  return { kind: 'campaigns' }
}
