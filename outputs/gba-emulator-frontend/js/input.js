import { ACTIONS } from "./settings.js";

export class InputManager extends EventTarget {
  constructor(settings, core) {
    super();
    this.settings = settings;
    this.core = core;
    this.pressed = new Set();
    this.gamepadIndex = null;
    this.listeningFor = null;
    this.touchPointers = new Map();
    this.raf = 0;
  }

  init() {
    window.addEventListener("keydown", event => this.handleKeyboard(event, true));
    window.addEventListener("keyup", event => this.handleKeyboard(event, false));
    window.addEventListener("gamepadconnected", event => {
      this.gamepadIndex = event.gamepad.index;
      this.emit("gamepad", `${event.gamepad.id} connected`);
      this.pollGamepad();
    });
    window.addEventListener("gamepaddisconnected", () => {
      this.gamepadIndex = null;
      this.emit("gamepad", "No gamepad");
    });
    this.pollGamepad();
  }

  attachTouch(root) {
    root.querySelectorAll("[data-key]").forEach(element => {
      element.addEventListener("pointerdown", event => this.touch(event, element.dataset.key, true));
      element.addEventListener("pointerup", event => this.touch(event, element.dataset.key, false));
      element.addEventListener("pointercancel", event => this.touch(event, element.dataset.key, false));
      element.addEventListener("lostpointercapture", event => this.touch(event, element.dataset.key, false));
    });
    this.makeDraggable(root);
    this.restoreTouchLayout(root);
  }

  handleKeyboard(event, pressed) {
    if (this.listeningFor && pressed) {
      event.preventDefault();
      this.settings.keyboard[this.listeningFor] = event.code;
      this.emit("remap", { action: this.listeningFor, code: event.code });
      this.listeningFor = null;
      return;
    }
    const action = Object.entries(this.settings.keyboard).find(([, code]) => code === event.code)?.[0];
    if (!action) return;
    event.preventDefault();
    this.setAction(action, pressed);
  }

  touch(event, action, pressed) {
    if (this.settings.touchRepositioning) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    this.setAction(action, pressed);
  }

  setAction(action, pressed) {
    if (!ACTIONS.includes(action)) return;
    const key = action;
    if (pressed && this.pressed.has(key)) return;
    if (!pressed && !this.pressed.has(key)) return;
    pressed ? this.pressed.add(key) : this.pressed.delete(key);
    this.core.setInput(action, pressed);
    this.emit("input", { action, pressed });
  }

  listenFor(action) {
    this.listeningFor = action;
  }

  pollGamepad() {
    const pads = navigator.getGamepads?.() || [];
    const pad = this.gamepadIndex !== null ? pads[this.gamepadIndex] : [...pads].find(Boolean);
    if (pad) {
      this.gamepadIndex = pad.index;
      Object.entries(this.settings.gamepad).forEach(([action, binding]) => {
        const [kind, indexText] = binding.split(":");
        const index = Number(indexText);
        const pressed = kind === "button" ? Boolean(pad.buttons[index]?.pressed) : Math.abs(pad.axes[index]) > 0.55;
        this.setAction(action, pressed);
      });
    }
    this.raf = requestAnimationFrame(() => this.pollGamepad());
  }

  makeDraggable(root) {
    root.querySelectorAll(".touch-control").forEach(control => {
      let start = null;
      control.addEventListener("pointerdown", event => {
        if (!this.settings.touchRepositioning) return;
        if (event.target.closest("button")) return;
        start = { x: event.clientX, y: event.clientY, left: control.offsetLeft, top: control.offsetTop };
        control.setPointerCapture(event.pointerId);
      });
      control.addEventListener("pointermove", event => {
        if (!start) return;
        const parent = root.getBoundingClientRect();
        const x = clamp(start.left + event.clientX - start.x, 0, parent.width - control.offsetWidth);
        const y = clamp(start.top + event.clientY - start.y, 0, parent.height - control.offsetHeight);
        control.style.left = `${x}px`;
        control.style.top = `${y}px`;
        control.style.right = "auto";
        control.style.bottom = "auto";
      });
      control.addEventListener("pointerup", () => { start = null; this.persistTouchLayout(root); });
      control.addEventListener("pointercancel", () => { start = null; });
    });
  }

  persistTouchLayout(root) {
    const layout = {};
    root.querySelectorAll(".touch-control").forEach((control, index) => {
      layout[index] = { left: control.style.left, top: control.style.top };
    });
    this.settings.touchLayout = layout;
    this.emit("touchlayout", layout);
  }

  restoreTouchLayout(root) {
    const layout = this.settings.touchLayout || {};
    root.querySelectorAll(".touch-control").forEach((control, index) => {
      const pos = layout[index];
      if (!pos) return;
      control.style.left = pos.left || "auto";
      control.style.top = pos.top || "auto";
      control.style.right = "auto";
      control.style.bottom = "auto";
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
