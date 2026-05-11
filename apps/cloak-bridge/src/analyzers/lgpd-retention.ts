import type { Analyzer, AnalyzerConfig, AnalyzerResult } from './base.js';
import type { CloakAccountHistory } from '../cloak/types.js';

/**
 * LGPD Art. 16 — Retention.
 *
 * Data processors must erase (or anonymize) personal data when purpose ends.
 * Applied to Cloak notes: any note older than `retentionDays` without a
 * corresponding spend (nullifier) should be flagged. Since Cloak's note
 * metadata is on-chain but PII-free by construction, this analyzer checks that
 * the entity's scanned history does not contain notes held past the declared
 * retention window.
 */
export class LgpdRetentionAnalyzer implements Analyzer {
  readonly id = 'lgpd-art16-retention';

  run(history: CloakAccountHistory, config: AnalyzerConfig): AnalyzerResult {
    const retentionDays = Number(config.params?.retentionDays ?? 365);
    const retentionSeconds = retentionDays * 86400;

    const cutoff = config.periodEnd - retentionSeconds;
    const stale = history.scanned.filter((tx) => tx.direction === 'in' && tx.blockTime < cutoff);

    const ratio =
      history.scanned.length === 0 ? 1 : 1 - stale.length / history.scanned.length;
    const score = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    const verdict = stale.length === 0 ? 'pass' : 'fail';

    return {
      analyzerId: this.id,
      framework: 'LGPD',
      article: 'Art. 16',
      verdict,
      score,
      thresholdUsed: 100,
      facts: {
        retentionDays,
        cutoffBlockTime: cutoff,
        staleNotes: stale.map((tx) => ({
          noteHash: tx.noteHash,
          blockTime: tx.blockTime,
          ageSeconds: config.periodEnd - tx.blockTime,
        })),
      },
    };
  }
}
