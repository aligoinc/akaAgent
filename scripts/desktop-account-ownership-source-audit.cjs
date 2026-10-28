const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),dir=path.join(root,'migrations/snapshots/desktop-account-ownership'),plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json')))
const files=cp.execFileSync('rg',['--files','migrations','supabase/migrations','-g','*.sql'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(p=>!p.includes('/snapshots/')&&!p.includes('/tests/')&&!p.includes('rollback')&&!p.endsWith('20261027183537_desktop_account_campaign_ownership.sql'))
const sources=files.map(file=>({file,text:fs.readFileSync(path.join(root,file),'utf8')}))
const body=def=>{const match=/\bAS\s+(\$\w*\$)([\s\S]*)\1/i.exec(def);return match?.[2].trim()}
const norm=s=>s?.replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim()
const audit=plan.functions.map(f=>{
 const mentions=[],definitions=[],names=f.arguments.match(/\bp_\w+(?=\s+(?:bigint|integer|text|boolean|jsonb|uuid|timestamp))/g)||[]
 for(const s of sources){if(!s.text.includes(f.name))continue;mentions.push(s.file)
  const re=new RegExp('CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:'+f.schema+'\\.)?'+f.name+'\\s*\\(','ig');let hit
  while((hit=re.exec(s.text))){const tail=s.text.slice(hit.index),as=/\bAS\s+(\$\w*\$)/i.exec(tail);if(!as)continue;const end=tail.indexOf(as[1],as.index+as[0].length);if(end<0)continue;const def=tail.slice(0,end+as[1].length),header=def.slice(0,def.search(/\)\s*RETURNS/i)),candidateNames=header.match(/\bp_\w+(?=\s+(?:bigint|integer|text|boolean|jsonb|uuid|timestamp))/g)||[];if(JSON.stringify(names)!==JSON.stringify(candidateNames))continue
   definitions.push({file:s.file,bodyMatchesLive:norm(body(def))===norm(body(f.definition)),bodyChecksum:crypto.createHash('md5').update(body(def)||'').digest('hex')})
  }
 }
 const removed=f.target_definition.replace(/\n  PERFORM private\.aka_agent_assert_request_ownership\([^\n]*\n/,'')
 const unrelatedBodyPreserved=/LANGUAGE plpgsql/.test(f.definition)?removed===f.definition:f.target_definition.includes(body(f.definition).trim().replace(/;\s*$/,''))
 if(!unrelatedBodyPreserved)throw Error('Unexpected body change '+f.signature)
 return {signature:f.signature,sourceChecksum:f.checksum,targetChecksum:f.target_checksum,unrelatedBodyPreserved,mentions,definitions}
})
fs.writeFileSync(path.join(dir,'migration-inventory.json'),JSON.stringify(audit,null,2)+'\n')
console.log(JSON.stringify({functions:audit.length,allLiveBodiesPreserved:audit.every(x=>x.unrelatedBodyPreserved),noDefinition:audit.filter(x=>!x.definitions.length).map(x=>x.signature),noMatchingRepositoryBody:audit.filter(x=>!x.definitions.some(d=>d.bodyMatchesLive)).map(x=>({signature:x.signature,candidates:x.definitions}))},null,2))
