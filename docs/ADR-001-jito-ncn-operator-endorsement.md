# ADR-001: Jito NCN Operator Endorsement Model

**Status:** Proposed  
**Date:** 2026-04-23  
**Deciders:** Fred Santana  
**Stack:** dpo2u-solana + dpo2u-mcp  

---

## Contexto

O DPO2U é um protocolo de compliance LGPD com attestations on-chain no Solana.
Atualmente o Agente Auditor é o único emissor de attestations — um oráculo centralizado.

Para o protocolo escalar com credibilidade enterprise, a pergunta é:
**quem garante a qualidade do auditor além da reputação da DPO2U?**

A resposta não pode ser "outros auditores que veem os dados das empresas" — isso
viola a LGPD que o protocolo defende. O caminho é economic accountability sem
exposição de dados.

---

## Decisão

Implementar um **NCN (Node Consensus Network) via Jito Restaking** onde:

1. **DPO2U é o único auditor** com acesso aos dados das empresas (via contrato + NDA)
2. **Empresas certificadas** tornam-se NCN Operators que **endossam** (não re-auditam) os resultados
3. **ZK proofs via SP1** garantem que o processo foi executado corretamente, sem expor conteúdo
4. **FHE via OpenFHE** (já integrado no dpo2u-mcp) para cálculos onde nem a DPO2U deve ver dados brutos
5. **Stake slashable em SOL/JitoSOL** cria accountability econômica sem centralização de confiança

---

## Pipeline Completo

### Fase 1 — Auditoria (sem mudança no v1)

```
Empresa → envia documentos → DPO2U (contrato + NDA)
                                    ↓
                        dpo2u-mcp: Auditor Agent
                        - checa 5 campos obrigatórios LGPD
                        - aplica checklist Art. 18, Art. 46, Art. 48
                        - gera compliance_score (0–100)
                                    ↓
                        SP1 gera ZK proof:
                        "a checklist foi executada corretamente"
                        (prova o processo, não o conteúdo)
                                    ↓
                        Lighthouse: upload doc cifrado → CID
                                    ↓
                        compliance-registry (Solana):
                        register_attestation(cnpj_hash, score, zk_proof, cid)
```

### Fase 2 — Convite para Operator

```
Trigger: attestation com score >= 75 registrada on-chain
                    ↓
        MCP tool: check_operator_eligibility(cnpj_hash)
        └── score >= threshold
        └── attestation válida e não expirada
        └── empresa com wallet Solana ativa
                    ↓
        Notificação (BillionMail):
        "Sua empresa está elegível para se tornar operadora da rede DPO2U.
         Operadores ganham fees em SOL por epoch de participação."
                    ↓
        Empresa aceita → recebe:
        - DPO2U Operator Kit (CLI + daemon)
        - Instrução para gerar keypair Solana de operador
        - Instrução para depositar SOL/JitoSOL no DPO2U Vault (Jito)
                    ↓
        3-way handshake Jito:
        NCN ←opt-in→ Operator ←opt-in→ Vault
```

### Fase 3 — Endosso e Votação

```
Nova attestation pendente publicada on-chain:
{ cnpj_hash, score, zk_proof, cid_cifrado, epoch }
                    ↓
Todos os operators ativos recebem o evento
                    ↓
Cada operator avalia:
  [A] Verificar ZK proof: proof.verify() on-chain → pass/fail
  [B] Verificar consistência do score com histórico público da empresa
  [C] Verificar se CID está acessível (documento não foi removido)
  OBS: operators NÃO acessam os dados em plaintext
                    ↓
Operator submete voto: ENDORSE | CHALLENGE + motivo_code
(assinado com keypair do operador, peso = JitoSOL em stake)
                    ↓
Período de votação: X epochs (~48h em devnet, configurável)
```

### Fase 4 — Consenso e Finalização

```
Caso A: sem CHALLENGE até fim do período
└── attestation FINALIZADA automaticamente
└── fees distribuídos a todos os operators que votaram ENDORSE

Caso B: CHALLENGE com >= 20% do stake
└── DPO2U abre evidências adicionais para árbitro designado
└── Árbitro (pool de DPOs certificados externos) decide
└── Se DPO2U estava errado: score corrigido, reputação penalizada
└── Se challengeador estava errado: stake do challengeador slashado

Fee distribution por epoch (Jito FeeDistributor):
- Operators que votaram no resultado final: proporcional ao stake
- Operators que votaram divergente e não contestaram formalmente: sem fee
- Operators sem voto: sem fee (ausência penaliza)
```

