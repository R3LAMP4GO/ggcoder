/**
 * Plan mode state machine.
 *
 * States:
 *   idle      → Normal mode, all tools available
 *   planning  → Read-only mode, agent explores and writes plan
 *   reviewing → Plan presented to user, waiting for approval/edit/reject
 *   executing → User approved, agent executes plan with full tools
 */

import fs from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { trackPlanMode } from "./telemetry.js";

// ── Types ───────────────────────────────────────────────────

export type PlanModeState = "idle" | "planning" | "reviewing" | "executing";

export interface PlanModeManager {
  readonly state: PlanModeState;
  readonly planContent: string | null;
  readonly planFilePath: string | null;
  readonly rejectionFeedback: string | null;
  readonly clearContextOnExit: boolean;

  /** idle → planning */
  enter(reason?: string): void;

  /** planning → reviewing (stores plan + writes to disk) */
  exitWithPlan(content: string): Promise<void>;

  /** reviewing → executing → idle */
  approve(): void;

  /** reviewing → planning (with feedback for the agent) */
  reject(feedback: string): void;

  /** any → idle */
  cancel(): void;

  /** Set how plan mode was entered (for telemetry) */
  setEntryMethod(method: "tool" | "hotkey" | "command"): void;

  /** Increment the count of questions asked during this plan session */
  incrementQuestionCount(): void;

  /** Whether the interview phase is currently active */
  readonly interviewPhase: boolean;

  /** Enable or disable the interview phase */
  setInterviewPhase(enabled: boolean): void;

  /** Set whether to clear context on plan mode exit */
  setClearContextOnExit(value: boolean): void;

  /** Update plan content after external editing (only in reviewing state) */
  updatePlanContent(content: string): void;

  /** Subscribe to state changes */
  onChange(listener: PlanModeListener): () => void;
}

export type PlanModeListener = (state: PlanModeState, manager: PlanModeManager) => void;

// ── Blocked-tool helper ────────────────────────────────────

/**
 * Check if a tool call should be blocked in plan mode.
 * Returns an error message if blocked, or null if allowed.
 */
export function checkPlanModeBlock(
  toolName: string,
  args: Record<string, unknown>,
  state: PlanModeState,
): string | null {
  if (state !== "planning") return null;

  if (toolName === "write") {
    const filePath = String(args.file_path ?? "");
    if (filePath.includes(".gg/plans/") || filePath.includes(".gg/plans\\")) {
      return null; // Allow writing plan files
    }
    return "Plan mode is read-only. Cannot write files outside .gg/plans/. Call exit_plan_mode when your plan is ready.";
  }

  if (toolName === "edit") {
    return "Plan mode is read-only. Cannot edit files. Call exit_plan_mode when your plan is ready.";
  }

  if (toolName === "bash") {
    const command = String(args.command ?? "").trim().toLowerCase();
    // Allow read-only shell commands during plan mode
    if (isReadOnlyBashCommand(command)) {
      return null;
    }
    return "Plan mode is read-only. Only read-only bash commands are allowed (ls, cat, head, tail, find, grep, git status/log/diff/show/branch, wc, file, which, echo, pwd, tree, stat, du, df). Call exit_plan_mode when your plan is ready.";
  }

  return null;
}

// ── Read-only bash detection ──────────────────────────────

/** Commands that are safe to run in plan mode (read-only). */
const READ_ONLY_PREFIXES = [
  "ls", "cat", "head", "tail", "find", "grep", "egrep", "fgrep", "rg",
  "git status", "git log", "git diff", "git show", "git branch", "git tag",
  "git remote", "git stash list", "git rev-parse", "git describe",
  "wc", "file", "which", "where", "type", "echo", "printf", "pwd",
  "env", "printenv", "tree", "stat", "du", "df", "uname", "hostname",
  "date", "whoami", "id", "sort", "uniq", "cut", "awk", "sed -n",
  "diff", "comm", "join", "nl", "od", "xxd", "hexdump", "strings",
  "readlink", "realpath", "basename", "dirname", "test", "[",
];

