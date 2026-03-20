import fs from "node:fs/promises";
import path from "node:path";

export type PermissionMode = "default" | "acceptEdits" | "dontAsk" | "bypassPermissions" | "plan";

export interface AgentDefinition {
  name: string;
  description: string;
  tools: string[];
  disallowedTools?: string[];
  model?: string;
  maxTurns?: number;
  background?: boolean;
  skills?: string[];
  permissionMode?: PermissionMode;
  systemPrompt: string;
  source: "global" | "project" | "builtin";
  filePath?: string;
}

/**
 * Discover agent definitions from global and project-local directories.
 * Agent files are markdown with frontmatter (similar to skills).
 */
export async function discoverAgents(options: {
  globalAgentsDir: string;
  projectDir?: string;
}): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];

  // Global agents: ~/.gg/agents/*.md
  const globalAgents = await loadAgentsFromDir(options.globalAgentsDir, "global");
  agents.push(...globalAgents);

  // Project agents: {cwd}/.gg/agents/*.md
  if (options.projectDir) {
    const projectAgentsDir = path.join(options.projectDir, ".gg", "agents");
    const projectAgents = await loadAgentsFromDir(projectAgentsDir, "project");
    agents.push(...projectAgents);
  }

  return agents;
}

async function loadAgentsFromDir(
  dir: string,
  source: "global" | "project",
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return agents;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(dir, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const agent = parseAgentFile(content, source);
      if (!agent.name) {
        agent.name = path.basename(file, ".md");
      }
      agent.filePath = filePath;
      agents.push(agent);
    } catch {
      // Skip unreadable files
    }
  }

  return agents;
}

/**
 * Parse an agent definition file with frontmatter.
 *
 * ```markdown
 * ---
 * name: scout
 * description: Fast codebase recon that returns compressed context
 * tools: read, grep, find, ls, bash
 * ---
 *
 * You are a scout. Quickly investigate a codebase...
 * ```
 */
export function parseAgentFile(raw: string, source: "global" | "project"): AgentDefinition {
  let name = "";
  let description = "";
  let tools: string[] = [];
  let disallowedTools: string[] | undefined;
  let model: string | undefined;
  let maxTurns: number | undefined;
  let background: boolean | undefined;
  let skills: string[] | undefined;
  let permissionMode: PermissionMode | undefined;
  let systemPrompt = raw;

  if (raw.startsWith("---")) {
    const endIndex = raw.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatter = raw.slice(3, endIndex).trim();
      systemPrompt = raw.slice(endIndex + 3).trim();

      for (const line of frontmatter.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();

        if (key === "name") name = value;
        else if (key === "description") description = value;
        else if (key === "tools") {
          tools = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        } else if (key === "disallowedtools" || key === "disallowed-tools") {
          disallowedTools = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        } else if (key === "model") model = value;
        else if (key === "maxturns" || key === "max-turns") {
          const parsed = parseInt(value, 10);
          if (!isNaN(parsed) && parsed > 0) maxTurns = parsed;
        } else if (key === "background") {
          background = value.toLowerCase() === "true";
        } else if (key === "skills") {
          skills = value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (key === "permissionmode" || key === "permission-mode") {
          const validModes: PermissionMode[] = [
            "default",
            "acceptEdits",
            "dontAsk",
            "bypassPermissions",
            "plan",
          ];
          if (validModes.includes(value as PermissionMode)) {
            permissionMode = value as PermissionMode;
          }
        }
      }
    }
  }

  return {
    name,
    description,
    tools,
    disallowedTools,
    model,
    maxTurns,
    background,
    skills,
    permissionMode,
    systemPrompt,
    source,
  };
}

// ── Write operations ──────────────────────────────────────

/**
 * Serialize an agent definition into frontmatter + markdown content.
 */
function serializeAgent(agent: AgentDefinition): string {
  const lines: string[] = ["---"];
  if (agent.name) lines.push(`name: ${agent.name}`);
  if (agent.description) lines.push(`description: ${agent.description}`);
  if (agent.tools.length > 0) lines.push(`tools: ${agent.tools.join(", ")}`);
  if (agent.disallowedTools && agent.disallowedTools.length > 0) {
    lines.push(`disallowed-tools: ${agent.disallowedTools.join(", ")}`);
  }
  if (agent.model) lines.push(`model: ${agent.model}`);
  if (agent.maxTurns) lines.push(`max-turns: ${agent.maxTurns}`);
  if (agent.background) lines.push(`background: true`);
  if (agent.skills && agent.skills.length > 0) {
    lines.push(`skills: ${agent.skills.join(", ")}`);
  }
  if (agent.permissionMode) lines.push(`permission-mode: ${agent.permissionMode}`);
  lines.push("---");
  lines.push("");
  lines.push(agent.systemPrompt);
  return lines.join("\n") + "\n";
}

/** Write an agent definition to a .md file. */
export async function saveAgentFile(filePath: string, agent: AgentDefinition): Promise<void> {
  await fs.writeFile(filePath, serializeAgent(agent), "utf-8");
}

/** Delete an agent .md file. */
export async function deleteAgentFile(filePath: string): Promise<void> {
  await fs.unlink(filePath);
}

/** Create a new agent .md file with a default template. Returns the file path. */
export async function createAgentFile(agentsDir: string, name: string): Promise<string> {
  await fs.mkdir(agentsDir, { recursive: true });
  const filePath = path.join(agentsDir, `${name}.md`);
  const template: AgentDefinition = {
    name,
    description: "",
    tools: [],
    model: "inherit",
    systemPrompt: `You are ${name}. Describe your role and capabilities here.`,
    source: "global",
  };
  await saveAgentFile(filePath, template);
  return filePath;
}

/** Update only the model field in an agent file's frontmatter. */
export async function updateAgentModel(filePath: string, model: string): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const agent = parseAgentFile(content, "global");
  agent.model = model;
  await saveAgentFile(filePath, agent);
}

/** Update only the tools field in an agent file's frontmatter. */
export async function updateAgentTools(filePath: string, tools: string[]): Promise<void> {
  const content = await fs.readFile(filePath, "utf-8");
  const agent = parseAgentFile(content, "global");
  agent.tools = tools;
  await saveAgentFile(filePath, agent);
}
