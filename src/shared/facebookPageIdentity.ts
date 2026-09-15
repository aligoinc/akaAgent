import type { CampaignExtraSettings } from './types'

export const FACEBOOK_PAGE_IDENTITY_ACTIONS = new Set([
  'facebook_join_group',
  'facebook_comment_seeding',
  'facebook_comment_seeding_post',
  'facebook_group_post',
  'facebook_find_data_group',
  'facebook_find_data_search'
])

export function supportsFacebookPageIdentity(actionId: string | null | undefined): boolean {
  return FACEBOOK_PAGE_IDENTITY_ACTIONS.has(actionId || '')
}

export function isFacebookPageIdentityEnabled(actionId: string, extra?: CampaignExtraSettings): boolean {
  return supportsFacebookPageIdentity(actionId) && extra?.runAsPage === true
}

export function validateFacebookPageIdentitySettings(
  actionId: string,
  extra: Pick<CampaignExtraSettings, 'runAsPage' | 'runAsPageUid' | 'runAsPageName'> | undefined,
  secondaryAccountId?: number | null
): void {
  if (extra?.runAsPage !== true) return
  if (!supportsFacebookPageIdentity(actionId)) throw new Error('Hành động này không hỗ trợ chạy bằng Page.')
  if (secondaryAccountId != null) throw new Error('Chạy bằng Page không sử dụng tài khoản phụ.')
  if (!String(extra.runAsPageUid || '').trim() || !String(extra.runAsPageName || '').trim()) {
    throw new Error('Vui lòng chọn Page để chạy chiến dịch.')
  }
}
