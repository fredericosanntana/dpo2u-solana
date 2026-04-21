/**
 * In-memory storage backend for tests and devnet demos. Shadow Drive does not
 * support devnet, so e2e flows on devnet use this to prove the erasure
 * lifecycle without touching mainnet.
 */

import { randomBytes } from 'node:crypto';
import { StorageBackend, PayloadNotFoundError } from './types.js';

export class MockBackend implements StorageBackend {
  readonly kind = 'mock' as const;
  private readonly store = new Map<string, Uint8Array>();

  async upload(content: Uint8Array, name: string): Promise<string> {
    const id = randomBytes(8).toString('hex');
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 32) || 'blob';
    const uri = `mock://${id}/${safeName}`;
    this.store.set(uri, Uint8Array.from(content));
    return uri;
  }

  async delete(uri: string): Promise<void> {
    this.store.delete(uri);
  }

  async fetch(uri: string): Promise<Uint8Array> {
    const hit = this.store.get(uri);
    if (!hit) throw new PayloadNotFoundError(uri);
    return Uint8Array.from(hit);
  }

  /** Test helper: number of live payloads. */
  size(): number {
    return this.store.size;
  }
}
