import type { Analyzer, AnalyzerConfig, AnalyzerResult } from './base.js';
import type { CloakAccountHistory } from '../cloak/types.js';

/**
 * MiCAR Article 36 — Proof of Reserve.
 *
 * Issuer must hold reserve assets ≥ circulating liability. We cannot read
 * on-chain reserve from a Cloak-shielded pool view alone; the caller injects
 * `params.reserveAssetsByMint` (e.g., fetched from a public treasury wallet)
 * and we compare against cumulative net liability (inflow - outflow) observed
 * through the viewing key.
 *
 * Pass iff reserveAssets ≥ netLiability for every mint with activity.
 */
export class MicarArt36Analyzer implements Analyzer {
  readonly id = 'micar-art36-reserve';

  run(history: CloakAccountHistory, config: AnalyzerConfig): AnalyzerResult {
    const reserves = (config.params?.reserveAssetsByMint as Record<string, string>) ?? {};
    const bufferBps = Number(config.params?.capitalBufferBps ?? 300);

    const breakdown: Array<{
      mint: string;
      netLiability: string;
      reserve: string;
      required: string;
      ratio: number;
      pass: boolean;
    }> = [];

    let minRatio = Number.POSITIVE_INFINITY;
    let allPass = true;

    for (const [mint, agg] of Object.entries(history.byMint)) {
      const netLiability = agg.inflow - agg.outflow;
      if (netLiability <= 0n) continue;
      const required = (netLiability * BigInt(10_000 + bufferBps)) / 10_000n;
      const reserve = reserves[mint] ? BigInt(reserves[mint]) : 0n;
      const ratio = required === 0n ? 1 : Number(reserve) / Number(required);
      const pass = reserve >= required;
      allPass = allPass && pass;
      if (ratio < minRatio) minRatio = ratio;
      breakdown.push({
        mint,
        netLiability: netLiability.toString(),
        reserve: reserve.toString(),
        required: required.toString(),
        ratio,
        pass,
      });
    }

    const score = Math.max(0, Math.min(100, Math.round(Math.min(minRatio, 1) * 100)));

    return {
      analyzerId: this.id,
      framework: 'MiCAR',
      article: 'Art. 36',
      verdict: breakdown.length === 0 ? 'inconclusive' : allPass ? 'pass' : 'fail',
      score: breakdown.length === 0 ? 0 : score,
      thresholdUsed: 100,
      facts: {
        periodStart: config.periodStart,
        periodEnd: config.periodEnd,
        bufferBps,
        breakdown,
      },
    };
  }
}
