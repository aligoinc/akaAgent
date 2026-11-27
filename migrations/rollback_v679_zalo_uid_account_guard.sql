-- Gỡ V679. Người nhận đang giữ vì DAT04 ("tạm dừng", ghi chú kết thúc bằng "(DAT04)") giữ nguyên trạng thái:
-- sau khi gỡ không gì tự trả họ về hàng đợi; muốn chạy họ thì sửa tay (UPDATE ... status = 'chờ xử lý', note = NULL).
BEGIN;
SET LOCAL lock_timeout = '3s';
DROP TRIGGER IF EXISTS trg_aka_agent_uid_account_release ON public.auto_campaigns;
DROP FUNCTION IF EXISTS private.aka_agent_uid_account_release();
DROP FUNCTION IF EXISTS public.aka_agent_control_campaign_uid_account_check(bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS public.aka_agent_campaign_uid_account_check_v1(jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_uid_account_dispatch(bigint, bigint, jsonb);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_uid_account_guard_mode();
DROP FUNCTION IF EXISTS private.aka_agent_campaign_uid_account_hold(bigint, bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_uid_account_check_campaign(bigint, bigint, bigint, bigint);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_uid_account_check(bigint, bigint, bigint[], text[]);
DROP FUNCTION IF EXISTS private.aka_agent_campaign_uid_account_classify(bigint, bigint, bigint, text[]);
DROP FUNCTION IF EXISTS private.aka_agent_uid_guard_norm(text);
DROP FUNCTION IF EXISTS private.aka_agent_uid_guard_action(text);
UPDATE public.auto_outcome_policies
   SET target_effect = 'complete',
       log_template = 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được',
       campaign_note_template = 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được',
       description = regexp_replace(description, ' \[V679\].*$', ''),
       revision = revision + 1, updated_by = 'rollback_v679', updated_at = now()
 WHERE id = 426;
UPDATE public.auto_error
   SET customer_title = 'UID được quét bằng tài khoản Zalo khác nên tài khoản này không gửi được',
       customer_help = 'Dùng tài khoản đã quét danh sách để chạy, hoặc quét lại bằng tài khoản này.',
       updated_at = now()
 WHERE id = 172;
DELETE FROM public.auto_system_settings WHERE key = 'campaign.uid_account_guard';
COMMIT;
