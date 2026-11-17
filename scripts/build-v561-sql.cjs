// Sinh migrations/migration_v561_campaign_repeat_after_completion_p1.sql, _p2.sql và file gỡ. Không sửa tay ba file đó.
// "Lặp lại sau khi chạy xong": chiến dịch lịch Hàng ngày chạy hết danh sách thì tự chạy lại sau x phút / giờ / ngày, tới khi đủ số lượt
// tối đa hoặc tới ngày kết thúc. Phương án: akaAgentWebApp docs/CAMPAIGN_REPEAT_PLAN.md; hợp đồng: docs/CAMPAIGN_REPEAT_V561.md.
//
// Bộ đếm lượt nằm ở hai cột của auto_campaigns (repeat_runs_done, repeat_log), không có bảng riêng.
// Một nơi quyết định (private.aka_agent_campaign_repeat_core), ba nơi gọi:
//   * engine v2: aka_agent_engine_finish_campaign_v2 gọi thẳng (thân hàm vá từ bản V558 đang chạy, md5 pg_get_functiondef khoá cứng);
//   * bộ chạy cũ Desktop: RPC aka_agent_campaign_repeat_decide_v1 lúc hết data;
//   * bộ quét dự phòng: RPC aka_agent_campaign_repeat_tick_v1 (API Web gọi theo đồng hồ) mở lại chiến dịch mà bộ chạy chưa biết
//     tính năng đã đánh "hoàn thành" (App Server, Desktop bản cũ, bộ cũ của ChatApi).
// Chạy: node scripts/build-v561-sql.cjs
'use strict'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const md5 = text => crypto.createHash('md5').update(text).digest('hex')
const v558 = require('./build-v558-sql.cjs')

function patch(text, from, to, count, label) {
  const n = text.split(from).length - 1
  if (n !== count) throw new Error(`${label}: cần ${count} chỗ, thấy ${n}`)
  return text.split(from).join(to)
}

// ---- Thân hàm đang chạy trên production (đọc chỉ đọc 17/11/2026 sau V558) -------------------------------------------------------
// finish: pg_get_functiondef nguyên văn của bản V558 (md5 pg_get_functiondef như V558 kiểm); capture: md5(prosrc) của bản V475.
const FINISH_SIG = 'public.aka_agent_engine_finish_campaign_v2(bigint,uuid,text)'
const CAPTURE_SIG = 'private.aka_agent_notification_capture_campaign()'
const LIVE = { finish: 'ffccdf1f6d95d6ed877c22abe945ae0b', capture: '6e7b852c41ba7565622db56dbb8ec057' }

const finishLive = v558.texts.new.finish
if (md5(finishLive) !== LIVE.finish || v558.NEW_MD5.finish !== LIVE.finish) throw new Error('Thân finish_campaign_v2 của V558 không còn khớp bản đang chạy (ffccdf1f…)')

const V475 = fs.readFileSync(path.join(ROOT, 'migrations/migration_v475_journey_campaign_notifications.sql'), 'utf8')
const cm = /CREATE OR REPLACE FUNCTION private\.aka_agent_notification_capture_campaign\(\)\nRETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS \$\$([\s\S]*?)\$\$;/.exec(V475)
if (!cm) throw new Error('Không thấy hàm ghi thông báo chiến dịch trong V475')
if (md5(cm[1]) !== LIVE.capture) throw new Error('Thân hàm ghi thông báo của V475 không còn khớp bản đang chạy (6e7b852c…)')
const captureLive = cm[0]

// ---- Vá hàm kết thúc lượt của engine v2 ------------------------------------------------------------------------------------------
let finish = finishLive
finish = patch(finish, `  -- V558: chạy lại sau N giờ (giờ, số nguyên ≥ 1).
  v_hours numeric;
BEGIN`, `  -- V558: chạy lại sau N giờ (giờ, số nguyên ≥ 1).
  v_hours numeric;
  -- V561: lặp lại sau khi chạy xong.
  v_repeat jsonb;
BEGIN`, 1, 'finish: biến lặp lại')
finish = patch(finish, `  -- V558: chạy lại sau N giờ khi xong`, `  -- 5b. (V561) Lặp lại sau khi chạy xong: lịch Hàng ngày, x phút / giờ / ngày tính từ lúc chạy xong, tới khi đủ số lượt tối đa hoặc tới
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

  -- V558: chạy lại sau N giờ khi xong`, 1, 'finish: nhánh lặp lại')