/** Patterns that indicate a write/destructive operation. */
const WRITE_PATTERNS = [
  /\bmkdir\b/, /\btouch\b/, /\brm\b/, /\brmdir\b/, /\bcp\b/, /\bmv\b/,
  /\bchmod\b/, /\bchown\b/, /\bchgrp\b/, /\bln\b/,
  /\bgit add\b/, /\bgit commit\b/, /\bgit push\b/, /\bgit merge\b/,
  /\bgit rebase\b/, /\bgit checkout\b/, /\bgit switch\b/, /\bgit reset\b/,
  /\bgit cherry-pick\b/, /\bgit stash\s+(push|pop|drop|apply|save)\b/,
  /\bnpm install\b/, /\bnpm ci\b/, /\byarn\s+(add|install)\b/,
  /\bpnpm\s+(add|install)\b/, /\bbun\s+(add|install)\b/,
  /\bpip install\b/, /\bcargo install\b/,
  /\bsed\s+-i\b/, /\btee\b/,
  /[^|]>/, />>/, /\bcurl\s.*-o\b/, /\bwget\b/,
  /\bkill\b/, /\bpkill\b/, /\bkillall\b/,
];

/**
 * Determine if a bash command is read-only (safe for plan mode).
 * Uses a combination of prefix allowlist and write-pattern blocklist.
 */
function isReadOnlyBashCommand(command: string): boolean {
  // Empty command — allow (harmless)
  if (!command) return true;

  // Check for explicit write patterns first (blocklist takes priority)
  for (const pattern of WRITE_PATTERNS) {
    if (pattern.test(command)) return false;
  }

  // If it's piped, check each segment
  const segments = command.split(/\s*\|\s*/);
  const firstSegment = segments[0].trim();

  // Check if the first command starts with a known read-only prefix
  for (const prefix of READ_ONLY_PREFIXES) {
    if (firstSegment === prefix || firstSegment.startsWith(prefix + " ") || firstSegment.startsWith(prefix + "\t")) {
      return true;
    }
  }

  // Unknown command — block by default for safety
  return false;
}

// ── System prompt injection ────────────────────────────────

