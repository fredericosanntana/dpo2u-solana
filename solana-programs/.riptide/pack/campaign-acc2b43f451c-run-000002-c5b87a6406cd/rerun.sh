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
# canonical hash: 777a3f95b69a5d59e27542adb671319655f9c72dde539189d120c4e822a07f6a

exec riptide run .riptide/campaigns/campaign_acc2b43f451c/runs/run_000002_c5b87a6406cd/run-config.json --adapter .riptide/adapters/knect-tokenomics.toml
