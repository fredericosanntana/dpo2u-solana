use riptide_engine::harness::{run_harness_cli, HarnessContext, RiptideHarness};

struct ProjectHarness;

impl RiptideHarness for ProjectHarness {
    fn setup(&self, ctx: &mut HarnessContext<'_>) -> anyhow::Result<()> {
        // Adapter-declared accounts are listed below. This empty harness is
        // buildable, but setup-heavy adapters should populate deterministic pre-tick-0 bytes
        // before a campaign is considered ready.
        //
        // Use the repo's source, IDL, tests, constants, dependency types, and
        // fixtures to derive account owners, discriminators, PDA seeds, feed
        // IDs, and serialization. Return an anyhow error when a required fact
        // cannot be determined locally.
        //
        // Common helpers:
        //   ctx.spl_mint("mint", ctx.admin_pubkey(), 1_000_000_000, 6)?;
        //   ctx.spl_token_account("vault", mint, authority, 500_000)?;
        //   ctx.agent_spl_token_account("user_ata", 0, mint, owner, 100_000)?;
        //   ctx.set_shared_account_data("oracle", oracle_program, oracle_bytes)?;
        //   ctx.set_raw_account(custom_pubkey, owner_program, account_bytes, None)?;
        //   ctx.load_program_from_so("../target/deploy/dependency.so")?;
        // config: shared, space=230
        ctx.require_declared_account("config")?;
        // source_ata: agent, space=165
        ctx.require_declared_account("source_ata")?;
        // vault_kbr: shared, space=165
        ctx.require_declared_account("vault_kbr")?;
        // vault_buyback: shared, space=165
        ctx.require_declared_account("vault_buyback")?;
        // vault_staking: shared, space=165
        ctx.require_declared_account("vault_staking")?;
        // vault_fundo: shared, space=165
        ctx.require_declared_account("vault_fundo")?;
        // fee_token_mint: shared, space=82
        ctx.require_declared_account("fee_token_mint")?;

        Ok(())
    }
}

fn main() -> std::process::ExitCode {
    run_harness_cli(ProjectHarness)
}
