"""Real expensive RPC cancellation and recovery; all writes roll back on local fixtures."""
import json,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
cmd=['/opt/homebrew/bin/psql','-X','-qAt','-h','127.0.0.1','-p','55421','-d','column_filters','-v','ON_ERROR_STOP=1']
query="SELECT public.aka_agent_read_filtered_remarketing_v1(10,1,'owner','fixture','{\"accountId\":3,\"limit\":100,\"columnFilters\":{\"version\":1,\"filters\":[]}}');"
started=time.perf_counter()
r=subprocess.run(cmd,input="SET ROLE anon; SET statement_timeout='20ms'; "+query,text=True,capture_output=True,timeout=10)
elapsed=time.perf_counter()-started
assert r.returncode and 'statement timeout' in r.stderr and elapsed<1,(r.stderr,elapsed)
# A million historic detail rows with a narrow recent date available. No persistent fixture change.
# psql continues after the deliberate cancelled statement so ROLLBACK/recovery can be checked.
columns=json.loads((root/'migrations/snapshots/column-filters-v421/schema.json').read_text())
columns=next(t['columns'] for t in columns if t['name']=='auto_campaign_details')
select=','.join('d.id+100000*n' if c['name']=='id' else "d.created_at-n*interval '1 year'" if c['name']=='created_at' else 'd."'+c['name']+'"' for c in columns)
sql=rf"""DO $$ BEGIN IF inet_server_port()<>55421 OR current_database()<>'column_filters' THEN RAISE EXCEPTION 'local only';END IF;END $$;
BEGIN; INSERT INTO public.auto_campaign_details SELECT {select} FROM public.auto_campaign_details d CROSS JOIN generate_series(1,9) n;
SET LOCAL ROLE anon; SET LOCAL statement_timeout='3s';
\timing on
\set ON_ERROR_STOP off
{query}
ROLLBACK;
\set ON_ERROR_STOP on
SET ROLE anon; SET statement_timeout='3s';
{query.replace('"limit":100','"dateFrom":"2026-10-10","dateTo":"2026-10-10","limit":1')}
"""
started=time.perf_counter();large=subprocess.run(cmd,input=sql,text=True,capture_output=True,timeout=60);elapsed_large=time.perf_counter()-started
assert large.returncode==0,large.stderr
assert not any(word in large.stderr for word in ['syntax error','permission denied','duplicate key']),large.stderr
assert 'statement timeout' in large.stderr,(large.stderr,large.stdout[-1500:])
recovered=[json.loads(line) for line in large.stdout.splitlines() if line.startswith('{')]
assert recovered and recovered[-1]['total']==10000 and len(recovered[-1]['rows'])==1
result={'real_query_20ms_timeout_seconds':round(elapsed,4),'million_history_broad_query':'cancelled at database statement timeout 3s','rollback_and_narrow_recovery':True,'total_fixture_test_seconds':round(elapsed_large,3),'timings':[line for line in large.stdout.splitlines() if line.startswith('Time:')]}
(root/'scripts/column-filters/timeout-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
