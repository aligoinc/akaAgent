#!/usr/bin/env bash
# Ảnh đính kèm câu hỏi của Hỏi đáp AI trên Desktop: đóng gói mã thật (src/shared/aiChat.ts, aiChatDesktop.ts,
# src/main/services/aiChatImageService.ts, handler của Edge Function ai-chat-agent) rồi chạy desktop_image_smoke.mjs.
#   bash scripts/ai-chat/desktop_image_smoke.sh                          : phần không cần database
#   bash scripts/ai-chat/desktop_image_smoke.sh <psql> <socket> <port>   : thêm vòng đầy đủ trên database tạm đã có lõi vá
#     (akaAgentWebApp scripts/test-ai-chat-images-sql.sh dựng database đó rồi gọi tệp này).
# Cần node_modules (esbuild).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
(cd "$ROOT" && node -e "
require('esbuild').buildSync({ stdin: { contents: \"export * from './src/shared/aiChat'; export * from './src/shared/aiChatDesktop'; export * from './src/main/services/aiChatImageService'; export { createAiChatAgentHandler } from './supabase/functions/ai-chat-agent/handler'\", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: '$TMP/aiChatImages.mjs', logLevel: 'error' })")
node "$ROOT/scripts/ai-chat/desktop_image_smoke.mjs" "$TMP/aiChatImages.mjs" "$@"
