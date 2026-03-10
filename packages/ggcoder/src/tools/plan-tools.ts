/**
 * Plan mode tools — EnterPlanMode and ExitPlanMode.
 *
 * These tools are registered in the tool array and the model can call them
 * proactively. They interact with the PlanModeManager to transition states.
 */

import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { PlanModeManager } from "../core/plan-mode.js";

// ── EnterPlanMode ──────────────────────────────────────────

const EnterPlanModeParams = z.object({
  reason: z.string().describe("Why planning is needed before implementation"),
});

export function createEnterPlanModeTool(
  manager: PlanModeManager,
): AgentTool<typeof EnterPlanModeParams> {
  return {
    name: "enter_plan_mode",
    description:
      "Enter read-only planning mode. Use this proactively when you're about to start a " +
      "non-trivial implementation task. Getting user sign-off on your approach before writing " +
      "code prevents wasted effort and ensures alignment.\n\n" +
      "When to use:\n" +
      "- New feature implementation\n" +
      "- Multiple valid approaches exist\n" +
      "- Code modifications affecting existing behavior\n" +
      "- Architectural decisions\n" +
      "- Multi-file changes\n" +
      "- Unclear requirements\n\n" +
      "When NOT to use:\n" +
      "- Single-line fixes, typos\n" +
      "- Clear, specific instructions\n" +
      "- Pure research/exploration",
    parameters: EnterPlanModeParams,
    async execute({ reason }) {
      if (manager.state !== "idle") {
        return `Cannot enter plan mode: already in ${manager.state} state.`;
      }
      manager.setEntryMethod("tool");
      manager.enter(reason);
      return (
        "Entering plan mode. You are now in READ-ONLY mode.\n\n" +
        "Explore the codebase and create a plan. When ready, call exit_plan_mode " +
        "with your complete implementation plan.\n\n" +
        "Restrictions:\n" +
        "- Cannot write or edit files (except .gg/plans/)\n" +
        "- Read-only bash is allowed (ls, cat, git log/diff/status, etc.)\n" +
        "- Write operations are blocked (mkdir, rm, cp, mv, git add/commit, npm install, etc.)"
      );
    },
  };
}

// ── ExitPlanMode ───────────────────────────────────────────

const ExitPlanModeParams = z.object({
  plan: z.string().describe("The complete implementation plan in markdown format"),
});

export function createExitPlanModeTool(
  manager: PlanModeManager,
): AgentTool<typeof ExitPlanModeParams> {
  return {
    name: "exit_plan_mode",
    description:
      "Exit plan mode and present the implementation plan for user review. " +
      "The plan should be a complete markdown document with approach summary, " +
      "step-by-step strategy, files to modify, and potential challenges. " +
      "The user will be able to approve, edit, reject (with feedback), or cancel the plan.",
    parameters: ExitPlanModeParams,
    async execute({ plan }) {
      if (manager.state !== "planning") {
        return `Cannot exit plan mode: current state is ${manager.state}. Must be in planning state.`;
      }
      await manager.exitWithPlan(plan);
      return (
        "Plan submitted for review. The user will now see your plan and can:\n" +
        "- [a]pprove — execute the plan\n" +
        "- [r]eject — provide feedback for revision\n" +
        "- [c]ancel — discard the plan\n\n" +
        `Plan saved to: ${manager.planFilePath}`
      );
    },
  };
}
