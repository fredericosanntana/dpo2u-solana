/**
 * Shadow Drive v1 backend — Solana-native, rent-based, mutable. The ONLY
 * storage backend in this SDK that satisfies LGPD Art. 18 (right to erasure)
 * while staying Solana-native: payloads can be deleted on request, while the
 * on-chain commitment hash remains as audit evidence.
 *
 * Mainnet-only. Shadow Drive does not deploy to devnet; pass `cluster === 'mainnet-beta'`
 * or the constructor throws. For devnet demos, use MockBackend.
 *
 * Requires:
 *   - wallet with some SHDW tokens (for storage account rent)
 *   - a pre-created storage account owned by the wallet
 *
 * Usage:
 *   const drv = await ShdwDriveBackend.init({ connection, wallet, storageAccount });
 *   const uri = await drv.upload(Buffer.from('payload'), 'proof.bin');
 *   // ...later, on Art. 18 request:
 *   await drv.delete(uri);
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { ShdwDrive } from '@shadow-drive/sdk';
import { StorageBackend, PayloadNotFoundError } from './types.js';

export interface ShdwBackendConfig {
  connection: Connection;
  wallet: Wallet | Keypair;
  /** pubkey of a pre-created Shadow Drive v1 storage account */
  storageAccount: PublicKey;
  /** override for custom gateway (default: shdw-drive.genesysgo.net) */
  gateway?: string;
  /** explicit cluster guard — throws if not mainnet-beta */
  cluster?: string;
}

const DEFAULT_GATEWAY = 'https://shdw-drive.genesysgo.net/';

export class ShdwDriveBackend implements StorageBackend {
  readonly kind = 'shdw' as const;

  private constructor(
    private readonly drive: ShdwDrive,
    private readonly storageAccount: PublicKey,
    private readonly gateway: string,
  ) {}

  static async init(config: ShdwBackendConfig): Promise<ShdwDriveBackend> {
    if (config.cluster && config.cluster !== 'mainnet-beta') {
      throw new Error(
        `ShdwDriveBackend requires mainnet-beta — Shadow Drive does not support ${config.cluster}. Use MockBackend for devnet demos.`,
      );
    }
    const wallet = (config.wallet instanceof Keypair)
      ? { publicKey: config.wallet.publicKey, signTransaction: async (tx: any) => { tx.partialSign(config.wallet as Keypair); return tx; }, signAllTransactions: async (txs: any[]) => { for (const tx of txs) tx.partialSign(config.wallet as Keypair); return txs; } } as unknown as Wallet
      : config.wallet;

    const drive = await new ShdwDrive(config.connection, wallet).init();
    return new ShdwDriveBackend(drive, config.storageAccount, config.gateway ?? DEFAULT_GATEWAY);
  }

  async upload(content: Uint8Array, name: string): Promise<string> {
    const file = new File([content], name);
    const result = await this.drive.uploadFile(this.storageAccount, file);
    if (!result.upload_errors || result.upload_errors.length === 0) {
      const finalized = result.finalized_locations?.[0];
      if (finalized) return finalized;
    }
    throw new Error(`shdw upload failed: ${JSON.stringify(result.upload_errors ?? [])}`);
  }

  async delete(uri: string): Promise<void> {
    const res = await this.drive.deleteFile(this.storageAccount, uri);
    if (!res || res.message?.toLowerCase().includes('error')) {
      throw new Error(`shdw delete failed: ${JSON.stringify(res)}`);
    }
  }

  async fetch(uri: string): Promise<Uint8Array> {
    const res = await fetch(uri);
    if (res.status === 404) throw new PayloadNotFoundError(uri);
    if (!res.ok) throw new Error(`shdw gateway ${res.status} for ${uri}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
