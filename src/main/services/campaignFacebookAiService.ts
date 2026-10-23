import { FACEBOOK_AI_FIELDS, FACEBOOK_AI_MESSAGES, FACEBOOK_AI_SECTIONS, facebookAiHiddenFields, parseFacebookAiResponse,
  type FacebookAiRequest, type FacebookAiResult, type FacebookAiCatalog } from '../../shared/campaignFacebookAi'
import { supportsFacebookPageIdentity } from '../../shared/facebookPageIdentity'
import { requireCurrentUser } from '../data/currentUser'
import { getSupabaseClient } from '../data/supabaseClient'
import { ensureCurrentUserCanUseCampaignAction, ensureCurrentUserCanUseAccountPlatform } from '../data/repositories/entitlementRepository'
import { getFormAiConfig } from '../data/repositories/aiRepository'
import { callAiUsing } from './aiRuntimeService'
import { compileFormAiSchema, formAiStructuredOptions } from './formAiSchema'

/** Read only names/IDs from the existing HTTP client; never expose sessions or fetch Facebook. */
export async function loadFacebookAiCatalog(request: FacebookAiRequest, allowMultipleAccounts: boolean, signal: AbortSignal): Promise<FacebookAiCatalog> {
  const user = requireCurrentUser(), client = getSupabaseClient()
  await ensureCurrentUserCanUseAccountPlatform('facebook')
  const hasSecondaryAccount = request.secondaryAccountId !== null
  if (!request.eligibleAccountIds.length) return { accounts: [], pages: [], allowMultipleAccounts, hasSecondaryAccount, secondaryAccount: null }
  const { data, error } = await client.from('auto_accounts').select('id,name')
    .eq('staff_id', user.staffId).eq('organization_id', user.organizationId).eq('is_delete', false).eq('flatform_type', 'facebook')
    .in('id', request.eligibleAccountIds).limit(501).abortSignal(signal)
  if (error || !data || data.length > 500) throw new Error(FACEBOOK_AI_MESSAGES.unavailable)
  const authorizedAccounts = data.map(row => ({ id: Number(row.id), name: String(row.name || '') }))
  // Keep the secondary account as read-only context; it cannot become primary
  // without the form clearing a field outside this AI's scope.
  const accounts = authorizedAccounts.filter(account => account.id !== request.secondaryAccountId)
  const catalog: FacebookAiCatalog = { accounts, pages: [], allowMultipleAccounts, hasSecondaryAccount,
    secondaryAccount: authorizedAccounts.find(account => account.id === request.secondaryAccountId) ?? null }
  if (accounts.length && supportsFacebookPageIdentity(request.actionId)) {
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
  await ensureCurrentUserCanUseCampaignAction(request.actionId, 'facebook')
  const section = FACEBOOK_AI_SECTIONS[request.kind]
  const config = await getFormAiConfig(section, request.actionId, signal)
  const validateContent = compileFormAiSchema(config.outputSchema, section)
  const { data: action, error } = await getSupabaseClient().from('auto_campaign_actions').select('id,allow_multiple_accounts')
    .eq('id', request.actionId).eq('flatform_type', 'facebook').eq('is_active', true).eq('is_delete', false).abortSignal(signal).maybeSingle()
  if (error || !action) throw new Error(FACEBOOK_AI_MESSAGES.unavailable)
  const catalog = request.kind === 'general'
    ? await loadFacebookAiCatalog(request, action.allow_multiple_accounts !== false && !request.singleAccountOnly && request.secondaryAccountId === null, signal)
    : undefined
  signal.throwIfAborted()
  const result = await callAiUsing(config.using.code, {
    facebookContext: JSON.stringify({ description: request.description, actionId: request.actionId, current: request.current,
      fields: FACEBOOK_AI_FIELDS[request.kind], lockedFields: [...new Set([...request.lockedFields, ...facebookAiHiddenFields(request)])], catalog }),
    bodyOverrides: formAiStructuredOptions(config.model.provider, config.model.endpoint, config.outputSchema, section)
  }, { organizationId: requireCurrentUser().organizationId }, { signal, formConfig: config, validateContent })
  signal.throwIfAborted()
  if (!result.ok) return { ok: false, code: 'unavailable', message: FACEBOOK_AI_MESSAGES.unavailable }
  return parseFacebookAiResponse(result.content, request, catalog)
}
