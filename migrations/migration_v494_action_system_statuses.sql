-- V494 (11/11/2026): Trạng thái hệ thống cho kết quả hành động + danh sách trạng thái khai báo theo hành động (Zalo).
-- Người dùng chốt 11/11 sau đợt rà soát log Zalo: mỗi trạng thái cơ bản (auto_status, component campaign_detail) gắn với đúng
-- một trạng thái hệ thống (thành công / thất bại / bỏ qua / dừng / lỗi / chờ); bổ sung trạng thái cơ bản còn thiếu của Zalo;
-- khai báo trước danh sách trạng thái của từng hành động thay vì chờ tự phát sinh.
--
-- CHỈ THÊM, KHÔNG ĐỔI HÀNH VI BỘ CHẠY:
--   1. Bảng mới public.auto_system_statuses (6 dòng) và cột public.auto_status.system_status_code (FK). 22 trạng thái kết quả
--      đang có được gắn một trạng thái hệ thống; CHECK buộc mọi trạng thái campaign_detail về sau phải có.
--   2. 6 trạng thái cơ bản mới của Zalo, is_active=false, CHƯA có policy và CHƯA auto_error nào trỏ tới: chưa bộ chạy nào ghi.
--      Bật từng trạng thái là việc của migration sau, làm cùng bộ ghi và các nơi đang đếm theo chữ 'thất bại'.
--   3. Bảng mới public.auto_account_action_result_statuses: hành động nào có những trạng thái nào. is_active=true là bộ chạy
--      đang ghi (có bằng chứng trong log hoặc policy/code); false là đã khai báo, chưa bật. Mới khai báo cho 10 hành động Zalo.
--
-- KHÔNG ĐỤNG: auto_error, auto_account_action_status_policies (report_group giữ 4 giá trị vì app đã cài từ chối giá trị lạ),
-- auto_campaign_action_detail_statuses (status_id trống là kết quả hoàn nguyên V369 theo yêu cầu người dùng 10/10),
-- auto_account_actions, auto_campaign_details, mọi hàm/trigger đang có.
--
-- Tương thích: Desktop, App Server và chat worker nạp auto_status bằng select * / to_jsonb rồi chỉ lấy trường đã biết; lớp
-- ActionStatusCatalog chỉ kiểm trùng id/code nên cột mới và 6 dòng chưa bật không ảnh hưởng (kiểm bằng
-- scripts/test-v494-action-system-statuses.sh với đúng lớp đó). Hai bảng mới bật RLS, thu hồi anon/authenticated (ACL mặc
-- định của schema public cấp sẵn cho hai role này); chỉ service_role đọc/ghi. Desktop chưa đọc hai bảng mới.
--
-- DDL (CREATE TABLE, ALTER TABLE) làm PostgREST nạp lại schema → apply ngoài giờ cao điểm. Bảng auto_status 41 dòng,
-- lock_timeout 3 giây. Từ migration này: guard md5 cả dòng auto_status ở migration sau phải bỏ 'system_status_code'.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $v494_preflight$
DECLARE
  v_count integer;
  v_fp text;
