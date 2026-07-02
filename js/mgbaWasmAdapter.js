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
    this.audioLoopActive = false;
    this.audioLoopRaf = 0;
    this.audioContext = null;
    this.audioGain = null;
    this.audioNode = null;
    this.audioQueue = [];
    this.audioEnabled = false;
    this.audioPreferredEnabled = false;
    this.audioVolume = 1;
    this.audioInitPromise = null;
    this.audioUserActivated = false;
    this.audioUnavailable = false;
    this.gameSpeed = 1;
    this.boundFrame = () => this.frame();
    this.boundAudioFrame = () => this.audioFrame();
  }

  async loadROM(buffer) {
    const bytes = new Uint8Array(buffer);
    const ptr = this.alloc(bytes);
    try {
      this.audioQueue = [];
      if (this.running) await this.pause();
      this.module._mgba_web_unload?.();
      const ok = this.module._mgba_web_load_rom(ptr, bytes.byteLength);
      if (!ok) throw new Error("mGBA rejected this ROM.");
      this.updateCanvasSize();
      this.drawFrame();
    } catch (error) {
      this.audioUnavailable = true;
      throw error;
    } finally {
      this.module._free(ptr);
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.startAudioLoop();
    void this.ensureAudio();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.boundFrame);
  }

  async pause() {
    this.running = false;
    this.stopAudioLoop();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  startAudioLoop() {
    if (this.audioLoopActive) return;
    this.audioLoopActive = true;
    if (this.audioLoopRaf) cancelAnimationFrame(this.audioLoopRaf);
    this.audioLoopRaf = requestAnimationFrame(this.boundAudioFrame);
  }

  stopAudioLoop() {
    this.audioLoopActive = false;
    if (this.audioLoopRaf) cancelAnimationFrame(this.audioLoopRaf);
    this.audioLoopRaf = 0;
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
    try {
      const iterations = Math.max(1, Number(this.gameSpeed) || 1);
      for (let index = 0; index < iterations; index += 1) {
        this.module._mgba_web_run_frame();
      }
      this.drawFrame();
    } catch (error) {
      console.info("Emulator frame failed; stopping the loop.", error);
      this.running = false;
      this.raf = 0;
      this.audioUnavailable = true;
      this.stopAudioLoop();
      return;
    }
    this.raf = requestAnimationFrame(this.boundFrame);
  }

  audioFrame() {
    if (!this.audioLoopActive || !this.running) return;
    try {
      if (this.audioEnabled) {
        this.pullAudio();
      }
    } catch (error) {
      console.info("Audio pipeline failed; continuing without audio.", error);
      this.audioUnavailable = true;
      this.stopAudioLoop();
      return;
    }
    this.audioLoopRaf = requestAnimationFrame(this.boundAudioFrame);
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

  setSettings(settings) {
    const audioAllowed = settings.audio !== false;
    this.audioPreferredEnabled = audioAllowed;
    this.audioEnabled = this.audioPreferredEnabled && this.audioUserActivated;
    this.audioVolume = Number(settings.volume || 100) / 100;
    this.gameSpeed = Number(settings.gameSpeed || 1);
    if (this.module?._mgba_web_set_audio_enabled) {
      this.module._mgba_web_set_audio_enabled(this.audioEnabled ? 1 : 0);
    }
    if (this.audioGain) {
      this.audioGain.gain.value = this.audioEnabled ? this.audioVolume : 0;
    }
    if (this.audioEnabled && this.running) {
      this.startAudioLoop();
    } else {
      this.stopAudioLoop();
    }
  }

  async resumeAudio() {
    this.audioUserActivated = true;
    this.audioEnabled = this.audioPreferredEnabled;
    if (this.module?._mgba_web_set_audio_enabled) {
      this.module._mgba_web_set_audio_enabled(this.audioEnabled ? 1 : 0);
    }
    if (!this.audioEnabled) {
      this.stopAudioLoop();
      return false;
    }
    this.startAudioLoop();
    return this.ensureAudio();
  }

  async ensureAudio() {
    if (!this.audioEnabled || typeof window === "undefined" || this.audioUnavailable) return false;
    if (this.audioInitPromise) return this.audioInitPromise;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      this.audioUnavailable = true;
      return false;
    }
    this.audioInitPromise = (async () => {
      try {
        if (!this.audioContext || this.audioContext.state === "closed") {
          this.audioContext = new AudioContextCtor();
        }
        if (!this.audioGain) {
          this.audioGain = this.audioContext.createGain();
          this.audioGain.gain.value = this.audioEnabled ? this.audioVolume : 0;
          this.audioNode = this.audioContext.createScriptProcessor?.(4096, 2, 2);
          if (!this.audioNode) {
            this.audioUnavailable = true;
            return false;
          }
          this.audioNode.onaudioprocess = event => this.handleAudioProcess(event);
          this.audioNode.connect(this.audioGain);
          this.audioGain.connect(this.audioContext.destination);
        }
        if (this.audioContext.state === "suspended" && this.audioUserActivated) {
          await this.audioContext.resume();
        }
        this.audioUnavailable = false;
        return true;
      } catch (error) {
        this.audioUnavailable = true;
        console.info("Audio setup failed; continuing without audio.", error);
        return false;
      } finally {
        this.audioInitPromise = null;
      }
    })();
    return this.audioInitPromise;
  }

  handleAudioProcess(event) {
    const left = event.outputBuffer.getChannelData(0);
    const right = event.outputBuffer.getChannelData(1);
    for (let index = 0; index < left.length; index += 1) {
      if (this.audioQueue.length >= 2) {
        left[index] = this.audioQueue.shift();
        right[index] = this.audioQueue.shift();
      } else {
        left[index] = 0;
        right[index] = 0;
      }
    }
  }

  pullAudio() {
    if (!this.audioEnabled || !this.module?._mgba_web_read_audio || this.audioUnavailable) return;
    if (this.audioContext?.state === "suspended" && !this.audioUserActivated) return;
    void this.ensureAudio();
    const maxFrames = 1024;
    const ptr = this.module._malloc(maxFrames * 2 * 2);
    try {
      const written = this.module._mgba_web_read_audio(ptr, maxFrames);
      if (written > 0) {
        const samples = this.module.HEAP16.subarray(ptr >> 1, (ptr >> 1) + written * 2);
        for (let index = 0; index < samples.length; index += 2) {
          this.audioQueue.push(samples[index] / 32768);
          this.audioQueue.push(samples[index + 1] / 32768);
        }
      }
    } finally {
      this.module._free(ptr);
    }
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
