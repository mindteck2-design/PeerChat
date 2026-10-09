export type User = {
  id: string;
  username: string;
  display_name: string;
  x25519_public: string;
  ed25519_public: string;
  online?: boolean;
};

export type Conversation = {
  id: string;
  kind: "dm" | "group";
  title?: string | null;
  peer_id?: string;
  peer_name?: string;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: string;
  ciphertext: string;
  nonce: string;
  wrapped_keys: any;
  signature: string;
  file_id?: string | null;
  created_at: string;
};

let baseUrl = "";
let token = "";

export function setBaseUrl(url: string) {
  baseUrl = url.replace(/\/$/, "");
}

export function getBaseUrl() {
  return baseUrl;
}

export function setToken(t: string) {
  token = t;
}

export function getToken() {
  return token;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !(init.body instanceof Uint8Array) && !(init.body instanceof ArrayBuffer) && !(init.body instanceof Blob)) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
  return data as T;
}

export const api = {
  info: () => req<{ fingerprint: string; invite_required: boolean; profile: string }>("/api/info"),
  signup: (body: any) =>
    req<{ user: User; token: string; server_fingerprint: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: any) =>
    req<{ user: User; token: string; server_fingerprint: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  me: () => req<{ user: User; server_fingerprint: string; profile: string }>("/api/me"),
  patchMe: (display_name: string) =>
    req<{ user: User }>("/api/me", { method: "PATCH", body: JSON.stringify({ display_name }) }),
  changePassword: (old_password: string, new_password: string) =>
    req("/api/me/password", {
      method: "POST",
      body: JSON.stringify({ old_password, new_password }),
    }),
  users: () => req<{ users: User[] }>("/api/users"),
  conversations: () => req<{ conversations: Conversation[] }>("/api/conversations"),
  openDm: (peer_id: string) =>
    req<{ conversation: Conversation }>("/api/conversations/dm", {
      method: "POST",
      body: JSON.stringify({ peer_id }),
    }),
  createGroup: (title: string, members: string[], wrapped_group_keys: Record<string, string>) =>
    req<{ conversation: Conversation }>("/api/conversations/group", {
      method: "POST",
      body: JSON.stringify({ title, members, wrapped_group_keys }),
    }),
  messages: (id: string) => req<{ messages: Message[] }>(`/api/conversations/${id}/messages`),
  sendMessage: (id: string, body: any) =>
    req<{ message: Message }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  groupKey: (id: string) =>
    req<{ wrapped_group_key: string }>(`/api/conversations/${id}/group-key`),
  rotateGroupKey: (id: string, wrapped_group_keys: Record<string, string>) =>
    req(`/api/conversations/${id}/group-key/rotate`, {
      method: "POST",
      body: JSON.stringify({ wrapped_group_keys }),
    }),
  members: (id: string) =>
    req<{ members: User[] }>(`/api/conversations/${id}/members`),
  createFile: (body: any) => req<{ file_id: string }>("/api/files", { method: "POST", body: JSON.stringify(body) }),
  getFile: (id: string) => req<{ file: any }>(`/api/files/${id}`),
  fileDownloaded: (id: string) =>
    req<{ ok: boolean; purged: boolean }>(`/api/files/${id}/downloaded`, { method: "POST" }),
  putChunk: async (id: string, index: number, data: Uint8Array, nonce: string) => {
    const res = await fetch(`${baseUrl}/api/files/${id}/chunks/${index}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "X-Chunk-Nonce": nonce,
      },
      body: data as unknown as BodyInit,
    });
    if (!res.ok) throw new Error("chunk upload failed");
  },
  getChunk: async (id: string, index: number) => {
    const res = await fetch(`${baseUrl}/api/files/${id}/chunks/${index}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("chunk missing");
    const nonce = res.headers.get("X-Chunk-Nonce") || "";
    const buf = new Uint8Array(await res.arrayBuffer());
    return { nonce, buf };
  },
};

/** UDP discovery is handled in Tauri; browser fallback uses manual URL. */
export async function discoverServers(): Promise<
  { ip: string; port: number; fingerprint: string; profile: string }[]
> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("discover_servers");
  } catch {
    return [];
  }
}

export async function fetchTlsFingerprint(url: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("tls_fingerprint", { url });
  } catch {
    // Web fallback cannot pin; return empty and rely on browser
    return "";
  }
}
