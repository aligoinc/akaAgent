import { renderContentSpinMax } from './contentSpin'

/** Same contract as akaAgentWebApp campaign-core `voiceCall.ts`; the campaign forms keep their own copies of these constants. */
export const VOICE_CALL_AI_DISCLOSURE = 'Đây là cuộc gọi tự động sử dụng giọng nói AI.'
export const VOICE_CALL_MAX_TTS_INPUT_CHARS = 4096

export function getVoiceCallContentValidationError(content: string): string | null {
  const length = `${VOICE_CALL_AI_DISCLOSURE} ${renderContentSpinMax(content)}`.trim().length
  return length > VOICE_CALL_MAX_TTS_INPUT_CHARS
    ? `Nội dung cuộc gọi sau khi thêm thông báo giọng nói AI không được vượt quá ${VOICE_CALL_MAX_TTS_INPUT_CHARS.toLocaleString('vi-VN')} ký tự.`
    : null
}
