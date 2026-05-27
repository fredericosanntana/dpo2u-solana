# Getting Started With Riptide

Riptide just created a thin `.riptide/` workspace. The default configuration path is:

```bash
/riptide-config
riptide campaign run .riptide/campaigns/<risk>.campaign.toml
riptide review <campaign-root>
```

`/riptide-config` should finish the adapter, add a Rust setup harness when account bytes or sibling programs are needed, create starter scenarios, write and validate a Campaign TOML, and report the exact run/review commands.

## Directory layout

- `adapters/fee-distributor.toml` — placeholder adapter with program artifact paths and TODO blocks for the config skill or a manual author.



## Skill-First Setup

`riptide init` also dropped the bundled `riptide-config` skill into `.claude/skills/riptide-config/` so any coding agent run from this repo picks it up automatically — even on a fresh clone or a machine that doesn't have it installed under `~/.claude/skills/`. Pass `--no-skills` if you want to opt out.

Invoke `/riptide-config` from your coding agent at the repo root. It treats this thin scaffold as normal input and owns:

- adapter TOML repair and validation
- Rust harness generation and setup, when needed
- personas, scenarios, invariants, and campaign creation
- bounded smoke runs and Campaign TOML validation
- final next commands for `riptide campaign run` and `riptide review`

It preserves existing `.riptide` files when they are user-authored. If this repo was initialized with `riptide init --wizard`, it should preserve those persona and scenario choices unless validation proves they are invalid.

## Manual / Advanced Path

Use this path if you are not using the config skill. To replace this thin scaffold with questionnaire-selected starter files, rerun `riptide init --wizard --force`.

1. `riptide doctor` — static health check; confirms toolchain + engine binary.
2. Build your program so `target/deploy/*.so` and `target/idl/*.json` exist.
3. Open `.riptide/adapters/fee-distributor.toml` and fill in the TODO blocks for accounts, instructions, state mapping, actions, observations, personas, invariants, semantics, oracle bindings, and lineage. The untouched placeholder is intentionally not lint-clean.
4. `riptide lint .riptide/adapters/fee-distributor.toml` — static validation against the JSON IDL named in the adapter.
5. Create `.riptide/scenarios/<experiment>/run-config.json` or write a Campaign TOML once the adapter is real.
6. Optional only if setup bytes are needed: `riptide harness generate --adapter .riptide/adapters/fee-distributor.toml`.
7. Run one bounded smoke after a scenario exists:

   ```
   riptide run .riptide/scenarios/<experiment>/run-config.json --adapter .riptide/adapters/fee-distributor.toml --seeds 1 --seed-root 1337
   ```


After a campaign finishes, `riptide-narrative` can turn a completed run's `simulation-result.json` and `report.md` into `report-narrative.md`.

## Reference

- Shipping adapter examples: [riptidesim/riptide — fixtures/adapters/](https://github.com/riptidesim/riptide/tree/main/fixtures/adapters)
- Architecture deep-dive: [docs/architecture.md](https://github.com/riptidesim/riptide/blob/main/docs/architecture.md)

Problems? Drop the adapter file + the engine stderr tail into an issue at https://github.com/riptidesim/riptide/issues.
