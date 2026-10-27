"""Compare captured live bodies against tracked repository migration definitions."""
import json,re,subprocess,difflib
from pathlib import Path
base=Path('migrations/snapshots/staff-rls');patches=json.loads((base/'runtime-patches.json').read_text())
files=subprocess.check_output(['rg','--files','migrations','supabase/migrations'],text=True).splitlines()
files=[p for p in files if p.endswith('.sql') and 'staff_rls_' not in p and '/snapshots/' not in p]
contents={p:Path(p).read_text() for p in files};dates={}
def date(p):
 if p not in dates:dates[p]=subprocess.check_output(['git','log','-1','--format=%ct','--',p],text=True).strip() or '0'
 return int(dates[p])
def identity(header):
 text=header[header.index('(')+1:];parts=[];current='';depth=0;quoted=False
 for c in text:
  if c=="'":quoted=not quoted
  if not quoted:
   if c=='(':depth+=1
   elif c==')':
    if depth==0:parts.append(current);break
    depth-=1
   elif c==',' and depth==0:parts.append(current);current='';continue
  current+=c
 types=[]
 for p in parts:
  p=re.split(r'\bDEFAULT\b|=',p,flags=re.I)[0].strip()
  tokens=p.split()
  if tokens and tokens[0].lower() in ('in','inout','variadic'):tokens=tokens[1:]
  if tokens and tokens[0].startswith('p_'):tokens=tokens[1:]
  t=' '.join(tokens).lower()
  t={'timestamptz':'timestamp with time zone','int':'integer','int8':'bigint','bool':'boolean'}.get(t,t)
  types.append(t)
 return ','.join(types)
rows=[];diffs=[]
for f in patches:
 name=f['signature'].split('(')[0]
 mentions=[p for p,s in contents.items() if re.search(r'\b'+re.escape(name)+r'\b',s)]
 candidates=[]
 for p in mentions:
  for m in re.finditer(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?'+name+r'\s*\(',contents[p],re.I):
   rest=contents[p][m.start():];tag=re.search(r'\$(?:\w+)?\$',rest)
   if tag:
    end=rest.find(tag.group(),tag.end())
    if end>=0 and identity(rest)==f['signature'].split('(',1)[1][:-1]:candidates.append((p,rest[:end+len(tag.group())]))
 version=lambda p:int(re.search(r'migration_v(\d+)',p).group(1)) if re.search(r'migration_v(\d+)',p) else None
 newest=max(candidates,key=lambda v:version(v[0])) if candidates and all(version(v[0]) is not None for v in candidates) else max(candidates,key=lambda v:date(v[0])) if candidates else None
 def body(s):
  m=re.search(r'\$(?:\w+)?\$',s);return s[m.end():s.rfind(m.group())].strip() if m else s
 live=body(f['definition'])
 exact=next((p for p,s in candidates if body(s)==live),None)
 entry={'signature':f['signature'],'sourceChecksum':f['checksum'],'mentions':mentions,'newestDefinitionFile':newest[0] if newest else None,'matchingBodyFile':exact,'transformation':'Only staff relation and its row lock moved to scoped helper/view; original invoker, predicates, other locks, ACL and configuration retained.'}
 if newest:
  delta=list(difflib.unified_diff(body(newest[1]).splitlines(),live.splitlines(),fromfile=newest[0],tofile='captured live '+f['signature'],lineterm=''))
  entry['newestBodyDiffLines']=len(delta)
  if delta:diffs.extend(delta+[''])
 rows.append(entry)
(base/'repository-audit.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
(base/'repository-vs-live.diff').write_text('\n'.join(diffs)+'\n')
print(json.dumps({'functions':len(rows),'newestExact':sum(r.get('newestBodyDiffLines')==0 for r in rows),'matchingBodyFound':sum(bool(r['matchingBodyFile']) for r in rows),'missingDefinition':sum(not r['newestDefinitionFile'] for r in rows)}))
