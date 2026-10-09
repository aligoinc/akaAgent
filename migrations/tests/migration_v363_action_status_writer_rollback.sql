-- Retain this file and the apply/rollback history. No historical recalculation.
BEGIN; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='2s';
-- An empty new-column partial index must not fall back to a historical heap scan.
SET LOCAL enable_seqscan=off;
LOCK TABLE public.auto_account_action_status_policies IN SHARE ROW EXCLUSIVE MODE NOWAIT;
LOCK TABLE public.auto_campaign_details IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $guard$ BEGIN
IF to_regprocedure('public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)')))<>'b4be76b63cd90ef5f4d7bdd93a22b288' THEN RAISE EXCEPTION 'migration_v363_action_status_writer target drift: aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb)'; END IF;
IF to_regprocedure('public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)')))<>'b2079cdddae3b165f409b3c42bbac834' THEN RAISE EXCEPTION 'migration_v363_action_status_writer target drift: aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text)'; END IF;
IF to_regprocedure('public.aka_agent_guard_result_policy_identity_v363()') IS NULL OR md5(pg_get_functiondef(to_regprocedure('public.aka_agent_guard_result_policy_identity_v363()')))<>'5e3da51a01b8ba546f3ed5d2852441d6' THEN RAISE EXCEPTION 'migration_v363_action_status_writer target drift: aka_agent_guard_result_policy_identity_v363()'; END IF;
IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.auto_campaign_details'::regclass AND tgname='auto_detail_action_identity_guard') IS DISTINCT FROM 'CREATE TRIGGER auto_detail_action_identity_guard BEFORE UPDATE OF action_code ON public.auto_campaign_details FOR EACH ROW EXECUTE FUNCTION aka_agent_guard_detail_result_v361()' THEN RAISE EXCEPTION 'rollback trigger drift: auto_detail_action_identity_guard'; END IF;
IF (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid='public.auto_account_action_status_policies'::regclass AND tgname='auto_aasp_identity_guard') IS DISTINCT FROM 'CREATE TRIGGER auto_aasp_identity_guard BEFORE UPDATE OF action_code, status_id ON public.auto_account_action_status_policies FOR EACH ROW EXECUTE FUNCTION aka_agent_guard_result_policy_identity_v363()' THEN RAISE EXCEPTION 'rollback trigger drift: auto_aasp_identity_guard'; END IF;
IF EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE status_id IS NOT NULL) OR EXISTS(SELECT 1 FROM public.auto_campaign_details WHERE result_key IS NOT NULL) THEN RAISE EXCEPTION 'result catalog already used; retain readers/schema and rollback future runtime only'; END IF;
END $guard$;
DO $rows$ BEGIN
IF NOT EXISTS(SELECT 1 FROM public.auto_account_action_status_policies p WHERE p.id=10 AND md5(to_jsonb(p)::text)='05e6beeb3ff982b5fdf815589648bbdf') THEN RAISE EXCEPTION 'v363 owned row edited: 10'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.auto_account_action_status_policies p WHERE p.id=26 AND md5(to_jsonb(p)::text)='dd35bcfefcb70fb653ac871a2039b3bf') THEN RAISE EXCEPTION 'v363 owned row edited: 26'; END IF;
IF NOT EXISTS(SELECT 1 FROM public.auto_account_action_status_policies p WHERE p.id=27 AND md5(to_jsonb(p)::text)='9cd2e296727391bae1e4b226a5383992') THEN RAISE EXCEPTION 'v363 owned row edited: 27'; END IF;
END $rows$;
DROP TRIGGER auto_aasp_identity_guard ON public.auto_account_action_status_policies;
DROP TRIGGER auto_detail_action_identity_guard ON public.auto_campaign_details;
DROP FUNCTION public.aka_agent_write_action_result_v1(bigint,bigint,bigint,uuid,uuid,text,jsonb);
DROP FUNCTION public.aka_agent_settle_action_results_v1(bigint,bigint,bigint,uuid,uuid,bigint,bigint[],jsonb,text);
DROP FUNCTION public.aka_agent_guard_result_policy_identity_v363();
UPDATE public.auto_account_action_status_policies p SET action_code=original.action_code,bad_target_effect=original.bad_target_effect,counts_toward_limit=original.counts_toward_limit,created_at=original.created_at,description=original.description,input_effect=original.input_effect,is_active=original.is_active,is_delete=original.is_delete,report_group=original.report_group,reset_error_streak=original.reset_error_streak,status_id=original.status_id,updated_at=original.updated_at FROM jsonb_populate_record(NULL::public.auto_account_action_status_policies,$original_policy${"action_code":"fb_group_invite","bad_target_effect":"ignore","counts_toward_limit":false,"created_at":"2026-10-09T10:23:33.056576+00:00","description":"Không tìm thấy đối tượng để mời nhóm Facebook được báo cáo bỏ qua theo report hiện tại.","id":10,"input_effect":"complete","is_active":true,"is_delete":false,"report_group":"skipped","reset_error_streak":false,"status_id":36,"updated_at":"2026-10-09T10:23:33.056576+00:00"}$original_policy$::jsonb) original WHERE p.id=10;
DELETE FROM public.auto_account_action_status_policies WHERE id=26;
DELETE FROM public.auto_account_action_status_policies WHERE id=27;

COMMIT;