finish = patch(finish, `  IF v_mode IS NULL AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction')
     AND v_extra->'findDataRerunEnabled' = 'true'::jsonb THEN`, `  IF v_mode IS NULL AND v_repeat IS NULL
     AND c.action_id IN ('facebook_find_data_group', 'facebook_find_data_search', 'facebook_comment_seeding', 'facebook_newsfeed_interaction')
     AND v_extra->'findDataRerunEnabled' = 'true'::jsonb THEN`, 1, 'finish: bật lặp thì bỏ chạy lại sau N giờ')
finish = patch(finish, `  IF v_mode IS NULL THEN
    RETURN public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed', NULL);
  END IF;
`, `  IF v_mode IS NULL THEN
    v_raw := public.aka_agent_engine_finalize_v501(c.id, p_note, 'completed',
      CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) END);
    IF v_repeat IS NOT NULL AND v_raw->>'campaignStatus' = 'hoàn thành' THEN
      PERFORM private.aka_agent_campaign_repeat_confirm_end(c.id);
    END IF;
    RETURN v_raw;
  END IF;
`, 1, 'finish: nhánh hoàn thành')
finish = patch(finish, `      RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
        || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;`, `      RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
        || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
        || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;`, 1, 'finish: trả thông tin lượt (không có data)')
finish = patch(finish, `  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END;
END $function$`, `  RETURN jsonb_build_object('ok', true, 'reason', v_mode, 'schedule', v_next, 'campaignStatus', 'chờ xử lý')
    || CASE WHEN v_mode = 'slot_advanced' THEN jsonb_build_object('slot', v_next_slot) ELSE '{}'::jsonb END
    || CASE WHEN v_repeat IS NOT NULL THEN jsonb_build_object('repeat', v_repeat) ELSE '{}'::jsonb END;
END $function$`, 1, 'finish: trả thông tin lượt')

