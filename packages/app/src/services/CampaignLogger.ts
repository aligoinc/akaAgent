import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProgressEvent } from '@akabiz/engine'

/**
 * CampaignLogger — write user-facing milestone log to campaign_logs table.
 * NEVER DELETE: dùng cho khách hàng xem báo cáo chiến dịch lâu dài.
 *
 * Filter: chỉ ghi step.end có reportingLabel (milestone), error events,
 * hoặc run.end với status failed.
 *
 * Format: VN + emoji theo convention cũ.
 */

interface RunContext {
  workflowId: string
  datatableRowId: string | null
  campaignViewId: string | null
  triggerId: string | null
}

const ICON_MAP: Record<string, string> = {
  'post-milestone': '📝',
  'comment-milestone': '💬',
  'reels-milestone': '🎬',
  'message-milestone': '💌',
  'friend-milestone': '🤝',
  'login-milestone': '🔐',
  'scrape-milestone': '🔍'
}

export class CampaignLogger {
  private contexts = new Map<string, RunContext>()

  constructor(private supabase: SupabaseClient) {}

  async handle(event: ProgressEvent): Promise<void> {
    try {
      if (event.kind === 'run.start') {
        const { data } = await this.supabase.from('runs')
          .select('workflow_id, datatable_row_id, trigger_id').eq('id', event.runId).single()
        if (data) {
          // Look up campaign_view via trigger
          let campaignViewId: string | null = null
          if (data.trigger_id) {
            const { data: cv } = await this.supabase.from('campaign_views').select('id')
              .eq('trigger_id', data.trigger_id).maybeSingle()
            if (cv) campaignViewId = String(cv.id)
          }
          this.contexts.set(event.runId, {
            workflowId: String(data.workflow_id),
            datatableRowId: data.datatable_row_id ? String(data.datatable_row_id) : null,
            campaignViewId,
            triggerId: data.trigger_id ? String(data.trigger_id) : null
          })
        }
        // Optional "starting" log
        const ctx = this.contexts.get(event.runId)
        if (ctx?.campaignViewId) {
          await this.write(event.runId, ctx, 'info', '▶️', 'Bắt đầu chạy', null)
        }
        return
      }

      if (event.kind === 'step.end') {
        if (!event.reportingLabel) return
        const ctx = this.contexts.get(event.runId)
        if (!ctx) return

        const tags = event.reportingTags ?? []
        const milestoneTag = tags.find(t => t.endsWith('-milestone'))
        const icon = milestoneTag ? (ICON_MAP[milestoneTag] ?? '✓') : (event.status === 'success' ? '✓' : '✗')

        if (event.status === 'success') {
          const message = `${event.reportingLabel} thành công`
          await this.write(event.runId, ctx, 'success', icon, message, this.extractMeta(event.output))
        } else if (event.status === 'error') {
          const message = `${event.reportingLabel} thất bại: ${event.error ?? 'unknown'}`
          await this.write(event.runId, ctx, 'error', '❌', message, { error: event.error })
        } else {
          // skipped
          await this.write(event.runId, ctx, 'info', '⏭', `${event.reportingLabel} bỏ qua`, null)
        }
        return
      }

      if (event.kind === 'run.end') {
        const ctx = this.contexts.get(event.runId)
        if (ctx?.campaignViewId) {
          if (event.status === 'completed') {
            await this.write(event.runId, ctx, 'success', '✅', `Hoàn thành (${event.durationMs}ms)`, null)
          } else if (event.status === 'failed') {
            await this.write(event.runId, ctx, 'error', '❌', `Thất bại (${event.durationMs}ms)`, null)
          } else if (event.status === 'cancelled') {
            await this.write(event.runId, ctx, 'warn', '⏹', 'Đã hủy', null)
          }
        }
        this.contexts.delete(event.runId)
        return
      }
    } catch (err) {
      console.warn('[CampaignLogger] write failed:', err instanceof Error ? err.message : err)
    }
  }

  private extractMeta(output: unknown): Record<string, unknown> | null {
    if (!output || typeof output !== 'object') return null
    const out = output as Record<string, unknown>
    const meta: Record<string, unknown> = {}
    // Common interesting fields
    if (out.postUrl) meta.postUrl = out.postUrl
    if (out.url) meta.url = out.url
    if (out.value) meta.value = out.value
    return Object.keys(meta).length > 0 ? meta : null
  }

  private async write(
    runId: string,
    ctx: RunContext,
    level: 'info' | 'success' | 'warn' | 'error',
    icon: string,
    message: string,
    meta: Record<string, unknown> | null
  ): Promise<void> {
    await this.supabase.from('campaign_logs').insert({
      campaign_view_id: ctx.campaignViewId,
      workflow_id: ctx.workflowId,
      run_id: runId,
      datatable_row_id: ctx.datatableRowId,
      level,
      icon,
      message,
      meta
    })
  }
}
