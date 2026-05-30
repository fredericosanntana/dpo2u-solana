#!/bin/sh
# Riptide — reviewer-ready rerun recipe.
#
# Simulation evidence — not audit signoff.
# Regenerates the accompanying simulation-result.json from committed inputs.
# Expects to be run from this file's directory or anywhere; it cds to the repo
# root and then executes the documented invocation. POSIX sh only — no bashisms.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here/../../.."

# scenario: happy-split (kind inferred from the SimulationResult)
# canonical hash: 000502dea808ae5baeac960a7d73119e4bf665c4be1ec6c6bfe52aa656c0b04a

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000000_dda2c471d7fc/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
