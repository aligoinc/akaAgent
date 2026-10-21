"""Correctness/security/performance gate against localhost:55421 synthetic fixtures only."""
import concurrent.futures,json,subprocess,time,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PSQL=['/opt/homebrew/bin/psql','-X','-qAt','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1']
def sql(text, timeout=20):
 start=time.perf_counter();r=subprocess.run(PSQL,input=text,text=True,capture_output=True,timeout=timeout)
 return r,time.perf_counter()-start

def read(filters=[],staff=10,**query):
 q={'groupId':1,'columnFilters':{'version':1,'filters':filters},'limit':10,**query}
 escaped=json.dumps(q,ensure_ascii=False).replace("'","''")
 username={10:'owner',11:'reader',12:'outsider'}.get(staff,'owner')
 r,elapsed=sql(f"SET ROLE anon; SET statement_timeout='3s'; SELECT public.aka_agent_read_filtered_group_v1({staff},{2 if staff==12 else 1},'{username}','fixture','{escaped}'::jsonb);")
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout),elapsed
checks=[]
def check(name,condition):
 assert condition,name;checks.append(name)

a,_=read();check('full total',a['total']==100000)
check('membership identity',all(r['id']!=r['contact_id'] for r in a['rows']))
b,_=read([{'field':'name','op':'contains','value':'nguyễn ánh'}]);check('Unicode casefold',b['total']==1000)
b,_=read([{'field':'info2','op':'contains','value':'%_'}]);check('literal wildcard',b['total']==14285)
b,_=read([{'field':'uid','op':'eq','value':'0001'}]);check('leading zero identifier',b['total']==1 and b['rows'][0]['contact_id']==1)
b,_=read([{'field':'info1','op':'empty'}]);check('trimmed empty',b['total']==5882)
b,_=read([{'field':'info1','op':'neq','value':'Khu vực 0'}]);check('negative excludes empty',b['total']==75294)
b,_=read([{'field':'name','op':'contains','value':"' OR true --"}]);check('SQL literal escaping',b['total']==0)
b,_=read([{'field':'source','op':'in','value':['automation']}]);check('primary source',b['total']==1000)
b,_=read(sourceCodes=['scan']);check('legacy any-source independent',b['total']==1)
b,_=read([{'field':'source','op':'in','value':['upload']}],sourceCodes=['scan']);check('primary source plus legacy scope',b['total']==1)
b,_=read([{'field':'status','op':'in','value':['friend']}]);check('boolean status',b['total']==50000)
b,_=read(idsOnly=True);check('ID-only reader uses membership IDs',all(set(row)=={'id'} for row in b['rows']) and b['total']==100000)
b,_=read(offset=100000);check('empty page preserves total',not b['rows'] and b['total']==100000)
b,_=read(staff=11);check('shared account name preserved',b['rows'][0]['source_account_name']=='Tài khoản A')
check('shared provenance redacted',all(not r['provenance'] and r['source_automation_name'] is None for r in b['rows']))
b,_=read([{'field':'automation','op':'contains','value':'Secret'}],staff=11);check('no filtering leak from hidden columns',b['total']==0)
b,_=read([{'field':'automation','op':'contains','value':'Secret'}]);check('owner automation',b['total']==1000)
b,_=read(after=a['after'],countMode='none');check('cursor no overlap',not {r['id'] for r in a['rows']} & {r['id'] for r in b['rows']})
check('cursor matches offset',b['rows']==read(offset=10,countMode='none')[0]['rows'])
for name,kw in [('cross tenant',{'staff':12}),('private other owner',{'groupId':2}),('unknown field',{'filters':[{'field':'password','op':'contains','value':'a'}]}),('invalid operation',{'filters':[{'field':'name','op':'gt','value':'a'}]}),('unknown enum',{'filters':[{'field':'status','op':'in','value':['x']}]}),('oversize page',{'limit':501})]:
 try:read(**kw)
 except RuntimeError:check(name,True)
 else:raise AssertionError(name)
r,_=sql("SET ROLE anon; SELECT private.column_filter_predicate_v1('data_group','{}');");check('helper not executable by anon',r.returncode!=0)
r,t=sql("SET ROLE anon; SET statement_timeout='150ms'; SELECT pg_sleep(1);");check('outer statement timeout',r.returncode!=0 and 'statement timeout' in r.stderr and t<1)
# Concurrent reads use the planned process-wide budget of two, not an unbounded flood.
cases={
 'all':[],
 'name_contains':[{'field':'name','op':'contains','value':'Khách'}],
 'mixed':[{'field':'status','op':'in','value':['friend']},{'field':'info1','op':'not_empty'},{'field':'name','op':'contains','value':'Khách'}],
 'automation':[{'field':'automation','op':'contains','value':'Secret'}]
}
perf={}
for name,filters in cases.items():
 times=[]
 for _ in range(8): times.append(read(filters,limit=100)[1])
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  concurrent_times=list(pool.map(lambda _:read(filters,limit=100)[1],range(8)))
 perf[name]={'max_seconds':round(sorted(times)[-1],4),'two_read_max_seconds':round(sorted(concurrent_times)[-1],4)}
result={'fixture_rows':100000,'checks':checks,'performance':perf,'gate':all(max(p.values())<2 for p in perf.values()),'environment':'PostgreSQL 16.15 local ICU und; metadata schema/indexes captured from PostgreSQL 17.6; no production rows or traffic; durations include psql startup'}
(ROOT/'scripts/column-filters/postgres-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
assert result['gate'],'performance gate failed'
