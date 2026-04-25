/**
 * Seed workflow JSON file → Supabase (workflows + workflow_revisions).
 *
 * Usage:
 *   npm run build -w @akabiz/app && \
 *     node packages/app/dist/cli/seed-workflow.js <path-to-workflow.json> [--id <uuid>]
 *
 * Output: prints workflow id (UUID) — use it to run-workflow.
 */

import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('Usage: seed-workflow <path-to-workflow.json> [--id <uuid>] [--name <name>]')
    process.exit(1)
  }

  const filePath = args[0]!
  let id: string | undefined
  let nameOverride: string | undefined

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--id' && args[i + 1]) { id = args[i + 1]; i++ }
    else if (args[i] === '--name' && args[i + 1]) { nameOverride = args[i + 1]; i++ }
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY env required')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } })

  const json = JSON.parse(await readFile(filePath, 'utf8')) as {
    name?: string
    description?: string
    graph: { nodes: unknown[]; edges: unknown[]; variables?: unknown[]; inputSchema?: unknown[]; outputSchema?: unknown[] }
    isBlock?: boolean
  }

  const workflowId = id ?? randomUUID()
  const name = nameOverride ?? json.name ?? 'Untitled workflow'
  const description = json.description ?? null
  const isBlock = Boolean(json.isBlock)

  // Upsert workflow
  const { error: wfErr } = await supabase.from('workflows').upsert({
    id: workflowId,
    name,
    description,
    is_active: true,
    is_block: isBlock,
    current_version: 1,
    updated_at: new Date().toISOString()
  })
  if (wfErr) {
    console.error('upsert workflow failed:', wfErr.message)
    process.exit(1)
  }

  // Insert revision v1 (overwrite if exists)
  const { error: revErr } = await supabase.from('workflow_revisions').upsert({
    workflow_id: workflowId,
    version: 1,
    graph: json.graph,
    notes: 'Seeded by seed-workflow CLI',
    is_published: true,
    created_at: new Date().toISOString()
  })
  if (revErr) {
    console.error('upsert revision failed:', revErr.message)
    process.exit(1)
  }

  console.log(`✅ Workflow seeded:`)
  console.log(`   id:      ${workflowId}`)
  console.log(`   name:    ${name}`)
  console.log(`   version: 1`)
  console.log(`\nRun it:\n   npm run run-workflow -w @akabiz/app -- ${workflowId} --input '<json>'`)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
