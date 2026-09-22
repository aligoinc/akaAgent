"""Linked production smoke, opt-in. Creates an isolated tenant and deletes it in finally.
Uses the existing Supabase Management HTTP API through CLI; no SQL client/pool.
"""
import argparse, concurrent.futures, json, pathlib, subprocess, tempfile, time, uuid
parser=argparse.ArgumentParser();parser.add_argument('--linked',action='store_true',required=True);parser.parse_args()
assert pathlib.Path('supabase/.temp/project-ref').read_text().strip()=='cgjbsmqtfhqvttudyjzq'
marker='__v305_concurrency_'+uuid.uuid4().hex
fixture=None
with tempfile.TemporaryDirectory(prefix='akaagent-staff-concurrency-') as folder:
 def query(sql):
  path=pathlib.Path(folder)/(uuid.uuid4().hex+'.sql');path.write_text(sql);path.chmod(0o600)
  result=subprocess.run(['supabase','db','query','--linked','--file',str(path)],capture_output=True,text=True)
  if result.returncode: raise RuntimeError(result.stderr)
  return json.loads(result.stdout)['rows']
 def rpc(action,payload):
  body=json.dumps(payload,ensure_ascii=False).replace("'","''")
  return "public.aka_agent_staff_management(%d,'%s','123456','%s','%s'::jsonb)"%(fixture['staff'],fixture['username'],action,body)
 def operation(action,payload,hold=0):
  sql="""BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='12s';
DO $worker$ DECLARE r jsonb; BEGIN BEGIN
 r:=%s; PERFORM pg_sleep(%s);
 EXCEPTION WHEN raise_exception THEN r:=jsonb_build_object('error',SQLERRM); END;
 PERFORM set_config('staff.smoke_response',r::text,true); END; $worker$;
 SELECT current_setting('staff.smoke_response')::jsonb AS result; COMMIT;"""%(rpc(action,payload),hold)
  return query(sql)[0]['result']
 def race(action,payloads):
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   jobs=[pool.submit(operation,action,p,0.8) for p in payloads]
   return [job.result() for job in jobs]
 def request(**values): return dict(values,requestId=str(uuid.uuid4()))
 try:
  fixture=query("""DO $fixture$ DECLARE c bigint;o bigint;s bigint;g bigint;u text; BEGIN
 INSERT INTO public.aka_customer(name) VALUES('%s') RETURNING id INTO c;
 INSERT INTO public.org_organization(customer_id,name,phone,max_staff,staff_id_created,staff_id_owner)
 SELECT c,'%s','0999999320',2,id,id FROM public.org_staff WHERE organization_id=1 AND is_admin IS TRUE LIMIT 1 RETURNING id INTO o;
 INSERT INTO public.org_staff(organization_id,name,phone,is_admin) VALUES(o,'Admin test','0999999320',true) RETURNING id,username INTO s,u;
 PERFORM set_config('staff.fixture',jsonb_build_object('customer',c,'org',o,'staff',s,'group',g,'username',u)::text,true);
 END; $fixture$; SELECT current_setting('staff.fixture')::jsonb AS fixture;"""%(marker,marker))[0]['fixture']
  assert all(isinstance(fixture[k],int) and fixture[k]>0 for k in ['customer','org','staff'])
  results=race('saveGroup',[request(name='First department '+str(i),parentId=None) for i in range(2)])
  assert all('id' in r for r in results),results
  roots=query('SELECT id,name FROM org_group WHERE organization_id=%d AND parent_id IS NULL'%fixture['org'])
  assert len(roots)==1 and roots[0]['name']==marker,roots
  fixture['group']=roots[0]['id']
  assert query('SELECT count(*) n FROM org_group WHERE organization_id=%d AND parent_id=%d'%(fixture['org'],fixture['group']))[0]['n']==2
  print('PASS concurrent first departments: one canonical organization root')
  # Simulate the Chat API create path using its exact shared advisory lock.
  # The independent Desktop request must wait, then reuse Chat's new root.
  query('DELETE FROM org_group WHERE organization_id=%d AND parent_id IS NOT NULL'%fixture['org'])
  query('DELETE FROM org_group WHERE organization_id=%d'%fixture['org'])
  chat_create="""BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='12s';
 SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-chat:workspace-staff:%d',0));
 DO $chat$ DECLARE r bigint; BEGIN
 SELECT id INTO r FROM org_group WHERE organization_id=%d AND parent_id IS NULL ORDER BY id LIMIT 1;
 IF r IS NULL THEN INSERT INTO org_group(organization_id,name) VALUES(%d,'%s') RETURNING id INTO r; END IF;
 INSERT INTO org_group(organization_id,name,parent_id) VALUES(%d,'Chat department',r);
 PERFORM pg_sleep(0.8); END; $chat$; COMMIT;"""%(fixture['org'],fixture['org'],fixture['org'],marker,fixture['org'])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   chat_job=pool.submit(query,chat_create)
   desktop_job=pool.submit(operation,'saveGroup',request(name='Desktop department',parentId=None),0.8)
   chat_job.result();assert 'id' in desktop_job.result()
  roots=query('SELECT id FROM org_group WHERE organization_id=%d AND parent_id IS NULL'%fixture['org'])
  assert len(roots)==1,roots
  fixture['group']=roots[0]['id']
  assert query('SELECT count(*) n FROM org_group WHERE organization_id=%d AND parent_id=%d'%(fixture['org'],fixture['group']))[0]['n']==2
  print('PASS simultaneous Chat/Desktop creation reuses the same root')
  results=race('saveStaff',[request(name='Quota '+str(i),phone='099999932'+str(i+1),groupId=fixture['group']) for i in range(2)])
  assert sum(r.get('error')=='staff_quota_full' for r in results)==1,results
  assert sum('id' in r for r in results)==1,results
  row=next(r for r in results if 'id' in r)
  assert query('SELECT count(*) used FROM org_staff WHERE organization_id=%d AND deleted_at IS NULL'%fixture['org'])[0]['used']==2
  print('PASS concurrent last staff slot: exactly one creation')
  query('UPDATE org_organization SET max_staff=5 WHERE id=%d'%fixture['org'])
  results=race('saveStaff',[request(name='Duplicate '+str(i),phone='0999999325' if i==0 else '+84999999325',groupId=fixture['group']) for i in range(2)])
  assert sum(r.get('error')=='staff_phone_exists' for r in results)==1,results
  assert sum('id' in r for r in results)==1,results
  print('PASS concurrent normalized phone: exactly one creation')
  results=race('saveStaff',[request(id=row['id'],name='CAS '+str(i),phone=row['phone'],groupId=fixture['group'],expectedVersion=row['version']) for i in range(2)])
  assert sum(r.get('error')=='staff_conflict' for r in results)==1,results
  print('PASS concurrent staff edit: stale writer rejected')
  query("UPDATE org_staff SET aka_agent_device_fingerprint_hash=repeat('a',64) WHERE id=%d"%row['id'])
  devices=operation('prepareDevices',{'ids':[row['id']]})
  old=request(targets=[{'id':row['id'],'expectedVersion':devices['items'][0]['version']}])
  assert operation('resetDevices',old).get('count')==1
  query("UPDATE org_staff SET aka_agent_device_fingerprint_hash=repeat('b',64) WHERE id=%d"%row['id'])
  assert operation('resetDevices',old).get('count')==1
  assert operation('resetDevices',dict(old,requestId=str(uuid.uuid4()))).get('error')=='staff_conflict'
  assert query("SELECT aka_agent_device_fingerprint_hash=repeat('b',64) preserved FROM org_staff WHERE id=%d"%row['id'])[0]['preserved']
  print('PASS cross-transaction device revision and idempotent replay preserve newer binding')
  # Two different staff may be nominated at once; only one remains manager.
  candidates=query('SELECT public.aka_agent_staff_management_row(id) r FROM org_staff WHERE organization_id=%d AND is_admin IS NOT TRUE ORDER BY id LIMIT 2'%fixture['org'])
  assert len(candidates)==2
  candidate_rows=[item['r'] for item in candidates]
  manager_requests=[request(id=c['id'],name=c['name'],phone=c['phone'],groupId=fixture['group'],isDepartmentManager=True,expectedVersion=c['version']) for c in candidate_rows]
  results=race('saveStaff',manager_requests)
  assert all('id' in r for r in results),results
  managers=query('SELECT staff_id FROM org_group_staff WHERE organization_id=%d AND group_id=%d AND is_admin IS TRUE'%(fixture['org'],fixture['group']))
  assert len(managers)==1 and managers[0]['staff_id'] in [c['id'] for c in candidate_rows],managers
  print('PASS concurrent Desktop nominations retain exactly one department manager')
  # Exercise Chat's transaction lock + delete/replace/insert membership contract.
  # Reset only this synthetic group's flags so each candidate starts ordinary.
  query('UPDATE org_group_staff SET is_admin=false WHERE organization_id=%d'%fixture['org'])
  desktop_candidate=query('SELECT public.aka_agent_staff_management_row(%d) r'%candidate_rows[0]['id'])[0]['r']
  chat_candidate=candidate_rows[1]
  chat_manager="""BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='12s';
 SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-chat:workspace-staff:%d',0));
 DELETE FROM org_group_staff WHERE organization_id=%d AND staff_id=%d;
 UPDATE org_group_staff SET is_admin=false WHERE organization_id=%d AND group_id=%d AND is_admin IS TRUE;
 INSERT INTO org_group_staff(organization_id,staff_id,group_id,is_admin) VALUES(%d,%d,%d,true);
 SELECT pg_sleep(0.8); COMMIT;"""%(fixture['org'],fixture['org'],chat_candidate['id'],fixture['org'],fixture['group'],fixture['org'],chat_candidate['id'],fixture['group'])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   chat_job=pool.submit(query,chat_manager)
   desktop_job=pool.submit(operation,'saveStaff',request(id=desktop_candidate['id'],name=desktop_candidate['name'],phone=desktop_candidate['phone'],groupId=fixture['group'],isDepartmentManager=True,expectedVersion=desktop_candidate['version']),0.8)
   chat_job.result();assert 'id' in desktop_job.result()
  assert query('SELECT count(*) n FROM org_group_staff WHERE organization_id=%d AND group_id=%d AND is_admin IS TRUE'%(fixture['org'],fixture['group']))[0]['n']==1
  print('PASS concurrent Chat/Desktop nominations share the lock and retain one manager')
  # The blocking transaction revokes the actor while another mutation waits.
  blocker="BEGIN; SET LOCAL application_name='%s_revoke'; SELECT pg_advisory_xact_lock(hashtextextended('aka-agent-staff-management:%d',0)); UPDATE org_staff SET is_admin=false WHERE id=%d; SELECT pg_sleep(3); COMMIT;"%(marker,fixture['org'],fixture['staff'])
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   held=pool.submit(query,blocker)
   # Wait until the blocker actually starts on the server; CLI startup order
   # is nondeterministic and must not decide the expected business result.
   deadline=time.monotonic()+15
   while not held.done():
    visible=query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='%s_revoke' AND wait_event='PgSleep') ready"%marker)[0]['ready']
    if visible: break
    if time.monotonic()>deadline: raise RuntimeError('revoke barrier did not start')
    time.sleep(0.05)
   waiting=pool.submit(operation,'saveGroup',request(name='Must not create',parentId=None))
   held.result();result=waiting.result()
  assert result.get('error')=='staff_access_denied',result
  assert query("SELECT count(*) n FROM org_group WHERE organization_id=%d AND name='Must not create'"%fixture['org'])[0]['n']==0
  print('PASS live admin revocation across waiting mutation')
 finally:
  if fixture:
   # Fixtures never have campaigns/products. Their insert trigger creates SMS
   # accounts. Suppress row/FK triggers only in this cleanup transaction to avoid
   # full scans of the existing 13 GB run-event table (unindexed account FK).
   cleanup=f"""BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM org_organization WHERE id={fixture['org']} AND name='{marker}' AND customer_id={fixture['customer']})
 OR NOT EXISTS(SELECT 1 FROM aka_customer WHERE id={fixture['customer']} AND name='{marker}')
 OR EXISTS(SELECT 1 FROM auto_campaigns WHERE organization_id={fixture['org']})
 OR EXISTS(SELECT 1 FROM org_organization_product WHERE organization_id={fixture['org']})
 OR EXISTS(SELECT 1 FROM auto_accounts WHERE organization_id={fixture['org']} AND flatform_type<>'sms')
 THEN RAISE EXCEPTION 'fixture cleanup ownership/activity mismatch'; END IF;
END; $guard$;
SET LOCAL session_replication_role='replica';
DELETE FROM auto_staff_management_requests WHERE organization_id={fixture['org']};
DELETE FROM org_group_staff WHERE organization_id={fixture['org']};
DELETE FROM org_group WHERE organization_id={fixture['org']};
DELETE FROM auto_accounts WHERE organization_id={fixture['org']};
DELETE FROM org_staff WHERE organization_id={fixture['org']};
DELETE FROM org_organization WHERE id={fixture['org']};
DELETE FROM aka_customer WHERE id={fixture['customer']} AND name='{marker}';
SET LOCAL session_replication_role='origin'; COMMIT;"""
   query(cleanup)
   assert query("SELECT count(*) n FROM org_organization WHERE id=%d"%fixture['org'])[0]['n']==0
   print('PASS isolated fixture cleanup')
