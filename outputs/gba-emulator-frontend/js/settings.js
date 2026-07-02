export const THEMES = [
  { id: "dark", label: "Dark Mode", swatches: ["#111318", "#2d7dff", "#f5f7fb"] },
  { id: "light", label: "Light Mode", swatches: ["#f6f7fb", "#1463d8", "#1d2430"] },
  { id: "classic", label: "Game Boy Classic", swatches: ["#9bbc0f", "#306230", "#0f380f"] },
  { id: "pixel", label: "Pixel Retro", swatches: ["#201335", "#ffcc33", "#ff5a7a"] },
  { id: "oled", label: "OLED Black", swatches: ["#000000", "#00d084", "#f7f7f7"] }
];

export const ACTIONS = ["Up", "Down", "Left", "Right", "A", "B", "L", "R", "Start", "Select"];

export const DEFAULT_SETTINGS = {
  audio: true,
  volume: 80,
  integerScaling: true,
  showFps: false,
  autosaveInterval: 5,
  theme: "dark",
  highContrast: false,
  autoLandscape: true,
  highPerformance: true,
  displayScale: 1,
  gameSpeed: 1,
  touchControls: true,
  touchOpacity: 82,
  touchSize: 100,
  touchRepositioning: false,
  keyboard: {
    Up: "ArrowUp",
    Down: "ArrowDown",
    Left: "ArrowLeft",
    Right: "ArrowRight",
    A: "KeyZ",
    B: "KeyX",
    L: "KeyA",
    R: "KeyS",
    Start: "Enter",
    Select: "ShiftRight"
  },
  gamepad: {
    Up: "button:12",
    Down: "button:13",
    Left: "button:14",
    Right: "button:15",
    A: "button:0",
    B: "button:1",
    L: "button:4",
    R: "button:5",
    Start: "button:9",
    Select: "button:8"
  },
  touchLayout: {}
};

export const AUTOSAVE_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 1, label: "1 min" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" }
];

export function loadSettings() {
  try {
    const raw = localStorage.getItem("gba-shell-settings");
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return deepMerge(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings) {
  localStorage.setItem("gba-shell-settings", JSON.stringify(settings));
}

export function setLastSession(session) {
  localStorage.setItem("gba-shell-last-session", JSON.stringify(session));
}

export function getLastSession() {
  try {
    return JSON.parse(localStorage.getItem("gba-shell-last-session") || "null");
  } catch {
    return null;
  }
}

function deepMerge(base, incoming) {
  Object.entries(incoming || {}).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      base[key] = deepMerge(base[key] || {}, value);
    } else {
      base[key] = value;
    }
  });
  return base;
}
