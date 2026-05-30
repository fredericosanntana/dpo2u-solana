# Technical trace — `happy-split`

> Simulation evidence — not audit signoff.

- **Adapter:** `.riptide/adapters/knect-tokenomics.toml`
- **Kind:** `simulation-run`
- **Total ticks:** 10
- **Event count:** 84
- **Canonical hash:** `424e205bc55a5ffb42c5f24ed8043a828f878e136c3f7e27b3c04f58650e147b`

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
| 6 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 6 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 6 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 6 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 7 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 7 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 7 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 7 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 8 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 8 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 8 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 8 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 9 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 9 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 9 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 9 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |
| 10 | `engine` | `invariant_fired:kbr_bps_canonical` | field=`split.kbr_bps` observed=0 == expected=2500 |
| 10 | `engine` | `invariant_fired:buyback_bps_canonical` | field=`split.buyback_bps` observed=0 == expected=2500 |
| 10 | `engine` | `invariant_fired:staking_bps_canonical` | field=`split.staking_bps` observed=0 == expected=3500 |
| 10 | `engine` | `invariant_fired:fundo_bps_canonical` | field=`split.fundo_bps` observed=0 == expected=1500 |

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
| 6 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 6 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 6 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 6 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 7 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 7 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 7 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 7 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 8 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 8 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 8 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 8 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 9 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 9 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 9 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 9 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |
| 10 | `kbr_bps_canonical` | `split.kbr_bps` | 0 | `==` 2500 |
| 10 | `buyback_bps_canonical` | `split.buyback_bps` | 0 | `==` 2500 |
| 10 | `staking_bps_canonical` | `split.staking_bps` | 0 | `==` 3500 |
| 10 | `fundo_bps_canonical` | `split.fundo_bps` | 0 | `==` 1500 |

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
| 6 | `split.buyback_bps` | 0 |
| 6 | `split.fundo_bps` | 0 |
| 6 | `split.kbr_bps` | 0 |
| 6 | `split.staking_bps` | 0 |
| 7 | `split.buyback_bps` | 0 |
| 7 | `split.fundo_bps` | 0 |
| 7 | `split.kbr_bps` | 0 |
| 7 | `split.staking_bps` | 0 |
| 8 | `split.buyback_bps` | 0 |
| 8 | `split.fundo_bps` | 0 |
| 8 | `split.kbr_bps` | 0 |
| 8 | `split.staking_bps` | 0 |
| 9 | `split.buyback_bps` | 0 |
| 9 | `split.fundo_bps` | 0 |
| 9 | `split.kbr_bps` | 0 |
| 9 | `split.staking_bps` | 0 |
| 10 | `split.buyback_bps` | 0 |
| 10 | `split.fundo_bps` | 0 |
| 10 | `split.kbr_bps` | 0 |
| 10 | `split.staking_bps` | 0 |

_Simulation evidence — not audit signoff._
