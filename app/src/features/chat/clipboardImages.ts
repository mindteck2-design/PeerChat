const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif)$/i;
const GENERIC_NAME = /^(image|blob|screenshot)(\s*\(\d+\))?(\.(png|jpe?g|gif|webp|bmp))?$/i;

export function isClipboardImage(file: File) {
  if (file.size <= 0) return false;
  if (file.type.startsWith("image/")) return true;
  return IMAGE_EXT.test(file.name || "");
}

function stampName(index: number, ext: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `Screenshot ${stamp}${suffix}.${ext}`;
}

/** Give Snipping Tool / "image.png" pastes a distinct name. Keep a real filename. */
export function namedClipboardImage(file: File, index: number) {
  const type = file.type.startsWith("image/") ? file.type : "image/png";
  const ext = (type.split("/")[1] || "png").replace("jpeg", "jpg").split("+")[0];
  const generic = !file.name || GENERIC_NAME.test(file.name);
  if (!generic) return file;
  return new File([file], stampName(index, ext), { type, lastModified: Date.now() });
}

/** Images from a paste event. Text-only pastes return nothing so the composer can insert text. */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const found: File[] = [];
  const seen = new Set<string>();
  const push = (file: File | null) => {
    if (!file || !isClipboardImage(file)) return;
    const key = `${file.type}|${file.size}|${file.name}|${file.lastModified}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push(namedClipboardImage(file, found.length));
  };
  for (const item of Array.from(data.items || [])) {
    if (item.kind === "file") push(item.getAsFile());
  }
  for (const file of Array.from(data.files || [])) push(file);
  return found;
}
