import { handleAuditMicarArt } from '/root/DPO2U/packages/mcp-server/src/tools/micar/audit-micar-art.js';

const r = await handleAuditMicarArt({
  vault: {
    authority: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
    reserveAmount: 1_030_000_000n,
    outstandingSupply: 1_000_000_000n,
    liquidityBps: 2000,
    capitalBufferBps: 300,
    dailyCap: 500_000_000n,
    dailySpent: 200_000_000n,
    lastResetDay: 0n,
    circuitTripped: false,
    version: 1,
  },
});
console.log(`score: ${r.overallScore}/100`);
console.log('modules:');
for (const [name, m] of Object.entries(r.modules)) {
  console.log(`  ${name.padEnd(20)} ok=${(m as any).ok} — ${(m as any).finding}`);
}
console.log(
  `missing controls: ${r.missingControls.length === 0 ? 'none' : r.missingControls.join(', ')}`,
);
