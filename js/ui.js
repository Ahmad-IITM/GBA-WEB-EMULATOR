import { ACTIONS, AUTOSAVE_OPTIONS, THEMES } from "./settings.js";

export class UI {
  constructor(settings) {
    this.settings = settings;
    this.$ = selector => document.querySelector(selector);
    this.elements = {
      app: this.$("#app"),
      canvas: this.$("#gameCanvas"),
      overlay: this.$("#screenOverlay"),
      status: this.$("#statusText"),
      autosave: this.$("#autosaveText"),
      romName: this.$("#romName"),
      controller: this.$("#controllerStatus"),
      saveStatus: this.$("#saveStatus"),
      recent: this.$("#recentGames"),
      states: this.$("#stateSlots"),
      toast: this.$("#toastRegion"),
      progress: this.$("#loadProgress"),
      fps: this.$("#fpsBadge"),
      touchLayer: this.$("#touchLayer"),
      settingsDialog: this.$("#settingsDialog"),
      themeDialog: this.$("#themeDialog"),
      resumeDialog: this.$("#resumeDialog")
    };
  }

  init(onChange) {
    this.onChange = onChange;
    this.populateSettings();
    this.applySettings();
    this.bindTabs();
    this.renderThemeCards();
    this.renderStateSlots([]);
  }

  populateSettings() {
    const autosaveSelect = this.$("#autosaveSelect");
    autosaveSelect.innerHTML = AUTOSAVE_OPTIONS.map(option => `<option value="${option.value}">${option.label}</option>`).join("");
    const themeSelect = this.$("#themeSelect");
    themeSelect.innerHTML = THEMES.map(theme => `<option value="${theme.id}">${theme.label}</option>`).join("");
    this.$("#keyboardMap").innerHTML = ACTIONS.map(action => `
      <div class="map-row">
        <span>${action}</span>
        <button type="button" data-remap="${action}">${prettyCode(this.settings.keyboard[action])}</button>
      </div>`).join("");
    this.$("#gamepadMap").innerHTML = ACTIONS.map(action => `
      <div class="map-row">
        <span>${action}</span>
        <code>${this.settings.gamepad[action]}</code>
      </div>`).join("");
  }

  bindSettings(inputManager) {
    const map = [
      ["#audioToggle", "audio", "checked"],
      ["#volumeRange", "volume", "value"],
      ["#integerScaleToggle", "integerScaling", "checked"],
      ["#fpsToggle", "showFps", "checked"],
      ["#autosaveSelect", "autosaveInterval", "value"],
      ["#themeSelect", "theme", "value"],
      ["#touchToggle", "touchControls", "checked"],
      ["#touchOpacity", "touchOpacity", "value"],
      ["#touchSize", "touchSize", "value"]
    ];
    map.forEach(([selector, key, prop]) => {
      const input = this.$(selector);
      input.addEventListener("input", () => {
        const raw = input[prop];
        this.settings[key] = typeof this.settings[key] === "boolean" ? Boolean(raw) : Number(raw) || raw;
        this.applySettings();
        this.onChange?.(this.settings);
      });
    });
    ["#landscapeToggle", "#performanceToggle", "#touchToggle"].forEach(selector => {
      const input = this.$(selector);
      input.addEventListener("input", () => {
        const key = selector === "#landscapeToggle" ? "autoLandscape" : selector === "#performanceToggle" ? "highPerformance" : "touchControls";
        this.settings[key] = Boolean(input.checked);
        this.applySettings();
        this.onChange?.(this.settings);
      });
    });
    this.$("#keyboardMap").addEventListener("click", event => {
      const button = event.target.closest("[data-remap]");
      if (!button) return;
      button.textContent = "Press key";
      inputManager.listenFor(button.dataset.remap);
    });
    inputManager.addEventListener("remap", event => {
      const { action, code } = event.detail;
      const button = this.$(`[data-remap="${action}"]`);
      if (button) button.textContent = prettyCode(code);
      this.onChange?.(this.settings);
      this.toast(`${action} mapped to ${prettyCode(code)}.`);
    });
    this.$("#resetTouchBtn").addEventListener("click", () => {
      this.elements.touchLayer.querySelectorAll(".touch-control").forEach(control => {
        control.removeAttribute("style");
      });
      this.settings.touchLayout = {};
      this.onChange?.(this.settings);
    });
    this.$("#repositionTouchBtn").addEventListener("click", () => {
      this.settings.touchRepositioning = !this.settings.touchRepositioning;
      this.applySettings();
      this.onChange?.(this.settings);
      this.toast(this.settings.touchRepositioning ? "Touch controls can now be moved." : "Touch controls locked.");
    });
  }

