#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convert 5 JSON dump files to SQL INSERT statements."""

import json
import re
import os
import sys

BASE = r"C:\Users\Nitrogen\.claude\projects\D--Workspace-MERN-akaBizAutoNew\f96ee437-9abd-4f18-9432-caaa48e7e059\tool-results"

FILES = {
    "auto_flows":                    os.path.join(BASE, "mcp-4bd6d52b-f589-4b27-aa58-85d64b12b3d5-execute_sql-1776832491370.txt"),
    "auto_campaigns":                os.path.join(BASE, "mcp-4bd6d52b-f589-4b27-aa58-85d64b12b3d5-execute_sql-1776832511953.txt"),
    "auto_campaign_details":         os.path.join(BASE, "mcp-4bd6d52b-f589-4b27-aa58-85d64b12b3d5-execute_sql-1776832517387.txt"),
    "auto_campaign_detail_actions":  os.path.join(BASE, "mcp-4bd6d52b-f589-4b27-aa58-85d64b12b3d5-execute_sql-1776832522978.txt"),
    "auto_flatform_contacts":        os.path.join(BASE, "mcp-4bd6d52b-f589-4b27-aa58-85d64b12b3d5-execute_sql-1776832529626.txt"),
}

# (column_name, type_kind)
# type_kind in: text, int, bool, ts, uuid, jsonb
SCHEMAS = {
    "auto_flows": [
        ("id", "uuid"),
        ("name", "text"),
        ("description", "text"),
        ("nodes", "jsonb"),
        ("edges", "jsonb"),
        ("variables", "jsonb"),
        ("input_schema", "jsonb"),
        ("output_schema", "jsonb"),
        ("is_block", "bool"),
        ("created_at", "ts"),
        ("updated_at", "ts"),
        ("staff_id", "int"),
        ("organization_id", "int"),
    ],
    "auto_campaigns": [
        ("id", "int"),
        ("name", "text"),
        ("action_id", "text"),
        ("flatform_account_id", "int"),
        ("status", "text"),
        ("schedule", "ts"),
        ("time_sleep_between_2", "int"),
        ("log", "text"),
        ("is_delete", "bool"),
        ("created_at", "ts"),
        ("updated_at", "ts"),
        ("content", "text"),
        ("schedule_type", "text"),
        ("schedule_end_date", "ts"),
        ("schedule_days", "text"),
        ("schedule_week_days", "text"),
        ("continue_next_day", "bool"),
        ("refresh_data", "bool"),
        ("extra_settings", "jsonb"),
        ("images", "jsonb"),
        ("staff_id", "int"),
        ("organization_id", "int"),
    ],
    "auto_campaign_details": [
        ("id", "int"),
        ("campaign_id", "int"),
        ("name", "text"),
        ("phone", "text"),
        ("uid", "text"),
        ("email", "text"),
        ("status", "text"),
        ("note", "text"),
        ("schedule", "ts"),
        ("date_action", "ts"),
        ("is_delete", "bool"),
        ("created_at", "ts"),
    ],
    "auto_campaign_detail_actions": [
        ("id", "int"),
        ("campaign_detail_id", "int"),
        ("campaign_id", "int"),
        ("action_name", "text"),
        ("status", "text"),
        ("log", "text"),
        ("data", "jsonb"),
        ("is_delete", "bool"),
        ("created_at", "ts"),
        ("account_id", "int"),
        ("post_url", "text"),
    ],
    "auto_flatform_contacts": [
        ("id", "int"),
        ("flatform_account_id", "int"),
        ("contact_type", "text"),
        ("name", "text"),
        ("uid", "text"),
        ("url", "text"),
        ("extra_data", "jsonb"),
        ("is_delete", "bool"),
        ("created_at", "ts"),
        ("updated_at", "ts"),
        ("staff_id", "int"),
        ("organization_id", "int"),
    ],
}

IDENTITY_ALWAYS = {"auto_campaigns", "auto_campaign_details"}


def extract_rows(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    outer = json.loads(raw)["result"]
    m = re.search(r"<untrusted-data-[^>]+>\s*(\[.*\])\s*</untrusted-data-", outer, re.DOTALL)
    if not m:
        raise RuntimeError(f"Cannot extract array from {path}")
    arr = json.loads(m.group(1))
    return [item["r"] for item in arr]


def sql_text(s):
    """Escape text for SQL single-quoted literal. standard_conforming_strings is on."""
    return "'" + s.replace("'", "''") + "'"


def to_literal(value, kind):
    if value is None:
        return "NULL"
    if kind == "text":
        if not isinstance(value, str):
            value = str(value)
        return sql_text(value)
    if kind == "int":
        # bigint/int4 — value is already a number from JSON
        if isinstance(value, bool):
            return "true" if value else "false"
        return str(int(value))
    if kind == "bool":
        return "true" if bool(value) else "false"
    if kind == "ts":
        if not isinstance(value, str):
            value = str(value)
        return sql_text(value) + "::timestamptz"
    if kind == "uuid":
        if not isinstance(value, str):
            value = str(value)
        return sql_text(value) + "::uuid"
    if kind == "jsonb":
        # value can be dict/list/str/etc — re-encode
        encoded = json.dumps(value, ensure_ascii=False)
        return sql_text(encoded) + "::jsonb"
    raise RuntimeError(f"Unknown kind: {kind}")


def build_insert(table, schema, row):
    cols = [c for c, _ in schema]
    vals = []
    for col, kind in schema:
        v = row.get(col)
        vals.append(to_literal(v, kind))
    cols_sql = ", ".join(cols)
    vals_sql = ", ".join(vals)
    if table in IDENTITY_ALWAYS:
        return f"INSERT INTO public.{table} ({cols_sql}) OVERRIDING SYSTEM VALUE VALUES ({vals_sql});"
    return f"INSERT INTO public.{table} ({cols_sql}) VALUES ({vals_sql});"


def main():
    out_path = r"D:\Workspace\MERN\akaBizAutoNew\migration_data_large.sql"
    chunks = []
    counts = {}
    errors = []

    chunks.append("-- ============================================================")
    chunks.append("-- Data INSERT cho 5 bang lon (auto_flows, auto_campaigns,")
    chunks.append("-- auto_campaign_details, auto_campaign_detail_actions,")
    chunks.append("-- auto_flatform_contacts)")
    chunks.append("-- Tong: 1148 rows")
    chunks.append("-- ============================================================")
    chunks.append("")

    for table, path in FILES.items():
        try:
            rows = extract_rows(path)
        except Exception as e:
            errors.append(f"{table}: extract failed: {e}")
            counts[table] = 0
            continue
        counts[table] = len(rows)
        chunks.append(f"-- ===== {table} ({len(rows)} rows) =====")
        schema = SCHEMAS[table]
        for idx, row in enumerate(rows):
            try:
                chunks.append(build_insert(table, schema, row))
            except Exception as e:
                errors.append(f"{table}[{idx}] (id={row.get('id')}): {e}")
        chunks.append("")

    content = "\n".join(chunks)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)

    size_bytes = os.path.getsize(out_path)
    print("=== REPORT ===")
    for t, c in counts.items():
        print(f"  {t}: {c} rows")
    print(f"  Total rows: {sum(counts.values())}")
    print(f"  Errors: {len(errors)}")
    for e in errors:
        print(f"    - {e}")
    print(f"  File size: {size_bytes} bytes ({size_bytes/1024:.1f} KB)")
    print(f"  Path: {out_path}")


if __name__ == "__main__":
    main()
