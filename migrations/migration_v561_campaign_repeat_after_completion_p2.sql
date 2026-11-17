-- V561: "Lặp lại sau khi chạy xong" cho chiến dịch lịch Hàng ngày (17/11/2026).
-- SINH TỪ scripts/build-v561-sql.cjs, không sửa tay. Hợp đồng: docs/CAMPAIGN_REPEAT_V561.md; phương án: akaAgentWebApp
-- docs/CAMPAIGN_REPEAT_PLAN.md.
--
-- Chiến dịch chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày (tính từ lúc chạy xong), tới khi đủ số lượt tối đa hoặc tới
-- ngày kết thúc. Cài đặt nằm ở auto_campaigns.extra_settings: repeatAfterCompletionEnabled / Every / Unit / MaxRuns; ngày kết thúc
-- ở schedule_end_date. Chưa chiến dịch nào có các khoá này nên apply xong chưa đổi hành vi của chiến dịch nào.
-- Hai phần, apply đúng thứ tự p1 → p2, mỗi phần một giao dịch và một dòng trong sổ migration:
--   p1: thêm hai cột vào public.auto_campaigns (không tạo bảng mới):
--         repeat_runs_done integer NOT NULL DEFAULT 0   số lượt đã chạy xong, tính cả lượt đầu;
--         repeat_log jsonb                               nhật ký, mỗi lần đếm một dòng (NULL = chưa từng bật lặp).
--       Chỉ có hai lệnh ALTER nên khoá bảng trong chốc lát; lock_timeout 3 giây, không viết lại bảng.
--   p2: hàm private.aka_agent_campaign_repeat_* (luật lặp) và bốn RPC public: sync_v1, decide_v1, state_v1 (service_role +
--       aka_agent_desktop), tick_v1 (service_role);
--       aka_agent_engine_finish_campaign_v2 (thân V558, md5 pg_get_functiondef khoá cứng): thêm nhánh 5b gọi luật lặp trước khi hoàn thành;
--       private.aka_agent_notification_capture_campaign (thân V475, md5 khoá cứng): lượt giữa không báo "hoàn thành";
--       auto_system_settings 'campaign.repeat_after_completion' = {"audience":"admin_akabiz","sweeper":true} (off | admin_akabiz | all;
--       "sweeper": false tắt khẩn bộ quét).
-- ALTER TABLE và CREATE FUNCTION làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.
-- Gỡ: rollback_v561_campaign_repeat_after_completion.sql.
-- PHẦN 2/2: hàm, RPC, nối engine v2, thông báo, công tắc. Chạy sau p1.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v561_%_p2') THEN
      RAISE EXCEPTION 'V561 p2 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname IN ('repeat_runs_done', 'repeat_log')
        AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'V561 p2 cần p1 (hai cột đếm lượt của auto_campaigns)';
  END IF;
  IF to_regprocedure('private.aka_agent_campaign_repeat_state(public.auto_campaigns)') IS NOT NULL THEN RAISE EXCEPTION 'V561 p2: hàm lặp lại đã có'; END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN RAISE EXCEPTION 'V561 cần private.aka_agent_desktop_data_context() (V436)'; END IF;
  IF to_regprocedure('public.aka_agent_engine_finalize_v501(bigint,text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'V561 cần V501'; END IF;
  IF to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)') IS NULL THEN RAISE EXCEPTION 'V561 cần public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)')));
  IF v_md5 IS DISTINCT FROM 'ffccdf1f6d95d6ed877c22abe945ae0b' THEN RAISE EXCEPTION 'V561: định nghĩa aka_agent_engine_finish_campaign_v2 khác bản V558 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('private.aka_agent_notification_capture_campaign()');
  IF v_md5 IS DISTINCT FROM '6e7b852c41ba7565622db56dbb8ec057' THEN RAISE EXCEPTION 'V561: thân hàm ghi thông báo chiến dịch khác V475 (%)', v_md5; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = 'campaign.repeat_after_completion') THEN RAISE EXCEPTION 'V561: dòng công tắc đã có'; END IF;
END $pre$;

