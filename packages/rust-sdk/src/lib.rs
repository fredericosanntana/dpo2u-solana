//! # dpo2u-sdk
//!
//! Rust client SDK for the DPO2U on-chain compliance programs on Solana.
//! Provides canonical program IDs, PDA derivers, and purpose-hash helpers
//! for integrators building Anchor programs that CPI into DPO2U or off-chain
//! clients that build DPO2U transactions directly.
//!
//! ## Programs covered
//!
//! | Program | Program ID (devnet) | Purpose |
//! |---|---|---|
//! | `compliance_registry` | `7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK` | DPIA/audit attestation with ZK binding |
//! | `sp1_verifier` | `5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW` | Groth16 pairing CPI target |
//! | `consent_manager` | `D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB` | DPDP India consent events |
//! | `art_vault` | `C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna` | MiCAR ART safeguards (PoR + liquidity + buffer + velocity) |
//! | `aiverify_attestation` | `DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm` | AI Verify Singapore attestation |
//! | `agent_registry` | `5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7` | DPO/auditor DIDs with capability bits |
//! | `payment_gateway` | `4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q` | MCP invoicing (SPL Token CPI) |
//! | `fee_distributor` | `88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x` | Atomic 70/20/10 split |
//! | `agent_wallet_factory` | `AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in` | Deterministic PDA wallets |
//!
//! ## Quick start — derive a consent PDA
//!
//! ```
//! use dpo2u_sdk::{programs, pdas};
//! use solana_program::pubkey::Pubkey;
//! use std::str::FromStr;
//!
//! let user = Pubkey::from_str("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU").unwrap();
//! let fiduciary = Pubkey::from_str("5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7").unwrap();
//! let purpose_hash = pdas::purpose_hash(b"marketing_communications");
//!
//! let (consent_pda, _bump) = pdas::consent_pda(&user, &fiduciary, &purpose_hash);
//! assert_ne!(consent_pda, Pubkey::default());
//! ```

#![cfg_attr(docsrs, feature(doc_cfg))]

#[cfg(feature = "mcp-client")]
#[cfg_attr(docsrs, doc(cfg(feature = "mcp-client")))]
pub mod mcp;

pub mod programs {
    //! Canonical program IDs (devnet === mainnet addresses — upgrades keep IDs).
    use solana_program::{pubkey, pubkey::Pubkey};

    pub const COMPLIANCE_REGISTRY: Pubkey = pubkey!("7q19zbMMFCPSDhJhh3cfUVJstin6r1Q4dgmeDAuQERyK");
    pub const SP1_VERIFIER: Pubkey = pubkey!("5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW");
    pub const CONSENT_MANAGER: Pubkey = pubkey!("D5mLHU4uUQAkoMvtviAzBe1ugpdxfdqQ7VuGoKLaTjfB");
    pub const ART_VAULT: Pubkey = pubkey!("C7sGZFeWPxEkaGHACwqdzCcy4QkacqPLYEwEarVpidna");
    pub const AIVERIFY_ATTESTATION: Pubkey =
        pubkey!("DSCVxsdJd5wVJan5WqQfpKkqxazWJR7D7cjd3r65s6cm");
    pub const AGENT_REGISTRY: Pubkey = pubkey!("5qeuUAaJi9kTzsfmiphQ89PNrpqy7xW7sCvhBZQ6mya7");
    pub const PAYMENT_GATEWAY: Pubkey = pubkey!("4Qj6GziMjUfh4TszuSnasnEqnASqQBS6SHw6YAu9U23Q");
    pub const FEE_DISTRIBUTOR: Pubkey = pubkey!("88eKEEMMnugv8AFWRvqa4i7LEiL7tM9bEuPTVkRbD76x");
    pub const AGENT_WALLET_FACTORY: Pubkey =
        pubkey!("AjRqmxyieQieov2qsNefdYpa6HbPhzciED7s5TfZi1in");
}

pub mod pdas {
    //! PDA derivers — all match the `#[account(seeds = ...)]` declarations in
    //! the on-chain programs. Use these exact functions client-side to avoid
    //! seed drift.
    use super::programs;
    use sha2::{Digest, Sha256};
    use solana_program::pubkey::Pubkey;

    /// `[b"attestation", subject, commitment]` under `compliance_registry`.
    pub fn attestation_pda(subject: &Pubkey, commitment: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"attestation", subject.as_ref(), commitment],
            &programs::COMPLIANCE_REGISTRY,
        )
    }

    /// `[b"consent", user, data_fiduciary, purpose_hash]` under `consent_manager`.
    pub fn consent_pda(
        user: &Pubkey,
        data_fiduciary: &Pubkey,
        purpose_hash: &[u8; 32],
    ) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[
                b"consent",
                user.as_ref(),
                data_fiduciary.as_ref(),
                purpose_hash,
            ],
            &programs::CONSENT_MANAGER,
        )
    }

    /// `[b"art_vault", authority]` under `art_vault`.
    pub fn art_vault_pda(authority: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"art_vault", authority.as_ref()], &programs::ART_VAULT)
    }

    /// `[b"aiverify", model_hash]` under `aiverify_attestation`.
    pub fn aiverify_pda(model_hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"aiverify", model_hash],
            &programs::AIVERIFY_ATTESTATION,
        )
    }

    /// `[b"agent", authority, name_bytes]` under `agent_registry`.
    pub fn agent_pda(authority: &Pubkey, name: &str) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[b"agent", authority.as_ref(), name.as_bytes()],
            &programs::AGENT_REGISTRY,
        )
    }

    /// SHA-256 hash of a purpose's human-readable text. Clients that want the
    /// same on-chain PDA MUST call this function with the exact same UTF-8
    /// bytes.
    pub fn purpose_hash(purpose_text_bytes: &[u8]) -> [u8; 32] {
        let mut h = Sha256::new();
        h.update(purpose_text_bytes);
        let out = h.finalize();
        let mut arr = [0u8; 32];
        arr.copy_from_slice(&out);
        arr
    }

    /// Commitment derivation compatible with the `compliance-registry` SP1
    /// flow: `sha256(subject_did_text)`. Used for the `create_attestation`
    /// legacy path and for local verification of the verified path's
    /// `subject_commitment` in the proof public values.
    pub fn commitment_from_subject(subject_text: &str) -> [u8; 32] {
        purpose_hash(subject_text.as_bytes())
    }
}

