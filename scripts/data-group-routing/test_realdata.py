#!/usr/bin/env python3
"""Kiểm thử V484-V486 bằng dữ liệu thật đã chép CHỈ ĐỌC từ production (không ghi gì vào production).

Ba cụm Postgres cục bộ nạp cùng dữ liệu thật (10 nhóm data, 910 chiến dịch, 79.599 input), định nghĩa hàm production
(nạp đè 81 hàm lệch bản chụp 27/10):
  old   = trước V484 (V483)          sync  = sau V486, công tắc sync       async = sau V486, async cho tổ chức 701
Kịch bản trên nhóm 1770 (tổ chức 701 / staff 724, nhóm từng timeout): nạp lại thành viên hiện có, nạp data thật mới
từ nhóm anh em, bật lại một nguồn đã tắt, nhập file (upload) một tập con. Sau mỗi bước async chạy worker tới hết hàng
đợi; trạng thái chuẩn hoá của ba cụm phải giống hệt (riêng kết quả lượt nạp async có thêm routing_status).
Dữ liệu ở REALDATA_DIR (scratchpad, không commit).
"""
from __future__ import annotations

import json
import sys
import time

import mcpfile
import realload
import realstack

STAFF, ORG, GROUP, DT = 724, 701, 1770, 39
PASS = 0
FAIL = []


def ok(cond, msg, detail=None):
    global PASS
    if cond:
        PASS += 1
        print(f'ok   {msg}')
    else:
        FAIL.append(msg)
        print(f'FAIL {msg}' + (f'\n     {str(detail)[:1500]}' if detail is not None else ''))


def sql_json(v) -> str:
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def build(kind: str, mode: str | None):
    drift = json.loads((mcpfile.REALDATA_DIR / 'drift.json').read_text())
    c = realstack.build('new' if kind != 'old' else 'old')
    realload.add_missing_columns(c)
    errs = realload.overlay_drifted_functions(c, drift['diff_md5'])
    assert not errs, errs
    # Hàm chỉ có trên production (không thuộc V484-V486): tạo hết, hàm nào lỗi tạo thì bỏ qua (không nằm trên đường nạp).
    realload.overlay_drifted_functions(c, drift['only_prod'])
    realload.load_tables(c)
    if mode:
        orgs = '[701]' if mode == 'async' else '[]'
        c.q("UPDATE public.auto_system_settings SET value = "
            f"'{{\"mode\":\"{mode}\",\"organizationIds\":{orgs},\"workerBudgetMs\":4000}}' WHERE key = 'data_groups.routing_mode'")
    return c


def drain(c, budget=20000, max_runs=500) -> int:
    runs = 0
    while c.q("SELECT count(*) FROM private.auto_data_group_route_jobs WHERE status IN ('pending','running')") != '0':
        c.q('UPDATE private.auto_data_group_route_jobs SET next_attempt_at = NULL')
        c.json(f'SELECT private.aka_agent_run_data_group_route_worker({budget})')
        runs += 1
        if runs > max_runs:
            raise SystemExit('worker did not drain')
    return runs


def contact_rows(c, where: str, limit: int = 1000) -> list[dict]:
    return c.rows(f"""
        SELECT ct.contact_type, ct.flatform_type, ct.uid, ct.url, ct.name, ct.phone, ct.email
        FROM public.auto_account_contacts ct WHERE {where} ORDER BY ct.id LIMIT {limit}""")


