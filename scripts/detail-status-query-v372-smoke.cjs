// In-memory Postgres fixture; no production writes, campaigns or network actions.
const assert = require('node:assert/strict'), path = require('node:path')
const v = require('./detail-status-query-v372.cjs')
const { PGlite } = require(process.env.PGLITE_MODULE || require.resolve('@electric-sql/pglite', { paths: [v.root, path.resolve(v.root, '../akaAgentChatApi')] }))
const q = value => value == null ? 'NULL' : typeof value === 'number' ? String(value) : v.quote(value)
async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE TABLE auto_campaigns(id bigint PRIMARY KEY, staff_id bigint, organization_id bigint);
      CREATE TABLE auto_status(id bigint PRIMARY KEY,code text,name text,status_value text,color text,is_active boolean,is_delete boolean);
      CREATE TABLE auto_accounts(id bigint PRIMARY KEY,flatform_type text,is_zalo_show_web boolean);
      CREATE TABLE auto_campaign_details(id bigint PRIMARY KEY,campaign_id bigint,is_delete boolean,status text,status_id bigint,sub_status_id bigint,
        created_at timestamptz NOT NULL,action_name text,action_code text,error_code text,log text,post_url text,data jsonb,account_id bigint);
      CREATE TABLE auto_campaign_detail_zalo_engagement(campaign_detail_id bigint PRIMARY KEY,seen_at timestamptz,responded_at timestamptz,reacted_at timestamptz,friended_at timestamptz);
      CREATE FUNCTION auto_assert_automation_identity(bigint,bigint,text,text) RETURNS void LANGUAGE plpgsql AS $$
        BEGIN IF $1 IS DISTINCT FROM 1 OR $2 IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'identity_denied'; END IF; END $$;
      INSERT INTO auto_campaigns VALUES(1,1,10),(2,2,20),(3,1,10);
      INSERT INTO auto_accounts VALUES(1,'zalo',false),(2,'facebook',false);
      INSERT INTO auto_status VALUES
        (1,'success','Thành công','thành công','green',true,false),
        (2,'waiting','Chờ duyệt bài','chờ duyệt bài','gray',true,false),
        (3,'alias','Thành công','other value',NULL,false,true),
        (4,'quoted','Don''t','don''t',NULL,true,false),
        (5,'wildcard','100%_ok','100%_ok',NULL,true,false);
      INSERT INTO auto_campaign_details(id,campaign_id,is_delete,status,status_id,sub_status_id,created_at,account_id) VALUES
        (1,1,false,'thành công',NULL,NULL,'2026-10-01',1),
        (2,1,false,'thành công',1,2,'2026-10-01',1),
        (3,1,false,'different',1,1,'2026-10-01',1),
        (4,1,false,NULL,NULL,2,'2026-10-01',1),
        (5,1,false,'chờ duyệt bài',2,2,'2026-10-01',1),
        (6,1,false,'THÀNH CÔNG',NULL,NULL,'2026-10-01',1),
        (7,1,false,'thành công',1,1,'2026-10-01',1),
        (8,1,false,'unrelated',3,NULL,'2026-10-01',1),
        (9,1,true,'thành công',1,2,'2026-10-01',1),
        (10,2,false,'thành công',1,2,'2026-10-01',1),
        (11,1,false,'legacy only',NULL,NULL,'2026-10-01',1),
        (12,1,false,'opaque',NULL,4,'2026-10-01',1),
        (13,1,false,NULL,NULL,NULL,'2026-10-01',1);
      INSERT INTO auto_campaign_details
      SELECT 100+n,CASE WHEN n%19=0 THEN 2 ELSE 1 END,n%13=0,
        (ARRAY['thành công','thất bại','chờ duyệt bài',NULL,'legacy only','THÀNH CÔNG'])[1+n%6],
        CASE WHEN n%5<>0 THEN 1+n%5 END,CASE WHEN n%3<>0 THEN 1+(n*7)%5 END,
        '2026-10-02'::timestamptz+interval '1 hour'*(n/3),
        (ARRAY['gửi tin',NULL,'chờ duyệt bài'])[1+n%3],
        CASE WHEN n%7<>0 THEN 'zalo_message_friend' END,
        CASE WHEN n%11=0 THEN 'example_error' END,
        CASE WHEN n%7=0 THEN 'original log' END,
        CASE WHEN n%17=0 THEN 'https://example.test/post' END,
        CASE WHEN n%7=0 THEN '{"partialSend":true}'::jsonb END,1+n%2
      FROM generate_series(1,120)n;
      INSERT INTO auto_campaign_detail_zalo_engagement
      SELECT id,CASE WHEN id%2=0 THEN created_at END,CASE WHEN id%3=0 THEN created_at END,
        CASE WHEN id%5=0 THEN created_at END,CASE WHEN id%7=0 THEN created_at END
      FROM auto_campaign_details WHERE id%4<>0;
    `)
    const cases = []
    function add(version, args = {}) {
      const a = {staff:1,org:10,campaign:1,search:null,status:null,from:null,to:null,offset:0,limit:100,sort:'created_desc',engagement:null,...args}
      const values = [a.staff,a.org,a.campaign,a.search,a.status,a.from,a.to,a.offset,a.limit,a.sort,null,null]
      if (version === 2) values.push(a.engagement)
      cases.push({ version, args:a, sql:`SELECT public.aka_agent_list_campaign_details_page${version===2?'_v2':''}(${values.map(q)}) result` })
    }
    for(const version of [1,2]) {
      for(const status of [null,'','  ','thành công','THÀNH CÔNG',' ThÀNH CÔNG ','chờ duyệt bài','other value','legacy only','unknown',"don't", "x'); DROP TABLE auto_status;--",'100%_ok']) {
        for(const search of [null,'chờ duyệt','original','%','_']) for(const sort of ['created_asc','created_desc']) add(version,{status,search,sort})
      }
      for(const offset of [0,1,5,100,1000,2147483647,null]) for(const limit of [1,2,100,500,null]) add(version,{status:'thành công',offset,limit})
      for(const status of ['thành công','chờ duyệt bài']) for(const dates of [[null,'2026-10-02'],['2026-10-02',null],['2026-10-02','2026-10-02'],['2026-11-01','2026-11-02']]) add(version,{status,from:dates[0],to:dates[1]})
      add(version,{campaign:3})
      add(version,{search:'x'.repeat(201),status:'x'.repeat(121)})
      for(const args of [{staff:2},{org:20},{campaign:2},{campaign:0},{campaign:null},{offset:-1},{limit:0},{limit:501},{sort:'id'},{from:'2026-10-02',to:'2026-10-01'}]) add(version,args)
    }
    for(const engagement of ['all','seen','responded','reacted','friended','none','invalid']) for(const status of [null,'thành công','chờ duyệt bài']) add(2,{engagement,status,limit:3,offset:2})
    async function run(c) {
      try { return {value:(await db.query(c.sql)).rows[0].result} }
      catch(e) { return {error:e.message,code:e.code} }
    }
    await db.exec(v.before.functions.map(f=>f.definition+';').join('\n'))
    const baseline=[]
    for(const c of cases) baseline.push(await run(c))
    // Direct expectations, not only an equality comparison against old code.
    const manual = status => `SELECT public.aka_agent_list_campaign_details_page(1,10,1,NULL,${q(status)},NULL,'2026-10-01',0,100,'created_asc',NULL,NULL) result`
    for(const phase of ['before','after']) {
      if(phase==='after') await db.exec(v.targets.map(f=>f.definition+';').join('\n'))
      for(const [status,ids] of [['thành công',[1,2,3,7,8]],['chờ duyệt bài',[2,4,5]],['legacy only',[11]],["don't",[12]],['unknown',[]]]) {
        const result=(await db.query(manual(status))).rows[0].result
        assert.equal(result.total,ids.length,phase+': '+status)
        assert.deepEqual(result.items.map(x=>x.id),ids,phase+': '+status)
      }
    }
    for(let i=0;i<cases.length;i++) assert.deepEqual(await run(cases[i]),baseline[i],JSON.stringify(cases[i]))
    const result={at:new Date().toISOString(),migration_sha256:v.hash(v.migration),cases:cases.length,explicit_overlap_checks:10,matching_errors:baseline.filter(x=>x.error).length,passed:true,production_writes:0}
    v.save('local-smoke.json',result)
    console.log(result)
  } finally { await db.close() }
}
main().catch(e=>{console.error(e);process.exitCode=1})
