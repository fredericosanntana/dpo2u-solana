import type { Analyzer, AnalyzerConfig, AnalyzerResult } from './base.js';
import type { CloakAccountHistory } from '../cloak/types.js';

/**
 * MiCAR Article 23 — Velocity Limiter.
 *
 * Issuers of significant ARTs must cap daily outflows to maintain reserve
 * stability. Default cap: 5,000,000 units per mint per 24h window (configurable
 * via `params.dailyOutflowCapByMint`). Produces `pass` iff no 24h window in the
 * scanned period exceeds the cap for any mint.
 */
export class MicarArt23Analyzer implements Analyzer {
  readonly id = 'micar-art23-velocity';

  run(history: CloakAccountHistory, config: AnalyzerConfig): AnalyzerResult {
    const caps = (config.params?.dailyOutflowCapByMint as Record<string, string>) ?? {};
    const defaultCap = BigInt((config.params?.defaultDailyOutflowCap as string) ?? '5000000');

    const buckets: Record<string, Map<number, bigint>> = {};
    for (const tx of history.scanned) {
      if (tx.direction !== 'out') continue;
      const dayBucket = Math.floor(tx.blockTime / 86400);
      const byDay = (buckets[tx.mint] ??= new Map());
      byDay.set(dayBucket, (byDay.get(dayBucket) ?? 0n) + tx.amount);
    }

    let worstRatio = 0;
    const breaches: Array<{ mint: string; dayBucket: number; outflow: string; cap: string }> = [];
    for (const [mint, byDay] of Object.entries(buckets)) {
      const cap = caps[mint] ? BigInt(caps[mint]) : defaultCap;
      for (const [day, outflow] of byDay) {
        const ratio = cap === 0n ? Number.POSITIVE_INFINITY : Number(outflow) / Number(cap);
        if (ratio > worstRatio) worstRatio = ratio;
        if (outflow > cap) {
          breaches.push({ mint, dayBucket: day, outflow: outflow.toString(), cap: cap.toString() });
        }
      }
    }

    const score = Math.max(0, Math.min(100, Math.round((1 - worstRatio) * 100)));
    const verdict = breaches.length === 0 ? 'pass' : 'fail';

    return {
      analyzerId: this.id,
      framework: 'MiCAR',
      article: 'Art. 23',
      verdict,
      score,
      thresholdUsed: 100,
      facts: {
        periodStart: config.periodStart,
        periodEnd: config.periodEnd,
        defaultCap: defaultCap.toString(),
        mintsObserved: Object.keys(buckets),
        breaches,
        worstUtilization: worstRatio,
      },
    };
  }
}
