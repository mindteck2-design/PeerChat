import { ed25519, x25519 } from "@noble/curves/ed25519";
import { gcm } from "@noble/ciphers/aes";
import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";

/** Larger chunks = fewer encrypt + TLS round-trips on big LAN files (max 8 MiB). */
export const CHUNK_SIZE = 8 * 1024 * 1024;

export type Identity = {
  x25519Private: Uint8Array;
  x25519Public: Uint8Array;
  ed25519Private: Uint8Array;
  ed25519Public: Uint8Array;
};

function b64(bytes: Uint8Array): string {
  // Chunked conversion avoids call-stack limits and is much faster than += in a loop.
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateIdentity(): Identity {
  const xPriv = randomBytes(32);
  const xPub = x25519.getPublicKey(xPriv);
  const ePriv = randomBytes(32);
  const ePub = ed25519.getPublicKey(ePriv);
  return {
    x25519Private: xPriv,
    x25519Public: xPub,
    ed25519Private: ePriv,
    ed25519Public: ePub,
  };
}

export function exportPublic(id: Identity) {
  return {
    x25519_public: b64(id.x25519Public),
    ed25519_public: b64(id.ed25519Public),
  };
}

export function serializeIdentity(id: Identity) {
  return {
    x25519Private: b64(id.x25519Private),
    x25519Public: b64(id.x25519Public),
    ed25519Private: b64(id.ed25519Private),
    ed25519Public: b64(id.ed25519Public),
  };
}

export function deserializeIdentity(raw: ReturnType<typeof serializeIdentity>): Identity {
  return {
    x25519Private: fromB64(raw.x25519Private),
    x25519Public: fromB64(raw.x25519Public),
    ed25519Private: fromB64(raw.ed25519Private),
    ed25519Public: fromB64(raw.ed25519Public),
  };
}

export function fingerprintPublic(x25519PublicB64: string): string {
  return bytesToHex(sha256(fromB64(x25519PublicB64))).slice(0, 16);
}

function wrapKey(contentKey: Uint8Array, recipientX25519PubB64: string, senderX25519Priv: Uint8Array) {
  const ephPriv = randomBytes(32);
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, fromB64(recipientX25519PubB64));
  // Stable KDF label — do not rename or existing wrapped keys will not unwrap.
  const kek = hkdf(sha256, shared, undefined, new TextEncoder().encode("lanmsg-wrap-v1"), 32);
  const nonce = randomBytes(12);
  const cipher = gcm(kek, nonce);
  const wrapped = cipher.encrypt(contentKey);
  // also bind sender static for transcript consistency (unused in unwrap but kept)
  void senderX25519Priv;
  return {
    eph_pub: b64(ephPub),
    nonce: b64(nonce),
    wrapped: b64(wrapped),
  };
}

function unwrapKey(bundle: { eph_pub: string; nonce: string; wrapped: string }, priv: Uint8Array) {
  const shared = x25519.getSharedSecret(priv, fromB64(bundle.eph_pub));
  // Stable KDF label — do not rename or existing wrapped keys will not unwrap.
  const kek = hkdf(sha256, shared, undefined, new TextEncoder().encode("lanmsg-wrap-v1"), 32);
  const cipher = gcm(kek, fromB64(bundle.nonce));
  return cipher.decrypt(fromB64(bundle.wrapped));
}

export async function encryptMessage(
  plaintext: string,
  conversationId: string,
  senderId: string,
  identity: Identity,
  recipientPubs: Record<string, string> // userId -> x25519 pub b64
) {
  const contentKey = randomBytes(32);
  const nonce = randomBytes(12);
  const ad = new TextEncoder().encode(`${conversationId}|${senderId}`);
  const cipher = gcm(contentKey, nonce, ad);
  const ct = cipher.encrypt(new TextEncoder().encode(plaintext));
  const wrapped_keys: Record<string, ReturnType<typeof wrapKey>> = {};
  for (const [uid, pub] of Object.entries(recipientPubs)) {
    wrapped_keys[uid] = wrapKey(contentKey, pub, identity.x25519Private);
  }
  const toSign = sha256(
    new TextEncoder().encode(
      `${conversationId}|${senderId}|${b64(nonce)}|${b64(ct)}`
    )
  );
  const signature = b64(ed25519.sign(toSign, identity.ed25519Private));
  return {
    ciphertext: b64(ct),
    nonce: b64(nonce),
    wrapped_keys,
    signature,
  };
}

export function verifyMessageSignature(
  msg: {
    ciphertext: string;
    nonce: string;
    signature?: string;
    conversation_id: string;
    sender_id: string;
  },
  senderEd25519PublicB64: string
) {
  if (!msg.signature) throw new Error("Missing signature");
  const toSign = sha256(
    new TextEncoder().encode(
      `${msg.conversation_id}|${msg.sender_id}|${msg.nonce}|${msg.ciphertext}`
    )
  );
  const ok = ed25519.verify(fromB64(msg.signature), toSign, fromB64(senderEd25519PublicB64));
  if (!ok) throw new Error("Invalid message signature");
}

