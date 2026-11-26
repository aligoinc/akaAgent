#!/usr/bin/env python3
"""Bộ thử ngẫu nhiên tầng DB cho đồng bộ Google Sheet (V662), chạy kịch bản do fuzz-loop.cjs sinh.

Chạy: python3 scripts/campaign-sheet-sync/fuzz_db.py <file kịch bản> [--seed N]

Mỗi kịch bản: một nhân viên, 1–3 chiến dịch (đủ trạng thái), data đã nhập từ cửa sổ Upload + data khách tự nhập (có dòng đã
xoá mềm, có cách viết khác), bật nguồn với mốc ban đầu, rồi nhiều lượt đồng bộ xen thao tác ngẫu nhiên (tắt / bật lại,
xoá chiến dịch, chiến dịch hoàn thành, khách thêm tay đúng số sắp có trong Sheet, Sửa cài đặt giữa lượt, lỗi tạm thời,
gọi lại finish). "Sự thật" tính độc lập theo khoá chuẩn hoá của app (không dùng hàm khoá của DB):
  D1 mỗi lượt chỉ thêm đúng các khoá mới (chưa có ở mọi chiến dịch từng thuộc nguồn, kể cả dòng đã xoá, trừ mốc ban đầu)
  D2 chia đều: mỗi khoá vào đúng một chiến dịch đang nhận, chênh lệch ≤ 1; "nhận đủ": mỗi chiến dịch nhận khoá nó chưa có
  D3 chiến dịch đã rời / đã xoá / nhân viên khác không nhận gì; data khác không bị sửa
  D4 added = số dòng thêm; gọi lại finish trả y kết quả cũ, không thêm; lượt bị Sửa giữa chừng không thêm
  D5 trường dòng thêm = dòng đầu tiên của khoá trong Sheet; chiến dịch hoàn thành có data mới thì về chờ xử lý
  D6 trạng thái nguồn hợp lệ sau mỗi bước; log có dòng lượt chạy
"""
import json
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
from pg import Cluster  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
MIGRATION = open(os.path.join(ROOT, 'migrations/migration_v662_campaign_sheet_sync.sql'), encoding='utf-8').read()
FIXTURE = open(os.path.join(os.path.dirname(__file__), 'fixture.sql'), encoding='utf-8').read()

failures = []
stats = {'scenarios': 0, 'runs': 0, 'added': 0, 'ops': {}}


def fail(kind, **detail):
    failures.append({'kind': kind, **detail})
    if len(failures) <= 20:
        short = {k: (v[:60] + f'…({len(v)})' if isinstance(v, str) and len(v) > 60 else v) for k, v in detail.items()}
        print('FAIL', kind, json.dumps(short, ensure_ascii=False, default=lambda o: str(o)[:60])[:700])


