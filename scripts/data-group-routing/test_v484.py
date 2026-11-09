#!/usr/bin/env python3
"""Kiểm thử V484 trên Postgres 17 + pg_cron cục bộ, chạy hàm live thật (không chạm production).

Dùng: python3 scripts/data-group-routing/test_v484.py   (PGBIN mặc định /usr/lib/postgresql/17/bin)

Phần chính là so sánh song song: cùng một chuỗi thao tác (nạp scan có dòng trùng, nạp lại, nạp SĐT, nhập file rồi nhập
lại bớt dòng, gắn chiến dịch mới, tắt rồi bật lại công tắc, chiến dịch đã xoá) chạy trên
  A = trước V484 (chỉ V483),  B = V484 chế độ 'sync',  C = V484 chế độ 'async' + chạy worker tới khi hết việc,
rồi so dữ liệu theo khoá tự nhiên: input chiến dịch (kể cả thứ tự trong từng chiến dịch), alias, nguồn gốc input,
thành viên + nguồn gốc thành viên, ghi chú/trạng thái chiến dịch, số đếm của lượt nạp.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fixture import Cluster, ROOT, PGBIN  # noqa: E402
import seed as S  # noqa: E402

V483 = ROOT / 'migrations' / 'migration_v483_data_group_ingest_budget_guard.sql'
V484_PARTS = sorted((ROOT / 'migrations').glob('migration_v484_data_group_async_routing_p*.sql'))
RB484_PARTS = sorted((ROOT / 'migrations').glob('rollback_v484_data_group_async_routing_p*.sql'))
assert len(V484_PARTS) == 3 and len(RB484_PARTS) == 2, 'run scripts/build-v484-sql.py first'

PASS = 0


def ok(cond: bool, msg: str, detail=None):
    global PASS
    if not cond:
        print(f'FAIL - {msg}', file=sys.stderr)
        if detail is not None:
            print(json.dumps(detail, ensure_ascii=False, default=str)[:4000], file=sys.stderr)
        raise SystemExit(1)
    PASS += 1
    print(f'ok {PASS} - {msg}')


def apply_v484(c: Cluster, parts=V484_PARTS):
    for part in parts:
        c.psql(part.read_text(encoding='utf-8'))


def rollback_v484(c: Cluster, stop_on_error=True) -> str:
    err_all = ''
    for part in RB484_PARTS:
        _, err = c.psql(part.read_text(encoding='utf-8'), stop_on_error=stop_on_error)
        err_all += err
        if 'ERROR' in err:
            break
    return err_all


def new_cluster(with_v484: bool) -> Cluster:
    c = Cluster()
    c.build_schema()
    c.psql(V483.read_text(encoding='utf-8'))
    if with_v484:
        apply_v484(c)
        c.q("UPDATE cron.job SET active = false WHERE jobname = 'aka-agent-data-group-route-worker'")
    c.q(S.BASE_SQL)
    return c


def set_mode(c: Cluster, mode: str, orgs='[701]', budget=4000):
    c.q("UPDATE public.auto_system_settings SET value = "
        f"'{{\"mode\":\"{mode}\",\"organizationIds\":{orgs},\"workerBudgetMs\":{budget}}}' "
        "WHERE key = 'data_groups.routing_mode'")


def drain(c: Cluster, budget=20000, max_runs=200) -> int:
    runs = 0
    while c.q("SELECT count(*) FROM private.auto_data_group_route_jobs WHERE status IN ('pending','running')") != '0':
        c.q("UPDATE private.auto_data_group_route_jobs SET next_attempt_at = NULL")
        c.json(f'SELECT private.aka_agent_run_data_group_route_worker({budget})')
        runs += 1
        if runs > max_runs:
            raise SystemExit('worker did not drain')
    return runs


# ---------------------------------------------------------------------------------------------------------------
# Kịch bản chung cho so sánh song song
# ---------------------------------------------------------------------------------------------------------------
def scenario(c: Cluster, after_step=lambda name: None) -> dict:
    results = {}
    # 30 chiến dịch "Đăng bài vào nhóm" (phần lớn tạm dừng) + 2 "Tham gia nhóm" + 1 khác kiểu (SĐT) trên nhóm FB.
    c.q(S.campaign_sql(1, 30, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                       statuses=['tạm dừng', 'tạm dừng', 'tạm dừng', 'đang chạy', 'chờ xử lý']))
    c.q(S.campaign_sql(31, 2, group=S.FB_GROUP, action='facebook_join_group', account=S.FB_ACCOUNT,
                       statuses=['đang chạy']))
    c.q(S.campaign_sql(33, 1, group=S.FB_GROUP, action='zalo_message_phone', account=S.ZALO_ACCOUNT,
                       statuses=['tạm dừng']))
    # Chiến dịch đã xoá nhưng nguồn vẫn bật: hàm đẩy phải kết thúc chiến dịch như cũ.
    c.q(S.campaign_sql(34, 1, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                       statuses=['tạm dừng']) + "UPDATE public.auto_campaigns SET is_delete = true WHERE id = 34;")
    # 4 chiến dịch nhắn SĐT trên nhóm SĐT.
    c.q(S.campaign_sql(41, 4, group=S.PHONE_GROUP, action='zalo_message_phone', account=S.ZALO_ACCOUNT,
                       statuses=['đang chạy', 'tạm dừng']))

    results['scan1'] = c.json(S.ingest_sql('scan-1', S.FB_GROUP, 'scan', S.fb_group_rows(1, 45, dup_every=15)))
    after_step('scan1')
    results['scan2'] = c.json(S.ingest_sql('scan-2', S.FB_GROUP, 'scan', S.fb_group_rows(30, 30)))
    after_step('scan2')
    results['phone1'] = c.json(S.ingest_sql('phone-1', S.PHONE_GROUP, 'manual', S.phone_rows(1, 25),
                                            account=None, data_type=S.TYPE_PHONE))
    after_step('phone1')
    results['upload1'] = c.json(S.ingest_sql('upload-1', S.FB_GROUP, 'upload', S.fb_group_rows(100, 20),
                                             dataset_name='File A'))
    after_step('upload1')
    results['upload2'] = c.json(S.ingest_sql('upload-2', S.FB_GROUP, 'upload', S.fb_group_rows(105, 10),
                                             dataset_name='File A'))
    after_step('upload2')
    # Gắn chiến dịch mới vào nhóm FB (không bundle): đẩy cả nhóm.
    c.q("SET session_replication_role = replica;"
        f"INSERT INTO public.auto_campaigns (id, staff_id, organization_id, name, action_id, account_id, status, is_delete,"
        f" schedule, data_target_source_mode) VALUES (50, {S.STAFF}, {S.ORG}, 'CD 50', 'facebook_group_post', {S.FB_ACCOUNT},"
        " 'tạm dừng', false, now(), 'direct');")
    results['bind50'] = c.json(f"SELECT public.aka_agent_bind_campaign_data_group_source({S.STAFF}, {S.ORG}, 'bind-50', 50,"
                               f" {S.FB_GROUP}, NULL)")
    after_step('bind50')
    # Tắt rồi bật lại công tắc của chiến dịch 4 (đang chạy).
    results['stop4'] = c.json("SET aka_agent.zalo_runtime_target = 'desktop'; "
                              f"SELECT public.aka_agent_stop_campaign_data_group_source({S.STAFF}, {S.ORG}, 4, 'stop-4', 'test')")
    c.q(S.ingest_sql('scan-3', S.FB_GROUP, 'scan', S.fb_group_rows(200, 5)))
    after_step('scan3')
    results['react4'] = c.json("SET aka_agent.zalo_runtime_target = 'desktop'; "
                               f"SELECT public.aka_agent_reactivate_campaign_data_group_source({S.STAFF}, {S.ORG}, 4, 'react-4', 'test')")
    after_step('react4')
    return results


def snapshot(c: Cluster) -> dict:
    return {
        'inputs': c.rows("""
            SELECT i.campaign_id, i.canonical_target_key, i.name, i.phone, i.uid, i.email, i.info1, i.status,
                   COALESCE(i.is_delete, false) AS is_delete, i.data_type_category_item_id,
                   row_number() OVER (PARTITION BY i.campaign_id ORDER BY i.id) AS send_order
            FROM public.auto_campaign_input_data i ORDER BY 1, 2"""),
        'aliases': c.rows("""SELECT campaign_id, alias_key, canonical_target_key, conflict_count
                             FROM public.auto_campaign_input_target_aliases ORDER BY 1, 2"""),
        'input_origins': c.rows("""
            SELECT i.campaign_id, i.canonical_target_key, o.origin_kind, s.campaign_id AS source_campaign,
                   ct.uid AS member_uid, b.request_id, o.group_revision
            FROM public.auto_campaign_input_origins o
            JOIN public.auto_campaign_input_data i ON i.id = o.input_data_id
            LEFT JOIN public.auto_campaign_data_group_sources s ON s.id = o.source_id
            LEFT JOIN public.auto_account_contact_group_members m ON m.id = o.membership_id
            LEFT JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
            LEFT JOIN public.auto_data_ingest_batches b ON b.id = o.batch_id
            ORDER BY 1, 2, 3, 4, 5, 6"""),
        'members': c.rows("""
            SELECT m.group_id, ct.uid, ct.phone, m.is_delete, m.change_revision
            FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
            ORDER BY 1, 2, 3"""),
        'member_origins': c.rows("""
            SELECT ct.uid, ct.phone, o.kind, d.name AS dataset, b.request_id, o.is_current, o.data_type_category_item_id
            FROM public.auto_account_contact_group_member_origins o
            JOIN public.auto_account_contact_group_members m ON m.id = o.membership_id
            JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
            LEFT JOIN public.auto_account_contacts_dataset d ON d.id = o.dataset_id
            LEFT JOIN public.auto_data_ingest_batches b ON b.id = o.batch_id
            ORDER BY 1, 2, 3, 4, 5"""),
        'campaigns': c.rows("SELECT id, status, note, is_delete, provisioning_state FROM public.auto_campaigns ORDER BY id"),
        'sources': c.rows("SELECT campaign_id, group_id, status, stop_reason, baseline_revision FROM public.auto_campaign_data_group_sources ORDER BY campaign_id"),
        'datasets': c.rows("SELECT name, contact_count, source FROM public.auto_account_contacts_dataset ORDER BY name"),
    }


TIME_KEYS = ('created_at', 'updated_at', 'started_at', 'stopped_at', 'last_ingest_at')


def norm(results: dict) -> dict:
    """Bỏ mốc thời gian (khác nhau giữa hai cluster) khỏi kết quả trả về."""
    return {k: ({kk: vv for kk, vv in v.items() if kk not in TIME_KEYS} if isinstance(v, dict) else v)
            for k, v in results.items()}


def main() -> None:
    t0 = time.time()
    # --------------------------------------------------------------- A: trước V484
    a = new_cluster(with_v484=False)
    try:
        res_a = scenario(a)
        snap_a = snapshot(a)
        batches_a = {r['request_id']: r['result'] for r in a.rows(
            "SELECT request_id, result FROM public.auto_data_ingest_batches WHERE operation = 'ingest'")}
    finally:
        a.close()
    ok(sum(1 for r in snap_a['inputs']) > 1000, 'kịch bản trước V484 tạo đủ input để so sánh',
       {'inputs': len(snap_a['inputs'])})
    ok(res_a['scan1']['already_member_count'] == 3 and res_a['scan1']['inserted_membership_count'] == 45,
       'trước V484: lượt scan có 3 dòng trùng')

    # --------------------------------------------------------------- B: V484 'sync' phải giống hệt A
    b = new_cluster(with_v484=True)
    try:
        ok(b.q("SELECT value FROM public.auto_system_settings WHERE key='data_groups.routing_mode'")
           == '{"mode":"sync","organizationIds":[],"workerBudgetMs":4000}', 'công tắc mặc định sync, không tổ chức nào')
        res_b = scenario(b)
        snap_b = snapshot(b)
        ok(b.q("SELECT count(*) FROM private.auto_data_group_route_jobs") == '0', 'chế độ sync không tạo việc nào')
    finally:
        b.close()
    ok(norm(res_b) == norm(res_a), 'sync: kết quả trả về của mọi lượt giống hệt trước V484', {'a': res_a, 'b': res_b})
    for key in snap_a:
        ok(snap_b[key] == snap_a[key], f'sync: bảng {key} giống hệt trước V484')

    # --------------------------------------------------------------- C: V484 'async' + worker
    c = new_cluster(with_v484=True)
    try:
        set_mode(c, 'async')
        queued = {}

        def after(name):
            queued[name] = c.rows("SELECT kind, status, source_id IS NOT NULL AS has_source,"
                                  " (SELECT count(*) FROM private.auto_data_group_route_job_members jm WHERE jm.job_id = j.id) AS members"
                                  " FROM private.auto_data_group_route_jobs j WHERE status IN ('pending','running') ORDER BY id")
            if name == 'scan1':
                ok(c.q("SELECT count(*) FROM public.auto_campaign_input_data") == '0',
                   'async: lượt nạp không đẩy gì vào chiến dịch trong giao dịch của người dùng')
                ok(len(queued[name]) == 1 and queued[name][0]['members'] == 45,
                   'async: một việc cho cả lượt nạp, 45 thành viên (dòng trùng gộp)', queued[name])
            drain(c)

        res_c = scenario(c, after_step=after)
        snap_c = snapshot(c)
        batches_c = {r['request_id']: r['result'] for r in c.rows(
            "SELECT request_id, result FROM public.auto_data_ingest_batches WHERE operation = 'ingest'")}
        jobs_c = c.rows("SELECT kind, status, inserted_count, existing_count, incompatible_count, conflict_count,"
                        " no_intake_count, skipped_source_count, error_count FROM private.auto_data_group_route_jobs ORDER BY id")
    finally:
        c.close()
    ok(res_c['scan1'].get('routing_status') == 'queued' and res_c['scan1']['inserted_input_count'] == 0,
       'async: lượt nạp trả routing_status queued, input = 0')
    ok(queued['bind50'] and queued['bind50'][-1]['kind'] == 'baseline', 'async: gắn chiến dịch tạo việc baseline')
    ok(queued['react4'] and queued['react4'][-1]['kind'] == 'baseline', 'async: bật lại công tắc tạo việc baseline')
    ok(all(j['status'] == 'done' and j['error_count'] == 0 for j in jobs_c), 'async: mọi việc xong, không lỗi', jobs_c)
    for key in snap_a:
        ok(snap_c[key] == snap_a[key], f'async + worker: bảng {key} giống hệt đồng bộ cũ',
           {'diff_a': [x for x in snap_a[key] if x not in snap_c[key]][:5],
            'diff_c': [x for x in snap_c[key] if x not in snap_a[key]][:5]})
    # Số đếm của lượt nạp sau khi worker cộng vào: giống đồng bộ. Riêng lượt có dòng trùng (scan-1), đồng bộ gọi đẩy
    # lại cho dòng trùng nên đếm thêm "đã thấy"/"không tương thích"; hàng đợi gộp dòng trùng nên chỉ đếm một lần.
    member_keys = ('inserted_membership_count', 'reactivated_membership_count', 'already_member_count',
                   'removed_membership_count', 'invalid_count', 'inserted_input_count', 'group_revision')
    for req, ra in batches_a.items():
        rc = batches_c[req]
        keys = member_keys if req == 'scan-1' else tuple(k for k in ra if k != 'batch_id')
        ok({k: rc[k] for k in keys} == {k: ra[k] for k in keys} and rc.get('routing_status') == 'done',
           f'async: số đếm lượt {req} khớp đồng bộ sau khi đẩy xong', {'sync': ra, 'async': rc})
    ok(batches_c['scan-1']['already_seen_input_count'] < batches_a['scan-1']['already_seen_input_count'],
       'async: dòng trùng trong một lượt chỉ đẩy một lần')

    print(f'# so sánh song song xong sau {time.time() - t0:.1f}s')
    async_specific()
    print(f'# {PASS} kiểm tra đạt, {time.time() - t0:.1f}s')


# ---------------------------------------------------------------------------------------------------------------
# Các ca riêng của hàng đợi
# ---------------------------------------------------------------------------------------------------------------
def async_specific() -> None:
    c = new_cluster(with_v484=True)
    try:
        # Mô phỏng nhóm 1770 lúc sự cố: 630 chiến dịch, 626 tạm dừng.
        c.q(S.campaign_sql(1, 630, group=S.FB_GROUP, action='facebook_group_post', account=S.FB_ACCOUNT,
                           statuses=['tạm dừng'] * 157 + ['đang chạy']))
        rows = S.fb_group_rows(1, 45)
        guard = lambda: c.psql(f"SELECT private.aka_agent_assert_data_group_ingest_budget({S.ORG}, {S.FB_GROUP}, 'scan', {S.sql_json(rows)})",
                               stop_on_error=False)[1]
        ok('PT413' in guard() or 'Không thể thêm 45 dòng' in guard(), 'guard V483 vẫn chặn 45 dòng x 630 chiến dịch ở chế độ sync')
        set_mode(c, 'async', orgs='null')
        ok(guard() == '', 'guard: tổ chức async không nhân số chiến dịch (45 dòng qua)')

        t = time.time()
        res = c.json(S.ingest_sql('big-1', S.FB_GROUP, 'scan', rows))
        ingest_ms = (time.time() - t) * 1000
        ok(res['routing_status'] == 'queued' and ingest_ms < 3000,
           f'async: 45 dòng vào nhóm 630 chiến dịch trả về sau {ingest_ms:.0f} ms', res)

        # Lượt worker đầu (ngân sách nhỏ): chiến dịch đang chạy có data trước.
        run = c.json('SELECT private.aka_agent_run_data_group_route_worker(1500)')
        ok(run['slices'] <= 32 and run['ms'] < 3500, 'worker tôn trọng ngân sách và trần 32 đoạn', run)
        first = c.rows("""SELECT c.status, count(i.id) AS n FROM public.auto_campaigns c
                          LEFT JOIN public.auto_campaign_input_data i ON i.campaign_id = c.id
                          GROUP BY c.status ORDER BY c.status""")
        running = next(x['n'] for x in first if x['status'] == 'đang chạy')
        paused = next(x['n'] for x in first if x['status'] == 'tạm dừng')
        ok(running == 3 * 45 and paused < 627 * 45, 'worker đẩy xong 3 chiến dịch đang chạy trước khi làm chiến dịch tạm dừng',
           first)

        # Tắt công tắc một chiến dịch tạm dừng trước khi tới lượt: chiến dịch đó không nhận.
        c.q("UPDATE public.auto_campaign_data_group_sources SET status = 'stopped' WHERE campaign_id = 600")
        t = time.time()
        runs = drain(c, budget=4000)
        ok(c.q("SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id = 600") == '0',
           'nguồn tắt trước khi tới lượt thì bỏ qua')
        total = int(c.q("SELECT count(*) FROM public.auto_campaign_input_data"))
        ok(total == 629 * 45, f'worker đẩy đủ 629 x 45 = {629 * 45} input sau {runs} lượt ({time.time() - t:.1f}s)')
        job = c.rows("SELECT * FROM private.auto_data_group_route_jobs ORDER BY id DESC LIMIT 1")[0]
        ok(job['skipped_source_count'] == 1 and job['inserted_count'] == 629 * 45, 'số đếm của việc đúng', job)
        batch = c.json("SELECT result FROM public.auto_data_ingest_batches WHERE request_id = 'big-1'")
        ok(batch['inserted_input_count'] == 629 * 45 and batch['routing_status'] == 'done',
           'kết quả lượt nạp được cộng số input thật', batch)
        replay = c.json(S.ingest_sql('big-1', S.FB_GROUP, 'scan', rows))
        ok(replay == batch, 'gửi lại cùng request_id trả kết quả đã cộng')
        ok(c.q("SELECT count(*) FROM private.auto_data_group_route_job_members") == '0', 'xong việc thì xoá danh sách thành viên')

        # Khoá chiến dịch đang bận: worker không treo, không tính lỗi, thử lại sau.
        c.q("UPDATE public.auto_campaign_data_group_sources SET status = 'stopped' WHERE campaign_id > 3")
        c.json(S.ingest_sql('lock-1', S.FB_GROUP, 'scan', S.fb_group_rows(500, 5)))
        holder = subprocess.Popen(
            ['runuser', '-u', 'postgres', '--', str(PGBIN / 'psql'), '-X', '-h', str(c.dir), '-p', str(c.port), '-U',
             'postgres', '-d', 'postgres', '-c',
             "BEGIN; SELECT 1 FROM public.auto_campaigns WHERE id IN (1,2,3) FOR UPDATE; SELECT pg_sleep(6); COMMIT;"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1)
        t = time.time()
        run = c.json('SELECT private.aka_agent_run_data_group_route_worker(4000)')
        ok(run['errors'] >= 1 and time.time() - t < 8, 'worker gặp khoá bận: dừng sau lock_timeout, không treo', run)
        job = c.rows("SELECT * FROM private.auto_data_group_route_jobs ORDER BY id DESC LIMIT 1")[0]
        ok(job['error_count'] == 0 and job['last_error'].startswith('55P03') and job['next_attempt_at'],
           'khoá bận không tính lỗi, hẹn thử lại', job)
        holder.wait()
        drain(c)
        ok(c.q("SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id IN (1,2,3) AND uid LIKE '%/9000005%'") == '15',
           'hết khoá thì worker đẩy xong')

        # Một thành viên lỗi lặp lại: chỉ bỏ đúng cặp đó.
        c.q("""CREATE FUNCTION public.v484_boom() RETURNS trigger LANGUAGE plpgsql AS $$
               BEGIN IF NEW.uid LIKE '%900000777' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
               CREATE TRIGGER v484_boom BEFORE INSERT ON public.auto_campaign_input_data FOR EACH ROW EXECUTE FUNCTION public.v484_boom();""")
        c.json(S.ingest_sql('boom-1', S.FB_GROUP, 'scan', S.fb_group_rows(770, 10)))
        drain(c, max_runs=100)
        job = c.rows("SELECT * FROM private.auto_data_group_route_jobs ORDER BY id DESC LIMIT 1")[0]
        ok(job['status'] == 'done' and job['error_count'] == 3 and job['inserted_count'] == 27,
           'thành viên lỗi lặp lại bị bỏ đúng cặp (3 chiến dịch), 27 cặp còn lại vào đủ', job)
        c.q("DROP TRIGGER v484_boom ON public.auto_campaign_input_data")

        # Công tắc: JSON hỏng = sync; organizationIds [] = không ai; null = mọi tổ chức.
        c.q("UPDATE public.auto_system_settings SET value = '{oops' WHERE key = 'data_groups.routing_mode'")
        ok(c.q(f"SELECT private.aka_agent_data_group_route_async({S.ORG})") == 'f', 'JSON hỏng thì coi như sync')
        set_mode(c, 'async', orgs='[]')
        ok(c.q(f"SELECT private.aka_agent_data_group_route_async({S.ORG})") == 'f', 'organizationIds [] thì không tổ chức nào')
        set_mode(c, 'async', orgs='[701, 9]')
        ok(c.q(f"SELECT private.aka_agent_data_group_route_async({S.ORG}), private.aka_agent_data_group_route_async(8)") == 't|f',
           'organizationIds chỉ bật đúng tổ chức trong danh sách')

        # Quyền: không role API nào đọc được bảng hàng đợi hay gọi worker.
        for role in ('anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'):
            out = c.q(f"SELECT has_function_privilege('{role}', 'private.aka_agent_run_data_group_route_worker(integer)', 'EXECUTE')"
                      f" OR has_table_privilege('{role}', 'private.auto_data_group_route_jobs', 'SELECT')")
            ok(out == 'f', f'{role} không gọi được worker/đọc hàng đợi')

        # pg_cron thật: bật job, chờ một lượt.
        set_mode(c, 'async', orgs='null')
        c.q("UPDATE public.auto_campaign_data_group_sources SET status = 'active' WHERE campaign_id BETWEEN 4 AND 10")
        c.json(S.ingest_sql('cron-1', S.FB_GROUP, 'scan', S.fb_group_rows(900, 3)))
        c.q("UPDATE cron.job SET active = true WHERE jobname = 'aka-agent-data-group-route-worker'")
        deadline = time.time() + 40
        while time.time() < deadline and c.q(
                "SELECT count(*) FROM private.auto_data_group_route_jobs WHERE status IN ('pending','running')") != '0':
            time.sleep(2)
        details = c.rows("SELECT status, return_message FROM cron.job_run_details ORDER BY runid DESC LIMIT 3")
        ok(c.q("SELECT count(*) FROM private.auto_data_group_route_jobs WHERE status IN ('pending','running')") == '0'
           and any(d['status'] == 'succeeded' for d in details), 'pg_cron chạy worker 10 giây/lần và xử lý hết việc', details)
        c.q("UPDATE cron.job SET active = false WHERE jobname = 'aka-agent-data-group-route-worker'")

        # Rollback: còn việc thì từ chối; hết việc thì trả nguyên văn hàm cũ.
        c.json(S.ingest_sql('rb-1', S.FB_GROUP, 'scan', S.fb_group_rows(950, 2)))
        ok('still pending' in rollback_v484(c, stop_on_error=False), 'rollback từ chối khi còn việc chưa đẩy')
        drain(c)
        rollback_v484(c)
        ok(c.q("SELECT to_regclass('private.auto_data_group_route_jobs') IS NULL AND NOT EXISTS (SELECT 1 FROM cron.job"
               " WHERE jobname = 'aka-agent-data-group-route-worker') AND NOT EXISTS (SELECT 1 FROM public.auto_system_settings"
               " WHERE key = 'data_groups.routing_mode')") == 't', 'rollback gỡ bảng, cron, dòng công tắc')
        res = c.json(S.ingest_sql('after-rb', S.FB_GROUP, 'scan', S.fb_group_rows(990, 2)))
        ok('routing_status' not in res and res['inserted_input_count'] > 0, 'sau rollback nạp đồng bộ như cũ')
        # Sai thứ tự / chạy lại phần đã xong đều bị chặn; rollback khi mới apply một phần vẫn sạch.
        _, err = c.psql(V484_PARTS[1].read_text(encoding='utf-8'), stop_on_error=False)
        ok('apply p1 first' in err, 'p2 không chạy khi chưa có p1')
        apply_v484(c, V484_PARTS[:1])
        _, err = c.psql(V484_PARTS[2].read_text(encoding='utf-8'), stop_on_error=False)
        ok('p2 not applied' in err, 'p3 không chạy khi chưa có p2')
        apply_v484(c, V484_PARTS[1:2])
        _, err = c.psql(V484_PARTS[1].read_text(encoding='utf-8'), stop_on_error=False)
        ok('already patched' in err, 'chạy lại p2 bị chặn')
        rollback_v484(c)
        ok(c.q("SELECT to_regclass('private.auto_data_group_route_jobs') IS NULL") == 't',
           'rollback được khi mới apply p1 + p2')
        apply_v484(c)
        ok(c.q("SELECT count(*) FROM cron.job WHERE jobname = 'aka-agent-data-group-route-worker'") == '1',
           'apply lại đủ 3 phần sau rollback được')
        _, err = c.psql(V484_PARTS[0].read_text(encoding='utf-8'), stop_on_error=False)
        ok('already applied' in err, 'chạy lại p1 bị chặn')
    finally:
        c.close()


if __name__ == '__main__':
    main()
