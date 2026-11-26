#!/usr/bin/env python3
"""Bài kiểm V664 (lọc trùng đồng bộ Google Sheet rẻ hơn, kết quả không đổi) trên Postgres cục bộ.

Chạy: python3 scripts/campaign-sheet-sync/test_v664.py [--rows 20000] [--values 60000]
  1. Khoá V662 và khoá V664 cho cùng kết quả trên mọi (trường, loại chiến dịch) với nhiều đầu vào sinh ngẫu nhiên
     (SĐT nhiều cách viết, khoảng trắng Unicode, email, link group Zalo, UID, chuỗi rất dài, NULL).
  2. finish V662 và V664 cho cùng dòng thêm / số đếm trên cùng kịch bản (chiến dịch có sẵn data, Sheet có dòng trùng,
     dòng sai, dòng không phải object).
  3. Đo thời gian: tính khoá cho N dòng data và một lượt finish.
  4. Bản gỡ trả 3 hàm về đúng md5 V662; chạy lại V664 bị từ chối khi đã có trong sổ.
"""
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
from pg import Cluster  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
read = lambda p: open(os.path.join(ROOT, p), encoding='utf-8').read()  # noqa: E731
V662 = read('migrations/migration_v662_campaign_sheet_sync.sql')
V664 = read('migrations/migration_v664_campaign_sheet_sync_key_speed.sql')
RB664 = read('migrations/rollback_v664_campaign_sheet_sync_key_speed.sql')
FIXTURE = open(os.path.join(os.path.dirname(__file__), 'fixture.sql'), encoding='utf-8').read()
ARG = lambda name, d: int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else d  # noqa: E731
ROWS, VALUES = ARG('--rows', 20000), ARG('--values', 60000)
FUNCS = "('aka_agent_campaign_sheet_key','aka_agent_campaign_sheet_unmatched_keys','aka_agent_campaign_sheet_finish')"
SPACES = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿', '\t', '\n', ' ', '​']
PAIRS = [('phone', 'zalo_message_phone'), ('email', 'email_send'), ('uid', 'facebook_group_post'), ('uid', 'facebook_message_uid'),
         ('uid', 'zalo_message_group_member'), ('uid', 'zalo_join_group_link'), ('uid', 'facebook_find_data_search'), ('x', 'y'), (None, None)]
passed = 0


def ok(cond, label):
    global passed
    if not cond:
        raise AssertionError(label)
    passed += 1
    print('PASS', label)


def sql_text(v):
    return 'NULL' if v is None else "'" + v.replace("'", "''") + "'"


def corpus(rng, n):
    sp = lambda: rng.choice(SPACES) * rng.randint(0, 2)  # noqa: E731
    out = [None, '', ' ', '　', 'x' * 2048, 'x' * 2049, 'a' * 255 + '@x.vn', 'https://zalo.me/g/', '0' * 40]
    for _ in range(n):
        kind = rng.randrange(9)
        if kind == 0:
            d = rng.choice(['09', '03', '08', '07', '05', '01', '02', '+849', '849', '0084 9', '0162', '012'])
            s = d + ''.join(rng.choice('0123456789') for _ in range(rng.randint(6, 10)))
            s = ''.join(c + (rng.choice(['', '', '', '.', '-', ' ', sp()]) if rng.random() < 0.2 else '') for c in s)
        elif kind == 1:
            s = rng.choice(['A.b', 'x', 'nguyen.van', '..a', 'a..b', 'đ', 'a+b', "o'neil"]) + rng.choice(['@', '@@', '']) + \
                rng.choice(['gmail.com', 'X.VN', 'a-b.c', '-a.vn', 'vn', 'a.b-', 'mail.com.vn'])
            s = rng.choice(['', 'mailto:', 'MAILTO:']) + s
        elif kind == 2:
            s = rng.choice(['https://', 'http://', '', 'HTTPS://www.']) + rng.choice(['zalo.me/g/', 'ZALO.ME/G/', 'chat.zalo.me/g/',
                                                                                     'zaloapp.com/qr/g/', 'zalo.me/', 'x.zalo.me/g/']) + \
                ''.join(rng.choice('abcXYZ0129_-') for _ in range(rng.randint(0, 12))) + rng.choice(['', '?src=qr', '/', '#a', ' x'])
        elif kind == 3:
            s = ''.join(rng.choice('0123456789') for _ in range(rng.randint(3, 32)))
            s = s[:rng.randint(0, len(s))] + sp() + s[rng.randint(0, len(s)):] + rng.choice(['', '/', '//', ' '])
        elif kind == 4:
            s = rng.choice(['https://www.facebook.com/groups/', 'facebook.com/profile.php?id=', 'fb.com/', '']) + \
                ''.join(rng.choice('abc123./') for _ in range(rng.randint(0, 20))) + rng.choice(['', '/', '///'])
        elif kind == 5:
            s = sp() + rng.choice(['BÁN  NHÀ', 'Đoàn Phóng', 'căn hộ\tquận 7', 'ÀÁẢÃẠ', 'İstanbul', 'straße']) + sp()
        elif kind == 6:
            s = ''.join(rng.choice('xyz/ ') for _ in range(rng.randint(2040, 2060)))
        elif kind == 7:
            s = ''.join(rng.choice(SPACES + ['a', '1', '@', '.', '/']) for _ in range(rng.randint(0, 12)))
        else:
            s = ''.join(chr(rng.randint(32, 0x2fff)) for _ in range(rng.randint(0, 15)))
        out.append(sp() + s + sp() if rng.random() < 0.3 else s)
    return out


