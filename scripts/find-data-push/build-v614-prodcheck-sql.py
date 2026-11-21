#!/usr/bin/env python3
"""Sinh câu kiểm khoá V614 trên DB thật mà không tạo gì lâu dài: hai hàm khoá V614 tạo trong pg_temp (chỉ sống trong phiên),
cả câu nằm trong giao dịch kết thúc bằng ROLLBACK. So khoá V610 đang chạy với khoá V614 trên data thật của chiến dịch đích.
    python3 scripts/find-data-push/build-v614-prodcheck-sql.py <kind>:<loại chiến dịch|...>:<uid|phone> [...] [--camps N] [--rows N]
Kết quả theo từng loại: rows, merged_clusters (cụm V614 gộp nhiều cách viết), newly_merged_by_v614 (V610 coi là khác),
split_vs_v610 (V610 gộp mà V614 tách), token_invariant_broken (cùng khoá mà không chung mảnh: phải 0), mẫu cụm gộp để soát tay.
"""
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[2]
args = sys.argv[1:]
ncamp, nrow = 600, 300
if '--camps' in args:
    i = args.index('--camps'); ncamp = int(args[i + 1]); del args[i:i + 2]
if '--rows' in args:
    i = args.index('--rows'); nrow = int(args[i + 1]); del args[i:i + 2]
mig = (root / 'migrations/migration_v614_find_data_push_match_key_v2.sql').read_text(encoding='utf-8')
fns = re.findall(r'(CREATE (?:OR REPLACE )?FUNCTION private\.aka_agent_find_data_match_(?:key|tokens)\(.*?\$function\$;)', mig, re.S)
assert len(fns) == 2
body = '\n'.join(fns).replace('CREATE OR REPLACE FUNCTION private.aka_agent_find_data_match_key', 'CREATE FUNCTION pg_temp.mk614')
body = body.replace('CREATE FUNCTION private.aka_agent_find_data_match_tokens', 'CREATE FUNCTION pg_temp.tk614')
body = body.replace('private.aka_agent_find_data_match_key(', 'pg_temp.mk614(')
body = '\n'.join(line for line in body.splitlines() if not line.strip().startswith('--'))
stop = re.search(r"WHERE t\.tok <> ALL \((ARRAY\[.*?\]::text\[\])\)", mig).group(1)
parts = []
for spec in args:
    kind, actions, col = spec.split(':')
    acts = ','.join("'" + a + "'" for a in actions.split('|'))
    parts.append(f"""'{kind}', (WITH c AS MATERIALIZED (
  SELECT id FROM public.auto_campaigns WHERE action_id IN ({acts}) ORDER BY id DESC LIMIT {ncamp}
), r AS MATERIALIZED (
  SELECT d.campaign_id, d.v FROM c CROSS JOIN LATERAL (
    SELECT x.campaign_id, x.{col} AS v FROM public.auto_campaign_input_data AS x
     WHERE x.campaign_id = c.id AND NOT COALESCE(x.is_delete, false) AND COALESCE(btrim(x.{col}), '') <> '' ORDER BY x.id DESC LIMIT {nrow}) AS d
), k AS MATERIALIZED (
  SELECT campaign_id, v, private.aka_agent_find_data_match_key('{kind}', v) AS k610, pg_temp.mk614('{kind}', v) AS k614 FROM r
), cl AS MATERIALIZED (
  SELECT campaign_id, k614, count(DISTINCT lower(btrim(v))) AS nraw, count(DISTINCT k610) AS n610, array_agg(DISTINCT left(v, 140)) AS vs,
         min(v) AS v0, array_agg(DISTINCT v) AS vfull
    FROM k WHERE k614 IS NOT NULL GROUP BY 1, 2
)
SELECT json_build_object(
  'rows', (SELECT count(*) FROM k), 'campaigns', (SELECT count(DISTINCT campaign_id) FROM k),
  'null_key', (SELECT count(*) FROM k WHERE k614 IS NULL),
  'merged_clusters', (SELECT count(*) FROM cl WHERE nraw > 1),
  'newly_merged_by_v614', (SELECT count(*) FROM cl WHERE n610 > 1),
  'split_vs_v610', (SELECT count(*) FROM (SELECT campaign_id, k610 FROM k GROUP BY 1, 2 HAVING count(DISTINCT k614) > 1) z),
  'token_invariant_broken', (SELECT count(*) FROM cl, LATERAL unnest(cl.vfull) AS m(v)
      WHERE cl.nraw > 1 AND NOT (pg_temp.tk614('{kind}', m.v) && COALESCE((SELECT array_agg(t) FROM unnest(pg_temp.tk614('{kind}', cl.v0)) t WHERE t <> ALL ({stop})), '{{}}'))),
  'merged_samples', (SELECT json_agg(json_build_object('k', left(k614, 80), 'vs', vs[1:4])) FROM (SELECT k614, vs FROM cl WHERE nraw > 1 ORDER BY random() LIMIT 30) z),
  'split_samples', (SELECT json_agg(x) FROM (SELECT array_agg(DISTINCT left(v, 120)) x FROM k GROUP BY campaign_id, k610 HAVING count(DISTINCT k614) > 1 LIMIT 8) z)
))""")
sql = f"""BEGIN;
SET LOCAL statement_timeout = '58s';
{body}
SELECT json_build_object(
{(','+chr(10)).join(parts)}
) AS result;
ROLLBACK;
"""
sys.stdout.write(sql)
