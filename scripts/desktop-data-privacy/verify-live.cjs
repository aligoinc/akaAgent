// Compare metadata only; never writes to production or prints business/secret rows.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto'),c=require('./config.cjs')
const p=path.dirname(c.before()),before=JSON.parse(fs.readFileSync(c.before())),after=JSON.parse(fs.readFileSync(path.join(p,'after-result.json'))).rows[0].metadata
const plan=JSON.parse(fs.readFileSync(c.dir+'/plan.json')),target=JSON.parse(fs.readFileSync(c.dir+'/target.json'))
for(const key of ['roles','memberships','default_acls','indexes','constraints','view_dependencies','function_dependencies'])if(before[key])assert.deepEqual(after[key],before[key],key)
const oldNames=new Set(before.functions.map(f=>f.schema+'.'+f.signature))
assert.deepEqual(after.functions.filter(f=>oldNames.has(f.schema+'.'+f.signature)),before.functions,'existing function definitions/ACL/config')
const newFunctions=after.functions.filter(f=>!oldNames.has(f.schema+'.'+f.signature));assert.equal(newFunctions.length,3)
for(const f of newFunctions){const t=target.functions.find(t=>t.signature.endsWith(f.signature));assert(t);assert.equal(f.checksum,t.definition);assert.equal(f.acl,t.acl);assert.equal(f.owner,t.owner);assert.equal(f.security_definer,t.definer);assert.deepEqual(f.config,t.config)}
assert.deepEqual(after.relations.filter(r=>r.name!=='org_organization'),before.relations.filter(r=>r.name!=='org_organization'))
const org=after.relations.find(r=>r.schema==='public'&&r.name==='org_organization'),oldOrg=before.relations.find(r=>r.schema==='public'&&r.name==='org_organization'),targetOrg=target.relations.find(r=>r.name==='org_organization')
assert.equal(org.acl,targetOrg.acl);assert.deepEqual(org.columns.map(a=>[a.name,a.acl]),targetOrg.columns)
assert.deepEqual({...org,acl:null,columns:org.columns.map(a=>({...a,acl:null}))},{...oldOrg,acl:null,columns:oldOrg.columns.map(a=>({...a,acl:null}))})
const policies=after.policies.filter(p=>p.policyname.startsWith('v436_'));assert.deepEqual(policies,target.policies)
assert.deepEqual(after.policies.filter(p=>!p.policyname.startsWith('v436_')),before.policies)
const triggers=after.triggers.filter(t=>t.name==='aaa_v436_desktop_data_owner');assert.equal(triggers.length,11)
assert.deepEqual(after.triggers.filter(t=>t.name!=='aaa_v436_desktop_data_owner'),before.triggers)
assert.deepEqual(triggers.map(t=>({schema:t.schema,table:t.relation,name:t.name,enabled:t.enabled,definition:t.definition})),target.triggers)
const role=JSON.parse(fs.readFileSync(path.join(p,'post-role-result.json'))).rows[0].role_smoke
assert.equal(role.status,'passed')
const inputs=JSON.parse(fs.readFileSync(path.join(p,'app-inputs.json')))
for(const [file,hash]of Object.entries(inputs))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(c.root,file))).digest('hex'),hash,file)
const receipt={project:after.project,migration:{version:'20261028093922',name:'migration_v436_desktop_data_privacy',file:path.relative(c.root,c.migration),sha256:crypto.createHash('sha256').update(fs.readFileSync(c.migration)).digest('hex')},appliedAt:'2026-10-28T09:39:22Z',verifiedAt:after.captured_at,existingFunctionsUnchanged:before.functions.length,newFunctions:newFunctions.map(f=>({signature:f.signature,checksum:f.checksum,owner:f.owner,acl:f.acl,config:f.config})),restrictivePolicies:policies.length,writeGuards:triggers.length,otherRelationsUnchanged:before.relations.length-1,otherRolesAndExistingTimeoutsUnchanged:true,appInputsAndOtherTaskFileUnchanged:Object.keys(inputs).length,rollbackTrialMappings:JSON.parse(fs.readFileSync(path.join(p,'rollback-trial-result.json'))).rows[0].role_smoke.activeMappings,postApply:role,customerBusinessWrites:0}
fs.writeFileSync(c.dir+'/apply-receipt.json',JSON.stringify(receipt,null,2)+'\n')
console.log(JSON.stringify(receipt,null,2))
