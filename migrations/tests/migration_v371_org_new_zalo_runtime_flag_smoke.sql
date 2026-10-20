-- Run inside a transaction that ends with ROLLBACK. No real org/customer writes,
-- sequence allocations, order synchronization, messages or network operations.
DO $catalog$
DECLARE
  v_column record;
  v_trigger record;
BEGIN
  SELECT a.*, pg_get_expr(d.adbin,d.adrelid) AS default_expression INTO v_column
  FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid='public.org_organization'::regclass AND a.attname='use_new_zalo_runtime' AND NOT a.attisdropped;
  IF NOT FOUND OR v_column.atttypid <> 'boolean'::regtype OR NOT v_column.attnotnull
     OR v_column.default_expression <> 'true' THEN
    RAISE EXCEPTION 'v371 invalid live column type/default/nullability';
  END IF;
  SELECT * INTO v_trigger FROM pg_trigger
  WHERE tgrelid='public.org_organization'::regclass AND tgname='trg_use_new_zalo_runtime_on_insert';
  IF NOT FOUND OR v_trigger.tgtype <> 7 OR v_trigger.tgenabled <> 'O'
     OR v_trigger.tgfoid <> 'private.aka_agent_org_default_new_zalo_runtime()'::regprocedure
     OR v_trigger.tgqual IS NOT NULL THEN
    RAISE EXCEPTION 'v371 expected unconditional BEFORE INSERT ROW trigger';
  END IF;
END;
$catalog$;

CREATE TEMP TABLE v371_org_fixture (
  id bigint PRIMARY KEY,
  label text,
  demo_created_by bigint,
  first_sale_by bigint,
  demo_created_at timestamptz,
  first_sale_at timestamptz
) ON COMMIT DROP;
INSERT INTO v371_org_fixture(id,label) VALUES (1,'legacy');
ALTER TABLE v371_org_fixture ADD COLUMN use_new_zalo_runtime boolean NOT NULL DEFAULT false;
ALTER TABLE v371_org_fixture ALTER COLUMN use_new_zalo_runtime SET DEFAULT true;

-- Use the actual unchanged live INSERT attribution function alongside the new
-- function, in the same alphabetical order as the real table.
CREATE TRIGGER trg_protect_org_lifecycle_attribution BEFORE INSERT OR UPDATE ON v371_org_fixture
  FOR EACH ROW EXECUTE FUNCTION private.protect_org_lifecycle_attribution();
CREATE TRIGGER trg_use_new_zalo_runtime_on_insert BEFORE INSERT ON v371_org_fixture
  FOR EACH ROW EXECUTE FUNCTION private.aka_agent_org_default_new_zalo_runtime();
GRANT SELECT, INSERT, UPDATE ON v371_org_fixture TO service_role;

-- Real SQL role switch verifies trigger execution without granting direct
-- EXECUTE on the private function to the application role.
SET LOCAL ROLE service_role;
INSERT INTO v371_org_fixture(id,label) VALUES (2,'omitted');
INSERT INTO v371_org_fixture(id,label,use_new_zalo_runtime) VALUES
  (3,'default',DEFAULT), (4,'true',true), (5,'false',false), (6,'null',null);
INSERT INTO v371_org_fixture(id,label,use_new_zalo_runtime)
  SELECT 7,'insert-select',false;
INSERT INTO v371_org_fixture(id,label,use_new_zalo_runtime,demo_created_by,demo_created_at)
  VALUES (8,'attribution',false,123,now());
UPDATE v371_org_fixture SET label='legacy updated' WHERE id=1;
INSERT INTO v371_org_fixture(id,label,use_new_zalo_runtime) VALUES (1,'ignored',false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO v371_org_fixture(id,label) VALUES (1,'legacy upsert')
  ON CONFLICT (id) DO UPDATE SET label=excluded.label;
DO $behavior$
BEGIN
  IF (SELECT count(*) FROM v371_org_fixture) <> 8
     OR (SELECT use_new_zalo_runtime FROM v371_org_fixture WHERE id=1) IS DISTINCT FROM false
     OR EXISTS (SELECT 1 FROM v371_org_fixture WHERE id>1 AND use_new_zalo_runtime IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'v371 existing/new INSERT behavior failed';
  END IF;
  IF EXISTS (SELECT 1 FROM v371_org_fixture WHERE demo_created_by IS NOT NULL OR demo_created_at IS NOT NULL) THEN
    RAISE EXCEPTION 'v371 live attribution INSERT guard changed';
  END IF;
  UPDATE v371_org_fixture SET use_new_zalo_runtime=false WHERE id=5;
  IF (SELECT use_new_zalo_runtime FROM v371_org_fixture WHERE id=5) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'v371 UPDATE false must remain allowed';
  END IF;
  UPDATE v371_org_fixture SET use_new_zalo_runtime=true WHERE id=1;
  IF (SELECT use_new_zalo_runtime FROM v371_org_fixture WHERE id=1) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'v371 UPDATE true must remain allowed';
  END IF;
  BEGIN
    UPDATE v371_org_fixture SET use_new_zalo_runtime=null WHERE id=1;
    RAISE EXCEPTION 'v371 UPDATE null unexpectedly succeeded';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
END;
$behavior$;
RESET ROLE;
