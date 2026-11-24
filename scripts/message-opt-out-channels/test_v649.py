#!/usr/bin/env python3
"""Kiểm V649 (link từ chối nhận tin cho SMS, email, Facebook) trên Postgres cục bộ.

Chạy: python3 scripts/message-opt-out-channels/test_v649.py   (PGBIN mặc định /usr/lib/postgresql/16/bin)

Nền: fixture.sql (bảng tối thiểu + hàm phụ thuộc như production) + ba hàm production đọc 24/11/2026
(migrations/snapshots/message-opt-out-channels-v649/live-functions-20261124.sql). Không chạm DB thật.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PGBIN = Path(os.environ.get('PGBIN', '/usr/lib/postgresql/16/bin'))
MIGRATION = ROOT / 'migrations' / 'migration_v649_message_opt_out_channels.sql'
ROLLBACK = ROOT / 'migrations' / 'rollback_v649_message_opt_out_channels.sql'
SNAPSHOT = ROOT / 'migrations' / 'snapshots' / 'message-opt-out-channels-v649' / 'live-functions-20261124.sql'
FIXTURE = Path(__file__).with_name('fixture.sql')
LIVE_MD5 = {
    'aka_agent_check_zalo_message_opt_out': 'debba6a72e49cf2ad16b7ac764fc2e06',
    'aka_agent_list_message_opt_out_customers': '90a3006ec70fec161ec7eb5862c10368',
    'aka_agent_list_sms_due_input_data': '9b7c118534bf14c7ace4a4c60fc68755',
}
LINK = re.compile(r'https://b\.akabiz\.biz/s/[A-Za-z0-9_-]{22}')

passed = 0
failed = 0


def check(name, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1
        print(f'PASS {name}')
    else:
        failed += 1
        print(f'FAIL {name} {detail}')


class Cluster:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix='v649-'))
        self.port = 56000 + (os.getpid() % 900)
        self.root = os.geteuid() == 0
        if self.root:
            shutil.chown(self.dir, 'postgres')
            os.chmod(self.dir, 0o755)
        self._as_pg([str(PGBIN / 'initdb'), '-D', str(self.dir / 'data'), '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--locale=C'])
        with open(self.dir / 'data' / 'postgresql.conf', 'a') as fh:
            fh.write(f"\nlisten_addresses = ''\nunix_socket_directories = '{self.dir}'\nport = {self.port}\nfsync = off\n")
        self._as_pg([str(PGBIN / 'pg_ctl'), '-D', str(self.dir / 'data'), '-l', str(self.dir / 'log'), '-w', 'start'])

    def _as_pg(self, args):
        cmd = (['runuser', '-u', 'postgres', '--'] + args) if self.root else args
        res = subprocess.run(cmd, capture_output=True, text=True, env={**os.environ, 'LC_ALL': 'C'})
        if res.returncode != 0:
            raise RuntimeError(res.stderr[-3000:])

    def psql(self, sql, stop=True):
        res = subprocess.run([str(PGBIN / 'psql'), '-X', '-h', str(self.dir), '-p', str(self.port), '-U', 'postgres',
                              '-d', 'postgres', '-v', f"ON_ERROR_STOP={'1' if stop else '0'}", '-Atq'],
                             input=sql, capture_output=True, text=True)
        if stop and res.returncode != 0:
            raise RuntimeError(res.stderr[-4000:])
        return res.stdout.strip(), res.stderr.strip(), res.returncode

    def q(self, sql):
        return self.psql(sql)[0]

    def rows(self, sql):
        return json.loads(self.q(f"SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), '[]'::jsonb) FROM ({sql}) r;"))

    def error(self, sql):
        out, err, code = self.psql(sql, stop=False)
        return err if code != 0 or 'ERROR' in err else ''

    def close(self):
        try:
            self._as_pg([str(PGBIN / 'pg_ctl'), '-D', str(self.dir / 'data'), '-m', 'immediate', '-w', 'stop'])
        finally:
            shutil.rmtree(self.dir, ignore_errors=True)


def fn_md5(db):
    return {r['proname']: r['md5'] for r in db.rows(
        "SELECT p.proname, md5(p.prosrc) md5 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
        "WHERE n.nspname = 'public' AND p.proname IN ('aka_agent_check_zalo_message_opt_out', "
        "'aka_agent_list_message_opt_out_customers', 'aka_agent_list_sms_due_input_data')")}


SEED = """
INSERT INTO org_staff VALUES (10, 1), (11, 1), (20, 2);
INSERT INTO auto_accounts VALUES (100, 10, 1, 'sms'), (101, 10, 1, 'email'), (102, 10, 1, 'facebook'), (103, 10, 1, 'zalo'),
  (110, 11, 1, 'sms'), (200, 20, 2, 'sms');
