#!/usr/bin/env python3
"""Phát lại các lời gọi RPC ghi của V530 do API WebApp tạo ra, trên PostgreSQL cục bộ đã apply V530.

Đầu vào là scripts/fixtures/web-facebook-email-authoring-v530/api-rpc-calls.json, chép nguyên văn từ
akaAgentWebApp apps/api/src/modules/aka-agent-control/__fixtures__/v530-rpc-calls.json (bài
v530RpcContract.test.ts của API ghi lại bằng mã API thật). Bài này bắt lệch giữa hai tầng mà kiểm thử từng tầng
không thấy: tên hàm, tên tham số, khoá camelCase/snake_case trong p_campaign / p_campaign_patch, hình dạng dòng
data, kiểu tham số.

Mỗi lời gọi được dựng thành `select public.<hàm>(<tên tham số> => <giá trị>::<kiểu của hàm>)`, kiểu lấy từ pg_proc.
Id và mốc thời gian giữ chỗ trong file (900001…, 2001-…) được thay bằng giá trị thật do các bước trước tạo ra.
Sau mỗi bước còn kiểm dữ liệu đã ghi (tài khoản phụ, khoá do bộ chạy sở hữu, mật khẩu SMTP được giữ…).

Dùng: v530-api-contract-replay.py <psql> <thư mục socket> <cổng> <database> <file json>
"""
import json
import subprocess
import sys

psql_bin, sock_dir, port, database, calls_path = sys.argv[1:6]


def psql(sql):
    result = subprocess.run(
        [psql_bin, '-X', '-q', '-At', '-h', sock_dir, '-p', port, '-U', 'postgres', '-d', database,
         '-v', 'ON_ERROR_STOP=1', '-c', sql],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or 'psql failed')
    return result.stdout.strip()


def scalar_json(sql):
    out = psql(f'select to_jsonb(q) from ({sql}) q')
    return json.loads(out) if out else None


def quote(text):
    return "'" + str(text).replace("'", "''") + "'"


def literal(value, pg_type):
    if value is None:
        return f'NULL::{pg_type}'
    if pg_type in ('jsonb', 'json'):
        return f'{quote(json.dumps(value, ensure_ascii=False))}::{pg_type}'
    if pg_type.endswith('[]'):
        if not isinstance(value, list):
            raise ValueError(f'expected a list for {pg_type}')
        if not value:
            return f"'{{}}'::{pg_type}"
        return 'ARRAY[' + ','.join(literal(item, pg_type[:-2]) for item in value) + f']::{pg_type}'
    if isinstance(value, bool):
        return ('true' if value else 'false') + f'::{pg_type}'
    if isinstance(value, (int, float)):
        return f'{value}::{pg_type}'
    if isinstance(value, (dict, list)):
        raise ValueError(f'unexpected JSON value for {pg_type}')
    return f'{quote(value)}::{pg_type}'


def signature(name):
    rows = psql(
        "select coalesce(array_to_json(p.proargnames)::text, '[]') || '|' || "
        "coalesce((select json_agg(t::regtype::text order by ord) from unnest(p.proargtypes) with ordinality as x(t, ord))::text, '[]') "
        "from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = " + quote(name)).splitlines()
    if len(rows) != 1:
        raise RuntimeError(f'{name}: cần đúng một hàm public, thấy {len(rows)}')
    names, types = rows[0].split('|', 1)
    names, types = json.loads(names), json.loads(types)
    # proargnames gồm cả cột OUT của hàm RETURNS TABLE; tham số vào là phần đầu, dài bằng proargtypes.
    return dict(zip(names[:len(types)], types))


document = json.load(open(calls_path, encoding='utf-8'))
placeholders = document['placeholders']
campaign_updated_at = placeholders['campaignUpdatedAt']
account_updated_at = placeholders['emailAccountUpdatedAt']
ids = {}  # id giữ chỗ (chuỗi) -> id thật


