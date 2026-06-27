export class EmulatorCore extends EventTarget {
  constructor(canvas, adapter = null) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.adapter = adapter || window.gbaEmulatorCore || null;
    this.loadedROM = null;
    this.running = false;
    this.inputState = new Map();
  }

  setAdapter(adapter) {
    this.adapter = adapter;
    this.dispatch("status", adapter ? "mGBA WebAssembly core connected." : "mGBA WebAssembly core is not connected.");
  }

  async loadROM(romRecord) {
    this.loadedROM = romRecord;
    this.drawCoreUnavailableScreen();
    if (!this.adapter) {
      this.dispatch("status", "ROM loaded into the frontend. mGBA WebAssembly core is not connected yet.");
      return false;
    }
    await this.adapter.loadROM(romRecord.buffer, romRecord);
    this.dispatch("status", "ROM passed to emulator core.");
    return true;
  }

  async start() {
    if (!this.loadedROM) throw new Error("No ROM is loaded.");
    if (this.running) return;
    if (!this.adapter) {
      this.dispatch("status", "Waiting for the black box emulator core.");
      return;
    }
    this.running = true;
    this.dispatch("status", "Emulator core started.");
    void this.adapter.start();
  }

  async pause() {
    if (this.adapter && this.running) void this.adapter.pause();
    this.running = false;
    this.dispatch("status", "Paused.");
  }

  async reset() {
    this.ensureAdapter();
    await this.adapter.reset();
    this.dispatch("status", "Reset.");
  }

  async save() {
    this.ensureLoaded();
    this.ensureAdapter();
    return this.adapter.save();
  }

  async loadSave(saveBuffer) {
    this.ensureLoaded();
    this.ensureAdapter();
    await this.adapter.loadSave(saveBuffer);
    this.dispatch("status", `Loaded save file (${saveBuffer.byteLength} bytes).`);
    return true;
  }

  async saveState() {
    this.ensureLoaded();
    this.ensureAdapter();
    return this.adapter.saveState();
  }

  async loadState(state) {
    this.ensureLoaded();
    this.ensureAdapter();
    await this.adapter.loadState(state);
    this.dispatch("status", "Loaded save state.");
    return true;
  }

  setInput(action, pressed) {
    this.inputState.set(action, Boolean(pressed));
    this.adapter?.setInput?.(action, Boolean(pressed));
  }

  async stop() {
    if (this.adapter) await this.adapter.stop();
    this.running = false;
    this.loadedROM = null;
    this.clear();
    this.dispatch("status", "Stopped.");
  }

  drawCoreUnavailableScreen() {
    this.clear();
    const { ctx } = this;
    ctx.fillStyle = "#151922";
    ctx.fillRect(18, 28, 204, 104);
    ctx.strokeStyle = "#2d7dff";
    ctx.lineWidth = 2;
    ctx.strokeRect(18, 28, 204, 104);
    ctx.fillStyle = "#f5f7fb";
    ctx.font = "bold 13px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("mGBA CORE NOT CONNECTED", 120, 70);
    ctx.font = "9px system-ui";
    ctx.fillText("ROM staged for future adapter", 120, 91);
    ctx.fillText(this.loadedROM?.name?.slice(0, 30) || "", 120, 111);
  }

  clear() {
    this.ctx.fillStyle = "#0b0d10";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  ensureLoaded() {
    if (!this.loadedROM) throw new Error("No ROM is loaded.");
  }

  ensureAdapter() {
    if (!this.adapter) {
      throw new Error("The mGBA WebAssembly core is not connected yet.");
    }
  }

  dispatch(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
