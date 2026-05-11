# `dpo2u-sdk`

Rust client SDK for the [DPO2U](https://github.com/fredericosanntana/dpo2u-solana) on-chain compliance programs on Solana.

Provides canonical program IDs, PDA derivers, and `PublicValuesStruct` parsers for integrators building:
- **Anchor programs** that CPI into DPO2U (e.g., your RWA platform wants to verify consent before transfer)
- **Off-chain clients** that build DPO2U transactions directly

## Install

```toml
[dependencies]
dpo2u-sdk = "0.1"
solana-program = "2.0"
```

## Quick start

```rust
use dpo2u_sdk::{programs, pdas};
use solana_program::pubkey::Pubkey;

// 1. Canonical program IDs
let consent_mgr = programs::CONSENT_MANAGER;

// 2. Derive a consent PDA (DPDP India §6)
let user = Pubkey::from_str("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU").unwrap();
let fiduciary = issuer_pubkey;
let purpose_hash = pdas::purpose_hash(b"marketing_communications");
let (consent_pda, bump) = pdas::consent_pda(&user, &fiduciary, &purpose_hash);

// 3. Derive an attestation PDA (LGPD Art. 38 / GDPR Art. 35 DPIA)
let commitment = pdas::commitment_from_subject("did:br:cnpj:12.345.678/0001-99");
let (attestation_pda, bump) = pdas::attestation_pda(&user, &commitment);

// 4. Derive an ART vault PDA (MiCAR Art. 23/35/36/39)
let (vault, bump) = pdas::art_vault_pda(&issuer);

// 5. Derive an AI Verify attestation PDA (Singapore AI Verify 2.0)
let model_hash = [0x42u8; 32]; // sha256 of model weights
let (ai_att, bump) = pdas::aiverify_pda(&model_hash);
```

## Parsing SP1 `PublicValuesStruct`

The `compliance_registry` and `consent_manager` programs both CPI to the SP1 verifier and amarram the `subject_commitment` (bytes [32..64]) to the caller-supplied `commitment`/`purpose_hash`. This SDK exposes the ABI parser:

```rust
use dpo2u_sdk::public_values::parse;

let pv = parse(&public_inputs_96_bytes)?;
assert_eq!(pv.threshold, 70);
assert_eq!(pv.subject_commitment, expected_sha256);
assert!(pv.meets_threshold);
```

## Programs covered

| Program | Constant | Seeds | PDA deriver |
|---|---|---|---|
| compliance-registry | `programs::COMPLIANCE_REGISTRY` | `[b"attestation", subject, commitment]` | `pdas::attestation_pda` |
| consent-manager (DPDP IN) | `programs::CONSENT_MANAGER` | `[b"consent", user, fiduciary, purpose_hash]` | `pdas::consent_pda` |
| art-vault (MiCAR EU) | `programs::ART_VAULT` | `[b"art_vault", authority]` | `pdas::art_vault_pda` |
| aiverify-attestation (SG) | `programs::AIVERIFY_ATTESTATION` | `[b"aiverify", model_hash]` | `pdas::aiverify_pda` |
| agent-registry | `programs::AGENT_REGISTRY` | `[b"agent", authority, name]` | `pdas::agent_pda` |
| sp1-verifier | `programs::SP1_VERIFIER` | (CPI target, no PDA) | — |

## CPI integration example

To call DPO2U's `consent_manager::record_consent` from your own Anchor program:

```rust
use dpo2u_sdk::{programs, pdas, seeds};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(purpose_code: u16, purpose_hash: [u8; 32])]
pub struct YourProgramCtx<'info> {
    #[account(mut)]
    pub data_fiduciary: Signer<'info>,
    /// CHECK: any pubkey
    pub user: AccountInfo<'info>,
    /// CHECK: derived and validated by DPO2U
    #[account(mut, seeds = [seeds::CONSENT, user.key().as_ref(), data_fiduciary.key().as_ref(), &purpose_hash], bump, seeds::program = programs::CONSENT_MANAGER)]
    pub consent: AccountInfo<'info>,
    /// CHECK: address-constrained to dpo2u consent-manager
    #[account(address = programs::CONSENT_MANAGER)]
    pub consent_manager_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
}
```

## Features

- `default`: just solana-program types
- `anchor-derive`: (future) re-export Anchor-compatible `BorshSerialize`/`BorshDeserialize` derives

## License

MIT © DPO2U
