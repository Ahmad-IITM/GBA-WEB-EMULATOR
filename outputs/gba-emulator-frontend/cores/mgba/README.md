# mGBA Web Core

This folder contains the web bridge for the uploaded `mGBA 0.5.1` source.

The frontend does not implement emulation itself. The C bridge in `src/mgba-web.c` wraps mGBA's existing `mCore` API and exports a small WebAssembly ABI for the browser app.

## Build

Install and activate Emscripten, then run:

```bash
./cores/mgba/build-mgba-web.sh /path/to/mgba-0.5.1
```

Expected output:

```text
cores/mgba/dist/mgba-core.js
cores/mgba/dist/mgba-core.wasm
```

Those files are loaded automatically by `js/mgbaWasmAdapter.js` when present.

## Exported ABI

- `mgba_web_load_rom(ptr, size)`
- `mgba_web_run_frame()`
- `mgba_web_framebuffer()`
- `mgba_web_framebuffer_width()`
- `mgba_web_framebuffer_height()`
- `mgba_web_framebuffer_stride()`
- `mgba_web_set_keys(mask)`
- `mgba_web_save_data(ptr, size)`
- `mgba_web_load_save(ptr, size)`
- `mgba_web_save_state(ptr, size)`
- `mgba_web_load_state(ptr, size)`
- `mgba_web_reset()`
- `mgba_web_unload()`

Button mask follows mGBA/libretro order:

```text
A=1, B=2, Select=4, Start=8, Right=16, Left=32, Up=64, Down=128, R=256, L=512
```
