const CORE_MODULE_URL = "../cores/mgba/dist/mgba-core.js";

const KEY_MASK = {
  A: 1,
  B: 2,
  Select: 4,
  Start: 8,
  Right: 16,
  Left: 32,
  Up: 64,
  Down: 128,
  R: 256,
  L: 512
};

export async function createMGBAWasmAdapter(canvas) {
  try {
    const { default: createMGBA } = await import(CORE_MODULE_URL);
    const module = await createMGBA({
      locateFile(path) {
        return new URL(`../cores/mgba/dist/${path}`, import.meta.url).href;
      }
    });
    return new MGBAWasmAdapter(module, canvas);
  } catch (error) {
    console.info("mGBA WebAssembly core is not available yet.", error);
    return null;
  }
}

class MGBAWasmAdapter {
  constructor(module, canvas) {
    this.module = module;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.imageData = this.ctx.createImageData(240, 160);
    this.keyMask = 0;
    this.running = false;
    this.raf = 0;
    this.boundFrame = () => this.frame();
  }

  async loadROM(buffer) {
    const bytes = new Uint8Array(buffer);
    const ptr = this.alloc(bytes);
    try {
      const ok = this.module._mgba_web_load_rom(ptr, bytes.byteLength);
      if (!ok) throw new Error("mGBA rejected this ROM.");
      this.updateCanvasSize();
      this.drawFrame();
    } finally {
      this.module._free(ptr);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.boundFrame);
  }

  async pause() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  async reset() {
    this.module._mgba_web_reset();
    this.drawFrame();
  }

  async save() {
    const size = this.module._mgba_web_save_size();
    if (!size) return new ArrayBuffer(0);
    const ptr = this.module._malloc(size);
    try {
      const written = this.module._mgba_web_save_data(ptr, size);
      return this.copyOut(ptr, written);
    } finally {
      this.module._free(ptr);
    }
  }

  async loadSave(buffer) {
    const bytes = await this.toBytes(buffer);
    if (!bytes.byteLength) throw new Error("This save file is empty.");
    const wasRunning = this.running;
    if (wasRunning) await this.pause();
    const expectedSize = this.module._mgba_web_save_size() || bytes.byteLength;
    const payload = new Uint8Array(expectedSize);
    payload.set(bytes.subarray(0, Math.min(bytes.byteLength, expectedSize)));
    const ptr = this.alloc(payload);
    try {
      const ok = this.module._mgba_web_load_save(ptr, payload.byteLength);
      if (!ok) throw new Error("mGBA could not load this save.");
      this.drawFrame();
    } finally {
      this.module._free(ptr);
    }
    if (wasRunning) await this.start();
  }

  async saveState() {
    const size = this.module._mgba_web_state_size();
    if (!size) throw new Error("mGBA did not expose a state size.");
    const ptr = this.module._malloc(size);
    try {
      const ok = this.module._mgba_web_save_state(ptr, size);
      if (!ok) throw new Error("mGBA could not save state.");
      return this.copyOut(ptr, size);
    } finally {
      this.module._free(ptr);
    }
  }

  async loadState(buffer) {
    const bytes = await this.toBytes(buffer);
    const ptr = this.alloc(bytes);
    try {
      const ok = this.module._mgba_web_load_state(ptr, bytes.byteLength);
      if (!ok) throw new Error("mGBA could not load state.");
      this.drawFrame();
    } finally {
      this.module._free(ptr);
    }
  }

  setInput(action, pressed) {
    const bit = KEY_MASK[action] || 0;
    this.keyMask = pressed ? this.keyMask | bit : this.keyMask & ~bit;
    this.module._mgba_web_set_keys(this.keyMask);
  }

  async stop() {
    await this.pause();
    this.module._mgba_web_unload();
  }

  frame() {
    if (!this.running) return;
    this.module._mgba_web_run_frame();
    this.drawFrame();
    this.raf = requestAnimationFrame(this.boundFrame);
  }

  drawFrame() {
    const ptr = this.module._mgba_web_framebuffer();
    const width = this.module._mgba_web_framebuffer_width();
    const height = this.module._mgba_web_framebuffer_height();
    const stride = this.module._mgba_web_framebuffer_stride();
    if (this.imageData.width !== width || this.imageData.height !== height) {
      this.imageData = this.ctx.createImageData(width, height);
    }
    const source = this.module.HEAPU16.subarray(ptr >> 1, (ptr >> 1) + stride * height);
    const dest = this.imageData.data;
    let out = 0;
    for (let y = 0; y < height; y += 1) {
      const row = y * stride;
      for (let x = 0; x < width; x += 1) {
        const pixel = source[row + x];
        const r = ((pixel >> 11) & 0x1f) << 3;
        const g = ((pixel >> 5) & 0x3f) << 2;
        const b = (pixel & 0x1f) << 3;
        dest[out++] = r;
        dest[out++] = g;
        dest[out++] = b;
        dest[out++] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  updateCanvasSize() {
    this.canvas.width = this.module._mgba_web_framebuffer_width();
    this.canvas.height = this.module._mgba_web_framebuffer_height();
  }

  alloc(bytes) {
    const ptr = this.module._malloc(bytes.byteLength);
    this.module.HEAPU8.set(bytes, ptr);
    return ptr;
  }

  async toBytes(buffer) {
    if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
    if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    if (buffer?.data instanceof ArrayBuffer) return new Uint8Array(buffer.data);
    if (buffer instanceof Blob) return new Uint8Array(await buffer.arrayBuffer());
    if (buffer instanceof File) return new Uint8Array(await buffer.arrayBuffer());
    return new Uint8Array(buffer || []);
  }

  copyOut(ptr, size) {
    const view = this.module.HEAPU8.slice(ptr, ptr + size);
    return view.buffer;
  }
}
