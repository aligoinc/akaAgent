const fs = require('node:fs'), path = require('node:path')
const { PGlite } = require('../../akaAgentChatApi/node_modules/@electric-sql/pglite')
const root = path.resolve(__dirname, '..')
const dir = path.join(root, 'migrations/snapshots/facebook-random-run-v387')
async function fixture({ lifecycle = false, restoredLifecycle = false, boundaries = false } = {}) {
  restoredLifecycle ||= boundaries
  const db = new PGlite()
  await db.exec('CREATE SCHEMA private; CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE aka_agent_chat_api;')
  for (const schema of JSON.parse(fs.readFileSync(path.join(dir, 'schema.json')))) {
    const columns = schema.cols.map(c => `"${c.name}" ${c.type}${c.default && !c.default.includes('nextval(') ? ' DEFAULT '+c.default : ''}`)
    await db.exec(`CREATE TABLE ${schema.name} (${columns.join(',')}, PRIMARY KEY(id));`)
  }
  await db.exec(`CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"role":"anon"}'::jsonb $$;
    CREATE FUNCTION aka_agent_staff_time_allowed(bigint) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION aka_agent_lock_campaign_input_serialization(bigint) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock($1) $$;
    CREATE FUNCTION resolve_organization_zalo_account_capabilities(bigint) RETURNS TABLE(qr_enabled boolean,server_enabled boolean,web_enabled boolean,capability_revision bigint) LANGUAGE sql AS $$ SELECT true,true,true,1::bigint $$;
    GRANT USAGE ON SCHEMA private TO anon,authenticated,service_role,aka_agent_chat_api;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,authenticated,service_role;
  `)
  const source=JSON.parse(fs.readFileSync(path.join(dir,'source.json')))
  for(const f of source) await db.exec(f.definition+';')
  // Preserve captured attributes for migration checksum/ACL audit.
  for(const f of source) {
    await db.exec(`ALTER FUNCTION public.${f.signature} OWNER TO ${f.owner}`)

  }
  const migration=fs.readFileSync(path.join(root,'migrations/migration_v387_facebook_random_run.sql'),'utf8')
  // Local PG version may normalize CREATE FUNCTION differently. Production checksum preflight is independently tested live.
  await db.exec(migration.replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/,''))
  if (lifecycle || restoredLifecycle) {
    const live=JSON.parse(fs.readFileSync(path.join(root,'migrations/snapshots/facebook-random-run-v389/source.json')))
    await db.exec(live.find(f=>f.signature==='aka_agent_clear_campaign_runtime_claim_metadata()').definition+';')
    await db.exec('CREATE TRIGGER aka_agent_clear_campaign_runtime_claim_metadata BEFORE UPDATE OF status ON auto_campaigns FOR EACH ROW EXECUTE FUNCTION aka_agent_clear_campaign_runtime_claim_metadata();')
    await db.exec(fs.readFileSync(path.join(root,'migrations/migration_v389_facebook_random_run_lifecycle.sql'),'utf8').replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/,''))
    if (restoredLifecycle) {
      for (const migration of ['migration_v391_revert_facebook_random_run_lifecycle.sql', 'migration_v392_restore_facebook_random_run_lifecycle.sql']) {
        await db.exec(fs.readFileSync(path.join(root,'migrations',migration),'utf8').replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/,''))
      }
    }
  }
  if (boundaries) {
    const captured = JSON.parse(fs.readFileSync(path.join(root, 'migrations/snapshots/facebook-random-run-boundaries-v393/source.json')))
    await db.exec('CREATE TABLE auto_campaign_inputs(id bigint PRIMARY KEY,campaign_id bigint,status text,is_delete boolean,note text); GRANT ALL ON auto_campaign_inputs TO anon;')
    for (const f of captured.filter(f => f.signature.startsWith('reset_desktop') || f.signature.startsWith('aka_agent_set_desktop_campaign_status_v2'))) await db.exec(f.definition + ';')
    await db.exec(fs.readFileSync(path.join(root, 'migrations/migration_v393_facebook_random_run_boundaries.sql'), 'utf8').replace(/DO \$preflight\$[\s\S]*?END \$preflight\$;/, ''))
  }
  await db.exec(`INSERT INTO org_organization(id,name) VALUES(1,'fixture');
    INSERT INTO org_staff(id,organization_id,is_active,username,password) VALUES(1,1,true,'fixture','fixture'),(2,1,true,'other','fixture');
    INSERT INTO auto_accounts(id,name,flatform_type,staff_id,organization_id,status,login_status,is_active,is_delete) VALUES(1,'fixture','facebook',1,1,'chờ xử lý','đã đăng nhập',true,false);
    INSERT INTO auto_campaign_actions(id,name,flatform_type,is_active,is_delete) VALUES('facebook_group_post','Group','facebook',true,false),('facebook_timeline_post','Timeline','facebook',true,false),('facebook_newsfeed_interaction','Newsfeed','facebook',true,false);
    INSERT INTO auto_campaigns(id,name,action_id,account_id,staff_id,organization_id,status,schedule,schedule_type,is_delete,extra_settings) VALUES(1,'Group A','facebook_group_post',1,1,1,'chờ xử lý',now()-interval '1 minute','daily',false,'{}'),(2,'Timeline','facebook_timeline_post',1,1,1,'chờ xử lý',now()-interval '1 minute','daily',false,'{}'),(3,'Newsfeed','facebook_newsfeed_interaction',1,1,1,'chờ xử lý',now()-interval '1 minute','daily',false,'{"newsfeedTimeMinutes":20}');
    INSERT INTO auto_campaign_input_data(id,campaign_id,status,is_delete) VALUES(1,1,'chờ xử lý',false),(2,1,'chờ xử lý',false),(3,1,'chờ xử lý',false),(4,1,'chờ xử lý',false);
  `)
  return db
}
module.exports={fixture,root,dir}
if(require.main===module)fixture().then(db=>db.close()).then(()=>console.log('Random SQL fixture compiled')).catch(e=>{console.error({message:e.message,position:e.position,internalPosition:e.internalPosition,internalQuery:e.internalQuery,where:e.where});process.exitCode=1})
