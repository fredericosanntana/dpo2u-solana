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
# canonical hash: c9d20b54c2730ec602469f3f84be0ba3b0d15a2e5b4f219c0a2c44f2dbcdf665

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000003_0e80f7bc936d/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
