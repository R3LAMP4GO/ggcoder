// ── Types ──────────────────────────────────────────────────

export interface SlashCommandContext {
  // These will be wired by AgentSession
  switchModel: (provider: string, model: string) => Promise<void>;
  compact: () => Promise<void>;
  newSession: () => Promise<void>;
  listSessions: () => Promise<string>;
  getSettings: () => Record<string, unknown>;
  setSetting: (key: string, value: unknown) => Promise<void>;
  getModelList: () => string;
  quit: () => void;
  togglePlanMode?: (args?: string) => string;
  getAgents?: () => { name: string; description: string; source: string; model?: string; tools: string[] }[];
}

export interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  execute: (args: string, context: SlashCommandContext) => Promise<string> | string;
}

// ── Registry ───────────────────────────────────────────────

export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommand>();

  register(command: SlashCommand): void {
    this.commands.set(command.name, command);
    for (const alias of command.aliases) {
      this.commands.set(alias, command);
    }
  }

  unregister(name: string): void {
    const cmd = this.commands.get(name);
    if (!cmd) return;
    this.commands.delete(cmd.name);
    for (const alias of cmd.aliases) {
      this.commands.delete(alias);
    }
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  getAll(): SlashCommand[] {
    // Deduplicate (aliases point to same command)
    const seen = new Set<string>();
    const result: SlashCommand[] = [];
    for (const cmd of this.commands.values()) {
      if (!seen.has(cmd.name)) {
        seen.add(cmd.name);
        result.push(cmd);
      }
    }
    return result;
  }

  parse(input: string): { name: string; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;
    const spaceIndex = trimmed.indexOf(" ");
    const name = spaceIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();
    return { name, args };
  }

  async execute(input: string, context: SlashCommandContext): Promise<string | null> {
    const parsed = this.parse(input);
    if (!parsed) return null;

    const command = this.get(parsed.name);
    if (!command) return `Unknown command: /${parsed.name}. Type /help for available commands.`;

    return command.execute(parsed.args, context);
  }
}

// ── Embedded Command Extraction ─────────────────────────────

export interface EmbeddedCommand {
  /** The matched command name (without leading /) */
  command: string;
  /** Everything in the input except the /command token */
  args: string;
  /** The raw /command token that was matched */
  raw: string;
}

/**
 * Extract a prompt/custom command from anywhere in the input string.
 * Only matches against the provided set of known command names — UI commands
 * like /quit, /model, /compact are never matched inline.
 *
 * If the input starts with `/`, returns null so the existing start-of-line
 * parsing takes priority.
 *
 * If multiple commands are found, the FIRST one wins.
 */
export function extractEmbedded(input: string, knownNames: Set<string>): EmbeddedCommand | null {
  const trimmed = input.trim();

  // If input starts with /, let the existing start-of-line parser handle it
  if (trimmed.startsWith("/")) return null;

  // Scan for /commandname tokens — word boundary before the slash ensures
  // we don't match inside URLs like https://example.com/scan
  const regex = /(?:^|\s)(\/([a-z][\w-]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(trimmed)) !== null) {
    const raw = match[1]; // "/scan"
    const name = match[2].toLowerCase(); // "scan" — normalize to lowercase
    if (knownNames.has(name)) {
      // Remove the /command token from the input to get the remaining args
      const args = trimmed
        .replace(raw, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      return { command: name, args, raw };
    }
  }

  return null;
}

// ── Bash Prefix (!) ───────────────────────────────────────

/**
 * Detect `!command` bash prefix — runs command directly.
 * Returns the command string if detected, null otherwise.
 */
export function parseBashPrefix(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("!")) return null;
  const command = trimmed.slice(1).trim();
  return command || null;
}

// ── File Mentions (@) ─────────────────────────────────────

/**
 * Extract `@path/to/file` mentions from input.
 * Returns array of file paths mentioned.
 */
