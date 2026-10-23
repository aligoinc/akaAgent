import type { CampaignExtraSettings } from './types'

export const GROUP_POST_SHARE_WORKFLOW_VERSION = 1

export function isNativeGroupPostShare(actionId: string, extra?: CampaignExtraSettings | null): boolean {
  return actionId === 'facebook_group_post' && extra?.groupPostShareFromPost === true
}

/** Native sharing accepts a particular post, never the latest item of a feed. */
export function isFacebookPostShareUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false
    if (!/(^|\.)facebook\.com$/i.test(url.hostname) && !/^(www\.)?fb\.com$/i.test(url.hostname)) return false
    return /\/(posts|videos|reel)\/[^/]+/i.test(url.pathname)
      || /^\/share\/[prv]\/[^/]+/i.test(url.pathname)
      || (/^\/(permalink|story|photo)\.php$/i.test(url.pathname)
        && Boolean(url.searchParams.get('story_fbid') || url.searchParams.get('fbid')))
  } catch { return false }
}

export function validateGroupPostShareLinks(value: string | undefined): string | null {
  const links = String(value || '').split(/[,\r\n]+/).map(link => link.trim()).filter(Boolean)
  if (!links.length) return 'Vui lòng nhập ít nhất một link bài viết để chia sẻ.'
  const invalid = links.findIndex(link => !isFacebookPostShareUrl(link))
  return invalid < 0 ? null : `Link nguồn số ${invalid + 1} phải là link bài viết Facebook cụ thể.`
}
