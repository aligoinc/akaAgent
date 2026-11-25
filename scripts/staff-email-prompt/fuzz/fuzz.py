#!/usr/bin/env python3
"""Kiểm thử ngẫu nhiên V652 (form xin email) trên PostgreSQL 16 cục bộ.

Mỗi vòng: dựng cụm mới, nạp dữ liệu (thật đã che email nếu có --real, cộng dữ liệu mẫu và dữ liệu cố tình sai),
chạy V652 p1 -> p2 -> p3 (+ các migration sửa trong --extra), rồi chạy hàng nghìn thao tác ngẫu nhiên. Mỗi thao tác:
đọc trạng thái trước, mô hình (viết độc lập trong file này) tính kết quả mong đợi, gọi hàm thật, so kết quả và dữ liệu
sau, kiểm thêm các bất biến. Sai lệch in ra kèm hạt giống để chạy lại.

Chạy: python3 scripts/staff-email-prompt/fuzz/fuzz.py --seed 1 --ops 4000 [--real <file json>] [--extra v653.sql]
Cần /usr/lib/postgresql/16/bin và psycopg2. Chạy bằng root thì cụm chạy bằng user postgres.
"""
import argparse, datetime as dt, json, os, random, re, shutil, subprocess, sys, tempfile, time
from collections import Counter

import psycopg2
import psycopg2.extras

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
PGBIN = os.environ.get('PGBIN', '/usr/lib/postgresql/16/bin')
PORT = int(os.environ.get('FUZZ_PORT', '55471'))

EMAIL_RE = re.compile(r"^[a-z0-9_%+'-]+(\.[a-z0-9_%+'-]+)*@([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$")
TYPO = {
    'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmail.cm': 'gmail.com', 'gmail.om': 'gmail.com',
    'gmail.vn': 'gmail.com', 'gmail.com.vn': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
    'gmal.com': 'gmail.com', 'gmali.com': 'gmail.com', 'gmsil.com': 'gmail.com', 'gmial.com': 'gmail.com',
    'gmaill.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.comm': 'gmail.com',
    'yahoo.con': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com',
    'outlook.con': 'outlook.com', 'icloud.con': 'icloud.com', 'example.com': '', 'test.com': '',
}
VN = dt.timezone(dt.timedelta(hours=7))
DUMP = None


# ------------------------------------------------------------------------------------------------ cụm PostgreSQL
class Cluster:
    def __init__(self):
        self.work = tempfile.mkdtemp(prefix='v652fuzz-')
        os.chmod(self.work, 0o755)
        self.root = os.getuid() == 0

    def sh(self, cmd):
        if self.root:
            subprocess.run(['chown', '-R', 'postgres', self.work], check=True)
            return subprocess.run(['su', 'postgres', '-c', cmd], check=True, capture_output=True, text=True)
        return subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)

    def start(self):
        self.sh(f'LC_ALL=C {PGBIN}/initdb -D {self.work}/data -A trust -E UTF8 --locale=C.UTF-8 >/dev/null')
        self.sh(f"{PGBIN}/pg_ctl -D {self.work}/data -o '-p {PORT} -k {self.work} -c listen_addresses= "
                f"-c max_connections=40 -c fsync=off -c synchronous_commit=off' -l {self.work}/log start -w >/dev/null")

    def connect(self):
        c = psycopg2.connect(host=self.work, port=PORT, user='postgres', dbname='postgres')
        c.autocommit = True
        return c

    def stop(self):
        try:
            self.sh(f'{PGBIN}/pg_ctl -D {self.work}/data stop -m fast >/dev/null')
        except Exception:
            pass
        shutil.rmtree(self.work, ignore_errors=True)


def run_file(conn, path):
    with open(path) as f:
        sql = f.read()
    with conn.cursor() as cur:
        cur.execute(sql)


# ------------------------------------------------------------------------------------------------ nguồn email
LOCALS = ['an', 'binh.tran', 'cuong_99', 'dung+ads', "o'neil", 'e-f', 'x', 'ab', 'nguyen.van.a', 'sale01', 'K']
DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'congty.vn', 'mindx.edu.vn', 'a-b.com.vn', 'x.io']


