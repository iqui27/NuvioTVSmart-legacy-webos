import { LocalStore } from "../../core/storage/localStore.js";

const AVATAR_CATALOG_KEY = "memberAvatarCatalogCache";
const PROFILE_BACKGROUND_CATALOG_KEY = "memberProfileBackgroundCatalogCache";
const DATABASE_NAME = "nuvio_member_asset_cache";
const DATABASE_VERSION = 1;
const ASSET_STORE_NAME = "assets";

const memoryAssets = new Map();
let databasePromise = null;

function normalizeCatalogPayload(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function assetKey(kind, id, assetVersion) {
  return `${String(kind || "asset").trim()}:${String(id || "").trim()}:v${Number(assetVersion || 1) || 1}`;
}

function canUseIndexedDb() {
  return typeof globalThis.indexedDB !== "undefined";
}

function openDatabase() {
  if (!canUseIndexedDb()) {
    return Promise.resolve(null);
  }
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve) => {
    let request;
    try {
      request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (_) {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(ASSET_STORE_NAME)) {
        database.createObjectStore(ASSET_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return databasePromise;
}

function isBlobLike(value) {
  return Boolean(value && typeof value === "object" && Number(value.size) >= 0);
}

async function readAsset(key) {
  if (memoryAssets.has(key)) {
    return memoryAssets.get(key);
  }
  const database = await openDatabase();
  if (!database) {
    return null;
  }
  return await new Promise((resolve) => {
    try {
      const transaction = database.transaction(ASSET_STORE_NAME, "readonly");
      const request = transaction.objectStore(ASSET_STORE_NAME).get(key);
      request.onsuccess = () => {
        const blob = request.result?.blob;
        if (isBlobLike(blob)) {
          memoryAssets.set(key, blob);
          resolve(blob);
          return;
        }
        resolve(null);
      };
      request.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

async function writeAsset(key, blob) {
  if (!isBlobLike(blob)) {
    return;
  }
  memoryAssets.set(key, blob);
  const database = await openDatabase();
  if (!database) {
    return;
  }
  await new Promise((resolve) => {
    try {
      const transaction = database.transaction(ASSET_STORE_NAME, "readwrite");
      transaction.objectStore(ASSET_STORE_NAME).put({ key, blob });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch (_) {
      resolve();
    }
  });
}

export const MemberCatalogStorage = {
  loadAvatarCatalog() {
    return normalizeCatalogPayload(LocalStore.get(AVATAR_CATALOG_KEY, null));
  },

  saveAvatarCatalog(payload) {
    const normalized = normalizeCatalogPayload(payload);
    if (normalized) {
      LocalStore.set(AVATAR_CATALOG_KEY, normalized);
    }
  },

  loadProfileBackgroundCatalog() {
    return normalizeCatalogPayload(LocalStore.get(PROFILE_BACKGROUND_CATALOG_KEY, null));
  },

  saveProfileBackgroundCatalog(payload) {
    const normalized = normalizeCatalogPayload(payload);
    if (normalized) {
      LocalStore.set(PROFILE_BACKGROUND_CATALOG_KEY, normalized);
    }
  },

  loadAsset(kind, id, assetVersion = 1) {
    const key = assetKey(kind, id, assetVersion);
    return readAsset(key);
  },

  saveAsset(kind, id, assetVersion, blob) {
    const key = assetKey(kind, id, assetVersion);
    return writeAsset(key, blob);
  }
};
