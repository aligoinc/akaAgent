// Compare old/new real repository paths with an in-memory Data API fixture.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { build } = require('esbuild')
const root = path.resolve(__dirname,'..')
// Immutable pre-fix baseline; HEAD would silently become the new code after commit.
const baseline = process.env.UID_BASE_REF || 'f06b1416897565c005a356e56e570f9c84386660'
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'aka-zalo-lookup-'))
const files = {
  contacts:'src/main/data/repositories/accountContactRepository.ts',
  campaigns:'src/main/data/repositories/campaignRepository.ts'
}
const extra = {
  contacts:'export { upsertZaloUsersForGroupMembers as testGroupUsers, getExistingZaloUsers as testLookup };',
  campaigns:'export { loadZaloRemarketingLookup as testRemarketing };'
}
const exportsByKind = {
  contacts:'upsertZaloCampaignUserContacts, testGroupUsers, testLookup',
  campaigns:'testRemarketing'
}
const uid = '1234567890123456789'
const oldRows = [
  {id:1,account_id:11,staff_id:7,zalo_uid:uid,display_name:'Old name',zalo_name:'Original',
    avatar:'old-avatar',phone_number:'0912345678',is_fr:1,gender:0,
    raw_payload:{retained:'old',nested:{value:1}},organization_id:9},
  {id:2,account_id:22,staff_id:7,zalo_uid:uid,display_name:'Other account',raw_payload:{other:true}},
  {id:3,account_id:11,staff_id:8,zalo_uid:'staff-8',display_name:'Other staff',raw_payload:{}}
]
function fixture({failCall=0, legacy=false}={}) {
  const state = {reads:[],writes:[],callCount:0}
  const chain = (table,args) => {
    const filters=[]
    let payload, projection
    const query = {
      select(fields) { projection=fields; return query },
      eq(key,value) { filters.push(row=>row[key]===value); return query },
      in(key,values) { filters.push(row=>values.includes(row[key])); return query },
      order() { return query },
      upsert(rows) { payload=rows; return query },
      then(resolve,reject) {
        let data=[], error=null
        if (payload) {
          state.writes.push({table,payload:structuredClone(payload)})
          data=payload.map((row,i)=>({...row,id:i+1}))
        } else if (table==='zalo_users') {
          state.callCount++
          state.reads.push({args:args && structuredClone(args),projection})
          if (state.callCount===failCall) error={message:'fixture timeout'}
          else data=oldRows.filter(row=>filters.every(test=>test(row)))
        }
        if (args) data=data.filter(row=>row.account_id===args.p_account_id &&
          row.staff_id===args.p_staff_id && args.p_zalo_uids.includes(row.zalo_uid))
        return Promise.resolve({data,error}).then(resolve,reject)
      }
    }
    return query
  }
  state.db = {
    from(table) {
      const query=chain(table)
      if (!legacy && table==='zalo_users') {
        query.eq=()=>{throw new Error('New path must not use legacy UID read')}
      }
      return query
    },
    rpc(name,args) {
      assert.equal(name,'aka_agent_lookup_zalo_users')
      assert.ok(args.p_zalo_uids.length<=100)
      assert.equal(typeof args.p_account_id,'number')
      assert.equal(args.p_staff_id,7)
      return chain('zalo_users',args)
    }
  }
  return state
}
function stable(value) {
  if(value instanceof Map) return stable([...value])
  if(Array.isArray(value)) return value.map(stable)
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value)
    .filter(([key])=>!['updated_at','last_seen_at'].includes(key)).map(([k,v])=>[k,stable(v)]))
  return value
}
async function compile(kind,old) {
  const relative=files[kind], absolute=path.join(root,relative)
  const outfile=path.join(temporary,kind+'-'+old+'.cjs')
  const source=old ? execFileSync('git',['show',baseline+':'+relative],{cwd:root,encoding:'utf8'}) : fs.readFileSync(absolute,'utf8')
  await build({
    stdin:{contents:`export { ${exportsByKind[kind]} } from './${relative}';`,resolveDir:root,loader:'ts'},
    outfile,bundle:true,platform:'node',format:'cjs',target:'node20',logLevel:'warning',
    external:['better-sqlite3'],
    plugins:[{name:'isolated-repository',setup(builder){
      builder.onResolve({filter:/^electron$/},()=>({path:'electron',namespace:'fixture'}))
      builder.onLoad({filter:/[\\/]repositories[\\/](accountContactRepository|campaignRepository)\.ts$/},args=>
        args.path===absolute ? {contents:source+'\n'+extra[kind],loader:'ts'} : undefined)
      builder.onResolve({filter:/\/(supabaseClient|currentUser)$/},args=>({
        path:args.path.endsWith('/supabaseClient')?'db':'auth',namespace:'fixture'
      }))
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({
        contents:args.path==='electron'
          ? 'export const app={on(){},getPath(){throw new Error("No filesystem runtime")}}; export const BrowserWindow={getAllWindows:()=>[]};'
          : args.path==='db'
          ? 'export const getSupabaseClient=()=>globalThis.__uidDb; export const getSupabaseUrl=()=>{throw new Error("No live URL")};'
          : 'export const requireCurrentUser=()=>({staffId:7,organizationId:9}); export const getCurrentUser=requireCurrentUser; export const requireCurrentUserCredentials=()=>{throw new Error("No credentials")}; export const getCurrentUserCredentials=requireCurrentUserCredentials;',
        loader:'js'
      }))
    }}]
  })
  return require(outfile)
}
async function main() {
  let checks=0
  const pass=label=>{checks++;console.log('PASS',label)}
  const modules={}
  for(const kind of Object.keys(files)) modules[kind]=[await compile(kind,true),await compile(kind,false)]
  async function parity(kind,fn,args,label) {
    const results=[]
    for(let i=0;i<2;i++) {
      const state=fixture({legacy:i===0}); globalThis.__uidDb=state.db
      results.push({result:stable(await modules[kind][i][fn](...args)),writes:stable(state.writes)})
    }
    assert.deepEqual(results[1],results[0]);pass(label)
    return results[1]
  }
  const result=await parity('contacts','upsertZaloCampaignUserContacts',[[
    {accountId:11,zaloUid:uid,displayName:'Updated',rawPayload:{added:true}},
    {accountId:22,zaloUid:uid,displayName:'Account two'},
    {accountId:11,zaloUid:'new-user',displayName:'New'}
  ]],'campaign merge parity: existing/new users and mixed accounts')
  const saved=result.writes.find(w=>w.table==='zalo_users').payload[0]
  assert.equal(saved.avatar,'old-avatar')
  assert.equal(saved.is_fr,1)
  assert.deepEqual(saved.raw_payload,{retained:'old',nested:{value:1},added:true})
  pass('existing profile fields/friend status/raw payload preserved')
  await parity('contacts','testGroupUsers',[11,[{zaloUid:uid,displayName:'Member',rawPayload:{incoming:true}},{zaloUid:'new-member',displayName:'New'}],7,9],
    'group member profile merge parity')
  const many=Array.from({length:205},(_,i)=>i===0?uid:'new-'+i)
  await parity('contacts','testLookup',[11,many,7],'205 UID lookup parity across three chunks')
  await parity('campaigns','testRemarketing',[11,7,[uid,' '+uid+' ',...many]],
    'remarketing metadata/maps and duplicate normalization parity')
  for(const [kind,fn,args] of [
    ['contacts','testLookup',[11,[],7]],['campaigns','testRemarketing',[11,7,[]]]
  ]) {
    const state=fixture();globalThis.__uidDb=state.db
    await modules[kind][1][fn](...args)
    assert.equal(state.callCount,0);pass(kind+' empty input makes no request')
  }
  for(const [kind,fn,args,failCall] of [
    ['contacts','upsertZaloCampaignUserContacts',[[{accountId:11,zaloUid:uid}]],1],
    ['contacts','testLookup',[11,many,7],2],
    ['campaigns','testRemarketing',[11,7,many],2]
  ]) {
    const state=fixture({failCall});globalThis.__uidDb=state.db
    await assert.rejects(modules[kind][1][fn](...args),/fixture timeout/)
    assert.equal(state.callCount,failCall)
    assert.equal(state.writes.length,0)
    pass(kind+' propagates failed chunk without fallback/retry/partial writes')
  }
  const state=fixture();globalThis.__uidDb=state.db
  await modules.campaigns[1].testRemarketing(11,7,[uid])
  assert.equal(state.reads[0].projection,'zalo_uid, display_name, zalo_name, phone_number, is_fr, gender, raw_payload')
  pass('remarketing keeps the smaller response projection')
  console.log(`PASS ${checks} repository checks`)
}
main().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(temporary,{recursive:true,force:true}))
