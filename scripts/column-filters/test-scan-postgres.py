import concurrent.futures,json,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
cmd=['/opt/homebrew/bin/psql','-X','-qAt','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1']
checks=[]
def read(source,filters=[],**scope):
 q={'accountId':3 if source in ['group_members','remarketing'] else 1,'limit':3,'columnFilters':{'version':1,'filters':filters},**scope}
 arg=json.dumps(q,ensure_ascii=False).replace("'","''")
 fn='aka_agent_read_filtered_remarketing_v1' if source=='remarketing' else 'aka_agent_read_filtered_contacts_v1'
 src='' if source=='remarketing' else "'"+source+"',"
 started=time.perf_counter();r=subprocess.run(cmd,input=f"SET ROLE anon; SET statement_timeout='3s'; SELECT public.{fn}(10,1,'owner','fixture',{src}'{arg}'::jsonb);",text=True,capture_output=True,timeout=10)
 if r.returncode:raise RuntimeError(r.stderr)
 return json.loads(r.stdout),time.perf_counter()-started

def check(name,condition):assert condition,name;checks.append(name)
a,_=read('contacts');check('contacts count',a['total']==100000)
b,_=read('contacts',[{'field':'name','op':'contains','value':'NGUYỄN ánh'}]);check('contacts Vietnamese',b['total']==1000)
b,_=read('contacts',[{'field':'friendship','op':'in','value':['friend']}]);check('contact status',b['total']==50000)
b,_=read('upload',[{'field':'info2','op':'contains','value':'%_'}],datasetId=1);check('upload literal and dataset order',b['total']==14285 and b['rows'][0]['id']==99995)
b,_=read('contacts',after=a['after'],countMode='none');check('contact cursor order',b['rows']==read('contacts',offset=3,countMode='none')[0]['rows'])
a,_=read('group_members',zaloGroupId='g1');check('members scope/order/identity',a['total']==10000 and a['rows'][0]['id']==300001 and a['rows'][0]['extra_data']['zaloGroupRole']=='owner')
b,_=read('group_members',[{'field':'role','op':'in','value':['admin']}],zaloGroupId='g1');check('role before count',b['total']==2)
b,_=read('group_members',[{'field':'zaloTags','op':'in','value':['vip']}],zaloGroupId='g1');check('tags before count',b['total']==5000)
b,_=read('group_members',[{'field':'gender','op':'in','value':['female']}],zaloGroupId='g1');check('gender',b['total']==5000)
b,_=read('group_members',[{'field':'phone','op':'eq','value':'0900000001'}],zaloGroupId='g1');check('phone matches displayed normalization',b['total']==1)
a,_=read('remarketing');check('recipient grouping',a['total']==10000 and a['rows'][0]['id']==100000 and a['rows'][0]['extra_data']['sentCount']==10)
check('latest metadata',a['rows'][0]['extra_data']['latestCampaignActionId']=='zalo_message_phone' and a['rows'][0]['extra_data']['groupName']=='Nhóm lớn')
b,_=read('remarketing',campaignActionIds=['zalo_message_friend']);check('source scope before aggregate',b['rows'][0]['extra_data']['sentCount']==9 and b['rows'][0]['id']==90000)
b,_=read('remarketing',[{'field':'sentCount','op':'gte','value':10}],campaignActionIds=['zalo_message_friend']);check('column filter after aggregate',b['total']==0)
b,_=read('remarketing',dateFrom='',dateTo='');check('empty history dates are optional',b['total']==10000)
b,_=read('remarketing',dateFrom='2026-10-10',dateTo='2026-10-10');check('Vietnam history date scope',b['rows'][0]['extra_data']['sentCount']==1)
b,_=read('remarketing',[{'field':'latestAction','op':'in','value':['zalo_message_friend']}]);check('latest action is not historical source action',b['total']==0)
b,_=read('remarketing',[{'field':'sentCount','op':'between','value':10,'to':10},{'field':'recipientStatus','op':'eq','value':'Bạn bè'}]);check('AND combined recipient filters',b['total']==5000)
b,_=read('remarketing',campaignActionIds=[]);check('explicit empty action scope',b['total']==0)
b,_=read('remarketing',after=a['after'],countMode='none');check('remarketing cursor',b['rows']==read('remarketing',offset=3,countMode='none')[0]['rows'])
perf={}
for label,source,scope in [('contacts','contacts',{}),('upload','upload',{'datasetId':1}),('group_members','group_members',{'zaloGroupId':'g1'}),('remarketing','remarketing',{}),
                         ('contacts_search','contacts',{'search':'0987654321'}),('upload_search','upload',{'datasetId':1,'search':'0987654321'}),('group_members_search','group_members',{'zaloGroupId':'g1','search':'0987654321'})]:
 times=[read(source,limit=100,**scope)[1] for _ in range(6)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:concurrent_times=list(pool.map(lambda _:read(source,limit=100,**scope)[1],range(6)))
 perf[label]={'max_seconds':round(max(times),4),'two_read_max_seconds':round(max(concurrent_times),4)}
result={'checks':checks,'performance':perf,'gate':all(max(p.values())<2 for p in perf.values()),'fixture':{'contacts':100000,'group_members':10000,'history':100000,'recipients':10000}}
(ROOT/'scripts/column-filters/scan-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False,indent=2));assert result['gate'],'performance gate failed'
