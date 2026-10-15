const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { build } = require('esbuild')
const { createClient } = require('@supabase/supabase-js')
async function main() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'report-rpc-'))
  try {
    await build({entryPoints:[path.resolve(__dirname,'../src/main/domain/reports/reportReadRpc.ts')],outfile:path.join(dir,'rpc.cjs'),bundle:true,platform:'node',format:'cjs',logLevel:'silent'})
    const {readReportPage,REPORT_READ_TIMEOUT_MS}=require(path.join(dir,'rpc.cjs'))
    assert.equal(REPORT_READ_TIMEOUT_MS,65000)
    const scope={staffId:7,organizationId:9,username:'fixture-user',password:'fixture-password'}
    const query={source:'results',view:'details',accountIds:[11],actionCodes:['zalo_message_stranger'],startIso:'2026-01-01T00:00:00Z',endIso:'2026-01-02T00:00:00Z',filter:{kind:'legacy',status:'x\n\r\t"\\n'},count:true,limit:100}
    let response={rows:[{id:1}],count:1},failure=false,delay=false
    const client=createClient('https://fixture.invalid','fixture-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,options)=>{
      assert.equal(new URL(url).pathname,'/rest/v1/rpc/aka_agent_read_report_page')
      assert.equal(options.method,'POST')
      const body=JSON.parse(options.body)
      assert.deepEqual(body.p_query,query)
      assert.equal(body.p_staff_id,7);assert.equal(body.p_organization_id,9)
      assert.equal(body.p_auth_username,scope.username);assert.equal(body.p_auth_password,scope.password)
      if(delay) await new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})})
      return new Response(JSON.stringify(failure?{message:'fixture statement timeout',code:'57014'}:response),{status:failure?500:200,headers:{'content-type':'application/json'}})
    }}})
    const signal=AbortSignal.timeout(REPORT_READ_TIMEOUT_MS)
    assert.deepEqual(await readReportPage(client,scope,query,signal),response)
    response={rows:[],count:null};assert.deepEqual(await readReportPage(client,scope,query,signal),response)
    response={rows:[],count:-1};await assert.rejects(readReportPage(client,scope,query,signal),/không hợp lệ/)
    failure=true;await assert.rejects(readReportPage(client,scope,query,signal),/statement timeout/)
    failure=false;delay=true
    const abort=new AbortController(),pending=readReportPage(client,scope,query,abort.signal)
    setImmediate(()=>abort.abort(new Error('fixture cancellation')))
    await assert.rejects(pending,/fixture cancellation/)
    console.log('PASS report RPC: POST contract/credentials, exact control characters, count validation, timeout and cancellation propagation; operation deadline 65s')
  } finally {fs.rmSync(dir,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
