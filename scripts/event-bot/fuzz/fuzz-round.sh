#!/usr/bin/env bash
# Một vòng kiểm thử Bot sự kiện: bài kiểm V672 + N hạt giống DB + M hạt giống vòng chạy (song song).
#   PG_MODULE_DIR=<thư mục có node_modules/pg> [EVENT_BOT_POOL=<mẫu dữ liệu thật ngoài repo>] \
#     bash scripts/event-bot/fuzz/fuzz-round.sh <hạt giống đầu> [số DB=16] [số vòng chạy=8] [ops=800]
# Mã thoát 1 khi có vi phạm.
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"; REPO="$(cd "$DIR/../../.." && pwd)"
BASE=$1; NDB=${2:-16}; NRT=${3:-8}; OPS=${4:-800}; PAR=${PAR:-4}
OUT="${FUZZ_OUT:-$(mktemp -d)}/round-$BASE"; mkdir -p "$OUT"
bash "$REPO/scripts/event-bot/db/v672-smoke.sh" > "$OUT/smoke.txt" 2>&1
SMOKE_PASS=$(grep -c PASS "$OUT/smoke.txt"); SMOKE_FAIL=$(grep -cE "FAIL|ERROR" "$OUT/smoke.txt")
{ seq "$BASE" $((BASE + NDB - 1)) | sed 's/^/db /'; seq "$BASE" $((BASE + NRT - 1)) | sed 's/^/rt /'; } | \
  xargs -P "$PAR" -L1 sh -c 'if [ "$0" = db ]; then node "'"$DIR"'/db-fuzz.cjs" --seed "$1" --ops '"$OPS"' --show 30 > "'"$OUT"'/db-$1.txt" 2>&1; else node "'"$DIR"'/runtime-fuzz.cjs" --seed "$1" --steps '$((OPS*2/3))' --show 30 > "'"$OUT"'/rt-$1.txt" 2>&1; fi'
BAD=0
for f in "$OUT"/db-*.txt "$OUT"/rt-*.txt; do
  head -1 "$f" | grep -q '"violations":0' || { BAD=$((BAD+1)); echo "VI PHẠM: $(basename "$f"): $(head -1 "$f" | cut -c1-300)"; }
done
SENDS=$(grep -ho '"sends":[0-9]*' "$OUT"/rt-*.txt | cut -d: -f2 | paste -sd+ | bc)
echo "Vòng $BASE: smoke $SMOKE_PASS PASS / $SMOKE_FAIL FAIL; DB $NDB hạt giống × $OPS thao tác, vòng chạy $NRT hạt giống ($SENDS lệnh gửi); tệp lỗi: $BAD; kết quả ở $OUT"
[ "$BAD" -eq 0 ] && [ "$SMOKE_FAIL" -eq 0 ]