export const PLAN_MODE_SYSTEM_PROMPT = `## Plan Mode (ACTIVE)

You are in READ-ONLY planning mode. You can explore the codebase but CANNOT modify files.

### Interview Phase (ACTIVE)

Before creating your plan, you MUST gather requirements through structured questions. Do NOT skip this phase.

**Workflow:**
1. Explore the codebase first (read, grep, find, ls) to understand existing patterns
2. Ask 2-4 structured questions using \`ask_user_question\` to clarify:
   - Scope and boundaries of the change
   - Preferred approach when multiple valid options exist  
   - Constraints or requirements not obvious from the code
3. Process answers and ask follow-up questions if needed
4. Only proceed to plan creation when you have enough clarity

**Important:** The goal is to prevent wasted planning effort. A 2-minute interview saves 10 minutes of plan revision.

### Gather requirements with ask_user_question

Before creating a plan, use the \`ask_user_question\` tool to clarify requirements and understand preferences. Do NOT rush to create a plan — explore first, then ask structured questions.

The tool presents interactive multiple-choice questions in the UI. The user can select from your options or type a custom "Other" answer (auto-generated by the UI — do NOT include "Other" in your options).

You can also use **elicitation mode** for typed form fields:
\`\`\`json
{
  "elicitation": {
    "message": "Configure your project settings",
    "requestedSchema": {
      "type": "object",
      "properties": {
        "projectName": { "type": "string", "title": "Project name", "minLength": 1 },
        "useTypeScript": { "type": "boolean", "title": "Use TypeScript?", "default": true },
        "framework": { "type": "string", "title": "Framework", "enum": ["React", "Vue", "Svelte"] }
      },
      "required": ["projectName"]
    }
  }
}
\`\`\`

The user can **accept** (answer), **decline** (skip), or **cancel** the questions.

Example usage (options mode):
\`\`\`json
{
  "questions": [
    {
      "question": "Which date formatting library should we use?",
      "header": "Library",
      "options": [
        { "label": "Day.js", "description": "Lightweight (2KB), Moment.js-compatible API" },
        { "label": "date-fns", "description": "Tree-shakeable, functional approach" },
        { "label": "Temporal API", "description": "Native browser API, no dependencies" }
      ],
      "multiSelect": false
    }
  ]
}
\`\`\`

Rules:
- Ask 1-4 questions per call (not too many at once)
- Each question: 2-4 options with concise labels and descriptive trade-offs
- Use \`multiSelect: true\` for non-mutually-exclusive choices
- \`header\` should be a very short tag (max 12 chars) like "Library", "Scope", "Pattern"
- Do NOT include an "Other" option — the UI adds one automatically

### Iteration flow

1. Explore the codebase (read, grep, find, ls)
2. Call \`ask_user_question\` with structured questions to clarify requirements
3. Process the user's answers
4. Ask follow-up questions if needed (also via \`ask_user_question\`)
5. Repeat until you're confident about the requirements

### Once you have enough context

When ready, create a comprehensive plan and call \`exit_plan_mode\`. Your plan should include:
- Summary of approach and rationale
- Step-by-step implementation strategy (ordered by dependency)
- Files to create/modify (with brief descriptions of changes)
- Dependencies and sequencing
- Potential challenges and mitigations
- Estimated scope (small/medium/large)

The plan will be saved as a .md file in .gg/plans/ for reference.

DO NOT: write files, edit files, run destructive commands, or start implementation.
DO NOT: use ask_user_question for plan approval — that's what exit_plan_mode is for.

### Bash in plan mode
Read-only bash commands ARE allowed: \`ls\`, \`cat\`, \`head\`, \`tail\`, \`find\`, \`grep\`, \`git status\`, \`git log\`, \`git diff\`, \`git show\`, \`git branch\`, \`wc\`, \`file\`, \`which\`, \`echo\`, \`pwd\`, \`tree\`, \`stat\`, \`du\`, \`df\`.
Write operations are blocked: \`mkdir\`, \`touch\`, \`rm\`, \`cp\`, \`mv\`, \`git add/commit/push\`, \`npm/yarn/pnpm install\`, etc.`;

// ── Implementation ─────────────────────────────────────────

