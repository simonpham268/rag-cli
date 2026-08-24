import { cosine } from './utils/cosine';
import type { Embedder } from './embedder';
import type { VectorStore, Retrieved } from './types';

export interface EvalPair {
  question: string;
  response: string;
}

export interface EvalOptions {
  passThreshold?: number; // min score to pass             (default 0.85)
  hallucinationThreshold?: number; // below this = hallucination    (default 0.60)
  topK?: number; // vector search breadth         (default 20)
  coverageN?: number; // key points to check           (default 5)
  minCovered?: number; // min points required to pass   (default 3)
  coverageThreshold?: number; // per-point similarity cutoff   (default 0.75)
}

export interface CoverageResult {
  covered: number;
  total: number;
  points: Retrieved[];
}

export interface EvalResult {
  score: number;
  pass: boolean;
  verdict: 'PASS' | 'FAIL' | 'HALLUCINATION';
  topMatch: Retrieved;
  coverage: CoverageResult;
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  hallucinated: number;
  avgScore: number;
}

const DEFAULTS = {
  passThreshold: 0.85,
  hallucinationThreshold: 0.60,
  topK: 20,
  coverageN: 3,
  minCovered: 1,
  coverageThreshold: 0.75,
} satisfies Required<EvalOptions>;

export class RagEvaluator {
  constructor(
    private embedder: Embedder,
    private store: VectorStore,
  ) {}

  async evaluate(
    question: string,
    agentResponse: string,
    opts: EvalOptions = {},
  ): Promise<EvalResult> {
    const o = { ...DEFAULTS, ...opts };

    const [responseEmb, queryEmb] = await Promise.all([
      this.embedder.embedQuery(agentResponse),
      this.embedder.embedQuery(question),
    ]);

    const candidates = await this.store.query(queryEmb, o.topK);
    if (candidates.length === 0) {
      throw new Error('No documents indexed — run rag.index() first.');
    }

    const score = this.topScore(responseEmb, candidates);
    const coverage = this.computeCoverage(responseEmb, candidates, o.coverageN, o.coverageThreshold);
    const topMatch = candidates.find((c) => c.embedding &&
      cosine(responseEmb, c.embedding) === score) ?? candidates[0];
    const verdict = this.getVerdict(score, coverage.covered, o);

    return { score, pass: verdict === 'PASS', verdict, topMatch, coverage };
  }

  async evaluateBatch(
    pairs: EvalPair[],
    opts: EvalOptions = {},
  ): Promise<{ pair: EvalPair; result: EvalResult }[]> {
    return Promise.all(
      pairs.map(async (pair) => ({
        pair,
        result: await this.evaluate(pair.question, pair.response, opts),
      })),
    );
  }

  static summary(results: EvalResult[]): EvalSummary {
    return {
      total: results.length,
      passed: results.filter((r) => r.verdict === 'PASS').length,
      failed: results.filter((r) => r.verdict === 'FAIL').length,
      hallucinated: results.filter((r) => r.verdict === 'HALLUCINATION').length,
      avgScore: results.reduce((s, r) => s + r.score, 0) / results.length,
    };
  }

  private topScore(responseEmb: number[], candidates: Retrieved[]): number {
    return Math.max(
      ...candidates
        .filter((c) => c.embedding)
        .map((c) => cosine(responseEmb, c.embedding!)),
    );
  }

  private computeCoverage(
    responseEmb: number[],
    candidates: Retrieved[],
    coverageN: number,
    threshold: number,
  ): CoverageResult {
    const keyPoints = candidates.slice(0, coverageN).filter((p) => p.embedding);
    const covered = keyPoints.filter((p) => cosine(responseEmb, p.embedding!) >= threshold);
    return { covered: covered.length, total: keyPoints.length, points: covered };
  }

  private getVerdict(
    score: number,
    covered: number,
    o: Required<EvalOptions>,
  ): EvalResult['verdict'] {
    if (score < o.hallucinationThreshold) return 'HALLUCINATION';
    if (score >= o.passThreshold && covered >= o.minCovered) return 'PASS';
    return 'FAIL';
  }
}
