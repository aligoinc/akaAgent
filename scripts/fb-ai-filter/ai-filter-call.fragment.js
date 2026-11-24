// AI lọc bài / comment: thử lại rồi gọi mô hình dự phòng. Câu trả lời phải là JSON có "matched" true / false, sai khuôn cũng tính là lỗi.
// Lỗi không thử lại được (hết tiền, sai khoá, thiếu cấu hình) thì chuyển ngay sang mô hình dự phòng.
const __AI_FILTER_FALLBACK_CODE = 'fb_ai_content_filter_fallback'
const __AI_FILTER_UNAVAILABLE = 'AI lọc bài tạm thời không dùng được'
async function __aiFilterCall(usingCode, payload) {
  const readText = result => {
    const value = result && (result.content ?? result.data ?? result.text ?? result.output ?? result.response)
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    try { return JSON.stringify(value) } catch (e) { return String(value) }
  }
  const usable = result => {
    if (!result || result.ok !== true) return false
    const text = readText(result).trim()
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const body = (fenced ? fenced[1] : text).trim()
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start < 0 || end <= start) return false
    try {
      const parsed = JSON.parse(body.slice(start, end + 1))
      return typeof parsed.matched === 'boolean' || typeof parsed.match === 'boolean'
    } catch (e) {
      return false
    }
  }
  const hopeless = message => /lỗi (?:400|401|402|403|404)\b|Không tìm thấy cấu hình AI|Thiếu mã cấu hình AI|no credits|insufficient|credit_balance/i.test(message)
  const abortSignal = typeof signal !== 'undefined' ? signal : undefined
  const plan = [[usingCode, 3], [__AI_FILTER_FALLBACK_CODE, 2]]
  let lastError = 'AI lỗi'
  for (const [code, tries] of plan) {
    for (let attempt = 0; attempt < tries; attempt++) {
      if (attempt > 0) await helpers.sleep(attempt === 1 ? 2000 : 5000, abortSignal)
      const result = await helpers.callAIUsing(code, payload)
      if (result && result.unsupported) return result
      if (usable(result)) return result
      lastError = result && result.ok === true ? 'AI trả lời sai khuôn' : String((result && (result.error || result.message)) || 'AI lỗi')
      if (hopeless(lastError)) break
    }
  }
  __AI_FILTER_FINAL__
}
