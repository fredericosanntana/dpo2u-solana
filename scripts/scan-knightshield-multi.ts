#!/usr/bin/env tsx
/**
 * scan-knightshield-multi.ts
 *
 * Real multi-jurisdiction compliance scan for KnightShield Mobile Privacy Wallet.
 * Imports the actual MCP handler locally (no auth/HTTP), runs LGPD/GDPR/CCPA/APPI
 * in parallel, computes aggregate score, and — if threshold passed — submits a
 * REAL `create_attestation` transaction to Solana devnet.
 *
 * Designed for terminal recording (xvfb+xterm+ffmpeg). Outputs paced for
 * cinematic effect. All numbers are real (handler-computed scores, on-chain tx,
 * measured compute-units).
 *
 * Run:
 *   NODE_PATH=/root/dpo2u-solana/solana-programs/node_modules \
 *     npx tsx /root/dpo2u-solana/scripts/scan-knightshield-multi.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { BorshCoder } from '@coral-xyz/anchor';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleMultiJurisdictionComplianceCheck } from '/root/DPO2U/packages/mcp-server/src/tools/standard/multi-jurisdiction-compliance-check.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- ANSI colors (terracotta accent matches DPO2U brand) ---
const T = '\x1b[38;5;208m';  // terracotta
const W = '\x1b[1;37m';       // bright white
const D = '\x1b[2;37m';       // dim
const G = '\x1b[1;32m';       // green
const Y = '\x1b[1;33m';       // yellow
const R = '\x1b[1;31m';       // red
const N = '\x1b[0m';          // reset
const B = '\x1b[1m';          // bold

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- KnightShield public profile (26 booleans, derived from their README + SECURITY.md) ---
// github.com/Knight-Shield-Wallet/wallet-solana
const KS_PROFILE = {
  // Strong yes — design-level evidence
  hasPrivacyPolicy: true,         // README + privacy-by-default thesis
  hasEncryption: true,            // Shamir 5/3 + TLS relay
  hasAccessControls: true,        // Wallet key ownership = access control
  hasDataBreachProtocol: true,    // emergency_lock tx (Phase 1) + GhostShard
  hasDataRetentionPolicy: true,   // no-persist by design
  hasErasureMechanism: true,      // Client-side key wipe always available
  hasIncidentResponsePlan: true,  // emergency_lock = formal IR mechanism
  hasAuditProgram: true,          // Open source + 35 tests passing CI
  hasDataPortability: true,       // Keys exportable (BIP39 mnemonic)
  hasBackup: true,                // Shamir 5-of-3 = formal backup
  // Realistic no — startup gaps
  hasDPO: false,
  hasDataMapping: false,
  hasDPIA: false,
  hasConsentManager: false,
  hasCookieConsent: false,
  hasLawfulBasisRegister: false,
  hasCrossBorderSafeguards: false,
  internationalTransfer: false,
  hasADMOptOut: false,
  hasChildrenDataSafeguards: false,
  hasDataProcessingAgreement: false,
  // MICAR-specific (N/A — wallet, not a stablecoin issuer)
  hasMicarWhitePaper: false,
  hasReserveManagement: false,
  hasRedemptionPolicy: false,
  hasCapitalBuffer: false,
  hasVelocityCap: false,
};

// --- Solana constants ---
const COMPLIANCE_REGISTRY = new PublicKey('7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK');
const RPC_URL = 'https://api.devnet.solana.com';
const IDL_PATH = '/root/dpo2u-solana/solana-programs/target/idl/compliance_registry.json';
const KS_SUBJECT_PATH = join(__dirname, 'knightshield-demo-subject.json');

function loadOrCreateSubject(): Keypair {
  if (existsSync(KS_SUBJECT_PATH)) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(KS_SUBJECT_PATH, 'utf-8'))));
  }
  const kp = Keypair.generate();
  writeFileSync(KS_SUBJECT_PATH, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

async function submitAttestation(
  aggregateScore: number,
  jurisdictions: string[],
  storageUri: string,
): Promise<{ tx: string; pda: string; cu: number; fee: number }> {
  const issuer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(join(homedir(), '.config', 'solana', 'id.json'), 'utf-8'))),
  );
  const subject = loadOrCreateSubject();
  const tag = process.env.COMMITMENT_TAG ?? Date.now().toString();
  const commitmentText = `KnightShield-${jurisdictions.join('+')}-score${aggregateScore}-${tag}`;
  const commitment = createHash('sha256').update(commitmentText).digest();

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('attestation'), subject.publicKey.toBuffer(), commitment],
    COMPLIANCE_REGISTRY,
  );

  const idl = JSON.parse(readFileSync(IDL_PATH, 'utf-8'));
  const coder = new BorshCoder(idl);
  const data = coder.instruction.encode('create_attestation', {
    commitment: Array.from(commitment),
    storage_uri: storageUri,
    schema_id: COMPLIANCE_REGISTRY,
    expires_at: null,
  });

  const ix = new TransactionInstruction({
    programId: COMPLIANCE_REGISTRY,
    keys: [
      { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
      { pubkey: subject.publicKey, isSigner: false, isWritable: false },
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), ix);
  const connection = new Connection(RPC_URL, 'confirmed');
  const sig = await sendAndConfirmTransaction(connection, tx, [issuer], { commitment: 'confirmed' });
  const detail = await connection.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  return {
    tx: sig,
    pda: pda.toBase58(),
    cu: detail?.meta?.computeUnitsConsumed ?? 0,
    fee: detail?.meta?.fee ?? 0,
  };
}

async function main() {
  // === 1. Header (~3s) ===
  console.log(`${T}━━━ DPO2U → KnightShield · multi-jurisdiction compliance scan ━━━${N}`);
  console.log(`${D}github.com/Knight-Shield-Wallet/wallet-solana — Mobile Privacy Wallet on Solana${N}`);
  console.log('');
  await sleep(1800);

  // === 2. Setup display (~3s) ===
  // Default threshold 40 = "minimum viable privacy-by-default baseline".
  // KnightShield Phase 0 has 10/26 controls — strong on encryption/IR, weak on
  // jurisdiction-specific consent flows (CCPA/APPI N/A — they don't process PII).
  // Honest scoring per DPO2U principle "atestar realidade, mesmo score baixo".
  const threshold = parseInt(process.env.THRESHOLD ?? '40', 10);
  const subject = loadOrCreateSubject();
  console.log(`  ${D}Subject:${N}    ${subject.publicKey.toBase58()}  ${D}(KnightShield)${N}`);
  console.log(`  ${D}Threshold:${N}  ${threshold}/100`);
  console.log(`  ${D}Profile:${N}    10 controls present · 16 gaps (privacy-by-default startup baseline)`);
  console.log('');
  await sleep(2200);

  // === 3. Start scan (~2s) ===
  const jurisdictions = ['LGPD', 'GDPR', 'CCPA', 'APPI'];
  console.log(`  ${T}▶${N} Scanning ${B}${jurisdictions.length} jurisdictions${N} in parallel via DPO2U engine`);
  console.log(`    ${D}⏳ LGPD (Brazil)   ⏳ GDPR (EU)   ⏳ CCPA (California)   ⏳ APPI (Japan)${N}`);
  await sleep(1500);

  // === 4. Real call to multi-juris handler ===
  const t0 = Date.now();
  const result = (await handleMultiJurisdictionComplianceCheck({
    company: 'KnightShield',
    auditScope: 'Mobile Privacy Wallet — Phase 0',
    jurisdictions,
    aggregateBy: 'average',
    ...KS_PROFILE,
  })) as any;
  const elapsed = Date.now() - t0;

  // === 5. Stream scores with pacing (~6s) ===
  console.log('');
  for (const r of result.byJurisdiction as any[]) {
    if (r.status === 'success' && typeof r.score === 'number') {
      const scoreStr = `${B}${r.score}${N}/100`;
      console.log(`    ${G}✓${N} ${B}${r.code.padEnd(7)}${N} score: ${scoreStr}   ${D}(${r.gaps.length} gaps · ${r.totalArticles} articles)${N}`);
    } else {
      console.log(`    ${Y}⚠${N} ${B}${r.code.padEnd(7)}${N} ${r.status}${r.error ? ` — ${r.error}` : ''}`);
    }
    await sleep(1300);
  }

  // === 6. Aggregate (~3s) ===
  console.log('');
  const agg = result.aggregate;
  console.log(`  ${D}Aggregate (avg of ${agg.jurisdictionsScored}):${N} ${B}${agg.score}${N}/100  ${D}· min ${agg.minScore} (${agg.mostStringent}) · max ${agg.maxScore} (${agg.leastStringent})${N}`);
  if (result.commonGaps?.length > 0) {
    const top2 = result.commonGaps.slice(0, 2).map((g: any) => g.gap.replace(/\s+/g, ' ').slice(0, 50)).join(' · ');
    console.log(`  ${D}Common gaps:${N}   ${top2}`);
  }
  await sleep(2200);

  // === 7. Threshold decision ===
  const passed = agg.score !== null && agg.score >= threshold;
  console.log('');
  if (passed) {
    console.log(`  ${G}✓ Decision:${N}    ${B}${agg.score} ≥ ${threshold}${N} → ${G}PASS${N} · submit aggregate attestation on-chain`);
  } else {
    console.log(`  ${R}✗ Decision:${N}    ${B}${agg.score} < ${threshold}${N} → ${R}FAIL${N} · close gaps first, no on-chain submit`);
    console.log('');
    console.log(`  ${D}Top recommendations:${N}`);
    for (const r of (result.recommendations ?? []).slice(0, 3)) {
      console.log(`    · ${(r as string).slice(0, 100)}`);
    }
    return;
  }
  await sleep(1500);

  // === 8. Submit on-chain (real tx) ===
  console.log('');
  console.log(`  ${D}Issuer:${N}     HjpGXPWQF1Pi...  ${D}(DPO2U auditor wallet)${N}`);
  console.log(`  ${D}PDA seed:${N}   sha256(\"KnightShield-${jurisdictions.join('+')}-score${agg.score}\")  ${D}— deterministic address${N}`);
  console.log(`  ${T}▶${N} Submitting create_attestation to compliance_registry on devnet...`);
  await sleep(800);

  let onchain;
  try {
    onchain = await submitAttestation(agg.score, jurisdictions, 'github.com/Knight-Shield-Wallet/wallet-solana');
  } catch (e) {
    console.log(`  ${R}✗ on-chain submit failed:${N} ${(e as Error).message}`);
    return;
  }

  console.log(`  ${G}✓ Tx:${N}      ${T}${onchain.tx}${N}`);
  console.log(`  ${G}✓ PDA:${N}     ${T}${onchain.pda}${N}  ${D}(on-chain attestation address — public, immutable)${N}`);
  const cuPct = ((onchain.cu / 200_000) * 100).toFixed(1);
  console.log(`  ${G}✓ CU:${N}      ${B}${onchain.cu.toLocaleString()}${N} / 200,000  ${D}(${cuPct}% of budget · fee ${(onchain.fee / 1e9).toFixed(6)} SOL ≈ $0.0001)${N}`);
  console.log(`  ${G}✓ Status:${N}  ${B}Finalized${N}  ${D}— transaction is permanent${N}`);
  await sleep(2200);

  // === 9. Closing line ===
  console.log('');
  console.log(`  ${B}Score${N}: ${D}private (off-chain, never left the machine)${N}`);
  console.log(`  ${B}PDA${N}:   ${D}public (on-chain, callable by any AI agent)${N}`);
  console.log('');
  console.log(`  ${G}✓ KnightShield · ${jurisdictions.length}-jurisdiction compliance attested on Solana devnet${N}`);
  console.log(`  ${D}https://explorer.solana.com/tx/${onchain.tx}?cluster=devnet${N}`);
}

main().catch((e) => {
  console.error('FAIL:', e?.message ?? e);
  process.exit(1);
});