pub mod seeds {
    //! Raw seed constants (for callers building transactions that need to
    //! mirror the Rust program's `#[account(seeds = ...)]` exactly).

    pub const ATTESTATION: &[u8] = b"attestation";
    pub const CONSENT: &[u8] = b"consent";
    pub const ART_VAULT: &[u8] = b"art_vault";
    pub const AIVERIFY: &[u8] = b"aiverify";
    pub const AGENT: &[u8] = b"agent";
}

pub mod public_values {
    //! Helpers for parsing the 96-byte `PublicValuesStruct` ABI layout used
    //! by both `compliance-registry::create_verified_attestation` and
    //! `consent-manager::record_verified_consent`.
    //!
    //! Layout:
    //!   - bytes `[0..32]`: `uint32 threshold` (last 4 bytes big-endian)
    //!   - bytes `[32..64]`: `bytes32 subject_commitment` / `purpose_hash`
    //!   - bytes `[64..96]`: `bool meets_threshold` (last byte)

    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum PublicValuesError {
        #[error("public_inputs must be exactly 96 bytes, got {0}")]
        WrongLength(usize),
    }

    pub struct PublicValues {
        pub threshold: u32,
        pub subject_commitment: [u8; 32],
        pub meets_threshold: bool,
    }

    pub fn parse(public_inputs: &[u8]) -> Result<PublicValues, PublicValuesError> {
        if public_inputs.len() != 96 {
            return Err(PublicValuesError::WrongLength(public_inputs.len()));
        }
        let mut threshold_bytes = [0u8; 4];
        threshold_bytes.copy_from_slice(&public_inputs[28..32]);
        let threshold = u32::from_be_bytes(threshold_bytes);

        let mut subject_commitment = [0u8; 32];
        subject_commitment.copy_from_slice(&public_inputs[32..64]);

        let meets_threshold = public_inputs[95] != 0;

        Ok(PublicValues {
            threshold,
            subject_commitment,
            meets_threshold,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::pubkey::Pubkey;

    #[test]
    fn consent_pda_is_deterministic() {
        let user = Pubkey::new_unique();
        let fid = Pubkey::new_unique();
        let h = pdas::purpose_hash(b"marketing_communications");
        let (a, _) = pdas::consent_pda(&user, &fid, &h);
        let (b, _) = pdas::consent_pda(&user, &fid, &h);
        assert_eq!(a, b);
    }

    #[test]
    fn consent_pda_differs_across_purposes() {
        let user = Pubkey::new_unique();
        let fid = Pubkey::new_unique();
        let h1 = pdas::purpose_hash(b"marketing");
        let h2 = pdas::purpose_hash(b"analytics");
        let (a, _) = pdas::consent_pda(&user, &fid, &h1);
        let (b, _) = pdas::consent_pda(&user, &fid, &h2);
        assert_ne!(a, b);
    }

    #[test]
    fn purpose_hash_is_sha256() {
        let h = pdas::purpose_hash(b"");
        // sha256("") hex
        assert_eq!(
            hex_lower(&h),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn aiverify_pda_has_global_uniqueness_per_model() {
        let h = [0u8; 32];
        let (pda1, _) = pdas::aiverify_pda(&h);
        let (pda2, _) = pdas::aiverify_pda(&h);
        assert_eq!(pda1, pda2);
    }

    #[test]
    fn parse_public_values_rejects_wrong_length() {
        assert!(public_values::parse(&[0u8; 95]).is_err());
        assert!(public_values::parse(&[0u8; 97]).is_err());
    }

    #[test]
    fn parse_public_values_extracts_fields() {
        let mut pi = [0u8; 96];
        // threshold = 70 (u32 big-endian in [28..32])
        pi[28..32].copy_from_slice(&70u32.to_be_bytes());
        // subject_commitment = 0xaa * 32
        for b in pi.iter_mut().take(64).skip(32) {
            *b = 0xaa;
        }
        // meets_threshold = true (last byte)
        pi[95] = 1;

        let pv = public_values::parse(&pi).unwrap();
        assert_eq!(pv.threshold, 70);
        assert_eq!(pv.subject_commitment, [0xaau8; 32]);
        assert!(pv.meets_threshold);
    }

    fn hex_lower(b: &[u8]) -> String {
        let mut s = String::with_capacity(b.len() * 2);
        for byte in b {
            s.push_str(&format!("{:02x}", byte));
        }
        s
    }
}

// Re-export for convenience so callers don't need to go through modules.
pub use programs::*;
