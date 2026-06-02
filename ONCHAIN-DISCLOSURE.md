# Divulgação Regulatória de Código On-chain — fredericosanntana/dpo2u-solana

> _Gerado pela DPO2U como template de postura de compliance. Preencha os detalhes específicos da sua organização. Não constitui aconselhamento jurídico._

Este repositório contém código que opera on-chain (TypeScript, Rust, Shell, JavaScript). Esta divulgação documenta
a exposição regulatória observável, conforme exigência da postura de compliance da DPO2U.

## Componentes on-chain
- Linguagens/ambientes detectados: TypeScript, Rust, Shell, JavaScript.
- Os contratos/programas executam em rede pública; o estado on-chain é, por natureza, público e imutável.

## Considerações regulatórias
- **MiCA / CASP (UE):** avaliar se a atividade constitui serviço de criptoativos (custódia, troca,
  operação de plataforma) sujeito a autorização CASP sob o MiCAR. Documentar o enquadramento.
- **Erasure / direito ao apagamento (GDPR Art.17 / LGPD Art.18):** dados pessoais NÃO devem ser
  gravados on-chain em claro. Use minimização, hashing/commitment ou armazenamento off-chain com
  ponteiro on-chain. Documentar a estratégia de erasure para qualquer dado pessoal envolvido.
- **Travessia internacional de dados:** redes públicas distribuem o estado globalmente — avaliar
  bases legais de transferência internacional quando houver dado pessoal.

## Controles
- [ ] Mapear se há dado pessoal tocando a chain e como é minimizado.
- [ ] Definir a estratégia de erasure (off-chain + ponteiro / commitment).
- [ ] Avaliar enquadramento MiCA/CASP e registrar a conclusão.

_Selo on-chain de postura: dpo2u.com/verify._
