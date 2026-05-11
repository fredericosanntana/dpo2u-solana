#!/usr/bin/env tsx
/**
 * transfer-program-authorities.ts
 *
 * Sprint Composed Stack — Fase 1
 *
 * Transfere upgrade authority dos 14 programas DPO2U pro Squads Governance
 * multisig vault PDA criado via setup-squads-multisig.ts. Operação parcialmente
 * REVERSÍVEL: depois desta migração, qualquer upgrade dos programas exige
 * proposal Squads + 3-of-5 approval + 24h time-lock. Reverter = proposal pra
 * `set_upgrade_authority` de volta pra um single signer (perde toda a
 * trustlessness, normalmente não desejado).
 *
 * IMPORTANTE: Pinocchio program é compilado sem upgrade authority por padrão
 * (deploy --final). Skip se já final. Lista filtrada via solana program show.
 *
 * Modos:
 *   --target governance   — migra upgrade authority dos 14 programas pro Squads[0] Governance
 *   --target reserve      — migra art-vault `vault.authority` field pro Squads[2] MiCAR Reserve
 *                           (chamada on-chain, não solana CLI)
 *
 * Pre-requisitos:
 *   - solana CLI configurado pra cluster correto (devnet ou mainnet-beta)
 *   - Wallet ~/.config/solana/id.json é a CURRENT upgrade authority dos 14 programas
 *   - squads-config.json gerado por setup-squads-multisig.ts existe
 *
 * Run (dry-run obrigatório primeiro):
 *   cd /root/dpo2u-solana
 *   npx tsx scripts/transfer-program-authorities.ts \
 *     --config ./scripts/squads-config.json \
 *     --target governance \
 *     --dry-run
 *
 * Run real (requer --confirm):
 *   npx tsx scripts/transfer-program-authorities.ts \
 *     --config ./scripts/squads-config.json \
 *     --target governance \
 *     --confirm
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as readline from "readline/promises";

const PROGRAM_IDS: Record<string, string> = {
  agent_registry: "5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7",
  agent_wallet_factory: "AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in",
  compliance_registry: "7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK",
  compliance_registry_pinocchio: "FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8",
  aiverify_attestation: "DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm",
  art_vault: "C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna",
  consent_manager: "D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB",
  fee_distributor: "88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x",
  payment_gateway: "4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q",
  popia_info_officer_registry:
    "ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb",
  ccpa_optout_registry: "5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk",
  pipeda_consent_extension: "G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT",
  pipa_korea_zk_identity: "41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR",
  hiroshima_ai_process_attestation:
    "4qPsou8f6QFacbZeW75ZZ1mZiYi5PtxuoRSJLyZZVQqx",
};

interface SquadsConfig {
  cluster: string;
  creator: string;
  members: string[];
  multisigs: Array<{
    role: string;
    multisigPda: string;
    vaultPda: string;
    threshold: string;
    timeLockSeconds: number;
  }>;
}

function parseArgs(): {
  configPath: string;
  target: "governance" | "reserve";
  dryRun: boolean;
  confirm: boolean;
} {
  const argv = process.argv.slice(2);
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const configPath = get("config") ?? "./scripts/squads-config.json";
  const target = (get("target") as "governance" | "reserve") ?? "governance";
  if (!["governance", "reserve"].includes(target)) {
    throw new Error(`--target must be governance or reserve, got ${target}`);
  }
  const dryRun = argv.includes("--dry-run");
  const confirm = argv.includes("--confirm");
  return { configPath, target, dryRun, confirm };
}

function loadConfig(p: string): SquadsConfig {
  const abs = path.isAbsolute(p) ? p : path.join(process.cwd(), p);
  return JSON.parse(fs.readFileSync(abs, "utf-8"));
}

function loadCreator(): Keypair {
  const walletPath =
    process.env.SOLANA_WALLET ??
    path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

interface ProgramInfo {
  name: string;
  programId: string;
  currentAuthority: string | null;
  isFinal: boolean;
}

function getProgramInfo(programId: string, name: string): ProgramInfo {
  try {
    const out = execSync(`solana program show ${programId}`, {
      encoding: "utf-8",
    });
    const authMatch = out.match(/Authority:\s+(\S+)/);
    const isFinal = out.includes("Authority: none");
    return {
      name,
      programId,
      currentAuthority: authMatch && !isFinal ? authMatch[1] : null,
      isFinal,
    };
  } catch (err) {
    return {
      name,
      programId,
      currentAuthority: null,
      isFinal: false,
    };
  }
}

async function migrateGovernance(
  config: SquadsConfig,
  creator: Keypair,
  dryRun: boolean,
  confirm: boolean,
) {
  const governance = config.multisigs.find((m) => m.role === "Governance");
  if (!governance) {
    throw new Error("Governance multisig not found in config");
  }
  const targetAuthority = governance.vaultPda;

  console.log(
    `\n─── Phase 1.b — Transfer upgrade authority → Squads Governance vault\n`,
  );
  console.log(`Target authority: ${targetAuthority}`);
  console.log(`Current signer  : ${creator.publicKey.toBase58()}\n`);

  // Inspect each program first
  console.log(`Inspecting current state of ${Object.keys(PROGRAM_IDS).length} programs...`);
  const infos: ProgramInfo[] = [];
  for (const [name, pid] of Object.entries(PROGRAM_IDS)) {
    const info = getProgramInfo(pid, name);
    infos.push(info);
    const status = info.isFinal
      ? "[FINAL — skip]"
      : info.currentAuthority === creator.publicKey.toBase58()
        ? "[OK to migrate]"
        : info.currentAuthority === targetAuthority
          ? "[ALREADY MIGRATED]"
          : `[OWNED BY OTHER: ${info.currentAuthority}]`;
    console.log(`  ${name.padEnd(36)} ${pid.slice(0, 8)}… ${status}`);
  }

  const eligible = infos.filter(
    (i) => !i.isFinal && i.currentAuthority === creator.publicKey.toBase58(),
  );
  console.log(`\n${eligible.length} of ${infos.length} programs eligible for migration.`);

  if (eligible.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (dryRun) {
    console.log("\n[DRY RUN] Would execute:");
    for (const info of eligible) {
      console.log(
        `  solana program set-upgrade-authority ${info.programId} --new-upgrade-authority ${targetAuthority}`,
      );
    }
    return;
  }

  if (!confirm) {
    console.log(
      "\n⚠️  Refusing to execute without --confirm. Re-run with --dry-run to preview, then --confirm to apply.",
    );
    process.exit(2);
  }

  // Final interactive confirmation gate
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const ans = await rl.question(
    `\n⚠️  About to transfer upgrade authority of ${eligible.length} programs to ${targetAuthority}.\nThis is REVERSIBLE only via Squads multisig proposal.\nType "MIGRATE" to proceed: `,
  );
  rl.close();
  if (ans.trim() !== "MIGRATE") {
    console.log("Aborted.");
    process.exit(3);
  }

  for (const info of eligible) {
    const cmd = `solana program set-upgrade-authority ${info.programId} --new-upgrade-authority ${targetAuthority} --skip-new-upgrade-authority-signer-check`;
    console.log(`\n→ ${info.name}`);
    console.log(`  $ ${cmd}`);
    try {
      const out = execSync(cmd, { encoding: "utf-8" });
      console.log(`  ✓ ${out.trim()}`);
    } catch (err: any) {
      console.error(`  ✗ FAILED: ${err.message}`);
      // continue with other programs — partial migration is acceptable, can resume
    }
  }

  console.log(
    `\n✓ Migration done. Verify with:\n  solana program show <PROGRAM_ID>`,
  );
}

async function migrateReserve(
  config: SquadsConfig,
  creator: Keypair,
  dryRun: boolean,
  confirm: boolean,
) {
  const reserve = config.multisigs.find((m) => m.role === "MiCAR Reserve");
  if (!reserve) {
    throw new Error("MiCAR Reserve multisig not found in config");
  }
  const targetAuthority = new PublicKey(reserve.vaultPda);

  console.log(
    `\n─── Phase 1.c — Transfer art-vault.authority → Squads MiCAR Reserve\n`,
  );
  console.log(`Target authority: ${targetAuthority.toBase58()}`);
  console.log(`Current signer  : ${creator.publicKey.toBase58()}\n`);

  console.log(
    `⚠️  This requires an art-vault instruction that transfers the on-chain` +
      `\n    'authority' field. The art-vault program currently does NOT expose` +
      `\n    such instruction (see programs/art-vault/src/lib.rs). Adding it is` +
      `\n    a Fase 2 task — bundle with Pinocchio refactor.\n`,
  );

  if (dryRun) {
    console.log(
      `[DRY RUN] Would CPI: art_vault::transfer_authority(new = ${targetAuthority.toBase58()})`,
    );
    return;
  }

  console.log(
    `Refusing to execute. Need to add 'transfer_authority' instruction to art-vault first.`,
  );
  process.exit(4);
}

async function main() {
  const { configPath, target, dryRun, confirm } = parseArgs();
  const config = loadConfig(configPath);
  const creator = loadCreator();

  const rpcUrl =
    config.cluster === "devnet"
      ? "https://api.devnet.solana.com"
      : "https://api.mainnet-beta.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");
  const balance = await connection.getBalance(creator.publicKey);
  console.log(
    `Wallet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL on ${config.cluster}`,
  );

  if (target === "governance") {
    await migrateGovernance(config, creator, dryRun, confirm);
  } else {
    await migrateReserve(config, creator, dryRun, confirm);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
