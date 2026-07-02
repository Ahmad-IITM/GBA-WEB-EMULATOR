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
    const gameKey = buildGameKey(await toBytes(buffer));
    const record = { id, gameKey, name: file.name, size: file.size, type: file.name.endsWith(".zip") ? "zip" : "gba", buffer, addedAt: now, lastPlayed: now };
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
    const keys = resolveRomKeys(romId);
    const record = { romId: keys.primary, legacyRomId: keys.legacy, name, buffer, updatedAt: Date.now() };
    await this.put("saves", record);
    return record;
  }

  async getSave(rom) {
    const keys = resolveRomKeys(rom);
    const all = await this.all("saves");
    return all.find(record => keys.all.includes(record.romId) || keys.all.includes(record.legacyRomId) || record.name === keys.name) || null;
  }

  async saveState(rom, slot, payload, thumbnail) {
    const keys = resolveRomKeys(rom);
    const record = {
      id: `${keys.primary}:${slot}`,
      romId: keys.primary,
      legacyRomId: keys.legacy,
      slot,
      gameName: rom.name,
      timestamp: Date.now(),
      payload,
      thumbnail
    };
    await this.put("states", record);
    return record;
  }

  async getState(rom, slot) {
    const keys = resolveRomKeys(rom);
    const all = await this.all("states");
    return all.find(record => record.slot === slot && (keys.all.includes(record.romId) || keys.all.includes(record.legacyRomId) || record.gameName === keys.name)) || null;
  }

  async getStates(rom) {
    const keys = resolveRomKeys(rom);
    const all = await this.all("states");
    return all.filter(state => keys.all.includes(state.romId) || keys.all.includes(state.legacyRomId) || state.gameName === keys.name).sort((a, b) => a.slot - b.slot);
  }

  async exportBackup() {
    const [roms, saves, states] = await Promise.all(STORES.map(store => this.all(store)));
    return {
      exportedAt: new Date().toISOString(),
      roms: roms.map(serializeRomRecord),
      saves: saves.map(serializeSaveRecord),
      states: states.map(serializeStateRecord)
    };
  }

  async importBackup(backup) {
    if (!backup || typeof backup !== "object") {
      throw new Error("This backup file is not valid.");
    }
    const roms = Array.isArray(backup.roms) ? backup.roms : [];
    const saves = Array.isArray(backup.saves) ? backup.saves : [];
    const states = Array.isArray(backup.states) ? backup.states : [];
    for (const rom of roms) {
      await this.put("roms", deserializeRomRecord(rom));
    }
    for (const save of saves) {
      await this.put("saves", deserializeSaveRecord(save));
    }
    for (const state of states) {
      await this.put("states", deserializeStateRecord(state));
    }
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

function resolveRomKeys(romOrId) {
  if (romOrId && typeof romOrId === "object") {
    const primary = romOrId.gameKey || romOrId.id || "";
    const legacy = romOrId.id && romOrId.id !== primary ? romOrId.id : "";
    return { primary, legacy, name: romOrId.name || "", all: [primary, legacy].filter(Boolean) };
  }
  return { primary: String(romOrId || ""), legacy: "", name: "", all: [String(romOrId || "")].filter(Boolean) };
}

function buildGameKey(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const title = readNullTerminatedText(view, 0xA0, 12);
  const code = readNullTerminatedText(view, 0xAC, 4);
  const crc32 = toHex32(crc32Bytes(view));
  return `${title}|${code}|${crc32}`;
}

function readNullTerminatedText(view, offset, length) {
  let text = "";
  for (let index = 0; index < length && offset + index < view.length; index += 1) {
    const byte = view[offset + index];
    if (byte === 0) break;
    text += String.fromCharCode(byte);
  }
  return text || "unknown";
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32Bytes(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function toHex32(value) {
  return (value >>> 0).toString(16).padStart(8, "0");
}

async function toBytes(buffer) {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (buffer?.data instanceof ArrayBuffer) return new Uint8Array(buffer.data);
  if (buffer instanceof Blob) return new Uint8Array(await buffer.arrayBuffer());
  if (buffer instanceof File) return new Uint8Array(await buffer.arrayBuffer());
  return new Uint8Array(buffer || []);
}

function stripBuffer(record) {
  const { buffer, ...rest } = record;
  return { ...rest, byteLength: buffer?.byteLength || 0 };
}

function serializeRomRecord(record) {
  return { ...stripBuffer(record), bufferBase64: encodeBuffer(record.buffer) };
}

function serializeSaveRecord(record) {
  return { ...stripBuffer(record), bufferBase64: encodeBuffer(record.buffer) };
}

function serializeStateRecord(record) {
  return { ...record, payloadBase64: encodeBuffer(record.payload) };
}

function deserializeRomRecord(record) {
  return {
    ...record,
    buffer: decodeBuffer(record.bufferBase64),
    byteLength: record.byteLength || 0
  };
}

function deserializeSaveRecord(record) {
  return {
    ...record,
    buffer: decodeBuffer(record.bufferBase64),
    byteLength: record.byteLength || 0
  };
}

function deserializeStateRecord(record) {
  return {
    ...record,
    payload: decodeBuffer(record.payloadBase64),
    byteLength: record.byteLength || 0
  };
}

function encodeBuffer(buffer) {
  if (!buffer) return "";
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBuffer(base64) {
  if (!base64) return new ArrayBuffer(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
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
