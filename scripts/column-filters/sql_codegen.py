"""Compile trusted SQL structure; runtime data is supplied only by EXECUTE USING."""
import re


def render_reader(source: str, kind: str) -> str:
    contacts = kind == 'contacts'
    date_key = 'time' if contacts else 'createdAt'
    checks = [
        "page_offset<>0",
        "jsonb_typeof(p_query->'after') IS DISTINCT FROM 'object'",
        "jsonb_typeof(p_query#>'{after,id}') IS DISTINCT FROM 'string'",
        "(p_query#>>'{after,id}') !~ '^[1-9][0-9]{0,15}$'",
        f"jsonb_typeof(p_query#>'{{after,{date_key}}}') IS DISTINCT FROM 'string'",
        f"(p_query#>>'{{after,{date_key}}}') !~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}[T ][0-9]{{2}}:[0-9]{{2}}:[0-9]{{2}}([.][0-9]{{1,6}})?(Z|[+-][0-9]{{2}}:[0-9]{{2}})$'",
    ]
    if contacts:
        checks += [
            "jsonb_typeof(p_query#>'{after,rank}') IS DISTINCT FROM 'number'",
            "(p_query#>>'{after,rank}') !~ '^[0-9]{1,10}$'",
            "jsonb_typeof(p_query#>'{after,name}') IS DISTINCT FROM 'string'",
        ]
    cursor = """ IF p_query ? 'after' THEN
  IF __CHECKS__ THEN RAISE EXCEPTION 'invalid_filter_cursor' USING ERRCODE='22023'; END IF;
  BEGIN
   IF (p_query#>>'{after,id}')::bigint>9007199254740991 OR NOT isfinite((p_query#>>'{after,__DATE__}')::timestamptz) THEN
    RAISE EXCEPTION 'invalid_filter_cursor' USING ERRCODE='22023';
   END IF;
   __RANK__
  EXCEPTION WHEN data_exception THEN RAISE EXCEPTION 'invalid_filter_cursor' USING ERRCODE='22023'; END;
  cursor_clause:=$cursor$__CLAUSE__$cursor$;
 END IF;
"""
    if contacts:
        clause = "(sort_rank,sort_name,-extract(epoch FROM sort_time),id)>((($3#>>'{after,rank}')::integer),($3#>>'{after,name}'),-extract(epoch FROM ($3#>>'{after,time}')::timestamptz),($3#>>'{after,id}')::bigint)"
    else:
        columns = 'member_created_at,selected_member_id' if kind == 'group' else 'created_at,id'
        clause = "(" + columns + ")<(($3#>>'{after,createdAt}')::timestamptz,($3#>>'{after,id}')::bigint)"
    cursor = cursor.replace('__CHECKS__', '\n   OR '.join(checks)).replace('__DATE__', date_key)
    cursor = cursor.replace('__RANK__', "PERFORM (p_query#>>'{after,rank}')::integer;" if contacts else '')
    source = source.replace('__CURSOR_VALIDATION__', cursor.replace('__CLAUSE__', clause))
    # format() substitutes trusted fragments once. It never rescans the fragments
    # or the values bound as $3/$5/$6 for template markers.
    start, query, end = source.split('$query$')
    query = query.replace('%', '%%')
    for marker, replacement in {
        '__PREDICATE__': '%1$s', '__CURSOR__': '%2$s', '__COUNT__': '%3$s',
        '__MATERIALIZED__': '%4$s', '__OFFSET__': '$5', '__LIMIT__': '$6',
    }.items():
        query = query.replace(marker, replacement)
    assert not re.search(r'__[A-Z]+__', query), 'Unresolved SQL template marker'
    return start + '$query$' + query + '$query$' + end
