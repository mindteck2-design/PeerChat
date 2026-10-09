import {
  deserializeIdentity,
  generateIdentity,
  serializeIdentity,
  type Identity,
} from "./crypto";

const KEYS = {
  serverUrl: "lanmsg.serverUrl",
  pinnedFp: "lanmsg.pinnedFp",
  token: "lanmsg.token",
  user: "lanmsg.user",
  identity: "lanmsg.identity",
};

async function tauriStore() {
  try {
    const { Store } = await import("@tauri-apps/plugin-store");
    return await Store.load("lanmsg.json");
  } catch {
    return null;
  }
}

export async function saveLocal(key: string, value: unknown) {
  const store = await tauriStore();
  if (store) {
    await store.set(key, value);
    await store.save();
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export async function loadLocal<T>(key: string): Promise<T | null> {
  const store = await tauriStore();
  if (store) {
    const v = await store.get<T>(key);
    return v ?? null;
  }
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function removeLocal(key: string) {
  const store = await tauriStore();
  if (store) {
    await store.delete(key);
    await store.save();
    return;
  }
  localStorage.removeItem(key);
}

export async function getOrCreateIdentity(): Promise<Identity> {
  const saved = await loadLocal<ReturnType<typeof serializeIdentity>>(KEYS.identity);
  if (saved) return deserializeIdentity(saved);
  const id = generateIdentity();
  await saveLocal(KEYS.identity, serializeIdentity(id));
  return id;
}

export { KEYS };
