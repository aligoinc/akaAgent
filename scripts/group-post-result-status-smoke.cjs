const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/main/services/campaignScheduler.ts'), 'utf8')
const start = source.indexOf('    const groupPostVerifySteps =')
const end = source.indexOf('    // Timeline/Reels only report success', start)
assert(start > 0 && end > start)
const compiled = ts.transpileModule(`module.exports = async function({steps,campaign,accountId,detail,inputDataName,createCampaignDetail,flushScreenshotLogsForStep}) {
 const emits = () => true
 ${source.slice(start, end)}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const context = { module: { exports: null }, ResultContractError: class extends Error {}, console: { error: (...args) => { throw new Error(args.join(' ')) } } }
vm.runInNewContext(compiled, context)
async function check({ detector, url = '', posted = true, expectedSub = null }) {
 const details = [], approvals = []
 const steps = [{ id:'verify', blockName:'fb_verify_group_post_form_closed', status:'success', output:{posted,postVisible:true} }]
 if (detector) steps.push({blockName:'fb_detect_pending_post',status:'success',output:detector})
 if (url) steps.push({blockName:'fb_get_first_group_post_link',status:'success',output:{postUrl:url}})
 await context.module.exports.call({
  cleanPostLinkForStorage: x => x, getPostActionCode: () => 'fb_post_group',
  formatGroupPendingProgressLog: () => 'existing progress',
  syncGroupPostContactStatus: async (_account,_detail,value) => approvals.push(value),
  logCampaignProgress: async () => {}, enqueuePostBumpAfterGroupPost: async () => {}
 }, { steps,campaign:{id:1,actionId:'facebook_group_post'},accountId:1,detail:{id:2},inputDataName:'Fixture group',
  createCampaignDetail: async detail => details.push(detail),flushScreenshotLogsForStep:async()=>{} })
 assert.equal(details.length,1)
 assert.equal(details[0].status,posted?'thành công':'thất bại')
 if (posted) {
  assert.equal(details[0].resultOutput.statusCode,'campaign_detail_success')
  assert.equal(details[0].resultOutput.subStatusCode,expectedSub)
  assert.equal(details[0].log,'Đăng bài thành công vào Fixture group'+(expectedSub?' (chờ duyệt)':''))
 } else assert.equal(details[0].resultOutput,undefined)
 return approvals[0]
}
async function main() {
 assert.equal(await check({detector:{isPending:true,pendingCheckConclusive:true},expectedSub:'campaign_detail_post_pending'}),true)
 assert.equal(await check({detector:{isPending:false,pendingCheckConclusive:true,postVisible:true}}),false)
 assert.equal(await check({detector:{isPending:false,pendingCheckConclusive:false,postVisible:true}}),undefined)
 assert.equal(await check({url:'https://www.facebook.com/groups/1/posts/2/'}),undefined)
 assert.equal(await check({url:'https://www.facebook.com/groups/1/pending_posts/2/',expectedSub:'campaign_detail_post_pending'}),true)
 await check({posted:false,detector:{isPending:true}})
 assert(!require('./action-status-policy-seed.cjs').newStatuses.some(s=>s.code==='campaign_detail_post_visible'))
 console.log('7 group-post checks passed; no live browser/network/action')
}
main().catch(e=>{console.error(e);process.exitCode=1})
