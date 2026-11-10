"""Đọc file kết quả MCP execute_sql mà Claude Code lưu ra đĩa khi quá lớn (dữ liệu production chỉ đọc).

File là JSON {"result": "...<untrusted-data-X>\n[ ...rows... ]\n</untrusted-data-X>..."}; trả về danh sách dòng.
Dữ liệu khách KHÔNG được commit: chỉ giữ trong thư mục scratchpad (REALDATA_DIR).
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

REALDATA_DIR = Path(os.environ.get(
    'REALDATA_DIR', '/tmp/claude-0/-home-user/02f7dd56-f23a-528e-a3f7-2968e7553206/scratchpad/realdata'))
TOOL_RESULTS = Path('/root/.claude/projects/-home-user/02f7dd56-f23a-528e-a3f7-2968e7553206/tool-results')


def rows_of(path: str | Path) -> list:
    raw = Path(path).read_text(encoding='utf-8')
    try:
        text = json.loads(raw)['result']
    except (ValueError, KeyError, TypeError):
        text = raw
    m = re.search(r'<untrusted-data-([0-9a-f-]+)>\n(.*)\n</untrusted-data-\1>', text, re.S)
    if not m:
        raise ValueError(f'no data block in {path}')
    return json.loads(m.group(2))


def data_of(path: str | Path, column: str = 'data'):
    """Câu trích xuất trả một dòng {data: <json text>, pad: ...}: parse cột data."""
    rows = rows_of(path)
    assert len(rows) == 1, len(rows)
    value = rows[0][column]
    return json.loads(value) if isinstance(value, str) else value


def save(name: str, path: str | Path, column: str = 'data'):
    """Chép dữ liệu của một file kết quả MCP vào REALDATA_DIR/<name>.json (không commit)."""
    REALDATA_DIR.mkdir(parents=True, exist_ok=True)
    value = data_of(path, column)
    out = REALDATA_DIR / f'{name}.json'
    out.write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
    return out, (len(value) if isinstance(value, (list, dict)) else None)


def load(name: str):
    return json.loads((REALDATA_DIR / f'{name}.json').read_text(encoding='utf-8'))
