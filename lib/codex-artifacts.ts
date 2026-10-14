import { registerPhotoSource } from './photo-album';
import { media } from './backend/services';
export async function createChatFile(input: Record<string, unknown>, owner: string, origin: string) {
  const name = String(input.name || '').replace(/[\r\n\0/\\]/g, '_').slice(0, 160);
  if (!name) throw new Error('File name required');
  const hasText = typeof input.text === 'string';
  const hasBinary = typeof input.base64 === 'string';
  if (hasText === hasBinary) throw new Error('Supply exactly one of text or base64');
  if ((hasBinary ? (input.base64 as string).length : (input.text as string).length) > 12 * 1024 * 1024) throw new Error('File exceeds 8 MiB');
  let bytes: Uint8Array<ArrayBuffer>;
  if (hasText) bytes = new TextEncoder().encode(input.text as string);
  else {
    const encoded = input.base64 as string;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('Invalid base64');
    bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  }
  if (bytes.length > 8 * 1024 * 1024) throw new Error('File exceeds 8 MiB');
  const requested = String(input.mimeType || (hasText ? 'text/plain' : 'application/octet-stream')).toLowerCase();
  const type = /^(image\/(png|jpeg|gif|webp)|audio\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/pdf|text\/plain)$/.test(requested) ? requested : 'application/octet-stream';
  const fingerprint = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const identity = new TextEncoder().encode(`${owner}\0${name}\0${type}\0${Array.from(fingerprint).join(',')}`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', identity)), x => x.toString(16).padStart(2, '0')).join('');
  const extension = name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin';
  const key = `${hash}.${extension}`;
  await media().put(key, bytes, type, `${type.startsWith('image/') || type.startsWith('audio/') || type.startsWith('video/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  if (type.startsWith('image/')) await registerPhotoSource(owner, { key, name, type, size: bytes.length }, 'agent');
  return { key, url: `${origin}/api/media/${key}`, name, type, size: bytes.length };
}