BEGIN
  IF to_regclass('public.auto_system_statuses') IS NOT NULL
     OR to_regclass('public.auto_account_action_result_statuses') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.auto_status'::regclass
                AND attname = 'system_status_code' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'v494: đã apply (auto_system_statuses / auto_account_action_result_statuses / auto_status.system_status_code đã có), không chạy lại';
  END IF;
  IF NOT has_table_privilege('aka_agent_desktop', 'public.auto_status', 'SELECT')
     OR NOT has_table_privilege('aka_agent_chat_api', 'public.auto_status', 'SELECT') THEN
    RAISE EXCEPTION 'v494: aka_agent_desktop/aka_agent_chat_api không còn SELECT cấp bảng trên auto_status; select * sẽ lỗi ở cột mới';
  END IF;
  IF has_table_privilege('aka_agent_desktop', 'public.auto_status', 'UPDATE')
     OR has_table_privilege('aka_agent_desktop', 'public.auto_status', 'INSERT') THEN
    RAISE EXCEPTION 'v494: aka_agent_desktop ghi được auto_status; cột mới sẽ ghi được từ Desktop';
  END IF;
  -- Bản chụp 22 trạng thái kết quả đọc trên akachat lúc viết migration (id, code, status_value, kênh, bật/xóa).
  SELECT count(*), md5(string_agg(s.id || ':' || s.code || ':' || coalesce(s.status_value, '') || ':' || s.flatform_type
                                  || ':' || s.is_active::text || ':' || s.is_delete::text, '|' ORDER BY s.id))
    INTO v_count, v_fp
    FROM public.auto_status s WHERE s.component_type = 'campaign_detail';
  IF v_count <> 22 OR v_fp IS DISTINCT FROM '069950463f9b6c09cfec954a3449d09d' THEN
    RAISE EXCEPTION 'v494: danh mục trạng thái kết quả đã đổi (% dòng, md5 %); đọc lại và gắn trạng thái hệ thống cho dòng mới', v_count, v_fp;
  END IF;
  -- 11 policy mặc định: nhóm báo cáo phải khớp trạng thái hệ thống gắn ở dưới.
  SELECT count(*), md5(string_agg(p.status_id || ':' || p.report_group || ':' || p.is_active::text, '|' ORDER BY p.status_id))
    INTO v_count, v_fp
    FROM public.auto_account_action_status_policies p WHERE p.action_code IS NULL AND p.is_delete = false;
  IF v_count <> 11 OR v_fp IS DISTINCT FROM 'f9a1bc5c87a3f34d082093f3c6994a0c' THEN
    RAISE EXCEPTION 'v494: policy mặc định đã đổi (% dòng, md5 %); đối chiếu lại nhóm báo cáo', v_count, v_fp;
  END IF;
  SELECT count(*), md5(string_agg(a.code || ':' || a.is_active::text || ':' || a.is_delete::text, '|' ORDER BY a.code))
    INTO v_count, v_fp
    FROM public.auto_account_actions a WHERE a.flatform_type = 'zalo';
  IF v_count <> 11 OR v_fp IS DISTINCT FROM 'cf942c3fa2a30892305dcac77900caa7' THEN
    RAISE EXCEPTION 'v494: danh sách hành động Zalo đã đổi (% dòng, md5 %); khai báo lại trạng thái cho hành động mới', v_count, v_fp;
  END IF;
  IF EXISTS (SELECT 1 FROM public.auto_status s
             WHERE s.code IN ('campaign_detail_receiver_blocked', 'campaign_detail_account_restricted', 'campaign_detail_limit_reached',
                              'campaign_detail_session_expired', 'campaign_detail_connection_error', 'campaign_detail_result_unknown')
                OR (s.component_type = 'campaign_detail' AND lower(s.status_value) IN ('người nhận chặn tin', 'tài khoản bị hạn chế',
                              'đạt giới hạn', 'hết phiên đăng nhập', 'lỗi kết nối', 'chưa rõ kết quả'))) THEN
    RAISE EXCEPTION 'v494: mã hoặc giá trị của 6 trạng thái Zalo mới đã tồn tại trong auto_status';
  END IF;
END
$v494_preflight$;

