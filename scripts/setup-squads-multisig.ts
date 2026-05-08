#!/usr/bin/env tsx
/**
 * setup-squads-multisig.ts
 *
 * Sprint Composed Stack — Fase 1
 *
 * Cria 5 multisigs Squads v4 separados (cada um com threshold + time_lock próprio)
 * pra governar o stack DPO2U pré-mainnet. Decisão de design: 5 multisigs em vez
 * de 1 multisig com 5 vaults porque Squads v4 trata threshold + time_lock como
 * propriedades por-multisig (não por-vault). Vault index segrega só assets.
 *
 * Multisigs criados:
 *   ROLE                     | THRESHOLD | TIME-LOCK | USE
 *   -------------------------+-----------+-----------+-------------------------------
 *   [0] Governance           | 3-of-5    | 24h       | Upgrade authority dos 14 prgs
 *   [1] Treasury             | 2-of-3    | sem       | Fees do payment-gateway, infra
 *   [2] MiCAR Reserve        | 2-of-3    | 48h       | Authority do art-vault
 *   [3] Compliance Authority | 2-of-3    | 24h       | Revoke compressed attestations
 *   [4] Emergency            | 2-of-3    | sem       | Circuit breaker art-vault
 *
 * Output: salva todos os PDAs em /root/dpo2u-solana/scripts/squads-config.json
 *
 * SECURITY NOTE — Members:
 *   Pro MVP devnet: este script aceita um único arquivo `members.json` com
 *   array de Pubkeys. Em produção (mainnet), cada member deve ser um
 *   hardware wallet (Ledger) custodiado em jurisdição diferente. Veja
 *   /root/dpo2u-solana/docs/GOVERNANCE.md.
 *
 * Pre-requisitos:
 *   - solana CLI configurado (devnet ou mainnet)
 *   - Wallet ~/.config/solana/id.json com >= 0.5 SOL
 *   - cd /root/dpo2u-solana/solana-programs && pnpm install (instala @sqds/multisig ^2.1.3)
 *   - members.json com 5 Pubkeys (3-of-5 threshold máximo)
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/setup-squads-multisig.ts \
 *     --cluster devnet \
 *     --members /root/dpo2u-solana/scripts/members.json \
 *     [--dry-run]
 *
 * Output:
 *   scripts/squads-config.json com PDAs + tx signatures de cada multisig
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const { Permission, Permissions } = multisig.types;

interface MultisigRole {
  index: number;
  name: string;
  description: string;
  threshold: number;
  timeLockSeconds: number;
}

const ROLES: MultisigRole[] = [
  {
    index: 0,
    name: "Governance",
    description: "Upgrade authority dos 14 programas DPO2U",
    threshold: 3,
    timeLockSeconds: 24 * 60 * 60, // 24h
  },
  {
    index: 1,
    name: "Treasury",
    description: "Fees do payment-gateway + infra",
    threshold: 2,
    timeLockSeconds: 0,
  },
  {
    index: 2,
    name: "MiCAR Reserve",
    description: "Authority do art-vault reserve (MiCAR Art. 36)",
    threshold: 2,
    timeLockSeconds: 48 * 60 * 60, // 48h — MiCAR conservador
  },
  {
    index: 3,
    name: "Compliance Authority",
    description: "Revoke compressed attestation leaves",
    threshold: 2,
    timeLockSeconds: 24 * 60 * 60, // 24h — LGPD prazo de contestação
  },
  {
    index: 4,
    name: "Emergency",
    description: "Circuit breaker art-vault (halt rápido)",
    threshold: 2,
    timeLockSeconds: 0, // sem delay — emergência
  },
];

function parseArgs(): {
  cluster: "devnet" | "mainnet-beta";
  membersPath: string;
  dryRun: boolean;
} {
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const cluster = (get("cluster") as "devnet" | "mainnet-beta") ?? "devnet";
  if (!["devnet", "mainnet-beta"].includes(cluster)) {
    throw new Error(`--cluster must be devnet or mainnet-beta, got ${cluster}`);
  }
  const membersPath = get("members") ?? "./scripts/members.json";
  const dryRun = argv.includes("--dry-run");
  return { cluster, membersPath, dryRun };
}

function loadCreator(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function loadMembers(membersPath: string): PublicKey[] {
  const raw = JSON.parse(fs.readFileSync(membersPath, "utf-8"));
  if (!Array.isArray(raw) || raw.length < 5) {
    throw new Error(
      `members.json must be array with >=5 Pubkeys (for 3-of-5 governance). Got ${raw.length}.`,
    );
  }
  return raw.map((s: string) => new PublicKey(s));
}

async function createOneMultisig(
  connection: Connection,
  creator: Keypair,
  members: PublicKey[],
  role: MultisigRole,
  dryRun: boolean,
): Promise<{
  multisigPda: string;
  vaultPda: string;
  createKey: string;
  txSig: string | null;
}> {
  // Each multisig needs a unique createKey (Keypair) — public key is part of PDA seed
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({
    createKey: createKey.publicKey,
  });
  const [vaultPda] = multisig.getVaultPda({
    multisigPda,
    index: 0, // each multisig has its own vault[0] as default
  });

  // Member set: all addresses get full permissions for the multisig.
  // Threshold + time_lock are config-level, not per-member.
  const memberConfig = members.slice(0, 5).map((key) => ({
    key,
    permissions: Permissions.all(),
  }));

  console.log(
    `\n[${role.index}] ${role.name}` +
      `\n    threshold=${role.threshold}-of-${members.length}` +
      `\n    time_lock=${role.timeLockSeconds}s` +
      `\n    multisigPda=${multisigPda.toBase58()}` +
      `\n    vaultPda=${vaultPda.toBase58()}`,
  );

  if (dryRun) {
    return {
      multisigPda: multisigPda.toBase58(),
      vaultPda: vaultPda.toBase58(),
      createKey: createKey.publicKey.toBase58(),
      txSig: null,
    };
  }

  // Squads v4 requires treasury param to match the canonical ProgramConfig.treasury.
  // Fetch the on-chain ProgramConfig once (cached at module level via passed-in arg
  // would be cleaner; for simplicity, re-fetch here — cheap RPC call).
  const [programConfigPda] = multisig.getProgramConfigPda({});
  const programConfig = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    programConfigPda,
  );
  const sig = await multisig.rpc.multisigCreateV2({
    connection,
    creator,
    multisigPda,
    configAuthority: null, // self-controlled — only multisig itself can change config
    threshold: role.threshold,
    members: memberConfig,
    timeLock: role.timeLockSeconds,
    rentCollector: null,
    treasury: programConfig.treasury, // canonical Squads treasury (collects fees)
    createKey,
    sendOptions: { skipPreflight: false },
  });

  console.log(`    ✓ created tx=${sig}`);

  return {
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    createKey: createKey.publicKey.toBase58(),
    txSig: sig,
  };
}

async function main() {
  const { cluster, membersPath, dryRun } = parseArgs();
  const rpcUrl =
    cluster === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const creator = loadCreator();
  const members = loadMembers(membersPath);

  const balance = await connection.getBalance(creator.publicKey);
  console.log(
    `─── DPO2U Squads v4 Multisig Setup ───` +
      `\nCluster        : ${cluster}` +
      `\nCreator        : ${creator.publicKey.toBase58()}` +
      `\nCreator balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL` +
      `\nMembers (${members.length}):` +
      members.map((m, i) => `\n   [${i}] ${m.toBase58()}`).join("") +
      `\nDry run        : ${dryRun}\n`,
  );

  if (!dryRun && balance < 0.5 * LAMPORTS_PER_SOL) {
    throw new Error(
      `Creator balance < 0.5 SOL (creating 5 multisigs costs ~0.05 SOL + tx fees). Fund the wallet first.`,
    );
  }

  const results: Array<{
    role: string;
    description: string;
    threshold: string;
    timeLockSeconds: number;
    multisigPda: string;
    vaultPda: string;
    createKey: string;
    txSig: string | null;
  }> = [];

  for (const role of ROLES) {
    const r = await createOneMultisig(
      connection,
      creator,
      members,
      role,
      dryRun,
    );
    results.push({
      role: role.name,
      description: role.description,
      threshold: `${role.threshold}-of-${members.length}`,
      timeLockSeconds: role.timeLockSeconds,
      ...r,
    });
  }

  const config = {
    cluster,
    creator: creator.publicKey.toBase58(),
    members: members.map((m) => m.toBase58()),
    createdAt: new Date().toISOString(),
    multisigs: results,
  };

  const outPath = path.join(__dirname, "squads-config.json");
  fs.writeFileSync(outPath, JSON.stringify(config, null, 2));
  console.log(`\n✓ Config saved to ${outPath}`);

  if (!dryRun) {
    console.log(
      `\nNext step: npx tsx scripts/transfer-program-authorities.ts ` +
        `--config ${outPath} --target governance`,
    );
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
