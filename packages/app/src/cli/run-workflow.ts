/**
 * CLI runner — execute 1 workflow run từ command line.
 *
 * Usage:
 *   npm run run-workflow -w @akabiz/app -- <workflow-id> [--input '<json>'] [--channel <id>]
 *
 * Example (workflow standalone, không cần channel):
 *   npm run run-workflow -w @akabiz/app -- wf_abc --input '{"x":42}'
 *
 * Example (workflow cần browser):
 *   npm run run-workflow -w @akabiz/app -- wf_fb_post --channel ch_main \
 *     --input '{"groupUrl":"https://facebook.com/groups/123","content":"Hello"}'
 *
 * Required env:
 *   SUPABASE_URL=https://...
 *   SUPABASE_SERVICE_KEY=...
 *   CONN_VAULT_KEY=<min 16 chars>
 */

import { bootstrap } from '../bootstrap.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: run-workflow <workflow-id> [--input <json>] [--channel <id>] [--version <n>]')
    process.exit(1)
  }

  const workflowId = args[0]!
  let input: Record<string, unknown> = {}
  let channelId: string | undefined
  let version: number | undefined

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
      input = JSON.parse(args[i + 1]!)
      i++
    } else if (args[i] === '--channel' && args[i + 1]) {
      channelId = args[i + 1]!
      i++
    } else if (args[i] === '--version' && args[i + 1]) {
      version = Number(args[i + 1]!)
      i++
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  const vaultKey = process.env.CONN_VAULT_KEY ?? 'dev-vault-key-change-me-1234'

  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY env vars required')
    process.exit(1)
  }

  console.log(`[CLI] Bootstrapping app...`)
  const ctx = await bootstrap({ supabaseUrl, supabaseKey, vaultKey })

  // If channel needed, fetch from DB and register
  if (channelId) {
    const { data: channel, error } = await ctx.supabase.from('channels').select('*').eq('id', channelId).single()
    if (error || !channel) {
      console.error(`Channel '${channelId}' not found in DB`)
      await ctx.shutdown()
      process.exit(1)
    }
    ctx.channelManager.registerChannel({
      id: String(channel.id),
      name: String(channel.name),
      channelType: channel.channel_type as 'browser_persistent' | 'browser_ephemeral' | 'headless_node',
      ...(channel.profile_path ? { profileBaseDir: String(channel.profile_path) } : {}),
      ...(channel.user_agent ? { userAgent: String(channel.user_agent) } : {}),
      ...(channel.locale ? { locale: String(channel.locale) } : {}),
      ...(channel.timezone ? { timezoneId: String(channel.timezone) } : {}),
      ...(channel.proxy_url ? { proxyUrl: String(channel.proxy_url) } : {}),
      headless: false
    })
    console.log(`[CLI] Channel '${channelId}' registered (${channel.channel_type})`)
  }

  // Listen for progress events
  ctx.engine.on('progress', (event) => {
    if (event.kind === 'log') {
      const prefix = event.level === 'error' ? '❌' : event.level === 'warn' ? '⚠️' : 'ℹ️'
      console.log(`  ${prefix} [${event.nodeId ?? 'engine'}] ${event.message}`)
    } else if (event.kind === 'step.start') {
      console.log(`  ▶ ${event.nodeId} (${event.manifestId})`)
    } else if (event.kind === 'step.end') {
      const icon = event.status === 'success' ? '✅' : event.status === 'skipped' ? '⏭' : '❌'
      console.log(`  ${icon} ${event.nodeId} ${event.durationMs}ms`)
    } else if (event.kind === 'run.end') {
      console.log(`\n[CLI] Run finished: ${event.status} (${event.durationMs}ms)`)
    }
  })

  console.log(`[CLI] Running workflow '${workflowId}'...\n`)
  try {
    const enqueueArgs: { workflowId: string; input: Record<string, unknown>; channelId?: string; workflowVersion?: number } = { workflowId, input }
    if (channelId) enqueueArgs.channelId = channelId
    if (typeof version === 'number') enqueueArgs.workflowVersion = version
    const result = await ctx.engine.enqueue(enqueueArgs)
    console.log('\n[CLI] Result:', JSON.stringify(result, null, 2))
    process.exitCode = result.status === 'completed' ? 0 : 1
  } catch (err) {
    console.error('\n[CLI] Error:', err instanceof Error ? err.message : err)
    process.exitCode = 1
  } finally {
    await ctx.shutdown()
  }
}

main().catch(err => {
  console.error('[CLI] Fatal:', err)
  process.exit(1)
})