  applySettings() {
    const s = this.settings;
    this.elements.app.dataset.theme = s.theme;
    this.elements.app.classList.toggle("integer-scale", s.integerScaling);
    this.elements.app.classList.toggle("display-scale-2x", Number(s.displayScale) === 2);
    this.elements.fps.hidden = !s.showFps;
    this.elements.touchLayer.classList.toggle("disabled", !s.touchControls);
    this.elements.touchLayer.classList.toggle("touch-editing", Boolean(s.touchRepositioning));
    this.elements.touchLayer.style.setProperty("--touch-opacity", `${Number(s.touchOpacity) / 100}`);
    this.elements.touchLayer.style.setProperty("--touch-scale", `${Number(s.touchSize) / 100}`);
    this.$("#audioToggle").checked = s.audio;
    this.$("#volumeRange").value = s.volume;
    this.$("#integerScaleToggle").checked = s.integerScaling;
    this.$("#fpsToggle").checked = s.showFps;
    this.$("#autosaveSelect").value = s.autosaveInterval;
    this.$("#themeSelect").value = s.theme;
    this.$("#displayScaleSelect").value = String(s.displayScale || 1);
    this.$("#landscapeToggle").checked = s.autoLandscape;
    this.$("#performanceToggle").checked = s.highPerformance;
    this.$("#touchToggle").checked = s.touchControls;
    this.$("#touchOpacity").value = s.touchOpacity;
    this.$("#touchSize").value = s.touchSize;
    this.$("#repositionTouchBtn").textContent = s.touchRepositioning ? "Done moving" : "Move controls";
    const scale = Number(s.displayScale || 1);
    this.elements.canvas.style.setProperty("--display-scale", String(scale));
    this.elements.canvas.style.width = "100%";
    this.elements.canvas.style.height = "auto";
    this.elements.canvas.style.maxWidth = "100%";
    this.elements.canvas.style.maxHeight = "100%";
    const label = AUTOSAVE_OPTIONS.find(option => Number(option.value) === Number(s.autosaveInterval))?.label || "Off";
    this.elements.autosave.textContent = `Auto-save: ${label}`;
  }

  bindTabs() {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
        document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
        tab.classList.add("active");
        this.$(`[data-panel="${tab.dataset.tab}"]`).classList.add("active");
      });
    });
  }

  renderThemeCards() {
    this.$("#themeCards").innerHTML = THEMES.map(theme => `
      <button type="button" class="theme-card" data-theme-card="${theme.id}">
        <span class="swatches">${theme.swatches.map(color => `<i style="background:${color}"></i>`).join("")}</span>
        <strong>${theme.label}</strong>
      </button>`).join("");
    this.$("#themeCards").addEventListener("click", event => {
      const card = event.target.closest("[data-theme-card]");
      if (!card) return;
      this.settings.theme = card.dataset.themeCard;
      this.applySettings();
      this.onChange?.(this.settings);
    });
  }

  renderRecent(items, onOpen) {
    if (!items.length) {
      this.elements.recent.innerHTML = `<p class="empty">No recent games yet.</p>`;
      return;
    }
    this.elements.recent.innerHTML = items.map(item => `
      <button type="button" class="recent-item" data-rom-id="${item.id}">
        <span>${escapeHtml(item.name)}</span>
        <small>${formatDate(item.lastPlayed)}</small>
      </button>`).join("");
    this.elements.recent.querySelectorAll("[data-rom-id]").forEach(button => {
      button.addEventListener("click", () => onOpen(button.dataset.romId));
    });
  }

  renderStateSlots(states, onSave, onLoad) {
    const bySlot = new Map(states.map(state => [state.slot, state]));
    this.elements.states.innerHTML = Array.from({ length: 10 }, (_, index) => {
      const slot = index + 1;
      const state = bySlot.get(slot);
      return `
        <article class="state-slot">
          <div class="thumb">${state?.thumbnail ? `<img src="${state.thumbnail}" alt="">` : `<span>Slot ${slot}</span>`}</div>
          <div>
            <strong>${state ? escapeHtml(state.gameName) : "Empty"}</strong>
            <small>${state ? formatDate(state.timestamp) : "No state"}</small>
          </div>
          <div class="slot-actions">
            <button type="button" data-save-slot="${slot}">Save</button>
            <button type="button" data-load-slot="${slot}" ${state ? "" : "disabled"}>Load</button>
          </div>
        </article>`;
    }).join("");
    this.elements.states.querySelectorAll("[data-save-slot]").forEach(button => button.addEventListener("click", () => onSave?.(Number(button.dataset.saveSlot))));
    this.elements.states.querySelectorAll("[data-load-slot]").forEach(button => button.addEventListener("click", () => onLoad?.(Number(button.dataset.loadSlot))));
  }

  setGame(rom) {
    this.elements.romName.textContent = rom?.name || "None loaded";
    this.elements.overlay.hidden = Boolean(rom);
    this.elements.overlay.style.display = rom ? "none" : "grid";
    this.elements.overlay.classList.toggle("is-hidden", Boolean(rom));
    this.elements.overlay.setAttribute("aria-hidden", rom ? "true" : "false");
  }

  setStatus(text) {
    this.elements.status.textContent = text;
  }

  setProgress(value, visible = true) {
    this.elements.progress.hidden = !visible;
    this.elements.progress.value = value;
  }

  toast(message, type = "info") {
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    this.elements.toast.append(item);
    setTimeout(() => item.remove(), 3800);
  }

  showSettings() { this.elements.settingsDialog.showModal(); }
  showThemes() { this.elements.themeDialog.showModal(); }
  showResume(name) {
    this.$("#resumeText").textContent = `Continue playing ${name}?`;
    this.elements.resumeDialog.showModal();
  }
}

function prettyCode(code = "") {
  return code.replace("Key", "").replace("Arrow", "").replace("ShiftRight", "Shift");
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}
