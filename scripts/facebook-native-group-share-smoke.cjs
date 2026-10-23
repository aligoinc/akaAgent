// Offline candidate, real DAG and scheduler/managed-result regressions.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const ts = require('typescript')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const spec = require('./build-facebook-native-group-share.cjs')
const root = path.resolve(__dirname, '..')
let checks = 0
const plain = x => JSON.parse(JSON.stringify(x))
function compile(file, mocks = {}) {
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    name => name in mocks ? mocks[name] : require(name), mod, mod.exports)
  return mod.exports
}
const modes = compile('src/shared/facebookGroupPostShare.ts')
function reportTests() {
  for(const [file,names,expression] of [
    ['campaignRepository',['FACEBOOK_GROUP_INVITE_ACTION_ID','CAMPAIGN_RELATION_SKIPPED_DETAIL_STATUSES','FACEBOOK_GROUP_INVITE_SKIPPED_DETAIL_STATUSES','isCampaignRelationSkippedStatus'],"isCampaignRelationSkippedStatus('facebook_group_post','bỏ qua')"],
    ['reportRepository',['FACEBOOK_GROUP_INVITE_ACTION_CODE','REPORT_SUCCESS_DETAIL_STATUSES','REPORT_FAILURE_DETAIL_STATUSES','REPORT_SKIPPED_DETAIL_STATUSES','FACEBOOK_GROUP_INVITE_SKIPPED_DETAIL_STATUSES','getSkippedDetailStatuses','getFailureDetailStatuses','getReportDetailBucket'],"getReportDetailBucket('fb_post_group','bỏ qua') === 'skipped'"]
  ]) {
    const source=fs.readFileSync(path.join(root,`src/main/data/repositories/${file}.ts`),'utf8')
    const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true)
    const declarations=ast.statements.filter(n=>ts.isFunctionDeclaration(n)?names.includes(n.name?.text)
      :ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.includes(d.name.text))).map(n=>n.getText(ast)).join('\n')
    const code=ts.transpileModule(declarations,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
    assert(new Function(code+`;return ${expression}`)())
    checks++
  }
}
async function variableAndLoopTests() {
  const {fixture}=require('./facebook-page-content-rotation-smoke-test.cjs')
  const {step}=require('./action-status-mixed-output-smoke.cjs')
  const note='Message produced by the block'
  const prepare=step(1,'fb_prepare_native_group_share',{groupName:'Nhóm live'})
  const select=step(2,'fb_select_native_share_group',{selected:true})
  const submit=step(3,'fb_submit_native_group_share',{})
  const progressSteps=[{...prepare,status:'running',output:{}},prepare,{...select,status:'running',output:{}},select,
    {...submit,status:'running',output:{}},submit]
  const f=fixture({actionId:'facebook_group_post',progressSteps:[...progressSteps,...progressSteps],extra:{groupPostShareFromPost:true,
    sourceLinks:'https://facebook.com/author/posts/1,https://facebook.com/author/posts/2',
    groupPostShareCaption:'Optional caption',copyContentFromSource:true,includeSourceImages:true,
    rewriteSourceContentWithAI:true,enableComment:true,enablePostLike:true,postWithBackground:true}})
  const updates=[],logs=[]
  const update=f.scheduler.supabase.updateCampaignInputData
  f.scheduler.supabase.updateCampaignInputData=async(id,patch)=>{updates.push(patch);return update(id,patch)}
  f.scheduler.logMilestonesV2=async()=>({skippedInputNote:note,hasFailure:false,hasError:false})
  f.scheduler.logCampaignProgress=async(_c,message)=>logs.push(message)
  await f.run(['chờ xử lý','chờ xử lý'])
  assert.deepEqual(f.stats.variables.map(v=>v.sourceLink),['https://facebook.com/author/posts/1','https://facebook.com/author/posts/2'])
  for(const vars of f.stats.variables) {
    assert.equal(vars.groupPostShareFromPost,true);assert.equal(vars.groupPostShareCaption,'Optional caption')
    for(const key of ['copyContentFromSource','includeSourceImages','rewriteSourceContentWithAI','enableComment','enablePostLike','postWithBackground','autoJoinGroupAfterPost'])assert.equal(vars[key],false,key)
    assert.deepEqual(vars.images,[]);assert.deepEqual(vars.commentIterations,[])
  }
  assert.equal(updates.filter(p=>p.status==='hoàn thành'&&p.note===note).length,2)
  assert.equal(logs.filter(x=>x.includes('Bỏ qua')&&x.includes(note)).length,2)
  assert.equal(logs.some(x=>/Đang lấy tên nhóm|Đang mở bài viết nguồn|Đã chọn nhóm|Đang gửi bài chia sẻ/.test(x)),false,
    'DOM step callbacks must not add campaign progress messages')
  assert.equal(logs.filter(x=>x.startsWith('▶️ Xử lý')).length,2,'keep the common target-start log')
  f.scheduler.getMilestoneBadReason=()=> 'Actual failure'
  f.scheduler.getMilestoneBadRootReason=()=> 'Actual failure'
  f.scheduler.logMilestonesV2=async()=>({skippedInputNote:note,hasFailure:true})
  await f.run()
  assert.equal(updates.at(-1).note,null,'a failure must not be labelled with a previous skip')
  checks+=7
  const actions=compile('src/shared/campaignActionDescriptors.ts')
  const campaign={actionId:'facebook_group_post',extraSettings:{groupPostShareFromPost:true,enableComment:true,enablePostLike:true}}
  assert.deepEqual(actions.getCampaignExecutableActionDescriptors(campaign).map(a=>a.code),['fb_post_group'])
  assert.deepEqual(actions.getCampaignActionDescriptors(campaign,{limitCheckActionCodes:['fb_post_group','fb_comment','fb_like_post']}).map(a=>a.code),['fb_post_group'])
  campaign.extraSettings.groupPostShareFromPost=false
  assert.equal(actions.getCampaignExecutableActionDescriptors(campaign).length,3)
  checks+=3
}
async function migrationTests() {
  const db = new PGlite()
  try {
    for (const table of ['auto_workflows', 'auto_blocks', 'auto_elements']) {
      const cols = spec.before.schema.filter(c => c.table === table)
      await db.exec(`CREATE SEQUENCE ${table}_id_seq START 20000; CREATE TABLE ${table} (${cols.map(c => `${c.column} ${c.type}${c.default ? ' DEFAULT '+c.default : ''}${c.nullable === 'NO' ? ' NOT NULL' : ''}`).join(',')}, PRIMARY KEY(id));`)
      const rows = spec.before[table.replace('auto_', '')]
      for (const row of rows) await db.query(`INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::${table}, $1::jsonb)`, [JSON.stringify(row)])
    }
    const read = async table => (await db.query(`SELECT to_jsonb(t)-'updated_at'-'created_at' AS row FROM ${table} t ORDER BY id`)).rows.map(r => r.row)
    const oldBlocks = await read('auto_blocks'), oldElements = await read('auto_elements'), oldWorkflows = await read('auto_workflows')
    await db.exec(spec.sql)
    const applied = await read('auto_workflows')
    assert(applied.every(w => w.default_variables.groupPostShareWorkflowVersion === 1))
    assert.deepEqual((await read('auto_blocks')).slice(0,oldBlocks.length), oldBlocks)
    assert.deepEqual((await read('auto_elements')).slice(0,oldElements.length), oldElements)
    await db.exec(spec.sql)
    assert.deepEqual(await read('auto_workflows'), applied)
    assert.equal((await read('auto_blocks')).length, oldBlocks.length + 3)
    assert.equal((await read('auto_elements')).length, oldElements.length + 4)
    checks += 6
    await db.exec(spec.rollbackSql)
    assert.deepEqual(await read('auto_workflows'), oldWorkflows)
    await db.exec(spec.rollbackSql)
    await db.exec(spec.sql)
    assert.deepEqual(await read('auto_workflows'), applied)
    checks += 2
    for (const [mutation, pattern] of [
      ["UPDATE auto_workflows SET description='new live patch' WHERE id=252", /workflow_changed/],
      ["UPDATE auto_elements SET xpath='new selector' WHERE name='fb_post_button'", /element_changed/],
      ["UPDATE auto_elements SET xpath='new selector' WHERE name='fb_share_group_result'", /element_collision/],
      ["UPDATE auto_blocks SET code='new live patch' WHERE name='fb_submit_native_group_share'", /block_collision/]
    ]) {
      await db.exec('BEGIN; '+mutation)
      await assert.rejects(db.exec(spec.sql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')), pattern)
      await db.exec('ROLLBACK')
      assert.deepEqual(await read('auto_workflows'), applied)
      checks++
    }
    await db.exec("BEGIN; UPDATE auto_workflows SET description='new live patch' WHERE id=252")
    await assert.rejects(db.exec(spec.rollbackSql.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,'')), /rollback_drift/)
    await db.exec('ROLLBACK')
    assert.deepEqual(await read('auto_workflows'), applied)
    assert(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION|DROP\s+|CREATE\s+TABLE/i.test(spec.sql))
    checks += 2
  } finally { await db.close() }
}
async function graphTests() {
  let blocks
  const { BlockExecutor } = compile('src/main/v2/runtime/blockExecutor.ts', {
    './blockHelpers': { createBlockHelpers: (log, helpers) => ({ log, ...helpers }) }
  })
  const { WorkflowEngineV2 } = compile('src/main/v2/runtime/workflowEngine.ts', {
    './blockExecutor': { BlockExecutor }, '../../data/repositories/blockRepository': { getBlock: async id => blocks.get(id) },
    '../../data/repositories/workflowV2Repository': {}, '../../data/repositories/runV2Repository': {}
  })
  for (const [i,w] of spec.after.entries()) {
    for (const native of [false, true]) for (const found of [false, true]) for (const page of [false,true]) {
      const visited = []
      blocks = new Map([...spec.before.blocks,...spec.blocks].map(b => [b.id, { ...b, defaultConfig:b.default_config, systemType:b.system_type,
        code: b.kind === 'system' ? b.code : `return await helpers.visit(${JSON.stringify(b.name)},vars,input);` }]))
      const helpers = { visit: async (name,vars,input) => {
        visited.push(name)
        if (name === 'fb_select_native_share_group') vars.groupShareSelected = found
        if (name === 'fb_get_current_identity_name') vars.originalIdentityName = 'Profile'
        if (name === 'fb_campaign_page_identity_state') {
          const b=spec.before.blocks.find(b=>b.name===name)
          return new (Object.getPrototypeOf(async function(){}).constructor)('vars','input',b.code)(vars,input)
        }
        return {ok:true,opened:true,posted:true}
      } }
      const vars={groupPostShareFromPost:native,runAsPage:page,runAsPageName:'Page',pageIdentityRestoreAfterTarget:true,
        autoJoinGroupAfterPost:false,enableComment:false,copyContentFromSource:false}
      const engine=new WorkflowEngineV2()
      const run=await engine.run({...w,defaultVariables:w.default_variables},vars,null,{persist:false,runtimeHelpers:helpers})
      assert.equal(run.status,'completed',run.error)
      assert.equal(visited.filter(n=>n==='fb_submit_native_group_share').length,native&&found?1:0)
      assert.equal(visited.includes('fb_open_composer'),!native)
      if(native) {
        for(const name of ['fb_scrape_post','fb_type_post_content','fb_select_group_post_share_targets','fb_get_first_group_post_link','fb_comment_at_position','fb_join_group_if_not_member']) assert(!visited.includes(name), name)
      } else {
        const changedVisit=[...visited];visited.length=0
        const old=spec.before.workflows[i]
        const baseline=await engine.run({...old,defaultVariables:old.default_variables},vars,null,{persist:false,runtimeHelpers:helpers})
        assert.equal(baseline.status,'completed',baseline.error)
        assert.deepEqual(visited,changedVisit,'off must preserve the exact old traversal')
      }
      if(page) assert.equal(visited.filter(n=>n==='fb_switch_identity_by_name').length,2)
      checks++
    }
  }
}
async function schedulerTests() {
  const {harness,step,result}=require('./action-status-mixed-output-smoke.cjs')
  const zca=await import('zca-js')
  for(const native of [false,true]) {
    const f=await harness(zca,'facebook_group_post','facebook',{'../../shared/facebookGroupPostShare':modes})
    try {
      f.campaign.extraSettings={groupPostShareFromPost:native,advancedContentEnabled:true,enableGroupPostShareToJoinedGroups:true}
      assert.equal(f.scheduler.campaignUsesMainContent(f.campaign),!native)
      assert.equal(f.scheduler.campaignUsesCommentIterations(f.campaign),!native)
      if(native) {
        assert.equal(await f.scheduler.resolveGroupPostShareQuotaCapacity(f.account,f.campaign,undefined,false),0)
      }
      const message='Fixture wording from block'
      const s=step(1,'fb_select_native_share_group',{actionResult:result('fb_post_group','campaign_detail_skipped',{message})})
      await Promise.all([f.realtime(s),f.realtime(structuredClone(s))])
      const summary=await f.final([structuredClone(s)])
      assert.equal(summary.skippedInputNote,native?message:undefined)
      assert.equal(summary.hasFailure,false)
      assert.equal(summary.hasSuccess,false)
      assert.equal((await f.details()).length,1)
      assert.equal((await f.details())[0].log,message)
      assert.equal(await f.quota(),0)
      await f.runtime.settleManagedActionInput(1,{status:'hoàn thành',note:summary.skippedInputNote})
      const input=(await f.db.query('SELECT * FROM auto_campaign_input_data WHERE id=1')).rows[0]
      if(native)assert.equal(input.note,message)
      assert.equal(f.campaign.status,'đang chạy')
      assert.equal(f.logs.filter(log=>log.startsWith('🔁')).length,0,'skip must not log a successful share')
      checks+=7
      if(native) {
        f.input.id=2
        const unknown=step(2,'fb_submit_native_group_share',{actionResult:result('fb_post_group','campaign_detail_error',{
          inputDataId:2,operationState:'unknown',errorCode:'err_undefined',message:'Uncertain submit'})})
        const pending=await f.final([unknown])
        assert.equal(pending.preventInputRetry,true)
        assert.equal(pending.inputCompletionNote,'Uncertain submit')
        assert.equal(pending.skippedInputNote,undefined)
        await f.runtime.settleManagedActionInput(2,{status:'chờ xử lý',note:pending.inputCompletionNote})
        const fenced=(await f.db.query('SELECT status,note FROM auto_campaign_input_data WHERE id=2')).rows[0]
        assert.notEqual(fenced.status,'chờ xử lý','uncertain click must fence automatic retry even on cancellation')
        assert.equal(fenced.note,'Uncertain submit')
        assert.equal(f.logs.filter(log=>log.includes('Uncertain submit')).length,1)
        assert.equal(f.logs.filter(log=>log.startsWith('🔁')).length,0,'uncertain submit must not log success')
        checks++
      }
    } finally {await f.close()}
  }
  // Four skips preserve the existing streak; only the next actual failure
  // increments it and reaches the existing four-target stop threshold.
  const f=await harness(zca,'facebook_group_post','facebook',{'../../shared/facebookGroupPostShare':modes})
  try {
    f.campaign.extraSettings={groupPostShareFromPost:true}
    await f.db.exec('INSERT INTO auto_campaign_error_state(campaign_id,count_consecutive_bad_targets) VALUES(1,3)')
    const row=(await f.db.query('SELECT to_jsonb(t) AS row FROM auto_campaign_input_data t WHERE id=1')).rows[0].row
    for(const id of [3,4,5]) await f.db.query('INSERT INTO auto_campaign_input_data SELECT * FROM jsonb_populate_record(NULL::auto_campaign_input_data,$1::jsonb)',[JSON.stringify({...row,id})])
    await f.db.exec('UPDATE auto_campaigns SET runtime_unit_input_data_ids=ARRAY[1,2,3,4,5] WHERE id=1')
    f.runtime.beginActionResultUnit(1,'22222222-2222-2222-2222-222222222222',[1,2,3,4,5])
    f.scheduler.supabase.getAccount=async()=>f.account
    f.scheduler.supabase.incrementCampaignBadTargetCount=async(_c,id,reason)=>({countConsecutiveBadTargets:await f.runtime.settleManagedBadTarget(1,id,reason)})
    const count=async()=>(await f.db.query('SELECT count_consecutive_bad_targets n FROM auto_campaign_error_state WHERE campaign_id=1')).rows[0].n
    for(const id of [1,2,3,4]) {
      f.input.id=id
      const s=step(id,'fb_select_native_share_group',{actionResult:result('fb_post_group','campaign_detail_skipped',{message:'Block note',inputDataId:id})})
      const summary=await f.final([s])
      await f.runtime.settleManagedActionInput(id,{status:'hoàn thành',note:summary.skippedInputNote})
      await f.scheduler.finalizeExplicitResultPolicies(f.account,f.campaign,id,summary,{targetCounter:{},campaignDecision:{paused:false}})
      assert.equal(await count(),3);assert.equal(f.campaign.status,'đang chạy');assert.equal(await f.quota(),0)
      checks++
    }
    f.input.id=5
    const s=step(5,'actual_failure',{actionResult:result('fb_post_group','campaign_detail_failed',{message:'Actual error',errorCode:'err_undefined',inputDataId:5})})
    const summary=await f.final([s])
    assert.equal(summary.skippedInputNote,undefined)
    await f.runtime.settleManagedActionInput(5,{status:'hoàn thành',note:'Actual error'})
    const handled=await f.scheduler.finalizeExplicitResultPolicies(f.account,f.campaign,5,summary,{targetCounter:{},campaignDecision:{paused:false}})
    assert.equal(handled.triggered,true);assert.equal(await count(),4);assert.equal(f.campaign.status,'tạm dừng')
    checks++
  }finally{await f.close()}
}
async function resultLogTests() {
  const {harness,step,result}=require('./action-status-mixed-output-smoke.cjs')
  const zca=await import('zca-js')
  for(const {native,name,uid} of [
    {native:false,name:'Fixture group'}, {native:true,name:'Fixture group'}, {native:true,name:'',uid:'12345'}
  ]) {
    const f=await harness(zca,'facebook_group_post','facebook',{'../../shared/facebookGroupPostShare':modes})
    try {
      f.campaign.extraSettings={groupPostShareFromPost:native}
      Object.assign(f.input,{name,uid})
      const submit=step(3,'fb_submit_native_group_share',{actionResult:result('fb_post_group',undefined,{
        message:'Đã chia sẻ bài viết vào Tên nhóm từ Facebook',data:{shareMode:'native_group_share',submitClosed:true}})})
      await Promise.all([f.realtime(submit),f.realtime(structuredClone(submit))])
      const summary=await f.final([structuredClone(submit)])
      await f.final([structuredClone(submit)])
      const expected=`🔁 Đã chia sẽ bài viết vào nhóm "${name||uid}"`
      assert.deepEqual(f.logs,native?[expected]:[],'only the existing share-result template, once per result')
      assert.equal((await f.details()).length,1)
      assert.equal(await f.quota(),1)
      assert.equal(summary.hasSuccess,true)
      assert.equal(summary.hasFailure,false)
      if(native) {
        f.scheduler.supabase.updateCampaignInputData=async()=>{}
        await f.scheduler.finishGroupPostShareTarget(f.campaign,{id:2,name:name||uid},new Set())
        assert.equal(f.logs.at(-1),expected,'both sharing paths use the requested result wording')
        assert.equal((await f.details())[0].log,'Đã chia sẻ bài viết vào Tên nhóm từ Facebook','detail note remains owned by the block')
      }
      checks+=5
    } finally {await f.close()}
  }
  const f=await harness(zca,'facebook_group_post','facebook',{'../../shared/facebookGroupPostShare':modes})
  try {
    f.campaign.extraSettings={groupPostShareFromPost:true}
    f.scheduler.supabase.createCampaignDetail=async()=>{throw new Error('result write unavailable')}
    const s=step(1,'fb_submit_native_group_share',{actionResult:result('fb_post_group',undefined,{message:'Result'})})
    await assert.rejects(f.final([s]),/result write unavailable/)
    assert.deepEqual(f.logs,[],'failed persistence must not fabricate a completed result')
    checks++
  } finally {await f.close()}
}
async function main() {
  for(const url of ['https://www.facebook.com/abc/posts/12','https://facebook.com/groups/12/posts/34/','https://m.facebook.com/story.php?story_fbid=12&id=4','https://facebook.com/share/p/xyz/']) {assert(modes.isFacebookPostShareUrl(url));checks++}
  for(const url of ['https://facebook.com/abc','https://facebook.com/groups/12','1234','https://facebook.com.evil.test/a/posts/1','javascript:alert(1)','https://u:p@facebook.com/a/posts/1']) {assert(!modes.isFacebookPostShareUrl(url));checks++}
  assert(modes.validateGroupPostShareLinks(''));assert(modes.validateGroupPostShareLinks('https://facebook.com/abc'));checks+=2
  reportTests();await migrationTests();await graphTests();await schedulerTests();await resultLogTests();await variableAndLoopTests()
  console.log(`${checks} native group-share checks passed; no live DB or posting`)
}
module.exports={compile,modes}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1})
