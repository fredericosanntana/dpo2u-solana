/**
 * Storage backend factory + re-exports.
 *
 * See `./types.ts` for the StorageBackend interface and the LGPD rationale.
 */

export { NotImplementedError, PayloadNotFoundError } from './types.js';
export type { StorageBackend } from './types.js';
export { MockBackend } from './mock.js';
export { IpfsBackend } from './ipfs.js';
export { ShdwDriveBackend } from './shdw.js';
export type { ShdwBackendConfig } from './shdw.js';
export {
  EncryptedStorageBackend,
  EncryptedBackendError,
  keyFromHex,
  withEncryption,
} from './encrypted.js';
export type { EncryptionMode, EncryptedStorageBackendOptions } from './encrypted.js';
export {
  KekVault,
  KekVaultError,
  defaultKekVaultPath,
} from './kek-vault.js';
export type { KekVaultOptions } from './kek-vault.js';

import { MockBackend } from './mock.js';
import { IpfsBackend } from './ipfs.js';
import { ShdwDriveBackend } from './shdw.js';
import type { ShdwBackendConfig } from './shdw.js';
import type { StorageBackend } from './types.js';

export type BackendKind = 'mock' | 'ipfs' | 'shdw';

export async function createStorageBackend(
  kind: BackendKind,
  config?: Partial<ShdwBackendConfig> & { gateway?: string },
): Promise<StorageBackend> {
  switch (kind) {
    case 'mock':
      return new MockBackend();
    case 'ipfs':
      return new IpfsBackend(config?.gateway);
    case 'shdw': {
      const required = ['connection', 'wallet', 'storageAccount'] as const;
      for (const k of required) {
        if (!config?.[k]) throw new Error(`shdw backend requires config.${k}`);
      }
      return ShdwDriveBackend.init(config as ShdwBackendConfig);
    }
    default:
      throw new Error(`unknown storage backend: ${kind}`);
  }
}
