import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { AgentDefinition } from "../core/agents.js";
import type { Skill } from "../core/skills.js";
import { getExploreModel, applyCommonSuffix } from "../core/builtin-agents.js";
import { truncateTail } from "./truncate.js";

const SUB_AGENT_MAX_TURNS = 10;
const SUB_AGENT_MAX_OUTPUT_CHARS = 100_000; // ~25k tokens, matches other tool limits
const SUB_AGENT_MAX_OUTPUT_LINES = 500;
const SUB_AGENT_MAX_STDERR_CHARS = 10_000; // Cap stderr to prevent unbounded growth

const SubAgentParams = z.object({
  task: z.string().describe("The task to delegate to the sub-agent"),
  agent: z
    .string()
    .optional()
    .describe(
      'Named agent to use. Built-in: "explore" (fast read-only search), ' +
        '"plan" (architecture/planning), "worker" (full-capability), ' +
        '"fork" (isolated worker for parallel task execution). ' +
        "Or a custom agent from ~/.gg/agents/ or .gg/agents/",
    ),
});

export interface SubAgentUpdate {
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  currentActivity?: string;
}

export interface SubAgentDetails {
  toolUseCount: number;
  tokenUsage: { input: number; output: number };
  durationMs: number;
}

/**
 * Resolve skill names from an agent's `skills` field to actual Skill content,
 * then format them for injection into the agent's system prompt.
 */
function resolvePreloadedSkills(skillNames: string[], availableSkills: Skill[]): string {
  if (skillNames.length === 0 || availableSkills.length === 0) return "";

  const skillMap = new Map(availableSkills.map((s) => [s.name.toLowerCase(), s]));
  const resolved: Skill[] = [];

  for (const name of skillNames) {
    const skill = skillMap.get(name.toLowerCase());
    if (skill) resolved.push(skill);
  }

  if (resolved.length === 0) return "";

  const parts = ["\n\n## Preloaded Skills\n"];
  for (const skill of resolved) {
    parts.push(`### ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`);
    parts.push(skill.content);
    parts.push("");
  }
  parts.push("Follow the conventions and patterns from the preloaded skills.\n");

  return parts.join("\n");
}

