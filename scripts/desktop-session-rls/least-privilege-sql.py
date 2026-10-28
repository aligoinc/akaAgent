"""Read-only dependency audit using PostgreSQL's parser (pglast).

SECURITY DEFINER is a privilege boundary: its body runs as its owner, so callers
do not need table grants or EXECUTE on its internal helpers. Invoker bodies and
triggers do need those privileges. Unknown dynamic SQL fails the audit.
"""
import json, os, re
from collections import defaultdict
from pathlib import Path
from pglast.parser import parse_plpgsql_json, parse_sql_json

ROOT = Path(__file__).resolve().parents[2]
DIR = ROOT / 'migrations/snapshots/desktop-session-rls'
read = lambda name: json.loads((DIR/name).read_text())
live = read('least-privilege-preflight.json')
source = read('least-privilege-source.json')
assert not source['unresolved']
functions = {}
def canonical(sig):
    for schema in ('public','private'):
        while sig.startswith(schema+'.'+schema+'.'): sig=sig[len(schema)+1:]
    return sig if sig.startswith(('public.','private.')) else 'public.'+sig
for name in ['fixture-public-functions.json', 'dependency-functions.json', 'entry-functions.json',
             'inbound-functions.json', 'invoker-functions.json', 'trigger-invoker-functions.json',
             'trigger-function-dependencies.json', 'private-runtime-dependencies.json']:
    for f in read(name):
        sig = canonical(f['signature'])
        functions[sig] = dict(f, signature=sig)
for f in read('fixture-schema.json')['private_functions']:
    sig = canonical(f['signature'])
    functions[sig] = dict(f, signature=sig)
private_security_dir = Path(os.environ.get('AKA_AGENT_PRIVATE_SECURITY_DIR') or
                            Path.home() / '.codex/incident-recovery/akaAgent-ip-block').resolve()
private_hook = private_security_dir / 'migrations/snapshots/desktop-session-rls/pre-request-preflight.json'
if not private_hook.is_file():
    raise FileNotFoundError('Set AKA_AGENT_PRIVATE_SECURITY_DIR to the external security archive: ' + str(private_hook))
functions['public.aka_agent_block_denied_ip_request()'] = json.loads(private_hook.read_text()).get('function', {})
live_functions = {f['signature']:f for f in live['functions']}
relations = {t['schema']+'.'+t['name']:t for t in live['relations'] if t['kind'] != 'S'}
by_name = defaultdict(list)
for sig, f in live_functions.items(): by_name[f['schema']+'.'+f['name']].append(sig)
tables, needed, processed, errors, dynamic = {}, {}, set(), [], []
schema_dependencies=read('least-privilege-schema-dependencies.json')

def add_table(name, operation, reason, columns=None):
    if name not in relations: return
    t = tables.setdefault(name, {})
    p = t.setdefault(operation, {'reasons':set(), 'columns':set(), 'all_columns':False})
    p['reasons'].add(reason)
    if columns is None: p['all_columns'] = True
    else: p['columns'].update(columns)

def nodes(value):
    if isinstance(value, dict):
        yield value
        for v in value.values(): yield from nodes(v)
    elif isinstance(value,list):
        for v in value: yield from nodes(v)

def sql_tree(query, signature, parse_mode=0):
    if not query or not query.strip(): return None
    # parseMode 2 = expression; PL/pgSQL assignments use modes 3..5.
    if parse_mode >= 3:
        match = re.match(r'^[\w.\[\]]+\s*(?::=|=)\s*(.*)$', query, re.S)
        if match: query = match.group(1)
    if parse_mode >= 2: query = 'SELECT '+query
    try: return json.loads(parse_sql_json(query))
    except Exception as e:
        errors.append({'function':signature,'query':query,'error':str(e)})
        return None

def relation_name(r):
    return (r.get('schemaname') or 'public')+'.'+r.get('relname','')

def walk_sql_tree(tree, reason):
    for n in nodes(tree):
        for kind,op in [('InsertStmt','INSERT'),('UpdateStmt','UPDATE'),('DeleteStmt','DELETE')]:
            if kind not in n: continue
            stmt=n[kind]; relation=relation_name(stmt['relation'])
            cols=None
            if op in ('INSERT','UPDATE'):
                cols=[x['ResTarget']['name'] for x in stmt.get('cols' if op=='INSERT' else 'targetList',[]) if 'ResTarget' in x and 'name' in x['ResTarget']]
                if not cols: cols=None
            add_table(relation,op,reason,cols)
            conflict=stmt.get('onConflictClause',{})
            if conflict.get('action') == 'ONCONFLICT_UPDATE':
                add_table(relation,'UPDATE',reason,[x['ResTarget']['name'] for x in conflict.get('targetList',[])])
        if 'RangeVar' in n: add_table(relation_name(n['RangeVar']),'SELECT',reason)
        if 'FuncCall' in n:
            parts=[v['String']['sval'] for v in n['FuncCall']['funcname']]
            names=['.'.join(parts)] if len(parts)>1 else ['public.'+parts[0],'private.'+parts[0]]
            for name in names:
                for child in by_name.get(name,[]): walk_function(child,reason)