def load_values(pg, values):
    rows = ',\n'.join(f'({i}, {sql_text(v)})' for i, v in enumerate(values))
    pg.psql(f'CREATE TABLE IF NOT EXISTS t_values (i int PRIMARY KEY, v text); TRUNCATE t_values; INSERT INTO t_values VALUES {rows};')


def keys_snapshot(pg, table):
    pg.psql(f'DROP TABLE IF EXISTS {table}; CREATE TABLE {table} AS SELECT p.f, p.a, t.i, private.aka_agent_campaign_sheet_key(p.f, p.a, t.v, t.v, t.v) AS k '
            f'FROM t_values t CROSS JOIN (VALUES ' + ','.join(f'({sql_text(f)}, {sql_text(a)})' for f, a in PAIRS) + ') p(f, a);')


def funcs_md5(pg):
    return pg.one(f"SELECT string_agg(p.proname || '=' || md5(pg_get_functiondef(p.oid)), ' ' ORDER BY p.proname) FROM pg_proc p WHERE p.proname IN {FUNCS}")


def finish_scenario(pg, rng, tag, sheet_rows):
    """Một nguồn, 2 chiến dịch chia đều, data sẵn có; trả kết quả finish + dòng đã thêm."""
    pg.psql("""
      DELETE FROM auto_campaign_sheet_sync_logs; DELETE FROM auto_campaign_sheet_syncs;
      DELETE FROM auto_campaign_input_data WHERE campaign_id IN (900, 901);
      INSERT INTO org_staff (id, organization_id) VALUES (90, 9) ON CONFLICT DO NOTHING;
      INSERT INTO auto_campaigns (id, staff_id, organization_id, action_id, name, status) VALUES
        (900, 90, 9, 'zalo_message_phone', 'P1', 'hoàn thành'), (901, 90, 9, 'zalo_message_phone', 'P2', 'chờ xử lý') ON CONFLICT DO NOTHING;
      UPDATE auto_campaigns SET status = 'hoàn thành' WHERE id = 900;
    """)
    existing = ',\n'.join(f"({900 + i % 2}, {sql_text(p)}, {'true' if i % 7 == 0 else 'false'})" for i, p in enumerate(sheet_rows['existing']))
    if existing:
        pg.psql(f'INSERT INTO auto_campaign_input_data (campaign_id, phone, is_delete) VALUES {existing};')
    config = {'url': 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit#gid=0', 'hasHeader': True, 'mapping': {'phone': 0, 'name': 1},
              'expectedHeaders': ['SĐT', 'Tên'], 'columnCount': 2, 'phonePolicy': 'first', 'targetField': 'phone', 'platform': 'zalo'}
    q = lambda v: "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"  # noqa: E731
    pg.psql(f"""INSERT INTO auto_campaign_sheet_syncs (organization_id, staff_id, action_id, config, every_hours, end_date, split_mode,
                 campaign_ids, campaigns, skipped_keys, next_run_at, create_request_id, create_request_hash)
               VALUES (9, 90, 'zalo_message_phone', {q(config)}, 6, current_date + 30, 'split', '{{900,901}}',
                 '[{{"campaignId":900,"state":"active"}},{{"campaignId":901,"state":"active"}}]', '{{{','.join(sheet_rows['skipped'])}}}',
                 now() - interval '1 second', 'req-{tag}', 'h');""")
    job = json.loads(pg.one("BEGIN; SET LOCAL ROLE service_role; SELECT public.aka_agent_campaign_sheet_claim()::text; COMMIT;"))
    t0 = time.time()
    res = json.loads(pg.one(f"BEGIN; SET LOCAL ROLE service_role; SELECT public.aka_agent_campaign_sheet_finish('{job['token']}'::uuid, "
                            f"{q({'rows': sheet_rows['rows'], 'rowCount': len(sheet_rows['rows']), 'invalid': 0, 'duplicates': 0})})::text; COMMIT;"))
    dt = time.time() - t0
    # Dòng sẵn có không có tên; dòng finish thêm luôn có tên (Sheet thử nào cũng có cột tên).
    added = pg.one("SELECT coalesce(json_agg(json_build_object('c', campaign_id, 'p', phone, 'n', name, 'i1', info1, 'pc', phone_carrier, 's', status) "
                   "ORDER BY id), '[]') FROM auto_campaign_input_data WHERE campaign_id IN (900, 901) AND name IS NOT NULL")
    status = pg.one("SELECT status FROM auto_campaigns WHERE id = 900")
    return res, added, status, dt


