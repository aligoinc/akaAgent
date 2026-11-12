// Read-only replay of real "rows added later" sessions: Desktop "Thêm data" classifier (src/shared/campaignAppendData.ts)
// against an oracle keyed by the database's own normalize_phone / SQL UID key. Never writes anything.
//
// 1. Copy the data with this SELECT (Supabase MCP execute_sql on akachat; result is saved to a file when large).
//    Adjust the id window (last ~1.500.000 rows ≈ 6 days on 12/11/2026):
//
//    with b as (select campaign_id, date_trunc('minute', created_at) m, min(id) first_id from auto_campaign_input_data
//      where id > <max_id> - 1500000 and input_id is null and control_append_idempotency_key is null and not is_delete group by 1,2),
//    s as (select b.*, c.action_id from b join auto_campaigns c on c.id = b.campaign_id
//      where b.m > c.created_at + interval '10 minutes' and coalesce(c.data_target_source_mode,'direct') = 'direct'
//        and c.action_id in ('zalo_message_phone','facebook_join_group','zalo_message_group_member','facebook_message_uid',
//          'facebook_group_post','zalo_message_friend','sms_send','zalo_join_group_link')),
//    camps as (select distinct campaign_id, action_id from s)
//    select json_build_object(
//      'sessions', (select json_agg(json_build_array(campaign_id, extract(epoch from m)::bigint, first_id, action_id)) from s),
//      'rows', (select json_agg(json_build_array(d.campaign_id, d.id, extract(epoch from date_trunc('minute', d.created_at))::bigint,
//          (d.input_id is null and d.control_append_idempotency_key is null),
//          case when c.action_id in ('zalo_message_phone','sms_send') then d.phone else d.uid end,
//          case when c.action_id in ('zalo_message_phone','sms_send') then coalesce(normalize_phone(d.phone), '')
//               else lower(regexp_replace(regexp_replace(coalesce(d.uid,''), '^\s+|\s+$', '', 'g'), '/+$', '')) end) order by d.campaign_id, d.id)
//        from auto_campaign_input_data d join camps c on c.campaign_id = d.campaign_id where not d.is_delete)) payload;
//
// 2. node scripts/campaign-add-data-replay.cjs <saved result file>
//
// A session = rows of one campaign inserted in the same minute (input_id/control key null) at least 10 minutes after the
// campaign was created; "existing" = live rows with a smaller id. Phone/UID only (single-key campaign types).
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildSync } = require('esbuild')

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/campaign-add-data-replay.cjs <saved MCP result file>'); process.exit(2) }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aka-add-data-replay-'))
const outfile = path.join(dir, 'lib.cjs')
buildSync({ entryPoints: [path.resolve(__dirname, '../src/shared/campaignAppendData.ts')], outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'warning' })
const lib = require(outfile)
fs.rmSync(dir, { recursive: true, force: true })

const text = fs.readFileSync(file, 'utf8')
const body = text.startsWith('{"result"') ? JSON.parse(text).result : text
const start = body.indexOf('[{"payload"'), end = body.lastIndexOf('}]') + 2
const { sessions, rows } = JSON.parse(body.slice(start, end))[0].payload
const byCampaign = new Map()
for (const row of rows) { if (!byCampaign.has(row[0])) byCampaign.set(row[0], []); byCampaign.get(row[0]).push(row) }
const field = actionId => (actionId === 'zalo_message_phone' || actionId === 'sms_send') ? 'phone' : 'uid'
const summary = {}
let mismatches = 0, total = 0, keyMismatches = 0
for (const [campaignId, minute, firstId, actionId] of sessions) {
  const list = byCampaign.get(campaignId) || []
  const existingRows = list.filter(row => row[1] < firstId)
  const pending = list.filter(row => row[3] && row[2] === minute)
  const f = field(actionId)
  const existingKeys = new Set(existingRows.flatMap(row => lib.appendInputDataDedupeKeys({ [f]: row[4] }, actionId)))
  const desktop = lib.classifyAppendInputData(actionId, pending.map(row => ({ [f]: row[4] })), existingKeys, { skipExisting: true })
  const dbExisting = new Set(existingRows.map(row => row[5]).filter(Boolean))
  const oracle = { acceptedIndexes: [], invalidIndexes: [], batchDuplicateIndexes: [], existingIndexes: [] }
  const seen = new Set()
  pending.forEach((row, index) => {
    const key = row[5]
    if (!key) oracle.invalidIndexes.push(index)
    else if (seen.has(key)) oracle.batchDuplicateIndexes.push(index)
    else if (dbExisting.has(key)) oracle.existingIndexes.push(index)
    else { seen.add(key); oracle.acceptedIndexes.push(index) }
  })
  pending.forEach(row => { if ((lib.appendInputDataDedupeKeys({ [f]: row[4] }, actionId)[0] || '') !== row[5]) keyMismatches++ })
  if (JSON.stringify(desktop) !== JSON.stringify(oracle)) {
    mismatches++
    if (mismatches <= 5) console.log('MISMATCH', campaignId, actionId, minute)
  }
  const s = summary[actionId] ||= { sessions: 0, rows: 0, existing: 0, batch: 0, invalid: 0, accepted: 0 }
  s.sessions++; s.rows += pending.length; s.existing += desktop.existingIndexes.length; s.batch += desktop.batchDuplicateIndexes.length
  s.invalid += desktop.invalidIndexes.length; s.accepted += desktop.acceptedIndexes.length
  total += pending.length
}
console.table(summary)
console.log(`sessions=${sessions.length} rows=${total} copied=${rows.length} mismatches=${mismatches} keyMismatches=${keyMismatches}`)
process.exitCode = mismatches || keyMismatches ? 1 : 0
