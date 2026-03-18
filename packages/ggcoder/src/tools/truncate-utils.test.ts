import { describe, it, expect } from "vitest";
import { truncateHead, truncateTail, MAX_LINES, MAX_CHARS } from "./truncate.js";

describe("constants", () => {
  it("MAX_LINES is 500", () => {
    expect(MAX_LINES).toBe(500);
  });

  it("MAX_CHARS is 100_000", () => {
    expect(MAX_CHARS).toBe(100_000);
  });
});

describe("truncateHead", () => {
  it("short content returns unchanged", () => {
    const result = truncateHead("line1\nline2\nline3");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("line1\nline2\nline3");
    expect(result.keptLines).toBe(3);
    expect(result.totalLines).toBe(3);
  });

  it("content over maxLines gets truncated from end (keeps first N)", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = truncateHead(content, 5);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(5);
    expect(result.totalLines).toBe(10);
    expect(result.content).toBe("line0\nline1\nline2\nline3\nline4");
  });

  it("content over maxChars gets truncated by char limit", () => {
    // Each line is 10 chars + 1 newline = 11 bytes per line
    const lines = Array.from({ length: 20 }, () => "abcdefghij");
    const content = lines.join("\n");
    // maxChars = 55 means ~5 lines worth (5 * 11 = 55)
    const result = truncateHead(content, 100, 55);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(5);
    expect(result.totalLines).toBe(20);
  });

  it("returns correct totalLines and keptLines counts", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = truncateHead(content, 30);
    expect(result.totalLines).toBe(100);
    expect(result.keptLines).toBe(30);
    expect(result.truncated).toBe(true);
  });

  it("custom maxLines and maxChars parameters work", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `row${i}`);
    const content = lines.join("\n");

    const result1 = truncateHead(content, 10);
    expect(result1.keptLines).toBe(10);
    expect(result1.truncated).toBe(true);

    const result2 = truncateHead(content, 1000);
    expect(result2.keptLines).toBe(50);
    expect(result2.truncated).toBe(false);
  });
});

describe("truncateTail", () => {
  it("short content returns unchanged", () => {
    const result = truncateTail("line1\nline2\nline3");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("line1\nline2\nline3");
    expect(result.keptLines).toBe(3);
    expect(result.totalLines).toBe(3);
  });

  it("content over maxLines keeps last N lines", () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = truncateTail(content, 5);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(5);
    expect(result.totalLines).toBe(10);
    expect(result.content).toBe("line5\nline6\nline7\nline8\nline9");
  });

  it("content over maxChars keeps last N chars worth", () => {
    // Each line is 10 chars + 1 newline = 11 bytes per line
    const lines = Array.from({ length: 20 }, () => "abcdefghij");
    const content = lines.join("\n");
    // maxChars = 55 means ~5 lines worth (5 * 11 = 55)
    const result = truncateTail(content, 100, 55);
    expect(result.truncated).toBe(true);
    expect(result.keptLines).toBe(5);
    expect(result.totalLines).toBe(20);
  });

  it("returns correct totalLines and keptLines counts", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i}`);
    const content = lines.join("\n");
    const result = truncateTail(content, 30);
    expect(result.totalLines).toBe(100);
    expect(result.keptLines).toBe(30);
    expect(result.truncated).toBe(true);
  });
});
