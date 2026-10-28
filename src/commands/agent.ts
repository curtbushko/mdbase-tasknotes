import { AgentError, invalid, readAgentInput, withAgent } from "../agent.js";
import { createAgentTask } from "../agent-create.js";
import { appendEvidence, describeTask } from "../task-content.js";
import { transitionInstance, transitionTask } from "../task-lifecycle.js";
import { editProject, hierarchy, hierarchySnapshot } from "../task-hierarchy.js";
import { TaskGraph, graphCycles } from "../task-graph.js";
import { dependencyQuery, DependencySnapshot, editDependency } from "../task-dependencies.js";
import { applyMove, movePlan } from "../task-relocation.js";

export async function agentCommand(operation: string, ref: string | undefined, options: { path?: string; input?: string; json?: boolean }): Promise<void> {
  try {
    const input = await readAgentInput(options.input);
    if (options.input === "-" && input && typeof input === "object" && Object.entries(input).some(([key, value]) => key.endsWith("File") && value === "-")) invalid("Cannot read a request and a separate content stream from the same stdin.");
    const result = await withAgent(options.path, async context => {
      if (operation === "create") {
        if (ref) invalid("Creation takes its optional path from the JSON request.");
        return createAgentTask(context, input);
      }
      if (operation === "validate") {
        if (ref) await context.exact(ref);
        const core = await context.collection.validate(ref);
        const graph = await TaskGraph.load(context);
        const hierarchyCycles = graphCycles(graph.hierarchyEdges());
        const dependencies = await DependencySnapshot.load(context);
        const result = { valid: core.valid && !hierarchyCycles.length && !dependencies.cycles.length, core, hierarchyCycles, dependencyCycles: dependencies.cycles };
        if (!result.valid) throw new AgentError("validation_failed", "Collection/task validation found errors or graph cycles.", result);
        return result;
      }
      if (["ready", "blocked", "dependencies"].includes(operation)) return dependencyQuery(context, operation, ref, input);
      if (!ref) invalid("Supply an exact task reference.");
      if (operation === "move-plan") return movePlan(context, ref, input);
      if (operation === "move-apply") return applyMove(context, ref, input);
      if (operation === "show") return { ...await context.read(ref), hierarchy: hierarchySnapshot(await TaskGraph.load(context), ref), dependencies: (await DependencySnapshot.load(context)).evaluate(ref) };
      if (["depends-add", "depends-remove", "depends-replace"].includes(operation)) return editDependency(context, ref, operation, input);
      if (operation === "hierarchy") return hierarchy(context, ref, input);
      if (["project-add", "project-remove", "project-replace"].includes(operation)) return editProject(context, ref, operation, input);
      if (operation === "patch") return context.patch(ref, input);
      if (operation === "describe") return describeTask(context, ref, input);
      if (operation === "note") return appendEvidence(context, ref, input);
      if (["status", "complete", "reopen", "block"].includes(operation)) return transitionTask(context, ref, operation, input);
      if (["complete-instance", "reopen-instance", "skip-instance", "unskip-instance"].includes(operation)) return transitionInstance(context, ref, operation, input);
      throw new AgentError("invalid_input", `Unknown agent operation: ${operation}`);
    });
    if (options.json) console.log(JSON.stringify({ version: 1, ok: true, result }));
    else console.log(`Agent ${operation}:\n${JSON.stringify(result, null, 2)}`);
  } catch (error) {
    const failure = error instanceof AgentError ? error : new AgentError("operation_failed", (error as Error).message);
    if (options.json) console.log(JSON.stringify({ version: 1, ok: false, error: { code: failure.code, message: failure.message, details: failure.details } }));
    else console.error(`Error [${failure.code}]: ${failure.message}`);
    process.exitCode = 1;
  }
}
