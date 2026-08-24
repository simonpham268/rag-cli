import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cosine } from '../utils/cosine';
import type { VectorItem, Retrieved, VectorStore } from '../types';

const DEFAULT_DB_PATH = '.rag/store.sqlite';

export class SqliteStore implements VectorStore {
  constructor(
    private db: DatabaseSync,
    private collection: string,
  ) { }

  static create(collection: string, dbPath: string = DEFAULT_DB_PATH): SqliteStore {
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT NOT NULL,
        collection TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding TEXT NOT NULL,
        metadata TEXT,
        PRIMARY KEY (id, collection)
      )
    `);
    return new SqliteStore(db, collection);
  }

  async add(items: VectorItem[]): Promise<void> {
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO vectors (id, collection, text, embedding, metadata) VALUES (?, ?, ?, ?, ?)',
    );
    for (const it of items) {
      insert.run(it.id, this.collection, it.text, JSON.stringify(it.embedding), JSON.stringify(it.metadata ?? {}));
    }
  }

  deleteBySource(source: string): void {
    this.db
      .prepare("DELETE FROM vectors WHERE collection = ? AND json_extract(metadata, '$.source') = ?")
      .run(this.collection, source);
  }

  async query(embedding: number[], topK: number): Promise<Retrieved[]> {
    const rows = this.db
      .prepare('SELECT text, embedding, metadata FROM vectors WHERE collection = ?')
      .all(this.collection) as { text: string; embedding: string; metadata: string }[];

    return rows
      .map((row) => {
        const rowEmbedding = JSON.parse(row.embedding) as number[];
        return {
          text: row.text,
          vectorScore: cosine(embedding, rowEmbedding),
          embedding: rowEmbedding,
          metadata: JSON.parse(row.metadata) as Record<string, unknown>,
        };
      })
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, topK);
  }
}
