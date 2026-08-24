import { cosine } from '../utils/cosine';
import type { VectorItem, Retrieved, VectorStore } from '../types';

export class InMemoryVectorStore implements VectorStore {
  private items: VectorItem[] = [];

  async add(items: VectorItem[]): Promise<void> {
    this.items.push(...items);
  }

  async query(embedding: number[], topK: number): Promise<Retrieved[]> {
    return this.items
      .map((it) => ({
        text: it.text,
        vectorScore: cosine(embedding, it.embedding),
        embedding: it.embedding,
        metadata: it.metadata,
      }))
      .sort((a, b) => b.vectorScore - a.vectorScore)
      .slice(0, topK);
  }
}
