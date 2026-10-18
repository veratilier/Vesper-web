import { registerPhotoSource } from '@/lib/photo-album';
import { optionsResponse } from '@/lib/cors';
import { appRoute, APIError } from '@/lib/backend/http';
import { media } from '@/lib/backend/services';
export const OPTIONS = optionsResponse;
export const POST = appRoute({ service: 'media', methods: ['POST'], errorMessage: 'Media upload failed; completion not confirmed', errorStatus: 500 }, async context => {
  const form = await context.request.formData(), file = form.get('file');
  if (!(file instanceof File)) throw new APIError('File required');
  if (file.size > 32 * 1024 * 1024) throw new APIError('Image is too large', 413);
  const extension = file.name.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'image';
  const key = `${crypto.randomUUID()}.${extension}`;
  await media().put(key, file.stream(), file.type);
  if (file.type.startsWith('image/')) await registerPhotoSource((await context.scope()).userId, { key, name: file.name, type: file.type, size: file.size }, 'user');
  return context.json({ key, url: `${context.url.origin}/api/media/${key}`, name: file.name, type: file.type || 'application/octet-stream', size: file.size });
});