def q(value):
    return "'" + json.dumps(value, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def lit(value):
    return 'NULL' if value is None else "'" + str(value).replace("'", "''") + "'"


class Db:
    def __init__(self, pg):
        self.pg = pg

    def desk(self, staff, payload):
        out = self.pg.psql(f"BEGIN; SET LOCAL ROLE aka_agent_desktop; SET LOCAL test.staff = '{staff}';"
                           f" SELECT public.aka_agent_campaign_sheet_sync({q(payload)})::text; COMMIT;", check=False)
        if out.returncode != 0:
            return None, out.stderr.strip()
        return json.loads(out.stdout.strip().splitlines()[-1]), None

    def svc(self, sql):
        out = self.pg.psql(f"BEGIN; SET LOCAL ROLE service_role; SELECT ({sql})::text; COMMIT;", check=False)
        if out.returncode != 0:
            return None, out.stderr.strip()
        lines = out.stdout.strip().splitlines()
        return (json.loads(lines[-1]) if lines and lines[-1] else None), None

    def rows(self, sql):
        out = self.pg.psql(f"SELECT COALESCE(jsonb_agg(t), '[]')::text FROM ({sql}) t")
        return json.loads(out.stdout.strip().splitlines()[-1])


def norm_key(action, field, key):
    if key is None or key == '':
        return None
    # Giới hạn của đồng bộ (DB): người nhận dài quá thì không nhận, không cắt.
    if (field == 'uid' and len(key.strip()) > 2048) or (field == 'email' and len(key.strip()) > 254):
        return None
    if action == 'facebook_find_data_search':
        return ' '.join(key.split()).lower()
    if field == 'email':
        return key.lower()
    return key


def run_scenario(db, sc, rng, staff):
    action, field = sc['action'], sc['field']
    k = rng.randint(1, 3)
    cids = [staff * 10 + i for i in range(k)]
    statuses = ['chờ xử lý', 'đang chạy', 'hoàn thành', 'tạm dừng']
    status = {c: rng.choice(statuses) for c in cids}
    split = 'split' if k > 1 and rng.random() < 0.6 else 'all'
    vals = ', '.join(f"({c}, {staff}, 1, {lit(action)}, 'C{c}', {lit(status[c])})" for c in cids)
    # Chiến dịch của nhân viên khác cùng tổ chức có cùng khoá: không được ảnh hưởng.
    other = staff * 10 + 9
    db.pg.psql(f"INSERT INTO org_staff (id, organization_id) VALUES ({staff}, 1), ({staff + 500000}, 1);"
               f"INSERT INTO auto_campaigns (id, staff_id, organization_id, action_id, name, status) VALUES {vals},"
               f" ({other}, {staff + 500000}, 1, {lit(action)}, 'other', 'chờ xử lý');")
    truth = {c: set() for c in cids}  # khoá app của mọi dòng (kể cả đã xoá mềm) theo chiến dịch

    def insert(campaign, row, deleted=False):
        cols = ['campaign_id', 'is_delete'] + [c for c in ['name', 'phone', 'uid', 'email', 'info1', 'info2', 'info3', 'info4', 'info5'] if row.get(c) not in (None, '')]
        values = [str(campaign), 'true' if deleted else 'false'] + [lit(row[c]) for c in cols[2:]]
        db.pg.psql(f"INSERT INTO auto_campaign_input_data ({', '.join(cols)}) VALUES ({', '.join(values)})")

    # Data cửa sổ Upload đã chèn vào form (chia đều theo tài khoản hoặc mỗi chiến dịch đủ danh sách).
    for i, item in enumerate(sc['imported'][:3000]):
        targets = [cids[i % k]] if split == 'split' else cids
        for c in targets:
            insert(c, item['row'])
            truth[c].add(norm_key(action, field, item['key']))
    for m in sc['manual']:
        c = rng.choice(cids)
        insert(c, {field: m['raw']}, m['deleted'])
        if m['key']:
            truth[c].add(norm_key(action, field, m['key']))
        insert(other, {field: m['raw']})
    baseline = {norm_key(action, field, v) for v in sc['sheetValues']}
    # Khoá DB của data khách tự nhập phải bằng khoá app (cùng người nhận ⇔ cùng khoá).
    if sc['manual']:
        raws = [m['raw'] for m in sc['manual']]
        got_keys = db.rows(f"SELECT x.o, private.aka_agent_campaign_sheet_key({lit(field)}, {lit(action)}, x.v, x.v, x.v) AS k"
                           f" FROM jsonb_array_elements_text({q(raws)}) WITH ORDINALITY x(v, o)")
        for item, m in zip(sorted(got_keys, key=lambda r: r['o']), sc['manual']):
            want = norm_key(action, field, m['key'])
            if item['k'] != want:
                fail('key_mismatch', scenario=sc['id'], action=action, raw=m['raw'], app=want, db=item['k'])

    end = time.strftime('%Y-%m-%d', time.gmtime(time.time() + 20 * 86400))
    req = {'action': 'save', 'requestId': f'fz-{staff}', 'campaignIds': cids, 'config': sc['config'], 'everyHours': rng.choice([1, 3, 6, 12, 24]),
           'endDate': end, 'splitMode': split, 'sheetValues': sc['sheetValues']}
    saved, err = db.desk(staff, req)
    if err:
        fail('save_failed', scenario=sc['id'], action=action, err=err[:300])
        return
    sid = saved['sync']['id']
    replay, err = db.desk(staff, req)
    if err or not replay.get('replayed') or replay['sync']['id'] != sid:
        fail('save_replay', scenario=sc['id'], err=err)
    active = list(cids)
    left = set()
    ever = list(cids)

    def bump(name):
        stats['ops'][name] = stats['ops'].get(name, 0) + 1

    for run_index, run in enumerate(sc['runs']):
        # ------------------------------------------------------------- thao tác trước lượt
        op = rng.choice(['none', 'none', 'none', 'stop', 'resume', 'delete', 'complete', 'softdel', 'manual_dup', 'edit', 'stale', 'transient', 'staff_locked'])
        bump(op)
        if op == 'stop' and active:
            c = rng.choice(active)
            res, err = db.desk(staff, {'action': 'stop', 'syncId': sid, 'campaignId': c})
            if err:
                fail('stop_failed', scenario=sc['id'], err=err[:200])
            else:
                active.remove(c)
                left.add(c)
                if sorted(res['sync']['campaignIds']) != sorted(active):
                    fail('stop_ids', scenario=sc['id'], got=res['sync']['campaignIds'], want=active)
        elif op == 'resume' and left:
            c = rng.choice(sorted(left))
            res, err = db.desk(staff, {'action': 'resume', 'syncId': sid, 'campaignId': c})
            deleted = db.rows(f"SELECT is_delete FROM auto_campaigns WHERE id={c}")[0]['is_delete']
            if deleted:
                if not err:
                    fail('resume_deleted_campaign', scenario=sc['id'], campaign=c)
            elif err:
                if 'sheet_sync_requires_save' not in err:
                    fail('resume_failed', scenario=sc['id'], err=err[:200])
            else:
                left.discard(c)
                active.append(c)
        elif op == 'delete' and active:
            c = rng.choice(active)
            db.pg.psql(f"UPDATE auto_campaigns SET is_delete = true WHERE id = {c}")
            active.remove(c)
            left.add(c)
        elif op == 'complete' and active:
            c = rng.choice(active)
            db.pg.psql(f"UPDATE auto_campaigns SET status = 'hoàn thành', completed_at = now() WHERE id = {c}")
        elif op == 'softdel':
            db.pg.psql(f"UPDATE auto_campaign_input_data SET is_delete = true WHERE id IN (SELECT id FROM auto_campaign_input_data WHERE campaign_id = ANY(ARRAY{cids}::bigint[]) ORDER BY random() LIMIT 3)")
        elif op == 'manual_dup' and run.get('keys') and active:
            key = rng.choice(run['keys'])
            c = rng.choice(active)
            insert(c, {field: key})
            truth[c].add(norm_key(action, field, key))
        elif op == 'edit':
            st = db.rows(f"SELECT revision, every_hours, split_mode FROM auto_campaign_sheet_syncs WHERE id={sid}")[0]
            res, err = db.desk(staff, {'action': 'save', 'syncId': sid, 'expectedRevision': st['revision'], 'everyHours': rng.choice([1, 6, 24]),
                                       'endDate': end, 'splitMode': st['split_mode']})
            if err and 'sheet_sync_no_campaign' not in err:
                fail('edit_failed', scenario=sc['id'], err=err[:200])
        elif op == 'staff_locked':
            db.pg.psql(f"UPDATE org_staff SET is_active = false WHERE id = {staff}")

        # ------------------------------------------------------------- lượt đồng bộ
        db.pg.psql(f"UPDATE auto_campaign_sheet_syncs SET next_run_at = now() - interval '1 second' WHERE id = {sid}")
        before = db.rows(f"SELECT coalesce(max(id),0) AS m FROM auto_campaign_input_data")[0]['m']
        if rng.random() < 0.2 and op != 'staff_locked':
            # Hai Edge cùng nhận việc: không ai nhận trùng nguồn.
            with ThreadPoolExecutor(2) as pool:
                pair = list(pool.map(lambda _: db.svc('public.aka_agent_campaign_sheet_claim()'), range(2)))
            jobs = [r for r, e in pair if r]
            if any(e for _, e in pair) or len({j['syncId'] for j in jobs}) != len(jobs):
                fail('parallel_claim', scenario=sc['id'], pair=[(r, (e or '')[:120]) for r, e in pair])
            bump('parallel_claim')
            job, err = (jobs[0] if jobs else None), None
        else:
            job, err = db.svc('public.aka_agent_campaign_sheet_claim()')
        if err:
            fail('claim_error', scenario=sc['id'], err=err[:300])
            return
        if op == 'staff_locked':
            if job is not None:
                fail('claim_locked_staff', scenario=sc['id'])
            db.pg.psql(f"UPDATE org_staff SET is_active = true WHERE id = {staff}")
            db.pg.psql(f"UPDATE auto_campaign_sheet_syncs SET next_run_at = now() - interval '1 second' WHERE id = {sid}")
            job, err = db.svc('public.aka_agent_campaign_sheet_claim()')
        src = db.rows(f"SELECT status, is_enabled, campaign_ids, stopped_reason FROM auto_campaign_sheet_syncs WHERE id={sid}")[0]
        if not active:
            if job is not None:
                fail('claim_without_campaign', scenario=sc['id'])
            if src['is_enabled'] or src['status'] not in ('paused',):
                fail('state_no_campaign', scenario=sc['id'], src=src)
            return
        if job is None:
            if src['is_enabled']:
                fail('claim_none', scenario=sc['id'], src=src, active=active)
            return
        if sorted(src['campaign_ids']) != sorted(active):
            fail('claim_campaign_ids', scenario=sc['id'], got=src['campaign_ids'], want=active)
            active = list(src['campaign_ids'])
        token = job['token']

        if op == 'transient':
            res, err = db.svc(f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q({'error': {'code': 'sheet_read_failed', 'message': 'Mạng lỗi', 'permanent': False}})})")
            st = db.rows(f"SELECT status, is_enabled FROM auto_campaign_sheet_syncs WHERE id={sid}")[0]
            if err or st['status'] != 'retry' or not st['is_enabled']:
                fail('transient_state', scenario=sc['id'], st=st, err=err)
            db.pg.psql(f"UPDATE auto_campaign_sheet_syncs SET next_run_at = now() - interval '1 second' WHERE id = {sid}")
            job, err = db.svc('public.aka_agent_campaign_sheet_claim()')
            token = job['token']
        if op == 'stale':
            st = db.rows(f"SELECT revision, split_mode FROM auto_campaign_sheet_syncs WHERE id={sid}")[0]
            db.desk(staff, {'action': 'save', 'syncId': sid, 'expectedRevision': st['revision'], 'everyHours': 6, 'endDate': end, 'splitMode': st['split_mode'],
                            'config': sc['config']})
            res, err = db.svc(f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q(run.get('payload') or {'rows': [], 'rowCount': 0, 'invalid': 0})})")
            after = db.rows(f"SELECT count(*) AS n FROM auto_campaign_input_data WHERE id > {before}")[0]['n']
            if err or not res.get('stale') or after:
                fail('stale_run', scenario=sc['id'], res=res, err=err, added=after)
            db.pg.psql(f"UPDATE auto_campaign_sheet_syncs SET next_run_at = now() - interval '1 second' WHERE id = {sid}")
            job, err = db.svc('public.aka_agent_campaign_sheet_claim()')
            if not job:
                fail('claim_after_stale', scenario=sc['id'], err=err)
                return
            token = job['token']

        stats['runs'] += 1
        if 'error' in run:
            res, err = db.svc(f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q({'error': run['error']})})")
            st = db.rows(f"SELECT status, is_enabled, stopped_reason FROM auto_campaign_sheet_syncs WHERE id={sid}")[0]
            if run['error']['permanent'] and (st['status'] != 'error' or st['is_enabled'] or st['stopped_reason'] != run['error']['code']):
                fail('permanent_state', scenario=sc['id'], st=st)
            if db.rows(f"SELECT count(*) AS n FROM auto_campaign_input_data WHERE id > {before}")[0]['n']:
                fail('error_added', scenario=sc['id'])
            if run['error']['permanent']:
                res, err = db.desk(staff, {'action': 'resume', 'syncId': sid, 'campaignId': active[0]})
                if run['error']['code'] == 'sheet_columns_changed' and (not err or 'sheet_sync_requires_save' not in err):
                    fail('resume_after_columns', scenario=sc['id'], err=err)
                return
            continue

        payload = run['payload']
        if rng.random() < 0.25:
            # Hai lượt finish cùng token chạy song song (Edge gọi lại khi mất câu trả lời): chỉ một lượt ghi.
            sql = f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q(payload)})"
            with ThreadPoolExecutor(2) as pool:
                pair = list(pool.map(lambda _: db.svc(sql), range(2)))
            oks = [r for r, e in pair if r and not r.get('stale')]
            if any(e for _, e in pair) or len(oks) < 1:
                fail('parallel_finish', scenario=sc['id'], pair=[(r, (e or '')[:120]) for r, e in pair])
            res, err = (oks[0] if oks else None), None
            bump('parallel_finish')
        else:
            res, err = db.svc(f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q(payload)})")
        if err:
            fail('finish_error', scenario=sc['id'], action=action, err=err[:300], rows=len(payload['rows']))
            return
        if res.get('stale'):
            fail('finish_stale', scenario=sc['id'])
            return

        # ------------------------------------------------------------- sự thật
        keys_order, first = [], {}
        for key, row in zip(run['keys'], payload['rows']):
            nk = norm_key(action, field, key)
            if nk and nk not in first:
                first[nk] = row
                keys_order.append(nk)
        existing_all = set().union(*[truth[c] for c in ever])
        added_rows = db.rows(f"SELECT id, campaign_id, name, phone, uid, email, info1, info2, info3, info4, info5 FROM auto_campaign_input_data WHERE id > {before} ORDER BY id")
        got = {}
        for r in added_rows:
            value = r[field]
            nk = norm_key(action, field, value)
            got.setdefault(r['campaign_id'], []).append(nk)
            row = first.get(nk)
            if row is None:
                fail('added_unknown_key', scenario=sc['id'], action=action, value=value)
            else:
                for col in ['name', 'info1', 'info2', 'info3', 'info4', 'info5']:
                    want = (row.get(col) or None)
                    want = want[:4000] if want and col != 'name' else (want[:500].strip() or None if want else None)
                    if (r[col] or None) != want:
                        fail('row_field', scenario=sc['id'], col=col, got=r[col], want=want)
                        break
        for c in got:
            if c not in active:
                fail('added_to_inactive', scenario=sc['id'], campaign=c, active=active)
        if split == 'split':
            want = [x for x in keys_order if x not in baseline and x not in existing_all]
            have = [x for c in got for x in got[c]]
            if sorted(have) != sorted(want):
                fail('split_keys', scenario=sc['id'], action=action, missing=sorted(set(want) - set(have))[:5], extra=sorted(set(have) - set(want))[:5],
                     nwant=len(want), nhave=len(have))
            counts = [len(got.get(c, [])) for c in active]
            if counts and max(counts) - min(counts) > 1:
                fail('split_balance', scenario=sc['id'], counts=counts)
        else:
            for c in active:
                want = [x for x in keys_order if x not in baseline and x not in truth[c]]
                have = got.get(c, [])
                if sorted(have) != sorted(want):
                    fail('all_keys', scenario=sc['id'], action=action, campaign=c, missing=sorted(set(want) - set(have))[:5],
                         extra=sorted(set(have) - set(want))[:5])
        if res['added'] != len(added_rows):
            fail('added_count', scenario=sc['id'], res=res['added'], rows=len(added_rows))
        stats['added'] += len(added_rows)
        for c, keys in got.items():
            truth[c].update(keys)
            st = db.rows(f"SELECT status FROM auto_campaigns WHERE id={c}")[0]['status']
            if st == 'hoàn thành':
                fail('not_reopened', scenario=sc['id'], campaign=c)
            logs = db.rows(f"SELECT count(*) AS n FROM auto_campaign_logs WHERE campaign_id={c} AND log LIKE '%đã thêm {len(keys)} data mới'")[0]['n']
            if not logs:
                fail('log_missing', scenario=sc['id'], campaign=c)
        again, err = db.svc(f"public.aka_agent_campaign_sheet_finish('{token}'::uuid, {q({'rows': [{field: 'x'}], 'rowCount': 1, 'invalid': 0})})")
        if again != res:
            fail('finish_replay', scenario=sc['id'], first=res, again=again)
        st = db.rows(f"SELECT status, is_enabled, lease_token FROM auto_campaign_sheet_syncs WHERE id={sid}")[0]
        if st['status'] != 'success' or st['lease_token'] is not None:
            fail('state_after_success', scenario=sc['id'], st=st)
        other_rows = db.rows(f"SELECT count(*) AS n FROM auto_campaign_input_data WHERE campaign_id={other} AND id > {before}")[0]['n']
        if other_rows:
            fail('other_staff_touched', scenario=sc['id'])
        # Chiến dịch từng ở trong nguồn (kể cả đã rời) vẫn tính khoá đã có ở lượt sau.
        for c in left:
            if c not in ever:
                ever.append(c)


