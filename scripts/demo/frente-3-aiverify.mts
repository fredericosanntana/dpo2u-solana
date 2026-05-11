import { handleGenerateAiverifyPluginTemplate } from '/root/DPO2U/packages/mcp-server/src/tools/aiverify/generate-aiverify-plugin-template.js';

const r = await handleGenerateAiverifyPluginTemplate({
  modelType: 'pytorch',
  metric: 'fairness',
});
const firstLines = r.pluginCode.split('\n').slice(0, 12).join('\n');
console.log('plugin.py (first 12 lines):');
console.log(firstLines);
console.log();
console.log(`anchoring.py: ${r.anchoringCode ? 'generated (' + r.anchoringCode.length + ' chars)' : 'omitted'}`);
console.log(`checklist: ${r.checklist.length} items`);
for (const c of r.checklist.slice(0, 3)) {
  console.log(`  - ${c}`);
}
