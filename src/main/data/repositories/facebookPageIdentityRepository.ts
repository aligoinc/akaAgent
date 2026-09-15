import type { Campaign } from '../../../shared/types'
import { validateFacebookPageIdentitySettings } from '../../../shared/facebookPageIdentity'
import { listContacts } from './accountContactRepository'

export async function validateCampaignPageIdentity(
  campaign: Pick<Campaign, 'actionId' | 'accountId' | 'secondaryAccountId' | 'extraSettings'>
): Promise<void> {
  validateFacebookPageIdentitySettings(campaign.actionId, campaign.extraSettings, campaign.secondaryAccountId)
  if (campaign.extraSettings?.runAsPage !== true) return
  const pages = await listContacts(campaign.accountId, 'page')
  const extra = campaign.extraSettings
  if (!pages.some(page => !page.isDelete && page.uid === extra.runAsPageUid && page.name === extra.runAsPageName)) {
    throw new Error('Page đã chọn không còn trong danh sách của tài khoản. Vui lòng tải lại và chọn Page.')
  }
}
