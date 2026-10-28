import { diagnoseCollection } from "../diagnostics.js";
import { selectCollectionPath } from "../config.js";

export async function diagnoseCommand(options: { path?: string; json?: boolean }): Promise<void> {
  try {
    const result = await diagnoseCollection(options.path);
    if (options.json) {
      console.log(JSON.stringify({ version: 1, ok: true, result }));
    } else {
      console.log(`Collection: ${result.root} (${result.selectionSource})`);
      console.log(`Configuration: ${result.locations.config}`);
      console.log(`Task type: ${result.locations.taskType}`);
      console.log(`Versions: mdbase ${result.versions.core}; model ${result.versions.model}; collection ${result.versions.spec}`);
      console.log(`Field mappings: ${JSON.stringify(result.mapping.roleToField)}`);
      console.log(`Status semantics: ${JSON.stringify(result.status)}`);
      console.log(`Validation: ${result.validation.policy}; strict: ${result.validation.strict}`);
      console.log(`Exclusions: ${result.exclusions.join(", ")}`);
      console.log(`Path contract: ${JSON.stringify(result.path)}`);
      console.log(`Contracts: ${JSON.stringify(result.contracts)}`);
      console.log(`Capabilities: ${JSON.stringify(result.capabilities)}`);
      console.log(`Agent eligibility policy: ${JSON.stringify(result.agentEligibilityPolicy)}`);
      console.log(`Dependency policy: ${JSON.stringify(result.dependencyPolicy)}`);
      for (const issue of result.issues) console.error(`Warning [${issue.code}]: ${issue.message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ version: 1, ok: false, error: {
        code: "configuration_error", message, details: selectCollectionPath(options.path),
      } }));
    } else {
      console.error(`Error [configuration_error]: ${message}`);
    }
    process.exitCode = 1;
  }
}
