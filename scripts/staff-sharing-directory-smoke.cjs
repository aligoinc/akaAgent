// Reuse the existing metadata-only PG17 fixture through its initial staff privacy cutover.
// All rows below are synthetic; never opens production or reads a customer token.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto')
module.exports=({sql,q,root,desktop,sharing,runAs,capture,ownQueries})=>{
 const dir=path.join(root,'migrations/snapshots/staff-sharing-directory')
 const source=JSON.parse(fs.readFileSync(path.join(dir,'before.json'))).function
 const migrationPath=path.join(root,'supabase/migrations/20261027180909_staff_sharing_directory.sql')
 const migration=fs.readFileSync(migrationPath,'utf8'),fn='public.aka_agent_group_sharing(bigint,bigint,text,text,text,jsonb)'
 let checks=0;const pass=s=>{checks++;console.log('PASS',s)}
 sql(`INSERT INTO org_staff(id,organization_id,name,username,password,is_active,is_policy_accepted) VALUES
  (4,10,'Inactive','inactive','fixture-only',false,true),(5,10,'Deleted','deleted','fixture-only',true,true);
  UPDATE org_staff SET deleted_at=now() WHERE id=5;
  INSERT INTO auto_content_groups(id,name,staff_id,organization_id,is_active,is_delete,sharing_scope,sharing_revision) VALUES(3,'Owned selected group',1,10,true,false,'selected',0);
  INSERT INTO auto_content_group_recipients(group_id,staff_id) VALUES(3,2);`)
 assert.equal(desktop(sharing('staff')),'[]')
 const ownBefore=ownQueries.map(x=>desktop(x)),allBefore=capture()
 const backendBefore=runAs('service_role',sharing('staff'))
 sql('BEGIN;'+migration+'COMMIT;')
 const people=JSON.parse(desktop(sharing('staff')))
 assert.deepEqual(people,[{id:2,name:'Bob Private'}])
 for(const p of people)assert.deepEqual(Object.keys(p).sort(),['id','name'])
 pass('directory returns exactly ID and display name; excludes self, inactive, deleted and other-org staff')
 assert.throws(()=>desktop("SELECT aka_agent_group_sharing(1,20,'alice','fixture-only','staff','{}')"),/automation_auth_invalid/)
 assert.throws(()=>desktop("SELECT aka_agent_group_sharing(2,10,'bob','fixture-only','staff','{}')"),/group_sharing_access_denied/)
 assert.throws(()=>desktop(sharing('staff'),{}),/group_sharing_access_denied/)
 pass('cannot change caller staff/org or omit token identity to broaden the directory')
 for(const p of people){
  assert.equal(desktop(`SELECT count(*) FROM aka_agent_staff_runtime_profile WHERE id=${p.id}`),'0')
  assert.equal(desktop(`SELECT count(*) FROM aka_agent_staff_runtime_scope(${p.id},'share')`),'0')
  assert.equal(desktop(`SELECT aka_agent_staff_time_allowed(${p.id})`),'f')
 }
 assert.throws(()=>desktop('SELECT username,phone,password FROM org_staff WHERE id=2'),/permission denied/)
 assert.throws(()=>desktop("SELECT aka_agent_staff_management(1,'alice','fixture-only','list','{}')"),/permission denied/)
 pass('knowing a returned staff ID does not permit username/phone/password/runtime reads or admin RPCs')
 const saved=JSON.parse(desktop(sharing('save',{kind:'content',groupId:3,scope:'selected',recipientIds:[2],expectedRevision:'0'})))
 assert.deepEqual(saved.recipientIds,[2]);assert.equal(saved.revision,'1')
 assert.throws(()=>desktop(sharing('save',{kind:'content',groupId:3,scope:'selected',recipientIds:[3],expectedRevision:'0'})),/invalid_group_sharing_recipients/)
 assert.throws(()=>desktop(sharing('save',{kind:'content',groupId:1,scope:'selected',recipientIds:[2],expectedRevision:'0'})),/group_sharing_owner_required/)
 assert.throws(()=>desktop(sharing('save',{kind:'content',groupId:3,scope:'selected',recipientIds:[2],expectedRevision:'99'})),/group_sharing_conflict/)
 pass('existing-client select/save contract works; owner, org and revision guards preserved')
 assert.deepEqual(ownQueries.map(x=>desktop(x)),ownBefore)
 assert.equal(runAs('service_role',sharing('staff')),backendBefore)
 pass('own-user runtime/data/sharing and trusted backend unchanged')
 const after=capture();const normalize=m=>({...m,functions:m.functions.map(f=>f.signature===source.signature?{...f,definition:undefined,checksum:undefined}:f)})
 assert.deepEqual(normalize(after),normalize(allBefore))
 pass('only the single sharing RPC body changed; all other metadata matches')
 const target=after.functions.find(f=>f.signature===source.signature)
 const rollback=`SET LOCAL lock_timeout='8s';\nDO $guard$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('${fn}') AND md5(pg_get_functiondef(oid))=${q(target.checksum)} AND proacl::text=${q(source.acl)} AND pg_get_userbyid(proowner)=${q(source.owner)}) THEN RAISE EXCEPTION 'sharing directory rollback source drift'; END IF; END $guard$;\n${source.definition};\nNOTIFY pgrst,'reload schema';\n`
 sql('BEGIN;'+rollback+'COMMIT;');assert.equal(desktop(sharing('staff')),'[]')
 assert.deepEqual(capture(),allBefore)
 pass('narrow rollback restores the empty picker without touching staff privacy functions or view')
 const changed=source.definition.replace("    IF private.aka_agent_staff_scope_for_request() IS NOT NULL THEN RETURN '[]'::jsonb; END IF;\n",'')
 assert.equal(target.checksum,crypto.createHash('md5').update(changed).digest('hex'))
 fs.writeFileSync(path.join(dir,'target.json'),JSON.stringify(target,null,2)+'\n')
 fs.writeFileSync(path.join(root,'migrations/rollback_staff_sharing_directory.sql'),rollback)
 fs.writeFileSync(path.join(dir,'local-test.json'),JSON.stringify({at:new Date().toISOString(),checks,status:'passed',target_checksum:target.checksum},null,2)+'\n')
 console.log(JSON.stringify({checks,status:'passed'}))
}
if(require.main===module){
 const Module=require('node:module'),filename=path.resolve(__dirname,'staff-self-access/smoke.cjs')
 const text=fs.readFileSync(filename,'utf8'),anchor=" sql('BEGIN;'+migration+'COMMIT;')"
 assert.equal(text.split(anchor).length,2,'fixture cutover anchor must remain unique')
 const prefix=text.slice(0,text.indexOf(anchor)+anchor.length)
 const body=prefix+'\nrequire('+JSON.stringify(__filename)+')({sql,q,root,desktop,sharing,runAs,capture,ownQueries});\n}finally{f.close()}\n'
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));mod._compile(body,filename)
}