export function createSubAgentTool(
  cwd: string,
  agents: AgentDefinition[],
  parentProvider: string,
  parentModel: string,
  availableSkills?: Skill[],
): AgentTool<typeof SubAgentParams> {
  // Sub-sub-agent prevention: if we're already a subagent, return a tool
  // that always errors. This prevents infinite recursion.
  if (process.env.GG_IS_SUBAGENT === "1") {
    return {
      name: "subagent",
      description: "Sub-agents cannot spawn other sub-agents.",
      parameters: SubAgentParams,
      async execute() {
        return "Error: Sub-agents cannot spawn other sub-agents. Complete the task directly.";
      },
    };
  }

  const agentList = agents.map((a) => `- ${a.name}: ${a.description}`).join("\n");
  const agentDesc = agentList ? `\n\nAvailable agents:\n${agentList}` : "";

  return {
    name: "subagent",
    description:
      `Spawn an isolated sub-agent with its own context window. Use for:\n` +
      `- Parallel exploration: spawn "explore" agents for codebase search\n` +
      `- Parallel execution: spawn multiple agents for independent tasks\n` +
      `- Isolation: keep large outputs out of main context\n\n` +
      `Built-in agents:\n` +
      `- explore: Fast, read-only codebase search (uses cheapest model). ` +
      `Specify thoroughness: "quick", "medium", or "very thorough"\n` +
      `- plan: Software architect for implementation planning (read-only)\n` +
      `- worker: General-purpose agent for complex multi-step tasks\n` +
      `- fork: Isolated worker for parallel task execution with structured output\n\n` +
      `Prefer "explore" for any file search, code search, or codebase questions.\n` +
      `Prefer spawning parallel agents when tasks are independent.` +
      agentDesc,
    parameters: SubAgentParams,
    async execute(args, context) {
      const startTime = Date.now();

      // Resolve agent definition if specified
      let agentDef: AgentDefinition | undefined;
      if (args.agent) {
        agentDef = agents.find((a) => a.name.toLowerCase() === args.agent!.toLowerCase());
        if (!agentDef) {
          return {
            content: `Unknown agent: "${args.agent}". Available agents: ${agents.map((a) => a.name).join(", ") || "none"}`,
          };
        }
      }

      // Resolve model — explore agent gets cheapest model
      let useModel = agentDef?.model ?? parentModel;
      if (agentDef?.name === "explore" && !agentDef.model) {
        useModel = getExploreModel(parentProvider, parentModel);
      }
      const useProvider = parentProvider;

      // Build the system prompt:
      // 1. Start with the agent's base system prompt
      // 2. Inject preloaded skills if the agent has a `skills` field
      // 3. Apply common suffix for subagent response format
      let systemPrompt = agentDef?.systemPrompt ?? "";
      if (systemPrompt) {
        // Inject preloaded skills
        if (agentDef?.skills && agentDef.skills.length > 0 && availableSkills) {
          systemPrompt += resolvePreloadedSkills(agentDef.skills, availableSkills);
        }

        // Apply common suffix — subagents get concise report instructions
        systemPrompt = applyCommonSuffix(systemPrompt, true);
      }

      // Build CLI args — limit turns to prevent runaway context growth
      const effectiveMaxTurns = agentDef?.maxTurns ?? SUB_AGENT_MAX_TURNS;
      const cliArgs: string[] = [
        "--json",
        "--provider",
        useProvider,
        "--model",
        useModel,
        "--max-turns",
        String(effectiveMaxTurns),
      ];

      if (systemPrompt) {
        cliArgs.push("--system-prompt", systemPrompt);
      }

      // Tool restrictions: if the agent has a specific tool list, enforce it
      if (agentDef?.tools && agentDef.tools.length > 0) {
        cliArgs.push("--restricted-tools", agentDef.tools.join(","));
      }

      cliArgs.push(args.task);

      // Spawn child process using same binary
      const binPath = process.argv[1];
      const child = spawn(process.execPath, [binPath, ...cliArgs], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GG_IS_SUBAGENT: "1" },
      });

      // Track progress
      let toolUseCount = 0;
      const tokenUsage = { input: 0, output: 0 };
      let currentActivity: string | undefined;
      let textOutput = "";

      // Handle abort signal
      const abortHandler = () => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 3000);
      };
      context.signal.addEventListener("abort", abortHandler, { once: true });

      return new Promise((resolve) => {
        // Read NDJSON from stdout
        const rl = createInterface({ input: child.stdout! });
        rl.on("line", (line) => {
          try {
            const event = JSON.parse(line);
            const type = event.type as string;
            switch (type) {
              case "text_delta":
                // Cap accumulation to ~2x the truncation limit (keeps tail for truncateTail)
                if (textOutput.length < SUB_AGENT_MAX_OUTPUT_CHARS * 2) {
                  textOutput += event.text;
                } else if (!textOutput.endsWith("[output capped]")) {
                  textOutput += "\n[output capped]";
                }
                break;
              case "tool_call_start":
                toolUseCount++;
                currentActivity = `${event.name}: ${truncateStr(JSON.stringify(event.args), 60)}`;
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              case "tool_call_end":
                currentActivity = undefined;
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              case "turn_end": {
                const usage = event.usage as
                  | { inputTokens: number; outputTokens: number }
                  | undefined;
                if (usage) {
                  tokenUsage.input += usage.inputTokens;
                  tokenUsage.output += usage.outputTokens;
                }
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              }
            }
          } catch {
            // Skip malformed lines
          }
        });

        // Collect stderr (capped to prevent unbounded memory growth)
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          if (stderr.length < SUB_AGENT_MAX_STDERR_CHARS) {
            stderr += chunk.toString();
            if (stderr.length > SUB_AGENT_MAX_STDERR_CHARS) {
              stderr = stderr.slice(0, SUB_AGENT_MAX_STDERR_CHARS);
            }
          }
        });

        child.on("close", (code) => {
          rl.close();
          context.signal.removeEventListener("abort", abortHandler);
          const durationMs = Date.now() - startTime;
          const details: SubAgentDetails = {
            toolUseCount,
            tokenUsage: { ...tokenUsage },
            durationMs,
          };

          if (code !== 0 && !textOutput) {
            resolve({
              content: `Sub-agent failed (exit ${code}): ${stderr.trim() || "unknown error"}`,
              details,
            });
            return;
          }

          // Truncate output to prevent blowing up parent's context
          const raw = textOutput || "(no output)";
          const result = truncateTail(raw, SUB_AGENT_MAX_OUTPUT_LINES, SUB_AGENT_MAX_OUTPUT_CHARS);
          const content = result.truncated
            ? `[Sub-agent output truncated: ${result.totalLines} total lines, showing last ${result.keptLines}]\n\n` +
              result.content
            : result.content;

          resolve({ content, details });
        });

        child.on("error", (err) => {
          rl.close();
          context.signal.removeEventListener("abort", abortHandler);
          resolve({
            content: `Failed to spawn sub-agent: ${err.message}`,
          });
        });
      });
    },
  };
}

function truncateStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
