import { describe, it, expect } from "vitest";
import { fuzzyFindText, countOccurrences, generateDiff } from "./edit-diff.js";

describe("fuzzyFindText", () => {
  it("finds exact match with usedFuzzy=false", () => {
    const content = "hello world\nfoo bar\n";
    const result = fuzzyFindText(content, "foo bar");
    expect(result.found).toBe(true);
    expect(result.usedFuzzy).toBe(false);
    expect(result.index).toBe(content.indexOf("foo bar"));
    expect(result.matchLength).toBe("foo bar".length);
  });

  it("returns not found for missing text", () => {
    const content = "hello world\n";
    const result = fuzzyFindText(content, "does not exist");
    expect(result.found).toBe(false);
    expect(result.index).toBe(-1);
    expect(result.matchLength).toBe(0);
  });

  it("fuzzy matches trailing whitespace differences with usedFuzzy=true", () => {
    const content = "line one   \nline two\n";
    const search = "line one\nline two";
    const result = fuzzyFindText(content, search);
    expect(result.found).toBe(true);
    expect(result.usedFuzzy).toBe(true);
  });

  it("fuzzy matches smart quotes to straight quotes", () => {
    const content = 'She said "hello"';
    const search = "She said \u201Chello\u201D";
    const result = fuzzyFindText(content, search);
    expect(result.found).toBe(true);
    expect(result.usedFuzzy).toBe(true);
  });
});

describe("countOccurrences", () => {
  it("counts single occurrence as 1", () => {
    const content = "abc def ghi";
    expect(countOccurrences(content, "def")).toBe(1);
  });

  it("counts multiple occurrences correctly", () => {
    const content = "aaa bbb aaa ccc aaa";
    expect(countOccurrences(content, "aaa")).toBe(3);
  });

  it("returns 0 for no match", () => {
    const content = "hello world";
    expect(countOccurrences(content, "xyz")).toBe(0);
  });

  it("falls back to fuzzy count when exact is 0", () => {
    // Exact won't match because of smart quotes, fuzzy should find 1
    const contentSmartQuote = "say \u201Chi\u201D and \u201Chi\u201D";
    const searchStraight = 'say "hi"';
    // Exact won't match because of smart quotes, fuzzy should find 1
    expect(countOccurrences(contentSmartQuote, searchStraight)).toBe(1);
  });
});

describe("generateDiff", () => {
  it("produces diff with --- a/ and +++ b/ header", () => {
    const diff = generateDiff("hello\n", "hello\nworld\n", "test.txt");
    expect(diff).toContain("--- a/test.txt");
    expect(diff).toContain("+++ b/test.txt");
  });

  it("shows removed lines with - prefix and added lines with + prefix", () => {
    const diff = generateDiff("old line\n", "new line\n", "file.ts");
    expect(diff).toContain("-old line");
    expect(diff).toContain("+new line");
  });
});
