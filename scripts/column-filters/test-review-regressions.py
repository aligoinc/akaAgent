"""Review regressions on synthetic localhost fixtures; every fixture edit rolls back."""
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PSQL = ['/opt/homebrew/bin/psql', '-X', '-qAt', '-h', '127.0.0.1', '-p', '55421',
        '-d', 'column_filters', '-v', 'ON_ERROR_STOP=1']
checks = []


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def run(statement, setup='', error=None):
    sql = """DO $$ BEGIN IF inet_server_port()<>55421 OR current_database()<>'column_filters'
    THEN RAISE EXCEPTION 'local fixture only'; END IF; END $$;
    BEGIN; SET LOCAL statement_timeout='10s';
    """ + setup + "\nSET LOCAL ROLE anon;\n" + statement + ';\nROLLBACK;'
    result = subprocess.run(PSQL, input=sql, text=True, capture_output=True, timeout=15)
    if error:
        assert result.returncode and error in result.stderr, result.stderr
        return
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip())


def call(source, filters=None, **query):
    q = {'columnFilters': {'version': 1, 'filters': filters or []}, 'limit': 10, **query}
    if source == 'data_group':
        rpc = 'group'; q.setdefault('groupId', 1); args = ''
    elif source == 'remarketing':
        rpc = source; q.setdefault('accountId', 3); args = ''
    else:
        rpc = 'contacts'; q.setdefault('accountId', 1); args = literal(source) + ','
    return "public.aka_agent_read_filtered_" + rpc + "_v1(10,1,'owner','fixture'," + args + literal(json.dumps(q, ensure_ascii=False)) + '::jsonb)'


def check(name, condition=True):
    assert condition, name
    checks.append(name)


tokens = ['__PREDICATE__', '__CURSOR__', '__OFFSET__', '__LIMIT__', '__COUNT__',
          '__MATERIALIZED__', "O'Brien %_\\ $3 %1$s", "x') OR true --"]
for token in tokens:
    setup = 'UPDATE auto_account_contacts SET name=' + literal(token) + ' WHERE id IN (1,300001);'
    for source in ['contacts', 'upload', 'data_group', 'remarketing']:
        ids = [90001] if source == 'remarketing' else [1000001] if source == 'data_group' else [1]
        result = run('SELECT ' + call(source, [{'field': 'name', 'op': 'eq', 'value': token}], ids=ids), setup)
        check(source + ' literal ' + repr(token), result['total'] == 1 and len(result['rows']) == 1)
    # Cursor text must remain literal, including tokens that occur later in the SQL template.
    setup += "UPDATE auto_account_contacts SET name=CASE id WHEN 2 THEN '0' ELSE 'zzz' END WHERE id IN(2,3);"
    first = run('SELECT ' + call('contacts', ids=[1, 2, 3], limit=1), setup)
    after = run('SELECT ' + call('contacts', ids=[1, 2, 3], limit=1, after=first['after'], countMode='none'), setup)
    offset = run('SELECT ' + call('contacts', ids=[1, 2, 3], limit=1, offset=1, countMode='none'), setup)
    check('cursor/offset parity ' + repr(token), after['rows'] == offset['rows'])

# Array values and text operators must also use parameters, not interpolation.
for op in ['in', 'contains', 'starts_with', 'neq', 'not_contains']:
    value = ['__LIMIT__'] if op == 'in' else '__LIMIT__'
    result = run('SELECT ' + call('contacts', [{'field': 'uid', 'op': op, 'value': value}], ids=[1])
                 if op != 'not_contains' else 'SELECT ' + call('contacts', [{'field': 'name', 'op': op, 'value': value}], ids=[1]),
                 "UPDATE auto_account_contacts SET uid='__LIMIT__',name='__LIMIT__' WHERE id=1;")
    check('bound operator ' + op, result['total'] == (0 if op in ['neq', 'not_contains'] else 1))

