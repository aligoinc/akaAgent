-- The column catalog below is generated from src/shared/dataColumnFilters.ts.
-- Readers bind the complete query as EXECUTE USING parameter $3. Only catalog
-- identifiers, operators and internally generated array indexes enter SQL text.
CREATE FUNCTION private.column_filter_predicate_v1(p_source text, p_request jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $fn$
DECLARE
 catalog constant jsonb := $catalog$__CATALOG__$catalog$::jsonb;
 operators constant jsonb := $operators$__OPERATORS__$operators$::jsonb;
 f jsonb; c jsonb; v jsonb; field text; op text; kind text; expr text; lit text; upper_lit text;
 result text := 'true'; predicate text; seen text[] := '{}'; item_index integer := -1; bound text;
BEGIN
 IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR p_request->'version' IS DISTINCT FROM '1'::jsonb
 OR jsonb_typeof(p_request->'filters') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_column_filters' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(p_request->'filters') > 40 OR NOT COALESCE(catalog ? p_source,false) THEN RAISE EXCEPTION 'invalid_column_filters' USING ERRCODE='22023'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_request->'filters') LOOP
  item_index:=item_index+1;
  bound:=format('($3->''columnFilters''->''filters''->%s)',item_index);
  field:=f->>'field'; op:=f->>'op'; c:=catalog->p_source->field; kind:=c->>'kind';
  IF c IS NULL OR field=ANY(seen) OR NOT COALESCE((operators->kind) ? op,false) THEN RAISE EXCEPTION 'invalid_column_filter_field_or_operator' USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,field); expr:=format('%I','f_'||field);
  IF kind IN ('text','identifier','enum','presence') THEN
   expr:=format('NULLIF(btrim(%s::text, chr(32)||chr(9)||chr(10)||chr(13)||chr(12)||chr(11)||chr(160)), '''')',expr);
  END IF;
  IF op IN ('empty','not_empty') THEN
   predicate:=CASE WHEN kind='set' THEN format('COALESCE(cardinality(%s),0) %s 0',expr,CASE WHEN op='empty' THEN '=' ELSE '>' END)
    ELSE format('%s IS %sNULL',expr,CASE WHEN op='empty' THEN '' ELSE 'NOT ' END) END;
  ELSIF op='in' THEN
   IF jsonb_typeof(f->'value') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_column_filter_values' USING ERRCODE='22023'; END IF;
   IF jsonb_array_length(f->'value') NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_column_filter_values' USING ERRCODE='22023'; END IF;
   FOR v IN SELECT value FROM jsonb_array_elements(f->'value') LOOP
    IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>1000 OR btrim(v#>>'{}')='' OR
      (c ? 'options' AND NOT (c->'options' ? (v#>>'{}'))) THEN RAISE EXCEPTION 'invalid_column_filter_value' USING ERRCODE='22023'; END IF;
   END LOOP;
   lit:=format('ARRAY(SELECT normalize(btrim(value),NFC) FROM jsonb_array_elements_text(%s->''value''))',bound);
   predicate:=CASE WHEN kind='set' THEN format('%s && %s',expr,lit)
    WHEN kind='identifier' THEN format('lower(normalize(%s,NFC)) = ANY(ARRAY(SELECT lower(x) FROM unnest(%s) x))',expr,lit)
    ELSE format('%s = ANY(%s)',expr,lit) END;
  ELSE
   IF kind='number' THEN
    IF jsonb_typeof(f->'value') IS DISTINCT FROM 'number' OR abs((f->>'value')::numeric)>9007199254740991
     OR (op='between' AND (jsonb_typeof(f->'to') IS DISTINCT FROM 'number' OR abs((f->>'to')::numeric)>9007199254740991)) THEN RAISE EXCEPTION 'invalid_column_filter_number' USING ERRCODE='22023'; END IF;
    lit:=format('(%s->>''value'')::numeric',bound); upper_lit:=format('(%s->>''to'')::numeric',bound);
    IF op='between' AND (f->>'value')::numeric>(f->>'to')::numeric THEN RAISE EXCEPTION 'invalid_column_filter_range' USING ERRCODE='22023'; END IF;
   ELSE
    IF jsonb_typeof(f->'value') IS DISTINCT FROM 'string' OR length(f->>'value')>1000 OR btrim(f->>'value')='' THEN RAISE EXCEPTION 'invalid_column_filter_value' USING ERRCODE='22023'; END IF;
    lit:=format('normalize(btrim(%s->>''value''),NFC)',bound);
    IF kind='date' THEN
     IF (f->>'value') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' OR
      (op='between' AND (jsonb_typeof(f->'to') IS DISTINCT FROM 'string' OR (f->>'to') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$')) THEN RAISE EXCEPTION 'invalid_column_filter_date' USING ERRCODE='22023'; END IF;
     PERFORM (f->>'value')::timestamptz;
     lit:=format('(%s->>''value'')::timestamptz',bound); upper_lit:=format('(%s->>''to'')::timestamptz',bound);
     IF op='between' AND (f->>'value')::timestamptz >= (f->>'to')::timestamptz THEN RAISE EXCEPTION 'invalid_column_filter_range' USING ERRCODE='22023'; END IF;
    ELSE
     expr:=format('lower(normalize(%s,NFC))',expr); lit:=format('lower(%s)',lit);
    END IF;
   END IF;
   IF op IN ('contains','not_contains','starts_with') THEN
    -- strpos makes percent/underscore/backslash literal without putting values in SQL.
    predicate:=format('strpos(%s,%s) %s',expr,lit,CASE op WHEN 'starts_with' THEN '= 1' WHEN 'not_contains' THEN '= 0' ELSE '> 0' END);
   ELSIF op='between' THEN
    predicate:=format('(%s >= %s AND %s %s %s)',expr,lit,expr,CASE WHEN kind='date' THEN '<' ELSE '<=' END,upper_lit);
   ELSE
    predicate:=format('%s %s %s',expr,CASE op WHEN 'eq' THEN '=' WHEN 'neq' THEN '<>' WHEN 'gt' THEN '>' WHEN 'gte' THEN '>=' WHEN 'lt' THEN '<' WHEN 'lte' THEN '<=' END,lit);
   END IF;
  END IF;
  result:=result||' AND ('||predicate||')';
 END LOOP;
 RETURN result;
END $fn$;
REVOKE ALL ON FUNCTION private.column_filter_predicate_v1(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