def snapshot(c, GROUP=GROUP) -> dict:
    camp = f"SELECT campaign_id FROM public.auto_campaign_data_group_sources WHERE group_id = {GROUP}"
    return {
        'inputs': c.rows(f"""
            SELECT i.campaign_id, i.canonical_target_key, i.name, i.phone, i.uid, i.email, i.info1, i.status, i.note,
                   COALESCE(i.is_delete, false) AS is_delete, i.data_type_category_item_id,
                   row_number() OVER (PARTITION BY i.campaign_id ORDER BY i.id) AS send_order
            FROM public.auto_campaign_input_data i WHERE i.campaign_id IN ({camp}) ORDER BY 1, 2, send_order"""),
        'aliases': c.rows(f"""SELECT campaign_id, alias_key, canonical_target_key, conflict_count
                             FROM public.auto_campaign_input_target_aliases WHERE campaign_id IN ({camp}) ORDER BY 1, 2"""),
        'input_origins': c.rows(f"""
            SELECT i.campaign_id, i.canonical_target_key, o.origin_kind, s.campaign_id AS source_campaign, ct.uid AS member_uid,
                   b.request_id, o.group_revision, o.payload_snapshot
            FROM public.auto_campaign_input_origins o
            JOIN public.auto_campaign_input_data i ON i.id = o.input_data_id
            LEFT JOIN public.auto_campaign_data_group_sources s ON s.id = o.source_id
            LEFT JOIN public.auto_account_contact_group_members m ON m.id = o.membership_id
            LEFT JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
            LEFT JOIN public.auto_data_ingest_batches b ON b.id = o.batch_id
            WHERE i.campaign_id IN ({camp}) ORDER BY 1, 2, 3, 4, 5, 6, 7"""),
        'members': c.rows(f"""
            SELECT ct.contact_type, ct.uid, ct.url, ct.phone, m.is_delete, m.change_revision
            FROM public.auto_account_contact_group_members m JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
            WHERE m.group_id = {GROUP} ORDER BY 2, 3, 4, 5"""),
        'member_origins': c.rows(f"""
            SELECT ct.uid, ct.url, o.kind, d.name AS dataset, b.request_id, o.is_current, o.data_type_category_item_id,
                   o.source_name_snapshot, o.relationship_kind
            FROM public.auto_account_contact_group_member_origins o
            JOIN public.auto_account_contact_group_members m ON m.id = o.membership_id
            JOIN public.auto_account_contacts ct ON ct.id = m.contact_id
            LEFT JOIN public.auto_account_contacts_dataset d ON d.id = o.dataset_id
            LEFT JOIN public.auto_data_ingest_batches b ON b.id = o.batch_id
            WHERE m.group_id = {GROUP} ORDER BY 1, 2, 3, 4, 5, 6"""),
        'contacts': c.rows("""SELECT staff_id, contact_type, flatform_type, uid, url, name, phone, email, is_delete
                              FROM public.auto_account_contacts ORDER BY 1, 2, 3, 4, 5"""),
        'campaigns': c.rows(f"""SELECT id, status, note, is_delete, provisioning_state, data_target_source_mode
                               FROM public.auto_campaigns WHERE id IN ({camp}) ORDER BY id"""),
        'sources': c.rows(f"""SELECT campaign_id, status, stop_reason, baseline_revision
                             FROM public.auto_campaign_data_group_sources WHERE group_id = {GROUP} ORDER BY campaign_id"""),
        'group': c.rows(f"SELECT revision, is_delete FROM public.auto_account_contact_groups WHERE id = {GROUP}"),
        'datasets': c.rows(f"""SELECT name, contact_count, source, contact_type, flatform_type FROM public.auto_account_contacts_dataset
                              WHERE group_id = {GROUP} ORDER BY name"""),
        'dataset_members': c.rows(f"""SELECT d.name, ct.uid, ct.url, dm.is_current FROM public.auto_account_contacts_dataset_members dm
                                     JOIN public.auto_account_contacts_dataset d ON d.id = dm.dataset_id
                                     JOIN public.auto_account_contacts ct ON ct.id = dm.contact_id
                                     WHERE d.group_id = {GROUP} ORDER BY 1, 2, 3"""),
    }


DROP_KEYS = ('created_at', 'updated_at', 'started_at', 'stopped_at', 'last_ingest_at', 'batch_id', 'group_revision',
             'routing_status', 'routing_job_id', 'routing_error_count', 'dataset_id', 'request_id_used')


def norm_result(r):
    if isinstance(r, dict):
        return {k: norm_result(v) for k, v in r.items() if k not in DROP_KEYS}
    if isinstance(r, list):
        return [norm_result(x) for x in r]
    return r


def diff(a, b, limit=3):
    out = {}
    for k in a:
        if a[k] != b.get(k):
            la, lb = a[k], b.get(k) or []
            sa = {json.dumps(x, sort_keys=True, ensure_ascii=False) for x in la}
            sb = {json.dumps(x, sort_keys=True, ensure_ascii=False) for x in lb}
            out[k] = {'only_left': sorted(sa - sb)[:limit], 'only_right': sorted(sb - sa)[:limit],
                      'n': (len(la), len(lb))}
    return out


