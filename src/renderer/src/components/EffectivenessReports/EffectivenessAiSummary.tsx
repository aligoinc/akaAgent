import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { EffectivenessAiSummary as Summary, EffectivenessQuery } from '../../../../shared/campaignEffectiveness'
import { EffectivenessError, effectivenessRequest, type EffectivenessNavigation } from './effectivenessApi'
import { suggestionNavigation } from './effectivenessPaths'

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; summary: Summary }
  | { status: 'error'; message: string }

function friendlyError(error: unknown): string {
  if (error instanceof EffectivenessError) {
    if (error.code === 'ai_not_configured' || error.code === 'effectiveness_not_ready') return 'Tóm tắt bằng AI đang được chuẩn bị. Vui lòng thử lại sau.'
    if (error.code === 'effectiveness_summary_empty') return 'Chưa có kết quả trong khoảng thời gian này để tóm tắt.'
    if (error.code === 'report_busy') return 'Hệ thống đang tổng hợp báo cáo khác. Vui lòng thử lại sau vài giây.'
    if (error.code === 'session_invalid') return error.message
  }
  return 'AI chưa tạo được tóm tắt lúc này. Vui lòng thử lại.'
}

/**
 * "Tóm tắt bằng AI": runs only when the user presses the button (never on load). Main sends aggregate numbers
 * only and keeps a summary for 10 minutes; a filter change clears this card and ignores the late result.
 */
export function EffectivenessAiSummary({ query, scopeKey, onNavigate }: {
  query: EffectivenessQuery; scopeKey: string; onNavigate(target: EffectivenessNavigation): void
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    setState({ status: 'idle' })
    return () => { controller.current?.abort(); controller.current = null }
  }, [scopeKey])

  const run = () => {
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    setState({ status: 'loading' })
    effectivenessRequest({ kind: 'aiSummary', query }, request.signal).then(summary => {
      if (controller.current === request) setState({ status: 'ready', summary })
    }).catch(error => {
      if (controller.current === request && !request.signal.aborted) setState({ status: 'error', message: friendlyError(error) })
    })
  }

  return <section className="eff-card eff-ai" aria-labelledby="eff-ai-title" aria-busy={state.status === 'loading'}>
    <div className="eff-card-toolbar">
      <h3 id="eff-ai-title"><Sparkles size={16} aria-hidden="true" /> Tóm tắt bằng AI</h3>
      <button type="button" className="btn btn-secondary btn-sm" onClick={run} disabled={state.status === 'loading'}>
        {state.status === 'ready' ? 'Tạo lại' : state.status === 'loading' ? 'Đang tóm tắt…' : 'Tạo tóm tắt'}
      </button>
    </div>
    {state.status === 'idle' && <p className="eff-muted">AI đọc số liệu của kỳ này và gợi ý việc nên làm tiếp. Chỉ dùng số liệu tổng hợp, không dùng thông tin khách hàng.</p>}
    {state.status === 'loading' && <p className="eff-muted" role="status">AI đang đọc số liệu và viết tóm tắt…</p>}
    {state.status === 'error' && <p className="eff-muted" role="alert">{state.message}</p>}
    {state.status === 'ready' && <div className="eff-ai-body" aria-live="polite">
      <strong className="eff-ai-headline">{state.summary.headline}</strong>
      {state.summary.achievements.length > 0 && <div>
        <h4>Thành tựu nổi bật</h4>
        <ul>{state.summary.achievements.map(item => <li key={item}>{item}</li>)}</ul>
      </div>}
      {state.summary.opportunities.length > 0 && <div>
        <h4>Cơ hội</h4>
        <ul>{state.summary.opportunities.map(item => <li key={item}>{item}</li>)}</ul>
      </div>}
      {state.summary.suggestions.length > 0 && <div>
        <h4>Gợi ý tiếp theo</h4>
        <ol className="eff-suggestions">{state.summary.suggestions.map(item => <li key={item.title}>
          <span>{item.title}</span>
          {item.target && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onNavigate(suggestionNavigation(item.target!))}>Thực hiện</button>}
        </li>)}</ol>
      </div>}
      <p className="eff-footnote">Tóm tắt do AI tạo từ số liệu tổng hợp của báo cáo; hãy kiểm tra lại trước khi áp dụng.</p>
    </div>}
  </section>
}
