import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { GoogleSheetError, mapGoogleSheet, readGoogleSheet, type GoogleSheetConfig } from '../../../src/shared/googleSheetSync.ts'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
// Custom internal authentication, same Vault-backed mechanism as the existing
// email worker. Never accept tenant IDs, source IDs, URLs or credentials here.
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const expected = Deno.env.get('INTERNAL_EDGE_FUNCTION_TOKEN')?.trim()
  const received = req.headers.get('x-internal-token') || ''
  if (!expected || !received || received.length !== expected.length) return json(401, { error: 'Unauthorized' })
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  if (difference) return json(401, { error: 'Unauthorized' })
  let token: string
  try {
    if (Number(req.headers.get('content-length')) > 1024) return json(400, { error: 'Invalid request' })
    const body = await req.json()
    if (typeof body.token !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.token)) return json(400, { error: 'Invalid request' })
    token = body.token
  } catch { return json(400, { error: 'Invalid request' }) }
  const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return json(503, { error: 'Worker is not configured' })
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: job, error: claimError } = await db.rpc('aka_agent_sheet_claim', { p_token: token }).abortSignal(AbortSignal.timeout(15_000))
  if (claimError) return json(503, { error: 'Cannot claim worker' })
  if (!job) return json(200, { skipped: true })
  let rows: Array<Record<string, string | null>> = [], rowCount = 0, invalidCount = 0
  let failure: string | null = null, permanent = false
  try {
    const config = job.config as GoogleSheetConfig
    const document = await readGoogleSheet(config.url, config.hasHeader)
    const mapped = mapGoogleSheet(document, config)
    rows = mapped.rows; rowCount = mapped.rowCount; invalidCount = mapped.invalidCount
  } catch (error) {
    failure = error instanceof GoogleSheetError ? error.message : 'Không thể đọc Google Sheet. Hệ thống sẽ thử lại.'
    permanent = error instanceof GoogleSheetError && error.permanent
  }
  const { data, error } = await db.rpc('aka_agent_sheet_finish', {
    p_token: token, p_rows: rows, p_row_count: rowCount, p_invalid_count: invalidCount, p_error: failure, p_permanent: permanent
  }).abortSignal(AbortSignal.timeout(65_000))
  // An uncertain response is recovered from the durable run on the next tick.
  if (error) return json(503, { error: 'Cannot finalize worker' })
  return json(200, { ok: !data?.error, runId: job.runId, ...data })
})
