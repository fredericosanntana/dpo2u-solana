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

# scenario: baseline (kind inferred from the SimulationResult)
# canonical hash: 219e7975137c5d53ebfd2a734384c5a4a728c3c6829acd01c6dfe5b3ef72b101

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000006_b80f34296420/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
