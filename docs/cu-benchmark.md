# Benchmark: Anchor vs Pinocchio — compliance-registry

Medido em `solana-bankrun` (in-process SVM) com os mesmos fixtures de Sprint 4c
(`zk-circuits/proofs/{proof,public_values}.bin`), mesmo verifier SP1 v6
Groth16, mesmo compute budget limit (400k CU).

**Data**: 2026-04-22  
**Instrução**: `create_verified_attestation` (happy path, DID=did:test:company:acme)

## Resumo executivo

| Métrica                        | Anchor 0.31.1 | Pinocchio 0.9 | Δ                 |
|--------------------------------|--------------:|--------------:|-------------------|
| **Binário `.so`**              | 247.808 bytes | 63.936 bytes  | **−74,2%**        |
| **CU total (tx)**              | 276.765       | 269.565       | −2,6%             |
| **CU do verifier (CPI)**       | 263.389       | 263.389       | 0 (verifier idêntico) |
| **CU do wrapper (fora CPI)**   | 13.376        | 6.176         | **−53,8%**        |

## Leitura dos números

O verifier SP1 é o mesmo programa em ambos (`5xrWphWXoFnXJh7jYt3tyWZAwX1itbyyxJQs8uumiRTW`),
então os ~263k CU gastos no pairing check via `alt_bn128` são **constantes** —
não dependem da escolha do framework do caller.

O que **muda** é o overhead do wrapper (parsing de args, validação, PDA init via
CreateAccount CPI, serialização do Attestation). Nesse recorte:

- Anchor consome 13.376 CU em macros (`#[derive(Accounts)]`, `#[account]`,
  `init`) + 8-byte discriminator + dispatch.
- Pinocchio consome 6.176 CU com dispatch manual de 1 byte + checagens de
  conta explícitas + serialização manual.

Em absoluto o verifier CPI domina, mas em qualquer tx que rode no hot path
toda essa sobra vira budget útil — e o binário 4× menor barateia rent e acelera
JIT/load.

## Cenários onde o delta cresce

- **Ixs sem CPI pesado** — `create_attestation` (legacy, sem verifier) e
  `revoke_attestation`. Nesses, o wrapper é 100% do custo, então o -54% do
  Pinocchio aparece inteiro.
- **Programas com vários PDAs init na mesma tx** — o delta cresce linear.
- **Deploy/upgrade** — custo de BPFLoader é proporcional ao tamanho do `.so`.
  -74% de binário vira rent-exempt mais barato, upgrade mais rápido.

## Setup

```bash
# Ambos programas ativos, Anchor.toml tem os dois program IDs:
cd /root/dpo2u-solana/solana-programs
pnpm exec vitest run tests/verified-attestation.test.ts          # Anchor
pnpm exec vitest run tests/verified-attestation-pinocchio.test.ts # Pinocchio
```

Ambos produzem 4/4 passing com os mesmos fixtures.

## Notas técnicas relevantes

1. **Pinocchio 0.9 `Rent::get()` e `Clock::get()`** usam o syscall
   `sol_get_sysvar` (genérico, SIMD-0094), que nem todos os runtimes têm
   registrado (bankrun estável ainda não). A solução canônica pré-1.18 é
   passar os accounts dos sysvars explicitamente e usar
   `Rent::from_account_info` / `Clock::from_account_info`. Trocamos 2
   syscalls por 2 accounts a mais na ix — trade-off consciente.

2. **Discriminator de conta**: mantivemos os 8 bytes do hash
   `sha256("account:Attestation")[0..8]` iguais aos do Anchor. Isso preserva
   compatibilidade binária — o mesmo `BorshCoder` do cliente TypeScript
   decodifica atestados criados por ambos os programas sem alterar uma linha
   no IDL.

3. **Pareamento SP1 + BN254**: o verifier é byte-wire-compatible em ambos —
   struct `SP1Groth16Proof { proof: Vec<u8>, sp1_public_inputs: Vec<u8> }`
   serializada via Borsh sem discriminator. Reproduzimos a serialização
   manualmente em Pinocchio (append de `u32 LE len + bytes` × 2) para
   zerar qualquer variação de encoding entre versões de Borsh.

## Consequência operacional

Para o demo do Colosseum Frontier (2026-05-11):

- Mantém-se o fluxo atual (Anchor continua servindo tráfego).
- `compliance-registry-pinocchio` fica disponível no mesmo workspace, deploy
  independente, novo program ID (`FZ21S53Rn8Y6ANfccS2waCrkYWh5zfjXK3hkKU5YSkJ8`).
- Client TS pode escolher qual chamar em runtime — útil para A/B no palco.
- Rollback = mudar 1 const no client. Risco controlado.