-- 1. Trạng thái hệ thống -------------------------------------------------------------------------------------------------
CREATE TABLE public.auto_system_statuses (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL CHECK (btrim(description) <> ''),
  -- Nhóm 4 giá trị mà app đã cài và báo cáo cũ đang đếm; trạng thái hệ thống mới quy về đúng một nhóm.
  report_group text NOT NULL CHECK (report_group = ANY (ARRAY['success', 'failure', 'skipped', 'pending'])),
  sort_order integer NOT NULL,
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.auto_system_statuses IS
  'Trạng thái hệ thống của kết quả hành động (V494). Mỗi auto_status component campaign_detail gắn đúng một dòng.';
ALTER TABLE public.auto_system_statuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_system_statuses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.auto_system_statuses TO service_role;

INSERT INTO public.auto_system_statuses (code, name, description, report_group, sort_order) VALUES
  ('success', 'Thành công', 'Hành động đã thực hiện và được xác nhận.', 'success', 10),
  ('failure', 'Thất bại', 'Hành động đã thực hiện nhưng không đạt: người nhận từ chối, đối tượng không tồn tại hoặc nội dung, tham số không hợp lệ.', 'failure', 20),
  ('skipped', 'Bỏ qua', 'Không thực hiện thao tác mới vì kết quả đã có sẵn.', 'skipped', 30),
  ('stopped', 'Dừng', 'Hành động bị dừng trước khi thực hiện với đối tượng: tài khoản bị hạn chế, đạt giới hạn hoặc hết phiên đăng nhập.', 'pending', 40),
  ('error', 'Lỗi', 'Lỗi kỹ thuật hoặc chưa xác định được kết quả.', 'failure', 50),
  ('pending', 'Chờ', 'Kết quả trung gian, còn chờ cập nhật tiếp.', 'pending', 60);

ALTER TABLE public.auto_status
  ADD COLUMN system_status_code text REFERENCES public.auto_system_statuses(code) ON UPDATE RESTRICT ON DELETE RESTRICT;
COMMENT ON COLUMN public.auto_status.system_status_code IS
  'Trạng thái hệ thống của trạng thái kết quả (V494). Bắt buộc với component campaign_detail, để trống với component khác.';

-- Không sửa updated_at và cột nào khác của 22 dòng đang có.
UPDATE public.auto_status s
   SET system_status_code = m.system_status_code
  FROM (VALUES
    (20, 'campaign_detail_success', 'success'),
    (21, 'campaign_detail_failed', 'failure'),
    (22, 'campaign_detail_error', 'error'),
    (23, 'campaign_detail_clicked', 'success'),
    (24, 'campaign_detail_alias_changed', 'success'),
    (25, 'campaign_detail_tag_applied', 'success'),
    (26, 'campaign_detail_sent', 'success'),
    (27, 'campaign_detail_invitation_sent', 'skipped'),
    (28, 'campaign_detail_friend_request_sent', 'success'),
    (29, 'campaign_detail_message_sent', 'success'),
    (30, 'campaign_detail_already_friend', 'skipped'),
    (31, 'campaign_detail_already_member', 'skipped'),
    (32, 'campaign_detail_received', 'success'),
    (33, 'campaign_detail_joined', 'skipped'),
    (34, 'campaign_detail_viewed', 'success'),
    (35, 'campaign_detail_calling', 'pending'),
    (36, 'campaign_detail_not_found', 'failure'),
    (37, 'campaign_detail_tag_not_found', 'failure'),
    (38, 'campaign_detail_invalid_parameter', 'failure'),
    (51, 'campaign_detail_skipped', 'skipped'),
    (52, 'campaign_detail_post_pending', 'pending'),
    (55, 'campaign_detail_post_approved', 'success')
  ) AS m(id, code, system_status_code)
 WHERE s.id = m.id AND s.code = m.code AND s.component_type = 'campaign_detail';

-- 2. Trạng thái cơ bản mới của Zalo: khai báo, chưa bật -----------------------------------------------------------------
INSERT INTO public.auto_status
  (code, name, description, status_key, status_value, flatform_type, component_type, is_default, is_terminal,
   can_set_manually, is_active, is_delete, sort_order, system_status_code)
VALUES
  ('campaign_detail_receiver_blocked', 'Người nhận chặn tin',
   'Người nhận chặn hoặc không nhận: mã Zalo 122 (chặn tin người lạ), 119, 126 khi nhắn tin hoặc mời vào nhóm, 215/251 khi kết bạn. Hiện các lượt này ghi Thất bại. Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
   'receiver_blocked', 'người nhận chặn tin', 'zalo', 'campaign_detail', false, true, false, false, false, 230, 'failure'),
  ('campaign_detail_account_restricted', 'Tài khoản bị hạn chế',
   'Zalo hạn chế tài khoản với hành động này: mã 120, 802, 123, 127. Hiện ghi Thất bại hoặc không ghi kết quả, chỉ khóa hành động. Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
   'account_restricted', 'tài khoản bị hạn chế', 'zalo', 'campaign_detail', false, false, false, false, false, 240, 'stopped'),
  ('campaign_detail_limit_reached', 'Đạt giới hạn',
   'Đạt giới hạn của Zalo: mã 221, 312, 313, 304 (tìm SĐT, kết bạn, nhắn tin), 314 (mời người lạ vào nhóm), 223, 224 (danh sách lời mời hoặc danh bạ đầy). Hiện ghi Thất bại hoặc không ghi kết quả. Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
   'limit_reached', 'đạt giới hạn', 'zalo', 'campaign_detail', false, false, false, false, false, 250, 'stopped'),
  ('campaign_detail_session_expired', 'Hết phiên đăng nhập',
   'Phiên đăng nhập Zalo không còn hợp lệ: mã 600. Hiện không ghi kết quả, chỉ đổi trạng thái đăng nhập của tài khoản. Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
   'session_expired', 'hết phiên đăng nhập', 'zalo', 'campaign_detail', false, false, false, false, false, 260, 'stopped'),
  ('campaign_detail_connection_error', 'Lỗi kết nối',
   'Lỗi mạng hoặc máy chủ khi gọi Zalo: ECONNRESET, ETIMEDOUT, ENOTFOUND, HTTP 500/502, fetch failed. Hiện ghi Thất bại. Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
   'connection_error', 'lỗi kết nối', 'zalo', 'campaign_detail', false, true, false, false, false, 270, 'error'),
  ('campaign_detail_result_unknown', 'Chưa rõ kết quả',
   'Đã gửi lệnh nhưng không xác định được kết quả, ví dụ quá thời gian gửi media; không tự gửi lại. Hiện ghi Thất bại. Chưa bật: chưa bộ chạy nào ghi trạng thái này (V494).',
   'result_unknown', 'chưa rõ kết quả', 'zalo', 'campaign_detail', false, true, false, false, false, 280, 'error');

ALTER TABLE public.auto_status
  ADD CONSTRAINT auto_status_detail_system_status_check
  CHECK (component_type <> 'campaign_detail' OR system_status_code IS NOT NULL);

-- 3. Hành động – trạng thái ----------------------------------------------------------------------------------------------
CREATE TABLE public.auto_account_action_result_statuses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_code text NOT NULL REFERENCES public.auto_account_actions(code) ON DELETE RESTRICT,
  status_id bigint NOT NULL REFERENCES public.auto_status(id) ON DELETE RESTRICT,
  -- true: bộ chạy đang ghi trạng thái này cho hành động. false: đã khai báo, chưa bật.
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_account_action_result_statuses_action_status_uq UNIQUE (action_code, status_id)
);
COMMENT ON TABLE public.auto_account_action_result_statuses IS
  'Danh sách trạng thái kết quả khai báo cho từng hành động của tài khoản (V494). Khác auto_account_action_status (khóa hành động theo tài khoản) và auto_account_action_status_policies (cách đếm).';
