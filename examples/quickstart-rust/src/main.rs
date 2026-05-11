//! DPO2U Quickstart — Rust track.
//!
//! Install:
//!   cargo new my-app && cd my-app
//!   cargo add dpo2u-sdk --features mcp-client
//!   cargo add tokio --features rt,macros
//!   cargo add solana-program
//!
//! Run:
//!   export DPO2U_API_KEY="sua-jwt-key"
//!   cargo run
//!
//! What this does:
//!   1. Derives a consent PDA locally (no RPC — useful pra CPI do seu program)
//!   2. Compares regulatory matrix via MCP REST
//!   3. Submits a consent event on Solana devnet (server signs as fiduciary)
//!   4. Fetches the PDA back via MCP read-only

use dpo2u_sdk::{mcp::MCPClient, pdas, programs};
use solana_program::pubkey::Pubkey;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mcp = MCPClient::new(
        "https://mcp.dpo2u.com",
        std::env::var("DPO2U_API_KEY").ok(),
    );

    // 1. Local PDA derivation (no network)
    println!("── 1. Local PDA derivation (pdas::consent_pda) ──");
    let user = Pubkey::new_unique();
    let fiduciary = Pubkey::new_unique();
    let purpose_hash = pdas::purpose_hash(b"marketing_communications");
    let (consent_pda, _bump) = pdas::consent_pda(&user, &fiduciary, &purpose_hash);
    println!("  program:     {}", programs::CONSENT_MANAGER);
    println!("  consent PDA: {}", consent_pda);
    println!("  seeds: [b\"consent\", user, fiduciary, sha256(\"marketing_communications\")]\n");

    // 2. Regulatory matrix via MCP REST
    println!("── 2. compare_jurisdictions (MCPClient) ──");
    let matrix = mcp
        .compare_jurisdictions(
            Some(vec!["BR".into(), "EU".into(), "INDIA".into(), "SG".into()]),
            Some("onchain"),
        )
        .await?;
    for r in &matrix.matrix {
        let op = r
            .on_chain_opportunity
            .as_ref()
            .map(|o| o.target.as_str())
            .unwrap_or("—");
        println!("  {}  {}  {}  ·  {}", r.code, r.country, r.crypto_maturity, op);
    }
    println!("  recommendation: {}\n", matrix.recommendation.chars().take(100).collect::<String>());

    // 3. On-chain consent submission
    println!("── 3. submit_consent_record (devnet tx via MCP) ──");
    let real_user = Pubkey::new_unique();
    let rec = mcp
        .submit_consent_record(
            &real_user.to_string(),
            1,
            "marketing_communications",
            Some("https://example.com/terms.pdf"),
            None,
        )
        .await?;
    println!("  user:     {}", real_user);
    println!("  tx:       {}", rec.signature);
    println!("  pda:      {}", rec.consent_pda);
    println!("  explorer: {}\n", rec.explorer_url);

    // 4. Fetch via MCP
    println!("── 4. fetch_consent_record ──");
    let fetched = mcp
        .fetch_consent_record(
            &real_user.to_string(),
            &rec.fiduciary,
            Some("marketing_communications"),
            None,
        )
        .await?;
    if let Some(record) = &fetched.record {
        println!("  found! purposeCode: {}, verified: {}", record.purpose_code, record.verified);
    } else {
        println!("  not found (may still be propagating — retry in 2s)");
    }

    println!("\n✓ On-chain DPDP India consent event gravado + auditado.");
    println!("  Pra usar sua própria keypair (produção), combine com DPO2UConsentClient");
    println!("  do @dpo2u/client-sdk ou o anchorpy equivalente.");
    Ok(())
}
