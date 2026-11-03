import { ProvStore } from "./db/store.js";
import { ExtractionPipeline } from "./extractors/pipeline.js";

async function main() {
  const store = new ProvStore();
  store.resetAllData();
  const pipeline = new ExtractionPipeline(store);
  await pipeline.runAllLoaders(0);

  const stats = store.getSummaryStats();
  const anomalies = store.getProcessAnomalies();
  console.log("Extraction complete!");
  console.log("Summary Stats:", stats);
  console.log("Detected Process Anomalies:", anomalies.length);
  for (const a of anomalies) {
    console.log(` - [${a.severity.toUpperCase()}] (${a.ruleId}) ${a.category}: ${a.label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