def main():
    path = sys.argv[1]
    seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 1
    data = json.load(open(path, encoding='utf-8'))
    rng = random.Random(seed * 7919 + data['seed'])
    pg = Cluster(port=55470 + seed % 20)
    try:
        pg.psql(FIXTURE)
        pg.psql(MIGRATION)
        pg.psql("UPDATE auto_system_settings SET value = '{\"audience\":\"all\",\"worker\":true,\"maxSourcesPerStaff\":20,\"minEveryHours\":1}' WHERE key='campaign.sheet_sync'")
        db = Db(pg)
        t0 = time.time()
        for i, sc in enumerate(data['scenarios']):
            stats['scenarios'] += 1
            try:
                run_scenario(db, sc, rng, 1000 + i)
            except Exception as error:  # noqa: BLE001
                fail('harness_exception', scenario=sc['id'], error=repr(error)[:400])
        print(f"{stats['scenarios']} kịch bản, {stats['runs']} lượt, thêm {stats['added']} dòng, thao tác {json.dumps(stats['ops'], ensure_ascii=False)}, {time.time() - t0:.0f} giây")
    finally:
        pg.stop()
    kinds = {}
    for f in failures:
        kinds[f['kind']] = kinds.get(f['kind'], 0) + 1
    print(f'LỖI {len(failures)}: {json.dumps(kinds, ensure_ascii=False)}' if failures else 'SẠCH')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
