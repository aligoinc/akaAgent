/** Native Messages adapter, used only for centralized form configurations. */
export function isFormAiClaude(provider: string): boolean { return provider === 'claude' || provider === 'anthropic' }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
/** Override individual output settings without losing effort when the runtime supplies format. */
export function mergeFormAiClaudeOptions(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  return { ...base, ...overrides,
    ...(record(base.output_config) && record(overrides.output_config)
      ? { output_config: { ...base.output_config, ...overrides.output_config } } : {})
  }
}
export function formAiClaudeBody(model: string, system: string, user: string, defaults: Record<string, unknown>, options: Record<string, unknown>): Record<string, unknown> {
  return { max_tokens: 16_384, ...mergeFormAiClaudeOptions(defaults, options), model, stream: false,
    system, messages: [{ role: 'user', content: user }] }
}
export function formAiClaudeText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') throw new Error('AI không trả về nội dung.')
  const response = raw as Record<string, unknown>
  if (response.stop_reason !== 'end_turn' || !Array.isArray(response.content)) throw new Error('AI chưa hoàn tất nội dung.')
  return response.content.filter(item => item && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text).join('').trim()
}
