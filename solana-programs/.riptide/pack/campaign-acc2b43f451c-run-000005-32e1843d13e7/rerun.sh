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
# canonical hash: 20aae482121618e7d1ee0f9082d1758d0ffe5b4d06c251ca86bf85675cfd7ec4

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000005_32e1843d13e7/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
