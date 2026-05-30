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
# canonical hash: 9dc62a64c83dfe7665f08f42b40fea0494523c5ba43f998028482a47db1295ba

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000007_590057da852e/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
