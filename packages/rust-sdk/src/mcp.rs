//! MCPClient — thin typed wrapper around the DPO2U MCP server REST API.
//!
//! Feature-gated by `mcp-client`. When enabled, brings in `reqwest` + `tokio`
//! + `serde` to call `mcp.dpo2u.com` (or self-hosted) and return typed
//! responses for the full tool surface: on-chain submit/revoke/fetch +
//! audit/docs generation.
//!
//! ```no_run
//! # #[cfg(feature = "mcp-client")]
//! # async fn demo() -> Result<(), dpo2u_sdk::mcp::MCPClientError> {
//! use dpo2u_sdk::mcp::MCPClient;
//!
//! let mcp = MCPClient::new("https://mcp.dpo2u.com", Some("your-jwt-api-key"));
//!
//! // On-chain: record a consent via server wallet
//! let rec = mcp.submit_consent_record(
//!     "HthjMxo...",
//!     1,
//!     "marketing_communications",
//!     None,  // storage_uri
//!     None,  // expires_at
//! ).await?;
//! println!("tx: {}, pda: {}", rec.signature, rec.consent_pda);
//!
//! // Audit/docs: cross-jurisdiction matrix
//! let matrix = mcp.compare_jurisdictions(
//!     Some(vec!["BR".into(), "EU".into(), "INDIA".into()]),
//!     Some("onchain"),
//! ).await?;
//! println!("{} jurisdictions", matrix.matrix.len());
//! # Ok(())
//! # }
//! ```

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum MCPClientError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("tool {tool} failed with HTTP {status}: {body}")]
    ToolFailure {
        tool: String,
        status: u16,
        body: String,
    },
    #[error("response parse error: {0}")]
    Parse(#[from] serde_json::Error),
}

/// Wraps the REST envelope `{ success, result }` the MCP HTTP handler returns.
#[derive(Deserialize)]
struct RestEnvelope<T> {
    #[allow(dead_code)]
    success: Option<bool>,
    result: Option<T>,
    #[allow(dead_code)]
    error: Option<String>,
}

#[derive(Clone)]
pub struct MCPClient {
    endpoint: String,
    api_key: Option<String>,
    http: reqwest::Client,
}

impl MCPClient {
    pub fn new(endpoint: impl Into<String>, api_key: Option<impl Into<String>>) -> Self {
        let mut ep: String = endpoint.into();
        while ep.ends_with('/') {
            ep.pop();
        }
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .expect("reqwest client");
        Self {
            endpoint: ep,
            api_key: api_key.map(|s| s.into()),
            http,
        }
    }

    pub fn endpoint(&self) -> &str {
        &self.endpoint
    }

    /// Generic dispatcher. Use the typed methods below for DX.
    pub async fn call<B, R>(&self, tool_name: &str, body: &B) -> Result<R, MCPClientError>
    where
        B: Serialize + ?Sized,
        R: for<'de> Deserialize<'de>,
    {
        let url = format!("{}/tools/{}", self.endpoint, tool_name);
        let mut req = self.http.post(&url).json(body);
        if let Some(key) = &self.api_key {
            req = req.header("x-api-key", key);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(MCPClientError::ToolFailure {
                tool: tool_name.to_string(),
                status: status.as_u16(),
                body,
            });
        }
        // Try to unwrap the {success, result} envelope first; fall back to raw body.
        let bytes = resp.bytes().await?;
        // First pass: try as envelope<R>
        if let Ok(env) = serde_json::from_slice::<RestEnvelope<R>>(&bytes) {
            if let Some(r) = env.result {
                return Ok(r);
            }
        }
        // Fallback: parse as R directly
        serde_json::from_slice::<R>(&bytes).map_err(MCPClientError::Parse)
    }

    // ─── On-chain tools ──────────────────────────────────────────────────

    pub async fn submit_consent_record(
        &self,
        user: &str,
        purpose_code: u16,
        purpose_text: &str,
        storage_uri: Option<&str>,
        expires_at: Option<i64>,
    ) -> Result<SubmitConsentRecordResult, MCPClientError> {
        let body = serde_json::json!({
            "user": user,
            "purposeCode": purpose_code,
            "purposeText": purpose_text,
            "storageUri": storage_uri.unwrap_or(""),
            "expiresAt": expires_at,
        });
        self.call("submit_consent_record", &body).await
    }

    pub async fn submit_consent_revoke(
        &self,
        consent_pda: &str,
        reason: &str,
        user_signer_base58: &str,
    ) -> Result<SubmitConsentRevokeResult, MCPClientError> {
        let body = serde_json::json!({
            "consentPda": consent_pda,
            "reason": reason,
            "userSignerBase58": user_signer_base58,
        });
        self.call("submit_consent_revoke", &body).await
    }

    pub async fn fetch_consent_record(
        &self,
        user: &str,
        data_fiduciary: &str,
        purpose_text: Option<&str>,
        purpose_hash_hex: Option<&str>,
    ) -> Result<FetchConsentResult, MCPClientError> {
        let body = serde_json::json!({
            "user": user,
            "dataFiduciary": data_fiduciary,
            "purposeText": purpose_text,
            "purposeHashHex": purpose_hash_hex,
        });
        self.call("fetch_consent_record", &body).await
    }

    // ─── Cross-jurisdiction ──────────────────────────────────────────────

    pub async fn compare_jurisdictions(
        &self,
        target_markets: Option<Vec<String>>,
        focus: Option<&str>,
    ) -> Result<CompareJurisdictionsResult, MCPClientError> {
        let body = serde_json::json!({
            "targetMarkets": target_markets,
            "focus": focus,
        });
        self.call("compare_jurisdictions", &body).await
    }

