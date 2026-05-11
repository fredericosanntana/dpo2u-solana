import type { CloakAccountHistory } from '../cloak/types.js';

export type Verdict = 'pass' | 'fail' | 'inconclusive';

export interface AnalyzerResult {
  analyzerId: string;
  framework: 'MiCAR' | 'LGPD' | 'DPDP';
  article: string;
  verdict: Verdict;
  /** 0..100 — how close the entity is to the compliant boundary. 100 = fully compliant. */
  score: number;
  /**
   * Human-readable facts; kept OFF-CHAIN (encrypted). The on-chain commitment
   * is sha256(JSON.stringify(facts)).
   */
  facts: Record<string, unknown>;
  thresholdUsed: number;
}

export interface AnalyzerConfig {
  /** Unix seconds. */
  periodStart: number;
  /** Unix seconds. */
  periodEnd: number;
  /** Extra per-analyzer knobs (reserve cap, velocity cap, retention days, etc.) */
  params?: Record<string, unknown>;
}

export interface Analyzer {
  readonly id: string;
  run(history: CloakAccountHistory, config: AnalyzerConfig): AnalyzerResult;
}