export async function decryptMessage(
  msg: {
    ciphertext: string;
    nonce: string;
    wrapped_keys: Record<string, { eph_pub: string; nonce: string; wrapped: string }>;
    conversation_id: string;
    sender_id: string;
    signature?: string;
  },
  myUserId: string,
  identity: Identity,
  senderEd25519PublicB64?: string
) {
  if (senderEd25519PublicB64) {
    verifyMessageSignature(msg, senderEd25519PublicB64);
  }
  const bundle = msg.wrapped_keys[myUserId];
  if (!bundle) throw new Error("No wrapped key for this user");
  const contentKey = unwrapKey(bundle, identity.x25519Private);
  const ad = new TextEncoder().encode(`${msg.conversation_id}|${msg.sender_id}`);
  const cipher = gcm(contentKey, fromB64(msg.nonce), ad);
  const pt = cipher.decrypt(fromB64(msg.ciphertext));
  return new TextDecoder().decode(pt);
}

export function createGroupKey() {
  return randomBytes(32);
}

export function wrapGroupKeyForMembers(
  groupKey: Uint8Array,
  identity: Identity,
  memberPubs: Record<string, string>
) {
  const out: Record<string, string> = {};
  for (const [uid, pub] of Object.entries(memberPubs)) {
    out[uid] = b64(
      new TextEncoder().encode(JSON.stringify(wrapKey(groupKey, pub, identity.x25519Private)))
    );
  }
  return out;
}

export function unwrapGroupKey(wrappedB64: string, identity: Identity) {
  const bundle = JSON.parse(new TextDecoder().decode(fromB64(wrappedB64)));
  return unwrapKey(bundle, identity.x25519Private);
}

export async function encryptWithGroupKey(
  plaintext: string,
  conversationId: string,
  senderId: string,
  groupKey: Uint8Array,
  identity: Identity
) {
  const nonce = randomBytes(12);
  const ad = new TextEncoder().encode(`${conversationId}|${senderId}`);
  const cipher = gcm(groupKey, nonce, ad);
  const ct = cipher.encrypt(new TextEncoder().encode(plaintext));
  const toSign = sha256(
    new TextEncoder().encode(`${conversationId}|${senderId}|${b64(nonce)}|${b64(ct)}`)
  );
  return {
    ciphertext: b64(ct),
    nonce: b64(nonce),
    wrapped_keys: {},
    signature: b64(ed25519.sign(toSign, identity.ed25519Private)),
  };
}

export async function decryptWithGroupKey(
  msg: {
    ciphertext: string;
    nonce: string;
    conversation_id: string;
    sender_id: string;
    signature?: string;
  },
  groupKey: Uint8Array,
  senderEd25519PublicB64?: string
) {
  if (senderEd25519PublicB64) {
    verifyMessageSignature(msg, senderEd25519PublicB64);
  }
  const ad = new TextEncoder().encode(`${msg.conversation_id}|${msg.sender_id}`);
  const cipher = gcm(groupKey, fromB64(msg.nonce), ad);
  return new TextDecoder().decode(cipher.decrypt(fromB64(msg.ciphertext)));
}

export async function prepareFileEncryption(
  identity: Identity,
  recipientPubs: Record<string, string>
) {
  const contentKey = randomBytes(32);
  const wrapped_keys: Record<string, ReturnType<typeof wrapKey>> = {};
  for (const [uid, pub] of Object.entries(recipientPubs)) {
    wrapped_keys[uid] = wrapKey(contentKey, pub, identity.x25519Private);
  }
  return { contentKey, wrapped_keys };
}

/** file_crypto_v >= 2 binds chunk index into AES-GCM AAD. */
export function encryptChunk(
  contentKey: Uint8Array,
  plain: Uint8Array,
  chunkIndex?: number
) {
  const nonce = randomBytes(12);
  const cipher =
    chunkIndex === undefined
      ? gcm(contentKey, nonce)
      : gcm(contentKey, nonce, new TextEncoder().encode(`chunk:${chunkIndex}`));
  const ciphertext = cipher.encrypt(plain);
  return { nonce: b64(nonce), ciphertext, ciphertextB64: b64(ciphertext) };
}

export function decryptChunk(
  contentKey: Uint8Array,
  nonceB64: string,
  ct: Uint8Array,
  chunkIndex?: number
) {
  const nonce = fromB64(nonceB64);
  const cipher =
    chunkIndex === undefined
      ? gcm(contentKey, nonce)
      : gcm(contentKey, nonce, new TextEncoder().encode(`chunk:${chunkIndex}`));
  return cipher.decrypt(ct);
}

export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function createSha256() {
  return sha256.create();
}

/** Encrypt filename with the same content key as file chunks. */
export function encryptFilename(contentKey: Uint8Array, filename: string) {
  const nonce = randomBytes(12);
  const cipher = gcm(contentKey, nonce);
  const ct = cipher.encrypt(new TextEncoder().encode(filename));
  return { nonce: b64(nonce), ciphertext: b64(ct) };
}

export function newContentHasher() {
  return sha256.create();
}

export function finishHasher(hasher: ReturnType<typeof sha256.create>) {
  return bytesToHex(hasher.digest());
}

export function decryptFilename(contentKey: Uint8Array, nonceB64: string, ciphertextB64: string) {
  const cipher = gcm(contentKey, fromB64(nonceB64));
  return new TextDecoder().decode(cipher.decrypt(fromB64(ciphertextB64)));
}

export function unwrapContentKey(
  wraps: Record<string, { eph_pub: string; nonce: string; wrapped: string }>,
  myUserId: string,
  identity: Identity
) {
  return unwrapKey(wraps[myUserId], identity.x25519Private);
}

export { b64, fromB64, bytesToHex, hexToBytes };
