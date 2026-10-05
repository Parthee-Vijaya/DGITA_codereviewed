import { tsImport } from "tsx/esm/api";

const { productionConfigurationIssues } = await tsImport("../features/runtime/production-config.ts", import.meta.url);

const issues = productionConfigurationIssues(process.env);
if (issues.length) {
  console.error(`Production configuration is incomplete: ${issues.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("Production configuration structure passed. Provider access and organisational approval still require verification.");
}
