import type { AgentTool } from "@kenkaiiii/gg-agent";
import { ProcessManager } from "../core/process-manager.js";
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
import { createSkillTool } from "./skill.js";
import { createEnterPlanTool } from "./enter-plan.js";
import { createExitPlanTool } from "./exit-plan.js";
import { createAskUserQuestionTool } from "./ask-user-question.js";
import { localOperations, type ToolOperations } from "./operations.js";
import type { AgentDefinition } from "../core/agents.js";
import type { Skill } from "../core/skills.js";

export interface CreateToolsOptions {
  agents?: AgentDefinition[];
  skills?: Skill[];
  provider?: string;
  model?: string;
  /** Custom I/O operations for remote execution (SSH, Docker, etc.). Defaults to local filesystem. */
  operations?: ToolOperations;
  /** Ref for checking plan mode state inside tool execute functions. */
  planModeRef?: { current: boolean };
  /** Callback when the LLM enters plan mode. */
  onEnterPlan?: (reason?: string) => void;
  /** Callback when the LLM exits plan mode. Returns approval result string. */
  onExitPlan?: (planPath: string) => Promise<string>;
}

export interface CreateToolsResult {
  tools: AgentTool[];
  processManager: ProcessManager;
}

export function createTools(cwd: string, opts?: CreateToolsOptions): CreateToolsResult {
  const readFiles = new Set<string>();
  const processManager = new ProcessManager();
  const ops = opts?.operations ?? localOperations;
  const planModeRef = opts?.planModeRef;

  const tools: AgentTool[] = [
    createReadTool(cwd, readFiles, ops),
    createWriteTool(cwd, readFiles, ops, planModeRef),
    createEditTool(cwd, readFiles, ops, planModeRef),
    createBashTool(cwd, processManager, ops, planModeRef),
    createFindTool(cwd),
    createGrepTool(cwd, ops),
    createLsTool(cwd, ops),
    createWebFetchTool(),
    createTaskOutputTool(processManager),
    createTaskStopTool(processManager),
    createTasksTool(cwd),
    createAskUserQuestionTool(),
  ];

  if (opts?.agents && opts.agents.length > 0 && opts.provider && opts.model) {
    tools.push(createSubAgentTool(cwd, opts.agents, opts.provider, opts.model, opts.skills, planModeRef));
  }

  if (opts?.skills && opts.skills.length > 0) {
    tools.push(createSkillTool(opts.skills));
  }

  if (opts?.onEnterPlan) {
    tools.push(createEnterPlanTool(opts.onEnterPlan));
  }

  if (opts?.onExitPlan) {
    tools.push(createExitPlanTool(cwd, opts.onExitPlan));
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
export { createSkillTool } from "./skill.js";
export { createEnterPlanTool } from "./enter-plan.js";
export { createExitPlanTool } from "./exit-plan.js";
export { createAskUserQuestionTool, setQuestionHandler } from "./ask-user-question.js";
export type { QuestionHandler, Question, QuestionOption } from "./ask-user-question.js";
export { ProcessManager } from "../core/process-manager.js";
export { localOperations, type ToolOperations } from "./operations.js";
