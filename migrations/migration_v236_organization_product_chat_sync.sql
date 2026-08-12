BEGIN;

ALTER TABLE public.org_organization_product
  ADD COLUMN IF NOT EXISTS is_chat_sync boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.org_organization_product.is_chat_sync IS
  'Cho phép sản phẩm đang còn hiệu lực tham gia đồng bộ Zalo qua akaAgent Chat.';

COMMIT;
