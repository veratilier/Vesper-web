/** Pure image validation helpers. Kept Worker-independent for deterministic tests. */
export const STICKER_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export type StickerImageInfo = { mimeType: string; width: number; height: number; extension: string };

function be16(bytes: Uint8Array, offset: number) { return (bytes[offset] << 8) | bytes[offset + 1]; }
function be32(bytes: Uint8Array, offset: number) { return (bytes[offset] * 0x1000000) + ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]); }
function le16(bytes: Uint8Array, offset: number) { return bytes[offset] | (bytes[offset + 1] << 8); }

/** Inspects only trusted file headers; extensions and browser MIME claims are ignored. */
export function inspectStickerImage(input: ArrayBuffer): StickerImageInfo {
  const b = new Uint8Array(input);
  if (b.length < 10) throw new Error("Sticker image is empty or damaged.");
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b.length >= 24) return { mimeType: "image/png", width: be32(b, 16), height: be32(b, 20), extension: "png" };
  if (String.fromCharCode(...b.slice(0, 6)) === "GIF87a" || String.fromCharCode(...b.slice(0, 6)) === "GIF89a") return { mimeType: "image/gif", width: le16(b, 6), height: le16(b, 8), extension: "gif" };
  if (String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") {
    const kind = String.fromCharCode(...b.slice(12, 16)); let width = 0; let height = 0;
    if (kind === "VP8X" && b.length >= 30) { width = 1 + b[24] + (b[25] << 8) + (b[26] << 16); height = 1 + b[27] + (b[28] << 8) + (b[29] << 16); }
    if (kind === "VP8 " && b.length >= 30) { width = le16(b, 26) & 0x3fff; height = le16(b, 28) & 0x3fff; }
    if (kind === "VP8L" && b.length >= 25) { const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); width = (bits & 0x3fff) + 1; height = ((bits >> 14) & 0x3fff) + 1; }
    return { mimeType: "image/webp", width, height, extension: "webp" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < b.length) {
      if (b[offset] !== 0xff) { offset += 1; continue; }
      const marker = b[offset + 1]; const length = be16(b, offset + 2);
      if (length < 2 || offset + 2 + length > b.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { mimeType: "image/jpeg", width: be16(b, offset + 7), height: be16(b, offset + 5), extension: "jpg" };
      offset += 2 + length;
    }
  }
  throw new Error("Only PNG, JPG, GIF and WebP stickers are supported.");
}

export function validateStickerImage(info: StickerImageInfo, maxPixels: number) {
  if (!STICKER_IMAGE_TYPES.has(info.mimeType) || !info.width || !info.height || info.width * info.height > maxPixels) throw new Error("Unsupported sticker format or dimensions");
}
