export interface FacebookRestBrowseSettings {
  enabled: boolean
  browseSeconds: number
  restSeconds: number
  browseTarget: boolean
  browseHome: boolean
}

export const FACEBOOK_REST_BROWSE_WORKFLOW = 'fb_campaign_rest_browse'
export const FACEBOOK_REST_BROWSE_DEFAULTS: Readonly<FacebookRestBrowseSettings> = {
  enabled: false, browseSeconds: 180, restSeconds: 60, browseTarget: true, browseHome: true
}

export function supportsFacebookRestBrowse(actionId: string): boolean {
  return ['facebook_group_post', 'facebook_comment_seeding', 'facebook_message_uid'].includes(actionId)
}

export function facebookRestBrowseSettings(value?: Partial<FacebookRestBrowseSettings> | null): FacebookRestBrowseSettings {
  return { ...FACEBOOK_REST_BROWSE_DEFAULTS, ...value }
}

export function validateFacebookRestBrowse(settings: FacebookRestBrowseSettings): string | null {
  if (settings.enabled !== true) return null
  if (!settings.browseTarget && !settings.browseHome) return 'Vui lòng chọn ít nhất một nơi lướt Facebook.'
  if (!Number.isSafeInteger(settings.browseSeconds) || settings.browseSeconds <= 0 || settings.browseSeconds > 2147483) {
    return 'Vui lòng nhập tổng thời gian lướt Facebook là số nguyên dương hợp lệ.'
  }
  if (!Number.isSafeInteger(settings.restSeconds) || settings.restSeconds < 0 ||
    (settings.browseSeconds + settings.restSeconds) * 1000 > 2147483647) {
    return 'Vui lòng nhập thời gian nghỉ là số nguyên không âm hợp lệ.'
  }
  return null
}

/** Only a target root, never an arbitrary link from the current page or notification. */
export function facebookRestBrowseTarget(actionId: string, raw: string | undefined): string | null {
  const value = (raw || '').trim()
  if (!value) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : /^([a-z]+\.)?facebook\.com\//i.test(value)
      ? `https://${value}`
      : actionId === 'facebook_group_post' && !value.startsWith('groups/') ? `https://www.facebook.com/groups/${value}` : `https://www.facebook.com/${value}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!/(^|\.)facebook\.com$/i.test(url.hostname) || url.username || url.password) return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'groups' && /^[\w.-]+$/.test(parts[1] || '')) return `https://www.facebook.com/groups/${parts[1]}/`
    if (parts[0] === 'profile.php' && /^\d+$/.test(url.searchParams.get('id') || '')) {
      return `https://www.facebook.com/profile.php?id=${url.searchParams.get('id')}`
    }
    if (parts.length === 1 && /^[\w.-]+$/.test(parts[0]) && !['login', 'checkpoint', 'notifications', 'photo.php', 'watch', 'reel', 'messages'].includes(parts[0])) {
      return `https://www.facebook.com/${parts[0]}/`
    }
    return null
  } catch { return null }
}

export function facebookRestBrowseSegments(settings: FacebookRestBrowseSettings, targetUrl: string | null) {
  const count = Number(settings.browseTarget) + Number(settings.browseHome)
  const durationMs = count ? settings.browseSeconds * 1000 / count : 0
  return [
    ...(settings.browseTarget && targetUrl ? [{ url: targetUrl, durationMs, home: false }] : []),
    ...(settings.browseHome ? [{ url: 'https://www.facebook.com/', durationMs, home: true }] : [])
  ]
}
