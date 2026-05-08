# DPO2U Governance — Squads v4 Multisig Architecture

> **Status**: Draft (Sprint Composed Stack — Fase 1, 2026-05-08).
> **Cluster**: devnet (mainnet migration after audit + 2-week devnet validation).
> **Plan**: `/root/.claude/plans/recebemos-o-seguinte-feedback-woolly-seal.md`

## Why Squads v4

Single-signer authorities for program upgrades and protocol assets are an
existential risk: compromising one keypair allows an attacker to rewrite
`compliance-registry`, mint unbacked ART tokens, or drain the treasury.

Squads v4 (mainnet program ID `SQDS4ej4dZndYAQiRJzRZqDPoAHTQ8R7BbfwL3GnxCk`)
provides:

- **M-of-N threshold approval** — no single key can act alone
- **Time-locks** — mandatory delay between approval and execution
- **Composability** — vault PDAs are plain Solana Pubkeys, so the 14 DPO2U
  programs need zero code change to be governed by a multisig
- **Battle-tested** — Squads v4 is live on mainnet managing treasuries for
  Jupiter, Drift, and other major Solana protocols

## Multisig Layout (5 separate multisigs)

Squads v4 treats `threshold` and `time_lock` as per-multisig properties (not
per-vault). To apply different policies per role, we run **5 independent
multisigs**, not one multisig with 5 vaults.

| # | Role                  | Threshold | Time-lock | Use                                                                    |
| - | --------------------- | --------- | --------- | ---------------------------------------------------------------------- |
| 0 | Governance            | 3-of-5    | 24h       | Upgrade authority of all 14 DPO2U programs                             |
| 1 | Treasury              | 2-of-3    | none      | Receives `payment-gateway` fees; pays infra (Helius, RPC, Photon)      |
| 2 | MiCAR Reserve         | 2-of-3    | 48h       | Authority of `art-vault` reserve account; conservative per MiCAR Art. 36 |
| 3 | Compliance Authority  | 2-of-3    | 24h       | Authority stamped on compressed attestation leaves; revoke flow         |
| 4 | Emergency             | 2-of-3    | none      | Trips `art-vault` circuit breaker (MiCAR Art. 23 halt)                  |

Rationales:
- **24h time-lock on Governance** lets external observers (regulators,
  community) detect and react to a malicious upgrade proposal before it
  executes.
- **48h on MiCAR Reserve** is intentionally longer — reserve management is
  the highest-value action and aligns with EU regulatory expectations of
  "reasonable cooling-off".
- **No time-lock on Emergency** — if the circuit breaker is being tripped,
  reaction time matters more than oversight (the action is *halt*, not
  *unhalt*; it is reversible by Governance later).

## Members and Key Custody

### Devnet (current sprint)

5 hot keys generated for testing. Members file at `scripts/members.json`
(committed to git for reproducibility — devnet only, no real value).

### Mainnet (pre-launch)

- **5 distinct natural persons or entities**, none controlling more than
  one key (no key sharing).
- Each member's signing key on a **hardware wallet** (Ledger Nano S+ minimum).
- Hardware wallets stored in **3 different jurisdictions** (BR, EU, APAC)
  to align with the multi-jurisdiction compliance narrative and reduce
  geopolitical concentration risk.
- Backup seed phrases held by the same member in a separate physical safe;
  no shared escrow.
- **Member rotation** is itself a Squads proposal — adding/removing members
  requires the same 3-of-5 approval as a program upgrade.

### Key Loss Recovery

If 3 of 5 keys are lost simultaneously, the multisigs become permanently
inoperative — programs become **read-only forever** (Governance can't
upgrade) and the MiCAR reserve is locked. Mitigations:

1. **Each member has a recovery seed** stored separately from their
   active hardware wallet. Loss requires losing both.
2. **Annual key audit** verifies all 5 members can still sign. Run before
   any major release.
3. **Pre-mainnet rehearsal**: rotate one member end-to-end on devnet to
   exercise the proposal/approval flow under failure.

## Operational Workflows

### Submitting an upgrade

```
  Member A: squads-cli proposal create --multisig <governance_pda> \
              --tx upgrade-program-bytecode-of-compliance-registry.json
  Members B, C, ...: squads-cli proposal approve --proposal <pid>
  After 24h time-lock + 3 approvals reached:
  Any member: squads-cli vault execute --proposal <pid>
```

### Revoking a compressed attestation (Compliance Authority)

```
  Member A: squads-cli proposal create --multisig <compliance_pda> \
              --tx revoke-leaf-{leaf_hash}.json
              # tx body: CPI compliance_registry_pinocchio::revoke_compressed
  Member B: squads-cli proposal approve
  After 24h time-lock + 2 approvals: execute → leaf nullified
```

### Tripping the circuit breaker (Emergency)

