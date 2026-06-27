import { EmulatorCore } from "./emulatorCore.js";
import { InputManager } from "./input.js";
import { createMGBAWasmAdapter } from "./mgbaWasmAdapter.js";
import { downloadBlob, StorageService } from "./storage.js";
import { getLastSession, loadSettings, saveSettings, setLastSession } from "./settings.js";
import { UI } from "./ui.js";

const settings = loadSettings();
const storage = new StorageService();
const ui = new UI(settings);
const core = new EmulatorCore(document.querySelector("#gameCanvas"));
const input = new InputManager(settings, core);

let currentROM = null;
let autosaveTimer = 0;

ui.init(nextSettings => {
  saveSettings(nextSettings);
  scheduleAutosave();
});
ui.bindSettings(input);
input.init();
input.attachTouch(document.querySelector("#touchLayer"));

bindToolbar();
restoreRecent();
checkResume();
drawIdleScreen();
scheduleAutosave();
connectMGBA();
setFullscreenUI(Boolean(document.fullscreenElement));

core.addEventListener("status", event => ui.setStatus(event.detail));
input.addEventListener("gamepad", event => {
  document.querySelector("#controllerStatus").textContent = event.detail;
});
input.addEventListener("touchlayout", () => saveSettings(settings));

async function connectMGBA() {
  const adapter = await createMGBAWasmAdapter(document.querySelector("#gameCanvas"), settings);
  core.setAdapter(adapter);
  document.querySelector("#coreStatus").textContent = adapter ? "mGBA ready" : "Core missing";
  if (adapter) ui.toast("mGBA WebAssembly core connected.");
}

function bindToolbar() {
  const romInput = document.querySelector("#romInput");
  const saveInput = document.querySelector("#saveInput");
  const stateInput = document.querySelector("#stateInput");
  document.querySelector("#loadGameBtn").addEventListener("click", () => {
    maybeEnableLandscape();
    romInput.click();
  });
  document.querySelector("#importSaveBtn").addEventListener("click", () => saveInput.click());
  document.querySelector("#importStateBtn").addEventListener("click", () => stateInput.click());
  document.querySelector("#exportSaveBtn").addEventListener("click", exportSave);
  document.querySelector("#saveStateBtn").addEventListener("click", () => saveState(1));
  document.querySelector("#loadStateBtn").addEventListener("click", () => loadState(1));
  document.querySelector("#pauseBtn").addEventListener("click", togglePause);
  document.querySelector("#resetBtn").addEventListener("click", resetGame);
  document.querySelector("#settingsBtn").addEventListener("click", () => ui.showSettings());
  document.querySelector("#themesBtn").addEventListener("click", () => ui.showThemes());
  document.querySelector("#rotateBtn").addEventListener("click", toggleLandscape);
  document.querySelector("#fullscreenBtn").addEventListener("click", toggleFullscreen);
  document.querySelector("#rotateBtn").addEventListener("click", toggleLandscape);
  document.querySelector("#clearRecentBtn").addEventListener("click", clearRecent);
  document.querySelector("#exportBackupBtn").addEventListener("click", exportBackup);
  document.querySelector("#mobileSettingsBtn").addEventListener("click", () => ui.showSettings());
  document.querySelector("#mobileThemesBtn").addEventListener("click", () => ui.showThemes());
  document.querySelector("#mobileStatesBtn").addEventListener("click", () => document.querySelector(".side-panel").scrollIntoView({ behavior: "smooth" }));
  document.querySelector("#continueBtn").addEventListener("click", continueLast);
  document.querySelector("#newGameBtn").addEventListener("click", () => document.querySelector("#resumeDialog").close());
  romInput.addEventListener("change", event => loadFile(event.target.files[0]));
  saveInput.addEventListener("change", event => importSave(event.target.files[0]));
  stateInput.addEventListener("change", event => importState(event.target.files[0]));

  const dropZone = document.querySelector("#dropZone");
  ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  }));
  dropZone.addEventListener("drop", event => loadFile(event.dataTransfer.files[0]));
}

async function loadFile(file) {
  try {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".gba") && !lower.endsWith(".zip")) throw new Error("Choose a .gba or .zip file.");
    ui.setProgress(8);
    const buffer = await readWithProgress(file, value => ui.setProgress(value));
    const romBuffer = lower.endsWith(".zip") ? await extractROMFromZip(buffer) : buffer;
    const romFile = lower.endsWith(".zip") ? new File([romBuffer], file.name.replace(/\.zip$/i, ".gba"), { type: "application/octet-stream" }) : file;
    const rom = await storage.saveROM(romFile, romBuffer);
    await openROM(rom);
    ui.setProgress(100);
    setTimeout(() => ui.setProgress(0, false), 500);
  } catch (error) {
    ui.setProgress(0, false);
    ui.toast(error.message || "Could not load this ROM.", "error");
  }
}

