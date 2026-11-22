#!/usr/bin/env python3
"""Sinh migration V624 (và bản gỡ) từ thân hàm V623 đã apply.

V624 chỉ thay thân public.akabiz_import_auto_desktop_v1(jsonb) để chạy đúng khi akaBiz Auto vẫn chạy trong lúc đồng bộ
(tìm ra bằng giả lập 22/11/2026, akaAgentWebApp scripts/akabiz-auto-sync-sim):
  1. 'inputs' không còn báo SOURCE_CHANGED khi số dòng đã đọc vượt số dòng lúc dựng bản chép (akaBiz Auto thêm data giữa lượt).
  2. 'publish' nhận payload.after_id: bên đọc khẳng định đã đọc hết tới đúng con trỏ máy chủ đang giữ; không có after_id thì kiểm
     số dòng như V623 (bên đọc cũ).
  3. 'campaign' gọi lại cho bản chép còn ẩn: cập nhật expected_count theo lần gọi mới; nếu loại chiến dịch / tài khoản nguồn
     đã đổi thì xoá dòng đã chép của bản ẩn đó và dựng bản chép mới (trước đây báo SOURCE_CHANGED mãi, không chép được).
Chạy: python3 scripts/build-v624-sql.py <md5 thân hàm V624>  (md5 lấy bằng lần chạy đầu trên PostgreSQL tạm, xem in ra).
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
v623 = (root / 'migrations/migration_v623_akabiz_auto_sync.sql').read_text()
m = re.search(r"EXECUTE \$create\$\n(CREATE FUNCTION .*?\n\$function\$;\n)\$create\$;", v623, re.S)
assert m, 'không tìm thấy thân hàm V623'
old_fn = m.group(1).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1)
V623_MD5 = 'f4ae76455879213d60526bc6cc20a805'

def sub(text, old, new):
    assert text.count(old) == 1, f'đoạn cần thay không duy nhất: {old[:80]}'
    return text.replace(old, new)

fn = old_fn
fn = sub(fn, """   IF h.target_id IS NOT NULL THEN
     IF h.source_version IS DISTINCT FROM n.source_version THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
     RETURN jsonb_build_object('state','staged','campaignId',c.id::text,
       'cursor',jsonb_build_object('afterId',h.data->'after_id','consumed',coalesce((h.data->>'consumed_count')::integer,0)));
   END IF;""", """   IF h.target_id IS NOT NULL THEN
     IF h.source_version IS DISTINCT FROM n.source_version THEN
       -- V624: loại chiến dịch / tài khoản nguồn đổi khi bản chép còn ẩn: bỏ dòng đã chép, dựng bản chép mới bên dưới
       -- (bản ẩn cũ giữ is_delete=true, không còn dòng nào).
       DELETE FROM public.auto_campaign_input_data WHERE campaign_id=c.id;
     ELSE
       -- V624: số dòng nguồn có thể đổi giữa hai lượt (akaBiz Auto vẫn chạy): ghi số mới để đối chiếu.
       IF coalesce((payload->>'expected_count')::bigint,-1)>=0 THEN
         UPDATE public.akabiz_zalo_import_history SET data=data||jsonb_build_object('expected_count',(payload->>'expected_count')::integer),
           updated_at=clock_timestamp() WHERE id=h.id RETURNING * INTO h;
       END IF;
       RETURN jsonb_build_object('state','staged','campaignId',c.id::text,
         'cursor',jsonb_build_object('afterId',h.data->'after_id','consumed',coalesce((h.data->>'consumed_count')::integer,0)));
     END IF;
   END IF;""")
fn = sub(fn, """   IF (h.data->>'consumed_count')::integer>(h.data->>'expected_count')::integer THEN RAISE EXCEPTION 'SOURCE_CHANGED'; END IF;
""", "")
fn = sub(fn, """ IF (h.data->>'consumed_count')::integer IS DISTINCT FROM (h.data->>'expected_count')::integer THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;""",
         """ -- V624: bên đọc gửi after_id = con trỏ nó đã đọc hết tới (không còn dòng nào sau đó); phải trùng con trỏ máy chủ.
 IF payload ? 'after_id' THEN
   IF (payload->'after_id') IS DISTINCT FROM coalesce(h.data->'after_id','null'::jsonb) THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;
 ELSIF (h.data->>'consumed_count')::integer IS DISTINCT FROM (h.data->>'expected_count')::integer THEN RAISE EXCEPTION 'IMPORT_INCOMPLETE'; END IF;""")
fn = sub(fn, """ UPDATE public.akabiz_zalo_import_history SET state='complete',error_code=NULL,updated_at=clock_timestamp() WHERE id=h.id;""",
         """ UPDATE public.akabiz_zalo_import_history SET state='complete',error_code=NULL,
   data=data||jsonb_build_object('expected_count',(data->>'consumed_count')::integer),updated_at=clock_timestamp() WHERE id=h.id;""")

v624_md5 = sys.argv[1] if len(sys.argv) > 1 else 'MD5_CHUA_TINH'

def wrap(tag, title, body, pre_md5, post_md5, notes):
    return f"""{title}
{notes}
-- Một khối DO = một câu lệnh: kiểm trước, thay, kiểm sau cùng thành công hoặc cùng thất bại. Không đổi bảng, quyền, ACL.
DO ${tag}$
DECLARE v_body text;
BEGIN
 SELECT md5(pg_get_functiondef('public.akabiz_import_auto_desktop_v1(jsonb)'::regprocedure)) INTO v_body;
 IF v_body IS DISTINCT FROM '{pre_md5}' THEN
   RAISE EXCEPTION '{tag.upper()} preflight: thân hàm hiện tại không như mong đợi: %', v_body;
 END IF;

 EXECUTE $create$
{body}$create$;

 SELECT md5(pg_get_functiondef('public.akabiz_import_auto_desktop_v1(jsonb)'::regprocedure)) INTO v_body;
 IF v_body IS DISTINCT FROM '{post_md5}' THEN
   RAISE EXCEPTION '{tag.upper()} postflight: thân hàm sau khi thay không như mong đợi: %', v_body;
 END IF;
