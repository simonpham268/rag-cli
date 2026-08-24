export interface ModelConfig {
  modelId: string;
  queryInstruction: string;
  dims: number;
}

export const MODELS = {
  BGE_SMALL_EN: {
    modelId: 'Xenova/bge-small-en-v1.5',
    queryInstruction: 'Represent this sentence for searching relevant passages: ',
    dims: 384,
  },
  BGE_BASE_EN: {
    modelId: 'Xenova/bge-base-en-v1.5',
    queryInstruction: 'Represent this sentence for searching relevant passages: ',
    dims: 768,
  },
  BGE_LARGE_EN: {
    modelId: 'Xenova/bge-large-en-v1.5',
    queryInstruction: 'Represent this sentence for searching relevant passages: ',
    dims: 1024,
  },
  E5_SMALL: {
    modelId: 'Xenova/e5-small-v2',
    queryInstruction: 'query: ',
    dims: 384,
  },
  E5_LARGE: {
    modelId: 'Xenova/e5-large-v2',
    queryInstruction: 'query: ',
    dims: 1024,
  },
} as const satisfies Record<string, ModelConfig>;

export const RERANKERS = {
  BGE_RERANKER_BASE: 'Xenova/bge-reranker-base',
  BGE_RERANKER_LARGE: 'Xenova/bge-reranker-large',
} as const;

export const DEFAULT_EMBEDDER = MODELS.BGE_SMALL_EN;
export const DEFAULT_RERANKER = RERANKERS.BGE_RERANKER_BASE;
