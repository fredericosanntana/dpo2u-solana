# LiteSVM Tests — DPO2U Solana Programs

Tests here use [LiteSVM](https://litesvm.github.io/litesvm/) — an in-process
SVM that boots in milliseconds (no `solana-test-validator` needed) so the
whole suite runs in under 2 seconds.

## Sprint 3 scope

These are **scaffolds** that exercise:

1. Program ID derivation sanity (each program's `declare_id!` matches the
   `Anchor.toml` registry).
2. PDA seed derivation matches the documented seeds (off-chain clients must
   derive identical PDAs).
3. Compiled `.so` exists (sets the expectation that Sprint 4 produces the
   actual artifacts).

**Not tested here** (Sprint 4 scope): CPI invocations, cross-program flows,
runtime errors, cost analysis. Those require `anchor build` + loaded programs.

## Running

```bash
pnpm install          # installs @coral-xyz/anchor, litesvm, vitest
pnpm test             # single-pass
pnpm test:watch       # watch mode during dev
```

If `litesvm` Node binding is missing on your platform, fall back to:

```bash
anchor build          # produces target/deploy/*.so
anchor test           # spins up solana-test-validator
```

## Troubleshooting

- `Cannot find module 'litesvm'`: `pnpm add litesvm@latest`
- `anchor: command not found`: install via `avm` (Anchor Version Manager)
- PDA mismatch: check the `deriveXPda()` helpers in each `.test.ts` match
  the `#[account(seeds = [...])]` attribute in the program.