export function extractFileMentions(input: string): string[] {
  const regex = /(?:^|\s)@([\w./-]+)/g;
  const mentions: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(input)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

// ── Built-in Commands ──────────────────────────────────────

export function createBuiltinCommands(): SlashCommand[] {
  return [
    {
      name: "model",
      aliases: ["m"],
      description: "Switch model or list available models",
      usage: "/model [provider:model]",
      async execute(args, ctx) {
        if (!args) {
          return ctx.getModelList();
        }
        const parts = args.split(":");
        if (parts.length === 2) {
          await ctx.switchModel(parts[0], parts[1]);
          return `Switched to ${parts[0]}:${parts[1]}`;
        }
        // Assume it's just a model name with current provider
        await ctx.switchModel("", args);
        return `Switched to model: ${args}`;
      },
    },
    {
      name: "compact",
      aliases: ["c"],
      description: "Compact conversation to reduce context usage",
      usage: "/compact",
      async execute(_args, ctx) {
        await ctx.compact();
        return "Conversation compacted.";
      },
    },
    {
      name: "settings",
      aliases: ["config"],
      description: "Show or modify settings",
      usage: "/settings [key] [value]",
      async execute(args, ctx) {
        if (!args) {
          const settings = ctx.getSettings();
          return Object.entries(settings)
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join("\n");
        }
        const [key, ...rest] = args.split(" ");
        if (rest.length === 0) {
          const settings = ctx.getSettings();
          const val = (settings as Record<string, unknown>)[key];
          return val !== undefined ? `${key}: ${JSON.stringify(val)}` : `Unknown setting: ${key}`;
        }
        const value = rest.join(" ");
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          parsed = value;
        }
        await ctx.setSetting(key, parsed);
        return `Set ${key} = ${JSON.stringify(parsed)}`;
      },
    },
    {
      name: "session",
      aliases: ["s"],
      description: "List sessions or create new",
      usage: "/session [list|new]",
      async execute(args, ctx) {
        if (args === "new" || args === "n") {
          await ctx.newSession();
          return "New session created.";
        }
        return ctx.listSessions();
      },
    },
    {
      name: "new",
      aliases: ["n"],
      description: "Start a new session",
      usage: "/new",
      async execute(_args, ctx) {
        await ctx.newSession();
        return "New session created.";
      },
    },
    {
      name: "help",
      aliases: ["h", "?"],
      description: "Show available commands",
      usage: "/help",
      execute() {
        // This will be populated dynamically by the registry
        return "Use /help to see available slash commands.";
      },
    },
    {
      name: "quit",
      aliases: ["q", "exit"],
      description: "Exit the agent",
      usage: "/quit",
      execute(_args, ctx) {
        ctx.quit();
        return "Goodbye!";
      },
    },
    {
      name: "plan",
      aliases: [],
      description: "Toggle plan mode (read-only planning with approval)",
      usage: "/plan [task description]",
      execute(args, ctx) {
        if (!ctx.togglePlanMode) return "Plan mode is not available in this session.";
        return ctx.togglePlanMode(args || undefined);
      },
    },
    {
      name: "agents",
      aliases: [],
      description: "List available agents",
      usage: "/agents",
      execute(_args, ctx) {
        if (!ctx.getAgents) return "Agent listing is not available in this session.";
        const agents = ctx.getAgents();
        if (agents.length === 0) return "No agents configured.";

        const groups: Record<string, typeof agents> = {};
        for (const a of agents) {
          const label = a.source === "global" ? "Built-in / User (~/.gg/agents/)" : "Project (.gg/agents/)";
          (groups[label] ??= []).push(a);
        }

        const lines: string[] = ["Available agents:\n"];
        for (const [group, items] of Object.entries(groups)) {
          lines.push(`  ${group}:`);
          for (const a of items) {
            const model = a.model ? ` [${a.model}]` : "";
            const tools = a.tools.length > 0 ? ` (${a.tools.join(", ")})` : " (all tools)";
            lines.push(`    ${a.name}${model} — ${a.description}${tools}`);
          }
          lines.push("");
        }
        return lines.join("\n");
      },
    },
  ];
}
