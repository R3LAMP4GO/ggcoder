import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseSkillFile } from "./skills.js";

export interface CustomCommand {
  name: string;
  description: string;
  prompt: string;
  filePath: string;
}

/**
 * Load commands from a single directory.
 * @param commandsDir - absolute path to a commands directory
 * @param source - label for the description (e.g. "global" or "project")
 */
async function loadCommandsFromDir(
  commandsDir: string,
  source: "global" | "project",
): Promise<CustomCommand[]> {
  const commands: CustomCommand[] = [];

  let files: string[];
  try {
    files = await fs.readdir(commandsDir);
  } catch {
    return commands;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(commandsDir, file);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = parseSkillFile(raw, source === "global" ? "user" : "project");
      const name = parsed.name || path.basename(file, ".md");
      commands.push({
        name,
        description:
          parsed.description ||
          `Custom command from ${source === "global" ? "~" : ""}/.gg/commands/${file}`,
        prompt: parsed.content,
        filePath,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return commands;
}

/**
 * Load custom slash commands from ~/.gg/commands/*.md (global) and
 * {cwd}/.gg/commands/*.md (project-local).
 *
 * Project-level commands take priority over global ones when names collide.
 */
export async function loadCustomCommands(cwd: string): Promise<CustomCommand[]> {
  const globalDir = path.join(os.homedir(), ".gg", "commands");
  const projectDir = path.join(cwd, ".gg", "commands");

  // Load both in parallel — global first, then project overrides
  const [globalCmds, projectCmds] = await Promise.all([
    loadCommandsFromDir(globalDir, "global"),
    loadCommandsFromDir(projectDir, "project"),
  ]);

  // Deduplicate by name — project commands override global ones
  const seen = new Map<string, CustomCommand>();
  for (const cmd of globalCmds) seen.set(cmd.name, cmd);
  for (const cmd of projectCmds) seen.set(cmd.name, cmd);
  return [...seen.values()];
}
