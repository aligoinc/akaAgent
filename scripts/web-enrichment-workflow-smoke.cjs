const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto')
const sql=fs.readFileSync(path.join(__dirname,'../migrations/migration_v404_web_enrichment_dwell.sql'),'utf8')
const before=JSON.parse(fs.readFileSync(path.join(__dirname,'../migrations/snapshots/web-enrichment-dwell-v404/preflight.json'),'utf8')).block.code
let candidate=before
for(const name of ['google','page']){
 const read=side=>sql.match(new RegExp(`\\$${name}_${side}\\$([\\s\\S]*?)\\$${name}_${side}\\$`))[1]
 assert.equal(candidate.split(read('before')).length,2,'replace exactly one dwell setting')
 candidate=candidate.replace(read('before'),read('after'))
}
assert.equal(crypto.createHash('md5').update(candidate).digest('hex'),'8d1223574f8fc342317da3ce63db240b')
const code=process.env.WEB_ENRICHMENT_SNAPSHOT
 ? JSON.parse(fs.readFileSync(process.env.WEB_ENRICHMENT_SNAPSHOT,'utf8')).block.code : candidate
assert.equal(code,candidate,'live block must match the tested migration candidate')
async function run({random=()=>0,captcha=false,broken=false,budget=30*60_000}={}){
 let now=0,current='',scrolled=0,queries=0;const navigations=[],sleeps=[]
 class Clock extends Date{static now(){return now}}
 const config={keywords:['one','two','three','four','five'],websites:['a','b','c','d','e'].map(x=>`https://${x}.example/`),hobbies:['music','sport']}
 const context=vm.createContext({vars:{webConfig:config,webSelectors:{},webUntil:budget},signal:new AbortController().signal,
   Date:Clock,Math:Object.assign(Object.create(Math),{random}),URL,Set,encodeURIComponent,
   helpers:{sleep:async ms=>{assert.ok(ms>=0);sleeps.push(ms);now+=ms}},
   page:{navigate:async url=>{current=url;navigations.push({url,time:now});now+=500;if(broken&&!url.includes('google.com'))throw Error('network')},
     evaluate:async source=>{if(source.includes('const selectors')){queries++;return{captcha,links:['https://result-one.example/','https://result-two.example/']}}scrolled++}}
 })
 const result=await vm.runInContext(`(async()=>{${code}})()`,context,{timeout:1000})
 return{result,navigations,sleeps,now,queries,scrolled,config}
}
async function main(){
 for(const [random,google,dwell] of [[()=>0,10000,60000],[()=>.999999,30000,180000]]){
   const r=await run({random});assert.ok(r.result.ok);assert.ok(r.scrolled>0)
   const first=r.navigations[0],second=r.navigations[1],third=r.navigations[2]
   assert.match(first.url,/google.com\/search\?q=/);assert.equal(second.time-first.time,google+500);assert.equal(third.time-second.time,dwell+500)
   assert.equal(r.navigations[3].time-third.time,dwell+500,'direct sites use the same dwell range as search results')
   assert.equal(r.now,30*60_000,'last page clips to session budget including navigation')
   assert.ok(r.navigations.every(n=>n.url.includes('google.com')||n.url.includes('result-')||r.config.websites.includes(n.url)))
 }
 const captcha=await run({captcha:true});assert.equal(captcha.navigations.filter(n=>n.url.includes('google.com')).length,1)
 const exhausted=await run({captcha:true,broken:true});assert.equal(exhausted.navigations.length,6);assert.ok(exhausted.now<30*60_000)
 const short=await run({budget:10000});assert.equal(short.navigations.length,1);assert.equal(short.now,10000)
 const clipped=await run({budget:45000});assert.equal(clipped.navigations.length,2);assert.equal(clipped.now,45000,'the first result page clips to the remaining session budget')
 console.log('PASS DB workflow: Google 10–30s, result/direct web pages 1–3m, navigation budget, scroll, last-page clip, supplied URLs only, CAPTCHA fallback, exhausted sites')
}
main().catch(e=>{console.error(e);process.exitCode=1})
