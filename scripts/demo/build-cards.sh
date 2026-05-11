#!/bin/bash
# build-cards.sh — generates 3 title cards for the Composed Stack demo:
#   intro-card.mp4   (10s)
#   cost-card.mp4    (25s)
#   outro-card.mp4   (20s)
#
# All cards: 1920x1080, H.264 yuv420p, 30fps, no audio.
# Codec params match the xvfb terminal recording so ffmpeg concat demuxer
# can stitch them losslessly.

set -e
DEMO_DIR="/root/dpo2u-solana/scripts/demo"
mkdir -p "$DEMO_DIR/cards"
cd "$DEMO_DIR/cards"

# Fonts (DejaVu, available system-wide)
FONT_SERIF_BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
FONT_SANS="/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_SANS_BOLD="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_MONO="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"

# Brand colors (terracotta DPO2U palette — match terminal)
BG="0x0C0D10"
FG="0xE8E2D5"
TERRACOTTA="0xC46950"
GREEN="0x6FB870"
RED="0xC75A4D"
DIM_GREY="0x6B6B6B"

# Resolution
W=1920
H=1080
FPS=30

# --- Intro card (10s) ----------------------------------------------------
echo "[build-cards] generating intro-card.mp4 (10s)..."
ffmpeg -y -hide_banner -loglevel warning \
  -f lavfi -i "color=c=$BG:s=${W}x${H}:r=${FPS}:d=10" \
  -vf "
    drawtext=fontfile=${FONT_SERIF_BOLD}:text='DPO2U Composed Stack':fontcolor=${FG}:fontsize=92:x=(w-text_w)/2:y=380,
    drawtext=fontfile=${FONT_SANS}:text='Devnet evidence · 2026-05-08':fontcolor=${TERRACOTTA}:fontsize=44:x=(w-text_w)/2:y=500,
    drawtext=fontfile=${FONT_MONO}:text='Pinocchio  ·  Light Protocol  ·  Shadow Drive  ·  Squads v4':fontcolor=${FG}:fontsize=32:x=(w-text_w)/2:y=620,
    drawtext=fontfile=${FONT_SANS}:text='dpo2u.com':fontcolor=${DIM_GREY}:fontsize=24:x=w-text_w-60:y=h-80
  " \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -r ${FPS} \
  -movflags +faststart \
  intro-card.mp4

# --- Cost-comparison card (25s) ------------------------------------------
echo "[build-cards] generating cost-card.mp4 (25s)..."
ffmpeg -y -hide_banner -loglevel warning \
  -f lavfi -i "color=c=$BG:s=${W}x${H}:r=${FPS}:d=25" \
  -vf "
    drawtext=fontfile=${FONT_SERIF_BOLD}:text='Cost comparison':fontcolor=${FG}:fontsize=64:x=(w-text_w)/2:y=120,

    drawtext=fontfile=${FONT_SANS_BOLD}:text='REGULAR ATTESTATION':fontcolor=${RED}:fontsize=36:x=200:y=300,
    drawtext=fontfile=${FONT_SERIF_BOLD}:text='\$0.34 / op':fontcolor=${FG}:fontsize=86:x=200:y=380,
    drawtext=fontfile=${FONT_SANS}:text='LOCKED in rent':fontcolor=${FG}:fontsize=32:x=200:y=520,
    drawtext=fontfile=${FONT_SANS}:text='never recovered':fontcolor=${DIM_GREY}:fontsize=28:x=200:y=580,

    drawtext=fontfile=${FONT_SANS_BOLD}:text='COMPOSED FLOW':fontcolor=${GREEN}:fontsize=36:x=1080:y=300,
    drawtext=fontfile=${FONT_SERIF_BOLD}:text='\$0.032 / op':fontcolor=${FG}:fontsize=86:x=1080:y=380,
    drawtext=fontfile=${FONT_SANS}:text='consumed':fontcolor=${FG}:fontsize=32:x=1080:y=520,
    drawtext=fontfile=${FONT_SANS}:text='ledger fee + Groth16 verify':fontcolor=${DIM_GREY}:fontsize=28:x=1080:y=580,

    drawtext=fontfile=${FONT_SERIF_BOLD}:text='10x cheaper':fontcolor=${TERRACOTTA}:fontsize=72:x=(w-text_w)/2:y=760,
    drawtext=fontfile=${FONT_SANS}:text='Break-even ~25k attestations / year vs Helius Photon Pro':fontcolor=${DIM_GREY}:fontsize=24:x=(w-text_w)/2:y=900,
    drawtext=fontfile=${FONT_SANS}:text='dpo2u.com':fontcolor=${DIM_GREY}:fontsize=24:x=w-text_w-60:y=h-80
  " \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -r ${FPS} \
  -movflags +faststart \
  cost-card.mp4

# --- Outro card (20s) ----------------------------------------------------
echo "[build-cards] generating outro-card.mp4 (20s)..."
ffmpeg -y -hide_banner -loglevel warning \
  -f lavfi -i "color=c=$BG:s=${W}x${H}:r=${FPS}:d=20" \
  -vf "
    drawtext=fontfile=${FONT_SERIF_BOLD}:text='Composition is the protocol.':fontcolor=${FG}:fontsize=72:x=(w-text_w)/2:y=380,
    drawtext=fontfile=${FONT_SANS}:text='Light Foundation issue \#2378 — registration in flight':fontcolor=${TERRACOTTA}:fontsize=34:x=(w-text_w)/2:y=540,
    drawtext=fontfile=${FONT_MONO}:text='github.com/fredericosanntana/dpo2u-solana':fontcolor=${FG}:fontsize=32:x=(w-text_w)/2:y=640,
    drawtext=fontfile=${FONT_MONO}:text='fred@dpo2u.com':fontcolor=${FG}:fontsize=32:x=(w-text_w)/2:y=720,
    drawtext=fontfile=${FONT_SANS}:text='dpo2u.com':fontcolor=${DIM_GREY}:fontsize=24:x=w-text_w-60:y=h-80
  " \
  -c:v libx264 -preset veryfast -pix_fmt yuv420p -crf 20 -r ${FPS} \
  -movflags +faststart \
  outro-card.mp4

echo
echo "[build-cards] done."
for f in intro-card.mp4 cost-card.mp4 outro-card.mp4; do
  ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$f" | tr '\n' ' '
  echo "  ← $f"
done
