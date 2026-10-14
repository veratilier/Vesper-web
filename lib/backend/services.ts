import { env } from 'cloudflare:workers';
import { ensureSchema, getDb } from '@/lib/db';
import { DocumentRepository } from './documents';
import { MediaRepository } from './media';

/** Composition root: storage bindings are resolved here, not supplied by the client. */
export async function documents(): Promise<DocumentRepository> {
  await ensureSchema();
  return new DocumentRepository(getDb());
}
export function media(): MediaRepository {
  return new MediaRepository((env as unknown as { MEDIA: R2Bucket }).MEDIA);
}
