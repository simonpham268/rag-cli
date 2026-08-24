export interface VectorItem {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
}

export interface Retrieved {
  text: string;
  vectorScore: number;
  rerankScore?: number;
  embedding?: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorStore {
  add(items: VectorItem[]): Promise<void>;
  query(embedding: number[], topK: number): Promise<Retrieved[]>;
}
