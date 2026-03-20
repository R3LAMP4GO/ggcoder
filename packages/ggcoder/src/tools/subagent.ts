import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { AgentDefinition } from "../core/agents.js";
import type { Skill } from "../core/skills.js";
import { resolveAgentModel, applyCommonSuffix } from "../core/builtin-agents.js";
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
  planModeRef?: { current: boolean },
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
      `Spawn an isolated sub-agent. IMPORTANT: Each spawn creates a new process with its own context — ` +
      `there is real overhead. Do NOT spawn an agent when you can accomplish the task yourself ` +
      `with 1-3 tool calls (grep, find, read). Only spawn when:\n` +
      `- You need PARALLEL execution of 2+ independent tasks\n` +
      `- The task requires 5+ tool calls and the output would bloat your context\n` +
      `- You need deep research across many files in unfamiliar code\n\n` +
      `Do NOT spawn when:\n` +
      `- A single grep + read answers the question\n` +
      `- You already have the relevant files in context\n` +
      `- You need the result for your very next edit (round-trip overhead wastes tokens)\n` +
      `- The task is trivial (finding a file, checking a type, reading a config)\n\n` +
      `Built-in agents:\n` +
      `- explore: Read-only codebase search (cheapest model). For broad searches across many files.\n` +
      `- plan: Architecture/planning (read-only)\n` +
      `- worker: Full-capability for complex multi-step tasks\n` +
      `- fork: Parallel execution — each fork handles one unit of work` +
      agentDesc,
    parameters: SubAgentParams,
    async execute(args, context) {
      if (planModeRef?.current) {
        return "Error: subagent is restricted in plan mode. Use read-only tools to explore the codebase.";
      }

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

      // Resolve model — agents can specify "haiku", "sonnet", "inherit", or a specific model ID
      const useModel = resolveAgentModel(agentDef?.model, parentProvider, parentModel);
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
        parentModel,
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

      return new Promise((resolve, reject) => {
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
                currentActivity = formatToolActivity(
                  event.name as string,
                  event.args as Record<string, unknown>,
                );
                context.onUpdate?.({
                  toolUseCount,
                  tokenUsage: { ...tokenUsage },
                  currentActivity,
                });
                break;
              case "tool_call_end":
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
            reject(
              Object.assign(
                new Error(
                  `Sub-agent failed (exit ${code}): ${stderr.trim() || "unknown error"}`,
                ),
                { details },
              ),
            );
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
          reject(new Error(`Failed to spawn sub-agent: ${err.message}`));
        });
      });
    },
  };
}

/** Build a short, human-readable activity string for a sub-agent tool call. */
function formatToolActivity(name: string, args: Record<string, unknown>): string {
  // Extract the most meaningful short value for common tools
  switch (name) {
    case "read":
      return `Reading ${shortenPath(String(args.file_path ?? ""))}`;
    case "write":
      return `Writing ${shortenPath(String(args.file_path ?? ""))}`;
    case "edit":
      return `Editing ${shortenPath(String(args.file_path ?? ""))}`;
    case "grep": {
      const pat = String(args.pattern ?? "");
      return `Searching for "${truncateStr(pat, 30)}"`;
    }
    case "find": {
      const pat = String(args.pattern ?? "");
      return `Finding "${truncateStr(pat, 30)}"`;
    }
    case "ls":
      return `Listing ${shortenPath(String(args.path ?? "."))}`;
    case "bash": {
      const cmd = String(args.command ?? "").split("\n")[0];
      return `Running ${truncateStr(cmd, 35)}`;
    }
    case "web_fetch":
      return `Fetching ${truncateStr(String(args.url ?? ""), 35)}`;
    default: {
      // MCP or unknown tools — show name + first short arg value
      const firstVal = Object.values(args).find((v) => typeof v === "string" && v.length > 0);
      const detail = firstVal ? truncateStr(String(firstVal), 30) : "";
      return detail ? `${name}: ${detail}` : name;
    }
  }
}

function shortenPath(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return "…/" + parts.slice(-2).join("/");
}

function truncateStr(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
