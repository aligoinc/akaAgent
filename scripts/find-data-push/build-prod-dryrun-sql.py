#!/usr/bin/env python3
"""Sinh câu kiểm V608 / V609 trên DB thật mà KHÔNG lưu gì: cả bài nằm trong một khối DO kết thúc bằng RAISE EXCEPTION mang kết quả,
nên Postgres huỷ toàn bộ (dòng thêm vào đích, sổ đẩy, hàm V609 tạo tạm). Gọi hàm như phiên Desktop thật của nhân viên chủ chiến dịch.
    python3 scripts/find-data-push/build-prod-dryrun-sql.py <auth_user_id> <nguồn> <đích> <outputKind> <file giá trị thật.json> > dryrun.sql
File giá trị thật: mảng giá trị đang có ở đích (đọc chỉ đọc trước đó). Nửa đầu dùng cho V608, nửa sau cho V609, đẩy ở dạng viết khác.
"""
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[2]
auth_user, source, target, kind, values_file = sys.argv[1:6]
values = json.loads(pathlib.Path(values_file).read_text(encoding='utf-8'))
half = len(values) // 2
set_a, set_b = values[:half], values[half:]


def variant(v):
    # Cách viết khác của cùng một data (m. host + tham số theo dõi + bỏ "/" cuối), như data khách / Facebook trả về.
    v2 = v.replace('https://www.', 'https://m.').rstrip('/')
    return f"{v2}?__cft__[0]=AZdryrun&__tn__=R" if kind in ('post_link',) else v2


def items(vals, fresh):
    out = [{'value': variant(v), 'key': variant(v).lower()} for v in vals]
    out.append({'value': fresh, 'key': fresh.lower()})
    return json.dumps({'sourceCampaignId': int(source), 'outputKind': kind, 'items': out}, ensure_ascii=False)


mig = (root / 'migrations/migration_v609_find_data_push_match_key.sql').read_text(encoding='utf-8')
functions = re.findall(r'(CREATE (?:OR REPLACE )?FUNCTION .*?\$function\$;)', mig, re.S)
assert len(functions) == 3, len(functions)
body = '\n'.join(f"  EXECUTE $v609_{i}${fn[:-1]}$v609_{i}$;" for i, fn in enumerate(functions))
fresh_a = 'https://www.facebook.com/groups/dryrun608/posts/1/'
fresh_b = 'https://www.facebook.com/groups/dryrun609/posts/1/'

sql = f"""DO $dry$
DECLARE
  r608 jsonb; r609 jsonb; r609again jsonb; n_before bigint; n_608 bigint; n_609 bigint; n_again bigint; t0 timestamptz;
  ms608 numeric; ms609 numeric;
BEGIN
  SET LOCAL statement_timeout = '25s';
  SET LOCAL lock_timeout = '2s';
  SELECT count(*) INTO n_before FROM public.auto_campaign_input_data WHERE campaign_id = {int(target)};
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'aka_agent_desktop', 'sub', '{auth_user}')::text, true);
  SET LOCAL ROLE aka_agent_desktop;
  t0 := clock_timestamp();
  r608 := public.aka_agent_find_data_push_v1($j${items(set_a, fresh_a)}$j$::jsonb);
  ms608 := extract(epoch FROM clock_timestamp() - t0) * 1000;
  RESET ROLE;
  SELECT count(*) INTO n_608 FROM public.auto_campaign_input_data WHERE campaign_id = {int(target)};
{body}
  SET LOCAL ROLE aka_agent_desktop;
  t0 := clock_timestamp();
  r609 := public.aka_agent_find_data_push_v1($j${items(set_b, fresh_b)}$j$::jsonb);
  ms609 := extract(epoch FROM clock_timestamp() - t0) * 1000;
  r609again := public.aka_agent_find_data_push_v1($j${items(set_b, fresh_b)}$j$::jsonb);
  RESET ROLE;
  SELECT count(*) INTO n_609 FROM public.auto_campaign_input_data WHERE campaign_id = {int(target)};
  RAISE EXCEPTION 'DRYRUN %', jsonb_build_object(
    'rows_before', n_before, 'v608_added', n_608 - n_before, 'v609_added', n_609 - n_608,
    'v608_ms', round(ms608), 'v609_ms', round(ms609),
    'v608', r608 -> 'targets', 'v609', r609 -> 'targets', 'v609_again', r609again -> 'targets');
END $dry$;
"""
assert 'COMMIT' not in sql.upper().replace('COMMENT', '')
sys.stdout.write(sql)