def gen_email(rng, kind=None):
    kind = kind or rng.choice(['ok'] * 6 + ['upper', 'pad', 'typo', 'sample', 'bad', 'blank', 'null', 'weird', 'long',
                                           'multi', 'unicode', 'ctrl'])
    l, d = rng.choice(LOCALS) + str(rng.randint(0, 999)), rng.choice(DOMAINS)
    if kind == 'ok': return f'{l}@{d}'
    if kind == 'upper': return f'{l.title()}@{d.upper()}'
    if kind == 'pad': return rng.choice([' ', '  ', '']) + f'{l}@{d}' + rng.choice([' ', '   '])
    if kind == 'typo': return f'{l}@{rng.choice([k for k, v in TYPO.items() if v])}'
    if kind == 'sample': return f'{l}@{rng.choice(["example.com", "test.com"])}'
    if kind == 'blank': return rng.choice(['', ' ', '   '])
    if kind == 'null': return None
    if kind == 'long': return 'a' * rng.choice([60, 240, 250, 260]) + '@' + d
    if kind == 'multi': return f'{l}@{d}{rng.choice([",", ";", " ", " , "])}b{rng.randint(0, 9)}@{d}'
    if kind == 'unicode': return rng.choice([f'nguyễn@{d}', f'{l}@gmail.com ', f'​{l}@{d}', f'{l}@{d}﻿',
                                              f'K{l}@{d}', f'İ{l}@{d}', f'{l}@ｇmail.com', f'{l}＠{d}'])
    if kind == 'ctrl': return rng.choice([f'{l}@{d}\n', f'\t{l}@{d}', f'{l}@{d}\r\n', f'{l}\n@{d}'])
    if kind == 'weird': return rng.choice([f'{l}@@{d}', f'.{l}@{d}', f'{l}.@{d}', f'{l}..x@{d}', f'{l}@-d.com',
                                            f'{l}@d-.com', f'{l}@d.c', f'{l}@d.c0m', f'{l}@localhost', '@gmail.com',
                                            'a@b.co', 'a@b.cd', "'; drop table org_staff; --@x.com", '0901234567',
                                            f'{l}@{d}.', f'mailto:{l}@{d}', f'"{l}"@{d}', f'{l}@[1.2.3.4]',
                                            f'{l}@xn--p1ai', f'{l}@{d}/'])
    if kind == 'bad': return rng.choice(['abc', 'a@', '@', 'a b@c.com', 'a@b', '', 'a@b..com'])
    raise ValueError(kind)


# ------------------------------------------------------------------------------------------------ mô hình
def jtrue(x):
    """(payload ->> 'k') = 'true' của Postgres: true JSON hoặc chuỗi 'true'."""
    return x is True or x == 'true'


def pg_btrim(s):
    return s.strip(' ')


def norm(conn, s):
    """lower(btrim(coalesce(s,''))) bằng đúng lower() của Postgres (khác Python ở vài ký tự Unicode)."""
    if s is None: return ''
    with conn.cursor() as cur:
        cur.execute('select lower(btrim(%s))', (s,))
        return cur.fetchone()[0]


def model_usable(conn, e, allow=None):
    v = norm(conn, e)
    if not (6 <= len(v) <= 254) or not EMAIL_RE.fullmatch(v):
        return None
    dom = v.split('@')[1] if '@' in v else ''
    if dom in TYPO and v != norm(conn, allow):
        return None
    return v


def vn_today(now):
    return now.astimezone(VN).date()


def model_list_after(conn, old_email, new_email, old_list, op):
    """Danh sách mong đợi sau khi trigger chạy (op 'UPDATE' khi cột email nằm trong lệnh UPDATE)."""
    v_new = norm(conn, new_email)
    v_old = norm(conn, old_email)
    lst = list(old_list or [])
    if v_new == '' or (v_new == v_old and v_new in lst):
        return lst
    out = []
    for e in [v_new, v_old or None] + lst:
        if e is None or e == '' or e in out: continue
        out.append(e)
    return out[:20]


