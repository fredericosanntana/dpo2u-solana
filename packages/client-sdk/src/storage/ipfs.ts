/**
 * Public-gateway IPFS backend — read-only. Upload/delete require a pin service
 * (Pinata, Web3.Storage, etc.) with auth, which is out of scope for this
 * demo. Included so existing `ipfs://Qm...` storage_uri values on attestations
 * remain fetchable via `dpo2u-cli fetch --resolve-payload`.
 *
 * LGPD caveat: IPFS is effectively immutable (content-addressed, replicas in
 * public swarm). This backend CANNOT honor Art. 18 erasure — use Shadow Drive
 * v1 or Mock for compliance-critical payloads.
 */

import { StorageBackend, NotImplementedError, PayloadNotFoundError } from './types.js';

const DEFAULT_GATEWAY = 'https://ipfs.io/ipfs/';

export class IpfsBackend implements StorageBackend {
  readonly kind = 'ipfs' as const;
  constructor(private readonly gateway: string = DEFAULT_GATEWAY) {}

  async upload(_content: Uint8Array, _name: string): Promise<string> {
    throw new NotImplementedError('ipfs', 'upload (use a pin service with auth)');
  }

  async delete(_uri: string): Promise<void> {
    throw new NotImplementedError('ipfs', 'delete (content-addressed, immutable by design)');
  }

  async fetch(uri: string): Promise<Uint8Array> {
    const cid = uri.replace(/^ipfs:\/\//, '').replace(/^\/ipfs\//, '');
    const url = `${this.gateway}${cid}`;
    const res = await fetch(url);
    if (res.status === 404) throw new PayloadNotFoundError(uri);
    if (!res.ok) throw new Error(`ipfs gateway ${res.status} for ${uri}`);
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }
}
