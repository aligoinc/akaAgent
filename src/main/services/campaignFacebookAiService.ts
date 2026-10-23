import { FACEBOOK_AI_FIELDS, FACEBOOK_AI_MESSAGES, FACEBOOK_AI_SECTIONS, facebookAiHiddenFields, parseFacebookAiResponse,
  type FacebookAiRequest, type FacebookAiResult, type FacebookAiCatalog } from '../../shared/campaignFacebookAi'
import { supportsFacebookPageIdentity } from '../../shared/facebookPageIdentity'
import { canSelectAccountForCampaignAction } from '../../shared/campaignAccountActionSnapshot'
import { requireCurrentUser } from '../data/currentUser'
import { getSupabaseClient } from '../data/supabaseClient'
import { ensureCurrentUserCanUseCampaignAction, ensureCurrentUserCanUseAccountPlatform,
  canUseZaloAccountWithCapabilities, loadCurrentUserZaloAccountCapabilities } from '../data/repositories/entitlementRepository'
import { getFormAiConfig } from '../data/repositories/aiRepository'
import { callAiUsing } from './aiRuntimeService'
import { compileFormAiSchema, formAiStructuredOptions } from './formAiSchema'

/** Read account names/IDs/type via the existing HTTP client; never expose sessions or call a social platform. */
export async function loadFacebookAiCatalog(request: FacebookAiRequest, platform: string, allowMultipleAccounts: boolean, signal: AbortSignal): Promise<FacebookAiCatalog> {
  const user = requireCurrentUser(), client = getSupabaseClient()
  await ensureCurrentUserCanUseAccountPlatform(platform)
  const hasSecondaryAccount = request.secondaryAccountId !== null
  const allowPageIdentity = platform === 'facebook' && supportsFacebookPageIdentity(request.actionId)
  if (!request.eligibleAccountIds.length) return { platform, allowPageIdentity, accounts: [], pages: [], allowMultipleAccounts, hasSecondaryAccount, secondaryAccount: null }
  const { data, error } = await client.from('auto_accounts').select('id,name,flatform_type,is_zalo_show_web,is_zalo_server')
    .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false).eq('flatform_type', platform)
    .in('id', request.eligibleAccountIds).limit(501).abortSignal(signal)
  if (error || !data || data.length > 500) throw new Error(FACEBOOK_AI_MESSAGES.unavailable)
  const zaloCapabilities = platform === 'zalo' ? loadCurrentUserZaloAccountCapabilities() : null
  const authorizedAccounts = data.filter(row => canSelectAccountForCampaignAction(
    { flatformType: row.flatform_type, isZaloShowWeb: row.is_zalo_show_web === true },
    { id: request.actionId, flatformType: platform }
  ) && (platform !== 'zalo' || canUseZaloAccountWithCapabilities({
    isZaloShowWeb: row.is_zalo_show_web === true, isZaloServer: row.is_zalo_server === true
  }, zaloCapabilities))).map(row => ({ id: Number(row.id), name: String(row.name || ''), ...(platform === 'zalo'
    ? { accountType: row.is_zalo_show_web === true ? 'zalo_web' : row.is_zalo_server === true ? 'zalo_server' : 'zalo_qr' } : {}) }))
  // Keep the secondary account as read-only context; it cannot become primary
  // without the form clearing a field outside this AI's scope.
  const secondaryAccount = authorizedAccounts.find(account => account.id === request.secondaryAccountId) ?? null
  // The Zalo form clears an incompatible secondary account after a primary change.
  // Keep AI choices within the current secondary's QR/browser/server type.
  const accounts = authorizedAccounts.filter(account => account.id !== request.secondaryAccountId
    && (platform !== 'zalo' || !hasSecondaryAccount || !!secondaryAccount && account.accountType === secondaryAccount.accountType))
  const catalog: FacebookAiCatalog = { platform, allowPageIdentity, accounts, pages: [], allowMultipleAccounts, hasSecondaryAccount, secondaryAccount }
  if (accounts.length && allowPageIdentity) {
    const { data: pages, error: pageError } = await client.from('auto_account_contacts').select('account_id,uid,name')
      .eq('staff_id', user.staffId).eq('is_delete', false).eq('contact_type', 'page')
      .in('account_id', accounts.map(a => a.id)).order('id').limit(501).abortSignal(signal)
    if (pageError || !pages || pages.length > 500) throw new Error(FACEBOOK_AI_MESSAGES.unavailable)
    catalog.pages = pages.filter(p => p.uid && p.name).map(p => ({ accountId: Number(p.account_id), uid: String(p.uid), name: String(p.name) }))
  }
  return catalog
}
export async function generateCampaignFacebook(request: FacebookAiRequest, signal: AbortSignal): Promise<FacebookAiResult> {
  signal.throwIfAborted()
  const { data: action, error } = await getSupabaseClient().from('auto_campaign_actions').select('id,flatform_type,allow_multiple_accounts')
    .eq('id', request.actionId).eq('is_active', true).eq('is_delete', false).abortSignal(signal).maybeSingle()
  const platform = String(action?.flatform_type || '').trim().toLowerCase()
  if (error || !action || !platform || request.kind !== 'general' && platform !== 'facebook') throw new Error(FACEBOOK_AI_MESSAGES.unavailable)
  await ensureCurrentUserCanUseCampaignAction(request.actionId, platform)
  const section = FACEBOOK_AI_SECTIONS[request.kind]
  const config = await getFormAiConfig(section, request.actionId, signal)
  const validateContent = compileFormAiSchema(config.outputSchema, section)
  const catalog = request.kind === 'general'
    ? await loadFacebookAiCatalog(request, platform, action.allow_multiple_accounts !== false && !request.singleAccountOnly && request.secondaryAccountId === null, signal)
    : undefined
  signal.throwIfAborted()
  const result = await callAiUsing(config.using.code, {
    facebookContext: JSON.stringify({ description: request.description, actionId: request.actionId, platform, current: request.current,
      fields: FACEBOOK_AI_FIELDS[request.kind], lockedFields: [...new Set([...request.lockedFields, ...facebookAiHiddenFields(request)])], catalog }),
    bodyOverrides: formAiStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema, section)
  }, { organizationId: requireCurrentUser().organizationId }, { signal, formConfig: config, validateContent })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: FACEBOOK_AI_MESSAGES.unavailable }
  return parseFacebookAiResponse(result.content, request, catalog)
}
