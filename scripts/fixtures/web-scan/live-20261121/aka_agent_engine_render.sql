CREATE OR REPLACE FUNCTION public.aka_agent_engine_render(p_template text, p_vars jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT nullif(btrim(
    replace(replace(replace(replace(replace(replace(replace(replace(replace(coalesce(p_template, ''),
      '{name}', coalesce(p_vars->>'name', '')),
      '{code}', coalesce(p_vars->>'code', '')),
      '{until}', coalesce(p_vars->>'until', '')),
      '{action}', coalesce(p_vars->>'action', '')),
      '{message}', coalesce(p_vars->>'message', '')),
      '[x]', coalesce(p_vars->>'x', p_vars->>'message', '')),
      '[t]', coalesce(p_vars->>'t', p_vars->>'until', '')),
      '[action]', coalesce(p_vars->>'action', '')),
      '[a]', coalesce(p_vars->>'action', ''))
  ), '')
$function$
