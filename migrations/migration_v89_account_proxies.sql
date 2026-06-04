-- ============================================================
-- Migration v89: Account proxies
-- - Staff-scoped proxy inventory shared by accounts.
-- - Accounts can choose one proxy; many accounts may share a proxy.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_proxies (
  id BIGSERIAL PRIMARY KEY,
  name text NOT NULL,
  protocol text NOT NULL DEFAULT 'http',
  host text NOT NULL,
  port integer NOT NULL,
  username text,
  password text,
  staff_id bigint NOT NULL REFERENCES public.org_staff(id) ON DELETE CASCADE,
  organization_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  is_delete boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_proxies_protocol_check CHECK (protocol IN ('http', 'https', 'socks5')),
  CONSTRAINT auto_proxies_port_check CHECK (port >= 1 AND port <= 65535)
);

CREATE UNIQUE INDEX IF NOT EXISTS auto_proxies_staff_name_unique
  ON public.auto_proxies(staff_id, lower(name))
  WHERE is_delete = false;

CREATE INDEX IF NOT EXISTS idx_auto_proxies_staff
  ON public.auto_proxies(staff_id)
  WHERE is_delete = false;

ALTER TABLE public.auto_accounts
  ADD COLUMN IF NOT EXISTS proxy_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auto_accounts_proxy_id_fkey'
  ) THEN
    ALTER TABLE public.auto_accounts
      ADD CONSTRAINT auto_accounts_proxy_id_fkey
      FOREIGN KEY (proxy_id)
      REFERENCES public.auto_proxies(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auto_accounts_proxy_id
  ON public.auto_accounts(proxy_id)
  WHERE is_delete = false;

CREATE OR REPLACE FUNCTION public.prevent_delete_proxy_with_accounts()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.is_delete = false AND NEW.is_delete = true) THEN
    IF EXISTS (
      SELECT 1
      FROM public.auto_accounts a
      WHERE a.proxy_id = OLD.id
        AND a.is_delete = false
    ) THEN
      RAISE EXCEPTION 'Không thể xoá proxy khi còn tài khoản đang dùng proxy này';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_delete_proxy_with_accounts ON public.auto_proxies;
CREATE TRIGGER trg_prevent_delete_proxy_with_accounts
  BEFORE DELETE OR UPDATE OF is_delete ON public.auto_proxies
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_delete_proxy_with_accounts();

NOTIFY pgrst, 'reload schema';

COMMIT;