def parse_body(f):
    text=f['definition']; trees=[]
    if re.search(r'LANGUAGE plpgsql', text, re.I):
        # libpg_query emits an extra brace for its empty trigger-variable datum
        # placeholders. Remove only that invalid empty-node serialization; the
        # SQL expression strings and statement tree remain untouched.
        try: proc=json.loads(parse_plpgsql_json(text).replace('{}},','{},'))
        except Exception as e:
            errors.append({'function':f['signature'],'error':str(e),'query':'[PL/pgSQL parse]'});return []
        for node in nodes(proc):
            if any(k in node for k in ['PLpgSQL_stmt_dynexecute','PLpgSQL_stmt_dynfors','PLpgSQL_stmt_dynforc']):
                dynamic.append({'function':f['signature'],'statement':node})
            if 'PLpgSQL_expr' in node:
                expr=node['PLpgSQL_expr']; tree=sql_tree(expr.get('query'), f['signature'], expr.get('parseMode',0))
                if tree: trees.append(tree)
    elif re.search(r'LANGUAGE sql',text,re.I):
        match=re.search(r'AS (\$\w*\$)([\s\S]*)\1',text)
        if match:
            tree=sql_tree(match.group(2),f['signature'])
            if tree: trees.append(tree)
        else: errors.append({'function':f['signature'],'error':'SQL body not found'})
    return trees

def walk_function(sig, reason, execute=True):
    if sig not in live_functions: errors.append({'function':sig,'error':'missing live function'});return
    if execute: needed.setdefault(sig,set()).add(reason)
    if sig in processed: return
    processed.add(sig)
    meta=live_functions[sig]
    # C/internal functions have no application-table dependencies.
    if meta['security_definer'] or meta['language'] not in ('sql','plpgsql'):return
    f=functions.get(sig)
    if not f or not f.get('definition'):
        errors.append({'function':sig,'error':'uncaptured invoker body'});return
    if f['checksum'] != meta['checksum']:
        errors.append({'function':sig,'error':'live definition checksum differs'});return
    for tree in parse_body(f):
        walk_sql_tree(tree,sig)

bootstrap=set(re.findall(r"'([a-z][a-z0-9_]+)'",(ROOT/'src/main/data/supabaseClient.ts').read_text().split('const bootstrapRpcs = new Set([')[1].split('])')[0]))
assert 'selects' in source, 'Refresh source inventory including PostgREST embedded selects'
for selection in source['selects']:
    if selection['serverOnly']: continue
    for relation in selection['relations']:
        assert 'public.'+relation in relations, 'Unresolved embedded relation: '+relation
        add_table('public.'+relation, 'SELECT', selection['location']+' embedded select')
for r in source['records']:
    if r['serverOnly']: continue
    if r['method']=='from':
        for op in r['operations']:
            payloads=[p for p in r['payloads'] if p['operation'].upper()==op or p['operation']=='upsert']
            cols=None if not payloads or any(p['columns'] is None for p in payloads) else sorted(set(c for p in payloads for c in p['columns']))
            add_table('public.'+r['name'],op,r['location'],cols)
    else:
        if r['name'] in bootstrap: continue  # The transport deliberately uses anon for these guarded RPCs.
        matches=[sig for sig in by_name.get('public.'+r['name'],[]) if live_functions[sig]['desktop_execute']]
        # New bootstrap readers are used without a Desktop Authorization header.
        for sig in matches: walk_function(sig,r['location'])

# Gateway hook is invoked before every PostgREST query, including bootstrap.
hook='public.aka_agent_block_denied_ip_request()'
needed.setdefault(hook,set()).add('PostgREST db-pre-request')

# Invoker triggers inherit the writer's role. Iterate because a trigger may
# introduce additional writes, which themselves fire another invoker trigger.
triggers=schema_dependencies['triggers']
while True:
    before=len(processed)
    for t in triggers:
        table=t['schema']+'.'+t['relation']
        writes=set(tables.get(table,{})) & {'INSERT','UPDATE','DELETE'}
        if not writes or t['security_definer'] or t['enabled']=='D':continue
        sig=canonical(t['signature'])
        if any(re.search(r'\b'+op+r'\b',t['definition']) for op in writes): walk_function(sig,'trigger '+t['name']+' on '+table,execute=False)
    for name,ops in list(tables.items()):
        if 'INSERT' in ops:
            for col in relations[name]['columns']:
                if col['default']:
                    tree=sql_tree(col['default'],'default '+name+'.'+col['name'],2)
                    if tree: walk_sql_tree(tree,'default '+name+'.'+col['name'])
        if set(ops)&{'INSERT','UPDATE'}:
            for constraint in schema_dependencies['constraints']:
                if constraint['schema']+'.'+constraint['table']!=name or constraint['type']!='c':continue
                tree=sql_tree('ALTER TABLE '+name+' ADD CONSTRAINT "audited_check" '+constraint['definition'],'constraint '+name+'.'+constraint['name'])
                if tree: walk_sql_tree(tree,'constraint '+name+'.'+constraint['name'])
        for policy in live['policies']:
            if policy['schemaname']+'.'+policy['tablename']!=name or not set(policy['roles'])&{'public','aka_agent_desktop'}:continue
            if policy['cmd']!='ALL' and policy['cmd'] not in ops:continue
            for expression in ['qual','with_check']:
                if policy[expression]:
                    tree=sql_tree(policy[expression],'policy '+name+'.'+policy['policyname'],2)
                    if tree: walk_sql_tree(tree,'policy '+name+'.'+policy['policyname'])
    if len(processed)==before:break

result={'tables':{name:{op:{**v,'columns':sorted(v['columns']),'reasons':sorted(v['reasons'])} for op,v in sorted(ops.items())} for name,ops in sorted(tables.items())},
        'functions':{sig:sorted(reasons) for sig,reasons in sorted(needed.items())},'analyzed_functions':sorted(processed),'errors':errors,'dynamic':dynamic}
(DIR/'least-privilege-dependencies.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'tables':len(tables),'functions':len(needed),'errors':errors,'dynamic_functions':sorted(set(x['function'] for x in dynamic))},ensure_ascii=False,indent=2))
