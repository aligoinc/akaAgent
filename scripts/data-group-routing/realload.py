"""Nạp dữ liệu thật đã chép (REALDATA_DIR/tables) vào cụm cục bộ + nạp đè hàm production lệch bản chụp 27/10."""
from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path

import mcpfile


def add_missing_columns(c) -> list[str]:
    schema = mcpfile.load('prod_schema')
    local = {(r['table_schema'], r['table_name'], r['column_name']) for r in c.rows(
        "SELECT table_schema, table_name, column_name FROM information_schema.columns "
        "WHERE table_schema IN ('public', 'private')")}
    tables = {(s, t) for s, t, _ in local}
    stmts = []
    for sch, rel, col, typ, nn, dflt, ident, gen, num in schema['columns']:
        if (sch, rel) in tables and (sch, rel, col) not in local:
            d = f' DEFAULT {dflt}' if dflt and 'nextval(' not in dflt else ''
            stmts.append(f'ALTER TABLE {sch}."{rel}" ADD COLUMN IF NOT EXISTS "{col}" {typ}{d};')
    if stmts:
        c.psql('\n'.join(stmts))
    return stmts


def overlay_drifted_functions(c, signatures: list[str]) -> list[str]:
    defs = {d[0]: d[1] for d in mcpfile.load('prod_function_defs')}
    sql = 'SET check_function_bodies = off;\n' + '\n'.join(defs[s] + ';' for s in signatures)
    _, err = c.psql(sql, stop_on_error=False)
    return [l for l in err.splitlines() if 'ERROR' in l]


def load_tables(c, names: list[str] | None = None) -> dict:
    tdir = mcpfile.REALDATA_DIR / 'tables'
    counts = {}
    stmts = ['SET session_replication_role = replica;']
    tmp = Path(tempfile.mkdtemp(prefix='realload-'))
    for f in sorted(tdir.glob('*.json')):
        table = f.stem
        if names and table not in names:
            continue
        payload = json.loads(f.read_text(encoding='utf-8'))
        cols, rows = payload['cols'], payload['rows']
        if not rows:
            continue
        jl = tmp / f'{table}.jsonl'
        with open(jl, 'w', encoding='utf-8') as fh:
            for r in rows:
                fh.write(json.dumps(dict(zip(cols, r)), ensure_ascii=False) + '\n')
        local_cols = {r['column_name'] for r in c.rows(
            f"SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{table}'")}
        use = ', '.join(f'"{col}"' for col in cols if col in local_cols)
        stmts += [f'CREATE TEMP TABLE "stage_{table}" (j jsonb);',
                  f"\\copy \"stage_{table}\" FROM '{jl}' WITH (FORMAT csv, QUOTE e'\\x01', DELIMITER e'\\x02')",
                  f'DELETE FROM public."{table}";',
                  f'INSERT INTO public."{table}" ({use}) SELECT {", ".join("r." + x.strip() for x in use.split(","))} '
                  f'FROM "stage_{table}" s, jsonb_populate_record(NULL::public."{table}", s.j) r;']
        counts[table] = len(rows)
    stmts.append('SET session_replication_role = origin;')
    c.psql('\n'.join(stmts))
    # Dời sequence lên trên id đã nạp để dòng mới không trùng.
    c.q("""DO $$DECLARE r record; v bigint; BEGIN
      FOR r IN SELECT c.relname AS tbl, pg_get_serial_sequence('public.' || quote_ident(c.relname), 'id') AS seq
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relkind = 'r'
                 AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'id' AND NOT a.attisdropped)
      LOOP
        IF r.seq IS NOT NULL THEN
          EXECUTE format('SELECT max(id) FROM public.%I', r.tbl) INTO v;
          IF v IS NOT NULL THEN PERFORM setval(r.seq, v + 1000); END IF;
        END IF;
      END LOOP; END$$;""")
    return counts
