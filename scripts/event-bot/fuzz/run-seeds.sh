#!/usr/bin/env bash
# Chạy nhiều hạt giống DB song song: bash scripts/event-bot/fuzz/run-seeds.sh <từ> <đến> [ops] [song song]
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
FROM=$1; TO=$2; OPS=${3:-600}; PAR=${4:-4}
OUT="${FUZZ_OUT:-$(mktemp -d)}"; mkdir -p "$OUT"
seq "$FROM" "$TO" | xargs -P "$PAR" -I{} sh -c "node '$DIR/db-fuzz.cjs' --seed {} --ops $OPS --show 30 > '$OUT/seed-{}.txt' 2>&1; echo \"seed {} exit \$?\""
echo "Kết quả: $OUT"
grep -h '^{"seed"' "$OUT"/seed-*.txt | sort -t: -k2 -n