async function openROM(rom) {
  currentROM = await storage.markPlayed(rom);
  ui.setGame(currentROM);
  maybeEnableLandscape();
  const loadedIntoCore = await core.loadROM(currentROM);
  if (loadedIntoCore) void core.start();
  updatePlaybackButtons();
  ui.setGame(currentROM);
  ui.setStatus(loadedIntoCore ? `${currentROM.name} running.` : `${currentROM.name} stored. Build the mGBA WASM core to run it.`);
  setLastSession({ romId: currentROM.id, gameName: currentROM.name, updatedAt: Date.now() });
  await restoreRecent();
  await refreshStates();
  const save = await storage.getSave(currentROM.id);
  document.querySelector("#saveStatus").textContent = save ? `Saved ${new Date(save.updatedAt).toLocaleString()}` : "No save data";
}

async function importSave(file) {
  try {
    if (!currentROM) throw new Error("Load a ROM before importing a save.");
    const name = file?.name?.toLowerCase() || "";
    const isSupported = /\.(sav|srm|bin|raw)$/i.test(name) || !name.includes(".");
    if (!file || !isSupported) throw new Error("Choose a supported save file.");
    const buffer = await file.arrayBuffer();
    await core.loadSave(buffer);
    await storage.saveInGame(currentROM.id, file.name, buffer);
    document.querySelector("#saveStatus").textContent = `Saved ${new Date().toLocaleString()}`;
    ui.toast("Save imported.");
  } catch (error) {
    ui.toast(error.message || "Could not import save.", "error");
  }
}

async function importState(file) {
  try {
    if (!currentROM) throw new Error("Load a ROM before loading a save state.");
    if (!file) return;
    const buffer = await file.arrayBuffer();
    await core.loadState(buffer);
    ui.toast("Save state loaded.");
  } catch (error) {
    ui.toast(error.message || "Could not load save state.", "error");
  }
}

async function exportSave() {
  try {
    if (!currentROM) throw new Error("Load a ROM before exporting a save.");
    let save = await storage.getSave(currentROM.id);
    if (!save) {
      const buffer = await core.save();
      save = await storage.saveInGame(currentROM.id, `${baseName(currentROM.name)}.sav`, buffer);
    }
    downloadBlob(`${baseName(currentROM.name)}.sav`, save.buffer);
    ui.toast("Save exported.");
  } catch (error) {
    ui.toast(error.message || "Could not export save.", "error");
  }
}

async function saveState(slot) {
  try {
    if (!currentROM) throw new Error("Load a ROM before saving state.");
    const payload = await core.saveState();
    const thumbnail = document.querySelector("#gameCanvas").toDataURL("image/webp", 0.68);
    await storage.saveState(currentROM, slot, payload, thumbnail);
    await refreshStates();
    ui.toast(`State saved to slot ${slot}.`);
  } catch (error) {
    ui.toast(error.message || "Could not save state.", "error");
  }
}

async function loadState(slot) {
  try {
    if (!currentROM) throw new Error("Load a ROM before loading state.");
    const state = await storage.getState(currentROM.id, slot);
    if (!state) throw new Error(`Slot ${slot} is empty.`);
    await core.loadState(state.payload);
    ui.toast(`Loaded slot ${slot}.`);
  } catch (error) {
    ui.toast(error.message || "Could not load state.", "error");
  }
}

async function refreshStates() {
  const states = currentROM ? await storage.getStates(currentROM.id) : [];
  ui.renderStateSlots(states, saveState, loadState);
}

async function restoreRecent() {
  const recent = await storage.getRecent();
  ui.renderRecent(recent.sort((a, b) => b.lastPlayed - a.lastPlayed), async id => {
    const rom = await storage.get("roms", id);
    if (rom) await openROM(rom);
  });
}

async function clearRecent() {
  await storage.clearRecent();
  await restoreRecent();
}

async function checkResume() {
  const session = getLastSession();
  if (!session?.romId) return;
  const rom = await storage.get("roms", session.romId).catch(() => null);
  if (rom) ui.showResume(rom.name);
}

async function continueLast() {
  document.querySelector("#resumeDialog").close();
  const session = getLastSession();
  const rom = session?.romId ? await storage.get("roms", session.romId) : null;
  if (rom) await openROM(rom);
}

async function togglePause() {
  try {
    if (!currentROM) throw new Error("Load a game first.");
    if (core.running) {
      await core.pause();
      ui.toast("Paused.");
    } else {
      await core.start();
      ui.toast("Resumed.");
    }
    updatePlaybackButtons();
  } catch (error) {
    ui.toast(error.message || "Could not change playback state.", "error");
  }
}

