/**
 * photon.ts — Composed Stack Fase 3
 *
 * Thin wrapper sobre o Helius Photon Indexer (gRPC/REST) pra reconstruir
 * compressed account state que vive em tx logs, não em accounts on-chain.
 *
 * Photon provê:
 *   - getInsertionProof   — Merkle proof pra inserir leaf novo na CMT
 *   - getCompressedAccount — fetch leaf data por leaf hash
 *   - getCompressedAccountsByOwner — query leaves de um subject/authority
 *   - getValidityProof    — Groth16 proof do estado da tree pra spend leaf
 *   - getNullifierStatus  — verifica se um leaf já foi nullificado
 *
 * Endpoints: https://docs.helius.dev/zk-compression-and-photon-api/photon-rpc-endpoints
 *
 * Required env: HELIUS_API_KEY (ou PHOTON_RPC_URL pra self-hosted)
 */

import { PublicKey } from "@solana/web3.js";

const DEFAULT_PHOTON_DEVNET = "https://devnet.helius-rpc.com";
const DEFAULT_PHOTON_MAINNET = "https://mainnet.helius-rpc.com";

export interface PhotonClientOptions {
  cluster?: "devnet" | "mainnet-beta";
  apiKey?: string;
  rpcUrl?: string;
  /** Timeout ms per request (default 8000) — paired with retry */
  timeoutMs?: number;
}

export interface MerkleProofResponse {
  proof: string[];        // 20 hashes (max_depth=20) ou menos com canopy
  root: string;
  leafIndex: number;
  treePubkey: string;
}

export interface CompressedAccountData {
  leafHash: string;
  leafIndex: number;
  treePubkey: string;
  data: Uint8Array;       // raw 252-byte AttestationLeaf (decode via helpers)
  owner: string;
  slot: number;
}

export class PhotonClient {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(opts: PhotonClientOptions = {}) {
    const cluster = opts.cluster ?? "devnet";
    const apiKey = opts.apiKey ?? process.env.HELIUS_API_KEY ?? "";
    const baseUrl = opts.rpcUrl ?? process.env.PHOTON_RPC_URL ??
      (cluster === "devnet" ? DEFAULT_PHOTON_DEVNET : DEFAULT_PHOTON_MAINNET);

    this.url = apiKey ? `${baseUrl}/?api-key=${apiKey}` : baseUrl;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  /**
   * RPC call wrapper com timeout.
   * Photon expõe métodos JSON-RPC 2.0 padrão.
   */
  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });
      const json = await res.json() as { result?: T; error?: { message: string } };
      if (json.error) throw new Error(`Photon ${method}: ${json.error.message}`);
      if (json.result === undefined) throw new Error(`Photon ${method}: no result`);
      return json.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Get Merkle proof for inserting a new leaf into a state tree.
   * Used by submitComposedAttestation right before sending the tx.
   */
  async getInsertionProof(treePubkey: PublicKey | string): Promise<MerkleProofResponse> {
    const pk = typeof treePubkey === "string" ? treePubkey : treePubkey.toBase58();
    return this.rpc<MerkleProofResponse>("getInsertionProof", { treePubkey: pk });
  }

  /**
   * Fetch a compressed account by its leaf hash.
   * Returns the raw 252-byte AttestationLeaf data — caller decodes via
   * deserializeAttestationLeaf from helpers.
   */
  async getCompressedAccount(leafHash: Buffer | string): Promise<CompressedAccountData | null> {
    const hashStr = typeof leafHash === "string" ? leafHash : leafHash.toString("hex");
    try {
      return await this.rpc<CompressedAccountData>("getCompressedAccount", { hash: hashStr });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("NotFound")) return null;
      throw err;
    }
  }

  /**
   * List all compressed accounts owned by a specific subject/authority.
   * Uses the owner index Photon maintains.
   */
  async getCompressedAccountsByOwner(owner: PublicKey | string, limit = 50): Promise<CompressedAccountData[]> {
    const pk = typeof owner === "string" ? owner : owner.toBase58();
    const result = await this.rpc<{ items: CompressedAccountData[] }>(
      "getCompressedAccountsByOwner",
      { owner: pk, limit },
    );
    return result.items;
  }

  /**
   * Validity proof — Groth16 proof that input compressed accounts exist
   * in the state tree AND nullifiers haven't been recorded. Required for
   * spend operations (e.g. revoke_compressed).
   */
  async getValidityProof(leafHashes: Array<Buffer | string>): Promise<{
    compressedProof: { a: number[]; b: number[]; c: number[] };
    rootIndices: number[];
    leafIndices: number[];
  }> {
    const hashes = leafHashes.map((h) => typeof h === "string" ? h : h.toString("hex"));
    return this.rpc("getValidityProof", { hashes });
  }

  /**
   * Check if a leaf has been nullified (i.e. consumed by revoke_compressed).
   * Returns true if nullifier is present in the on-chain queue OR processed
   * by Forester into the Merkle tree.
   */
  async getNullifierStatus(leafHash: Buffer | string): Promise<{ nullified: boolean; slot?: number }> {
    const hashStr = typeof leafHash === "string" ? leafHash : leafHash.toString("hex");
    return this.rpc<{ nullified: boolean; slot?: number }>("getNullifierStatus", { hash: hashStr });
  }

  /**
   * Health probe — returns Photon node version and slot height.
   * Use to gate operations behind health-check + populate dashboard.
   */
  async health(): Promise<{ version: string; slot: number }> {
    return this.rpc<{ version: string; slot: number }>("getHealth", {});
  }
}