class World:
    def __init__(self, conn, rng):
        self.c = conn
        self.rng = rng

    def q(self, sql, args=None, one=False):
        with self.c.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, args)
            if cur.description is None: return None
            rows = cur.fetchall()
            return (rows[0] if rows else None) if one else rows

    def now(self):
        return self.q('select now() as n', one=True)['n']

    def snap(self, staff_id):
        s = self.q('select id, organization_id, username, email, email_list, coalesce(is_admin,false) a, '
                   'coalesce(is_admin_akabiz,false) z, is_active, deleted_at from org_staff where id=%s', (staff_id,), one=True)
        if not s: return None
        o = self.q('select id, email, email_list, customer_id from org_organization where id=%s', (s['organization_id'],), one=True)
        c = self.q('select id, email, email_list from aka_customer where id=%s', (o['customer_id'],), one=True) if o and o['customer_id'] else None
        p = self.q('select * from private.aka_staff_email_prompt where staff_id=%s', (staff_id,), one=True)
        pk = self.q("select exists(select 1 from org_organization_product p where p.organization_id=%s and p.is_deleted is not true "
                    "and (p.expiration_date at time zone 'Asia/Ho_Chi_Minh')::date >= (now() at time zone 'Asia/Ho_Chi_Minh')::date) x",
                    (s['organization_id'],), one=True)['x']
        cfg = self.q("select value, is_active from auto_system_settings where key='account.email_prompt' order by id limit 1", one=True)
        return {'s': s, 'o': o, 'c': c, 'p': p, 'pk': pk, 'cfg': cfg}

    # ------------------------------------------------------------- mô hình của core
    def enabled(self, sn):
        cfg = sn['cfg']
        if not cfg or cfg['is_active'] is not True: return False
        try:
            v = json.loads(cfg['value'])
        except Exception:
            return False
        if not isinstance(v, dict): return False
        aud = v.get('audience', 'off')
        if aud is None: aud = 'off'
        if aud == 'all': return True
        if aud == 'admin_akabiz': return sn['s']['z']
        if aud == 'orgs':
            ids = v.get('organizationIds')
            return isinstance(ids, list) and any(isinstance(x, (int, float)) and not isinstance(x, bool) and x == sn['s']['organization_id'] for x in ids)
        return False

    def expect(self, sn, action, payload):
        """Trả về (kết quả mong đợi dạng dict con, thay đổi mong đợi: {'staff': email|None, 'org':..., 'cust':...})."""
        s = sn['s']
        if s is None or not s['is_active'] or s['deleted_at'] is not None or sn['o'] is None:
            return {'ok': False, 'code': 'staff_inactive'}, {}
        if not self.enabled(sn):
            return {'ok': True, 'enabled': False, 'show': 'none', 'reason': 'disabled'}, {}
        p = sn['p'] or {}
        e_staff = model_usable(self.c, s['email'], p.get('saved_email'))
        e_org = model_usable(self.c, sn['o']['email'])
        e_crm = model_usable(self.c, sn['c']['email']) if sn['c'] else None
        now = self.now()
        if action == 'state':
            if not sn['pk']:
                return {'ok': True, 'enabled': True, 'show': 'none', 'reason': 'no_package'}, {}
            anyv = e_staff or e_org or e_crm
            if anyv:
                ch = {}
                if s['a']:
                    blank = lambda x: (x is None) or x.strip(' ') == ''
                    if blank(s['email']): ch['staff'] = anyv
                    if blank(sn['o']['email']): ch['org'] = anyv
                    if sn['c'] is not None and blank(sn['c']['email']): ch['cust'] = anyv
                return {'ok': True, 'enabled': True, 'show': 'none', 'reason': 'has_email', 'synced': bool(ch)}, ch
            dismissed = p.get('last_dismissed_at') is not None and vn_today(p['last_dismissed_at']) >= vn_today(now)
            r = {'ok': True, 'enabled': True, 'show': 'none' if dismissed else 'enter',
                 'reason': 'dismissed' if dismissed else 'no_email', 'chip': True, 'username': s['username'], 'isAdmin': s['a']}
            return r, {}
        if action == 'dismiss':
            return {'ok': True, 'dismissed': True}, {}
        if action == 'profile':
            em = norm(self.c, s['email']) or None
            return {'ok': True, 'enabled': True, 'email': em, 'emailList': list(s['email_list']), 'isAdmin': s['a'],
                    'verified': bool(p) and p.get('verified_at') is not None and p.get('saved_email') == norm(self.c, s['email'])}, {}
        if action == 'save':
            client = payload.get('client')
            if client not in ('desktop', 'web', 'ios'):
                return {'ok': False, 'code': 'invalid_client'}, {}
            if p and p.get('save_window_start') and p['save_window_start'] > now - dt.timedelta(hours=1) and p['save_window_count'] >= 5:
                return {'ok': False, 'code': 'rate_limited'}, {}
            if jtrue(payload.get('confirm')):
                v = e_staff or e_org or e_crm
                if not v: return {'ok': False, 'code': 'nothing_to_confirm'}, {}
            else:
                v = norm(self.c, payload.get('email') if isinstance(payload.get('email'), str) else ('' if payload.get('email') is None else json.dumps(payload.get('email'))))
                if not (6 <= len(v) <= 254) or not EMAIL_RE.fullmatch(v):
                    return {'ok': False, 'code': 'email_invalid'}, {}
                fix = TYPO.get(v.split('@')[1])
                if fix == '': return {'ok': False, 'code': 'email_invalid'}, {}
                if fix and not jtrue(payload.get('allowTypo')):
                    return {'ok': False, 'code': 'email_typo', 'suggestion': v.split('@')[0] + '@' + fix}, {}
            ch = {'staff': v}
            if s['a']:
                ch['org'] = v
                if sn['c'] is not None: ch['cust'] = v
            return {'ok': True, 'saved': True, 'email': v, 'isAdmin': s['a']}, ch
        return {'ok': False, 'code': 'invalid_action'}, {}


# ------------------------------------------------------------------------------------------------ dữ liệu
def load_population(w, rng, real, n_synth):
    q = w.q
    q("insert into auto_system_settings(key,value,description,is_secret,is_active) values ('x.other','{}','',false,true) on conflict do nothing")
    staff_rows = []
    cust_id = 90000000
    org_ids = set()
    if real:
        for r in real:
            if r['o'] not in org_ids:
                org_ids.add(r['o'])
                if r['c'] is not None:
                    q('insert into aka_customer(id,email) values (%s,%s) on conflict do nothing', (r['c'], r['ce']))
                q('insert into org_organization(id,customer_id,name,email) values (%s,%s,%s,%s)', (r['o'], r['c'] or 0, 'o', r['oe']))
                if r['pk']:
                    q("insert into org_organization_product(organization_id,product_name,package_name,expiration_date,is_deleted,is_paid) "
                      "values (%s,'akaAgent Zalo','Gói',now()+interval '30 days',false,true)", (r['o'],))
            staff_rows.append(r['s'])
            q('insert into org_staff(id,organization_id,name,username,email,is_active,is_admin,is_admin_akabiz,deleted_at) '
              'values (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
              (r['s'], r['o'], 'n', f"u{r['s']}", r['se'], r['act'], r['a'], r['z'], dt.datetime.now(dt.timezone.utc) if r['del'] else None))
    sid, oid = 900000, 900000
    for i in range(n_synth):
        oid += 1; cust_id += 1
        has_c = rng.random() < 0.9
        if has_c: q('insert into aka_customer(id,email) values (%s,%s)', (cust_id, gen_email(rng)))
        q('insert into org_organization(id,customer_id,name,email) values (%s,%s,%s,%s)', (oid, cust_id if has_c else 0, 'o', gen_email(rng)))
        exp = rng.choice(["now()+interval '30 days'", "now()-interval '1 day'", "now()+interval '1 minute'",
                          "date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') at time zone 'Asia/Ho_Chi_Minh'", None])
        if exp:
            q(f"insert into org_organization_product(organization_id,product_name,package_name,expiration_date,is_deleted,is_paid) "
              f"values (%s,'akaAgent Zalo','Gói',{exp},%s,true)", (oid, rng.choice([False, None, None, True])))
        for k in range(rng.choice([1, 1, 1, 2, 3])):
            sid += 1
            q('insert into org_staff(id,organization_id,name,username,email,is_active,is_admin,is_admin_akabiz) values (%s,%s,%s,%s,%s,%s,%s,%s)',
              (sid, oid, 'n', f'u{sid}', gen_email(rng), rng.random() < 0.95,
               (k == 0) if rng.random() < 0.85 else rng.choice([True, False, None]), rng.random() < 0.05))
            staff_rows.append(sid)
    return staff_rows


