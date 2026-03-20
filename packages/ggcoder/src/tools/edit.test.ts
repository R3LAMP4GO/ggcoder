import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createEditTool } from "./edit.js";

describe("createEditTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "edit-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("replaces exact text and returns a diff", async () => {
    const filePath = path.join(tmpDir, "hello.txt");
    await fs.writeFile(filePath, "hello world\n");

    const tool = createEditTool(tmpDir);
    const result = await tool.execute(
      { file_path: "hello.txt", old_text: "hello", new_text: "goodbye" },
      { signal: new AbortController().signal, toolCallId: "test-1" },
    );

    expect(typeof result).toBe("string");
    expect(result).toContain("-hello world");
    expect(result).toContain("+goodbye world");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("goodbye world\n");
  });

  it("returns error string in plan mode", async () => {
    const filePath = path.join(tmpDir, "plan.txt");
    await fs.writeFile(filePath, "original\n");

    const planModeRef = { current: true };
    const tool = createEditTool(tmpDir, undefined, undefined, planModeRef);
    const result = await tool.execute(
      { file_path: "plan.txt", old_text: "original", new_text: "modified" },
      { signal: new AbortController().signal, toolCallId: "test-2" },
    );

    expect(result).toContain("Error: edit is restricted in plan mode");

    // File should remain unchanged
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("original\n");
  });

  it("throws when file hasn't been read with readFiles tracking", async () => {
    const filePath = path.join(tmpDir, "unread.txt");
    await fs.writeFile(filePath, "content\n");

    const readFiles = new Set<string>();
    const tool = createEditTool(tmpDir, readFiles);

    await expect(
      tool.execute(
        { file_path: "unread.txt", old_text: "content", new_text: "new" },
        { signal: new AbortController().signal, toolCallId: "test-3" },
      ),
    ).rejects.toThrow("File must be read first");
  });

  it("allows edit when file is in readFiles set", async () => {
    const filePath = path.join(tmpDir, "tracked.txt");
    await fs.writeFile(filePath, "alpha beta\n");

    const readFiles = new Set<string>();
    readFiles.add(path.resolve(tmpDir, "tracked.txt"));

    const tool = createEditTool(tmpDir, readFiles);
    const result = await tool.execute(
      { file_path: "tracked.txt", old_text: "alpha", new_text: "gamma" },
      { signal: new AbortController().signal, toolCallId: "test-4" },
    );

    expect(result).toContain("-alpha beta");
    expect(result).toContain("+gamma beta");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("gamma beta\n");
  });

  it("throws when old_text is not found", async () => {
    const filePath = path.join(tmpDir, "missing.txt");
    await fs.writeFile(filePath, "some content here\n");

    const tool = createEditTool(tmpDir);

    await expect(
      tool.execute(
        { file_path: "missing.txt", old_text: "nonexistent text", new_text: "replacement" },
        { signal: new AbortController().signal, toolCallId: "test-5" },
      ),
    ).rejects.toThrow("old_text not found");
  });

  it("throws when old_text matches multiple times", async () => {
    const filePath = path.join(tmpDir, "dupes.txt");
    await fs.writeFile(filePath, "foo bar foo baz foo\n");

    const tool = createEditTool(tmpDir);

    await expect(
      tool.execute(
        { file_path: "dupes.txt", old_text: "foo", new_text: "qux" },
        { signal: new AbortController().signal, toolCallId: "test-6" },
      ),
    ).rejects.toThrow(/found 3 times/);
  });

  it("handles fuzzy matching with trailing whitespace and smart quotes", async () => {
    const filePath = path.join(tmpDir, "fuzzy.txt");
    // File has trailing whitespace and straight quotes
    await fs.writeFile(filePath, "const msg = 'hello';  \nend\n");

    const tool = createEditTool(tmpDir);
    // Search with no trailing whitespace and smart quotes
    const result = await tool.execute(
      {
        file_path: "fuzzy.txt",
        old_text: "const msg = \u2018hello\u2019;",
        new_text: "const msg = 'goodbye';",
      },
      { signal: new AbortController().signal, toolCallId: "test-7" },
    );

    expect(typeof result).toBe("string");
    expect(result).toContain("+const msg = 'goodbye';");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toContain("goodbye");
  });

  it("preserves CRLF line endings", async () => {
    const filePath = path.join(tmpDir, "crlf.txt");
    await fs.writeFile(filePath, "line one\r\nline two\r\nline three\r\n");

    const tool = createEditTool(tmpDir);
    const result = await tool.execute(
      { file_path: "crlf.txt", old_text: "line two", new_text: "line TWO" },
      { signal: new AbortController().signal, toolCallId: "test-8" },
    );

    expect(result).toContain("+line TWO");

    const written = await fs.readFile(filePath, "utf-8");
    expect(written).toBe("line one\r\nline TWO\r\nline three\r\n");
  });
});