def main() -> None:
    t0 = time.time()
    clusters = {}
    try:
        for name, kind, mode in (('old', 'old', None), ('sync', 'new', 'sync'), ('async', 'new', 'async')):
            clusters[name] = build(kind, mode)
        print(f'# 3 cụm đã nạp dữ liệu thật ({time.time() - t0:.0f}s)')
        base = clusters['old']
        members = contact_rows(base, f"""ct.id IN (SELECT contact_id FROM public.auto_account_contact_group_members
                                          WHERE group_id = {GROUP} AND is_delete = false)""")
        siblings = contact_rows(base, f"""ct.organization_id = {ORG} AND ct.contact_type = 'group' AND ct.id NOT IN (
                                          SELECT contact_id FROM public.auto_account_contact_group_members WHERE group_id = {GROUP})""", 300)
        stopped_row = base.rows("""SELECT s.campaign_id, s.group_id, c.staff_id, c.organization_id,
                                    (SELECT count(*) FROM public.auto_account_contact_group_members m
                                     WHERE m.group_id = s.group_id AND m.is_delete = false) AS members
                            FROM public.auto_campaign_data_group_sources s
                            JOIN public.auto_campaigns c ON c.id = s.campaign_id
                            JOIN public.auto_accounts a ON a.id = c.account_id
                            WHERE s.status = 'stopped' AND COALESCE(c.is_delete, false) = false
                              AND c.data_group_id = s.group_id AND c.data_target_source_mode = 'data_group'
                              AND (c.schedule_end_date IS NULL OR c.schedule_end_date > now())
                              AND a.staff_id = c.staff_id AND COALESCE(a.is_delete, false) = false
                              AND (COALESCE(a.flatform_type, '') <> 'zalo' OR COALESCE(a.is_zalo_server, false) = false)
                            ORDER BY members DESC, s.campaign_id LIMIT 1""")
        stopped_row = stopped_row[0] if stopped_row else None
        stopped = stopped_row['campaign_id'] if stopped_row else None
        print(f'# dữ liệu kịch bản: {len(members)} thành viên hiện có, {len(siblings)} data mới từ nhóm anh em, '
              f'nguồn bật lại: chiến dịch {stopped}')
        upload = siblings[:40] + members[:10]
        steps = [
            ('s1 nạp lại thành viên hiện có', f"SELECT public.aka_agent_ingest_data_group({STAFF}, {ORG}, 'rt-s1', {GROUP}, 'manual', "
             f"{sql_json(members)}, NULL, NULL, NULL, NULL, 'Kiểm thử', NULL, {DT})"),
            ('s2 nạp data mới từ nhóm anh em', f"SELECT public.aka_agent_ingest_data_group({STAFF}, {ORG}, 'rt-s2', {GROUP}, 'manual', "
             f"{sql_json(siblings)}, NULL, NULL, NULL, NULL, 'Kiểm thử', NULL, {DT})"),
        ] + ([] if not stopped_row else [
            ('s3 bật lại nguồn đã tắt (nhóm ' + str(stopped_row['group_id']) + ', ' + str(stopped_row['members']) + ' thành viên)',
             "SET aka_agent.zalo_runtime_target = 'desktop'; "
             f"SELECT public.aka_agent_reactivate_campaign_data_group_source({stopped_row['staff_id']}, {stopped_row['organization_id']}, "
             f"{stopped}, 'rt-s3', 'kiểm thử')"),
        ]) + [
            ('s4 nhập file (upload) tập con', f"SELECT public.aka_agent_ingest_data_group({STAFF}, {ORG}, 'rt-s4', {GROUP}, 'upload', "
             f"{sql_json(upload)}, NULL, 'Tệp kiểm thử', 'excel', NULL, 'Kiểm thử', NULL, {DT})"),
            ('s5 nạp lại đúng mã s2 (idempotent)', f"SELECT public.aka_agent_ingest_data_group({STAFF}, {ORG}, 'rt-s2', {GROUP}, 'manual', "
             f"{sql_json(siblings)}, NULL, NULL, NULL, NULL, 'Kiểm thử', NULL, {DT})"),
        ]
        for label, sql in steps:
            results, timing, runs = {}, {}, 0
            for name, c in clusters.items():
                t1 = time.time()
                out, err = c.psql(sql, stop_on_error=False)
                timing[name] = time.time() - t1
                if 'ERROR' in err:
                    results[name] = {'error': err.strip()[-400:]}
                    continue
                results[name] = json.loads(out.strip().splitlines()[-1])
                if name == 'async':
                    runs = drain(c)
            ok(all('error' not in r for r in results.values()), f'{label}: không lỗi ở cả 3 cụm',
               {k: v.get('error') for k, v in results.items() if 'error' in v})
            if any('error' in r for r in results.values()):
                continue
            ok(norm_result(results['old']) == norm_result(results['sync']), f'{label}: kết quả trả về sync = cũ',
               (norm_result(results['old']), norm_result(results['sync'])))
            ra = results['async']
            if ra.get('routing_status') == 'queued':
                ok(all(ra.get(k) == results['old'].get(k) for k in ('inserted_membership_count', 'already_member_count',
                       'reactivated_membership_count', 'removed_membership_count', 'conflict_count')),
                   f'{label}: async trả ngay (queued), số thành viên = cũ', (results['old'], ra))
                req = ra.get('request_id')
                final = clusters['async'].json(f"SELECT result FROM public.auto_data_ingest_batches WHERE request_id = '{req}'"
                                               " ORDER BY id DESC LIMIT 1")
                ok(final.get('routing_status') == 'done' and norm_result(final) == norm_result(results['old']),
                   f'{label}: kết quả lượt nạp async sau worker (done) = cũ', (norm_result(results['old']), final))
            else:
                ok(norm_result(results['old']) == norm_result(ra), f'{label}: kết quả trả về async = cũ',
                   (norm_result(results['old']), norm_result(ra)))
            grp = stopped_row['group_id'] if label.startswith('s3') and stopped_row else GROUP
            snaps = {n: snapshot(c, grp) for n, c in clusters.items()}
            for sn in snaps.values():
                for k in sn:
                    sn[k] = sorted(sn[k], key=lambda x: json.dumps(x, sort_keys=True, ensure_ascii=False))
            d1, d2 = diff(snaps['old'], snaps['sync']), diff(snaps['old'], snaps['async'])
            ok(not d1, f'{label}: trạng thái sync = cũ (11 bảng)', d1)
            ok(not d2, f'{label}: trạng thái async (sau worker, {runs} lượt) = cũ', d2)
            print(f'     thời gian lời gọi: ' + ', '.join(f'{k} {v * 1000:.0f} ms' for k, v in timing.items())
                  + f"; async trạng thái: {results['async'].get('routing_status')}")
            r = results['old']
            print('     số liệu (cách cũ): ' + ', '.join(f'{k}={r[k]}' for k in (
                'inserted_membership_count', 'already_member_count', 'reactivated_membership_count', 'removed_membership_count',
                'inserted_input_count', 'already_seen_input_count', 'incompatible_count', 'conflict_count') if k in r)
                  + ''.join(f', {k}={json.dumps(r[k], ensure_ascii=False)[:120]}' for k in r if k not in (
                'inserted_membership_count', 'already_member_count', 'reactivated_membership_count', 'removed_membership_count',
                'inserted_input_count', 'already_seen_input_count', 'incompatible_count', 'conflict_count', 'conflicts',
                'batch_id', 'request_id', 'group_id', 'group_revision', 'invalid_count')))
        n_inputs = clusters['async'].q(f"""SELECT count(*) FROM public.auto_campaign_input_data WHERE campaign_id IN (
            SELECT campaign_id FROM public.auto_campaign_data_group_sources WHERE group_id = {GROUP})""")
        print(f'# input của các chiến dịch nhóm {GROUP} sau kịch bản: {n_inputs}')
    finally:
        for c in clusters.values():
            c.close()
    print(f'# {PASS} đạt, {len(FAIL)} lỗi, {time.time() - t0:.0f}s')
    sys.exit(1 if FAIL else 0)


if __name__ == '__main__':
    main()
