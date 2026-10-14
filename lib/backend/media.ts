/** All persistent attachment bytes use this R2 adapter; Cinema scratch files are separate. */
export class MediaRepository {
  constructor(private readonly bucket: R2Bucket) {}
  put(key: string, data: Parameters<R2Bucket['put']>[1], contentType: string, contentDisposition?: string) {
    return this.bucket.put(key, data, { httpMetadata: { contentType, ...(contentDisposition ? { contentDisposition } : {}) } });
  }
  get(key: string) { return this.bucket.get(key); }
}