# ------------------------------------------------------------------------------------------------ gọi hàm
def call(w, via, staff, action, payload):
    """via: 'desktop' (role aka_agent_desktop + phiên) | 'control' (service_role)."""
    with w.c.cursor() as cur:
        cur.execute('begin')
        try:
            if via == 'desktop':
                cur.execute("select set_config('test.staff', %s, true)", (str(staff),))
                cur.execute('set local role aka_agent_desktop')
                cur.execute('select public.aka_agent_email_prompt(%s, %s::jsonb)', (action, json.dumps(payload)))
            else:
                org = w.q('select organization_id from org_staff where id=%s', (staff,), one=True)
                cur.execute('set local role service_role')
                cur.execute('select public.aka_agent_control_email_prompt(%s, %s, %s, %s::jsonb)',
                            (staff, org['organization_id'] if org else None, action, json.dumps(payload)))
            r = cur.fetchone()[0]
            cur.execute('commit')
            return r
        except Exception:
            cur.execute('rollback')
            raise


def worker(w, action, payload):
    with w.c.cursor() as cur:
        cur.execute('begin')
        cur.execute('set local role service_role')
        try:
            cur.execute('select public.aka_agent_email_prompt_worker(%s, %s::jsonb)', (action, json.dumps(payload)))
            r = cur.fetchone()[0]
            cur.execute('commit')
            return r
        except Exception:
            cur.execute('rollback')
            raise