-- 1000: SMS bật link, không dấu, không giữ xuống dòng; 1001: SMS bật link, có dấu, giữ xuống dòng; 1002: SMS không bật link;
-- 1003: SMS nhân viên khác cùng tổ chức; 1010 email; 1020 Facebook UID; 1021 inbox Page; 1030 Zalo theo SĐT.
INSERT INTO auto_campaigns (id, name, staff_id, organization_id, account_id, action_id, schedule, extra_settings) VALUES
  (1000, 'SMS A', 10, 1, 100, 'sms_send', now() - interval '1 hour', '{"zaloOptOutLinkEnabled": true}'),
  (1001, 'SMS B', 10, 1, 100, 'sms_send', now() - interval '1 hour', '{"zaloOptOutLinkEnabled": true, "smsUseUnicode": true, "smsKeepNewLines": true}'),
  (1002, 'SMS C', 10, 1, 100, 'sms_send', now() - interval '1 hour', '{}'),
  (1003, 'SMS D', 11, 1, 110, 'sms_send', now() - interval '1 hour', '{"zaloOptOutLinkEnabled": true}'),
  (1010, 'Email', 10, 1, 101, 'email_send', now(), '{"zaloOptOutLinkEnabled": true}'),
  (1020, 'FB UID', 10, 1, 102, 'facebook_message_uid', now(), '{"zaloOptOutLinkEnabled": true}'),
  (1021, 'FB inbox', 10, 1, 102, 'facebook_page_to_message', now(), '{}'),
  (1030, 'Zalo', 10, 1, 103, 'zalo_message_phone', now(), '{}');
INSERT INTO auto_campaign_input_data (id, campaign_id, phone, content, created_at) VALUES
  (1, 1000, '0912345678', 'Chao ban', now() - interval '5 min'),
  (2, 1000, '0912345679', 'Chao ban, tu choi: #{STOP_MESSAGES_LINK}', now() - interval '4 min'),
  (3, 1001, '0912345670', 'Chào bạn  ', now() - interval '3 min'),
  (4, 1002, '0912345671', 'Xin chao #{STOP_MESSAGES_LINK}', now() - interval '2 min'),
  (5, 1002, '0912345672', 'Xin chao', now() - interval '1 min');
INSERT INTO auto_campaign_input_data (id, campaign_id, phone, content, created_at) VALUES
  (6, 1003, '0912345678', 'Chao ban', now());
