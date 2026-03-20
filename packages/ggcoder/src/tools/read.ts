import path from "node:path";
import fs from "node:fs/promises";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { resolvePath, rejectSymlink } from "./path-utils.js";
import { truncateHead } from "./truncate.js";
import { processImage } from "../utils/image.js";
import { localOperations, type ToolOperations } from "./operations.js";

/** Image extensions that the read tool can render as image content blocks. */
const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tiff",
  ".tif",
]);

export const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".tiff",
  ".tif",
  ".svg",
  ".mp3",
  ".mp4",
  ".wav",
  ".avi",
  ".mov",
  ".mkv",
  ".flac",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".7z",
  ".rar",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pyc",
  ".class",
  ".o",
  ".obj",
  ".asar",
  ".node",
  ".wasm",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".snap",
  ".pack",
  ".idx",
]);

const ReadParams = z.object({
  file_path: z.string().describe("The file path to read"),
  offset: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Line number to start reading from (1-based)"),
  limit: z.number().int().min(1).optional().describe("Maximum number of lines to read"),
});

export function createReadTool(
  cwd: string,
  readFiles?: Set<string>,
  ops: ToolOperations = localOperations,
): AgentTool<typeof ReadParams> {
  return {
    name: "read",
    description:
      "Read a file's contents. Returns numbered lines (cat -n style). " +
      "Output is capped at ~25,000 tokens. If truncated, use offset/limit to read remaining sections. " +
      "Binary files return a notice instead of content.",
    parameters: ReadParams,
    async execute({ file_path, offset, limit }) {
      const resolved = resolvePath(cwd, file_path);
      await rejectSymlink(resolved);
      readFiles?.add(resolved);
      const ext = path.extname(resolved).toLowerCase();

      // Image files: read, process/resize, and return as image content block
      if (IMAGE_EXTENSIONS.has(ext)) {
        const stat = await fs.stat(resolved);
        const buffer = await fs.readFile(resolved);
        const processed = await processImage(buffer);
        const mediaType = processed.mediaType;
        const data = processed.buffer.toString("base64");
        const dimInfo = processed.dimensions
          ? ` (${processed.dimensions.originalWidth}×${processed.dimensions.originalHeight})`
          : "";
        return {
          content: `Image: ${resolved}${dimInfo}, ${stat.size} bytes`,
          images: [{ type: "image" as const, mediaType, data }],
        };
      }

      if (BINARY_EXTENSIONS.has(ext)) {
        const stat = await ops.stat(resolved);
        return `Binary file: ${resolved} (${ext}, ${stat.size} bytes)`;
      }

      const raw = await ops.readFile(resolved);
      let lines = raw.split("\n");

      // Apply offset/limit
      const startLine = offset ? offset - 1 : 0;
      const endLine = limit ? startLine + limit : lines.length;
      lines = lines.slice(startLine, endLine);

      const content = lines.join("\n");
      const result = truncateHead(content);

      // Prepend line numbers (cat -n style)
      const actualStart = startLine + 1;
      const numbered = result.content
        .split("\n")
        .map((line, i) => {
          const lineNum = String(actualStart + i).padStart(6, " ");
          return `${lineNum}\t${line}`;
        })
        .join("\n");

      if (result.truncated) {
        const nextOffset = (offset ?? 1) + result.keptLines;
        return (
          `${numbered}\n` +
          `[Truncated: showing lines ${offset ?? 1}-${(offset ?? 1) + result.keptLines - 1} of ${result.totalLines}. ` +
          `Use offset=${nextOffset} to read more.]`
        );
      }
      return numbered;
    },
  };
}