# ------------------------------------------------------------------------------------------------ vòng thử
class Fuzz:
    def __init__(self, w, rng, staff_ids):
        self.w, self.rng, self.staff = w, rng, staff_ids
        self.issues = Counter()
        self.samples = {}
        self.stats = Counter()
        self.unlinked = {}  # staff -> (email đã gỡ, email trước khi lưu)
        self.pre_save = {}  # staff -> email trước lần lưu gần nhất

    def bad(self, key, detail):
        self.issues[key] += 1
        self.samples.setdefault(key, detail)

    def pick(self):
        return self.rng.choice(self.staff)

    def set_config(self):
        v = self.rng.choice(['{"audience":"all"}'] * 6 + ['{"audience":"off"}', '{"audience":"admin_akabiz"}',
            '{"audience":"orgs","organizationIds":[900001,900005,900010]}', '{"audience":"orgs","organizationIds":["900001"]}',
            '{"audience":"orgs"}', 'null', '[]', 'không phải json', '{"audience":null}', '{"audience":"ALL"}', '{}'])
        act = self.rng.random() < 0.95
        self.w.q("update auto_system_settings set value=%s, is_active=%s where key='account.email_prompt'", (v, act))
        self.stats['config'] += 1

    def compare(self, label, got, exp, ctx):
        for k, v in exp.items():
            if got.get(k) != v:
                self.bad(f'{label}: {k}', {'got': got, 'exp': exp, 'cfg': self.w.q("select value, is_active from auto_system_settings where key='account.email_prompt'", one=True), **ctx})
                return False
        if got.get('ok') is False and set(got) - {'ok', 'code', 'suggestion'}:
            self.bad(f'{label}: lỗi có khoá thừa', {'got': got, **ctx})
        return True

    def check_after(self, label, sn0, ch, ctx):
        sn1 = self.w.snap(sn0['s']['id'])
        for key, tbl in (('staff', 's'), ('org', 'o'), ('cust', 'c')):
            r0, r1 = sn0[tbl], sn1[tbl]
            if r0 is None: continue
            want_email = ch.get(key)
            if want_email is None:
                if r1['email'] != r0['email']:
                    self.bad(f'{label}: {key} đổi email ngoài ý muốn', {'before': r0['email'], 'after': r1['email'], **ctx})
                if list(r1['email_list']) != list(r0['email_list']):
                    self.bad(f'{label}: {key} đổi email_list ngoài ý muốn', {'before': r0['email_list'], 'after': r1['email_list'], **ctx})
            else:
                if norm(self.w.c, r1['email']) != want_email:
                    self.bad(f'{label}: {key} email sai', {'want': want_email, 'after': r1['email'], **ctx})
                exp_list = model_list_after(self.w.c, r0['email'], r1['email'], r0['email_list'], 'UPDATE') \
                    if r1['email'] != r0['email'] else list(r0['email_list'])
                if list(r1['email_list']) != exp_list:
                    self.bad(f'{label}: {key} email_list sai', {'want': exp_list, 'after': r1['email_list'], 'before': r0['email_list'],
                                                                 'emails': [r0['email'], r1['email']], **ctx})
        return sn1

    def invariants(self, sid):
        sn = self.w.snap(sid)
        for tbl in ('s', 'o', 'c'):
            r = sn[tbl]
            if r is None: continue
            lst = list(r['email_list'])
            if len(lst) != len(set(lst)): self.bad(f'bất biến: {tbl} email_list trùng', {'list': lst, 'sid': sid})
            if len(lst) > 20: self.bad(f'bất biến: {tbl} email_list > 20', {'n': len(lst), 'sid': sid})
            if any(x is None or x == '' or x != norm(self.w.c, x) for x in lst):
                self.bad(f'bất biến: {tbl} email_list có phần tử chưa chuẩn', {'list': lst, 'sid': sid})
            e = norm(self.w.c, r['email'])
            if e and (not lst or lst[0] != e):
                self.bad(f'bất biến: {tbl} email hiện tại không đứng đầu email_list', {'email': r['email'], 'list': lst, 'sid': sid})
        return sn

    def op_rpc(self, action):
        sid = self.pick()
        via = self.rng.choice(['desktop', 'control'])
        payload = {}
        if action == 'save':
            r = self.rng.random()
            if r < 0.12: payload = {'client': self.rng.choice(['desktop', 'web', 'ios']), 'confirm': True}
            else:
                payload = {'client': self.rng.choice(['desktop', 'web', 'ios'] * 8 + ['android', None, '', 'DESKTOP'])}
                em = gen_email(self.rng)
                if self.rng.random() < 0.03: em = self.rng.choice([123, ['a@b.com'], {'e': 1}, True])
                if self.rng.random() < 0.85: payload['email'] = em
                if self.rng.random() < 0.3: payload['allowTypo'] = self.rng.choice([True, True, 'true', 1, False])
                if self.rng.random() < 0.03: payload['confirm'] = self.rng.choice(['true', 1, False])
        elif self.rng.random() < 0.02:
            payload = self.rng.choice([[], 'x', None, {'client': 'web'}])
        sn0 = self.w.snap(sid)
        ctx = {'sid': sid, 'via': via, 'action': action, 'payload': payload}
        exp, ch = self.w.expect(sn0, action, payload if isinstance(payload, dict) else {})
        try:
            got = call(self.w, via, sid, action, payload)
        except Exception as ex:
            self.bad(f'{action}: lỗi SQL', {'err': str(ex)[:300], **ctx})
            return
        if DUMP is not None: DUMP.write(json.dumps({'action': action, 'raw': got}, ensure_ascii=False) + '\n')
        self.stats[f'{action}:{got.get("code") or got.get("reason") or ("saved" if got.get("saved") else "ok")}'] += 1
        if action == 'save' and got.get('saved') and sn0['p'] is None or (action == 'save' and got.get('saved') and True):
            self.pre_save[sid] = (sn0['s']['email'], sn0['o']['email'], sn0['c']['email'] if sn0['c'] else None)
        if not self.compare(action, got, exp, ctx):
            return
        sn1 = self.check_after(action, sn0, ch, ctx)
        # Bất biến theo nghiệp vụ.
        if action == 'state' and got.get('show') == 'enter':
            if any(model_usable(self.w.c, x) for x in (sn1['s']['email'], sn1['o']['email'], sn1['c']['email'] if sn1['c'] else None)):
                self.bad('state: hiện form khi đã có email', ctx)
        if action == 'save' and got.get('saved') and not sn1['s']['a']:
            if sn1['o']['email'] != sn0['o']['email'] or (sn1['c'] and sn1['c']['email'] != sn0['c']['email']):
                self.bad('save: nhân viên ghi vào tổ chức / CRM', ctx)
        if action == 'save' and got.get('saved'):
            st = call(self.w, 'control', sid, 'state', {})
            if st.get('show') == 'enter':
                self.bad('save xong mà state vẫn hỏi', {'state': st, **ctx})
        self.invariants(sid)

    def op_external_edit(self):
        """CRM / Web / SQL tay sửa email của 1 trong 3 bảng."""
        sid = self.pick()
        sn0 = self.w.snap(sid)
        tbl, key = self.rng.choice([('org_staff', 's'), ('org_organization', 'o'), ('aka_customer', 'c')])
        r0 = sn0[key]
        if r0 is None: return
        new = gen_email(self.rng)
        self.w.q(f'update {tbl} set email=%s where id=%s', (new, r0['id']))
        r1 = self.w.snap(sid)[key]
        exp = model_list_after(self.w.c, r0['email'], new, r0['email_list'], 'UPDATE')
        if list(r1['email_list']) != exp:
            self.bad('sửa tay: email_list sai', {'tbl': tbl, 'before': r0['email_list'], 'old': r0['email'], 'new': new, 'got': r1['email_list'], 'want': exp})
        self.stats['external_edit'] += 1
        self.invariants(sid)

    def op_time(self):
        hours = self.rng.choice([1, 2, 12, 24, 30])
        self.w.q(f"""update private.aka_staff_email_prompt set
            last_dismissed_at = last_dismissed_at - interval '{hours} hours', last_shown_at = last_shown_at - interval '{hours} hours',
            save_window_start = save_window_start - interval '{hours} hours', verify_next_at = verify_next_at - interval '{hours} hours',
            saved_at = saved_at - interval '{hours} hours'""")
        self.w.q(f"update org_organization_product set expiration_date = expiration_date - interval '{hours} hours'")
        self.stats['time'] += 1

    def op_flags(self):
        sid = self.pick()
        f = self.rng.choice(['is_admin', 'is_active', 'deleted_at'])
        if f == 'deleted_at':
            self.w.q('update org_staff set deleted_at = case when deleted_at is null then now() end where id=%s', (sid,))
        elif f == 'is_admin':
            self.w.q('update org_staff set is_admin = %s where id=%s', (self.rng.choice([True, False, None]), sid))
        else:
            self.w.q('update org_staff set is_active = not is_active where id=%s', (sid,))
        self.stats['flags'] += 1

    def op_worker(self):
        a = self.rng.choice(['claim'] * 4 + ['sent', 'failed', 'verify', 'unlink', 'bad'])
        if a == 'claim':
            lim = self.rng.choice([1, 5, 20, 50, 0, -3, 1000, 'x'])
            before = {r['staff_id']: r for r in self.w.q('select * from private.aka_staff_email_prompt')}
            try:
                got = worker(self.w, 'claim', {'limit': lim})
            except Exception as ex:
                self.bad('worker claim: lỗi SQL', {'err': str(ex)[:300], 'limit': lim}); return
            items = got.get('items') or []
            self.stats['claim_items'] += len(items)
            exp_lim = 20 if not isinstance(lim, int) or lim is True else min(max(lim, 1), 50)
            if len(items) > exp_lim: self.bad('worker claim: vượt giới hạn', {'n': len(items), 'limit': lim})
            seen = set()
            for it in items:
                sid = it['staffId']
                if sid in seen: self.bad('worker claim: trùng', {'sid': sid})
                seen.add(sid)
                b = before.get(sid)
                s = self.w.q('select email, is_active, deleted_at from org_staff where id=%s', (sid,), one=True)
                if not b or b['saved_email'] != it['email'] or b['verify_sent_at'] is not None or b['verified_at'] is not None:
                    self.bad('worker claim: nhận dòng không đến hạn', {'it': it, 'before': str(b)})
                if norm(self.w.c, s['email']) != it['email'] or not s['is_active'] or s['deleted_at'] is not None:
                    self.bad('worker claim: gửi cho email đã đổi / tài khoản đã khoá', {'it': it, 'staff': str(s)})
            # Lấy lại ngay thì không ra lại các dòng vừa nhận (đang giữ chỗ 10 phút).
            try:
                again = worker(self.w, 'claim', {'limit': 50}).get('items') or []
            except Exception as ex:
                self.bad('worker claim: lỗi SQL', {'err': str(ex)[:300]}); again = []
            dup = seen & {x['staffId'] for x in again}
            if dup: self.bad('worker claim: nhận lại dòng đang giữ chỗ', {'dup': sorted(dup)[:5]})
            for it in items + again:
              try:
                r = self.rng.random()
                if r < 0.6: worker(self.w, 'sent', {'staffId': it['staffId'], 'email': it['email']})
                elif r < 0.8: worker(self.w, 'failed', {'staffId': it['staffId'], 'email': it['email'], 'retryable': self.rng.choice([True, False, 'true']), 'error': 'x' * self.rng.choice([5, 500])})
              except Exception as ex:
                self.bad('worker sent/failed: lỗi SQL', {'err': str(ex)[:300]})
            return
        rows = self.w.q('select p.*, s.email semail from private.aka_staff_email_prompt p join org_staff s on s.id=p.staff_id')
        if not rows: return
        r = self.rng.choice(rows)
        sid = r['staff_id']
        email = r['saved_email'] if self.rng.random() < 0.8 else self.rng.choice([norm(self.w.c, r['semail']), 'khac@gmail.com', '', None])
        pl = {'staffId': sid if self.rng.random() < 0.95 else self.rng.choice([str(sid), 'abc', -1, None]), 'email': email}
        if a == 'bad':
            try:
                got = worker(self.w, self.rng.choice(['nope', '', 'CLAIM']), pl)
            except Exception as ex:
                self.bad('worker lệnh lạ: lỗi SQL', {'err': str(ex)[:300], 'pl': pl}); return
            if False: got = worker(self.w, self.rng.choice(['nope', '', 'CLAIM']), pl)
            if got.get('ok') is not False: self.bad('worker: lệnh lạ không bị từ chối', {'got': got})
            return
        sn0 = self.w.snap(sid)
        try:
            got = worker(self.w, a, pl)
        except Exception as ex:
            self.bad(f'worker {a}: lỗi SQL', {'err': str(ex)[:300], 'pl': pl}); return
        self.stats[f'w_{a}:{got.get("code") or "ok"}'] += 1
        sn1 = self.w.snap(sid)
        ok = got.get('ok')
        cur_staff = norm(self.w.c, sn0['s']['email'])
        valid_id = isinstance(pl['staffId'], (int, str)) and re.fullmatch(r'[0-9]{1,18}', str(pl['staffId'])) is not None
        match = valid_id and sn0['p'] and sn0['p']['saved_email'] is not None and sn0['p']['saved_email'] == norm(self.w.c, email)
        if a in ('verify', 'unlink'): match = match and cur_staff == norm(self.w.c, email)
        if bool(ok) != bool(match):
            self.bad(f'worker {a}: kết quả', {'got': got, 'pl': pl, 'saved': sn0['p'] and sn0['p']['saved_email'], 'staff_email': sn0['s']['email']})
            return
        if a == 'unlink' and ok:
            if norm(self.w.c, sn1['s']['email']) == norm(self.w.c, email):
                self.bad('unlink: email vẫn còn', {'sid': sid})
            pre = self.pre_save.get(sid)
            if pre is not None:
                # Trả lại email trước lần lưu; trước đó đã là chính email bị gỡ (hoặc trống) thì để trống.
                want_staff = '' if norm(self.w.c, pre[0]) == norm(self.w.c, email) else (norm(self.w.c, pre[0]) or '')
                if norm(self.w.c, sn1['s']['email']) != want_staff:
                    self.bad('unlink: không trả lại đúng email trước khi lưu', {'sid': sid, 'before_save': pre[0], 'after_unlink': sn1['s']['email'], 'list': sn0['s']['email_list']})
                if sn0['p']['saved_as_admin']:
                    for i, key in ((1, 'o'), (2, 'c')):
                        if sn1[key] is None: continue
                        if norm(self.w.c, sn0[key]['email']) != norm(self.w.c, email): continue
                        want = '' if norm(self.w.c, pre[i]) == norm(self.w.c, email) else (norm(self.w.c, pre[i]) or '')
                        if norm(self.w.c, sn1[key]['email']) != want:
                            self.bad(f'unlink: {key} không trả lại đúng email trước khi lưu', {'sid': sid, 'before_save': pre[i], 'after_unlink': sn1[key]['email']})
            self.pre_save.pop(sid, None)
            st = call(self.w, 'control', sid, 'state', {})
            self.stats['unlink_then_state:' + str(st.get('reason'))] += 1
        if a == 'verify' and ok:
            pf = call(self.w, 'control', sid, 'profile', {})
            if pf.get('ok') and pf.get('enabled') is not False and pf.get('verified') is not True:
                self.bad('verify xong mà profile chưa xác nhận', {'pf': pf})
        self.invariants(sid)

    def run(self, n):
        ops = [('state', 30), ('dismiss', 8), ('save', 25), ('profile', 6), ('ext', 8), ('time', 3), ('flags', 3), ('worker', 12), ('config', 1)]
        names = [o for o, wgt in ops for _ in range(wgt)]
        for i in range(n):
            o = self.rng.choice(names)
            if o in ('state', 'dismiss', 'save', 'profile'): self.op_rpc(o)
            elif o == 'ext': self.op_external_edit()
            elif o == 'time': self.op_time()
            elif o == 'flags': self.op_flags()
            elif o == 'worker': self.op_worker()
            else: self.set_config()


