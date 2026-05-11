/**
 * Pure-helpers smoke tests pros 4 SDK clients Sprint D — sem network.
 * Valida PDA derivation, hash helpers, validações de input.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

import {
  DPO2UPopiaClient,
  POPIA_INFO_OFFICER_PROGRAM_ID,
} from './popia.js';
import {
  DPO2UCcpaClient,
  CCPA_OPTOUT_PROGRAM_ID,
  OPTOUT_KIND,
} from './ccpa.js';
import {
  DPO2UPipedaClient,
  PIPEDA_CONSENT_EXT_PROGRAM_ID,
  CONSENT_FORM,
} from './pipeda.js';
import {
  DPO2UPipaClient,
  PIPA_KOREA_ZK_ID_PROGRAM_ID,
  ATTRIBUTE_KIND,
} from './pipa.js';

const fakeSigner = Keypair.generate();
const fakeUser = new PublicKey('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU');

describe('DPO2UPopiaClient — pure helpers', () => {
  it('PROGRAM_ID matches declare_id!()', () => {
    expect(POPIA_INFO_OFFICER_PROGRAM_ID.toBase58()).toBe(
      'ASqTAMhhki7btr3WL768v2yUPKWuGfMEGWnP7TxALmmb',
    );
  });

  it('organizationIdHash is sha256 of input', () => {
    const h = DPO2UPopiaClient.organizationIdHash('CIPC-2026/123');
    expect(h.length).toBe(32);
    expect(Buffer.from(h).toString('hex')).toBe(
      createHash('sha256').update('CIPC-2026/123').digest('hex'),
    );
  });

  it('derivePda matches [b"popia_io", responsible_party, organization_id_hash]', () => {
    const client = new DPO2UPopiaClient({ cluster: 'localnet', signer: fakeSigner });
    const orgHash = DPO2UPopiaClient.organizationIdHash('CIPC-2026/123');
    const [pda] = client.derivePda(fakeSigner.publicKey, orgHash);
    const [canonical] = PublicKey.findProgramAddressSync(
      [Buffer.from('popia_io'), fakeSigner.publicKey.toBuffer(), Buffer.from(orgHash)],
      POPIA_INFO_OFFICER_PROGRAM_ID,
    );
    expect(pda.equals(canonical)).toBe(true);
  });
});

describe('DPO2UCcpaClient — pure helpers', () => {
  it('PROGRAM_ID matches declare_id!()', () => {
    expect(CCPA_OPTOUT_PROGRAM_ID.toBase58()).toBe(
      '5xVQq4KKsAST14RGvxP2aSNZhp681tRENM9TFwVfUpgk',
    );
  });

  it('OPTOUT_KIND values match Rust constants', () => {
    expect(OPTOUT_KIND.SALE).toBe(1);
    expect(OPTOUT_KIND.SHARE).toBe(2);
    expect(OPTOUT_KIND.SENSITIVE).toBe(3);
  });

  it('derivePda includes optout_kind discriminator byte', () => {
    const client = new DPO2UCcpaClient({ cluster: 'localnet', signer: fakeSigner });
    const consumerHash = DPO2UCcpaClient.consumerCommitmentHash('demo-consumer-1');
    const [pdaSale] = client.derivePda(fakeSigner.publicKey, consumerHash, OPTOUT_KIND.SALE);
    const [pdaShare] = client.derivePda(fakeSigner.publicKey, consumerHash, OPTOUT_KIND.SHARE);
    expect(pdaSale.equals(pdaShare)).toBe(false);
  });
});

describe('DPO2UPipedaClient — pure helpers', () => {
  it('PROGRAM_ID matches declare_id!()', () => {
    expect(PIPEDA_CONSENT_EXT_PROGRAM_ID.toBase58()).toBe(
      'G98d5DAEC17xWfojMCdsYrAdAXP8E7QC2g2KrrnLrMPT',
    );
  });

  it('CONSENT_FORM values match Rust constants', () => {
    expect(CONSENT_FORM.EXPRESS).toBe(1);
    expect(CONSENT_FORM.IMPLIED).toBe(2);
    expect(CONSENT_FORM.OPT_OUT).toBe(3);
  });

  it('purposeHashFromText is sha256-deterministic', () => {
    const a = DPO2UPipedaClient.purposeHashFromText('pipeda:p3:marketing');
    const b = DPO2UPipedaClient.purposeHashFromText('pipeda:p3:marketing');
    const c = DPO2UPipedaClient.purposeHashFromText('pipeda:p3:other');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('derivePda matches [b"pipeda_consent", subject, organization, purpose_hash]', () => {
    const client = new DPO2UPipedaClient({ cluster: 'localnet', signer: fakeSigner });
    const purposeHash = DPO2UPipedaClient.purposeHashFromText('pipeda:p3:marketing');
    const [pda] = client.derivePda(fakeUser, fakeSigner.publicKey, purposeHash);
    const [canonical] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('pipeda_consent'),
        fakeUser.toBuffer(),
        fakeSigner.publicKey.toBuffer(),
        Buffer.from(purposeHash),
      ],
      PIPEDA_CONSENT_EXT_PROGRAM_ID,
    );
    expect(pda.equals(canonical)).toBe(true);
  });
});

describe('DPO2UPipaClient — pure helpers', () => {
  it('PROGRAM_ID matches declare_id!()', () => {
    expect(PIPA_KOREA_ZK_ID_PROGRAM_ID.toBase58()).toBe(
      '41JLtHb54P8LMLeSccZM1XR6xr4gxcDbVrNRZVg2hPhR',
    );
  });

  it('ATTRIBUTE_KIND values match Rust constants', () => {
    expect(ATTRIBUTE_KIND.AGE_GATE_19).toBe(1);
    expect(ATTRIBUTE_KIND.KOREAN_RESIDENT).toBe(2);
    expect(ATTRIBUTE_KIND.KYC_VERIFIED).toBe(3);
    expect(ATTRIBUTE_KIND.DOMESTIC_REPRESENTATIVE).toBe(4);
  });

  it('derivePda includes attribute_kind discriminator byte', () => {
    const client = new DPO2UPipaClient({ cluster: 'localnet', signer: fakeSigner });
    const commitment = createHash('sha256').update('demo-secret').digest();
    const [pdaAge] = client.derivePda(fakeSigner.publicKey, commitment, ATTRIBUTE_KIND.AGE_GATE_19);
    const [pdaKyc] = client.derivePda(fakeSigner.publicKey, commitment, ATTRIBUTE_KIND.KYC_VERIFIED);
    expect(pdaAge.equals(pdaKyc)).toBe(false);
  });

  it('issueAttestation rejects mismatched subject_commitment vs publicInputs[32..64]', async () => {
    const client = new DPO2UPipaClient({ cluster: 'localnet', signer: fakeSigner });
    const commitment = new Uint8Array(32).fill(1);
    const wrongCommitment = new Uint8Array(32).fill(2);
    const proof = new Uint8Array(356);
    const publicInputs = new Uint8Array(96);
    publicInputs.set(wrongCommitment, 32);

    await expect(
      client.issueAttestation({
        subjectCommitment: commitment,
        attributeKind: ATTRIBUTE_KIND.AGE_GATE_19,
        attributeMetadataHash: new Uint8Array(32),
        proof,
        publicInputs,
      }),
    ).rejects.toThrow(/subjectCommitment does not match/);
  });

  it('issueAttestation rejects bad proof length', async () => {
    const client = new DPO2UPipaClient({ cluster: 'localnet', signer: fakeSigner });
    const commitment = new Uint8Array(32).fill(1);
    await expect(
      client.issueAttestation({
        subjectCommitment: commitment,
        attributeKind: ATTRIBUTE_KIND.AGE_GATE_19,
        attributeMetadataHash: new Uint8Array(32),
        proof: new Uint8Array(100), // wrong size
        publicInputs: new Uint8Array(96),
      }),
    ).rejects.toThrow(/356 bytes/);
  });
});