CREATE FUNCTION private.aka_agent_campaign_repeat_log_append(p_log jsonb, p_entry jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $f$
-- Thêm một dòng vào nhật ký đếm lượt (auto_campaigns.repeat_log). Giữ tối đa 120 dòng gần nhất và luôn giữ dòng "arm" gần nhất, vì
-- trạng thái vòng lặp hiện tại đọc từ dòng "arm" cuối trở đi. Khoá có giá trị null bị bỏ.
DECLARE
  c_max CONSTANT integer := 120;
  v jsonb := CASE WHEN jsonb_typeof(p_log) = 'array' THEN p_log ELSE '[]'::jsonb END || jsonb_build_array(jsonb_strip_nulls(p_entry));
  n integer := jsonb_array_length(v);
  v_arm integer;
BEGIN
  IF n <= c_max THEN RETURN v; END IF;
  SELECT max(t.ord)::integer INTO v_arm FROM jsonb_array_elements(v) WITH ORDINALITY AS t(value, ord) WHERE t.value->>'type' = 'arm';
  IF v_arm IS NULL OR v_arm > n - c_max THEN
    RETURN (SELECT jsonb_agg(t.value ORDER BY t.ord) FROM jsonb_array_elements(v) WITH ORDINALITY AS t(value, ord) WHERE t.ord > n - c_max);
  END IF;
  RETURN (SELECT jsonb_agg(t.value ORDER BY t.ord) FROM jsonb_array_elements(v) WITH ORDINALITY AS t(value, ord)
           WHERE t.ord = v_arm OR t.ord > n - (c_max - 1));
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_state(c public.auto_campaigns)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $f$
-- Trạng thái vòng lặp hiện tại, đọc từ hai cột của chiến dịch: repeat_runs_done (số lượt đã chạy xong) và repeat_log (nhật ký).
-- Mỗi dòng nhật ký: {type, at, ...}
--   arm   bắt đầu đếm (bật lặp, đổi cài đặt, hoặc chạy lại sau khi đã hết lượt): cfg = {every, unit, maxRuns, endEpoch}, by,
--         since (mốc bắt đầu cũ được giữ khi chỉ mở vòng mới), completedAt (lần hoàn thành có trước lúc bật, không tính).
--   run   chạy xong một lượt: run, max, by (engine | desktop | sweeper), doneAt, next (giờ lượt kế) hoặc final (lý do đây là lượt cuối).
--   end   thôi lặp: reason (max_runs | end_date | no_rerun_data | error), completedAt.
--   error bộ quét không mở lại được: message.
--   skip  bộ quét bỏ qua một lần hoàn thành: reason, completedAt.
--   off   tắt lặp.
-- completedAt ở dòng cuối = auto_campaigns.completed_at mà bộ quét đã xử lý xong.
DECLARE
  e jsonb;
  v_armed boolean := false;
  v_cfg jsonb;
  v_armed_at timestamptz;
  v_done_at timestamptz;
  v_next timestamptz;
  v_finish text;
  v_ended text;
  v_ended_at timestamptz;
  v_handled timestamptz;
  v_errors integer := 0;
BEGIN
  IF c.repeat_log IS NOT NULL AND jsonb_typeof(c.repeat_log) = 'array' THEN
    FOR e IN SELECT t.value FROM jsonb_array_elements(c.repeat_log) WITH ORDINALITY AS t(value, ord) ORDER BY t.ord LOOP
      CASE e->>'type'
        WHEN 'arm' THEN
          v_armed := true; v_cfg := e->'cfg';
          v_armed_at := coalesce((e->>'since')::timestamptz, (e->>'at')::timestamptz);
          v_done_at := NULL; v_next := NULL; v_finish := NULL; v_ended := NULL; v_ended_at := NULL; v_errors := 0;
        WHEN 'off' THEN
          v_armed := false; v_cfg := NULL; v_armed_at := NULL;
          v_done_at := NULL; v_next := NULL; v_finish := NULL; v_ended := NULL; v_ended_at := NULL; v_errors := 0;
        WHEN 'run' THEN
          v_done_at := (e->>'doneAt')::timestamptz; v_next := (e->>'next')::timestamptz; v_finish := e->>'final';
          v_ended := NULL; v_ended_at := NULL; v_errors := 0;
        WHEN 'end' THEN
          v_ended := e->>'reason'; v_ended_at := (e->>'at')::timestamptz; v_finish := NULL; v_next := NULL;
        WHEN 'error' THEN
          v_errors := v_errors + 1;
        ELSE
          NULL;
      END CASE;
      IF e ? 'completedAt' THEN v_handled := (e->>'completedAt')::timestamptz; END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('armed', v_armed, 'cfg', v_cfg, 'armedAt', v_armed_at,
    'runsDone', CASE WHEN v_armed THEN coalesce(c.repeat_runs_done, 0) ELSE 0 END,
    'lastDoneAt', v_done_at, 'nextRunAt', v_next, 'finishing', v_finish IS NOT NULL, 'finishReason', v_finish,
    'endedReason', v_ended, 'endedAt', v_ended_at, 'handledCompletedAt', v_handled, 'errorCount', v_errors);
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_config(c public.auto_campaigns)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Cài đặt lặp hợp lệ của chiến dịch ({every, unit, maxRuns}) hoặc NULL khi không bật / không thuộc phạm vi. Form và API kiểm kỹ hơn
-- (khoảng lặp tối thiểu theo loại, xung đột với "không gửi lặp trong N ngày"); ở đây chỉ giữ các điều kiện mà chạy sai sẽ có hại.
DECLARE
  v_extra jsonb := coalesce(c.extra_settings, '{}'::jsonb);
  v_raw jsonb;
  v_every integer;
  v_max integer;
  v_unit text;
  v_journey boolean;
BEGIN
  IF v_extra->'repeatAfterCompletionEnabled' IS DISTINCT FROM 'true'::jsonb THEN RETURN NULL; END IF;
  IF coalesce(c.is_delete, false) OR coalesce(c.schedule_type, 'daily') <> 'daily'
     OR coalesce(c.data_target_source_mode, '') = 'data_group'
     OR v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb
     OR c.action_id IS NULL
     OR c.action_id IN ('zalo_message_birthday', 'zalo_message_group_realtime', 'zalo_message_friend_recommendation',
                        'zalo_cancel_sent_friend_request', 'sms_send', 'voice_call') THEN
    RETURN NULL;
  END IF;
  v_unit := CASE WHEN jsonb_typeof(v_extra->'repeatAfterCompletionUnit') = 'string' THEN v_extra->>'repeatAfterCompletionUnit' END;
  v_raw := v_extra->'repeatAfterCompletionEvery';
  v_every := CASE
    WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\d{1,5}$' THEN (v_raw #>> '{}')::integer
    WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\d{1,5}$' THEN btrim(v_raw #>> '{}')::integer END;
  v_raw := v_extra->'repeatAfterCompletionMaxRuns';
  v_max := CASE
    WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\d{1,5}$' THEN (v_raw #>> '{}')::integer
    WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\d{1,5}$' THEN btrim(v_raw #>> '{}')::integer END;
  IF v_every IS NULL OR v_max IS NULL OR v_max NOT BETWEEN 2 AND 100 THEN RETURN NULL; END IF;
  IF v_unit = 'minute' THEN
    -- Phút chỉ dành cho nhắn bạn bè / nhắn group đang gửi dạng chia sẻ (gộp từ "Gửi lặp lại sau mỗi x phút") và bốn loại Facebook
    -- trước đây dùng "Chạy lại sau mỗi x giờ" (tìm data theo group, theo search, comment seeding, lướt newsfeed).
    IF v_every NOT BETWEEN 5 AND 1439 THEN RETURN NULL; END IF;
    IF NOT (c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction')
            OR (c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND coalesce(v_extra->>'zaloMessageSendMode', '') = 'share')) THEN
      RETURN NULL;
    END IF;
  ELSIF v_unit = 'hour' THEN
    IF v_every NOT BETWEEN 1 AND 168 THEN RETURN NULL; END IF;
  ELSIF v_unit = 'day' THEN
    IF v_every NOT BETWEEN 1 AND 90 THEN RETURN NULL; END IF;
  ELSE
    RETURN NULL;
  END IF;
  -- Chiến dịch do Quy trình tự động quản lý: bộ máy quy trình tự mở lại, không lặp.
  IF to_regclass('public.auto_journey_step_campaigns') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.auto_journey_step_campaigns sc WHERE sc.campaign_id = $1)' INTO v_journey USING c.id;
    IF v_journey THEN RETURN NULL; END IF;
  END IF;
  RETURN jsonb_build_object('every', v_every, 'unit', v_unit, 'maxRuns', v_max);
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_clamp(c public.auto_campaigns, p_at timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Đưa một mốc giờ vào khung giờ chạy của chiến dịch (giờ Việt Nam): trước Giờ chạy thì dời tới Giờ chạy cùng ngày; từ giờ dừng trong
-- ngày (hoặc 23:59) trở đi thì dời tới Giờ chạy hôm sau. Giờ chạy lấy từ original_schedule (schedule bị dời theo lượt).
DECLARE
  v_local timestamp := p_at AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_src timestamp := coalesce(c.original_schedule, c.schedule) AT TIME ZONE 'Asia/Ho_Chi_Minh';
  v_start time := coalesce(make_time(extract(hour FROM v_src)::integer, extract(minute FROM v_src)::integer, 0), time '00:00');
  v_cutoff time := least(coalesce(c.daily_stop_time, time '23:59:00'), time '23:59:00');
BEGIN
  IF v_start < v_cutoff THEN
    IF v_local::time < v_start THEN
      v_local := v_local::date + v_start;
    ELSIF v_local::time >= v_cutoff THEN
      v_local := (v_local::date + 1) + v_start;
    END IF;
  END IF;
  RETURN v_local AT TIME ZONE 'Asia/Ho_Chi_Minh';
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_core(c public.auto_campaigns, p_done_at timestamptz, p_apply boolean,
  p_not_before timestamptz, p_by text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Quyết định sau một lượt chạy hết danh sách: lặp tiếp (repeat = true, next = giờ lượt kế) hay kết thúc (max_runs | end_date).
-- p_apply = true: ghi bộ đếm vào hai cột repeat_runs_done / repeat_log của chiến dịch (gọi đúng một lần cho mỗi lượt đã chạy hết;
-- nơi gọi đang giữ khoá dòng chiến dịch). p_apply = false: chỉ xem trước, không ghi gì. p_by: nơi đếm (engine | desktop | sweeper).
-- p_not_before: lượt kế không sớm hơn mốc này (bộ quét xử lý trễ). Không đổi trạng thái, lịch hay data; nơi gọi tự đặt lại data và hẹn lịch.
--   * unit = day: Giờ chạy của ngày (ngày chạy xong + every).
--   * unit = minute / hour: lúc chạy xong + every, rồi đưa vào khung giờ chạy.
--   * Lượt kế từ ngày kết thúc trở đi, hoặc đã đủ maxRuns lượt (tính cả lượt đầu): kết thúc.
-- Vòng đếm bắt đầu lại khi cài đặt lặp đổi, hoặc khi vòng trước đã kết thúc mà chiến dịch lại chạy hết một lượt nữa.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cfg jsonb := private.aka_agent_campaign_repeat_config(c);
  v_fp jsonb;
  s jsonb;
  v_same_cfg boolean;
  v_new_cycle boolean;
  v_runs integer;
  v_max integer;
  v_next timestamptz;
  v_local timestamp;
  v_src timestamp;
  v_repeat boolean;
  v_reason text;
  v_log jsonb;
BEGIN
  IF v_cfg IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'repeat', false);
  END IF;
  v_max := (v_cfg->>'maxRuns')::integer;
  v_fp := jsonb_strip_nulls(v_cfg || jsonb_build_object('endEpoch', floor(extract(epoch FROM c.schedule_end_date))::bigint));
  s := private.aka_agent_campaign_repeat_state(c);
  v_same_cfg := (s->>'armed')::boolean AND s->'cfg' IS NOT DISTINCT FROM v_fp;
  -- Vòng mới: cài đặt đổi; vòng trước đã kết thúc (dòng "end"); hoặc lượt cuối đã đếm và chiến dịch đã "hoàn thành" sau đó (completed_at
  -- không bị xoá khi chạy lại) mà chưa ai ghi dòng "end" (bộ chạy cũ hoàn thành rồi khách cho chạy lại trước khi bộ quét chốt).
  v_new_cycle := NOT v_same_cfg OR s->>'endedReason' IS NOT NULL
    OR ((s->>'finishing')::boolean AND c.completed_at IS NOT NULL AND c.completed_at >= (s->>'lastDoneAt')::timestamptz);
  IF NOT v_new_cycle AND (s->>'finishing')::boolean THEN
    -- Lượt cuối đã đếm nhưng chiến dịch chưa hoàn thành (có data mới giữa chừng): vẫn là lượt cuối đó, không đếm thêm.
    RETURN jsonb_build_object('enabled', true, 'repeat', false, 'reason', s->>'finishReason', 'run', (s->>'runsDone')::integer,
      'maxRuns', v_max, 'every', v_cfg->'every', 'unit', v_cfg->'unit', 'finishing', true);
  END IF;
  v_runs := CASE WHEN v_new_cycle THEN 0 ELSE (s->>'runsDone')::integer END + 1;
  IF v_runs >= v_max THEN
    v_repeat := false; v_reason := 'max_runs';
  ELSE
    IF v_cfg->>'unit' = 'day' THEN
      v_local := p_done_at AT TIME ZONE 'Asia/Ho_Chi_Minh';
      v_src := coalesce(c.original_schedule, c.schedule) AT TIME ZONE 'Asia/Ho_Chi_Minh';
      v_next := ((v_local::date + (v_cfg->>'every')::integer)
        + coalesce(make_time(extract(hour FROM v_src)::integer, extract(minute FROM v_src)::integer, 0), time '00:00'))
        AT TIME ZONE 'Asia/Ho_Chi_Minh';
    ELSIF v_cfg->>'unit' = 'hour' THEN
      v_next := private.aka_agent_campaign_repeat_clamp(c, p_done_at + make_interval(hours => (v_cfg->>'every')::integer));
    ELSE
      v_next := private.aka_agent_campaign_repeat_clamp(c, p_done_at + make_interval(mins => (v_cfg->>'every')::integer));
    END IF;
    IF p_not_before IS NOT NULL AND v_next < p_not_before THEN
      v_next := private.aka_agent_campaign_repeat_clamp(c, p_not_before);
    END IF;
    IF c.schedule_end_date IS NOT NULL AND v_next >= c.schedule_end_date THEN
      v_repeat := false; v_reason := 'end_date'; v_next := NULL;
    ELSE
      v_repeat := true; v_reason := 'scheduled';
    END IF;
  END IF;
  IF p_apply THEN
    v_log := c.repeat_log;
    IF v_new_cycle THEN
      -- Chỉ mở vòng mới (cài đặt không đổi) thì giữ mốc bắt đầu cũ: bộ quét chỉ tính lần hoàn thành sau mốc đó.
      v_log := private.aka_agent_campaign_repeat_log_append(v_log, jsonb_build_object('type', 'arm', 'at', v_now, 'cfg', v_fp,
        'by', p_by, 'since', CASE WHEN v_same_cfg THEN s->'armedAt' END));
    END IF;
    v_log := private.aka_agent_campaign_repeat_log_append(v_log, jsonb_build_object('type', 'run', 'at', v_now, 'run', v_runs,
      'max', v_max, 'by', p_by, 'doneAt', p_done_at, 'next', v_next, 'final', CASE WHEN v_repeat THEN NULL ELSE v_reason END));
    UPDATE public.auto_campaigns SET repeat_runs_done = v_runs, repeat_log = v_log WHERE id = c.id;
  END IF;
  RETURN jsonb_build_object('enabled', true, 'repeat', v_repeat, 'reason', v_reason, 'run', v_runs, 'maxRuns', v_max,
    'every', v_cfg->'every', 'unit', v_cfg->'unit') || CASE WHEN v_next IS NOT NULL THEN jsonb_build_object('next', v_next) ELSE '{}'::jsonb END;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_confirm_end(p_campaign_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Chiến dịch đã thật sự "hoàn thành" sau lượt cuối: ghi dòng "end". Lần chạy hết kế tiếp (người dùng cho chạy lại) mở vòng mới.
DECLARE
  c public.auto_campaigns%ROWTYPE;
  s jsonb;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN; END IF;
  s := private.aka_agent_campaign_repeat_state(c);
  IF NOT ((s->>'armed')::boolean AND (s->>'finishing')::boolean) THEN RETURN; END IF;
  UPDATE public.auto_campaigns
     SET repeat_log = private.aka_agent_campaign_repeat_log_append(c.repeat_log, jsonb_build_object('type', 'end', 'at', clock_timestamp(),
           'reason', coalesce(s->>'finishReason', 'max_runs'), 'completedAt', c.completed_at))
   WHERE id = c.id;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_sweeper_enabled()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Khoá tắt khẩn bộ quét: auto_system_settings 'campaign.repeat_after_completion' có "sweeper": false. Thiếu dòng, dòng tắt, sai JSON = bật.
DECLARE v_value text;
BEGIN
  SELECT s.value INTO v_value FROM public.auto_system_settings s WHERE s.key = 'campaign.repeat_after_completion' AND s.is_active LIMIT 1;
  IF v_value IS NULL THEN RETURN true; END IF;
  BEGIN
    RETURN (v_value::jsonb)->'sweeper' IS DISTINCT FROM 'false'::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN true;
  END;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_will_reopen(c public.auto_campaigns)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Hàm ghi thông báo hỏi: chiến dịch vừa "hoàn thành" này có được bộ quét mở lại không? Chỉ đúng khi chiến dịch đã được đăng ký lặp
-- trước lần hoàn thành này, bộ quét đang bật và luật lặp nói còn lượt. Lỗi bất kỳ = false (báo như thường), không chặn lệnh đổi
-- trạng thái.
DECLARE s jsonb;
BEGIN
  -- Cùng điều kiện với bộ quét (aka_agent_campaign_repeat_sweep_one): đã đăng ký trước lần hoàn thành này, còn data để chạy lại.
  s := private.aka_agent_campaign_repeat_state(c);
  IF NOT (s->>'armed')::boolean OR coalesce(c.completed_at, clock_timestamp()) < (s->>'armedAt')::timestamptz THEN RETURN false; END IF;
  IF NOT private.aka_agent_campaign_repeat_sweeper_enabled() THEN RETURN false; END IF;
  -- Lượt cuối đã đếm: hoàn thành lần này là kết thúc vòng, báo như thường.
  IF (s->>'finishing')::boolean THEN RETURN false; END IF;
  IF coalesce(c.action_id, '') NOT IN ('facebook_timeline_post', 'facebook_newsfeed_interaction')
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng') THEN
    RETURN false;
  END IF;
  RETURN coalesce((private.aka_agent_campaign_repeat_core(c, clock_timestamp(), false, clock_timestamp(), NULL)->>'repeat')::boolean, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_sync(p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Gọi sau khi lưu chiến dịch: đăng ký / gỡ đăng ký lặp theo cài đặt hiện tại. Cài đặt lặp không đổi thì giữ nguyên bộ đếm; đổi (hoặc
-- bật lần đầu) thì đếm lại từ 0 và chỉ tính các lần chạy hết sau thời điểm này. Chiến dịch đang "hoàn thành" lúc bật: lần hoàn thành
-- đó được ghi là đã xử lý, bộ quét không mở lại.
DECLARE
  v_now timestamptz := clock_timestamp();
  c public.auto_campaigns%ROWTYPE;
  v_cfg jsonb;
  v_fp jsonb;
  s jsonb;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('enabled', false); END IF;
  v_cfg := private.aka_agent_campaign_repeat_config(c);
  s := private.aka_agent_campaign_repeat_state(c);
  IF v_cfg IS NULL THEN
    IF (s->>'armed')::boolean THEN
      UPDATE public.auto_campaigns
         SET repeat_runs_done = 0,
             repeat_log = private.aka_agent_campaign_repeat_log_append(c.repeat_log, jsonb_build_object('type', 'off', 'at', v_now))
       WHERE id = c.id;
    END IF;
    RETURN jsonb_build_object('enabled', false);
  END IF;
  v_fp := jsonb_strip_nulls(v_cfg || jsonb_build_object('endEpoch', floor(extract(epoch FROM c.schedule_end_date))::bigint));
  IF NOT (s->>'armed')::boolean OR s->'cfg' IS DISTINCT FROM v_fp THEN
    UPDATE public.auto_campaigns
       SET repeat_runs_done = 0,
           repeat_log = private.aka_agent_campaign_repeat_log_append(c.repeat_log, jsonb_build_object('type', 'arm', 'at', v_now,
             'cfg', v_fp, 'by', 'save', 'completedAt', CASE WHEN c.status = 'hoàn thành' THEN c.completed_at END))
     WHERE id = c.id
    RETURNING * INTO c;
    s := private.aka_agent_campaign_repeat_state(c);
  END IF;
  RETURN jsonb_build_object('enabled', true, 'runsDone', (s->>'runsDone')::integer, 'maxRuns', (v_cfg->>'maxRuns')::integer,
    'every', v_cfg->'every', 'unit', v_cfg->'unit', 'nextRunAt', s->'nextRunAt', 'endedReason', s->'endedReason');
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_sweep_one(p_campaign_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Bộ quét, một chiến dịch đã "hoàn thành": đếm lượt vừa xong rồi mở lại (đặt lại data như bộ chạy: mọi data trừ "tạm dừng" về
-- "chờ xử lý"; chiến dịch về "chờ xử lý" với lịch là giờ lượt kế), hoặc chốt kết thúc. Trả: reopened | ended | skipped | busy | gone.
-- Lần hoàn thành không bao giờ được tính (chưa đăng ký, hoàn thành trước lúc đăng ký, cài đặt không hợp lệ) được ghi một dòng
-- "skip" để lượt quét sau không xét lại.
DECLARE
  v_now timestamptz := clock_timestamp();
  c public.auto_campaigns%ROWTYPE;
  s jsonb;
  v_dec jsonb;
  v_next timestamptz;
  v_total bigint;
  v_resettable bigint;
  v_line text;
  v_skip text;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id FOR UPDATE SKIP LOCKED;
  IF c.id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = p_campaign_id) THEN RETURN 'gone'; END IF;
    RETURN 'busy';
  END IF;
  IF coalesce(c.is_delete, false) THEN RETURN 'gone'; END IF;
  s := private.aka_agent_campaign_repeat_state(c);
  IF c.status IS DISTINCT FROM 'hoàn thành' OR c.completed_at IS NULL
     OR c.completed_at IS NOT DISTINCT FROM (s->>'handledCompletedAt')::timestamptz THEN
    RETURN 'skipped';
  END IF;
  IF NOT (s->>'armed')::boolean THEN
    v_skip := 'not_armed';
  ELSIF c.completed_at < (s->>'armedAt')::timestamptz THEN
    v_skip := 'before_arm';
  END IF;
  IF v_skip IS NULL THEN
    -- Bộ chạy cũ còn giữ chiến dịch (token treo): chờ lượt quét sau.
    IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN RETURN 'busy'; END IF;
    -- Lượt cuối đã đếm (bộ chạy biết tính năng hoàn thành sau lượt cuối): chốt kết thúc.
    IF (s->>'finishing')::boolean THEN
      PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
      RETURN 'ended';
    END IF;
    v_dec := private.aka_agent_campaign_repeat_core(c, c.completed_at, true, v_now, 'sweeper');
    IF NOT (v_dec->>'enabled')::boolean THEN v_skip := 'not_enabled'; END IF;
  END IF;
  IF v_skip IS NOT NULL THEN
    UPDATE public.auto_campaigns
       SET repeat_log = private.aka_agent_campaign_repeat_log_append(c.repeat_log, jsonb_build_object('type', 'skip', 'at', v_now,
             'reason', v_skip, 'completedAt', c.completed_at))
     WHERE id = c.id;
    RETURN 'skipped';
  END IF;
  IF NOT (v_dec->>'repeat')::boolean THEN
    PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
    RETURN 'ended';
  END IF;
  v_next := (v_dec->>'next')::timestamptz;
  SELECT count(*), count(*) FILTER (WHERE d.status <> 'tạm dừng') INTO v_total, v_resettable
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;
  -- Như rescheduleCompletedCampaignPass: không còn data để chạy lại thì kết thúc. Đăng trang cá nhân và lướt newsfeed của Facebook
  -- chạy không cần data.
  IF (v_total > 0 AND v_resettable = 0)
     OR (v_total = 0 AND c.action_id NOT IN ('facebook_timeline_post', 'facebook_newsfeed_interaction')) THEN
    UPDATE public.auto_campaigns x
       SET repeat_log = private.aka_agent_campaign_repeat_log_append(x.repeat_log, jsonb_build_object('type', 'end', 'at', v_now,
             'reason', 'no_rerun_data', 'completedAt', c.completed_at))
     WHERE x.id = c.id;
    RETURN 'ended';
  END IF;
  IF v_resettable > 0 THEN
    UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
     WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  END IF;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, completed_at = NULL, updated_at = v_now
   WHERE id = c.id;
  -- Dòng lịch sử chạy cho khách đọc (cùng khuôn "HH:MM:SS DD/MM/YYYY - nội dung" và cùng khoá thứ tự với append_auto_campaign_log).
  IF to_regclass('public.auto_campaign_logs') IS NOT NULL THEN
    v_line := to_char(v_now AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI:SS DD/MM/YYYY') || ' - ⏳ Đã chạy xong lượt '
      || (v_dec->>'run') || '/' || (v_dec->>'maxRuns') || ', hẹn chạy lại chiến dịch "' || coalesce(c.name, '') || '" lúc '
      || to_char(v_next AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI DD/MM/YYYY');
    PERFORM pg_advisory_xact_lock(hashtextextended('auto_campaign_logs:' || c.id::text, 0));
    EXECUTE 'INSERT INTO public.auto_campaign_logs (campaign_id, log) VALUES ($1, $2)' USING c.id, v_line;
  END IF;
  RETURN 'reopened';
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_assert_caller(p_staff_id bigint)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Phiên Desktop chỉ được thao tác trên chiến dịch của chính nhân viên đang đăng nhập; service_role (API Web, App Server) tự chịu
-- trách nhiệm về p_staff_id như các RPC điều khiển khác.
DECLARE v_staff bigint;
BEGIN
  IF p_staff_id IS NULL OR p_staff_id <= 0 THEN RAISE EXCEPTION 'invalid_staff' USING ERRCODE = '22023'; END IF;
  IF current_setting('role', true) = 'aka_agent_desktop' THEN
    SELECT ctx.staff_id INTO v_staff FROM private.aka_agent_desktop_data_context() ctx LIMIT 1;
    IF v_staff IS NULL OR v_staff <> p_staff_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  END IF;
END $f$;

CREATE FUNCTION public.aka_agent_campaign_repeat_sync_v1(p_staff_id bigint, p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Gọi sau khi tạo / sửa chiến dịch (API Web, form Desktop): đăng ký lặp theo cài đặt vừa lưu.
BEGIN
  PERFORM private.aka_agent_campaign_repeat_assert_caller(p_staff_id);
  IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns c WHERE c.id = p_campaign_id AND c.staff_id = p_staff_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true) || private.aka_agent_campaign_repeat_sync(p_campaign_id);
END $f$;

CREATE FUNCTION public.aka_agent_campaign_repeat_decide_v1(p_staff_id bigint, p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Bộ chạy cũ của Desktop gọi khi một lượt vừa chạy hết danh sách và chiến dịch còn "đang chạy", trước khi hoàn thành: đếm lượt và
-- trả quyết định. repeat = true thì bộ chạy đặt lại data và hẹn lịch tới "next" (rescheduleCompletedCampaignPass); false thì hoàn
-- thành chiến dịch như thường.
DECLARE c public.auto_campaigns%ROWTYPE;
BEGIN
  PERFORM private.aka_agent_campaign_repeat_assert_caller(p_staff_id);
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id AND staff_id = p_staff_id FOR UPDATE;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF c.status IS DISTINCT FROM 'đang chạy' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_running', 'campaignStatus', c.status);
  END IF;
  RETURN jsonb_build_object('ok', true) || private.aka_agent_campaign_repeat_core(c, clock_timestamp(), true, NULL, 'desktop');
END $f$;

CREATE FUNCTION public.aka_agent_campaign_repeat_state_v1(p_staff_id bigint, p_campaign_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Bộ đếm lượt để hiển thị ("lượt i/n, lượt kế lúc …"), đọc từ hai cột repeat_runs_done / repeat_log. Tối đa 200 chiến dịch mỗi lần,
-- chỉ chiến dịch của p_staff_id đang đăng ký lặp.
BEGIN
  PERFORM private.aka_agent_campaign_repeat_assert_caller(p_staff_id);
  IF coalesce(cardinality(p_campaign_ids), 0) > 200 THEN RAISE EXCEPTION 'too_many_campaigns' USING ERRCODE = '22023'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('campaignId', q.id, 'runsDone', (q.s->>'runsDone')::integer,
        'maxRuns', (q.s->'cfg'->>'maxRuns')::integer, 'every', q.s->'cfg'->'every', 'unit', q.s->'cfg'->'unit',
        'nextRunAt', q.s->'nextRunAt', 'lastCompletedAt', q.s->'lastDoneAt', 'finishing', q.s->'finishing',
        'endedReason', q.s->'endedReason', 'endedAt', q.s->'endedAt') ORDER BY q.id)
      FROM (SELECT c.id, private.aka_agent_campaign_repeat_state(c) AS s
              FROM public.auto_campaigns c
             WHERE c.id = ANY (coalesce(p_campaign_ids, '{}'::bigint[])) AND c.staff_id = p_staff_id
               AND coalesce(c.is_delete, false) = false AND c.repeat_log IS NOT NULL) q
     WHERE (q.s->>'armed')::boolean
  ), '[]'::jsonb);
END $f$;

CREATE FUNCTION public.aka_agent_campaign_repeat_tick_v1(p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '50s' AS $f$
-- Bộ quét dự phòng (API Web gọi theo đồng hồ): chiến dịch đã đăng ký lặp mà bộ chạy đánh "hoàn thành" thì đếm lượt và mở lại, hoặc
-- chốt kết thúc. Mỗi chiến dịch một giao dịch con: lỗi của chiến dịch này không chặn chiến dịch khác; lỗi 5 lượt liền thì thôi lặp.
-- Một lượt quét tại một thời điểm; dừng nhận thêm sau 30 giây. Ứng viên: chiến dịch có nhật ký, đang bật lặp, "hoàn thành", và dòng
-- nhật ký cuối chưa ghi lần hoàn thành này là đã xử lý.
DECLARE
  v_started timestamptz := clock_timestamp();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  r record;
  c public.auto_campaigns%ROWTYPE;
  v_out text;
  v_err text;
  v_log jsonb;
  v_reopened integer := 0;
  v_ended integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
BEGIN
  IF NOT private.aka_agent_campaign_repeat_sweeper_enabled() THEN RETURN jsonb_build_object('ok', true, 'enabled', false); END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('aka-agent-campaign-repeat-tick', 0)) THEN
    RETURN jsonb_build_object('ok', true, 'enabled', true, 'busy', true);
  END IF;
  FOR r IN
    SELECT x.id AS campaign_id, x.completed_at
      FROM public.auto_campaigns x
     WHERE x.repeat_log IS NOT NULL AND x.status = 'hoàn thành' AND x.completed_at IS NOT NULL AND coalesce(x.is_delete, false) = false
       AND x.extra_settings->'repeatAfterCompletionEnabled' = 'true'::jsonb
       AND (x.repeat_log -> -1 ->> 'completedAt')::timestamptz IS DISTINCT FROM x.completed_at
     ORDER BY x.completed_at
     LIMIT v_limit
  LOOP
    EXIT WHEN clock_timestamp() - v_started > interval '30 seconds';
    BEGIN
      v_out := private.aka_agent_campaign_repeat_sweep_one(r.campaign_id);
      IF v_out = 'reopened' THEN v_reopened := v_reopened + 1;
      ELSIF v_out = 'ended' THEN v_ended := v_ended + 1;
      ELSE v_skipped := v_skipped + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_failed := v_failed + 1;
      SELECT * INTO c FROM public.auto_campaigns WHERE id = r.campaign_id FOR UPDATE SKIP LOCKED;
      IF c.id IS NOT NULL THEN
        v_log := private.aka_agent_campaign_repeat_log_append(c.repeat_log, jsonb_build_object('type', 'error', 'at', clock_timestamp(),
          'message', left(v_err, 300)));
        IF (private.aka_agent_campaign_repeat_state(c)->>'errorCount')::integer + 1 >= 5 THEN
          v_log := private.aka_agent_campaign_repeat_log_append(v_log, jsonb_build_object('type', 'end', 'at', clock_timestamp(),
            'reason', 'error', 'completedAt', r.completed_at));
        END IF;
        UPDATE public.auto_campaigns SET repeat_log = v_log WHERE id = c.id;
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'reopened', v_reopened, 'ended', v_ended, 'skipped', v_skipped, 'failed', v_failed);
END $f$;

CREATE OR REPLACE FUNCTION public.aka_agent_engine_finish_campaign_v2(p_account_id bigint, p_lease_token uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- Hết data khi còn giữ lease: kết thúc lượt như Desktop (campaignScheduler.ts, cuối executeCampaignV2 + handleCampaignCompletion +
-- rescheduleCompletedCampaignPass), theo đúng thứ tự. Trả lý do; lõi in câu tiến trình theo lý do.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_vn date := (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date;
  v_campaign_id bigint;
  l public.auto_engine_leases%ROWTYPE;
  c public.auto_campaigns%ROWTYPE;
  a public.auto_accounts%ROWTYPE;
  v_extra jsonb;
  v_next timestamptz;
  v_cutoff time;
  v_slots text[];
  v_slot text;
  v_slot_minute integer;
  v_current_minute integer;
  v_candidate timestamptz;
  v_next_slot text;
  v_minutes integer;
  v_raw jsonb;
  v_mode text;
  v_suffix text;
  v_total bigint;
  v_resettable bigint;
  v_m text[];
  -- V506: group thời gian thực.
  v_rt_raw text;
  v_rt_key text;
  v_anchor timestamptz;
  v_rt_slot time;
  -- V558: chạy lại sau N giờ (giờ, số nguyên ≥ 1).
  v_hours numeric;
  -- V561: lặp lại sau khi chạy xong.
  v_repeat jsonb;
BEGIN
  SELECT el.campaign_id INTO v_campaign_id FROM public.auto_engine_leases el
   WHERE el.account_id = p_account_id AND el.lease_token = p_lease_token AND el.expires_at > v_now;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  -- Thứ tự khoá như bản cũ: khoá nạp data của chiến dịch (cùng khoá với aka_agent_lock_campaign_input_serialization và luồng nạp
  -- Nhóm data), rồi chiến dịch, tài khoản, rồi lease (claim cũng khoá chiến dịch → tài khoản → lease).
  PERFORM pg_advisory_xact_lock(hashtextextended('aka-agent-campaign-input-serialization:' || v_campaign_id::text, 0));
  SELECT * INTO c FROM public.auto_campaigns WHERE id = v_campaign_id FOR UPDATE;
  SELECT * INTO a FROM public.auto_accounts WHERE id = p_account_id FOR UPDATE;
  SELECT * INTO l FROM public.auto_engine_leases
   WHERE account_id = p_account_id AND lease_token = p_lease_token AND expires_at > v_now FOR UPDATE;
  IF NOT FOUND OR l.campaign_id IS DISTINCT FROM v_campaign_id THEN RETURN jsonb_build_object('ok', false, 'reason', 'ownership_lost'); END IF;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'campaign_deleted'); END IF;
  IF c.status NOT IN ('chờ xử lý', 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'campaign_control_won', 'campaignStatus', c.status);
  END IF;
  -- Review 12/11: máy chưa cập nhật (bộ cũ) đã nhận chiến dịch giữa lúc lõi hết data và lúc kết thúc lượt: không kết thúc / đặt lại
  -- data, như release_v1 và close_stale_v1 (chỉ đụng chiến dịch không còn token của bộ cũ).
  IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'legacy_busy');
  END IF;
  -- Như finalizer của VPS: tài khoản Server bị tạm dừng trong lượt thì chiến dịch về "chờ xử lý", không hoàn thành.
  IF l.runtime_target = 'fly' AND a.status IS DISTINCT FROM 'đang chạy' AND a.status IS DISTINCT FROM 'chờ xử lý' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'account_control_won', 'accountStatus', a.status, 'campaignStatus', 'chờ xử lý');
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.campaign_id = c.id AND tr.completed_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                 WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'đang chạy') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Data đến hạn chưa thử trong lượt này (vừa được thêm vào): chạy tiếp, chưa kết thúc.
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)
                AND NOT EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.input_data_id = d.id AND tr.lease_token = p_lease_token)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'targets_remaining');
  END IF;
  -- Review 12/11: bản cũ xoá ghi chú khi bắt đầu mỗi lượt (claim v397); bộ mới chỉ xoá khi nhận được data (chiến dịch sang "đang
  -- chạy"). Lượt không nhận data nào (chiến dịch còn "chờ xử lý", ví dụ mọi data còn lại bị chống gửi lặp tạm dừng) thì ghi chú đang
  -- có là của lượt trước (câu chờ khoá / hạn mức, không kiểm được giới hạn gửi lặp): xoá trước khi hoàn thành / hẹn lại.
  IF c.status = 'chờ xử lý' AND c.note IS NOT NULL THEN
    UPDATE public.auto_campaigns SET note = NULL, updated_at = v_now WHERE id = c.id;
    c.note := NULL;
  END IF;

  -- 0. Như executeCampaignV2 (isZaloFriendAutoDataCampaign && không có data): chiến dịch nhắn bạn bè "toàn bộ / theo tag" đã lấy
  -- data một lần mà không còn dòng nào thì giữ "chờ xử lý" kèm ghi chú, không hoàn thành (chế độ lạ coi như "selected").
  IF c.action_id = 'zalo_message_friend'
     AND coalesce(c.extra_settings->>'zaloFriendTargetMode', 'selected') IN ('all_friends', 'tagged_friends')
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Chiến dịch đã lấy data bạn bè Zalo một lần nhưng chưa có data để chạy',
      updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'friend_auto_no_data', 'campaignStatus', 'chờ xử lý');
  END IF;

  -- V506: group thời gian thực, như handleZaloRealtimeGroupCompletion (sau lượt) và prepareZaloRealtimeGroupCampaignRun (lượt không có data
  -- đến hạn) của Desktop, theo đúng thứ tự: data đến hạn còn chờ → chạy lại ngay; data tương lai → hẹn tới data sớm nhất; còn trong ngày
  -- nhận data (zaloRealtimeEndDate, ngày VN của DB) → chờ tới giờ gốc của chiến dịch (hôm nay nếu chưa qua, không thì ngày mai); hết ngày
  -- nhận → hoàn thành. Data do bộ nhận sự kiện của bản cũ đổ vào (enqueue_campaign_zalo_realtime_group_event), không đổi.
  IF c.action_id = 'zalo_message_group_realtime' THEN
    IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                  AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_now, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'realtime_due_pending', 'campaignStatus', 'chờ xử lý');
    END IF;
    SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
     WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
    IF v_next IS NOT NULL THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
    END IF;
    -- getZaloRealtimeEndDateKey: "YYYY-MM-DD" giữ nguyên (so như chuỗi), dạng khác đọc như ngày giờ rồi lấy ngày VN; sai thì hết hạn.
    v_rt_raw := btrim(coalesce(c.extra_settings->>'zaloRealtimeEndDate', ''));
    v_rt_key := NULL;
    IF v_rt_raw ~ '^\d{4}-\d{2}-\d{2}$' THEN
      v_rt_key := v_rt_raw;
    ELSIF v_rt_raw <> '' THEN
      BEGIN
        v_rt_key := to_char((v_rt_raw::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD');
      EXCEPTION WHEN OTHERS THEN
        v_rt_key := NULL;
      END;
    END IF;
    IF v_rt_key IS NOT NULL AND to_char(v_vn, 'YYYY-MM-DD') <= v_rt_key THEN
      -- getZaloRealtimeWaitSchedule: giờ:phút (VN) của lịch gốc, không có thì lịch hiện tại, không có nữa thì bây giờ.
      v_anchor := coalesce(c.original_schedule, c.schedule, v_now);
      v_rt_slot := date_trunc('minute', (v_anchor AT TIME ZONE 'Asia/Ho_Chi_Minh'))::time;
      v_next := ((v_vn + v_rt_slot)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
      IF v_next <= v_now THEN v_next := (((v_vn + 1) + v_rt_slot)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'); END IF;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      -- Lượt đã chạy data thì "tiếp tục chờ" (sau lượt), chưa chạy data nào thì "đang chờ" (trước lượt), như hai câu của Desktop.
      RETURN jsonb_build_object('ok', true, 'reason', 'realtime_waiting', 'schedule', v_next, 'campaignStatus', 'chờ xử lý',
        'ranTargets', EXISTS (SELECT 1 FROM public.auto_engine_target_runs tr WHERE tr.lease_token = p_lease_token AND tr.campaign_id = c.id));
    END IF;
    RETURN public.aka_agent_engine_finalize_v501(c.id, 'Chiến dịch đã hết ngày nhận data theo thời gian thực và không còn data chờ chạy',
      'completed_realtime_end', NULL);
  END IF;

  -- 1. Data chưa đến lịch: hẹn chiến dịch tới data sớm nhất (deferCampaignUntilFutureInput), trước mọi nhánh khác.
  SELECT min(d.schedule) INTO v_next FROM public.auto_campaign_input_data d
   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý' AND d.schedule > v_now;
  IF v_next IS NOT NULL THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'rescheduled_future_input', 'schedule', v_next, 'campaignStatus', 'chờ xử lý');
  END IF;

  -- 2. Nhóm data (handleCampaignCompletion bước 1): đúng hàm kết thúc của bản cũ (aka_agent_internal_finalize_data_group_campaign_v219,
  -- cùng lõi với bản Desktop và bản Zalo Server): data chờ / về hàng đợi → chờ xử lý; nguồn đang nhận → chờ xử lý + "Chờ data mới";
  -- nguồn dừng / hết hạn / bị xoá → hoàn thành. Lease của lượt là bằng chứng sở hữu (thay kiểm runtime của hai bản bọc).
  IF c.data_target_source_mode = 'data_group'
     AND to_regprocedure('public.aka_agent_internal_finalize_data_group_campaign_v219(bigint,bigint,bigint,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.aka_agent_internal_finalize_data_group_campaign_v219($1, $2, $3, $4)' INTO v_raw
      USING c.staff_id, c.organization_id, c.id, p_note;
    RETURN jsonb_build_object('ok', true, 'reason', CASE WHEN (v_raw->>'completed')::boolean THEN 'data_group_completed' ELSE 'data_group_waiting' END,
      'finalize', v_raw, 'campaignStatus', v_raw->>'status');
  END IF;
  -- Nhóm theo thời gian thực có bộ kết thúc riêng của bản cũ; Nhóm data khi DB chưa có hàm kết thúc (DB thử): không tự hoàn thành
  -- (hoàn thành làm trigger dừng hẳn nguồn Nhóm data).
  IF c.data_target_source_mode = 'data_group' THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', updated_at = v_now WHERE id = c.id AND status = 'đang chạy';
    RETURN jsonb_build_object('ok', false, 'reason', 'completion_not_supported', 'campaignStatus', 'chờ xử lý');
  END IF;

  v_cutoff := least(coalesce(c.daily_stop_time, time '23:59:00'), time '23:59:00');
  v_extra := coalesce(c.extra_settings, '{}'::jsonb);

  -- 3. Hết ngày kết thúc.
  IF c.schedule_end_date IS NOT NULL AND v_now >= c.schedule_end_date THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_end_date', NULL);
  END IF;

  -- 4. Nhiều khung giờ (handleMultiDailyTimeSlotAfterCompletion): khung hiện tại = lịch lúc bắt đầu lượt, phải cùng ngày hôm nay.
  -- V558: như MULTI_DAILY_TIME_SLOT_ACTION_IDS của bộ cũ (campaignScheduler.ts:666), gồm cả trang cá nhân và Page Facebook.
  IF c.action_id IN ('zalo_message_friend', 'zalo_message_group', 'facebook_timeline_post', 'facebook_page_post')
     AND v_extra->'multiDailyTimeSlotsEnabled' = 'true'::jsonb THEN
    -- Tách theo dấu phẩy/xuống dòng, chuẩn hoá H, H:M, HhM, Hh (giờ 0–23, phút 0–59), bỏ trùng theo phút, xếp tăng dần.
    SELECT coalesce(array_agg(s.slot ORDER BY s.minute), '{}'::text[]) INTO v_slots FROM (
      SELECT DISTINCT ON (x.minute) x.minute, x.slot FROM (
        SELECT (m[1])::integer * 60 + coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer AS minute,
               lpad(m[1]::integer::text, 2, '0') || ':' || lpad(coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer::text, 2, '0') AS slot
          FROM regexp_split_to_table(CASE jsonb_typeof(v_extra->'multiDailyTimeSlots') WHEN 'string' THEN v_extra->>'multiDailyTimeSlots'
                                          WHEN 'number' THEN v_extra->>'multiDailyTimeSlots' ELSE '' END, '[,\r\n]+') item,
               LATERAL regexp_match(regexp_replace(lower(btrim(item)), '\s+', '', 'g'), '^(\d{1,2})(?::(\d{1,2})|h(\d{1,2})?|h)?$') m
         WHERE m IS NOT NULL AND (m[1])::integer BETWEEN 0 AND 23 AND coalesce(nullif(m[2], ''), nullif(m[3], ''), '0')::integer BETWEEN 0 AND 59
      ) x ORDER BY x.minute
    ) s;
    IF cardinality(v_slots) >= 2 AND l.campaign_schedule IS NOT NULL
       AND (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = v_vn THEN
      v_current_minute := extract(hour FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer * 60
                        + extract(minute FROM (l.campaign_schedule AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer;
      FOREACH v_slot IN ARRAY v_slots LOOP
        v_slot_minute := split_part(v_slot, ':', 1)::integer * 60 + split_part(v_slot, ':', 2)::integer;
        CONTINUE WHEN v_slot_minute <= v_current_minute;
        v_candidate := ((v_vn + make_interval(mins => v_slot_minute))::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh');
        CONTINUE WHEN v_candidate <= v_now;
        v_next_slot := v_slot;
        EXIT;
      END LOOP;
      IF v_next_slot IS NULL THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_slot', NULL);
      END IF;
      IF (v_candidate AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_slot_after_cutoff', jsonb_build_object('slot', v_next_slot));
      END IF;
      v_next := v_candidate;
      v_mode := 'slot_advanced';
      v_suffix := 'ở khung giờ tiếp theo';
    END IF;
  END IF;

  -- 5. Gửi lặp lại sau x phút (handleZaloShareRepeatAfterCompletion): nhắn bạn bè/nhóm dạng chia sẻ, không nhiều khung giờ,
  -- không bật chống gửi lặp N ngày, số phút 5–1439 (số, hoặc chuỗi 1–4 chữ số).
  IF v_mode IS NULL AND c.action_id IN ('zalo_message_friend', 'zalo_message_group') AND v_extra->'zaloShareRepeatEnabled' = 'true'::jsonb
     AND v_extra->>'zaloMessageSendMode' = 'share' AND v_extra->'multiDailyTimeSlotsEnabled' IS DISTINCT FROM 'true'::jsonb
     AND v_extra->'recentDeliveryCooldownEnabled' IS DISTINCT FROM 'true'::jsonb THEN
    v_raw := v_extra->'zaloShareRepeatAfterMinutes';
    v_minutes := CASE
      WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\d+$' THEN (v_raw #>> '{}')::integer
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\d{1,4}$' THEN btrim(v_raw #>> '{}')::integer END;
    IF v_minutes BETWEEN 5 AND 1439 THEN
      v_next := v_now + make_interval(mins => v_minutes);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_repeat_after_cutoff', NULL);
      END IF;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt gửi lặp kế tiếp';
    END IF;
  END IF;

  -- 5b. (V561) Lặp lại sau khi chạy xong: lịch Hàng ngày, x phút / giờ / ngày tính từ lúc chạy xong, tới khi đủ số lượt tối đa hoặc tới
  -- ngày kết thúc. Như handleCampaignRepeatAfterCompletion của bộ cũ: chỉ tính lượt khi lượt này thật sự chạy hết (không còn data chờ)
  -- và còn data để chạy lại (đăng trang cá nhân, lướt newsfeed không có dòng data nào vẫn lặp, bước 6 hẹn lượt kế mà không đặt lại gì).
  -- Các kiểm tra đó trùng với bước 6 nên bước 6 không rẽ nhánh khác sau khi đã đếm lượt. Đang bật lặp thì "chạy lại sau N giờ" kiểu cũ
  -- (V558) không áp dụng, kể cả khi lượt này đã là lượt cuối.
  IF v_mode IS NULL AND v_extra->'repeatAfterCompletionEnabled' = 'true'::jsonb
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý')
     AND (EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                   WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng')
          OR (c.action_id IN ('facebook_timeline_post', 'facebook_newsfeed_interaction')
              AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false))) THEN
    v_repeat := private.aka_agent_campaign_repeat_core(c, v_now, true, NULL, 'engine');
    IF (v_repeat->>'repeat')::boolean THEN
      v_next := (v_repeat->>'next')::timestamptz;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt lặp kế tiếp';
    ELSIF NOT (v_repeat->>'enabled')::boolean THEN
      v_repeat := NULL;
    END IF;
  END IF;

  -- V558: chạy lại sau N giờ khi xong (handleRerunAfterCompletion, campaignScheduler.ts:2711-2786): tìm data trong group / bằng search,
  -- comment seeding, newsfeed; findDataRerunEnabled đúng true, findDataRerunAfterHours lấy phần nguyên, dưới 1 hoặc sai thì tắt (hoàn thành
  -- như thường). Lịch kế = bây giờ + N giờ; khác ngày nhận lượt hoặc khác hôm nay → hoàn thành; từ giờ dừng trong ngày → hoàn thành. Trừ
  -- newsfeed (không có data): mọi data chưa xoá, khác "tạm dừng" về "chờ xử lý" (ghi chú rỗng, date_action NULL); không còn data nào như
  -- vậy → hoàn thành. Không qua bước "còn data đến hạn" và không đòi có data (khác nhánh 6).
  IF v_mode IS NULL AND v_repeat IS NULL
     AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction')
     AND v_extra->'findDataRerunEnabled' = 'true'::jsonb THEN
    v_raw := v_extra->'findDataRerunAfterHours';
    v_hours := CASE
      WHEN jsonb_typeof(v_raw) = 'number' THEN floor((v_raw #>> '{}')::numeric)
      WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^[0-9]{1,6}(\.[0-9]+)?$' THEN floor(btrim(v_raw #>> '{}')::numeric) END;
    IF v_hours >= 1 AND v_hours <= 1000000 THEN
      v_next := v_now + make_interval(hours => v_hours::integer);
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> (l.acquired_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
         OR (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::date <> v_vn THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_next_day', NULL);
      END IF;
      IF (v_next AT TIME ZONE 'Asia/Ho_Chi_Minh')::time >= v_cutoff THEN
        RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_after_cutoff', jsonb_build_object('hours', v_hours));
      END IF;
      IF c.action_id <> 'facebook_newsfeed_interaction' THEN
        SELECT count(*) INTO v_resettable FROM public.auto_campaign_input_data d
         WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng';
        IF v_resettable = 0 THEN
          RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_rerun_no_data', NULL);
        END IF;
        UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
         WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
      END IF;
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', 'rerun_scheduled', 'schedule', v_next, 'hours', v_hours, 'campaignStatus', 'chờ xử lý');
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    v_raw := public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed',
      CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) END);
    IF v_repeat IS NOT NULL AND v_raw->>'campaignStatus' = 'hoàn thành' THEN
      PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
    END IF;
    RETURN v_raw;
  END IF;

  -- 6. Hẹn lượt kế tiếp (rescheduleCompletedCampaignPass).
  IF EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
              WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý'
                AND (d.schedule IS NULL OR d.schedule <= v_now)) THEN
    UPDATE public.auto_campaigns SET status = 'chờ xử lý', note = 'Còn data đã đến lịch, chiến dịch sẽ tiếp tục xử lý.', updated_at = v_now
     WHERE id = c.id;
    RETURN jsonb_build_object('ok', true, 'reason', 'due_pending', 'campaignStatus', 'chờ xử lý');
  END IF;
  SELECT count(*), count(*) FILTER (WHERE d.status <> 'tạm dừng') INTO v_total, v_resettable
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;
  IF v_resettable = 0 THEN
    -- V558: như rescheduleCompletedCampaignPass của bộ cũ: Page không có dòng data nào thì hoàn thành ("không có page…"); chiến dịch Facebook
    -- khác không có dòng data nào (trang cá nhân) thì hẹn khung kế mà không đặt lại gì. Có data mà không đặt lại được thì hoàn thành như Zalo.
    IF c.action_id = 'facebook_page_post' AND v_total = 0 THEN
      RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_page', jsonb_build_object('suffix', v_suffix));
    END IF;
    IF c.action_id LIKE 'facebook\_%' AND v_total = 0 THEN
      UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
      RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
        || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
        || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;
    END IF;
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed_no_rerun_data', jsonb_build_object('suffix', v_suffix));
  END IF;
  UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
   WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, updated_at = v_now WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
    || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;
END $function$
;

CREATE OR REPLACE FUNCTION private.aka_agent_notification_capture_campaign()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_sub public.auto_notification_subscriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_to text := NEW.status;
  v_cooldown integer;
  v_last bigint;
  v_org bigint;
  v_digest integer; v_deliver timestamptz; v_prev_deliver timestamptz; v_prev_status text;
BEGIN
  IF NOT private.aka_agent_notification_enabled() THEN RETURN NULL; END IF;
  SELECT * INTO v_sub FROM public.auto_notification_subscriptions
   WHERE staff_id = NEW.staff_id AND event_type = 'campaign.status_changed' AND scope = 'own' AND is_enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT (coalesce(v_sub.filters -> 'toStatuses', private.aka_agent_notification_default_filters('campaign.status_changed') -> 'toStatuses') ? v_to) THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(v_sub.filters -> 'campaignIds') = 'array' AND NOT ((v_sub.filters -> 'campaignIds') @> to_jsonb(NEW.id)) THEN
    RETURN NULL;
  END IF;
  -- V475: chiến dịch do Quy trình quản lý. Bộ máy mở lại chiến dịch mỗi khi có khách tới bước gửi, nên "hoàn thành",
  -- "đang chạy", "chờ xử lý" lặp nhiều lần mỗi ngày mà không cần ai xử lý. Khi quy trình đang chạy hoặc tạm dừng chỉ báo
  -- "tạm dừng"/"lỗi". Quy trình đã dừng/xóa, hoặc chưa có bảng Quy trình (V473 gỡ ra): như chiến dịch thường.
  IF v_to NOT IN ('tạm dừng', 'lỗi') AND to_regclass('public.auto_journey_step_campaigns') IS NOT NULL
     AND to_regclass('public.auto_journeys') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.auto_journey_step_campaigns sc JOIN public.auto_journeys j ON j.id = sc.journey_id
                WHERE sc.campaign_id = NEW.id AND j.is_delete = false AND j.status IN ('active', 'paused')) THEN
      RETURN NULL;
    END IF;
  END IF;
  -- V561: chiến dịch đang bật "Lặp lại sau khi chạy xong" mà bộ chạy chưa biết tính năng đánh "hoàn thành" ở lượt giữa: bộ quét sẽ mở
  -- lại ngay sau đó, nên không báo. Lượt cuối (đủ số lượt, tới ngày kết thúc) báo như thường. Bộ quét đang tắt, hàm chưa có hoặc
  -- hàm lỗi: báo như chiến dịch thường.
  IF v_to = 'hoàn thành' AND NEW.extra_settings -> 'repeatAfterCompletionEnabled' = 'true'::jsonb
     AND to_regprocedure('private.aka_agent_campaign_repeat_will_reopen(public.auto_campaigns)') IS NOT NULL THEN
    IF private.aka_agent_campaign_repeat_will_reopen(NEW) THEN RETURN NULL; END IF;
  END IF;
  v_cooldown := CASE WHEN v_to IN ('đang chạy', 'chờ xử lý') THEN coalesce(v_sub.cooldown_minutes, 15)
    ELSE coalesce(v_sub.cooldown_minutes, private.aka_agent_notification_int_setting('notifications.cooldown_minutes.campaign', 10)) END;
  IF v_cooldown > 0 THEN
    SELECT n.id INTO v_last FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'campaign.status_changed' AND n.entity_key = 'campaign:' || NEW.id
       AND n.occurred_at > v_now - make_interval(mins => v_cooldown) AND n.payload ->> 'toStatus' = v_to
       AND n.content_status <> 'failed'
     ORDER BY n.occurred_at DESC LIMIT 1;
    IF FOUND THEN
      UPDATE public.auto_notifications
         SET payload = payload || jsonb_build_object('suppressedCount', coalesce((payload ->> 'suppressedCount')::integer, 0) + 1,
                                                    'lastOccurredAt', v_now),
             updated_at = v_now
       WHERE id = v_last;
      RETURN NULL;
    END IF;
  END IF;
  -- Gom: thông báo đầu tiên trong lúc yên gửi sau 30 giây; các thay đổi cùng trạng thái tiếp theo của nhân viên
  -- dồn vào mốc kế tiếp (cách lần gửi trước ≥ digest phút) để worker gộp thành 1 thông báo.
  v_deliver := v_now + interval '30 seconds';
  v_digest := private.aka_agent_notification_int_setting('notifications.digest_minutes.campaign', 10);
  IF v_digest > 0 THEN
    SELECT n.deliver_after, n.content_status INTO v_prev_deliver, v_prev_status FROM public.auto_notifications n
     WHERE n.staff_id = NEW.staff_id AND n.event_type = 'campaign.status_changed'
       AND n.deliver_after > v_now - make_interval(mins => v_digest)
       AND n.content_status IN ('pending', 'rendering', 'ready') AND n.payload ->> 'toStatus' = v_to
     ORDER BY n.deliver_after DESC LIMIT 1;
    IF FOUND THEN
      v_deliver := CASE WHEN v_prev_status = 'pending' THEN v_prev_deliver
                        ELSE greatest(v_deliver, v_prev_deliver + make_interval(mins => v_digest)) END;
    END IF;
  END IF;
  v_org := private.aka_agent_notification_staff_org(NEW.staff_id, NEW.organization_id);
  INSERT INTO public.auto_notifications (organization_id, staff_id, event_type, severity, campaign_id, account_id, entity_key,
                                         occurred_at, deliver_after, dedupe_key, payload)
  VALUES (v_org, NEW.staff_id, 'campaign.status_changed', CASE WHEN v_to = 'tạm dừng' THEN 'warning' ELSE 'info' END,
          NEW.id, NEW.account_id, 'campaign:' || NEW.id, v_now, v_deliver,
          format('cs:%s:%s:%s', NEW.id, v_to, txid_current()),
          jsonb_build_object('campaignId', NEW.id, 'campaignName', NEW.name, 'actionId', NEW.action_id, 'accountId', NEW.account_id,
                             'fromStatus', OLD.status, 'toStatus', v_to, 'note', NEW.note, 'changedAt', v_now,
                             'source', private.aka_agent_notification_change_source()))
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;

DO $grants$
DECLARE
  fn text;
  r text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['private.aka_agent_campaign_repeat_log_append(jsonb,jsonb)',
    'private.aka_agent_campaign_repeat_state(public.auto_campaigns)',
    'private.aka_agent_campaign_repeat_config(public.auto_campaigns)',
    'private.aka_agent_campaign_repeat_clamp(public.auto_campaigns,timestamp with time zone)',
    'private.aka_agent_campaign_repeat_core(public.auto_campaigns,timestamp with time zone,boolean,timestamp with time zone,text)',
    'private.aka_agent_campaign_repeat_confirm_end(bigint)',
    'private.aka_agent_campaign_repeat_will_reopen(public.auto_campaigns)',
    'private.aka_agent_campaign_repeat_sweeper_enabled()',
    'private.aka_agent_campaign_repeat_sync(bigint)',
    'private.aka_agent_campaign_repeat_sweep_one(bigint)',
    'private.aka_agent_campaign_repeat_assert_caller(bigint)',
    'public.aka_agent_campaign_repeat_sync_v1(bigint,bigint)',
    'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)',
    'public.aka_agent_campaign_repeat_state_v1(bigint,bigint[])',
    'public.aka_agent_campaign_repeat_tick_v1(integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    FOR r IN SELECT x FROM unnest(ARRAY['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']) x WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x) LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, r);
    END LOOP;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY['public.aka_agent_campaign_repeat_sync_v1(bigint,bigint)', 'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)', 'public.aka_agent_campaign_repeat_state_v1(bigint,bigint[])'] LOOP
    FOR r IN SELECT x FROM unnest(ARRAY['service_role', 'aka_agent_desktop']) x WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x) LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, r);
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.aka_agent_campaign_repeat_tick_v1(integer) TO service_role';
  END IF;
END $grants$;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('campaign.repeat_after_completion', '{"audience":"admin_akabiz","sweeper":true}',
  'Lặp lại chiến dịch sau khi chạy xong (V561). audience: off = ẩn, admin_akabiz = chỉ admin akaBiz thấy ô cài đặt, all = mọi tài khoản. sweeper: false = tắt khẩn bộ quét mở lại chiến dịch.',
  false, true);

DO $post$
DECLARE
  v_md5 text;
  v_bad text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'::regprocedure));
  IF v_md5 IS DISTINCT FROM 'd8c9a144ae30718e7a5aed5d58914fb1' THEN RAISE EXCEPTION 'V561 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = 'private.aka_agent_notification_capture_campaign()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '28c58b148172224c2f88885b55dcb3b9' THEN RAISE EXCEPTION 'V561 postflight: hàm ghi thông báo %', v_md5; END IF;
  SELECT string_agg(r.rolname || ' → ' || f.sig, '; ') INTO v_bad
    FROM unnest(ARRAY['private.aka_agent_campaign_repeat_log_append(jsonb,jsonb)', 'private.aka_agent_campaign_repeat_state(public.auto_campaigns)', 'private.aka_agent_campaign_repeat_config(public.auto_campaigns)', 'private.aka_agent_campaign_repeat_clamp(public.auto_campaigns,timestamp with time zone)', 'private.aka_agent_campaign_repeat_core(public.auto_campaigns,timestamp with time zone,boolean,timestamp with time zone,text)', 'private.aka_agent_campaign_repeat_confirm_end(bigint)', 'private.aka_agent_campaign_repeat_will_reopen(public.auto_campaigns)', 'private.aka_agent_campaign_repeat_sweeper_enabled()', 'private.aka_agent_campaign_repeat_sync(bigint)', 'private.aka_agent_campaign_repeat_sweep_one(bigint)', 'private.aka_agent_campaign_repeat_assert_caller(bigint)', 'public.aka_agent_campaign_repeat_sync_v1(bigint,bigint)', 'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)', 'public.aka_agent_campaign_repeat_state_v1(bigint,bigint[])', 'public.aka_agent_campaign_repeat_tick_v1(integer)']) AS f(sig)
    JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated', 'aka_agent_chat_api', 'service_role', 'aka_agent_desktop')
   WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE')
     AND NOT (f.sig = ANY (ARRAY['public.aka_agent_campaign_repeat_sync_v1(bigint,bigint)', 'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)', 'public.aka_agent_campaign_repeat_state_v1(bigint,bigint[])']) AND r.rolname IN ('service_role', 'aka_agent_desktop'))
     AND NOT (f.sig = 'public.aka_agent_campaign_repeat_tick_v1(integer)' AND r.rolname = 'service_role');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V561 postflight: quyền hàm quá rộng: %', v_bad; END IF;
END $post$;

COMMIT;
