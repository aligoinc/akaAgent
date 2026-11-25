import { EMAIL_PROMPT_TEXTS } from '../../../../shared/emailPrompt'
import { useEmailPromptStore } from '../../stores/emailPromptStore'
import './emailPrompt.css'

/** Nhãn nhỏ "Thêm email" trên thanh trên cùng khi tài khoản chưa có email và form đang đóng. Bấm thì mở lại form. */
export default function EmailPromptChip() {
  const visible = useEmailPromptStore(store => store.state?.enabled === true && store.state.chip && !store.open)
  const openFromChip = useEmailPromptStore(store => store.openFromChip)
  if (!visible) return null
  return (
    <button type="button" className="email-prompt-chip" onClick={openFromChip} title="Thêm email cho tài khoản">
      <span className="email-prompt-chip-dot" aria-hidden="true" />
      <span>{EMAIL_PROMPT_TEXTS.chip}</span>
    </button>
  )
}
