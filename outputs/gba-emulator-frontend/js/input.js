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
    this.resetTouchLayout(root);
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
      layout[index] = {
        left: control.style.left || "",
        top: control.style.top || "",
        right: control.style.right || "",
        bottom: control.style.bottom || "",
        transform: control.style.transform || ""
      };
    });
    this.settings.touchLayout = layout;
    this.emit("touchlayout", layout);
  }

  resetTouchLayout(root) {
    const parentRect = root.getBoundingClientRect();
    const width = parentRect.width || 360;
    const height = parentRect.height || 220;
    const paddingX = Math.max(12, width * 0.04);
    const paddingY = Math.max(12, height * 0.04);
    const dpadSize = Math.min(148, Math.max(112, width * 0.34));
    const faceWidth = Math.min(160, Math.max(120, width * 0.4));
    const faceHeight = Math.min(116, Math.max(88, height * 0.26));
    const shoulderHeight = Math.max(36, Math.min(48, height * 0.08));

    root.querySelectorAll(".touch-control").forEach(control => {
      control.style.left = "";
      control.style.top = "";
      control.style.right = "";
      control.style.bottom = "";
      control.style.transform = "";
    });

    const dpad = root.querySelector(".touch-control.dpad");
    if (dpad) {
      dpad.style.left = `${paddingX}px`;
      dpad.style.bottom = `${Math.max(16, height * 0.08)}px`;
      dpad.style.width = `${dpadSize}px`;
      dpad.style.height = `${dpadSize}px`;
    }

    const face = root.querySelector(".touch-control.face-buttons");
    if (face) {
      face.style.right = `${paddingX}px`;
      face.style.bottom = `${Math.max(16, height * 0.09)}px`;
      face.style.width = `${faceWidth}px`;
      face.style.height = `${faceHeight}px`;
    }

    const menu = root.querySelector(".touch-control.menu-buttons");
    if (menu) {
      menu.style.left = `${width / 2}px`;
      menu.style.bottom = `${Math.max(12, height * 0.04)}px`;
      menu.style.transform = "translateX(-50%)";
    }

    const shoulderLeft = root.querySelector(".touch-control.shoulder.left");
    if (shoulderLeft) {
      shoulderLeft.style.top = `${Math.max(16, height * 0.03)}px`;
      shoulderLeft.style.left = `${paddingX}px`;
      shoulderLeft.style.right = "auto";
      shoulderLeft.style.bottom = "auto";
      shoulderLeft.style.height = `${shoulderHeight}px`;
      shoulderLeft.style.minWidth = `${Math.max(72, width * 0.2)}px`;
    }

    const shoulderRight = root.querySelector(".touch-control.shoulder.right");
    if (shoulderRight) {
      shoulderRight.style.top = `${Math.max(16, height * 0.03)}px`;
      shoulderRight.style.right = `${paddingX}px`;
      shoulderRight.style.left = "auto";
      shoulderRight.style.bottom = "auto";
      shoulderRight.style.height = `${shoulderHeight}px`;
      shoulderRight.style.minWidth = `${Math.max(72, width * 0.2)}px`;
    }

    this.settings.touchLayout = {};
    this.emit("touchlayout", {});
  }

  restoreTouchLayout(root) {
    const layout = this.settings.touchLayout || {};
    root.querySelectorAll(".touch-control").forEach((control, index) => {
      const pos = layout[index];
      if (!pos) return;
      control.style.left = pos.left || "";
      control.style.top = pos.top || "";
      control.style.right = pos.right || "";
      control.style.bottom = pos.bottom || "";
      control.style.transform = pos.transform || "";
    });
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
