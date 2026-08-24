import { Embedder } from './embedder';
import { Reranker } from './reranker';
import { InMemoryVectorStore } from './stores/in-memory.store';
import { chunkText } from './utils/chunking';
import type { VectorStore, Retrieved } from './types';

export class TwoStageRAG {
  constructor(
    private embedder: Embedder,
    private reranker: Reranker,
    private store: VectorStore,
  ) {}

  static async create(
    store: VectorStore = new InMemoryVectorStore(),
    embedder?: Embedder,
  ): Promise<TwoStageRAG> {
    const [resolvedEmbedder, reranker] = await Promise.all([
      embedder ?? Embedder.create(),
      Reranker.create(),
    ]);
    return new TwoStageRAG(resolvedEmbedder, reranker, store);
  }

  async index(documents: string[], source = 'unknown'): Promise<number> {
    const chunks = documents.flatMap((doc) =>
      chunkText(doc).map((text, chunkIndex) => ({ text, metadata: { source, chunkIndex } })),
    );
    if (chunks.length === 0) return 0;

    const embeddings = await this.embedder.embedPassages(chunks.map((c) => c.text));
    await this.store.add(
      chunks.map((c, i) => ({
        id: crypto.randomUUID(),
        text: c.text,
        embedding: embeddings[i],
        metadata: c.metadata,
      })),
    );
    return chunks.length;
  }

  async retrieve(query: string, topK = 20): Promise<Retrieved[]> {
    const qEmb = await this.embedder.embedQuery(query);
    return this.store.query(qEmb, topK);
  }

  async rerank(query: string, candidates: Retrieved[], topN = 5): Promise<Retrieved[]> {
    if (candidates.length === 0) return [];
    const scores = await this.reranker.score(query, candidates.map((c) => c.text));
    return candidates
      .map((c, i) => ({ ...c, rerankScore: scores[i] }))
      .sort((a, b) => b.rerankScore! - a.rerankScore!)
      .slice(0, topN);
  }

  async search(query: string, topK = 20, topN = 5): Promise<Retrieved[]> {
    const candidates = await this.retrieve(query, topK);
    return this.rerank(query, candidates, topN);
  }

  static buildPrompt(query: string, contexts: Retrieved[]): string {
    const ctx = contexts.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n');
    return [
      'Answer the question using ONLY the context below.',
      "If the context is insufficient, say you don't know.\n",
      '=== CONTEXT ===',
      ctx,
      '\n=== QUESTION ===',
      query,
      '\n=== ANSWER ===',
    ].join('\n');
  }
}
