#!/bin/bash
# assemble-demo.sh — concatenates the 4 video segments into the final
# 3-minute demo mp4:
#
#   intro-card.mp4 (10s) → composed-terminal.mp4 (~140s) → cost-card.mp4 (25s) → outro-card.mp4 (20s)
#
# Output: /root/dpo2u-solana/scripts/demo/dpo2u-demo-2026.mp4

set -e
DEMO_DIR="/root/dpo2u-solana/scripts/demo"
cd "$DEMO_DIR"

# Verify all sources exist
for f in cards/intro-card.mp4 composed-terminal.mp4 cards/cost-card.mp4 cards/outro-card.mp4; do
  if [ ! -f "$f" ]; then
    echo "[assemble] missing source: $f"
    echo "[assemble] run build-cards.sh + record-composed-demo.sh first"
    exit 2
  fi
done

# Build concat manifest
cat > /tmp/composed-concat.txt <<EOF
file '${DEMO_DIR}/cards/intro-card.mp4'
file '${DEMO_DIR}/composed-terminal.mp4'
file '${DEMO_DIR}/cards/cost-card.mp4'
file '${DEMO_DIR}/cards/outro-card.mp4'
EOF

OUT="${OUT:-${DEMO_DIR}/dpo2u-demo-2026.mp4}"
echo "[assemble] concatenating to ${OUT}..."

# Use concat demuxer (lossless, no re-encode needed since codecs match)
# Fallback: re-encode if container mismatch
ffmpeg -y -hide_banner -loglevel warning \
  -f concat -safe 0 -i /tmp/composed-concat.txt \
  -c copy \
  -movflags +faststart \
  "${OUT}" || {
  echo "[assemble] concat -c copy failed (codec mismatch?), falling back to re-encode..."
  ffmpeg -y -hide_banner -loglevel warning \
    -f concat -safe 0 -i /tmp/composed-concat.txt \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -r 30 \
    -movflags +faststart \
    "${OUT}"
}

echo "[assemble] done."
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "${OUT}" 2>&1
echo "  ← ${OUT}"

# Sanity: extract first + last frames for visual verification
ffmpeg -y -hide_banner -loglevel error -i "${OUT}" -frames:v 1 /tmp/demo-first-frame.jpg
DURATION=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nokey=1 "${OUT}")
LAST=$(echo "$DURATION - 1" | bc 2>/dev/null || echo "${DURATION%.*}")
ffmpeg -y -hide_banner -loglevel error -ss "$LAST" -i "${OUT}" -frames:v 1 /tmp/demo-last-frame.jpg
echo "[assemble] first frame: /tmp/demo-first-frame.jpg"
echo "[assemble] last frame:  /tmp/demo-last-frame.jpg"
