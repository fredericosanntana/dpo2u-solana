/**
 * Storage backend factory + re-exports.
 *
 * See `./types.ts` for the StorageBackend interface and the LGPD rationale.
 */

export { StorageBackend, NotImplementedError, PayloadNotFoundError } from './types.js';
export { MockBackend } from './mock.js';
export { IpfsBackend } from './ipfs.js';
export { ShdwDriveBackend, ShdwBackendConfig } from './shdw.js';

import { MockBackend } from './mock.js';
import { IpfsBackend } from './ipfs.js';
import { ShdwDriveBackend, ShdwBackendConfig } from './shdw.js';
import { StorageBackend } from './types.js';

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
