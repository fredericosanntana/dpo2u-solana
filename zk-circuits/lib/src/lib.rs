//! DPO2U Zero-Knowledge Compliance Validation for Autonomous Agent Repositories
//! Library crate for SP1.

use alloy_sol_types::sol;

sol! {
    /// Public values committed by the zkVM program. ABI-encoded so both
    /// Solana (via sp1-solana verifier) and EVM chains can decode natively.
    #[derive(Debug)]
    struct PublicValuesStruct {
        bytes32 commit_hash;
        bytes32 agent_pubkey;
        uint32 predicates_bitmap; // Bitmask of verified predicates
    }
}

/// Bit indices for compliance predicates (v0.1)
pub const GDPR_PII_DATA_FLOW: u32 = 1 << 0;
pub const GDPR_ART22_HUMAN_OVERSIGHT: u32 = 1 << 1;
pub const GDPR_ART25_PRIVACY_BY_DESIGN: u32 = 1 << 2;
pub const GDPR_PURPOSE_LIMITATION: u32 = 1 << 3;

pub const AI_ACT_RISK_TIER_CLASSIFICATION: u32 = 1 << 4;
pub const AI_ACT_SYSTEM_LOGGING: u32 = 1 << 5;
pub const AI_ACT_TRANSPARENCY_NOTICE: u32 = 1 << 6;
pub const AI_ACT_HUMAN_OVERSIGHT: u32 = 1 << 7;

pub const SUPPLY_NO_SECRETS: u32 = 1 << 8;
pub const SUPPLY_SBOM_PRESENT: u32 = 1 << 9;
pub const SUPPLY_DEP_INTEGRITY: u32 = 1 << 10;
pub const SUPPLY_PINNED_DEPS: u32 = 1 << 11;
pub const SUPPLY_LICENSE_COMPAT: u32 = 1 << 12;
