# Campaign Summary: knect-tokenomics-tese

## Scope

This report describes observations within this campaign only. It does not certify complete protocol safety.

- **Class:** lending.v1
- **Objective:** custom:split-correctness
- **Campaign ID:** campaign_acc2b43f451c
- **Campaign digest:** `acc2b43f451c8223514b440b4ae719b37294328c5045a63d9331ae19534a22c2`
- **Run budget:** 8
- **Runs requested here:** 8
- **Adapter:** `../adapters/knect-tokenomics.toml`

## Outcome

- **Completed runs:** 8
- **Setup errors:** 0
- **Invariant-failed runs:** 8
- **Invariant failure rate:** 100%
- **First failure ticks:** count 8, min 0, median 0, max 0

One or more invariant failures were observed within this campaign. Inspect the retained runs before changing the scenario, adapter, or protocol assumptions.

## Key Risk Signal

Retained case `first_failure` -> `run_000000_dda2c471d7fc` recorded invariant signal buyback_bps_canonical, fundo_bps_canonical, kbr_bps_canonical, staking_bps_canonical. Parameters: (none).

## Scenario Families

| Family | Planned | Completed | Failed | Setup errors | First failure tick | Bad debt max | Max utilization | Min TVL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 2 | 2 | 2 | 0 | 0 |  |  |  |
| happy_split | 6 | 6 | 6 | 0 | 0 |  |  |  |

## Parameters

| Parameter | Distribution | Unit | Samples | Observed range |
|---|---|---|---:|---|

## Lending Observations

Observed semantic/lending surfaces: `summary.total_bad_debt`, `timeseries.cumulative_bad_debt`, `timeseries.tvl`, `timeseries.utilization`, `summary.total_liquidations`, `run invariant fires`.

- **Bad debt max:** 
- **Total liquidations max:** 
- **Max utilization observed:** 
- **Minimum TVL observed:** 
- **Liquidation-safety failed runs:** 8

## Retained Evidence

| Label | Status | Run | Score | Risk signals | Reason |
|---|---|---|---:|---|---|
| first_failure | selected | `run_000000_dda2c471d7fc` | 0 | invariants=buyback_bps_canonical+fundo_bps_canonical+kbr_bps_canonical+staking_bps_canonical | earliest invariant failure tick observed within this campaign; tie: 8 runs shared the earliest failure tick; selected lowest run index 0 |
| median | selected | `run_000001_73622645c483` | 1445000 | invariants=buyback_bps_canonical+fundo_bps_canonical+kbr_bps_canonical+staking_bps_canonical | middle completed run by deterministic campaign risk score; tie: 6 runs shared the same deterministic risk score; selected lowest run index 1 |

## Artifact Index

- `campaign-summary.json`
- `campaign-summary.md`
- `parameters.csv`
- `runs.jsonl`
- `retention-manifest.json`
- `retained/<label>-<run-id>/case.json`
- `retained/<label>-<run-id>/rerun.sh`

## Recommendation

Review retained failure evidence, then decide whether to tighten invariants, broaden scenarios, or change protocol assumptions.

Claim boundary: All conclusions are observations within this campaign's declared inputs, scenario families, parameters, seed policy, and run budget. They are not proof of complete protocol safety.