```
  Member A: squads-cli proposal create --multisig <emergency_pda> \
              --tx trip-circuit-breaker.json
  Member B: squads-cli proposal approve
  Immediately (no time-lock): execute → art-vault halted
```

To unhalt requires a Governance proposal (24h time-lock).

## Migration Timeline

| Step                                          | Cluster   | Reversible?          |
| --------------------------------------------- | --------- | -------------------- |
| 1. `setup-squads-multisig.ts` creates 5 PDAs  | devnet    | Trivially (re-run)   |
| 2. `transfer-program-authorities.ts`          | devnet    | Via Squads proposal  |
| 3. 2-week observation: rehearsal upgrades     | devnet    | —                    |
| 4. OtterSec/Neodyme audit of Pinocchio prog   | —         | —                    |
| 5. Repeat steps 1-2 on mainnet                | mainnet   | Via Squads proposal  |
| 6. Migrate `art-vault.authority` field        | mainnet   | Via Squads (Reserve) |

Step 6 requires adding a `transfer_authority` instruction to the
`art-vault` program (currently absent) — bundled with Fase 2 of the
Composed Stack sprint.

## Audit Trail

- All multisig PDAs, members, thresholds, and creation tx signatures saved
  in `scripts/squads-config.json` (regenerated each `setup-squads-multisig.ts`
  run).
- Every proposal, approval, and execution is on-chain — fetchable via
  Squads explorer or `squads-cli proposal list`.
- DPO2U landing site `/coverage` displays the **GovernanceBadge** linking
  to each multisig's Solana Explorer URL.

## Threats Considered

- **Single-key compromise**: blocked. 1 key cannot reach threshold.
- **Insider front-running upgrade**: 24h time-lock allows community
  detection; an external observer running `squads-cli proposal list` sees
  the proposal as it is created.
- **Member coordination attack** (3 colluding): mitigated by jurisdiction
  spread; collusion across 3 jurisdictions is harder than 3 colocated
  insiders. **Not eliminated** — this is the residual risk of any
  M-of-N multisig.
- **Squads v4 program bug**: Squads itself is a SoT — a bug in Squads v4
  can compromise governance. Mitigated by Squads' own audit history and
  mainnet track record. Residual risk; revisit if Squads v5 ships during
  mainnet operations.

## References

- Squads v4 program: `SQDS4ej4dZndYAQiRJzRZqDPoAHTQ8R7BbfwL3GnxCk`
- Squads docs: https://docs.squads.so/main
- DPO2U Composed Stack plan:
  `/root/.claude/plans/recebemos-o-seguinte-feedback-woolly-seal.md`
- Threat model and out-of-scope: see plan §"Risks consolidados"

---

## Light Protocol — registration prerequisite (Composed Stack Fase 3.b)

**Status**: bloqueador identificado pré-mainnet — não bloqueia Pinocchio
build/tests, mas bloqueia primeira CPI bem-sucedida ao Light System Program.

Para o `compliance-registry-pinocchio` fazer CPI ao Light System Program
(`SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7`) via `InvokeCpi`
discriminator `[49, 212, 191, 129, 39, 194, 43, 196]`, é necessário que
o programa esteja **registered** no Light account-compression program
(`compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq`).

### Como verificar se já está registrado

```bash
# Derive registered_program_pda — seed = invoking_program.toBytes()
solana account <REGISTERED_PROGRAM_PDA> --url devnet
# Should return account owned by compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq
```

PDA derivation em TS:
```typescript
import { deriveRegisteredProgramPda } from '@dpo2u/client-sdk';
const pda = deriveRegisteredProgramPda(COMPLIANCE_PINOCCHIO_PROGRAM_ID);
```

### Como registrar (devnet)

Pode ser uma das opções dependendo da política Light governance no
momento:

1. **Self-registration** se Light expor instrução pública pra registrar
   (verificar `programs/account-compression/src/instructions/register_program.rs`
   upstream — autoridade pode ser group_authority_pda controlado por Light
   governance, não público).

2. **Solicitar a Light Foundation** via Discord/GitHub:
   https://github.com/Lightprotocol/light-protocol/issues
   Mencionar program ID + cluster (devnet) + use case (compliance audit trail).

3. **Aguardar Anchor-side `register_program` Anchor instruction** se exposto
   no dpo2u-solana git submodule do Light (não é o caso atual).

### Implicação para roadmap

Antes de qualquer mainnet deploy, esta etapa precisa estar fechada. Pra
demo Colosseum em devnet, o registration deve ser solicitado **após**
deploy do compliance-registry-pinocchio atualizado (177KB .so com selectors
0x03/0x04 + light_proto raw CPI).

Sem registration, qualquer tx que chame `submit_verified_compressed`
ou `revoke_compressed` falha com erro do Light System Program (provavelmente
"InvalidProgramAuthority" ou similar) na hora do CPI.
