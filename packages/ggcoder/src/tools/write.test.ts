import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWriteTool } from "./write.js";

function resultToString(result: string | { content: string }): string {
  return typeof result === "string" ? result : result.content;
}

describe("createWriteTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes file and returns byte count with absolute path", async () => {
    const tool = createWriteTool(tmpDir);
    const content = "line1\nline2\nline3\n";
    const raw = await tool.execute(
      { file_path: "test.txt", content },
      { signal: new AbortController().signal, toolCallId: "test-1" },
    );

    const result = resultToString(raw);
    const bytes = Buffer.byteLength(content, "utf-8");
    expect(result).toBe(`Wrote ${bytes} bytes to ${path.join(tmpDir, "test.txt")}`);

    // Verify file was actually written
    const written = await fs.readFile(path.join(tmpDir, "test.txt"), "utf-8");
    expect(written).toBe(content);
  });

  it("reports correct byte count for unicode content", async () => {
    const tool = createWriteTool(tmpDir);
    const content = "héllo wörld 🚀\n";
    const raw = await tool.execute(
      { file_path: "unicode.txt", content },
      { signal: new AbortController().signal, toolCallId: "test-2" },
    );

    const result = resultToString(raw);
    const bytes = Buffer.byteLength(content, "utf-8");
    expect(result).toBe(`Wrote ${bytes} bytes to ${path.join(tmpDir, "unicode.txt")}`);
  });

  it("creates parent directories if needed", async () => {
    const tool = createWriteTool(tmpDir);
    const raw = await tool.execute(
      { file_path: "sub/dir/file.txt", content: "test\n" },
      { signal: new AbortController().signal, toolCallId: "test-3" },
    );

    const resolved = path.join(tmpDir, "sub/dir/file.txt");
    const result = resultToString(raw);
    expect(result).toBe(`Wrote 5 bytes to ${resolved}`);

    // Verify file was actually created in the nested directory
    const written = await fs.readFile(resolved, "utf-8");
    expect(written).toBe("test\n");
  });

  it("blocks overwriting existing files that haven't been read", async () => {
    const readFiles = new Set<string>();
    const tool = createWriteTool(tmpDir, readFiles);

    // Create an existing file
    const filePath = path.join(tmpDir, "existing.txt");
    await fs.writeFile(filePath, "original");

    await expect(
      tool.execute(
        { file_path: "existing.txt", content: "new content" },
        { signal: new AbortController().signal, toolCallId: "test-4" },
      ),
    ).rejects.toThrow("File must be read first before overwriting");
  });

  it("allows overwriting files that have been read", async () => {
    const readFiles = new Set<string>();
    const filePath = path.join(tmpDir, "existing.txt");
    await fs.writeFile(filePath, "original");

    // Mark as read
    readFiles.add(filePath);

    const tool = createWriteTool(tmpDir, readFiles);
    const raw = await tool.execute(
      { file_path: "existing.txt", content: "new content" },
      { signal: new AbortController().signal, toolCallId: "test-5" },
    );

    const result = resultToString(raw);
    expect(result).toContain("Wrote");
    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("new content");
  });

  it("allows writing new files without reading", async () => {
    const readFiles = new Set<string>();
    const tool = createWriteTool(tmpDir, readFiles);

    const raw = await tool.execute(
      { file_path: "brand-new.txt", content: "hello" },
      { signal: new AbortController().signal, toolCallId: "test-6" },
    );

    const result = resultToString(raw);
    expect(result).toContain("Wrote 5 bytes");
  });

  it("restricts writes to .gg/plans/ in plan mode", async () => {
    const planModeRef = { current: true };
    const tool = createWriteTool(tmpDir, undefined, undefined, planModeRef);

    const raw = await tool.execute(
      { file_path: "src/main.ts", content: "code" },
      { signal: new AbortController().signal, toolCallId: "test-7" },
    );

    const result = resultToString(raw);
    expect(result).toContain("Error: write is restricted in plan mode");
  });

  it("allows writing to .gg/plans/ in plan mode", async () => {
    const planModeRef = { current: true };
    const tool = createWriteTool(tmpDir, undefined, undefined, planModeRef);

    const raw = await tool.execute(
      { file_path: ".gg/plans/plan.md", content: "# My Plan\n" },
      { signal: new AbortController().signal, toolCallId: "test-8" },
    );

    const result = resultToString(raw);
    expect(result).toContain("Wrote");

    const written = await fs.readFile(path.join(tmpDir, ".gg/plans/plan.md"), "utf-8");
    expect(written).toBe("# My Plan\n");
  });

  it("writes empty content", async () => {
    const tool = createWriteTool(tmpDir);
    const raw = await tool.execute(
      { file_path: "empty.txt", content: "" },
      { signal: new AbortController().signal, toolCallId: "test-9" },
    );

    const result = resultToString(raw);
    expect(result).toBe(`Wrote 0 bytes to ${path.join(tmpDir, "empty.txt")}`);
  });
});
