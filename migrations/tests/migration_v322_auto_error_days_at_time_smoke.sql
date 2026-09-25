-- Run inside a rollback transaction, after v322. Explicit negative IDs avoid sequence changes.
DO $smoke$
DECLARE item jsonb; rejected boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.auto_error WHERE id=-322) THEN
    RAISE EXCEPTION 'v322 smoke fixture ID is occupied';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements('[
    {"days":null,"time":"09:45","minutes":1440},
    {"days":-1,"time":"09:45","minutes":1440},
    {"days":1,"time":"09:45","minutes":null},
    {"days":1,"time":"09:45","minutes":0},
    {"days":1,"time":"09:45","minutes":-1},
    {"days":1,"time":"24:00","minutes":1440},
    {"days":0,"time":null,"minutes":1440},
    {"days":1,"time":"09:60","minutes":1440},
    {"days":1.5,"time":"09:45","minutes":1440}
  ]'::jsonb) LOOP
    rejected := false;
    BEGIN
      INSERT INTO public.auto_error(id,error_type,error_code,error_name,disable_action_mode,
        disable_action_days,disable_action_time,time_disable_actions)
      VALUES (-322,'external zalo','__v322_smoke__','smoke','days_at_time',
        (item->>'days')::integer,(item->>'time')::time,(item->>'minutes')::integer);
    EXCEPTION WHEN check_violation OR invalid_text_representation OR datetime_field_overflow THEN
      rejected := true;
    END;
    IF NOT rejected THEN RAISE EXCEPTION 'v322 accepted invalid configuration: %',item; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements('[
    {"days":1,"time":"09:45","minutes":1440},
    {"days":2,"time":"09:45","minutes":2880},
    {"days":1,"time":null,"minutes":1440},
    {"days":1,"time":"00:00","minutes":1440},
    {"days":0,"time":"09:45","minutes":1440}
  ]'::jsonb) LOOP
    INSERT INTO public.auto_error(id,error_type,error_code,error_name,disable_action_mode,
      disable_action_days,disable_action_time,time_disable_actions)
    VALUES (-322,'external zalo','__v322_smoke__','smoke','days_at_time',
      (item->>'days')::integer,(item->>'time')::time,(item->>'minutes')::integer);
    DELETE FROM public.auto_error WHERE id=-322;
  END LOOP;
END $smoke$;
SELECT 'v322 constraints verified' AS result;
