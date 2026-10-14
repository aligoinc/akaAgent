CREATE OR REPLACE FUNCTION private.aka_agent_capture_table_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  v_new jsonb;
  v_old jsonb;
  v_pk jsonb := '{}'::jsonb;
  v_column text;
BEGIN
  -- No schema is stored. Restrict registration to public tables; in particular,
  -- the private log cannot log itself. No catalog query is needed per row.
  IF TG_TABLE_SCHEMA <> 'public' OR TG_WHEN <> 'AFTER' OR TG_LEVEL <> 'ROW'
     OR TG_OP NOT IN ('INSERT','UPDATE') OR TG_NARGS=0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid table log trigger configuration';
  END IF;
  v_new := to_jsonb(NEW);
  IF TG_OP='UPDATE' THEN
    v_old := to_jsonb(OLD);
  END IF;
  FOREACH v_column IN ARRAY TG_ARGV LOOP
    IF v_column IS NULL OR NOT (v_new ? v_column) OR v_new->v_column='null'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid table log primary key column';
    END IF;
    v_pk := v_pk || jsonb_build_object(v_column,v_new->v_column);
  END LOOP;
  INSERT INTO private.auto_table_logs(table_name,record_pk,operation,old_data,new_data)
    VALUES (TG_TABLE_NAME,v_pk,TG_OP,v_old,v_new);
  RETURN NULL; -- ignored for AFTER ROW triggers
EXCEPTION WHEN OTHERS THEN
  -- Do not include SQLERRM/DETAIL/row values (they can contain credentials).
  -- Cancellation/assertion failures remain PostgreSQL errors; no retry/queue.
  RAISE WARNING 'auto_table_logs: capture skipped (SQLSTATE %)', SQLSTATE;
  RETURN NULL;
END;
$function$
;
