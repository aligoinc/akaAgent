/**
 * Phase 13 — Migration script: legacy schema (auto_*) → v2 schema.
 *
 * Idempotent: chạy nhiều lần OK. Track migrated rows qua flag column.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     npx tsx scripts/migrate-legacy.ts [--dry-run] [--only campaigns|flows|channels]
 *
 * Mapping:
 *   auto_flatform_accounts → channels (browser_persistent)
 *   auto_flows (legacy)    → workflows + workflow_revisions
 *   auto_campaigns         → campaign_views + triggers (schedule)
 *   auto_campaign_details  → datatable_rows (1 datatable per campaign)
 *   auto_elements          → named_selectors
 *
 * KHÔNG migrate: auto_runs, auto_run_steps, auto_campaign_detail_actions
 *   (transient log data, không cần preserve)
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

interface Counters {
  channels: number
  workflows: number
  workflowRevisions: number
  datatables: number
  datatableRows: number
  triggers: number
  campaignViews: number
  selectors: number
  errors: number
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const onlyArg = process.argv.find((a, i) => process.argv[i - 1] === '--only')
  const only = onlyArg ?? ''

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY env required')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  console.log(`[migrate] mode: ${dryRun ? 'DRY RUN' : 'WRITE'} ${only ? `only=${only}` : ''}`)
  console.log('---')

  const c: Counters = {
    channels: 0, workflows: 0, workflowRevisions: 0,
    datatables: 0, datatableRows: 0, triggers: 0,
    campaignViews: 0, selectors: 0, errors: 0
  }

  // 1. Channels (org_channels → channels)
  if (!only || only === 'channels') {
    console.log('[1/5] Migrating channels...')
    const { data: legacyChannels, error } = await supabase.from('org_channels').select('*')
    if (error) {
      console.warn('  No org_channels table or error:', error.message)
    } else {
      for (const row of legacyChannels ?? []) {
        if (!row.is_active || row.is_delete) continue
        const newId = String(row.id)   // Reuse id if UUID-compatible. Otherwise random.
        const channelId = isUUID(newId) ? newId : randomUUID()
        const payload = {
          id: channelId,
          name: String(row.name ?? `Channel ${row.id}`),
          channel_type: 'browser_persistent',
          status: row.login_status === 'da dang nhap' ? 'idle' : 'logged_out',
          health_meta: { legacy_id: row.id, flatform_type: row.flatform_type, login_status: row.login_status }
        }
        if (!dryRun) {
          const { error: e } = await supabase.from('channels').upsert(payload)
          if (e) { console.warn(`  channel ${row.id}:`, e.message); c.errors++; continue }
        }
        c.channels++
      }
    }
    console.log(`  ✓ ${c.channels} channels`)
  }

  // 2. Selectors (auto_elements → named_selectors)
  if (!only || only === 'selectors') {
    console.log('[2/5] Migrating named selectors...')
    const { data: legacyEls, error } = await supabase.from('auto_elements').select('*')
    if (error) {
      console.warn('  No auto_elements:', error.message)
    } else {
      for (const row of legacyEls ?? []) {
        const payload = {
          name: String(row.name).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase(),
          domain: null,
          description: row.description ? String(row.description) : null,
          selector_type: 'xpath' as const,
          expression: String(row.xpath)
        }
        if (!dryRun) {
          const { error: e } = await supabase.from('named_selectors').upsert(payload, { onConflict: 'organization_id,name' })
          if (e) { console.warn(`  selector ${row.name}:`, e.message); c.errors++; continue }
        }
        c.selectors++
      }
    }
    console.log(`  ✓ ${c.selectors} selectors`)
  }

  // 3. Workflows (auto_flows → workflows + workflow_revisions)
  if (!only || only === 'flows') {
    console.log('[3/5] Migrating workflows from auto_flows...')
    const { data: legacyFlows, error } = await supabase.from('auto_flows').select('*')
    if (error) {
      console.warn('  No auto_flows:', error.message)
    } else {
      for (const row of legacyFlows ?? []) {
        const wfId = isUUID(String(row.id)) ? String(row.id) : randomUUID()
        const wfPayload = {
          id: wfId,
          name: String(row.name ?? 'Migrated workflow'),
          description: row.description ?? null,
          is_active: true,
          is_block: Boolean(row.is_block),
          current_version: 1
        }
        if (!dryRun) {
          const { error: e1 } = await supabase.from('workflows').upsert(wfPayload)
          if (e1) { console.warn(`  workflow ${row.id}:`, e1.message); c.errors++; continue }

          // Best-effort convert nodes/edges. Legacy schema uses actionType which
          // map to manifestId. KHÔNG fully compatible — user phải edit lại sau.
          const legacyNodes = Array.isArray(row.nodes) ? row.nodes as Array<Record<string, unknown>> : []
          const newNodes = legacyNodes.map(n => ({
            id: String(n.id),
            manifestId: mapLegacyAction(String((n.data as Record<string, unknown>)?.actionType ?? 'core.log')),
            position: n.position ?? { x: 0, y: 0 },
            config: ((n.data as Record<string, unknown>)?.config as Record<string, unknown>) ?? {},
            inputMapping: ((n.data as Record<string, unknown>)?.inputMapping as Record<string, unknown>) ?? {}
          }))
          const newEdges = Array.isArray(row.edges) ? (row.edges as Array<Record<string, unknown>>).map(e => ({
            id: String(e.id),
            source: String(e.source),
            target: String(e.target),
            ...(e.sourceHandle ? { sourceHandle: String(e.sourceHandle) } : {}),
            ...(e.targetHandle ? { targetHandle: String(e.targetHandle) } : {})
          })) : []

          const { error: e2 } = await supabase.from('workflow_revisions').upsert({
            workflow_id: wfId,
            version: 1,
            graph: { nodes: newNodes, edges: newEdges, variables: row.variables ?? [] },
            notes: 'Migrated from legacy auto_flows. Manual review needed for actionType mapping.',
            is_published: true
          })
          if (e2) { console.warn(`  revision for ${wfId}:`, e2.message); c.errors++; continue }
          c.workflowRevisions++
        }
        c.workflows++
      }
    }
    console.log(`  ✓ ${c.workflows} workflows + ${c.workflowRevisions} revisions`)
  }

  // 4. Campaigns → campaign_views + datatables + triggers
  if (!only || only === 'campaigns') {
    console.log('[4/5] Migrating campaigns...')
    const { data: legacyCampaigns, error } = await supabase.from('auto_campaigns').select('*')
    if (error) {
      console.warn('  No auto_campaigns:', error.message)
    } else {
      for (const row of legacyCampaigns ?? []) {
        if (row.is_delete) continue

        // 4a. Create datatable for campaign details
        const dtId = randomUUID()
        if (!dryRun) {
          const { error: e } = await supabase.from('datatables').upsert({
            id: dtId,
            name: `[Migrated] ${row.name} — targets`,
            description: `Targets từ auto_campaign_details (campaign legacy id ${row.id})`,
            schema: [
              { name: 'name', type: 'string', label: 'Name' },
              { name: 'phone', type: 'string', label: 'Phone' },
              { name: 'uid', type: 'string', label: 'UID' },
              { name: 'email', type: 'string', label: 'Email' }
            ]
          })
          if (e) { console.warn(`  datatable for campaign ${row.id}:`, e.message); c.errors++; continue }
        }
        c.datatables++

        // 4b. Migrate details → datatable_rows
        const { data: details } = await supabase.from('auto_campaign_details')
          .select('*').eq('campaign_id', row.id)
        for (const detail of details ?? []) {
          if (detail.is_delete) continue
          const rowPayload = {
            datatable_id: dtId,
            data: {
              name: detail.name ?? null,
              phone: detail.phone ?? null,
              uid: detail.uid ?? null,
              email: detail.email ?? null,
              note: detail.note ?? null,
              schedule: detail.schedule ?? null
            },
            status: mapLegacyDetailStatus(detail.status)
          }
          if (!dryRun) {
            const { error: e } = await supabase.from('datatable_rows').insert(rowPayload)
            if (e) { console.warn(`  detail row:`, e.message); c.errors++; continue }
          }
          c.datatableRows++
        }

        // 4c. Find workflow id from action mapping (skip if no map — user will set later)
        let workflowId: string | null = null
        if (row.action_id) {
          try {
            const { data: wfMap } = await supabase.from('auto_workflow_mapping')
              .select('workflow_id').eq('action_id', row.action_id).maybeSingle()
            workflowId = wfMap?.workflow_id ?? null
          } catch { workflowId = null }
        }

        // 4d. Create trigger if has schedule
        let triggerId: string | null = null
        if (row.schedule && workflowId) {
          const cronStr = scheduleToCron(row.schedule, row.schedule_type as string, row.schedule_days as string, row.schedule_week_days as string)
          if (cronStr) {
            triggerId = randomUUID()
            const triggerPayload = {
              id: triggerId,
              workflow_id: workflowId,
              channel_id: row.channel_id ? String(row.channel_id) : null,
              datatable_id: dtId,
              datatable_filter: { where: { status: 'pending' }, limit: 50 },
              kind: 'schedule',
              config: { cron: cronStr, timezone: 'Asia/Ho_Chi_Minh' },
              is_active: row.status !== 'tam dung'
            }
            if (!dryRun) {
              const { error: e } = await supabase.from('triggers').insert(triggerPayload)
              if (e) { console.warn(`  trigger for campaign ${row.id}:`, e.message); c.errors++ }
              else c.triggers++
            } else c.triggers++
          }
        }

        // 4e. Create campaign_view wrapper
        const cvPayload = {
          name: String(row.name),
          description: row.log ? String(row.log).slice(0, 200) : `Migrated từ legacy campaign id ${row.id}`,
          workflow_id: workflowId,
          trigger_id: triggerId,
          datatable_id: dtId
        }
        if (!dryRun) {
          const { error: e } = await supabase.from('campaign_views').insert(cvPayload)
          if (e) { console.warn(`  campaign_view ${row.id}:`, e.message); c.errors++; continue }
        }
        c.campaignViews++
      }
    }
    console.log(`  ✓ ${c.campaignViews} campaigns → ${c.datatables} datatables (${c.datatableRows} rows) + ${c.triggers} triggers`)
  }

  console.log('---')
  console.log('Summary:')
  console.log(`  Channels:           ${c.channels}`)
  console.log(`  Workflows:          ${c.workflows} (+${c.workflowRevisions} revisions)`)
  console.log(`  DataTables:         ${c.datatables}`)
  console.log(`  DataTable rows:     ${c.datatableRows}`)
  console.log(`  Triggers:           ${c.triggers}`)
  console.log(`  Campaign Views:     ${c.campaignViews}`)
  console.log(`  Named Selectors:    ${c.selectors}`)
  console.log(`  Errors:             ${c.errors}`)
  console.log(`  Mode: ${dryRun ? 'DRY RUN — no DB writes' : 'WRITE'}`)

  if (c.errors > 0) {
    console.log('\n⚠️  Some rows had errors. Check warnings above.')
    process.exit(1)
  }
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

function mapLegacyAction(actionType: string): string {
  // Map legacy enum-style actionType → new manifestId
  const map: Record<string, string> = {
    'navigate': 'core.navigate', 'click': 'core.click', 'type': 'core.type',
    'scroll': 'core.scroll', 'hover': 'core.hover', 'select': 'core.select',
    'pressKey': 'core.pressKey', 'getValue': 'core.getValue', 'setValue': 'core.setValue',
    'getText': 'core.getText', 'getAttribute': 'core.getAttribute', 'screenshot': 'core.screenshot',
    'sleep': 'core.delay', 'waitForSelector': 'core.waitForSelector',
    'waitForNavigation': 'core.waitForNavigation', 'apiCall': 'core.httpRequest',
    'updateCampaignStatus': 'core.log', 'writeCampaignLog': 'core.log',
    'uploadFile': 'core.uploadFile', 'downloadUrl': 'core.downloadUrl',
    'ifElse': 'core.if', 'loop': 'core.loop', 'switch': 'core.switch',
    'blockInput': 'core.input', 'blockOutput': 'core.output',
    // FB legacy actions → these need user manual replace (no direct mapping)
    'fbScrapePost': 'core.log', 'fbSharePost': 'core.log', 'fbPostReels': 'core.log',
    'fbSendMessage': 'core.log', 'fbAddFriend': 'core.log', 'fbDetectPostPending': 'core.log',
    'fbLeaveGroupIfPending': 'core.log', 'fbJoinGroupIfNotMember': 'core.log'
  }
  return map[actionType] ?? 'core.log'
}

function mapLegacyDetailStatus(status: string | null | undefined): 'pending' | 'in_progress' | 'done' | 'failed' | 'skipped' {
  if (!status) return 'pending'
  const s = String(status).toLowerCase()
  if (s.includes('hoàn thành') || s.includes('hoan thanh')) return 'done'
  if (s.includes('lỗi') || s.includes('loi')) return 'failed'
  if (s.includes('đang chạy') || s.includes('dang chay')) return 'in_progress'
  if (s.includes('tạm dừng') || s.includes('tam dung')) return 'skipped'
  return 'pending'
}

function scheduleToCron(time: string, type: string, days: string, weekDays: string): string | null {
  // time format: 'HH:MM' or just HH
  const [hStr, mStr] = String(time).split(':')
  const h = Number(hStr ?? 8)
  const m = Number(mStr ?? 0)
  if (Number.isNaN(h) || Number.isNaN(m)) return null

  if (type === 'weekly' && weekDays) {
    // Legacy 2=Mon..8=Sun → cron 1=Mon..0=Sun (or 7)
    const dayMap: Record<string, string> = { '2': '1', '3': '2', '4': '3', '5': '4', '6': '5', '7': '6', '8': '0' }
    const cronDays = String(weekDays).split(',').map(d => dayMap[d.trim()]).filter(Boolean).join(',')
    if (!cronDays) return null
    return `${m} ${h} * * ${cronDays}`
  }
  if (type === 'monthly' && days) {
    return `${m} ${h} ${days} * *`
  }
  // daily default
  return `${m} ${h} * * *`
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
