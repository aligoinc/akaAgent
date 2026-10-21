"""Start the isolated local-only fixture server. No credentials or remote endpoints."""
import os,subprocess
from pathlib import Path
bin=Path('/opt/homebrew/bin');data=Path('/tmp/aka-column-filters-pg-20261021')
if not data.exists():
 subprocess.run([str(bin/'initdb'),'-D',str(data),'-A','trust','--no-locale','-E','UTF8'],check=True,stdout=subprocess.DEVNULL)
status=subprocess.run([str(bin/'pg_ctl'),'-D',str(data),'status'],capture_output=True)
if status.returncode:
 subprocess.run([str(bin/'pg_ctl'),'-D',str(data),'-l',str(data)+'.log','-o','-p 55421 -k /tmp -h 127.0.0.1','start'],check=True)
psql=[str(bin/'psql'),'-X','-qAt','-h','127.0.0.1','-p','55421','-d','postgres','-v','ON_ERROR_STOP=1']
sql="""DO $$ BEGIN IF current_setting('data_directory')<>'/tmp/aka-column-filters-pg-20261021' THEN RAISE EXCEPTION 'local fixture only';END IF;END $$;
DO $$ BEGIN CREATE ROLE postgres SUPERUSER;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
SELECT 'CREATE DATABASE column_filters' WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='column_filters') \gexec
"""
subprocess.run(psql,input=sql,text=True,check=True)
print('Local fixture ready on 127.0.0.1:55421; run reset-local.py to rebuild.')
