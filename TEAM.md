# Team

## Core contributor

**Frederico Santana** — Chairman, DPO2U
- X/Twitter: [@fredericosanntana](https://x.com/fredericosanntana)
- GitHub: [@fredericosanntana](https://github.com/fredericosanntana)
- Role on this project: architecture, SP1 v6 patch, Anchor programs,
  integration testing, deployment

## Shipping model — "chairman + AI agents"

`dpo2u-solana` was built **chairman-solo** using the AI-agent coordination
pattern from the DPO2U platform. Human judgment shapes strategy, product,
tradeoffs, and narrative; specialized AI agents (Claude Code) execute the
implementation in parallel — writing Rust contracts, TypeScript clients,
test suites, and documentation under chairman review and integration.

This is a deliberate bet: that the convergence of AI and blockchain lets
a single well-equipped builder ship what would previously have required a
5-person team, without sacrificing quality or auditability. Every line of
code in this repo was reviewed, refined, and integrated by a human; the
agents provide velocity, not autonomy.

If this model interests you for your own hackathon or product work, reach
out — happy to share the playbook.

## Why Brazil

LGPD (Lei Geral de Proteção de Dados, Brazil's GDPR analog, in force since
2020) is the motivating compliance regime. The collision between "audit
must verify the compliance score" and "but the score itself is sensitive
business data" is not an abstract academic case — it's a live problem
facing ~50M registered CNPJs in Brazil.

This is also why the project ships from Brazil: the constraints informed
the design, and the regulatory semantics (threshold policies, DPO workflows,
subject commitments as `did:br:cnpj:...` pattern) are LGPD-native, not
retrofitted from GDPR. The same stack generalizes to GDPR and other
jurisdictions — but starting from a specific regulatory reality produces
better primitives than starting from a generic spec.

## Acknowledgments

- **Pedro Marafiotti** ([@kukasolana](https://x.com/kukasolana)), Superteam
  Brasil Lead — who built the community that makes BR-first Solana projects
  credible. Kuka's framing of TradFi-to-DeFi analogies directly informs how
  we explain ZK compliance to non-cryptographers. `dpo2u-solana` is built
  with Superteam Brasil in mind as the first audience.
- **Superteam Brasil** — for the community, events, and unwavering bet that
  "Brasil vai ser o flagship market da Solana." We agree.
- **Succinct Labs** — for the SP1 zkVM and the original `sp1-solana` crate
  that this project patches. Our v6 patch is a contribution back (~120 LOC,
  upstream PR planned).
- **Light Protocol Labs** — for `groth16-solana`, the underlying pairing
  verifier that all of this rides on.
- **Anza** — for the Solana runtime with BN254 precompiles that makes
  on-chain Groth16 verification economically viable.

## Contact

For technical questions, open a GitHub issue. For partnership, regulatory,
or press inquiries, DM [@fredericosanntana](https://x.com/fredericosanntana).

---

*A gente sobe junto. 🇧🇷*