### Fase 5 — FHE para Dados Ultrassensíveis (v2+)

Para campos onde nem a DPO2U deve ver plaintext (ex: volume exato de titulares,
dados financeiros de processamento):

```
Empresa cifra campo sensível com chave FHE pública do protocolo
                    ↓
dpo2u-mcp (OpenFHE): computa checklist sobre dados cifrados
└── Ex: retention_days_enc >= 365_enc → bool_enc
                    ↓
Threshold decrypt: N-de-M operators combinam chaves parciais
└── Decifram apenas o resultado booleano/score parcial
└── Nenhum operador vê o valor original
                    ↓
Score parcial FHE integrado ao score final do auditor
```

---

## Privacidade por Design

| Camada | Dados expostos | Para quem |
|--------|---------------|-----------|
| Auditoria (DPO2U) | Documentos em plaintext | Só DPO2U (contrato + NDA) |
| ZK Proof (SP1) | Resultado booleano do processo | Público |
| CID on-chain | Hash do documento cifrado | Público |
| Voto do operator | ENDORSE / CHALLENGE | Público |
| FHE (v2) | Nada em plaintext | Ninguém |
| Attestation final | score + cnpj_hash + proof | Público |

**Dados pessoais dos titulares: nunca sobem on-chain, nunca saem do controle da empresa.**

---

## Tokenomics (sem token próprio)

| Item | Token | Direção |
|------|-------|---------|
| Pagamento pelo serviço | SOL | Empresa → DPO2U |
| Stake do operator | JitoSOL | Empresa → Vault Jito |
| Fees por epoch | SOL | Protocolo → Operators |
| Slash por fraude | JitoSOL | Operator → Vault (queimado/redistribuído) |

**Sem lançamento de token. Sem overhead regulatório de securities.**

---

## Flywheel

```
Mais empresas certificadas
        ↓
Mais operators com stake
        ↓
Attestations mais credíveis
        ↓
Enterprise confia mais no protocolo
        ↓
Mais empresas querem certificação
        ↓ (loop)
```

Empresas migram de "centro de custo" (pagar pela certificação) para
"potencial de receita" (ganhar SOL por endossar outros).

---

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Cartel: operators combinam endossar empresas não-conformes | ZK proof verifica o processo antes do vote ser aceito |
| DPO2U frauda audit | Operators perdem stake por endossar → interesse em contestar |
| Operator incompetente (endossa sem verificar) | Ausência de fee + slash acumulado por histórico ruim |
| ANPD não reconhece attestation peer | DPO2U mantém super-operator slot com maioria temporária; attestation tem validade jurídica separada |
| Poucos operators no bootstrap | DPO2U opera como único operator em v1; NCN ativado só com >= 3 operators independentes |

---

## O que muda nos programas existentes

### dpo2u-solana

- `compliance-registry`: adicionar campo `endorsement_epoch` e `operator_count` na attestation
- `fee-distributor`: substituir por Jito FeeDistributor (ou wrapper)
- Novo programa: `ncn-program` (fork do ncn-template com ComplianceVote em vez de WeatherStatus)

### dpo2u-mcp

- Nova tool: `invite_to_operator_network(cnpj_hash)` 
- Nova tool: `get_pending_endorsements()` — lista attestations aguardando vote
- Nova tool: `submit_endorsement(attestation_id, vote, keypair)` 
- Integração OpenFHE: já existe no container, expor como tool MCP

---

## Referências

- [Jito NCN Template](https://github.com/jito-foundation/ncn-template)
- [Jito Restaking Docs](https://docs.restaking.jito.network)
- [JET Latam](https://jetlatam.com) — comunidade Jito LATAM (canal de onboarding de operators)
- `dpo2u-solana/docs/REVIEW.md` — arquitetura atual dos programas Solana
- LGPD Art. 46 (medidas de segurança) e Art. 18 (direitos dos titulares)

---

## Próximos Passos

- [ ] v1: certificar primeiras 3 empresas e convidar como operators beta
- [ ] v1: spike devnet — fork do ncn-template com `ComplianceVote`
- [ ] v1: integração JET Latam para onboarding de operators na comunidade Solana LATAM
- [ ] v2: FHE threshold decrypt para campos ultrassensíveis
- [ ] v2: árbitro pool (DPOs certificados externos) para dispute resolution
