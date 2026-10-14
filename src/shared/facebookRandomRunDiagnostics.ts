import { validateFacebookRandomConfig, type FacebookRandomConfig } from './facebookRandomRun'

/** Raw configuration read with the account; never infer disabled from missing evidence. */
export interface FacebookRandomDiagnosticSettings { enabled: unknown; config: unknown }
export interface FacebookRandomConfigurationCheck {
  state: 'off' | 'missing' | 'invalid' | 'excluded' | 'included'
  enabled: boolean
  config: FacebookRandomConfig | null
  reason: string | null
}

export function checkFacebookRandomConfiguration(
  settings: FacebookRandomDiagnosticSettings | null | undefined, action: { id: string; name: string }
): FacebookRandomConfigurationCheck {
  if (!settings || typeof settings.enabled !== 'boolean' || settings.config === undefined) {
    throw new Error('Chưa đủ dữ liệu cấu hình chạy ngẫu nhiên.')
  }
  if (!settings.enabled) return { state: 'off', enabled: false, config: null, reason: null }
  if (settings.config === null) return { state: 'missing', enabled: true, config: null,
    reason: 'Tài khoản đang bật chạy ngẫu nhiên nhưng chưa có cấu hình. Vui lòng kiểm tra cài đặt chạy ngẫu nhiên.' }
  let config: FacebookRandomConfig
  try {
    const rules = (settings.config as Partial<FacebookRandomConfig>).rules
    // Validate the stored structure/units using the form's rules. Action availability
    // and permission remain the existing campaign checks, not a whole-account blocker.
    const ids = Array.isArray(rules) && rules.length <= 100
      ? rules.flatMap(rule => typeof rule?.campaignActionId === 'string' ? [rule.campaignActionId] : []) : []
    config = validateFacebookRandomConfig(settings.config, ids)
  } catch (error) {
    const detail = error instanceof Error && /^Dòng \d+:/.test(error.message)
      ? error.message : 'Thiếu hoặc sai thông tin cấu hình; cần từ 1 đến 100 loại chiến dịch.'
    return { state: 'invalid', enabled: true, config: null, reason: `Cấu hình chạy ngẫu nhiên chưa hợp lệ: ${detail}` }
  }
  const included = config.rules.some(rule => rule.campaignActionId === action.id)
  return { state: included ? 'included' : 'excluded', enabled: true, config,
    reason: included ? null : `Loại chiến dịch “${action.name}” chưa có trong cấu hình chạy ngẫu nhiên của tài khoản.` }
}
