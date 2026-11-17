// Sinh migrations/migration_v555_campaign_repeat_after_completion.sql và file gỡ. Không sửa tay hai file đó.
// "Lặp lại sau khi chạy xong": chiến dịch lịch Hàng ngày chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày, tới khi đủ số lượt
// tối đa hoặc tới ngày kết thúc. Phương án: akaAgentWebApp docs/CAMPAIGN_REPEAT_PLAN.md; hợp đồng: docs/CAMPAIGN_REPEAT_V555.md.
//
// Một nơi quyết định (private.aka_agent_campaign_repeat_core), ba nơi gọi:
//   * engine v2: aka_agent_engine_finish_campaign_v2 gọi thẳng (thân hàm vá từ bản V506 đang chạy, md5 khoá cứng);
//   * bộ chạy cũ Desktop / App Server: RPC aka_agent_campaign_repeat_decide_v1 lúc hết data;
//   * bộ quét dự phòng: RPC aka_agent_campaign_repeat_tick_v1 (API Web gọi theo đồng hồ) mở lại chiến dịch mà bộ chạy chưa biết
//     tính năng đã đánh "hoàn thành".
// Chạy: node scripts/build-v555-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v506 = require('./build-v506-sql.cjs')

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}
const bodyOf = block => /AS \$f\$([\s\S]*?)\$f\$;$/.exec(block)[1]

// ---- Thân hàm đang chạy trên production (đọc chỉ đọc 17/11/2026) ---------------------------------------------------------------
const FINISH_SIG = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'
const CAPTURE_SIG = 'private.aka_agent_notification_capture_campaign()'
const LIVE = { finish: '48625d957157f8392c966c153016df41', capture: '6e7b852c41ba7565622db56dbb8ec057' }

