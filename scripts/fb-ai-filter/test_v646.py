#!/usr/bin/env python3
"""V646 trên PostgreSQL cục bộ: apply đổi đúng lời dặn, chạy lại bị từ chối, lời dặn khác bản đã đọc thì dừng, gỡ trả đúng bản 2.
Chạy: PGBIN=/usr/lib/postgresql/16/bin python3 scripts/fb-ai-filter/test_v646.py"""
import hashlib, os, shutil, subprocess, tempfile
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PGBIN = os.environ.get('PGBIN', '/usr/lib/postgresql/16/bin')
M = open(os.path.join(ROOT, 'migrations/migration_v646_fb_ai_filter_prompt_v3.sql'), encoding='utf-8').read()
R = open(os.path.join(ROOT, 'migrations/rollback_v646_fb_ai_filter_prompt_v3.sql'), encoding='utf-8').read()
v2 = open(os.path.join(ROOT, 'scripts/fb-ai-filter/prompt-v2.user.txt'), encoding='utf-8').read().strip()
v3 = open(os.path.join(ROOT, 'scripts/fb-ai-filter/prompt-v3.user.txt'), encoding='utf-8').read().strip()
base = tempfile.mkdtemp(prefix='v646-', dir='/var/tmp'); os.chmod(base, 0o777)
as_pg = ['runuser', '-u', 'postgres', '--'] if os.geteuid() == 0 else []
env = {**os.environ, 'LC_ALL': 'C'}
n = 0
def run(cmd, **kw): return subprocess.run(as_pg + cmd, env=env, capture_output=True, **kw)
def psql(sql, ok=True):
    r = run([f'{PGBIN}/psql', '-h', base, '-p', '5646', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], input=sql.encode())
    if ok and r.returncode: raise SystemExit(r.stderr.decode())
    return r
def check(name, c):
    global n
    if not c: raise SystemExit('FAIL ' + name)
    n += 1; print('ok -', name)
md5 = lambda: psql('select md5(prompt_user) from public.ai_prompt where id = 75;').stdout.decode().strip()
try:
    run([f'{PGBIN}/initdb', '-D', base + '/d', '-U', 'postgres', '-A', 'trust'])
    r = run([f'{PGBIN}/pg_ctl', '-D', base + '/d', '-l', base + '/log', '-o', f'-k {base} -p 5646 -c listen_addresses=', '-w', 'start'])
    if r.returncode: raise SystemExit(r.stderr.decode())
    psql(f"create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text, name text, statements text[]);"
         f"create table public.ai_prompt (id bigint primary key, code text, prompt_system text, prompt_user text);"
         f"insert into public.ai_prompt values (75, 'find_data_meaning_check_v2', 's', $q${v2}$q$);")
    psql(M)
    check('apply: lời dặn ra bản 3', md5() == hashlib.md5(v3.encode()).hexdigest())
    psql("insert into supabase_migrations.schema_migrations values ('1', 'migration_v646_fb_ai_filter_prompt_v3', null);")
    r = psql(M, ok=False); check('chạy lại bị từ chối', r.returncode and 'không chạy lại' in r.stderr.decode())
    psql("delete from supabase_migrations.schema_migrations;")
    psql(R)
    check('gỡ: về đúng bản 2', md5() == hashlib.md5(v2.encode()).hexdigest())
    psql("update public.ai_prompt set prompt_user = prompt_user || ' ' where id = 75;")
    r = psql(M, ok=False); check('lời dặn khác bản đã đọc thì dừng, không đổi', r.returncode and 'khác bản V640' in r.stderr.decode())
    psql("update public.ai_prompt set prompt_user = rtrim(prompt_user) where id = 75;")
    psql(M.replace('\n', '\r\n'))
    check('dán kiểu CRLF vẫn đúng (postflight bỏ CR)', psql("select md5(replace(prompt_user, chr(13), '')) from public.ai_prompt where id = 75;").stdout.decode().strip() == hashlib.md5(v3.encode()).hexdigest())
    print(f'PASS {n} kiểm')
finally:
    run([f'{PGBIN}/pg_ctl', '-D', base + '/d', '-m', 'immediate', 'stop']); shutil.rmtree(base, ignore_errors=True)
