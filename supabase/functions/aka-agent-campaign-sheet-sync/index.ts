// Worker đồng bộ Google Sheet vào data chiến dịch (V662). DB gọi qua pg_net mỗi 30 giây khi có nguồn đến hạn.
// Mỗi lượt gọi xử lý lần lượt nhiều nguồn trong tối đa ~90 giây: claim → đọc Sheet → chuẩn hoá như cửa sổ Upload → finish.
// Không nhận link / id / dữ liệu từ bên gọi; mọi thứ lấy từ DB qua claim.
import { createClient } from 'npm:@supabase/supabase-js@2.49.1'
import { CampaignSheetSyncError, GoogleSheetError, campaignSheetSyncRows, campaignSheetTable, readGoogleSheet } from './core.generated.js'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const BUDGET_MS = 90_000
// Supabase cắt lượt gọi dùng quá 2 giây CPU; đọc + chuẩn hoá 10.000 dòng tốn ~0,2-0,3 giây CPU.
// Đọc đủ số dòng này thì dừng, lượt 30 giây sau làm tiếp.
const ROW_BUDGET = 20_000

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const expected = Deno.env.get('INTERNAL_EDGE_FUNCTION_TOKEN')?.trim()
  const received = req.headers.get('x-internal-token') || ''
  if (!expected || !received || received.length !== expected.length) return json(401, { error: 'Unauthorized' })
  let difference = 0
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ received.charCodeAt(i)
  if (difference) return json(401, { error: 'Unauthorized' })
  if (Number(req.headers.get('content-length')) > 1024) return json(400, { error: 'Invalid request' })
  await req.body?.cancel()

  const url = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!url || !key) return json(503, { error: 'Worker is not configured' })
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const started = Date.now()
  const done: Array<{ syncId: number; ok: boolean; added?: number; errorCode?: string }> = []
  let rowsRead = 0

  while (Date.now() - started < BUDGET_MS && rowsRead < ROW_BUDGET) {
    const { data: job, error: claimError } = await db.rpc('aka_agent_campaign_sheet_claim').abortSignal(AbortSignal.timeout(30_000))
    if (claimError) return json(503, { error: 'Cannot claim', processed: done })
    if (!job) break
    let result: Record<string, unknown>
    try {
      // Tách dòng tiêu đề khi đọc để giới hạn 10.000 dòng chỉ tính dòng data, như cửa sổ Upload.
      const hasHeader = job.config.hasHeader === true
      const document = await readGoogleSheet(job.config.url, hasHeader)
      rowsRead += document.rows.length
      result = campaignSheetSyncRows(campaignSheetTable(hasHeader ? [document.headers, ...document.rows] : document.rows), job.config, job.actionId)
    } catch (error) {
      const code = error instanceof CampaignSheetSyncError ? error.code
        : error instanceof GoogleSheetError ? (error.permanent ? 'sheet_read_blocked' : 'sheet_read_failed') : 'sheet_read_failed'
      const permanent = error instanceof CampaignSheetSyncError || error instanceof GoogleSheetError ? error.permanent : false
      const message = error instanceof CampaignSheetSyncError || error instanceof GoogleSheetError
        ? error.message : 'Không thể đọc Google Sheet. Hệ thống sẽ thử lại.'
      result = { error: { code, message, permanent } }
    }
    const { data, error } = await db.rpc('aka_agent_campaign_sheet_finish', { p_token: job.token, p_result: result })
      .abortSignal(AbortSignal.timeout(65_000))
    // Câu trả lời không rõ: lease hết hạn thì lượt sau đọc lại Sheet (finish gọi lại cùng token không thêm trùng).
    if (error) return json(503, { error: 'Cannot finalize', processed: done })
    done.push({ syncId: job.syncId, ok: !!data?.ok, added: data?.added, errorCode: data?.errorCode })
  }
  return json(200, { processed: done.length, items: done })
})
