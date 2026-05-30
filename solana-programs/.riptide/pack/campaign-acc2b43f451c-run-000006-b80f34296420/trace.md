# Technical trace — `baseline`

> Simulation evidence — not audit signoff.

- **Adapter:** `.riptide/adapters/knect-tokenomics.toml`
- **Kind:** `simulation-run`
- **Total ticks:** 5
- **Event count:** 39
- **Canonical hash:** `219e7975137c5d53ebfd2a734384c5a4a728c3c6829acd01c6dfe5b3ef72b101`

## Events of interest

Scope: invariant firings, bridge firings, scheduled actions, oracle writes.

| Tick | Component | Event | Details |
|-----:|-----------|-------|---------|
| 0 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 0 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 0 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 0 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 1 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 1 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 1 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 1 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 2 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 2 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 2 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 2 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 3 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 3 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 3 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 3 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 4 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 4 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 4 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 4 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 5 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 5 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 5 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 5 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |

## Invariant firings — snapshot context

| Tick | Invariant | Field | Observed | Expected (op) |
|-----:|-----------|-------|---------:|---------------|
| 0 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 0 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 0 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 0 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 1 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 1 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 1 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 1 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 2 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 2 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 2 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 2 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 3 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 3 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 3 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 3 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 4 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 4 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 4 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 4 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 5 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 5 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 5 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 5 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |

## State deltas around invariant firings

| Tick | Key | Value |
|-----:|-----|------:|
| 0 | `split.buyback_bps` | 0 |
| 0 | `split.fundo_bps` | 0 |
| 0 | `split.kbr_bps` | 0 |
| 0 | `split.staking_bps` | 0 |
| 1 | `split.buyback_bps` | 0 |
| 1 | `split.fundo_bps` | 0 |
| 1 | `split.kbr_bps` | 0 |
| 1 | `split.staking_bps` | 0 |
| 2 | `split.buyback_bps` | 0 |
| 2 | `split.fundo_bps` | 0 |
| 2 | `split.kbr_bps` | 0 |
| 2 | `split.staking_bps` | 0 |
| 3 | `split.buyback_bps` | 0 |
| 3 | `split.fundo_bps` | 0 |
| 3 | `split.kbr_bps` | 0 |
| 3 | `split.staking_bps` | 0 |
| 4 | `split.buyback_bps` | 0 |
| 4 | `split.fundo_bps` | 0 |
| 4 | `split.kbr_bps` | 0 |
| 4 | `split.staking_bps` | 0 |
| 5 | `split.buyback_bps` | 0 |
| 5 | `split.fundo_bps` | 0 |
| 5 | `split.kbr_bps` | 0 |
| 5 | `split.staking_bps` | 0 |

_Simulation evidence — not audit signoff._