-- Một dòng Zalo đã từ chối có SĐT, như production.
INSERT INTO auto_zalo_message_opt_outs (phone, zalo_global_id, staff_id, organization_id, confirmed_at)
VALUES ('0988000001', 'g-1', 10, 1, now());
"""


def list_sms(db, account=100, campaigns=None):
    arr = 'NULL' if campaigns is None else f"ARRAY{campaigns}::bigint[]"
    return db.rows(f"SELECT * FROM aka_agent_list_sms_due_input_data({account}, {arr}, NULL, 100, 30)")


def main():
    db = Cluster()
    try:
        db.q(FIXTURE.read_text())
        db.q(SNAPSHOT.read_text())
        check('nền: ba hàm production đúng md5', fn_md5(db) == LIVE_MD5, fn_md5(db))
        db.q(SEED)
        # Bản chép hàm danh sách cũ để so thứ tự / giới hạn.
        legacy = SNAPSHOT.read_text().split('CREATE OR REPLACE FUNCTION public.aka_agent_list_sms_due_input_data')[1]
        db.q('CREATE OR REPLACE FUNCTION public.legacy_list_sms' + legacy.split('$function$;')[0] + '$function$;')
        before = list_sms(db)

        db.q(MIGRATION.read_text())
        check('apply V649', True)
        err = db.error(MIGRATION.read_text())
        check('chạy lại bị từ chối', 'cột channel đã có' in err, err[-200:])
        check('dòng Zalo cũ thành kênh zalo', db.q("SELECT channel FROM auto_zalo_message_opt_outs WHERE zalo_global_id = 'g-1'") == 'zalo')
        check('công tắc tắt sau apply', db.q("SELECT value FROM auto_system_settings WHERE key = 'message_opt_out.channels'")
              == '{"sms":false,"email":false,"facebook":false}')
        opt = db.rows("SELECT error_code, public_code, customer_title, counts_toward_limit, error_class FROM auto_error WHERE public_code IN ('OPT01','OPT02') ORDER BY public_code")
        check('OPT02 chép từ OPT01', len(opt) == 2 and opt[1]['customer_title'].endswith('Facebook')
              and opt[1]['error_class'] == opt[0]['error_class'] and opt[1]['counts_toward_limit'] is False, opt)
        pol = db.rows("SELECT error_code, target_effect, quota_effect, detail_mode, revision, updated_by FROM auto_outcome_policies ORDER BY id")
        check('chính sách OPT02 như OPT01', len(pol) == 2 and {k: v for k, v in pol[1].items() if k != 'error_code'}
              == {k: v for k, v in pol[0].items() if k != 'error_code'}, pol)

        # ── Kênh SMS tắt: không đổi gì trừ bỏ biến ──
        off = list_sms(db)
        legacy_ids = [r['input_data_id'] for r in db.rows("SELECT * FROM legacy_list_sms(100, NULL, NULL, 100, 30)")]
        check('tắt: cùng dòng, cùng thứ tự như hàm cũ', [r['input_data_id'] for r in off] == legacy_ids == [r['input_data_id'] for r in before])
        by = {r['input_data_id']: r for r in off}
        check('tắt: biến bị bỏ, không gửi nguyên văn', by[2]['content'] == 'Chao ban, tu choi: ' and by[4]['content'] == 'Xin chao ')
        check('tắt: không thêm dòng cuối', by[1]['content'] == 'Chao ban')
        check('tắt: không tạo link nào', db.q("SELECT count(*) FROM auto_zalo_message_opt_outs WHERE channel <> 'zalo'") == '0')
        check('tắt: giới hạn giữ nguyên', [r['input_data_id'] for r in db.rows(
            "SELECT * FROM aka_agent_list_sms_due_input_data(100, NULL, NULL, 2, 30)")] == legacy_ids[:2])

        # ── Bật SMS ──
        db.q("UPDATE auto_system_settings SET value = '{\"sms\":true,\"email\":true,\"facebook\":true}' WHERE key = 'message_opt_out.channels'")
        on = list_sms(db)
        by = {r['input_data_id']: r for r in on}
        check('bật: cùng dòng như hàm cũ', [r['input_data_id'] for r in on] == legacy_ids)
        c1 = by[1]['content']
        check('bật: không dấu, không xuống dòng → " Tu choi nhan tin: <link>"',
              re.fullmatch(r'Chao ban Tu choi nhan tin: https://b\.akabiz\.biz/s/[A-Za-z0-9_-]{22}', c1) is not None, c1)
        c2 = by[2]['content']
        check('bật: có biến thì thay tại chỗ, không thêm dòng cuối',
              re.fullmatch(r'Chao ban, tu choi: https://b\.akabiz\.biz/s/[A-Za-z0-9_-]{22}', c2) is not None, c2)
        c3 = by[3]['content']
        check('bật: có dấu + giữ xuống dòng → "\\nTừ chối nhận tin: <link>"',
              re.fullmatch(r'Chào bạn\nTừ chối nhận tin: https://b\.akabiz\.biz/s/[A-Za-z0-9_-]{22}', c3) is not None, repr(c3))
        check('bật nhưng chiến dịch không bật link: bỏ biến, không dòng cuối', by[4]['content'] == 'Xin chao ' and by[5]['content'] == 'Xin chao')
        again = {r['input_data_id']: r['content'] for r in list_sms(db)}
        check('đọc lại ra đúng link cũ', again[1] == c1 and again[2] == c2)
        rows = db.rows("SELECT channel, phone, staff_id, source_campaign_id, source_campaign_name, source_action_name FROM auto_zalo_message_opt_outs WHERE channel = 'sms' ORDER BY phone")
        check('bật: mỗi SĐT một dòng kênh sms (chỉ chiến dịch bật link)', [r['phone'] for r in rows] == ['0912345670', '0912345678', '0912345679'], rows)
        check('nguồn = chiến dịch phát link', rows[1]['source_campaign_name'] == 'SMS A' and rows[1]['source_action_name'] == 'Gửi tin nhắn SMS')
        tok = LINK.search(c1).group(0).rsplit('/', 1)[1]
        opt_id = db.q("SELECT id FROM auto_zalo_message_opt_outs WHERE channel = 'sms' AND phone = '0912345678'")
        check('link = mã hoá id', db.q(f"SELECT private.aka_agent_message_opt_out_token('{opt_id}')") == tok)

        # Xác nhận từ chối SĐT 0912345678 (dòng 1 của 1000) bằng hàm xác nhận cũ.
        db.q(f"SELECT * FROM aka_agent_confirm_zalo_message_opt_out('{opt_id}')")
        ins = db.rows(f"SELECT * FROM aka_agent_inspect_message_opt_out('{opt_id}')")
        check('inspect mới trả kênh', ins == [{'state': 'confirmed', 'channel': 'sms'}], ins)
        ins0 = db.rows("SELECT * FROM aka_agent_inspect_message_opt_out('00000000-0000-4000-8000-000000000000')")
        check('inspect mã lạ = invalid', ins0[0]['state'] == 'invalid', ins0)
        after = list_sms(db)
        check('đã từ chối: không trả dòng đó', 1 not in [r['input_data_id'] for r in after] and 2 in [r['input_data_id'] for r in after])
        st = db.rows("SELECT status, note FROM auto_campaign_input_data WHERE id = 1")[0]
        check('đã từ chối: data hoàn thành + ghi chú', st == {'status': 'hoàn thành', 'note': 'Bỏ qua vì người nhận đã từ chối nhận tin nhắn SMS'}, st)
        # Nhân viên khác cùng tổ chức, cùng SĐT: không bị chặn (phạm vi theo nhân viên).
        d = list_sms(db, account=110)
        check('nhân viên khác cùng SĐT vẫn gửi', [r['input_data_id'] for r in d] == [6] and LINK.search(d[0]['content']) is not None)
        # Chiến dịch hết data sau khi bỏ qua → hoàn thành.
        db.q("UPDATE auto_campaign_input_data SET status = 'hoàn thành' WHERE id = 2")
        db.q("INSERT INTO auto_zalo_message_opt_outs (channel, phone, staff_id, organization_id, confirmed_at) VALUES ('sms', '0912345670', 10, 1, now()) ON CONFLICT DO NOTHING")
        db.q("UPDATE auto_zalo_message_opt_outs SET confirmed_at = now() WHERE channel = 'sms' AND phone = '0912345670'")
        list_sms(db, campaigns=[1001])
        check('bỏ qua người cuối → chiến dịch hoàn thành', db.q("SELECT status FROM auto_campaigns WHERE id = 1001") == 'hoàn thành')
        check('chiến dịch còn data không đổi', db.q("SELECT status FROM auto_campaigns WHERE id = 1002") == 'chờ xử lý')

        # ── Zalo: từ chối SMS không chặn Zalo cùng SĐT; từ chối Zalo vẫn chặn Zalo ──
        z = db.rows("SELECT * FROM aka_agent_check_zalo_message_opt_out(1030, 103, 10, '0912345678', NULL)")
        check('từ chối SMS không chặn tin Zalo cùng SĐT', z == [{'is_opted_out': False, 'matched_by': None}], z)
        z = db.rows("SELECT * FROM aka_agent_check_zalo_message_opt_out(1030, 103, 10, '0988000001', NULL)")
        check('từ chối Zalo vẫn chặn Zalo theo SĐT', z == [{'is_opted_out': True, 'matched_by': 'phone'}], z)
        z = db.rows("SELECT * FROM aka_agent_prepare_zalo_message_opt_out(1030, 103, 10, '0912345678', 'g-2')")
        check('hàm Zalo cũ vẫn tạo link được', len(z) == 1 and z[0]['is_opted_out'] is False, z)
        err = db.error("INSERT INTO auto_zalo_message_opt_outs (phone, staff_id, organization_id) VALUES ('0911111111', 10, 1)")
        check('dòng Zalo thiếu mã Zalo bị CHECK chặn', 'auto_message_opt_outs_identity_check' in err, err[-200:])
        err = db.error("INSERT INTO auto_zalo_message_opt_outs (channel, staff_id, organization_id) VALUES ('email', 10, 1)")
        check('dòng email thiếu email bị CHECK chặn', 'auto_message_opt_outs_identity_check' in err, err[-200:])

        # ── RPC Desktop: email + Facebook ──
        r = db.rows("SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', '  An@Example.COM ')")
        r2 = db.rows("SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', 'an@example.com')")
        check('email: chuẩn hoá chữ thường, một link', r[0]['id'] == r2[0]['id'] and r[0]['is_opted_out'] is False, (r, r2))
        check('email lưu chữ thường', db.q(f"SELECT email FROM auto_zalo_message_opt_outs WHERE id = '{r[0]['id']}'") == 'an@example.com')
        check('email sai bị từ chối', 'message_opt_out_identity_invalid' in db.error(
            "SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', 'khong-phai-email')"))
        check('sai kênh với loại chiến dịch bị từ chối', 'message_opt_out_scope_not_found' in db.error(
            "SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'sms', '0912345678')"))
        check('check trước xác nhận = false', db.q("SELECT aka_agent_check_message_opt_out(1010, 101, 10, 'email', 'AN@example.com')") == 'f')
        db.q(f"UPDATE auto_zalo_message_opt_outs SET confirmed_at = now() WHERE id = '{r[0]['id']}'")
        check('check sau xác nhận = true', db.q("SELECT aka_agent_check_message_opt_out(1010, 101, 10, 'email', 'AN@example.com')") == 't')
        r3 = db.rows("SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', 'an@example.com')")
        check('prepare sau xác nhận trả is_opted_out', r3[0]['is_opted_out'] is True and r3[0]['id'] == r[0]['id'])
        fb = db.rows("SELECT * FROM aka_agent_prepare_message_opt_out(1020, 102, 10, 'facebook', 'uid:100012345678901')")
        check('Facebook UID tạo link', len(fb) == 1 and fb[0]['is_opted_out'] is False, fb)
        fb2 = db.rows("SELECT * FROM aka_agent_prepare_message_opt_out(1021, 102, 10, 'facebook', 'page:111:222')")
        check('Facebook inbox Page tạo link riêng', fb2[0]['id'] != fb[0]['id'])
        check('khoá Facebook sai bị từ chối', 'message_opt_out_identity_invalid' in db.error(
            "SELECT * FROM aka_agent_prepare_message_opt_out(1020, 102, 10, 'facebook', '100012345678901')"))
        db.q(f"UPDATE auto_zalo_message_opt_outs SET confirmed_at = now() WHERE id = '{fb[0]['id']}'")
        check('Facebook: check theo khoá', db.q("SELECT aka_agent_check_message_opt_out(1020, 102, 10, 'facebook', 'uid:100012345678901')") == 't'
              and db.q("SELECT aka_agent_check_message_opt_out(1021, 102, 10, 'facebook', 'page:111:222')") == 'f')
        check('phiên Desktop nhân viên khác bị từ chối', 'desktop_staff_scope_denied' in db.error(
            "SET test.staff = '11'; SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', 'b@x.com')"))
        check('phiên Desktop đúng nhân viên chạy được', db.q(
            "SET test.staff = '10'; SELECT count(*) FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', 'b@x.com')") == '1')
        db.q("UPDATE auto_system_settings SET value = '{\"sms\":true}' WHERE key = 'message_opt_out.channels'")
        check('kênh tắt: prepare báo tắt', 'message_opt_out_channel_disabled' in db.error(
            "SELECT * FROM aka_agent_prepare_message_opt_out(1010, 101, 10, 'email', 'c@x.com')"))
        check('kênh thiếu trong công tắc = tắt (false, không NULL)', db.q("SELECT private.aka_agent_message_opt_out_channel_enabled('email')") == 'f')
        check('kênh tắt: check = false (không chặn)', db.q("SELECT aka_agent_check_message_opt_out(1010, 101, 10, 'email', 'an@example.com')") == 'f')
        db.q("UPDATE auto_system_settings SET value = 'khong phai json' WHERE key = 'message_opt_out.channels'")
        check('công tắc hỏng = tắt', db.q("SELECT private.aka_agent_message_opt_out_channel_enabled('sms')") == 'f')

        # ── Câu tra theo kênh dùng index (không quét cả bảng) ──
        db.q("INSERT INTO auto_zalo_message_opt_outs (phone, zalo_global_id, staff_id, organization_id) "
             "SELECT '09' || lpad(g::text, 8, '0'), 'gz-' || g, 10 + (g % 50), 1 + (g % 7) FROM generate_series(1, 60000) g; ANALYZE auto_zalo_message_opt_outs;")
        explain = db.q("EXPLAIN SELECT 1 FROM public.auto_zalo_message_opt_outs o WHERE o.staff_id = 10 AND o.organization_id = 1 "
                       "AND o.channel = 'sms' AND o.phone = '0912345678' AND o.confirmed_at IS NOT NULL")
        check('tra SĐT kênh SMS dùng index một phần', 'auto_message_opt_outs_sms_phone_uidx' in explain, explain)

        # ── Danh sách khách từ chối ──
        lst = json.loads(db.q("SELECT aka_agent_list_message_opt_out_customers(10, 1, 'u', 'p', '', 1)"))
        chans = sorted({i['channel'] for i in lst['items']})
        check('danh sách có kênh', chans == ['email', 'facebook', 'sms', 'zalo'], chans)
        lst = json.loads(db.q("SELECT aka_agent_list_message_opt_out_customers(10, 1, 'u', 'p', 'uid:1000', 1)"))
        check('tìm theo khoá Facebook', lst['total'] == 1 and lst['items'][0]['facebookKey'] == 'uid:100012345678901', lst)

        # ── Quyền ──
        acl = {r['proname']: r['acl'] for r in db.rows(
            "SELECT p.proname, coalesce(p.proacl::text, '') acl FROM pg_proc p WHERE p.proname IN "
            "('aka_agent_prepare_message_opt_out','aka_agent_check_message_opt_out','aka_agent_inspect_message_opt_out','aka_agent_sms_opt_out_render')")}
        public_grant = re.compile(r'(^|[{,])=X')
        check('prepare: Desktop + service_role, không PUBLIC', 'aka_agent_desktop=X' in acl['aka_agent_prepare_message_opt_out']
              and 'service_role=X' in acl['aka_agent_prepare_message_opt_out']
              and not public_grant.search(acl['aka_agent_prepare_message_opt_out']), acl)
        check('hàm SMS nội bộ không PUBLIC', not public_grant.search(acl['aka_agent_sms_opt_out_render']), acl)
        check('inspect: chỉ service_role', 'aka_agent_desktop' not in acl['aka_agent_inspect_message_opt_out'] and 'service_role=X' in acl['aka_agent_inspect_message_opt_out'], acl)
        db.q("UPDATE auto_system_settings SET value = '{\"sms\":true}' WHERE key = 'message_opt_out.channels'")
        out = db.q("SET ROLE service_role; SELECT count(*) FROM aka_agent_list_sms_due_input_data(100, NULL, NULL, 100, 30); RESET ROLE;")
        check('service_role gọi được hàm danh sách SMS', out.strip().isdigit(), out)

        # ── Gỡ ──
        zalo_rows = db.q("SELECT count(*) FROM auto_zalo_message_opt_outs WHERE channel = 'zalo'")
        db.q(ROLLBACK.read_text())
        check('gỡ: ba hàm về đúng md5 production', fn_md5(db) == LIVE_MD5, fn_md5(db))
        check('gỡ: còn dòng Zalo, mất dòng kênh khác', db.q("SELECT count(*) FROM auto_zalo_message_opt_outs") == zalo_rows
              and db.q("SELECT count(*) FROM information_schema.columns WHERE table_name = 'auto_zalo_message_opt_outs' AND column_name IN ('channel', 'facebook_key')") == '0')
        check('gỡ: không còn OPT02 / công tắc / RPC mới',
              db.q("SELECT count(*) FROM auto_error WHERE public_code = 'OPT02'") == '0'
              and db.q("SELECT count(*) FROM auto_system_settings WHERE key = 'message_opt_out.channels'") == '0'
              and db.q("SELECT count(*) FROM pg_proc WHERE proname LIKE '%message_opt_out%' AND proname NOT LIKE '%zalo%' AND proname <> 'aka_agent_list_message_opt_out_customers'") == '0')
        db.q(MIGRATION.read_text())
        check('apply lại sau khi gỡ', db.q("SELECT count(*) FROM auto_error WHERE public_code = 'OPT02'") == '1')
    finally:
        db.close()
    print(f'\n{passed} PASS, {failed} FAIL')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
