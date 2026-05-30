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
# canonical hash: 424e205bc55a5ffb42c5f24ed8043a828f878e136c3f7e27b3c04f58650e147b

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000004_b53d4f807242/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
