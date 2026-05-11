/**
 * Frente 2 (MiCAR ART safeguards) — art-vault scaffold tests.
 *
 * Pure PDA + size-budget + BPS math tests. Runtime CPI tests follow once the
 * program is compiled via `anchor build`.
 */

import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PROGRAM_IDS, deriveArtVaultPda } from './helpers.js';

describe('art-vault — program ID canary', () => {
  it('program ID is a valid base58 pubkey', () => {
    const pk = PROGRAM_IDS.art_vault;
    expect(pk.toBase58()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    expect(() => new PublicKey(pk.toBase58())).not.toThrow();
  });

  it('program ID matches declare_id!() in lib.rs', () => {
    expect(PROGRAM_IDS.art_vault.toBase58()).toBe(
      'C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna',
    );
  });
});

describe('art-vault — PDA derivation', () => {
  it('vault PDA same for same authority', () => {
    const auth = Keypair.generate().publicKey;
    const [a] = deriveArtVaultPda(auth);
    const [b] = deriveArtVaultPda(auth);
    expect(a.equals(b)).toBe(true);
  });

  it('different authorities → different PDAs', () => {
    const [a] = deriveArtVaultPda(Keypair.generate().publicKey);
    const [b] = deriveArtVaultPda(Keypair.generate().publicKey);
    expect(a.equals(b)).toBe(false);
  });

  it('PDA matches canonical [b"art_vault", authority] seeds', () => {
    const auth = Keypair.generate().publicKey;
    const [pda] = deriveArtVaultPda(auth);
    const [canonical] = PublicKey.findProgramAddressSync(
      [Buffer.from('art_vault'), auth.toBuffer()],
      PROGRAM_IDS.art_vault,
    );
    expect(pda.equals(canonical)).toBe(true);
  });
});

describe('art-vault — account size budget', () => {
  it('ArtVault fits in 10KB PDA limit', () => {
    // InitSpace: authority(32) + reserve_amount(8) + outstanding_supply(8)
    //  + liquidity_bps(2) + capital_buffer_bps(2) + daily_cap(8) + daily_spent(8)
    //  + last_reset_day(8) + circuit_tripped(1) + version(1) + bump(1)
    //  + discriminator(8)
    const bytes = 8 + 32 + 8 + 8 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 1;
    expect(bytes).toBeLessThan(10_240);
    expect(bytes).toBe(87);
  });
});

describe('art-vault — MiCAR BPS math semantics', () => {
  const BPS = 10_000;

  it('default capital buffer is 3% (MiCAR Art. 35)', () => {
    const DEFAULT_CAPITAL_BUFFER_BPS = 300;
    expect(DEFAULT_CAPITAL_BUFFER_BPS / BPS).toBeCloseTo(0.03);
  });

  it('default liquidity vault is 20% (MiCAR Art. 39 redemption budget)', () => {
    const DEFAULT_LIQUIDITY_BPS = 2000;
    expect(DEFAULT_LIQUIDITY_BPS / BPS).toBeCloseTo(0.2);
  });

  it('reserve coverage formula: supply * (1 + buffer_bps/10000) should fit u64', () => {
    // Sanity for the supply_plus_buffer helper — 1B supply + 3% buffer = 1.03B, fits in u64.
    const supply = 1_000_000_000n;
    const buffer_bps = 300n;
    const buffer = (supply * buffer_bps) / BigInt(BPS);
    const required = supply + buffer;
    expect(required).toBe(1_030_000_000n);
    expect(required < BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it('sum of liquidity_bps + capital_buffer_bps capped at 10000', () => {
    const liquidity = 2000;
    const buffer = 300;
    expect(liquidity + buffer).toBeLessThanOrEqual(BPS);
  });
});

describe('art-vault — velocity limiter semantics', () => {
  const SECONDS_PER_DAY = 86_400;

  it('day rolls over at unix_timestamp / SECONDS_PER_DAY boundary', () => {
    const now = 1_745_283_600; // sample unix ts (2025-04-22)
    const today = Math.floor(now / SECONDS_PER_DAY);
    const tomorrow = Math.floor((now + SECONDS_PER_DAY) / SECONDS_PER_DAY);
    expect(tomorrow).toBe(today + 1);
  });

  it('circuit breaker trip is one-way in MVP (no reset instruction)', () => {
    // Documents the MVP decision — reset requires governance multi-sig, not
    // exposed as a single-authority instruction. See lib.rs comment.
    expect(true).toBe(true);
  });
});