CREATE INDEX auto_account_action_result_statuses_status_idx ON public.auto_account_action_result_statuses (status_id);
ALTER TABLE public.auto_account_action_result_statuses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auto_account_action_result_statuses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.auto_account_action_result_statuses TO service_role;
REVOKE ALL ON SEQUENCE public.auto_account_action_result_statuses_id_seq FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.aka_agent_guard_action_result_status_v494() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE v_status public.auto_status%ROWTYPE;
BEGIN
  SELECT * INTO v_status FROM public.auto_status WHERE id = NEW.status_id;
  IF NOT FOUND OR v_status.component_type <> 'campaign_detail' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'action_result_status_component_invalid';
  END IF;
  IF NEW.is_active AND (v_status.is_active IS NOT TRUE OR v_status.is_delete) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'action_result_status_inactive';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.aka_agent_guard_action_result_status_v494() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER auto_account_action_result_statuses_guard
  BEFORE INSERT OR UPDATE OF status_id, is_active ON public.auto_account_action_result_statuses
  FOR EACH ROW EXECUTE FUNCTION public.aka_agent_guard_action_result_status_v494();

-- Đang ghi: có dòng kết quả trong log production (rà 09–11/11/2026) hoặc có policy/nhánh code đang phát.
INSERT INTO public.auto_account_action_result_statuses (action_code, status_id, is_active, sort_order, note)
SELECT v.action_code, s.id, true, v.sort_order, v.note
  FROM (VALUES
    ('zalo_find_phone_user', 'campaign_detail_success', 10, 'Tìm thấy tài khoản Zalo theo SĐT.'),
    ('zalo_find_phone_user', 'campaign_detail_not_found', 20, 'Mã Zalo 216, 212, 219, 210.'),
    ('zalo_find_phone_user', 'campaign_detail_failed', 30, 'Mã 114 và lỗi chưa phân loại.'),
    ('zalo_message_stranger', 'campaign_detail_success', 10, 'Đã gửi tin.'),
    ('zalo_message_stranger', 'campaign_detail_failed', 20, 'Mã 122, 119, 126, 127, 123, 114 và lỗi chưa phân loại.'),
    ('zalo_message_friend', 'campaign_detail_success', 10, 'Đã gửi tin.'),
    ('zalo_message_friend', 'campaign_detail_failed', 20, 'Mã 119, 126, 127, 123, 221 và lỗi chưa phân loại.'),
    ('zalo_message_group', 'campaign_detail_success', 10, 'Đã gửi tin hoặc chia sẻ vào nhóm.'),
    ('zalo_message_group', 'campaign_detail_failed', 20, 'Mã 112, 126, 127, 123, 221 và lỗi chưa phân loại.'),
    ('zalo_message_group', 'campaign_detail_not_found', 30, 'Mã 161: nhóm không còn tồn tại.'),
    ('zalo_add_friend', 'campaign_detail_success', 10, 'Đã gửi lời mời, hoặc mã 222 tự thành bạn bè.'),
    ('zalo_add_friend', 'campaign_detail_failed', 20, 'Mã 215, 251, 311, 221, 114 và lỗi chưa phân loại.'),
    ('zalo_add_friend', 'campaign_detail_already_friend', 30, 'Mã 225.'),
    ('zalo_add_friend', 'campaign_detail_not_found', 40, 'Mã 216, 210.'),
    ('zalo_add_group_member', 'campaign_detail_success', 10, 'Đã thêm hoặc mời vào nhóm.'),
    ('zalo_add_group_member', 'campaign_detail_failed', 20, 'Mã 122, 119, 126, 314, 802, 114 và lỗi chưa phân loại.'),
    ('zalo_add_group_member', 'campaign_detail_already_member', 30, 'Mã 178. Có policy và nhánh code, chưa có dòng log nào từ 09/10/2026.'),
    ('zalo_cancel_sent_friend_request', 'campaign_detail_success', 10, 'Đã huỷ lời mời.'),
    ('zalo_cancel_sent_friend_request', 'campaign_detail_failed', 20, 'Mã 114 và lỗi chưa phân loại.'),
    ('zalo_join_group_link', 'campaign_detail_success', 10, 'Đã tham gia hoặc gửi yêu cầu tham gia.'),
    ('zalo_join_group_link', 'campaign_detail_joined', 20, 'Tài khoản đã ở trong nhóm từ trước.'),
    ('zalo_join_group_link', 'campaign_detail_failed', 30, 'Mã 227 và lỗi chưa phân loại.'),
    ('zalo_tag_contact', 'campaign_detail_success', 10, 'Đã gắn tag.'),
    ('zalo_tag_contact', 'campaign_detail_failed', 20, 'Mã 114 và lỗi chưa phân loại.'),
    ('zalo_tag_contact', 'campaign_detail_tag_not_found', 30, 'Không tìm thấy tag cần gắn.'),
    ('zalo_change_alias', 'campaign_detail_success', 10, 'Đã đổi tên gợi nhớ.'),
    ('zalo_change_alias', 'campaign_detail_failed', 20, 'Mã 112 (thường do tên dài quá 50 ký tự) và lỗi chưa phân loại.'),
    ('zalo_change_alias', 'campaign_detail_invalid_parameter', 30, 'Tên mới rỗng sau khi điền mẫu.')
  ) AS v(action_code, status_code, sort_order, note)
  JOIN public.auto_status s ON s.code = v.status_code;

