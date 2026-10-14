import { allowedDocumentKeys } from '@/db/schema';
import { cleanMusicDocument } from '@/lib/music-data';

export type DocumentRecord = { key: string; value: unknown; updatedAt?: string };
type Row = { key?: string; value: string; updated_at: string };

/** D1 is the authority for app documents; HTTP and model tools share this repository. */
export class DocumentRepository {
  constructor(private readonly database: D1Database) {}
  private validate(key: string) {
    if (!allowedDocumentKeys.has(key)) throw new Error('Unsupported Vesper document');
  }
  async read(key: string): Promise<DocumentRecord> {
    this.validate(key);
    const row = await this.database.prepare('SELECT value, updated_at FROM vesper_documents WHERE key = ?').bind(key).first<Row>();
    return row ? { key, value: JSON.parse(row.value), updatedAt: row.updated_at } : { key, value: null };
  }
  async list(): Promise<Record<string, { value: unknown; updatedAt: string }>> {
    const rows = await this.database.prepare('SELECT key, value, updated_at FROM vesper_documents').all<Row>();
    return Object.fromEntries(rows.results.map(row => [row.key!, { value: JSON.parse(row.value), updatedAt: row.updated_at }]));
  }
  async value(key: string): Promise<unknown> {
    const record = await this.read(key);
    return record.value ?? (key === 'diary' || key === 'settings' ? {} : []);
  }
  async write(key: string, value: unknown): Promise<DocumentRecord> {
    this.validate(key);
    if (value === undefined) throw new Error('Invalid document');
    value = cleanMusicDocument(key, value);
    const updatedAt = new Date().toISOString();
    await this.database.prepare(`INSERT INTO vesper_documents(key,value,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).bind(key, JSON.stringify(value), updatedAt).run();
    return { key, value, updatedAt };
  }
  /** Retry only local read/modify/write transactions, never model/tool side effects. */
  async update(key: string, change: (value: unknown) => unknown): Promise<DocumentRecord> {
    this.validate(key);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await this.database.prepare('SELECT value, updated_at FROM vesper_documents WHERE key = ?').bind(key).first<Row>();
      const previous = row ? JSON.parse(row.value) : (key === 'diary' || key === 'settings' ? {} : []);
      const value = cleanMusicDocument(key, change(previous));
      if (value === undefined) throw new Error('Invalid document');
      const updatedAt = new Date().toISOString();
      const statement = row
        ? this.database.prepare('UPDATE vesper_documents SET value = ?, updated_at = ? WHERE key = ? AND value = ?').bind(JSON.stringify(value), updatedAt, key, row.value)
        : this.database.prepare('INSERT OR IGNORE INTO vesper_documents(key,value,updated_at) VALUES(?,?,?)').bind(key, JSON.stringify(value), updatedAt);
      const result = await statement.run();
      if (result.meta.changes) return { key, value, updatedAt };
    }
    throw new Error('Document changed concurrently. Read again before retrying.');
  }
}