const fm = /CREATE OR REPLACE FUNCTION public\.aka_agent_engine_finish_campaign_v2\([\s\S]*?AS \$f\$([\s\S]*?)\$f\$;/.exec(v506.migration)
if (!fm) throw new Error('Không thấy finish_campaign_v2 trong V506')
if (md5(fm[1]) !== LIVE.finish || v506.NEW.finish !== LIVE.finish) throw new Error('Thân finish_campaign_v2 của V506 không còn khớp bản đang chạy (48625d95…)')
const finishLive = fm[0]

const V475 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v475_journey_campaign_notifications.sql'), 'utf8')
const cm = /CREATE OR REPLACE FUNCTION private\.aka_agent_notification_capture_campaign\(\)\nRETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS \$\$([\s\S]*?)\$\$;/.exec(V475)
if (!cm) throw new Error('Không thấy hàm ghi thông báo chiến dịch trong V475')
if (md5(cm[1]) !== LIVE.capture) throw new Error('Thân hàm ghi thông báo của V475 không còn khớp bản đang chạy (6e7b852c…)')
const captureLive = cm[0]

// ---- Vá hàm kết thúc lượt của engine v2 ------------------------------------------------------------------------------------------
let finish = finishLive
finish = patch(finish, `  v_rt_slot time;
BEGIN`, `  v_rt_slot time;
  -- V555: lặp lại sau khi chạy xong.
  v_repeat jsonb;
BEGIN`, 1, 'finish: biến lặp lại')
finish = patch(finish, `  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;
`, `  -- 5b. (V555) Lặp lại sau khi chạy xong: lịch Hàng ngày, x phút / giờ / ngày tính từ lúc chạy xong, tới khi đủ số lượt tối đa hoặc tới
  -- ngày kết thúc. Chỉ tính lượt khi lượt này thật sự chạy hết (không còn data chờ đã đến lịch) và còn data để chạy lại; các kiểm tra
  -- đó trùng với bước 6 nên bước 6 không rẽ nhánh khác sau khi đã đếm lượt.
  IF v_mode IS NULL AND v_extra->'repeatAfterCompletionEnabled' = 'true'::jsonb
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status = 'chờ xử lý')
     AND EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                  WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng') THEN
    v_repeat := private.aka_agent_campaign_repeat_core(c, v_now, true, NULL);
    IF (v_repeat->>'repeat')::boolean THEN
      v_next := (v_repeat->>'next')::timestamptz;
      v_mode := 'repeat_scheduled';
      v_suffix := 'ở lượt lặp kế tiếp';
    END IF;
  END IF;

  IF v_mode IS NULL THEN
    v_raw := public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed',
      CASE WHEN (v_repeat->>'enabled')::boolean THEN jsonb_build_object('repeat', v_repeat) END);
    IF (v_repeat->>'enabled')::boolean AND v_raw->>'campaignStatus' = 'hoàn thành' THEN
      PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
    END IF;
    RETURN v_raw;
  END IF;
`, 1, 'finish: nhánh lặp lại')
finish = patch(finish, `    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;
END $f$;`, `    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
    || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;
END $f$;`, 1, 'finish: trả thông tin lượt')

// ---- Vá hàm ghi thông báo: lượt giữa không báo "hoàn thành" ----------------------------------------------------------------------
let capture = captureLive
capture = patch(capture, `  v_cooldown := CASE WHEN v_to IN ('đang chạy', 'chờ xử lý')`, `  -- V555: chiến dịch đang bật "Lặp lại sau khi chạy xong" mà bộ chạy chưa biết tính năng đánh "hoàn thành" ở lượt giữa: bộ quét sẽ mở
  -- lại ngay sau đó, nên không báo. Lượt cuối (đủ số lượt, tới ngày kết thúc) báo như thường. Bộ quét đang tắt, hàm chưa có hoặc
  -- hàm lỗi: báo như chiến dịch thường.
  IF v_to = 'hoàn thành' AND NEW.extra_settings -> 'repeatAfterCompletionEnabled' = 'true'::jsonb
     AND to_regprocedure('private.aka_agent_campaign_repeat_will_reopen(public.auto_campaigns)') IS NOT NULL THEN
    IF private.aka_agent_campaign_repeat_will_reopen(NEW) THEN RETURN NULL; END IF;
  END IF;
  v_cooldown := CASE WHEN v_to IN ('đang chạy', 'chờ xử lý')`, 1, 'capture: lượt giữa')
const captureBody = block => /AS \$\$([\s\S]*?)\$\$;$/.exec(block)[1]

// ---- Đối tượng mới ----------------------------------------------------------------------------------------------------------------
const SETTING_KEY = 'campaign.repeat_after_completion'
const SIGS = {
  config: 'private.aka_agent_campaign_repeat_config(public.auto_campaigns)',
  clamp: 'private.aka_agent_campaign_repeat_clamp(public.auto_campaigns,timestamp with time zone)',
  core: 'private.aka_agent_campaign_repeat_core(public.auto_campaigns,timestamp with time zone,boolean,timestamp with time zone)',
  confirm: 'private.aka_agent_campaign_repeat_confirm_end(bigint)',
  willReopen: 'private.aka_agent_campaign_repeat_will_reopen(public.auto_campaigns)',
  sweeper: 'private.aka_agent_campaign_repeat_sweeper_enabled()',
  sync: 'private.aka_agent_campaign_repeat_sync(bigint)',
  sweepOne: 'private.aka_agent_campaign_repeat_sweep_one(bigint)',
  caller: 'private.aka_agent_campaign_repeat_assert_caller(bigint)',
  syncV1: 'public.aka_agent_campaign_repeat_sync_v1(bigint,bigint)',
  decideV1: 'public.aka_agent_campaign_repeat_decide_v1(bigint,bigint)',
  stateV1: 'public.aka_agent_campaign_repeat_state_v1(bigint,bigint[])',
  tickV1: 'public.aka_agent_campaign_repeat_tick_v1(integer)',
}

const objects = `CREATE TABLE private.auto_campaign_repeat_state (
  campaign_id bigint PRIMARY KEY,
  staff_id bigint,
  -- Dấu vân tay cài đặt lặp (every, unit, maxRuns, endEpoch). Đổi cài đặt = bắt đầu đếm lại.
  config jsonb NOT NULL,
  -- Lúc bắt đầu đếm (bật lặp, đổi cài đặt, hoặc chạy lại sau khi đã hết lượt). Bộ quét chỉ xét lần hoàn thành sau mốc này.
  armed_at timestamptz NOT NULL,
  runs_done integer NOT NULL DEFAULT 0,
  last_completed_at timestamptz,
  next_run_at timestamptz,
  -- Lượt cuối đã được đếm, chờ chiến dịch chuyển "hoàn thành" (bộ chạy gọi trước khi hoàn thành).
  finishing boolean NOT NULL DEFAULT false,
  finish_reason text,
  -- Đã kết thúc vòng lặp: max_runs | end_date | no_rerun_data | error.
  ended_reason text,
  ended_at timestamptz,
  -- auto_campaigns.completed_at mà bộ quét đã xử lý xong.
  handled_completed_at timestamptz,
  error_count integer NOT NULL DEFAULT 0,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE private.auto_campaign_repeat_state IS
  'V555: bộ đếm lượt của "Lặp lại sau khi chạy xong". Cài đặt nằm ở auto_campaigns.extra_settings (repeatAfterCompletion*); bảng này chỉ do hàm private.aka_agent_campaign_repeat_* ghi.';
ALTER TABLE private.auto_campaign_repeat_state ENABLE ROW LEVEL SECURITY;

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
                        'zalo_cancel_sent_friend_request', 'facebook_newsfeed_interaction', 'facebook_find_data_group',
                        'facebook_find_data_search', 'facebook_comment_seeding', 'sms_send', 'voice_call') THEN
    RETURN NULL;
  END IF;
  v_unit := CASE WHEN jsonb_typeof(v_extra->'repeatAfterCompletionUnit') = 'string' THEN v_extra->>'repeatAfterCompletionUnit' END;
  v_raw := v_extra->'repeatAfterCompletionEvery';
  v_every := CASE
    WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\\d{1,5}$' THEN (v_raw #>> '{}')::integer
    WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\\d{1,5}$' THEN btrim(v_raw #>> '{}')::integer END;
  v_raw := v_extra->'repeatAfterCompletionMaxRuns';
  v_max := CASE
    WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\\d{1,5}$' THEN (v_raw #>> '{}')::integer
    WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\\d{1,5}$' THEN btrim(v_raw #>> '{}')::integer END;
  IF v_every IS NULL OR v_max IS NULL OR v_max NOT BETWEEN 2 AND 100 THEN RETURN NULL; END IF;
  IF v_unit = 'minute' THEN
    -- Phút chỉ dành cho nhắn bạn bè / nhắn group đang gửi dạng chia sẻ (gộp từ "Gửi lặp lại sau mỗi x phút").
    IF v_every NOT BETWEEN 5 AND 1439 OR c.action_id NOT IN ('zalo_message_friend', 'zalo_message_group')
       OR v_extra->>'zaloMessageSendMode' IS DISTINCT FROM 'share' THEN RETURN NULL; END IF;
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
  p_not_before timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Quyết định sau một lượt chạy hết danh sách: lặp tiếp (repeat = true, next = giờ lượt kế) hay kết thúc (max_runs | end_date).
-- p_apply = true: ghi bộ đếm (gọi đúng một lần cho mỗi lượt đã chạy hết). p_apply = false: chỉ xem trước, không ghi gì.
-- p_not_before: lượt kế không sớm hơn mốc này (bộ quét xử lý trễ). Không đổi chiến dịch hay data; nơi gọi tự đặt lại data và hẹn lịch.
--   * unit = day: Giờ chạy của ngày (ngày chạy xong + every).
--   * unit = minute / hour: lúc chạy xong + every, rồi đưa vào khung giờ chạy.
--   * Lượt kế từ ngày kết thúc trở đi, hoặc đã đủ maxRuns lượt (tính cả lượt đầu): kết thúc.
-- Vòng đếm bắt đầu lại khi cài đặt lặp đổi, hoặc khi vòng trước đã kết thúc mà chiến dịch lại chạy hết một lượt nữa.
DECLARE
  v_now timestamptz := clock_timestamp();
  v_cfg jsonb := private.aka_agent_campaign_repeat_config(c);
  v_fp jsonb;
  s private.auto_campaign_repeat_state%ROWTYPE;
  v_new_cycle boolean;
  v_runs integer;
  v_max integer;
  v_next timestamptz;
  v_local timestamp;
  v_src timestamp;
  v_repeat boolean;
  v_reason text;
BEGIN
  IF v_cfg IS NULL THEN
    IF p_apply THEN DELETE FROM private.auto_campaign_repeat_state WHERE campaign_id = c.id; END IF;
    RETURN jsonb_build_object('enabled', false, 'repeat', false);
  END IF;
  v_max := (v_cfg->>'maxRuns')::integer;
  v_fp := v_cfg || jsonb_build_object('endEpoch', floor(extract(epoch FROM c.schedule_end_date))::bigint);
  IF p_apply THEN
    SELECT * INTO s FROM private.auto_campaign_repeat_state WHERE campaign_id = c.id FOR UPDATE;
  ELSE
    SELECT * INTO s FROM private.auto_campaign_repeat_state WHERE campaign_id = c.id;
  END IF;
  v_new_cycle := s.campaign_id IS NULL OR s.config IS DISTINCT FROM v_fp OR s.ended_reason IS NOT NULL;
  IF NOT v_new_cycle AND s.finishing THEN
    -- Lượt cuối đã đếm nhưng chiến dịch chưa hoàn thành (có data mới giữa chừng): vẫn là lượt cuối đó, không đếm thêm.
    RETURN jsonb_build_object('enabled', true, 'repeat', false, 'reason', s.finish_reason, 'run', s.runs_done, 'maxRuns', v_max,
      'every', v_cfg->'every', 'unit', v_cfg->'unit', 'finishing', true);
  END IF;
  v_runs := CASE WHEN v_new_cycle THEN 0 ELSE s.runs_done END + 1;
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
    INSERT INTO private.auto_campaign_repeat_state AS st (campaign_id, staff_id, config, armed_at, runs_done, last_completed_at,
      next_run_at, finishing, finish_reason, ended_reason, ended_at, error_count, last_error, last_error_at, updated_at)
    VALUES (c.id, c.staff_id, v_fp, v_now, v_runs, p_done_at, v_next, NOT v_repeat, CASE WHEN v_repeat THEN NULL ELSE v_reason END,
      NULL, NULL, 0, NULL, NULL, v_now)
    ON CONFLICT (campaign_id) DO UPDATE SET
      staff_id = EXCLUDED.staff_id, config = EXCLUDED.config,
      armed_at = CASE WHEN v_new_cycle AND st.config IS DISTINCT FROM EXCLUDED.config THEN EXCLUDED.armed_at ELSE st.armed_at END,
      runs_done = EXCLUDED.runs_done, last_completed_at = EXCLUDED.last_completed_at, next_run_at = EXCLUDED.next_run_at,
      finishing = EXCLUDED.finishing, finish_reason = EXCLUDED.finish_reason, ended_reason = NULL, ended_at = NULL,
      error_count = 0, last_error = NULL, last_error_at = NULL, updated_at = EXCLUDED.updated_at;
  END IF;
  RETURN jsonb_build_object('enabled', true, 'repeat', v_repeat, 'reason', v_reason, 'run', v_runs, 'maxRuns', v_max,
    'every', v_cfg->'every', 'unit', v_cfg->'unit') || CASE WHEN v_next IS NOT NULL THEN jsonb_build_object('next', v_next) ELSE '{}'::jsonb END;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_confirm_end(p_campaign_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Chiến dịch đã thật sự "hoàn thành" sau lượt cuối: chốt vòng lặp. Lần chạy hết kế tiếp (người dùng cho chạy lại) mở vòng mới.
BEGIN
  UPDATE private.auto_campaign_repeat_state st
     SET ended_reason = coalesce(st.finish_reason, 'max_runs'), ended_at = clock_timestamp(), finishing = false, next_run_at = NULL,
         handled_completed_at = (SELECT c.completed_at FROM public.auto_campaigns c WHERE c.id = p_campaign_id),
         updated_at = clock_timestamp()
   WHERE st.campaign_id = p_campaign_id AND st.finishing;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_sweeper_enabled()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Khoá tắt khẩn bộ quét: auto_system_settings '${SETTING_KEY}' có "sweeper": false. Thiếu dòng, dòng tắt, sai JSON = bật.
DECLARE v_value text;
BEGIN
  SELECT s.value INTO v_value FROM public.auto_system_settings s WHERE s.key = '${SETTING_KEY}' AND s.is_active LIMIT 1;
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
BEGIN
  -- Cùng điều kiện với bộ quét (aka_agent_campaign_repeat_sweep_one): đã đăng ký trước lần hoàn thành này, còn data để chạy lại.
  IF NOT EXISTS (SELECT 1 FROM private.auto_campaign_repeat_state st
                  WHERE st.campaign_id = c.id AND coalesce(c.completed_at, clock_timestamp()) >= st.armed_at) THEN RETURN false; END IF;
  IF NOT private.aka_agent_campaign_repeat_sweeper_enabled() THEN RETURN false; END IF;
  IF c.action_id IS DISTINCT FROM 'facebook_timeline_post'
     AND NOT EXISTS (SELECT 1 FROM public.auto_campaign_input_data d
                      WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false AND d.status <> 'tạm dừng') THEN
    RETURN false;
  END IF;
  RETURN coalesce((private.aka_agent_campaign_repeat_core(c, clock_timestamp(), false, clock_timestamp())->>'repeat')::boolean, false);
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_sync(p_campaign_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Gọi sau khi lưu chiến dịch: đăng ký / gỡ đăng ký lặp theo cài đặt hiện tại. Cài đặt lặp không đổi thì giữ nguyên bộ đếm; đổi (hoặc
-- bật lần đầu) thì đếm lại từ 0 và chỉ tính các lần chạy hết sau thời điểm này.
DECLARE
  v_now timestamptz := clock_timestamp();
  c public.auto_campaigns%ROWTYPE;
  v_cfg jsonb;
  v_fp jsonb;
  s private.auto_campaign_repeat_state%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id;
  IF c.id IS NOT NULL THEN v_cfg := private.aka_agent_campaign_repeat_config(c); END IF;
  IF v_cfg IS NULL THEN
    DELETE FROM private.auto_campaign_repeat_state WHERE campaign_id = p_campaign_id;
    RETURN jsonb_build_object('enabled', false);
  END IF;
  v_fp := v_cfg || jsonb_build_object('endEpoch', floor(extract(epoch FROM c.schedule_end_date))::bigint);
  INSERT INTO private.auto_campaign_repeat_state AS st (campaign_id, staff_id, config, armed_at, updated_at)
  VALUES (c.id, c.staff_id, v_fp, v_now, v_now)
  ON CONFLICT (campaign_id) DO UPDATE SET
    staff_id = EXCLUDED.staff_id, config = EXCLUDED.config, armed_at = EXCLUDED.armed_at, runs_done = 0, last_completed_at = NULL,
    next_run_at = NULL, finishing = false, finish_reason = NULL, ended_reason = NULL, ended_at = NULL, handled_completed_at = NULL,
    error_count = 0, last_error = NULL, last_error_at = NULL, updated_at = EXCLUDED.updated_at
  WHERE st.config IS DISTINCT FROM EXCLUDED.config;
  SELECT * INTO s FROM private.auto_campaign_repeat_state WHERE campaign_id = c.id;
  RETURN jsonb_build_object('enabled', true, 'runsDone', s.runs_done, 'maxRuns', (v_cfg->>'maxRuns')::integer,
    'every', v_cfg->'every', 'unit', v_cfg->'unit', 'nextRunAt', s.next_run_at, 'endedReason', s.ended_reason);
END $f$;

CREATE FUNCTION private.aka_agent_campaign_repeat_sweep_one(p_campaign_id bigint)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
-- Bộ quét, một chiến dịch đã "hoàn thành": đếm lượt vừa xong rồi mở lại (đặt lại data như bộ chạy: mọi data trừ "tạm dừng" về
-- "chờ xử lý"; chiến dịch về "chờ xử lý" với lịch là giờ lượt kế), hoặc chốt kết thúc. Trả: reopened | ended | skipped | busy | gone.
DECLARE
  v_now timestamptz := clock_timestamp();
  c public.auto_campaigns%ROWTYPE;
  s private.auto_campaign_repeat_state%ROWTYPE;
  v_dec jsonb;
  v_next timestamptz;
  v_total bigint;
  v_resettable bigint;
  v_line text;
BEGIN
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id FOR UPDATE SKIP LOCKED;
  IF c.id IS NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.auto_campaigns x WHERE x.id = p_campaign_id) THEN
      DELETE FROM private.auto_campaign_repeat_state WHERE campaign_id = p_campaign_id;
      RETURN 'gone';
    END IF;
    RETURN 'busy';
  END IF;
  IF coalesce(c.is_delete, false) THEN
    DELETE FROM private.auto_campaign_repeat_state WHERE campaign_id = c.id;
    RETURN 'gone';
  END IF;
  SELECT * INTO s FROM private.auto_campaign_repeat_state WHERE campaign_id = c.id FOR UPDATE;
  IF s.campaign_id IS NULL OR c.status IS DISTINCT FROM 'hoàn thành' OR c.completed_at IS NULL
     OR c.completed_at IS NOT DISTINCT FROM s.handled_completed_at OR c.completed_at < s.armed_at THEN
    RETURN 'skipped';
  END IF;
  -- Bộ chạy cũ còn giữ chiến dịch (token treo): chờ lượt quét sau.
  IF c.runtime_claim_token IS NOT NULL OR c.runtime_unit_token IS NOT NULL THEN RETURN 'busy'; END IF;

  v_dec := private.aka_agent_campaign_repeat_core(c, c.completed_at, true, v_now);
  IF NOT (v_dec->>'enabled')::boolean THEN RETURN 'skipped'; END IF;
  IF NOT (v_dec->>'repeat')::boolean THEN
    PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
    RETURN 'ended';
  END IF;
  v_next := (v_dec->>'next')::timestamptz;
  SELECT count(*), count(*) FILTER (WHERE d.status <> 'tạm dừng') INTO v_total, v_resettable
    FROM public.auto_campaign_input_data d WHERE d.campaign_id = c.id AND coalesce(d.is_delete, false) = false;
  -- Như rescheduleCompletedCampaignPass: không còn data để chạy lại thì kết thúc. Chỉ đăng trang cá nhân Facebook chạy không cần data.
  IF (v_total > 0 AND v_resettable = 0) OR (v_total = 0 AND c.action_id <> 'facebook_timeline_post') THEN
    UPDATE private.auto_campaign_repeat_state
       SET ended_reason = 'no_rerun_data', ended_at = v_now, finishing = false, next_run_at = NULL,
           handled_completed_at = c.completed_at, updated_at = v_now
     WHERE campaign_id = c.id;
    RETURN 'ended';
  END IF;
  IF v_resettable > 0 THEN
    UPDATE public.auto_campaign_input_data SET status = 'chờ xử lý', note = '', date_action = NULL
     WHERE campaign_id = c.id AND coalesce(is_delete, false) = false AND status <> 'tạm dừng';
  END IF;
  UPDATE public.auto_campaigns SET status = 'chờ xử lý', schedule = v_next, note = NULL, completed_at = NULL, updated_at = v_now
   WHERE id = c.id;
  UPDATE private.auto_campaign_repeat_state SET handled_completed_at = c.completed_at, updated_at = v_now WHERE campaign_id = c.id;
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
-- Bộ chạy cũ (Desktop, App Server) gọi khi một lượt vừa chạy hết danh sách và chiến dịch còn "đang chạy", trước khi hoàn thành:
-- đếm lượt và trả quyết định. repeat = true thì bộ chạy đặt lại data và hẹn lịch tới "next" (rescheduleCompletedCampaignPass);
-- false thì hoàn thành chiến dịch như thường.
DECLARE c public.auto_campaigns%ROWTYPE;
BEGIN
  PERFORM private.aka_agent_campaign_repeat_assert_caller(p_staff_id);
  SELECT * INTO c FROM public.auto_campaigns WHERE id = p_campaign_id AND staff_id = p_staff_id FOR UPDATE;
  IF c.id IS NULL OR coalesce(c.is_delete, false) THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF c.status IS DISTINCT FROM 'đang chạy' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_running', 'campaignStatus', c.status);
  END IF;
  RETURN jsonb_build_object('ok', true) || private.aka_agent_campaign_repeat_core(c, clock_timestamp(), true, NULL);
END $f$;

CREATE FUNCTION public.aka_agent_campaign_repeat_state_v1(p_staff_id bigint, p_campaign_ids bigint[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $f$
-- Bộ đếm lượt để hiển thị ("lượt i/n, lượt kế lúc …"). Tối đa 200 chiến dịch mỗi lần, chỉ chiến dịch của p_staff_id.
BEGIN
  PERFORM private.aka_agent_campaign_repeat_assert_caller(p_staff_id);
  IF coalesce(cardinality(p_campaign_ids), 0) > 200 THEN RAISE EXCEPTION 'too_many_campaigns' USING ERRCODE = '22023'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('campaignId', st.campaign_id, 'runsDone', st.runs_done, 'maxRuns', (st.config->>'maxRuns')::integer,
        'every', st.config->'every', 'unit', st.config->'unit', 'nextRunAt', st.next_run_at, 'lastCompletedAt', st.last_completed_at,
        'finishing', st.finishing, 'endedReason', st.ended_reason, 'endedAt', st.ended_at) ORDER BY st.campaign_id)
      FROM private.auto_campaign_repeat_state st
      JOIN public.auto_campaigns c ON c.id = st.campaign_id
     WHERE st.campaign_id = ANY (coalesce(p_campaign_ids, '{}'::bigint[])) AND c.staff_id = p_staff_id AND coalesce(c.is_delete, false) = false
  ), '[]'::jsonb);
END $f$;

CREATE FUNCTION public.aka_agent_campaign_repeat_tick_v1(p_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET statement_timeout = '50s' AS $f$
-- Bộ quét dự phòng (API Web gọi theo đồng hồ): chiến dịch đã đăng ký lặp mà bộ chạy đánh "hoàn thành" thì đếm lượt và mở lại, hoặc
-- chốt kết thúc. Mỗi chiến dịch một giao dịch con: lỗi của chiến dịch này không chặn chiến dịch khác; lỗi 5 lượt liền thì thôi lặp.
-- Một lượt quét tại một thời điểm; dừng nhận thêm sau 30 giây.
DECLARE
  v_started timestamptz := clock_timestamp();
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 200);
  r record;
  v_out text;
  v_err text;
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
    SELECT st.campaign_id, c.completed_at
      FROM private.auto_campaign_repeat_state st
      JOIN public.auto_campaigns c ON c.id = st.campaign_id
     WHERE c.status = 'hoàn thành' AND c.completed_at IS NOT NULL AND coalesce(c.is_delete, false) = false
       AND c.completed_at IS DISTINCT FROM st.handled_completed_at AND c.completed_at >= st.armed_at
     ORDER BY c.completed_at
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
      UPDATE private.auto_campaign_repeat_state st
         SET error_count = st.error_count + 1, last_error = left(v_err, 500), last_error_at = clock_timestamp(),
             ended_reason = CASE WHEN st.error_count + 1 >= 5 THEN 'error' ELSE st.ended_reason END,
             ended_at = CASE WHEN st.error_count + 1 >= 5 THEN clock_timestamp() ELSE st.ended_at END,
             finishing = CASE WHEN st.error_count + 1 >= 5 THEN false ELSE st.finishing END,
             handled_completed_at = CASE WHEN st.error_count + 1 >= 5 THEN r.completed_at ELSE st.handled_completed_at END,
             updated_at = clock_timestamp()
       WHERE st.campaign_id = r.campaign_id;
    END;
  END LOOP;
  -- Chiến dịch đã xoá: bỏ dòng đếm.
  DELETE FROM private.auto_campaign_repeat_state st USING public.auto_campaigns c
   WHERE c.id = st.campaign_id AND coalesce(c.is_delete, false);
  RETURN jsonb_build_object('ok', true, 'enabled', true, 'reopened', v_reopened, 'ended', v_ended, 'skipped', v_skipped, 'failed', v_failed);
END $f$;`

const PRIVATE_FNS = [SIGS.config, SIGS.clamp, SIGS.core, SIGS.confirm, SIGS.willReopen, SIGS.sweeper, SIGS.sync, SIGS.sweepOne, SIGS.caller]
const DESKTOP_AND_SERVICE = [SIGS.syncV1, SIGS.decideV1, SIGS.stateV1]
const SERVICE_ONLY = [SIGS.tickV1]
const ALL_ROLES = ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']

const NEW = { finish: md5(bodyOf(finish)), capture: md5(captureBody(capture)) }

const grants = `DO $grants$
DECLARE
  fn text;
  r text;
BEGIN
  FOR r IN SELECT x FROM unnest(ARRAY[${ALL_ROLES.map(x => `'${x}'`).join(', ')}]) x WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x) LOOP
    EXECUTE format('REVOKE ALL ON TABLE private.auto_campaign_repeat_state FROM %I', r);
  END LOOP;
  REVOKE ALL ON TABLE private.auto_campaign_repeat_state FROM PUBLIC;
  FOREACH fn IN ARRAY ARRAY[${[...PRIVATE_FNS, ...DESKTOP_AND_SERVICE, ...SERVICE_ONLY].map(x => `'${x}'`).join(',\n    ')}] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
    FOR r IN SELECT x FROM unnest(ARRAY[${ALL_ROLES.map(x => `'${x}'`).join(', ')}]) x WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x) LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', fn, r);
    END LOOP;
  END LOOP;
  FOREACH fn IN ARRAY ARRAY[${DESKTOP_AND_SERVICE.map(x => `'${x}'`).join(', ')}] LOOP
    FOR r IN SELECT x FROM unnest(ARRAY['service_role', 'aka_agent_desktop']) x WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = x) LOOP
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', fn, r);
    END LOOP;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION ${SIGS.tickV1} TO service_role';
  END IF;
END $grants$;`

const migration = `-- V555: "Lặp lại sau khi chạy xong" cho chiến dịch lịch Hàng ngày (17/11/2026).
-- SINH TỪ scripts/build-v555-sql.cjs, không sửa tay. Hợp đồng: docs/CAMPAIGN_REPEAT_V555.md; phương án: akaAgentWebApp
-- docs/CAMPAIGN_REPEAT_PLAN.md.
--
-- Chiến dịch chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày (tính từ lúc chạy xong), tới khi đủ số lượt tối đa hoặc tới
-- ngày kết thúc. Cài đặt nằm ở auto_campaigns.extra_settings: repeatAfterCompletionEnabled / Every / Unit / MaxRuns; ngày kết thúc
-- ở schedule_end_date. Chưa chiến dịch nào có các khoá này nên apply xong chưa đổi hành vi của chiến dịch nào.
--   * Bảng mới private.auto_campaign_repeat_state (bộ đếm lượt; RLS bật, không cấp quyền cho ai).
--   * Hàm mới private.aka_agent_campaign_repeat_* (luật lặp) và bốn RPC public: sync_v1, decide_v1, state_v1 (service_role +
--     aka_agent_desktop), tick_v1 (service_role).
--   * aka_agent_engine_finish_campaign_v2 (thân V506, md5 khoá cứng): thêm nhánh 5b gọi luật lặp trước khi hoàn thành.
--   * private.aka_agent_notification_capture_campaign (thân V475, md5 khoá cứng): lượt giữa không báo "hoàn thành".
--   * auto_system_settings '${SETTING_KEY}' = {"audience":"admin_akabiz","sweeper":true} (off | admin_akabiz | all; "sweeper": false
--     tắt khẩn bộ quét).
-- Không ALTER bảng nào. CREATE FUNCTION làm PostgREST nạp lại schema: apply ngoài giờ cao điểm.
-- Gỡ: rollback_v555_campaign_repeat_after_completion.sql.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v555_%') THEN
      RAISE EXCEPTION 'V555 đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;
  IF to_regclass('private.auto_campaign_repeat_state') IS NOT NULL THEN RAISE EXCEPTION 'V555: bảng đếm lượt đã có'; END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN RAISE EXCEPTION 'V555 cần private.aka_agent_desktop_data_context() (V436)'; END IF;
  IF to_regprocedure('public.aka_agent_engine_finalize_v501(bigint,text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'V555 cần V501'; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${FINISH_SIG}');
  IF v_md5 IS DISTINCT FROM '${LIVE.finish}' THEN RAISE EXCEPTION 'V555: thân aka_agent_engine_finish_campaign_v2 khác V506 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${CAPTURE_SIG}');
  IF v_md5 IS DISTINCT FROM '${LIVE.capture}' THEN RAISE EXCEPTION 'V555: thân hàm ghi thông báo chiến dịch khác V475 (%)', v_md5; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = '${SETTING_KEY}') THEN RAISE EXCEPTION 'V555: dòng công tắc đã có'; END IF;
END $pre$;

${objects}

${finish}

${capture}

${grants}

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('${SETTING_KEY}', '{"audience":"admin_akabiz","sweeper":true}',
  'Lặp lại chiến dịch sau khi chạy xong (V555). audience: off = ẩn, admin_akabiz = chỉ admin akaBiz thấy ô cài đặt, all = mọi tài khoản. sweeper: false = tắt khẩn bộ quét mở lại chiến dịch.',
  false, true);

DO $post$
DECLARE
  v_md5 text;
  v_bad text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${FINISH_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.finish}' THEN RAISE EXCEPTION 'V555 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${CAPTURE_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.capture}' THEN RAISE EXCEPTION 'V555 postflight: hàm ghi thông báo %', v_md5; END IF;
  SELECT string_agg(r.rolname || ' → ' || f.sig, '; ') INTO v_bad
    FROM unnest(ARRAY[${[...PRIVATE_FNS, ...DESKTOP_AND_SERVICE, ...SERVICE_ONLY].map(x => `'${x}'`).join(', ')}]) AS f(sig)
    JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated', 'aka_agent_chat_api', 'service_role', 'aka_agent_desktop')
   WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE')
     AND NOT (f.sig = ANY (ARRAY[${DESKTOP_AND_SERVICE.map(x => `'${x}'`).join(', ')}]) AND r.rolname IN ('service_role', 'aka_agent_desktop'))
     AND NOT (f.sig = '${SIGS.tickV1}' AND r.rolname = 'service_role');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V555 postflight: quyền hàm quá rộng: %', v_bad; END IF;
  SELECT string_agg(r.rolname, ', ') INTO v_bad FROM pg_roles r
   WHERE r.rolname IN ('anon', 'authenticated', 'aka_agent_chat_api', 'service_role', 'aka_agent_desktop')
     AND has_table_privilege(r.rolname, 'private.auto_campaign_repeat_state', 'SELECT, INSERT, UPDATE, DELETE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V555 postflight: quyền bảng đếm lượt quá rộng: %', v_bad; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'private.auto_campaign_repeat_state'::regclass) THEN
    RAISE EXCEPTION 'V555 postflight: bảng đếm lượt chưa bật RLS';
  END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V555: trả hàm kết thúc lượt của engine v2 về thân V506, hàm ghi thông báo về thân V475, xoá hàm, bảng đếm lượt và dòng công tắc.
-- SINH TỪ scripts/build-v555-sql.cjs. Chiến dịch đang chờ lượt lặp kế tiếp vẫn chạy lượt đó (đã là "chờ xử lý" với lịch tương lai), sau
-- đó hoàn thành như chiến dịch thường. Trước khi gỡ: API Web phải ngừng gọi bốn RPC (tắt công tắc: audience off, sweeper false) và
-- bộ chạy Desktop / App Server bản có gọi decide_v1 tự coi "chưa có hàm" là không lặp.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regclass('private.auto_campaign_repeat_state') IS NULL THEN RAISE EXCEPTION 'Gỡ V555: chưa có V555'; END IF;
END $pre$;

${finishLive}

${captureLive}

DROP FUNCTION ${SIGS.tickV1};
DROP FUNCTION ${SIGS.stateV1};
DROP FUNCTION ${SIGS.decideV1};
DROP FUNCTION ${SIGS.syncV1};
DROP FUNCTION ${SIGS.caller};
DROP FUNCTION ${SIGS.sweepOne};
DROP FUNCTION ${SIGS.sync};
DROP FUNCTION ${SIGS.willReopen};
DROP FUNCTION ${SIGS.sweeper};
DROP FUNCTION ${SIGS.confirm};
DROP FUNCTION ${SIGS.core};
DROP FUNCTION ${SIGS.clamp};
DROP FUNCTION ${SIGS.config};
DROP TABLE private.auto_campaign_repeat_state;
DELETE FROM public.auto_system_settings WHERE key = '${SETTING_KEY}';

DO $post$
DECLARE v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${FINISH_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.finish}' THEN RAISE EXCEPTION 'Gỡ V555 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${CAPTURE_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.capture}' THEN RAISE EXCEPTION 'Gỡ V555 postflight: hàm ghi thông báo %', v_md5; END IF;
END $post$;

COMMIT;
`

module.exports = { migration, rollback, LIVE, NEW, SIGS, SETTING_KEY, FINISH_SIG, CAPTURE_SIG }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, 'migrations/migration_v555_campaign_repeat_after_completion.sql'), migration)
  fs.writeFileSync(path.join(ROOT, 'migrations/rollback_v555_campaign_repeat_after_completion.sql'), rollback)
  console.log('V555 migration', md5(migration), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