def resolve(value):
    """Thay id giữ chỗ bằng id thật ở mọi độ sâu."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and str(value) in ids:
        return ids[str(value)]
    if isinstance(value, list):
        return [resolve(item) for item in value]
    if isinstance(value, dict):
        return {key: resolve(item) for key, item in value.items()}
    return value


def check(condition, step, message):
    if not condition:
        raise AssertionError(f'{step}: {message}')


def campaign(campaign_id):
    return scalar_json(
        'select c.id, c.name, c.status, c.action_id, c.account_id, c.secondary_account_id, c.content, c.extra_settings, '
        'c.images, c.web_campaign_form, (select count(*) from auto_campaign_input_data d where d.campaign_id = c.id) as inputs '
        f'from auto_campaigns c where c.id = {int(campaign_id)}')


def verify(step, params, result):
    """Kiểm dữ liệu đã ghi sau từng bước."""
    if step == 'facebook_create':
        row = campaign(result['campaign_id'])
        sent = params['p_campaign']
        check(row['status'] == 'tạm dừng' and row['action_id'] == 'facebook_group_post', step, f'trạng thái/loại sai: {row}')
        check(row['account_id'] == sent['accountId'], step, 'sai tài khoản chính')
        check(sent.get('secondaryAccountId') is not None and row['secondary_account_id'] == sent.get('secondaryAccountId'), step,
              'tài khoản phụ không được ghi (API phải gửi secondaryAccountId khi tạo)')
        check(row['web_campaign_form'] == sent['webCampaignForm'], step, 'web_campaign_form không được ghi')
        check(row['extra_settings'] == sent['extraSettings'], step, 'extra_settings không giữ nguyên như API gửi')
        check(row['inputs'] == 0, step, 'tạo không kèm data nhưng có dòng data')
    elif step == 'facebook_add_inputs':
        row = campaign(params['p_campaign_id'])
        check(row['inputs'] == len(params['p_inputs']), step, f"số dòng data {row['inputs']}")
        uids = psql(f"select string_agg(uid, ',' order by id) from auto_campaign_input_data where campaign_id = {int(params['p_campaign_id'])}")
        check(uids == ','.join(item['uid'] for item in params['p_inputs']), step, f'uid ghi sai: {uids}')
        check(row['status'] == params['p_campaign_status'], step, 'trạng thái sau thêm data sai')
    elif step == 'facebook_update':
        row = campaign(params['p_campaign_id'])
        patch = params['p_campaign_patch']
        check(row['name'] == patch['name'] and row['content'] == patch['content'], step, 'tên/nội dung không được sửa')
        check(row['secondary_account_id'] is None, step, 'tài khoản phụ không được bỏ')
        sent = patch['extra_settings']
        check('contentRotationIndex' in sent and 'sourceLinkIndex' in sent, step, 'ca thử phải gửi khoá do bộ chạy sở hữu')
        # Dòng trong DB chưa có hai khoá này nên giá trị form gửi bị bỏ (hợp đồng mục 3.2).
        check('contentRotationIndex' not in row['extra_settings'] and 'sourceLinkIndex' not in row['extra_settings'], step,
              'khoá do bộ chạy sở hữu bị form ghi vào DB')
        expected = {key: value for key, value in sent.items() if key not in ('contentRotationIndex', 'sourceLinkIndex')}
        check(row['extra_settings'] == expected, step, 'các khoá còn lại của extra_settings không được ghi đúng')
    elif step == 'email_create':
        row = campaign(result['campaign_id'])
        sent = params['p_campaign']
        check(row['action_id'] == 'email_send' and row['account_id'] == sent['accountId'], step, f'sai loại/tài khoản: {row}')
        check(row['extra_settings'] == sent['extraSettings'], step, 'extra_settings Email không giữ nguyên')
        check(row['images'] == sent['images'], step, 'tệp đính kèm không giữ nguyên')
        check(row['secondary_account_id'] is None, step, 'Email không có tài khoản phụ')
    elif step == 'email_add_inputs':
        emails = psql(f"select string_agg(email, ',' order by id) from auto_campaign_input_data where campaign_id = {int(params['p_campaign_id'])}")
        check(emails == ','.join(item['email'] for item in params['p_inputs']), step, f'email ghi sai: {emails}')
    elif step in ('email_account_create', 'email_account_update', 'email_account_update_keep_status'):
        account_id = result['account_id'] if step == 'email_account_create' else params['p_account_id']
        if step == 'email_account_update_keep_status':
            # API không nối được SMTP từ máy chủ, cấu hình kết nối không đổi: lưu cấu hình, giữ trạng thái đăng nhập.
            check(params['p_verified'] is None and params['p_verify_error'] is None, step, 'ca thử phải gửi p_verified null')
        row = scalar_json(
            'select a.name, a.flatform_type, a.login_status, a.is_delete, a.email_session, a.staff_id, a.organization_id '
            f'from auto_accounts a where a.id = {int(account_id)}')
        check(row['flatform_type'] == 'email' and row['is_delete'] is False, step, f'dòng tài khoản sai: {row}')
        check(row['staff_id'] == params['p_staff_id'] and row['organization_id'] == params['p_organization_id'], step, 'sai chủ sở hữu')
        check(row['login_status'] == 'đã đăng nhập', step, f"trạng thái đăng nhập {row['login_status']}")
        session = row['email_session']
        sent = params['p_session']
        for key in ('brandName', 'host', 'port', 'secure', 'user', 'fromEmail', 'replyTo', 'cc'):
            check(session.get(key) == sent[key], step, f'email_session.{key} = {session.get(key)!r}, API gửi {sent[key]!r}')
        if step == 'email_account_create':
            check(session.get('pass') == sent['pass'], step, 'mật khẩu không được lưu')
            returned = result.get('account') or {}
            check('pass' not in (returned.get('email_session') or {}) and sent['pass'] not in json.dumps(returned, ensure_ascii=False),
                  step, 'kết quả trả về có mật khẩu')
            ids['__smtp_pass'] = sent['pass']
        else:
            check('pass' not in sent, step, 'ca thử sửa phải không gửi mật khẩu')
            check(session.get('pass') == ids['__smtp_pass'], step, 'mật khẩu đang lưu không được giữ khi sửa không nhập lại')
    elif step == 'email_account_delete':
        deleted = psql(f"select is_delete from auto_accounts where id = {int(params['p_account_id'])}")
        check(deleted == 't', step, 'tài khoản không được xoá mềm')
    elif step in ('find_data_link_add', 'find_data_link_remove'):
        target = params['p_target_campaign_id']
        for source in params['p_source_campaign_ids']:
            linked = psql(
                f"select coalesce(extra_settings->{quote(params['p_target_key'])}, '[]'::jsonb) @> to_jsonb({int(target)}::bigint) "
                f'from auto_campaigns where id = {int(source)}')
            check(linked == ('t' if params['p_add'] else 'f'), step, f'liên kết ở chiến dịch nguồn {source}: {linked}')


count = 0
for call in document['calls']:
    step, name = call['step'], call['name']
    params = resolve(call['params'])
    arg_types = signature(name)
    unknown = [key for key in params if key not in arg_types]
    check(not unknown, step, f'{name} không có tham số {unknown} (có: {sorted(arg_types)})')
    if params.get('p_expected_updated_at') == campaign_updated_at:
        params['p_expected_updated_at'] = psql(
            f"select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from auto_campaigns where id = {int(params['p_campaign_id'])}")
    elif params.get('p_expected_updated_at') == account_updated_at:
        params['p_expected_updated_at'] = psql(
            f"select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from auto_accounts where id = {int(params['p_account_id'])}")
    arguments = ', '.join(f'{key} => {literal(value, arg_types[key])}' for key, value in params.items())
    try:
        row = scalar_json(f'select * from public.{name}({arguments})')
    except RuntimeError as error:
        raise SystemExit(f'{step}: {name} lỗi: {error}')
    # Hàm trả jsonb: to_jsonb(q) bọc trong khoá tên hàm.
    result = row[name] if isinstance(row, dict) and list(row.keys()) == [name] else row
    check(isinstance(result, dict), step, f'{name} trả về {result!r}')
    for key, expected in call['expect'].items():
        check(result.get(key) == expected, step, f'{name} trả {key} = {result.get(key)!r}, cần {expected!r}; kết quả: {result}')
    for placeholder, key in (call.get('bind') or {}).items():
        check(isinstance(result.get(key), int), step, f'{name} không trả {key}')
        ids[placeholder] = result[key]
    verify(step, params, result)
    count += 1

print(f'v530: API contract replay passed ({count} calls)')
