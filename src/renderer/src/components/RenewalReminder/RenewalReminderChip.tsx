import { useEffect, useRef, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import {
  renewalCountdown,
  renewalCountdownLabel,
  renewalReminderTexts,
  type RenewalReminder
} from '../../../../shared/renewalReminder'
import { useRenewalReminderStore } from '../../stores/renewalReminderStore'
import { RENEWAL_LEVEL_ICONS, formatCountdownPart, renewalShowsCountdown, renewalToneClass, useRenewalNow } from './renewalReminderUi'

/** Nhãn nhỏ trên thanh trên cùng: "Còn N ngày"/"Dùng thử còn …" + nút Gia hạn/Nâng cấp; sau khi thanh toán là nhãn xanh. */
export default function RenewalReminderChip() {
  const state = useRenewalReminderStore(store => store.state)
  const successUntil = useRenewalReminderStore(store => store.successUntil)
  const openWindow = useRenewalReminderStore(store => store.openWindow)
  const reminder = state?.enabled ? state.reminder : null
  const now = useRenewalNow(!!reminder && renewalShowsCountdown(reminder))
  const [, setSuccessTick] = useState(0)
  const [popoverOpen, setPopoverOpen] = useState(false)

  useEffect(() => {
    const remaining = successUntil - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setSuccessTick(value => value + 1), remaining + 50)
    return () => window.clearTimeout(timer)
  }, [successUntil])

  useEffect(() => { if (!reminder || reminder.kind !== 'trial') setPopoverOpen(false) }, [reminder])

  if (!reminder || !state?.today) {
    if (successUntil <= Date.now()) return null
    return (
      <div className="renewal-reminder-chip renewal-reminder-chip-success" role="status">
        <CheckCircle2 size={14} aria-hidden="true" />
        <span>Đã gia hạn thành công.</span>
      </div>
    )
  }

  const texts = renewalReminderTexts(reminder, state.today)
  const countdownLabel = renewalShowsCountdown(reminder) ? renewalCountdownLabel(renewalCountdown(reminder.expiresAtMs, now)) : null
  const Icon = RENEWAL_LEVEL_ICONS[reminder.level]
  const trial = reminder.kind === 'trial'
  const label = (
    <>
      <Icon size={14} aria-hidden="true" />
      <span>{texts.chip}</span>
      {countdownLabel && <span className="renewal-reminder-chip-countdown">{countdownLabel}</span>}
    </>
  )

  return (
    <div className={`renewal-reminder-chip ${renewalToneClass(reminder.level)}`}>
      {trial ? (
        <button type="button" className="renewal-reminder-chip-label" aria-expanded={popoverOpen}
          onClick={() => setPopoverOpen(open => !open)} title="Xem thời gian dùng thử">
          {label}
        </button>
      ) : (
        <button type="button" className="renewal-reminder-chip-label" onClick={openWindow} title={texts.title}>{label}</button>
      )}
      <button type="button" className="renewal-reminder-chip-action" onClick={() => { setPopoverOpen(false); openWindow() }}>
        {texts.button}
      </button>
      {trial && popoverOpen && (
        <TrialPopover reminder={reminder} now={now} message={texts.message} title={texts.title} button={texts.button}
          onUpgrade={() => { setPopoverOpen(false); openWindow() }} onClose={() => setPopoverOpen(false)} />
      )}
    </div>
  )
}

interface TrialPopoverProps {
  reminder: RenewalReminder
  now: number
  title: string
  message: string
  button: string
  onUpgrade: () => void
  onClose: () => void
}

function TrialPopover({ reminder, now, title, message, button, onUpgrade, onClose }: TrialPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const chip = ref.current?.parentElement
      if (chip && event.target instanceof Node && !chip.contains(event.target)) onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const countdown = renewalCountdown(reminder.expiresAtMs, now)
  const parts = countdown.days > 0
    ? [[String(countdown.days), 'ngày'], [formatCountdownPart(countdown.hours), 'giờ'], [formatCountdownPart(countdown.minutes), 'phút']]
    : [[formatCountdownPart(countdown.hours), 'giờ'], [formatCountdownPart(countdown.minutes), 'phút'], [formatCountdownPart(countdown.seconds), 'giây']]
  const total = Math.max(1, Math.min(14, reminder.product.durationDays ?? 3))
  const currentDay = Math.max(1, Math.min(total, total - reminder.daysLeft))

  return (
    <div ref={ref} className="renewal-reminder-popover" role="dialog" aria-labelledby="renewal-trial-title">
      <h2 id="renewal-trial-title">{title}</h2>
      <div className="renewal-reminder-countdown" role="timer" aria-live="off">
        {parts.map(([value, unit]) => (
          <div key={unit} className="renewal-reminder-countdown-cell"><strong>{value}</strong><span>{unit}</span></div>
        ))}
      </div>
      <div className="renewal-reminder-trial-days" role="img" aria-label={`Ngày dùng thử thứ ${currentDay} trên ${total}`}>
        <div className="renewal-reminder-trial-bars">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={index < currentDay ? 'is-used' : ''} />
          ))}
        </div>
        {total <= 7 && (
          <div className="renewal-reminder-trial-labels">
            {Array.from({ length: total }, (_, index) => <span key={index}>Ngày {index + 1}</span>)}
          </div>
        )}
      </div>
      <p>{message}</p>
      <button type="button" className="renewal-reminder-primary" onClick={onUpgrade}>{button}</button>
    </div>
  )
}
