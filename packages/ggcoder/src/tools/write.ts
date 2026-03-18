import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { resolvePath, rejectSymlink } from "./path-utils.js";
import { localOperations, type ToolOperations } from "./operations.js";

const WriteParams = z.object({
  file_path: z.string().describe("The file path to write to"),
  content: z.string().describe("The content to write"),
});

export function createWriteTool(
  cwd: string,
  readFiles?: Set<string>,
  ops: ToolOperations = localOperations,
  planModeRef?: { current: boolean },
): AgentTool<typeof WriteParams> {
  return {
    name: "write",
    description:
      "Write content to a file. Creates parent directories if needed. " +
      "Existing files must be read first before overwriting. Use for new files or complete rewrites.",
    parameters: WriteParams,
    async execute({ file_path, content }) {
      const resolved = resolvePath(cwd, file_path);
      await rejectSymlink(resolved);

      // In plan mode, only allow writing to .gg/plans/
      if (planModeRef?.current) {
        const plansDir = path.join(cwd, ".gg", "plans");
        if (!resolved.startsWith(plansDir)) {
          return (
            "Error: write is restricted in plan mode. You can only write to .gg/plans/. Got: " +
            file_path
          );
        }
        // Ensure .gg/plans/ directory exists
        await fs.mkdir(plansDir, { recursive: true });
      }

      // Block overwriting existing files that haven't been read
      if (readFiles && !readFiles.has(resolved)) {
        const exists = await ops.stat(resolved).then(
          () => true,
          () => false,
        );
        if (exists) {
          throw new Error("File must be read first before overwriting. Use the read tool first.");
        }
      }
      await ops.writeFile(resolved, content);
      const bytes = Buffer.byteLength(content, "utf-8");
      return `Wrote ${bytes} bytes to ${resolved}`;
    },
  };
}
