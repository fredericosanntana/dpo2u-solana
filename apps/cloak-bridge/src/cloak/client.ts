import type { Connection, PublicKey } from '@solana/web3.js';
import type { CloakAccountHistory, CloakTx, ViewingKeyMaterial } from './types.js';

/**
 * Cloak SDK wrapper.
 *
 * The upstream SDK (`@cloak.dev/sdk`) is alpha and mainnet-only. Rather than
 * hard-couple to its evolving type surface, we dynamic-import and adapt to a
 * narrow internal shape. When the SDK is unavailable (local dev, unit tests)
 * the caller can inject a `MockCloakProvider`.
 */
export interface CloakProvider {
  scanHistory(args: {
    viewingKey: ViewingKeyMaterial;
    periodStart: number;
    periodEnd: number;
  }): Promise<CloakAccountHistory>;
}

export async function loadCloakSdkProvider(connection: Connection): Promise<CloakProvider> {
  const sdk = await import('@cloak.dev/sdk').catch(() => null);
  if (!sdk) {
    throw new Error(
      '@cloak.dev/sdk is not installed. Install the alpha SDK (see docs.cloak.ag) or use MockCloakProvider.',
    );
  }

  const anySdk = sdk as unknown as {
    scanTransactions: (args: {
      connection: Connection;
      viewingKey: Uint8Array;
      account: PublicKey;
    }) => Promise<Array<Record<string, unknown>>>;
  };

  return {
    async scanHistory({ viewingKey, periodStart, periodEnd }) {
      const raw = await anySdk.scanTransactions({
        connection,
        viewingKey: viewingKey.nk,
        account: viewingKey.accountPubkey,
      });

      const scanned: CloakTx[] = raw
        .map((r) => normalizeCloakTx(r))
        .filter((tx) => tx.blockTime >= periodStart && tx.blockTime <= periodEnd);

      return aggregate(viewingKey.accountPubkey, periodStart, periodEnd, scanned);
    },
  };
}

export class MockCloakProvider implements CloakProvider {
  constructor(private readonly fixture: CloakTx[]) {}

  async scanHistory({
    viewingKey,
    periodStart,
    periodEnd,
  }: {
    viewingKey: ViewingKeyMaterial;
    periodStart: number;
    periodEnd: number;
  }): Promise<CloakAccountHistory> {
    const scanned = this.fixture.filter(
      (tx) => tx.blockTime >= periodStart && tx.blockTime <= periodEnd,
    );
    return aggregate(viewingKey.accountPubkey, periodStart, periodEnd, scanned);
  }
}

function normalizeCloakTx(raw: Record<string, unknown>): CloakTx {
  const amount = BigInt((raw.amount as string | number | bigint | undefined) ?? 0);
  const fee = BigInt((raw.fee as string | number | bigint | undefined) ?? 0);
  const netDelta = BigInt(
    (raw.netDelta as string | number | bigint | undefined) ?? amount - fee,
  );
  const direction: 'in' | 'out' = netDelta >= 0n ? 'in' : 'out';
  return {
    signature: String(raw.signature ?? ''),
    blockTime: Number(raw.blockTime ?? 0),
    mint: String(raw.mint ?? ''),
    direction,
    amount: amount < 0n ? -amount : amount,
    fee,
    netDelta,
    noteHash: String(raw.chainNoteHash ?? raw.noteHash ?? ''),
  };
}

function aggregate(
  entity: PublicKey,
  periodStart: number,
  periodEnd: number,
  scanned: CloakTx[],
): CloakAccountHistory {
  const byMint: Record<string, { inflow: bigint; outflow: bigint; fees: bigint; count: number }> =
    {};
  for (const tx of scanned) {
    const slot = (byMint[tx.mint] ??= { inflow: 0n, outflow: 0n, fees: 0n, count: 0 });
    if (tx.direction === 'in') slot.inflow += tx.amount;
    else slot.outflow += tx.amount;
    slot.fees += tx.fee;
    slot.count += 1;
  }
  return { entity, periodStart, periodEnd, scanned, byMint };
}
