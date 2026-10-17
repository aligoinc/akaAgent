const assert = require('node:assert/strict')
const { buildSync } = require('esbuild')
const { mkdtempSync, rmSync, readFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const dir = mkdtempSync(join(tmpdir(), 'campaign-edit-flow-'))
const tick = () => new Promise(resolve => setImmediate(resolve))
async function main() {
  const desktop = resolve(__dirname, '../src/shared/campaignEditFlow.ts')
  const web = resolve(__dirname, '../../akaAgentWebApp/apps/web/src/lib/campaignEditFlow.ts')
  assert.equal(readFileSync(desktop, 'utf8'), readFileSync(web, 'utf8'), 'both applications obey the same state machine')
  buildSync({ entryPoints: [desktop], outfile: join(dir, 'flow.cjs'), bundle: true, platform: 'node', format: 'cjs' })
  const { CampaignEditFlow, resumeSavedCampaigns } = require(join(dir, 'flow.cjs'))
  let row, reads = 0, pauses = 0, pauseError = false, lateRead
  const flow = new CampaignEditFlow(async () => { reads++; if (lateRead) return new Promise(resolve => lateRead.push(resolve)); return { ...row } }, async () => { pauses++; if (pauseError) throw Error('pause failed') })
  for (const status of ['chờ xử lý', 'đang chạy']) {
    row = { id: 1, status, editReady: false }; const oldPauses = pauses
    let pending = flow.prepare(1); await tick(); assert.equal(flow.getSnapshot().kind, 'confirm')
    assert.equal(await flow.prepare(2), null, 'double click cannot replace operation')
    flow.cancel(); assert.equal(await pending, null); assert.equal(pauses, oldPauses)
    pending = flow.prepare(1); await tick(); await Promise.all([flow.confirmPause(), flow.confirmPause()])
    assert.equal(pauses, oldPauses + 1); assert.equal(flow.getSnapshot().kind, 'waiting')
    flow.refresh(); await tick(); assert.equal(flow.getSnapshot().kind, 'waiting', 'pause command success is not a paused snapshot')
    row = { ...row, status: 'tạm dừng', editReady: false, content: 'fresh after pause' }; flow.refresh()
    assert.equal((await pending).content, 'fresh after pause')
  }
  row = { id: 1, status: 'tạm dừng', editReady: true }; assert.equal((await flow.prepare(1)).id, 1)
  row.editReady = false; assert.equal((await flow.prepare(1)).id, 1, 'old claim-based readiness cannot block a paused campaign')
  let pending
  row.status = 'hoàn thành'; pending = flow.prepare(1); await tick(); assert.equal(flow.getSnapshot().kind, 'error'); flow.cancel(); await pending
  row.status = 'đang chạy'; pauseError = true; pending = flow.prepare(1); await tick(); await flow.confirmPause(); assert.equal(flow.getSnapshot().kind, 'error')
  pauseError = false; flow.retry(); await tick(); await flow.confirmPause(); flow.cancel(); await pending; assert.equal(row.status, 'đang chạy', 'cancel wait must not force a status change')
  lateRead = []; const session = new AbortController(); pending = flow.prepare(1, session.signal); session.abort(); assert.equal(await pending, null)
  row.editReady = true; lateRead[0](row); await tick(); assert.equal(flow.getSnapshot().kind, 'closed', 'late read cannot open form'); lateRead = null
  for (const choice of ['tạm dừng', 'chờ xử lý']) { const value = flow.chooseSaveStatus(); flow.selectSaveStatus(choice); assert.equal(await value, choice) }
  let choice = flow.chooseSaveStatus(); flow.cancel(); assert.equal(await choice, null)
  const expired = new AbortController(); choice = flow.chooseSaveStatus(expired.signal); expired.abort(); assert.equal(await choice, null)
  let resumes = 0; row = { id: 2, status: 'tạm dừng', editReady: true }
  const resume = async () => { resumes++; row.status = 'đang chạy'; throw Error('lost response') }
  await assert.rejects(resumeSavedCampaigns([2], async () => row, resume, new AbortController().signal), /lost response/)
  await resumeSavedCampaigns([2], async () => row, resume, new AbortController().signal); assert.equal(resumes, 1, 'retry cannot restart a campaign already activated')
  row.status = 'hoàn thành'; await resumeSavedCampaigns([2], async () => row, resume, new AbortController().signal); assert.equal(resumes, 1)
  row.status = 'tạm dừng'; row.editReady = false
  await resumeSavedCampaigns([2], async () => row, async () => { resumes++; row.status = 'chờ xử lý' }, new AbortController().signal)
  assert.equal(resumes, 2, 'a leftover claim cannot block the chosen post-save resume')
  await assert.rejects(resumeSavedCampaigns([2], async () => row, resume, expired.signal), /đã đóng/)
  buildSync({ entryPoints: [resolve(__dirname, '../src/main/data/mappers.ts')], outfile: join(dir, 'mappers.cjs'), bundle: true, platform: 'node', format: 'cjs' })
  const { mapCampaignConfigFromDB } = require(join(dir, 'mappers.cjs'))
  for (const status of ['chờ xử lý', 'đang chạy', 'tạm dừng', 'hoàn thành']) for (const claim of [null, 'secret']) for (const unit of [null, 'secret']) {
    const config = mapCampaignConfigFromDB({ id: 1, status, runtime_claim_token: claim, runtime_unit_token: unit })
    assert.equal(config.editReady, status === 'tạm dừng')
    assert(!JSON.stringify(config).includes('secret'), 'runtime ownership never crosses IPC')
  }
  assert.equal(mapCampaignConfigFromDB({id:1,status:'tạm dừng'}).editReady, true)
  // Execute the production repository writer against a fake PostgREST CAS,
  // changing status/version between the initial read and UPDATE.
  const ts = require('typescript'), vm = require('node:vm')
  const source = ts.createSourceFile('repository.ts', readFileSync(resolve(__dirname, '../src/main/data/repositories/campaignRepository.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const writer = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'updateCampaign')
  const exports = {}; let stored, beforeWrite
  vm.runInNewContext(ts.transpileModule(writer.getText(source), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports, requireCurrentUser: () => ({staffId:7}), CAMPAIGN_SELECT:'*', mapCampaignFromDB:x=>x,
    touchesRestrictedCampaignConfig:()=>false, smsMaterializationUpdateRequested:()=>false,
    isMobileManagedSmsCampaignAction:()=>false, SMS_SEND_ACTION_ID:'sms_send',
    client:()=>({from:()=>{
      const filters={};let patch;const q={update:v=>(patch=v,q),eq:(k,v)=>(filters[k]=v,q),is:(k,v)=>(filters[k]=v,q),select:()=>q,
        maybeSingle:async()=>{beforeWrite?.();if(!Object.entries(filters).every(([k,v])=>stored[k]===v))return {data:null,error:null};Object.assign(stored,patch);return {data:stored,error:null}}};return q
    }})
  })
  for (const change of [{}, {status:'chờ xử lý'}, {status:'đang chạy'}, {status:'hoàn thành'}, {updated_at:'newer-version'}, {staff_id:8}, {is_delete:true}]) {
    stored={id:1,staff_id:7,status:'tạm dừng',runtime_claim_token:null,runtime_unit_token:null,is_delete:false,updated_at:'read-version',name:'old'}
    beforeWrite=()=>Object.assign(stored,change)
    const write=exports.updateCampaign(1,{name:'new'},true,'read-version')
    if(Object.keys(change).length) { await assert.rejects(write,/đã thay đổi/);assert.equal(stored.name,'old') }
    else { await write;assert.equal(stored.name,'new') }
  }
  console.log('PASS: pending/running pause confirmation, single-flight, fresh paused status, cancellation/auth/late reads, save choices, resume-only retry, 16 readiness/redaction cases')
}
main().finally(() => rmSync(dir, { recursive: true, force: true })).catch(error => { console.error(error); process.exitCode = 1 })
