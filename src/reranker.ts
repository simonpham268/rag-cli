import { DEFAULT_RERANKER } from './models';

export class Reranker {
  private tokenizer!: any;
  private model!: any;

  static async create(modelId = DEFAULT_RERANKER): Promise<Reranker> {
    const { AutoTokenizer, AutoModelForSequenceClassification } = await import('@huggingface/transformers');
    const r = new Reranker();
    r.tokenizer = await AutoTokenizer.from_pretrained(modelId);
    r.model = await AutoModelForSequenceClassification.from_pretrained(modelId);
    return r;
  }

  async score(query: string, docs: string[]): Promise<number[]> {
    const inputs = await this.tokenizer(new Array(docs.length).fill(query), {
      text_pair: docs,
      padding: true,
      truncation: true,
    });
    const { logits } = await this.model(inputs);
    return (logits.tolist() as number[][]).map((row) => row[0]);
  }
}
