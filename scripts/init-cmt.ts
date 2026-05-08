#!/usr/bin/env tsx
/**
 * init-cmt.ts
 *
 * Sprint Composed Stack — Fase 3
 *
 * Aloca uma Concurrent Merkle Tree (CMT) on-chain pra hospedar compressed
 * AttestationLeaves do DPO2U. Configuração default: max_depth=20, suporta
 * 2^20 = 1,048,576 leaves antes de precisar rollover. Custo one-time
 * estimado ~1 SOL devnet (rent + canopy storage).
 *
 * Light Protocol model:
 *   - State Tree: Merkle tree onde leaves vivem (refs como leaf hashes)
 *   - Address Tree: Merkle tree de addresses únicos pra evitar collisions
 *   - Output Queue: nullifier queue processada por Forester
 *
 * Decisão de tree config:
 *   max_depth=20         → 1M leaves capacity (overkill p/ devnet, mas é
 *                          rent-exempt one-time, vale a pena dimensionar
 *                          generoso pra evitar rollover early)
 *   max_buffer_size=2048 → suporta 2048 changes por slot (concurrent writes
 *                          por validator slot — mais que suficiente p/
 *                          DPO2U volume previsto)
 *   canopy_depth=10      → cache de top 10 levels da tree on-chain pra
 *                          reduzir Merkle proof size em writes (proof
 *                          requerida vai de 20 hashes → 10 hashes)
 *
 * Pre-requisitos:
 *   - Wallet com >= 1.5 SOL
 *   - cd /root/dpo2u-solana/packages/client-sdk && pnpm install
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/packages/client-sdk/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/init-cmt.ts \
 *     --cluster devnet \
 *     --rpc-url https://devnet.helius-rpc.com/?api-key=$HELIUS_API_KEY \
 *     [--max-depth 20] [--max-buffer 2048] [--canopy 10]
 *
 * Output:
 *   /root/dpo2u-solana/scripts/cmt-config.json
 *     { stateTreePubkey, addressTreePubkey, queuePubkey, maxDepth, ... }
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// IMPORTANT: Light Protocol SDK importado dinâmico pra script funcionar
// mesmo se @lightprotocol/stateless.js ainda não estiver instalado
// (degrada com mensagem clara sobre `pnpm install`).
//
// Light Protocol expose helpers:
//   - createStateTree({ maxDepth, maxBufferSize, canopyDepth })
//   - createAddressTree(...)
//   - LightSystemProgram constants

interface InitCmtArgs {
  cluster: "devnet" | "mainnet-beta";
  rpcUrl: string;
  maxDepth: number;
  maxBufferSize: number;
  canopyDepth: number;
  outPath: string;
}

function parseArgs(): InitCmtArgs {
  const argv = process.argv.slice(2);
  const get = (n: string) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cluster = (get("cluster") as "devnet" | "mainnet-beta") ?? "devnet";
  const rpcUrl = get("rpc-url") ??
    (cluster === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com");
  return {
    cluster,
    rpcUrl,
    maxDepth: parseInt(get("max-depth") ?? "20", 10),
    maxBufferSize: parseInt(get("max-buffer") ?? "2048", 10),
    canopyDepth: parseInt(get("canopy") ?? "10", 10),
    outPath: get("out") ?? "/root/dpo2u-solana/scripts/cmt-config.json",
  };
}

function loadCreator(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const args = parseArgs();
  const connection = new Connection(args.rpcUrl, "confirmed");
  const creator = loadCreator();

  const balance = await connection.getBalance(creator.publicKey);
  console.log(
    `─── DPO2U Light Protocol CMT init ───` +
      `\nCluster        : ${args.cluster}` +
      `\nRPC URL        : ${args.rpcUrl}` +
      `\nCreator        : ${creator.publicKey.toBase58()}` +
      `\nCreator balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL` +
      `\nTree config    : depth=${args.maxDepth} buffer=${args.maxBufferSize} canopy=${args.canopyDepth}`,
  );

  if (balance < 1.5 * LAMPORTS_PER_SOL) {
    throw new Error(
      `Need >= 1.5 SOL for CMT alloc (rent for state tree + address tree + canopy). Fund the wallet first.`,
    );
  }

  // Dynamic import to fail gracefully if package missing
  let stateless: any;
  try {
    stateless = await import("@lightprotocol/stateless.js");
  } catch (err) {
    console.error(
      `\n⚠️  @lightprotocol/stateless.js not installed.\n` +
        `Run: cd /root/dpo2u-solana/packages/client-sdk && pnpm install\n`,
    );
    process.exit(2);
  }

  // ---------------------------------------------------------------------------
  // The actual CMT init API depends on the Light Protocol SDK version.
  // Version 0.13.x exposes: createStateTreeAndQueue, createAddressTreeAndQueue.
  // Older versions: createTree from @lightprotocol/stateless.js
  //
  // Below is the canonical pattern; the exact symbol names are validated at
  // runtime against the imported module — if mismatched, the script logs a
  // clear error pointing to the version bump in package.json.
  // ---------------------------------------------------------------------------

  const stateTreeKp = Keypair.generate();
  const stateQueueKp = Keypair.generate();
  const addressTreeKp = Keypair.generate();
  const addressQueueKp = Keypair.generate();

  const apiCandidates = [
    "createStateTreeAndQueue",
    "createStateTree",
    "createTree",
  ];
  const apiName = apiCandidates.find((n) => typeof stateless[n] === "function");
  if (!apiName) {
    console.error(
      `\n⚠️  Could not find CMT init API in @lightprotocol/stateless.js.\n` +
        `Tried: ${apiCandidates.join(", ")}.\n` +
        `Available: ${Object.keys(stateless).slice(0, 30).join(", ")}\n` +
        `Pin a known-compatible version in packages/client-sdk/package.json\n` +
        `or update this script for the SDK release.\n`,
    );
    process.exit(3);
  }

  console.log(`\nUsing API: stateless.${apiName}()`);
  console.log(`State tree  PDA candidate: ${stateTreeKp.publicKey.toBase58()}`);
  console.log(`State queue PDA candidate: ${stateQueueKp.publicKey.toBase58()}`);
  console.log(`Address tree PDA candidate: ${addressTreeKp.publicKey.toBase58()}`);
  console.log(`\n[NOT EXECUTING] To actually create the trees on-chain, finalize`);
  console.log(`the API call signature for the installed SDK version and remove`);
  console.log(`this guard. Pre-execution scaffolding written to:`);

  const config = {
    cluster: args.cluster,
    rpcUrl: args.rpcUrl,
    creator: creator.publicKey.toBase58(),
    createdAt: new Date().toISOString(),
    config: {
      maxDepth: args.maxDepth,
      maxBufferSize: args.maxBufferSize,
      canopyDepth: args.canopyDepth,
    },
    keypairs: {
      stateTree: stateTreeKp.publicKey.toBase58(),
      stateQueue: stateQueueKp.publicKey.toBase58(),
      addressTree: addressTreeKp.publicKey.toBase58(),
      addressQueue: addressQueueKp.publicKey.toBase58(),
    },
    apiUsed: apiName,
    status: "scaffolded — Fase 3.b finalizes",
  };

  fs.writeFileSync(args.outPath, JSON.stringify(config, null, 2));
  console.log(args.outPath);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
