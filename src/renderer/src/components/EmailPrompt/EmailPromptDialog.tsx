import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ChartLine, KeyRound, Lock, Mail, MonitorDown, UserCheck, X } from 'lucide-react'
import {
  EMAIL_PROMPT_BENEFITS,
  EMAIL_PROMPT_TEXTS,
  emailPromptSavedMessage,
  emailPromptSubtitle,
  emailPromptTypoQuestion,
  emailQuickCompletions,
  isValidEmail,
  normalizeEmail,
  suggestEmailFix
} from '../../../../shared/emailPrompt'
import { useEmailPromptStore } from '../../stores/emailPromptStore'
import './emailPrompt.css'

const BENEFIT_ICONS: Record<string, typeof KeyRound> = {
  recover: KeyRound,
  installer: MonitorDown,
  account: UserCheck,
  report: ChartLine
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'

/** In đậm một đoạn (tên đăng nhập, email) trong câu chữ dùng chung, không tự viết lại câu. */
function withBold(text: string, part: string | null): ReactNode {
  if (!part) return text
  const index = text.indexOf(part)
  if (index < 0) return text
  return <>{text.slice(0, index)}<strong>{part}</strong>{text.slice(index + part.length)}</>
}

/**
 * Hộp thoại xin email: màn nhập / màn xác nhận / màn Đã lưu. Chỉ đóng bằng nút × nhỏ góc phải (bấm ra ngoài và Esc
 * không đóng). Kiểm email ở giao diện chỉ để gợi ý; DB kiểm lại khi lưu.
 */
export default function EmailPromptDialog() {
  const state = useEmailPromptStore(store => store.state)
  const mode = useEmailPromptStore(store => store.mode)
  const screen = useEmailPromptStore(store => store.screen)
  const saved = useEmailPromptStore(store => store.saved)
  const currentEmail = useEmailPromptStore(store => store.currentEmail)
  const close = useEmailPromptStore(store => store.close)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  // Giữ phím Tab trong hộp thoại; Esc không đóng và không đi tiếp xuống hộp thoại bên dưới.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }

  const labelId = screen === 'saved' ? 'email-prompt-saved-title' : screen === 'confirm' ? 'email-prompt-confirm-title' : 'email-prompt-title'

  return (
    <div className="email-prompt-overlay" data-email-prompt="overlay">
      <div ref={dialogRef} className="email-prompt-dialog" role="dialog" aria-modal="true" aria-labelledby={labelId}
        data-screen={screen} onKeyDown={onKeyDown}>
        <button type="button" className="email-prompt-close" onClick={close}
          aria-label={EMAIL_PROMPT_TEXTS.close} title={EMAIL_PROMPT_TEXTS.close}>
          <X size={11} strokeWidth={2.6} aria-hidden="true" />
        </button>
        {screen === 'saved' && saved
          ? <SavedScreen email={saved.email} verified={saved.verified} onDone={close} />
          : screen === 'confirm' && state?.email
            ? <ConfirmScreen username={state.username} email={state.email} />
            : <EnterScreen username={state?.username ?? null} changeMode={mode === 'change'} currentEmail={currentEmail} />}
      </div>
    </div>
  )
}

function HeroIcon() {
  return (
    <div className="email-prompt-hero-icon" aria-hidden="true">
      <Mail size={28} strokeWidth={1.8} />
      <span className="email-prompt-hero-badge"><span><KeyRound size={12} strokeWidth={2.6} /></span></span>
    </div>
  )
}

function EnterScreen({ username, changeMode, currentEmail }: { username: string | null; changeMode: boolean; currentEmail: string | null }) {
  const save = useEmailPromptStore(store => store.save)
  const [value, setValue] = useState('')
  const [keepTypo, setKeepTypo] = useState(false)
  const [serverSuggestion, setServerSuggestion] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const email = normalizeEmail(value)
  const localSuggestion = keepTypo ? null : suggestEmailFix(email)
  const suggestion = localSuggestion ?? (keepTypo ? null : serverSuggestion)
  const valid = isValidEmail(email)
  const completions = suggestion ? [] : emailQuickCompletions(email)
  const canSave = valid && !suggestion && !busy

  const change = (next: string) => {
    setValue(next)
    setKeepTypo(false)
    setServerSuggestion(null)
    setTouched(false)
    setError(null)
  }

  const submit = async () => {
    if (busy) return
    if (suggestion) return // Lưu chờ khách chọn Sửa giúp / Giữ nguyên.
    if (!valid) { setTouched(true); return }
    setBusy(true)
    setError(null)
    const result = await save({ email, ...(keepTypo ? { allowTypo: true } : {}) })
    setBusy(false)
    if (result.ok) return
    if (result.code === 'email_typo' && result.suggestion) { setServerSuggestion(result.suggestion); return }
    if (result.code === 'email_invalid') { setTouched(true); return }
    setError(result.message)
  }

  return (
    <div className="email-prompt-body">
      <div className="email-prompt-heading">
        <HeroIcon />
        <span className="email-prompt-eyebrow">{EMAIL_PROMPT_TEXTS.eyebrow}</span>
        <h2 id="email-prompt-title">{changeMode ? 'Đổi email tài khoản' : EMAIL_PROMPT_TEXTS.title}</h2>
        <p>
          {changeMode
            ? (currentEmail ? withBold(`Email đang lưu: ${currentEmail}. Email mới sẽ thay email này.`, currentEmail) : 'Tài khoản của bạn chưa có email.')
            : withBold(emailPromptSubtitle(username), username)}
        </p>
      </div>

      {!changeMode && (
        <ul className="email-prompt-benefits">
          {EMAIL_PROMPT_BENEFITS.map(item => {
            const Icon = BENEFIT_ICONS[item.key] ?? Check
            return (
              <li key={item.key}>
                <span className="email-prompt-benefit-icon" aria-hidden="true"><Icon size={15} /></span>
                <span className="email-prompt-benefit-copy"><strong>{item.title}</strong><span>{item.detail}</span></span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="email-prompt-field">
        <label htmlFor="email-prompt-input">{EMAIL_PROMPT_TEXTS.inputLabel}</label>
        <div className="email-prompt-input-box">
          <Mail size={17} aria-hidden="true" />
          <input ref={inputRef} id="email-prompt-input" type="email" inputMode="email" autoComplete="email"
            placeholder={EMAIL_PROMPT_TEXTS.inputPlaceholder} value={value} maxLength={254}
            aria-invalid={touched && !valid ? true : undefined}
            onChange={event => change(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void submit() } }} />
        </div>

        {completions.length > 0 && (
          <div className="email-prompt-completions">
            {completions.map(item => (
              <button key={item} type="button" className="email-prompt-completion"
                onClick={() => { change(item); inputRef.current?.focus() }}>
                {item.slice(item.indexOf('@'))}
              </button>
            ))}
          </div>
        )}

        {suggestion && (
          <div className="email-prompt-typo" role="status">
            <span>{withBold(emailPromptTypoQuestion(suggestion), suggestion)}</span>
            <button type="button" className="email-prompt-typo-fix" onClick={() => { change(suggestion); inputRef.current?.focus() }}>
              {EMAIL_PROMPT_TEXTS.fixTypo}
            </button>
            <button type="button" className="email-prompt-typo-keep" onClick={() => { setKeepTypo(true); inputRef.current?.focus() }}>
              {EMAIL_PROMPT_TEXTS.keepTypo}
            </button>
          </div>
        )}

        {touched && !valid && !suggestion && (
          <span className="email-prompt-error" role="alert">Email chưa đúng, ví dụ: ten@gmail.com</span>
        )}
        {error && <span className="email-prompt-error" role="alert">{error}</span>}
      </div>

      <div className="email-prompt-actions">
        <button type="button" className="email-prompt-primary" data-ready={canSave ? 'true' : 'false'} onClick={() => void submit()} disabled={busy}>
          {busy ? 'Đang lưu…' : EMAIL_PROMPT_TEXTS.save}
          {!busy && <ArrowRight size={16} strokeWidth={2.2} aria-hidden="true" />}
        </button>
        <p className="email-prompt-trust">
          <Lock size={13} aria-hidden="true" />
          <span>{EMAIL_PROMPT_TEXTS.trust}</span>
        </p>
      </div>
    </div>
  )
}

function ConfirmScreen({ username, email }: { username: string | null; email: string }) {
  const save = useEmailPromptStore(store => store.save)
  const showEnter = useEmailPromptStore(store => store.showEnter)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await save({ confirm: true })
    setBusy(false)
    if (!result.ok) setError(result.message)
  }

  return (
    <div className="email-prompt-body">
      <div className="email-prompt-heading">
        <div className="email-prompt-hero-icon" aria-hidden="true"><Mail size={28} strokeWidth={1.8} /></div>
        <span className="email-prompt-eyebrow">{EMAIL_PROMPT_TEXTS.eyebrow}</span>
        <h2 id="email-prompt-confirm-title">{EMAIL_PROMPT_TEXTS.confirmTitle}</h2>
        <p>
          {username
            ? <>Thông tin tài khoản <strong>{username}</strong> sẽ gửi về email dưới đây. Bấm xác nhận là xong.</>
            : 'Thông tin tài khoản sẽ gửi về email dưới đây. Bấm xác nhận là xong.'}
        </p>
      </div>
      <div className="email-prompt-confirm-card">
        <span className="email-prompt-confirm-icon" aria-hidden="true"><Mail size={18} /></span>
        <span className="email-prompt-confirm-copy">
          <strong>{email}</strong>
          <span>Email đang lưu trong tài khoản của bạn</span>
        </span>
      </div>
      <ul className="email-prompt-checklist">
        {EMAIL_PROMPT_BENEFITS.map(item => (
          <li key={item.key}><Check size={14} strokeWidth={2.6} aria-hidden="true" /><span>{item.title}</span></li>
        ))}
      </ul>
      {error && <span className="email-prompt-error" role="alert">{error}</span>}
      <div className="email-prompt-actions">
        <button type="button" className="email-prompt-primary" data-ready="true" onClick={() => void confirm()} disabled={busy} autoFocus>
          {!busy && <Check size={16} strokeWidth={2.6} aria-hidden="true" />}
          {busy ? 'Đang lưu…' : EMAIL_PROMPT_TEXTS.confirm}
        </button>
        <button type="button" className="email-prompt-secondary" onClick={showEnter} disabled={busy}>{EMAIL_PROMPT_TEXTS.changeEmail}</button>
      </div>
    </div>
  )
}

const MAIL_CONTENTS = [
  { key: 'account', Icon: UserCheck, text: 'Tên đăng nhập, gói đang dùng và hạn sử dụng' },
  { key: 'installer', Icon: MonitorDown, text: 'Link tải bản cài Windows, macOS và link đăng nhập Web' },
  { key: 'recover', Icon: KeyRound, text: 'Link Lấy lại tài khoản, dùng khi quên mật khẩu' }
] as const

function SavedScreen({ email, verified, onDone }: { email: string; verified: boolean; onDone: () => void }) {
  return (
    <div className="email-prompt-body email-prompt-saved">
      <span className="email-prompt-saved-icon" aria-hidden="true"><Check size={32} strokeWidth={2.6} /></span>
      <h2 id="email-prompt-saved-title">{EMAIL_PROMPT_TEXTS.savedTitle}</h2>
      <p>{withBold(emailPromptSavedMessage(email, verified), email)}</p>
      <div className="email-prompt-mail-contents">
        <span className="email-prompt-mail-contents-title">TRONG THƯ CÓ</span>
        {MAIL_CONTENTS.map(({ key, Icon, text }) => (
          <div key={key}><Icon size={15} aria-hidden="true" /><span>{text}</span></div>
        ))}
      </div>
      <button type="button" className="email-prompt-primary" data-ready="true" onClick={onDone} autoFocus>{EMAIL_PROMPT_TEXTS.savedNext}</button>
      <span className="email-prompt-footnote">{EMAIL_PROMPT_TEXTS.savedFootnote}</span>
    </div>
  )
}
