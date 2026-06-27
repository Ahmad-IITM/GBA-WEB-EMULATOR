# GBA Emulator Frontend

Static, framework-free frontend shell for a future mGBA WebAssembly core.

## Run

Open `index.html` from a static host such as GitHub Pages. For local module loading, serve the folder with any static file server.

## Core Boundary

The app does not emulate games and does not simulate game logic. `js/emulatorCore.js` is a facade for a black box core. A future mGBA adapter can be attached as:

```js
window.gbaEmulatorCore = {
  async loadROM(buffer, romRecord) {},
  async start() {},
  async pause() {},
  async reset() {},
  async save() {},
  async loadSave(buffer) {},
  async saveState() {},
  async loadState(state) {},
  setInput(action, pressed) {},
  async stop() {}
};
```

When no adapter is present, ROMs can still be imported, stored, resumed, and listed, but runtime operations that require emulation report that the mGBA WebAssembly core is not connected yet.

## Structure

- `index.html`: App shell and dialogs
- `css/style.css`: Responsive layout, handheld controls, and themes
- `js/main.js`: Application orchestration
- `js/emulatorCore.js`: Black box emulator adapter facade
- `js/storage.js`: IndexedDB and download helpers
- `js/input.js`: Keyboard, touch, and Gamepad API input
- `js/settings.js`: Defaults, themes, and localStorage settings
- `js/ui.js`: Rendering and UI state helpers
- `themes/`: Theme extension notes