// ---- Vá hàm ghi thông báo: lượt giữa không báo "hoàn thành" ----------------------------------------------------------------------
let capture = captureLive
capture = patch(capture, `  v_cooldown := CASE WHEN v_to IN ('đang chạy', 'chờ xử lý')`, `  -- V561: chiến dịch đang bật "Lặp lại sau khi chạy xong" mà bộ chạy chưa biết tính năng đánh "hoàn thành" ở lượt giữa: bộ quét sẽ mở
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
  logAppend: 'private.aka_agent_campaign_repeat_log_append(jsonb,jsonb)',
  state: 'private.aka_agent_campaign_repeat_state(public.auto_campaigns)',
  core: 'private.aka_agent_campaign_repeat_core(public.auto_campaigns,timestamp with time zone,boolean,timestamp with time zone,text)',
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

const objects = `CREATE FUNCTION private.aka_agent_campaign_repeat_log_append(p_log jsonb, p_entry jsonb)
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
    WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\\d{1,5}$' THEN (v_raw #>> '{}')::integer
    WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\\d{1,5}$' THEN btrim(v_raw #>> '{}')::integer END;
  v_raw := v_extra->'repeatAfterCompletionMaxRuns';
  v_max := CASE
    WHEN jsonb_typeof(v_raw) = 'number' AND (v_raw #>> '{}') ~ '^\\d{1,5}$' THEN (v_raw #>> '{}')::integer
    WHEN jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') ~ '^\\d{1,5}$' THEN btrim(v_raw #>> '{}')::integer END;
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
END $f$;`

const PRIVATE_FNS = [SIGS.logAppend, SIGS.state, SIGS.config, SIGS.clamp, SIGS.core, SIGS.confirm, SIGS.willReopen, SIGS.sweeper, SIGS.sync, SIGS.sweepOne, SIGS.caller]
const DESKTOP_AND_SERVICE = [SIGS.syncV1, SIGS.decideV1, SIGS.stateV1]
const SERVICE_ONLY = [SIGS.tickV1]
const ALL_ROLES = ['anon', 'authenticated', 'service_role', 'aka_agent_chat_api', 'aka_agent_desktop']

const NEW = { finish: md5(finish), capture: md5(captureBody(capture)) }

const grants = `DO $grants$
DECLARE
  fn text;
  r text;
BEGIN
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

const NAME = 'campaign_repeat_after_completion'
const HEADER = `-- V561: "Lặp lại sau khi chạy xong" cho chiến dịch lịch Hàng ngày (17/11/2026).
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
--       auto_system_settings '${SETTING_KEY}' = {"audience":"admin_akabiz","sweeper":true} (off | admin_akabiz | all;
--       "sweeper": false tắt khẩn bộ quét).
-- ALTER TABLE và CREATE FUNCTION làm PostgREST nạp lại schema: apply buổi tối, ngoài giờ cao điểm.
-- Gỡ: rollback_v561_${NAME}.sql.`

const ledgerGuard = part => `  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE name LIKE 'migration_v561_%_${part}') THEN
      RAISE EXCEPTION 'V561 ${part} đã có trong sổ migration, không chạy lại';
    END IF;
  END IF;`

const migrationP1 = `${HEADER}
-- PHẦN 1/2: hai cột đếm lượt.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $pre$
BEGIN
${ledgerGuard('p1')}
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname IN ('repeat_runs_done', 'repeat_log')
              AND NOT attisdropped) THEN
    RAISE EXCEPTION 'V561 p1: cột đếm lượt đã có';
  END IF;
END $pre$;

ALTER TABLE public.auto_campaigns
  ADD COLUMN repeat_runs_done integer NOT NULL DEFAULT 0,
  ADD COLUMN repeat_log jsonb;
COMMENT ON COLUMN public.auto_campaigns.repeat_runs_done IS
  'V561 "Lặp lại sau khi chạy xong": số lượt đã chạy xong trong vòng lặp hiện tại, tính cả lượt đầu. Chỉ hàm private.aka_agent_campaign_repeat_* ghi.';
COMMENT ON COLUMN public.auto_campaigns.repeat_log IS
  'V561 "Lặp lại sau khi chạy xong": nhật ký đếm lượt, mảng JSON tối đa 120 dòng {type: arm|run|end|error|skip|off, at, ...}. NULL = chưa từng bật lặp. Chỉ hàm private.aka_agent_campaign_repeat_* ghi.';

DO $post$
DECLARE v_bad text;
BEGIN
  -- App Desktop không tự sửa được bộ đếm: role aka_agent_desktop chỉ có quyền UPDATE theo danh sách cột, hai cột mới không nằm trong
  -- đó (kiểm production 17/11/2026). Backend (service_role, aka_agent_chat_api) có quyền cả bảng như mọi cột khác.
  SELECT string_agg(r.rolname || '.' || a.col, ', ') INTO v_bad
    FROM pg_roles r CROSS JOIN unnest(ARRAY['repeat_runs_done', 'repeat_log']) AS a(col)
   WHERE r.rolname = 'aka_agent_desktop'
     AND has_column_privilege(r.rolname, 'public.auto_campaigns', a.col, 'UPDATE');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V561 p1 postflight: app Desktop sửa được cột đếm lượt: %', v_bad; END IF;
END $post$;

COMMIT;
`

const migrationP2 = `${HEADER}
-- PHẦN 2/2: hàm, RPC, nối engine v2, thông báo, công tắc. Chạy sau p1.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE v_md5 text;
BEGIN
${ledgerGuard('p2')}
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.auto_campaigns'::regclass AND attname IN ('repeat_runs_done', 'repeat_log')
        AND NOT attisdropped) <> 2 THEN
    RAISE EXCEPTION 'V561 p2 cần p1 (hai cột đếm lượt của auto_campaigns)';
  END IF;
  IF to_regprocedure('${SIGS.state}') IS NOT NULL THEN RAISE EXCEPTION 'V561 p2: hàm lặp lại đã có'; END IF;
  IF to_regprocedure('private.aka_agent_desktop_data_context()') IS NULL THEN RAISE EXCEPTION 'V561 cần private.aka_agent_desktop_data_context() (V436)'; END IF;
  IF to_regprocedure('public.aka_agent_engine_finalize_v501(bigint,text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'V561 cần V501'; END IF;
  IF to_regprocedure('${FINISH_SIG}') IS NULL THEN RAISE EXCEPTION 'V561 cần ${FINISH_SIG}'; END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('${FINISH_SIG}')));
  IF v_md5 IS DISTINCT FROM '${LIVE.finish}' THEN RAISE EXCEPTION 'V561: định nghĩa aka_agent_engine_finish_campaign_v2 khác bản V558 (%)', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = to_regprocedure('${CAPTURE_SIG}');
  IF v_md5 IS DISTINCT FROM '${LIVE.capture}' THEN RAISE EXCEPTION 'V561: thân hàm ghi thông báo chiến dịch khác V475 (%)', v_md5; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_system_settings WHERE key = '${SETTING_KEY}') THEN RAISE EXCEPTION 'V561: dòng công tắc đã có'; END IF;
END $pre$;

${objects}

${finish};

${capture}

${grants}

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES ('${SETTING_KEY}', '{"audience":"admin_akabiz","sweeper":true}',
  'Lặp lại chiến dịch sau khi chạy xong (V561). audience: off = ẩn, admin_akabiz = chỉ admin akaBiz thấy ô cài đặt, all = mọi tài khoản. sweeper: false = tắt khẩn bộ quét mở lại chiến dịch.',
  false, true);

DO $post$
DECLARE
  v_md5 text;
  v_bad text;
BEGIN
  v_md5 := md5(pg_get_functiondef('${FINISH_SIG}'::regprocedure));
  IF v_md5 IS DISTINCT FROM '${NEW.finish}' THEN RAISE EXCEPTION 'V561 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${CAPTURE_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${NEW.capture}' THEN RAISE EXCEPTION 'V561 postflight: hàm ghi thông báo %', v_md5; END IF;
  SELECT string_agg(r.rolname || ' → ' || f.sig, '; ') INTO v_bad
    FROM unnest(ARRAY[${[...PRIVATE_FNS, ...DESKTOP_AND_SERVICE, ...SERVICE_ONLY].map(x => `'${x}'`).join(', ')}]) AS f(sig)
    JOIN pg_roles r ON r.rolname IN ('anon', 'authenticated', 'aka_agent_chat_api', 'service_role', 'aka_agent_desktop')
   WHERE has_function_privilege(r.rolname, f.sig, 'EXECUTE')
     AND NOT (f.sig = ANY (ARRAY[${DESKTOP_AND_SERVICE.map(x => `'${x}'`).join(', ')}]) AND r.rolname IN ('service_role', 'aka_agent_desktop'))
     AND NOT (f.sig = '${SIGS.tickV1}' AND r.rolname = 'service_role');
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'V561 postflight: quyền hàm quá rộng: %', v_bad; END IF;
END $post$;

COMMIT;
`

const rollback = `-- Gỡ V561: trả hàm kết thúc lượt của engine v2 về thân V558, hàm ghi thông báo về thân V475, xoá hàm và dòng công tắc (giao dịch 1),
-- rồi bỏ hai cột đếm lượt của auto_campaigns (giao dịch 2; mất số lượt đã đếm và nhật ký).
-- SINH TỪ scripts/build-v561-sql.cjs. Chiến dịch đang chờ lượt lặp kế tiếp vẫn chạy lượt đó (đã là "chờ xử lý" với lịch tương lai), sau
-- đó hoàn thành như chiến dịch thường. Trước khi gỡ: API Web phải ngừng gọi bốn RPC (tắt công tắc: audience off, sweeper false) và
-- bộ chạy Desktop bản có gọi decide_v1 tự coi "chưa có hàm" là không lặp. Bỏ cột khoá bảng trong chốc lát: chạy buổi tối.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $pre$
BEGIN
  IF to_regprocedure('${SIGS.state}') IS NULL THEN RAISE EXCEPTION 'Gỡ V561: chưa có V561 p2'; END IF;
  IF md5(pg_get_functiondef('${FINISH_SIG}'::regprocedure)) IS DISTINCT FROM '${NEW.finish}' THEN
    RAISE EXCEPTION 'Gỡ V561: finish_campaign_v2 không phải bản V561, dừng để đối chiếu';
  END IF;
END $pre$;

${finishLive};

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
DROP FUNCTION ${SIGS.state};
DROP FUNCTION ${SIGS.logAppend};
DELETE FROM public.auto_system_settings WHERE key = '${SETTING_KEY}';

DO $post$
DECLARE v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef('${FINISH_SIG}'::regprocedure));
  IF v_md5 IS DISTINCT FROM '${LIVE.finish}' THEN RAISE EXCEPTION 'Gỡ V561 postflight: finish_campaign_v2 %', v_md5; END IF;
  SELECT md5(prosrc) INTO v_md5 FROM pg_proc WHERE oid = '${CAPTURE_SIG}'::regprocedure;
  IF v_md5 IS DISTINCT FROM '${LIVE.capture}' THEN RAISE EXCEPTION 'Gỡ V561 postflight: hàm ghi thông báo %', v_md5; END IF;
END $post$;

COMMIT;

BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.auto_campaigns DROP COLUMN repeat_log, DROP COLUMN repeat_runs_done;
COMMIT;
`

const migration = migrationP1 + '\n' + migrationP2
module.exports = { migration, migrationP1, migrationP2, rollback, LIVE, NEW, SIGS, SETTING_KEY, FINISH_SIG, CAPTURE_SIG }
if (require.main === module) {
  fs.writeFileSync(path.join(ROOT, `migrations/migration_v561_${NAME}_p1.sql`), migrationP1)
  fs.writeFileSync(path.join(ROOT, `migrations/migration_v561_${NAME}_p2.sql`), migrationP2)
  fs.writeFileSync(path.join(ROOT, `migrations/rollback_v561_${NAME}.sql`), rollback)
  console.log('V561 p1', md5(migrationP1), 'p2', md5(migrationP2), 'rollback', md5(rollback), 'thân mới', JSON.stringify(NEW))
}
