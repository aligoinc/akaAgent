#!/usr/bin/env python3
"""Chạy V641 và bản gỡ trên PostgreSQL cục bộ với code 10 block đọc từ production 24/11 (scripts/fixtures/fb-ai-filter/blocks-live-20261124.json).
Kiểm: md5 sau khi apply khớp bộ sinh, sổ chép block ghi md5 mới, chạy lại bị từ chối, gỡ trả đúng code cũ (gỡ hai lần vô hại),
thiếu V640 hoặc block đã bị sửa thì từ chối.
Chạy: PGBIN=/usr/lib/postgresql/16/bin python3 scripts/fb-ai-filter/test_v641.py"""
import hashlib, json, os, shutil, subprocess, sys, tempfile, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PGBIN = os.environ.get('PGBIN', '/usr/lib/postgresql/16/bin')
BLOCKS = json.load(open(os.path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-live-20261124.json'), encoding='utf-8'))['blocks']
AFTER = {b['id']: b['md5'] for b in json.load(open(os.path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-v641.json'), encoding='utf-8'))['blocks']}
MIGRATION = open(os.path.join(ROOT, 'migrations/migration_v641_fb_ai_filter_blocks.sql'), encoding='utf-8').read()
ROLLBACK = open(os.path.join(ROOT, 'migrations/rollback_v641_fb_ai_filter_blocks.sql'), encoding='utf-8').read()
PAIRS = [(2554, 2859), (2602, 2863), (2603, 2864), (2718, 2904), (2719, 2905)]

base = tempfile.mkdtemp(prefix='v641-', dir='/var/tmp')
os.chmod(base, 0o777)
data, sock = os.path.join(base, 'data'), base
as_pg = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
env = {**os.environ, 'LC_ALL': 'C'}
passed = 0

def run(cmd, **kw):
    return subprocess.run(as_pg + cmd, env=env, capture_output=True, text=True, **kw)

def psql(sql, expect_ok=True):
    r = run([f'{PGBIN}/psql', '-h', sock, '-p', '5641', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], input=sql)
    if expect_ok and r.returncode != 0:
        raise SystemExit(f'psql lỗi: {r.stderr[-2000:]}')
    return r

def check(name, cond):
    global passed
    if not cond:
        raise SystemExit(f'FAIL {name}')
    passed += 1
    print(f'ok - {name}')

def md5s():
    out = psql('select id || \':\' || md5(code) from public.auto_blocks order by id;').stdout.split()
    return dict((int(x.split(':')[0]), x.split(':')[1]) for x in out)

try:
    r = run([f'{PGBIN}/initdb', '-D', data, '-U', 'postgres', '-A', 'trust'])
    if r.returncode: raise SystemExit(r.stderr)
    r = run([f'{PGBIN}/pg_ctl', '-D', data, '-l', os.path.join(base, 'pg.log'), '-o', f'-k {sock} -p 5641 -c listen_addresses=', '-w', 'start'])
    if r.returncode: raise SystemExit(r.stderr)
    seed = ["create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text, name text, statements text[]);",
            "insert into supabase_migrations.schema_migrations values ('20261124062959', 'migration_v640_fb_ai_filter_config', null);",
            "create table public.auto_blocks (id bigint primary key, name text, code text, updated_at timestamptz);",
            "create table public.ai_using (code text primary key, is_active boolean);",
            "insert into public.ai_using select c, true from unnest(array['fb_prepare_seeding_iterations_ai_filter_v2','fb_extract_data_from_group_posts_ai_filter_v2','fb_collect_group_comments_ai_filter_v2','fb_extract_data_from_search_posts_ai_filter_v2','fb_collect_search_post_comments_ai_filter_v2','fb_ai_content_filter_fallback']) c;",
            "create table public.auto_system_settings (key text primary key, value text);",
            "insert into public.auto_system_settings values ('facebook.error_signs', '[{\"code\":\"err_fb_ai_filter_unavailable\"}]');",
            "create table public.auto_engine_block_copies (engine_block_id bigint primary key, source_block_id bigint, source_md5_at_copy text, engine_md5_at_copy text, copied_at timestamptz);"]
    for b in BLOCKS:
        q = '$blk$'
        assert q not in b['code']
        seed.append(f"insert into public.auto_blocks values ({b['id']}, {q}{b['name']}{q}, {q}{b['code']}{q}, now());")
    for old, eng in PAIRS:
        m = next(b['md5'] for b in BLOCKS if b['id'] == old)
        seed.append(f"insert into public.auto_engine_block_copies values ({eng}, {old}, '{m}', '{m}', now());")
    psql('\n'.join(seed))
    before = md5s()
    check('code fixture khớp md5 đọc từ production', all(hashlib.md5(b['code'].encode()).hexdigest() == b['md5'] == before[b['id']] for b in BLOCKS))

    psql("delete from supabase_migrations.schema_migrations;")
    r = psql(MIGRATION, expect_ok=False)
    check('thiếu V640 thì từ chối', r.returncode != 0 and 'cần apply V640 trước' in r.stderr)
    check('từ chối thì không đổi block', md5s() == before)
    psql("insert into supabase_migrations.schema_migrations values ('20261124062959', 'migration_v640_fb_ai_filter_config', null);")

    t = time.time(); psql(MIGRATION)
    after = md5s()
    check(f'apply V641 ({time.time() - t:.2f} giây): 10 block ra đúng md5 bộ sinh', all(after[i] == m for i, m in AFTER.items()))
    copies = psql("select engine_block_id || ':' || source_md5_at_copy || ':' || engine_md5_at_copy from public.auto_engine_block_copies order by 1;").stdout.split()
    check('sổ chép block ghi md5 mới của cả hai bên', all(f'{e}:{AFTER[o]}:{AFTER[e]}' in copies for o, e in PAIRS))

    psql("insert into supabase_migrations.schema_migrations values ('20261124200000', 'migration_v641_fb_ai_filter_blocks', null);")
    r = psql(MIGRATION, expect_ok=False)
    check('chạy lại V641 bị từ chối', r.returncode != 0 and 'không chạy lại' in r.stderr)

    psql(ROLLBACK)
    check('gỡ V641 trả đúng code cũ của 10 block', md5s() == before)
    copies = psql("select engine_block_id || ':' || source_md5_at_copy || ':' || engine_md5_at_copy from public.auto_engine_block_copies order by 1;").stdout.split()
    check('gỡ trả sổ chép block về md5 cũ', all(f'{e}:{before[o]}:{before[e]}' in copies for o, e in PAIRS))
    r = psql(ROLLBACK, expect_ok=False)
    check('gỡ lần hai không đổi gì (UPDATE theo md5 bản V641 không khớp dòng nào)', r.returncode == 0 and md5s() == before)
    psql("update public.auto_blocks set code = code || ' ' where id = 2859;")
    r = psql(MIGRATION.replace("'migration_v641_%'", "'migration_v641_x%'"), expect_ok=False)
    check('block bị sửa khác bản đã đọc thì V641 dừng, không ghi gì', r.returncode != 0 and 'khác bản đã đọc' in r.stderr and md5s()[2554] == before[2554])
    print(f'PASS {passed} kiểm')
finally:
    run([f'{PGBIN}/pg_ctl', '-D', data, '-m', 'immediate', 'stop'])
    shutil.rmtree(base, ignore_errors=True)