for source in ['contacts', 'data_group', 'remarketing']:
    valid = {'rank': 0, 'name': '', 'time': '1970-01-01T00:00:00Z', 'id': '1'} if source == 'contacts' else {'createdAt': '2026-01-01T00:00:00Z', 'id': '1'}
    malformed = [None, [], 'text', {}, {**valid, 'id': None}, {**valid, 'id': 1},
                 {**valid, 'id': '-1'}, {**valid, 'id': '9007199254740992'}]
    date_key = 'time' if source == 'contacts' else 'createdAt'
    malformed += [{**valid, date_key: None}, {**valid, date_key: 'infinity'}, {**valid, date_key: '2026-99-01T00:00:00Z'}]
    if source == 'contacts':
        malformed += [{**valid, 'rank': None}, {**valid, 'rank': 0.5}, {**valid, 'rank': 2147483648}, {**valid, 'name': None}]
    for index, cursor in enumerate(malformed):
        run('SELECT ' + call(source, [{'field': 'name', 'op': 'eq', 'value': '__CURSOR__'}], after=cursor), error='invalid_filter_cursor')
        check(source + ' rejects malformed cursor ' + str(index))

# Generated SQL depends only on field/operator shape, never on scalar/list values.
for field, op, left, right in [('name', 'eq', '__CURSOR__', "O'Brien"),
                              ('name', 'contains', '%_\\', '__LIMIT__'),
                              ('uid', 'in', ['0001'], ['__COUNT__', "O'Brien"]),
                              ('memberCount', 'gte', 0, 100),
                              ('friendship', 'in', ['friend'], ['unknown'])]:
    args = [literal(json.dumps({'version': 1, 'filters': [{'field': field, 'op': op, 'value': value}]})) + '::jsonb' for value in [left, right]]
    stmt = "RESET ROLE; SELECT to_jsonb(private.column_filter_predicate_v1('contacts'," + args[0] + ") = private.column_filter_predicate_v1('contacts'," + args[1] + '))'
    check('SQL independent of values ' + field + '/' + op, run(stmt) is True)

# Keep the existing authorization boundary even when marker-like values are present.
run('SELECT ' + call('contacts', [{'field': 'name', 'op': 'eq', 'value': '__CURSOR__'}], accountId=2), error='account_access_denied')
run('SELECT ' + call('data_group', [{'field': 'name', 'op': 'eq', 'value': '__CURSOR__'}], groupId=2), error='group_access_denied')
check('other-owner account and group denied')

# Status cases mirror the existing getMemberStatus renderer behavior.
matrix = [
    ('phone', 'facebook', True, None, None), ('email', 'facebook', False, None, None),
    ('page', 'facebook', None, None, None), ('campaign_input', None, None, None, None),
    ('group', 'facebook', None, True, 'joined'), ('group', 'facebook', None, False, 'not_joined'),
    ('group', 'facebook', None, None, 'not_joined'),
    ('person', 'facebook', True, None, 'friend'), ('person', 'facebook', False, None, 'stranger'),
    ('person', 'facebook', None, None, 'unknown'), ('person', 'zalo', True, None, 'friend'),
    ('person', 'zalo', None, None, 'stranger'),
]
sql_value = lambda v: 'NULL' if v is None else 'true' if v is True else 'false' if v is False else literal(v)
setup = '\n'.join('UPDATE auto_account_contacts SET contact_type=' + sql_value(t) + ',flatform_type=' + sql_value(p)
                   + ',is_friend=' + sql_value(friend) + ',is_joined=' + sql_value(joined) + ' WHERE id=' + str(i) + ';'
                   for i, (t, p, friend, joined, _) in enumerate(matrix, 1))
for status in [None, 'friend', 'stranger', 'unknown', 'joined', 'not_joined']:
    condition = {'field': 'status', 'op': 'empty'} if status is None else {'field': 'status', 'op': 'in', 'value': [status]}
    result = run('SELECT ' + call('data_group', [condition], ids=list(range(1000001, 1000013)), limit=20), setup)
    expected = {1000000 + i for i, item in enumerate(matrix, 1) if item[4] == status}
    check('status display parity ' + str(status), result['total'] == len(expected) and {r['id'] for r in result['rows']} == expected)