-- Đã khai báo, chưa bật: các cặp có trong log lỗi API Zalo 08–11/11/2026.
INSERT INTO public.auto_account_action_result_statuses (action_code, status_id, is_active, sort_order, note)
SELECT v.action_code, s.id, false, v.sort_order, v.note
  FROM (VALUES
    ('zalo_message_stranger', 'campaign_detail_receiver_blocked', 110, 'Mã 122, 119, 126.'),
    ('zalo_message_friend', 'campaign_detail_receiver_blocked', 110, 'Mã 119, 126, 122.'),
    ('zalo_add_group_member', 'campaign_detail_receiver_blocked', 110, 'Mã 122, 119, 126.'),
    ('zalo_add_friend', 'campaign_detail_receiver_blocked', 110, 'Mã 215, 251.'),
    ('zalo_message_stranger', 'campaign_detail_account_restricted', 120, 'Mã 120, 802, 123, 127.'),
    ('zalo_message_friend', 'campaign_detail_account_restricted', 120, 'Mã 123, 127.'),
    ('zalo_message_group', 'campaign_detail_account_restricted', 120, 'Mã 123, 126, 127.'),
    ('zalo_add_group_member', 'campaign_detail_account_restricted', 120, 'Mã 120, 802.'),
    ('zalo_find_phone_user', 'campaign_detail_limit_reached', 130, 'Mã 221, 312, 313, 304.'),
    ('zalo_add_friend', 'campaign_detail_limit_reached', 130, 'Mã 221, 223, 224.'),
    ('zalo_message_friend', 'campaign_detail_limit_reached', 130, 'Mã 221.'),
    ('zalo_message_group', 'campaign_detail_limit_reached', 130, 'Mã 221.'),
    ('zalo_add_group_member', 'campaign_detail_limit_reached', 130, 'Mã 314.'),
    ('zalo_find_phone_user', 'campaign_detail_session_expired', 140, 'Mã 600.'),
    ('zalo_message_stranger', 'campaign_detail_session_expired', 140, 'Mã 600.'),
    ('zalo_add_friend', 'campaign_detail_session_expired', 140, 'Mã 600.'),
    ('zalo_find_phone_user', 'campaign_detail_connection_error', 150, 'HTTP 500, ECONNRESET, ENOTFOUND.'),
    ('zalo_message_stranger', 'campaign_detail_connection_error', 150, 'ECONNRESET, ETIMEDOUT, fetch failed.'),
    ('zalo_message_friend', 'campaign_detail_connection_error', 150, 'Listener đóng, lỗi mạng.'),
    ('zalo_message_group', 'campaign_detail_connection_error', 150, 'fetch failed, kết nối bị ngắt.'),
    ('zalo_add_friend', 'campaign_detail_connection_error', 150, 'HTTP 502.'),
    ('zalo_cancel_sent_friend_request', 'campaign_detail_connection_error', 150, 'HTTP 500.'),
    ('zalo_change_alias', 'campaign_detail_connection_error', 150, 'fetch failed, ECONNRESET.'),
    ('zalo_tag_contact', 'campaign_detail_connection_error', 150, 'fetch failed.'),
    ('zalo_message_stranger', 'campaign_detail_result_unknown', 160, 'Quá thời gian gửi media.'),
    ('zalo_message_friend', 'campaign_detail_result_unknown', 160, 'Quá thời gian gửi media.')
  ) AS v(action_code, status_code, sort_order, note)
  JOIN public.auto_status s ON s.code = v.status_code;

