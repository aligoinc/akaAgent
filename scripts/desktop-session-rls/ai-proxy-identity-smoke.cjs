// Disposable PostgreSQL only: synthetic staff/Auth rows; no remote DB calls.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process')
const root=path.resolve(__dirname,'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-ai-sql-'))
const bin=process.env.DESKTOP_TEST_PG_BIN||'/opt/homebrew/opt/postgresql@17/bin'
const run=(name,args,input)=>{const r=spawnSync(path.join(bin,name),args,{input,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim()}
const sql=s=>run('psql',['-X','-h',tmp,'-p','55494','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],s)
const migration=fs.readFileSync(path.join(root,'migrations/migration_v434_desktop_ai_proxy_identity.sql'),'utf8')
const baseline=require('../../migrations/snapshots/desktop-session-rls/ai-proxy-identity-preflight.json').function
const uid='00000000-0000-4000-8000-000000000001',sid='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003'
run('initdb',['-D',path.join(tmp,'db'),'-A','trust','-U','postgres','--encoding=UTF8','--locale=C'])
run('pg_ctl',['-D',path.join(tmp,'db'),'-l',path.join(tmp,'log'),'-o',`-h '' -k ${tmp} -p 55494`,'-w','start'])
try {
 sql(`CREATE SCHEMA private; CREATE SCHEMA auth; CREATE ROLE service_role; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE aka_agent_desktop;
 CREATE TABLE public.org_organization(id bigint PRIMARY KEY,use_staff_expiration boolean);
 CREATE TABLE public.org_staff(id bigint PRIMARY KEY,organization_id bigint,is_active boolean,deleted_at timestamptz,expiration_date timestamptz);
 CREATE TABLE private.aka_agent_desktop_users(staff_id bigint,auth_user_id uuid);
 CREATE TABLE auth.users(id uuid,role text,raw_app_meta_data jsonb);
 CREATE TABLE auth.sessions(id uuid,user_id uuid);
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 ${baseline.definition};
 INSERT INTO org_organization VALUES(10,false); INSERT INTO org_staff VALUES(1,10,true,NULL,NULL);
 INSERT INTO auth.users VALUES('${uid}','aka_agent_desktop','{"aka_agent_desktop":true}');
 INSERT INTO auth.sessions VALUES('${sid}','${uid}'); INSERT INTO private.aka_agent_desktop_users VALUES(1,'${uid}');`)
 const digest=()=>sql("SELECT md5(pg_get_functiondef('public.aka_agent_staff_time_allowed(bigint)'::regprocedure))")
 assert.equal(digest(),baseline.checksum)
 const body=migration.replace(/^BEGIN;\n/m,'').replace(/^COMMIT;\n/m,'')
 assert.throws(()=>sql(`BEGIN; ALTER FUNCTION public.aka_agent_staff_time_allowed(bigint) SET statement_timeout='1s'; ${body} ROLLBACK;`),/Staff time guard changed/)
 sql(migration.replace(/^COMMIT;$/m,'ROLLBACK;'))
 assert.equal(sql("SELECT to_regprocedure('public.aka_agent_desktop_ai_identity(uuid,uuid)')"),'')
 sql(migration)
 const call=(u=uid,s=sid)=>sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.aka_agent_desktop_ai_identity('${u}','${s}'); ROLLBACK;`)
 assert.deepEqual(JSON.parse(call()),{staffId:1,organizationId:10})
 assert.equal(call(other),''); assert.equal(call(uid,other),'')
 for(const role of ['anon','authenticated','aka_agent_desktop'])assert.throws(()=>sql(`SET ROLE ${role}; SELECT public.aka_agent_desktop_ai_identity('${uid}','${sid}');`),/permission denied/)
 for(const mutation of ["UPDATE org_staff SET is_active=false", "UPDATE org_staff SET deleted_at=now()", "UPDATE auth.users SET role='authenticated'", "UPDATE auth.users SET raw_app_meta_data='{}'", "DELETE FROM auth.sessions"]){
  assert.equal(sql(`BEGIN; ${mutation}; SET LOCAL ROLE service_role; SELECT public.aka_agent_desktop_ai_identity('${uid}','${sid}'); ROLLBACK;`),'')
 }
 assert.equal(digest(),baseline.checksum)
 assert.throws(()=>sql(migration),/already exists/)
 console.log(sql("SELECT json_build_object('signature','public.aka_agent_desktop_ai_identity(uuid,uuid)','checksum',md5(pg_get_functiondef(oid)),'owner',pg_get_userbyid(proowner),'securityDefiner',prosecdef,'volatility',provolatile,'config',proconfig,'acl',proacl) FROM pg_proc WHERE oid='public.aka_agent_desktop_ai_identity(uuid,uuid)'::regprocedure"))
 console.log('PASS 14 SQL identity/role/revocation/drift/DDL rollback cases; existing helper unchanged; no production access')
} finally {run('pg_ctl',['-D',path.join(tmp,'db'),'-m','immediate','-w','stop']);fs.rmSync(tmp,{recursive:true,force:true})}
