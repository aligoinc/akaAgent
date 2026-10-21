"""Read schema/index metadata only; build a faithful empty local fixture database."""
import json, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
linked = Path('/Users/lequangnhut/Repos/akaAgent')
assert (linked/'supabase/.temp/project-ref').read_text().strip() == 'cgjbsmqtfhqvttudyjzq'
tables = ['org_staff','auto_accounts','auto_account_contacts','zalo_users','zalo_groups','zalo_group_members','auto_account_contact_groups','auto_account_contact_group_members','auto_account_contact_group_member_origins','auto_account_contacts_dataset','auto_account_contacts_dataset_members','chat_zalo_account_organization','chat_zalo_account_user','category_item','auto_automation','auto_automation_detail','category_type','auto_content_groups','auto_data_group_recipients','auto_content_group_recipients','auto_campaigns','auto_campaign_actions','auto_campaign_details','auto_campaign_input_data','auto_group_share_recipients']
names = ','.join("'"+t+"'" for t in tables)
sql = f"""BEGIN READ ONLY; SET LOCAL statement_timeout='10s';
SELECT c.relname name,
 (SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod)) ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped) columns,
 (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid)) FROM pg_index i WHERE i.indrelid=c.oid) indexes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ({names}); COMMIT;"""
with tempfile.TemporaryDirectory() as d:
 p=Path(d)/'q.sql';p.write_text(sql)
 r=subprocess.run(['supabase','db','query','--linked','--file',str(p),'--output','json'],cwd=linked,check=True,capture_output=True,text=True,timeout=60)
rows=json.loads(r.stdout)['rows']
(ROOT/'migrations/snapshots/column-filters-v421/schema.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print([(r['name'],len(r['columns'])) for r in rows])
