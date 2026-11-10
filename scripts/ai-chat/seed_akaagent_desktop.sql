-- Nhóm agent và agent Hỏi đáp chiến dịch riêng của app akaAgent Desktop.
-- Đã chạy trên production (akachat) ngày 10/11/2026: nhóm lúc 21:42:02 VN (id 2), agent lúc 21:50:20 VN (id 2).
-- Chỉ dữ liệu, chạy lại không đổi gì (ON CONFLICT DO NOTHING). Cần V488. Dùng để dựng lại ở môi trường thử.
-- Agent sao từ `hoi-dap-chien-dich` tại thời điểm chạy (mô tả, quy tắc, output_schema, câu hỏi, audience, hạn trả lời).
-- App Desktop đọc nhóm này qua AI_CHAT_DESKTOP_GROUP (src/shared/aiChatDesktop.ts); Web/iOS vẫn đọc `hoi-dap-chien-dich`.
-- Gỡ: UPDATE public.ai_project SET audience = 'off' WHERE code = 'hoi-dap-chien-dich-desktop'; (mục Trợ lý trên Desktop ẩn hẳn).

INSERT INTO public.ai_project_group (code, name, description, rules, sort_order)
VALUES (
  'akaagent-desktop',
  'akaAgent Desktop',
  'Các trợ lý hỏi đáp dành cho app akaAgent Desktop: chiến dịch Facebook và Zalo (mã QR, trình duyệt) chạy trên máy của khách.',
  'Chỉ trả lời dựa trên dữ liệu thật của đúng tổ chức và chiến dịch trong hội thoại. Viết tiếng Việt tự nhiên, không lộ mã nội bộ, SQL, XPath, đường dẫn tệp hay dữ liệu của khách khác. Không chắc thì hỏi lại hoặc đề nghị chuyển chuyên viên. Chiến dịch của nhóm này chạy trên app akaAgent Desktop ở máy của khách: chỉ chạy khi app đang mở và tài khoản đã đăng nhập.',
  20)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ai_project (group_id, code, name, description, rules, output_schema, intake_schema, default_question, suggested_questions,
                               output_webhook_url, applies_to, requires_campaign, audience, timeout_seconds, sort_order)
SELECT g.id, 'hoi-dap-chien-dich-desktop', src.name, src.description, src.rules, src.output_schema, src.intake_schema, src.default_question,
       src.suggested_questions, src.output_webhook_url, src.applies_to, src.requires_campaign, src.audience, src.timeout_seconds, 10
  FROM public.ai_project src
  JOIN public.ai_project_group g ON g.code = 'akaagent-desktop'
 WHERE src.code = 'hoi-dap-chien-dich'
ON CONFLICT (code) DO NOTHING;