def sheet_case(rng, n_existing, n_rows):
    phones = [f"09{rng.randint(10000000, 99999999)}" for _ in range(max(n_existing, n_rows) * 2)]
    existing = rng.sample(phones, n_existing)
    rows = []
    for _ in range(n_rows):
        r = rng.random()
        if r < 0.05:
            rows.append(rng.choice(['x', 5, None, [1]]))  # không phải object
            continue
        p = rng.choice(phones) if r < 0.9 else rng.choice(['abc', '', '0123', '+84 ' + rng.choice(phones)[1:]])
        if rng.random() < 0.2:
            p = '84' + p[1:] if p.startswith('0') else p
        rows.append({'phone': p, 'name': f'K {rng.randint(1, 9999)}', 'info1': rng.choice(['', 'ghi chú', None]),
                     'phoneCarrier': rng.choice(['viettel', '', None])})
    skipped = [f'"{p}"' for p in rng.sample(phones, 5)]
    return {'existing': existing, 'rows': rows, 'skipped': skipped}


def run(pg):
    rng = random.Random(664)
    pg.psql(FIXTURE)
    pg.psql(V662)
    pg.psql("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261126080442', 'migration_v662_campaign_sheet_sync');"
            "UPDATE auto_system_settings SET value = '{\"audience\":\"all\",\"worker\":true,\"maxSourcesPerStaff\":20,\"minEveryHours\":1}' WHERE key = 'campaign.sheet_sync'")
    md5_662 = funcs_md5(pg)

    values = corpus(rng, VALUES)
    load_values(pg, values)
    keys_snapshot(pg, 't_k662')
    cases = [sheet_case(random.Random(s), *dims) for s, dims in enumerate([(0, 50), (200, 300), (3000, 2000), (5, 8)])]
    before = [finish_scenario(pg, rng, f'a{i}', c) for i, c in enumerate(cases)]
    pg.psql("INSERT INTO auto_campaigns (id, staff_id, organization_id, action_id, name, status) VALUES (902, 90, 9, 'zalo_message_phone', 'B', 'chờ xử lý');"
            "INSERT INTO auto_campaign_input_data (campaign_id, phone) SELECT 902, '09' || (10000000 + g * 37)::text FROM generate_series(1, %d) g;"
            "ANALYZE auto_campaign_input_data;" % ROWS)
    bench = "EXPLAIN (ANALYZE, FORMAT JSON) SELECT count(DISTINCT k.key) FROM auto_campaign_input_data d " \
            "CROSS JOIN LATERAL (SELECT private.aka_agent_campaign_sheet_key('phone', 'zalo_message_phone', d.phone, d.uid, d.email) AS key%s) k " \
            "WHERE d.campaign_id = 902 AND k.key IS NOT NULL"
    t662 = min(json.loads(pg.psql(bench % '').stdout)[0]['Plan']['Actual Total Time'] for _ in range(3))
    big = sheet_case(random.Random(99), ROWS, 9000)
    big_before = finish_scenario(pg, rng, 'b0', big)

    pg.psql(V664)
    ok(pg.error(V664) is not None, 'chạy lại V664 bị từ chối')
    pg.psql("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20261126099999', 'migration_v664_campaign_sheet_sync_key_speed')")
    ok('cần V662' not in (pg.error(V664) or '') and pg.error(V664) is not None, 'đã có trong sổ thì từ chối')
    keys_snapshot(pg, 't_k664')
    diff = pg.one("SELECT count(*) FROM t_k662 a JOIN t_k664 b USING (f, a, i) WHERE a.k IS DISTINCT FROM b.k")
    total = pg.one("SELECT count(*) FROM t_k664")
    sample = pg.one("SELECT coalesce(json_agg(json_build_object('f', a.f, 'a', a.a, 'v', t.v, 'old', a.k, 'new', b.k)), '[]') FROM "
                    "(SELECT * FROM t_k662 a JOIN t_k664 b USING (f, a, i) WHERE a.k IS DISTINCT FROM b.k LIMIT 5) x "
                    "JOIN t_k662 a USING (f, a, i) JOIN t_k664 b USING (f, a, i) JOIN t_values t USING (i)") if diff != '0' else '[]'
    ok(diff == '0', f'khoá V662 = khoá V664 trên {total} cặp (trường, loại chiến dịch, giá trị) {sample}')
    nonnull = pg.one("SELECT count(*) FILTER (WHERE k IS NOT NULL) FROM t_k664")
    ok(int(nonnull) > 1000, f'bộ thử có đủ giá trị ra khoá ({nonnull})')
    t664 = min(json.loads(pg.psql(bench % ' OFFSET 0').stdout)[0]['Plan']['Actual Total Time'] for _ in range(3))
    t664_once = min(json.loads(pg.psql(bench % '').stdout)[0]['Plan']['Actual Total Time'] for _ in range(3))
    print(f'  khoá {ROWS} dòng: V662 {t662:.0f} ms, V664 {t664:.0f} ms ({t662 / t664:.1f}x), V664 không OFFSET {t664_once:.0f} ms')
    ok(t664 * 3 < t662, f'khoá V664 nhanh hơn ít nhất 3 lần ({t662:.0f} → {t664:.0f} ms)')

    after = [finish_scenario(pg, rng, f'c{i}', c) for i, c in enumerate(cases)]
    for i, (b, a) in enumerate(zip(before, after)):
        ok(b[0] == a[0] and b[1] == a[1] and b[2] == a[2], f'finish kịch bản {i}: cùng kết quả {a[0]}, cùng dòng thêm, cùng trạng thái')
    big_after = finish_scenario(pg, rng, 'b1', big)
    ok(big_before[0] == big_after[0] and big_before[1] == big_after[1], f'finish 9.000 dòng Sheet + {ROWS} data: cùng kết quả {big_after[0]["added"]} dòng thêm')
    print(f'  finish 9.000 dòng Sheet + {ROWS} data có sẵn: V662 {big_before[3] * 1000:.0f} ms, V664 {big_after[3] * 1000:.0f} ms')
    ok(big_after[3] < big_before[3], 'finish V664 nhanh hơn')

    for role, fn in [('anon', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)'), ('aka_agent_desktop', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)'),
                     ('aka_agent_desktop', 'private.aka_agent_campaign_sheet_key(text,text,text,text,text)'),
                     ('authenticated', 'private.aka_agent_campaign_sheet_unmatched_keys(text,text,jsonb,bigint[],text[])')]:
        ok(pg.one(f"SELECT has_function_privilege('{role}', '{fn}', 'EXECUTE')") == 'f', f'{role} không gọi được {fn}')
    ok(pg.one("SELECT has_function_privilege('service_role', 'public.aka_agent_campaign_sheet_finish(uuid,jsonb)', 'EXECUTE')") == 't',
       'service_role vẫn gọi được finish')
    ok(pg.one("SELECT proconfig IS NULL AND prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql') FROM pg_proc "
              "WHERE proname = 'aka_agent_campaign_sheet_key'") == 't', 'khoá V664 là plpgsql, không SET search_path')
    ok(pg.one("SELECT has_function_privilege('aka_agent_desktop', 'public.aka_agent_campaign_sheet_sync(jsonb)', 'EXECUTE')") == 't',
       'Desktop vẫn gọi được hàm thao tác (unmatched_keys / khoá chạy qua hàm SECURITY DEFINER)')

    pg.psql(RB664)
    ok(funcs_md5(pg) == md5_662, 'bản gỡ trả 3 hàm về đúng md5 V662')


def main():
    pg = Cluster(port=55464)
    try:
        run(pg)
    finally:
        pg.stop()
    print(f'\n{passed} PASS')


if __name__ == '__main__':
    main()
