import test from "node:test";
import assert from "node:assert";
import {
  generateIdentity,
  exportPublic,
  serializeIdentity,
  deserializeIdentity,
  fingerprintPublic,
  encryptMessage,
  decryptMessage,
  verifyMessageSignature,
  createGroupKey,
  wrapGroupKeyForMembers,
  unwrapGroupKey,
  encryptWithGroupKey,
  decryptWithGroupKey,
  encryptFilename,
  decryptFilename,
} from "../src/crypto.ts";

test("generateIdentity creates valid x25519 and ed25519 keypairs", () => {
  const id = generateIdentity();
  assert.strictEqual(id.x25519Private.length, 32);
  assert.strictEqual(id.x25519Public.length, 32);
  assert.strictEqual(id.ed25519Private.length, 32);
  assert.strictEqual(id.ed25519Public.length, 32);
});

test("serialize and deserialize identity maintains key bytes", () => {
  const id1 = generateIdentity();
  const serialized = serializeIdentity(id1);
  const id2 = deserializeIdentity(serialized);

  assert.deepStrictEqual(id1.x25519Private, id2.x25519Private);
  assert.deepStrictEqual(id1.x25519Public, id2.x25519Public);
  assert.deepStrictEqual(id1.ed25519Private, id2.ed25519Private);
  assert.deepStrictEqual(id1.ed25519Public, id2.ed25519Public);
});

test("fingerprintPublic returns a consistent 16-hex character string", () => {
  const id = generateIdentity();
  const pub = exportPublic(id);
  const fp1 = fingerprintPublic(pub.x25519_public);
  const fp2 = fingerprintPublic(pub.x25519_public);

  assert.strictEqual(fp1.length, 16);
  assert.strictEqual(fp1, fp2);
  assert.match(fp1, /^[0-9a-f]{16}$/);
});

test("encryptMessage and decryptMessage roundtrip between two peers", async () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const alicePub = exportPublic(alice);
  const bobPub = exportPublic(bob);

  const plain = "Hello Bob! Secret meeting at 3pm.";
  const convId = "conv-alice-bob";
  const aliceId = "alice-123";
  const bobId = "bob-456";

  const encrypted = await encryptMessage(plain, convId, aliceId, alice, {
    [aliceId]: alicePub.x25519_public,
    [bobId]: bobPub.x25519_public,
  });

  assert.ok(encrypted.ciphertext);
  assert.ok(encrypted.nonce);
  assert.ok(encrypted.signature);
  assert.ok(encrypted.wrapped_keys[aliceId]);
  assert.ok(encrypted.wrapped_keys[bobId]);

  // Bob decrypts
  const bobDecrypted = await decryptMessage(
    {
      ...encrypted,
      conversation_id: convId,
      sender_id: aliceId,
    },
    bobId,
    bob,
    alicePub.ed25519_public
  );
  assert.strictEqual(bobDecrypted, plain);

  // Alice decrypts her own message
  const aliceDecrypted = await decryptMessage(
    {
      ...encrypted,
      conversation_id: convId,
      sender_id: aliceId,
    },
    aliceId,
    alice,
    alicePub.ed25519_public
  );
  assert.strictEqual(aliceDecrypted, plain);
});

test("verifyMessageSignature detects tampering of ciphertext or sender", async () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const alicePub = exportPublic(alice);
  const bobPub = exportPublic(bob);

  const encrypted = await encryptMessage("Original", "c1", "alice", alice, {
    bob: bobPub.x25519_public,
  });

  // Valid signature check
  assert.doesNotThrow(() => {
    verifyMessageSignature(
      {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        signature: encrypted.signature,
        conversation_id: "c1",
        sender_id: "alice",
      },
      alicePub.ed25519_public
    );
  });

  // Tampered ciphertext fails
  assert.throws(() => {
    verifyMessageSignature(
      {
        ciphertext: encrypted.ciphertext + "tamper",
        nonce: encrypted.nonce,
        signature: encrypted.signature,
        conversation_id: "c1",
        sender_id: "alice",
      },
      alicePub.ed25519_public
    );
  });

  // Spoofed sender_id fails
  assert.throws(() => {
    verifyMessageSignature(
      {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        signature: encrypted.signature,
        conversation_id: "c1",
        sender_id: "mallory",
      },
      alicePub.ed25519_public
    );
  });
});

test("Group key distribution and message encryption/decryption", async () => {
  const alice = generateIdentity();
  const bob = generateIdentity();
  const charlie = generateIdentity();

  const alicePub = exportPublic(alice);
  const bobPub = exportPublic(bob);
  const charliePub = exportPublic(charlie);

  const groupKey = createGroupKey();
  const wrappedMap = wrapGroupKeyForMembers(groupKey, alice, {
    alice: alicePub.x25519_public,
    bob: bobPub.x25519_public,
    charlie: charliePub.x25519_public,
  });

  // Bob and Charlie unwrap the key
  const bobKey = unwrapGroupKey(wrappedMap["bob"], bob);
  const charlieKey = unwrapGroupKey(wrappedMap["charlie"], charlie);

  assert.deepStrictEqual(bobKey, groupKey);
  assert.deepStrictEqual(charlieKey, groupKey);

  // Alice encrypts for the group
  const groupMsg = "Welcome to the group chat!";
  const encrypted = await encryptWithGroupKey(groupMsg, "group-1", "alice", groupKey, alice);

  // Bob decrypts with signature verification
  const bobRead = await decryptWithGroupKey(
    {
      ...encrypted,
      conversation_id: "group-1",
      sender_id: "alice",
    },
    bobKey,
    alicePub.ed25519_public
  );
  assert.strictEqual(bobRead, groupMsg);

  // Charlie decrypts with signature verification
  const charlieRead = await decryptWithGroupKey(
    {
      ...encrypted,
      conversation_id: "group-1",
      sender_id: "alice",
    },
    charlieKey,
    alicePub.ed25519_public
  );
  assert.strictEqual(charlieRead, groupMsg);
});

test("Filename encryption and decryption", () => {
  const key = createGroupKey();
  const filename = "Confidential_Quarterly_Report_2026.pdf";
  const { nonce, ciphertext } = encryptFilename(key, filename);

  assert.notStrictEqual(ciphertext, filename);
  const decrypted = decryptFilename(key, nonce, ciphertext);
  assert.strictEqual(decrypted, filename);
});
