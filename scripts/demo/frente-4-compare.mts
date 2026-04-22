import { handleCompareJurisdictions } from '/root/DPO2U/packages/mcp-server/src/tools/jurisdictions/compare-jurisdictions.js';

const r = await handleCompareJurisdictions({
  targetMarkets: ['BR', 'EU', 'INDIA', 'SG', 'UAE'],
  focus: 'onchain',
});
console.log('matrix:');
for (const row of r.matrix) {
  console.log(
    `  ${row.code.padEnd(6)} ${row.country}  crypto=${row.cryptoMaturity}  data=${row.dataProtection}`,
  );
  if (row.onChainOpportunity) {
    console.log(`           → ${row.onChainOpportunity.target}`);
  }
}
console.log();
console.log(`recommendation: ${r.recommendation}`);
