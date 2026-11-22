#!/usr/bin/env python3
"""Sinh V622: "Chào ngày mới" trả tổng data chờ / dự kiến hôm nay của MỌI chiến dịch chạy hôm nay.

V621 chỉ trả 50 chiến dịch đầu (theo giờ chạy) trong `campaignsToday`, API cộng tổng từ 50 dòng đó nên nhân viên có hơn 50
chiến dịch thấy số "dự kiến hôm nay" thấp hơn thật (đo 22/11/2026: nhân viên 2362 có 116 chiến dịch). V622 thêm ba khoá tính
trên toàn bộ `ranked`: `campaignsTodayNeedsData` (số chiến dịch cần data), `campaignsTodayPending`, `campaignsTodayExpected`.
Không đổi khoá cũ, nên API bản cũ vẫn chạy như trước.

Nguồn: migrations/snapshots/notification-morning-totals-v622/live/*.sql = pg_get_functiondef production đọc 22/11/2026.
Ra: migrations/migration_v622_notification_morning_totals.sql + rollback_v622_notification_morning_totals.sql.
Chỉ thay thân một hàm (CREATE OR REPLACE giữ chủ sở hữu và quyền), khoá md5 trước / sau.
"""
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SIG = 'private.aka_agent_notification_morning(bigint,text,timestamp with time zone)'
LIVE_MD5 = '94392489bb0b5f3c25bd281c2fe1eb06'
LIVE = ROOT / 'migrations' / 'snapshots' / 'notification-morning-totals-v622' / 'live' / f'aka_agent_notification_morning.{LIVE_MD5}.sql'
NAME = 'migration_v622_notification_morning_totals'

OLD = """           'campaignsTodayTotal', (SELECT count(*) FROM ranked),
"""
NEW = """           'campaignsTodayTotal', (SELECT count(*) FROM ranked),
           -- V622: tổng trên mọi chiến dịch chạy hôm nay (campaignsToday chỉ có 50 dòng đầu).
           'campaignsTodayNeedsData', (SELECT count(*) FROM ranked WHERE NOT no_data),
           'campaignsTodayPending', (SELECT coalesce(sum(pending), 0) FROM ranked WHERE NOT no_data),
           'campaignsTodayExpected', (SELECT coalesce(sum(CASE WHEN day_left IS NULL THEN pending
                                                              ELSE least(pending, greatest(day_left - used_before, 0)) END), 0)
                                        FROM ranked WHERE NOT no_data),
"""


def md5(s: str) -> str:
    return hashlib.md5(s.encode()).hexdigest()


def q(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


old = LIVE.read_text(encoding='utf-8')
if md5(old) != LIVE_MD5:
    raise SystemExit(f'bản chụp md5 {md5(old)} khác {LIVE_MD5}')
if old.count(OLD) != 1:
    raise SystemExit('không tìm thấy đúng một chỗ cần sửa')
new = old.replace(OLD, NEW)
NEW_MD5 = md5(new)


def guard(tag: str, want: str, msg: str) -> str:
    return f"""  IF md5(pg_get_functiondef({q(SIG)}::regprocedure)) IS DISTINCT FROM {q(want)} THEN
    RAISE EXCEPTION '{tag}: {SIG} {msg} (md5 %)', md5(pg_get_functiondef({q(SIG)}::regprocedure));
  END IF;"""


def body(def_text: str) -> str:
    if not def_text.endswith('\n'):
        def_text += '\n'
    return def_text.rstrip('\n') + ';\n'


migration = f"""-- V622: "Chào ngày mới" (snapshot morning) trả thêm tổng data chờ / dự kiến hôm nay trên MỌI chiến dịch chạy hôm nay.
-- V621 chỉ có 50 chiến dịch đầu trong campaignsToday nên tổng do API cộng thiếu khi nhân viên có hơn 50 chiến dịch.
-- Thêm khoá campaignsTodayNeedsData / campaignsTodayPending / campaignsTodayExpected; khoá cũ giữ nguyên.
-- Chỉ thay thân private.aka_agent_notification_morning (CREATE OR REPLACE giữ chủ sở hữu và quyền), khoá md5 trước / sau.
-- Sinh bằng: python3 scripts/build-v622-sql.py
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $v622_pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name = 'migration_v621_notification_daily_reports') THEN
    RAISE EXCEPTION 'v622: cần V621 trước';
  END IF;
{guard('v622', LIVE_MD5, 'khác bản đã đọc 22/11/2026')}
END
$v622_pre$;

{body(new)}
DO $v622_post$
BEGIN
{guard('v622', NEW_MD5, 'sau khi thay không đúng bản V622')}
END
$v622_post$;
COMMIT;
"""

rollback = f"""-- Gỡ V622: trả private.aka_agent_notification_morning về bản V621 (khoá md5 trước / sau).
BEGIN;
SET LOCAL lock_timeout = '3s';
DO $v622_rb_pre$
BEGIN
{guard('v622 rollback', NEW_MD5, 'không phải bản V622')}
END
$v622_rb_pre$;

{body(old)}
DO $v622_rb_post$
BEGIN
{guard('v622 rollback', LIVE_MD5, 'sau khi gỡ không đúng bản V621')}
END
$v622_rb_post$;
COMMIT;
"""

(ROOT / 'migrations' / f'{NAME}.sql').write_text(migration, encoding='utf-8')
(ROOT / 'migrations' / f'rollback_v622_notification_morning_totals.sql').write_text(rollback, encoding='utf-8')
print('md5 thân trước', LIVE_MD5, 'sau', NEW_MD5)
print('md5 migration', md5(migration))
