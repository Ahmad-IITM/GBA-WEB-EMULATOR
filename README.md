# GBA Web Emulator

A polished browser-based Game Boy Advance emulator experience built with the mGBA WebAssembly core. This project brings a lightweight, touch-friendly emulator frontend to the web with ROM loading, save import/export, save states, fullscreen mode, and responsive controls.

## Live!

Open the deployed app here:
https://ahmad-iitm.github.io/GBA-WEB-EMULATOR/

## Highlights

- Play GBA ROMs directly in the browser
- Import and export save files
- Save and load emulator states
- Responsive fullscreen-friendly UI
- Touch controls and keyboard/gamepad support
- Smooth, lightweight WebAssembly-powered emulation

## Tech stack

- HTML, CSS, and JavaScript
- mGBA compiled to WebAssembly
- IndexedDB for local saves and states
- GitHub Pages for hosting

## Run locally

Serve the repository root with any static file server, for example:

```bash
python3 -m http.server 8000
```

Then open http://127.0.0.1:8000/ in your browser.

