const { spawnSync } = require('node:child_process')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engagement-pg-'))
const run = (name, args, extra={}) => { const r=spawnSync(name,args,{encoding:'utf8',...extra}); if(r.status!==0) throw new Error(r.stdout+'\n'+r.stderr); return r.stdout }
let started=false
try {
 run('initdb',['-D',path.join(dir,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
 run('pg_ctl',['-D',path.join(dir,'db'),'-l',path.join(dir,'postgres.log'),'-o',`-h '' -k ${dir} -p 55489 -c max_connections=10`,'-w','start']); started=true
 const args=['-X','-h',dir,'-p','55489','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
 for (const file of ['scripts/fixtures/zalo-engagement/schema.sql','migrations/migration_v339_zalo_campaign_engagement.sql','scripts/fixtures/zalo-engagement/assertions.sql']) console.log(run('psql',[...args,'-f',file]))
 console.log(run(process.execPath,['scripts/zalo-campaign-engagement-race-smoke.cjs',dir],{timeout:30000}));
 if(process.argv.includes('--benchmark') || process.argv.includes('--pipeline-only')) { console.log(run('psql',[...args,'-f','scripts/fixtures/zalo-engagement/benchmark.sql'])); console.log(run(process.execPath,['scripts/zalo-campaign-engagement-benchmark.cjs',dir,...(process.argv.includes('--pipeline-only')?['--pipeline-only']:[])],{timeout:600000})); }
 const metadata=run('psql',[...args,'-Atc',"SELECT json_agg(json_build_object('signature',oid::regprocedure::text,'checksum',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'volatility',provolatile,'acl',proacl,'config',proconfig) ORDER BY proname) FROM pg_proc WHERE proname LIKE '%campaign_engagement%' OR proname='aka_agent_list_campaign_details_page_v2'"])
 fs.mkdirSync('docs/audits/zalo-engagement',{recursive:true})
 fs.writeFileSync('docs/audits/zalo-engagement/local-target.json',JSON.stringify(JSON.parse(metadata),null,2)+'\n')
 const indexes=run('psql',[...args,'-Atc',"SELECT json_agg(json_build_object('name',c.relname,'definition',pg_get_indexdef(c.oid)) ORDER BY c.relname) FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND (c.relname LIKE 'auto_campaign_engagement_%' OR c.relname LIKE 'chat_runtime_engagement_%')"])
 fs.writeFileSync('docs/audits/zalo-engagement/local-indexes.json',JSON.stringify(JSON.parse(indexes),null,2)+'\n')
 console.log(metadata)
} finally { if(started)run('pg_ctl',['-D',path.join(dir,'db'),'-m','immediate','stop']); fs.rmSync(dir,{recursive:true,force:true}) }
