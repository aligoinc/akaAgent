#!/usr/bin/env python3
"""Bản dán SQL Editor của V641 khi dán từ máy Windows (xuống dòng CRLF), trên PostgreSQL cục bộ với code 10 block đọc từ production 24/11.
Kiểm: bản dán kiểu cũ (chèn dòng sổ trước COMMIT) + CRLF dừng ở postflight và không đổi gì (đúng lỗi anh gặp 15:53 VN 24/11);
bản dán chịu CRLF (scripts/make-migration-paste-crlf-safe.py) chạy được với CRLF lẫn LF, 10 block ra đúng md5, md5 dòng sổ = md5 file, chạy lại bị từ chối.
Chạy: PGBIN=/usr/lib/postgresql/16/bin python3 scripts/fb-ai-filter/test_v641_paste.py [<bản dán kiểu cũ>]"""
import hashlib, json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PGBIN = os.environ.get('PGBIN', '/usr/lib/postgresql/16/bin')
BLOCKS = json.load(open(os.path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-live-20261124.json'), encoding='utf-8'))['blocks']
AFTER = {b['id']: b['md5'] for b in json.load(open(os.path.join(ROOT, 'scripts/fixtures/fb-ai-filter/blocks-v641.json'), encoding='utf-8'))['blocks']}
MIGRATION = open(os.path.join(ROOT, 'migrations/migration_v641_fb_ai_filter_blocks.sql'), encoding='utf-8').read()
PASTE = open(os.path.join(ROOT, 'migrations/tests/migration_v641_fb_ai_filter_blocks_paste.sql'), encoding='utf-8').read()
OLD = open(sys.argv[1], encoding='utf-8').read() if len(sys.argv) > 1 else None
PAIRS = [(2554, 2859), (2602, 2863), (2603, 2864), (2718, 2904), (2719, 2905)]
crlf = lambda s: s.replace('\n', '\r\n')

base = tempfile.mkdtemp(prefix='v641p-', dir='/var/tmp')
os.chmod(base, 0o777)
data, sock = os.path.join(base, 'data'), base
as_pg = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
env = {**os.environ, 'LC_ALL': 'C'}
passed = 0

def run(cmd, **kw):
    return subprocess.run(as_pg + cmd, env=env, capture_output=True, **kw)

def psql(sql, expect_ok=True):
    r = run([f'{PGBIN}/psql', '-h', sock, '-p', '5642', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], input=sql.encode('utf-8'))
    r.out, r.err = r.stdout.decode('utf-8'), r.stderr.decode('utf-8')
    if expect_ok and r.returncode != 0:
        raise SystemExit(f'psql lỗi: {r.err[-2000:]}')
    return r

def check(name, cond):
    global passed
    if not cond:
        raise SystemExit(f'FAIL {name}')
    passed += 1
    print(f'ok - {name}')

def md5s():
    out = psql("select id || ':' || md5(code) from public.auto_blocks order by id;").out.split()
    return dict((int(x.split(':')[0]), x.split(':')[1]) for x in out)

def seed():
    s = ["drop schema if exists supabase_migrations cascade; drop table if exists public.auto_blocks, public.ai_using, public.auto_system_settings, public.auto_engine_block_copies;",
         "create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, name text, statements text[]);",
         "insert into supabase_migrations.schema_migrations values ('20261124062959', 'migration_v640_fb_ai_filter_config', null);",
         "create table public.auto_blocks (id bigint primary key, name text, code text, updated_at timestamptz);",
         "create table public.ai_using (code text primary key, is_active boolean);",
         "insert into public.ai_using select c, true from unnest(array['fb_prepare_seeding_iterations_ai_filter_v2','fb_extract_data_from_group_posts_ai_filter_v2','fb_collect_group_comments_ai_filter_v2','fb_extract_data_from_search_posts_ai_filter_v2','fb_collect_search_post_comments_ai_filter_v2','fb_ai_content_filter_fallback']) c;",
         "create table public.auto_system_settings (key text primary key, value text);",
         "insert into public.auto_system_settings values ('facebook.error_signs', '[{\"code\":\"err_fb_ai_filter_unavailable\"}]');",
         "create table public.auto_engine_block_copies (engine_block_id bigint primary key, source_block_id bigint, source_md5_at_copy text, engine_md5_at_copy text, copied_at timestamptz);"]
    for b in BLOCKS:
        s.append(f"insert into public.auto_blocks values ({b['id']}, $blk${b['name']}$blk$, $blk${b['code']}$blk$, now());")
    for old, eng in PAIRS:
        m = next(b['md5'] for b in BLOCKS if b['id'] == old)
        s.append(f"insert into public.auto_engine_block_copies values ({eng}, {old}, '{m}', '{m}', now());")
    psql('\n'.join(s))

def ledger():
    return psql("select md5(statements[1]) || ':' || version from supabase_migrations.schema_migrations where name = 'migration_v641_fb_ai_filter_blocks';").out.split()

try:
    r = run([f'{PGBIN}/initdb', '-D', data, '-U', 'postgres', '-A', 'trust'])
    if r.returncode: raise SystemExit(r.stderr.decode())
    r = run([f'{PGBIN}/pg_ctl', '-D', data, '-l', os.path.join(base, 'pg.log'), '-o', f'-k {sock} -p 5642 -c listen_addresses=', '-w', 'start'])
    if r.returncode: raise SystemExit(r.stderr.decode())
    file_md5 = hashlib.md5(MIGRATION.encode()).hexdigest()
    seed(); before = md5s()
    if OLD:
        r = psql(crlf(OLD), expect_ok=False)
        check('bản dán kiểu cũ + CRLF: dừng ở postflight (lỗi anh gặp), không đổi block, không ghi sổ',
              r.returncode != 0 and 'V641 postflight: block 2554 không ra md5' in r.err and md5s() == before and ledger() == [])
    for label, sql in (('CRLF', crlf(PASTE)), ('LF', PASTE)):
        seed()
        psql(sql)
        after = md5s()
        check(f'bản dán chịu CRLF, dán kiểu {label}: 10 block ra đúng md5 bộ sinh', all(after[i] == m for i, m in AFTER.items()))
        copies = psql("select engine_block_id || ':' || source_md5_at_copy || ':' || engine_md5_at_copy from public.auto_engine_block_copies order by 1;").out.split()
        check(f'{label}: sổ chép block ghi md5 mới', all(f'{e}:{AFTER[o]}:{AFTER[e]}' in copies for o, e in PAIRS))
        led = ledger()
        check(f'{label}: sổ migration có một dòng, md5 = md5 file, version 14 chữ số', len(led) == 1 and led[0].split(':')[0] == file_md5 and len(led[0].split(':')[1]) == 14)
        r = psql(sql, expect_ok=False)
        check(f'{label}: bấm Run lần hai bị từ chối, không đổi gì', r.returncode != 0 and 'không chạy lại' in r.err and md5s() == after and len(ledger()) == 1)
    seed()
    psql("update public.auto_blocks set code = code || ' ' where id = 2859;")
    r = psql(crlf(PASTE), expect_ok=False)
    check('block khác bản đã đọc: dừng ở preflight, không ghi sổ', r.returncode != 0 and 'khác bản đã đọc' in r.err and ledger() == [])
    print(f'PASS {passed} kiểm')
finally:
    run([f'{PGBIN}/pg_ctl', '-D', data, '-m', 'immediate', 'stop'])
    shutil.rmtree(base, ignore_errors=True)
