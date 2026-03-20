import fs from "node:fs/promises";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  content: string;
  source: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  argumentHint?: string;
  model?: string;
  context?: "fork" | "inline";
  agent?: string;
}

/**
 * Discover skills from global and project-local skill directories.
 */
export async function discoverSkills(options: {
  globalSkillsDir: string;
  projectDir?: string;
}): Promise<Skill[]> {
  const skills: Skill[] = [];

  // Global skills: ~/.gg/skills/*.md
  const globalSkills = await loadSkillsFromDir(options.globalSkillsDir, "global");
  skills.push(...globalSkills);

  // Project skills: {cwd}/.gg/skills/*.md
  if (options.projectDir) {
    const projectSkillsDir = path.join(options.projectDir, ".gg", "skills");
    const projectSkills = await loadSkillsFromDir(projectSkillsDir, "project");
    skills.push(...projectSkills);
  }

  return skills;
}

async function loadSkillsFromDir(dir: string, source: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return skills;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(dir, file);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const skill = parseSkillFile(content, source);
      if (!skill.name) {
        skill.name = path.basename(file, ".md");
      }
      skills.push(skill);
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}

/**
 * Parse a skill file with optional frontmatter.
 * Supports simple key: value frontmatter between --- delimiters.
 */
export function parseSkillFile(raw: string, source: string): Skill {
  let name = "";
  let description = "";
  let content = raw;
  let disableModelInvocation: boolean | undefined;
  let userInvocable: boolean | undefined;
  let allowedTools: string[] | undefined;
  let argumentHint: string | undefined;
  let model: string | undefined;
  let context: "fork" | "inline" | undefined;
  let agent: string | undefined;

  // Check for frontmatter
  if (raw.startsWith("---")) {
    const endIndex = raw.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatter = raw.slice(3, endIndex).trim();
      content = raw.slice(endIndex + 3).trim();

      for (const line of frontmatter.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim().toLowerCase().replace(/-/g, "");
        const value = line.slice(colonIndex + 1).trim();
        if (key === "name") name = value;
        else if (key === "description") description = value;
        else if (key === "disablemodelinvocation")
          disableModelInvocation = value.toLowerCase() === "true";
        else if (key === "userinvocable") userInvocable = value.toLowerCase() !== "false";
        else if (key === "allowedtools")
          allowedTools = value
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
        else if (key === "argumenthint") argumentHint = value;
        else if (key === "model") model = value;
        else if (key === "context" && (value === "fork" || value === "inline")) context = value;
        else if (key === "agent") agent = value;
      }
    }
  }

  return {
    name,
    description,
    content,
    source,
    disableModelInvocation,
    userInvocable,
    allowedTools,
    argumentHint,
    model,
    context,
    agent,
  };
}

/**
 * Apply string substitutions to skill content.
 * Supports $ARGUMENTS, $ARGUMENTS[N], $N, ${CLAUDE_SESSION_ID}.
 */
export function applySkillSubstitutions(content: string, args: string, sessionId?: string): string {
  const argParts = args.split(/\s+/).filter(Boolean);

  let result = content;

  // Replace indexed args first (longer patterns before shorter)
  for (let i = argParts.length - 1; i >= 0; i--) {
    result = result.replace(new RegExp(`\\$ARGUMENTS\\[${i}\\]`, "g"), argParts[i]);
    result = result.replace(new RegExp(`\\$${i}`, "g"), argParts[i]);
  }

  // Replace $ARGUMENTS (full string)
  if (result.includes("$ARGUMENTS")) {
    result = result.replace(/\$ARGUMENTS/g, args);
  }

  // Replace ${CLAUDE_SESSION_ID}
  if (sessionId) {
    result = result.replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);
  }

  return result;
}

/**
 * Format skills as a summary list for the system prompt.
 * Only includes names and descriptions — full content is loaded on-demand via the skill tool.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const list = skills
    .map((s) => `- **${s.name}**${s.description ? `: ${s.description}` : ""}`)
    .join("\n");

  return (
    `## Skills\n\n` +
    `The following skills are available. Use the **skill** tool to invoke a skill when needed:\n\n` +
    list
  );
}
