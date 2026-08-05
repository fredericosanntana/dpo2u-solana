# Riptide Simulation Report

## Run metadata

- **Adapter**: `/root/dpo2u-solana/solana-programs/.riptide/adapters/knect-tokenomics.toml`
- **Seed**: 539747423
- **Ticks**: 5
- **Agents**: 3 (1× Low-volume dispensary, 2× High-volume dispensary)
- **Scenario**: baseline
- **Output**: `/root/dpo2u-solana/solana-programs/.riptide/campaigns/campaign_acc2b43f451c/runs/run_000006_b80f34296420`

## Summary

| Metric | Value |
|--------|-------|
| split.buyback_bps_avg | 0 |
| split.buyback_bps_max | 0 |
| split.buyback_bps_min | 0 |
| split.fundo_bps_avg | 0 |
| split.fundo_bps_max | 0 |
| split.fundo_bps_min | 0 |
| split.kbr_bps_avg | 0 |
| split.kbr_bps_max | 0 |
| split.kbr_bps_min | 0 |
| split.staking_bps_avg | 0 |
| split.staking_bps_max | 0 |
| split.staking_bps_min | 0 |
| tokenomics.distributions_count_avg | 0 |
| tokenomics.distributions_count_max | 0 |
| tokenomics.distributions_count_min | 0 |
| tokenomics.total_distributed_avg | 0 |
| tokenomics.total_distributed_max | 0 |
| tokenomics.total_distributed_min | 0 |

**Agent lifecycle**: 3 active, 0 liquidated, 0 depleted

## Invariants

| Invariant | Firings | First tick |
|-----------|---------|------------|
| kbr_bps_canonical | 6 | T0 |
| buyback_bps_canonical | 6 | T0 |
| staking_bps_canonical | 6 | T0 |
| fundo_bps_canonical | 6 | T0 |

## Notable events

- T0: Engine — invariant_violation:kbr_bps_canonical → failed
- T0: Engine — invariant_violation:buyback_bps_canonical → failed
- T0: Engine — invariant_violation:staking_bps_canonical → failed
- T0: Engine — invariant_violation:fundo_bps_canonical → failed
- T1: Low-volume dispensary (agent-001) — distribute_fee → failed
- T1: High-volume dispensary (agent-002) — distribute_fee → failed
- T1: High-volume dispensary (agent-003) — distribute_fee → failed
- T1: Engine — invariant_violation:kbr_bps_canonical → failed
- T1: Engine — invariant_violation:buyback_bps_canonical → failed
- T1: Engine — invariant_violation:staking_bps_canonical → failed

## Simulation boundaries

- In-process LiteSVM backend (no external validator).
- Generic adapters expose only adapter-defined actions/observations; no default TVL/health semantics are inferred.
- Pool-wide TVL/utilization metrics are zeroed on the generic path until a protocol-specific aggregate is declared.
- Custom actions do not mutate engine cash/PnL by default; only on-chain account observations are authoritative.

## How to reproduce

```sh
exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000006_b80f34296420/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
```
