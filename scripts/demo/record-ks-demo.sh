#!/bin/bash
# record-ks-demo.sh — capture ks-terminal-demo.sh inside an xvfb-driven
# xterm at 1920x1080 and produce a clean H.264 mp4 at 30fps.
#
# Output: /root/dpo2u-solana/scripts/demo/ks-demo.mp4

set -e

OUT="${OUT:-/root/dpo2u-solana/scripts/demo/ks-demo.mp4}"
DURATION="${DURATION:-90}"   # seconds — generous, ffmpeg trims script naturally
DISPLAY_NUM="${DISPLAY_NUM:-99}"

# Cleanup any prior runs
pkill -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true
pkill -f "xterm.*ks-terminal-demo" 2>/dev/null || true
rm -f "/tmp/.X${DISPLAY_NUM}-lock"
sleep 1

# 1. Start Xvfb at 1920x1080 24-bit
echo "[record] starting Xvfb :${DISPLAY_NUM} at 1920x1080..."
Xvfb ":${DISPLAY_NUM}" -screen 0 1920x1080x24 -ac &
XVFB_PID=$!
sleep 2

# 2. Start ffmpeg capturing :99
echo "[record] starting ffmpeg capture..."
ffmpeg -y -hide_banner -loglevel warning \
  -f x11grab -framerate 30 -video_size 1920x1080 -draw_mouse 0 \
  -i ":${DISPLAY_NUM}.0" \
  -t "${DURATION}" \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 \
  -movflags +faststart \
  "${OUT}" &
FFMPEG_PID=$!
sleep 2

# 3. Launch xterm in foreground running the demo script.
# No -hold: xterm auto-closes after script finishes, then ffmpeg gets stopped.
echo "[record] launching xterm with demo..."
DISPLAY=":${DISPLAY_NUM}" xterm \
  -fa "DejaVu Sans Mono" -fs 16 \
  -bg "#0C0D10" -fg "#E8E2D5" \
  -geometry 165x44 \
  -bw 0 \
  -title "DPO2U KnightShield demo" \
  -e bash -c "/root/dpo2u-solana/scripts/demo/ks-terminal-demo.sh 2>&1 | tee /tmp/ks-xterm-output.log" \
  || true
echo "[record] xterm exited"
echo "[record] xterm output last 8 lines:"
tail -8 /tmp/ks-xterm-output.log 2>&1 || echo "(no log)"

# 4. Stop ffmpeg gracefully so it finalizes the mp4
sleep 1
kill -INT "${FFMPEG_PID}" 2>/dev/null || true
wait "${FFMPEG_PID}" 2>/dev/null || true

# 5. Stop Xvfb
kill "${XVFB_PID}" 2>/dev/null || true
wait "${XVFB_PID}" 2>/dev/null || true

echo "[record] done. Output: ${OUT}"
ls -la "${OUT}"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "${OUT}" 2>&1
