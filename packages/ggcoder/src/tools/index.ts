import type { AgentTool, ToolContext } from "@kenkaiiii/gg-agent";
import { ProcessManager } from "../core/process-manager.js";
import type { PlanModeManager } from "../core/plan-mode.js";
import { checkPlanModeBlock } from "../core/plan-mode.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";
import { createEditTool } from "./edit.js";
import { createBashTool } from "./bash.js";
import { createFindTool } from "./find.js";
import { createGrepTool } from "./grep.js";
import { createLsTool } from "./ls.js";
import { createSubAgentTool } from "./subagent.js";
import { createWebFetchTool } from "./web-fetch.js";
import { createTaskOutputTool } from "./task-output.js";
import { createTaskStopTool } from "./task-stop.js";
import { createTasksTool } from "./tasks.js";
import { createEnterPlanModeTool, createExitPlanModeTool } from "./plan-tools.js";
import { createAskUserQuestionTool } from "./ask-user-question.js";
import type { AgentDefinition } from "../core/agents.js";
import type { Skill } from "../core/skills.js";

export interface CreateToolsOptions {
  agents?: AgentDefinition[];
  provider?: string;
  model?: string;
  planModeManager?: PlanModeManager;
  skills?: Skill[];
}

export interface CreateToolsResult {
  tools: AgentTool[];
  processManager: ProcessManager;
}

/**
 * Wrap a tool with plan mode guards. When plan mode is active (state === "planning"),
 * write/edit/bash-write operations return an error instead of executing.
 */
function withPlanModeGuard(tool: AgentTool, planManager: PlanModeManager): AgentTool {
  const guardsApply = ["write", "edit", "bash"].includes(tool.name);
  if (!guardsApply) return tool;

  return {
    ...tool,
    async execute(args: unknown, context: ToolContext) {
      const blockMessage = checkPlanModeBlock(
        tool.name,
        args as Record<string, unknown>,
        planManager.state,
      );
      if (blockMessage) {
        throw new Error(blockMessage);
      }
      return tool.execute(args, context);
    },
  };
}

export function createTools(cwd: string, opts?: CreateToolsOptions): CreateToolsResult {
  const readFiles = new Set<string>();
  const processManager = new ProcessManager();
  const planManager = opts?.planModeManager;

  let tools: AgentTool[] = [
    createReadTool(cwd, readFiles),
    createWriteTool(cwd, readFiles),
    createEditTool(cwd, readFiles),
    createBashTool(cwd, processManager),
    createFindTool(cwd),
    createGrepTool(cwd),
    createLsTool(cwd),
    createWebFetchTool(),
    createTaskOutputTool(processManager),
    createTaskStopTool(processManager),
    createTasksTool(cwd),
    createAskUserQuestionTool(),
  ];

  // Add plan mode tools if a manager is provided
  if (planManager) {
    tools.push(createEnterPlanModeTool(planManager));
    tools.push(createExitPlanModeTool(planManager));

    // Wrap write/edit/bash tools with plan mode guards
    tools = tools.map((tool) => withPlanModeGuard(tool, planManager));
  }

  if (opts?.agents && opts.agents.length > 0 && opts.provider && opts.model) {
    tools.push(createSubAgentTool(cwd, opts.agents, opts.provider, opts.model, opts.skills));
  }

  return { tools, processManager };
}

export { createReadTool } from "./read.js";
export { createWriteTool } from "./write.js";
export { createEditTool } from "./edit.js";
export { createBashTool } from "./bash.js";
export { createFindTool } from "./find.js";
export { createGrepTool } from "./grep.js";
export { createLsTool } from "./ls.js";
export { createWebFetchTool } from "./web-fetch.js";
export { createTaskOutputTool } from "./task-output.js";
export { createTaskStopTool } from "./task-stop.js";
export { createTasksTool } from "./tasks.js";
export { createEnterPlanModeTool, createExitPlanModeTool } from "./plan-tools.js";
export { createAskUserQuestionTool, setQuestionHandler } from "./ask-user-question.js";
export type { QuestionHandler, Question, QuestionOption } from "./ask-user-question.js";
export { ProcessManager } from "../core/process-manager.js";
