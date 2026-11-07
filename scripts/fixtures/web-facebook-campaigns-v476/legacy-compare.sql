-- So caller cũ với bản chụp trước V476: phải giống hệt từng lời gọi.
DO $c$
DECLARE bad text; n integer;
BEGIN
  SELECT count(*), string_agg(coalesce(x.name, y.name), ', ' ORDER BY coalesce(x.name, y.name))
    FILTER (WHERE x.payload IS DISTINCT FROM y.payload)
  INTO n, bad
  FROM v476_test.legacy_results() x FULL JOIN v476_test.captured y ON y.name = x.name;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'v476_legacy_changed: %', bad; END IF;
  RAISE NOTICE 'v476 legacy compare: % calls identical', n;
END
$c$;
