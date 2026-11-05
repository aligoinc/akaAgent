import { EFFECTIVENESS_LIFETIME_WINDOWS, type EffectivenessLifetimeWindow } from '../../../../shared/campaignEffectiveness'

/**
 * "Lũy kế" window picker shared by the Thành quả banner and the Hành trình card. The report opens on 7 days;
 * a longer window reads more history only when the viewer picks it (kept until the app restarts or logs out).
 */
export function LifetimeWindowSelect({ value, onChange }: {
  value: EffectivenessLifetimeWindow
  onChange: (value: EffectivenessLifetimeWindow) => void
}) {
  return <label className="eff-window-select">
    <span>Lũy kế</span>
    <select value={value} onChange={event => onChange(event.target.value as EffectivenessLifetimeWindow)}>
      {EFFECTIVENESS_LIFETIME_WINDOWS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
    </select>
  </label>
}