async function resetGame() {
  try {
    if (!currentROM) throw new Error("Load a game first.");
    await core.reset();
    ui.toast("Reset complete.");
  } catch (error) {
    ui.toast(error.message || "Could not reset the game.", "error");
  }
}

function updatePlaybackButtons() {
  const pauseButton = document.querySelector("#pauseBtn");
  if (pauseButton) pauseButton.textContent = core.running ? "Pause" : "Resume";
}

function scheduleAutosave() {
  clearInterval(autosaveTimer);
  const minutes = Number(settings.autosaveInterval);
  if (!minutes) return;
  autosaveTimer = setInterval(async () => {
    if (!currentROM) return;
    try {
      const buffer = await core.save();
      await storage.saveInGame(currentROM.id, `${baseName(currentROM.name)}.sav`, buffer);
      ui.setStatus(`Auto-saved ${new Date().toLocaleTimeString()}.`);
    } catch {
      ui.setStatus("Auto-save waiting for mGBA core.");
    }
  }, minutes * 60 * 1000);
}

async function exportBackup() {
  try {
    const backup = await storage.exportBackup();
    downloadBlob(`gba-shell-backup-${Date.now()}.json`, JSON.stringify(backup, null, 2), "application/json");
  } catch (error) {
    ui.toast(error.message || "Could not export backup.", "error");
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.querySelector("#app").requestFullscreen?.();
}

function setFullscreenUI(isFullscreen) {
  document.querySelector("#app")?.classList.toggle("is-fullscreen", isFullscreen);
}

function isMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

function maybeEnableLandscape() {
  if (!settings.autoLandscape || !isMobileDevice()) return;
  if (document.documentElement.requestFullscreen && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
  if (screen.orientation?.lock) {
    screen.orientation.lock("landscape").catch(() => {});
  }
}

function toggleLandscape() {
  maybeEnableLandscape();
  if (screen.orientation?.lock) {
    screen.orientation.lock("landscape").catch(() => {});
  }
}

document.addEventListener("fullscreenchange", () => {
  setFullscreenUI(Boolean(document.fullscreenElement));
});

window.addEventListener("orientationchange", () => {
  if (settings.autoLandscape && isMobileDevice()) {
    maybeEnableLandscape();
  }
});

function readWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 92) + 8);
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsArrayBuffer(file);
  });
}

function drawIdleScreen() {
  const canvas = document.querySelector("#gameCanvas");
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#10141d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#273246";
  for (let x = 0; x < canvas.width; x += 16) ctx.fillRect(x, 0, 1, canvas.height);
  for (let y = 0; y < canvas.height; y += 16) ctx.fillRect(0, y, canvas.width, 1);
  ctx.fillStyle = "#e8eefb";
  ctx.font = "bold 14px system-ui";
  ctx.textAlign = "center";
  ctx.fillText("GBA FRONTEND", 120, 78);
  ctx.font = "9px system-ui";
  ctx.fillText("Static app ready for a WebAssembly core", 120, 96);
}

async function extractROMFromZip(buffer) {
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const signature = readUint32LE(bytes, offset);
    if (signature === 0x04034b50) {
      const fileNameLength = readUint16LE(bytes, offset + 26);
      const extraLength = readUint16LE(bytes, offset + 28);
      const compressionMethod = readUint16LE(bytes, offset + 8);
      const compressedSize = readUint32LE(bytes, offset + 18);
      const fileName = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + fileNameLength));
      const dataOffset = offset + 30 + fileNameLength + extraLength;
      const dataEnd = dataOffset + compressedSize;
      if (dataEnd > bytes.length) throw new Error("The ZIP archive is truncated.");
      const entryBytes = bytes.slice(dataOffset, dataEnd);
      if (fileName.toLowerCase().endsWith(".gba")) {
        if (compressionMethod === 0) {
          return entryBytes.buffer.slice(entryBytes.byteOffset, entryBytes.byteOffset + entryBytes.byteLength);
        }
        if (compressionMethod === 8 && typeof DecompressionStream !== "undefined") {
          const stream = new DecompressionStream("deflate-raw");
          const writer = stream.writable.getWriter();
          writer.write(entryBytes);
          writer.close();
          const chunks = [];
          const reader = stream.readable.getReader();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const inflated = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
          let cursor = 0;
          chunks.forEach(chunk => {
            inflated.set(chunk, cursor);
            cursor += chunk.byteLength;
          });
          return inflated.buffer;
        }
        throw new Error("This ZIP uses unsupported compression.");
      }
      offset = dataEnd;
      continue;
    }
    if (signature === 0x06054b50) break;
    break;
  }
  throw new Error("No .gba ROM was found in the ZIP archive.");
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24);
}

function baseName(name) {
  return name.replace(/\.[^.]+$/, "");
}