END ${tag}$;
"""

notes = """-- Người dùng yêu cầu 22/11/2026: giả lập đồng bộ trên SQLite như khách thật, sửa lỗi tìm ra (akaAgentWebApp
-- scripts/akabiz-auto-sync-sim). Chỉ thay thân public.akabiz_import_auto_desktop_v1(jsonb) của V623:
--  1. 'inputs' không báo SOURCE_CHANGED khi đã đọc nhiều dòng hơn lúc dựng bản chép (akaBiz Auto thêm data giữa lượt).
--  2. 'publish' nhận payload.after_id (bên đọc đã đọc hết tới con trỏ này) thay cho so số dòng; thiếu after_id thì như V623.
--  3. 'campaign' gọi lại cho bản chép còn ẩn: ghi số dòng mới; loại / tài khoản nguồn đổi thì dựng lại bản chép
--     (V623 báo SOURCE_CHANGED mãi, chiến dịch không bao giờ chép được).
-- Sinh bằng scripts/build-v624-sql.py từ thân V623; bản gỡ: rollback_v624_akabiz_auto_sync_live_source.sql."""
(root / 'migrations/migration_v624_akabiz_auto_sync_live_source.sql').write_text(
    wrap('v624', '-- V624 — Đồng bộ akaBiz Auto: chạy đúng khi akaBiz Auto vẫn thêm / xoá data trong lúc đồng bộ.', fn, V623_MD5, v624_md5, notes))
(root / 'migrations/rollback_v624_akabiz_auto_sync_live_source.sql').write_text(
    wrap('r624', '-- Gỡ V624: đặt lại thân hàm akabiz_import_auto_desktop_v1 của V623.', old_fn, v624_md5, V623_MD5,
         '-- Không đổi dữ liệu. Bản chép ẩn đã dựng lại bởi V624 (bản cũ không còn dòng) giữ nguyên.'))
print('ok', v624_md5)