def concurrency(w, cluster, rng, staff_ids, issues):
    """Nhiều kết nối cùng gọi state / save cho cùng tài khoản."""
    import threading
    sid = rng.choice([s for s in staff_ids if w.q('select is_active and deleted_at is null x from org_staff where id=%s', (s,), one=True)['x']] or staff_ids)
    w.q('delete from private.aka_staff_email_prompt where staff_id=%s', (sid,))
    errs = []

    def go(k):
        c = cluster.connect()
        ww = World(c, random.Random(k))
        for j in range(15):
            try:
                a = 'save' if (k + j) % 3 == 0 else 'state'
                call(ww, 'control', sid, a, {'client': 'web', 'email': f'cc{k}_{j}@gmail.com'} if a == 'save' else {})
            except Exception as ex:
                errs.append(str(ex)[:200])
        c.close()
    ts = [threading.Thread(target=go, args=(k,)) for k in range(8)]
    [t.start() for t in ts]; [t.join() for t in ts]
    if errs: issues['đồng thời: lỗi SQL'] += len(errs); print('  ví dụ lỗi đồng thời:', errs[0])
    p = w.q('select save_window_count from private.aka_staff_email_prompt where staff_id=%s', (sid,), one=True)
    if p and p['save_window_count'] > 5: issues['đồng thời: vượt hạn 5 lần lưu / giờ'] += 1
    s = w.q('select email_list from org_staff where id=%s', (sid,), one=True)
    if len(s['email_list']) != len(set(s['email_list'])): issues['đồng thời: email_list trùng'] += 1