# Generic search must retain all ten legacy phone aliases, even when the first is populated.
phone_keys = ['phone', 'phoneNumber', 'phone_number', 'mobilePhone', 'mobile_phone']
phone_values = ['0901234567', '0987654321', '0912345678', '0923456789', '0934567890',
                '0945678901', '0956789012', '0967890123', '0978901234', '0990123456']
phones = dict(zip(phone_keys, phone_values[:5]))
phones['rawPayload'] = dict(zip(phone_keys, phone_values[5:]))
phone_setup = "UPDATE auto_account_contacts SET name='Khách kiểm thử SĐT',extra_data=" + literal(json.dumps(phones)) + "::jsonb WHERE id IN(1,2,3,300001,300002,300003);"
for source, scope, ids in [
    ('contacts', {}, [1, 2, 3]),
    ('upload', {'datasetId': 1}, [1, 2, 3]),
    ('group_members', {'accountId': 3, 'zaloGroupId': 'g1'}, [300001, 300002, 300003]),
]:
    for index, value in enumerate(phone_values):
        result = run('SELECT ' + call(source, search=value, ids=ids[:1], **scope), phone_setup)
        check(source + ' searches phone alias ' + str(index), result['total'] == 1 and [r['id'] for r in result['rows']] == ids[:1])
    for label, value in [('absent phone', '0888888888'), ('name', 'KHÁCH KIỂM THỬ'), ('uid', 'z1' if source == 'group_members' else '0001')]:
        result = run('SELECT ' + call(source, search=value, ids=ids[:1], **scope), phone_setup)
        expected = [] if label == 'absent phone' else ids[:1]
        check(source + ' generic search ' + label, result['total'] == len(expected) and [r['id'] for r in result['rows']] == expected)
    # Searching a secondary phone must combine with the displayed phone's column condition.
    for value, expected_count in [(phone_values[0], 1), (phone_values[1], 0)]:
        result = run('SELECT ' + call(source, [{'field': 'phone', 'op': 'eq', 'value': value}], search=phone_values[1], ids=ids[:1], **scope), phone_setup)
        check(source + ' secondary search with column phone ' + value, result['total'] == expected_count and len(result['rows']) == expected_count)
    for label, empty in [('missing', {}), ('null', {**dict.fromkeys(phone_keys), 'rawPayload': dict.fromkeys(phone_keys)}),
                         ('blank', {**dict.fromkeys(phone_keys, '  '), 'rawPayload': dict.fromkeys(phone_keys, '')})]:
        setup = 'UPDATE auto_account_contacts SET extra_data=' + literal(json.dumps(empty)) + '::jsonb WHERE id=' + str(ids[0]) + ';'
        result = run('SELECT ' + call(source, search=phone_values[1], ids=ids[:1], **scope), setup)
        check(source + ' phone search ignores ' + label, result['total'] == 0 and not result['rows'])
    first_page = run('SELECT ' + call(source, search=phone_values[-1], ids=ids, limit=1, **scope), phone_setup)
    second_page = run('SELECT ' + call(source, search=phone_values[-1], ids=ids, limit=1, after=first_page['after'], countMode='none', **scope), phone_setup)
    offset_page = run('SELECT ' + call(source, search=phone_values[-1], ids=ids, limit=1, offset=1, countMode='none', **scope), phone_setup)
    check(source + ' secondary phone count/cursor', first_page['total'] == 3 and first_page['hasMore'] and second_page['total'] is None and len(second_page['rows']) == 1 and second_page['rows'] == offset_page['rows'] and second_page['rows'][0]['id'] != first_page['rows'][0]['id'])
    result = run('SELECT ' + call(source, search=phone_values[-1], ids=ids, excludeIds=ids[:1], **scope), phone_setup)
    check(source + ' secondary phone ID exclusions', result['total'] == 2 and {r['id'] for r in result['rows']} == set(ids[1:]))

result = {'checks': len(checks), 'passed': checks, 'production_changed': False}
(ROOT / 'scripts/column-filters/review-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'checks': len(checks), 'all_passed': True, 'production_changed': False}))
