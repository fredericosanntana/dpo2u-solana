/**
 * Shared helpers para os 4 clients Sprint D (POPIA / CCPA / PIPEDA / PIPA Korea).
 *
 * Padrão idêntico ao consent.ts mas extraído pra evitar duplicação de
 * cluster URLs, explorer URL builders, e IDL path resolution.
 */

import { Connection } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export type ClusterName = 'localnet' | 'devnet' | 'testnet' | 'mainnet-beta';

export const CLUSTER_URLS: Record<ClusterName, string> = {
  localnet: 'http://127.0.0.1:8899',
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export const EXPLORER_CLUSTER: Record<ClusterName, string> = {
  localnet: '?cluster=custom',
  devnet: '?cluster=devnet',
  testnet: '?cluster=testnet',
  'mainnet-beta': '',
};

export function buildExplorerUrl(signature: string, cluster: ClusterName): string {
  return `https://explorer.solana.com/tx/${signature}${EXPLORER_CLUSTER[cluster]}`;
}

export function makeConnection(cluster: ClusterName, rpcUrl?: string): Connection {
  return new Connection(rpcUrl ?? CLUSTER_URLS[cluster], 'confirmed');
}

/**
 * Resolves IDL path searching across known build locations.
 * Order: dist/idl (npm-installed runtime) → src/idl (dev) → solana-programs/target/idl (monorepo).
 */
export function resolveIdlPath(idlFileName: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, `./idl/${idlFileName}`),
    path.resolve(here, `../idl/${idlFileName}`),
    path.resolve(here, `../../../solana-programs/target/idl/${idlFileName}`),
  ];
  for (const p of candidates) {
    try {
      if (readFileSync(p, 'utf-8').length > 0) return p;
    } catch {
      /* try next */
    }
  }
  return candidates[candidates.length - 1];
}

export function loadIdl(idlFileName: string, override?: string): any {
  const p = override ?? resolveIdlPath(idlFileName);
  return JSON.parse(readFileSync(p, 'utf-8'));
}
