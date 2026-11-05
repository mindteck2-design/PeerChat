import test from "node:test";
import assert from "node:assert/strict";
import { imagesFromClipboard, isClipboardImage, namedClipboardImage } from "../src/features/chat/clipboardImages.ts";

test("screenshot paste with a generic name gets a Screenshot filename", () => {
  const raw = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
  const named = namedClipboardImage(raw, 0);
  assert.match(named.name, /^Screenshot \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.png$/);
  assert.equal(named.type, "image/png");
  assert.equal(named.size, 3);
});

test("a copied file keeps its own name", () => {
  const raw = new File([new Uint8Array([1])], "holiday.jpg", { type: "image/jpeg" });
  assert.equal(namedClipboardImage(raw, 0).name, "holiday.jpg");
});

test("text-only clipboard does not produce an attachment", () => {
  const data = {
    items: [{ kind: "string", type: "text/plain", getAsFile: () => null }],
    files: [],
  } as unknown as DataTransfer;
  assert.deepEqual(imagesFromClipboard(data), []);
});

test("image item is taken once even if it is also listed as a file", () => {
  const raw = new File([new Uint8Array([9, 9])], "image.png", { type: "image/png" });
  const data = {
    items: [{ kind: "file", type: "image/png", getAsFile: () => raw }],
    files: [raw],
  } as unknown as DataTransfer;
  const images = imagesFromClipboard(data);
  assert.equal(images.length, 1);
  assert.equal(isClipboardImage(images[0]), true);
});
