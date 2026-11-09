#!/usr/bin/env python3
"""Kiểm thử V485 (nhập file vào nhóm data theo nhiều phần) trên Postgres 17 + pg_cron cục bộ, chạy hàm live thật.

Dùng: python3 scripts/data-group-routing/test_v485.py

So sánh song song cùng một chuỗi thao tác (quét, nhập 'File A' một lần, rồi nhập lại 'File A' có dòng trùng, dòng hỏng,
dòng trùng với data quét; nhóm SĐT không gắn tài khoản có dòng trùng nằm ở hai phần khác nhau):
  A0 = V484 (chưa V485), nhập một lần;  A = V485, nhập một lần (đường cũ phải giống hệt A0);
  B  = V485 sync, nhập lại theo nhiều phần;  C = V485 async + worker, nhập lại theo nhiều phần.
Rồi các ca riêng: > 10.000 dòng, gửi lại phần, phần chồng nhau, thiếu phần, phiên bị thay/hết hạn, bỏ dở,
lối vào Desktop (xác thực + chặn sớm PT413), quyền, async: lượt tổng cộng lại khi worker đẩy xong, rollback.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed as S  # noqa: E402
import test_v484 as T  # noqa: E402
from fixture import ROOT  # noqa: E402

V485_PARTS = sorted((ROOT / 'migrations').glob('migration_v485_data_group_upload_sessions_p*.sql'))
RB485 = ROOT / 'migrations' / 'rollback_v485_data_group_upload_sessions.sql'
assert len(V485_PARTS) == 2 and RB485.exists(), 'run scripts/build-v485-sql.py first'
ok = T.ok
INGEST_SIG = ('public.aka_agent_ingest_data_group_v186_internal(bigint,bigint,text,bigint,text,jsonb,bigint,text,text,'
              'bigint,text,text)')
WORKER_SIG = 'private.aka_agent_run_data_group_route_worker(integer)'


def apply_v485(c):
    for part in V485_PARTS:
        c.psql(part.read_text(encoding='utf-8'))


def new_cluster(v485: bool = True):
    c = T.new_cluster(with_v484=True)
    if v485:
        apply_v485(c)
    return c


def sval(v) -> str:
    if v is None:
        return 'NULL'
    if isinstance(v, int):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def type_rows(rows: list[dict]) -> list[dict]:
    seen, out = set(), []
    for r in rows:
        key = (r.get('contact_type'), r.get('flatform_type'))
        if key not in seen:
            seen.add(key)
            out.append({'contact_type': key[0], 'flatform_type': key[1]})
    return out


def begin_sql(request, group, rows, *, account=S.FB_ACCOUNT, data_type=S.TYPE_FB_GROUP, dataset_name=None,
              total=None, source_name='Thử') -> str:
    return (f"SELECT public.aka_agent_begin_data_group_upload({S.STAFF}, {S.ORG}, {sval(request)}, {group}, "
            f"{sval(dataset_name)}, NULL, {sval(account)}, {sval(source_name)}, {sval(data_type)}, "
            f"{S.sql_json(type_rows(rows))}, {total if total is not None else len(rows)})")


def append_sql(session, offset, rows, payload_hash=None) -> str:
    return (f"SELECT public.aka_agent_append_data_group_upload({S.STAFF}, {S.ORG}, '{session}'::uuid, {offset}, "
            f"{S.sql_json(rows)}, {sval(payload_hash)})")


def finish_sql(session) -> str:
    return f"SELECT public.aka_agent_finish_data_group_upload({S.STAFF}, {S.ORG}, '{session}'::uuid)"


def upload_multi(c, request, group, rows, sizes, *, after_part=None, **kw) -> dict:
    session = c.json(begin_sql(request, group, rows, **kw))['session_id']
    offset, i = 0, 0
    while offset < len(rows):
        size = sizes[i % len(sizes)]
        c.json(append_sql(session, offset, rows[offset:offset + size]))
        if after_part:
            after_part(i)
        offset += size
        i += 1
    return c.json(finish_sql(session))


def upload_single(c, request, group, rows, *, account=S.FB_ACCOUNT, data_type=S.TYPE_FB_GROUP, dataset_name=None):
    return c.json(S.ingest_sql(request, group, 'upload', rows, account=account, data_type=data_type,
                               dataset_name=dataset_name))


def err_of(c, sql) -> str:
    _, err = c.psql(sql, stop_on_error=False)
    return err


def snapshot(c) -> dict:
    base = "split_part(b.request_id, ':part:', 1)"
    snap = T.snapshot(c)
    snap.pop('members')
    snap.pop('member_origins')
    # Dòng trùng ở hai phần khác nhau được đẩy lại với batch của phần sau (như nạp chia lô kiểu quét): thêm một dòng
    # nguồn gốc input trỏ tới lượt nạp khác, cùng input/nguồn/thành viên. So theo tập; số dòng thừa kiểm riêng.
    snap['input_origins'] = c.rows(f"""
        SELECT DISTINCT i.campaign_id, i.canonical_target_key, o.origin_kind, s.campaign_id AS source_campaign,
               ct.uid AS member_uid, ct.phone AS member_phone, {base} AS request_id
        FROM public.auto_campaign_input_origins o
        JOIN public.auto_campaign_input_data i ON i.id = o.input_data_id
        LEFT JOIN public.auto_campaign_data_group_sources s ON s.id = o.source_id
        LEFT JOIN public.auto_account_contact_group_members m ON m.id = o.membership_id
        LEFT JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
        LEFT JOIN public.auto_data_ingest_batches b ON b.id = o.batch_id
        ORDER BY 1, 2, 3, 4, 5, 6, 7""")
    snap['members'] = c.rows("""
        SELECT m.group_id, ct.uid, ct.phone, m.is_delete
        FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
        ORDER BY 1, 2, 3""")
    snap['member_origins'] = c.rows(f"""
        SELECT ct.uid, ct.phone, o.kind, d.name AS dataset, {base} AS request_id, o.is_current,
               o.data_type_category_item_id, o.relationship_kind, o.source_name_snapshot, o.source_account_id
        FROM public.auto_account_contact_group_member_origins o
        JOIN public.auto_account_contact_group_members m ON m.id = o.membership_id
        JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
        LEFT JOIN public.auto_account_contacts_dataset d ON d.id = o.dataset_id
        LEFT JOIN public.auto_data_ingest_batches b ON b.id = o.batch_id
        ORDER BY 1, 2, 3, 4, 5, 6""")
    snap['dataset_members'] = c.rows("""
        SELECT d.name, ct.uid, ct.phone, dm.is_current, dm.sort_order
        FROM public.auto_account_contacts_dataset_members dm
        JOIN public.auto_account_contacts_dataset d ON d.id = dm.dataset_id
        JOIN public.auto_account_contacts ct ON ct.id = dm.contact_id
        ORDER BY 1, 2, 3""")
    snap['contacts'] = c.rows("""
        SELECT account_id, flatform_type, contact_type, uid, name, url, phone, email, extra_data, is_delete
        FROM public.auto_account_contacts ORDER BY 1, 3, 4, 7""")
    snap['datasets'] = c.rows("""
        SELECT name, contact_count, source, flatform_type, contact_type, data_type_category_item_id, account_id, is_delete
        FROM public.auto_account_contacts_dataset ORDER BY 1""")
    return snap


# Dữ liệu kịch bản
def file_a1() -> list[dict]:
    return S.fb_group_rows(100, 20)


def file_a2() -> list[dict]:
    rows = S.fb_group_rows(108, 22)                       # 108..129: giữ 108..119, bỏ 100..107, thêm 120..129
    rows.insert(12, dict(rows[2]))                       # dòng trùng (giống hệt) nằm ở phần khác dòng gốc
    rows.insert(5, {'contact_type': 'group', 'flatform_type': 'facebook', 'name': 'Không có uid'})  # dòng hỏng
    rows.append(dict(S.fb_group_rows(3, 1)[0]))          # trùng một nhóm đã có từ lượt quét
    rows.append(dict(rows[0]))                           # trùng dòng đầu, ở phần cuối
    return rows


def phones_1() -> list[dict]:
    return S.phone_rows(1, 20)


def phones_2() -> list[dict]:
    rows = S.phone_rows(10, 26)                          # 10..35
    rows.insert(15, dict(rows[1]))                       # SĐT không gắn tài khoản trùng ở phần khác
    return rows


SIZES = [7, 6, 9]


def setup(c):
    c.q(S.campaign_sql(1, 12, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                       statuses=['tạm dừng', 'đang chạy', 'chờ xử lý']))
    c.q(S.campaign_sql(13, 1, group=S.FB_GROUP, action='zalo_message_phone', account=S.ZALO_ACCOUNT,
                       statuses=['tạm dừng']))
    c.q(S.campaign_sql(41, 3, group=S.PHONE_GROUP, action='zalo_message_phone', account=S.ZALO_ACCOUNT,
                       statuses=['đang chạy', 'tạm dừng']))
    res = {'scan': c.json(S.ingest_sql('scan-1', S.FB_GROUP, 'scan', S.fb_group_rows(1, 10)))}
    res['a1'] = upload_single(c, 'upload-a1', S.FB_GROUP, file_a1(), dataset_name='File A')
    res['p1'] = upload_single(c, 'upload-p1', S.PHONE_GROUP, phones_1(), account=None, data_type=S.TYPE_PHONE,
                              dataset_name='Danh bạ')
    return res


def run_single(c) -> dict:
    res = setup(c)
    res['a2'] = upload_single(c, 'upload-a2', S.FB_GROUP, file_a2(), dataset_name='File A')
    res['p2'] = upload_single(c, 'upload-p2', S.PHONE_GROUP, phones_2(), account=None, data_type=S.TYPE_PHONE,
                              dataset_name='Danh bạ')
    return res


def run_multi(c, drain=False) -> dict:
    res = setup(c)
    if drain:
        T.drain(c)
    res['a2'] = upload_multi(c, 'upload-a2', S.FB_GROUP, file_a2(), SIZES, dataset_name='File A')
    res['p2'] = upload_multi(c, 'upload-p2', S.PHONE_GROUP, phones_2(), SIZES, account=None, data_type=S.TYPE_PHONE,
                             dataset_name='Danh bạ')
    if drain:
        T.drain(c)
        c.json(f'SELECT {WORKER_SIG.split("(")[0]}(20000)')
    return res


MEMBER_KEYS = ('inserted_membership_count', 'reactivated_membership_count', 'already_member_count',
               'removed_membership_count', 'invalid_count')
INPUT_KEYS = ('inserted_input_count', 'already_seen_input_count', 'incompatible_count', 'conflict_count')


def latest_stats(c, group) -> dict:
    return c.rows(f"SELECT * FROM public.aka_agent_get_data_group_latest_ingest_stats({S.STAFF}, {S.ORG}, {group})")[0]


def differential() -> None:
    a0 = new_cluster(v485=False)
    try:
        res_a0 = run_single(a0)
        snap_a0 = snapshot(a0)
    finally:
        a0.close()
    a = new_cluster()
    try:
        res_a = run_single(a)
        snap_a = snapshot(a)
        ok(a.q('SELECT count(*) FROM private.auto_data_group_upload_sessions') == '0', 'nhập một lần không tạo phiên')
    finally:
        a.close()
    ok(T.norm(res_a) == T.norm(res_a0), 'V485, nhập một lần: kết quả trả về giống hệt V484', {'a0': res_a0, 'a': res_a})
    for key in snap_a0:
        ok(snap_a[key] == snap_a0[key], f'V485, nhập một lần: bảng {key} giống hệt V484')
    ok(res_a['a2']['removed_membership_count'] == 8 and res_a['a2']['invalid_count'] == 1
       and res_a['a2']['already_member_count'] >= 3, 'kịch bản: lần nhập lại gỡ 8 thành viên, 1 dòng hỏng, có dòng trùng',
       res_a['a2'])

    b = new_cluster()
    try:
        res_b = run_multi(b)
        snap_b = snapshot(b)
        stats_b = latest_stats(b, S.FB_GROUP)
        sessions_b = b.rows('SELECT status, received_rows, total_rows, routing_pending FROM private.auto_data_group_upload_sessions ORDER BY created_at')
        origins_per_member = b.q("""
            SELECT max(n) FROM (SELECT o.membership_id, o.dataset_id, count(*) AS n
              FROM public.auto_account_contact_group_member_origins o WHERE o.is_current GROUP BY 1, 2) x""")
    finally:
        b.close()
    ok(all(s['status'] == 'finished' and s['received_rows'] == s['total_rows'] and not s['routing_pending']
           for s in sessions_b) and len(sessions_b) == 2, 'nhiều phần (sync): 2 phiên đã chốt, nhận đủ dòng', sessions_b)
    for key in snap_a:
        ok(snap_b[key] == snap_a[key], f'nhiều phần (sync): bảng {key} giống hệt nhập một lần',
           {'only_single': [x for x in snap_a[key] if x not in snap_b[key]][:6],
            'only_multi': [x for x in snap_b[key] if x not in snap_a[key]][:6]})
    ok(origins_per_member == '1', 'dòng trùng nằm ở phần khác không tạo origin hiện tại thứ hai')
    for req in ('a2', 'p2'):
        ok({k: res_b[req][k] for k in MEMBER_KEYS + INPUT_KEYS} == {k: res_a[req][k] for k in MEMBER_KEYS + INPUT_KEYS},
           f'nhiều phần (sync): số đếm lượt {req} khớp nhập một lần', {'single': res_a[req], 'multi': res_b[req]})
    ok(stats_b['latest_request_id'] == 'upload-a2:finish' and stats_b['removed_membership_count'] == 8
       and stats_b['inserted_input_count'] == res_a['a2']['inserted_input_count'],
       '"lần nạp gần nhất" của nhóm là lượt tổng của cả file', stats_b)

    c = new_cluster()
    try:
        T.set_mode(c, 'async')
        res_c = run_multi(c, drain=True)
        snap_c = snapshot(c)
        summary = c.rows("SELECT request_id, result FROM public.auto_data_ingest_batches WHERE request_id LIKE '%:finish' ORDER BY id")
        pending = c.q('SELECT count(*) FROM private.auto_data_group_upload_sessions WHERE routing_pending')
        jobs = c.rows("SELECT status, error_count FROM private.auto_data_group_route_jobs ORDER BY id")
    finally:
        c.close()
    ok(res_c['a2'].get('routing_status') in ('queued', 'done'), 'async: lượt tổng báo đang đẩy nền', res_c['a2'])
    ok(all(j['status'] == 'done' and j['error_count'] == 0 for j in jobs) and len(jobs) >= 6,
       'async: mỗi phần một việc, mọi việc xong không lỗi', jobs)
    for key in snap_a:
        ok(snap_c[key] == snap_a[key], f'nhiều phần (async + worker): bảng {key} giống hệt nhập một lần',
           {'only_single': [x for x in snap_a[key] if x not in snap_c[key]][:6],
            'only_multi': [x for x in snap_c[key] if x not in snap_a[key]][:6]})
    final = {r['request_id']: r['result'] for r in summary}
    ok(pending == '0' and final['upload-a2:finish'].get('routing_status') == 'done'
       and final['upload-a2:finish']['inserted_input_count'] == res_a['a2']['inserted_input_count'],
       'async: worker cộng lại lượt tổng khi các phần đẩy xong (routing_status done, số input như sync)', final)


def edge_cases() -> None:
    c = new_cluster()
    try:
        c.q(S.campaign_sql(1, 3, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                           statuses=['đang chạy']))
        old = S.fb_group_rows(1, 30)
        upload_single(c, 'old-file', S.FB_GROUP, old, dataset_name='File B')
        rows = S.fb_group_rows(20, 25)  # 20..44: bỏ 1..19
        s = c.json(begin_sql('file-b', S.FB_GROUP, rows, dataset_name='File B'))
        sid = s['session_id']
        ok(s['status'] == 'open' and s['parts'] == [] and s['total_rows'] == 25, 'begin trả phiên mới', s)
        s2 = c.json(begin_sql('file-b', S.FB_GROUP, rows, dataset_name='File B'))
        ok(s2['session_id'] == sid, 'begin gửi lại cùng mã trả đúng phiên cũ')
        ok('data_group_request_id_conflict' in err_of(c, begin_sql('file-b', S.FB_GROUP, rows, dataset_name='File B',
                                                                   total=26)),
           'begin cùng mã khác số dòng bị từ chối')
        r1 = c.json(append_sql(sid, 0, rows[0:10]))
        r1b = c.json(append_sql(sid, 0, rows[0:10]))
        ok(r1b['batch_id'] == r1['batch_id'] and r1b['received_rows'] == 10, 'gửi lại đúng phần: trả kết quả cũ, không nạp trùng')
        ok('data_group_upload_part_conflict' in err_of(c, append_sql(sid, 5, rows[5:15])), 'phần chồng phần đã nhận bị từ chối')
        ok('data_group_upload_part_conflict' in err_of(c, append_sql(sid, 0, rows[0:8])), 'cùng vị trí khác độ dài bị từ chối')
        ok('invalid_data_group_ingest_payload' in err_of(c, append_sql(sid, 20, rows[0:10])), 'phần vượt quá tổng số dòng bị từ chối')
        c.json(append_sql(sid, 20, rows[20:25]))
        active_mid = c.q(f"SELECT count(*) FROM public.auto_account_contact_group_members WHERE group_id = {S.FB_GROUP} AND NOT is_delete")
        ok(active_mid == '35', 'đang gửi các phần: thành viên của lần nhập trước chưa bị gỡ (30 cũ + 5 mới)', active_mid)
        ok('data_group_upload_incomplete' in err_of(c, finish_sql(sid)), 'thiếu phần giữa thì không chốt')
        c.json(append_sql(sid, 10, rows[10:20]))
        s3 = c.json(begin_sql('file-b', S.FB_GROUP, rows, dataset_name='File B'))
        ok([p['offset'] for p in s3['parts']] == [0, 10, 20] and s3['received_rows'] == 25,
           'begin gửi lại liệt kê các phần đã nhận', s3)
        fin = c.json(finish_sql(sid))
        ok(fin['removed_membership_count'] == 19 and c.q(
            f"SELECT count(*) FROM public.auto_account_contact_group_members WHERE group_id = {S.FB_GROUP} AND NOT is_delete") == '25',
           'chốt: gỡ 19 thành viên không còn trong file, còn đúng 25', fin)
        ok(c.json(finish_sql(sid)) == fin, 'chốt lại trả đúng kết quả cũ')
        ok(c.q("SELECT contact_count FROM public.auto_account_contacts_dataset WHERE name = 'File B'") == '25',
           'dataset đếm lại 25 dòng')
        ok('data_group_upload_session_closed' in err_of(c, append_sql(sid, 0, rows[0:10])), 'phiên đã chốt không nhận thêm phần')

        # Bị thay: phiên mới cùng dataset, và lượt nhập một lần cùng dataset.
        s_old = c.json(begin_sql('file-b-2', S.FB_GROUP, rows, dataset_name='File B'))['session_id']
        c.json(append_sql(s_old, 0, rows[0:5]))
        s_new = c.json(begin_sql('file-b-3', S.FB_GROUP, rows, dataset_name='File B'))['session_id']
        ok('data_group_upload_session_closed' in err_of(c, append_sql(s_old, 5, rows[5:10])),
           'phiên mới cùng dataset thay phiên đang mở')
        upload_single(c, 'one-shot-b', S.FB_GROUP, rows, dataset_name='File B')
        ok('data_group_upload_session_closed' in err_of(c, append_sql(s_new, 0, rows[0:5])),
           'lượt nhập một lần cùng dataset thay phiên đang mở')
        ok(c.q(f"SELECT string_agg(status, ',' ORDER BY created_at) FROM private.auto_data_group_upload_sessions") ==
           'finished,superseded,superseded', 'trạng thái phiên: finished, superseded, superseded')

        # Hết hạn / bỏ dở: dòng đã nhận vẫn còn, không gỡ gì.
        s_exp = c.json(begin_sql('file-c', S.FB_GROUP, S.fb_group_rows(300, 10), dataset_name='File C'))['session_id']
        c.json(append_sql(s_exp, 0, S.fb_group_rows(300, 4)))
        c.q(f"UPDATE private.auto_data_group_upload_sessions SET expires_at = now() - interval '1 second' WHERE id = '{s_exp}'")
        ok('data_group_upload_session_closed' in err_of(c, append_sql(s_exp, 4, S.fb_group_rows(304, 6))), 'phiên hết hạn không nhận phần')
        ok('data_group_upload_session_closed' in err_of(c, finish_sql(s_exp)), 'phiên hết hạn không chốt được')
        c.json(begin_sql('file-d', S.FB_GROUP, S.fb_group_rows(400, 3), dataset_name='File D'))
        ok(c.q(f"SELECT status FROM private.auto_data_group_upload_sessions WHERE id = '{s_exp}'") == 'expired',
           'begin đánh dấu phiên quá hạn là expired')
        ok(c.q(f"SELECT count(*) FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts ct ON ct.id = m.contact_id"
               f" WHERE m.group_id = {S.FB_GROUP} AND NOT m.is_delete AND ct.uid IN ('900000300','900000301','900000302','900000303')") == '4',
           'phiên bỏ dở: 4 dòng đã nhận vẫn trong nhóm')

        # Người khác / tổ chức khác không thấy phiên.
        ok('data_group_upload_session_not_found' in err_of(
            c, f"SELECT public.aka_agent_append_data_group_upload(725, {S.ORG}, '{sid}'::uuid, 0, '[{{}}]'::jsonb, NULL)"),
           'nhân viên khác không gửi được vào phiên')
        ok('invalid_data_group_ingest_payload' in err_of(c, begin_sql('big', S.FB_GROUP, rows, total=100001)),
           'quá 100.000 dòng bị từ chối')
    finally:
        c.close()


def large_and_desktop() -> None:
    c = new_cluster()
    try:
        c.q(S.campaign_sql(1, 2, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                           statuses=['đang chạy']))
        rows = S.fb_group_rows(10_000, 12_000)
        ok('invalid_data_group_ingest_payload' in err_of(c, S.ingest_sql('too-big', S.FB_GROUP, 'upload', rows,
                                                                         dataset_name='Lớn')),
           'nhập một lần quá 10.000 dòng vẫn bị từ chối như cũ')
        t = time.time()
        sid = c.json(begin_sql('big-1', S.FB_GROUP, rows, dataset_name='Lớn'))['session_id']
        part_ms = []
        for off in range(0, len(rows), 2000):
            t1 = time.time()
            c.json(append_sql(sid, off, rows[off:off + 2000]))
            part_ms.append(round((time.time() - t1) * 1000))
        fin = c.json(finish_sql(sid))
        ok(fin['inserted_membership_count'] == 12_000 and fin['inserted_input_count'] == 24_000
           and c.q("SELECT contact_count FROM public.auto_account_contacts_dataset WHERE name = 'Lớn'") == '12000',
           f'12.000 dòng qua 6 phần ({max(part_ms)} ms/phần lớn nhất, tổng {time.time() - t:.1f}s): đủ thành viên + input', fin)
        # Thay toàn bộ bằng 12.000 dòng khác: chốt phải gỡ 12.000 trong một giao dịch ngắn.
        rows2 = S.fb_group_rows(50_000, 12_000)
        sid2 = c.json(begin_sql('big-2', S.FB_GROUP, rows2, dataset_name='Lớn'))['session_id']
        for off in range(0, len(rows2), 2000):
            c.json(append_sql(sid2, off, rows2[off:off + 2000]))
        t1 = time.time()
        fin2 = c.json(finish_sql(sid2))
        finish_ms = round((time.time() - t1) * 1000)
        ok(fin2['removed_membership_count'] == 12_000, f'chốt gỡ 12.000 thành viên cũ trong {finish_ms} ms', fin2)
        ok(finish_ms < 20_000, f'chốt dưới 20 giây ({finish_ms} ms)')

        # Lối vào Desktop: xác thực tài khoản, guard V483 cho từng phần.
        c.q(f"UPDATE public.org_staff SET password = 'pw' WHERE id = {S.STAFF}")
        auth = "'staff724', 'pw'"
        d_rows = S.fb_group_rows(70_000, 30)
        pre = "SET request.jwt.claims = '{\"role\":\"aka_agent_desktop\"}'; SET ROLE aka_agent_desktop; "
        d_begin = (f"SELECT public.aka_agent_begin_data_group_upload({S.STAFF}, {S.ORG}, 'desk-1', {S.FB_GROUP}, 'Desk', NULL,"
                   f" {S.FB_ACCOUNT}, 'Thử', {S.TYPE_FB_GROUP}, {S.sql_json(type_rows(d_rows))}, 30, {auth})")
        ok('automation_auth_invalid' in err_of(c, pre + d_begin.replace("'pw'", "'sai'")), 'Desktop: sai mật khẩu bị từ chối')
        d_sid = c.json(pre + d_begin)['session_id']
        c.json(pre + f"SELECT public.aka_agent_append_data_group_upload({S.STAFF}, {S.ORG}, '{d_sid}'::uuid, 0,"
                     f" {S.sql_json(d_rows)}, NULL, {auth})")
        d_fin = c.json(pre + f"SELECT public.aka_agent_finish_data_group_upload({S.STAFF}, {S.ORG}, '{d_sid}'::uuid, {auth})")
        ok(d_fin['inserted_membership_count'] == 30, 'Desktop: begin/append/finish qua lối vào có xác thực', d_fin)
        ok('permission denied' in err_of(c, pre + finish_sql(d_sid)), 'Desktop không gọi thẳng được RPC lõi')
        # 9.000 dòng x (8 + 2 chiến dịch x 5) ms > 75 s: chặn sớm bằng PT413 trước khi nạp.
        big = S.fb_group_rows(80_000, 9000)
        g_sid = c.json(pre + (f"SELECT public.aka_agent_begin_data_group_upload({S.STAFF}, {S.ORG}, 'desk-2', {S.FB_GROUP}, 'Desk 2',"
                              f" NULL, {S.FB_ACCOUNT}, 'Thử', {S.TYPE_FB_GROUP}, {S.sql_json(type_rows(big))}, 9000, {auth})"))['session_id']
        e = err_of(c, pre + f"SELECT public.aka_agent_append_data_group_upload({S.STAFF}, {S.ORG}, '{g_sid}'::uuid, 0,"
                            f" {S.sql_json(big)}, NULL, {auth})")
        ok('PT413' in e or 'mỗi lần khoảng' in e, 'Desktop: phần quá trần bị chặn sớm (PT413) để app thu nhỏ', e[-400:])
        ok(c.q(f"SELECT received_rows FROM private.auto_data_group_upload_sessions WHERE id = '{g_sid}'") == '0',
           'phần bị chặn sớm không ghi gì')
        for role in ('anon', 'authenticated', 'aka_agent_chat_api'):
            for fn in ('aka_agent_begin_data_group_upload', 'aka_agent_append_data_group_upload',
                       'aka_agent_finish_data_group_upload'):
                ok(c.q(f"SELECT bool_or(has_function_privilege('{role}', p.oid, 'EXECUTE')) FROM pg_proc p"
                       f" WHERE p.proname = '{fn}'") == 'f', f'quyền: {role} không gọi được {fn}')
        ok(c.q("SELECT has_table_privilege('service_role', 'private.auto_data_group_upload_sessions', 'SELECT')") == 'f',
           'quyền: bảng phiên không mở cho role API')
    finally:
        c.close()


def async_pending_and_rollback() -> None:
    c = new_cluster()
    try:
        c.q(S.campaign_sql(1, 4, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                           statuses=['đang chạy', 'tạm dừng']))
        T.set_mode(c, 'async')
        rows = S.fb_group_rows(1, 300)
        fin = upload_multi(c, 'async-1', S.FB_GROUP, rows, [100])
        ok(fin.get('routing_status') == 'queued' and fin['inserted_input_count'] == 0
           and c.q('SELECT count(*) FROM private.auto_data_group_upload_sessions WHERE routing_pending') == '1',
           'async: chốt trước khi worker đẩy -> lượt tổng queued, phiên chờ cộng lại', fin)
        order = c.rows("SELECT id, status FROM private.auto_data_group_route_jobs ORDER BY id")
        w = c.json('SELECT private.aka_agent_run_data_group_route_worker(20000)')
        T.drain(c)
        c.json('SELECT private.aka_agent_run_data_group_route_worker(20000)')
        summary = c.json("SELECT result FROM public.auto_data_ingest_batches WHERE request_id = 'async-1:finish'")
        ok(summary['routing_status'] == 'done' and summary['inserted_input_count'] == 1200
           and c.q('SELECT count(*) FROM private.auto_data_group_upload_sessions WHERE routing_pending') == '0'
           and c.json("SELECT result FROM private.auto_data_group_upload_sessions WHERE request_id = 'async-1'") == summary,
           'async: worker cộng lại lượt tổng (1.200 input), phiên hết chờ', {'summary': summary, 'worker': w, 'jobs': order})
        sent = c.rows("""SELECT i.campaign_id, i.uid FROM public.auto_campaign_input_data i ORDER BY i.campaign_id, i.id""")
        by_campaign = {}
        for r in sent:
            by_campaign.setdefault(r['campaign_id'], []).append(r['uid'])
        expected = [f'https://www.facebook.com/groups/{900000000 + i}' for i in range(1, 301)]
        ok(all(v == expected or [x.split('/')[-1] for x in v] == [e.split('/')[-1] for e in expected]
               for v in by_campaign.values()) and len(by_campaign) == 4,
           'async: các phần vào mỗi chiến dịch đúng thứ tự trong file (worker làm việc của một nhóm theo thứ tự)',
           {k: v[:3] + v[-3:] for k, v in by_campaign.items()})

        # Rollback: còn phiên mở thì từ chối; hết phiên mở thì trả hàm về V484 và gỡ sạch; apply lại được.
        open_sid = c.json(begin_sql('rb-open', S.FB_GROUP, S.fb_group_rows(900, 3), dataset_name='RB'))['session_id']
        ok('still open' in err_of(c, RB485.read_text(encoding='utf-8')), 'rollback từ chối khi còn phiên đang mở')
        c.q(f"UPDATE private.auto_data_group_upload_sessions SET status = 'expired' WHERE id = '{open_sid}'")
        T.drain(c)
        c.psql(RB485.read_text(encoding='utf-8'))
        ok(c.q(f"SELECT md5(pg_get_functiondef('{INGEST_SIG}'::regprocedure))") == '0a0c9d1f870df7eac69ceaa20f6fb10a'
           and c.q("SELECT to_regclass('private.auto_data_group_upload_sessions') IS NULL") == 't'
           and c.q("SELECT count(*) FROM pg_proc WHERE proname LIKE 'aka_agent_%_data_group_upload%'") == '0',
           'rollback: hàm nạp về đúng bản V484, gỡ hết bảng/hàm V485')
        apply_v485(c)
        ok(c.q("SELECT to_regclass('private.auto_data_group_upload_session_parts') IS NOT NULL") == 't',
           'apply lại V485 sau rollback được')
        ok('already applied' in err_of(c, V485_PARTS[0].read_text(encoding='utf-8')), 'chạy lại p1 bị chặn')
        ok('already patched' in err_of(c, V485_PARTS[1].read_text(encoding='utf-8')), 'chạy lại p2 bị chặn')
    finally:
        c.close()
    # Thứ tự apply.
    c = T.new_cluster(with_v484=True)
    try:
        ok('apply p1 first' in err_of(c, V485_PARTS[1].read_text(encoding='utf-8')), 'p2 trước p1 bị chặn')
        c.psql(V485_PARTS[0].read_text(encoding='utf-8'))
        ok(c.q(f"SELECT md5(pg_get_functiondef('{INGEST_SIG}'::regprocedure))") == '0a0c9d1f870df7eac69ceaa20f6fb10a',
           'sau p1 hàm nạp chưa đổi')
        _, err = c.psql(RB485.read_text(encoding='utf-8'), stop_on_error=False)
        ok('ERROR' not in err, 'rollback chạy được khi mới apply p1', err[-300:])
    finally:
        c.close()
    c = T.new_cluster(with_v484=False)
    try:
        ok('apply V484' in err_of(c, V485_PARTS[0].read_text(encoding='utf-8')), 'p1 khi chưa có V484 bị chặn')
    finally:
        c.close()


def main() -> None:
    t0 = time.time()
    differential()
    print(f'# so sánh song song xong sau {time.time() - t0:.1f}s')
    edge_cases()
    large_and_desktop()
    async_pending_and_rollback()
    print(f'# {T.PASS} kiểm tra đạt, {time.time() - t0:.1f}s')


if __name__ == '__main__':
    main()
