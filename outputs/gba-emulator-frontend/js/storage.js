const DB_NAME = "gba-shell-db";
const DB_VERSION = 1;
const STORES = ["roms", "saves", "states"];

export class StorageService {
  constructor() {
    this.dbPromise = this.open();
  }

  open() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not available in this browser."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("roms")) {
          const store = db.createObjectStore("roms", { keyPath: "id" });
          store.createIndex("lastPlayed", "lastPlayed");
        }
        if (!db.objectStoreNames.contains("saves")) db.createObjectStore("saves", { keyPath: "romId" });
        if (!db.objectStoreNames.contains("states")) {
          const store = db.createObjectStore("states", { keyPath: "id" });
          store.createIndex("romId", "romId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(storeName, value) {
    const db = await this.dbPromise;
    return txRequest(db, storeName, "readwrite", store => store.put(value));
  }

  async get(storeName, key) {
    const db = await this.dbPromise;
    return txRequest(db, storeName, "readonly", store => store.get(key));
  }

  async delete(storeName, key) {
    const db = await this.dbPromise;
    return txRequest(db, storeName, "readwrite", store => store.delete(key));
  }

  async all(storeName) {
    const db = await this.dbPromise;
    return txRequest(db, storeName, "readonly", store => store.getAll());
  }

  async clear(storeName) {
    const db = await this.dbPromise;
    return txRequest(db, storeName, "readwrite", store => store.clear());
  }

  async saveROM(file, buffer) {
    const now = Date.now();
    const id = await digest(`${file.name}:${file.size}:${file.lastModified}`);
    const record = { id, name: file.name, size: file.size, type: file.name.endsWith(".zip") ? "zip" : "gba", buffer, addedAt: now, lastPlayed: now };
    await this.put("roms", record);
    await this.updateRecent(record);
    return record;
  }

  async markPlayed(rom) {
    const updated = { ...rom, lastPlayed: Date.now() };
    await this.put("roms", updated);
    await this.updateRecent(updated);
    return updated;
  }

  async updateRecent(rom) {
    const recent = await this.getRecent();
    const next = [{ id: rom.id, name: rom.name, lastPlayed: Date.now(), size: rom.size }, ...recent.filter(item => item.id !== rom.id)].slice(0, 12);
    localStorage.setItem("gba-shell-recent", JSON.stringify(next));
  }

  async getRecent() {
    try {
      return JSON.parse(localStorage.getItem("gba-shell-recent") || "[]");
    } catch {
      return [];
    }
  }

  async clearRecent() {
    localStorage.removeItem("gba-shell-recent");
  }

  async saveInGame(romId, name, buffer) {
    const record = { romId, name, buffer, updatedAt: Date.now() };
    await this.put("saves", record);
    return record;
  }

  async getSave(romId) {
    return this.get("saves", romId);
  }

  async saveState(rom, slot, payload, thumbnail) {
    const record = {
      id: `${rom.id}:${slot}`,
      romId: rom.id,
      slot,
      gameName: rom.name,
      timestamp: Date.now(),
      payload,
      thumbnail
    };
    await this.put("states", record);
    return record;
  }

  async getState(romId, slot) {
    return this.get("states", `${romId}:${slot}`);
  }

  async getStates(romId) {
    const all = await this.all("states");
    return all.filter(state => state.romId === romId).sort((a, b) => a.slot - b.slot);
  }

  async exportBackup() {
    const [roms, saves, states] = await Promise.all(STORES.map(store => this.all(store)));
    return { exportedAt: new Date().toISOString(), roms: roms.map(stripBuffer), saves: saves.map(stripBuffer), states };
  }
}

function txRequest(db, storeName, mode, makeRequest) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = makeRequest(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onerror = () => reject(tx.error);
  });
}

async function digest(text) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
}

function stripBuffer(record) {
  const { buffer, ...rest } = record;
  return { ...rest, byteLength: buffer?.byteLength || 0 };
}

export function downloadBlob(filename, data, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
