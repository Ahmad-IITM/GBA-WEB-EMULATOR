#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/mgba-0.5.1" >&2
  exit 2
fi

MGBA_SRC="$(cd "$1" && pwd)"
APP_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="$APP_ROOT/cores/mgba/dist"
BRIDGE="$APP_ROOT/cores/mgba/src/mgba-web.c"

mkdir -p "$OUT_DIR"

mapfile -t SOURCES < <(
  find "$MGBA_SRC/src" \
    \( -path "$MGBA_SRC/src/platform" -o -path "$MGBA_SRC/src/feature" -o -path "$MGBA_SRC/src/third-party/libpng" \) -prune -o \
    -name '*.c' -print |
  grep -E '/(arm|core|debugger|gba|gb/audio|util|third-party/(blip_buf|inih|zlib))/'
)

SOURCES=("${SOURCES[@]/$MGBA_SRC\/src\/util\/memory.c/}")
mapfile -t SOURCES < <(printf '%s\n' "${SOURCES[@]}" | grep -v '/src/third-party/zlib/' | grep -v '/src/util/formatting.c' | grep -v '/src/util/vfs/vfs-' )
SOURCES+=("$MGBA_SRC/src/util/vfs/vfs-mem.c" "$MGBA_SRC/src/gb/audio.c")

emcc "${SOURCES[@]}" "$BRIDGE" "$APP_ROOT/cores/mgba/src/web-memory.c" "$APP_ROOT/cores/mgba/src/binary-stub.c" "$APP_ROOT/cores/mgba/src/time-stub.c" "$APP_ROOT/cores/mgba/src/vfs-stub.c" \
  -I"$MGBA_SRC/src" \
  -I/tmp/emscripten-headers \
  -I/usr/include \
  -I/usr/include/x86_64-linux-gnu \
  -DM_CORE_GBA \
  -DMINIMAL_CORE=1 \
  -DDISABLE_THREADING \
  -DCOLOR_16_BIT \
  -include time.h \
  -DCOLOR_5_6_5 \
  -O3 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME=createMGBA \
  -s EXPORT_ES6=1 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FILESYSTEM=1 \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","ccall","HEAPU8","HEAPU16","HEAP32"]' \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_mgba_web_load_rom","_mgba_web_unload","_mgba_web_is_loaded","_mgba_web_reset","_mgba_web_run_frame","_mgba_web_set_keys","_mgba_web_set_audio_enabled","_mgba_web_read_audio","_mgba_web_framebuffer","_mgba_web_framebuffer_width","_mgba_web_framebuffer_height","_mgba_web_framebuffer_stride","_mgba_web_state_size","_mgba_web_save_state","_mgba_web_load_state","_mgba_web_save_size","_mgba_web_save_data","_mgba_web_load_save","_mgba_web_frame_counter"]' \
  -o "$OUT_DIR/mgba-core.js"

echo "Built $OUT_DIR/mgba-core.js and $OUT_DIR/mgba-core.wasm"