def node(mode, data):
    r = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', os.path.join(HERE, 'client-check.mts'), mode],
                       input=json.dumps(data), capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def client_checks(w, rng, f):
    """1) Bộ kiểm email của giao diện và của DB cho cùng chuỗi; 2) mọi kết quả RPC đọc được bằng hàm của app."""
    raws = []
    for i in range(4000):
        if rng.random() < 0.35:
            raws.append(''.join(rng.choice("ab.@-_+'%9 AZ\u00e9\u212a\u0130\u00a0\t\ufeff") for _ in range(rng.randint(0, 16)))
                        + rng.choice(['', '@gmail.com', '.vn', '@gmail.con', '@example.com']))
        else:
            raws.append(gen_email(rng) or '')
    res = node('validate', raws)
    # Một admin riêng để gọi save trong giao dịch rồi huỷ (không đụng hạn 5 lần / giờ).
    w.q("insert into aka_customer(id,email) values (99999990,null) on conflict do nothing")
    w.q("insert into org_organization(id,customer_id,name,email) values (99999990,99999990,'v',null) on conflict do nothing")
    w.q("insert into org_organization_product(organization_id,product_name,package_name,expiration_date,is_deleted,is_paid) values (99999990,'a','b',now()+interval '9 days',false,true)")
    w.q("insert into org_staff(id,organization_id,name,username,email,is_admin) values (99999990,99999990,'v','v',null,true) on conflict do nothing")
    w.q("update auto_system_settings set value='{\"audience\":\"all\"}', is_active=true where key='account.email_prompt'")
    for r in res:
        out = {}
        for allow in (False, True):
            with w.c.cursor() as cur:
                cur.execute('begin')
                cur.execute('set local role service_role')
                cur.execute("select public.aka_agent_control_email_prompt(99999990, 99999990, 'save', %s::jsonb)",
                            (json.dumps({'client': 'web', 'email': r['sent'], 'allowTypo': allow}),))
                out[allow] = cur.fetchone()[0]
                cur.execute('rollback')
        db_ok = out[True].get('saved') is True
        if db_ok != r['valid']:
            f.bad('giao diện / DB: khác nhau về email hợp lệ', {'raw': r['raw'], 'sent': r['sent'], 'ui': r['valid'], 'db': out[True]})
        db_fix = out[False].get('suggestion') if out[False].get('code') == 'email_typo' else None
        if r['valid'] and db_fix != r['fix']:
            f.bad('giao diện / DB: khác nhau về gợi ý sửa tên miền', {'sent': r['sent'], 'ui': r['fix'], 'db': out[False]})
        if db_ok and out[True]['email'] != r['sent']:
            f.bad('giao diện / DB: email lưu khác email gửi', {'sent': r['sent'], 'db': out[True]['email']})
    f.stats['validate_strings'] += len(res)
    if DUMP is not None:
        DUMP.flush()
        rows = [json.loads(l) for l in open(DUMP.name)]
        parsed = node('parse', rows)
        for x in parsed:
            raw, pr = x['raw'], x['parsed']
            if raw.get('ok') is True and raw.get('enabled') is not False and pr.get('ok') is not True:
                f.bad('hàm đọc của app: kết quả đúng bị đọc thành lỗi', x)
            if raw.get('ok') is False and pr.get('ok') is not False:
                f.bad('hàm đọc của app: lỗi bị đọc thành đúng', x)
            if raw.get('ok') is False and pr.get('code') == 'unavailable':
                f.bad('hàm đọc của app: mã lỗi DB không có trong danh sách', {'code': raw.get('code')})
            if x['action'] == 'state' and raw.get('ok') and pr['data']['show'] != raw.get('show'):
                f.bad('hàm đọc của app: show lệch', x)
            if x['action'] == 'state' and raw.get('enabled') is False and pr['data']['enabled'] is not False:
                f.bad('hàm đọc của app: tắt mà đọc thành bật', x)
        f.stats['parsed_rpc'] += len(parsed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--ops', type=int, default=3000)
    ap.add_argument('--synth', type=int, default=400)
    ap.add_argument('--real')
    ap.add_argument('--extra', action='append', default=[])
    ap.add_argument('--dump')
    ap.add_argument('--strings', help='ghi kết quả kiểm email của DB cho 5.000 chuỗi ngẫu nhiên ra file này')
    a = ap.parse_args()
    global DUMP
    DUMP = open(a.dump, 'w') if a.dump else None
    rng = random.Random(a.seed)
    cl = Cluster()
    t0 = time.time()
    try:
        cl.start()
        conn = cl.connect()
        run_file(conn, os.path.join(HERE, 'fixture.sql'))
        for p in ('p1', 'p2', 'p3'):
            run_file(conn, os.path.join(REPO, 'migrations', f'migration_v652_staff_email_prompt_{p}.sql'))
        w = World(conn, rng)
        real = json.load(open(a.real)) if a.real else None
        if real:
            real = rng.sample(real, min(len(real), rng.choice([600, 1200, len(real)])))
        staff = load_population(w, rng, real, a.synth)
        # p3 lần nữa trên dữ liệu vừa nạp (dữ liệu cũ trước khi có trigger: tắt trigger lúc nạp không có, nên kiểm p3 chạy lại).
        run_file(conn, os.path.join(REPO, 'migrations', 'migration_v652_staff_email_prompt_p3.sql'))
        for x in a.extra: run_file(conn, x)
        w.q("update auto_system_settings set value='{\"audience\":\"all\"}' where key='account.email_prompt'")
        f = Fuzz(w, rng, staff)
        f.run(a.ops)
        concurrency(w, cl, rng, staff, f.issues)
        client_checks(w, rng, f)
        dt_ = time.time() - t0
        print(f'seed={a.seed} ops={a.ops} staff={len(staff)} {dt_:.0f}s')
        print('  thống kê:', ', '.join(f'{k}={v}' for k, v in sorted(f.stats.items())))
        if f.issues:
            print(f'  VẤN ĐỀ ({sum(f.issues.values())}):')
            for k, v in f.issues.most_common():
                print(f'   - {k}: {v}  ví dụ: {json.dumps(f.samples.get(k), ensure_ascii=False, default=str)[:600]}')
            sys.exit(1)
        print('  SẠCH')
    finally:
        cl.stop()


if __name__ == '__main__':
    main()
