-- V478 (08/11/2026): Nguyên tắc bổ sung cho AI điền form chiến dịch — cột ai_form_configs.nguyen_tac_bo_sung.
-- Người dùng chốt 08/11: mỗi phần của form chiến dịch có một ô "Nguyên tắc bổ sung" (kiến thức vận hành), chỉ admin akaBiz
-- (org_staff.is_admin_akabiz) xem và sửa ở Web (menu Cài đặt admin akaBiz → Nguyên tắc cài đặt chiến dịch).
-- API Web nối nội dung cột vào sau prompt_system khi gọi AI của phần đó; cột NULL thì request giống hệt trước.
-- Desktop chưa đọc cột này (làm ở bản phát hành sau). Không ghi sẵn nguyên tắc nào: cả 12 dòng để NULL.
-- ADD COLUMN không DEFAULT chỉ đổi metadata; bảng 12 dòng, khoảng 8 lượt AI form/ngày. lock_timeout 3 giây.
-- DDL làm PostgREST nạp lại schema → apply ngoài giờ cao điểm.
-- Desktop có SELECT cấp bảng nên select('*') của bản cũ vẫn chạy (mapper chỉ lấy trường đã biết); proxy AI Desktop chỉ so
-- id/code/model_id của dòng, không so updated_at hay prompt.
-- Từ migration này: guard md5 cả dòng ai_form_configs ở migration sau phải bỏ 'nguyen_tac_bo_sung' và 'updated_at'
-- (admin lưu nguyên tắc làm đổi cả hai; trigger ai_form_configs_validate đặt lại updated_at ở mỗi lần ghi).
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $v478_preflight$
DECLARE
  v_count integer;
  v_fp text;
BEGIN
  IF to_regclass('public.ai_form_configs') IS NULL THEN
    RAISE EXCEPTION 'v478: public.ai_form_configs missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
             WHERE attrelid = 'public.ai_form_configs'::regclass AND attname = 'nguyen_tac_bo_sung' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v478: already applied (ai_form_configs.nguyen_tac_bo_sung exists)';
  END IF;
  IF has_table_privilege('aka_agent_desktop', 'public.ai_form_configs', 'UPDATE')
     OR has_table_privilege('aka_agent_desktop', 'public.ai_form_configs', 'INSERT') THEN
    RAISE EXCEPTION 'v478: aka_agent_desktop can write ai_form_configs; the new column would be writable from Desktop';
  END IF;
  IF NOT has_table_privilege('aka_agent_desktop', 'public.ai_form_configs', 'SELECT') THEN
    RAISE EXCEPTION 'v478: aka_agent_desktop has no table-level SELECT; Desktop select(*) would fail on the new column';
  END IF;
  -- Bản chụp 12 dòng đọc trên akachat lúc viết migration (cả dòng, gồm updated_at).
  SELECT count(*), md5(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id))
    INTO v_count, v_fp
    FROM public.ai_form_configs c;
  IF v_count <> 12 OR v_fp IS DISTINCT FROM 'b4370e771a565a4f74073344affcb94d' THEN
    RAISE EXCEPTION 'v478: ai_form_configs drifted (rows %, md5 %); re-read live rows and update the guard', v_count, v_fp;
  END IF;
END
$v478_preflight$;

ALTER TABLE public.ai_form_configs
  ADD COLUMN nguyen_tac_bo_sung text
  CONSTRAINT ai_form_configs_nguyen_tac_bo_sung_check
    CHECK (nguyen_tac_bo_sung IS NULL OR char_length(nguyen_tac_bo_sung) <= 8000);

COMMENT ON COLUMN public.ai_form_configs.nguyen_tac_bo_sung IS
  'Nguyên tắc bổ sung (V478): kiến thức vận hành cho AI của phần form này. Chỉ admin akaBiz (org_staff.is_admin_akabiz) sửa ở Web, Cài đặt admin akaBiz. API Web nối vào sau prompt_system khi gọi AI; NULL = không có. Guard md5 cả dòng ở migration sau phải bỏ cột này và updated_at.';

DO $v478_postflight$
DECLARE
  v_count integer;
  v_fp text;
  v_nonnull integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = 'public.ai_form_configs'::regclass AND a.attname = 'nguyen_tac_bo_sung'
                   AND NOT a.attisdropped AND NOT a.attnotnull AND NOT a.atthasdef AND a.atttypid = 'text'::regtype) THEN
    RAISE EXCEPTION 'v478: column shape mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.ai_form_configs'::regclass
                   AND conname = 'ai_form_configs_nguyen_tac_bo_sung_check' AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION 'v478: check constraint missing';
  END IF;
  -- Cột cũ của 12 dòng (kể cả updated_at) giữ nguyên; cột mới NULL ở mọi dòng.
  SELECT count(*), md5(string_agg((to_jsonb(c) - 'nguyen_tac_bo_sung')::text, '|' ORDER BY c.id)), count(c.nguyen_tac_bo_sung)
    INTO v_count, v_fp, v_nonnull
    FROM public.ai_form_configs c;
  IF v_count <> 12 OR v_fp IS DISTINCT FROM 'b4370e771a565a4f74073344affcb94d' OR v_nonnull <> 0 THEN
    RAISE EXCEPTION 'v478: existing rows changed (rows %, md5 %, non-null %)', v_count, v_fp, v_nonnull;
  END IF;
  IF NOT has_column_privilege('aka_agent_desktop', 'public.ai_form_configs', 'nguyen_tac_bo_sung', 'SELECT')
     OR has_column_privilege('aka_agent_desktop', 'public.ai_form_configs', 'nguyen_tac_bo_sung', 'UPDATE') THEN
    RAISE EXCEPTION 'v478: unexpected aka_agent_desktop privileges on nguyen_tac_bo_sung';
  END IF;
  IF has_table_privilege('anon', 'public.ai_form_configs', 'SELECT')
     OR has_table_privilege('authenticated', 'public.ai_form_configs', 'SELECT') THEN
    RAISE EXCEPTION 'v478: anon/authenticated must not read ai_form_configs';
  END IF;
END
$v478_postflight$;

COMMIT;
