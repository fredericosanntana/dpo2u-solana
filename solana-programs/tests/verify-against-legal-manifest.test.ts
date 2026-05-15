/**
 * Sprint Replicate (2026-05-15) — static IDL checks for the 4 newly-added
 * `verify_against_legal_manifest` instructions across popia, ccpa, pipeda,
 * pipa-korea, and hiroshima programs.
 *
 * Bankrun-style runtime tests would require loading legal_source_manifest as
 * a fixture; for now these tests verify the instruction is well-formed at the
 * IDL layer and that the cross-program PDA derivation in the SDK matches the
 * seeds declared in Rust.
 */

import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';

import popiaIdl from '../target/idl/popia_info_officer_registry.json' assert { type: 'json' };
import ccpaIdl from '../target/idl/ccpa_optout_registry.json' assert { type: 'json' };
import pipedaIdl from '../target/idl/pipeda_consent_extension.json' assert { type: 'json' };
import pipaIdl from '../target/idl/pipa_korea_zk_identity.json' assert { type: 'json' };
import hiroshimaIdl from '../target/idl/hiroshima_ai_process_attestation.json' assert { type: 'json' };
import consentIdl from '../target/idl/consent_manager.json' assert { type: 'json' };
import artVaultIdl from '../target/idl/art_vault.json' assert { type: 'json' };
import complianceIdl from '../target/idl/compliance_registry.json' assert { type: 'json' };
import aiverifyIdl from '../target/idl/aiverify_attestation.json' assert { type: 'json' };
import agentRegistryIdl from '../target/idl/agent_registry.json' assert { type: 'json' };
import paymentGatewayIdl from '../target/idl/payment_gateway.json' assert { type: 'json' };
import feeDistributorIdl from '../target/idl/fee_distributor.json' assert { type: 'json' };
import agentWalletFactoryIdl from '../target/idl/agent_wallet_factory.json' assert { type: 'json' };

const LEGAL_SOURCE_MANIFEST_PROGRAM_ID = new PublicKey(
  'eb579ftMYPtFb7pSsB3ULJJHCbisYe7EJdhWnHUt8dK',
);

function hasInstruction(idl: any, name: string): boolean {
  return (idl.instructions ?? []).some((i: any) => i.name === name || i.name === toSnake(name));
}

function findInstruction(idl: any, name: string): any {
  return (idl.instructions ?? []).find(
    (i: any) => i.name === name || i.name === toSnake(name),
  );
}

function hasEvent(idl: any, name: string): boolean {
  return (idl.events ?? []).some((e: any) => e.name === name);
}

function hasError(idl: any, name: string): boolean {
  return (idl.errors ?? []).some((e: any) => e.name === name);
}

function toSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (m, i) => (i === 0 ? m.toLowerCase() : '_' + m.toLowerCase()));
}

describe('Sprint Replicate — verify_against_legal_manifest IDL coverage', () => {
  it.each([
    ['popia', popiaIdl],
    ['ccpa', ccpaIdl],
    ['pipeda', pipedaIdl],
    ['pipa-korea', pipaIdl],
    ['hiroshima', hiroshimaIdl],
    ['consent-manager', consentIdl],
    ['art-vault', artVaultIdl],
    ['compliance-registry', complianceIdl],
    ['aiverify-attestation', aiverifyIdl],
    ['agent-registry', agentRegistryIdl],
    ['payment-gateway', paymentGatewayIdl],
    ['fee-distributor', feeDistributorIdl],
    ['agent-wallet-factory', agentWalletFactoryIdl],
  ])('%s IDL exposes verify_against_legal_manifest instruction', (_name, idl: any) => {
    expect(hasInstruction(idl, 'verify_against_legal_manifest')).toBe(true);
  });

  it.each([
    ['popia', popiaIdl, 'AppointmentVerifiedAgainstManifest'],
    ['ccpa', ccpaIdl, 'OptoutVerifiedAgainstManifest'],
    ['pipeda', pipedaIdl, 'ConsentVerifiedAgainstManifest'],
    ['pipa-korea', pipaIdl, 'AttestationVerifiedAgainstManifest'],
    ['hiroshima', hiroshimaIdl, 'AttestationVerifiedAgainstManifest'],
  ])('%s IDL has %s event', (_name, idl: any, eventName) => {
    expect(hasEvent(idl, eventName)).toBe(true);
  });

  it.each([
    ['popia', popiaIdl],
    ['ccpa', ccpaIdl],
    ['pipeda', pipedaIdl],
    ['pipa-korea', pipaIdl],
  ])('%s IDL has ManifestJurisdictionMismatch error', (_name, idl: any) => {
    expect(hasError(idl, 'ManifestJurisdictionMismatch')).toBe(true);
  });

  it('hiroshima does NOT enforce jurisdiction prefix (cross-framework attestation)', () => {
    // Hiroshima accepts any legal_source_manifest — no ManifestJurisdictionMismatch error
    expect(hasError(hiroshimaIdl, 'ManifestJurisdictionMismatch')).toBe(false);
  });

  it.each([
    ['popia', popiaIdl, 'appointment'],
    ['ccpa', ccpaIdl, 'optout'],
    ['pipeda', pipedaIdl, 'consent'],
    ['pipa-korea', pipaIdl, 'attestation'],
    ['hiroshima', hiroshimaIdl, 'attestation'],
  ])('%s verify ix has 2 accounts: %s record + legal_manifest', (_name, idl: any, recordName) => {
    const ix = findInstruction(idl, 'verify_against_legal_manifest');
    expect(ix).toBeDefined();
    const accounts = ix.accounts ?? [];
    expect(accounts).toHaveLength(2);
    const names = accounts.map((a: any) => a.name);
    expect(names).toContain(recordName);
    expect(names).toContain('legal_manifest');
    // Both accounts are read-only (no writable/signer flags expected)
    for (const a of accounts) {
      expect(a.writable ?? a.isMut ?? false).toBe(false);
      expect(a.signer ?? a.isSigner ?? false).toBe(false);
    }
  });
});

describe('Sprint Replicate — legal_source_manifest PDA derivation', () => {
  function deriveLegalManifestPda(juris: string): [PublicKey, number] {
    const buf = Buffer.alloc(16);
    Buffer.from(juris, 'ascii').copy(buf);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('legal_manifest'), buf],
      LEGAL_SOURCE_MANIFEST_PROGRAM_ID,
    );
  }

  it('LGPD PDA matches the well-known 2026-05-14 init result', () => {
    const [pda] = deriveLegalManifestPda('LGPD');
    expect(pda.toBase58()).toBe('6tFrRNsZVSRPsrKJEEZGfA8NNuRoeTJtoDeZoJDzsUdE');
  });

  it('POPIA PDA matches the well-known 2026-05-14 init result', () => {
    const [pda] = deriveLegalManifestPda('POPIA');
    expect(pda.toBase58()).toBe('554hEMFgY13pAkzL3QrUrdVHjbXekG9KUHtgUq8qEgC2');
  });

  it('CCPA PDA matches the well-known 2026-05-15 Bridge C init result', () => {
    const [pda] = deriveLegalManifestPda('CCPA');
    expect(pda.toBase58()).toBe('2Sm3JtHw6K1jhzYrR22pX21xPZyUiJ5aXrdmHRexeFme');
  });

  it('different jurisdictions yield different PDAs', () => {
    const [a] = deriveLegalManifestPda('LGPD');
    const [b] = deriveLegalManifestPda('GDPR');
    expect(a.equals(b)).toBe(false);
  });
});