DO $v494_postflight$
DECLARE
  v_count integer;
BEGIN
  IF (SELECT count(*) FROM public.auto_system_statuses) <> 6 THEN
    RAISE EXCEPTION 'v494: auto_system_statuses không đủ 6 dòng';
  END IF;
  SELECT count(*) INTO v_count FROM public.auto_status WHERE component_type = 'campaign_detail';
  IF v_count <> 28 THEN RAISE EXCEPTION 'v494: mong đợi 28 trạng thái kết quả, có %', v_count; END IF;
  IF EXISTS (SELECT 1 FROM public.auto_status
             WHERE (component_type = 'campaign_detail') IS DISTINCT FROM (system_status_code IS NOT NULL)) THEN
    RAISE EXCEPTION 'v494: trạng thái hệ thống gắn sai component';
  END IF;
  -- Nhóm báo cáo của policy mặc định phải trùng nhóm của trạng thái hệ thống.
  IF EXISTS (SELECT 1 FROM public.auto_account_action_status_policies p
             JOIN public.auto_status s ON s.id = p.status_id
             JOIN public.auto_system_statuses y ON y.code = s.system_status_code
             WHERE p.action_code IS NULL AND p.is_delete = false AND p.report_group <> y.report_group) THEN
    RAISE EXCEPTION 'v494: trạng thái hệ thống lệch nhóm báo cáo của policy mặc định';
  END IF;
  -- 6 trạng thái mới: chưa bật, chưa có policy, chưa auto_error nào dùng (theo id lẫn theo chữ).
  IF (SELECT count(*) FROM public.auto_status s WHERE s.code LIKE 'campaign\_detail\_%' AND s.is_active = false
        AND s.flatform_type = 'zalo' AND s.system_status_code IN ('failure', 'stopped', 'error')) <> 6
     OR EXISTS (SELECT 1 FROM public.auto_account_action_status_policies p JOIN public.auto_status s ON s.id = p.status_id WHERE s.is_active = false)
     OR EXISTS (SELECT 1 FROM public.auto_error e JOIN public.auto_status s
                  ON s.id = e.detail_status_id OR lower(s.status_value) = lower(e.detail_status) WHERE s.is_active = false) THEN
    RAISE EXCEPTION 'v494: 6 trạng thái Zalo mới phải ở dạng chưa bật và chưa được dùng';
  END IF;
  SELECT count(*) INTO v_count FROM public.auto_account_action_result_statuses WHERE is_active;
  IF v_count <> 28 THEN RAISE EXCEPTION 'v494: mong đợi 28 cặp hành động–trạng thái đang ghi, có %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.auto_account_action_result_statuses WHERE NOT is_active;
  IF v_count <> 26 THEN RAISE EXCEPTION 'v494: mong đợi 26 cặp đã khai báo chưa bật, có %', v_count; END IF;
  -- Cặp đang ghi phải phân giải được policy (riêng hoặc mặc định), như bộ chạy làm lúc bắt đầu chiến dịch.
  IF EXISTS (SELECT 1 FROM public.auto_account_action_result_statuses r
             WHERE r.is_active AND NOT EXISTS (
               SELECT 1 FROM public.auto_account_action_status_policies p
               WHERE p.status_id = r.status_id AND p.is_delete = false AND p.is_active
                 AND (p.action_code = r.action_code OR p.action_code IS NULL))) THEN
    RAISE EXCEPTION 'v494: có cặp đang ghi không có policy';
  END IF;
  IF has_table_privilege('anon', 'public.auto_system_statuses', 'SELECT')
     OR has_table_privilege('authenticated', 'public.auto_system_statuses', 'SELECT')
     OR has_table_privilege('anon', 'public.auto_account_action_result_statuses', 'SELECT')
     OR has_table_privilege('authenticated', 'public.auto_account_action_result_statuses', 'SELECT')
     OR has_table_privilege('aka_agent_desktop', 'public.auto_account_action_result_statuses', 'SELECT') THEN
    RAISE EXCEPTION 'v494: quyền trên bảng mới rộng hơn dự kiến';
  END IF;
END
$v494_postflight$;

COMMIT;
