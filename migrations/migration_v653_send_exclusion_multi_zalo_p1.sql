-- V653 p1: nhóm loại trừ gửi theo nhiều Zalo (bảng khối theo Zalo, cột phiên bản, điền sẵn khối cho nhóm cũ).
-- Phương án: docs/CAMPAIGN_SEND_EXCLUSION_MULTI_ZALO_PLAN.md. Chạy trước p2 (hàm). Chỉ mục zalo_users dựng riêng:
-- migration_v653_send_exclusion_multi_zalo_index.sql (CREATE INDEX CONCURRENTLY, một lệnh).
--
-- Đổi:
--   * Bảng mới auto_campaign_send_exclusion_group_accounts: mỗi dòng là một khối điều kiện của một Zalo trong nhóm
--     (match_mode riêng). Chỉ hàm SECURITY DEFINER đọc/ghi; không cấp quyền bảng cho vai trò nào.
--   * auto_campaign_send_exclusion_rules.group_account_id (NOT NULL, FK tới khối, cùng nhóm). "Mỗi trường một lần" đổi từ
--     theo nhóm sang theo khối.
--   * auto_campaign_send_exclusion_groups.version: 1 = một khối (app cũ dùng được), 2 = từ hai khối. account_id giữ là
--     Zalo của khối đầu để app cũ đọc không lỗi.
--   * Điền sẵn: mỗi nhóm hiện có một khối (account_id, match_mode của nhóm); mọi điều kiện gắn vào khối đó.
--   * Trigger điền group_account_id khi ghi điều kiện không kèm khối (đường lưu cũ): khối của group.account_id.
--   * Dòng cài đặt campaign.send_exclusion_multi_zalo = {"audience":"off"} (form chỉ hiện phần mới khi bật).
-- ALTER TABLE trên hai bảng nhỏ (102 nhóm, 187 điều kiện lúc viết 25/11/2026): khoá ngắn, nhưng làm PostgREST nạp lại schema,
-- apply ngoài giờ cao điểm. Gỡ: rollback_v653_send_exclusion_multi_zalo.sql (sau khi gỡ p2).

BEGIN;
SET LOCAL lock_timeout = '3s';
DO $ledger$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v653_%p1%') THEN
      RAISE EXCEPTION 'V653 p1: sổ migration đã có bản p1, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('public.auto_campaign_send_exclusion_group_accounts') IS NOT NULL THEN
    RAISE EXCEPTION 'V653 p1: bảng auto_campaign_send_exclusion_group_accounts đã có';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name IN ('auto_campaign_send_exclusion_rules', 'auto_campaign_send_exclusion_groups')
      AND column_name IN ('group_account_id', 'version')) THEN
    RAISE EXCEPTION 'V653 p1: cột group_account_id/version đã có';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auto_campaign_send_exclusion_rules_group_id_field_id_key') THEN
    RAISE EXCEPTION 'V653 p1: thiếu ràng buộc auto_campaign_send_exclusion_rules_group_id_field_id_key';
  END IF;
END $ledger$;

CREATE TABLE public.auto_campaign_send_exclusion_group_accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id bigint NOT NULL REFERENCES public.auto_campaign_send_exclusion_groups(id) ON DELETE CASCADE,
  account_id bigint NOT NULL REFERENCES public.auto_accounts(id),
  match_mode text NOT NULL CHECK (match_mode IN ('and', 'or')),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_send_exclusion_group_accounts_unique UNIQUE (group_id, account_id),
  CONSTRAINT auto_send_exclusion_group_accounts_id_group UNIQUE (id, group_id)
);
ALTER TABLE public.auto_campaign_send_exclusion_group_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_campaign_send_exclusion_group_accounts FROM PUBLIC;
DO $revoke$
DECLARE v_role text;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_desktop', 'aka_agent_chat_api'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.auto_campaign_send_exclusion_group_accounts FROM %I', v_role);
    END IF;
  END LOOP;
END $revoke$;

ALTER TABLE public.auto_campaign_send_exclusion_groups
  ADD COLUMN version smallint NOT NULL DEFAULT 1 CONSTRAINT auto_send_exclusion_groups_version_check CHECK (version IN (1, 2));
ALTER TABLE public.auto_campaign_send_exclusion_rules ADD COLUMN group_account_id bigint;

INSERT INTO public.auto_campaign_send_exclusion_group_accounts (group_id, account_id, match_mode, sort_order, created_at)
SELECT g.id, g.account_id, g.match_mode, 0, g.created_at FROM public.auto_campaign_send_exclusion_groups g ORDER BY g.id;
UPDATE public.auto_campaign_send_exclusion_rules r SET group_account_id = ga.id
  FROM public.auto_campaign_send_exclusion_group_accounts ga WHERE ga.group_id = r.group_id;

CREATE FUNCTION public.auto_fill_send_exclusion_rule_block()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 -- Đường lưu nhóm một khối (hàm cũ) không biết khối: gắn vào khối của Zalo chính của nhóm.
 IF NEW.group_account_id IS NULL THEN
  SELECT ga.id INTO NEW.group_account_id FROM public.auto_campaign_send_exclusion_group_accounts ga
   JOIN public.auto_campaign_send_exclusion_groups g ON g.id = ga.group_id AND g.account_id = ga.account_id
   WHERE ga.group_id = NEW.group_id;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.auto_fill_send_exclusion_rule_block() FROM PUBLIC;
CREATE TRIGGER auto_fill_send_exclusion_rule_block BEFORE INSERT ON public.auto_campaign_send_exclusion_rules
  FOR EACH ROW EXECUTE FUNCTION public.auto_fill_send_exclusion_rule_block();

ALTER TABLE public.auto_campaign_send_exclusion_rules ALTER COLUMN group_account_id SET NOT NULL;
ALTER TABLE public.auto_campaign_send_exclusion_rules
  ADD CONSTRAINT auto_send_exclusion_rules_block_fkey FOREIGN KEY (group_account_id, group_id)
    REFERENCES public.auto_campaign_send_exclusion_group_accounts (id, group_id) ON DELETE CASCADE,
  DROP CONSTRAINT auto_campaign_send_exclusion_rules_group_id_field_id_key,
  ADD CONSTRAINT auto_send_exclusion_rules_block_field_key UNIQUE (group_account_id, field_id);
CREATE INDEX auto_send_exclusion_rules_group ON public.auto_campaign_send_exclusion_rules (group_id);

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
SELECT 'campaign.send_exclusion_multi_zalo', '{"audience":"off"}',
  'V653: hiện phần loại trừ gửi theo nhiều Zalo, Nhóm data và chiến dịch đã gửi trong form (off | admin_akabiz | all). Chỉ ẩn/hiện form; cấu hình đã lưu vẫn chạy.',
  false, true
WHERE NOT EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'campaign.send_exclusion_multi_zalo');

DO $post$
DECLARE v_groups bigint; v_blocks bigint; v_rules_missing bigint;
BEGIN
  SELECT count(*) INTO v_groups FROM public.auto_campaign_send_exclusion_groups;
  SELECT count(*) INTO v_blocks FROM public.auto_campaign_send_exclusion_group_accounts;
  SELECT count(*) INTO v_rules_missing FROM public.auto_campaign_send_exclusion_rules WHERE group_account_id IS NULL;
  IF v_groups <> v_blocks OR v_rules_missing <> 0 THEN
    RAISE EXCEPTION 'V653 p1 postflight: % nhóm, % khối, % điều kiện chưa gắn khối', v_groups, v_blocks, v_rules_missing;
  END IF;
END $post$;
COMMIT;
