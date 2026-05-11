import type { PublicKey } from '@solana/web3.js';

export type Direction = 'in' | 'out';

export interface CloakTx {
  signature: string;
  blockTime: number;
  mint: string;
  direction: Direction;
  amount: bigint;
  fee: bigint;
  netDelta: bigint;
  noteHash: string;
}

export interface CloakAccountHistory {
  entity: PublicKey;
  periodStart: number;
  periodEnd: number;
  scanned: CloakTx[];
  byMint: Record<string, { inflow: bigint; outflow: bigint; fees: bigint; count: number }>;
}

export interface ViewingKeyMaterial {
  nk: Uint8Array;
  accountPubkey: PublicKey;
}
