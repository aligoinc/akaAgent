/** Shared Zalo/Email token semantics. Formatting and opt-out adapters wrap text nodes. */
export function renderCampaignTemplateText(
  template: unknown,
  inputData: Record<string, unknown> | undefined,
  target: { displayName?: string; originalName?: string; phone?: string; gender?: unknown } | null | undefined,
  businessNow: Date | undefined,
  options: { spin: (text: string) => string; phone: (...values: unknown[]) => string; afterSpin?: (text: string) => string }
): string {
    const raw = options.spin(String(template ?? ''))
    if (!raw) return ''
    const formatDate = (format: string, offsetDays = 0): string => {
      if (!businessNow) {
        throw new Error('DB runtime clock is required for relative date template tokens')
      }
      const date = new Date(businessNow.getTime() + offsetDays * 24 * 60 * 60 * 1000)
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date)
      const dateMap = Object.fromEntries(parts.map(part => [part.type, part.value])) as Record<string, string>
      return String(format || 'DD/MM/YYYY')
        .replace(/DD/g, dateMap.day || '')
        .replace(/MM/g, dateMap.month || '')
        .replace(/YYYY/g, dateMap.year || '')
        .replace(/YY/g, (dateMap.year || '').slice(-2))
    }

    const input = inputData || {}
    const getInput = (key: string): string => String(input[key] ?? '').trim()
    const renderPhone = (): string => options.phone(target?.phone, input.phone)
    const renderSex = (body: string): string => {
      const [male = '', female = '', unknown = ''] = String(body || '').split('-')
      const gender = target?.gender
      const normalized = String(gender ?? '').toLocaleLowerCase('vi-VN')
      if (gender === 0 || normalized === '0' || normalized === 'male' || normalized === 'nam') return male
      if (gender === 1 || normalized === '1' || normalized === 'female' || normalized === 'nữ' || normalized === 'nu') return female
      return unknown || male || female
    }

    const rendered = (options.afterSpin ? options.afterSpin(raw) : raw)
      .replace(/#\{(TODAY|TOMORROW|YESTERDAY)\(([^}]*)\)\}/g, (_, token, fmt) => {
        const offsetDays = token === 'TOMORROW' ? 1 : token === 'YESTERDAY' ? -1 : 0
        return formatDate(String(fmt || 'DD/MM/YYYY'), offsetDays)
      })
      .replace(/#\{SEX\{([^}]*)\}\}/g, (_, body) => renderSex(String(body || '')))
      .replace(/#\{FULL_NAME\}/g, target?.displayName || '')
      .replace(/#\{ORIGINAL_NAME\}/g, target?.originalName || '')
      .replace(/#\{INPUT_FULLNAME\}/g, getInput('name'))
      .replace(/#\{UID\}/g, getInput('uid'))
      .replace(/#\{PHONE\}/g, renderPhone())
      .replace(/#\{MOBILE\}/g, renderPhone())
      .replace(/#\{EMAIL\}/g, getInput('email'))
      .replace(/#\{INFO1\}/g, getInput('info1'))
      .replace(/#\{INFO2\}/g, getInput('info2'))
      .replace(/#\{INFO3\}/g, getInput('info3'))
      .replace(/#\{INFO4\}/g, getInput('info4'))
      .replace(/#\{INFO5\}/g, getInput('info5'))
    return rendered
}