export function createPlanModeManager(cwd: string): PlanModeManager {
  let currentState: PlanModeState = "idle";
  let planContent: string | null = null;
  let planFilePath: string | null = null;
  let rejectionFeedback: string | null = null;
  let entryMethod: "tool" | "hotkey" | "command" = "tool";
  let enterTimestamp: number | null = null;
  let questionCount = 0;
  let interviewPhase = true;
  let clearContextOnExit = false;
  const listeners = new Set<PlanModeListener>();

  function notify() {
    for (const listener of listeners) {
      listener(currentState, manager);
    }
  }

  function transition(to: PlanModeState) {
    const from = currentState;
    currentState = to;
    log("INFO", "plan-mode", `State: ${from} → ${to}`);
    notify();
  }

  function getDurationMs(): number | undefined {
    return enterTimestamp ? Date.now() - enterTimestamp : undefined;
  }

  const manager: PlanModeManager = {
    get state() {
      return currentState;
    },
    get planContent() {
      return planContent;
    },
    get planFilePath() {
      return planFilePath;
    },
    get rejectionFeedback() {
      return rejectionFeedback;
    },
    get clearContextOnExit() {
      return clearContextOnExit;
    },
    setClearContextOnExit(value: boolean) {
      clearContextOnExit = value;
    },

    setEntryMethod(method: "tool" | "hotkey" | "command") {
      entryMethod = method;
    },

    incrementQuestionCount() {
      questionCount++;
    },

    get interviewPhase() {
      return interviewPhase;
    },
    setInterviewPhase(enabled: boolean) {
      interviewPhase = enabled;
    },

    enter(reason?: string) {
      if (currentState !== "idle") {
        log("WARN", "plan-mode", `Cannot enter plan mode from state: ${currentState}`);
        return;
      }
      rejectionFeedback = null;
      planContent = null;
      planFilePath = null;
      enterTimestamp = Date.now();
      questionCount = 0;
      log("INFO", "plan-mode", `Entering plan mode${reason ? `: ${reason}` : ""}`);

      trackPlanMode({
        event: "plan_enter",
        entryMethod,
        interviewPhaseEnabled: true,
      });

      transition("planning");
    },

    async exitWithPlan(content: string) {
      if (currentState !== "planning") {
        log("WARN", "plan-mode", `Cannot exit with plan from state: ${currentState}`);
        return;
      }
      planContent = content;

      // Write plan to .gg/plans/
      const plansDir = path.join(cwd, ".gg", "plans");
      await fs.mkdir(plansDir, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const slug = content
        .slice(0, 60)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      const filename = `${timestamp}-${slug || "plan"}.md`;
      planFilePath = path.join(plansDir, filename);

      await fs.writeFile(planFilePath, content, "utf-8");
      log("INFO", "plan-mode", `Plan written to ${planFilePath}`);

      trackPlanMode({
        event: "plan_exit",
        entryMethod,
        planLengthChars: content.length,
        interviewPhaseEnabled: true,
        questionCount,
        interviewQuestionsAsked: questionCount,
      });

      transition("reviewing");
    },

    approve() {
      if (currentState !== "reviewing") {
        log("WARN", "plan-mode", `Cannot approve from state: ${currentState}`);
        return;
      }
      log("INFO", "plan-mode", "Plan approved — executing");

      trackPlanMode({
        event: "plan_approve",
        entryMethod,
        outcome: "approved",
        interviewPhaseEnabled: true,
        questionCount,
        interviewQuestionsAsked: questionCount,
        durationMs: getDurationMs(),
        planLengthChars: planContent?.length,
      });

      transition("executing");
      // Auto-transition to idle after approval
      transition("idle");
    },

    reject(feedback: string) {
      if (currentState !== "reviewing") {
        log("WARN", "plan-mode", `Cannot reject from state: ${currentState}`);
        return;
      }
      rejectionFeedback = feedback;
      log("INFO", "plan-mode", `Plan rejected with feedback: ${feedback}`);

      trackPlanMode({
        event: "plan_reject",
        entryMethod,
        outcome: "rejected",
        interviewPhaseEnabled: true,
        questionCount,
        durationMs: getDurationMs(),
        planLengthChars: planContent?.length,
      });

      transition("planning");
    },

    updatePlanContent(content: string) {
      if (currentState !== "reviewing") {
        log("WARN", "plan-mode", `Cannot update plan content from state: ${currentState}`);
        return;
      }
      planContent = content;
      log("INFO", "plan-mode", "Plan content updated after external edit");
      notify();
    },

    cancel() {
      const prev = currentState;
      log("INFO", "plan-mode", `Plan mode cancelled from state: ${prev}`);

      trackPlanMode({
        event: "plan_cancel",
        entryMethod,
        outcome: "cancelled",
        interviewPhaseEnabled: prev === "planning" || prev === "reviewing",
        questionCount,
        durationMs: getDurationMs(),
        planLengthChars: planContent?.length ?? undefined,
      });

      planContent = null;
      planFilePath = null;
      rejectionFeedback = null;
      enterTimestamp = null;
      questionCount = 0;
      interviewPhase = true;
      clearContextOnExit = false;
      transition("idle");
    },

    onChange(listener: PlanModeListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return manager;
}
