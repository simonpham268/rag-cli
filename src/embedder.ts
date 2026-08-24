import { DEFAULT_EMBEDDER, type ModelConfig } from './models';

export class Embedder {
  private extractor!: any;
  private readonly queryInstruction: string;

  private constructor(queryInstruction: string) {
    this.queryInstruction = queryInstruction;
  }

  static async create(model: ModelConfig = DEFAULT_EMBEDDER): Promise<Embedder> {
    const { pipeline } = await import('@huggingface/transformers');
    const e = new Embedder(model.queryInstruction);
    e.extractor = await pipeline('feature-extraction', model.modelId);
    return e;
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    return this.embed(texts);
  }

  async embedQuery(query: string): Promise<number[]> {
    return (await this.embed([this.queryInstruction + query]))[0];
  }

  private async embed(inputs: string[]): Promise<number[][]> {
    const out = await this.extractor(inputs, { pooling: 'mean', normalize: true });
    return out.tolist() as number[][];
  }
}
