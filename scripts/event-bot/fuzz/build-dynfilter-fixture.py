#!/usr/bin/env python3
"""Dựng scripts/event-bot/db/dynfilter-prod-20261127.sql: chuỗi Bộ lọc động (Nhóm data) của production cho bộ giả lập sự kiện Zalo.
Đầu vào: các tệp JSON định nghĩa hàm / trigger đọc CHỈ ĐỌC từ production (pg_get_functiondef), để ngoài repo.
Cách chạy: python3 -I scripts/event-bot/fuzz/build-dynfilter-fixture.py <dynfilter-live.json> <extra.json> <extra2.json> <extra3.json>"""
import json, sys, os
funcs, trigs = {}, []
for p in sys.argv[1:]:
    r = json.load(open(p))
    for f in r.get('funcs') or []:
        funcs[f['sig']] = f['def']
    trigs += r.get('triggers') or []
KEEP = ['aka_agent_data_group_account_available', 'aka_agent_data_group_dynamic_scope_matches', 'aka_agent_dynamic_filter_enqueue_contact',
        'aka_agent_dynamic_filter_enqueue_group_member', 'aka_agent_dynamic_filter_sync_chat_contact', 'aka_agent_enqueue_data_group_chat_user',
        'private.aka_agent_notification_member_events_enabled', 'aka_agent_process_data_group_dynamic_filters_core',
        'aka_agent_run_data_group_dynamic_filter_worker', 'aka_agent_data_group_dynamic_rule_matches', 'private.aka_agent_data_group_finish_member_events',
        'private.aka_agent_data_group_record_member_event', 'private.aka_agent_notification_enabled', 'private.aka_agent_notification_setting',
        'aka_agent_data_group_dynamic_values_match', 'aka_agent_data_group_zalo_facts']
out = []
out.append(open(os.path.join(os.path.dirname(__file__), 'dynfilter-schema.sql')).read())
for k in KEEP:
    sig = next(s for s in funcs if s.split('(')[0] == k)
    out.append(f'-- {sig} (production, đọc 27/11/2026)\n' + funcs[sig].rstrip() + ';\n')
for t in trigs:
    out.append(t['def'] + ';\n')
dst = os.path.join(os.path.dirname(__file__), '..', 'db', 'dynfilter-prod-20261127.sql')
open(dst, 'w').write('\n'.join(out))
print(dst, len(KEEP), 'hàm', len(trigs), 'trigger')
