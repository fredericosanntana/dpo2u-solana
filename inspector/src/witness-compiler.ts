import { RepositoryEvidence } from './static-analyzer';

// Bit indices matching SP1 program `lib.rs`
const GDPR_PII_DATA_FLOW = 1 << 0;
const GDPR_ART22_HUMAN_OVERSIGHT = 1 << 1;
const GDPR_ART25_PRIVACY_BY_DESIGN = 1 << 2;
const GDPR_PURPOSE_LIMITATION = 1 << 3;

const AI_ACT_RISK_TIER_CLASSIFICATION = 1 << 4;
const AI_ACT_SYSTEM_LOGGING = 1 << 5;
const AI_ACT_TRANSPARENCY_NOTICE = 1 << 6;
const AI_ACT_HUMAN_OVERSIGHT = 1 << 7;

const SUPPLY_NO_SECRETS = 1 << 8;
const SUPPLY_SBOM_PRESENT = 1 << 9;
const SUPPLY_DEP_INTEGRITY = 1 << 10;
const SUPPLY_PINNED_DEPS = 1 << 11;
const SUPPLY_LICENSE_COMPAT = 1 << 12;

export interface CanonicalWitness {
  commitHash: string; // Hex string 32 bytes
  agentPubkey: string; // Hex string 32 bytes
  predicatesBitmap: number; // u32 bitmask
}

/**
 * Compiles RepositoryEvidence into the Canonical Witness structure 
 * required by the SP1 zkVM program.
 */
export class WitnessCompiler {
  
  public compile(
    evidence: RepositoryEvidence, 
    commitHash: string, 
    agentPubkey: string
  ): CanonicalWitness {
    
    let bitmap = 0;

    // Apply evidence to bitmask
    if (evidence.hasSbom) {
      bitmap |= SUPPLY_SBOM_PRESENT;
    }
    
    if (!evidence.hasHardcodedSecrets) {
      bitmap |= SUPPLY_NO_SECRETS;
    }

    if (evidence.hasPrivacyByDesign) {
      bitmap |= GDPR_ART25_PRIVACY_BY_DESIGN;
    }

    if (evidence.hasHumanOversight) {
      bitmap |= GDPR_ART22_HUMAN_OVERSIGHT;
      bitmap |= AI_ACT_HUMAN_OVERSIGHT;
    }

    // Mocking the remaining predicates as "passed" for the prototype
    bitmap |= GDPR_PII_DATA_FLOW;
    bitmap |= GDPR_PURPOSE_LIMITATION;
    bitmap |= AI_ACT_RISK_TIER_CLASSIFICATION;
    bitmap |= AI_ACT_SYSTEM_LOGGING;
    bitmap |= AI_ACT_TRANSPARENCY_NOTICE;
    bitmap |= SUPPLY_DEP_INTEGRITY;
    bitmap |= SUPPLY_PINNED_DEPS;
    bitmap |= SUPPLY_LICENSE_COMPAT;

    return {
      commitHash,
      agentPubkey,
      predicatesBitmap: bitmap
    };
  }
}
