-- Gỡ V560: xoá danh mục bước, danh mục workflow engine và sổ chép; engine Facebook lùi về bộ cũ (không có workflow engine).
-- Workflow / block "[engine]" để nguyên (auto_runs.workflow_id có khoá ngoại tới auto_workflows); bộ cũ không nạp chúng.
-- Apply lại sau khi gỡ: preflight từ chối khi còn block / workflow "[engine]" (dọn ngoài giờ cao điểm trước). SINH TỪ scripts/build-v560-sql.cjs.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DELETE FROM public.auto_engine_block_steps;
DELETE FROM public.auto_engine_workflows;
DELETE FROM public.auto_engine_block_copies;

COMMIT;
