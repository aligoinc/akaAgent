#!/usr/bin/env bash
# Một vòng kiểm thử V660 (anh yêu cầu 26/11/2026: lặp tới khi ít nhất 3 vòng liền không còn vấn đề).
# Cách chạy: CHAT_REPO=<akaAgentChatApi> bash scripts/zalo-tag-sync/fuzz-round.sh <seed> [<pool.json ngoài repo>]
# pool.json: tag thật đã ẩn danh (mã người băm thành số, giữ tiền tố "g" của nhóm), xem docs/ZALO_TAG_AUTO_SEND_PLAN.md mục 9.
set -uo pipefail
SEED="${1:?seed}"; POOL="${2:-}"
DIR="$(cd "$(dirname "$0")" && pwd)"
export CHAT_REPO="${CHAT_REPO:-$(cd "$DIR/../../../akaagentchatapi" 2>/dev/null && pwd)}"
status=0
step() { echo "== $1"; shift; "$@" || status=1; }
step "DB V660 + đồng thời" node "$DIR/fuzz-loop.cjs" --seed "$SEED" --scenarios 80 --steps 140 ${POOL:+--real "$POOL"}
step "Fly: cờ liền mạch" node "$DIR/fly-tag-sync-fuzz.cjs" --seed "$SEED" --runs 3000
step "Desktop / App Server: bộ hỏi tag" node "$DIR/runtime-fuzz.cjs" --seed "$SEED" --runs 400
step "Lõi engine: kiểm bạn bè" env SEED="$SEED" node "$DIR/engine-friend-check-smoke.cjs"
step "Bài kiểm V660 + gỡ / apply lại" bash "$DIR/v660-smoke.sh"
step "Desktop / App Server: smoke" node "$DIR/runtime-smoke.cjs"
echo "== VÒNG seed $SEED: $([ $status = 0 ] && echo SẠCH || echo CÒN LỖI)"
exit $status
