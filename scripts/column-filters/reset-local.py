"""Reset only the disposable local fixture created for this task, then verify rollback and apply locally."""
import subprocess,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
base=['/opt/homebrew/bin/psql','-X','-qAt','-h','127.0.0.1','-p','55421','-v','ON_ERROR_STOP=1']
def run(sql,db='column_filters'):
 result=subprocess.run(base+['-d',db],input='SET ROLE postgres;\n'+sql,text=True,capture_output=True)
 if result.returncode:raise RuntimeError(result.stderr)
 return result.stdout
identity=run("SELECT host(inet_server_addr())||':'||inet_server_port()||':'||current_setting('data_directory');",'postgres').strip()
assert identity=='127.0.0.1:55421:/tmp/aka-column-filters-pg-20261021',identity
run('DROP DATABASE column_filters;', 'postgres')
run("CREATE DATABASE column_filters TEMPLATE template0 LOCALE_PROVIDER icu ICU_LOCALE 'und';",'postgres')
subprocess.run(['python3',str(root/'scripts/column-filters/bootstrap-local.py')],check=True)
migration=(root/'migrations/migration_v421_data_column_filters.sql').read_text()
run(migration.replace('COMMIT;','ROLLBACK;'))
assert run("SELECT to_regprocedure('public.aka_agent_read_filtered_group_v1(bigint,bigint,text,text,jsonb)') IS NULL;").strip()=='t'
run(migration)
for file in ['fixtures.sql','scan-fixtures.sql']:run((root/'scripts/column-filters'/file).read_text())
print('Local candidate transaction rollback, clean apply and synthetic fixture load passed.')
