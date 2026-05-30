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
# canonical hash: 4da1c87136f3262ea25b80b607d56eedd95f2dc42b2d7e25fc24f0cd07b2b838

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000001_73622645c483/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
