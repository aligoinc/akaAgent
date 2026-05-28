BEGIN;

CREATE TABLE IF NOT EXISTS public.auto_system_settings (
  id bigint GENERATED ALWAYS AS IDENTITY,
  key text NOT NULL,
  value text,
  description text,
  is_secret boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auto_system_settings_pkey PRIMARY KEY (id),
  CONSTRAINT auto_system_settings_key_unique UNIQUE (key)
);

CREATE INDEX IF NOT EXISTS idx_auto_system_settings_active_key
  ON public.auto_system_settings (key)
  WHERE is_active = true;

INSERT INTO public.auto_system_settings (key, value, description, is_secret, is_active)
VALUES
  (
    'ai.deepseek.api_key',
    '',
    'DeepSeek API key used by main-process AI features.',
    true,
    true
  ),
  (
    'ai.deepseek.endpoint',
    'https://api.deepseek.com/chat/completions',
    'DeepSeek chat completions endpoint.',
    false,
    true
  ),
  (
    'ai.deepseek.model',
    'deepseek-v4-flash',
    'Default DeepSeek model for assistant responses.',
    false,
    true
  ),
  (
    'ai.deepseek.default_body',
    '{"temperature":1,"max_tokens":4096,"top_p":1,"stream":false,"thinking":{"type":"enabled"},"reasoning_effort":"high","response_format":{"type":"text"}}',
    'Default JSON body merged into DeepSeek requests.',
    false,
    true
  ),
  (
    'assistant.facebook.campaign.system_prompt',
    'Bạn là trợ lý hỗ trợ khách hàng của AkaBiz, chuyên giúp người dùng xử lý chiến dịch Facebook.

VAI TRÒ:
- Luôn đứng ở vai trò hỗ trợ khách hàng, giải thích dễ hiểu và hướng người dùng tới cách xử lý cụ thể trên AkaBiz.
- Ưu tiên xác định tình trạng chiến dịch, nguyên nhân có khả năng cao nhất và bước tiếp theo người dùng có thể làm ngay.
- Giữ giọng điệu bình tĩnh, rõ ràng, không đổ lỗi cho người dùng hoặc đội kỹ thuật.

NGUYÊN TẮC BẮT BUỘC:
- Không dùng ngôn ngữ kỹ thuật trong câu trả lời.
- Không dùng hoặc nhắc các từ: bảng, API, log, DB, JSON, backend, frontend, endpoint, context.
- Không tiết lộ ID nội bộ như campaignId, accountId, staffId, detailId, inputDataId, runId hoặc bất kỳ mã định danh tương tự.
- Không tiết lộ việc bạn dựa vào nguồn nào để trả lời. Không nói "tôi dựa vào log", "theo dữ liệu", "từ context", "hệ thống cho thấy" hoặc cách diễn đạt tương tự.
- Không nhắc lại toàn bộ thông tin chiến dịch; chỉ nói phần cần thiết để người dùng hành động.
- Không bịa thông tin. Nếu thiếu dữ kiện, hãy nói: "Hiện chưa đủ thông tin để xác định chính xác", rồi gợi ý bước kiểm tra phù hợp.
- Tôn trọng phần đã được che: giá trị "[masked]" hoặc "__present__" là thông tin bảo mật, không được diễn giải thành nội dung cụ thể.

ĐỊNH DẠNG CÂU TRẢ LỜI:
- Mở đầu bằng một kết luận ngắn.
- Sau đó có mục "Cần làm ngay" với 2-5 bước hành động cụ thể, theo thứ tự ưu tiên.
- Nếu có rủi ro hoặc điều kiện cần lưu ý, thêm mục "Lưu ý".
- Trả lời bằng tiếng Việt, trọng tâm, mang tính giải pháp.',
    'System prompt for the Facebook campaign assistant.',
    false,
    true
  ),
  (
    'assistant.facebook.campaign.max_messages',
    '30',
    'Maximum recent chat messages sent to DeepSeek for a Facebook campaign assistant request.',
    false,
    true
  ),
  (
    'assistant.facebook.campaign.max_context_rows',
    '30',
    'Maximum per-source context rows from today for the Facebook campaign assistant.',
    false,
    true
  )
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  description = EXCLUDED.description,
  is_secret = EXCLUDED.is_secret,
  is_active = EXCLUDED.is_active,
  updated_at = now();

COMMENT ON TABLE public.auto_system_settings IS
  'Global key-value settings for akaAgent system features.';

COMMENT ON COLUMN public.auto_system_settings.is_secret IS
  'Marks values that must only be read in trusted main-process/backend code.';

COMMIT;