    pub async fn audit_micar_art(
        &self,
        args: &Value,
    ) -> Result<Value, MCPClientError> {
        self.call("audit_micar_art", args).await
    }

    pub async fn check_compliance(&self, args: &Value) -> Result<Value, MCPClientError> {
        self.call("check_compliance", args).await
    }

    pub async fn generate_consent_manager_plan(
        &self,
        args: &Value,
    ) -> Result<Value, MCPClientError> {
        self.call("generate_consent_manager_plan", args).await
    }

    pub async fn generate_aiverify_plugin_template(
        &self,
        args: &Value,
    ) -> Result<Value, MCPClientError> {
        self.call("generate_aiverify_plugin_template", args).await
    }

    // ─── Meta ────────────────────────────────────────────────────────────

    pub async fn health(&self) -> Result<Value, MCPClientError> {
        let url = format!("{}/health", self.endpoint);
        let resp = self.http.get(&url).send().await?;
        let body: Value = resp.json().await?;
        Ok(body)
    }
}

// ─── Typed result structures ─────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmitConsentRecordResult {
    pub signature: String,
    pub consent_pda: String,
    pub explorer_url: String,
    pub cluster: String,
    pub fiduciary: String,
    pub purpose_hash_hex: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmitConsentRevokeResult {
    pub signature: String,
    pub explorer_url: String,
    pub cluster: String,
    pub user_pubkey: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct FetchConsentResult {
    pub found: bool,
    pub record: Option<ConsentRecordBrief>,
    #[serde(rename = "derivedPurposeHashHex")]
    pub derived_purpose_hash_hex: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsentRecordBrief {
    pub pda: String,
    pub user: String,
    pub data_fiduciary: String,
    pub purpose_code: u16,
    pub purpose_hash_hex: String,
    pub storage_uri: String,
    pub issued_at: String,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
    pub revocation_reason: Option<String>,
    pub version: u8,
    pub verified: bool,
    pub threshold: u32,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct CompareJurisdictionsResult {
    pub matrix: Vec<JurisdictionRow>,
    pub recommendation: String,
    pub focus: String,
    pub metadata: Value,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct JurisdictionRow {
    pub code: String,
    pub name: String,
    pub country: String,
    pub crypto_maturity: String,
    pub ai_regulation: String,
    pub data_protection: String,
    pub best_use_case: String,
    pub key_insight: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on_chain_opportunity: Option<OnChainOpportunity>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OnChainOpportunity {
    pub target: String,
    pub architecture: String,
    pub regulatory_fit: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_trims_trailing_slash() {
        let c = MCPClient::new("https://mcp.example.com/", None::<&str>);
        assert_eq!(c.endpoint(), "https://mcp.example.com");
    }

    #[test]
    fn client_with_api_key() {
        let c = MCPClient::new("https://x", Some("mykey"));
        assert_eq!(c.endpoint(), "https://x");
        assert_eq!(c.api_key.as_deref(), Some("mykey"));
    }

    #[test]
    fn submit_consent_record_result_parses() {
        let json = serde_json::json!({
            "signature": "abc",
            "consentPda": "pda1",
            "explorerUrl": "https://explorer.solana.com/tx/abc",
            "cluster": "devnet",
            "fiduciary": "fid",
            "purposeHashHex": "00".repeat(32),
        });
        let r: SubmitConsentRecordResult = serde_json::from_value(json).unwrap();
        assert_eq!(r.signature, "abc");
        assert_eq!(r.consent_pda, "pda1");
    }

    #[test]
    fn jurisdiction_row_parses() {
        let json = serde_json::json!({
            "code": "LGPD",
            "name": "LGPD",
            "country": "BR",
            "cryptoMaturity": "Medium",
            "aiRegulation": "Emerging",
            "dataProtection": "Strong",
            "bestUseCase": "Home market",
            "keyInsight": "Brasil...",
            "onChainOpportunity": {
                "target": "consent",
                "architecture": "arch",
                "regulatoryFit": "fit"
            }
        });
        let r: JurisdictionRow = serde_json::from_value(json).unwrap();
        assert_eq!(r.code, "LGPD");
        assert!(r.on_chain_opportunity.is_some());
    }

    #[test]
    fn jurisdiction_row_parses_emea_codes() {
        for (code, country, use_case) in [
            ("POPIA", "ZA", "SADC gateway"),
            ("NDPA", "NG", "West Africa fintech"),
            ("CCPA", "US", "US enterprise market"),
            ("PIPEDA", "CA", "EU-adequate Americas bridge"),
            ("LAW25", "CA", "First North American GDPR-equivalent"),
            ("PIPA", "KR", "Northeast Asia gateway"),
            ("PDP", "ID", "SE Asia largest economy"),
        ] {
            let json = serde_json::json!({
                "code": code,
                "name": code,
                "country": country,
                "cryptoMaturity": "High",
                "aiRegulation": "Emerging",
                "dataProtection": "Strong",
                "bestUseCase": use_case,
                "keyInsight": "EMEA expansion",
            });
            let r: JurisdictionRow = serde_json::from_value(json).unwrap();
            assert_eq!(r.code, code);
            assert_eq!(r.country, country);
        }
    }

    #[test]
    fn fetch_consent_result_handles_null_record() {
        let json = serde_json::json!({
            "found": false,
            "record": null,
        });
        let r: FetchConsentResult = serde_json::from_value(json).unwrap();
        assert!(!r.found);
        assert!(r.record.is_none());
    }
}
