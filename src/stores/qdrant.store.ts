import type { Embedder } from '../embedder';
import type { VectorItem, Retrieved, VectorStore } from '../types';

export class QdrantStore implements VectorStore {
  constructor(
    private client: any,
    private collection: string,
  ) { }

  static async create(
    collection: string,
    embedder: Embedder,
    url = 'http://localhost:6333',
  ): Promise<QdrantStore> {
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    const client = new QdrantClient({ url });

    const exists = await client
      .getCollection(collection)
      .then(() => true)
      .catch((err: any) => {
        if (err?.cause?.code === 'ECONNREFUSED') {
          throw new Error(`Qdrant is not running at ${url}. Start it with: docker run -p 6333:6333 qdrant/qdrant`);
        }
        return false;
      });

    if (!exists) {
      const probe = await embedder.embedQuery('probe');
      await client.createCollection(collection, {
        vectors: { size: probe.length, distance: 'Cosine' }
      });
    }

    return new QdrantStore(client, collection);
  }

  async add(items: VectorItem[]): Promise<void> {
    await this.client.upsert(this.collection, {
      points: items.map((it) => ({
        id: it.id,
        vector: it.embedding,
        payload: { text: it.text, ...it.metadata },
      })),
    });
  }

  async query(embedding: number[], topK: number): Promise<Retrieved[]> {
    const res = await this.client.search(this.collection, {
      vector: embedding,
      limit: topK,
      with_payload: true,
      with_vectors: true,
    });

    return res.map((p: any) => ({
      text: String(p.payload?.text ?? ''),
      vectorScore: p.score,
      embedding: p.vector as number[] | undefined,
      metadata: p.payload as Record<string, unknown>,
    }));
  }
}
